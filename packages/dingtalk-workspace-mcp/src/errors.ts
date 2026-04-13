/**
 * 错误归一化与脱敏。
 *
 * 安全约定：MCP 返回内容会落到 LLM context；任何疑似 token / cookie / authorization
 * header 的字符串都必须脱敏，避免凭据回灌训练数据或日志。
 */

import type { DwsError, DwsErrorCode } from './types.js';

/** 简单脱敏：常见凭据模式替换为占位符 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [REDACTED]'],
  [/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]'],
  [/access[_-]?token["'\s:=]+[A-Za-z0-9._\-+/=]{8,}/gi, 'access_token=[REDACTED]'],
  [/refresh[_-]?token["'\s:=]+[A-Za-z0-9._\-+/=]{8,}/gi, 'refresh_token=[REDACTED]'],
  [/AppKey["'\s:=]+[A-Za-z0-9._\-]{8,}/gi, 'AppKey=[REDACTED]'],
  [/AppSecret["'\s:=]+[A-Za-z0-9._\-]{8,}/gi, 'AppSecret=[REDACTED]'],
  [/ghp_[A-Za-z0-9]{20,}/g, 'ghp_[REDACTED]'],
  [/sk-[A-Za-z0-9]{20,}/g, 'sk-[REDACTED]'],
];

export function redact(input: string | undefined): string | undefined {
  if (!input) return input;
  let out = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function makeError(
  code: DwsErrorCode,
  message: string,
  extra: { stdout?: string; stderr?: string; exitCode?: number } = {}
): DwsError {
  return {
    code,
    message,
    stdout: redact(extra.stdout),
    stderr: redact(extra.stderr),
    exitCode: extra.exitCode,
  };
}

/** 把 DwsError 渲染成可读文本（注入 MCP 错误返回） */
export function formatError(error: DwsError): string {
  const lines: string[] = [`[${error.code}] ${error.message}`];
  if (error.exitCode !== undefined) lines.push(`exit code: ${error.exitCode}`);
  if (error.stderr) lines.push(`stderr:\n${error.stderr.trim()}`);
  if (error.stdout) lines.push(`stdout:\n${error.stdout.trim()}`);
  return lines.join('\n');
}

/** dws stderr 触发 auth 失效的关键词探测 */
export function isAuthExpiredStderr(stderr: string | undefined): boolean {
  if (!stderr) return false;
  const lower = stderr.toLowerCase();
  return (
    lower.includes('unauthorized') ||
    lower.includes('token expired') ||
    lower.includes('未登录') ||
    lower.includes('授权过期') ||
    lower.includes('请重新登录') ||
    lower.includes('401')
  );
}
