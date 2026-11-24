// Natural-language quick add and cron (PARSER block). Run with TZ=Europe/Stockholm (npm test does this).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.TZ = 'Europe/Stockholm';   // the expected times below are Swedish local times

const SRC = process.env.PING_HTML || new URL('../index.html', import.meta.url);
const html = fs.readFileSync(SRC, 'utf8');
const a = html.indexOf('/*PARSER-START*/'), b = html.indexOf('/*PARSER-END*/');
assert.ok(a > 0 && b > a, 'parser markers not found');
const block = html.slice(a, b);
const ctx = vm.createContext({ Date, Math, Set, Error, String, RegExp, parseInt, parseFloat, isNaN, Object, Array, Number });
vm.runInContext(block + '\n;globalThis.__x = { ParserText, Cron, QuickParser };', ctx);
const { ParserText, Cron, QuickParser } = ctx.__x;

assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Europe/Stockholm', 'run with TZ=Europe/Stockholm');

const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = new Date(2026, 10, 23, 10, 0, 0); // Mon 2026-11-23 10:00 local
const P = (s, now = NOW) => QuickParser.parse(s, now);
const when = (s, now) => { const r = P(s, now); return r.when ? r.when.getTime() : null; };
const fmt = ms => ms == null ? null : new Date(ms).toString();
const eqWhen = (s, exp, now) => assert.equal(fmt(when(s, now)), fmt(exp), s);

describe('basic English/Swedish', () => {
  test('tomorrow / imorgon', () => {
    eqWhen('call bob tomorrow', L(2026, 11, 24, 9));
    eqWhen('ring bob imorgon 18', L(2026, 11, 24, 18));
    eqWhen('ring bob i morgon kl 14.30', L(2026, 11, 24, 14, 30));
    eqWhen('x day after tomorrow at 3pm', L(2026, 11, 25, 15));
    eqWhen('x i övermorgon', L(2026, 11, 25, 9));
    assert.equal(P('Review PR DATA-142 tomorrow 10:00 #review').title, 'Review PR DATA-142');
  });
  test('relative', () => {
    eqWhen('tea in 45 min', L(2026, 11, 23, 10, 45));
    eqWhen('te om 2 timmar', L(2026, 11, 23, 12));
    eqWhen('te om en halvtimme', L(2026, 11, 23, 10, 30));
    eqWhen('x in an hour', L(2026, 11, 23, 11));
    eqWhen('x om 3 dagar', L(2026, 11, 26, 10));
    eqWhen('x in 2 weeks', L(2026, 12, 7, 10));
    eqWhen('x om 1 månad', L(2026, 12, 23, 10));
    assert.equal(P('te om 2 timmar').title, 'Te');
  });
  test('relative month from Jan 31 clamps to month end', () => {
    eqWhen('x in 1 month', L(2027, 2, 28, 10), new Date(2027, 0, 31, 10));
  });
  test('relative days with explicit time keeps the time', () => {
    eqWhen('x in 2 days at 9', L(2026, 11, 25, 9));
    eqWhen('x om 2 dagar kl 14', L(2026, 11, 25, 14));
  });
  test('relative days across DST keep wall-clock time', () => {
    // 2027-03-28 is spring-forward in Stockholm
    eqWhen('x in 2 days', L(2027, 3, 29, 10), new Date(2027, 2, 27, 10));
  });
  test('weekdays', () => {
    eqWhen('möte på torsdag kl 13', L(2026, 11, 26, 13));
    eqWhen('x on friday 14:00', L(2026, 11, 27, 14));
    eqWhen('x monday 9', L(2026, 11, 30, 9)); // today 10:00 > 9 -> next week
    eqWhen('x monday 11', L(2026, 11, 23, 11));
    eqWhen('x on sat', L(2026, 11, 28, 9));
    eqWhen('x sunday', L(2026, 11, 29, 9));
    eqWhen('x on sun', L(2026, 11, 29, 9));
    eqWhen('x next monday 15:00', L(2026, 11, 30, 15));
    assert.equal(P('möte på torsdag kl 13').title, 'Möte');
  });
  test('dates', () => {
    eqWhen('x 25/11', L(2026, 11, 25, 9));
    eqWhen('x 20/11', L(2027, 11, 20, 9));
    eqWhen('x 25 november kl 8', L(2026, 11, 25, 8));
    eqWhen('x nov 30th', L(2026, 11, 30, 9));
    eqWhen('x 2026-12-31 23:59', L(2026, 12, 31, 23, 59));
    eqWhen('x 31/12 23:59', L(2026, 12, 31, 23, 59));
    eqWhen('x 1/1', L(2027, 1, 1, 9));
    assert.equal(when('x 31/02'), null);
    assert.equal(when('x 30/2'), null);
  });
  test('time before date in Swedish style', () => {
    eqWhen('möte 14.30 25/11', L(2026, 11, 25, 14, 30));
    assert.equal(P('möte 14.30 25/11').title, 'Möte');
  });
  test('Feb 29 without year picks next leap year', () => {
    eqWhen('x 29/2', L(2028, 2, 29, 9));
    eqWhen('x 29/2', L(2032, 2, 29, 9), new Date(2028, 2, 10, 10)); // March 2028
    eqWhen('x 2028-02-29', L(2028, 2, 29, 9));
    assert.equal(when('x 2027-02-29'), null);
  });
  test('UTC', () => {
    eqWhen('deploy friday 14:00 UTC', Date.UTC(2026, 10, 27, 14));
    eqWhen('x 9:00 utc', Date.UTC(2026, 10, 24, 9)); // 10:00 local = 09:00Z, passed
    // now = 2026-11-24 00:30 local = 2026-11-23 23:30Z; 23:45Z is 15 min away
    eqWhen('x 23:45 UTC', Date.UTC(2026, 10, 23, 23, 45), new Date(2026, 10, 24, 0, 30));
  });
  test('times', () => {
    eqWhen('x at 12am', L(2026, 11, 24, 0));
    eqWhen('x at 12pm', L(2026, 11, 23, 12));
    eqWhen('x 9am', L(2026, 11, 24, 9));
    eqWhen('x kl 9', L(2026, 11, 24, 9)); // passed -> tomorrow
    eqWhen('x kl 23:59', L(2026, 11, 23, 23, 59));
    eqWhen('x 00:00', L(2026, 11, 24, 0));
    eqWhen('x at noon', L(2026, 11, 23, 12));
    eqWhen('x tonight at 8', L(2026, 11, 23, 20));
    eqWhen('x ikväll', L(2026, 11, 23, 19));
    eqWhen('x 23:59', L(2026, 11, 24, 23, 59), new Date(2026, 10, 23, 23, 59, 30));
    eqWhen('x 23:59', L(2027, 1, 1, 23, 59), new Date(2026, 11, 31, 23, 59, 30));
  });
  test('invalid times are not silently swallowed', () => {
    const r = P('x tomorrow 25:00');
    assert.ok(r.title.includes('25'), 'title=' + r.title);
    const r2 = P('x at 25:00');
    assert.ok(r2.title.includes('25:00'));
  });
});

describe('repeats', () => {
  test('intervals', () => {
    let r = P('Check pipeline runs every 30 min #etl !!');
    assert.equal(r.repeat, 'interval'); assert.equal(r.every, 30);
    assert.deepEqual([...r.tags], ['etl']); assert.equal(r.priority, 2);
    assert.equal(r.title, 'Check pipeline runs');
    eqWhen('x every 30 min', L(2026, 11, 23, 10, 30));
    r = P('x varje timme'); assert.equal(r.every, 60);
    r = P('x var 2 t'); assert.equal(r.every, 120);
    r = P('x every 1.5h'); assert.equal(r.every, 90);
  });
  test('calendar repeats', () => {
    let r = P('standup every weekday kl 9');
    assert.equal(r.repeat, 'weekdays'); assert.equal(fmt(r.when.getTime()), fmt(L(2026, 11, 24, 9)));
    assert.equal(r.title, 'Standup');
    r = P('x every weekday kl 9', new Date(2026, 10, 27, 10)); // Fri after 9
    assert.equal(fmt(r.when.getTime()), fmt(L(2026, 11, 30, 9)));
    r = P('x varje fredag kl 15'); assert.equal(r.repeat, 'weekly');
    assert.equal(fmt(r.when.getTime()), fmt(L(2026, 11, 27, 15)));
    r = P('x every sat'); assert.equal(r.repeat, 'weekly');
    assert.equal(fmt(r.when.getTime()), fmt(L(2026, 11, 28, 9)));
    r = P('x dagligen kl 7'); assert.equal(r.repeat, 'daily');
    r = P('x every month'); assert.equal(r.repeat, 'monthly');
  });
  test('cron', () => {
    let r = P('Standup cron `45 8 * * 1-5`');
    assert.equal(r.repeat, 'cron'); assert.equal(r.cron, '45 8 * * 1-5'); assert.equal(r.title, 'Standup');
    assert.equal(fmt(r.when.getTime()), fmt(L(2026, 11, 24, 8, 45)));
    r = P('x cron 0 9 * * mon-fri report'); assert.equal(r.cron, '0 9 * * mon-fri'); assert.equal(r.title, 'X report');
    r = P('x cron `0 9 * *`'); assert.ok(r.error);
  });
  test('word "cron" in a plain title is not an error', () => {
    const r = P('review cron job and fix all tests');
    assert.equal(r.error, null, String(r.error));
  });
});

describe('Cron.next', () => {
  const N = (e, now) => fmt(Cron.next(e, now));
  const now = L(2026, 11, 23, 10);
  test('basics', () => {
    assert.equal(N('*/15 * * * *', now), fmt(L(2026, 11, 23, 10, 15)));
    assert.equal(N('0 0 1 * *', now), fmt(L(2026, 12, 1)));
    assert.equal(N('0 9 * * 0', now), fmt(L(2026, 11, 29, 9)));
    assert.equal(N('0 9 * * 7', now), fmt(L(2026, 11, 29, 9)));
    assert.equal(N('0 9 * * 5-7', now), fmt(L(2026, 11, 27, 9)));
    assert.equal(N('0 9,17 * * *', now), fmt(L(2026, 11, 23, 17)));
    assert.equal(N('0 0 29 2 *', now), fmt(L(2028, 2, 29)));
    assert.equal(N('0 0 31 * *', now), fmt(L(2026, 12, 31)));
    assert.equal(N('0 0 30 2 *', now), null);
    assert.equal(N('59 23 31 12 *', L(2026, 12, 31, 23, 59)), fmt(L(2027, 12, 31, 23, 59)));
    assert.equal(N('1-10/3 * * * *', now), fmt(L(2026, 11, 23, 10, 1)));
    assert.equal(N('5/20 * * * *', now), fmt(L(2026, 11, 23, 10, 5)));
  });
  test('dom/dow OR semantics', () => {
    // 1st of month OR friday
    assert.equal(N('0 9 1 * 5', now), fmt(L(2026, 11, 27, 9)));
    assert.equal(N('0 9 1 * 5', L(2026, 11, 27, 10)), fmt(L(2026, 12, 1, 9)));
  });
  test('DST', () => {
    // spring forward 2027-03-28 02:00->03:00; fall back 2026-10-25 03:00->02:00
    assert.equal(N('30 2 * * *', L(2027, 3, 27, 12)) !== null, true);
    assert.equal(N('0 3 * * *', L(2026, 10, 25, 1)), fmt(L(2026, 10, 25, 3)));
    // every 15 min across fall-back: from 02:50 CEST, next should be 15 minutes later in absolute time
    const t0 = Date.UTC(2026, 9, 25, 0, 50); // 02:50 CEST
    assert.equal(Cron.next('*/15 * * * *', t0), Date.UTC(2026, 9, 25, 1, 0)); // 02:00 CET
  });
  test('parse errors', () => {
    assert.throws(() => Cron.parse('60 * * * *'));
    assert.throws(() => Cron.parse('* 24 * * *'));
    assert.throws(() => Cron.parse('* * 0 * *'));
    assert.throws(() => Cron.parse('* * * 13 *'));
    assert.throws(() => Cron.parse('* * * * 8'));
    assert.throws(() => Cron.parse('*/0 * * * *'));
    assert.throws(() => Cron.parse('*/1.5 * * * *'));
    assert.throws(() => Cron.parse('5-1 * * * *'));
    assert.throws(() => Cron.parse('* * * *'));
    assert.throws(() => Cron.parse('foo * * * *'));
    ParserText.lang = 'sv';
    assert.throws(() => Cron.parse('* * * *'), /5 fält/);
    ParserText.lang = 'en';
  });
});

describe('tags, priority, title', () => {
  test('tags and priority', () => {
    let r = P('#etl #ETL #prod. fix it !!!');
    assert.deepEqual([...r.tags], ['etl', 'prod']); assert.equal(r.priority, 3); assert.equal(r.title, 'Fix it');
    r = P('x p1'); assert.equal(r.priority, 3);
    r = P('x p3'); assert.equal(r.priority, 1);
    r = P('x !'); assert.equal(r.priority, 1);
    r = P('#only #tags'); assert.equal(r.title, ''); assert.equal(r.when, null);
    r = P(''); assert.equal(r.title, ''); assert.equal(r.when, null);
    r = P('   '); assert.equal(r.title, '');
  });
  test('time-looking words in titles', () => {
    let r = P('fix v2.10 release'); assert.equal(r.when, null); assert.equal(r.title, 'Fix v2.10 release');
    r = P('call 112'); assert.equal(r.when, null); assert.equal(r.title, 'Call 112');
    r = P('room 1430'); assert.equal(r.when, null); assert.equal(r.title, 'Room 1430');
    r = P('upgrade to 1.2.3'); assert.equal(r.when, null, 'when=' + r.when); assert.equal(r.title, 'Upgrade to 1.2.3');
    r = P('monitor the fridge'); assert.equal(r.when, null); assert.equal(r.title, 'Monitor the fridge');
  });
  test('stray words', () => {
    assert.equal(P('call mom at 5pm').title, 'Call mom');
    assert.equal(P('call mom on friday at 5pm').title, 'Call mom');
    assert.equal(P('ring mamma kl 17').title, 'Ring mamma');
    assert.equal(P('ring mamma på fredag den 27/11').title, 'Ring mamma');
    assert.equal(P('remind me to call mom tomorrow').title, 'Call mom');
    assert.equal(P('påminn mig om att ringa mamma imorgon').title, 'Ringa mamma');
    assert.equal(P('ring mamma klockan 17').title, 'Ring mamma');
  });
});

describe('short day names only count as days after on/next/every', () => {
  test('prose with "sun" or "sat" is left alone', () => {
    for (const s of ['enjoy the sun', 'she sat down with the team', 'sunny standup']) {
      const r = P(s); assert.equal(r.when, null, s); assert.equal(r.repeat, 'none', s);
    }
  });
  test('"next sat" and "this sun"', () => {
    eqWhen('x next sat', L(2026, 11, 28, 9));
    eqWhen('x this sun 10:00', L(2026, 11, 29, 10));
  });
});

describe('found in the edge-case hunt', () => {
  test('an earlier hour with "tonight"/"ikväll" means the evening', () => {
    eqWhen('x kl 8 ikväll', L(2026, 11, 23, 20));
    eqWhen('x at 8 tonight', L(2026, 11, 23, 20));
    eqWhen('x tonight 9.30', L(2026, 11, 23, 21, 30));
  });
  test('"fri" is Friday only where it reads as a day; "monday.com" is not a day', () => {
    for (const s of ['Boka fri tid', 'fri parkering vid kontoret', 'monday.com review']) assert.equal(P(s).when, null, s);
    assert.equal(P('Boka fri tid').title, 'Boka fri tid');
    eqWhen('standup fri', L(2026, 11, 27, 9));
    eqWhen('standup fri 10:00', L(2026, 11, 27, 10));
    eqWhen('x on fri', L(2026, 11, 27, 9));
    assert.equal(P('x every fri at 9').repeat, 'weekly');
  });
  test('dotted times with am/pm', () => {
    eqWhen('call 9.30pm', L(2026, 11, 23, 21, 30));
    assert.equal(P('call 9.30pm').title, 'Call');
    eqWhen('x 11.45pm', L(2026, 11, 23, 23, 45));
  });
  test('cron never goes backwards when the clocks go back (2026-10-25)', () => {
    const z = s => Date.UTC(2026, 9, 25, ...s);
    for (const [expr, from] of [['0 * * * *', z([1, 0])], ['*/30 * * * *', z([1, 0])], ['*/30 * * * *', z([0, 30])], ['15 2 * * *', z([0, 20])]]) {
      let t = from;
      for (let k = 0; k < 6; k++) { const n = Cron.next(expr, t); assert.ok(n > t, `${expr} after ${new Date(t).toISOString()} gave ${new Date(n).toISOString()}`); t = n; }
    }
    // the hourly job runs at every real hour, including the second 02:00 (01:00 UTC)
    const runs = []; let t = z([-1, 30]); for (let k = 0; k < 5; k++) { t = Cron.next('0 * * * *', t); runs.push(new Date(t).toISOString().slice(11, 16)); }
    assert.deepEqual(runs, ['00:00', '01:00', '02:00', '03:00', '04:00']);   // UTC: 01:00Z is the second 02:00 local
  });
});
