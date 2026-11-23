'use strict';
// "Looks like code" suggestions in notes (SUG block).
const test = require('node:test');
const assert = require('node:assert/strict');
const { block } = require('./load.cjs');
const Sug = block('SUG', 'Sug');

// Same as codeVocab() in index.html
const vocabOf = (...texts) => {
  const v = Sug.emptyVocab();
  for (const t of texts) { const l = Sug.learn(t); l.loose.forEach(x => v.loose.add(x)); l.calls.forEach(x => v.calls.add(x)); l.exact.forEach(x => v.exact.add(x)); }
  return v;
};
const words = (text, v = Sug.emptyVocab()) => Sug.suggest(text, v).map(h => h.word);
const kinds = (text, v = Sug.emptyVocab()) => Object.fromEntries(Sug.suggest(text, v).map(h => [h.word, h.kind]));

test('learn: buckets', () => {
  const l = Sug.learn('use `SELECT` and `count(*)` and `df.groupBy` and `foo_bar` and `C:\\tmp\\x` and `x`');
  assert.deepEqual(l.exact, ['SELECT']);
  assert.deepEqual(l.calls, ['count']);
  assert.deepEqual(l.loose.sort(), ['c:\\tmp\\x', 'df.groupby', 'foo_bar']);
});

test('learn: empty / null / fences ignored', () => {
  for (const t of ['', null, undefined, '``', '` `']) assert.deepEqual(Sug.learn(t), { loose: [], calls: [], exact: [] });
  assert.deepEqual(Sug.learn('```\n`inside`\n```\n`outside`'), { loose: [], calls: [], exact: ['outside'] });
  assert.deepEqual(Sug.learn('```sql\n`inside`'), { loose: [], calls: [], exact: [] });
});

test('learn: regex-special chars do not throw and are handled', () => {
  const l = Sug.learn('`a.b*c` `foo(` `$x` `a+b` `(?:x)` `[x]` `x|y` `^a$`');
  assert.deepEqual(l.loose, ['$x']);
  assert.deepEqual(Sug.suggest('then $x again', vocabOf('`$x`')).map(h => h.word), ['$x']);
});

test('match: exact case for plain words, any case for calls / loose', () => {
  const v = vocabOf('`SELECT` `count(*)` `df.groupBy`');
  assert.deepEqual(words('SELECT select Select', v), ['SELECT']);
  assert.deepEqual(words('count count(x) COUNT(y)', v), ['count(x)', 'COUNT(y)']);
  assert.deepEqual(words('DF.GROUPBY df.groupby', v), ['DF.GROUPBY', 'df.groupby']);
});

test('match: punctuation adjacency', () => {
  const v = vocabOf('`SELECT`');
  assert.deepEqual(words('Use SELECT, then SELECT. (SELECT) "SELECT" SELECT!', v), ['SELECT', 'SELECT', 'SELECT', 'SELECT', 'SELECT']);
  const hits = Sug.suggest('call getName.', v);
  assert.equal(hits[0].word, 'getName'); assert.equal(hits[0].end, 'call getName'.length);
  assert.deepEqual(words('xSELECT SELECTx SELECT_ $SELECT', v), []);
});

test('no re-suggest inside backticks, fences, links, headings', () => {
  const v = vocabOf('`foo_bar`');
  assert.deepEqual(words('`foo_bar` and ``foo_bar``', v), []);
  assert.deepEqual(words('```\nfoo_bar\n```\nfoo_bar', v), ['foo_bar']);
  assert.deepEqual(words('# foo_bar\n[foo_bar](http://x/foo_bar)', v), []);
  assert.deepEqual(words('https://x.com/foo_bar a@foo_bar.com', v), []);
});

test('positions are correct across lines incl. CRLF', () => {
  const t = 'abc\r\nuse foo_bar now\r\nand getName()';
  for (const h of Sug.suggest(t, Sug.emptyVocab())) assert.equal(t.slice(h.start, h.end), h.word);
  assert.deepEqual(words(t), ['foo_bar', 'getName()']);
});

test('guesses', () => {
  assert.deepEqual(kinds('snake_case camelCase iPhone df.groupBy example.com f(x) ~/a/b C:\\x\\y a'),
    { snake_case: 'guess', camelCase: 'guess', 'df.groupBy': 'guess', '~/a/b': 'guess', 'C:\\x\\y': 'guess' });
});

test('unicode: no suggestion inside a Swedish/accented word', () => {
  // ASCII \w in TOKEN boundaries lets matches start/end in the middle of a word containing å/ä/ö/é
  assert.deepEqual(words('mötesAnteckningar'), []);
  assert.deepEqual(words('åfoo_bar'), []);
  assert.deepEqual(words('foo_barå'), []);
  assert.deepEqual(words('kaféBesök'), []);
  const v = vocabOf('`SELECT`');
  assert.deepEqual(words('ÅSELECT SELECTö', v), []);
});

test('unicode words learned? (åäö identifiers are not learned)', () => {
  assert.deepEqual(Sug.learn('`räkna_ut`'), { loose: [], calls: [], exact: [] });
});

test('empty notes / huge notes', () => {
  assert.deepEqual(Sug.suggest('', Sug.emptyVocab()), []);
  assert.deepEqual(Sug.suggest(null, Sug.emptyVocab()), []);
  assert.deepEqual(Sug.suggest('foo_bar '.repeat(20000), Sug.emptyVocab()), []);
});

test('perf: pathological 110 KB lines < 500 ms', () => {
  const slow = [];
  for (const [k, s] of Object.entries({ brackets: '['.repeat(110000), unders: ' _a'.repeat(36000), stars: ' *a'.repeat(36000), paths: 'C:\\' + 'a.'.repeat(55000), slashes: '/a'.repeat(55000), parens: 'f(' .repeat(55000), dots: 'a.'.repeat(55000), hashes: ' #a'.repeat(36000), ticks: '`'.repeat(110000), base64: 'QUJDRA=='.repeat(13000), words: 'foo_bar '.repeat(13000) })) {
    const t = Date.now(); Sug.suggest(s, vocabOf('`foo_bar`')); const ms = Date.now() - t;
    if (ms > 500) slow.push(`${k}: ${ms} ms`);
  }
  assert.deepEqual(slow, []);
});
