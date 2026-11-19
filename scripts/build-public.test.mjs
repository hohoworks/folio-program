import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildPublic } from './build-public.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'folio-public-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = new URL('../dist/', import.meta.url);
  const source = join(root, 'dist');
  const output = join(root, 'public-site');
  await mkdir(join(source, 'assets'), { recursive: true });
  for (const name of await readdir(dist)) {
    if (/\.(?:html|css|js)$/.test(name) || name === '_headers') {
      await cp(new URL(name, dist), join(source, name));
    }
  }
  for (const name of ['folio.svg', 'forest.jpg', 'forest-cover.webp', 'examples']) {
    await cp(new URL('assets/' + name, dist), join(source, 'assets', name), { recursive: true });
  }
  async function write(path, content) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), content);
  }
  return { root, source, output, write,
    save: catalog => write('catalog.json', JSON.stringify(catalog)),
    read: async () => JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8')),
  };
}

test('only public records and referenced images reach Pages, including after unpublishing', async t => {
  const f = await fixture(t);
  const id = 'shown';
  const front = 'assets/books/shown/cover.webp';
  const page = 'assets/books/shown/page.webp';
  const art = 'assets/projects/draft/poster.webp';
  const portrait = 'assets/site/about/photo.webp';
  const gallery = 'assets/books/shown/gallery.webp';
  const book = { id, title: '책', published: true, revision: 'edit-id', lastMutationId: 'save-id',
    coverImages: { front, back: front, spine: front }, thumbnailSrc: front, coverRatio: .7, pageRatio: .7,
    pages: [{ imageSrc: './' + page }], galleryImages: [{ imageSrc: gallery }] };
  const project = { id: 'draft', published: false, title: '미공개 작업', images: [{ imageSrc: art }] };
  const catalog = { demo: true, books: [book], projects: [project], order: ['draft', id],
    site: { title: '포트폴리오', revision: 'edit-id', about: { text: '소개', imageSrc: portrait } } };
  for (const path of [front, page, art, gallery, portrait, 'assets/books/shown/unused.webp', '.dev.vars']) await f.write(path, 'fixture');
  await f.save(catalog);
  await buildPublic(f.root);
  const home = await readFile(join(f.output, 'index.html'), 'utf8');
  assert.ok(home.includes('<title data-en="포트폴리오">포트폴리오</title>'));
  assert.ok(home.includes('<span data-wordmark-locale="en" lang="ko">포트폴리오</span>'));
  const published = await f.read();
  assert.equal(published.demo, false);
  assert.deepEqual(published.order, [id]);
  assert.equal(published.books[0].revision, undefined);
  assert.equal(published.books[0].lastMutationId, undefined);
  assert.equal(published.site.revision, undefined);
  assert.deepEqual(published.projects, []);
  for (const path of [page, front, gallery, portrait]) await readFile(join(f.output, path));
  for (const path of [art, '.dev.vars', 'assets/books/shown/unused.webp', 'assets/forest.jpg', 'book.js']) {
    await assert.rejects(readFile(join(f.output, path)), { code: 'ENOENT' });
  }
  book.published = false;
  await f.save(catalog);
  await buildPublic(f.root);
  assert.deepEqual((await f.read()).books, []);
  assert.equal((await f.read()).demo, false);
  await assert.rejects(readFile(join(f.output, front)), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.source, front), 'utf8'), 'fixture');
});

test('an explicit empty demo includes all sample assets; a failed build preserves the last output', async t => {
  const f = await fixture(t);
  await f.save({ books: [], demo: true });
  await buildPublic(f.root);
  assert.ok((await readFile(join(f.output, 'index.html'), 'utf8')).includes('<title data-en="Folio">Folio</title>'));
  await readFile(join(f.output, 'library.js'));
  await readFile(join(f.output, 'assets/forest-cover.webp'));
  await readFile(join(f.output, 'assets/examples/thumbs/afterimage.webp'));
  const missing = 'assets/projects/new/missing.jpg';
  const project = { id: 'new', title: '새 작업', images: [{ imageSrc: missing }] };
  await f.save({ books: [], projects: [project] });
  await assert.rejects(buildPublic(f.root));
  assert.equal((await f.read()).demo, true);
  await f.write(missing, 'fixture');
  await buildPublic(f.root);
  assert.equal((await f.read()).projects[0].id, 'new');
  await f.save({ books: [], projects: [{ ...project, published: 'false' }] });
  await assert.rejects(buildPublic(f.root), /공개 설정/);
});

test('separate checkouts publish current private-repository data and program-repository code', async t => {
  const f = await fixture(t);
  const content = await mkdtemp(join(tmpdir(), 'folio-private-test-'));
  t.after(() => rm(content, { recursive: true, force: true }));
  const contentDir = join(content, 'dist');
  const outputDir = join(content, 'build', 'public-site');
  const opts = { contentDir, outputDir };
  const image = 'assets/projects/live/poster.webp';
  const draft = 'assets/projects/draft/poster.webp';
  for (const path of [image, draft]) await mkdir(dirname(join(contentDir, path)), { recursive: true });
  await f.save({ demo: true, books: [] });
  await f.write(image, 'outdated bytes in the program repository');
  const privateCatalog = { site: { title: '  작업 & <책>  ', translations: { en: { title: 'Studio "A" / $&' } } }, books: [], projects: [
    { id: 'live', title: '공개', images: [{ imageSrc: image }] },
    { id: 'draft', title: '미공개', published: false, images: [{ imageSrc: draft }] },
  ] };
  await writeFile(join(contentDir, 'catalog.json'), JSON.stringify(privateCatalog));
  await writeFile(join(contentDir, image), 'published artwork');
  await writeFile(join(contentDir, draft), 'draft');
  await writeFile(join(contentDir, 'index.html'), 'not the program');
  await buildPublic(f.root, opts);
  const readOutput = path => readFile(join(outputDir, path), 'utf8');
  assert.equal(await readOutput(image), 'published artwork');
  const home = await readOutput('index.html');
  assert.ok(home.includes('<title data-en="Studio &quot;A&quot; / $&amp;">작업 &amp; &lt;책&gt;</title>'));
  assert.ok(home.includes('<span data-wordmark-locale="ko" lang="ko">작업 &amp; &lt;책&gt;</span>'));
  assert.ok(home.includes('<span data-wordmark-locale="en" lang="en">Studio &quot;A&quot; / $&amp;</span>'));
  assert.deepEqual(JSON.parse(await readOutput('catalog.json')).projects.map(item => item.id), ['live']);
  await assert.rejects(readOutput(draft), { code: 'ENOENT' });
  await rm(join(contentDir, image));
  await assert.rejects(buildPublic(f.root, opts), { code: 'ENOENT' });
  assert.equal(await readOutput(image), 'published artwork');
  await rm(join(contentDir, 'catalog.json'));
  await assert.rejects(buildPublic(f.root, opts), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readOutput('catalog.json')).projects.map(item => item.id), ['live']);

  // In demo mode, a customised About photo is still content; stock images are code assets.
  const about = 'assets/site/about/profile.jpg';
  await mkdir(dirname(join(contentDir, about)), { recursive: true });
  await writeFile(join(contentDir, about), 'portrait from private repository');
  await writeFile(join(contentDir, 'catalog.json'), JSON.stringify({
    demo: true, books: [], site: { title: 'Folio', about: { text: 'Profile', imageSrc: about } },
  }));
  await buildPublic(f.root, opts);
  assert.equal(await readOutput(about), 'portrait from private repository');
  assert.deepEqual(await readFile(join(outputDir, 'assets/forest-cover.webp')), await readFile(join(f.source, 'assets/forest-cover.webp')));
  await assert.rejects(readOutput(image), { code: 'ENOENT' });
});

test('output cannot replace or nest inside source folders, including through a symlink', async t => {
  const f = await fixture(t);
  const contentRoot = join(f.root, 'private');
  const contentDir = join(contentRoot, 'dist');
  await mkdir(contentDir, { recursive: true });
  await writeFile(join(contentDir, 'catalog.json'), '{"books":[]}');
  const alias = join(f.root, 'alias');
  await symlink(contentDir, alias, 'dir');
  const overlaps = [f.source, join(f.source, 'generated'), f.root, contentDir, contentRoot,
    join(contentDir, 'nested'), join(alias, 'nested', 'site')];
  const alternateCase = join(f.root, 'DIST');
  if (await realpath(alternateCase).catch(() => null) === await realpath(f.source)) overlaps.push(alternateCase);
  for (const outputDir of overlaps) {
    await assert.rejects(buildPublic(f.root, { contentDir, outputDir }), /원본 폴더 밖/);
  }
  await assert.rejects(buildPublic(f.root, { contentDir: alias }), /원본 폴더/);
  assert.deepEqual(await readdir(contentDir), ['catalog.json']);
  const privatePhoto = 'assets/projects/one/photo.webp';
  await mkdir(join(contentDir, 'assets/projects/one'), { recursive: true });
  await symlink(join(f.root, 'dist/index.html'), join(contentDir, privatePhoto));
  await writeFile(join(contentDir, 'catalog.json'), JSON.stringify({
    books: [], projects: [{ id: 'one', title: 'One', images: [{ imageSrc: privatePhoto }] }],
  }));
  await assert.rejects(buildPublic(f.root, { contentDir }), /일반 파일/);
  await assert.rejects(readFile(join(f.output, 'catalog.json')), { code: 'ENOENT' });
});
