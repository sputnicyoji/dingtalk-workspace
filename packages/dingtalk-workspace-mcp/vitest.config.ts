import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // server.ts 是 e2e 范畴 (spawn dws + connect MCP transport),
      // cli.ts/types.ts 无逻辑分支. 这三个排除统计.
      exclude: ['src/cli.ts', 'src/types.ts', 'src/server.ts'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 75,
        lines: 85,
      },
    },
  },
});
