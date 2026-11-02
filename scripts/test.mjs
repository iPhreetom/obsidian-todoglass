import { build } from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
await mkdir('.test-build', { recursive: true });
const allTests = await readdir('tests');
const tests = allTests.filter(x => x.endsWith('.test.ts'));
const nativeTests = allTests.filter(x => x.endsWith('.test.mjs'));
for (const test of tests) {
  await build({ entryPoints: [`tests/${test}`], outfile: `.test-build/${test.replace('.ts', '.cjs')}`, bundle: true, platform: 'node', format: 'cjs', target: 'node22', ...(test === 'plugin.test.ts' ? { alias: { obsidian: resolve('tests/obsidian-mock.ts') } } : {}) });
}
const result = spawnSync(process.execPath, ['--test', ...tests.map(t => `.test-build/${t.replace('.ts', '.cjs')}`), ...nativeTests.map(t => `tests/${t}`)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
