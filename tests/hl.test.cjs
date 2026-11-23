'use strict';
// Code colouring (HL block): text joins back exactly, output is escaped, and no input makes it slow.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { block, unesc, strip } = require('./load.cjs');

const Hl = block('HL', 'Hl');
const LANGS = Hl.list().map(l => l.id);

const SAMPLES = {
  javascript: ['const a = `x${`a${b}`}y` / 2; const r = /"[a-z]+\'/g; // c\n/* open', 'let s = "\\"<script>alert(1)</script>"; x = a / b / c;', 'class A { @dec m() { return this.$x?.y ?? 1e3 } }'],
  typescript: ['interface X { a: string; b?: number } type T = keyof X; const v = <T>(x as any);', 'enum E { A = 1 } function f<T extends object>(a: T): void {}'],
  css: ['a:hover > .b, #c::before { color: #fff !important; width: calc(100% - 2px); }', '@media (max-width:600px){ .x{ --v: "a<b" } }', 'body { background: url("x.png") ; /* unterminated'],
  html: ['<!doctype html><html><head><style>a{color:red}</style><script>if (a < b && c > d) alert("</div>")</script></head><body class="x" data-a=\'1\' disabled>&amp; &lt; &#39; &nbsp;</body></html>', '<div <script', '<script>let x = 1', '<!-- unterminated', '<![CDATA[ x < y '],
  xml: ['<?xml version="1.0"?><root a="1"><b/><![CDATA[<x>]]></root>', '<a b="unterminated'],
  php: ['<?php echo "$x <b>"; $y = \'a\'; // c\n# d\n/* e */ function F() {} ?>'],
  sql: ["SELECT 'it''s', N'x''y', [col], \"q\", `bt` FROM dbo.t WHERE a <> @p -- c\n/* b */", "select '' , '''' , 'unterminated", "INSERT INTO t VALUES ('a\nb')"],
  kql: ['T | where Timestamp > ago(1d) | project-away x | summarize count() by bin(ts, 1h) // c'],
  python: ['def f(x) -> int:\n    """doc\n    """\n    return rb\'\\x00\' + f"{x}" + \'\'\'a', '@decorator\nclass A(B): pass  # c', 's = """unterminated'],
  r: ['x <- c(1, 2) %>% mean(); f <- function(a) { if (a) TRUE else NA } # c'],
  bash: ['#!/bin/bash\ncat <<EOF\nhello $USER\nEOF\necho "$(date) ${x:-y}" \'$z\' $# $? | grep -v x && ls -la # c', 'echo "unterminated $(ls'],
  powershell: ['<# block #> $x = "a `"b`" $env:Path" + @"\nhere\n"@; Get-ChildItem -Path . | Where-Object { $_.Length -gt 1 } [string]$s', "'it''s'"],
  json: ['{"a": [1, -2.5e3, true, null], "b": "x\\"y", "c": {}} // c', '{"a": "unterminated'],
  yaml: ['---\nkey: value\n- item: 1\nanchors: &a\n  ref: *a\ntag: !!str 1\nblock: |\n  text\n# c\n...'],
  csv: ['a,b,"c ""q"" d"\n1,2.5,-3\n"unterminated', 'a\tb\tc\r\n1\t2\t3'],
  csharp: ['#region x\nusing System; var s = $@"a{b}""c"; [Obsolete] public class A { public int P { get; set; } }'],
  java: ['@Override public static void main(String[] a) { String t = """\n x\n """; char c = \'\\n\'; }'],
  kotlin: ['data class A(val x: Int) { fun f() = println("$x ${x + 1}") }'],
  go: ['package main\nfunc main() { s := `raw\nstring`; fmt.Println(s, \'x\') }'],
  rust: ['#[derive(Debug)] fn f<\'a>(x: &\'a str) -> Result<i32, E> { let s = r#"raw "q" "#; println!("{}", b\'x\'); }'],
  c: ['#include <stdio.h>\nint main(void) { printf("%d\\n", 1 < 2); return 0; }'],
  cpp: ['#include <vector>\ntemplate<typename T> class A { std::vector<T> v; }; auto x = a < b ? c : d;'],
  swift: ['import UIKit\nguard let x = y else { return }\nlet s = """\nmulti\n"""\n#if DEBUG'],
  scala: ['object A extends App { case class B(x: Int); val s = s"a $x ${y}"; val t = """raw""" }'],
  dockerfile: ['FROM node:20 AS build\nRUN apt-get install -y x && \\\n  echo "$HOME ${X}"\nCOPY --from=build . .'],
  terraform: ['resource "aws_s3_bucket" "b" {\n  name = "x-${var.y}"\n  policy = <<EOF\n{"a":1}\nEOF\n}\n# c', 'x = <<-EOT\nunterminated'],
  ini: ['[section]\nkey = "value"\n; c\n# c\n[[array]]\nflag = true\ndate = 2024-01-01T00:00:00Z'],
  nginx: ['server {\n  listen 80;\n  location / { proxy_pass http://$host; }\n}\n<VirtualHost *:80>\n</VirtualHost>'],
  markdown: ['# H\n> quote\n- item **bold** *it* `code` [l](http://x)\n```js\nx\n```\nhttps://a.b/c'],
  diff: ['diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old <b>\n+new &amp;\n ctx'],
  makefile: ['.PHONY: all\nCC := gcc\nall: main.o\n\t$(CC) -o $@ $< "x"\nifeq ($(A),1)\nendif'],
  regex: ['^(?:[a-z]+|\\d{2,3})(?<name>x)\\p{L}+[^\\]]*$', '[unterminated', '\\'],
};

const NASTY = ['', ' ', '\t\t  \n \n', '\n', '\r\n', 'a\r\nb\r\n', '"', "'", '`', '/*', '<!--', '"""', "'''", '\\', '\\\\\\\\"', '<script>alert(1)</script>',
  '&amp; &lt; &#39; & < > " \'', 'åäö ÅÄÖ é 中文 😀 👨‍👩‍👧 \u{1F600}x', '"😀"\'😀\'`😀`', '\\😀', '\u0000\u2028\u2029\uFEFF', 'x'.repeat(5000), '${`a${b}`}', 'a/b/c /re/g', '\t\tindent\ttab'];

function check(code, id) {
  const toks = Hl.tokens(code, id);
  assert.equal(toks.map(t => t[0]).join(''), code, `tokens join (${id})`);
  for (const [t] of toks) assert.ok(t.length > 0, `empty token (${id})`);
  const h = Hl.html(code, id);
  assert.ok(!/<(?!\/?span[ >])/.test(h), `raw < in html (${id})`);
  assert.ok(!/&(?!(?:lt|gt|quot|#39|amp);)/.test(h), `raw & in html (${id})`);
  assert.ok(!/<span[^>]*>[^<]*["'][^<]*<\/span>/.test(h.replace(/<span class="tk-\w+">/g, '<span>')), `raw quote (${id})`);
  assert.equal(unesc(strip(h)), code, `html round trip (${id})`);
  const ls = Hl.lines(code, id);
  assert.equal(ls.length, code.split('\n').length, `line count (${id})`);
  assert.equal(ls.map(l => unesc(strip(l))).join('\n'), code, `lines round trip (${id})`);
  return toks;
}

for (const id of LANGS) {
  test(`round trip: ${id}`, () => {
    for (const s of [...(SAMPLES[id] || []), ...NASTY]) check(s, id);
    for (const s of SAMPLES[id] || []) check(s.replace(/\n/g, '\r\n'), id);
  });
  test(`cross-language samples: ${id}`, () => {
    for (const k in SAMPLES) for (const s of SAMPLES[k]) check(s, id);
  });
}

test('every language has samples', () => {
  for (const id of LANGS) assert.ok(SAMPLES[id], 'missing samples for ' + id);
  assert.equal(LANGS.length, 32);
});

test('unknown language falls back to plain', () => { check('<b>&', 'nope'); });

test('no surrogate pair split across token boundaries', () => {
  const bad = [];
  for (const id of LANGS) for (const s of [...NASTY, '\\😀', '"\\😀"', '\'\\😀\'', '`\\😀`', '[😀]', '#😀', '// 😀', '-- 😀']) {
    const toks = Hl.tokens(s, id);
    for (let k = 0; k < toks.length - 1; k++) {
      const a = toks[k][0], b = toks[k + 1][0];
      if (/[\uD800-\uDBFF]$/.test(a) && /^[\uDC00-\uDFFF]/.test(b) && toks[k][1] !== toks[k + 1][1]) bad.push(`${id}: ${JSON.stringify(s)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('random fuzz round trip', () => {
  const alphabet = ['a', 'Z', '_', '$', '0', '9', '.', ' ', '\t', '\n', '\r', '"', "'", '`', '\\', '/', '*', '#', '<', '>', '&', '-', '=', ':', ';', '{', '}', '(', ')', '[', ']', '@', '!', '%', '|', 'å', '😀', 'EOF', '<<', '${', '"""', '<!--', '-->', '<script>', '</script>', '<style>'];
  let seed = 42; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let r = 0; r < 300; r++) {
    let s = ''; const n = rnd(60);
    for (let k = 0; k < n; k++) s += alphabet[rnd(alphabet.length)];
    for (const id of LANGS) check(s, id);
  }
});

test('detect sanity', () => {
  assert.equal(Hl.detect(''), null);
  assert.equal(Hl.detect('   \n '), null);
  assert.equal(Hl.detect('{"a": 1}'), 'json');
  assert.equal(Hl.detect('SELECT a FROM b WHERE c = 1'), 'sql');
  assert.equal(Hl.detect('def f(x):\n    return x'), 'python');
});

// --- performance: each case runs in a child process with a hard timeout so catastrophic backtracking can't hang the suite
const LIMIT = 500;
function timed(expr, id, fn = 'html') {
  const script = `const {block}=require(${JSON.stringify(path.join(__dirname, 'load.cjs'))});const Hl=block('HL','Hl');const s=${expr};const t=process.hrtime.bigint();Hl.${fn}(s, ${JSON.stringify(id)});console.log(Number(process.hrtime.bigint()-t)/1e6);`;
  const r = spawnSync(process.execPath, ['-e', script], { timeout: 8000, encoding: 'utf8' });
  if (r.error || r.status !== 0) return Infinity;
  return parseFloat(r.stdout);
}
const big = id => `${JSON.stringify((SAMPLES[id] || ['x']).join('\n') + '\n')}.repeat(Math.ceil(200000/${(SAMPLES[id] || ['x']).join('\n').length + 1}))`;

test('perf: 200 KB realistic input per language', () => {
  const slow = [];
  for (const id of LANGS) { const ms = timed(big(id), id); if (ms > LIMIT) slow.push(`${id}: ${ms} ms`); }
  assert.deepEqual(slow, []);
});

const PATHO = {
  backslashes: `'\\\\'.repeat(200000)`,
  quotes: `'"'.repeat(200000)`,
  squotes: `"'".repeat(200000)`,
  openComment: `'/*' + 'a '.repeat(100000)`,
  openStrSpaces: `'"' + ' '.repeat(200000)`,
  longWordsLine: `'word '.repeat(40000)`,
  longIdent: `'a'.repeat(200000)`,
  ltRun: `'<'.repeat(200000)`,
  tagOpen: `'<a b=c '.repeat(25000)`,
  stars: `'*'.repeat(200000)`,
  dashes: `'- '.repeat(100000)`,
  heredocs: `'<<EOF\\n'.repeat(30000)`,
  newlines: `'x' + '\\n'.repeat(200000) + 'x'`,
  spaces: `'x' + ' '.repeat(200000) + 'x'`,
  brackets: `'['.repeat(200000)`,
  cssDataUri: `'.a{background:url(data:image/png;base64,' + 'iVBORw0KGgo'.repeat(18000) + ')}'`,
  yamlLongValue: `'key: ' + 'value '.repeat(33000)`,
};
test('perf: pathological inputs (tokens) per language', () => {
  const slow = [];
  for (const id of LANGS) for (const [k, expr] of Object.entries(PATHO)) {
    const ms = timed(expr, id); if (ms > LIMIT) slow.push(`${id}/${k}: ${ms === Infinity ? '>8000 (timeout)' : ms.toFixed(0)} ms`);
  }
  assert.deepEqual(slow, []);
});
test('perf: detect on pathological inputs', () => {
  const slow = [];
  for (const [k, expr] of Object.entries(PATHO)) {
    const ms = timed(expr, null, 'detect'); if (ms > LIMIT) slow.push(`detect/${k}: ${ms === Infinity ? '>8000 (timeout)' : ms.toFixed(0)} ms`);
  }
  assert.deepEqual(slow, []);
});
