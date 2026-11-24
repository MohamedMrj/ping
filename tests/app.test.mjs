// End-to-end and in-page unit tests: the real index.html in a real browser (Chrome, Edge or Playwright's Chromium).
// Every test gets a fresh browser profile, so nothing here touches anyone's real Ping data.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
let server, base, browser;

function findBrowser() {
  if (process.env.PING_BROWSER) return { executablePath: process.env.PING_BROWSER };
  const pw = join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (existsSync(pw)) for (const d of readdirSync(pw).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) if (existsSync(join(pw, d, exe))) return { executablePath: join(pw, d, exe) };
  }
  return { channel: 'msedge' };
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html');
    try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch(findBrowser());
});
after(async () => { await browser?.close(); server?.close(); });

// A fresh profile with Ping open. `seed` is put in localStorage before Ping starts.
async function open({ seed, lang = 'sv', tz = 'Europe/Stockholm', onboarded = true, init } = {}) {
  const ctx = await browser.newContext({ timezoneId: tz, serviceWorkers: 'block' });
  const errors = [];
  if (seed !== undefined || onboarded || lang) {
    await ctx.addInitScript(([seed, lang, onboarded]) => {
      if (sessionStorage.getItem('seeded')) return;        // only on the first load, so reloads show what Ping saved
      sessionStorage.setItem('seeded', '1');
      if (typeof seed === 'string') localStorage.setItem('reminder-by-me.v1', seed);
      else {
        const d = seed || {};
        d.settings = Object.assign({ lang, onboarded, driveGuideSeen: onboarded }, d.settings || {});
        localStorage.setItem('reminder-by-me.v1', JSON.stringify(d));
      }
    }, [seed, lang, onboarded]);
  }
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());                      // confirm() boxes: say yes
  await page.goto(base);
  await page.waitForFunction(() => typeof isActiveWindow !== 'undefined' && isActiveWindow && fileInitDone);
  return { ctx, page, errors };
}
const tab = (page, name) => page.click(`.tabs [data-tab="${name}"]`);
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('reminder-by-me.v1')));

// ------------------------------------------------------------------ start-up and every screen
test('Ping starts without errors and every tab and dialog opens, in Swedish and English', async () => {
  for (const lang of ['sv', 'en']) {
    const { ctx, page, errors } = await open({ lang });
    for (const k of ['notes', 'settings', 'reminders']) { await tab(page, k); await page.waitForTimeout(50); }
    await page.evaluate(() => { openStartupGuide(); });
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#startupDlg'), true, 'Escape closes the startup guide');
    await page.evaluate(() => { openSetup(0, true); });
    assert.equal(await page.isVisible('#setupStep0'), true);
    await page.click('[data-act="setup-drive-next"]');
    assert.equal(await page.isVisible('#setupStep1'), true);
    await page.click('#setupStep1 [data-act="setup-skip"]');
    assert.equal(await page.isVisible('#setupStep2'), true);
    await page.click('#setupStep2 [data-act="setup-done"]:visible');
    assert.equal(await page.isHidden('#setupDlg'), true);
    assert.deepEqual(errors, [], lang);
    await ctx.close();
  }
});

test('every text has both languages: no missing translations and no untranslated keys on screen', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const src = [...document.scripts].map(s => s.textContent).join('\n');
    const used = new Set([...src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('_')));   // 'snd_' + id and the like are prefixes
    const staticKeys = new Set([...document.querySelectorAll('[data-i18n],[data-i18n-ph],[data-i18n-title],[data-i18n-aria]')]
      .flatMap(el => ['data-i18n', 'data-i18n-ph', 'data-i18n-title', 'data-i18n-aria'].map(a => el.getAttribute(a)).filter(Boolean)));
    return {
      dynMissingSv: [...used].filter(k => !(k in T.sv)),
      dynMissingEn: [...used].filter(k => !(k in T.en)),
      staticMissingEn: [...staticKeys].filter(k => !(k in T.en)),
    };
  });
  assert.deepEqual(r.dynMissingEn, [], 'used with t() but missing in T.en');
  assert.deepEqual(r.staticMissingEn, [], 'data-i18n key without English');
  assert.deepEqual(r.dynMissingSv, [], 'used with t() but missing in T.sv (would show English in the Swedish app)');
  await ctx.close();
});

// ------------------------------------------------------------------ the Google Drive / OneDrive guide
test('a new person sees the cloud-folder guide first, with Google Drive and OneDrive steps', async () => {
  const { ctx, page, errors } = await open({ onboarded: false });
  await page.waitForSelector('#setupStep0', { state: 'visible' });
  assert.match(await page.textContent('#setupStep0 .step'), /1 av 3/);
  assert.equal(await page.isVisible('[data-cloud="gdrive"]'), true);
  assert.equal(await page.isHidden('[data-cloud="onedrive"]'), true);
  assert.match(await page.textContent('[data-cloud="gdrive"]'), /google\.com\/drive\/download/);
  await page.click('[data-cloud-set="onedrive"]');
  assert.equal(await page.isVisible('[data-cloud="onedrive"]'), true);
  assert.equal(await page.isHidden('[data-cloud="gdrive"]'), true);
  assert.match(await page.textContent('[data-cloud="onedrive"]'), /Behåll alltid på den här enheten/);
  assert.equal((await stored(page)).settings.cloud, 'onedrive', 'the choice is remembered');
  // English
  await page.evaluate(() => { S.settings.lang = 'en'; applyLang(); });
  assert.match(await page.textContent('[data-cloud="onedrive"]'), /Always keep on this device/);
  assert.match(await page.textContent('#setupStep0 .step'), /Step 1 of 3/);
  await page.click('[data-act="setup-drive-next"]');
  assert.equal(await page.isVisible('#setupStep1'), true);
  assert.match(await page.textContent('#setupStep1 .step'), /Step 2 of 3/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('people set up before the guide existed (no save file) see it once, then never again', async () => {
  const { ctx, page } = await open({ seed: { reminders: [], notes: [], settings: { onboarded: true } }, onboarded: true, lang: 'sv',
    init: () => { /* simulate an old profile: driveGuideSeen missing */ } });
  // the seed helper sets driveGuideSeen = onboarded, so clear it and re-run onboarding as on an old profile
  await page.evaluate(() => { delete S.settings.driveGuideSeen; $('setupDlg').hidden = true; maybeOnboard(); });
  const supportsFiles = await page.evaluate(() => fileApi);
  if (supportsFiles) {
    assert.equal(await page.isVisible('#setupStep0'), true);
    await page.evaluate(() => finishSetup());
    await page.reload(); await page.waitForFunction(() => isActiveWindow && fileInitDone);
    await page.waitForTimeout(200);
    assert.equal(await page.isHidden('#setupDlg'), true);
  }
  await ctx.close();
});

test('Settings has a button that opens the guide', async () => {
  const { ctx, page } = await open();
  await tab(page, 'settings');
  await page.click('[data-act="setup-open-wizard"]');
  assert.equal(await page.isVisible('#setupStep0'), true);
  await ctx.close();
});

// ------------------------------------------------------------------ saving in the browser
test('a reminder typed in quick add survives a reload', async () => {
  const { ctx, page } = await open();
  await page.fill('#quickInput', 'Ring Anna imorgon 10:00 #jobb !!');
  await page.press('#quickInput', 'Enter');
  await page.reload(); await page.waitForFunction(() => isActiveWindow);
  const d = await stored(page);
  assert.equal(d.reminders.length, 1);
  assert.equal(d.reminders[0].title, 'Ring Anna');
  assert.deepEqual(d.reminders[0].tags, ['jobb']);
  assert.equal(d.reminders[0].priority, 2);
  assert.match(await page.textContent('#groups'), /Ring Anna/);
  await ctx.close();
});

test('unreadable browser data is kept aside, not overwritten', async () => {
  const broken = '{"reminders":[{"id":"a","title":"important"'; // cut off half way
  const { ctx, page } = await open({ seed: broken });
  await page.waitForTimeout(300);
  const kept = await page.evaluate(async () => { const keys = (await kv.keys()).map(String).filter(k => k.startsWith('unreadable-')); return keys.length ? kv.get(keys[0]) : null; });
  assert.equal(kept, broken);
  await ctx.close();
});

test('when browser storage is full, old note versions are thinned out and saving still works', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === KEY && v.length > 2500) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return real.call(this, k, v); };
    S.notes.push({ id: 'n1', text: 'x', created: 1, modified: 1, history: Array.from({ length: 8 }, (_, i) => ({ t: i, text: 'v'.repeat(400) })) });
    save();
    const ok = { err: lastSaveError, hist: S.notes[0].history.length };
    Storage.prototype.setItem = real;
    return ok;
  });
  assert.equal(r.err, '');
  assert.ok(r.hist < 8);
  await ctx.close();
});

test('when storage stays full, the header says “Not saved!” and it recovers afterwards', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k) { if (k === KEY) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
    S.reminders.push(newReminder({ title: 'x' })); save();
    const bad = $('saveChip').classList.contains('bad');
    Storage.prototype.setItem = real; save();
    return { bad, after: $('saveChip').classList.contains('bad') };
  });
  assert.deepEqual(r, { bad: true, after: false });
  await ctx.close();
});

test('daily copies are named after the local date, not the UTC date', async () => {
  const { ctx, page } = await open({ tz: 'Pacific/Kiritimati', seed: { reminders: [{ id: 'a', title: 'x', due: Date.now() + 3600e3, repeat: 'none', tags: [] }], notes: [] } });
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => ({ keys: (await kv.keys()).map(String).filter(k => k.startsWith('snap-')), local: isoDate(new Date()) }));
  assert.deepEqual(r.keys, ['snap-' + r.local]);
  await ctx.close();
});

// ------------------------------------------------------------------ restore and undo
test('restore from backup: "add" keeps everything and adds what is missing; "replace" can be undone', async () => {
  const { ctx, page } = await open({ seed: { reminders: [{ id: 'mine', title: 'mine', due: Date.now() + 1e6, repeat: 'none', tags: [] }], notes: [] } });
  const r = await page.evaluate(async () => {
    const backup = { reminders: [{ id: 'old', title: 'from backup', due: Date.now() + 1e6, repeat: 'none', tags: [] }], notes: [{ id: 'n', text: 'note from backup' }] };
    pendingRestore = backup; document.querySelector('input[name=restoreMode][value=add]').checked = true; await doRestore();
    const added = S.reminders.map(x => x.id).sort().join() + '|' + S.notes.length;
    pendingRestore = backup; document.querySelector('input[name=restoreMode][value=replace]').checked = true; await doRestore();
    const replaced = S.reminders.map(x => x.id).sort().join();
    $('toastAct').click();                     // Undo
    return { added, replaced, undone: S.reminders.map(x => x.id).sort().join() };
  });
  assert.equal(r.added, 'mine,old|1');
  assert.equal(r.replaced, 'old');
  assert.equal(r.undone, 'mine,old');
  await ctx.close();
});

// ------------------------------------------------------------------ the save file (Google Drive / OneDrive folder)
// A stand-in for a file the person picked: behaves like the browser's file handle.
const FAKE_FILE = () => {
  window.makeFile = (text, opts = {}) => {
    const f = { text, writes: 0, name: 'Ping-data.json', perm: 'granted', fail: null };
    f.queryPermission = async () => f.perm;
    f.requestPermission = async () => (f.perm = 'granted');
    f.getFile = async () => { if (f.fail) { const e = new Error(f.fail); e.name = f.fail; throw e; } return { text: async () => f.text }; };
    f.createWritable = async () => { let buf = ''; return { write: async s => { buf += s; }, close: async () => { f.text = buf; f.writes++; } }; };
    return Object.assign(f, opts);
  };
};

test('the save file merges two computers: nothing from either side is lost', async () => {
  const now = Date.now();
  const { ctx, page } = await open({ init: FAKE_FILE, seed: { reminders: [{ id: 'here', title: 'on this PC', due: now + 1e6, repeat: 'none', tags: [], updated: now }], notes: [] } });
  const r = await page.evaluate(async now => {
    const other = { reminders: [{ id: 'there', title: 'on the other PC', due: now + 2e6, repeat: 'none', tags: [], updated: now }], notes: [{ id: 'n', text: 'note from the other PC', updated: now }] };
    const f = makeFile(JSON.stringify(other));
    fileHandle = f; fileState = 'ok'; await syncFile();
    const inFile = JSON.parse(f.text);
    return { here: S.reminders.map(x => x.id).sort().join(), file: inFile.reminders.map(x => x.id).sort().join(), notes: inFile.notes.length, state: fileState };
  }, now);
  assert.deepEqual(r, { here: 'here,there', file: 'here,there', notes: 1, state: 'ok' });
  await ctx.close();
});

test('a half-synced save file is never overwritten, and Ping says it will retry', async () => {
  const { ctx, page } = await open({ init: FAKE_FILE });
  const r = await page.evaluate(async () => {
    const f = makeFile('{"reminders":[{"id":"a"'); fileHandle = f; fileState = 'ok';
    S.reminders.push(newReminder({ title: 'x' })); save(); await syncFile();
    return { writes: f.writes, text: f.text, state: fileState, kind: fileErrKind, chip: $('saveChipText').textContent };
  });
  assert.equal(r.writes, 0);
  assert.equal(r.text, '{"reminders":[{"id":"a"');
  assert.equal(r.kind, 'unreadable');
  assert.match(r.chip, /försöker igen/);
  await ctx.close();
});

test('a moved or deleted save file shows the banner, and lost permission only asks for a click', async () => {
  const { ctx, page } = await open({ init: FAKE_FILE });
  const r = await page.evaluate(async () => {
    const f = makeFile('{}', { fail: 'NotFoundError' }); fileHandle = f; fileState = 'ok'; await syncFile();
    const gone = { banner: !$('fileBanner').hidden, kind: fileErrKind };
    f.fail = null; f.perm = 'prompt'; fileState = 'ok'; await syncFile();
    return { gone, needs: fileState, chip: $('saveChipText').textContent };
  });
  assert.deepEqual(r.gone, { banner: true, kind: 'gone' });
  assert.equal(r.needs, 'needs-permission');
  assert.match(r.chip, /klick/);
  await ctx.close();
});

test('a file that is not a Ping save file is refused when opened', async () => {
  const { ctx, page } = await open({ init: FAKE_FILE });
  const r = await page.evaluate(async () => { const f = makeFile('{"hello":1}'); await useFile(f, true); return { used: fileHandle === f, writes: f.writes }; });
  assert.deepEqual(r, { used: false, writes: 0 });
  await ctx.close();
});

// ------------------------------------------------------------------ when reminders go off
test('monthly and yearly repeats keep their day (31st, 29 Feb) instead of drifting', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const L = (y, m, d, h = 9) => new Date(y, m - 1, d, h).getTime(), D = ms => isoDate(new Date(ms));
    const rm = { repeat: 'monthly', monthDay: 31 }, out = [];
    let due = L(2027, 1, 31);
    for (let i = 0; i < 4; i++) { due = nextAfter(rm, due, due); out.push(D(due)); }
    const ry = { repeat: 'yearly', monthDay: 29 }; let y = L(2028, 2, 29); const years = [];
    for (let i = 0; i < 4; i++) { y = nextAfter(ry, y, y); years.push(D(y)); }
    const caught = D(nextAfter({ repeat: 'monthly', monthDay: 31 }, L(2027, 1, 31), L(2027, 3, 15)));
    const old = D(nextAfter({ repeat: 'monthly' }, L(2027, 1, 30), L(2027, 1, 30)));
    return { out, years, caught, old, hour: new Date(nextAfter(rm, L(2027, 3, 1, 9), L(2027, 3, 1, 9))).getHours() };
  });
  assert.deepEqual(r.out, ['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  assert.deepEqual(r.years, ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  assert.equal(r.caught, '2027-03-31');          // missed while closed: jumps to the next one after now
  assert.equal(r.old, '2027-02-28');             // reminders saved before monthDay existed
  assert.equal(r.hour, 9);                       // across the change to summer time
  await ctx.close();
});

test('daily, weekday, weekly and interval repeats', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const L = (y, m, d, h = 9, mi = 0) => new Date(y, m - 1, d, h, mi).getTime(), F = ms => new Date(ms).toString().slice(0, 21);
    return {
      dailyDst: F(nextAfter({ repeat: 'daily' }, L(2027, 3, 27), L(2027, 3, 27))),
      weekdayFri: F(nextAfter({ repeat: 'weekdays' }, L(2026, 11, 27), L(2026, 11, 27))),
      weekly: F(nextAfter({ repeat: 'weekly' }, L(2026, 11, 23), L(2026, 12, 1))),
      interval: F(nextAfter({ repeat: 'interval', every: 30 }, L(2026, 11, 23, 9), L(2026, 11, 23, 10, 5))),
    };
  });
  assert.equal(r.dailyDst, 'Sun Mar 28 2027 09:00');
  assert.equal(r.weekdayFri, 'Mon Nov 30 2026 09:00');
  assert.equal(r.weekly, 'Mon Dec 07 2026 09:00');
  assert.equal(r.interval, 'Mon Nov 23 2026 10:30');
  await ctx.close();
});

test('a reminder fires once, is marked overdue, and does not fire again after a reload', async () => {
  const { ctx, page } = await open({ seed: { reminders: [{ id: 'r', title: 'Due now', due: Date.now() - 1000, repeat: 'none', tags: [], fired: false, done: false, snoozeUntil: null }], notes: [] } });
  await page.waitForSelector('.alert');
  assert.match(await page.textContent('.alert'), /Due now/);
  const d = await stored(page);
  assert.equal(d.reminders[0].fired, true);
  await page.reload(); await page.waitForFunction(() => isActiveWindow);
  await page.evaluate(() => check());
  assert.equal(await page.locator('.alert').count(), 0);
  assert.match(await page.textContent('#groups'), /Försenade/);
  await ctx.close();
});

test('snoozing a reminder before it goes off moves it: it does not also go off at the old time', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const fired = []; window.fire = (x, at) => fired.push(at);
    const rem = newReminder({ title: 'later', due: Date.now() + 60000 }); S.reminders.push(rem); save();
    snooze(rem, Date.now() + 3600000);
    rem.due = Date.now() - 1; check();            // the old time passes
    const atOld = fired.length;
    rem.snoozeUntil = Date.now() - 1; check();    // the snooze time passes
    return { atOld, total: fired.length, overdue: isOverdue(rem) };
  });
  assert.deepEqual(r, { atOld: 0, total: 1, overdue: true });
  await ctx.close();
});

test('a repeating reminder missed while Ping was closed fires once and moves to the next time', async () => {
  const day = 86400000;
  const { ctx, page } = await open({ seed: { reminders: [{ id: 'd', title: 'daily', due: Date.now() - 3 * day - 1000, repeat: 'daily', tags: [], fired: false, done: false, snoozeUntil: null }], notes: [] } });
  await page.waitForSelector('.alert');
  assert.equal(await page.locator('.alert').count(), 1);
  const d = await stored(page);
  assert.ok(d.reminders[0].due > Date.now() && d.reminders[0].due <= Date.now() + day);
  await ctx.close();
});

// ------------------------------------------------------------------ showing text safely
test('titles, notes and Markdown can never run code or inject HTML', async () => {
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  const { ctx, page } = await open({ seed: { reminders: [{ id: 'x', title: evil, notes: evil, due: Date.now() - 1000, repeat: 'none', tags: ['<b>'], fired: false }], notes: [{ id: 'n', text: '# ' + evil + '\n\n' + evil + '\n\n[click](javascript:alert(1)) ![a](javascript:alert(1))\n\n```html\n' + evil + '\n```', modified: Date.now() }] } });
  await page.waitForSelector('.alert');
  await tab(page, 'notes');
  await page.evaluate(() => setNoteView('split'));
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('#notePreview a[href^="javascript"], #notePreview img[src^="javascript"]').count(), 0);
  assert.equal(await page.locator('#groups img, .alert img, #notePreview img, #noteHl img').count(), 0);
  await ctx.close();
});

test('links keep their underscores and stars; formatting around them still works', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const box = document.createElement('div');
    box.innerHTML = inlineMd('see https://example.com/_a_/b*c*d and **bold** _it_ #tag https://x.se/#frag');
    return { hrefs: [...box.querySelectorAll('a')].map(a => a.getAttribute('href')), bold: box.querySelector('strong')?.textContent, em: box.querySelector('em')?.textContent, tags: box.querySelectorAll('.ntag').length };
  });
  assert.deepEqual(r.hrefs, ['https://example.com/_a_/b*c*d', 'https://x.se/#frag']);
  assert.equal(r.bold, 'bold');
  assert.equal(r.em, 'it');
  assert.equal(r.tags, 1);
  await ctx.close();
});

// ------------------------------------------------------------------ Outlook calendar file
test('calendar lines are at most 75 bytes and never split a letter or emoji', async () => {
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const line = 'SUMMARY:' + 'Möte med Åsa 🎉 och Örjan – planering '.repeat(6);
    const folded = fold(line), parts = folded.split('\r\n'), enc = new TextEncoder();
    return { max: Math.max(...parts.map(p => enc.encode(p).length)), back: parts.map((p, i) => i ? p.slice(1) : p).join('') === line, lone: /[\ud800-\udbff](?![\udc00-\udfff])/.test(folded), short: fold('SUMMARY:x') };
  });
  assert.ok(r.max <= 75, 'line too long: ' + r.max);
  assert.equal(r.back, true);
  assert.equal(r.lone, false);
  assert.equal(r.short, 'SUMMARY:x');
  await ctx.close();
});

// ------------------------------------------------------------------ notes
test('notes: typing saves, delete goes to the trash with undo, and history keeps old versions', async () => {
  const { ctx, page } = await open();
  await tab(page, 'notes');
  await page.click('#noteText');
  await page.keyboard.type('# Första\n\nhej');
  await page.waitForTimeout(400);
  let d = await stored(page);
  assert.equal(d.notes.length, 1);
  assert.match(d.notes[0].text, /# Första/);
  await page.click('[data-act="del-note"]');
  d = await stored(page);
  assert.ok(d.notes[0].trashed);
  await page.click('#toastAct');               // Undo
  d = await stored(page);
  assert.ok(!d.notes[0].trashed);
  await ctx.close();
});

// ------------------------------------------------------------------ themes, dark whiteboard, fullscreen
const THEMES = ['lagoon', 'fjord', 'solarized', 'sunset', 'forest', 'candy', 'neon', 'space', 'interstellar', 'nature', 'mountain', 'desert'];

test('settings is a gear icon with a readable name, in Swedish and English', async () => {
  for (const [lang, name] of [['sv', 'Inställningar'], ['en', 'Settings']]) {
    const { ctx, page } = await open({ lang });
    const b = page.locator('.tabs [data-tab="settings"]');
    assert.equal((await b.innerText()).trim(), '', 'no text, just the icon');
    assert.equal(await b.getAttribute('aria-label'), name);
    assert.equal(await b.getAttribute('title'), name);
    await b.click();
    assert.equal(await page.isVisible('#view-settings'), true);
    await ctx.close();
  }
});

test('every theme has its own light and dark colours, and the whiteboard paper follows them', async () => {
  const { ctx, page, errors } = await open({ lang: 'en' });
  await tab(page, 'settings');
  assert.equal(await page.locator('[data-palette-set]:visible').count(), THEMES.length, 'every theme has a button');
  const seen = new Set();
  for (const p of THEMES) {
    await page.click(`[data-palette-set="${p}"]`);
    for (const mode of ['light', 'dark']) {
      await page.click(`[data-theme-set="${mode}"]`);
      const r = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme, pal: wbPal() }));
      assert.equal(r.scheme, mode, `${p} ${mode}: color-scheme`);
      assert.equal(r.pal.dark, mode === 'dark', `${p} ${mode}: the board knows the mode`);
      const lum = Number(/\d+/.exec(r.bg)[0]);   // the red channel is enough to tell light from dark here
      assert.ok(mode === 'light' ? lum > 200 : lum < 60, `${p} ${mode}: background ${r.bg}`);
      assert.match(r.pal.bg, /^rgb/, `${p} ${mode}: the board paper colour is resolved`);
      seen.add(r.bg + '|' + r.pal.bg);
    }
    assert.equal((await stored(page)).settings.palette, p, 'the theme is saved');
  }
  assert.equal(seen.size, THEMES.length * 2, 'no two themes or modes look the same');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('dark whiteboard: drawings are shown in dark-mode colours but stored and exported in their own', async () => {
  const { ctx, page, errors } = await open({ lang: 'en', seed: { reminders: [], notes: [], settings: { theme: 'dark' } } });
  await tab(page, 'board');
  await page.waitForFunction(() => wb.board);
  const r = await page.evaluate(() => {
    const it = { id: 'n1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, fill: '#fff3a3', text: 'Hej', z: 1, author: wb.me.cid };
    wb.board.items.n1 = it; wbDraw();
    const exp = wbCanvasImage(), px = exp.getContext('2d').getImageData(Math.round(exp.width / 2), 5 + Math.round(exp.height / 4), 1, 1).data;
    return { dark: wbPal().dark, ink: wbCol('#1e1e1e', true), note: wbCol('#fff3a3', true), light: wbCol('#fff3a3', false), odd: wbCol('#123456', true),
      none: wbCol('none', true), stored: wb.board.items.n1.fill, exportPx: [...px].slice(0, 3) };
  });
  assert.equal(r.dark, true);
  assert.equal(r.ink, '#e9ecef', 'black ink turns light');
  assert.equal(r.note, '#5f5524', 'yellow notes turn deep and soft');
  assert.equal(r.light, '#fff3a3', 'light mode leaves colours alone');
  assert.match(r.odd, /^hsl\(210 65% \d+%\)$/, 'other colours keep their hue');
  assert.ok(Number(/(\d+)%\)$/.exec(r.odd)[1]) > 60, 'and get lighter when they were dark');
  assert.equal(r.none, 'none');
  assert.equal(r.stored, '#fff3a3', 'the board keeps the original colour');
  assert.deepEqual(r.exportPx, [0xff, 0xf3, 0xa3], 'pictures are exported in light colours');
  // switching to light mode while the board is open redraws it with the original colours
  await tab(page, 'settings'); await page.click('[data-theme-set="light"]'); await tab(page, 'board');
  assert.equal(await page.evaluate(() => wbPal().dark), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('whiteboard fullscreen: F and the button toggle it, the list hides until B, Esc and other tabs leave it', async () => {
  const { ctx, page, errors } = await open({ lang: 'en' });
  await tab(page, 'board');
  await page.waitForFunction(() => wb.board);
  await page.focus('#wbStage');
  const state = () => page.evaluate(() => ({ full: wbFull(), side: wbSideShown(), sideVisible: !!$('wb').querySelector('.wb-side').offsetParent,
    rect: $('wb').getBoundingClientRect().toJSON(), vw: innerWidth, vh: innerHeight, pref: localStorage.getItem('ping.wbSide'), label: $('wbFullBtn').getAttribute('aria-label') }));
  let s = await state();
  assert.equal(s.full, false); assert.equal(s.sideVisible, true); assert.equal(s.label, 'Fullscreen');
  await page.keyboard.press('f');
  s = await state();
  assert.equal(s.full, true);
  assert.equal(s.sideVisible, false, 'the list of boards hides in fullscreen');
  assert.equal(Math.round(s.rect.width), s.vw); assert.equal(Math.round(s.rect.height), s.vh);
  assert.equal(s.label, 'Exit fullscreen');
  await page.keyboard.press('b');
  s = await state();
  assert.equal(s.sideVisible, true, 'B shows the list in fullscreen');
  await page.click('#wbSideHide');
  assert.equal((await state()).sideVisible, false, 'the « button hides it again');
  await page.keyboard.press('Escape');
  s = await state();
  assert.equal(s.full, false, 'Esc leaves fullscreen');
  assert.equal(s.sideVisible, true, 'the normal view keeps its own list setting');
  assert.equal(s.pref, null, 'fullscreen does not change the remembered choice');
  // the button, and leaving the tab
  await page.click('#wbFullBtn');
  assert.equal((await state()).full, true);
  await page.evaluate(() => showTab('reminders'));   // e.g. Edit on a reminder that pops up while the board is fullscreen
  assert.equal(await page.evaluate(() => wbFull()), false, 'another tab ends fullscreen');
  // B in the normal view hides the list and remembers it
  await tab(page, 'board'); await page.focus('#wbStage');
  await page.keyboard.press('b');
  s = await state();
  assert.equal(s.sideVisible, false); assert.equal(s.pref, '0');
  assert.equal(await page.getAttribute('#wbSideBtn', 'aria-label'), 'Show your boards');
  assert.deepEqual(errors, []);
  await ctx.close();
});
