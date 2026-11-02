import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/todoglass', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/todoglass/main.js', bundle: true, platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian', 'electron'], sourcemap: false, minify: false });
await copyFile('manifest.json', 'dist/todoglass/manifest.json');
console.log('Obsidian plugin built.');
