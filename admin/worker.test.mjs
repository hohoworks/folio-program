import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStore } from '../scripts/local-store.mjs';
import { buildPublic } from '../scripts/build-public.mjs';
import { catalogAssets } from '../scripts/check-site.mjs';
import worker from './worker.mjs';
import { MAX_PROJECT_VIDEO_BYTES } from '../dist/project-media.js';
import { STOCK_PROJECT_TAGS } from '../dist/project-tags.js';
import { DEFAULT_SITE_TITLE } from '../dist/site-title.js';
import { planPdfPages, remainingPdfPages } from './public/pdf-layout.js';

const origin = 'https://admin.folio.example';
const code = crypto.randomUUID() + crypto.randomUUID();
const env = {
  ADMIN_CODE: code,
  GITHUB_TOKEN: 'mock-token',
  GITHUB_REPOSITORY: 'my-studio/folio-books',
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: {
    async fetch(request) {
      return new Response(new URL(request.url).pathname, { headers: { 'Cache-Control': 'public' } });
    },
  },
};

function request(path, { method = 'GET', cookie, headerOrigin = origin, body, headers = {} } = {}, bindings = env) {
  const requestHeaders = new Headers(headers);
  if (cookie) requestHeaders.set('Cookie', cookie);
  if (method === 'POST' && headerOrigin) requestHeaders.set('Origin', headerOrigin);
  if (body && !(body instanceof Uint8Array)) {
    requestHeaders.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  return worker.fetch(new Request(new URL(path, origin), { method, headers: requestHeaders, body }), bindings);
}

function login(given = code, options = {}, bindings = env) {
  return request('/api/login', { method: 'POST', body: { code: given }, ...options }, bindings);
}

async function session() {
  const response = await login();
  assert.equal(response.status, 200);
  return response.headers.get('Set-Cookie').split(';')[0];
}

function mockGitHub(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.headers.Authorization, 'Bearer mock-token');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['User-Agent'], 'HOHO-WORKS-Admin');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
    const call = {
      path: url.pathname.replace('/repos/my-studio/folio-books', ''),
      ref: url.searchParams.get('ref'),
      method: options.method,
      body: options.body == null ? undefined : await new Response(options.body).json(),
      accept: options.headers.Accept,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

test('admin shell and scripts require a signed, expiring session', async t => {
  const publicPage = await request('/admin');
  assert.equal(await publicPage.text(), '/login.html');
  assert.equal(publicPage.headers.get('Cache-Control'), 'no-store');
  assert.equal(await (await request('/style.css')).text(), '/style.css');
  assert.equal((await request('/api/books')).status, 401);
  assert.equal((await request('/index.html')).status, 401);
  assert.equal((await request('/admin.js')).status, 401);
  assert.equal((await request('/vendor/pdf.mjs')).status, 401);
  assert.equal((await login(code, { headerOrigin: null })).status, 403);
  assert.equal((await login(code, { headerOrigin: 'https://other.example' })).status, 403);
  assert.equal((await login('Z' + code.slice(1))).status, 401);
  assert.equal((await login(code, {}, { ...env, ADMIN_CODE: 'short' })).status, 503);

  const loggedIn = await login();
  const setCookie = loggedIn.headers.get('Set-Cookie');
  assert.match(setCookie, /^__Host-folio-admin=/);
  assert.match(setCookie, /; Path=\/; Max-Age=14400; Secure; HttpOnly; SameSite=Strict$/);
  assert.equal(loggedIn.headers.get('Cache-Control'), 'no-store');
  const cookie = setCookie.split(';')[0];
  assert.equal(await (await request('/', { cookie })).text(), '/index.html');
  assert.equal(await (await request('/admin.js', { cookie })).text(), '/admin.js');
  assert.equal(await (await request('/vendor/pdf.mjs', { cookie })).text(), '/vendor/pdf.mjs');
  const signatureStart = cookie.lastIndexOf('.') + 1;
  const tampered = cookie.slice(0, signatureStart)
    + (cookie[signatureStart] === 'A' ? 'B' : 'A') + cookie.slice(signatureStart + 1);
  assert.equal((await request('/admin.js', { cookie: tampered })).status, 401);
  assert.equal((await request('/admin.js', { cookie }, { ...env, ADMIN_CODE: 'Z' + code.slice(1) })).status, 401);

  assert.equal((await request('/api/logout', { method: 'POST', cookie, headerOrigin: null })).status, 403);
  const logout = await request('/api/logout', { method: 'POST', cookie });
  assert.match(logout.headers.get('Set-Cookie'), /; Max-Age=0;/);
  t.mock.method(Date, 'now', () => Date.parse(loggedIn.headers.get('Date') || new Date().toISOString()) + 14401 * 1000);
  assert.equal((await request('/admin.js', { cookie })).status, 401);
});

test('a signed-out visitor cannot read private records or change the portfolio', async () => {
  for (const [method, paths] of [
    ['GET', ['/api/catalog', '/api/books', '/api/preview']],
    ['POST', ['/api/assets', '/api/books', '/api/projects', '/api/site', '/api/delete', '/api/order']],
  ]) {
    for (const path of paths) {
      const response = await request(path, { method });
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
  }
});

test('login respects the Worker rate limit binding', async () => {
  const response = await login(code, { headers: { 'CF-Connecting-IP': '192.0.2.1' } }, {
    ...env,
    LOGIN_RATE_LIMITER: {
      async limit({ key }) {
        assert.equal(key, '192.0.2.1');
        return { success: false };
      },
    },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('PDF libraries revalidate after authentication while the editor and private data stay uncached', async () => {
  const cookie = await session();
  const etag = '"pdf-build"';
  let assetReads = 0;
  const bindings = { ...env, ASSETS: { async fetch(req) {
    assetReads++;
    assert.equal(req.headers.get('Cookie'), null);
    const matches = req.headers.get('If-None-Match') === etag;
    return new Response(matches ? null : 'module', { status: matches ? 304 : 200, headers: { ETag: etag } });
  } } };
  const path = '/vendor/pdfjs/pdf.worker.mjs';
  const headers = { 'If-None-Match': etag };
  const denied = await request(path, { headers }, bindings);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  assert.equal(assetReads, 0);
  const downloaded = await request(path, { cookie }, bindings);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('Cache-Control'), 'private, no-cache');
  const revalidated = await request(path, { cookie, headers }, bindings);
  assert.equal(revalidated.status, 304);
  assert.equal(await revalidated.text(), '');
  assert.equal(revalidated.headers.get('Cache-Control'), 'private, no-cache');
  const editor = await request('/admin.js', { cookie, headers }, bindings);
  assert.equal(editor.status, 200);
  assert.equal(editor.headers.get('Cache-Control'), 'no-store');
});

test('login stays closed if its rate limiter is missing or unavailable', async () => {
  for (const limiter of [undefined, { limit: async () => { throw new Error('unavailable'); } }, { limit: async () => ({}) }]) {
    const response = await login(code, {}, { ...env, LOGIN_RATE_LIMITER: limiter });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('catalogue read needs one GitHub request and distinguishes an empty catalogue from a missing branch', async t => {
  const cookie = await session();
  const bindings = { ...env, GITHUB_BRANCH: 'folio/live' };
  let catalogExists = true;
  let branchExists = true;
  const calls = mockGitHub(t, ({ path, ref }) => {
    if (path === '/contents/dist/catalog.json') {
      assert.equal(ref, 'folio/live');
      return catalogExists ? Response.json({ books: [] }) : new Response(null, { status: 404 });
    }
    assert.equal(path, '/git/ref/heads/folio/live');
    return branchExists ? Response.json({ object: { sha: 'current' } }) : new Response(null, { status: 404 });
  });
  assert.equal((await request('/api/catalog', { cookie }, bindings)).status, 200);
  assert.equal(calls.length, 1);
  catalogExists = false;
  assert.deepEqual(await (await request('/api/books', { cookie }, bindings)).json(), { books: [] });
  assert.equal(calls.length, 3);
  branchExists = false;
  assert.equal((await request('/api/catalog', { cookie }, bindings)).status, 502);
});

test('a split administrator reads and commits only to the named private repository', async t => {
  const cookie = await session();
  const bindings = { ...env, FOLIO_STORAGE_MODE: 'private', FOLIO_CONTENT_REPOSITORY: env.GITHUB_REPOSITORY,
    GITHUB_REPOSITORY: 'my-studio/program', GITHUB_BRANCH: 'program-only' };
  const state = repository(t, { books: [] });
  assert.equal((await request('/api/catalog', { cookie }, bindings)).status, 200);
  const change = { method: 'POST', cookie, body: { registrationId: crypto.randomUUID(), title: '새 이름' } };
  assert.equal((await request('/api/site', change, bindings)).status, 200);
  assert.equal(state.catalog.site.title, '새 이름');
  assert.equal(state.commitCount, 1);

  state.isPrivate = false;
  assert.equal((await request('/api/catalog', { cookie }, bindings)).status, 503);
  assert.equal((await request('/api/site', change, bindings)).status, 503);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 8, 0, 0, 0, 8]);
  assert.equal((await request('/api/assets', { method: 'POST', cookie, body: png, headers: { 'Content-Type': 'image/png' } }, bindings)).status, 503);
  assert.equal(state.commitCount, 1);
});

test('a split administrator fails closed with a missing target, a renamed target or an uninitialized content branch', async t => {
  const cookie = await session();
  const bindings = { ...env, FOLIO_STORAGE_MODE: 'private', FOLIO_CONTENT_BRANCH: 'content/production' };
  let fullName = 'my-studio/different-repository';
  const calls = mockGitHub(t, ({ path, ref }) => {
    if (path === '') return Response.json({ full_name: fullName, private: true, visibility: 'private' });
    assert.equal(path, '/contents/dist/catalog.json');
    assert.equal(ref, 'content/production');
    return new Response(null, { status: 404 });
  });
  assert.equal((await request('/api/catalog', { cookie }, bindings)).status, 503);
  assert.equal(calls.length, 0);
  assert.equal((await request('/api/catalog', { cookie }, { ...bindings, FOLIO_STORAGE_MODE: undefined })).status, 503);
  assert.equal(calls.length, 0);
  bindings.FOLIO_CONTENT_REPOSITORY = env.GITHUB_REPOSITORY;
  assert.equal((await request('/api/catalog', { cookie }, bindings)).status, 503);
  assert.equal(calls.length, 1);
  fullName = bindings.FOLIO_CONTENT_REPOSITORY;
  const missing = await request('/api/catalog', { cookie }, bindings);
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /dist\/catalog\.json/);
});

test('only accepted image uploads are staged as GitHub blobs', async t => {
  const sha = '1'.repeat(40);
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 64, 0, 0, 0, 64]);
  const calls = mockGitHub(t, ({ path, method, body }) => {
    assert.equal(path, '/git/blobs');
    assert.equal(method, 'POST');
    assert.deepEqual(body, { encoding: 'base64', content: Buffer.from(bytes).toString('base64') });
    return Response.json({ sha }, { status: 201 });
  });
  const cookie = await session();
  const png = { 'Content-Type': 'image/png' };
  assert.equal((await request('/api/assets', {
    method: 'POST', body: bytes, headers: png,
  })).status, 401);
  assert.equal((await request('/api/assets', {
    method: 'POST', body: new Uint8Array([1, 2, 3]), cookie, headers: png,
  })).status, 415);
  assert.equal((await request('/api/assets', {
    method: 'POST', body: bytes, cookie, headers: { ...png, 'Content-Length': '10485761' },
  })).status, 413);
  const largePixels = bytes.slice();
  new DataView(largePixels.buffer).setUint32(16, 20000);
  assert.equal((await request('/api/assets', {
    method: 'POST', body: largePixels, cookie, headers: png,
  })).status, 400);
  const response = await request('/api/assets', { method: 'POST', body: bytes, cookie, headers: png });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { sha, ext: 'png', ratio: 1 });
  assert.equal(calls.length, 1);
});

test('registration keeps the GitHub catalog and image references in one commit across concurrent writes', async t => {
  const oldBook = { id: 'old-book', title: '책', pages: [] };
  const newParallelBook = { id: 'parallel-book', title: '이웃 책', pages: [] };
  const trees = [];
  let currentHead = 'head1';
  let lastCatalog = { books: [oldBook] };
  const calls = mockGitHub(t, ({ path, ref, method, body, accept }) => {
    if (path === '/git/ref/heads/main') return Response.json({ object: { sha: currentHead } });
    if (path === '/contents/dist/catalog.json') {
      assert.equal(accept, 'application/vnd.github.raw+json');
      assert.ok(ref === 'main' || ref === currentHead);
      return Response.json(lastCatalog);
    }
    if (path.startsWith('/git/commits/') && method === 'GET') {
      return Response.json({ tree: { sha: 'tree-' + currentHead } });
    }
    if (path === '/git/trees' && method === 'POST') {
      assert.equal(body.base_tree, 'tree-' + currentHead);
      trees.push(body.tree);
      return Response.json({ sha: 'new-tree-' + currentHead });
    }
    if (path === '/git/commits' && method === 'POST') {
      assert.deepEqual(body.parents, [currentHead]);
      assert.equal(body.tree, 'new-tree-' + currentHead);
      assert.equal(body.message, 'Register book: 책');
      return Response.json({ sha: 'commit-' + currentHead });
    }
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      assert.deepEqual(body, { sha: 'commit-' + currentHead, force: false });
      if (currentHead === 'head1') {
        currentHead = 'head2';
        lastCatalog = { books: [oldBook, newParallelBook] };
        return Response.json({ message: 'Update is not a fast forward' }, { status: 422 });
      }
      currentHead = body.sha;
      lastCatalog = JSON.parse(trees.at(-1).at(-1).content);
      return Response.json({ ok: true });
    }
    assert.fail('Unexpected GitHub call: ' + path);
  });
  const body = {
    registrationId: '56ecb607-8aa5-4ae1-9b85-1e219ab00a8b',
    title: ' 책 ',
    category: '에세이',
    description: '샘플 책',
    language: '한국어',
    trimSizeMm: [148, 210],
    spineWidthMm: 12,
    bindingType: 'exposed-sewn',
    pageRatio: 148 / 210,
    coverRatio: 150 / 215,
    assets: {
      front: { sha: '1'.repeat(40), ext: 'png' },
      back: { sha: '2'.repeat(40), ext: 'jpg' },
      spine: { sha: '3'.repeat(40), ext: 'png' },
      pages: [
        { sha: '4'.repeat(40), ext: 'webp' },
        { sha: '5'.repeat(40), ext: 'jpg' },
      ],
    },
  };
  const cookie = await session();
  assert.equal((await request('/api/books', {
    method: 'POST', body, cookie, headerOrigin: 'https://other.example',
  })).status, 403);
  assert.equal((await request('/api/books', {
    method: 'POST', body: { ...body, pageRatio: 0 }, cookie,
  })).status, 400);
  assert.equal((await request('/api/books', {
    method: 'POST', body: { ...body, bindingType: 'unknown-binding' }, cookie,
  })).status, 400);
  assert.equal((await request('/api/books', {
    method: 'POST', body: { ...body, registrationId: '../another-book' }, cookie,
  })).status, 400);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  const response = await request('/api/books', { method: 'POST', body, cookie });
  assert.equal(response.status, 201);
  const { book, commit } = await response.json();
  assert.equal(commit, 'commit-head2');
  assert.equal(book.id, 'book-' + body.registrationId);
  assert.equal(book.title, '책');
  assert.deepEqual(book.description, ['샘플 책']);
  assert.deepEqual(book.trimSizeMm, [148, 210]);
  assert.equal(book.spineWidthMm, 12);
  assert.equal(book.bindingType, 'exposed-sewn');
  const dir = 'assets/books/' + book.id;
  assert.deepEqual(book.coverImages, {
    front: dir + '/front.png',
    back: dir + '/back.jpg',
    spine: dir + '/spine.png',
  });
  assert.deepEqual(book.pages, [{ imageSrc: dir + '/page-0001.webp' }, { imageSrc: dir + '/page-0002.jpg' }]);
  assert.equal(trees.length, 2);
  assert.deepEqual(trees[0].slice(0, -1), trees[1].slice(0, -1));
  assert.deepEqual(trees[1].slice(0, -1).map(entry => entry.path), [
    'dist/' + book.coverImages.front,
    'dist/' + book.coverImages.back,
    'dist/' + book.coverImages.spine,
    ...book.pages.map(page => 'dist/' + page.imageSrc),
  ]);
  assert.deepEqual(trees[1].slice(0, -1).map(entry => entry.sha), ['1', '2', '3', '4', '5'].map(x => x.repeat(40)));
  assert.deepEqual(lastCatalog.books, [oldBook, newParallelBook, book]);
  assert.ok(calls.filter(call => call.path === '/contents/dist/catalog.json').every(call => call.ref !== 'main'));
  const catalog = await request('/api/books', { cookie });
  assert.deepEqual(await catalog.json(), { books: lastCatalog.books });
  const replay = await request('/api/books', {
    method: 'POST', body: { ...body, title: 'New title', registrationId: body.registrationId.toUpperCase() }, cookie,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { book, commit });
  assert.equal(trees.length, 2);
  const olderRequest = await request('/api/books', {
    method: 'POST', body: { ...body, registrationId: undefined, bindingType: undefined }, cookie,
  });
  assert.equal(olderRequest.status, 201);
  const { book: paperback } = await olderRequest.json();
  assert.equal(paperback.bindingType, 'paperback');
  assert.notEqual(paperback.id, book.id);
});

function repository(t, initial, files = []) {
  const state = {
    catalog: structuredClone(initial),
    isPrivate: true,
    files: new Set(files),
    head: 'initial-head',
    commitCount: 0,
    trees: [],
    beforeUpdate: null,
  };
  const createdTrees = new Map();
  const createdCommits = new Map();
  mockGitHub(t, ({ path, ref, method, body }) => {
    if (path === '') return Response.json({ full_name: env.GITHUB_REPOSITORY, private: state.isPrivate, visibility: state.isPrivate ? 'private' : 'public' });
    if (path === '/git/ref/heads/main') return Response.json({ object: { sha: state.head } });
    if (path === '/contents/dist/catalog.json') {
      assert.ok(ref === 'main' || ref === state.head);
      return Response.json(state.catalog);
    }
    if (path.startsWith('/contents/dist/assets/')) return new Response(new Uint8Array([1, 2, 3]));
    if (path.startsWith('/git/commits/') && method === 'GET') {
      return Response.json({ tree: { sha: 'tree-' + state.head } });
    }
    if (path.startsWith('/git/trees/') && method === 'GET') {
      return Response.json({ tree: [...state.files].map(path => ({ path, type: 'blob' })), truncated: false });
    }
    if (path === '/git/trees' && method === 'POST') {
      const sha = 'tree-' + state.trees.length;
      state.trees.push(body.tree);
      createdTrees.set(sha, body.tree);
      return Response.json({ sha });
    }
    if (path === '/git/commits' && method === 'POST') {
      const sha = 'commit-' + (++state.commitCount);
      createdCommits.set(sha, body);
      return Response.json({ sha });
    }
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      assert.equal(body.force, false);
      if (state.beforeUpdate) {
        state.beforeUpdate(state);
        state.beforeUpdate = null;
        return Response.json({ message: 'Concurrent update' }, { status: 422 });
      }
      const commit = createdCommits.get(body.sha);
      assert.deepEqual(commit.parents, [state.head]);
      const tree = createdTrees.get(commit.tree);
      for (const entry of tree) {
        if (entry.path === 'dist/catalog.json') state.catalog = JSON.parse(entry.content);
        else if (entry.sha === null) state.files.delete(entry.path);
        else state.files.add(entry.path);
      }
      state.head = body.sha;
      return Response.json({ ok: true });
    }
    assert.fail('Unexpected request: ' + path);
  });
  return state;
}

const imageFile = { sha: '1'.repeat(40), ext: 'webp' };
const legacyBook = {
  id: 'legacy', title: '원래 책', category: '사진', description: ['원래 소개'], year: '2025',
  coverRatio: 0.7, pageRatio: 0.7, trimSizeMm: [148, 210], spineWidthMm: 10,
  coverImages: { front: 'assets/books/legacy/front.png', back: 'assets/books/legacy/back.jpg' },
  pages: [{ imageSrc: 'assets/books/legacy/page-0001.webp' }],
  customField: 'preserved',
};

function assetPaths(item) {
  return [item.thumbnailSrc, ...Object.values(item.coverImages || {}), ...(item.pages || []).map(page => page.imageSrc),
    ...(item.images || []).map(image => image.imageSrc)].filter(Boolean).map(path => 'dist/' + path);
}

test('PDF auto layout uses the trim aspect for each rotated viewport and only resumes missing sides', async () => {
  const file = widths => ({
    numPages: widths.length,
    async getPage(n) { return { getViewport: () => ({ width: widths[n - 1], height: 200 }), cleanup() {} }; },
  });
  const mixed = await planPdfPages(file([140, 280, 280, 140]), 'auto', 0.7);
  assert.deepEqual(mixed, { sheets: [1, 2, 2, 1], total: 6, layout: 'mixed' });
  assert.deepEqual([...remainingPdfPages(mixed.sheets, 2)], [
    { number: 2, count: 2, startSide: 1 }, { number: 3, count: 2, startSide: 0 }, { number: 4, count: 1, startSide: 0 },
  ]);
  assert.equal((await planPdfPages(file([280, 280]), 'auto', 1.4)).layout, 'single');
  assert.equal((await planPdfPages(file([280, 280]), 'auto', 0.7)).layout, 'spread');
  await assert.rejects(planPdfPages(file([200]), 'auto', 0.7), /직접 선택/);
  await assert.rejects(planPdfPages(file([200]), 'auto', null), /재단 크기/);
  assert.equal((await planPdfPages(file([200]), 'single')).total, 1);
  assert.equal((await planPdfPages(file([200]), 'spread')).total, 2);
  await assert.rejects(planPdfPages({ numPages: 501 }, 'spread'), /1,000/);
});

test('legacy half-page repair is explicit, reversible and cleared on PDF replacement; imported layout survives edits', async t => {
  const book = { ...legacyBook, pages: [...legacyBook.pages, { imageSrc: 'assets/books/legacy/page-0002.webp' }] };
  const state = repository(t, { books: [book] }, assetPaths(book));
  const cookie = await session();
  const edit = extra => request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, registrationId: crypto.randomUUID(), baseRevision: state.catalog.books[0].revision ?? null, ...extra,
  } });
  assert.equal((await edit({ pdfLayout: 'spread' })).status, 400);
  assert.equal((await edit({ joinSplitPages: 'yes' })).status, 400);
  assert.equal((await edit({ joinSplitPages: true })).status, 200);
  assert.equal((await edit({ title: '복원 유지' })).status, 200);
  assert.equal(state.catalog.books[0].joinSplitPages, true);
  assert.deepEqual(state.catalog.books[0].pages, book.pages);
  assert.equal((await edit({ joinSplitPages: false })).status, 200);
  assert.equal(state.catalog.books[0].joinSplitPages, undefined);
  assert.equal((await edit({ joinSplitPages: true })).status, 200);
  assert.equal((await edit({ pdfLayout: 'spread', assets: { pages: [imageFile] } })).status, 400);
  assert.equal((await edit({ pdfLayout: 'single', assets: { pages: [imageFile] } })).status, 200);
  assert.equal(state.catalog.books[0].joinSplitPages, undefined);
  assert.equal((await edit({ title: '재편집' })).status, 200);
  assert.equal(state.catalog.books[0].pdfLayout, 'single');
  assert.equal((await edit({ joinSplitPages: true })).status, 400);
  const mixedPages = { pages: [imageFile, imageFile, imageFile, imageFile] };
  for (const sides of [undefined, [1, 2], [1, 1, 1, 1], [2, 2], [1, 2, 3]]) {
    assert.equal((await edit({ pdfLayout: 'mixed', pdfSheetSides: sides, assets: mixedPages })).status, 400);
  }
  assert.equal((await edit({ pdfLayout: 'mixed', pdfSheetSides: [1, 2, 1], assets: mixedPages })).status, 200);
  assert.equal((await edit({ title: '혼합 유지' })).status, 200);
  assert.deepEqual(state.catalog.books[0].pdfSheetSides, [1, 2, 1]);
  assert.equal((await edit({ pdfLayout: 'spread', assets: mixedPages })).status, 200);
  assert.equal(state.catalog.books[0].pdfSheetSides, undefined);
});

test('first page side can be edited without re-uploading a repaired book or changing its page files', async t => {
  const book = { ...legacyBook, joinSplitPages: true, pages: [
    ...legacyBook.pages, { imageSrc: 'assets/books/legacy/page-0002.webp' },
  ] };
  const state = repository(t, { books: [book] }, assetPaths(book));
  const cookie = await session();
  const edit = extra => request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, registrationId: crypto.randomUUID(), baseRevision: state.catalog.books[0].revision ?? null, ...extra,
  } });
  assert.equal((await edit({ title: '기존 배치' })).status, 200);
  assert.equal(state.catalog.books[0].firstPageSide, undefined);
  assert.equal((await edit({ firstPageSide: 'right' })).status, 200);
  assert.equal((await edit({ title: '우수 시작' })).status, 200);
  assert.equal(state.catalog.books[0].firstPageSide, 'right');
  assert.equal(state.catalog.books[0].joinSplitPages, true);
  assert.deepEqual(state.catalog.books[0].pages, book.pages);
  assert.equal((await edit({ firstPageSide: 'bad' })).status, 400);
  assert.equal((await edit({ baseRevision: null, firstPageSide: 'left' })).status, 409);
  assert.equal(state.catalog.books[0].firstPageSide, 'right');
  assert.equal((await edit({ assets: { pages: [imageFile] }, pdfLayout: 'single' })).status, 200);
  assert.equal(state.catalog.books[0].firstPageSide, 'right');
  assert.equal((await edit({ firstPageSide: 'left' })).status, 200);
  assert.equal(state.catalog.books[0].firstPageSide, 'left');
  assert.equal((await edit({ firstPageSide: null })).status, 200);
  assert.equal(Object.hasOwn(state.catalog.books[0], 'firstPageSide'), false);
});

test('mockup and reading controls can be changed independently of uploaded book files', async t => {
  const state = repository(t, { books: [legacyBook] }, assetPaths(legacyBook));
  const cookie = await session();
  const edit = extra => request('/api/books', { method: 'POST', cookie, body: {
    id: legacyBook.id, registrationId: crypto.randomUUID(), baseRevision: state.catalog.books[0].revision ?? null, ...extra,
  } });
  for (const invalid of [{ pageJumpEnabled: '0' }, { resumeReadingEnabled: 1 }, { caseColor: 'red' }, { paperColor: '#fff' }, { mockupView: 'constructor' }]) {
    assert.equal((await edit(invalid)).status, 400);
  }
  const options = { mockupView: 'edge', pageJumpEnabled: false, resumeReadingEnabled: false, caseColor: '#663311', paperColor: '#ffeeaa' };
  assert.equal((await edit(options)).status, 200);
  assert.equal((await edit({ title: '목업 수정' })).status, 200);
  for (const [key, value] of Object.entries(options)) assert.equal(state.catalog.books[0][key], value);
  assert.equal((await edit({ resumeReadingEnabled: true, caseColor: null, paperColor: null })).status, 200);
  assert.equal(state.catalog.books[0].caseColor, undefined);
  assert.equal(state.catalog.books[0].paperColor, undefined);
  assert.equal(state.catalog.books[0].resumeReadingEnabled, true);
  assert.equal(state.catalog.books[0].pageJumpEnabled, false);
  assert.deepEqual(state.catalog.books[0].pages, legacyBook.pages);
  assert.deepEqual(state.catalog.books[0].coverImages, legacyBook.coverImages);
});

test('book finishing settings survive partial updates and can be reset without uploading files', async t => {
  const state = repository(t, { books: [legacyBook] }, assetPaths(legacyBook));
  const cookie = await session();
  const edit = extra => request('/api/books', { method: 'POST', cookie, body: {
    id: legacyBook.id, registrationId: crypto.randomUUID(), baseRevision: state.catalog.books[0].revision ?? null, ...extra,
  } });
  const options = { spineShape: 'round', boardThicknessMm: 2.5, stapleCount: 4, ribbonEnabled: true,
    headbandEnabled: true, ribbonColor: '#cc6677', ribbonMaterial: 'cotton', coverGloss: 70 };
  assert.equal((await edit({ bindingType: 'hardcover', mockupDetails: options })).status, 200);
  for (const invalid of [{ coverGloss: 101 }, { threadColor: 'red' }, { stapleCount: 3.2 }, { ribbonEnabled: 1 },
    { sewingStationCount: 0 }, { sewingStationCount: 13 }, { sewingStationCount: 2.5 },
    { ribbonMaterial: 'silk ' }, { spineShape: 'constructor' }, { unrecognized: 4 }, [], '3']) {
    assert.equal((await edit({ mockupDetails: invalid })).status, 400);
    assert.deepEqual(state.catalog.books[0].mockupDetails, options);
  }
  assert.equal((await edit({ mockupDetails: { boardThicknessMm: null, ribbonColor: '#BB4466' } })).status, 200);
  const expected = { ...options, ribbonColor: '#bb4466' };
  delete expected.boardThicknessMm;
  assert.equal((await edit({ bindingType: 'saddle-stitch' })).status, 200);
  assert.deepEqual(state.catalog.books[0].mockupDetails, expected);
  assert.equal((await edit({ bindingType: 'exposed-sewn', mockupDetails: { sewingStationCount: 7 } })).status, 200);
  assert.deepEqual(state.catalog.books[0].mockupDetails, { ...expected, sewingStationCount: 7 });
  assert.equal((await edit({ mockupDetails: { sewingStationCount: 5 } })).status, 200);
  assert.deepEqual(state.catalog.books[0].mockupDetails, expected);
  assert.equal((await edit({ bindingType: 'hardcover', mockupDetails: { ribbonEnabled: false } })).status, 200);
  assert.equal(state.catalog.books[0].mockupDetails.ribbonMaterial, 'cotton');
  assert.equal((await edit({ mockupDetails: { ribbonEnabled: true, ribbonMaterial: 'silk' } })).status, 200);
  delete expected.ribbonMaterial;
  assert.deepEqual(state.catalog.books[0].mockupDetails, expected);
  assert.equal((await edit({ mockupDetails: null })).status, 200);
  assert.equal(Object.hasOwn(state.catalog.books[0], 'mockupDetails'), false);
  assert.deepEqual(state.catalog.books[0].pages, legacyBook.pages);
  assert.deepEqual(state.catalog.books[0].coverImages, legacyBook.coverImages);
});

test('legacy book edits preserve omitted data, remove owned obsolete files, reject stale revisions and replay safely', async t => {
  const orphan = 'dist/assets/books/legacy/old-orphan.png';
  const unrelated = 'dist/assets/projects/elsewhere/image.webp';
  const state = repository(t, { books: [legacyBook], demo: true, customRoot: 'kept' },
    [...assetPaths(legacyBook), orphan, unrelated]);
  const cookie = await session();
  const firstCatalog = await (await request('/api/catalog', { cookie })).json();
  assert.deepEqual(firstCatalog.order, ['legacy']);
  assert.deepEqual(firstCatalog.projects, []);
  const data = {
    id: 'legacy', baseRevision: null, registrationId: crypto.randomUUID(),
    title: '수정한 책', published: false, assets: { back: null },
  };
  const response = await request('/api/books', { method: 'POST', cookie, body: data });
  assert.equal(response.status, 200);
  const { book } = await response.json();
  assert.equal(book.published, false);
  assert.equal(book.year, '2025');
  assert.equal(book.customField, 'preserved');
  assert.deepEqual(book.pages, legacyBook.pages);
  assert.deepEqual(book.coverImages, { front: legacyBook.coverImages.front });
  assert.deepEqual(book.trimSizeMm, legacyBook.trimSizeMm);
  assert.equal(book.spineWidthMm, 10);
  assert.equal(book.bindingType, 'paperback');
  assert.equal(state.catalog.demo, false);
  assert.equal(state.catalog.customRoot, 'kept');
  assert.equal(state.files.has(orphan), false);
  assert.equal(state.files.has('dist/' + legacyBook.coverImages.back), false);
  assert.equal(state.files.has(unrelated), true);
  assert.equal(state.files.has('dist/' + legacyBook.coverImages.front), true);
  const writes = state.trees.length;
  const replay = await request('/api/books', { method: 'POST', cookie, body: data });
  assert.deepEqual((await replay.json()).book, book);
  assert.equal(state.trees.length, writes);
  const stale = await request('/api/books', {
    method: 'POST', cookie, body: { ...data, registrationId: crypto.randomUUID() },
  });
  assert.equal(stale.status, 409);
  assert.equal(state.trees.length, writes);
  const replaced = await request('/api/books', {
    method: 'POST', cookie, body: { id: book.id, baseRevision: book.revision, assets: { front: imageFile } },
  });
  assert.equal(replaced.status, 200);
  assert.equal(state.files.has('dist/' + legacyBook.coverImages.front), false);
  assert.equal(state.files.has('dist/' + (await replaced.json()).book.coverImages.front), true);
});

test('projects support image reorder, replacement, private preview, ordering and complete deletion', async t => {
  const state = repository(t, { books: [legacyBook] }, assetPaths(legacyBook));
  const cookie = await session();
  const create = await request('/api/projects', {
    method: 'POST', cookie, body: {
      registrationId: crypto.randomUUID(), title: '전시', category: '디자인', description: '프로젝트 설명',
      year: '2026', published: false, assets: { images: [imageFile, { ...imageFile, alt: '두 번째 이미지' }] },
    },
  });
  assert.equal(create.status, 201);
  const { project } = await create.json();
  assert.equal(project.published, false);
  assert.deepEqual(project.description, ['프로젝트 설명']);
  assert.equal(project.year, '2026');
  assert.equal(project.images[1].alt, '두 번째 이미지');
  assert.deepEqual(state.catalog.order, ['legacy', project.id]);
  const preview = await request('/api/preview?path=' + encodeURIComponent(project.images[0].imageSrc), { cookie });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('Content-Type'), 'image/webp');
  assert.equal(preview.headers.get('Cache-Control'), 'no-store');
  assert.equal((await request('/api/preview?path=' + encodeURIComponent(project.images[0].imageSrc))).status, 401);
  assert.equal((await request('/api/preview?path=assets/books/other/private.png', { cookie })).status, 404);
  const editData = { id: project.id, baseRevision: project.revision, registrationId: crypto.randomUUID() };
  const foreign = await request('/api/projects', { method: 'POST', cookie, body: {
    ...editData, assets: { images: [{ imageSrc: legacyBook.coverImages.front }] },
  } });
  assert.equal(foreign.status, 400);
  const edit = await request('/api/projects', { method: 'POST', cookie, body: {
    ...editData, assets: { images: [{ imageSrc: project.images[1].imageSrc }, imageFile] },
  } });
  assert.equal(edit.status, 200);
  const updated = (await edit.json()).project;
  assert.equal(updated.images[0].imageSrc, project.images[1].imageSrc);
  assert.equal(updated.images[0].alt, '두 번째 이미지');
  assert.equal(state.files.has('dist/' + project.images[0].imageSrc), false);
  assert.equal(state.files.has('dist/' + project.images[1].imageSrc), true);
  assert.equal((await request('/api/order', { method: 'POST', cookie, body: { order: [project.id] } })).status, 409);
  const ordered = await request('/api/order', { method: 'POST', cookie, body: { order: [project.id, 'legacy'] } });
  assert.equal(ordered.status, 200);
  assert.deepEqual(state.catalog.order, [project.id, 'legacy']);
  assert.equal((await request('/api/delete', { method: 'POST', cookie, body: {
    id: project.id, kind: 'project', baseRevision: project.revision,
  } })).status, 409);
  const deletion = await request('/api/delete', { method: 'POST', cookie, body: {
    id: project.id, kind: 'project', baseRevision: updated.revision,
  } });
  assert.equal(deletion.status, 200);
  assert.deepEqual(state.catalog.projects, []);
  assert.deepEqual(state.catalog.order, ['legacy']);
  assert.equal([...state.files].some(path => path.startsWith('dist/assets/projects/' + project.id + '/')), false);
  const lastDelete = await request('/api/delete', { method: 'POST', cookie, body: { id: 'legacy', kind: 'book', baseRevision: null } });
  assert.equal(lastDelete.status, 200);
  assert.deepEqual(state.catalog.books, []);
  assert.deepEqual(state.catalog.order, []);
  assert.equal(state.catalog.demo, false);
});

test('concurrent order changes fail with a conflict and preserve the other editor order', async t => {
  const second = { ...legacyBook, id: 'second' };
  const third = { ...legacyBook, id: 'third' };
  const state = repository(t, { books: [legacyBook, second, third], order: ['legacy', 'second', 'third'] });
  state.beforeUpdate = value => {
    value.head = 'remote-head';
    value.catalog.order = ['third', 'legacy', 'second'];
  };
  const cookie = await session();
  const response = await request('/api/order', {
    method: 'POST', cookie, body: { order: ['second', 'third', 'legacy'] },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(state.catalog.order, ['third', 'legacy', 'second']);
  assert.equal(state.trees.length, 1);
});

test('catalog capacity rejects writes before any Git tree creation', async t => {
  const crowded = { id: 'crowded', title: '기존 작품', images: Array.from({ length: 19000 }, () => ({ imageSrc: 'assets/projects/crowded/image.webp' })) };
  const state = repository(t, { books: [], projects: [crowded] });
  const cookie = await session();
  const response = await request('/api/projects', { method: 'POST', cookie, body: { title: '추가 작품', assets: { images: [imageFile] } } });
  assert.equal(response.status, 400);
  assert.equal(state.trees.length, 0);
});

test('GitHub secondary rate limits expose retry timing while permission errors remain distinct', async t => {
  const cookie = await session();
  for (const scenario of [
    { status: 403, message: 'You have exceeded a secondary rate limit.', headers: { 'Retry-After': '75' }, expected: 429, retryAfter: 75 },
    { status: 429, message: 'Too many requests', headers: {}, expected: 429, retryAfter: 60 },
    { status: 403, message: 'Resource not accessible by personal access token', headers: {}, expected: 502 },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ message: scenario.message }, {
      status: scenario.status, headers: scenario.headers,
    }));
    const response = await request('/api/catalog', { cookie });
    assert.equal(response.status, scenario.expected);
    const data = await response.json();
    assert.equal(data.retryAfter, scenario.retryAfter);
    assert.equal(response.headers.get('Retry-After'), scenario.retryAfter ? String(scenario.retryAfter) : null);
  }
});

test('site settings preserve blank defaults, validate contact URLs, replay revisions and clean replaced About images', async t => {
  const state = repository(t, { books: [], projects: [], demo: true });
  const cookie = await session();
  const initial = await (await request('/api/catalog', { cookie })).json();
  assert.deepEqual(initial.site, {
    title: DEFAULT_SITE_TITLE, about: { heading: '', text: '' }, contact: { text: '', email: '', links: [] }, revision: null,
    projectTags: STOCK_PROJECT_TAGS,
  });
  const registrationId = crypto.randomUUID();
  const data = {
    registrationId, baseRevision: null, title: '작업실',
    about: { heading: '소개', text: '기록과 디자인' },
    contact: { text: '함께 작업하기', email: 'mailto:hello@example.com', links: [{ label: '웹사이트', url: 'https://example.com' }] },
    assets: { about: imageFile },
  };
  const response = await request('/api/site', { method: 'POST', cookie, body: data });
  assert.equal(response.status, 200);
  const { site } = await response.json();
  assert.equal(site.contact.email, 'hello@example.com');
  assert.deepEqual(site.contact.links, [{ label: '웹사이트', url: 'https://example.com/' }]);
  assert.equal(site.about.imageSrc, 'assets/site/' + registrationId + '/about.webp');
  assert.equal(state.files.has('dist/' + site.about.imageSrc), true);
  assert.equal(state.catalog.demo, false);
  assert.equal((await request('/api/preview?path=' + encodeURIComponent(site.about.imageSrc), { cookie })).status, 200);
  const commits = state.commitCount;
  const replay = await request('/api/site', { method: 'POST', cookie, body: data });
  assert.deepEqual((await replay.json()).site, site);
  assert.equal(state.commitCount, commits);
  assert.equal((await request('/api/site', { method: 'POST', cookie, body: { ...data, registrationId: crypto.randomUUID() } })).status, 409);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/', 'https://example.com/\n']) {
    const rejected = await request('/api/site', { method: 'POST', cookie, body: {
      baseRevision: site.revision, contact: { links: [{ label: '주소', url }] },
    } });
    assert.equal(rejected.status, 400, url);
  }
  for (const email of ['hello@example.com?subject=injected', 'hello%0d%0a@example.com', 'hello@example.com\nBcc:another@example.com']) {
    assert.equal((await request('/api/site', { method: 'POST', cookie, body: {
      baseRevision: site.revision, contact: { email },
    } })).status, 400);
  }
  assert.equal(state.commitCount, commits);
  const orphan = 'dist/assets/site/old-about/orphan.png';
  state.files.add(orphan);
  const replaced = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: site.revision, assets: { about: { ...imageFile, ext: 'png' } },
  } });
  const updated = (await replaced.json()).site;
  assert.equal(updated.title, site.title);
  assert.deepEqual(updated.contact, site.contact);
  assert.equal(state.files.has('dist/' + site.about.imageSrc), false);
  assert.equal(state.files.has(orphan), false);
  assert.equal(state.files.has('dist/' + updated.about.imageSrc), true);
  const removed = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: updated.revision, assets: { about: null }, about: { heading: '', text: '' },
  } });
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).site.about, { heading: '', text: '' });
  assert.equal([...state.files].some(path => path.startsWith('dist/assets/site/')), false);
});

test('book gallery edits preserve alt and omitted images, reject foreign paths and remove cleared assets', async t => {
  const book = {
    ...legacyBook,
    galleryImages: [
      { imageSrc: 'assets/books/legacy/gallery-0001.webp', alt: '첫 작업 이미지' },
      { imageSrc: 'assets/books/legacy/gallery-0002.webp', alt: '두 번째 작업 이미지' },
    ],
  };
  const state = repository(t, { books: [book] }, [...assetPaths(book), ...book.galleryImages.map(image => 'dist/' + image.imageSrc)]);
  const cookie = await session();
  const foreign = await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: null, assets: { galleryImages: [{ imageSrc: book.coverImages.front }] },
  } });
  assert.equal(foreign.status, 400);
  assert.equal((await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: null, assets: { galleryImages: [null] },
  } })).status, 400);
  const data = {
    id: book.id, baseRevision: null, registrationId: crypto.randomUUID(),
    assets: { galleryImages: [{ imageSrc: './' + book.galleryImages[1].imageSrc }, { ...imageFile, alt: '새 작업 이미지' }] },
  };
  const saved = await request('/api/books', { method: 'POST', cookie, body: data });
  assert.equal(saved.status, 200);
  const updated = (await saved.json()).book;
  assert.deepEqual(updated.galleryImages[0], book.galleryImages[1]);
  assert.equal(updated.galleryImages[1].alt, '새 작업 이미지');
  assert.equal(state.files.has('dist/' + book.galleryImages[0].imageSrc), false);
  assert.equal(state.files.has('dist/' + book.galleryImages[1].imageSrc), true);
  assert.deepEqual(updated.pages, book.pages);
  assert.deepEqual(updated.coverImages, book.coverImages);
  const replay = await request('/api/books', { method: 'POST', cookie, body: data });
  assert.deepEqual((await replay.json()).book, updated);
  const renamed = await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: updated.revision, title: '새 제목',
  } });
  const renamedBook = (await renamed.json()).book;
  assert.deepEqual(renamedBook.galleryImages, updated.galleryImages);
  const cleared = await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: renamedBook.revision, assets: { galleryImages: null },
  } });
  assert.deepEqual((await cleared.json()).book.galleryImages, []);
  assert.equal(state.files.has('dist/' + book.coverImages.front), true);
  for (const image of updated.galleryImages) assert.equal(state.files.has('dist/' + image.imageSrc), false);
});

test('baseOrder rejects stale clients while a successful order replay remains idempotent', async t => {
  const second = { ...legacyBook, id: 'second' };
  const third = { ...legacyBook, id: 'third' };
  const state = repository(t, { books: [legacyBook, second, third], order: ['legacy', 'second', 'third'] });
  const cookie = await session();
  const data = { order: ['second', 'third', 'legacy'], baseOrder: ['legacy', 'second', 'third'] };
  assert.equal((await request('/api/order', { method: 'POST', cookie, body: data })).status, 200);
  assert.equal((await request('/api/order', { method: 'POST', cookie, body: data })).status, 200);
  assert.equal(state.commitCount, 1);
  const conflict = await request('/api/order', { method: 'POST', cookie, body: {
    order: ['third', 'legacy', 'second'], baseOrder: ['legacy', 'second', 'third'],
  } });
  assert.equal(conflict.status, 409);
  assert.deepEqual(state.catalog.order, data.order);
  assert.equal(state.commitCount, 1);
});

test('admin modules, method restrictions and nested input validation keep protected actions gated', async t => {
  repository(t, { books: [legacyBook] }, assetPaths(legacyBook));
  for (const path of ['/site-settings.js', '/draft-store.js', '/upload-request.js', '/image-encoding.js', '/pdf-layout.js', '/admin.js', '/vendor/pdfjs/pdf.mjs']) {
    assert.equal((await request(path)).status, 401);
  }
  const cookie = await session();
  assert.equal(await (await request('/site-settings.js', { cookie })).text(), '/site-settings.js');
  assert.equal(await (await request('/image-encoding.js', { cookie })).text(), '/image-encoding.js');
  assert.equal(await (await request('/pdf-layout.js', { cookie })).text(), '/pdf-layout.js');
  const badMethod = await request('/api/site', { method: 'PUT', cookie });
  assert.equal(badMethod.status, 405);
  assert.equal(badMethod.headers.get('Allow'), 'POST');
  assert.equal(badMethod.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(badMethod.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal((await request('/api/site', { method: 'POST', cookie, headerOrigin: null, body: {} })).status, 403);
  for (const body of [{ about: null }, { contact: [] }, { contact: { links: [null] } }, { assets: null }]) {
    assert.equal((await request('/api/site', { method: 'POST', cookie, body })).status, 400);
  }
  assert.equal((await request('/api/projects', { method: 'POST', cookie, body: {
    title: '프로젝트', assets: { images: [null] },
  } })).status, 400);
});

test('book and project English translations create, retain, clear and replay without changing Korean data', async t => {
  const book = {
    ...legacyBook,
    translations: { fr: { title: 'Livre' }, en: { title: 'Original book', category: 'Photo', description: ['Original description'], language: 'Korean', legacyField: 'kept' } },
  };
  const state = repository(t, { books: [book] }, assetPaths(book));
  const cookie = await session();
  const creationData = {
    registrationId: crypto.randomUUID(), title: '프로젝트', category: '편집', description: '한국어 소개',
    translations: { en: { title: 'Project', category: 'Editorial', description: 'English introduction' } },
    assets: { images: [imageFile] },
  };
  const creation = await request('/api/projects', { method: 'POST', cookie, body: creationData });
  assert.equal(creation.status, 201);
  const project = (await creation.json()).project;
  assert.equal(project.title, '프로젝트');
  assert.deepEqual(project.description, ['한국어 소개']);
  assert.deepEqual(project.translations.en, { title: 'Project', category: 'Editorial', description: ['English introduction'] });
  const replay = await request('/api/projects', { method: 'POST', cookie, body: creationData });
  assert.deepEqual((await replay.json()).project, project);
  const omitted = await request('/api/projects', { method: 'POST', cookie, body: {
    id: project.id, baseRevision: project.revision, title: '새 한국어 제목',
  } });
  const preserved = (await omitted.json()).project;
  assert.deepEqual(preserved.translations, project.translations);
  assert.equal(preserved.title, '새 한국어 제목');
  const cleared = await request('/api/projects', { method: 'POST', cookie, body: {
    id: project.id, baseRevision: preserved.revision,
    translations: { en: { title: '', category: '', description: '' } },
  } });
  assert.deepEqual((await cleared.json()).project.translations.en, { title: '', category: '', description: [''] });
  const bookData = {
    id: book.id, baseRevision: null, registrationId: crypto.randomUUID(),
    translations: { en: { title: 'Updated English title', description: '', language: '' } },
  };
  const savedBook = await request('/api/books', { method: 'POST', cookie, body: bookData });
  assert.equal(savedBook.status, 200);
  const updated = (await savedBook.json()).book;
  assert.equal(updated.title, legacyBook.title);
  assert.deepEqual(updated.description, legacyBook.description);
  assert.deepEqual(updated.translations.fr, book.translations.fr);
  assert.deepEqual(updated.translations.en, {
    title: 'Updated English title', category: 'Photo', description: [''], language: '', legacyField: 'kept',
  });
  const trees = state.trees.length;
  const bookReplay = await request('/api/books', { method: 'POST', cookie, body: bookData });
  assert.deepEqual((await bookReplay.json()).book, updated);
  assert.equal(state.trees.length, trees);
});

test('site English content has separate text fields with shared contact details and About image', async t => {
  const state = repository(t, { books: [] });
  const cookie = await session();
  const data = {
    registrationId: crypto.randomUUID(), baseRevision: null, title: '작업실',
    about: { heading: '소개', text: '한글 소개' },
    contact: { text: '한글 연락 안내', email: 'hello@example.com', links: [{ label: 'Instagram', url: 'https://instagram.com/example/' }] },
    translations: { en: { title: 'Studio', about: { heading: 'About', text: 'English introduction' }, contact: { text: 'Get in touch' } } },
    assets: { about: imageFile },
  };
  const saved = await request('/api/site', { method: 'POST', cookie, body: data });
  assert.equal(saved.status, 200);
  const site = (await saved.json()).site;
  assert.deepEqual(site.translations.en, data.translations.en);
  const englishOnly = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: site.revision, translations: { en: { about: { text: '' }, contact: { text: 'Contact me' } } },
  } });
  const updated = (await englishOnly.json()).site;
  assert.deepEqual(updated.about, site.about);
  assert.deepEqual(updated.contact, site.contact);
  assert.equal(updated.translations.en.about.heading, 'About');
  assert.equal(updated.translations.en.about.text, '');
  assert.equal(updated.translations.en.contact.text, 'Contact me');
  assert.equal(updated.translations.en.title, 'Studio');
  const koreanOnly = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: updated.revision, about: { text: '수정한 한글 소개' },
  } });
  const finalSite = (await koreanOnly.json()).site;
  assert.deepEqual(finalSite.translations, updated.translations);
  assert.equal(finalSite.about.imageSrc, site.about.imageSrc);
  assert.equal(finalSite.contact.email, site.contact.email);
  assert.equal(state.files.has('dist/' + site.about.imageSrc), true);
});

test('malformed English translation fields return validation errors without creating commits', async t => {
  const state = repository(t, { books: [legacyBook] }, assetPaths(legacyBook));
  const cookie = await session();
  for (const translations of [null, [], { en: null }, { en: [] }, { en: { title: 123 } },
    { en: { category: null } }, { en: { description: ['unexpected array'] } }, { en: { language: false } },
    { en: { title: 'x'.repeat(161) } }]) {
    const response = await request('/api/books', { method: 'POST', cookie, body: { id: 'legacy', baseRevision: null, translations } });
    assert.equal(response.status, 400, JSON.stringify(translations));
  }
  for (const translations of [null, { en: { about: null } }, { en: { about: { text: [] } } },
    { en: { contact: [] } }, { en: { contact: { text: 5 } } }]) {
    const response = await request('/api/site', { method: 'POST', cookie, body: { baseRevision: null, translations } });
    assert.equal(response.status, 400, JSON.stringify(translations));
  }
  assert.equal(state.commitCount, 0);
});

test('taxonomy labels and order persist while legacy books default to Book and in-use removals are rejected', async t => {
  const state = repository(t, { books: [legacyBook] }, assetPaths(legacyBook));
  const cookie = await session();
  const initial = await (await request('/api/catalog', { cookie })).json();
  assert.deepEqual(initial.site.projectTags, STOCK_PROJECT_TAGS);
  const created = await request('/api/projects', { method: 'POST', cookie, body: {
    title: '복합 작업', year: '2024', tagIds: ['poster', 'web'], assets: { images: [imageFile] },
  } });
  const project = (await created.json()).project;
  assert.equal(project.year, '2024');
  assert.deepEqual(project.tagIds, ['poster', 'web']);
  const customTag = { id: 'tag-' + crypto.randomUUID(), ko: '실험', en: 'Experiment' };
  const tags = [customTag, ...STOCK_PROJECT_TAGS.slice().reverse().map(tag => tag.id === 'poster' ? { ...tag, ko: '포스터 작업', en: 'Poster work' } : tag)];
  const saved = await request('/api/site', { method: 'POST', cookie, body: { baseRevision: null, projectTags: tags } });
  assert.equal(saved.status, 200);
  const site = (await saved.json()).site;
  assert.deepEqual(site.projectTags, tags);
  const before = state.commitCount;
  for (const id of ['book', 'poster', 'web']) {
    const rejected = await request('/api/site', { method: 'POST', cookie, body: {
      baseRevision: site.revision, projectTags: tags.filter(tag => tag.id !== id),
    } });
    assert.equal(rejected.status, 409, id);
    assert.equal((await rejected.json()).code, 'TAG_IN_USE');
  }
  assert.equal(state.commitCount, before);
  const renamedBook = await request('/api/books', { method: 'POST', cookie, body: { id: 'legacy', baseRevision: null, title: '수정한 책' } });
  const book = (await renamedBook.json()).book;
  assert.deepEqual(book.tagIds, ['book']);
  const clearBook = await request('/api/books', { method: 'POST', cookie, body: {
    id: 'legacy', baseRevision: book.revision, tagIds: [],
  } });
  assert.deepEqual((await clearBook.json()).book.tagIds, []);
  const removeUnused = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: site.revision, projectTags: tags.filter(tag => !['book', 'logo'].includes(tag.id)),
  } });
  assert.equal(removeUnused.status, 200);
  assert.equal((await removeUnused.json()).site.projectTags.some(tag => tag.id === 'book'), false);
  const newBook = await request('/api/books', { method: 'POST', cookie, body: {
    title: '새 책', coverRatio: 0.7, pageRatio: 0.7, assets: { front: imageFile, pages: [imageFile] },
  } });
  assert.deepEqual((await newBook.json()).book.tagIds, []);
  const retained = await request('/api/projects', { method: 'POST', cookie, body: {
    id: project.id, baseRevision: project.revision, description: '내용 수정',
  } });
  assert.deepEqual((await retained.json()).project.tagIds, ['poster', 'web']);
});

test('taxonomy and work tag inputs reject malformed, duplicate and unknown ids', async t => {
  const state = repository(t, { books: [] });
  const cookie = await session();
  for (const projectTags of [null, {}, [{ id: 'invalid/dir', ko: '분류', en: 'Tag' }],
    [{ id: 'tag', ko: '', en: 'Tag' }], [{ id: 'tag', ko: '분류', en: 5 }],
    [{ id: 'tag', ko: '분류', en: 'Tag' }, { id: 'tag', ko: '중복', en: 'Duplicate' }]]) {
    assert.equal((await request('/api/site', { method: 'POST', cookie, body: { baseRevision: null, projectTags } })).status, 400);
  }
  for (const tagIds of [null, {}, ['missing'], ['poster', 'poster'], [123]]) {
    const response = await request('/api/projects', { method: 'POST', cookie, body: {
      title: '작업', assets: { images: [imageFile] }, tagIds,
    } });
    assert.equal(response.status, 400, JSON.stringify(tagIds));
  }
  assert.equal(state.commitCount, 0);
});

test('tag removal rechecks work usage after a concurrent GitHub commit', async t => {
  const state = repository(t, { books: [] });
  const cookie = await session();
  state.beforeUpdate = value => {
    value.head = 'remote-work-head';
    value.catalog.projects = [{ id: 'concurrent-work', title: '동시 등록', tagIds: ['poster'], images: [] }];
  };
  const response = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: null, projectTags: STOCK_PROJECT_TAGS.filter(tag => tag.id !== 'poster'),
  } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'TAG_IN_USE');
  assert.equal(state.catalog.site?.projectTags, undefined);
  assert.equal(state.catalog.projects[0].id, 'concurrent-work');
  assert.equal(state.trees.length, 1);
});

test('work saving rechecks selected tags after concurrent taxonomy removal', async t => {
  const state = repository(t, { books: [] });
  const cookie = await session();
  state.beforeUpdate = value => {
    value.head = 'remote-taxonomy-head';
    value.catalog.site = { projectTags: STOCK_PROJECT_TAGS.filter(tag => tag.id !== 'poster') };
  };
  const response = await request('/api/projects', { method: 'POST', cookie, body: {
    title: '포스터', assets: { images: [imageFile] }, tagIds: ['poster'],
  } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'UNKNOWN_TAG');
  assert.equal(state.catalog.projects, undefined);
  assert.equal(state.trees.length, 1);
});

test('project image ratios validate on save and remain when retained without a new ratio', async t => {
  const state = repository(t, { books: [] });
  const cookie = await session();
  const created = await request('/api/projects', { method: 'POST', cookie, body: {
    title: '사진', assets: { images: [{ ...imageFile, ratio: 1.5 }] },
  } });
  assert.equal(created.status, 201);
  const project = (await created.json()).project;
  assert.equal(project.images[0].ratio, 1.5);
  const retained = await request('/api/projects', { method: 'POST', cookie, body: {
    id: project.id, baseRevision: project.revision, assets: { images: [{ imageSrc: project.images[0].imageSrc }] },
  } });
  const updated = (await retained.json()).project;
  assert.equal(updated.images[0].ratio, 1.5);
  const commits = state.commitCount;
  for (const ratio of [0, -1, 0.000001, 20000, '1', null]) {
    assert.equal((await request('/api/projects', { method: 'POST', cookie, body: {
      id: project.id, baseRevision: updated.revision, assets: { images: [{ imageSrc: updated.images[0].imageSrc, ratio }] },
    } })).status, 400);
  }
  assert.equal(state.commitCount, commits);
});

test('native and fallback base64 uploads preserve binary bytes in generated JSON', async t => {
  const bytes = new Uint8Array(24 + 256);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 64, 0, 0, 0, 64]);
  bytes.set(Uint8Array.from({ length: 256 }, (_, index) => index), 24);
  let calls = 0;
  mockGitHub(t, ({ path, body }) => {
    assert.equal(path, '/git/blobs');
    assert.equal(body.encoding, 'base64');
    assert.deepEqual(Buffer.from(body.content, 'base64'), Buffer.from(bytes));
    calls += 1;
    return Response.json({ sha: '1'.repeat(40) });
  });
  const cookie = await session();
  const fallback = await request('/api/assets', { method: 'POST', cookie, body: bytes, headers: { 'Content-Type': 'image/png' } });
  assert.equal(fallback.status, 201);
  let nativeCalls = 0;
  const previous = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    configurable: true,
    value() {
      nativeCalls += 1;
      return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64');
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(Uint8Array.prototype, 'toBase64', previous);
    else delete Uint8Array.prototype.toBase64;
  });
  const native = await request('/api/assets', { method: 'POST', cookie, body: bytes, headers: { 'Content-Type': 'image/png' } });
  assert.equal(native.status, 201);
  assert.equal(nativeCalls, 1);
  assert.equal(calls, 2);
});

test('project thumbnails persist, replay, preview and clear when the first image changes', async t => {
  const state = repository(t, { books: [] });
  const cookie = await session();
  const data = {
    registrationId: crypto.randomUUID(), title: '작업', assets: {
      images: [imageFile, { ...imageFile, sha: '2'.repeat(40) }],
      thumbnail: { sha: '3'.repeat(40), ext: 'webp' },
    },
  };
  const created = await request('/api/projects', { method: 'POST', cookie, body: data });
  assert.equal(created.status, 201);
  const project = (await created.json()).project;
  assert.equal(project.thumbnailSrc, 'assets/projects/' + project.id + '/thumbnail.webp');
  assert.equal(state.files.has('dist/' + project.thumbnailSrc), true);
  const before = state.commitCount;
  const replay = await request('/api/projects', { method: 'POST', cookie, body: data });
  assert.deepEqual((await replay.json()).project, project);
  assert.equal(state.commitCount, before);
  assert.equal((await request('/api/preview?path=' + encodeURIComponent(project.thumbnailSrc), { cookie })).status, 200);
  const metadataOnly = await request('/api/projects', { method: 'POST', cookie, body: {
    id: project.id, baseRevision: project.revision, title: '제목 수정', assets: { images: project.images },
  } });
  const retained = (await metadataOnly.json()).project;
  assert.equal(retained.thumbnailSrc, project.thumbnailSrc);
  const reordered = await request('/api/projects', { method: 'POST', cookie, body: {
    id: project.id, baseRevision: retained.revision, assets: { images: [project.images[1], project.images[0]] },
  } });
  const changed = (await reordered.json()).project;
  assert.equal(changed.thumbnailSrc, undefined);
  assert.equal(changed.images[0].imageSrc, project.images[1].imageSrc);
  assert.equal(state.files.has('dist/' + project.thumbnailSrc), false);
  const duplicate = await request('/api/projects', { method: 'POST', cookie, body: {
    id: project.id, baseRevision: changed.revision, assets: { images: [imageFile], thumbnail: imageFile },
  } });
  const deduplicated = (await duplicate.json()).project;
  assert.equal(deduplicated.thumbnailSrc, undefined);
  assert.equal(state.trees.at(-1).filter(entry => entry.path.includes('thumbnail')).length, 0);
});

test('book thumbnails follow cover replacements and optional clears without changing original interiors', async t => {
  const book = { ...legacyBook, thumbnailSrc: 'assets/books/legacy/thumbnail.webp' };
  const state = repository(t, { books: [book] }, assetPaths(book));
  const cookie = await session();
  const modified = await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: null, assets: { front: imageFile },
  } });
  const changed = (await modified.json()).book;
  assert.equal(changed.thumbnailSrc, undefined);
  assert.equal(state.files.has('dist/' + book.thumbnailSrc), false);
  assert.deepEqual(changed.pages, book.pages);
  const added = await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: changed.revision, assets: { thumbnail: { sha: '2'.repeat(40), ext: 'webp' } },
  } });
  const withThumbnail = (await added.json()).book;
  assert.equal(state.files.has('dist/' + withThumbnail.thumbnailSrc), true);
  const cleared = await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: withThumbnail.revision, assets: { thumbnail: null },
  } });
  const withoutThumbnail = (await cleared.json()).book;
  assert.equal(withoutThumbnail.thumbnailSrc, undefined);
  assert.equal(state.files.has('dist/' + withThumbnail.thumbnailSrc), false);
  assert.deepEqual(withoutThumbnail.pages, book.pages);
  const commits = state.commitCount;
  const malformed = await request('/api/books', { method: 'POST', cookie, body: {
    id: book.id, baseRevision: withoutThumbnail.revision, assets: { thumbnail: { imageSrc: book.coverImages.front } },
  } });
  assert.equal(malformed.status, 400);
  assert.equal(state.commitCount, commits);
});

test('thumbnail references count toward the total image limit', async t => {
  const crowded = { id: 'crowded', title: '기존 작업', images: Array.from({ length: 18999 }, () => ({ imageSrc: 'assets/projects/crowded/image.webp' })) };
  const state = repository(t, { books: [], projects: [crowded] });
  const cookie = await session();
  const response = await request('/api/projects', { method: 'POST', cookie, body: {
    title: '추가 작업', assets: { images: [imageFile], thumbnail: { sha: '2'.repeat(40), ext: 'webp' } },
  } });
  assert.equal(response.status, 400);
  assert.equal(state.trees.length, 0);
});

test('GitHub environment values normalize surrounding whitespace and keep the fixed API origin', async t => {
  const cookie = await session();
  const calls = mockGitHub(t, ({ path, ref }) => {
    assert.equal(path, '/contents/dist/catalog.json');
    assert.equal(ref, 'folio/live');
    return Response.json({ books: [] });
  });
  const response = await request('/api/catalog', { cookie }, {
    ...env, FOLIO_STORAGE_MODE: ' single ', FOLIO_CONTENT_REPOSITORY: ' \n ', FOLIO_CONTENT_BRANCH: '',
    GITHUB_REPOSITORY: ' my-studio/folio-books ', GITHUB_BRANCH: ' folio/live ', GITHUB_TOKEN: '\nmock-token\r\n',
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test('invalid GitHub token header values fail before outgoing requests and never echo the value', async t => {
  const cookie = await session();
  let outgoing = 0;
  t.mock.method(globalThis, 'fetch', async () => { outgoing++; return Response.json({ books: [] }); });
  for (const token of [undefined, '', 'header-canary\nsecond-line', 'header-canary with-space', '한글-header-canary', 123]) {
    const response = await request('/api/catalog', { cookie }, { ...env, GITHUB_TOKEN: token });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'GITHUB_CONFIG');
    assert.equal(JSON.stringify(body).includes('header-canary'), false);
  }
  assert.equal(outgoing, 0);
});

test('GitHub redirects are never followed or parsed and cannot leak the token to another origin', async t => {
  const cookie = await session();
  let calls = 0;
  for (const status of [301, 302, 303, 304, 307, 308]) {
    const response = new Response(null, { status, headers: { Location: 'https://outside.invalid/secret-canary' } });
    t.mock.method(response, 'clone', () => { assert.fail('Redirect body must not be parsed'); });
    t.mock.method(globalThis, 'fetch', async (address, options) => {
      assert.equal(new URL(address).origin, 'https://api.github.com');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers['User-Agent'], 'HOHO-WORKS-Admin');
      calls++;
      return response;
    });
    const result = await request('/api/catalog', { cookie });
    assert.equal(result.status, 502);
    const body = await result.json();
    assert.equal(body.code, 'GITHUB_REDIRECT');
    assert.equal(JSON.stringify(body).includes('outside.invalid'), false);
    assert.equal(JSON.stringify(body).includes('mock-token'), false);
  }
  assert.equal(calls, 6);
});

test('GitHub failures distinguish credentials, permissions, missing resources, API versions and transport errors', async t => {
  const cookie = await session();
  for (const scenario of [
    { status: 401, message: 'Bad credentials mock-token', code: 'GITHUB_AUTH' },
    { status: 403, message: 'Resource not accessible by personal access token', code: 'GITHUB_PERMISSION' },
    { status: 403, message: 'A valid User-Agent header is required', code: 'GITHUB_HEADERS' },
    { status: 404, message: 'Not Found', code: 'GITHUB_NOT_FOUND' },
    { status: 400, message: 'Unsupported API version', code: 'GITHUB_VERSION' },
    { status: 410, message: 'API version is retired', code: 'GITHUB_VERSION' },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ message: scenario.message }, { status: scenario.status }));
    const response = await request('/api/catalog', { cookie });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, scenario.code);
    assert.equal(JSON.stringify(body).includes('mock-token'), false);
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('secret network mock-token'); });
  const response = await request('/api/catalog', { cookie });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'GITHUB_CONNECTION');
  assert.equal(JSON.stringify(body).includes('mock-token'), false);
});

test('starter site title migration is read-only and preserves revision checks and later explicit names', async t => {
  const initialRevision = 'e1edee23-0932-4b9a-8c67-9c803a4b2e93';
  const state = repository(t, { books: [], site: { title: 'HOHOHO', revision: initialRevision, lastMutationId: 'original-mutation' } });
  const cookie = await session();
  const read = await request('/api/catalog', { cookie });
  const site = (await read.json()).site;
  assert.equal(site.title, DEFAULT_SITE_TITLE);
  assert.equal(site.revision, initialRevision);
  assert.equal(site.lastMutationId, 'original-mutation');
  assert.equal(state.catalog.site.title, 'HOHOHO');
  assert.equal(state.commitCount, 0);
  const changed = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: initialRevision, contact: { text: '연락처 안내' },
  } });
  assert.equal(changed.status, 200);
  const updated = (await changed.json()).site;
  assert.equal(updated.title, DEFAULT_SITE_TITLE);
  assert.equal(state.catalog.site.title, DEFAULT_SITE_TITLE);
  const explicit = await request('/api/site', { method: 'POST', cookie, body: {
    baseRevision: updated.revision, title: 'HOHOHO',
  } });
  assert.equal(explicit.status, 200);
  const reread = await request('/api/catalog', { cookie });
  assert.equal((await reread.json()).site.title, 'HOHOHO');
});

test('video uploads preserve binary contents, validate type and reject oversize before storage', async t => {
  const cookie = await session();
  const sha = '7'.repeat(40);
  const mp4 = Uint8Array.from(Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex'));
  const webm = Uint8Array.from(Buffer.from('1a45dfa38b4282847765626d42858102', 'hex'));
  const received = [];
  const calls = mockGitHub(t, ({ path, body }) => {
    assert.equal(path, '/git/blobs');
    received.push(Buffer.from(body.content, 'base64'));
    return Response.json({ sha });
  });
  const upload = (type, bytes, headers = {}) => request('/api/assets', { method: 'POST', cookie, body: bytes, headers: { 'Content-Type': type, ...headers } });
  for (const [type, file] of [['mp4', mp4], ['webm', webm]]) {
    const result = await upload('video/' + type, file);
    assert.equal(result.status, 201);
    assert.deepEqual(await result.json(), { sha, ext: type });
    assert.deepEqual(received.at(-1), Buffer.from(file));
  }
  assert.equal((await upload('video/mp4', webm)).status, 415);
  assert.equal((await upload('video/webm', mp4)).status, 415);
  assert.equal((await upload('video/mp4', mp4, { 'Content-Length': String(MAX_PROJECT_VIDEO_BYTES + 1) })).status, 413);
  assert.equal(calls.length, 2);
});

test('a video at the Pages limit reaches GitHub intact and a larger video is rejected without a length header', async t => {
  assert.equal(MAX_PROJECT_VIDEO_BYTES, 25 * 1024 * 1024);
  const cookie = await session();
  const bytes = Buffer.alloc(MAX_PROJECT_VIDEO_BYTES + 1);
  Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex').copy(bytes);
  for (let offset = 65535; offset < bytes.length; offset += 65535) bytes[offset] = offset % 251;
  bytes[MAX_PROJECT_VIDEO_BYTES - 1] = 0xff;
  const video = bytes.subarray(0, MAX_PROJECT_VIDEO_BYTES);
  const calls = mockGitHub(t, ({ path, body }) => {
    assert.equal(path, '/git/blobs');
    assert.equal(body.encoding, 'base64');
    assert.deepEqual(Buffer.from(body.content, 'base64'), video);
    return Response.json({ sha: '7'.repeat(40) });
  });
  const upload = body => request('/api/assets', { method: 'POST', cookie, body, headers: { 'Content-Type': 'video/mp4' } });
  assert.equal((await upload(video)).status, 201);
  assert.equal((await upload(bytes)).status, 413);
  assert.equal(calls.length, 1);
});

test('mixed project media saves, reorders and safely removes files with revision checks and private video seeking', async t => {
  const state = repository(t, { books: [] });
  const cookie = await session();
  const save = data => request('/api/projects', { method: 'POST', cookie, body: data });
  const data = {
    title: '미디어', published: false, registrationId: crypto.randomUUID(),
    assets: { media: [
      { type: 'image', ...imageFile, alt: '처음' },
      { type: 'video', sha: '2'.repeat(40), ext: 'webm', ratio: 16/9 },
      { type: 'embed', url: 'https://example.org/frame?q=1', alt: '웹 페이지' },
      { type: 'image', ...imageFile, alt: '끝' },
    ] },
  };
  const created = await save(data);
  assert.equal(created.status, 201);
  const { project } = await created.json();
  const [first, video, embed, last] = project.media;
  assert.deepEqual(project.images.map(image => image.imageSrc), [first.imageSrc, last.imageSrc]);
  assert.equal(video.ratio, 16/9);
  assert.equal(state.files.size, 3);
  assert.deepEqual((await (await save(data)).json()).project, project);
  const preview = '/api/preview?path=' + encodeURIComponent(video.videoSrc);
  assert.equal((await request(preview)).status, 401);
  const part = await request(preview, { cookie, headers: { Range: 'bytes=1-2' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Type'), 'video/webm');
  assert.equal(part.headers.get('Content-Range'), 'bytes 1-2/3');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [2, 3]);
  assert.equal((await request(preview, { cookie, headers: { Range: 'bytes=10-20' } })).status, 416);
  const edit = assets => save({ id: project.id, baseRevision: project.revision, assets });
  assert.equal((await edit({ images: project.images })).status, 409);
  assert.equal((await edit({ media: [{ ...video, videoSrc: 'assets/projects/elsewhere/video.webm' }] })).status, 400);
  for (const url of ['javascript:alert(1)', 'https://user:pw@example.org', '<iframe src="https://example.org">', 'http://example.org', 'https://example.org/\npath']) {
    assert.equal((await edit({ media: [{ type: 'embed', url }] })).status, 400);
  }
  assert.equal((await edit({ media: [{ type: 'video', ...imageFile }] })).status, 400);
  assert.equal((await edit({ media: [{ type: 'image', ext: 'mp4', sha: imageFile.sha }] })).status, 400);
  const result = await edit({ media: [embed, last, video] });
  assert.equal(result.status, 200);
  const updated = (await result.json()).project;
  assert.deepEqual(updated.media, [embed, last, video]);
  assert.equal(state.files.has('dist/' + first.imageSrc), false);
  assert.equal(state.files.has('dist/' + video.videoSrc), true);
  assert.equal((await edit({ media: [first] })).status, 409);
  const onlyEmbed = await save({ id: project.id, baseRevision: updated.revision, assets: { media: [embed] } });
  assert.equal(onlyEmbed.status, 200);
  assert.deepEqual((await onlyEmbed.json()).project.images, []);
  assert.equal(state.files.size, 0);
  assert.equal((await request(preview, { cookie })).status, 404);
});


test('local card registration, reopening, reorder and publication retain scan files and the automatic cover', async t => {
  const root = await mkdtemp(join(tmpdir(), 'folio-card-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = join(root, 'content'), staging = join(root, 'uploads'), output = join(root, 'public');
  await mkdir(content);
  await writeFile(join(content, 'catalog.json'), JSON.stringify({ books: [], projects: [] }));
  const bindings = { ...env, LOCAL_STORE: await createLocalStore(content, staging) };
  const cookie = await session();
  const post = (path, body, headers) => request(path, { method: 'POST', cookie, body, headers }, bindings);
  async function asset(file, mime) {
    const bytes = await readFile(new URL('../dist/assets/' + file, import.meta.url));
    const response = await post('/api/assets', bytes, { 'Content-Type': mime });
    assert.equal(response.status, 201);
    return { bytes, upload: await response.json() };
  }
  const [first, second, scan] = await Promise.all([
    asset('forest-cover.webp', 'image/webp'), asset('forest.jpg', 'image/jpeg'), asset('sewn-signatures.webp', 'image/webp'),
  ]);
  const registrationId = crypto.randomUUID();
  const registration = {
    registrationId, title: 'Cards', bookForm: 'cards', cardStock: { cornerRadiusMm: 4, layers: ['#eeeeee', '#335599'] },
    coverRatio: first.upload.ratio, pageRatio: first.upload.ratio, edgeTreatments: { head: { mode: 'scan', rotation: 90 } },
    assets: { edgeScans: { head: scan.upload }, cards: [
      { front: { ...first.upload, sizeMm: [80, 100] }, back: null },
      { front: second.upload, back: first.upload },
    ] },
  };
  const created = await post('/api/books', registration);
  const saved = await created.json();
  assert.equal(created.status, 201, JSON.stringify(saved));
  const prefix = 'assets/books/cards-' + registrationId + '/';
  const paths = [prefix + 'card-1-front.webp', prefix + 'card-2-front.jpg', prefix + 'card-2-back.webp', prefix + 'edge-head.webp'];
  const [frontA, frontB, backB, scanPath] = paths;
  assert.equal(saved.book.coverImages.front, frontA);
  assert.deepEqual(saved.book.pages.map(face => face.imageSrc || face), [frontA, { blank: true }, frontB, backB]);
  assert.equal(saved.book.edgeTreatments.head.imageSrc, scanPath);
  assert.equal((await (await post('/api/books', registration)).json()).commit, saved.commit);

  bindings.LOCAL_STORE = await createLocalStore(content, staging);
  const reopened = await (await request('/api/catalog', { cookie }, bindings)).json();
  assert.deepEqual(reopened.books, [saved.book]);
  const edit = await post('/api/books', {
    id: saved.book.id, baseRevision: reopened.books[0].revision, registrationId: crypto.randomUUID(),
    edgeTreatments: { head: { mode: 'scan', rotation: 270, crop: { x: 5, y: 0, width: 90, height: 100 } } },
    assets: { cards: [{ front: { imageSrc: frontB }, back: { imageSrc: backB } }, { front: { imageSrc: frontA }, back: null }] },
  });
  const edited = await edit.json();
  assert.equal(edit.status, 200, JSON.stringify(edited));
  assert.equal(edited.book.coverImages.front, frontB);
  assert.equal(edited.book.coverRatio, second.upload.ratio);
  assert.deepEqual(edited.book.pages[2].sizeMm, [80, 100]);
  assert.deepEqual(edited.book.pages.map(face => face.imageSrc || face), [frontB, backB, frontA, { blank: true }]);
  assert.deepEqual(edited.book.edgeTreatments.head, {
    mode: 'scan', imageSrc: scanPath, rotation: 270, crop: { x: 5, y: 0, width: 90, height: 100 },
  });
  const preview = await request('/api/preview?path=' + encodeURIComponent(scanPath), { cookie }, bindings);
  assert.equal(preview.status, 200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), scan.bytes);

  await buildPublic(fileURLToPath(new URL('../', import.meta.url)), { contentDir: content, outputDir: output });
  const published = JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8'));
  assert.deepEqual(catalogAssets(published), new Set(paths));
  assert.deepEqual(published.books[0].pages, edited.book.pages);
  assert.deepEqual(published.books[0].coverImages, edited.book.coverImages);
  assert.deepEqual(published.books[0].edgeTreatments, edited.book.edgeTreatments);
  for (const [path, bytes] of [[frontA, first.bytes], [frontB, second.bytes], [backB, first.bytes], [scanPath, scan.bytes]]) {
    assert.deepEqual(await readFile(join(output, path)), bytes);
  }
});
