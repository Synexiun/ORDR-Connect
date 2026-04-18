import * as esbuild from 'esbuild';
import { cpSync } from 'fs';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/background.ts', 'src/popup.ts', 'src/session.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
});

cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/session.html', 'dist/session.html');

if (watch) {
  await ctx.watch();
  console.warn('Watching for changes…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
