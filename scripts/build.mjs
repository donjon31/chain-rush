import { access, cp, mkdir } from 'node:fs/promises';
await access('dist/index.html');
await mkdir('build', { recursive: true });
await cp('dist', 'build', { recursive: true, force: true });
console.log('CHAIN RUSH static build ready in build/');
