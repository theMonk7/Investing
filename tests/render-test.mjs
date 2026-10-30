// jsdom does not execute <script type="module">, so build the DOM from
// index.html and import the modules directly into that global environment.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const BASE = `http://127.0.0.1:${process.env.PORT || 8000}/web/`;
const errors = [];

const html = readFileSync(`${ROOT}/web/index.html`, 'utf8')
  .replace(/<script[^>]*><\/script>/g, '');            // drop CDN + module tags

const vc = new VirtualConsole();
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));
const dom = new JSDOM(html, { url: BASE, pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;

// Expose the browser globals the modules expect.
for (const k of ['window', 'document', 'location', 'Node', 'MouseEvent',
                 'Event', 'HTMLElement', 'getComputedStyle', 'localStorage', 'history']) {
  Object.defineProperty(globalThis, k, {
    value: k === 'window' ? window : window[k], configurable: true, writable: true,
  });
}
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));
globalThis.setInterval = () => 0;                       // no background polling in the test
globalThis.HTMLElement = window.HTMLElement;

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  realFetch(new URL(String(input), BASE).href, init);
window.fetch = globalThis.fetch;

await import(`file://${ROOT}/web/js/app.js`);   // modules from disk, data over HTTP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

const doc = window.document;
const main = doc.querySelector('#main');
if (main.querySelector('.loader')) errors.push('stuck on loader — data never loaded');
const errBanner = main.querySelector('.banner.err');
if (errBanner) errors.push(`error banner: ${errBanner.textContent.slice(0, 200)}`);

const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const views = [...doc.querySelectorAll('#nav [data-view]')].map((b) => b.dataset.view);
const report = [];
const setMarket = async (market) => {
  click([...doc.querySelectorAll('#marketSwitch button')].find((b) => b.dataset.market === market));
  await sleep(150);
};

if (!views.includes('calendar')) errors.push('calendar tab missing from the nav');
if (!doc.querySelector('#syncChip')?.textContent.trim()) errors.push('sync chip is empty');

for (const market of ['IN', 'US']) {
  await setMarket(market);
  for (const v of views) {
    try { click(doc.querySelector(`#nav [data-view="${v}"]`)); }
    catch (e) { errors.push(`${market}/${v} threw: ${e.message}\n${e.stack}`); continue; }
    await sleep(60);
    const nodes = main.querySelectorAll('*').length;
    const chars = main.textContent.trim().length;
    report.push(`${market}/${v.padEnd(10)} nodes=${String(nodes).padStart(5)} chars=${String(chars).padStart(6)}`);
    if (nodes < 25) errors.push(`${market}/${v} rendered almost nothing (${nodes} nodes)`);
    if (/Nothing here yet\.$/.test(main.textContent.trim()) && v !== 'alerts') {
      errors.push(`${market}/${v} rendered only the empty state`);
    }
  }
}

// Stock detail modal (from the Watchlist table).
await setMarket('IN');
click(doc.querySelector('#nav [data-view="watchlist"]'));
await sleep(120);
const row = doc.querySelector('#main tbody tr');
if (!row) { errors.push('no watchlist table row to open'); }
else {
  click(row);
  await sleep(900);
  const m = doc.querySelector('.modal');
  if (!m) errors.push('stock detail modal did not open');
  else {
    const n = m.querySelectorAll('*').length;
    report.push(`stock modal: ${n} nodes, ${m.textContent.length} chars`);
    if (n < 60) errors.push(`stock modal too sparse (${n} nodes)`);
    if (/NaN|undefined|\[object Object\]/.test(m.textContent)) {
      errors.push(`stock modal has bad values: ${m.textContent.match(/.{0,40}(NaN|undefined|\[object Object\]).{0,40}/)[0]}`);
    }
  }
  click(doc.querySelector('.modal-bg .icon-btn'));
}

// Settings modal.
click(doc.querySelector('#settingsBtn'));
await sleep(200);
if (!doc.querySelector('.modal')) errors.push('settings modal did not open');
else report.push(`settings modal: ${doc.querySelector('.modal').querySelectorAll('*').length} nodes`);
click(doc.querySelector('.modal-bg .icon-btn'));

// Watchlist add/remove (localStorage path only — no GitHub token configured).
click(doc.querySelector('#nav [data-view="watchlist"]'));
await sleep(150);
const rowsNow = () => doc.querySelectorAll('#main tbody tr').length;
const before = rowsNow();
const input = doc.querySelector('#addSym');
input.value = 'zzwipro';            // lower case, no suffix: becomes ZZWIPRO.NS
click([...doc.querySelectorAll('#main .btn.primary')].find((b) => b.textContent.includes('Add')));
await sleep(300);
const after = rowsNow();
report.push(`watchlist rows: ${before} -> ${after}`);
if (after !== before + 1) errors.push(`add symbol did not add a table row (${before} -> ${after})`);
const added = [...doc.querySelectorAll('#main tbody tr')].find((tr) => tr.textContent.includes('ZZWIPRO'));
if (!added) errors.push('added ticker not shown in the table');
else {
  if (!/No data yet|Fetching…/.test(added.textContent)) errors.push(`new ticker placeholder missing: ${added.textContent}`);
  click(added);
  await sleep(200);
  if (!doc.querySelector('.modal')) errors.push('modal for a ticker without data did not open');
  click(doc.querySelector('.modal-bg .icon-btn'));
  click(added.querySelector('.icon-x'));
  await sleep(200);
  if (rowsNow() !== before) errors.push(`remove did not drop the row (${rowsNow()} vs ${before})`);
  if (doc.querySelector('.modal')) errors.push('remove button also opened the row modal');
}

// Calendar: windows, scope, ticker filter.
click(doc.querySelector('#nav [data-view="calendar"]'));
await sleep(150);
const evRows = () => doc.querySelectorAll('#main .ev-row').length;
if (doc.querySelector('#main .calendar .seg')) {
  click(doc.querySelector('#main .seg button[data-id="all"]'));
  click(doc.querySelector('#main .seg button[data-id="next30"]'));
  await sleep(100);
  const all30 = evRows();
  click(doc.querySelector('#main .chip-toggle[data-group="results"]'));
  await sleep(100);
  const results30 = evRows();
  const firstSym = doc.querySelector('#main .ev-sym')?.textContent.replace('★', '');
  type(doc.querySelector('#calTickers'), firstSym ?? 'INFY');
  await sleep(100);
  const syms = [...doc.querySelectorAll('#main .ev-sym')].map((b) => b.textContent.replace('★', ''));
  type(doc.querySelector('#calTickers'), 'ZZZZQ');
  await sleep(100);
  const unknown = /Nothing scheduled for ZZZZQ/.test(doc.querySelector('#main').textContent);
  report.push(`calendar: next30 all=${all30} results=${results30} ticker ${firstSym}=${syms.length} unknown-banner=${unknown}`);
  if (!all30) errors.push('calendar shows no events for the next 30 days');
  if (results30 > all30) errors.push('type filter increased the row count');
  // Company-name matching may legitimately pull in a related ticker, so only
  // require that the typed one is there and most rows are it.
  const own = syms.filter((s) => s === firstSym).length;
  if (!own || own < syms.length / 2) errors.push(`ticker filter is off: ${[...new Set(syms)]}`);
  if (!unknown) errors.push('unknown ticker banner missing on calendar');
  type(doc.querySelector('#calTickers'), '');
} else {
  report.push('calendar: no events.json, empty state only');
}

// News: ticker filter and the unknown-ticker prompt.
click(doc.querySelector('#nav [data-view="news"]'));
await sleep(150);
click(doc.querySelector('#main .seg button[data-scope="all"]'));
await sleep(100);
const allNews = doc.querySelectorAll('#main .news-item').length;
type(doc.querySelector('#newsTickers'), 'ZZZZQ');
await sleep(100);
const newsUnknown = /No stories mention ZZZZQ/.test(main.textContent);
report.push(`news: all=${allNews} unknown-banner=${newsUnknown}`);
if (!allNews) errors.push('news view shows no stories in All');
if (!newsUnknown) errors.push('unknown ticker banner missing on news');
type(doc.querySelector('#newsTickers'), '');

// Scan every rendered view for obviously broken output.
for (const v of views) {
  click(doc.querySelector(`#nav [data-view="${v}"]`));
  await sleep(60);
  const t = main.textContent;
  const bad = t.match(/.{0,45}(NaN|\[object Object\]|undefined%).{0,45}/);
  if (bad) errors.push(`${v}: suspicious output "${bad[0].replace(/\s+/g, ' ')}"`);
}

console.log(report.join('\n'));
console.log('\n' + (errors.length ? `FAILURES (${errors.length}):\n` + errors.join('\n---\n') : '✅ NO ERRORS'));
process.exit(errors.length ? 1 : 0);
