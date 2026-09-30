// Shared helpers: formatting, DOM building, local persistence.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- numbers ---------------------------------------------------------------
export const fmt = (n, d = 2) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (n, d = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(d)}%`;

export function compact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

export const sign = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

export function ago(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export const display = (sym) => sym.replace('.NS', '');

// --- small components ------------------------------------------------------
export function pill(text, kind = 'neutral') {
  return el('span', { class: `pill ${kind}` }, text);
}

export function changePill(n) {
  return pill(pct(n), sign(n) || 'neutral');
}

export function stat(label, value, detail, valueClass = '') {
  return el('div', { class: 'stat' },
    el('div', { class: 'k' }, label),
    el('div', { class: `v num ${valueClass}` }, value),
    detail ? el('div', { class: 'd' }, detail) : null);
}

export function card(title, sub, ...body) {
  return el('div', { class: 'card' },
    title ? el('h3', { class: 'card-head' }, title, sub ? el('span', { class: 'sub' }, sub) : null) : null,
    ...body);
}

export function meter(value, min, max, colour) {
  const width = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return el('div', { class: 'meter' },
    el('div', { class: 'bar' }, el('i', { style: `width:${width}%;background:${colour}` })),
    el('span', { class: 'num faint', style: 'font-size:11px;min-width:30px' }, fmt(value, 0)));
}

/** Sortable table. `cols` = [{key, label, render?, align?, sort?}] */
export function table(cols, rows, { onRow, initialSort } = {}) {
  let sortKey = initialSort?.key ?? null;
  let sortDir = initialSort?.dir ?? -1;

  const wrap = el('div', { class: 'table-wrap' });
  const tbl = el('table');
  const thead = el('thead');
  const tbody = el('tbody');

  const headRow = el('tr');
  for (const col of cols) {
    headRow.append(el('th', {
      title: col.title || col.label,
      onclick: () => {
        if (col.sort === false) return;
        sortDir = sortKey === col.key ? -sortDir : -1;
        sortKey = col.key;
        draw();
      },
    }, col.label + (sortKey === col.key ? (sortDir === -1 ? ' ▾' : ' ▴') : '')));
  }
  thead.append(headRow);

  function draw() {
    headRow.replaceChildren(...cols.map((col) => el('th', {
      title: col.title || col.label,
      onclick: () => {
        if (col.sort === false) return;
        sortDir = sortKey === col.key ? -sortDir : -1;
        sortKey = col.key;
        draw();
      },
    }, col.label + (sortKey === col.key ? (sortDir === -1 ? ' ▾' : ' ▴') : ''))));

    const data = [...rows];
    if (sortKey) {
      data.sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        if (typeof x === 'string' || typeof y === 'string') {
          return String(x).localeCompare(String(y)) * -sortDir;
        }
        return ((x ?? -Infinity) - (y ?? -Infinity)) * sortDir;
      });
    }
    tbody.replaceChildren(...data.map((row) => {
      const tr = el('tr', onRow ? { onclick: () => onRow(row) } : {});
      for (const col of cols) tr.append(el('td', {}, col.render ? col.render(row) : row[col.key] ?? '—'));
      return tr;
    }));
  }

  draw();
  tbl.append(thead, tbody);
  wrap.append(tbl);
  return rows.length ? wrap : el('div', { class: 'empty' }, 'Nothing here yet.');
}

/** Inline sparkline from a list of closes. */
export function sparkline(values, width = 110, height = 30) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('class', 'spark');
  if (!values || values.length < 2) return svg;

  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - ((v - min) / span) * (height - 4) - 2,
  ]);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke', values.at(-1) >= values[0] ? 'var(--up)' : 'var(--down)');
  svg.append(path);
  return svg;
}

// --- local storage ---------------------------------------------------------
// Wrapped because private windows and blocked site data both throw here.
export function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function toast(message, kind = 'info') {
  const node = el('div', {
    class: `pill ${kind === 'error' ? 'down' : kind === 'ok' ? 'up' : 'info'}`,
    style: 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:200;'
         + 'padding:10px 18px;font-size:13px;box-shadow:var(--shadow)',
  }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 3200);
}

export function modal(title, ...body) {
  const root = $('#modalRoot');
  const close = () => root.replaceChildren();
  const bg = el('div', {
    class: 'modal-bg',
    onclick: (e) => { if (e.target === bg) close(); },
  }, el('div', { class: 'modal' },
    el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:14px' },
      el('h3', {}, title),
      el('button', { class: 'icon-btn', onclick: close }, '✕')),
    ...body));
  root.replaceChildren(bg);
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return close;
}
