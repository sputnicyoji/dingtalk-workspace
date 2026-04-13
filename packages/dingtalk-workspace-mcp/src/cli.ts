#!/usr/bin/env node
/**
 * CLI 入口。解析 argv，启动 MCP server。
 */

import { startServer } from './server.js';
import { ProbeFatalError } from './errors.js';

interface CliArgs {
  verbose: boolean;
  toolTimeoutMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    verbose: false,
    toolTimeoutMs: parseInt(process.env['DINGTALK_MCP_TIMEOUT'] ?? '120000', 10),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verbose' || a === '-v') {
      args.verbose = true;
    } else if (a === '--timeout' && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (next) {
        args.toolTimeoutMs = parseInt(next, 10) * 1000;
        i++;
      }
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--version') {
      process.stdout.write('0.0.1\n');
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      '@yoji/dingtalk-workspace-mcp — DingTalk MCP server (dws-driven)',
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
