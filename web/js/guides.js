// Page guides: a header on every page plus an "ⓘ How to read this page" drawer
// explaining what the page is for, how to use it and what each number means.

import { conceptTitle } from './learn.js';
import { drawer, el, fmt, pct } from './lib.js';

const MARKET_NAME = { IN: 'India', US: 'US' };
const NOT_ADVICE = 'Everything here is educational analysis of public data — not investment advice.';

export const GUIDES = {
  // ------------------------------------------------------------ watchlist
  watchlist: {
    title: 'Watchlist',
    tagline: 'The stocks you follow: price, trend, momentum, news and the next scheduled event in one table.',
    purpose: 'Your home base. Use it to spot which of your stocks needs attention today — an unusual move, a stretched RSI, a burst of news or results coming up — and then open that stock for the detail.',
    steps: [
      'Type one or more tickers and press Add. On the India tab “WIPRO” becomes WIPRO.NS (NSE); add .BO for BSE. US tickers are plain, e.g. NFLX.',
      'Click a column header to sort: Day for today’s movers, RSI for stretched stocks, Next event for what reports soonest.',
      'Click a row for the chart (with 20- and 50-day averages), technicals, the model view, upcoming events and news.',
      'Update now (or ⟳ → Update watchlist) fetches fresh prices, news and events for every ticker on the list.',
      'Remove a ticker with ×.',
    ],
    metrics: [
      { name: 'Price', what: 'Last close, or a delayed quote if the update ran during market hours, in the market’s currency.',
        read: 'Never real-time. Use it for context, not for placing orders — your broker’s quote is the one that counts.' },
      { name: 'Day', what: 'Percentage change from the previous session’s close.',
        read: 'Size it against the stock’s ATR (in the stock detail). More than ~2× ATR is unusual for that stock; less is normal noise. Then compare with the index: falling 1% on a day the index fell 2% is strength.',
        example: 'ATR 1.2% and Day −3.0% → a 2.5× ATR move. Look for news or a filing.', concept: 'atr' },
      { name: '5D · 1M', what: 'Return over the last 5 and 20 trading sessions (about a week and a month).',
        read: 'Both positive: short-term uptrend. 1M up, 5D down: a pullback inside an uptrend. 1M down, 5D up: a bounce in a downtrend, which often fails. Compare with the index (Market page) to separate the stock from the market.',
        concept: 'relstrength' },
      { name: 'RSI', range: '0–100', what: '14-session Relative Strength Index: recent gains against recent losses. The bar turns red at 70 or above and green at 30 or below.',
        read: '30–70 is the normal zone. Above 70 = strong recent buying (overbought); below 30 = strong selling (oversold). In a strong trend RSI can stay above 70 for weeks, so it is not a sell signal on its own. Watch for divergence between price and RSI.',
        concept: 'rsi' },
      { name: 'News', what: 'Stories mentioning the ticker in the news window, and their average tone from −1 to +1. The tag is green above +0.1 and red below −0.1.',
        read: 'A jump in story count matters more than the tone. Read the headlines (News page, filter by ticker) before trusting the number — tone describes coverage, and most of it is already in the price.',
        concept: 'sentiment' },
      { name: 'Next event', what: 'The next scheduled results date, board meeting, dividend, bonus, split or other corporate action, from exchange filings (estimates are marked on the Calendar).',
        read: 'Stocks often move 2–3× their usual range on results day. Decide before the date whether you want to hold through it.',
        concept: 'results' },
      { name: 'Status line', what: 'Where your list is stored: “saved to watchlist.json” (local mode), “synced to GitHub”, or “saved in this browser”.',
        read: '“Not synced to GitHub” means GitHub refused the last save. Open ⚙ Settings → Check access for the exact fix.' },
    ],
    tips: [
      'Keep it to 10–20 names you can genuinely follow.',
      'Write down why each stock is on the list, and remove it when that reason is gone.',
      'Each Monday, open Calendar → Watchlist → Next 7 days to see who reports this week.',
    ],
    caveats: ['Prices are delayed or end-of-day.', 'A row with “No data yet” is waiting for the next update to fetch it.'],
  },

  // ----------------------------------------------------------------- news
  news: {
    title: 'News',
    tagline: 'Headlines and filings for this market, scored for tone and tagged by company, sector and event type.',
    purpose: 'Find out why something moved, and catch stories about your stocks or sectors before you act. Each story is tagged so you can filter down to what matters.',
    steps: [
      'Pick a scope: Watchlist (stories about your tickers), Sectors (choose sector chips) or All.',
      'Narrow with the ticker box, the headline search, Type (news, filings or both) and Tone (positive or negative).',
      'Click a ticker button on a story to open its chart and see whether the price reacted.',
      '↻ Fetch latest news pulls new headlines (1–2 minutes on GitHub, faster in local mode). Mark all read resets the blue “new” dots.',
    ],
    metrics: [
      { name: 'Tone number', range: '−1 to +1', what: 'Sentiment of the headline and summary. Green above +0.1, red below −0.1.',
        read: 'It measures how the coverage sounds, not whether it is good for the price. Word-based scoring misreads phrases like “loss narrows” (good news). Always read the headline.',
        concept: 'sentiment' },
      { name: 'N outlets', what: 'How many different sources carried essentially the same story.',
        read: 'One outlet with a dramatic claim is a rumour until confirmed. Five or more means the event is real and widely known — and likely already in the price.',
        concept: 'corroboration' },
      { name: 'Event tag', what: 'The type of event detected: earnings, guidance, rating change, M&A, management change, legal or regulatory, and so on.',
        read: 'Earnings, guidance and M&A move prices most. The Filings page shows how each type has actually moved prices here.',
        concept: 'pricedin' },
      { name: 'Sector tag · Filing tag', what: 'The sector the story affects, and whether it is an exchange filing rather than an article.',
        read: 'A filing is the primary source. Prefer it to an article about it.', concept: 'disclosures' },
      { name: 'LLM-scored', what: 'The headline was ambiguous for the word-based scorer and was re-scored by a language model.',
        read: 'Usually more accurate on nuance, but still a machine reading. Treat it as a hint.' },
      { name: 'Blue dot', what: 'Story is new since your last visit to this page.', read: 'Use New only to read just those.' },
    ],
    tips: [
      'Compare tone with the price reaction: bad news and a rising price means the news was less bad than feared.',
      'Read primary sources (filings) before articles about them.',
      'Be wary of “sources say” stories carried by a single outlet.',
    ],
    caveats: ['Coverage depends on public RSS feeds; small caps get few stories.', 'Headlines lag the market; by the time you read it, the move has usually happened.'],
  },

  // ------------------------------------------------------------- calendar
  calendar: {
    title: 'Calendar',
    tagline: 'Results, board meetings, dividends and other corporate actions, filterable by date window and type.',
    purpose: 'Know in advance which of your stocks has a scheduled event, so you can decide whether to hold through it, and check what has just happened.',
    steps: [
      'Choose a window: Past 7 days, Today, Next 7 days, Next 30 days, or Custom dates.',
      'Choose Watchlist or All companies, and search by ticker or company name.',
      'Toggle event types (Results, Board meetings, Dividends, Bonus · split · buyback, Fund raising, AGM · mergers · other). Several types combine as “any of these”.',
      'Open Filing ↗ to read the primary document — especially the purpose line of a board-meeting notice.',
      '⟳ → Refresh calendar fetches the latest filings.',
    ],
    metrics: [
      { name: 'Results', what: 'Date the quarterly or annual results will be approved and published.',
        read: 'The biggest scheduled price event for any stock. In India results often arrive after market hours, so the reaction shows up as a gap next morning.',
        concept: 'results' },
      { name: 'Board meeting', what: 'Prior notice to the exchange of a board meeting and its purpose (results, dividend, bonus, buyback, fund raising).',
        read: 'Read the purpose. “To consider financial results for the period ended September 30” means the Jul–Sep quarter results. SEBI rules require at least 2 working days’ notice; outcomes must be disclosed promptly after the meeting.',
        concept: 'boardmeeting' },
      { name: 'Dividend', what: 'Declared dividend with its ex-date or record date.',
        read: 'With T+1 settlement the ex-date is normally the record date. Buy before the ex-date to receive it — and expect the price to drop by about the dividend that morning.',
        concept: 'dividends' },
      { name: 'Bonus · split · buyback · fund raising', what: 'Actions that change the share count or return or raise capital.',
        read: 'Bonus and split are cosmetic (same value, more shares). Buybacks return cash. Rights issues, QIPs and preferential allotments dilute holders who do not take part.',
        concept: 'corpactions' },
      { name: 'Estimate tag', what: 'Date estimated by Yahoo Finance rather than announced in an exchange filing.',
        read: 'Approximate. The official date appears once the company files its board-meeting notice.' },
      { name: '★ and highlighted rows', what: 'The company is on your watchlist.', read: 'These are the events that affect you directly.' },
    ],
    tips: [
      'Check Next 7 days every Monday and Today every morning.',
      'Decide before results whether to hold, trim or hedge — not in the panic after.',
      'Use Past 7 days with the Filings page to see how recent events actually moved prices.',
    ],
    caveats: ['Exchange sources occasionally fail; the page keeps the last good data and says so.', 'US dates come from company announcements and estimates, which can shift.'],
  },

  // --------------------------------------------------------------- market
  market: {
    title: 'Market',
    tagline: 'The backdrop for every decision: trend regime, breadth, volatility, sectors and today’s biggest movers.',
    purpose: 'Most stocks move with their market and sector. Check the backdrop here before reading too much into any single stock.',
    steps: [
      'Read the four tiles left to right: Regime, Index today, Breadth, Volatility.',
      'Read “Today in one paragraph” for the day’s story.',
      'Check Sector leadership and the rotation table to see where money is moving.',
      'Scan Top gainers / losers and Unusual volume for names to investigate — click a row for the chart.',
    ],
    metrics: [
      { name: 'Regime', what: 'A label from three facts: is the index above its 50- and 200-day averages, and what share of stocks are above their own 50-day average.',
        read: '“Risk-on / broad uptrend”: index above both averages and more than 55% of stocks above their 50-DMA. “Uptrend, narrowing participation”: above the 200-DMA with more than 40% participating. “Corrective / below long-term trend”: index below its 200-DMA. “Risk-off / broad downtrend”: below the 200-DMA with fewer than 35% participating. Otherwise “Mixed / range-bound”. Buying breakouts works far better in the first than in the last.',
        concept: 'movingavg', now: (ctx) => ctx.bundle?.regime?.regime },
      { name: 'Index today', what: 'Daily change of the benchmark (Nifty 50 for India, S&P 500 for the US), with its 20-day return.',
        read: 'Your yardstick. A stock that fell 1% on a day the index fell 2% held up well.',
        concept: 'relstrength',
        now: (ctx) => { const r = ctx.bundle?.regime; return r ? `${pct(r.index_change_pct)} today, ${pct(r.index_ret_20d)} over 20 sessions` : null; } },
      { name: 'Breadth', what: 'Share of tracked stocks that rose today, and the share above their own 50-day average.',
        read: 'Above ~60% above the 50-DMA is a broad, healthy trend. Below ~35% while the index is near its highs means a few heavyweights carry the index — fragile.',
        concept: 'breadth',
        now: (ctx) => { const r = ctx.bundle?.regime; return r?.pct_above_sma50 != null ? `${fmt(r.pct_above_sma50, 0)}% above their 50-DMA` : null; } },
      { name: 'Volatility', what: 'India VIX or CBOE VIX — the 30-day volatility implied by index options, annualised. If unavailable, the index’s realised 20-day volatility.',
        read: 'India VIX roughly 10–15 calm, above 20 stressed. CBOE VIX below 15 calm, above 25–30 fearful. VIX ÷ 16 ≈ the typical daily index move in %. Rising VIX with a falling index is fear.',
        concept: 'volatility',
        now: (ctx) => { const r = ctx.bundle?.regime; return r?.vix != null ? `VIX ${fmt(r.vix, 1)} → typical daily move ≈ ${fmt(r.vix / 15.9, 2)}%` : null; } },
      { name: 'News sentiment', range: '−1 to +1', what: 'Recency-weighted tone of all market news (3-day half-life) with counts of positive, neutral and negative stories.',
        read: 'Context, not a signal. An extreme reading with a price that stops reacting is more interesting than the reading itself.',
        concept: 'sentiment' },
      { name: 'Sector leadership · rotation', what: 'Equal-weighted 1-, 5- and 20-day returns of each sector’s tracked stocks, with average RSI, leaders and laggards.',
        read: 'Watch changes in rank. A sector climbing from the bottom to the top over two weeks with average RSI still below 60 is rotation in progress.',
        concept: 'sectorrotation' },
      { name: 'Vol σ', what: 'Today’s volume vs its 20-day average, in standard deviations.',
        read: 'Above 2σ is unusual. A big move on heavy volume is more trustworthy than one on thin volume.', concept: 'volume' },
      { name: '52-week extremes', what: 'Stocks at or near their highest or lowest price of the past year.',
        read: 'New highs on heavy volume in a risk-on regime often continue. New lows mean the market is repricing the business — find out why before bottom-fishing.',
        concept: 'highs52' },
    ],
    tips: ['Check this page before acting on any single-stock idea.', 'Reduce position sizes when VIX is high or the regime is risk-off.'],
    caveats: ['Breadth uses the tracked universe here, not every listed stock.', 'Data is end-of-day or delayed.'],
  },

  // ---------------------------------------------------------------- ideas
  ideas: {
    title: 'Ideas',
    tagline: 'A transparent technical screen, ranked. Candidates to research — not recommendations.',
    purpose: 'Surface stocks where several technical conditions line up, so you spend research time on the most interesting names first.',
    steps: [
      'Read Bullish setups and Bearish setups, each ranked by combined score.',
      'Expand a row to see exactly which conditions fired and the stock’s close, ATR, expected move and confidence.',
      'Open the chart and read the news and filings before doing anything.',
      '★ Watch adds the stock to your watchlist.',
    ],
    metrics: [
      { name: 'Combined score', what: 'Technical setup points plus a model nudge of (probability − 0.5) × 8.',
        read: 'Setup points: +2 when price > 50-DMA > 200-DMA (−2 for the reverse); ±1.5 for volume ≥2σ in the day’s direction; +1.5 within 3% of the 52-week high, −1 within 5% of the low; +1 for RSI 55–70, −1 above 75, +0.5 below 30; +0.8 for a positive MACD histogram (−0.5 otherwise); +1 if the sector rose more than 2% in 5 days (−0.8 if it fell more than 2%). Higher = more conditions agree.',
        concept: 'movingavg' },
      { name: 'Bias', what: '“bullish setup” at a technical score of 3.5 or more, “bearish setup” at −3 or less.',
        read: 'The direction the conditions point. It says nothing about timing or valuation.' },
      { name: '% RS pill', what: 'Model probability that the stock beats the median stock over the horizon.',
        read: 'Relative, not absolute: in a falling market a 60% stock is expected to fall less than its peers.', concept: 'probability' },
      { name: 'ATR', what: 'Average True Range as % of price — the stock’s typical daily move.',
        read: 'Use it for stops (1.5–2 ATR away) and position size.', concept: 'atr' },
      { name: 'Expected vs median', what: '(probability − 0.5) × 2 × ATR% × √horizon.',
        read: 'A volatility-scaled expectation relative to the median stock. Not a price target.' },
      { name: 'Confidence', what: 'About the evidence, not the size of the probability.',
        read: 'Low whenever the model’s holdout AUC is below 0.52. High needs AUC ≥ 0.55, a probability more than 12 points from 50% and at least 3 news stories. Medium above 6 points.',
        concept: 'calibration' },
    ],
    tips: [
      'Prefer setups that agree with the market regime.',
      'Plan the exit before the entry: stop where the setup is invalid, size so the stop costs about 1% of capital.',
    ],
    caveats: ['The score has not been backtested as a trading strategy. Treat it as a filter, not an edge.'],
    risk: 'risk',
  },

  // ---------------------------------------------------------------- model
  model: {
    title: 'Model',
    tagline: 'Probability each stock beats the median stock over the next few sessions, and an honest scorecard of how that has gone.',
    purpose: 'Show what a simple, transparent model thinks — and, more importantly, how good it actually is — so you can decide how much weight to give it (usually: little).',
    steps: [
      'Read the four tiles and the verdict banner first: they tell you whether the model has any measurable edge right now.',
      'Sort the predictions table by P(beat median) or Confidence; click a row for the chart.',
      'Check the Live scorecard to see how matured predictions actually turned out.',
    ],
    metrics: [
      { name: 'Holdout AUC', range: '0.5 = coin flip', what: 'On data the model never saw, the chance it ranks a random outperformer above a random underperformer.',
        read: 'Below 0.52: no measurable edge. 0.52–0.56: small but real edge, useful only across many positions. Above 0.56: suspiciously strong — possibly overfitting.',
        concept: 'probability',
        now: (ctx) => { const m = ctx.meta?.model_metrics; return m?.holdout_auc != null ? `AUC ${fmt(m.holdout_auc, 3)}` : null; } },
      { name: 'Accuracy · base rate', what: 'Share of held-out predictions on the right side of 50%, and how often the outcome happens anyway.',
        read: 'Accuracy only means something compared with the base rate.', concept: 'samplesize' },
      { name: 'P(beat median)', what: 'Probability the stock outperforms the median stock over the horizon.',
        read: 'Not the chance it goes up. Green from 50% upward.', concept: 'relstrength' },
      { name: 'Technical only · News nudge', what: 'The probability from price features alone, and the adjustment from news tone in percentage points.',
        read: 'The nudge is 0.10 × news score, damped when there are fewer than 5 stories. A big nudge on two stories deserves little trust.' },
      { name: 'Exp. vs median', what: '(p − 0.5) × 2 × ATR% × √horizon.', read: 'The size of the expected relative move. Not a price target.' },
      { name: 'Top driver', what: 'The feature that pushed this prediction most.', read: 'Lets you check whether the reason makes sense to you.' },
      { name: 'Hit rate · Edge', what: 'Share of matured predictions that came true, and the margin over the base rate in percentage points.',
        read: 'An edge under ~1 point over a small sample is noise.', concept: 'samplesize' },
      { name: 'Brier score', what: 'Mean squared error of the probabilities. 0 is perfect; always saying 50% scores 0.25.',
        read: 'It must beat the baseline shown next to it for the probabilities to carry information.', concept: 'calibration' },
      { name: 'Calibration table', what: 'For each band of predicted probability, how often the stock actually outperformed.',
        read: 'Good calibration means the two columns roughly match. Predicted 65% but happened 50% = overconfident.', concept: 'calibration' },
    ],
    tips: ['Use the model as a tie-breaker between ideas, never as the reason for a trade.'],
    caveats: ['Short-horizon stock prediction is mostly noise. A model with AUC 0.53 is wrong nearly half the time.'],
  },

  // --------------------------------------------------------------- alerts
  alerts: {
    title: 'Alerts',
    tagline: 'Rule-based alerts on your watchlist stocks, sent to your phone if you have configured a channel.',
    purpose: 'Get told when something unusual happens to a stock you follow, so you do not have to watch the screen.',
    steps: [
      'Check the rules in force at the top.',
      'Read Recent alerts; each one says what fired and the numbers behind it.',
      'Push delivery (ntfy, Telegram, Discord and others) is configured as repository secrets — see the README.',
    ],
    metrics: [
      { name: 'Price move', what: 'Daily move of 3% or more (default). High severity at 5%.', read: 'Compare with ATR: 3% is routine for some stocks.', concept: 'atr' },
      { name: 'Volume spike', what: 'Volume at least 2.5σ above its 20-day average.', read: 'Something happened. Up = accumulation signature, down = distribution.', concept: 'volume' },
      { name: 'RSI ≥72 / ≤28', what: 'Momentum stretched in either direction.', read: 'Extended, not automatically a sell or buy.', concept: 'rsi' },
      { name: '52-week high / low · 200-DMA cross', what: 'Price within 0.5% of a 52-week extreme, or closing across the 200-day average on that day.', read: 'Important levels; check volume to judge conviction.', concept: 'highs52' },
      { name: 'News swing · model signal', what: 'Aggregate news tone beyond ±0.45 on 3+ stories, or a high-confidence model prediction.', read: 'Read the stories; model signals are weak evidence.' },
      { name: 'Severity', what: 'High (red), medium (amber), low (grey).', read: 'Read high first.' },
      { name: 'Cooldown', what: 'The same rule will not fire again for the same stock for 6 hours.', read: 'Stops repeat notifications.' },
    ],
    tips: ['Keep alerts to the watchlist so they stay rare and meaningful.'],
    caveats: ['Alerts fire when the pipeline runs, not tick-by-tick.'],
  },

  // ----------------------------------------------------------- sectornews
  sectornews: {
    title: 'Sector board',
    tagline: 'Every sector at a glance: tone of its news, its returns and how coverage is trending.',
    purpose: 'See which sectors the news and the money are moving towards or away from, and drill into the stories behind a sector.',
    steps: [
      'Scan the board: colour shows tone and returns (red bearish → green bullish).',
      'Click a sector for its stories, returns, leaders and laggards.',
      'Use Sentiment history to see whether tone is improving or worsening, and “What kind of news” to see what drives coverage.',
    ],
    metrics: [
      { name: 'Tone', range: '−1 to +1', what: 'Recency-weighted sentiment of the sector’s stories.', read: 'Coverage tone, not a forecast. Tone diverging from returns is the interesting case.', concept: 'sentiment' },
      { name: '1D · 5D · 20D', what: 'Equal-weighted return of the sector’s tracked stocks.', read: 'Changes in ranking matter more than levels.', concept: 'sectorrotation' },
      { name: 'Stories · + · −', what: 'Story count, with positive and negative counts.', read: 'A sudden rise in coverage often precedes or accompanies a big move.' },
      { name: 'Sentiment trend', what: 'Daily sector tone history.', read: 'Improving tone with flat prices can foreshadow rotation; check it against returns.' },
      { name: 'What kind of news', what: 'Event types driving coverage in the window.', read: 'Earnings season, regulation or M&A waves show up here first.' },
    ],
    tips: ['Use this with the Market page’s rotation table to confirm money is following the news.'],
    caveats: ['Sectors with few tracked stocks or stories can swing on a single headline.'],
  },

  // -------------------------------------------------------------- filings
  filings: {
    title: 'Filings',
    tagline: 'Official disclosures, recent high-impact catalysts and how each event type has actually moved prices here.',
    purpose: 'Read primary sources and learn from measured history how prices react to each kind of event — instead of assuming.',
    steps: [
      'Check Recent catalysts: high-impact events on tracked stocks in the last 3 days. Expand one for the price and volume reaction.',
      'Read “What each event type has actually done” for measured 5-day reactions.',
      'Scroll Filings and disclosures for the documents themselves.',
    ],
    metrics: [
      { name: 'Expected tone tag', what: 'How this type of event is usually read (bullish, bearish or mixed).', read: 'A prior, not a fact; the measured stats below tell you what actually happened.', concept: 'pricedin' },
      { name: 'Today · Volume σ · RSI', what: 'The stock’s reaction on the day, volume vs normal, and momentum.', read: 'Big move on heavy volume = the market took the news seriously.', concept: 'volume' },
      { name: 'Mean 5-day reaction', what: 'Average return in the 5 sessions after past events of this type, with median and % positive.',
        read: 'Shown only once a type has at least 8 graded cases. Even then, check the median and % positive — one outlier can drive the mean.', concept: 'samplesize' },
      { name: 'Graded of logged', what: 'Events recorded, and how many have had 5 sessions pass so they can be scored.', read: 'The stats get more reliable as this grows.' },
    ],
    tips: ['Prefer filings to articles about them.', 'Insider and promoter purchases are more informative than sales.'],
    caveats: ['Trading on unpublished information is illegal. Everything here is public.', 'Indian filings are partly sourced second-hand; check the exchange link.'],
    risk: 'disclosures',
  },

  // ---------------------------------------------------------------- learn
  learn: {
    title: 'Learn',
    tagline: 'One new concept a day — explained, worked through on your own data, and checked with a quiz.',
    purpose: 'Build the knowledge behind every number in this dashboard, one concept at a time, from beginner to advanced.',
    steps: [
      'Read today’s concept: what it is, why it matters, the formula and a worked example.',
      '“On your data right now” applies the concept to your watchlist or this market.',
      'Answer the quiz — you get the explanation immediately.',
      'Mark it as learned. Tomorrow brings the next unlearned concept; Next concept → moves on early.',
      '“Explained: what happened today” turns real moves into short lessons. The library lets you jump to any concept.',
    ],
    metrics: [
      { name: 'Concepts learned', what: 'Concepts you have marked as learned, overall and per level.', read: 'Stored in this browser only.' },
      { name: 'Quiz score', what: 'Correct answers out of those you have attempted.', read: 'If you miss one, re-read the “How it works” section and try again from the library.' },
    ],
    tips: ['Ten minutes a day beats an hour once a week.', 'After each concept, find one example of it on the Market or Watchlist page.'],
    caveats: [],
  },

  // ---------------------------------------------------------------- about
  about: {
    title: 'About',
    tagline: 'Where the data comes from, when it was last updated and what this dashboard cannot do.',
    purpose: 'Know the limits of the data before you rely on it.',
    steps: ['Check Last run to see how fresh the data is.', 'Read Limitations and the disclaimer once.'],
    metrics: [
      { name: 'Last run', what: 'When the pipeline last built this data, and which mode (full, quotes, news, events, quick).', read: 'Older than a trading day? Use ⟳ to update.' },
      { name: 'LLM', what: 'The language model used to explain moves and re-score ambiguous headlines, if any.', read: '“none” means rule-based text only.' },
      { name: 'News window', what: 'How many days of news feed into sentiment.', read: 'Shorter windows react faster but are noisier.' },
      { name: 'Markets', what: 'Markets built in the last run, and any that failed.', read: 'A failed market keeps showing its previous data.' },
    ],
    tips: [],
    caveats: [],
  },
};

function metricBlock(m, ctx) {
  let now = null;
  try { now = m.now?.(ctx) ?? null; } catch { now = null; }
  return el('div', { class: 'g-metric' },
    el('div', { class: 'g-metric-name' }, m.name, m.range ? el('span', { class: 'g-range' }, m.range) : null),
    el('p', {}, el('b', {}, 'What it is: '), m.what),
    el('p', {}, el('b', {}, 'How to read it: '), m.read),
    m.example ? el('p', { class: 'g-example' }, el('b', {}, 'Example: '), m.example) : null,
    now ? el('p', { class: 'g-now' }, el('b', {}, 'Right now: '), now) : null,
    m.concept ? el('button', {
      class: 'btn sm g-learn', onclick: () => ctx.openConcept(m.concept),
    }, `📖 Learn: ${conceptTitle(m.concept)}`) : null);
}

export function openGuide(view, ctx) {
  const g = GUIDES[view];
  if (!g) return;
  const section = (title, ...body) => el('section', { class: 'g-section' }, el('h4', {}, title), ...body);
  drawer(`${g.title} · how to read this page`,
    el('p', { class: 'g-purpose' }, g.purpose),
    section('How to use it', el('ol', {}, ...g.steps.map((s) => el('li', {}, s)))),
    g.metrics.length ? section('Metrics and what they mean', ...g.metrics.map((m) => metricBlock(m, ctx))) : null,
    g.tips.length ? section('Good habits', el('ul', {}, ...g.tips.map((t) => el('li', {}, t)))) : null,
    g.caveats.length ? section('Watch out', el('ul', { class: 'g-caveats' }, ...g.caveats.map((t) => el('li', {}, t)))) : null,
    g.risk ? el('button', { class: 'btn sm g-learn', onclick: () => ctx.openConcept(g.risk) }, `📖 Learn: ${conceptTitle(g.risk)}`) : null,
    el('p', { class: 'faint g-foot' }, NOT_ADVICE));
}

export function pageHead(view, ctx) {
  const g = GUIDES[view];
  if (!g) return el('div');
  return el('div', { class: 'page-head' },
    el('div', { class: 'page-title' },
      el('h2', {}, g.title, view === 'learn' || view === 'about'
        ? null : el('span', { class: 'page-market' }, MARKET_NAME[ctx.market] ?? ctx.market)),
      el('p', {}, g.tagline)),
    el('button', {
      class: 'guide-btn', id: 'guideBtn', type: 'button',
      title: 'What this page is for and how to read its numbers',
      onclick: () => openGuide(view, ctx),
    }, el('span', { class: 'guide-i', 'aria-hidden': 'true' }, 'i'), el('span', {}, 'How to read this page')));
}
