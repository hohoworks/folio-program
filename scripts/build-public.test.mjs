import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildPublic } from './build-public.mjs';
import { loadCatalog, readerSpreads } from '../dist/catalog.js';
import { projectFrame, projectVideoPlayer } from '../dist/project-media.js';

test('video share links resolve to official inline players and preserve share start times and unlisted Vimeo hashes', () => {
  const id = 'M7lc1UVf-VE';
  for (const url of ['https://youtu.be/' + id + '?t=90', 'https://m.youtube.com/watch?v=' + id + '&t=1m30s',
    'https://www.youtube.com/shorts/' + id + '#t=90s', 'https://youtube.com/live/' + id + '?start=90']) {
    assert.deepEqual(projectVideoPlayer(url), { provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/' + id + '?playsinline=1&start=90' });
  }
  assert.deepEqual(projectVideoPlayer('https://vimeo.com/76979871/5e2d1c1e6d?share=copy#t=1m'),
    { provider: 'Vimeo', src: 'https://player.vimeo.com/video/76979871?h=5e2d1c1e6d#t=1m' });
  assert.equal(projectVideoPlayer('https://www.vimeo.com/76979871')?.src, 'https://player.vimeo.com/video/76979871');
  for (const src of ['https://www.youtube.com/embed/' + id + '?cc_load_policy=1', 'https://player.vimeo.com/video/76979871?h=5e2d1c1e6d&loop=1']) {
    assert.equal(projectVideoPlayer(src)?.src, src);
  }
  for (const url of ['https://example.com/video', 'https://youtube.com.example/watch?v=' + id,
    'https://example.com@youtu.be/' + id, 'https://vimeo.com/channels/staffpicks', 'https://youtu.be/', 'http://vimeo.com/123']) {
    assert.equal(projectVideoPlayer(url), null);
  }
});

function assertStaticWordmark(html, expectedText) {
  // Check what the header contains even when scripts and styles have not loaded.
  const anchors = [...html.matchAll(/<a\b[^>]*\bclass="wordmark"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.deepEqual(anchors.map(anchor => anchor[1]), [expectedText]);
}

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
  for (const name of ['folio.svg', 'sewn-signatures.webp', 'forest.jpg', 'forest-cover.webp', 'examples', 'fonts']) {
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

test('explicit repair joins neighboring scans into complete reader pages without replacing the source images', async t => {
  const f = await fixture(t);
  const files = Array.from({ length: 4 }, (_, i) => 'assets/books/old/page-' + (i + 1) + '.webp');
  for (const path of files) await f.write(path, 'source ' + path);
  const pages = files.map(imageSrc => ({ imageSrc }));
  const book = { id: 'old', title: '책', coverRatio: .62, coverImages: { front: files[0] }, pageRatio: .34, pages };
  t.mock.method(globalThis, 'fetch', async () => Response.json(await f.read()));
  for (const repair of [false, true]) {
    await f.save({ books: [{ ...book, ...(repair && { joinSplitPages: true }) }] });
    await buildPublic(f.root);
    assert.deepEqual((await f.read()).books[0].pages, pages);
    const [result] = (await loadCatalog()).books;
    assert.equal(result.pageRatio, repair ? .68 : .34);
    assert.deepEqual(result.pages, repair ? [
      { imageSrc: files[0], rightImageSrc: files[1] },
      { imageSrc: files[2], rightImageSrc: files[3] },
    ] : pages);
    for (const path of files) assert.equal(await readFile(join(f.output, path), 'utf8'), 'source ' + path);
  }
  await f.save({ books: [{ ...book, joinSplitPages: true, pages: pages.slice(1) }] });
  await assert.rejects(buildPublic(f.root), /짝/);
  assert.equal((await f.read()).books[0].pages.length, 4);
});

test('public books use saved finishes and keep defaults for legacy or malformed fields', async t => {
  const imageSrc = 'assets/books/print/cover.webp';
  const source = { id: 'print', title: '책', coverRatio: .7, coverImages: { front: imageSrc }, pageRatio: .7, pages: [{ imageSrc }] };
  const books = [source, { ...source, id: 'case', bindingType: 'hardcover',
    mockupDetails: { spineShape: 'round', ribbonEnabled: true, ribbonAngle: 45, headbandColor: '#da597c', boardThicknessMm: 300 } }];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ books }));
  const [original, finished] = (await loadCatalog()).books;
  assert.equal(original.mockupDetails.ribbonEnabled, false);
  assert.equal(original.mockupDetails.boardThicknessMm, null);
  assert.equal(finished.mockupDetails.spineShape, 'round');
  assert.equal(finished.mockupDetails.ribbonAngle, 45);
  assert.equal(finished.mockupDetails.ribbonEnabled, true);
  assert.equal(finished.mockupDetails.headbandColor, '#da597c');
  assert.equal(finished.mockupDetails.boardThicknessMm, null);
});

test('mixed sheets keep their original pairs and solo pages through the public catalog', async t => {
  const folder = 'assets/books/mixed/';
  const book = { id: 'mixed', title: '혼합', coverRatio: .6, coverImages: { front: folder + 'front.webp' }, pageRatio: .6,
    pages: Array.from({ length: 6 }, (_, i) => ({ imageSrc: folder + i + '.webp' })), pdfLayout: 'mixed', pdfSheetSides: [1, 2, 2, 1] };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ books: [book] }));
  const [mixed] = (await loadCatalog()).books;
  assert.deepEqual(readerSpreads(mixed), [{ left: 0, right: 1 }, { left: 2, right: 3 }, { left: 4, right: 5 }, { left: 6, right: 0 }]);
  assert.deepEqual(readerSpreads({ ...mixed, pdfSheetSides: [2, 1, 1, 2] }), [
    { left: 1, right: 2 }, { left: 0, right: 3 }, { left: 4, right: 0 }, { left: 5, right: 6 },
  ]);
  assert.deepEqual(readerSpreads({ pages: book.pages.slice(0, 3) }), [{ left: 1, right: 2 }, { left: 3, right: 0 }]);
  assert.deepEqual(readerSpreads({ ...mixed, firstPageSide: 'left' }), [
    { left: 1, right: 0 }, { left: 2, right: 3 }, { left: 4, right: 5 }, { left: 0, right: 6 },
  ]);
});

test('opening a loose-leaf book on the recto leaves the verso empty without counting it', () => {
  const spreads = (count, firstPageSide) => readerSpreads({ pages: Array(count), firstPageSide });
  assert.deepEqual(spreads(1, 'right'), [{ left: 0, right: 1 }]);
  assert.deepEqual(spreads(3, 'right'), [{ left: 0, right: 1 }, { left: 2, right: 3 }]);
  assert.deepEqual(spreads(2, 'left'), [{ left: 1, right: 2 }]);
  assert.deepEqual(spreads(2), [{ left: 1, right: 2 }]);
  const book = spreads(340, 'right');
  assert.deepEqual(book.at(-1), { left: 340, right: 0 });
  assert.deepEqual(book.flatMap(({ left, right }) => [left, right]).filter(Boolean), Array.from({ length: 340 }, (_, i) => i + 1));
});

test('the reader preserves composed PDF spreads and applies recto after repairing false splits', async t => {
  const path = 'assets/books/old/scan.webp';
  const book = { id: 'original', title: '책', coverRatio: .7, coverImages: { front: path }, pageRatio: .7,
    pages: Array.from({ length: 4 }, () => ({ imageSrc: path })), pdfLayout: 'spread', firstPageSide: 'right' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ books: [book, { ...book, id: 'repaired', joinSplitPages: true }] }));
  const [original, repaired] = (await loadCatalog()).books;
  assert.deepEqual(readerSpreads(original), [{ left: 1, right: 2 }, { left: 3, right: 4 }]);
  assert.deepEqual(readerSpreads(repaired), [{ left: 0, right: 1 }, { left: 2, right: 0 }]);
});

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
  assertStaticWordmark(home, '포트폴리오');
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
  const home = await readFile(join(f.output, 'index.html'), 'utf8');
  assert.ok(home.includes('<title data-en="HOHO WORKS">HOHO WORKS</title>'));
  assertStaticWordmark(home, 'HOHO WORKS');
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

test('the shipped site title migrates before publishing, while subsequent choices and translations survive', async t => {
  const f = await fixture(t);
  const starterRevision = 'e1edee23-0932-4b9a-8c67-9c803a4b2e93';
  for (const [title, revision, expected] of [
    ['HOHOHO', starterRevision, 'HOHO WORKS'],
    ['HOHOHO', 'new-revision', 'HOHOHO'],
    ['Folio', starterRevision, 'Folio'],
  ]) {
    const site = { title, revision, translations: { en: { title: 'English name' } } };
    await f.save({ books: [], site });
    await buildPublic(f.root);
    const published = await f.read();
    assert.deepEqual(published.site, { title: expected, translations: site.translations });
    const html = await readFile(join(f.output, 'index.html'), 'utf8');
    assert.ok(html.includes(`<title data-en="English name">${expected}</title>`));
    assertStaticWordmark(html, expected);
    assert.deepEqual(JSON.parse(await readFile(join(f.source, 'catalog.json'), 'utf8')).site, site);
  }
});

test('HTML and the full module graph use one version that changes with code, independently of catalog edits', async t => {
  const f = await fixture(t);
  await f.save({ books: [], demo: true });
  const modulePath = join(f.source, 'book.js');
  const bookModule = await readFile(modulePath, 'utf8');
  // A URL for a document in site content must still point to its original location.
  await f.write('book.js', bookModule + "\nexport const guide = './assets/books/sample/guide.pdf';\n");

  async function buildAndCheckReferences() {
    await buildPublic(f.root);
    const readOutput = name => readFile(join(f.output, name), 'utf8');
    const home = await readOutput('index.html');
    const version = home.match(/\.\/viewer\.js\?v=([a-f0-9]{16})"/)?.[1];
    assert.ok(version, 'the entry module must have a version');
    const scripts = (await readdir(f.output)).filter(name => name.endsWith('.js'));
    const localCodeUrls = source => [...source.matchAll(/(["'])(\.?\/[^"'<>\s]*?\.(?:js|css)(?:\?[^"'<>\s]*)?)\1/g)].map(match => match[2]);
    for (const name of ['index.html', '404.html', ...scripts]) {
      const original = await readFile(join(f.source, name), 'utf8');
      const generated = await readOutput(name);
      assert.deepEqual(localCodeUrls(generated), localCodeUrls(original).map(url => url + '?v=' + version), name);
    }
    assert.ok(home.includes('"https://use.typekit.net/gwz2aiq.js"'));
    assert.ok(home.includes('"./assets/folio.svg"'));
    assert.ok((await readOutput('catalog.js')).includes("'./catalog.json'"));
    assert.ok((await readOutput('library.js')).includes("'./assets/forest.jpg'"));
    assert.ok((await readOutput('book.js')).includes("'./assets/books/sample/guide.pdf'"));
    return version;
  }

  const first = await buildAndCheckReferences();
  await f.save({ books: [], demo: true, site: { title: 'Another name' } });
  assert.equal(await buildAndCheckReferences(), first);
  // book.js is imported by a dynamically imported demo module, not the home page.
  const current = await readFile(modulePath, 'utf8');
  await f.write('book.js', current + '\nexport const changed = true;\n');
  assert.notEqual(await buildAndCheckReferences(), first);
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
  assert.ok(home.includes('<title data-en="Studio “A” / $&amp;">작업 &amp; &lt;책&gt;</title>'));
  assertStaticWordmark(home, '작업 &amp; &lt;책&gt;');
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

test('public build retains ordered mixed media, skips private uploads and supports old image-only projects', async t => {
  const f = await fixture(t);
  const photo = 'assets/projects/mixed/picture.webp';
  const video = 'assets/projects/mixed/film.mp4';
  const hiddenVideo = 'assets/projects/draft/private.webm';
  await f.write(photo, 'picture');
  await f.write(video, 'binary film');
  await f.write(hiddenVideo, 'private film');
  const media = [
    { type: 'video', videoSrc: video, ratio: 1.5 },
    { type: 'image', imageSrc: photo },
    { type: 'embed', url: 'https://example.com/piece', alt: '인터랙티브' },
  ];
  const projects = [
    { id: 'mixed', title: 'Mixed', media, images: [{ imageSrc: photo }] },
    { id: 'legacy', title: 'Legacy', images: [{ imageSrc: photo }] },
    { id: 'web', title: 'Web', media: [media[2]] },
    { id: 'private', title: 'Private', published: false, media: [{ type: 'video', videoSrc: hiddenVideo }] },
  ];
  await f.save({ books: [], projects });
  await buildPublic(f.root);
  assert.equal(await readFile(join(f.output, video), 'utf8'), 'binary film');
  await assert.rejects(readFile(join(f.output, hiddenVideo)), { code: 'ENOENT' });
  t.mock.method(globalThis, 'fetch', async () => Response.json(await f.read()));
  const catalog = await loadCatalog();
  assert.deepEqual(catalog.projects.map(project => project.id), ['mixed', 'legacy', 'web']);
  assert.deepEqual(catalog.projects[0].media.map(entry => entry.type), ['video', 'image', 'embed']);
  assert.equal(catalog.projects[0].media[0].ratio, 1.5);
  assert.equal(catalog.projects[1].media[0].imageSrc, photo);
  assert.deepEqual(catalog.projects[2].images, []);
  for (const faulty of [{ type: 'video', videoSrc: 'assets/books/foo/movie.webm' }, { type: 'embed', url: 'data:text/html,hello' }]) {
    await f.save({ books: [], projects: [{ ...projects[0], media: [faulty] }] });
    await assert.rejects(buildPublic(f.root), /미디어 형식/);
    assert.deepEqual((await f.read()).projects[0].media, media);
  }
});

test('public frame policy follows published player origins and shrinks on the next publication', async t => {
  const f = await fixture(t);
  const embed = url => ({ type: 'embed', url });
  const media = [
    embed('https://youtu.be/M7lc1UVf-VE?t=90'),
    embed('https://www.youtube.com/embed/M7lc1UVf-VE'),
    embed('https://vimeo.com/76979871/abc'),
    embed('https://player.vimeo.com/video/76979871?h=abc'),
    embed('https://EXAMPLE.ORG:8443/work?version=3#view'),
    embed('https://example.org:8443/another'),
    embed('https://예시.kr/작품'),
  ];
  const projects = [
    { id: 'live', title: 'Live', media },
    { id: 'draft', title: 'Draft', published: false, media: [embed('https://draft.example.org/')] },
  ];
  const headers = () => readFile(join(f.output, '_headers'), 'utf8');
  const frameSources = text => text.match(/; frame-src ([^;]+);/)[1].split(' ');
  await f.save({ books: [], projects });
  await buildPublic(f.root);
  const output = await headers();
  assert.deepEqual(frameSources(output), [
    'https://example.org:8443', 'https://player.vimeo.com', 'https://www.youtube-nocookie.com',
    'https://www.youtube.com', new URL('https://예시.kr').origin,
  ].sort());
  assert.match(output, /^  ! Access-Control-Allow-Origin$/m);
  assert.match(output, /^  Content-Security-Policy-Report-Only: style-src-attr 'none'$/m);
  assert.match(output, /; media-src 'self';/);
  assert.doesNotMatch(await readFile(join(f.output, '404.html'), 'utf8'), /<style[\s>]/i);

  await f.save({ books: [], projects: projects.map(item => ({ ...item, published: false })) });
  await buildPublic(f.root);
  assert.deepEqual(frameSources(await headers()), ["'none'"]);
});

test('large embedding collections keep their full document policy and unsupported hosts remain clickable', async t => {
  const f = await fixture(t);
  const siteUrls = Array.from({ length: 100 }, (_, i) => 'https://host-' + i + '.example.org');
  const linkOnly = 'https://[::1]:8443/work';
  const urls = [...siteUrls, linkOnly];
  await f.save({ books: [], projects: [{ id: 'work', title: 'Work', media: urls.map(url => ({ type: 'embed', url })) }] });
  await buildPublic(f.root);
  const headers = await readFile(join(f.output, '_headers'), 'utf8');
  assert.ok(headers.split('\n').every(line => line.length <= 2000));
  assert.match(headers, /; frame-src https:;/);
  const html = await readFile(join(f.output, 'index.html'), 'utf8');
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="frame-src ([^"]+)">/);
  assert.deepEqual(policy[1].split(' '), siteUrls.sort());
  assert.ok(policy.index < html.indexOf('<script'));
  assert.match(await readFile(join(f.output, '404.html'), 'utf8'), /content="frame-src 'none'"/);
  assert.equal((await f.read()).projects[0].media.at(-1).url, linkOnly);
  assert.equal(projectFrame(linkOnly), null);
  assert.equal(projectFrame('https://*.example.org/work'), null);
});
