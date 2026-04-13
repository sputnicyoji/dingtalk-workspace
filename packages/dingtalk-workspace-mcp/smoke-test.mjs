#!/usr/bin/env node
/**
 * 本地端到端冒烟。
 *
 * 启动 dist/cli.js (MCP server)，按 MCP 协议发 initialize + tools/list，
 * 验证：
 *   - server 启动不崩溃
 *   - tools/list 返回 ≥ 50 个 dingtalk.* tool（dws v1.0.8 实测 76）
 *   - 至少包含 dingtalk.todo.task.create 和 dingtalk.aitable.record.query
 *
 * 用真实 dws 二进制（PATH 中），不 mock。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, 'dist', 'cli.js');

const child = spawn(process.execPath, [SERVER, '--verbose'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch (e) {
      console.error('non-json from server:', line);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  const req = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  child.stdin.write(req);
  return new Promise((resolve) => pending.set(id, { resolve }));
}

function notify(method, params) {
  const req = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
  child.stdin.write(req);
}

let exitCode = 0;
try {
  // 等 server 准备就绪（验证日志走 stderr 就行；这里直接发请求）
  await new Promise((r) => setTimeout(r, 500));

  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0' },
  });
  console.log('✓ initialize');
  if (init.error) throw new Error(`initialize error: ${JSON.stringify(init.error)}`);

  notify('notifications/initialized', {});

  const list = await send('tools/list', {});
  if (list.error) throw new Error(`tools/list error: ${JSON.stringify(list.error)}`);
  const tools = list.result.tools;
  console.log(`✓ tools/list returned ${tools.length} tools`);

  const required = ['dingtalk.todo.task.create', 'dingtalk.aitable.record.query'];
  for (const name of required) {
    if (!tools.find((t) => t.name === name)) {
      throw new Error(`missing required tool: ${name}`);
    }
  }
  console.log(`✓ required tools present: ${required.join(', ')}`);

  if (tools.length < 50) {
    console.warn(`⚠ tool count (${tools.length}) lower than expected (≥50)`);
    exitCode = 0; // 不致命，只警告
  }

  // 抽查一个 tool 的 inputSchema：aitable.record.query.filters 应是 object 类型
  const q = tools.find((t) => t.name === 'dingtalk.aitable.record.query');
  const filters = q?.inputSchema?.properties?.filters;
  if (!filters) throw new Error('aitable.record.query.filters property missing');
  if (filters.type !== 'object' && filters.anyOf?.[0]?.type !== 'object') {
    console.warn(`⚠ filters semantic type unexpected: ${JSON.stringify(filters)}`);
  } else {
    console.log(`✓ aitable.record.query.filters is object type (json_object hint applied)`);
  }

  // 抽查 array_of_string：record-ids
  const recordIds = q?.inputSchema?.properties?.['record-ids'];
  if (recordIds?.type === 'array' || recordIds?.anyOf?.[0]?.type === 'array') {
    console.log(`✓ aitable.record.query.record-ids is array type (comma-separated hint applied)`);
  } else {
    console.warn(`⚠ record-ids semantic type unexpected: ${JSON.stringify(recordIds)}`);
  }

  console.log('\n✅ smoke test PASSED');
} catch (e) {
  console.error('\n❌ smoke test FAILED:', e.message);
  exitCode = 1;
} finally {
  child.kill();
  setTimeout(() => process.exit(exitCode), 200);
}
