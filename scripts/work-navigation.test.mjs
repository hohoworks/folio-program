import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkRoute } from '../dist/work-url.js';

const book = { id: 'book-stable-id', type: 'book', slug: 'bap', slugAliases: ['rice-book', 'rice'] };
const project = { id: 'project-stable-id', type: 'project', slug: 'identity-design' };
const route = path => resolveWorkRoute([book, project], new URL(path, 'https://example.org/'));

test('canonical and previous work names always open the same entry in either language', () => {
  for (const slug of [book.slug, ...book.slugAliases]) {
    for (const suffix of ['', '/?lang=ko', '?lang=en']) {
      assert.deepEqual(route('/work/' + slug + suffix), { page: 'book', entry: book });
    }
  }
  assert.deepEqual(route('/work/' + project.slug), { page: 'detail', entry: project });
});

test('saved book, project, and bare ID hash links keep the original item and archive return context', () => {
  for (const [entry, view] of [[book, 'book'], [project, 'detail']]) {
    assert.deepEqual(route('/?lang=en#' + entry.id), { page: view, entry, fromProject: false });
    assert.deepEqual(route('/?tag=book#project/' + entry.id), { page: view, entry, fromProject: true });
  }
  assert.deepEqual(route('/index.html#book/' + book.id), { page: 'book', entry: book, fromProject: false });
  assert.deepEqual(route('/#book/' + project.id), { page: 'project' });
  assert.deepEqual(route('/#book/' + book.id + '/extra'), { page: 'project' });
});

test('navigation hashes resolve to their section and never shadow a work on its own page', () => {
  for (const section of ['project', 'about', 'contact', 'bookshelf']) {
    assert.deepEqual(route('/?lang=en#' + section), { page: section });
  }
  assert.deepEqual(route('/work/bap#project'), { page: 'book', entry: book });
});
