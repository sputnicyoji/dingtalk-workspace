/**
 * dispatch 单元测试 — ADR-001 §D1 全规则覆盖。
 *
 * 不实际 spawn dws，覆盖纯函数 flagify / flagifyOne。
 * dispatchTool 的 spawn 路径靠 e2e 冒烟覆盖（手工或 inspector）。
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { flagify, flagifyOne, dispatchTool } from '../src/dispatch.js';
import type { DwsFlagSpec, DwsToolSpec } from '../src/types.js';

/** 制造一个最小 ChildProcess mock，控制 stdout/stderr/exit 时序 */
function makeMockChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
}) {
  const ee = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig?: string) => void;
  };
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  setTimeout(() => {
    if (opts.stdout) ee.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) ee.stderr.emit('data', Buffer.from(opts.stderr));
    ee.emit('close', opts.exitCode ?? 0);
  }, opts.delayMs ?? 5);
  return ee;
}

const spec = (over: Partial<DwsFlagSpec> & { name: string; semanticType: DwsFlagSpec['semanticType'] }): DwsFlagSpec => ({
  rawType: 'string',
  description: '',
  required: false,
  ...over,
});

const tool = (flags: DwsFlagSpec[]): DwsToolSpec => ({
  name: 'dingtalk.test.cmd',
  description: '',
  command: ['test', 'cmd'],
  flags,
});

/** Convenience: assert flagifyOne returns ok and yield the value */
function unwrap1(key: string, value: unknown, s?: DwsFlagSpec): string[] {
  const r = flagifyOne(key, value, s);
  if (!r.ok) throw new Error(`unexpected err: ${r.error.message}`);
  return r.value;
}

function unwrap(t: DwsToolSpec, args: Record<string, unknown>): string[] {
  const r = flagify(t, args);
  if (!r.ok) throw new Error(`unexpected err: ${r.error.message}`);
  return r.value;
}

describe('flagifyOne', () => {
  it('boolean true → switch flag (no value)', () => {
    expect(unwrap1('debug', true)).toEqual(['--debug']);
  });

  it('boolean false → omitted entirely', () => {
    expect(unwrap1('debug', false)).toEqual([]);
  });

  it('string → --key value', () => {
    expect(unwrap1('title', 'hello')).toEqual(['--title', 'hello']);
  });

  it('number → --key stringified', () => {
    expect(unwrap1('limit', 50)).toEqual(['--limit', '50']);
  });

  it('array of primitives → comma-joined string', () => {
    expect(unwrap1('executors', ['u1', 'u2', 'u3'])).toEqual(['--executors', 'u1,u2,u3']);
  });

  it('array of numbers → comma-joined string', () => {
    expect(unwrap1('ids', [1, 2, 3])).toEqual(['--ids', '1,2,3']);
  });

  it('array WITH json_array spec → JSON.stringify (not comma)', () => {
    const s = spec({ name: 'sort', semanticType: 'json_array' });
    expect(unwrap1('sort', [{ field: 'a', dir: 'asc' }], s)).toEqual([
      '--sort',
      '[{"field":"a","dir":"asc"}]',
    ]);
  });

  it('array of objects WITHOUT spec → JSON.stringify fallback', () => {
    expect(unwrap1('items', [{ a: 1 }, { a: 2 }])).toEqual([
      '--items',
      '[{"a":1},{"a":2}]',
    ]);
  });

  it('plain object → JSON.stringify', () => {
    expect(unwrap1('filters', { field: 'x', op: 'eq', value: 'y' })).toEqual([
      '--filters',
      '{"field":"x","op":"eq","value":"y"}',
    ]);
  });

  it('object with json_object spec → JSON.stringify', () => {
    const s = spec({ name: 'filters', semanticType: 'json_object' });
    expect(unwrap1('filters', { a: 1 }, s)).toEqual(['--filters', '{"a":1}']);
  });

  it('returns INVALID_OUTPUT err for unsupported types (e.g. function)', () => {
    const r = flagifyOne('cb', () => 0, undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_OUTPUT');
  });
});

describe('flagify', () => {
  it('skips null / undefined args silently', () => {
    const t = tool([
      spec({ name: 'title', semanticType: 'string' }),
      spec({ name: 'desc', semanticType: 'string' }),
    ]);
    expect(unwrap(t, { title: 'hi', desc: null, extra: undefined })).toEqual([
      '--title',
      'hi',
    ]);
  });

  it('respects spec when picking array vs json branch', () => {
    const t = tool([
      spec({ name: 'sort', semanticType: 'json_array' }),
      spec({ name: 'tags', semanticType: 'array_of_string' }),
    ]);
    expect(unwrap(t, { sort: [{ field: 'a' }], tags: ['x', 'y'] })).toEqual([
      '--sort',
      '[{"field":"a"}]',
      '--tags',
      'x,y',
    ]);
  });

  it('handles tool with no flag specs (fallback heuristics)', () => {
    const t = tool([]);
    expect(unwrap(t, { title: 'hi', ids: [1, 2], meta: { a: 1 } })).toEqual([
      '--title',
      'hi',
      '--ids',
      '1,2',
      '--meta',
      '{"a":1}',
    ]);
  });

  it('propagates flagifyOne err', () => {
    const t = tool([]);
    const r = flagify(t, { cb: () => 0 });
    expect(r.ok).toBe(false);
  });
});

describe('dispatchTool (spawn injected)', () => {
  it('returns ok with stdout when exit 0', async () => {
    const t = tool([spec({ name: 'title', semanticType: 'string', required: true })]);
    const mockSpawn = vi.fn().mockImplementation(() =>
      makeMockChild({ stdout: '{"ok":true}', exitCode: 0 })
    );
    const r = await dispatchTool(
      t,
      { title: 'hi' },
      {
        binaryPath: '/fake/dws',
        spawnImpl: mockSpawn as unknown as typeof import('node:child_process').spawn,
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stdout).toBe('{"ok":true}');
      expect(r.value.exitCode).toBe(0);
    }
    // 校验 spawn 接到的参数：command + flags + --yes --format json
    expect(mockSpawn).toHaveBeenCalledWith(
      '/fake/dws',
      ['test', 'cmd', '--title', 'hi', '--yes', '--format', 'json'],
      expect.any(Object)
    );
  });

  it('returns NON_ZERO_EXIT error when exit != 0', async () => {
    const t = tool([]);
    const mockSpawn = vi.fn().mockImplementation(() =>
      makeMockChild({ stderr: 'bad request', exitCode: 1 })
    );
    const r = await dispatchTool(t, {}, {
      binaryPath: '/fake/dws',
      spawnImpl: mockSpawn as unknown as typeof import('node:child_process').spawn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NON_ZERO_EXIT');
      expect(r.error.exitCode).toBe(1);
      expect(r.error.stderr).toBe('bad request');
    }
  });

  it('detects AUTH_EXPIRED from stderr keywords', async () => {
    const t = tool([]);
    const mockSpawn = vi.fn().mockImplementation(() =>
      makeMockChild({ stderr: 'HTTP 401 Unauthorized', exitCode: 1 })
    );
    const r = await dispatchTool(t, {}, {
      binaryPath: '/fake/dws',
      spawnImpl: mockSpawn as unknown as typeof import('node:child_process').spawn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTH_EXPIRED');
  });

  it('returns TIMEOUT when child exceeds timeoutMs', async () => {
    const t = tool([]);
    const mockSpawn = vi.fn().mockImplementation(() =>
      makeMockChild({ delayMs: 200, exitCode: 0 })
    );
    const r = await dispatchTool(t, {}, {
      binaryPath: '/fake/dws',
      timeoutMs: 50,
      spawnImpl: mockSpawn as unknown as typeof import('node:child_process').spawn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TIMEOUT');
  });
});
