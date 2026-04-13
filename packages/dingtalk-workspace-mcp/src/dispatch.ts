/**
 * MCP tools/call → dws CLI 调度。
 *
 * 唯一职责：把 MCP arguments 翻译成 dws CLI 调用，捕获结果，归一化错误。
 * 不做任何业务判断（哪个产品 / 哪个场景 / 是否需要重试等都由调用方决定）。
 *
 * 参数序列化规则：见 docs/decisions/001-param-serialization.md §D1
 */

import { spawn } from 'node:child_process';
import type { DwsError, DwsFlagSpec, DwsToolSpec, Result } from './types.js';
import { ok, err } from './types.js';
import { isAuthExpiredStderr, makeError } from './errors.js';

export interface DispatchOptions {
  binaryPath: string;
  /** 单次 dws 调用超时（ms） */
  timeoutMs?: number;
  /** 注入用：覆盖 spawn（测试用） */
  spawnImpl?: typeof spawn;
}

export interface DispatchResult {
  /** 进程 stdout 原文。MCP server 决定如何呈现给 agent */
  stdout: string;
  /** stderr（已脱敏）。成功路径通常为空 */
  stderr: string;
  exitCode: number;
}

/** Convert MCP arguments object into dws CLI flag list per ADR-001 §D1. */
export function flagify(
  tool: DwsToolSpec,
  args: Record<string, unknown>
): Result<string[], DwsError> {
  const flagBySpec = new Map(tool.flags.map((f) => [f.name, f]));
  const out: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    const r = flagifyOne(key, value, flagBySpec.get(key));
    if (!r.ok) return r;
    out.push(...r.value);
  }
  return ok(out);
}

export function flagifyOne(
  key: string,
  value: unknown,
  spec: DwsFlagSpec | undefined
): Result<string[], DwsError> {
  if (typeof value === 'boolean') {
    return ok(value ? [`--${key}`] : []);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return ok([`--${key}`, String(value)]);
  }
  if (Array.isArray(value)) {
    if (spec?.semanticType === 'json_array') {
      return ok([`--${key}`, JSON.stringify(value)]);
    }
    if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return ok([`--${key}`, value.map(String).join(',')]);
    }
    return ok([`--${key}`, JSON.stringify(value)]);
  }
  if (typeof value === 'object') {
    return ok([`--${key}`, JSON.stringify(value)]);
  }
  return err(makeError('INVALID_OUTPUT', `Unsupported value type for --${key}: ${typeof value}`));
}

/**
 * 调度 dws 子命令。
 * 强制注入 --yes（agent 场景跳过确认）+ --format json（结构化输出）。
 */
export async function dispatchTool(
  tool: DwsToolSpec,
  args: Record<string, unknown>,
  options: DispatchOptions
): Promise<Result<DispatchResult, DwsError>> {
  const timeout = options.timeoutMs ?? 120_000;
  const spawnFn = options.spawnImpl ?? spawn;

  const flagsResult = flagify(tool, args);
  if (!flagsResult.ok) return flagsResult;
  const cliArgs = [...tool.command, ...flagsResult.value, '--yes', '--format', 'json'];

  return new Promise((resolve) => {
    const child = spawnFn(options.binaryPath, cliArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Buffer[] avoids O(n²) string concat on chunked outputs (multi-MB lists).
    const out: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout?.on('data', (c: Buffer) => out.push(c));
    child.stderr?.on('data', (c: Buffer) => errChunks.push(c));

    const collect = () => ({
      stdout: Buffer.concat(out).toString('utf-8'),
      stderr: Buffer.concat(errChunks).toString('utf-8'),
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      const { stdout, stderr } = collect();
      resolve(
        err(
          makeError('NOT_INSTALLED', `spawn failed: ${e.message}`, { stdout, stderr })
        )
      );
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const { stdout, stderr } = collect();

      if (killedByTimeout) {
        resolve(
          err(
            makeError('TIMEOUT', `dws timed out after ${timeout}ms`, {
              stdout,
              stderr,
              exitCode: exitCode ?? -1,
            })
          )
        );
        return;
      }

      if (exitCode === 0) {
        resolve(ok({ stdout, stderr, exitCode: 0 }));
        return;
      }

      const code = isAuthExpiredStderr(stderr) ? 'AUTH_EXPIRED' : 'NON_ZERO_EXIT';
      resolve(
        err(
          makeError(code, `dws ${tool.command.join(' ')} exit ${exitCode}`, {
            stdout,
            stderr,
            exitCode: exitCode ?? -1,
          })
        )
      );
    });
  });
}
