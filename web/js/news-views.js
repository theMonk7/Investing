// Sector news, the accumulating feed, and disclosed filings.

import { divergingColor, divergingLegend, hbars, lineChart, withTip } from './charts.js';
import {
  ago, card, changePill, display, el, fmt, lsGet, lsSet, pct, sign, table,
} from './lib.js';

const SEEN_KEY = 'mktdesk.lastSeen';

const toneClass = (s) => (s > 0.1 ? 'bull' : s < -0.1 ? 'bear' : '');

// ============================================================ sector news
export function sectorNews(ctx) {
  const { bundle } = ctx;
  const sectors = bundle.sectors ?? [];
  const stories = bundle.sector_news ?? {};
  const series = bundle.sector_series ?? [];

  if (!sectors.length) {
    return card('Sector news', null,
      el('div', { class: 'empty' }, 'No sector data yet — run the pipeline in news mode.'));
  }

  // date -> per-sector sentiment history, for the small multiples
  const history = {};
  for (const row of series) {
    (history[row.sector] ??= []).push({ date: row.date, value: row.sentiment ?? 0 });
  }
  for (const key of Object.keys(history)) history[key].sort((a, b) => a.date.localeCompare(b.date));

  const frag = el('div');
  const openSector = (name) => renderSectorPanel(ctx, name, stories[name] ?? []);

  // ---- the board: one row per sector, diverging colour + signed numbers --
  const head = el('div', { class: 'board-row' },
    el('div', { class: 'board-head' }, 'Sector'),
    el('div', { class: 'board-head' }, `Sentiment trend (${series.length ? 'daily' : 'no history yet'})`),
    el('div', { class: 'board-head' }, 'Tone'),
    el('div', { class: 'board-head' }, '1D'),
    el('div', { class: 'board-head' }, '5D'),
    el('div', { class: 'board-head' }, 'Stories'));

  const rows = sectors.map((s) => {
    const tone = s.sentiment ?? 0;
    const cell = (value, text, tipRows) => withTip(
      el('div', {
        class: `cell${Math.abs(value) < 0.06 ? ' zero' : ''}`,
        style: `background:${divergingColor(value, 0.6)}`,
        tabindex: '0', 'data-v': value,
      }, text),
      () => tipRows.map(([k, v]) => el('div', {}, el('b', {}, k), v)));

    return el('div', { class: 'board-row' },
      el('div', {
        class: 'cell label', tabindex: '0', role: 'button',
        onclick: () => openSector(s.sector),
        onkeydown: (e) => { if (e.key === 'Enter') openSector(s.sector); },
      }, s.sector),
      el('div', { class: 'cell spark' },
        lineChart(history[s.sector] ?? [], { height: 32 })),
      cell(tone, (tone >= 0 ? '+' : '') + fmt(tone, 2),
        [[`${s.sector} news tone`, `${s.sentiment_label ?? 'neutral'} (${fmt(tone, 2)})`],
         ['Coverage', `${s.story_count ?? 0} stories · ${s.bullish ?? 0} positive / ${s.bearish ?? 0} negative`]]),
      cell((s.ret_1d ?? 0) / 3, pct(s.ret_1d, 1),
        [[`${s.sector} today`, `${pct(s.ret_1d)} equal-weighted across ${s.members} stocks`]]),
      cell((s.ret_5d ?? 0) / 6, pct(s.ret_5d, 1),
        [[`${s.sector} 5-day`, `${pct(s.ret_5d)} · leaders ${s.leaders.map(display).join(', ')}`],
         ['Laggards', s.laggards.map(display).join(', ')]]),
      el('div', { class: 'cell', style: 'background:var(--bg-elev-2);color:var(--text-dim)' },
        String(s.story_count ?? 0)));
  });

  frag.append(card('Sector board', 'click a sector for its stories',
    divergingLegend('Sentiment and returns'),
    el('div', { class: 'board' }, head, ...rows),
    el('div', { id: 'sectorPanel' })));

  // ---- small multiples: one single-series chart per sector ---------------
  if (series.length) {
    frag.append(card('Sentiment history', `${new Set(series.map((r) => r.date)).size} day(s) recorded`,
      el('div', { class: 'multiples' }, ...sectors.map((s) => {
        const points = history[s.sector] ?? [];
        const latest = points.at(-1)?.value ?? 0;
        return el('div', { class: 'multiple' },
          el('div', { class: 't' }, s.sector),
          el('div', { class: 'v', style: `color:${latest >= 0 ? 'var(--viz-bull)' : 'var(--viz-bear)'}` },
            (latest >= 0 ? '+' : '') + fmt(latest, 2)),
          lineChart(points, { height: 38 }),
          el('div', { class: 's' }, `${s.story_count ?? 0} stories · ${pct(s.ret_5d, 1)} 5D`));
      })),
      el('p', { class: 'faint', style: 'font-size:11.5px;margin:12px 0 0;line-height:1.6' },
        'History accumulates one point per pipeline run per day. It starts near-empty '
        + 'on a fresh install and fills in over the following weeks.')));
  }

  // ---- what kinds of events are driving coverage ------------------------
  const counts = {};
  for (const list of Object.values(stories)) {
    for (const s of list) if (s.event_type) counts[s.event_type] = (counts[s.event_type] ?? 0) + 1;
  }
  for (const s of bundle.market_news ?? []) {
    if (s.event_type) counts[s.event_type] = (counts[s.event_type] ?? 0) + 1;
  }
  const eventRows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([type, n]) => ({ label: type.replace(/_/g, ' '), value: n, format: null }));

  if (eventRows.length) {
    frag.append(card('What kind of news is driving coverage', 'stories in the current window',
      hbars(eventRows, { format: (v) => String(v) })));
  }

  // ---- table view, required alongside any colour-encoded chart ----------
  frag.append(card('Sector table', 'the same figures without colour encoding',
    table([
      { key: 'sector', label: 'Sector' },
      { key: 'sentiment', label: 'Sentiment',
        render: (r) => el('span', { class: `num ${sign(r.sentiment)}` },
          (r.sentiment >= 0 ? '+' : '') + fmt(r.sentiment, 3)) },
      { key: 'sentiment_label', label: 'Tone' },
      { key: 'story_count', label: 'Stories' },
      { key: 'bullish', label: '+' },
      { key: 'bearish', label: '−' },
      { key: 'ret_1d', label: '1D', render: (r) => el('span', { class: `num ${sign(r.ret_1d)}` }, pct(r.ret_1d)) },
      { key: 'ret_5d', label: '5D', render: (r) => el('span', { class: `num ${sign(r.ret_5d)}` }, pct(r.ret_5d)) },
      { key: 'ret_20d', label: '20D', render: (r) => el('span', { class: `num ${sign(r.ret_20d)}` }, pct(r.ret_20d)) },
    ], sectors, { initialSort: { key: 'sentiment', dir: -1 } })));

  return frag;
}

function renderSectorPanel(ctx, name, stories) {
  const host = document.querySelector('#sectorPanel');
  if (!host) return;
  const sector = (ctx.bundle.sectors ?? []).find((s) => s.sector === name) ?? {};
  host.replaceChildren(el('div', { class: 'sector-panel' },
    el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' },
      el('h4', { style: 'margin:0;font-size:14px' }, `${name} — ${stories.length} stories`),
      el('button', { class: 'btn sm', onclick: () => host.replaceChildren() }, 'Close')),
    el('div', { class: 'row', style: 'gap:14px;margin-bottom:12px;font-size:12px' },
      el('span', {}, 'Tone ', el('b', { class: `num ${sign(sector.sentiment)}` },
        (sector.sentiment >= 0 ? '+' : '') + fmt(sector.sentiment ?? 0, 2))),
      el('span', {}, '1D ', el('b', { class: `num ${sign(sector.ret_1d)}` }, pct(sector.ret_1d))),
      el('span', {}, '5D ', el('b', { class: `num ${sign(sector.ret_5d)}` }, pct(sector.ret_5d))),
      el('span', { class: 'faint' }, `Leaders: ${(sector.leaders ?? []).map(display).join(', ')}`),
      el('span', { class: 'faint' }, `Laggards: ${(sector.laggards ?? []).map(display).join(', ')}`)),
    stories.length
      ? el('div', {}, ...stories.map((s) => newsRow(s, ctx)))
      : el('div', { class: 'empty' }, 'No stories matched this sector in the current window.')));
  host.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================== news feed
// Filters live outside the render so they survive background reloads.
const feedViews = {};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPANY_SUFFIX = /\b(limited|ltd\.?|inc\.?|corp(oration)?\.?|co\.?|plc|holdings?|the)\b/gi;

/** The accumulating feed plus per-ticker and per-sector buckets, newest first. */
function allStories(ctx) {
  const seen = new Map();
  const add = (s) => {
    const key = s?.id ?? s?.link ?? s?.title;
    if (key && !seen.has(key)) seen.set(key, s);
  };
  (ctx.feed?.items ?? []).forEach(add);
  Object.values(ctx.bundle.news_by_symbol ?? {}).flat().forEach(add);
  Object.values(ctx.bundle.sector_news ?? {}).flat().forEach(add);
  (ctx.bundle.market_news ?? []).forEach(add);
  return [...seen.values()].sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')));
}

export function newsFeed(ctx) {
  const items = allStories(ctx);
  const st = (feedViews[ctx.market] ??= {
    scope: ctx.watchSymbols.length ? 'watchlist' : 'all',
    tickers: '', q: '', kind: 'news', tone: '', sector: '', onlyNew: false,
  });

  // "New since last visit" uses OUR first_seen, not the outlet's timestamp,
  // so a backdated story still registers as new to you.
  const lastSeen = lsGet(`${SEEN_KEY}.${ctx.market}`, null);
  const newCount = lastSeen ? items.filter((i) => (i.first_seen ?? '') > lastSeen).length : 0;

  const base = (s) => String(s ?? '').replace(/\.(NS|BO)$/, '').toUpperCase();
  const watchBases = new Set(ctx.watchSymbols.map(base));
  const names = Object.fromEntries((ctx.bundle.quotes ?? []).map((q) => [base(q.symbol),
    String(q.name ?? '').replace(COMPANY_SUFFIX, '').replace(/\s+/g, ' ').trim().toLowerCase()]));

  const isWatched = (i) => watchBases.has(base(i.symbol)) || (i.tickers ?? []).some((t) => watchBases.has(base(t)));
  const mentions = (i, term) => {
    const b = base(term);
    if (base(i.symbol) === b || (i.tickers ?? []).some((t) => base(t) === b)) return true;
    if (new RegExp(`(^|[^A-Za-z0-9])${escapeRe(b)}($|[^A-Za-z0-9])`, 'i').test(i.title ?? '')) return true;
    const name = names[b];
    return Boolean(name && name.length > 3 && (i.title ?? '').toLowerCase().includes(name));
  };

  const list = el('div');
  const note = el('div');
  const sectorRow = el('div', { class: 'chips sector-chips' });

  function draw() {
    const terms = st.tickers.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
    const q = st.q.toLowerCase();
    sectorRow.classList.toggle('hidden', st.scope !== 'sectors' || terms.length > 0);

    const filtered = items.filter((i) => {
      if (terms.length) { if (!terms.some((t) => mentions(i, t))) return false; }
      else if (st.scope === 'watchlist' && !isWatched(i)) return false;
      else if (st.scope === 'sectors') {
        if (!i.sector || i.sector === 'Market-wide') return false;
        if (st.sector && i.sector !== st.sector) return false;
      }
      const kind = i.kind ?? 'news';
      if (st.kind === 'news' && kind !== 'news') return false;
      if (st.kind === 'filings' && kind === 'news') return false;
      if (st.tone === 'bull' && !(i.sentiment > 0.1)) return false;
      if (st.tone === 'bear' && !(i.sentiment < -0.1)) return false;
      if (st.onlyNew && lastSeen && (i.first_seen ?? '') <= lastSeen) return false;
      if (q && !`${i.title} ${i.source} ${(i.tickers ?? []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });

    // Tickers with nothing in the window: offer to fetch them on demand.
    const missing = terms.filter((t) => !items.some((i) => mentions(i, t)));
    note.replaceChildren(...(missing.length ? [el('div', { class: 'banner' },
      `No stories mention ${missing.map((t) => t.toUpperCase()).join(', ')} in the current window. `,
      ctx.connected
        ? el('button', { class: 'btn sm', id: 'fetchNews', onclick: () => ctx.fetchSymbols(missing, 'news') },
            `Fetch news for ${missing.map((t) => t.toUpperCase()).join(', ')}`)
        : 'Connect GitHub (⚙) to fetch news for any ticker on demand.')] : []));

    let empty = 'Nothing matches those filters.';
    if (!terms.length && st.scope === 'watchlist') {
      empty = ctx.watchSymbols.length
        ? 'No recent stories for your watchlist. Try "All" or check back after the next update.'
        : 'Your watchlist is empty. Add tickers on the Watchlist tab, or type tickers above.';
    }
    list.replaceChildren(
      el('div', { class: 'faint', style: 'font-size:11.5px;margin-bottom:10px' },
        `${filtered.length} of ${items.length} stories`),
      ...(filtered.length
        ? filtered.slice(0, 250).map((i) => newsRow(i, ctx, lastSeen))
        : [el('div', { class: 'empty' }, empty)]));
  }

  const seg = el('div', { class: 'seg', role: 'tablist' },
    ...[['watchlist', 'Watchlist'], ['sectors', 'Sectors'], ['all', 'All']].map(([id, label]) =>
      el('button', {
        class: st.scope === id ? 'active' : '', 'data-scope': id,
        onclick: (e) => {
          st.scope = id;
          [...seg.children].forEach((b) => b.classList.toggle('active', b === e.currentTarget));
          draw();
        },
      }, label)));

  sectorRow.append(...(ctx.bundle.sectors ?? []).map((s) => {
    const tone = s.sentiment ?? 0;
    return el('button', {
      class: `chip-toggle${st.sector === s.sector ? ' on' : ''}`,
      title: `${s.story_count ?? 0} stories · tone ${fmt(tone, 2)}`,
      onclick: (e) => {
        st.sector = st.sector === s.sector ? '' : s.sector;
        [...sectorRow.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget && st.sector));
        draw();
      },
    }, s.sector, el('span', { class: `num ${tone > 0.1 ? 'up' : tone < -0.1 ? 'down' : 'faint'}` },
      ` ${tone >= 0 ? '+' : ''}${fmt(tone, 2)}`));
  }));

  const select = (label, key, options) => el('select', {
    'aria-label': label, 'data-filter': key,
    onchange: (e) => { st[key] = e.target.value; draw(); },
  }, ...options.map(([value, text]) => el('option', { value, selected: st[key] === value }, text)));

  const frag = el('div');
  frag.append(card('News', `${items.length} stories · last ${ctx.meta?.news_window_days ?? 7} days`,
    newCount
      ? el('div', { class: 'faint', style: 'font-size:12px;margin-bottom:10px' },
          el('b', {}, `${newCount} new`), ` since you last looked (${ago(lastSeen)}), marked with a dot.`)
      : null,
    el('div', { class: 'feed-controls' },
      seg,
      el('input', {
        type: 'search', id: 'newsTickers', value: st.tickers,
        placeholder: 'Tickers, e.g. INFY, HDFCBANK', style: 'min-width:200px',
        oninput: (e) => { st.tickers = e.target.value; draw(); },
      }),
      el('input', {
        type: 'search', id: 'newsSearch', value: st.q, placeholder: 'Search headlines…',
        style: 'flex:1;min-width:160px',
        oninput: (e) => { st.q = e.target.value; draw(); },
      }),
      select('Type', 'kind', [['news', 'News'], ['filings', 'Filings'], ['', 'News + filings']]),
      select('Tone', 'tone', [['', 'Any tone'], ['bull', 'Positive'], ['bear', 'Negative']]),
      lastSeen
        ? el('button', {
            class: `btn sm${st.onlyNew ? ' primary' : ''}`,
            onclick: (e) => {
              st.onlyNew = !st.onlyNew;
              e.currentTarget.classList.toggle('primary', st.onlyNew);
              draw();
            },
          }, 'New only')
        : null,
      el('button', {
        class: 'btn sm',
        onclick: () => {
          lsSet(`${SEEN_KEY}.${ctx.market}`, new Date().toISOString());
          ctx.rerender();
        },
      }, 'Mark all read')),
    sectorRow,
    note,
    list));

  draw();
  return frag;
}

export function newsRow(n, ctx, lastSeen = null) {
  const isNew = lastSeen && (n.first_seen ?? '') > lastSeen;
  const s = Number(n.sentiment ?? 0);
  const corroboration = n.corroboration ?? 1;

  return el('div', { class: `news-item${isNew ? ' is-new' : ''}` },
    el('div', { class: 't' },
      n.link
        ? el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.title)
        : n.title),
    el('div', { class: 'm' },
      el('span', { class: `tag ${toneClass(s)}` },
        `${s >= 0 ? '+' : ''}${s.toFixed(2)}`),
      n.event_type ? el('span', { class: 'tag' }, n.event_type.replace(/_/g, ' ')) : null,
      n.sector && n.sector !== 'Market-wide' ? el('span', { class: 'tag' }, n.sector) : null,
      n.kind && n.kind !== 'news' ? el('span', { class: 'tag filing' }, n.kind) : null,
      el('span', {}, n.source),
      el('span', {}, ago(n.published)),
      corroboration > 1
        ? el('span', { class: 'corrob', title: 'Number of outlets carrying this story' },
            `${corroboration} outlets`)
        : null,
      ...(n.tickers ?? []).slice(0, 4).map((t) =>
        el('button', {
          class: 'btn sm', style: 'padding:1px 7px;font-size:10.5px',
          onclick: () => ctx.openStock?.(t),
        }, display(t))),
      n.scored_by?.startsWith('llm') ? el('span', { class: 'tag' }, 'LLM-scored') : null));
}

// =============================================================== filings
export function filings(ctx) {
  const { bundle, meta } = ctx;
  const rows = bundle.disclosures ?? [];
  const catalysts = bundle.catalysts ?? [];
  const stats = bundle.event_stats ?? [];
  const status = bundle.event_status ?? {};
  const frag = el('div');

  frag.append(el('div', { class: 'banner' },
    el('b', {}, 'Public disclosures only. '),
    'Everything here was filed with a regulator or reported by an exchange and is '
    + 'public the moment it is posted. This dashboard does not source, and will not '
    + 'help you source, material non-public information — trading on it is illegal '
    + 'under SEC Rule 10b-5 and SEBI’s insider-trading regulations.'));

  if (bundle.market === 'US' && meta && !meta.sec_filings_enabled) {
    frag.append(el('div', { class: 'banner' },
      el('b', {}, 'SEC filings are off. '),
      'The SEC rejects requests without a contact email in the User-Agent. Set the ',
      el('code', {}, 'SEC_CONTACT_EMAIL'),
      ' repository secret to switch on Form 4 (insider transactions) and 8-K '
      + '(material events).'));
  }
  if (bundle.market === 'IN') {
    frag.append(el('div', { class: 'banner' },
      el('b', {}, 'India note. '),
      'NSE and BSE block datacenter IP ranges, so their filing APIs cannot be reached '
      + 'from GitHub Actions. These items come from Moneycontrol, Business Standard, '
      + 'Mint, ET and targeted news queries over disclosure language — public, but '
      + 'second-hand and less complete than the US feed.'));
  }

  // ---- catalysts --------------------------------------------------------
  frag.append(card('Recent catalysts', 'high-impact events on tracked stocks, last 3 days',
    catalysts.length
      ? el('div', {}, ...catalysts.map((c) => catalystRow(c, ctx)))
      : el('div', { class: 'empty' },
          'No high-impact events matched a tracked stock in the window.')));

  // ---- measured reaction stats -----------------------------------------
  frag.append(card('What each event type has actually done',
    `${status.graded ?? 0} graded of ${status.logged ?? 0} logged`,
    stats.some((s) => s.reliable)
      ? el('div', {},
          hbars(stats.filter((s) => s.reliable).map((s) => ({
            label: `${s.label} (n=${s.n})`,
            value: s.mean_5d,
            tip: () => [
              el('div', {}, el('b', {}, s.label), s.meaning),
              el('div', {}, `Mean 5-day return `,
                el('span', { class: 'num' }, pct(s.mean_5d))),
              el('div', {}, `Median `, el('span', { class: 'num' }, pct(s.median_5d))),
              el('div', {}, `Positive `, el('span', { class: 'num' },
                `${((s.hit_rate_5d ?? 0) * 100).toFixed(0)}% of ${s.n}`)),
            ],
          })), { diverging: true, format: (v) => pct(v) }),
          divergingLegend('Mean 5-day return after the event'))
      : el('div', { class: 'empty' },
          `Not enough graded events yet — ${status.logged ?? 0} logged, `
          + `${status.graded ?? 0} graded, and averages need ${status.min_sample ?? 8} `
          + 'per event type. Events are graded once five sessions of forward prices '
          + 'exist, so this fills in over the coming weeks.'),
    el('p', { class: 'faint', style: 'font-size:11.5px;margin:12px 0 0;line-height:1.6' },
      status.note ?? '')));

  // ---- the raw disclosure list -----------------------------------------
  frag.append(card(`Filings and disclosures (${rows.length})`, null,
    rows.length
      ? el('div', {}, ...rows.map((r) => newsRow(r, ctx)))
      : el('div', { class: 'empty' }, 'None retrieved in the last run.')));

  return frag;
}

function catalystRow(c, ctx) {
  const tone = c.expected_tone;
  return el('details', { class: 'accordion' },
    el('summary', {},
      el('span', { style: 'font-weight:680;min-width:100px' }, display(c.symbol)),
      el('span', { class: `tag ${tone === 'bullish' ? 'bull' : tone === 'bearish' ? 'bear' : ''}` },
        c.label),
      c.change_pct != null ? changePill(c.change_pct) : null,
      el('span', { class: 'faint', style: 'font-size:11.5px;flex:1;overflow:hidden;'
        + 'text-overflow:ellipsis;white-space:nowrap' }, c.headline),
      el('span', { class: 'faint', style: 'font-size:11px' }, c.date)),
    el('div', { class: 'body' },
      el('p', { style: 'margin:0 0 10px' }, c.meaning || '—'),
      el('div', { class: 'row', style: 'gap:16px;font-size:12px;margin-bottom:10px' },
        el('span', {}, 'Sector ', el('b', {}, c.sector ?? '—')),
        el('span', {}, 'Today ', el('b', { class: `num ${sign(c.change_pct)}` }, pct(c.change_pct))),
        el('span', {}, 'Volume ', el('b', { class: 'num' }, `${fmt(c.vol_z, 1)}σ`)),
        el('span', {}, 'RSI ', el('b', { class: 'num' }, fmt(c.rsi14, 0))),
        el('span', {}, 'Headline tone ', el('b', { class: `num ${sign(c.sentiment)}` },
          (c.sentiment >= 0 ? '+' : '') + fmt(c.sentiment, 2)))),
      c.historical_reliable
        ? el('div', { class: 'dim', style: 'font-size:12.5px;line-height:1.6' },
            `Across ${c.historical_n} previously graded "${c.label}" events in this market, `
            + `the mean 5-day return was ${pct(c.historical_mean_5d)} and `
            + `${((c.historical_hit_rate_5d ?? 0) * 100).toFixed(0)}% were positive. `,
            el('b', {}, 'That is a historical average over a small sample, not a forecast '
              + 'for this one.'))
        : el('div', { class: 'faint', style: 'font-size:12px' },
            `Only ${c.historical_n} graded observations of this event type so far — `
            + 'too few to average, so no reaction statistic is shown.'),
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { class: 'btn sm', onclick: () => ctx.openStock?.(c.symbol) }, 'Open chart'),
        !ctx.watchSymbols.includes(c.symbol)
          ? el('button', { class: 'btn sm', onclick: () => ctx.addSymbol(c.symbol) }, '★ Watch')
          : null)));
}
