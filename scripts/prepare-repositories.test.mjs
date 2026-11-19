import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareRepositories } from './prepare-repositories.mjs';
import { buildPublic } from './build-public.mjs';

test('split export keeps the complete editable catalogue only in the private repository', async t => {
  const root = await mkdtemp(join(tmpdir(), 'folio-repo-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'editable');
  const pairs = ['work', 'unlisted'];
  for (const id of pairs) {
    const directory = join(source, 'assets/projects', id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'image.webp'), 'test bytes ' + id);
  }
  const catalog = { books: [], projects: pairs.map(id => ({
    id, title: 'fixture title ' + id, published: id === 'work', revision: 'fixture revision ' + id,
    images: [{ imageSrc: 'assets/projects/' + id + '/image.webp' }],
  })), order: pairs };
  const sourceBytes = JSON.stringify(catalog, null, 2) + '\n';
  await writeFile(join(source, 'catalog.json'), sourceBytes);
  await writeFile(join(source, '.dev.vars'), 'fixture only');
  const destination = join(root, 'two-repos');
  const checkout = fileURLToPath(new URL('../', import.meta.url));
  const { program, content } = await prepareRepositories(checkout, destination, source);
  assert.deepEqual(JSON.parse(await readFile(join(program, 'dist/catalog.json'))), { demo: true, books: [], projects: [], order: [] });
  const programNames = await readdir(program, { recursive: true });
  for (const path of programNames) {
    assert.ok(!/(?:^|\/)(?:\.git|\.dev\.vars|\.wrangler|node_modules|public-site|unlisted)(?:$|\/)/.test(path));
  }
  assert.equal(await readFile(join(content, 'dist/catalog.json'), 'utf8'), sourceBytes);
  assert.deepEqual((await readdir(content)).sort(), ['.gitignore', 'README.md', 'build-site.mjs', 'dist']);
  await assert.rejects(readFile(join(content, 'dist/.dev.vars')), { code: 'ENOENT' });
  for (const id of pairs) {
    const path = 'dist/assets/projects/' + id + '/image.webp';
    assert.equal(await readFile(join(content, path), 'utf8'), 'test bytes ' + id);
    await assert.rejects(readFile(join(program, path)), { code: 'ENOENT' });
  }
  const output = join(content, 'public-site');
  await buildPublic(program, { contentDir: join(content, 'dist'), outputDir: output });
  assert.deepEqual(JSON.parse(await readFile(join(output, 'catalog.json'))).order, ['work']);
  await assert.rejects(readFile(join(output, 'assets/projects/unlisted/image.webp')), { code: 'ENOENT' });
  await assert.rejects(prepareRepositories(checkout, destination, source), { code: 'EEXIST' });
  assert.equal(await readFile(join(content, 'dist/catalog.json'), 'utf8'), sourceBytes);
});
