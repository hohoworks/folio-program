import { copyFile, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageRoot = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const output = new URL('../admin/public/vendor/pdfjs/', import.meta.url);
const files = ['pdf.mjs', 'pdf.worker.mjs'];
const directories = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

require.resolve('pdfjs-dist/package.json');
await mkdir(output, { recursive: true });
await Promise.all([
  copyFile(new URL('../dist/project-tags.js', import.meta.url), new URL('../admin/public/project-tags.js', import.meta.url)),
  ...files.map(file => copyFile(new URL('build/' + file.replace('.mjs', '.min.mjs'), packageRoot), new URL(file, output))),
  ...directories.map(directory => cp(new URL(directory + '/', packageRoot), new URL(directory + '/', output), { recursive: true })),
  copyFile(new URL('LICENSE', packageRoot), new URL('LICENSE', output)),
]);
