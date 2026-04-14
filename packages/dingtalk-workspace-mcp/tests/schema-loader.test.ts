/**
 * schema-loader 单元测试。
 *
 * fixture 是 dws v1.0.8 (windows/amd64) 的真实 --help 输出，
 * 重新抓取请运行：
 *   dws --help > tests/fixtures/dws-root-help.txt
 *   dws aitable record query --help > tests/fixtures/aitable-record-query-help.txt
 *   dws todo task create --help > tests/fixtures/todo-task-create-help.txt
 *   dws aitable --help > tests/fixtures/aitable-help.txt
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseHelpOutput,
  toFlagSpec,
  extractDescription,
  loadFromSchemaJson,
  loadFromHelpTree,
  loadAll,
} from '../src/schema-loader.js';
import type { SpawnOnceFn, SpawnOnceResult } from '../src/dws-probe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures');
const fx = (name: string): string => readFileSync(join(FIXTURE_DIR, name), 'utf-8');

describe('parseHelpOutput', () => {
  it('parses root help: discovered services as subcommands, no flags', () => {
    const result = parseHelpOutput(fx('dws-root-help.txt'));
    expect(result.isLeaf).toBe(false);
    expect(result.flags).toHaveLength(0);
    expect(result.subcommands).toContain('aitable');
    expect(result.subcommands).toContain('todo');
    expect(result.subcommands).toContain('contact');
  });

  it('parses mid-tier help (aitable): subcommands present, no leaf flags', () => {
    const result = parseHelpOutput(fx('aitable-help.txt'));
    expect(result.isLeaf).toBe(false);
    expect(result.subcommands).toContain('record');
    expect(result.subcommands).toContain('field');
  });

  it('parses leaf help (aitable record query): isLeaf, full flag set, no subcommands', () => {
    const result = parseHelpOutput(fx('aitable-record-query-help.txt'));
    expect(result.isLeaf).toBe(true);
    expect(result.subcommands).toHaveLength(0);

    const names = result.flags.map((f) => f.name).sort();
    expect(names).toEqual([
      'base-id',
      'cursor',
      'field-ids',
      'filters',
      'limit',
      'query',
      'record-ids',
      'sort',
      'table-id',
    ]);
  });

  it('skips Global Flags from leaf flag list', () => {
    const result = parseHelpOutput(fx('aitable-record-query-help.txt'));
    const names = result.flags.map((f) => f.name);
    // Global flags 不应混入：client-id / debug / dry-run / format / verbose / yes 等
    expect(names).not.toContain('client-id');
    expect(names).not.toContain('debug');
    expect(names).not.toContain('dry-run');
    expect(names).not.toContain('format');
    expect(names).not.toContain('verbose');
    expect(names).not.toContain('yes');
  });

  it('skips help flag (-h/--help) from leaf flags', () => {
    const result = parseHelpOutput(fx('aitable-record-query-help.txt'));
    expect(result.flags.map((f) => f.name)).not.toContain('help');
  });

  it('dedups subcommands (dws v1.0.8 outputs duplicates under chat.bot.message)', () => {
    // 模拟 dws chat bot message 的实际输出：recall-by-bot 与 send-by-bot 各列两次
    const dup = `消息管理\n\nUsage:\n  dws chat bot message [flags]\n\nAvailable Commands:\n  recall-by-bot   bot/recall-by-bot\n  recall-by-bot   bot/recall-by-bot\n  send-by-bot     bot/send-by-bot\n  send-by-bot     bot/send-by-bot\n  send-by-webhook bot/send-by-webhook\n`;
    const r = parseHelpOutput(dup);
    expect(r.subcommands).toEqual(['recall-by-bot', 'send-by-bot', 'send-by-webhook']);
  });
});

describe('toFlagSpec — semantic type promotion (ADR-001 §D2)', () => {
  it('detects required via 中文 (必填) 半角括号', () => {
    const spec = toFlagSpec('table-id', 'string', 'Table ID (必填)');
    expect(spec.required).toBe(true);
  });

  it('detects required via 中文 （必填） 全角括号（dws v1.0.8 attendance.summary）', () => {
    // BUG FIX 2026-04-14：原正则只匹配半角 (必填)，全角 （必填） 漏标成 optional；
    // attendance.summary 的 --user / --date 因此被错误地暴露为可选，LLM 可能漏传
    const spec = toFlagSpec(
      'date',
      'string',
      '工作日期，格式 yyyy-MM-dd HH:mm:ss，如 2026-03-12 15:00:00（必填）'
    );
    expect(spec.required).toBe(true);
  });

  it('detects required via English (required)', () => {
    const spec = toFlagSpec('title', 'string', 'Todo title (required)');
    expect(spec.required).toBe(true);
  });

  it('detects required via English （required）全角括号', () => {
    const spec = toFlagSpec('title', 'string', 'Todo title （required）');
    expect(spec.required).toBe(true);
  });

  it('promotes string to array_of_string when desc has 逗号分隔', () => {
    const spec = toFlagSpec('field-ids', 'string', 'Field ID 列表，逗号分隔');
    expect(spec.semanticType).toBe('array_of_string');
  });

  it('promotes string to array_of_string when desc has list keyword', () => {
    const spec = toFlagSpec('executors', 'string', 'Executor userId list (required)');
    expect(spec.semanticType).toBe('array_of_string');
  });

  it('promotes string to json_object when desc says JSON (no array hint)', () => {
    const spec = toFlagSpec('filters', 'string', '过滤条件 JSON');
    expect(spec.semanticType).toBe('json_object');
  });

  it('promotes string to json_array when desc says JSON 数组', () => {
    const spec = toFlagSpec('sort', 'string', '排序 JSON 数组');
    expect(spec.semanticType).toBe('json_array');
  });

  it('keeps int type', () => {
    const spec = toFlagSpec('limit', 'int', '单次最大记录数');
    expect(spec.semanticType).toBe('integer');
  });

  it('keeps bool type', () => {
    const spec = toFlagSpec('force', 'bool', 'force overwrite');
    expect(spec.semanticType).toBe('boolean');
  });

  it('does not promote to array when "list" appears as substring of unrelated word', () => {
    // 描述里有 "checklist" 不应触发 list hint（用 \b 边界）
    const spec = toFlagSpec('mode', 'string', 'checklist mode');
    expect(spec.semanticType).toBe('string');
  });

  it('default fallback for plain string desc', () => {
    const spec = toFlagSpec('cursor', 'string', '分页游标');
    expect(spec.semanticType).toBe('string');
  });
});

describe('extractDescription', () => {
  it('takes leading non-empty lines until a blank line or Usage:', () => {
    const desc = extractDescription(fx('todo-task-create-help.txt'));
    expect(desc).toBe('Create todo');
  });

  it('returns empty string for empty input', () => {
    expect(extractDescription('')).toBe('');
  });
});

// 用 fixture 串成一个可寻址的 mock spawn
function makeFixtureSpawn(
  responses: Record<string, Partial<SpawnOnceResult>>
): SpawnOnceFn {
  return vi.fn(async (_bin: string, args: string[]): Promise<SpawnOnceResult> => {
    const key = args.filter((a) => a !== '--help').join(' ') || '__root__';
    const r = responses[key] ?? responses['__default__'];
    if (!r) {
      // 默认空 leaf 让 walker 终止
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0 };
  });
}

describe('loadFromSchemaJson (stubbed — see ADR-002)', () => {
  // dws schema 表面是 MCP runtime 工具集 (snake_case 名), 与 CLI 命令树不同;
  // 名字无法机械还原成 CLI 路径, 故无法通过 spawn(dws ...) 调度. v0 起始终返回空,
  // 强制 loadAll 走 help-tree. 这条测试守住 stub 行为, 防回退到带副作用实现.
  it('always returns ok([]) regardless of input (no spawn invoked)', async () => {
    const spawnFn = vi.fn();
    const r = await loadFromSchemaJson('/fake/dws', 5_000, spawnFn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('loadFromHelpTree', () => {
  it('walks tree from root → service → leaf, builds tool list', async () => {
    const spawnFn = makeFixtureSpawn({
      __root__: { stdout: fx('dws-root-help.txt') },
      aitable: { stdout: fx('aitable-help.txt') },
      // 模拟其他 service 直接空 leaf（终止）
      'aitable record': { stdout: '' },
      'aitable record query': { stdout: fx('aitable-record-query-help.txt') },
    });
    // 限制只走 aitable.record.query 这一支：根 → aitable → record → query
    const recordHelpStub = `记录管理\n\nUsage:\n  dws aitable record [command]\n\nAvailable Commands:\n  query   查询记录\n\nFlags:\n  -h, --help  help\n`;
    const walker = vi.fn(async (_bin: string, args: string[]): Promise<SpawnOnceResult> => {
      const argsKey = args.filter((a) => a !== '--help').join(' ');
      if (argsKey === '') return { stdout: fx('dws-root-help.txt'), stderr: '', exitCode: 0 };
      if (argsKey === 'aitable') return { stdout: fx('aitable-help.txt'), stderr: '', exitCode: 0 };
      if (argsKey === 'aitable record') return { stdout: recordHelpStub, stderr: '', exitCode: 0 };
      if (argsKey === 'aitable record query')
        return { stdout: fx('aitable-record-query-help.txt'), stderr: '', exitCode: 0 };
      // 其他兄弟分支返回空 → 不是 leaf 也无 subcommands → 静默跳过
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const r = await loadFromHelpTree('/fake/dws', 5_000, walker);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.value.map((t) => t.name);
      expect(names).toContain('dingtalk.aitable.record.query');
    }
    expect(spawnFn).not.toHaveBeenCalled(); // sanity: 我们用的是 walker
  });

  it('returns empty list (ok) when root has no subcommands', async () => {
    const spawnFn = vi.fn(async (): Promise<SpawnOnceResult> => ({
      stdout: 'No services',
      stderr: '',
      exitCode: 0,
    }));
    const r = await loadFromHelpTree('/fake/dws', 5_000, spawnFn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });
});

describe('loadAll orchestration', () => {
  it('uses help-tree as the sole tool source (schema-json stubbed)', async () => {
    const spawnFn = vi.fn(async (_bin: string, args: string[]): Promise<SpawnOnceResult> => {
      const argsKey = args.filter((a) => a !== '--help').join(' ');
      if (argsKey === '') {
        return {
          stdout: 'Discovered MCP Services:\n\n  todo  待办\n\nUsage:\n  dws <service>',
          stderr: '',
          exitCode: 0,
        };
      }
      if (argsKey === 'todo') {
        return {
          stdout:
            '管理待办\n\nUsage:\n  dws todo [flags]\n\nFlags:\n      --title string   Todo title (required)\n',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const r = await loadAll('/fake/dws', true, spawnFn);
    expect(r.source).toBe('help-tree');
    expect(r.tools.length).toBeGreaterThan(0);
    // schema-json attempt always recorded as skipped per ADR-002
    expect(r.attempts[0]?.path).toBe('schema-json');
    expect(r.attempts[0]?.ok).toBe(false);
    expect(r.attempts[0]?.reason).toMatch(/stubbed/);
  });

  it('returns bootstrap-only when help-tree empty', async () => {
    const spawnFn = vi.fn(async (): Promise<SpawnOnceResult> => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
    }));
    const r = await loadAll('/fake/dws', false, spawnFn);
    expect(r.source).toBe('bootstrap-only');
    expect(r.tools).toEqual([]);
  });
});

// 三个回归 fixture：对应 2026-04-15 MCP 工具测试报告里被标记的 "参数问题"。
// 经 dws dry-run 验证，这三条 CLI 自身工作正常；测试核心是证明
// T1 help-tree 解析后的 DwsToolSpec 和真实 CLI 契约一致。
describe('regression: 2026-04-15 test report parameter issues', () => {
  it('todo task delete: --yes 是布尔 flag，不是字符串（BUG FIX）', () => {
    // 根因：原 FLAG_LINE_RE 把 `--yes Skip confirmation...` 里的 Skip 当类型词，
    // 归一化为 rawType='string'，导致 MCP 把 yes 暴露成 string；agent 传 true
    // 布尔后 dispatch 导出 `--yes true`，dws 把 true 当成位置参数报错。
    const result = parseHelpOutput(fx('todo-task-delete-help.txt'));
    expect(result.isLeaf).toBe(true);

    const yesFlag = result.flags.find((f) => f.name === 'yes');
    expect(yesFlag).toBeDefined();
    expect(yesFlag?.rawType).toBe('bool');
    expect(yesFlag?.semanticType).toBe('boolean');
    // description 必须完整保留，不能被类型词吞掉第一个单词
    expect(yesFlag?.description).toMatch(/^Skip confirmation/);

    // task-id 仍然正常解析为 string + required
    const taskId = result.flags.find((f) => f.name === 'task-id');
    expect(taskId?.semanticType).toBe('string');
    expect(taskId?.required).toBe(true);
  });

  it('oa approval list-initiated: flag 名字直接取 CLI 名不转 camelCase（契约确认）', () => {
    // bug 报告"参数格式不正确"的最可能解释是 agent 侧传了 startTime/endTime
    // （dws 描述里的 API 字段名）而非 start/end（真实 CLI flag 名）。
    // 此测试守住：T1 暴露给 MCP 的 key 就是 CLI flag 原名。
    const result = parseHelpOutput(fx('oa-approval-list-initiated-help.txt'));
    expect(result.isLeaf).toBe(true);

    const names = result.flags.map((f) => f.name).sort();
    expect(names).toEqual([
      'end',
      'max-results',
      'next-token',
      'process-code',
      'start',
    ]);
    // 反向兜底：不得出现 camelCase 变体
    expect(names).not.toContain('startTime');
    expect(names).not.toContain('endTime');
  });

  it('attendance summary: --user / --date 全角（必填）被正确识别为 required（BUG FIX）', () => {
    // 2026-04-14 MCP probe 发现：29 个 tool 在 schema 中 required=[]，其中
    // attendance.summary 实际 dws help 明标 --user 与 --date 均必填，只是用了
    // 全角括号。原正则漏匹配，LLM 可能漏传必需参数。
    const result = parseHelpOutput(fx('attendance-summary-help.txt'));
    expect(result.isLeaf).toBe(true);

    const date = result.flags.find((f) => f.name === 'date');
    const user = result.flags.find((f) => f.name === 'user');
    expect(date?.required).toBe(true);
    expect(user?.required).toBe(true);
  });

  it('report create: --contents 语义提升为 json_array（契约确认）', () => {
    // bug 报告"内容格式需验证"——dispatch 对 json_array 的处理已在
    // dispatch.test.ts 覆盖（数组 → JSON.stringify 整体传一个 flag）。
    // 此测试守住：help-tree 侧要把 --contents 打成 json_array 才能触发正确路径。
    const result = parseHelpOutput(fx('report-create-help.txt'));
    expect(result.isLeaf).toBe(true);

    const contents = result.flags.find((f) => f.name === 'contents');
    expect(contents).toBeDefined();
    expect(contents?.rawType).toBe('string');
    expect(contents?.semanticType).toBe('json_array');
    expect(contents?.required).toBe(true);

    // to-chat 是 cobra 布尔 flag（description 起首词是 "是否"），需正确识别
    const toChat = result.flags.find((f) => f.name === 'to-chat');
    expect(toChat?.rawType).toBe('bool');
    expect(toChat?.semanticType).toBe('boolean');
  });
});
