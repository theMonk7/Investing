// View renderers. Each export returns a DocumentFragment-ish element tree for
// the main pane. State comes in as `ctx` so views stay pure and testable.

import {
  ago, card, changePill, compact, display, el, fmt, meter, modal, pct, pill,
  sign, sparkline, stat, table, toast,
} from './lib.js';

const RSI_COLOUR = (v) => (v >= 70 ? 'var(--down)' : v <= 30 ? 'var(--up)' : 'var(--accent)');

const CONF_PILL = { high: 'up', medium: 'warn', low: 'neutral' };

function quoteMap(bundle) {
  return Object.fromEntries(bundle.quotes.map((q) => [q.symbol, q]));
}

// ---------------------------------------------------------------- overview
export function overview(ctx) {
  const { bundle, meta } = ctx;
  const r = bundle.regime || {};
  const s = bundle.market_sentiment || {};
  const frag = el('div');

  if (meta?.failed_markets?.length) {
    frag.append(el('div', { class: 'banner err' },
      `Last pipeline run failed for: ${meta.failed_markets.join(', ')}. Figures below may be stale.`));
  }

  frag.append(el('div', { class: 'grid g4', style: 'margin-bottom:16px' },
    stat('Regime', r.regime ?? '—',
      `Index ${fmt(r.index_close)} · RSI ${fmt(r.index_rsi14, 0)}`),
    stat('Index today', pct(r.index_change_pct),
      `20-day ${pct(r.index_ret_20d)}`, sign(r.index_change_pct)),
    stat('Breadth', `${fmt(r.advancers_pct, 0)}%`,
      `advancing · ${fmt(r.pct_above_sma50, 0)}% above 50-DMA`),
    stat('Volatility', r.vix != null ? fmt(r.vix) : `${fmt(r.realised_vol_20d, 1)}%`,
      r.vix != null ? `VIX ${pct(r.vix_change_pct)}` : 'realised 20-day, annualised',
      r.vix_change_pct > 0 ? 'down' : 'up')));

  // brief
  frag.append(card('Today in one paragraph',
    bundle.brief?.source?.startsWith('llm') ? `written by ${bundle.brief.source}` : 'rule-generated',
    el('p', { style: 'line-height:1.75;margin:0;color:var(--text-dim)' },
      bundle.brief?.text ?? 'No brief available.')));

  // sentiment + top movers side by side
  const sentCard = card('News sentiment', `${s.count ?? 0} stories, last ${meta?.news_window_days ?? 7} days`,
    el('div', { class: 'row', style: 'margin-bottom:12px' },
      el('div', { class: 'num', style: 'font-size:30px;font-weight:680' },
        (s.score >= 0 ? '+' : '') + fmt(s.score, 2)),
      pill(s.label ?? 'neutral', s.score > 0.1 ? 'up' : s.score < -0.1 ? 'down' : 'neutral')),
    el('div', { class: 'bar', style: 'height:8px;display:flex' },
      el('i', { style: `width:${bar(s.bullish, s)}%;background:var(--up)` }),
      el('i', { style: `width:${bar(s.neutral, s)}%;background:var(--border-strong)` }),
      el('i', { style: `width:${bar(s.bearish, s)}%;background:var(--down)` })),
    el('div', { class: 'row faint', style: 'margin-top:8px;font-size:11.5px;gap:14px' },
      `▲ ${s.bullish ?? 0} bullish`, `■ ${s.neutral ?? 0} neutral`, `▼ ${s.bearish ?? 0} bearish`),
    el('p', { class: 'faint', style: 'font-size:11.5px;margin:12px 0 0;line-height:1.6' },
      'Recency-weighted with a 3-day half-life. Measures coverage tone, not truth — '
      + 'much of it is already in the price.'));

  const topSectors = (bundle.sectors ?? []).slice(0, 6);
  const sectorCard = card('Sector leadership', '5-day, equal weighted',
    el('div', {}, ...topSectors.map((sec) =>
      el('div', { class: 'row', style: 'margin-bottom:9px' },
        el('span', { style: 'min-width:92px;font-weight:550' }, sec.sector),
        el('div', { class: 'bar', style: 'flex:1' },
          el('i', {
            style: `width:${Math.min(100, Math.abs(sec.ret_5d) * 12)}%;`
                 + `background:var(${sec.ret_5d >= 0 ? '--up' : '--down'})`,
          })),
        el('span', { class: `num ${sign(sec.ret_5d)}`, style: 'min-width:58px;text-align:right' },
          pct(sec.ret_5d))))));

  frag.append(el('div', { class: 'grid g2' }, sentCard, sectorCard));

  // watchlist snapshot
  const watched = bundle.quotes.filter((q) => q.watched);
  frag.append(card(`Your watchlist (${watched.length})`, 'click a row for detail',
    table(watchCols(ctx), watched, {
      onRow: (row) => stockDetail(ctx, row.symbol),
      initialSort: { key: 'change_pct', dir: -1 },
    })));

  // teaching teaser
  const lessons = (bundle.lessons ?? []).slice(0, 3);
  if (lessons.length) {
    frag.append(card('Why things moved today', 'full explanations in Learn',
      ...lessons.map((l) => lessonBlock(l, ctx))));
  }
  return frag;
}

const bar = (n, s) => {
  const total = (s.bullish ?? 0) + (s.neutral ?? 0) + (s.bearish ?? 0);
  return total ? ((n ?? 0) / total) * 100 : 33.3;
};

// --------------------------------------------------------------- watchlist
function watchCols(ctx) {
  return [
    { key: 'symbol', label: 'Symbol', render: (r) =>
        el('div', { class: 'sym' }, display(r.symbol), el('small', {}, r.name || r.sector)) },
    { key: 'close', label: 'Price', render: (r) =>
        el('span', { class: 'num' }, ctx.bundle.currency + fmt(r.close)) },
    { key: 'change_pct', label: 'Chg %', render: (r) => changePill(r.change_pct) },
    { key: 'ret_5d', label: '5D', render: (r) =>
        el('span', { class: `num ${sign(r.ret_5d)}` }, pct(r.ret_5d)) },
    { key: 'ret_20d', label: '20D', render: (r) =>
        el('span', { class: `num ${sign(r.ret_20d)}` }, pct(r.ret_20d)) },
    { key: 'rsi14', label: 'RSI', title: 'Relative Strength Index (14)',
      render: (r) => meter(r.rsi14, 0, 100, RSI_COLOUR(r.rsi14)) },
    { key: 'vol_z', label: 'Vol σ', title: 'Volume vs 20-day average, in standard deviations',
      render: (r) => el('span', { class: `num ${r.vol_z > 2 ? 'up' : ''}` }, fmt(r.vol_z, 1)) },
    { key: 'atr_pct', label: 'ATR%', title: 'Average True Range as % of price — daily travel',
      render: (r) => el('span', { class: 'num faint' }, fmt(r.atr_pct, 1)) },
    // `prob` is flattened onto each quote in app.js so the column can sort.
    { key: 'prob', label: `${ctx.meta?.predict_horizon_days ?? 5}D RS`,
      title: 'Model probability this stock beats the median stock over the horizon '
           + '(relative strength, not direction)',
      render: (r) => (r.prob == null
        ? el('span', { class: 'faint' }, '\u2014')
        : el('span', { class: `num ${r.prob > 0.55 ? 'up' : r.prob < 0.45 ? 'down' : ''}` },
            `${(r.prob * 100).toFixed(0)}%`)) },
  ];
}

export function watchlist(ctx) {
  const { bundle } = ctx;
  const frag = el('div');
  const watched = bundle.quotes.filter((q) => q.watched);

  const input = el('input', {
    type: 'text', placeholder: bundle.market === 'IN' ? 'e.g. WIPRO.NS' : 'e.g. NFLX',
    style: 'flex:1;min-width:180px', id: 'addSym',
  });
  const add = () => {
    let sym = input.value.trim().toUpperCase();
    if (!sym) return;
    if (bundle.market === 'IN' && !sym.includes('.')) sym += '.NS';
    ctx.addSymbol(sym);
    input.value = '';
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  frag.append(card('Manage watchlist',
    ctx.syncLabel,
    el('div', { class: 'row', style: 'margin-bottom:14px' },
      input,
      el('button', { class: 'btn primary', onclick: add }, '+ Add'),
      el('button', { class: 'btn', onclick: () => ctx.openSettings() }, '⚙ Sync settings')),
    el('div', { class: 'chips' }, ...ctx.watchSymbols.map((sym) =>
      el('span', { class: 'chip' }, display(sym),
        el('button', { title: 'Remove', onclick: () => ctx.removeSymbol(sym) }, '×')))),
    el('p', { class: 'faint', style: 'font-size:11.5px;margin:14px 0 0;line-height:1.6' },
      'Symbols use Yahoo Finance format: NSE tickers end in .NS (RELIANCE.NS), '
      + 'BSE in .BO, US tickers are plain (AAPL). Changes save to this browser '
      + 'immediately; with GitHub sync on they also commit to watchlist.json, '
      + 'so the scheduled pipeline fetches news and sends alerts for them.')));

  frag.append(card(`Watchlist detail (${watched.length})`, null,
    table([...watchCols(ctx),
      { key: 'pct_from_52w_hi', label: 'vs 52w hi',
        render: (r) => el('span', { class: 'num faint' }, pct(r.pct_from_52w_hi, 1)) },
      { key: 'sector', label: 'Sector', render: (r) => el('span', { class: 'faint' }, r.sector) },
    ], watched, { onRow: (r) => stockDetail(ctx, r.symbol), initialSort: { key: 'change_pct', dir: -1 } })));

  const missing = ctx.watchSymbols.filter((s) => !bundle.quotes.some((q) => q.symbol === s));
  if (missing.length) {
    frag.append(el('div', { class: 'banner' },
      `No data yet for ${missing.map(display).join(', ')}. `
      + 'These appear after the next pipeline run (or check the symbol is valid on Yahoo Finance).'));
  }
  return frag;
}

// ------------------------------------------------------------------ movers
export function movers(ctx) {
  const m = ctx.bundle.movers || {};
  const frag = el('div');
  const cols = [
    { key: 'symbol', label: 'Symbol', render: (r) =>
        el('div', { class: 'sym' }, display(r.symbol), el('small', {}, r.name)) },
    { key: 'close', label: 'Price', render: (r) => el('span', { class: 'num' }, fmt(r.close)) },
    { key: 'change_pct', label: 'Chg %', render: (r) => changePill(r.change_pct) },
    { key: 'ret_5d', label: '5D', render: (r) => el('span', { class: `num ${sign(r.ret_5d)}` }, pct(r.ret_5d)) },
    { key: 'vol_z', label: 'Vol σ', render: (r) => el('span', { class: 'num' }, fmt(r.vol_z, 1)) },
    { key: 'rsi14', label: 'RSI', render: (r) => meter(r.rsi14, 0, 100, RSI_COLOUR(r.rsi14)) },
  ];
  const onRow = (r) => stockDetail(ctx, r.symbol);

  frag.append(el('div', { class: 'grid g2' },
    card('Top gainers', null, table(cols, m.gainers ?? [], { onRow })),
    card('Top losers', null, table(cols, m.losers ?? [], { onRow }))));
  frag.append(el('div', { class: 'grid g2' },
    card('Unusual volume', 'largest deviation from 20-day average',
      table(cols, m.most_active ?? [], { onRow })),
    card('At 52-week extremes', 'breakout and breakdown watch',
      table(cols, [...(m.near_52w_high ?? []), ...(m.near_52w_low ?? [])], { onRow }))));
  return frag;
}

// ----------------------------------------------------------------- sectors
export function sectors(ctx) {
  const rows = ctx.bundle.sectors ?? [];
  return el('div', {},
    card('Sector rotation', 'equal-weighted average of tracked constituents',
      table([
        { key: 'sector', label: 'Sector' },
        { key: 'members', label: '#', render: (r) => el('span', { class: 'faint num' }, r.members) },
        { key: 'ret_1d', label: '1D', render: (r) => changePill(r.ret_1d) },
        { key: 'ret_5d', label: '5D', render: (r) => el('span', { class: `num ${sign(r.ret_5d)}` }, pct(r.ret_5d)) },
        { key: 'ret_20d', label: '20D', render: (r) => el('span', { class: `num ${sign(r.ret_20d)}` }, pct(r.ret_20d)) },
        { key: 'avg_rsi', label: 'Avg RSI', render: (r) => meter(r.avg_rsi, 0, 100, RSI_COLOUR(r.avg_rsi)) },
        { key: 'leaders', label: 'Leaders', sort: false, render: (r) =>
            el('span', { class: 'faint', style: 'font-size:11.5px' }, r.leaders.map(display).join(', ')) },
        { key: 'laggards', label: 'Laggards', sort: false, render: (r) =>
            el('span', { class: 'faint', style: 'font-size:11.5px' }, r.laggards.map(display).join(', ')) },
      ], rows, { initialSort: { key: 'ret_5d', dir: -1 } })),
    card('How to read this', null,
      el('p', { class: 'dim', style: 'line-height:1.7;margin:0' },
        'What matters is the change in ranking, not the level. A sector climbing from the '
        + 'bottom of the 5-day column toward the top, while its average RSI is still below 60, '
        + 'is rotation in progress rather than a move already over. Individual stocks inherit '
        + 'most of their return from their sector.')));
}

// ------------------------------------------------------------------- ideas
export function ideas(ctx) {
  const c = ctx.bundle.candidates || {};
  const frag = el('div');

  frag.append(el('div', { class: 'banner' },
    'These are screening results, not recommendations. Every score below is the sum of '
    + 'transparent technical conditions listed in the row — open one to see exactly what fired. '
    + 'Nothing here accounts for your risk tolerance, position size, taxes or holding period.'));

  const render = (rows, title, sub) => card(title, sub,
    el('div', {}, ...rows.map((r) => ideaRow(r, ctx))));

  frag.append(render(c.bullish ?? [], 'Bullish setups', 'ranked by combined technical + model score'));
  frag.append(render(c.bearish ?? [], 'Bearish setups', 'weakness, breakdowns, negative momentum'));
  return frag;
}

function ideaRow(r, ctx) {
  const scoreColour = r.combined_score > 0 ? 'var(--up)' : 'var(--down)';
  return el('details', { class: 'accordion' },
    el('summary', {},
      el('span', { style: 'font-weight:680;min-width:110px' }, display(r.symbol)),
      changePill(r.change_pct),
      pill(r.bias, r.bias.includes('bullish') ? 'up' : r.bias.includes('bearish') ? 'down' : 'neutral'),
      el('span', { class: 'faint', style: 'font-size:11.5px' }, r.sector),
      el('span', { class: 'spacer', style: 'flex:1' }),
      r.prob_outperform != null
        ? pill(`${(r.prob_outperform * 100).toFixed(0)}% RS`, CONF_PILL[r.confidence] ?? 'neutral')
        : null,
      el('span', { class: 'num', style: `font-weight:680;color:${scoreColour}` },
        r.combined_score > 0 ? `+${r.combined_score}` : r.combined_score)),
    el('div', { class: 'body' },
      el('ul', { style: 'margin:0 0 12px;padding-left:18px;line-height:1.8' },
        ...r.reasons.map((reason) => el('li', {}, reason))),
      el('div', { class: 'row', style: 'gap:16px;font-size:12px' },
        el('span', {}, `Close `, el('b', { class: 'num' }, fmt(r.close))),
        el('span', {}, `ATR `, el('b', { class: 'num' }, fmt(r.atr_pct, 1) + '%')),
        r.expected_rel_move_pct != null
          ? el('span', {}, 'Expected vs median ',
              el('b', { class: `num ${sign(r.expected_rel_move_pct)}` },
                pct(r.expected_rel_move_pct)))
          : null,
        r.confidence ? el('span', {}, 'Confidence ', pill(r.confidence, CONF_PILL[r.confidence])) : null,
        el('button', { class: 'btn sm', onclick: () => stockDetail(ctx, r.symbol) }, 'Open chart'),
        !ctx.watchSymbols.includes(r.symbol)
          ? el('button', { class: 'btn sm', onclick: () => ctx.addSymbol(r.symbol) }, '★ Watch')
          : null)));
}

// ------------------------------------------------------------------- model
export function model(ctx) {
  const m = ctx.meta?.model_metrics ?? {};
  const preds = Object.values(ctx.bundle.predictions ?? {});
  const auc = m.holdout_auc;
  const verdict = auc == null ? 'not trained'
    : auc < 0.52 ? 'no measurable edge — treat every probability as a coin flip'
    : auc < 0.56 ? 'small edge, consistent with realistic cross-sectional equity models'
    : 'unusually strong for this asset class — suspect overfitting or leakage';

  return el('div', {},
    el('div', { class: 'grid g4' },
      stat('Holdout AUC', auc != null ? fmt(auc, 3) : '—', '0.50 = coin flip'),
      stat('Accuracy', m.holdout_accuracy != null ? `${(m.holdout_accuracy * 100).toFixed(1)}%` : '—',
        `base rate ${m.base_rate_up != null ? (m.base_rate_up * 100).toFixed(1) + '%' : '—'}`),
      stat('Horizon', `${m.horizon_days ?? ctx.meta?.predict_horizon_days ?? 5}d`, 'trading days ahead'),
      stat('Training rows', compact(m.train_rows), `${compact(m.test_rows)} held out`)),

    el('div', { class: 'banner' },
      el('b', {}, 'What this predicts: '),
      'the probability a stock ', el('b', {}, 'beats the median stock'),
      ` over the next ${m.horizon_days ?? 5} sessions — relative strength, not direction. `,
      '60% does not mean "likely to rise"; in a falling market the top-ranked stock usually '
      + 'still falls, just less. An absolute-direction target was tried first and measured '
      + 'AUC 0.49 — worse than a coin flip — because market beta dominates it and these '
      + 'features cannot predict beta. ',
      el('b', {}, 'Verdict: '), verdict, '. ',
      'Logistic regression on technical features only, validated on a time-based holdout. '
      + 'News sentiment is applied afterwards as a separate capped adjustment, shown per '
      + 'stock, so the technical number and the news nudge stay visible independently.'),

    card('Per-stock predictions', `${preds.length} symbols`,
      table([
        { key: 'symbol', label: 'Symbol', render: (r) => el('span', { class: 'sym' }, display(r.symbol)) },
        { key: 'prob_outperform', label: 'P(beat median)', render: (r) =>
            el('div', { class: 'meter' },
              el('div', { class: 'bar' }, el('i', {
                style: `width:${r.prob_outperform * 100}%;`
                     + `background:var(${r.prob_outperform >= 0.5 ? '--up' : '--down'})`,
              })),
              el('span', { class: 'num', style: 'min-width:38px' },
                `${(r.prob_outperform * 100).toFixed(0)}%`)) },
        { key: 'prob_technical_only', label: 'Technical only', render: (r) =>
            el('span', { class: 'num faint' }, `${(r.prob_technical_only * 100).toFixed(0)}%`) },
        { key: 'sentiment_adjustment', label: 'News nudge', render: (r) =>
            el('span', { class: `num ${sign(r.sentiment_adjustment)}` },
              r.sentiment_adjustment ? (r.sentiment_adjustment * 100).toFixed(1) + 'pp' : '—') },
        { key: 'expected_rel_move_pct', label: 'Exp. vs median', render: (r) =>
            el('span', { class: `num ${sign(r.expected_rel_move_pct)}` },
              pct(r.expected_rel_move_pct)) },
        { key: 'confidence', label: 'Confidence', render: (r) =>
            pill(r.confidence, CONF_PILL[r.confidence] ?? 'neutral') },
        { key: 'driver', label: 'Top driver', sort: false, render: (r) =>
            el('span', { class: 'faint', style: 'font-size:11.5px' },
              `${r.drivers?.[0]?.label ?? '—'} (${r.drivers?.[0]?.direction ?? ''})`) },
      ], preds, { onRow: (r) => stockDetail(ctx, r.symbol),
                  initialSort: { key: 'prob_outperform', dir: -1 } })),

    card('What the numbers mean', null,
      el('p', { class: 'dim', style: 'line-height:1.75;margin:0 0 10px' },
        el('b', {}, 'AUC'), ' is the probability the model ranks a randomly chosen '
        + 'outperforming stock-day above a randomly chosen underperforming one. 0.50 is '
        + 'worthless. Realistic cross-sectional equity models sit at 0.52–0.56, and so does '
        + 'this one. That edge is real but small, shows up only across many independent '
        + 'positions, and is erased by overtrading.'),
      el('p', { class: 'dim', style: 'line-height:1.75;margin:0' },
        el('b', {}, 'Expected vs median'), ' scales the probability edge by the stock\'s own ATR '
        + 'and the square root of the horizon. It is a volatility-adjusted relative '
        + 'expectation, not a price target.')),
    scorecardCard(ctx));
}

function scorecardCard(ctx) {
  const sc = ctx.scorecard;
  if (!sc || sc.status !== 'ok') {
    return card('Live scorecard', 'realised accuracy since deployment',
      el('p', { class: 'dim', style: 'line-height:1.7;margin:0' },
        sc?.note ?? 'Not enough matured predictions yet. Every prediction is stored when '
        + 'made and graded once its horizon has elapsed, so this fills in after about a '
        + 'week of scheduled runs.'));
  }

  const edge = sc.hit_rate - sc.base_rate;
  const brierBetter = sc.brier_score < sc.brier_baseline;

  return card('Live scorecard', `${sc.n} matured predictions, ${sc.first_graded} → ${sc.last_graded}`,
    el('div', { class: 'grid g4', style: 'margin-bottom:14px' },
      stat('Hit rate', `${(sc.hit_rate * 100).toFixed(1)}%`,
        `base rate ${(sc.base_rate * 100).toFixed(1)}%`,
        edge > 0.01 ? 'up' : edge < -0.01 ? 'down' : ''),
      stat('Edge', `${(edge * 100).toFixed(1)}pp`, 'above base rate',
        edge > 0 ? 'up' : 'down'),
      stat('Brier', fmt(sc.brier_score, 4),
        `baseline ${fmt(sc.brier_baseline, 4)} — ${brierBetter ? 'informative' : 'no better than guessing'}`,
        brierBetter ? 'up' : 'down'),
      stat('Mean excess', sc.mean_excess_when_picked_pct != null
        ? pct(sc.mean_excess_when_picked_pct) : '—', 'on picks vs median',
        sign(sc.mean_excess_when_picked_pct))),

    sc.calibration?.length
      ? el('div', {},
          el('div', { class: 'faint', style: 'font-size:11px;font-weight:700;margin-bottom:8px;'
            + 'text-transform:uppercase;letter-spacing:.06em' }, 'Calibration'),
          table([
            { key: 'bucket', label: 'Predicted range' },
            { key: 'n', label: 'n' },
            { key: 'mean_predicted', label: 'Mean predicted',
              render: (r) => el('span', { class: 'num' }, `${(r.mean_predicted * 100).toFixed(1)}%`) },
            { key: 'actual_outperform_rate', label: 'Actually outperformed',
              render: (r) => el('span', {
                class: `num ${r.actual_outperform_rate >= r.mean_predicted ? 'up' : 'down'}`,
              }, `${(r.actual_outperform_rate * 100).toFixed(1)}%`) },
          ], sc.calibration))
      : null,

    sc.by_confidence && Object.keys(sc.by_confidence).length
      ? el('div', { class: 'row', style: 'margin-top:14px' },
          ...Object.entries(sc.by_confidence).map(([level, v]) =>
            pill(`${level}: ${(v.hit_rate * 100).toFixed(0)}% over ${v.n}`,
              CONF_PILL[level] ?? 'neutral')))
      : null,

    el('p', { class: 'faint', style: 'font-size:11.5px;margin:14px 0 0;line-height:1.6' }, sc.note));
}

// ------------------------------------------------------------------ alerts
export function alerts(ctx) {
  const rows = ctx.bundle.alerts ?? [];
  const th = ctx.meta?.alert_thresholds ?? {};
  return el('div', {},
    card('Alert rules in force', 'change these in the repo, not the browser',
      el('div', { class: 'chips' },
        pill(`price move ≥ ${th.pct_move ?? 3}%`, 'info'),
        pill(`volume ≥ ${th.volume_z ?? 2.5}σ`, 'info'),
        pill(`RSI ≥ ${th.rsi_high ?? 72} or ≤ ${th.rsi_low ?? 28}`, 'info'),
        pill('52-week high / low', 'info'),
        pill('200-DMA cross', 'info'),
        pill('news sentiment swing', 'info'),
        pill('high-confidence model signal', 'info'),
        pill(`cooldown ${th.cooldown_hours ?? 6}h per rule`, 'neutral')),
      el('p', { class: 'faint', style: 'font-size:11.5px;margin:12px 0 0;line-height:1.6' },
        'Alerts fire only for watchlist symbols. Set thresholds as repository variables '
        + '(ALERT_PCT_MOVE, ALERT_VOLUME_Z, ALERT_RSI_HIGH, ALERT_RSI_LOW, ALERT_COOLDOWN_HOURS).')),

    card(`Recent alerts (${rows.length})`, null,
      rows.length
        ? el('div', {}, ...rows.map((a) => el('div', { class: 'news-item' },
            el('div', { class: 'row', style: 'gap:8px;margin-bottom:4px' },
              pill(a.kind.replace(/_/g, ' '),
                a.severity === 'high' ? 'down' : a.severity === 'medium' ? 'warn' : 'neutral'),
              el('span', { class: 't', style: 'margin:0' }, a.title)),
            el('div', { class: 'dim', style: 'font-size:12.5px;line-height:1.6' }, a.body),
            el('div', { class: 'm', style: 'margin-top:5px' }, ago(a.ts)))))
        : el('div', { class: 'empty' }, 'No alerts yet. They appear after the pipeline runs.')));
}

// -------------------------------------------------------------------- news
export function news(ctx) {
  const { bundle } = ctx;
  const bySym = bundle.news_by_symbol ?? {};
  const frag = el('div');

  frag.append(card('Market-wide headlines',
    `${(bundle.market_news ?? []).length} stories, last ${ctx.meta?.news_window_days ?? 7} days`,
    ...(bundle.market_news ?? []).slice(0, 30).map(newsItem)));

  const symbols = Object.keys(bySym).sort();
  if (symbols.length) {
    frag.append(card('By watchlist stock', null,
      ...symbols.map((sym) => {
        const agg = (bundle.quotes.find((q) => q.symbol === sym) && bundle.predictions?.[sym]) || {};
        return el('details', { class: 'accordion' },
          el('summary', {},
            el('span', { style: 'font-weight:660' }, display(sym)),
            el('span', { class: 'faint', style: 'font-size:11.5px' }, `${bySym[sym].length} stories`),
            el('span', { style: 'flex:1' }),
            agg.sentiment_adjustment
              ? pill(`news nudge ${(agg.sentiment_adjustment * 100).toFixed(1)}pp`,
                  agg.sentiment_adjustment > 0 ? 'up' : 'down')
              : null),
          el('div', { class: 'body', style: 'padding-left:24px' }, ...bySym[sym].map(newsItem)));
      })));
  }
  return frag;
}

function newsItem(n) {
  const kind = n.sentiment > 0.1 ? 'up' : n.sentiment < -0.1 ? 'down' : 'neutral';
  return el('div', { class: 'news-item' },
    el('div', { class: 't' },
      n.link ? el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.title) : n.title),
    el('div', { class: 'm' },
      pill(`${n.sentiment >= 0 ? '+' : ''}${Number(n.sentiment).toFixed(2)}`, kind),
      el('span', {}, n.source),
      el('span', {}, ago(n.published)),
      n.scored_by?.startsWith('llm') ? pill('LLM-scored', 'info') : null));
}

// ------------------------------------------------------------------- learn
export function learn(ctx) {
  const lessons = ctx.bundle.lessons ?? [];
  const curriculum = ctx.curriculum ?? [];
  const frag = el('div');

  frag.append(card('Explained: what happened today',
    `${lessons.length} events detected`,
    lessons.length
      ? el('div', {}, ...lessons.map((l) => lessonBlock(l, ctx)))
      : el('div', { class: 'empty' }, 'Nothing unusual happened, so there is nothing to explain. '
          + 'Lessons appear when a stock moves sharply, volume spikes, RSI hits an extreme, '
          + 'or news clusters.')));

  const levels = ['beginner', 'intermediate', 'advanced'];
  for (const level of levels) {
    const items = curriculum.filter((c) => c.level === level);
    if (!items.length) continue;
    frag.append(card(level[0].toUpperCase() + level.slice(1), `${items.length} lessons`,
      ...items.map((c) => el('details', { class: 'accordion' },
        el('summary', {}, c.title,
          el('span', { style: 'flex:1' }),
          ...c.tags.map((t) => pill(t, 'neutral'))),
        el('div', { class: 'body' }, c.body)))));
  }
  return frag;
}

function lessonBlock(l, ctx) {
  return el('div', { class: `lesson ${l.severity}` },
    el('h4', {}, l.headline),
    el('p', {}, l.explanation),
    el('div', { class: 'row meta' },
      pill(l.kind.replace(/_/g, ' '), 'neutral'),
      el('span', {}, ago(l.ts)),
      el('span', {}, l.source?.startsWith('llm') ? `explained by ${l.source}` : 'rule-generated'),
      el('button', { class: 'btn sm', onclick: () => stockDetail(ctx, l.symbol) }, 'Chart'),
      ...(l.related_lessons ?? []).map((id) => {
        const lesson = (ctx.curriculum ?? []).find((c) => c.id === id);
        return lesson
          ? el('button', {
              class: 'btn sm',
              onclick: () => modal(lesson.title,
                el('p', { class: 'dim', style: 'line-height:1.75;white-space:pre-wrap' }, lesson.body)),
            }, `📖 ${lesson.title}`)
          : null;
      })));
}

// ------------------------------------------------------------------- about
export function about(ctx) {
  const meta = ctx.meta ?? {};
  return el('div', {},
    el('div', { class: 'grid g4' },
      stat('Last run', ago(meta.generated_at), meta.mode ? `mode: ${meta.mode}` : ''),
      stat('LLM', (meta.llm_provider ?? 'none').split(' ')[0], meta.llm_provider),
      stat('News window', `${meta.news_window_days ?? 7}d`, 'sentiment lookback'),
      stat('Markets', (meta.markets ?? []).join(' · '), meta.failed_markets?.length
        ? `failed: ${meta.failed_markets.join(', ')}` : 'all healthy')),
    card('Data sources', null,
      el('ul', { class: 'dim', style: 'line-height:1.9;margin:0;padding-left:18px' },
        el('li', {}, el('b', {}, 'Prices: '), 'Yahoo Finance via ',
          el('a', { href: 'https://github.com/ranaroussi/yfinance', target: '_blank', rel: 'noopener' }, 'yfinance'),
          ' — free, no key, covers NSE (.NS), BSE (.BO) and US.'),
        el('li', {}, el('b', {}, 'News: '), 'public RSS only — Moneycontrol, Economic Times, '
          + 'Business Standard, LiveMint, Google News, Yahoo Finance, CNBC, MarketWatch.'),
        el('li', {}, el('b', {}, 'Sentiment: '), 'VADER plus a finance lexicon; optionally re-scored '
          + 'by a free-tier LLM for ambiguous headlines.'),
        el('li', {}, el('b', {}, 'Indicators: '), 'computed in pandas in this repo — no TA-Lib, '
          + 'no pandas-ta, nothing to break in CI.'),
        el('li', {}, el('b', {}, 'Charts: '), el('a',
          { href: 'https://github.com/tradingview/lightweight-charts', target: '_blank', rel: 'noopener' },
          'TradingView lightweight-charts'), ' (Apache-2.0).'))),
    card('Limitations — read this', null,
      el('ul', { class: 'dim', style: 'line-height:1.9;margin:0;padding-left:18px' },
        el('li', {}, 'Prices are end-of-day or delayed intraday, never real-time. Do not trade off them.'),
        el('li', {}, 'Yahoo Finance is an unofficial endpoint. It breaks occasionally and adjusts '
          + 'history retroactively for splits and dividends.'),
        el('li', {}, 'The model trains on technicals only, because no multi-year news archive is '
          + 'available for free. Sentiment is a post-hoc adjustment, not a trained feature.'),
        el('li', {}, 'Sector definitions are hand-maintained in ', el('code', {}, 'pipeline/universe.py'),
          ' and cover the tracked universe only.'),
        el('li', {}, 'LLM-written text can be wrong even when told not to fabricate. Every number '
          + 'it quotes is also shown elsewhere in the UI — check it there.'),
        el('li', {}, 'Nothing here is investment advice, and none of it has been reviewed by anyone '
          + 'licensed to give it.'))),
    card('Disclaimer', null,
      el('p', { class: 'dim', style: 'line-height:1.75;margin:0' },
        meta.disclaimer ?? 'Educational tool. Not investment advice.')));
}

// ------------------------------------------------------------- stock modal
export async function stockDetail(ctx, symbol) {
  const q = quoteMap(ctx.bundle)[symbol];
  if (!q) { toast(`No data for ${display(symbol)} yet`, 'error'); return; }
  const pred = ctx.bundle.predictions?.[symbol];
  const stories = ctx.bundle.news_by_symbol?.[symbol] ?? [];
  const cur = ctx.bundle.currency;

  const chartBox = el('div', { id: 'chart' });
  const body = el('div', {},
    el('div', { class: 'row', style: 'gap:18px;margin-bottom:16px' },
      el('div', { class: 'num', style: 'font-size:30px;font-weight:700' }, cur + fmt(q.close)),
      changePill(q.change_pct),
      el('span', { class: 'faint', style: 'font-size:12px' },
        `O ${fmt(q.open)} · H ${fmt(q.high)} · L ${fmt(q.low)} · Vol ${compact(q.volume)}`),
      el('span', { style: 'flex:1' }),
      ctx.watchSymbols.includes(symbol)
        ? el('button', { class: 'btn sm', onclick: () => ctx.removeSymbol(symbol) }, '★ Unwatch')
        : el('button', { class: 'btn sm primary', onclick: () => ctx.addSymbol(symbol) }, '☆ Watch')),
    chartBox,
    el('div', { class: 'grid g4', style: 'margin:16px 0' },
      stat('RSI(14)', fmt(q.rsi14, 0), q.rsi14 >= 70 ? 'overbought' : q.rsi14 <= 30 ? 'oversold' : 'neutral'),
      stat('Volume', `${fmt(q.vol_z, 1)}σ`, 'vs 20-day average'),
      stat('ATR', `${fmt(q.atr_pct, 1)}%`, 'typical daily travel'),
      stat('52w range', `${fmt(q.pct_from_52w_hi, 1)}%`, `from high ${fmt(q.hi_52w)}`)),
    el('div', { class: 'grid g2' },
      card('Trend', null,
        kv('Close vs 50-DMA', `${fmt(q.sma50)} (${pct((q.close / q.sma50 - 1) * 100)})`),
        kv('Close vs 200-DMA', `${fmt(q.sma200)} (${pct((q.close / q.sma200 - 1) * 100)})`),
        kv('MACD histogram', fmt(q.macd_hist, 3)),
        kv('Bollinger %B', fmt(q.bb_pctb, 2)),
        kv('5 / 20 / 60-day return', `${pct(q.ret_5d)} · ${pct(q.ret_20d)} · ${pct(q.ret_60d)}`),
        kv('Annualised volatility', `${fmt(q.vol_20d, 1)}%`)),
      pred
        ? card(`Model, ${pred.horizon_days}-day horizon`, `holdout AUC ${fmt(pred.model_auc, 3)}`,
            el('div', { class: 'row', style: 'margin-bottom:6px' },
              el('div', { class: 'num', style: 'font-size:28px;font-weight:700' },
                `${(pred.prob_outperform * 100).toFixed(0)}%`),
              pill(pred.confidence + ' confidence', CONF_PILL[pred.confidence] ?? 'neutral'),
              el('span', { class: `num ${sign(pred.expected_rel_move_pct)}` },
                `exp. ${pct(pred.expected_rel_move_pct)} vs median`)),
            el('div', { class: 'dim', style: 'font-size:11.5px;margin-bottom:8px' },
              'Probability of beating the median stock over the horizon — relative '
              + 'strength, not direction.'),
            el('div', { class: 'faint', style: 'font-size:11.5px;margin-bottom:10px' },
              `Technical-only ${(pred.prob_technical_only * 100).toFixed(0)}%, `
              + `news adjustment ${(pred.sentiment_adjustment * 100).toFixed(1)}pp.`),
            ...(pred.drivers ?? []).map((d) => el('div', { class: 'row', style: 'margin-bottom:6px' },
              el('span', { style: 'min-width:170px;font-size:12.5px' }, d.label),
              el('div', { class: 'bar', style: 'flex:1' },
                el('i', {
                  style: `width:${Math.min(100, Math.abs(d.contribution) * 90)}%;`
                       + `background:var(${d.direction === 'bullish' ? '--up' : '--down'})`,
                })),
              el('span', { class: `num ${d.direction === 'bullish' ? 'up' : 'down'}`,
                style: 'min-width:52px;text-align:right;font-size:11.5px' },
                d.contribution > 0 ? `+${d.contribution}` : d.contribution))))
        : card('Model', null, el('div', { class: 'empty' }, 'No prediction — insufficient history.'))),
    stories.length
      ? card(`News (${stories.length})`, null, ...stories.map(newsItem))
      : null,
  );

  modal(`${display(symbol)} — ${q.name ?? ''}`, body);
  drawChart(ctx, symbol, chartBox);
}

function kv(k, v) {
  return el('div', { class: 'row', style: 'justify-content:space-between;padding:5px 0;font-size:12.5px' },
    el('span', { class: 'dim' }, k), el('span', { class: 'num' }, v));
}

async function drawChart(ctx, symbol, box) {
  if (!window.LightweightCharts) {
    box.replaceChildren(el('div', { class: 'empty' }, 'Chart library did not load.'));
    return;
  }
  let candles;
  try {
    const resp = await fetch(`${ctx.dataBase}/${ctx.bundle.market}/charts/${encodeURIComponent(symbol)}.json`
      + `?v=${encodeURIComponent(ctx.meta?.generated_at ?? '')}`);
    if (!resp.ok) throw new Error(String(resp.status));
    candles = await resp.json();
  } catch {
    box.replaceChildren(el('div', { class: 'empty' },
      'No chart data for this symbol yet — charts are generated for watchlist stocks '
      + 'on the next pipeline run.'));
    return;
  }

  const dark = document.documentElement.dataset.theme !== 'light';
  const chart = window.LightweightCharts.createChart(box, {
    layout: {
      background: { color: 'transparent' },
      textColor: dark ? '#93a1b8' : '#52627a',
      fontFamily: getComputedStyle(document.body).fontFamily,
    },
    grid: {
      vertLines: { color: dark ? '#1a2130' : '#eef2f8' },
      horzLines: { color: dark ? '#1a2130' : '#eef2f8' },
    },
    rightPriceScale: { borderColor: dark ? '#232c3d' : '#dde4ee' },
    timeScale: { borderColor: dark ? '#232c3d' : '#dde4ee', rightOffset: 4 },
    crosshair: { mode: 1 },
    autoSize: true,
  });

  const series = chart.addCandlestickSeries({
    upColor: '#26c281', downColor: '#f6465d', borderVisible: false,
    wickUpColor: '#26c281', wickDownColor: '#f6465d',
  });
  series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

  for (const [key, colour] of [['sma20', '#4f8cff'], ['sma50', '#a78bfa']]) {
    const line = chart.addLineSeries({ color: colour, lineWidth: 1.5, priceLineVisible: false });
    line.setData(candles.filter((c) => c[key] != null).map((c) => ({ time: c.time, value: c[key] })));
  }

  const vol = chart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: 'vol',
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(candles.map((c) => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? 'rgba(38,194,129,.35)' : 'rgba(246,70,93,.35)',
  })));

  chart.timeScale().fitContent();
}
