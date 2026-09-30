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
                 'Event', 'HTMLElement', 'getComputedStyle', 'localStorage']) {
  Object.defineProperty(globalThis, k, {
    value: k === 'window' ? window : window[k], configurable: true, writable: true,
  });
}
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));
globalThis.setInterval = () => 0;                       // no background polling in the test

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
const views = [...doc.querySelectorAll('#nav button')].map((b) => b.dataset.view);
const report = [];

for (const market of ['IN', 'US']) {
  click([...doc.querySelectorAll('#marketSwitch button')].find((b) => b.dataset.market === market));
  await sleep(150);
  for (const v of views) {
    try { click(doc.querySelector(`#nav button[data-view="${v}"]`)); }
    catch (e) { errors.push(`${market}/${v} threw: ${e.message}\n${e.stack}`); continue; }
    await sleep(60);
    const nodes = main.querySelectorAll('*').length;
    const chars = main.textContent.trim().length;
    report.push(`${market}/${v.padEnd(10)} nodes=${String(nodes).padStart(5)} chars=${String(chars).padStart(6)}`);
    if (nodes < 25) errors.push(`${market}/${v} rendered almost nothing (${nodes} nodes)`);
  }
}

// Stock detail modal (from the Watchlist table).
click(doc.querySelector('#nav button[data-view="watchlist"]'));
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
click(doc.querySelector('#nav button[data-view="watchlist"]'));
await sleep(150);
const before = doc.querySelectorAll('#main .chip').length;
const input = doc.querySelector('#addSym');
input.value = 'WIPRO.NS';
click([...doc.querySelectorAll('#main .btn.primary')].find((b) => b.textContent.includes('Add')));
await sleep(300);
const after = doc.querySelectorAll('#main .chip').length;
report.push(`watchlist chips: ${before} -> ${after}`);
if (after !== before + 1) errors.push(`add symbol did not update the chip list (${before} -> ${after})`);

// Scan every rendered view for obviously broken output.
for (const v of views) {
  click(doc.querySelector(`#nav button[data-view="${v}"]`));
  await sleep(60);
  const t = main.textContent;
  const bad = t.match(/.{0,45}(NaN|\[object Object\]|undefined%).{0,45}/);
  if (bad) errors.push(`${v}: suspicious output "${bad[0].replace(/\s+/g, ' ')}"`);
}

console.log(report.join('\n'));
console.log('\n' + (errors.length ? `FAILURES (${errors.length}):\n` + errors.join('\n---\n') : '✅ NO ERRORS'));
process.exit(errors.length ? 1 : 0);
