import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { programDistributionFiles } from './build-public.mjs';
import { catalogAssets } from './check-site.mjs';

// The public repository is assembled from distribution files, never from Git history or the editor's catalogue.
const programFiles = [
  '.github/workflows/admin.yml', '.github/workflows/check.yml', '.gitignore',
  'README.md', 'SPLIT-HOSTING.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'wrangler.jsonc',
  'admin/worker.mjs', 'admin/worker.test.mjs',
  ...['index.html', 'login.html', 'admin.js', 'login.js', 'style.css', 'draft-store.js', 'site-settings.js',
    'upload-request.js', 'media-order.js', 'image-encoding.js', 'pdf-layout.js', 'mockup-controls.js', 'mockup-preview.js', 'mockup-preview.css', 'book-construction.js', 'card-editor.js'].map(name => 'admin/public/' + name),
  ...['build-admin.mjs', 'build-public.mjs', 'build-public.test.mjs', 'check-site.mjs',
    'local-admin.mjs', 'local-store.mjs', 'local-store.test.mjs', 'prepare-repositories.mjs',
    'prepare-repositories.test.mjs', 'punctuation.test.mjs', 'split-bootstrap.test.mjs', 'book-format.test.mjs', 'cover-stock.test.mjs', 'book-import.test.mjs', 'book-surfaces.test.mjs', 'work-navigation.test.mjs'].map(name => 'scripts/' + name),
  'templates/content/build-site.mjs', 'templates/content/README.md', 'templates/content/.gitignore',
  ...programDistributionFiles.map(name => 'dist/' + name),
];

async function regularFile(root, path) {
  const file = join(root, path);
  if (await realpath(file) !== file || !(await lstat(file)).isFile()) {
    throw new Error('원본 폴더 안의 일반 파일만 복사할 수 있습니다. ' + path);
  }
  return file;
}

async function copyFiles(source, target, files) {
  for (let start = 0; start < files.length; start += 16) {
    const results = await Promise.allSettled(files.slice(start, start + 16).map(async path => {
      const original = await regularFile(source, path);
      const output = join(target, path);
      await mkdir(dirname(output), { recursive: true });
      await copyFile(original, output);
    }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
}

export async function prepareRepositories(projectRoot, destination, contentDir = join(projectRoot, 'dist')) {
  const programSource = await realpath(projectRoot);
  const contentSource = await realpath(contentDir);
  const target = join(await realpath(dirname(resolve(destination))), basename(resolve(destination)));
  if ([programSource, contentSource].some(root => root === target || target.startsWith(root + sep))) {
    throw new Error('두 새 저장소를 담을 폴더는 원본 저장소 밖에 지정해주세요.');
  }
  const original = await regularFile(contentSource, 'catalog.json');
  const bytes = await readFile(original);
  const catalog = JSON.parse(bytes);
  const assets = [...catalogAssets({ ...catalog, demo: false })];
  // Reserve a new destination. An existing checkout may contain newer work.
  await mkdir(target, { mode: 0o700 });
  try {
    const program = join(target, 'folio-program');
    const content = join(target, 'folio-content');
    await mkdir(join(content, 'dist'), { recursive: true });
    await copyFiles(programSource, program, programFiles);
    await writeFile(join(program, '.folio-split-program'), 'FOLIO separate content repository\n');
    await writeFile(join(program, 'dist/catalog.json'), JSON.stringify({ demo: true, books: [], projects: [], order: [] }) + '\n');
    await writeFile(join(program, '.gitignore'), '\n/dist/assets/books/\n/dist/assets/projects/\n/dist/assets/site/\n', { flag: 'a' });
    await copyFiles(join(programSource, 'templates/content'), content, ['build-site.mjs', '.gitignore', 'README.md']);
    await copyFiles(contentSource, join(content, 'dist'), assets);
    await writeFile(join(content, 'dist/catalog.json'), bytes);
    if (!bytes.equals(await readFile(original))) throw new Error('복사 중 작업 목록이 바뀌었습니다. 다시 분리해주세요.');
    return { program, content, images: assets.length };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const destination = resolve(process.argv[2] || join(root, '..', 'FOLIO-저장소-분리'));
  if ((await lstat(join(root, '.folio-split-program')).catch(() => null)) && !process.env.FOLIO_CONTENT_DIR) {
    throw new Error('이미 분리된 프로그램입니다. 다시 복사하려면 FOLIO_CONTENT_DIR에 비공개 저장소의 dist 경로를 지정해주세요.');
  }
  const result = await prepareRepositories(root, destination, process.env.FOLIO_CONTENT_DIR);
  console.log('프로그램 폴더 · ' + result.program);
  console.log('비공개 작품 폴더 · ' + result.content + ' · 작품 이미지 ' + result.images + '개');
}
