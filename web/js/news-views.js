// Sector news, the accumulating feed, and disclosed filings.

import { divergingColor, divergingLegend, hbars, lineChart, withTip } from './charts.js';
import {
  ago, card, changePill, display, el, fmt, lsGet, lsSet, pct, pill, sign, stat, table,
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
export function newsFeed(ctx) {
  const items = ctx.feed?.items ?? [];
  if (!items.length) {
    return card('News feed', null,
      el('div', { class: 'empty' },
        'No feed yet. It is written by the pipeline in news or full mode.'));
  }

  // "New since last visit" uses OUR first_seen, not the outlet's timestamp,
  // so a backdated story still registers as new to you.
  const lastSeen = lsGet(`${SEEN_KEY}.${ctx.bundle.market}`, null);
  const newCount = lastSeen
    ? items.filter((i) => (i.first_seen ?? '') > lastSeen).length
    : 0;

  const state = { q: '', sector: '', event: '', kind: '', tone: '', onlyNew: false };
  const list = el('div');

  const sectorsPresent = [...new Set(items.map((i) => i.sector).filter(Boolean))].sort();
  const eventsPresent = [...new Set(items.map((i) => i.event_type).filter(Boolean))].sort();

  function draw() {
    const filtered = items.filter((i) => {
      if (state.onlyNew && lastSeen && (i.first_seen ?? '') <= lastSeen) return false;
      if (state.sector && i.sector !== state.sector) return false;
      if (state.event && i.event_type !== state.event) return false;
      if (state.kind && (i.kind ?? 'news') !== state.kind) return false;
      if (state.tone === 'bull' && !(i.sentiment > 0.1)) return false;
      if (state.tone === 'bear' && !(i.sentiment < -0.1)) return false;
      if (state.q) {
        const hay = `${i.title} ${i.source} ${(i.tickers ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(state.q.toLowerCase())) return false;
      }
      return true;
    });
    list.replaceChildren(
      el('div', { class: 'faint', style: 'font-size:11.5px;margin-bottom:10px' },
        `${filtered.length} of ${items.length} stories`),
      ...(filtered.length
        ? filtered.slice(0, 250).map((i) => newsRow(i, ctx, lastSeen))
        : [el('div', { class: 'empty' }, 'Nothing matches those filters.')]));
  }

  const select = (label, key, options) => el('select', {
    'aria-label': label,
    onchange: (e) => { state[key] = e.target.value; draw(); },
  }, el('option', { value: '' }, label),
     ...options.map((o) => el('option', { value: o }, String(o).replace(/_/g, ' '))));

  const search = el('input', {
    type: 'search', placeholder: 'Search headlines, sources, tickers…',
    style: 'flex:1;min-width:190px',
    oninput: (e) => { state.q = e.target.value; draw(); },
  });

  const frag = el('div');

  frag.append(card(
    'Live news feed',
    `${items.length} stories held · adds on each refresh, never replaces`,
    newCount
      ? el('div', { class: 'banner' },
          el('b', {}, `${newCount} new `),
          `since you last opened this tab (${ago(lastSeen)}). `,
          'Marked with a dot on the left.')
      : null,
    el('div', { class: 'feed-controls' },
      search,
      select('All sectors', 'sector', sectorsPresent),
      select('All events', 'event', eventsPresent),
      select('All types', 'kind', ['news', 'filing', 'disclosure']),
      select('Any tone', 'tone', ['bull', 'bear']),
      lastSeen
        ? el('button', {
            class: 'btn sm',
            onclick: (e) => {
              state.onlyNew = !state.onlyNew;
              e.target.classList.toggle('primary', state.onlyNew);
              draw();
            },
          }, 'New only')
        : null,
      el('button', {
        class: 'btn sm',
        onclick: () => {
          lsSet(`${SEEN_KEY}.${ctx.bundle.market}`, new Date().toISOString());
          ctx.rerender();
        },
      }, 'Mark all read')),
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
