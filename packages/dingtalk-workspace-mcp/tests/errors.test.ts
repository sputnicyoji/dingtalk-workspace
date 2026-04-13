import { describe, it, expect } from 'vitest';
import {
  redact,
  makeError,
  formatError,
  isAuthExpiredStderr,
} from '../src/errors.js';

describe('redact', () => {
  it('redacts Bearer tokens', () => {
    expect(redact('Bearer abcdef1234567890.xyz')).toBe('Bearer [REDACTED]');
  });

  it('redacts access_token=', () => {
    expect(redact('access_token=ghp_abcdef0123456789ABCDEFG')).toMatch(
      /access_token=\[REDACTED\]/
    );
  });

  it('redacts ghp_ pat', () => {
    expect(redact('using ghp_aBcDeFgHiJ0123456789KLMNopq')).toContain(
      'ghp_[REDACTED]'
    );
  });

  it('redacts AppKey & AppSecret', () => {
    expect(redact('AppKey=dingtalkappkey12345')).toContain('AppKey=[REDACTED]');
    expect(redact('AppSecret=secret_value_12345')).toContain('AppSecret=[REDACTED]');
  });

  it('returns undefined for undefined input', () => {
    expect(redact(undefined)).toBeUndefined();
  });

  it('passes through non-secret strings', () => {
    expect(redact('hello world')).toBe('hello world');
  });
});

describe('makeError + formatError', () => {
  it('builds DwsError with code & message', () => {
    const e = makeError('TIMEOUT', 'too slow');
    expect(e.code).toBe('TIMEOUT');
    expect(e.message).toBe('too slow');
  });

  it('formats with all fields when present', () => {
    const e = makeError('NON_ZERO_EXIT', 'bad', {
      stdout: 'out',
      stderr: 'err',
      exitCode: 7,
    });
    const txt = formatError(e);
    expect(txt).toContain('[NON_ZERO_EXIT]');
    expect(txt).toContain('exit code: 7');
    expect(txt).toContain('stderr:\nerr');
    expect(txt).toContain('stdout:\nout');
  });

  it('omits empty sections', () => {
    const e = makeError('NOT_INSTALLED', 'absent');
    const txt = formatError(e);
    expect(txt).not.toContain('exit code:');
    expect(txt).not.toContain('stderr:');
    expect(txt).not.toContain('stdout:');
  });

  it('redacts stderr when constructing', () => {
    const e = makeError('AUTH_EXPIRED', 'oops', {
      stderr: 'leaked AppSecret=secret_value_abcdefg please',
    });
    expect(e.stderr).toContain('AppSecret=[REDACTED]');
  });
});

describe('isAuthExpiredStderr', () => {
  it('detects 401', () => {
    expect(isAuthExpiredStderr('HTTP 401 Unauthorized')).toBe(true);
  });

  it('detects 中文 未登录', () => {
    expect(isAuthExpiredStderr('当前未登录, 请先 dws auth login')).toBe(true);
  });

  it('detects token expired', () => {
    expect(isAuthExpiredStderr('error: token expired')).toBe(true);
  });

  it('returns false for unrelated stderr', () => {
    expect(isAuthExpiredStderr('parameter --base-id is required')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAuthExpiredStderr(undefined)).toBe(false);
  });
});
