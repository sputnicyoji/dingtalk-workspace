/**
 * MCP server 装配。
 *
 * 启动后流程：
 *   probe → schema-loader.loadAll → 把每个 DwsToolSpec 注册成 MCP tool → stdio
 *
 * 注册的 tool callback 内部走 dispatch.dispatchTool。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';
import { z } from 'zod';
import type { ZodRawShape, ZodType } from 'zod';
import { probeDws } from './dws-probe.js';
import { loadAll } from './schema-loader.js';
import { dispatchTool } from './dispatch.js';
import { formatError, ProbeFatalError } from './errors.js';
import type { DwsFlagSpec, DwsProbeResult, DwsToolSpec } from './types.js';

const SERVER_NAME = '@sputnicyoji/dingtalk-workspace-mcp';
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
const SERVER_VERSION = pkg.version;

export interface ServerOptions {
  /** dws 单次调用超时（默认 120s） */
  toolTimeoutMs?: number;
  /** 日志输出到 stderr 的级别 */
  verbose?: boolean;
}

export async function createServer(opts: ServerOptions = {}): Promise<McpServer> {
  const probe = await probeDws();
  if (!probe.ok) {
    throw new ProbeFatalError(probe.error.code, formatError(probe.error));
  }
  const probeResult = probe.value;
  log(opts, `dws ${probeResult.version} at ${probeResult.binaryPath}`);
  log(opts, `auth: ${probeResult.authenticated ? 'authenticated' : 'NOT authenticated'}`);

  const loadResult = await loadAll(probeResult.binaryPath, probeResult.authenticated);
  log(
    opts,
    `loaded ${loadResult.tools.length} tools via ${loadResult.source}`
  );
  for (const attempt of loadResult.attempts) {
    log(opts, `  - ${attempt.path}: ${attempt.ok ? 'ok' : `skipped (${attempt.reason})`}`);
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  if (loadResult.tools.length === 0) {
    registerBootstrapTool(server, probeResult);
  } else {
    for (const tool of loadResult.tools) {
      registerDwsTool(server, tool, probeResult, opts.toolTimeoutMs ?? 120_000);
    }
    // 即使 schema 完整，也注册 bootstrap 给"未 auth 时"用
    if (!probeResult.authenticated) {
      registerBootstrapTool(server, probeResult);
    }
  }

  return server;
}

export async function startServer(opts: ServerOptions = {}): Promise<void> {
  const server = await createServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(opts, 'MCP server ready (stdio)');
}

// ---------------------------------------------------------------------------
// Tool 注册：DwsToolSpec → registerTool
// ---------------------------------------------------------------------------

function registerDwsTool(
  server: McpServer,
  tool: DwsToolSpec,
  probe: DwsProbeResult,
  toolTimeoutMs: number
): void {
  const inputSchema = buildZodShape(tool.flags);

  server.registerTool(
    tool.name,
    {
      description: tool.description || `dws ${tool.command.join(' ')}`,
      inputSchema,
    },
    async (args: Record<string, unknown>) => {
      const result = await dispatchTool(tool, args ?? {}, {
        binaryPath: probe.binaryPath,
        timeoutMs: toolTimeoutMs,
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatError(result.error) }],
        };
      }
      const text = result.value.stdout || result.value.stderr || '(empty output)';
      return {
        content: [{ type: 'text' as const, text }],
      };
    }
  );
}

function registerBootstrapTool(server: McpServer, probe: DwsProbeResult): void {
  server.registerTool(
    'dingtalk.bootstrap',
    {
      description:
        'DingTalk MCP bootstrap diagnostic. Returns dws version & auth status. ' +
        'If not authenticated, run `dws auth login` in a terminal then restart this MCP server.',
      inputSchema: {} as ZodRawShape,
    },
    async () => {
      const lines = [
        `dws binary: ${probe.binaryPath}`,
        `dws version: ${probe.version}`,
        `authenticated: ${probe.authenticated}`,
      ];
      if (!probe.authenticated) {
        lines.push('');
        lines.push('Next step: open a terminal and run:');
        lines.push('  dws auth login');
        lines.push('Then restart your MCP host (Claude Desktop / Cursor / Codex / etc).');
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );
}

/**
 * DwsFlagSpec[] → Zod raw shape (传给 registerTool 的 inputSchema)
 */
export function buildZodShape(flags: DwsFlagSpec[]): ZodRawShape {
  const shape: Record<string, ZodType> = {};
  for (const flag of flags) {
    let zodType: ZodType;
    switch (flag.semanticType) {
      case 'string':
        zodType = z.string();
        break;
      case 'integer':
        zodType = z.number().int();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array_of_string':
        zodType = z.array(z.string());
        break;
      case 'array_of_integer':
        zodType = z.array(z.number().int());
        break;
      case 'json_array':
        zodType = z.array(z.unknown());
        break;
      case 'json_object':
        zodType = z.record(z.string(), z.unknown());
        break;
      default:
        zodType = z.string();
    }
    if (flag.description) {
      zodType = zodType.describe(flag.description);
    }
    if (!flag.required) {
      zodType = zodType.optional();
    }
    shape[flag.name] = zodType;
  }
  return shape;
}

function log(opts: ServerOptions, msg: string): void {
  if (opts.verbose) {
    process.stderr.write(`[mcp] ${msg}\n`);
  }
}
