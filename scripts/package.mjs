import { copyFile, cp, mkdir, chmod, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
const releaseZip = `dist/TodoGlass-${version}-macOS.zip`;
const sourceZip = `dist/TodoGlass-${version}-source.zip`;
const root = `dist/TodoGlass-${version}-macOS`;
await rm(root, { recursive: true, force: true });
await mkdir(`${root}/todoglass`, { recursive: true });
await cp('dist/todoglass', `${root}/todoglass`, { recursive: true });
await cp('dist/macos', `${root}/todoglass/macos`, { recursive: true });
await copyFile('README.md', `${root}/使用说明.md`);
await copyFile('README.en.md', `${root}/README.en.md`);
await copyFile('LICENSE', `${root}/LICENSE`);
await copyFile('THIRD_PARTY_NOTICES.md', `${root}/THIRD_PARTY_NOTICES.md`);
await copyFile('scripts/Install.command', `${root}/安装 TodoGlass.command`);
await chmod(`${root}/安装 TodoGlass.command`, 0o755);
const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', root, releaseZip], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Packaged ${releaseZip}`);
const sourceRoot = `dist/TodoGlass-${version}-source`;
await rm(sourceRoot, { recursive: true, force: true });
await mkdir(sourceRoot, { recursive: true });
for (const file of ['src', 'native', 'scripts', 'tests', '.github', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', 'manifest.json', 'versions.json', 'README.md', 'README.en.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.gitignore']) {
  await cp(file, `${sourceRoot}/${file}`, { recursive: true });
}
const sourceResult = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', sourceRoot, sourceZip], { stdio: 'inherit' });
if (sourceResult.status !== 0) process.exit(sourceResult.status ?? 1);
console.log(`Packaged ${sourceZip}`);
