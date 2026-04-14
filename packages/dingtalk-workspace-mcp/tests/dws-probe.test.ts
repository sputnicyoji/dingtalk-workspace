import { describe, it, expect, vi } from 'vitest';
import {
  compareVersions,
  parseVersionOutput,
  parseAuthStatus,
  probeDws,
  runDws,
  locateDws,
  type SpawnOnceFn,
  type SpawnOnceResult,
} from '../src/dws-probe.js';

describe('compareVersions', () => {
  it('strips leading v', () => {
    expect(compareVersions('v1.0.8', '1.0.7')).toBeGreaterThan(0);
  });

  it('returns 0 when equal', () => {
    expect(compareVersions('1.0.7', '1.0.7')).toBe(0);
  });

  it('returns negative when lower', () => {
    expect(compareVersions('1.0.5', '1.0.7')).toBeLessThan(0);
  });

  it('compares major before minor before patch', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.1.99')).toBeGreaterThan(0);
  });

  it('handles pre-release suffixes by stripping non-digits', () => {
    expect(compareVersions('1.0.7-rc1', '1.0.7')).toBe(0);
  });

  it('treats missing segments as 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('2', '1.99.99')).toBeGreaterThan(0);
  });
});

describe('parseVersionOutput', () => {
  it('extracts from JSON object', () => {
    expect(parseVersionOutput('{"Version":"v1.0.8","Edition":"open"}')).toBe('v1.0.8');
  });

  it('extracts from Version: text format', () => {
    const text = `Version:        v1.0.8
Edition:        open
Build:          2026-04-07T12:33:43Z`;
    expect(parseVersionOutput(text)).toBe('v1.0.8');
  });

  it('returns null for unparseable input', () => {
    expect(parseVersionOutput('garbage')).toBeNull();
  });
});

describe('parseAuthStatus', () => {
  it('returns true when authenticated:true', () => {
    expect(parseAuthStatus('{"success":true,"authenticated":true}')).toBe(true);
  });

  it('returns false when authenticated:false', () => {
    expect(parseAuthStatus('{"success":true,"authenticated":false,"message":"未登录"}')).toBe(false);
  });

  it('returns false when missing field', () => {
    expect(parseAuthStatus('{"success":true}')).toBe(false);
  });

  it('returns false for invalid JSON', () => {
    expect(parseAuthStatus('not json')).toBe(false);
  });
});

describe('locateDws', () => {
  it('returns null when PATH empty', () => {
    expect(locateDws({ PATH: '' })).toBeNull();
  });
});

describe('probeDws (spawn injected)', () => {
  const fakeSpawn = (
    onCall: (args: string[]) => Partial<SpawnOnceResult>
  ): SpawnOnceFn =>
    vi.fn(async (_bin: string, args: string[]): Promise<SpawnOnceResult> => {
      const r = onCall(args);
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0 };
    });

  it('returns NOT_INSTALLED when binary not provided and PATH is empty', async () => {
    const oldPath = process.env['PATH'];
    const oldPathWin = process.env['Path'];
    process.env['PATH'] = '';
    process.env['Path'] = '';
    try {
      const spawnImpl = fakeSpawn(() => ({}));
      const r = await probeDws({ binaryPath: undefined, spawnImpl });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('NOT_INSTALLED');
      expect(spawnImpl).not.toHaveBeenCalled();
    } finally {
      if (oldPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = oldPath;
      if (oldPathWin === undefined) delete process.env['Path'];
      else process.env['Path'] = oldPathWin;
    }
  });

  it('returns NOT_INSTALLED when version spawn throws', async () => {
    const spawnImpl: SpawnOnceFn = vi.fn(async () => {
      throw new Error('exec failed');
    });
    const r = await probeDws({ binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_INSTALLED');
  });

  it('returns NOT_INSTALLED when version output unparseable', async () => {
    const spawnImpl = fakeSpawn(() => ({ stdout: 'garbage' }));
    const r = await probeDws({ binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_INSTALLED');
  });

  it('returns VERSION_TOO_OLD when version below min', async () => {
    const spawnImpl = fakeSpawn((args) => {
      if (args[0] === 'version') return { stdout: '{"Version":"v1.0.0"}' };
      return {};
    });
    const r = await probeDws({ binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VERSION_TOO_OLD');
  });

  it('returns ok with authenticated=true when both checks pass', async () => {
    const spawnImpl = fakeSpawn((args) => {
      if (args[0] === 'version') return { stdout: '{"Version":"v1.0.8"}' };
      if (args[0] === 'auth') return { stdout: '{"authenticated":true}' };
      return {};
    });
    const r = await probeDws({ binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.version).toBe('v1.0.8');
      expect(r.value.authenticated).toBe(true);
    }
  });

  it('returns ok with authenticated=false when auth status returns 未登录', async () => {
    const spawnImpl = fakeSpawn((args) => {
      if (args[0] === 'version') return { stdout: '{"Version":"v1.0.8"}' };
      if (args[0] === 'auth') return { stdout: '{"authenticated":false,"message":"未登录"}' };
      return {};
    });
    const r = await probeDws({ binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.authenticated).toBe(false);
  });

  it('treats auth spawn failure as not-authenticated (non-fatal)', async () => {
    let calls = 0;
    const spawnImpl: SpawnOnceFn = vi.fn(async (_bin: string, args: string[]) => {
      calls++;
      if (args[0] === 'version')
        return { stdout: '{"Version":"v1.0.8"}', stderr: '', exitCode: 0 };
      throw new Error('auth spawn died');
    });
    const r = await probeDws({ binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.authenticated).toBe(false);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe('runDws error classification', () => {
  it('returns TIMEOUT when spawn reports timeout', async () => {
    const spawnImpl: SpawnOnceFn = vi.fn(async () => {
      throw new Error('spawn timeout: /fake/dws foo');
    });
    const r = await runDws(['foo'], { binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TIMEOUT');
  });

  it('returns NOT_INSTALLED for non-timeout spawn errors', async () => {
    const spawnImpl: SpawnOnceFn = vi.fn(async () => {
      const e = new Error('spawn ENOENT') as NodeJS.ErrnoException;
      e.code = 'ENOENT';
      throw e;
    });
    const r = await runDws(['foo'], { binaryPath: '/fake/dws', spawnImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_INSTALLED');
  });
});
