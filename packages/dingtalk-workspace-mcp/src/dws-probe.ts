/**
 * dws 探测：启动期检查 dws 是否可用、版本是否达标、是否已 auth。
 *
 * 探测结果驱动 server 启动决策：
 *   - NOT_INSTALLED / VERSION_TOO_OLD → 启动期 exit 1
 *   - NOT_AUTHENTICATED → 启动成功，但 schema-loader 走"help-tree 降级 / bootstrap tool"路径
 *   - 全 ok → schema-loader 走"dws schema --format json"正路
 */

import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DwsProbeResult, Result } from './types.js';
import { ok, err } from './types.js';
import { makeError } from './errors.js';
import type { DwsError } from './types.js';

/** package.json 中声明的最低 dws 版本。schema 命令至少要 v1.0.7 才稳定 */
export const DWS_MIN_VERSION = '1.0.7';

export interface SpawnOnceResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type SpawnOnceFn = (
  bin: string,
  args: string[],
  timeoutMs?: number
) => Promise<SpawnOnceResult>;

export function spawnOnce(
  bin: string,
  args: string[],
  timeoutMs = 10_000
): Promise<SpawnOnceResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    // Buffer[] avoids O(n²) string concat on chunked output (multi-MB list responses).
    const out: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`spawn timeout: ${bin} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString('utf-8'),
        stderr: Buffer.concat(errChunks).toString('utf-8'),
        exitCode: code,
      });
    });
  });
}

/**
 * Shared spawn-and-classify primitive used by schema-loader and dispatch.
 * Returns ok({stdout, stderr}) when child exits 0; err DwsError on timeout or non-zero exit.
 * Callers handle output parsing themselves.
 */
export async function runDws(
  args: string[],
  ctx: { binaryPath: string; timeoutMs?: number; spawnImpl?: SpawnOnceFn }
): Promise<Result<{ stdout: string; stderr: string }, DwsError>> {
  const timeout = ctx.timeoutMs ?? 30_000;
  const run = ctx.spawnImpl ?? spawnOnce;
  let result: SpawnOnceResult;
  try {
    result = await run(ctx.binaryPath, args, timeout);
  } catch (e) {
    return err(makeError('TIMEOUT', `dws ${args.join(' ')}: ${(e as Error).message}`));
  }
  if (result.exitCode !== 0) {
    return err(
      makeError('NON_ZERO_EXIT', `dws ${args.join(' ')} exit ${result.exitCode}`, {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? -1,
      })
    );
  }
  return ok({ stdout: result.stdout, stderr: result.stderr });
}

/**
 * 在 PATH 中查找 dws 二进制。
 * 跨平台：Windows 自动尝试 .exe / .cmd / .bat 后缀。
 */
export function locateDws(env: NodeJS.ProcessEnv = process.env): string | null {
  const pathVar = env['PATH'] ?? env['Path'] ?? '';
  const isWin = process.platform === 'win32';
  const candidates = isWin ? ['dws.exe', 'dws.cmd', 'dws.bat', 'dws'] : ['dws'];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const name of candidates) {
      const full = join(dir, name);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/**
 * 比较 semver-like 版本，仅取前三段数字。
 * 返回正数表示 a > b，0 相等，负数 a < b。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .slice(0, 3)
      .map((p) => parseInt(p.replace(/[^0-9].*$/, ''), 10) || 0);
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < 3; i++) {
    const da = va[i] ?? 0;
    const db = vb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** 解析 `dws version` JSON 输出，提取版本号字符串（如 "v1.0.8"） */
export function parseVersionOutput(stdout: string): string | null {
  // dws v1.0.8 默认输出 JSON 形式: { "Version": "v1.0.8", ... }
  // 但全局 --format 默认 json 时输出可能是 plain text. 双格式兼容
  const trimmed = stdout.trim();
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ['Version', 'version']) {
      const v = obj[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  } catch {
    // 非 JSON, 走文本解析
  }
  const m = trimmed.match(/Version:\s*(\S+)/i);
  return m?.[1] ?? null;
}

/**
 * 解析 `dws auth status` JSON：{ success, authenticated, message }
 */
export function parseAuthStatus(stdout: string): boolean {
  try {
    const obj = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return obj['authenticated'] === true;
  } catch {
    return false;
  }
}

export interface ProbeOptions {
  /** 注入用：覆盖 dws 二进制路径（测试 / 自定义） */
  binaryPath?: string;
  /** 单次 spawn 超时 */
  timeoutMs?: number;
  /** 注入用：自定义 spawn 实现（测试 / 自定义） */
  spawnImpl?: SpawnOnceFn;
}

/**
 * 完整探测流程。
 * 失败时返回带 code 的 DwsError，调用方决定是 exit 1 还是降级。
 */
export async function probeDws(
  opts: ProbeOptions = {}
): Promise<Result<DwsProbeResult, DwsError>> {
  const binaryPath = opts.binaryPath ?? locateDws();
  if (!binaryPath) {
    return err(
      makeError(
        'NOT_INSTALLED',
        'dws CLI not found in PATH. Install: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli#installation'
      )
    );
  }

  const timeout = opts.timeoutMs ?? 10_000;
  const run = opts.spawnImpl ?? spawnOnce;

  let versionResult: SpawnOnceResult;
  try {
    versionResult = await run(binaryPath, ['version'], timeout);
  } catch (e) {
    return err(
      makeError('NOT_INSTALLED', `Failed to invoke dws: ${(e as Error).message}`)
    );
  }
  const version = parseVersionOutput(versionResult.stdout);
  if (!version) {
    return err(
      makeError('NOT_INSTALLED', `Cannot parse dws version output`, {
        stdout: versionResult.stdout,
        stderr: versionResult.stderr,
      })
    );
  }
  if (compareVersions(version, DWS_MIN_VERSION) < 0) {
    return err(
      makeError(
        'VERSION_TOO_OLD',
        `dws ${version} < required ${DWS_MIN_VERSION}. Run: dws upgrade`
      )
    );
  }

  // auth 探测失败不致命: 视作未 auth, schema-loader 走降级路径
  let authenticated = false;
  try {
    const authResult = await run(binaryPath, ['auth', 'status'], timeout);
    authenticated = parseAuthStatus(authResult.stdout);
  } catch {
    authenticated = false;
  }

  return ok({ binaryPath, version, authenticated });
}
