/**
 * 共享类型定义。
 *
 * Result<T, E> 模式：所有可能失败的内部 API 返回 Result，避免 throw 滥用。
 */

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** dws 探测结果：足以让 server.ts 决定走哪条 schema-loader 路径 */
export interface DwsProbeResult {
  binaryPath: string;
  version: string;
  authenticated: boolean;
}

/** 已知的 dws 错误类别，schema-loader / dispatch 共用 */
export type DwsErrorCode =
  | 'NOT_INSTALLED'
  | 'VERSION_TOO_OLD'
  | 'NOT_AUTHENTICATED'
  | 'AUTH_EXPIRED'
  | 'TIMEOUT'
  | 'NON_ZERO_EXIT'
  | 'INVALID_OUTPUT';

export interface DwsError {
  code: DwsErrorCode;
  message: string;
  /** dws stderr 原文（已脱敏） */
  stderr?: string;
  /** dws stdout 原文 */
  stdout?: string;
  /** 进程退出码 */
  exitCode?: number;
}

/**
 * 从 dws schema 还原后的统一 Tool 描述。
 * schema-loader 双轨（schema JSON / help-tree）输出统一为此结构。
 */
export interface DwsToolSpec {
  /** MCP tool name, e.g. "dingtalk.todo.task_create" */
  name: string;
  /** 自然语言描述（来自 dws desc） */
  description: string;
  /** dws 调用时的子命令路径，e.g. ["todo", "task", "create"] */
  command: string[];
  /** flag 定义列表 */
  flags: DwsFlagSpec[];
}

export interface DwsFlagSpec {
  /** flag 名（不带 -- 前缀） */
  name: string;
  /** 原始 dws 类型 */
  rawType: 'string' | 'int' | 'bool';
  /** 经过 ADR-001 §D2 提升后的语义类型 */
  semanticType:
    | 'string'
    | 'integer'
    | 'boolean'
    | 'array_of_string' // 逗号分隔
    | 'array_of_integer' // 逗号分隔
    | 'json_array' // 整体 JSON 字符串
    | 'json_object'; // 整体 JSON 字符串
  description: string;
  required: boolean;
}
