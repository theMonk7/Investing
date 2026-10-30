// Corporate calendar: results dates, board meetings, dividends, splits.
//
// Data is data/{market}/events.json, built by pipeline/corporate_events.py
// from exchange filings (NSE board meetings and corporate actions for India,
// the Nasdaq earnings and dividend calendars for the US), with Yahoo Finance
// estimates filling gaps for tracked tickers. Estimates are labelled as such.

import { ago, card, display, el } from './lib.js';

const GROUPS = [
  { id: 'results', label: 'Results', types: ['results'] },
  { id: 'board', label: 'Board meetings', types: ['board_meeting'] },
  { id: 'dividend', label: 'Dividends', types: ['dividend'] },
  { id: 'capital', label: 'Bonus · split · buyback', types: ['bonus', 'split', 'buyback'] },
  { id: 'fund', label: 'Fund raising', types: ['fundraise'] },
  { id: 'other', label: 'AGM · mergers · other', types: ['agm', 'merger', 'other'] },
];

const TYPE_LABEL = {
  results: 'Results', board_meeting: 'Board meeting', dividend: 'Dividend', bonus: 'Bonus',
  split: 'Split', buyback: 'Buyback', fundraise: 'Fund raising', merger: 'Restructuring',
  agm: 'Shareholder meeting', other: 'Other',
};

const WINDOWS = [
  { id: 'past7', label: 'Past 7 days', from: -7, to: -1 },
  { id: 'today', label: 'Today', from: 0, to: 0 },
  { id: 'next7', label: 'Next 7 days', from: 0, to: 7 },
  { id: 'next30', label: 'Next 30 days', from: 0, to: 30 },
  { id: 'custom', label: 'Custom' },
];

const PAGE = 300;

// --------------------------------------------------------------- helpers
const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };
export const todayISO = () => isoDate(new Date());
export const baseSym = (s) => String(s).replace(/\.(NS|BO)$/, '');

export function relDay(iso) {
  const days = Math.round((Date.parse(iso) - Date.parse(todayISO())) / 86400e3);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
}

const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined,
  { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Every event for one ticker, oldest first (items are date-sorted). */
export function eventsFor(ctx, sym) {
  const base = baseSym(sym);
  return (ctx.events?.items ?? []).filter((e) => baseSym(e.symbol) === base);
}

export function nextEvent(ctx, sym) {
  const today = todayISO();
  return eventsFor(ctx, sym).find((e) => e.date >= today) ?? null;
}

/** Short label: the most specific type, e.g. "Results" over "Board meeting". */
export function eventLabel(e) {
  const t = e.types.find((x) => x !== 'board_meeting') ?? e.types[0];
  return (TYPE_LABEL[t] ?? t) + (e.estimated ? ' (est.)' : '');
}

function eventLink(e) {
  if (e.link) return e.link;
  const sym = encodeURIComponent(baseSym(e.symbol));
  if (e.source === 'NSE') return `https://www.nseindia.com/get-quotes/equity?symbol=${sym}`;
  if (e.source.startsWith('Nasdaq')) {
    return `https://www.nasdaq.com/market-activity/stocks/${sym.toLowerCase()}/earnings`;
  }
  return `https://finance.yahoo.com/quote/${encodeURIComponent(e.symbol)}/`;
}

export function eventRow(e, ctx, { showDate = false } = {}) {
  const watched = ctx.watchSymbols.some((s) => baseSym(s) === baseSym(e.symbol));
  const hasQuote = (ctx.bundle?.quotes ?? []).some((q) => q.symbol === e.symbol);
  const sourceTag = e.estimated
    ? el('span', { class: 'tag est', title: 'Estimated by Yahoo Finance. Not yet filed with the exchange.' }, 'estimate')
    : el('span', { class: 'tag', title: e.official ? 'From an exchange filing' : '' }, e.source);

  return el('div', { class: `ev-row${watched ? ' watched' : ''}` },
    showDate
      ? el('div', { class: 'ev-date num' }, e.date.slice(5), el('small', {}, relDay(e.date)))
      : null,
    el('button', {
      class: 'ev-sym', title: hasQuote ? 'Open chart' : e.company,
      onclick: () => (hasQuote || watched ? ctx.openStock(e.symbol) : null),
      disabled: !(hasQuote || watched),
    }, display(e.symbol), watched ? el('span', { class: 'star', title: 'On your watchlist' }, '★') : null),
    el('div', { class: 'ev-main' },
      el('div', { class: 'ev-title' }, e.title),
      el('div', { class: 'ev-detail' },
        [e.company, e.time, e.detail].filter(Boolean).join(' · '))),
    el('div', { class: 'ev-tags' },
      ...e.types.filter((t) => t !== 'board_meeting').slice(0, 2)
        .map((t) => el('span', { class: `tag t-${t}` }, TYPE_LABEL[t] ?? t)),
      sourceTag,
      el('a', { href: eventLink(e), target: '_blank', rel: 'noopener noreferrer',
        title: e.link ? 'Open the filing' : `Look it up on ${e.source}` }, e.link ? 'Filing ↗' : 'Source ↗')));
}

// ---------------------------------------------------------------- the view
// Kept outside the render so filters survive background reloads.
const views = {};

function viewState(market, watching) {
  return (views[market] ??= {
    window: 'next7', from: addDays(0), to: addDays(14),
    scope: watching ? 'watchlist' : 'all', tickers: '', groups: new Set(), limit: PAGE,
  });
}

export function calendar(ctx) {
  const data = ctx.events;
  const st = viewState(ctx.market, ctx.watchSymbols.length > 0);
  const frag = el('div', { class: 'calendar' });

  if (!data?.items) {
    frag.append(card('Corporate calendar', null,
      el('div', { class: 'empty' },
        el('p', {}, 'No calendar data yet. It is built on every news or full pipeline run, '
          + 'or locally with ', el('code', {}, 'python pipeline/run_all.py --mode events'), '.'),
        ctx.connected
          ? el('button', { class: 'btn primary', onclick: () => ctx.fetchEvents() }, 'Fetch calendar now')
          : null)));
    return frag;
  }

  const list = el('div');
  const summary = el('div', { class: 'faint cal-summary' });
  const tickerNote = el('div');

  // ---- controls -----------------------------------------------------------
  const seg = (options, key, onPick) => el('div', { class: 'seg', role: 'tablist' },
    ...options.map(([id, label]) => el('button', {
      class: st[key] === id ? 'active' : '', 'data-id': id,
      onclick: (e) => {
        st[key] = id;
        st.limit = PAGE;
        [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('active', b === e.currentTarget));
        onPick?.();
        draw();
      },
    }, label)));

  const customBox = el('div', { class: `row cal-custom${st.window === 'custom' ? '' : ' hidden'}` },
    el('input', { type: 'date', value: st.from, 'aria-label': 'From',
      onchange: (e) => { st.from = e.target.value; draw(); } }),
    el('span', { class: 'faint' }, 'to'),
    el('input', { type: 'date', value: st.to, 'aria-label': 'To',
      onchange: (e) => { st.to = e.target.value; draw(); } }));

  const tickers = el('input', {
    type: 'search', id: 'calTickers', value: st.tickers,
    placeholder: 'Tickers, e.g. INFY, TCS — or a company name',
    oninput: (e) => { st.tickers = e.target.value; st.limit = PAGE; draw(); },
  });

  const chips = el('div', { class: 'chips' }, ...GROUPS.map((g) => el('button', {
    class: `chip-toggle${st.groups.has(g.id) ? ' on' : ''}`, 'data-group': g.id,
    onclick: (e) => {
      st.groups.has(g.id) ? st.groups.delete(g.id) : st.groups.add(g.id);
      e.currentTarget.classList.toggle('on', st.groups.has(g.id));
      st.limit = PAGE;
      draw();
    },
  }, g.label)));

  frag.append(el('div', { class: 'card cal-controls' },
    el('div', { class: 'row' },
      seg(WINDOWS.map((w) => [w.id, w.label]), 'window',
        () => customBox.classList.toggle('hidden', st.window !== 'custom')),
      customBox),
    el('div', { class: 'row' },
      seg([['watchlist', 'Watchlist'], ['all', 'All companies']], 'scope'),
      tickers),
    chips));

  frag.append(sourcesBanner(ctx, data));
  frag.append(el('div', { class: 'card' }, summary, tickerNote, list));

  // ---- filtering ----------------------------------------------------------
  function range() {
    if (st.window === 'custom') return [st.from || '0000', st.to || '9999'];
    const w = WINDOWS.find((x) => x.id === st.window);
    return [addDays(w.from), addDays(w.to)];
  }

  function draw() {
    const [from, to] = range();
    const terms = st.tickers.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    const watchBases = new Set(ctx.watchSymbols.map(baseSym));
    const types = new Set(GROUPS.filter((g) => st.groups.has(g.id)).flatMap((g) => g.types));

    const matchTerm = (e, t) => baseSym(e.symbol) === baseSym(t)
      || (t.length > 3 && (e.company ?? '').toUpperCase().includes(t));

    const rows = data.items.filter((e) => {
      if (e.date < from || e.date > to) return false;
      if (terms.length) { if (!terms.some((t) => matchTerm(e, t))) return false; }
      else if (st.scope === 'watchlist' && !watchBases.has(baseSym(e.symbol))) return false;
      if (types.size && !e.types.some((t) => types.has(t))) return false;
      return true;
    });

    const watchedCount = rows.filter((e) => watchBases.has(baseSym(e.symbol))).length;
    summary.textContent = `${rows.length} event${rows.length === 1 ? '' : 's'} · ${from} → ${to}`
      + (watchedCount && (terms.length || st.scope === 'all') ? ` · ${watchedCount} on your watchlist` : '');

    // Tickers typed in with nothing found anywhere in the published window.
    const unknown = terms.filter((t) => !data.items.some((e) => matchTerm(e, t)));
    tickerNote.replaceChildren(...(unknown.length ? [el('div', { class: 'banner' },
      `Nothing scheduled for ${unknown.join(', ')} between ${data.window?.from} and ${data.window?.to}. `,
      ctx.connected
        ? el('button', { class: 'btn sm', onclick: () => ctx.fetchSymbols(unknown, 'events') },
            `Look up ${unknown.join(', ')}`)
        : 'Connect GitHub (⚙) to look up any ticker on demand.')] : []));

    if (!rows.length) {
      list.replaceChildren(el('div', { class: 'empty' },
        st.scope === 'watchlist' && !terms.length
          ? 'Nothing for your watchlist in this window. Try "All companies" or a wider window.'
          : 'No events in this window.'));
      return;
    }

    const today = todayISO();
    const groups = new Map();
    for (const e of rows.slice(0, st.limit)) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }
    // Upcoming windows read top-down from today; past windows newest first.
    const dates = [...groups.keys()].sort();
    if (to < today) dates.reverse();

    list.replaceChildren(
      ...dates.map((d) => el('section', { class: `ev-day${d === today ? ' today' : ''}` },
        el('h4', {}, longDate(d), el('span', { class: 'faint' }, ` · ${relDay(d)} · ${groups.get(d).length}`)),
        ...groups.get(d)
          .sort((a, b) => Number(watchBases.has(baseSym(b.symbol))) - Number(watchBases.has(baseSym(a.symbol))))
          .map((e) => eventRow(e, ctx)))),
      rows.length > st.limit
        ? el('button', { class: 'btn', style: 'margin-top:12px',
            onclick: () => { st.limit += PAGE; draw(); } }, `Show ${Math.min(PAGE, rows.length - st.limit)} more`)
        : null);
  }

  draw();
  return frag;
}

function sourcesBanner(ctx, data) {
  const sources = data.sources ?? [];
  const failed = sources.filter((s) => !s.ok);
  const line = el('div', { class: 'faint cal-sources' },
    'Sources: ', ...sources.flatMap((s, i) => [
      i ? ' · ' : '',
      el('span', { class: s.ok ? '' : 'down', title: s.note || '' },
        `${s.name} ${s.ok ? '✓' : '✕'}`)]),
    ` · built ${ago(data.generated_at)}`);
  if (!failed.length) return line;

  const exchange = failed.find((s) => /NSE|Nasdaq/.test(s.name));
  return el('div', {},
    el('div', { class: 'banner' },
      el('b', {}, `${failed.map((s) => s.name).join(', ')} could not be reached on the last run`),
      failed[0].last_ok ? ` (last success ${ago(failed[0].last_ok)}). ` : '. ',
      exchange
        ? ['Exchanges sometimes block cloud servers, so dates already collected are kept and '
          + 'Yahoo estimates fill in for your watchlist. To refresh from your own connection run ',
          el('code', {}, 'python pipeline/run_all.py --mode events'), ' and commit.']
        : 'Showing what was collected earlier.'),
    line);
}
