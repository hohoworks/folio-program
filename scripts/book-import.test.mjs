import assert from 'node:assert/strict';
import test from 'node:test';
import { cardsFromPages } from '../admin/public/card-editor.js';
import { pdfFaceSize, planPdfPages } from '../admin/public/pdf-layout.js';

test('PDF imports keep rotated physical dimensions for each side of a mixed document', async () => {
  const sizes = [[72, 144], [288, 288], [144, 288]];
  const cleaned = [];
  const pdf = {
    numPages: sizes.length,
    async getPage(number) {
      const [width, height] = sizes[number - 1];
      return { getViewport: () => ({ width, height }), cleanup: () => cleaned.push(number) };
    },
  };
  const plan = await planPdfPages(pdf, 'auto', 0.5, () => {}, true);
  assert.deepEqual(plan.sheets, [1, 2, 1]);
  assert.deepEqual(plan.faceSizes, [[25.4, 50.8], [50.8, 101.6], [50.8, 101.6], [50.8, 101.6]]);
  assert.deepEqual(cleaned, [1, 2, 3]);
  assert.deepEqual(pdfFaceSize({ width: 144, height: 72 }), [50.8, 25.4]);
  assert.equal(pdfFaceSize({ width: 0, height: 72 }), undefined);
});

test('card editing preserves blank backs, odd last fronts and the order of source images', () => {
  const a = { imageSrc: 'a.webp', sizeMm: [50, 90] };
  const b = { imageSrc: 'b.webp' }, c = { imageSrc: 'c.webp' }, d = { imageSrc: 'd.webp' };
  const cards = cardsFromPages([a, { blank: true }, b, c, d]);
  assert.deepEqual(cards.map(({ front, back }) => [front, back]), [[a, null], [b, c], [d, null]]);
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
});
