// Multi-device sync through one shared save file (Google Drive, OneDrive …): the SYNC block of index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const { mergeData, syncKey, makeBase, stampChanges, TOMBSTONE_MS } =
  load('SYNC', ['mergeData', 'syncKey', 'makeBase', 'stampChanges', 'TOMBSTONE_MS']);

const NOW = Date.UTC(2026, 10, 23, 12);
const data = (o = {}) => Object.assign({ reminders: [], notes: [], deleted: {}, settings: { lang: 'sv' }, settingsUpdated: 0 }, o);
const rem = (id, updated, extra = {}) => Object.assign({ id, title: id, updated, tags: [], priority: 0 }, extra);
const note = (id, updated, text = id) => ({ id, text, updated, pinned: false });
const ids = a => Array.from(a, x => x.id).sort();
const plain = x => JSON.parse(JSON.stringify(x));   // objects from the vm have another Object.prototype

test('items only on one side are kept from both sides', () => {
  const m = mergeData(data({ reminders: [rem('a', 1)] }), data({ reminders: [rem('b', 2)], notes: [note('n', 3)] }), NOW);
  assert.deepEqual(ids(m.reminders), ['a', 'b']);
  assert.deepEqual(ids(m.notes), ['n']);
});

test('the newer version of an item wins, whichever side it is on', () => {
  const l = data({ reminders: [rem('a', 10, { title: 'local' })] }), r = data({ reminders: [rem('a', 20, { title: 'remote' })] });
  assert.equal(mergeData(l, r, NOW).reminders[0].title, 'remote');
  assert.equal(mergeData(r, l, NOW).reminders[0].title, 'remote');
});

test('older items without an `updated` stamp fall back to modified/created', () => {
  const l = data({ notes: [{ id: 'n', text: 'old', created: 5 }] }), r = data({ notes: [{ id: 'n', text: 'new', modified: 9 }] });
  assert.equal(mergeData(l, r, NOW).notes[0].text, 'new');
});

test('same stamp, different content: both devices pick the same winner (no endless overwriting)', () => {
  const a = data({ notes: [note('n', 50, 'from A')] }), b = data({ notes: [note('n', 50, 'from B')] });
  const onA = mergeData(a, b, NOW), onB = mergeData(b, a, NOW);
  assert.equal(onA.notes[0].text, onB.notes[0].text);
  assert.equal(syncKey(onA), syncKey(onB));
});

test('a deletion removes the item everywhere, unless it was edited after the deletion', () => {
  const T = NOW - 1000;
  const l = data({ reminders: [rem('a', T - 10), rem('b', T + 10)] });
  const r = data({ deleted: { a: T, b: T } });
  const m = mergeData(l, r, NOW);
  assert.deepEqual(ids(m.reminders), ['b']);            // b was changed after it was deleted elsewhere: kept
  assert.equal(m.deleted.a, T);
});

test('tombstones older than the limit are dropped; newer tombstones win over older ones', () => {
  const m = mergeData(data({ deleted: { old: NOW - TOMBSTONE_MS - 1, x: NOW - 9 } }), data({ deleted: { x: NOW - 5 } }), NOW);
  assert.equal(m.deleted.old, undefined);
  assert.equal(m.deleted.x, NOW - 5);
});

test('shared settings come from the newer side, device-only settings stay', () => {
  const l = data({ settings: { lang: 'sv', theme: 'dark', onboarded: true, lastBackup: 1 }, settingsUpdated: 10 });
  const r = data({ settings: { lang: 'en', theme: 'light', onboarded: false }, settingsUpdated: 20 });
  const m = mergeData(l, r, NOW);
  assert.equal(m.settings.lang, 'en');
  assert.equal(m.settings.theme, 'light');
  assert.equal(m.settings.onboarded, true);
  assert.equal(m.settings.lastBackup, 1);
  assert.equal(mergeData(r, l, NOW).settings.lang, 'en');   // and the other way round
});

test('merging tolerates a remote file with missing parts', () => {
  const m = mergeData(data({ reminders: [rem('a', 1)] }), {}, NOW);
  assert.deepEqual(ids(m.reminders), ['a']);
});

test('merge is idempotent and order-independent for sync purposes', () => {
  const a = data({ reminders: [rem('a', 1), rem('c', 7)], notes: [note('n', 4)], deleted: { z: NOW - 10 } });
  const b = data({ reminders: [rem('b', 2), rem('c', 8, { title: 'c2' })], deleted: { n: 3 } });
  const ab = mergeData(a, b, NOW), ba = mergeData(b, a, NOW);
  assert.equal(syncKey(ab), syncKey(ba));
  assert.equal(syncKey(mergeData(ab, b, NOW)), syncKey(ab));
});

test('syncKey ignores field order, item order and defaults filled in on load', () => {
  const a = data({ reminders: [{ id: 'x', title: 't', updated: 1 }, { id: 'y', title: 'u', updated: 1 }], notes: [{ id: 'n', text: 'q' }] });
  const b = data({ reminders: [{ updated: 1, title: 'u', id: 'y', tags: [], priority: 0 }, { title: 't', id: 'x', updated: 1 }], notes: [{ text: 'q', id: 'n', pinned: false }] });
  assert.equal(syncKey(a), syncKey(b));
  b.reminders[0].title = 'changed';
  assert.notEqual(syncKey(a), syncKey(b));
});

test('stampChanges stamps only what changed and records deletions', () => {
  const d = data({ reminders: [rem('a', 1), rem('b', 1)], notes: [note('n', 1)] });
  const base = makeBase(d);
  d.reminders[0].title = 'edited';
  d.notes = [];
  d.reminders.push(rem('c', undefined));
  stampChanges(d, base, 500);
  const byId = Object.fromEntries(d.reminders.map(r => [r.id, r]));
  assert.equal(byId.a.updated, 500);
  assert.equal(byId.b.updated, 1);
  assert.equal(byId.c.updated, 500);
  assert.equal(d.deleted.n, 500);
  stampChanges(d, base, 900);                 // nothing changed since: nothing re-stamped
  assert.equal(byId.a.updated, 500);
});

test('stampChanges stamps settings only when a shared setting changes', () => {
  const d = data({ settings: { lang: 'sv', onboarded: false } });
  const base = makeBase(d);
  d.settings.onboarded = true; stampChanges(d, base, 100);
  assert.equal(d.settingsUpdated, 0);
  d.settings.lang = 'en'; stampChanges(d, base, 200);
  assert.equal(d.settingsUpdated, 200);
});

test('two devices editing different things both keep their edits after a round trip', () => {
  const start = data({ reminders: [rem('a', 1)], notes: [note('n', 1, 'v1')] });
  const A = plain(start), B = plain(start), baseA = makeBase(A), baseB = makeBase(B);
  A.reminders[0].title = 'A edit'; stampChanges(A, baseA, 100);
  B.notes[0].text = 'B edit'; stampChanges(B, baseB, 110);
  const file = mergeData(A, B, NOW);           // A writes, B merges the file, B writes
  const finalA = mergeData(A, file, NOW);
  assert.equal(finalA.reminders[0].title, 'A edit');
  assert.equal(finalA.notes[0].text, 'B edit');
  assert.equal(syncKey(finalA), syncKey(mergeData(B, file, NOW)));
});
