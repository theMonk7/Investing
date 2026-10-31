// Event detail: what a calendar event is, how the company has been doing,
// what the market expects, how the stock usually reacts, and which way the
// evidence leans. Results data comes from data/<market>/fundamentals.json.

import { baseSym, eventLabel, relDay, todayISO } from './calendar.js';
import { $, ago, display, drawer, el, fmt, pct, pill } from './lib.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CUR = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const DAY = 86400e3;

const EXPLAIN = {
  results: {
    what: 'The company publishes revenue, profit and earnings per share (EPS) for the quarter or year, usually with management commentary and sometimes guidance.',
    why: 'Price moves on the gap between the numbers and what investors expected, not on whether profit rose. Guidance about the coming quarters often matters more than the quarter itself.',
    concept: 'results',
  },
  board_meeting: {
    what: 'Advance notice to the exchange that the board will meet. The purpose line says what it will decide: results, a dividend, a bonus, a buyback or fund raising.',
    why: 'The meeting itself moves nothing. The outcome, published right after it, does.',
    concept: 'boardmeeting',
  },
  dividend: {
    what: 'A cash payout per share. You receive it if you own the shares at the close before the ex-date.',
    why: 'On the ex-date the price usually opens lower by about the dividend: value moves from the share to your bank account. It is not a loss.',
    concept: 'dividends',
  },
  bonus: {
    what: 'Free extra shares in a fixed ratio (1:1 doubles your share count).',
    why: 'Total value is unchanged; the price adjusts down by the ratio on the ex-date. Sometimes read as a confidence signal, and it improves liquidity.',
    concept: 'corpactions',
  },
  split: {
    what: 'Each share is divided into several shares of lower face value.',
    why: 'Cosmetic: same total value, more shares at a lower price. A rally on the news is about sentiment and accessibility, not value.',
    concept: 'corpactions',
  },
  buyback: {
    what: 'The company buys back its own shares, usually at a premium, and cancels them.',
    why: 'Returns cash and shrinks the share count, which lifts EPS. A tender price above market acts as a soft floor until the offer closes.',
    concept: 'corpactions',
  },
  fundraise: {
    what: 'Raising money by issuing new shares (QIP, rights issue, preferential allotment) or debt (NCDs, bonds).',
    why: 'New shares dilute existing holders and are often priced at a discount, which can weigh on the price. What the money is for matters: growth capex reads better than plugging a hole.',
    concept: 'corpactions',
  },
  merger: {
    what: 'A merger, demerger, acquisition or other scheme of arrangement.',
    why: 'It can change what you own. The price reacts to the terms (swap ratio, price paid) and to whether the deal creates or destroys value.',
    concept: 'pricedin',
  },
  agm: {
    what: 'A meeting where shareholders vote on resolutions: accounts, dividends, directors and special items.',
    why: 'Rarely moves the price unless a contested or unusual resolution is on the agenda.',
    concept: 'disclosures',
  },
  other: {
    what: 'A corporate announcement filed with the exchange.',
    why: 'Read the filing to judge whether it changes the business.',
    concept: 'disclosures',
  },
};

// ------------------------------------------------------------ formatting
function periodLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${MONTHS[(d.getMonth() + 10) % 12]}–${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const curSym = (code) => CUR[code] ?? (code ? `${code} ` : '');

function money(n, code) {
  if (n === null || n === undefined) return '—';
  const s = curSym(code);
  const a = Math.abs(n);
  if (code === 'INR') return a >= 1e7 ? `${s}${fmt(n / 1e7, a >= 1e10 ? 0 : 1)} Cr` : `${s}${fmt(n / 1e5, 1)} L`;
  if (a >= 1e9) return `${s}${fmt(n / 1e9, 2)}B`;
  if (a >= 1e6) return `${s}${fmt(n / 1e6, 1)}M`;
  return `${s}${fmt(n, 0)}`;
}

const perShare = (n, code) => (n === null || n === undefined ? '—' : `${curSym(code)}${fmt(n, 2)}`);
const pts = (n) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${fmt(n, 1)} pts`);
const tone = (n, hi = 0, lo = 0) => (n === null || n === undefined ? '' : n > hi ? 'up' : n < lo ? 'down' : '');
const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined,
  { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

function sec(title, sub, ...body) {
  return el('section', { class: 'ed-sec' },
    el('h4', {}, title, sub ? el('span', { class: 'ed-sub' }, sub) : null), ...body);
}

function tile(label, value, detail, cls = '') {
  return el('div', { class: 'ed-tile' },
    el('div', { class: 'k' }, label),
    el('div', { class: `v num ${cls}` }, value),
    detail ? el('div', { class: 'd' }, detail) : null);
}

function learnLink(ctx, id, text) {
  return id && ctx.openConcept
    ? el('button', { class: 'btn sm g-learn', onclick: () => ctx.openConcept(id) }, text ?? 'Learn more →')
    : null;
}

// ----------------------------------------------------------------- data
export function fundamentalsFor(ctx, sym) {
  const items = ctx.fundamentals?.items ?? {};
  if (items[sym]) return items[sym];
  const base = baseSym(sym);
  return Object.values(items).find((f) => baseSym(f.symbol) === base) ?? null;
}

function newsFor(ctx, sym) {
  const base = baseSym(sym);
  const cutoff = Date.now() - 21 * DAY;
  const seen = new Set();
  const all = [...(ctx.feed?.items ?? []), ...(ctx.bundle?.news_by_symbol?.[sym] ?? [])];
  return all.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    const about = baseSym(n.symbol ?? '') === base || (n.tickers ?? []).some((t) => baseSym(t) === base);
    return about && Date.parse(n.published) >= cutoff;
  }).sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));
}

function aggregate(items) {
  const scored = items.filter((n) => typeof n.sentiment === 'number');
  const avg = scored.length ? scored.reduce((s, n) => s + n.sentiment, 0) / scored.length : null;
  return {
    count: items.length,
    bullish: items.filter((n) => n.sentiment_label === 'bullish').length,
    bearish: items.filter((n) => n.sentiment_label === 'bearish').length,
    avg,
  };
}

// --------------------------------------------------------------- sections
function header(ctx, e, q) {
  const watched = ctx.watchSymbols.some((s) => baseSym(s) === baseSym(e.symbol));
  const types = e.types.filter((t) => t !== 'board_meeting');
  return el('div', { class: 'ed-head' },
    el('div', { class: 'ed-company' }, e.company || display(e.symbol),
      el('span', { class: 'faint num' }, ` ${display(e.symbol)}`)),
    el('div', { class: 'ed-when' },
      el('b', {}, longDate(e.date)), ` · ${relDay(e.date)}`, e.time ? ` · ${e.time}` : ''),
    el('div', { class: 'ed-tags' },
      ...(types.length ? types : e.types).map((t) => el('span', { class: `tag t-${t}` }, eventLabel({ types: [t] }))),
      e.estimated
        ? el('span', { class: 'tag est', title: 'Estimated by Yahoo Finance. Not yet filed with the exchange.' }, 'estimated date')
        : el('span', { class: 'tag' }, e.official ? `${e.source} filing` : e.source),
      watched ? el('span', { class: 'tag', style: 'color:var(--warn)' }, '★ watchlist') : null),
    e.detail ? el('p', { class: 'ed-detail' }, e.detail) : null,
    el('div', { class: 'row ed-actions' },
      e.link
        ? el('a', { class: 'btn sm', href: e.link, target: '_blank', rel: 'noopener noreferrer' },
            /\.pdf($|\?)/i.test(e.link) ? 'Read the filing (PDF) ↗' : 'Open the filing ↗')
        : null,
      q || watched ? el('button', { class: 'btn sm', onclick: () => ctx.openStock(e.symbol) }, 'Chart & technicals') : null,
      !watched && ctx.addSymbol
        ? el('button', { class: 'btn sm', onclick: (ev) => { ev.currentTarget.disabled = true; ctx.addSymbol(e.symbol); } },
            '+ Watchlist')
        : null));
}

function explainSection(ctx, e) {
  const type = e.types.find((t) => t !== 'board_meeting') ?? e.types[0];
  const x = EXPLAIN[type] ?? EXPLAIN.other;
  return sec('What this event is', null,
    el('p', {}, x.what),
    el('p', { class: 'dim' }, el('b', {}, 'Why the price may move: '), x.why),
    learnLink(ctx, x.concept));
}

function resultsVerdict(s) {
  const bits = [];
  const move = (v, what) => v !== null && v !== undefined
    && bits.push(`${what} ${v >= 0 ? 'up' : 'down'} ${fmt(Math.abs(v), 1)}%`);
  move(s.rev_yoy, 'revenue');
  move(s.ni_yoy, 'net profit');
  if (s.margin_chg_yoy !== null && s.margin_chg_yoy !== undefined && Math.abs(s.margin_chg_yoy) >= 0.3) {
    bits.push(`operating margin ${s.margin_chg_yoy > 0 ? 'wider' : 'narrower'} by ${fmt(Math.abs(s.margin_chg_yoy), 1)} pts`);
  }
  if (!bits.length) return null;
  const rev = s.rev_yoy ?? 0, ni = s.ni_yoy ?? 0;
  const [label, kind] = rev > 0 && ni > 0 ? ['Growing', 'up'] : rev < 0 && ni < 0 ? ['Shrinking', 'down'] : ['Mixed', 'warn'];
  return el('p', { class: 'ed-verdict' }, pill(label, kind),
    ` Against the same quarter last year: ${bits.join(', ')}.`);
}

function quarterSection(ctx, f, e) {
  const s = f.summary ?? {};
  const qs = (f.quarters ?? []).slice(0, 5);
  if (!qs.length) return null;
  const cur = f.statement_currency || f.currency;
  const latest = qs[0];
  const maxRev = Math.max(...qs.map((x) => x.revenue ?? 0)) || 1;
  const newerReport = (f.history ?? []).find((h) => h.actual !== null && h.actual !== undefined);
  const lagging = newerReport && Date.parse(newerReport.date) - Date.parse(latest.period) > 75 * DAY;
  const upcoming = e.date >= todayISO() && Date.parse(e.date) - Date.parse(latest.period) > 30 * DAY;
  const fxNote = f.statement_currency && f.currency && f.statement_currency !== f.currency
    ? `Statements are filed in ${f.statement_currency}; the share trades in ${f.currency}.` : null;

  return sec('How the company did', `last reported quarter: ${periodLabel(latest.period)}`,
    el('div', { class: 'ed-tiles' },
      tile('Revenue', money(latest.revenue, cur), `${pct(s.rev_yoy, 1)} YoY · ${pct(s.rev_qoq, 1)} QoQ`, tone(s.rev_yoy)),
      tile('Net profit', money(latest.net_income, cur), `${pct(s.ni_yoy, 1)} YoY · ${pct(s.ni_qoq, 1)} QoQ`, tone(s.ni_yoy)),
      tile('EPS', perShare(latest.eps, cur), s.eps_yoy !== null && s.eps_yoy !== undefined ? `${pct(s.eps_yoy, 1)} YoY` : 'per share'),
      tile('Operating margin', s.op_margin === null || s.op_margin === undefined ? '—' : `${fmt(s.op_margin, 1)}%`,
        `${pts(s.margin_chg_yoy)} YoY`, tone(s.margin_chg_yoy, 0.3, -0.3))),
    resultsVerdict(s),
    el('table', { class: 'ed-table' },
      el('thead', {}, el('tr', {}, ...['Quarter', 'Revenue', '', 'Op. margin', 'Net profit', 'EPS'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...qs.map((x) => el('tr', {},
        el('td', {}, periodLabel(x.period)),
        el('td', { class: 'num' }, money(x.revenue, cur)),
        el('td', { class: 'ed-bar-cell' }, el('i', { class: 'ed-bar', style: `width:${Math.max(4, ((x.revenue ?? 0) / maxRev) * 100)}%` })),
        el('td', { class: 'num' }, x.op_margin === null || x.op_margin === undefined ? '—' : `${fmt(x.op_margin, 1)}%`),
        el('td', { class: `num ${tone(x.net_income)}` }, money(x.net_income, cur)),
        el('td', { class: 'num' }, perShare(x.eps, cur)))))),
    el('p', { class: 'ed-note' },
      'YoY compares with the same quarter a year earlier (removes seasonality); QoQ with the quarter just before. ',
      'Operating margin = operating profit ÷ revenue: how much of each sale the business keeps before interest and tax. ',
      upcoming ? 'The results on this event’s date will add a newer quarter. ' : '',
      lagging ? `EPS for ${longDate(newerReport.date)} is out (below); the full statement usually follows within days. ` : '',
      fxNote ?? ''),
    learnLink(ctx, 'results', 'How to read a results release →'));
}

function expectationsSection(ctx, f, e) {
  const rows = (f.history ?? []).filter((h) => h.actual !== null && h.actual !== undefined).slice(0, 8);
  const r = f.reactions ?? {};
  const next = f.next && daysApart(f.next.date, e.date) <= 14 ? f.next : null;
  const cur = f.currency;
  if (!rows.length && !next) return null;

  let implied = null;
  if (next?.eps_estimate !== null && next?.eps_estimate !== undefined) {
    const yearAgo = rows.find((h) => Math.abs(daysApart(h.date, next.date) - 365) <= 30);
    if (yearAgo) implied = ((next.eps_estimate - yearAgo.actual) / Math.abs(yearAgo.actual)) * 100;
  }

  return sec('What the market expects', 'EPS estimate vs reported',
    next
      ? el('div', { class: 'ed-tiles' },
          tile('EPS estimate', perShare(next.eps_estimate, cur), `consensus for ${longDate(next.date)}`),
          implied !== null ? tile('Implied growth', pct(implied, 1), 'estimate vs same quarter last year', tone(implied)) : null,
          r.rated ? tile('Beat record', `${r.beats}/${r.rated}`, `avg surprise ${pct(r.avg_surprise, 1)}`, r.beats / r.rated >= 0.7 ? 'up' : r.beats / r.rated <= 0.4 ? 'down' : '') : null)
      : null,
    rows.length
      ? el('table', { class: 'ed-table' },
          el('thead', {}, el('tr', {}, ...['Reported', 'Estimate', 'Actual', 'Surprise', 'Day move', '5-day'].map((h) => el('th', {}, h)))),
          el('tbody', {}, ...rows.map((h) => el('tr', { class: daysApart(h.date, e.date) <= 5 ? 'hl' : '' },
            el('td', {}, h.date),
            el('td', { class: 'num' }, perShare(h.estimate, cur)),
            el('td', { class: 'num' }, perShare(h.actual, cur)),
            el('td', { class: `num ${tone(h.surprise_pct)}` }, pct(h.surprise_pct, 1)),
            el('td', { class: `num ${tone(h.move_pct)}` }, pct(h.move_pct, 1)),
            el('td', { class: `num ${tone(h.drift_5d_pct)}` }, pct(h.drift_5d_pct, 1))))))
      : null,
    el('p', { class: 'ed-note' },
      'Surprise = (actual − estimate) ÷ estimate. Day move runs from the close before the announcement to the first close after it; '
      + '5-day from the same base to five sessions later. Companies usually guide analysts toward beatable numbers, so a small beat is the norm, not good news.'));
}

function reactionSection(ctx, f, q) {
  const r = f?.reactions ?? {};
  if (!r.n) return null;
  const lines = [
    `Typical results-day move: ±${fmt(r.typical_abs_move, 1)}% (median of the last ${r.n} reports). `
      + `It closed higher ${r.up} of ${r.n} times; average move ${pct(r.avg_move, 1)}.`,
  ];
  if (q?.atr_pct) {
    lines.push(`For scale, an ordinary day moves about ${fmt(q.atr_pct, 1)}% (ATR), so results days run about ${fmt(r.typical_abs_move / q.atr_pct, 1)}× normal.`);
  }
  if (r.avg_move_beat !== null && r.avg_move_beat !== undefined && r.beats >= 2) {
    lines.push(r.avg_move_beat < 0
      ? `After beating estimates it still fell ${fmt(-r.avg_move_beat, 1)}% on average: investors expected more than the published consensus, so a beat alone has not been enough.`
      : `After beating estimates it rose ${fmt(r.avg_move_beat, 1)}% on average.`);
  }
  if (r.avg_move_miss !== null && r.avg_move_miss !== undefined && r.misses >= 2) {
    lines.push(r.avg_move_miss > 0
      ? `After misses it rose ${fmt(r.avg_move_miss, 1)}% on average: the bad news was already in the price.`
      : `After misses it fell ${fmt(-r.avg_move_miss, 1)}% on average.`);
  }
  return sec('How the stock usually reacts', `${r.n} past reports`,
    el('ul', { class: 'ed-list' }, ...lines.map((l) => el('li', {}, l))),
    r.n < 8 ? el('p', { class: 'ed-note' }, `Only ${r.n} reports: averages this small are fragile.`) : null,
    learnLink(ctx, 'pricedin', 'Why good news can sink a stock →'));
}

function whatHappened(f, e) {
  const h = (f?.history ?? []).find((x) => daysApart(x.date, e.date) <= 5);
  if (!h) {
    return sec('What happened', null, el('p', { class: 'dim' },
      'The numbers for this report are not in the data yet (Yahoo usually updates within a day of the release). '
      + 'Read the filing for the outcome, then refresh.'));
  }
  const beat = h.surprise_pct === null || h.surprise_pct === undefined ? null : h.surprise_pct >= 0;
  return sec('What happened', `reported ${longDate(h.date)}`,
    el('div', { class: 'ed-tiles' },
      h.actual !== null && h.actual !== undefined
        ? tile('EPS', perShare(h.actual, f.currency), `estimate ${perShare(h.estimate, f.currency)}`) : null,
      beat !== null ? tile('Surprise', pct(h.surprise_pct, 1), beat ? 'beat' : 'miss', beat ? 'up' : 'down') : null,
      h.move_pct !== null && h.move_pct !== undefined ? tile('Day move', pct(h.move_pct, 1), 'close before → first close after', tone(h.move_pct)) : null,
      h.drift_5d_pct !== null && h.drift_5d_pct !== undefined ? tile('After 5 sessions', pct(h.drift_5d_pct, 1), 'did the move stick?', tone(h.drift_5d_pct)) : null),
    beat !== null && h.move_pct !== null && h.move_pct !== undefined
      ? el('p', { class: 'ed-verdict' }, beat === h.move_pct >= 0
          ? `The price followed the numbers: a ${beat ? 'beat' : 'miss'} and a ${h.move_pct >= 0 ? 'rise' : 'fall'}.`
          : `The price went against the headline numbers (${beat ? 'beat but fell' : 'missed but rose'}): guidance, margins or expectations above the consensus mattered more.`)
      : null);
}

function setupSection(ctx, q, newsAgg) {
  if (!q) return null;
  const trend = q.close > q.sma50 && q.sma50 > q.sma200 ? ['Uptrend', 'up']
    : q.close < q.sma50 && q.sma50 < q.sma200 ? ['Downtrend', 'down'] : ['Mixed', ''];
  const regime = ctx.bundle?.regime;
  const mkt = ctx.bundle?.market_sentiment;
  return sec('Going into it', `price ${ctx.bundle?.currency ?? ''}${fmt(q.close)} · ${q.date}`,
    el('div', { class: 'ed-tiles' },
      tile('Trend', trend[0], 'price vs 50- and 200-day averages', trend[1]),
      tile('1 month', pct(q.ret_20d, 1), `5 days ${pct(q.ret_5d, 1)}`, tone(q.ret_20d)),
      tile('RSI', fmt(q.rsi14, 0), q.rsi14 >= 70 ? 'overbought' : q.rsi14 <= 30 ? 'oversold' : 'normal zone',
        q.rsi14 >= 70 ? 'down' : q.rsi14 <= 30 ? 'up' : ''),
      tile('From 52-week high', pct(q.pct_from_52w_hi, 1), `low ${pct(q.pct_from_52w_lo, 1)}`),
      tile('News tone', newsAgg.avg === null ? '—' : fmt(newsAgg.avg, 2),
        `${newsAgg.count} stories · ${newsAgg.bullish}▲ ${newsAgg.bearish}▼`, tone(newsAgg.avg, 0.1, -0.1)),
      regime?.regime ? tile('Market', String(regime.regime).split(/[,/]/)[0].trim(),
        [String(regime.regime).split(/[,/]/).slice(1).join(',').trim(), mkt ? `news mood ${mkt.label}` : '']
          .filter(Boolean).join(' · ') || null) : null));
}

function newsSection(ctx, items) {
  if (!items.length) return sec('Recent news', null, el('p', { class: 'dim' }, 'No stories about this company in the last 3 weeks.'));
  return sec('Recent news', `${items.length} in 3 weeks`,
    el('ul', { class: 'ed-news' }, ...items.slice(0, 6).map((n) => el('li', {},
      el('span', { class: `tag ${n.sentiment_label === 'bullish' ? 'bull' : n.sentiment_label === 'bearish' ? 'bear' : ''}` },
        typeof n.sentiment === 'number' ? fmt(n.sentiment, 2) : '·'),
      el('div', {},
        n.link ? el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.title) : n.title,
        el('small', {}, [n.source, ago(n.published), n.event_type?.replace(/_/g, ' ')].filter(Boolean).join(' · ')))))),
    learnLink(ctx, 'sentiment', 'What news tone can and cannot tell you →'));
}

function analystSection(ctx, f, q) {
  const a = f?.analysts ?? {};
  const v = f?.valuation ?? {};
  if (!f || (!a.target_mean && (v.pe === null || v.pe === undefined))) return null;
  const price = q?.close;
  const ratingKind = /buy/.test(a.rating ?? '') ? 'up' : /sell|under/.test(a.rating ?? '') ? 'down' : 'neutral';
  const range = a.target_low && a.target_high && a.target_high > a.target_low;
  const at = (x) => `${Math.max(0, Math.min(100, ((x - a.target_low) / (a.target_high - a.target_low)) * 100))}%`;
  return sec('Analysts & valuation', a.count ? `${a.count} analysts` : null,
    a.target_mean
      ? el('div', { class: 'ed-analyst' },
          a.rating ? pill(a.rating.replace(/_/g, ' '), ratingKind) : null,
          ` Average target ${perShare(a.target_mean, f.currency)} `,
          el('span', { class: tone(a.upside_pct) }, `(${pct(a.upside_pct, 1)} from here)`),
          range
            ? el('div', { class: 'ed-range', title: 'Lowest to highest analyst target' },
                el('i', { class: 'ed-range-mean', style: `left:${at(a.target_mean)}` }),
                price ? el('i', { class: 'ed-range-price', style: `left:${at(price)}` }) : null,
                el('span', { class: 'lo' }, perShare(a.target_low, f.currency)),
                el('span', { class: 'hi' }, perShare(a.target_high, f.currency)))
            : null,
          range && price ? el('div', { class: 'ed-note' }, 'Blue mark: average target · white mark: current price.') : null)
      : null,
    el('div', { class: 'ed-tiles' },
      tile('P/E', v.pe ? fmt(v.pe, 1) : '—', v.forward_pe ? `forward ${fmt(v.forward_pe, 1)}` : 'trailing 12 months'),
      tile('Profit margin', v.profit_margin === null || v.profit_margin === undefined ? '—' : `${fmt(v.profit_margin, 1)}%`, 'net, trailing'),
      tile('ROE', v.roe === null || v.roe === undefined ? '—' : `${fmt(v.roe, 1)}%`, 'return on equity'),
      tile('Debt / equity', v.debt_to_equity === null || v.debt_to_equity === undefined ? '—' : fmt(v.debt_to_equity / 100, 2), 'below 1 is modest'),
      tile('Dividend yield', v.dividend_yield === null || v.dividend_yield === undefined ? '—' : `${fmt(v.dividend_yield, 2)}%`, 'trailing')),
    el('p', { class: 'ed-note' },
      'Forward P/E below trailing P/E means analysts expect earnings to grow. Targets are 12-month views and are revised after results; '
      + 'a price already above the average target leaves less room for upside surprises.'),
    learnLink(ctx, 'valuation', 'How to use P/E and targets →'));
}

// ---------------------------------------------------------------- the lean
export function leanFactors({ f, q, newsAgg, pred }) {
  const out = [];
  const add = (effect, label, why) => out.push({ effect, label, why });
  const s = f?.summary ?? {};
  const r = f?.reactions ?? {};
  const a = f?.analysts ?? {};

  if (s.rev_yoy !== null && s.rev_yoy !== undefined && s.ni_yoy !== null && s.ni_yoy !== undefined) {
    const why = `Last quarter: revenue ${pct(s.rev_yoy, 1)}, net profit ${pct(s.ni_yoy, 1)} year on year.`;
    add(s.rev_yoy > 0 && s.ni_yoy > 0 ? 1 : s.rev_yoy < 0 && s.ni_yoy < 0 ? -1 : 0, 'Business momentum', why);
  }
  if (s.margin_chg_yoy !== null && s.margin_chg_yoy !== undefined && Math.abs(s.margin_chg_yoy) >= 1) {
    add(Math.sign(s.margin_chg_yoy), 'Margins', `Operating margin ${s.margin_chg_yoy > 0 ? 'widened' : 'narrowed'} ${fmt(Math.abs(s.margin_chg_yoy), 1)} pts on a year ago.`);
  }
  if (r.rated >= 4) {
    const rate = r.beats / r.rated;
    add(rate >= 0.75 ? 1 : rate <= 0.4 ? -1 : 0, 'Beat record', `Beat EPS estimates ${r.beats} of ${r.rated} times.`);
  }
  if (r.beats >= 2 && r.avg_move_beat !== null && r.avg_move_beat !== undefined && r.avg_move_beat < -0.5) {
    add(-1, 'High bar', `Beats have been sold (average ${pct(r.avg_move_beat, 1)}), so a normal beat may not lift it.`);
  }
  if (q) {
    if (q.ret_20d > 8 || (q.pct_from_52w_hi > -3 && q.rsi14 > 65)) {
      add(-1, 'Expectations already high', `Up ${pct(q.ret_20d, 1)} in a month, RSI ${fmt(q.rsi14, 0)}: good results may already be priced in.`);
    } else if (q.ret_20d < -8 || q.rsi14 < 35) {
      add(1, 'Low bar', `Down ${pct(q.ret_20d, 1)} in a month, RSI ${fmt(q.rsi14, 0)}: pessimism is priced in, so “less bad” can lift it.`);
    }
    const up = q.close > q.sma200 && q.sma50 > q.sma200;
    const down = q.close < q.sma200 && q.sma50 < q.sma200;
    add(up ? 1 : down ? -1 : 0, 'Trend', up ? 'Above a rising 200-day average: the path of least resistance is up.'
      : down ? 'Below a falling 200-day average: rallies tend to be sold.' : 'No clear long-term trend.');
  }
  if (newsAgg?.count >= 3 && newsAgg.avg !== null) {
    add(newsAgg.avg > 0.15 ? 1 : newsAgg.avg < -0.15 ? -1 : 0, 'News tone',
      `${newsAgg.count} stories, average tone ${fmt(newsAgg.avg, 2)} (${newsAgg.bullish} positive, ${newsAgg.bearish} negative).`);
  }
  if (a.upside_pct !== null && a.upside_pct !== undefined && (a.count ?? 0) >= 3) {
    add(a.upside_pct > 10 ? 1 : a.upside_pct < -3 ? -1 : 0, 'Analyst targets',
      a.upside_pct < -3 ? `Price is ${fmt(-a.upside_pct, 1)}% above the average target.` : `Average target is ${pct(a.upside_pct, 1)} from here.`);
  }
  if (pred?.prob_outperform !== null && pred?.prob_outperform !== undefined) {
    const p = pred.prob_outperform;
    add(p >= 0.55 ? 1 : p <= 0.45 ? -1 : 0, 'Model',
      `${Math.round(p * 100)}% probability of beating the index over ${pred.horizon_days ?? 'the next few'} days (a small, measured edge at best).`);
  }
  return out;
}

function leanSection(ctx, f, q, newsAgg, pred) {
  const factors = leanFactors({ f, q, newsAgg, pred });
  if (factors.length < 2) return null;
  const net = factors.reduce((s, x) => s + x.effect, 0);
  const pos = factors.filter((x) => x.effect > 0).length;
  const neg = factors.filter((x) => x.effect < 0).length;
  const [label, kind, line] = net >= 2
    ? ['Leans positive', 'up', 'More of the evidence points up than down.']
    : net <= -2 ? ['Leans negative', 'down', 'More of the evidence points down than up.']
      : ['Mixed · no clear edge', 'neutral', 'The evidence is split; the outcome is close to a coin flip.'];
  const typical = f?.reactions?.typical_abs_move ?? (q?.atr_pct ? q.atr_pct * 2 : null);
  return sec('Which way might it go?', 'evidence, not a forecast',
    el('div', { class: `ed-lean ${kind}` },
      el('div', { class: 'ed-lean-label' }, label),
      el('div', {}, `${line} ${pos} for · ${neg} against · ${factors.length - pos - neg} neutral.`),
      typical ? el('div', { class: 'ed-lean-size' },
        `Size the risk for roughly ±${fmt(typical, 1)}% on the day${f?.reactions?.n ? '' : ' (about 2× its daily ATR; no results history yet)'}.`) : null),
    el('ul', { class: 'ed-factors' }, ...factors.map((x) => el('li', { class: x.effect > 0 ? 'up' : x.effect < 0 ? 'down' : '' },
      el('span', { class: 'mark' }, x.effect > 0 ? '▲' : x.effect < 0 ? '▼' : '•'),
      el('div', {}, el('b', {}, x.label), ' ', x.why)))),
    el('p', { class: 'ed-note' },
      'Each factor is a simple, visible rule; they are counted, not weighted by a model. Even professionals call results-day direction '
      + 'only slightly better than chance. The dependable number here is the size of the move: use it to decide how much to hold through the event.'),
    learnLink(ctx, 'probability', 'Thinking in probabilities →'));
}

function noDataSection(ctx, e) {
  const watched = ctx.watchSymbols.some((s) => baseSym(s) === baseSym(e.symbol));
  return sec('Results data', null,
    el('p', { class: 'dim' },
      watched
        ? 'Not fetched yet for this stock. It is collected on the next news or full run, or fetch it now.'
        : 'Results history, estimates and analyst views are collected for your watchlist and for tracked companies with results due. '
          + 'Fetch it now for this one, or add it to your watchlist to keep it updated.'),
    ctx.connected
      ? el('button', { class: 'btn sm primary', onclick: () => ctx.fetchSymbols([e.symbol], 'results data') }, 'Fetch results data')
      : el('p', { class: 'ed-note' }, 'Connect GitHub (⚙ Settings) or run ./dev.sh to fetch on demand.'));
}

// ------------------------------------------------------------------ entry
export function openEvent(ctx, e) {
  const f = fundamentalsFor(ctx, e.symbol);
  const q = (ctx.bundle?.quotes ?? []).find((x) => baseSym(x.symbol) === baseSym(e.symbol));
  const pred = ctx.bundle?.predictions?.[q?.symbol ?? e.symbol];
  const news = newsFor(ctx, e.symbol);
  const newsAgg = aggregate(news);
  const results = e.types.includes('results');
  const past = e.date < todayISO();

  const body = [header(ctx, e, q), explainSection(ctx, e)];
  if (results && f && past) body.push(whatHappened(f, e));
  if (f) {
    body.push(quarterSection(ctx, f, e));
    if (results) body.push(expectationsSection(ctx, f, e), reactionSection(ctx, f, q));
  } else {
    body.push(noDataSection(ctx, e));
  }
  body.push(setupSection(ctx, q, newsAgg));
  if (!past) body.push(leanSection(ctx, f, q, newsAgg, pred));
  body.push(newsSection(ctx, news), analystSection(ctx, f, q));
  body.push(el('p', { class: 'ed-foot faint' },
    f ? `Results data: Yahoo Finance, fetched ${ago(f.fetched_at)}. Price reactions measured from daily closes. ` : '',
    'Educational analysis of public data, not investment advice.'));

  const close = drawer(`${display(e.symbol)} · ${eventLabel(e)}`, ...body.filter(Boolean));
  $('#modalRoot .drawer')?.classList.add('wide');
  return close;
}
