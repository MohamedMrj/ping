// Whiteboard model (BOARD block): permissions for guests, shape recognition, connectors, mind maps, templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { load } from './extract.mjs';

const { Board } = load('BOARD', ['Board'], { crypto: webcrypto });
const plain = x => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------------ helpers that draw like a hand would
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const jitter = (p, a) => [p[0] + rnd() * a, p[1] + rnd() * a];
const path = (corners, steps = 12, noise = 3) => {
  const out = [];
  for (let i = 0; i < corners.length - 1; i++) for (let k = 0; k < steps; k++) {
    const a = corners[i], b = corners[i + 1], f = k / steps;
    out.push(jitter([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], noise));
  }
  out.push(jitter(corners[corners.length - 1], noise));
  return out;
};
const circle = (cx, cy, rx, ry, n = 48, noise = 3, sweep = 1.0) => Array.from({ length: n + 1 }, (_, i) => jitter([cx + rx * Math.cos(2 * Math.PI * sweep * i / n), cy + ry * Math.sin(2 * Math.PI * sweep * i / n)], noise));

test('recognises hand-drawn shapes', () => {
  assert.equal(Board.recognize(circle(200, 200, 80, 80)).type, 'ellipse');
  assert.equal(Board.recognize(circle(200, 200, 140, 60)).type, 'ellipse');
  assert.equal(Board.recognize(path([[0, 0], [200, 0], [200, 120], [0, 120], [0, 4]])).type, 'rect');
  assert.equal(Board.recognize(path([[40, 130], [100, 10], [160, 130], [42, 128]])).type, 'triangle');
  assert.equal(Board.recognize(path([[100, 0], [200, 80], [100, 160], [0, 80], [98, 2]])).type, 'diamond');
  assert.equal(Board.recognize(path([[0, 0], [300, 40]], 20, 2)).type, 'line');
});

test('recognises an arrow drawn in one stroke and gives its direction', () => {
  const r = Board.recognize(path([[0, 100], [300, 100], [260, 70], [300, 100], [262, 130]], 14, 1.5));
  assert.equal(r && r.type, 'arrow');
  assert.ok(Math.abs(r.x1 - 0) < 10 && Math.abs(r.x2 - 300) < 10);
});

test('leaves scribbles, handwriting and tiny strokes alone', () => {
  assert.equal(Board.recognize(path([[0, 0], [50, 80], [100, 0], [150, 80], [200, 0], [250, 80]])), null);   // zigzag
  assert.equal(Board.recognize(path([[0, 0], [5, 6], [9, 2]])), null);                                       // a dot
  assert.equal(Board.recognize(circle(100, 100, 60, 60, 40, 2, 0.5)), null);                                  // half a circle
  assert.equal(Board.recognize([]), null);
});

test('the bounding box of a recognised shape matches the drawing', () => {
  const r = Board.recognize(path([[10, 20], [210, 20], [210, 140], [10, 140], [10, 24]], 12, 0));
  assert.deepEqual([Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)], [10, 20, 200, 120]);
});

// ------------------------------------------------------------------ what guests may do
const board = () => {
  const b = Board.newBoard('t');
  b.items = { mine: { id: 'mine', type: 'rect', x: 0, y: 0, w: 10, h: 10, author: 'g1' }, theirs: { id: 'theirs', type: 'sticky', x: 0, y: 0, w: 10, h: 10, author: 'host', votes: { a: 2 } }, locked: { id: 'locked', type: 'rect', x: 0, y: 0, w: 1, h: 1, author: 'g1', locked: true } };
  return b;
};
const guest = { cid: 'g1', canEdit: true }, viewer = { cid: 'g2', canEdit: false }, host = { host: true, cid: 'host' };
const put = item => ({ t: 'put', item });

test('a view-only guest can change nothing', () => {
  const b = board();
  assert.equal(Board.accept(b, put({ id: 'n', type: 'rect', x: 0, y: 0, w: 1, h: 1 }), viewer), null);
  assert.equal(Board.accept(b, { t: 'del', id: 'mine' }, viewer), null);
});

test('guests own what they create; authorship, votes and locks cannot be forged', () => {
  const b = board();
  const created = Board.accept(b, put({ id: 'n', type: 'sticky', x: 0, y: 0, w: 1, h: 1, author: 'someone-else', votes: { g1: 50 }, locked: true }), guest);
  assert.equal(created.item.author, 'g1');
  assert.equal(created.item.votes, undefined);
  assert.equal(created.item.locked, undefined);
  const moved = Board.accept(b, put({ id: 'theirs', type: 'sticky', x: 5, y: 5, w: 10, h: 10, author: 'g1', votes: {} }), guest);
  assert.equal(moved.item.author, 'host');
  assert.deepEqual(plain(moved.item.votes), { a: 2 });
});

test('"only their own items" stops guests from moving or deleting other people\'s items', () => {
  const b = board(), perms = Object.assign(Board.defaultPerms(), { editOthers: false });
  assert.equal(Board.accept(b, put({ id: 'theirs', type: 'sticky', x: 9, y: 9, w: 10, h: 10 }), guest, perms), null);
  assert.equal(Board.accept(b, { t: 'del', id: 'theirs' }, guest, perms), null);
  assert.ok(Board.accept(b, { t: 'del', id: 'mine' }, guest, perms));
});

test('locked items can only be changed by the host', () => {
  const b = board();
  assert.equal(Board.accept(b, { t: 'del', id: 'locked' }, guest), null);
  assert.ok(Board.accept(b, { t: 'del', id: 'locked' }, host));
});

test('pictures can be switched off for guests', () => {
  const b = board(), perms = Object.assign(Board.defaultPerms(), { images: false });
  const img = { id: 'i', type: 'image', x: 0, y: 0, w: 5, h: 5, src: 'data:image/png;base64,AAAA' };
  assert.equal(Board.accept(b, put(img), guest, perms), null);
  assert.ok(Board.accept(b, put(img), guest));
});

test('broken or hostile items are refused, even from the host', () => {
  const b = board();
  for (const it of [
    { id: 'x', type: 'script', x: 0, y: 0, w: 1, h: 1 },
    { id: 'x', type: 'rect', x: 'a', y: 0, w: 1, h: 1 },
    { id: 'x', type: 'rect', x: 0, y: 0, w: -5, h: 1 },
    { id: 'x', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'https://tracker.example/pixel.png' },
    { id: 'x', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'javascript:alert(1)' },
    { id: 'x', type: 'rect', x: 0, y: 0, w: 1, h: 1, stroke: 'red;background:url(x)' },
    { id: 'x', type: 'stroke', pts: [[0, 'a']] },
    { id: '../../x', type: 'rect', x: 0, y: 0, w: 1, h: 1 },
    { id: 'x', type: 'sticky', x: 0, y: 0, w: 1, h: 1, votes: { a: -3 } },
  ]) assert.equal(Board.accept(b, put(it), host), null, JSON.stringify(it));
  assert.equal(Board.accept(b, { t: 'drop-table' }, host), null);
});

test('apply and inverse undo a change exactly', () => {
  const b = board(), before = { mine: Board.clone(b.items.mine), n: null };
  Board.apply(b, [put({ id: 'n', type: 'rect', x: 1, y: 1, w: 1, h: 1 }), put(Object.assign({}, b.items.mine, { x: 50 }))]);
  assert.equal(b.items.mine.x, 50);
  Board.apply(b, Board.inverse(before));
  assert.equal(b.items.mine.x, 0);
  assert.equal(b.items.n, undefined);
});

// ------------------------------------------------------------------ connectors and geometry
test('a connector end sits on the outline of the item it is tied to, and follows it', () => {
  const items = { a: { id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100 }, b: { id: 'b', type: 'ellipse', x: 300, y: 0, w: 100, h: 100 } };
  const l = { id: 'l', type: 'arrow', from: 'a', to: 'b', x1: 0, y1: 0, x2: 0, y2: 0 };
  assert.deepEqual(plain(Board.ends(l, items)).map(p => p.map(Math.round)), [[100, 50], [300, 50]]);
  items.b.y = 300; items.b.x = 0;
  assert.deepEqual(plain(Board.ends(l, items)).map(p => p.map(Math.round)), [[50, 100], [50, 300]]);
  delete items.b;                                         // the item is gone: the end falls back to its own point
  assert.deepEqual(plain(Board.ends(l, items)[1]), [0, 0]);
});

test('hit testing and bounds', () => {
  const s = { type: 'stroke', pts: [[0, 0], [100, 0]], sw: 4 };
  assert.ok(Board.hit(s, [50, 3], 2));
  assert.ok(!Board.hit(s, [50, 10], 2));
  assert.deepEqual(plain(Board.bounds(s)), { x: -2, y: -2, w: 104, h: 4 });
  const r = { type: 'rect', x: 10, y: 10, w: 20, h: 20 };
  assert.ok(Board.hit(r, [20, 20], 0) && !Board.hit(r, [40, 40], 2));
});

test('scaling keeps boxes positive and scales text size with height', () => {
  const t = { type: 'text', x: 0, y: 0, w: 100, h: 20, fs: 20 };
  Board.scaleItem(t, 0, 0, 2, 2);
  assert.deepEqual([t.w, t.h, t.fs], [200, 40, 40]);
  const r = { type: 'rect', x: 0, y: 0, w: 100, h: 50 };
  Board.scaleItem(r, 100, 0, -1, 1);                      // dragged past the opposite edge
  assert.ok(r.w === 100 && r.x === 100);
});

// ------------------------------------------------------------------ mind maps, templates, voting
test('mind-map branches go to the right of the parent and stack below each other', () => {
  const items = { p: { id: 'p', type: 'sticky', x: 0, y: 0, w: 100, h: 100, fill: '#fff3a3' } };
  const [n1, l1] = Board.branch(items, items.p, 'me', ['n1', 'l1']);
  Object.assign(items, { n1, l1 });
  const [n2] = Board.branch(items, items.p, 'me', ['n2', 'l2']);
  assert.ok(n1.x > 100);
  assert.equal(n2.x, n1.x);
  assert.ok(n2.y >= n1.y + n1.h);
  assert.equal(l1.from, 'p'); assert.equal(l1.to, 'n1');
  assert.equal(Board.parentOf(items, n1).id, 'p');
  assert.equal(Board.children(items, items.p).length, 1);
});

test('every template produces valid items, with connectors that point at real items', () => {
  for (const kind of ['retro', 'kanban', 'swot', 'flow', 'mind', 'brainstorm']) {
    const out = Board.template(kind, 0, 0, k => k.toUpperCase(), 'me');
    assert.ok(out.length >= 4, kind);
    const ids = new Set(out.map(i => i.id));
    for (const it of out) {
      assert.ok(Board.validItem(it), kind + ' ' + JSON.stringify(it));
      if (it.from) assert.ok(ids.has(it.from) && ids.has(it.to), kind);
    }
  }
});

test('vote tally counts everyone\'s dots, most first', () => {
  const items = { a: { id: 'a', type: 'sticky', votes: { x: 1, y: 2 } }, b: { id: 'b', type: 'sticky', votes: { x: 4 } }, c: { id: 'c', type: 'sticky' } };
  assert.deepEqual(plain(Board.tally(items)), [{ id: 'b', n: 4 }, { id: 'a', n: 3 }]);
  assert.equal(Board.votesBy(items, 'x'), 5);
});
