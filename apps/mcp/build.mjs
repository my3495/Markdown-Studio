import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/index.mjs',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});
