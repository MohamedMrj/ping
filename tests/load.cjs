'use strict';
// Cuts a marked block out of index.html and runs it (used by hl.test.cjs and sug.test.cjs).
const fs = require('node:fs');
const SRC = process.env.PING_HTML || require('node:path').join(__dirname, '..', 'index.html');
function block(name, ret) {
  const t = fs.readFileSync(process.env.PING_HTML || SRC, 'utf8');
  const a = t.indexOf(`/*${name}-START*/`), b = t.indexOf(`/*${name}-END*/`);
  if (a < 0 || b < 0) throw new Error('markers not found: ' + name);
  return new Function(t.slice(a, b) + `\nreturn ${ret};`)();
}
const unesc = s => s.replace(/&(lt|gt|quot|#39|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[e]);
const strip = h => h.replace(/<\/?span[^>]*>/g, '');
module.exports = { block, unesc, strip };
