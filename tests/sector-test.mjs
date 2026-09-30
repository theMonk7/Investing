import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const ROOT = '/Users/utkarshraj/Documents/Learning/Investing';
const BASE = `http://127.0.0.1:${process.env.PORT || 8779}/web/`;
const html = readFileSync(`${ROOT}/web/index.html`, 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: BASE, pretendToBeVisual: true });
const { window } = dom;
for (const k of ['window','document','location','Node','MouseEvent','Event','HTMLElement','getComputedStyle','localStorage','KeyboardEvent'])
  Object.defineProperty(globalThis, k, { value: k==='window'?window:window[k], configurable:true, writable:true });
globalThis.structuredClone ??= (o)=>JSON.parse(JSON.stringify(o));
globalThis.setInterval = () => 0;
const rf = globalThis.fetch;
globalThis.fetch = (i, init) => rf(new URL(String(i), BASE).href, init);
window.fetch = globalThis.fetch;
await import(`file://${ROOT}/web/js/app.js`);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
await sleep(2500);
const doc = window.document;
const click = n => n.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const errors = [];

click(doc.querySelector('#nav button[data-view="sectornews"]'));
await sleep(200);
const main = doc.querySelector('#main');
console.log('board rows:', doc.querySelectorAll('.board-row').length);
console.log('spark svgs:', doc.querySelectorAll('.cell.spark svg').length);
console.log('multiples :', doc.querySelectorAll('.multiple').length);
console.log('hbars     :', doc.querySelectorAll('.hbar').length);
console.log('table rows:', doc.querySelectorAll('#main tbody tr').length);
console.log('legend    :', doc.querySelectorAll('.legend').length);

// every coloured cell must carry a signed number (colour never alone)
const cells = [...doc.querySelectorAll('.cell[data-v]')];
const blank = cells.filter(c => !/[-+−]?\d/.test(c.textContent));
console.log('coloured cells:', cells.length, '| without a number:', blank.length);
if (blank.length) errors.push(`${blank.length} coloured cells have no numeric label`);
if (!doc.querySelector('.legend .scale')) errors.push('diverging legend missing');

// drill into a sector
const label = doc.querySelector('.cell.label');
console.log('clicking sector:', label.textContent);
click(label);
await sleep(300);
const panel = doc.querySelector('.sector-panel');
if (!panel) errors.push('sector panel did not open');
else console.log('panel:', panel.querySelectorAll('.news-item').length, 'stories,', panel.textContent.length, 'chars');

// tooltip on hover
const cell = cells[0];
cell.dispatchEvent(new window.MouseEvent('mouseenter',{bubbles:true,clientX:100,clientY:100}));
await sleep(80);
const tip = doc.querySelector('.viz-tip');
if (!tip) errors.push('hover tooltip did not appear');
else console.log('tooltip  :', JSON.stringify(tip.textContent.slice(0,90)));

// feed filters
click(doc.querySelector('#nav button[data-view="news"]'));
await sleep(250);
const before = doc.querySelectorAll('#main .news-item').length;
// selects are [sector, event, kind, tone] -- the search box is an <input>
const sel = doc.querySelectorAll('#main .feed-controls select')[2]; // kind
sel.value = 'filing';
sel.dispatchEvent(new window.Event('change',{bubbles:true}));
await sleep(200);
const after = doc.querySelectorAll('#main .news-item').length;
console.log(`feed filter kind=filing: ${before} -> ${after}`);
if (after === before && before > 0) errors.push('feed kind filter had no effect');

const search = doc.querySelector('#main input[type="search"]');
search.value = 'zzzznomatch';
search.dispatchEvent(new window.Event('input',{bubbles:true}));
await sleep(200);
console.log('search no-match ->', doc.querySelectorAll('#main .news-item').length, 'items');

console.log('\n' + (errors.length ? 'FAILURES:\n'+errors.join('\n') : '✅ SECTOR/FEED CHECKS PASS'));
process.exit(errors.length?1:0);
