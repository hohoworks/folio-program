// Apply editorial punctuation only to plain text on the public site. Leave the author's source editable.
const verbatimParts = [
  /`{3}[\s\S]*?`{3}|`[^`\n]*`/,
  /(?:https?:\/\/|www\.)[^\s<>"“”‘’]*[^\s<>"“”‘’'.,;:!?)\]]/,
  /[\w.+%-]+(?:'[\w.+%-]+)*@[\w.-]+\.[a-z]{2,}/,
  /<(?<tag>[a-z][\w:-]*)(?:\s+[^<>]*)?>[^<]*<\/\k<tag>\s*>/,
  /<\/?[a-z][\w:-]*(?:\s+[^<>]*?=\s*[^<>]*|\s*\/)\s*>/,
];
const literal = new RegExp(verbatimParts.map(pattern => pattern.source).join('|'), 'giu');
export function displayText(text) {
  if (typeof text !== 'string' || !/["'，]/.test(text)) return text;
  const opened = new Set();
  function prose(start, end) {
    const fragment = text.slice(start, end);
    return fragment.replace(/["'，]/g, (mark, index, value) => {
      if (mark === '，') return ',';
      const before = value[index - 1] ?? text[start - 1] ?? '';
      const after = value[index + 1] ?? text[end] ?? '';
      const single = mark === "'";
      const close = single ? '’' : '”';
      if (single && /\p{Script=Latin}/u.test(before) && /\p{Script=Latin}/u.test(after)) return close;
      if (opened.has(mark) && before && !/\s/.test(before)) {
        opened.delete(mark);
        return close;
      }
      if (/\d/.test(before)) return mark; // e.g. 6'2" or a 12" print
      if (single && /^\d{2}(?:s\b|\b(?!'))/.test(value.slice(index + 1))) return close;
      if (after && !/\s/.test(after)) {
        opened.add(mark);
        return single ? '‘' : '“';
      }
      return close;
    });
  }
  let result = '';
  let start = 0;
  for (const match of text.matchAll(literal)) {
    result += prose(start, match.index) + match[0];
    start = match.index + match[0].length;
  }
  return result + prose(start, text.length);
}
