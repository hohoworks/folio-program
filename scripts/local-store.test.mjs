import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalStore } from './local-store.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'folio-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = join(root, 'dist');
  const state = join(root, 'pending');
  await mkdir(content);
  await writeFile(join(content, 'catalog.json'), JSON.stringify({ books: [], projects: [] }));
  return { content, state, store: await createLocalStore(content, state) };
}

test('local uploads survive a restart and appear in the portfolio only on save', async t => {
  const { content, state, store } = await workspace(t);
  const bytes = Buffer.from('encoded image');
  const sha = await store.stage(bytes);
  assert.deepEqual(await readdir(content), ['catalog.json']);

  const restarted = await createLocalStore(content, state);
  const before = await restarted.snapshot();
  const path = 'assets/projects/work/first.webp';
  const catalog = { ...before.catalog, projects: [{ id: 'work', images: [{ imageSrc: path }] }] };
  const head = await restarted.publish(before.head, catalog, [{ path: 'dist/' + path, sha }], []);
  assert.deepEqual((await store.snapshot()), { head, catalog });
  assert.deepEqual(await readFile(join(content, path)), bytes);
  assert.deepEqual(await restarted.readAsset(path), bytes);
});

test('failed and concurrent local saves preserve the last complete catalog', async t => {
  const { content, store } = await workspace(t);
  const before = await store.snapshot();
  const sha = await store.stage(Buffer.from('first image'));
  const first = 'assets/books/work/front.png';
  const second = 'assets/books/work/page.png';
  await assert.rejects(store.publish(before.head, { books: [{ id: 'work' }] }, [
    { path: 'dist/' + first, sha },
    { path: 'dist/' + second, sha: '0'.repeat(40) },
  ], []));
  assert.deepEqual(await store.snapshot(), before);
  await assert.rejects(readFile(join(content, first)), { code: 'ENOENT' });

  const edits = ['A', 'B'].map(title => ({ ...before.catalog, site: { title } }));
  const heads = await Promise.all(edits.map(edit => store.publish(before.head, edit, [], [])));
  assert.equal(heads.filter(Boolean).length, 1);
  const winner = heads.findIndex(Boolean);
  assert.deepEqual(await store.snapshot(), { head: heads[winner], catalog: edits[winner] });
});

test('local storage publishes, previews and removes project videos while rejecting video paths outside projects', async t => {
  const { content, store } = await workspace(t);
  const before = await store.snapshot();
  const bytes = Buffer.from([0, 19, 213, 255]);
  const sha = await store.stage(bytes);
  const videoSrc = 'assets/projects/work/film.mp4';
  const media = [{ type: 'video', videoSrc }, { type: 'embed', url: 'https://example.com/frame' }];
  const catalog = { books: [], projects: [{ id: 'work', media, images: [] }] };
  await assert.rejects(store.publish(before.head, catalog, [{ path: 'dist/assets/books/work/film.mp4', sha }], []));
  const head = await store.publish(before.head, catalog, [{ path: 'dist/' + videoSrc, sha }], []);
  assert.deepEqual(await store.readAsset(videoSrc), bytes);
  await store.publish(head, before.catalog, [], [videoSrc]);
  await assert.rejects(readFile(join(content, videoSrc)), { code: 'ENOENT' });
});
