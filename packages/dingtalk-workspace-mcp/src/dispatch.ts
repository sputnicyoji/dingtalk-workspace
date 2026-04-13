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

/**
 * 把 MCP arguments object 转成 dws CLI flags。
 *
 * @param tool 调度目标（提供 flag 元信息以做 array/object 分支）
 * @param args MCP tools/call 传入的 arguments 对象
 */
export function flagify(
  tool: DwsToolSpec,
  args: Record<string, unknown>
): string[] {
  const flagBySpec = new Map(tool.flags.map((f) => [f.name, f]));
  const out: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    const spec = flagBySpec.get(key);
    out.push(...flagifyOne(key, value, spec));
  }
  return out;
}

export function flagifyOne(
  key: string,
  value: unknown,
  spec: DwsFlagSpec | undefined
): string[] {
  // boolean → switch flag
  if (typeof value === 'boolean') {
    return value ? [`--${key}`] : [];
  }

  // 简单标量
  if (typeof value === 'string' || typeof value === 'number') {
    return [`--${key}`, String(value)];
  }

  // array：按 spec 分流
  if (Array.isArray(value)) {
    if (spec?.semanticType === 'json_array') {
      return [`--${key}`, JSON.stringify(value)];
    }
    // array_of_* 或没有 spec → 默认逗号分隔
    if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return [`--${key}`, value.map(String).join(',')];
    }
    // array of objects 兜底为 JSON
    return [`--${key}`, JSON.stringify(value)];
  }

  // object → JSON 字符串
  if (typeof value === 'object') {
    return [`--${key}`, JSON.stringify(value)];
  }

  throw new Error(`Unsupported value type for --${key}: ${typeof value}`);
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

  let flags: string[];
  try {
    flags = flagify(tool, args);
  } catch (e) {
    return err(
      makeError('INVALID_OUTPUT', `Failed to serialize args: ${(e as Error).message}`)
    );
  }

  const cliArgs = [...tool.command, ...flags, '--yes', '--format', 'json'];

  return new Promise((resolve) => {
    const child = spawnFn(options.binaryPath, cliArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf-8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf-8')));

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(
        err(
          makeError('NOT_INSTALLED', `spawn failed: ${e.message}`, {
            stdout,
            stderr,
          })
        )
      );
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);

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
