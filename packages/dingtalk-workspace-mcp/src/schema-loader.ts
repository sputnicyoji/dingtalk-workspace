/**
 * Schema 发现：双轨 + 优雅降级。
 *
 * 路径优先级（见 ADR-001 §D2）：
 *   1. `dws schema --format json` —— 已 auth 时返回完整 JSON Schema（最权威）
 *   2. `dws --help` 树形遍历 —— 未 auth 也能用，cobra 文本解析
 *   3. 全失败 → 上层 server 只暴露 dingtalk.bootstrap 工具
 *
 * 命名约定：MCP tool name = "dingtalk." + 命令路径用 "." 连接
 *   例：dws todo task create → dingtalk.todo.task.create
 */

import type { DwsError, DwsFlagSpec, DwsToolSpec, Result } from './types.js';
import { ok, err } from './types.js';
import { runDws, spawnOnce, type SpawnOnceFn } from './dws-probe.js';

/**
 * `dws schema --format json` exposes dws's *MCP runtime* tool surface (snake_case
 * names like `create_personal_todo`), which is **distinct** from the CLI command
 * tree (`dws todo task create`). The two surfaces differ in count, naming, and
 * grouping; there is no mechanical name → CLI path mapping.
 *
 * Since this wrapper dispatches via `spawn(dws <cli-path>)`, only CLI tools are
 * reachable. Calling `dws mcp` (the runtime that would serve the schema-json
 * tools) is currently a "Reserved" surface upstream — see ADR-002.
 *
 * Function kept as a stub so the loadAll fallback chain still compiles; it
 * always returns ok([]), forcing help-tree to be the source of truth.
 */
export async function loadFromSchemaJson(
  _binaryPath: string,
  _timeoutMs = 30_000,
  _spawnImpl: SpawnOnceFn = spawnOnce
): Promise<Result<DwsToolSpec[], DwsError>> {
  return ok([]);
}

/**
 * Parse a `dws ... --help` (cobra format) output.
 *  - Has "Discovered MCP Services:"  → root, subcommands are service names
 *  - Has "Available Commands:"       → branch, subcommands are children
 *  - Neither + has "Flags:" section  → leaf, extract flag list
 */
export interface ParsedHelp {
  isLeaf: boolean;
  subcommands: string[];
  flags: DwsFlagSpec[];
}

// 类型词白名单：仅 cobra 为 string/int flag 打印的类型字。
// 布尔 flag 在 cobra 里不打印类型，故 (string|int)? 可选组未命中 = boolean。
// 过去用 (\w+)? 会把描述首词（如 "Skip confirmation..."）误吞为类型词，
// 导致 `--yes` 这类无类型布尔被归一化成 string，dispatch 层再翻译时
// 把 agent 传入的 true 误导出成 `--yes true` 让 dws 当成位置参数报错。
const FLAG_LINE_RE = /^\s{2,}(?:-\w,\s+)?--(\S+)(?:\s+(string|int))?\s+(.*)$/;
// 子命令行：cobra 通常 2+ 空格分隔列，但当命令名超过列宽时只插 1 空格，
// 实测 dws v1.0.8 `chat bot message` 下 `send-by-webhook` 即此情况。放宽到 \s+。
const SUBCMD_LINE_RE = /^\s{2,}(\S+)\s+(\S.*)?$/;

export function parseHelpOutput(text: string): ParsedHelp {
  const lines = text.split(/\r?\n/);
  let mode: 'none' | 'services' | 'commands' | 'flags' | 'global-flags' = 'none';
  const subcommands: string[] = [];
  const flags: DwsFlagSpec[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'Discovered MCP Services:') {
      mode = 'services';
      continue;
    }
    if (trimmed === 'Available Commands:') {
      mode = 'commands';
      continue;
    }
    if (trimmed === 'Flags:') {
      mode = 'flags';
      continue;
    }
    if (trimmed === 'Global Flags:') {
      mode = 'global-flags';
      continue;
    }
    // 任何其他形如 "Word(s):" 的行（Usage / Examples / Description / ...）→ 退出当前 section
    // 否则 cobra root help 的 `Usage:\n  dws <service> ...` 会被误当作 subcommand
    if (/^[A-Z][A-Za-z ]+:$/.test(trimmed)) {
      mode = 'none';
      continue;
    }
    if (trimmed === '') continue;

    if (mode === 'services' || mode === 'commands') {
      const m = SUBCMD_LINE_RE.exec(line);
      if (m && m[1]) {
        const name = m[1];
        // 跳过 -h/--help 之类
        if (!name.startsWith('-')) subcommands.push(name);
      }
      continue;
    }
    if (mode === 'flags') {
      const m = FLAG_LINE_RE.exec(line);
      if (m && m[1]) {
        const name = m[1];
        const rawType = (m[2] ?? '').toLowerCase();
        const description = (m[3] ?? '').trim();
        if (name === 'help') continue;
        flags.push(toFlagSpec(name, rawType, description));
      }
      continue;
    }
    // global-flags 区段忽略
  }

  // dws v1.0.8 实测：部分子命令在 cobra 输出中重复出现（如 `dws chat bot message`
  // 下 recall-by-bot / send-by-bot 各列两次）。去重避免下游注册同名 MCP tool。
  const dedupSubcommands = Array.from(new Set(subcommands));
  return {
    isLeaf: dedupSubcommands.length === 0 && flags.length > 0,
    subcommands: dedupSubcommands,
    flags,
  };
}

/** 单 flag 行 → DwsFlagSpec，按 ADR-001 §D2 提升语义类型 */
export function toFlagSpec(
  name: string,
  rawTypeStr: string,
  description: string
): DwsFlagSpec {
  // 约定：空 rawTypeStr 源于 cobra 对 bool flag 不打印类型字（见 FLAG_LINE_RE 注释）
  // 'bool' 分支留给直接调用 toFlagSpec 的单测；真实 help 输出永远走 '' 路径
  const rawType: DwsFlagSpec['rawType'] =
    rawTypeStr === 'int' ? 'int'
      : rawTypeStr === 'bool' ? 'bool'
      : rawTypeStr === 'string' ? 'string'
      : 'bool';
  const required = /\(required\)|\(必填\)/.test(description);
  const descLower = description.toLowerCase();
  const hasJsonHint = /\bjson\b/i.test(description);
  const hasJsonArrayHint = /json\s*(?:数组|array)/i.test(description);
  const hasCommaHint =
    description.includes('逗号分隔') ||
    description.includes('comma-separated') ||
    description.includes('comma separated');
  // "list" / "列表" 是 dws 的另一种数组提示（如 "Executor userId list" 实际逗号分隔）
  // 用 \b 边界避免误判 "listed" / "checklist" 等
  const hasListHint =
    /\blist\b/i.test(description) || description.includes('列表');

  let semanticType: DwsFlagSpec['semanticType'];
  if (rawType === 'bool') {
    semanticType = 'boolean';
  } else if (rawType === 'int') {
    semanticType = 'integer';
  } else if (hasJsonArrayHint) {
    semanticType = 'json_array';
  } else if (hasJsonHint) {
    semanticType = 'json_object';
  } else if (hasCommaHint || hasListHint) {
    // 元素类型按 description 判断：含 "ID" / "id" 仍按 string；其他默认 string
    semanticType = descLower.includes('integer') || descLower.includes('数字')
      ? 'array_of_integer'
      : 'array_of_string';
  } else {
    semanticType = 'string';
  }

  return { name, rawType, semanticType, description, required };
}

/**
 * Walk `dws ... --help` tree producing all leaf tools. Sibling branches run
 * in parallel via Promise.all — sequential would be ~16s for ~80 commands at
 * 200ms each. Peak concurrency is bounded by the dws command tree shape
 * (~10 services × ~10 leaves ≈ 100 children at worst); fine on desktop hosts,
 * revisit if running in resource-constrained sandboxes.
 */
export async function loadFromHelpTree(
  binaryPath: string,
  timeoutMs = 15_000,
  spawnImpl: SpawnOnceFn = spawnOnce
): Promise<Result<DwsToolSpec[], DwsError>> {
  const ctx = { binaryPath, timeoutMs, spawnImpl };
  const tools: DwsToolSpec[] = [];

  const visit = async (path: string[]): Promise<void> => {
    const r = await runDws([...path, '--help'], ctx);
    if (!r.ok) return; // sibling branches keep walking
    const parsed = parseHelpOutput(r.value.stdout);

    if (parsed.isLeaf) {
      tools.push({
        name: ['dingtalk', ...path].join('.'),
        description: extractDescription(r.value.stdout),
        command: path,
        flags: parsed.flags,
      });
      return;
    }
    await Promise.all(parsed.subcommands.map((sub) => visit([...path, sub])));
  };

  const rootR = await runDws(['--help'], ctx);
  if (!rootR.ok) return err(rootR.error);
  const rootParsed = parseHelpOutput(rootR.value.stdout);
  await Promise.all(rootParsed.subcommands.map((svc) => visit([svc])));

  return ok(tools);
}

/** 从 cobra --help 输出顶部抽 1-2 行作为 description */
export function extractDescription(helpOutput: string): string {
  const lines = helpOutput.split(/\r?\n/);
  const collected: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === '' && collected.length > 0) break;
    if (t === '') continue;
    if (t.startsWith('Usage:') || t.startsWith('Examples:')) break;
    collected.push(t);
    if (collected.length >= 2) break;
  }
  return collected.join(' ');
}

export interface LoadResult {
  tools: DwsToolSpec[];
  source: 'schema-json' | 'help-tree' | 'bootstrap-only';
  /** 信息性，不参与逻辑：哪条路径走过了 */
  attempts: Array<{ path: 'schema-json' | 'help-tree'; ok: boolean; reason?: string }>;
}

export async function loadAll(
  binaryPath: string,
  _authenticated: boolean,
  spawnImpl: SpawnOnceFn = spawnOnce
): Promise<LoadResult> {
  const attempts: LoadResult['attempts'] = [
    { path: 'schema-json', ok: false, reason: 'stubbed (see ADR-002): MCP surface != CLI surface' },
  ];

  const helpR = await loadFromHelpTree(binaryPath, undefined, spawnImpl);
  if (helpR.ok && helpR.value.length > 0) {
    attempts.push({ path: 'help-tree', ok: true });
    return { tools: helpR.value, source: 'help-tree', attempts };
  }
  attempts.push({
    path: 'help-tree',
    ok: false,
    reason: helpR.ok ? 'empty tree' : helpR.error.message,
  });

  return { tools: [], source: 'bootstrap-only', attempts };
}
