import assert from 'node:assert/strict';
import test from 'node:test';
import { displayText } from '../dist/punctuation.js';
import { loadCatalog } from '../dist/catalog.js';

test('Korean and English prose use curly quotation marks and keep the chosen title marks', () => {
  assert.equal(displayText('안부, 욕하는 것까지 "밥" 이라는 말'), '안부, 욕하는 것까지 “밥” 이라는 말');
  assert.equal(displayText('<시간/공간>，<<A/B>>와 〈인쇄〉, 《밥》'), '<시간/공간>,<<A/B>>와 〈인쇄〉, 《밥》');
  assert.equal(displayText('<작품> 〈작품〉 ＜작품＞ 《작품》 『작품』'), '<작품> 〈작품〉 ＜작품＞ 《작품》 『작품』');
  assert.equal(displayText('She said, "read \'the artist\'s book\'."'), 'She said, “read ‘the artist’s book’.”');
  assert.equal(displayText('크기 12" × 16", 6\'2", 1,250원 · 2026.11.'), '크기 12" × 16", 6\'2", 1,250원 · 2026.11.');
  assert.equal(displayText('“있는 부호”, 『밥』 「한 끼」'), '“있는 부호”, 『밥』 「한 끼」');
});

test('contact details, technical text and comparisons survive verbatim inside prose and quotations', () => {
  for (const literal of ["https://example.com/O'Reilly", "o'neil@example.com", '`<제목 attr="값">`']) {
    assert.equal(displayText('"' + literal + '"'), '“' + literal + '”');
  }
  for (const source of ['a < b > c, 1<2>0', 'Map<Key>', '<em class="label">title</em>',
    '<img src="image.jpg" />', '메일 <info@example.com>', '&lt;밥&gt;']) {
    assert.equal(displayText(source), source);
  }
});

test('public catalog formats bilingual titles, labels and prose without editing uploaded work or addresses', async t => {
  const path = 'assets/projects/work/poster.webp';
  const source = {
    projects: [{ id: 'work', title: '<책>', category: '"전시"', description: ['"밥"'], images: [{ imageSrc: path }],
      translations: { en: { title: '<Book>', description: ["The artist's archive."] } } }],
    site: { title: '<작업실>', about: { heading: '<소개>', text: '"안녕"' }, contact: { text: '"연락"', email: "o'neil@example.com",
      links: [{ label: '<홈>', url: "https://example.com/O'Reilly" }] },
      translations: { en: { about: { text: '"Hello"' }, contact: { text: '"Contact"' } } } },
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json(source));
  const { projects: [project], site } = await loadCatalog();
  assert.equal(project.title, '<책>');
  assert.equal(project.category, '“전시”');
  assert.deepEqual(project.description, ['“밥”']);
  assert.equal(project.translations.en.title, '<Book>');
  assert.deepEqual(project.translations.en.description, ['The artist’s archive.']);
  assert.equal(project.images[0].imageSrc, path);
  assert.equal(site.title, '<작업실>');
  assert.equal(site.about.heading, '<소개>');
  assert.equal(site.about.text, '“안녕”');
  assert.equal(site.translations.en.about.text, '“Hello”');
  assert.equal(site.contact.text, '“연락”');
  assert.equal(site.translations.en.contact.text, '“Contact”');
  assert.equal(site.contact.email, source.site.contact.email);
  assert.deepEqual(site.contact.links[0], { label: '<홈>', url: source.site.contact.links[0].url });
  assert.equal(source.projects[0].title, '<책>');
});
