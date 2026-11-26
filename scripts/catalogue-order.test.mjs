import assert from 'node:assert/strict';
import test from 'node:test';
import { reorderedCatalogue } from '../admin/public/media-order.js';

test('the work slider can move directly to either end without changing the original order', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(reorderedCatalogue(order, order, 0, 4), ['b', 'c', 'd', 'e', 'a']);
  assert.deepEqual(reorderedCatalogue(order, order, 4, 0), ['e', 'a', 'b', 'c', 'd']);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
});

test('filtered work moves leave hidden slots intact and ignore stale or invalid targets', () => {
  const order = ['a', 'x', 'b', 'y', 'c'];
  const visible = ['a', 'b', 'c'];
  assert.deepEqual(reorderedCatalogue(order, visible, 2, 0), ['c', 'x', 'a', 'y', 'b']);
  assert.deepEqual(visible, ['a', 'b', 'c']);
  assert.equal(reorderedCatalogue(order, ['b', 'c', 'a'], 2, 0), null);
  assert.equal(reorderedCatalogue(order, visible, 1, 1), null);
  assert.equal(reorderedCatalogue(order, visible, -1, 2), null);
  assert.equal(reorderedCatalogue(order, visible, 1, 3), null);
});
