#!/usr/bin/env node
/**
 * CLI 入口。解析 argv，启动 MCP server。
 */

import { createRequire } from 'node:module';
import { startServer } from './server.js';
import { ProbeFatalError } from './errors.js';

// 从 package.json 读版本号，避免发版漂移（dist/cli.js → ../package.json = 包根）
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

interface CliArgs {
  verbose: boolean;
  toolTimeoutMs: number;
}

function parsePositiveInteger(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function getDefaultTimeoutMs(): number {
  const raw = process.env['DINGTALK_MCP_TIMEOUT'];
  if (!raw) return DEFAULT_TOOL_TIMEOUT_MS;
  const parsed = parsePositiveInteger(raw);
  return parsed ?? DEFAULT_TOOL_TIMEOUT_MS;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    verbose: false,
    toolTimeoutMs: getDefaultTimeoutMs(),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verbose' || a === '-v') {
      args.verbose = true;
    } else if (a === '--timeout') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--timeout requires a positive integer value (seconds)');
      }
      const seconds = parsePositiveInteger(next);
      if (seconds == null) {
        throw new Error('--timeout must be a positive integer (seconds)');
      }
      args.toolTimeoutMs = seconds * 1000;
      i++;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--version') {
      process.stdout.write(`${pkg.version}\n`);
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      '@sputnicyoji/dingtalk-workspace-mcp — DingTalk MCP server (dws-driven)',
      '',
      'Usage: dingtalk-workspace-mcp [flags]',
      '',
      'Flags:',
      '  -v, --verbose         enable verbose logging to stderr',
      '      --timeout <sec>   per-tool-call timeout (default 120, env DINGTALK_MCP_TIMEOUT)',
      '      --version         print version and exit',
      '  -h, --help            show this help and exit',
      '',
      'This server speaks MCP over stdio. Wire it into your MCP host config.',
      '',
    ].join('\n')
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  try {
    await startServer({
      verbose: args.verbose,
      toolTimeoutMs: args.toolTimeoutMs,
    });
  } catch (e) {
    const error = e as Error;
    process.stderr.write(`fatal: ${error.message}\n`);
    if (e instanceof ProbeFatalError) {
      const installFatal = e.code === 'NOT_INSTALLED' || e.code === 'VERSION_TOO_OLD';
      process.exit(installFatal ? 1 : 2);
    }
    process.exit(2);
  }
}

void main();
