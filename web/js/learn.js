// Learn: one new concept a day, with a worked example, your own data and a quiz.

import { todayISO } from './calendar.js';
import { ago, card, display, el, fmt, lsGet, lsSet, modal, pct, pill } from './lib.js';

const KEY = 'mktdesk.learn';
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const LEVEL_PILL = { beginner: 'up', intermediate: 'info', advanced: 'warn' };
const PAGE_NAME = {
  watchlist: 'Watchlist', news: 'News', calendar: 'Calendar', market: 'Market', ideas: 'Ideas',
  model: 'Model', filings: 'Filings', sectornews: 'Sector board',
};

// ------------------------------------------------------- live-data helpers
const quotesFor = (ctx) => {
  const all = ctx.bundle?.quotes ?? [];
  const mine = all.filter((q) => ctx.watchSymbols.includes(q.symbol));
  return mine.length ? mine : all;
};
const scopeName = (ctx) =>
  ((ctx.bundle?.quotes ?? []).some((q) => ctx.watchSymbols.includes(q.symbol))
    ? 'your watchlist' : 'the tracked stocks');
const extreme = (rows, key, dir = 1) => rows
  .filter((r) => r[key] != null && !Number.isNaN(r[key]))
  .reduce((best, r) => (!best || (r[key] - best[key]) * dir > 0 ? r : best), null);
const n = (q) => display(q.symbol);
const money = (ctx, v, d = 2) => `${ctx.bundle?.currency ?? ''}${fmt(v, d)}`;
const upcoming = (ctx, types) => (ctx.events?.items ?? [])
  .filter((e) => e.date >= todayISO() && e.types.some((t) => types.includes(t)));
const watchedFirst = (ctx, rows) => {
  const mine = rows.filter((e) => ctx.watchSymbols.some((s) => display(s) === display(e.symbol)));
  return mine.length ? { rows: mine, whose: 'on your watchlist' } : { rows, whose: 'in this market' };
};

// --------------------------------------------------------------- concepts
export const CONCEPTS = [
  // ============================================================ beginner
  {
    id: 'movingavg', level: 'beginner', minutes: 4, page: 'watchlist',
    title: 'Moving averages: the trend in one line',
    summary: 'The average closing price over the last N sessions, recalculated every day. It smooths out noise so you can see which way a stock is really going.',
    why: 'Most of a stock’s risk comes from fighting the trend. A moving average tells you the trend in one glance, and the regime label on the Market page and the Ideas score are both built on them.',
    body: [
      'A simple moving average (SMA) adds the last N closes and divides by N. The 20-day average tracks the short-term swing, the 50-day the medium-term trend, and the 200-day the long-term trend that big investors watch.',
      'Read three things: is the price above or below the average, is the average rising or falling, and are the averages stacked in order (price > 50-DMA > 200-DMA is a clean uptrend; the reverse is a clean downtrend).',
      'When the 50-day crosses above the 200-day it is called a golden cross; below is a death cross. They are slow confirmations of what already happened, not predictions.',
    ],
    formula: 'SMA(N) = (C₁ + C₂ + … + Cₙ) / N\nC = closing price of each of the last N sessions',
    example: 'Five closes: 100, 102, 101, 103, 104. The 5-day SMA is 510 / 5 = 102. Price (104) is above its average, and the average is rising from the previous day: a short-term uptrend.',
    live: (ctx) => {
      const qs = quotesFor(ctx).filter((q) => q.sma50 && q.sma200);
      if (!qs.length) return null;
      const up = qs.filter((q) => q.close > q.sma50 && q.sma50 > q.sma200);
      const down = qs.filter((q) => q.close < q.sma50 && q.sma50 < q.sma200);
      return `In ${scopeName(ctx)}, ${up.length} of ${qs.length} stocks are in a clean uptrend (price > 50-DMA > 200-DMA)`
        + `${up.length ? `: ${up.slice(0, 5).map(n).join(', ')}` : ''}. ${down.length} are in a clean downtrend`
        + `${down.length ? `: ${down.slice(0, 5).map(n).join(', ')}` : ''}. Open any of them to see the averages on the chart.`;
    },
    mistakes: [
      'Treating a crossover as a precise entry signal. Averages lag by design.',
      'Using them in sideways markets, where price chops across the line and produces losing whipsaws.',
      'Ignoring the slope: price above a falling 200-DMA is a weaker picture than above a rising one.',
    ],
    quiz: [
      { q: 'A stock trades at ₹540. Its 50-DMA is ₹520 and its 200-DMA ₹480, both rising. What is the trend?',
        options: ['Long-term uptrend intact', 'Downtrend', 'No trend', 'Cannot tell without RSI'], answer: 0,
        why: 'Price above a rising 50-DMA which is above a rising 200-DMA is the textbook uptrend stack.' },
      { q: 'Why do moving-average crossover signals often lose money in sideways markets?',
        options: ['Volume is too low', 'They lag, so price keeps crossing back and forth (whipsaws)', 'The averages are calculated differently', 'RSI overrides them'], answer: 1,
        why: 'An average only reacts after the move. In a range, each signal arrives just as the swing reverses.' },
    ],
    related: ['rsi', 'breadth'],
  },
  {
    id: 'rsi', level: 'beginner', minutes: 4, page: 'watchlist',
    title: 'RSI: overbought is not a sell signal',
    summary: 'The Relative Strength Index compares recent gains with recent losses and squeezes the result onto a 0–100 scale.',
    why: 'RSI is the RSI column on your watchlist and part of the Ideas score. Read correctly, it tells you whether a move is stretched or whether momentum is fading.',
    body: [
      'RSI(14) looks at the last 14 sessions. If almost every day was up, RSI approaches 100; if almost every day was down, it approaches 0. 50 is balance.',
      'Convention says above 70 is overbought and below 30 oversold. But in a strong uptrend RSI can sit between 60 and 80 for weeks: that is what strength looks like, not a reason to sell.',
      'The more useful pattern is divergence. If price makes a new high but RSI makes a lower high, buying pressure is fading. If price makes a new low but RSI makes a higher low, selling is exhausting.',
      'Always read RSI with the trend. RSI 75 in a stock above a rising 200-DMA is momentum; RSI 75 in a stock below a falling 200-DMA is often a bear-market rally.',
    ],
    formula: 'RS = average gain ÷ average loss (14 sessions, Wilder smoothing)\nRSI = 100 − 100 ÷ (1 + RS)',
    example: 'Over 14 sessions the average gain is 1.2 and the average loss 0.6. RS = 2, so RSI = 100 − 100 / 3 = 66.7: strong but not stretched.',
    live: (ctx) => {
      const qs = quotesFor(ctx);
      const hi = extreme(qs, 'rsi14', 1);
      const lo = extreme(qs, 'rsi14', -1);
      if (!hi || !lo) return null;
      const ctxWord = (q) => (q.sma200 && q.close > q.sma200 ? 'above its 200-DMA, so read it as strength' : 'below its 200-DMA, so be wary of a rally in a downtrend');
      return `Highest RSI in ${scopeName(ctx)}: ${n(hi)} at ${fmt(hi.rsi14, 0)}, ${ctxWord(hi)}. `
        + `Lowest: ${n(lo)} at ${fmt(lo.rsi14, 0)}${lo.rsi14 <= 30 ? ' (oversold — check the news before assuming a bounce)' : ''}.`;
    },
    mistakes: [
      'Selling every time RSI crosses 70.',
      'Buying every time RSI drops below 30. Stocks in a downtrend stay oversold.',
      'Reading RSI without looking at the trend or the chart.',
    ],
    quiz: [
      { q: 'RSI is 78 and the stock is above a rising 200-DMA. The most reasonable reading?',
        options: ['Sell now, it is overbought', 'Strong momentum; overbought alone is not a sell signal', 'The stock is undervalued', 'Volume must be falling'], answer: 1,
        why: 'In an uptrend high RSI is normal. Look for divergence or a trend break before calling a top.' },
      { q: 'Price makes a new high but RSI makes a lower high. This is called…',
        options: ['Bullish divergence', 'A golden cross', 'Bearish divergence', 'A gap'], answer: 2,
        why: 'Price and momentum disagree: the new high was made with less buying force.' },
    ],
    related: ['movingavg', 'macd'],
  },
  {
    id: 'volume', level: 'beginner', minutes: 3, page: 'market',
    title: 'Volume: how many people agree with the move',
    summary: 'Volume is the number of shares traded. A price move on heavy volume has more participants, and so more conviction, behind it.',
    why: 'The Vol σ column and volume alerts flag days when far more shares changed hands than usual — often the first sign that news or a big investor is involved.',
    body: [
      'This dashboard expresses volume as a z-score: how many standard deviations today’s volume is from its 20-day average. 0 is normal, 2σ is unusual, 3σ+ is rare.',
      'A breakout on 2–3σ volume is more likely to hold than one on thin volume. A sharp fall on heavy volume after results shows that many holders acted on the news.',
      'Very high volume after a long decline can also mark capitulation: the last sellers giving up. Context — trend, news, level — decides which reading applies.',
    ],
    formula: 'Volume z = (today’s volume − 20-day average) ÷ 20-day standard deviation',
    example: 'Average daily volume 2.0M shares, standard deviation 0.5M. Today 3.5M trade: z = (3.5 − 2.0) / 0.5 = 3σ. Something happened; find out what.',
    live: (ctx) => {
      const hot = quotesFor(ctx).filter((q) => q.vol_z >= 2).sort((a, b) => b.vol_z - a.vol_z);
      if (!hot.length) return `No stock in ${scopeName(ctx)} traded at 2σ+ volume in the latest session — a quiet day.`;
      return `Unusual volume in ${scopeName(ctx)}: ${hot.slice(0, 5).map((q) => `${n(q)} ${fmt(q.vol_z, 1)}σ (${pct(q.change_pct, 1)})`).join(', ')}. Check the News page for the reason.`;
    },
    mistakes: [
      'Trusting a breakout that happened on below-average volume.',
      'Comparing raw volume across stocks. Compare a stock only with its own history.',
    ],
    quiz: [
      { q: 'Two stocks rise 4% today, one at 0.3σ volume and one at 3σ. Which move is more meaningful?',
        options: ['The 0.3σ one', 'The 3σ one', 'They are equal', 'Neither, volume never matters'], answer: 1,
        why: 'Heavy volume means many participants pushed the price; thin-volume moves reverse more easily.' },
      { q: 'A stock falls 5% on 4σ volume right after results. What does the volume tell you?',
        options: ['Many holders acted on the news; the move has conviction', 'The data is wrong', 'It will bounce tomorrow', 'Nothing'], answer: 0,
        why: 'Volume measures participation. It does not predict tomorrow, but it says the reaction was broad.' },
    ],
    related: ['gap', 'breadth'],
  },
  {
    id: 'gap', level: 'beginner', minutes: 3, page: 'watchlist',
    title: 'Gaps: when news arrives overnight',
    summary: 'A gap is when a stock opens well above or below the previous close, because news arrived while the market was shut.',
    why: 'Results, board decisions and global events usually land outside trading hours, so the biggest moves of a stock’s year are often gaps.',
    body: [
      'Gap up: open above the prior close. Gap down: open below it. The size relative to the stock’s ATR tells you how big the surprise was.',
      '“Gaps always fill” is a myth. Small gaps without news often fill within days; breakaway gaps on real news (results, guidance changes) frequently never do.',
      'Watch the first hour: a gap up that holds and closes near the high shows buyers defending it; one that fades to a red close shows sellers used it to exit.',
    ],
    formula: 'Gap % = (today’s open − yesterday’s close) ÷ yesterday’s close × 100',
    example: 'Yesterday’s close ₹1,000, today’s open ₹1,040: a +4% gap. If the stock’s ATR is 1.5%, that is a 2.7× ATR surprise.',
    live: (ctx) => {
      const gaps = quotesFor(ctx).filter((q) => q.gap_pct != null).map((q) => ({ ...q, abs: Math.abs(q.gap_pct) }));
      const big = extreme(gaps, 'abs', 1);
      if (!big) return null;
      return `Biggest opening gap in ${scopeName(ctx)} last session: ${n(big)} opened ${pct(big.gap_pct)} vs the prior close and finished ${pct(big.change_pct)} on the day.`;
    },
    mistakes: ['Shorting every gap up because “gaps fill”.', 'Chasing a gap without checking what caused it.'],
    quiz: [
      { q: 'Previous close ₹500, open ₹480. The gap is…',
        options: ['+4%', '−4%', '−20%', '0%, gaps use the close'], answer: 1,
        why: '(480 − 500) / 500 = −4%.' },
      { q: 'A stock gaps up 8% on strong results and raised guidance. Will the gap fill?',
        options: ['Always, within a week', 'Never', 'Often not: news-driven breakaway gaps frequently hold', 'Only if RSI > 70'], answer: 2,
        why: 'When the gap reflects a real change in the business, the market re-prices it rather than reversing.' },
    ],
    related: ['results', 'atr'],
  },
  {
    id: 'results', level: 'beginner', minutes: 5, page: 'calendar',
    title: 'Quarterly results: what to read and why the stock reacts',
    summary: 'Every listed company reports its revenue and profit every quarter. The price reaction depends on how the numbers compare with what the market expected.',
    why: 'Results days are the most important scheduled events for a stock. The Calendar shows when they are; this concept explains what to look for.',
    body: [
      'India: under SEBI’s listing rules (LODR Regulation 33) quarterly results must be published within 45 days of the quarter end, and annual audited results within 60 days. US companies file a 10-Q each quarter and usually release earnings earlier in a press release.',
      'Read in this order: revenue growth (is the business growing?), operating margin such as EBITDA margin (is it growing profitably?), net profit (PAT) and EPS, then exceptional or one-off items, and finally management commentary or guidance.',
      'Compare year-on-year (YoY: same quarter last year) because many businesses are seasonal. Quarter-on-quarter (QoQ) is useful for spotting a turn.',
      'The market already prices in an expectation (the consensus estimate). Profit up 15% can send a stock down if 25% was expected, and a smaller loss can send it up.',
    ],
    formula: 'YoY growth = (this quarter − same quarter last year) ÷ same quarter last year × 100\nEBITDA margin = EBITDA ÷ revenue × 100',
    example: 'Revenue ₹10,000 cr vs ₹9,000 cr a year ago: +11.1% YoY. EBITDA ₹2,000 cr gives a 20% margin, down from 22% last year: sales grew but profitability slipped, so watch what management says about costs.',
    live: (ctx) => {
      const { rows, whose } = watchedFirst(ctx, upcoming(ctx, ['results']));
      if (!rows.length) return null;
      return `Next results ${whose}: ${rows.slice(0, 5).map((e) => `${display(e.symbol)} on ${e.date}${e.estimated ? ' (estimate)' : ''}`).join(', ')}.`;
    },
    mistakes: [
      'Judging results by the headline profit alone; one-off gains or losses can distort it.',
      'Ignoring expectations: the reaction is about the surprise, not the absolute number.',
      'Comparing QoQ in seasonal businesses (retail, cement, travel).',
    ],
    quiz: [
      { q: 'Profit rose 15% YoY but the stock fell 6% on results day. The most likely reason?',
        options: ['The data feed is wrong', 'Results or guidance were below what the market expected', 'Profit growth is always bad', 'Results do not affect prices'], answer: 1,
        why: 'Prices move on surprise relative to expectations, not on whether the number went up.' },
      { q: 'Why compare a quarter with the same quarter last year (YoY)?',
        options: ['It is required by law', 'To remove seasonality', 'It always looks better', 'QoQ data is not published'], answer: 1,
        why: 'Many businesses have predictably strong and weak quarters; YoY compares like with like.' },
    ],
    related: ['boardmeeting', 'pricedin'],
  },
  {
    id: 'boardmeeting', level: 'beginner', minutes: 4, page: 'calendar',
    title: 'Board meetings: reading the notice',
    summary: 'In India a listed company must tell the exchange in advance when its board will meet to decide price-sensitive matters, and what they will consider.',
    why: 'The notice tells you what is coming and when: results, dividends, bonus issues, buybacks or fund raising. The Calendar’s board-meeting entries come from these filings.',
    body: [
      'SEBI’s listing rules (LODR Regulation 29) require prior intimation of board meetings that will consider results, dividends, buybacks, bonus issues or fund raising — generally at least two working days ahead, excluding the day of the notice and the meeting.',
      'The purpose line is the key. “To consider and approve the financial results for the period ended September 30” means the July–September quarter’s results will be approved and usually published the same day.',
      'After the meeting, the outcome (for example, the dividend amount or a bonus ratio) must be disclosed to the exchange quickly — within 30 minutes of the meeting ending for decisions like these.',
      'Insider trading rules close the “trading window” for designated insiders from the end of each quarter until 48 hours after results are published.',
    ],
    example: 'Notice on 28 Oct: “Board meeting on 31 Oct to consider Q2 results and an interim dividend.” Expect results on 31 Oct (often after market hours) and a record date for the dividend announced in the outcome filing.',
    live: (ctx) => {
      const { rows, whose } = watchedFirst(ctx, upcoming(ctx, ['board_meeting']));
      if (!rows.length) return null;
      return `Upcoming board meetings ${whose}: ${rows.slice(0, 5).map((e) => `${display(e.symbol)} on ${e.date}`).join(', ')}. Open the Calendar and read each purpose line.`;
    },
    mistakes: [
      'Assuming every board meeting is about results; read the purpose.',
      'Missing that outcomes are often released after market hours, so the reaction shows up as a gap the next morning.',
    ],
    quiz: [
      { q: 'A notice says “to consider and approve the financial results for the period ended September 30”. What happens at the meeting?',
        options: ['A dividend is paid', 'The July–September quarter results are approved and published', 'The company lists new shares', 'Nothing price-sensitive'], answer: 1,
        why: 'The period ended 30 September is the Q2 (Jul–Sep) quarter for most Indian companies.' },
      { q: 'How soon must an Indian listed company disclose a decision such as a dividend after the board meeting?',
        options: ['Within 30 minutes of the meeting ending', 'Within 30 days', 'At the next AGM', 'Only in the annual report'], answer: 0,
        why: 'Regulation 30 requires prompt disclosure of board outcomes — within 30 minutes for these decisions.' },
    ],
    related: ['results', 'dividends'],
  },
  {
    id: 'dividends', level: 'beginner', minutes: 4, page: 'calendar',
    title: 'Dividends: ex-date, record date and why it is not free money',
    summary: 'A dividend is cash paid to shareholders. Whether you receive it depends on owning the stock before the ex-date.',
    why: 'Dividend entries on the Calendar are only useful if you know which date matters and what happens to the price.',
    body: [
      'Four dates: declaration (board announces), ex-date (first day the stock trades without the right to the dividend), record date (the company checks its register) and payment date.',
      'With T+1 settlement (India since 2023, the US since May 2024) the ex-date is normally the same day as the record date. To receive the dividend you must buy before the ex-date, i.e. by the previous trading day.',
      'On the ex-date the price typically opens lower by roughly the dividend amount. Your total value is unchanged, and in India dividends are taxed as income at your slab rate, so buying just for the dividend usually loses money after tax.',
      'Dividend yield = annual dividend ÷ price. A very high yield can be a warning: the price may have fallen because the market expects the dividend to be cut.',
    ],
    formula: 'Dividend yield = annual dividend per share ÷ share price × 100',
    example: 'Price ₹500, annual dividend ₹15: yield 3%. On the ex-date the stock opens near ₹485 — you received ₹15 cash but hold ₹15 less in share value.',
    live: (ctx) => {
      const { rows, whose } = watchedFirst(ctx, upcoming(ctx, ['dividend']));
      if (!rows.length) return null;
      return `Upcoming dividend dates ${whose}: ${rows.slice(0, 5).map((e) => `${display(e.symbol)} ${e.date}`).join(', ')}.`;
    },
    mistakes: ['Buying the day before the ex-date expecting a free gain.', 'Chasing the highest yield without asking why it is high.'],
    quiz: [
      { q: 'The ex-date is Thursday (T+1 settlement). What is the last day you can buy and still get the dividend?',
        options: ['Thursday', 'Wednesday', 'Friday', 'The payment date'], answer: 1,
        why: 'You must own the shares before the ex-date, so the last buying day is the trading day before it.' },
      { q: 'Why is buying just before the ex-date not free money?',
        options: ['Dividends are never paid', 'The price drops by about the dividend and the dividend is taxed', 'Brokers keep the dividend', 'The record date moves'], answer: 1,
        why: 'Value moves from the share price into your bank account, minus tax.' },
    ],
    related: ['corpactions', 'boardmeeting'],
  },
  {
    id: 'corpactions', level: 'beginner', minutes: 4, page: 'calendar',
    title: 'Bonus, split, buyback and fund raising',
    summary: 'Corporate actions change the number of shares or the cash in the company. Some change nothing about value; others dilute you or return cash to you.',
    why: 'The Calendar’s “Bonus · split · buyback” and “Fund raising” filters show these events. Knowing which ones matter saves you from reacting to cosmetic changes.',
    body: [
      'Bonus issue (e.g. 1:1): one free share for each share held. Split (e.g. ₹10 face value to ₹2, a 1:5 split): each share becomes five. In both, the price adjusts proportionally and your total value is unchanged.',
      'Buyback: the company buys back its own shares, usually at a premium, returning cash and lifting earnings per share. In a tender-offer buyback only part of what you tender may be accepted (the acceptance ratio).',
      'Fund raising — rights issue, QIP (to institutions) or preferential allotment — creates new shares. Existing holders who do not participate are diluted. Raising money for growth can be good; raising it to repay debt is a warning sign.',
    ],
    example: 'You hold 100 shares at ₹1,000 (₹1,00,000). After a 1:1 bonus you hold 200 shares at about ₹500 — still ₹1,00,000. Charts adjust past prices so the history stays comparable.',
    mistakes: ['Thinking a bonus or split makes you richer.', 'Ignoring dilution from repeated equity raises.'],
    quiz: [
      { q: 'After a 1:1 bonus issue you have…',
        options: ['The same shares at a higher price', 'Twice the shares at about half the price, same value', 'Twice the value', 'Fewer shares'], answer: 1,
        why: 'A bonus capitalises reserves into shares; the pie is cut into more slices.' },
      { q: 'Which action raises fresh money and dilutes holders who do not take part?',
        options: ['Stock split', 'Bonus issue', 'Rights issue or QIP', 'Dividend'], answer: 2,
        why: 'New shares are issued for cash, so each existing share owns a smaller part of the company.' },
    ],
    related: ['dividends', 'valuation'],
  },
  {
    id: 'corroboration', level: 'beginner', minutes: 3, page: 'news',
    title: 'Is this story real? Corroboration and sources',
    summary: 'The number of outlets carrying a story is the cheapest accuracy check you have. Primary sources beat articles about them.',
    why: 'The News page shows “N outlets” on each story. A dramatic single-outlet headline is often a rumour, rewrite or old news recirculating.',
    body: [
      'A genuine market-moving event is picked up widely within hours. If only one site has it, treat it as unconfirmed.',
      'Prefer the primary source: the exchange filing beats a news article about the filing. Use the Filing ↗ links on the Calendar and the Filings page.',
      'Separate “the company announced” from “sources say”. The second is unverified by definition.',
      'Check timestamps. Syndicated copies of old news circulate constantly; a story you have not seen is not necessarily new.',
    ],
    example: '“Company X in talks to acquire Y — sources” appears on one site at 9:05. By 11:00 no other outlet has it, and X files a clarification denying it. The single-outlet flag was the warning.',
    mistakes: ['Trading on a single-source headline.', 'Confusing publish time with when the event happened.'],
    quiz: [
      { q: 'Which is the strongest evidence that an event really happened?',
        options: ['A viral social post', 'One blog with an exclusive', 'The company’s exchange filing', 'A headline with a big number'], answer: 2,
        why: 'The filing is the primary source and carries legal responsibility.' },
      { q: '“Sources say” in a headline means…',
        options: ['The company confirmed it', 'It is unverified', 'It is a filing', 'It is old news'], answer: 1,
        why: 'Anonymous sourcing may be right, but it is not confirmed until the company or regulator says so.' },
    ],
    related: ['sentiment', 'disclosures'],
  },
  {
    id: 'risk', level: 'beginner', minutes: 5, page: 'ideas',
    title: 'Position sizing: decide the loss before the trade',
    summary: 'How much you buy should depend on where you will exit if you are wrong, not on how confident you feel.',
    why: 'Most beginners do not lose money because they pick bad stocks; they lose because one or two oversized losers wipe out many small winners.',
    body: [
      'Pick a fixed small share of your capital to risk per position — 1% is common. Risk means the loss if your stop is hit, not the amount invested.',
      'Put the stop where your reason for owning the stock is proven wrong: below a recent swing low, below a key moving average, or about 1.5–2 ATR away. Then size the position so that hitting the stop costs exactly your risk amount.',
      'Volatile stocks therefore get smaller positions and calm stocks larger ones, for the same risk.',
      'Averaging down on a loser without a plan is how a small loss becomes a large one.',
    ],
    formula: 'Risk amount = capital × risk %\nShares = risk amount ÷ (entry − stop)',
    example: 'Capital ₹5,00,000 and 1% risk = ₹5,000. Entry ₹800, stop ₹760 (₹40 risk per share): 5,000 / 40 = 125 shares, a ₹1,00,000 position (20% of capital) that loses only 1% if the stop is hit.',
    live: (ctx) => {
      const q = quotesFor(ctx).find((x) => x.atr_pct && x.close);
      if (!q) return null;
      const stop = q.close * (1 - (2 * q.atr_pct) / 100);
      const shares = Math.floor(5000 / (q.close - stop));
      return `${n(q)} closed at ${money(ctx, q.close)} with ATR ${fmt(q.atr_pct, 1)}%. A stop 2 ATR below is ${money(ctx, stop)}. `
        + `With ${ctx.bundle?.currency ?? ''}5,000 of risk you could hold about ${shares} shares (${money(ctx, shares * q.close, 0)}).`;
    },
    mistakes: ['Investing the same amount in every stock regardless of volatility.', 'Moving the stop further away once it is close.', 'Having no exit plan at all.'],
    quiz: [
      { q: 'Capital ₹2,00,000, risk 1%, entry ₹400, stop ₹380. How many shares?',
        options: ['50', '100', '500', '5,000'], answer: 1,
        why: 'Risk ₹2,000 ÷ ₹20 per share = 100 shares.' },
      { q: 'Where should the stop go?',
        options: ['Wherever the loss starts to hurt', 'Where the reason for the trade is proven wrong', 'Always 10% below entry', 'No stop is needed for good companies'], answer: 1,
        why: 'Place the stop by the chart or thesis, then let the size absorb the distance.' },
    ],
    related: ['atr', 'volatility'],
  },

  // ======================================================= intermediate
  {
    id: 'atr', level: 'intermediate', minutes: 4, page: 'ideas',
    title: 'ATR: how far a stock normally moves',
    summary: 'Average True Range measures a stock’s typical daily range, including overnight gaps. Shown here as a percentage of price.',
    why: 'ATR tells you whether today’s move is news or noise, where to put a stop, and how big a position should be.',
    body: [
      'True range for a day is the largest of: high − low, |high − previous close| and |low − previous close|. ATR averages it over 14 sessions.',
      'Judging moves: a stock with ATR 1% that falls 3.5% made a 3.5× ATR move — unusual. A stock with ATR 4% falling 3.5% had an ordinary day.',
      'Stops placed 1.5–2 ATR away are outside normal noise. Combined with position sizing, ATR equalises risk across calm and volatile stocks.',
    ],
    formula: 'TR = max(high − low, |high − prev close|, |low − prev close|)\nATR(14) = average of TR over 14 sessions\nATR % = ATR ÷ close × 100',
    example: 'High 105, low 100, previous close 98. TR = max(5, 7, 2) = 7 — the gap from 98 counts, which a simple high − low would miss.',
    live: (ctx) => {
      const qs = quotesFor(ctx).filter((q) => q.atr_pct && q.change_pct != null);
      const big = extreme(qs.map((q) => ({ ...q, mult: Math.abs(q.change_pct) / q.atr_pct })), 'mult', 1);
      if (!big) return null;
      return `Largest move relative to its normal range in ${scopeName(ctx)}: ${n(big)} moved ${pct(big.change_pct)} with ATR ${fmt(big.atr_pct, 1)}% — ${fmt(big.mult, 1)}× ATR${big.mult >= 2 ? ', worth investigating' : ', within normal noise'}.`;
    },
    mistakes: ['Using a fixed-percentage stop for every stock.', 'Calling a 3% move “big” without checking the stock’s ATR.'],
    quiz: [
      { q: 'A stock’s ATR is 1%. It falls 3.5% today. That is…',
        options: ['Normal noise', 'An unusual move, 3.5× ATR — look for the reason', 'A buy signal', 'Impossible'], answer: 1,
        why: 'Moves over ~2× ATR are outside the stock’s normal behaviour.' },
      { q: 'Two stocks have ATR 1% and 4%. For the same risk per trade, which position is bigger?',
        options: ['The 4% ATR stock', 'Both equal', 'The 1% ATR stock', 'Neither can be traded'], answer: 2,
        why: 'A calmer stock needs a tighter stop, so you can hold more shares for the same rupee risk.' },
    ],
    related: ['risk', 'volatility'],
  },
  {
    id: 'relstrength', level: 'intermediate', minutes: 4, page: 'watchlist',
    title: 'Relative strength: the stock versus the market',
    summary: 'Relative strength compares a stock’s return with the market’s over the same period. It is not the same thing as RSI.',
    why: 'Most of a stock’s short-term move is the market’s move. Relative strength strips that out and shows whether the stock itself is attractive to buyers.',
    body: [
      'Subtract the index return from the stock return over the same window (5 days, 20 days, 3 months). Positive means the stock outperformed.',
      'Stocks that hold up during market declines often lead the next rally. Research on momentum has found that relative winners over the past 3–12 months tend to keep outperforming for a while, before eventually reversing.',
      'The Model page predicts exactly this: the probability a stock beats the median stock, not whether it goes up.',
    ],
    formula: 'Relative return = stock return − benchmark return (same period)',
    example: 'Over 20 sessions the index fell 4% and your stock fell 1%. Relative return = −1 − (−4) = +3 points: it outperformed in a falling market.',
    live: (ctx) => {
      const idx = ctx.bundle?.regime?.index_ret_20d;
      const qs = quotesFor(ctx).filter((q) => q.ret_20d != null);
      if (idx == null || !qs.length) return null;
      const rel = qs.map((q) => ({ ...q, rel: q.ret_20d - idx }));
      const best = extreme(rel, 'rel', 1);
      const worst = extreme(rel, 'rel', -1);
      return `The index returned ${pct(idx)} over 20 sessions. Strongest in ${scopeName(ctx)}: ${n(best)} at ${pct(best.ret_20d)} (${pct(best.rel)} relative). Weakest: ${n(worst)} at ${pct(worst.ret_20d)} (${pct(worst.rel)} relative).`;
    },
    mistakes: ['Confusing relative strength with RSI.', 'Calling a stock “strong” because it rose in a market that rose more.'],
    quiz: [
      { q: 'The index fell 4% this month and your stock fell 1%. Its relative return is…',
        options: ['−1%', '+3 points', '−5 points', '+4 points'], answer: 1,
        why: '−1 − (−4) = +3: it lost less than the market.' },
      { q: 'How is RSI different from relative strength?',
        options: ['They are identical', 'RSI compares a stock with its own recent gains and losses; relative strength compares it with the market', 'RSI uses volume', 'Relative strength is only for indices'], answer: 1,
        why: 'Same words, different measurements.' },
    ],
    related: ['probability', 'sectorrotation'],
  },
  {
    id: 'breadth', level: 'intermediate', minutes: 3, page: 'market',
    title: 'Market breadth: is the rally real?',
    summary: 'Breadth measures how many stocks take part in a move. An index can rise while most of its members fall.',
    why: 'The Breadth tile on the Market page and the regime label both use it. Narrow rallies are fragile.',
    body: [
      'Two measures here: the share of tracked stocks up today, and the share trading above their own 50-day average.',
      'Above about 60% above the 50-DMA is a healthy, broad trend. Below about 35% while the index sits near its highs means a few heavyweights carry the index.',
      'Breadth weakening while the index makes new highs is one of the few genuinely useful early warnings.',
    ],
    formula: 'Breadth = stocks above their 50-DMA ÷ stocks tracked × 100',
    example: 'The index is at a record, but only 30% of stocks are above their 50-DMA, down from 65% a month ago. Leadership is narrowing: be more selective.',
    live: (ctx) => {
      const r = ctx.bundle?.regime;
      if (r?.pct_above_sma50 == null) return null;
      return `Right now ${fmt(r.advancers_pct, 0)}% of tracked stocks rose in the last session and ${fmt(r.pct_above_sma50, 0)}% are above their 50-DMA. Regime: ${r.regime}.`;
    },
    mistakes: ['Reading the index level alone.', 'Expecting breadth to time the exact top; it is an early warning, not a trigger.'],
    quiz: [
      { q: 'The index is at a new high but only 30% of stocks are above their 50-DMA. This suggests…',
        options: ['A broad, healthy rally', 'A narrow rally led by a few large stocks', 'A crash tomorrow', 'Nothing'], answer: 1,
        why: 'Most stocks are not participating; the index is being carried by its biggest weights.' },
      { q: 'Which breadth reading points to a healthy trend?',
        options: ['20% above the 50-DMA', '65% above the 50-DMA', '0%', 'Breadth cannot show health'], answer: 1,
        why: 'Above ~60% means most stocks are in their own uptrends.' },
    ],
    related: ['movingavg', 'sectorrotation'],
  },
  {
    id: 'volatility', level: 'intermediate', minutes: 4, page: 'market',
    title: 'VIX: the market’s fear gauge',
    summary: 'VIX is the market’s expectation of volatility over the next 30 days, derived from index option prices and shown as an annualised percentage.',
    why: 'The Volatility tile shows India VIX or CBOE VIX. It tells you how big the swings are likely to be, which should change how much risk you take.',
    body: [
      'Realised volatility measures how much prices actually moved. Implied volatility (VIX) measures how much option buyers are paying for protection against future moves.',
      'Rough zones — India VIX: 10–15 calm, above 20 stressed. CBOE VIX: below 15 calm, above 25–30 fearful.',
      'VIX tends to spike when markets fall and to revert to its average afterwards. Extreme spikes have often come near short-term lows, but a high VIX can stay high in a real crisis.',
      'Convert to an expected move: VIX ÷ √252 ≈ expected daily move; VIX ÷ √12 ≈ expected monthly move (one standard deviation).',
    ],
    formula: 'Expected daily move ≈ VIX ÷ √252 ≈ VIX ÷ 15.9\nExpected monthly move ≈ VIX ÷ √12 ≈ VIX ÷ 3.46',
    example: 'India VIX at 16 implies a typical daily Nifty move of about 16 / 15.9 ≈ 1%, and a one-month range of about ±4.6%.',
    live: (ctx) => {
      const r = ctx.bundle?.regime;
      if (!r) return null;
      if (r.vix != null) {
        return `VIX is ${fmt(r.vix, 1)} (${pct(r.vix_change_pct)} on the day), implying a typical daily index move of about ${fmt(r.vix / 15.9, 2)}% and a one-month range of about ±${fmt(r.vix / 3.46, 1)}%.`;
      }
      return r.realised_vol_20d != null ? `VIX is unavailable; the index’s realised 20-day volatility is ${fmt(r.realised_vol_20d, 1)}% annualised.` : null;
    },
    mistakes: ['Treating a high VIX as a guaranteed bottom.', 'Keeping the same position sizes when VIX doubles.'],
    quiz: [
      { q: 'CBOE VIX jumps to 32. What does that mean?',
        options: ['Markets expect large swings; fear is high', 'Prices will rise 32%', 'Volume is 32% higher', 'Nothing useful'], answer: 0,
        why: 'Above 30 is historically a fearful market with large expected moves.' },
      { q: 'India VIX at 16 implies a typical daily index move of about…',
        options: ['16%', '4%', '1%', '0.1%'], answer: 2,
        why: '16 ÷ √252 ≈ 1%.' },
    ],
    related: ['atr', 'risk'],
  },
  {
    id: 'sentiment', level: 'intermediate', minutes: 4, page: 'news',
    title: 'News sentiment: what the score can and cannot tell you',
    summary: 'Each headline is scored from −1 (very negative) to +1 (very positive). The score measures how the coverage sounds, not whether the news is good for the price.',
    why: 'Tone tags appear on every story, on the Watchlist and the Sector board. Knowing their limits keeps you from over-trusting them.',
    body: [
      'The base scorer is VADER with a finance word list layered on, because general sentiment models read words like “beat”, “miss”, “downgrade” and “cut” as neutral. Ambiguous headlines may be re-scored by an LLM.',
      'Scores are aggregated with a 3-day half-life: today’s headline counts about twice as much as one from three days ago.',
      'Two cautions. Sentiment is coverage tone, not truth: a stock can rally on bad news that was less bad than feared. And most of it is already in the price by the time you read it.',
      'Word-based scoring also misreads phrases like “loss narrows” (good news) or sarcasm. Read the headline, not just the number.',
    ],
    formula: 'Weight of a story = 0.5 ^ (age in days ÷ 3)\nAggregate = Σ(weight × score) ÷ Σ(weight)',
    example: 'Two headlines: +0.6 today (weight 1.0) and −0.6 three days ago (weight 0.5). Aggregate = (0.6 − 0.3) / 1.5 = +0.2: mildly positive.',
    live: (ctx) => {
      const s = ctx.bundle?.market_sentiment;
      if (!s?.count) return null;
      return `Market tone now: ${s.score >= 0 ? '+' : ''}${fmt(s.score, 2)} (${s.label}) across ${s.count} stories — ${s.bullish} positive, ${s.neutral} neutral, ${s.bearish} negative.`;
    },
    mistakes: ['Trading the score instead of reading the story.', 'Assuming positive tone means the price will rise.'],
    quiz: [
      { q: 'A headline says “Company X’s quarterly loss narrows sharply”. A simple word-based scorer might mark it…',
        options: ['Correctly positive', 'Negative, because of the word “loss”', 'As a filing', 'As old news'], answer: 1,
        why: 'Word-level scoring sees “loss” and misses that the situation improved.' },
      { q: 'With a 3-day half-life, a 3-day-old story counts…',
        options: ['The same as today’s', 'Half as much as today’s', 'Not at all', 'Twice as much'], answer: 1,
        why: 'Half-life 3 days: weight halves every three days.' },
    ],
    related: ['corroboration', 'pricedin'],
  },
  {
    id: 'macd', level: 'intermediate', minutes: 4, page: 'ideas',
    title: 'MACD: momentum turning points',
    summary: 'MACD tracks the gap between a fast and a slow exponential moving average. Its histogram shows whether momentum is building or fading.',
    why: 'A positive MACD histogram adds points to the Ideas score, and the stock detail shows its value.',
    body: [
      'The MACD line is the 12-day EMA minus the 26-day EMA. The signal line is a 9-day EMA of the MACD line. The histogram is the difference between the two.',
      'Histogram above zero and rising: upward momentum strengthening. Shrinking towards zero: momentum fading, even if price is still rising.',
      'Like all averages it lags and whipsaws in ranges. It works best as confirmation of a trend you can already see.',
    ],
    formula: 'MACD = EMA(12) − EMA(26)\nSignal = EMA(9) of MACD\nHistogram = MACD − Signal',
    example: 'EMA12 = 210, EMA26 = 205, so MACD = 5. Signal = 4, so the histogram is +1: momentum is positive and above its own average.',
    live: (ctx) => {
      const qs = quotesFor(ctx).filter((q) => q.macd_hist != null);
      if (!qs.length) return null;
      const pos = qs.filter((q) => q.macd_hist > 0);
      return `${pos.length} of ${qs.length} stocks in ${scopeName(ctx)} have a positive MACD histogram${pos.length ? ` (${pos.slice(0, 6).map(n).join(', ')})` : ''}.`;
    },
    mistakes: ['Trading every signal-line cross in a sideways market.', 'Comparing MACD values across stocks; they depend on price level.'],
    quiz: [
      { q: 'The MACD histogram is positive but shrinking each day. What is happening?',
        options: ['Momentum is accelerating', 'Upward momentum is fading', 'The stock is falling', 'Volume is rising'], answer: 1,
        why: 'Positive means still up-momentum; shrinking means it is weakening.' },
      { q: 'MACD is built from…',
        options: ['Volume', 'Two exponential moving averages of price', 'RSI and ATR', 'News sentiment'], answer: 1,
        why: '12-day EMA minus 26-day EMA.' },
    ],
    related: ['movingavg', 'rsi'],
  },
  {
    id: 'bollinger', level: 'intermediate', minutes: 4, page: 'watchlist',
    title: 'Bollinger Bands and %B: stretched or squeezed',
    summary: 'Bands set two standard deviations above and below a 20-day average. %B says where the price sits inside them.',
    why: 'The stock detail shows Bollinger %B, and the Ideas page flags stocks riding or pinned to a band.',
    body: [
      '%B of 1 means price is at the upper band, 0 at the lower band, 0.5 at the average. Above 1 or below 0 means outside the bands.',
      'In strong trends prices “ride” the upper band for long stretches; touching it is not by itself a sell signal.',
      'A squeeze — bands unusually narrow — means volatility has compressed. Compressed volatility tends to be followed by a larger move; the direction is unknown until it breaks.',
    ],
    formula: 'Middle = SMA(20); Upper/Lower = Middle ± 2 × SD(20)\n%B = (price − lower) ÷ (upper − lower)',
    example: 'SMA20 = 100 and SD = 2.5, so bands are 95 and 105. Price 104: %B = (104 − 95) / 10 = 0.9 — near the top of its normal range.',
    live: (ctx) => {
      const qs = quotesFor(ctx).filter((q) => q.bb_pctb != null);
      const hi = extreme(qs, 'bb_pctb', 1);
      const lo = extreme(qs, 'bb_pctb', -1);
      if (!hi || !lo) return null;
      return `Most stretched in ${scopeName(ctx)}: ${n(hi)} at %B ${fmt(hi.bb_pctb, 2)}. Most depressed: ${n(lo)} at %B ${fmt(lo.bb_pctb, 2)}.`;
    },
    mistakes: ['Selling every upper-band touch in an uptrend.', 'Assuming a squeeze tells you the breakout direction.'],
    quiz: [
      { q: 'Price is 104, lower band 95, upper band 105. %B is…',
        options: ['0.1', '0.5', '0.9', '1.04'], answer: 2,
        why: '(104 − 95) / (105 − 95) = 0.9.' },
      { q: 'Unusually narrow bands (a squeeze) suggest…',
        options: ['A big move is likely soon, direction unknown', 'The stock will fall', 'The stock will rise', 'Trading has stopped'], answer: 0,
        why: 'Low volatility tends to be followed by high volatility.' },
    ],
    related: ['volatility', 'rsi'],
  },
  {
    id: 'highs52', level: 'intermediate', minutes: 3, page: 'market',
    title: '52-week highs and lows',
    summary: 'Where a stock trades relative to its highest and lowest price of the past year.',
    why: 'The Market page lists stocks at 52-week extremes, the Ideas score rewards proximity to the high, and alerts fire on new highs and lows.',
    body: [
      'Many investors anchor on the 52-week high. As a stock approaches it, holders who bought there sell to break even, which creates resistance; once it breaks through, that supply is gone.',
      'Academic research (George and Hwang, 2004) found that stocks near their 52-week high tended to outperform those far from it — a form of momentum.',
      'A new 52-week low says the market is repricing the business. Find the reason before buying something just because it is “cheap”.',
    ],
    formula: 'Distance from high = (price ÷ 52-week high − 1) × 100',
    example: 'Price ₹970, 52-week high ₹1,000: −3% from the high, inside the Ideas page’s “breakout watch” zone.',
    live: (ctx) => {
      const qs = quotesFor(ctx).filter((q) => q.pct_from_52w_hi != null);
      const near = qs.filter((q) => q.pct_from_52w_hi > -3);
      if (!qs.length) return null;
      return near.length
        ? `Within 3% of a 52-week high in ${scopeName(ctx)}: ${near.slice(0, 6).map((q) => `${n(q)} (${pct(q.pct_from_52w_hi, 1)})`).join(', ')}.`
        : `No stock in ${scopeName(ctx)} is within 3% of its 52-week high.`;
    },
    mistakes: ['Assuming a stock at a 52-week low is cheap.', 'Avoiding stocks at highs because they “already went up”.'],
    quiz: [
      { q: 'Price ₹970, 52-week high ₹1,000. Distance from the high?',
        options: ['+3%', '−3%', '−30%', '97%'], answer: 1,
        why: '970 / 1000 − 1 = −3%.' },
      { q: 'Research on 52-week highs found that stocks near their high…',
        options: ['Always crash', 'Tended to outperform stocks far from it', 'Have no pattern', 'Pay higher dividends'], answer: 1,
        why: 'Anchoring delays the reaction to good news, producing momentum.' },
    ],
    related: ['relstrength', 'volume'],
  },
  {
    id: 'disclosures', level: 'intermediate', minutes: 4, page: 'filings',
    title: 'Disclosed filings vs inside information',
    summary: 'Filings are what companies and insiders are legally required to publish. Reading them fast is a legitimate edge; trading on unpublished information is a crime.',
    why: 'The Filings page and the Calendar’s Filing ↗ links are primary sources. They often reach the market before the news cycle digests them.',
    body: [
      'India: material events are disclosed under SEBI LODR Regulation 30; promoter and insider trades under the insider-trading (PIT) rules; large acquisitions under the takeover (SAST) rules; plus bulk and block deal reports from the exchanges.',
      'US: an 8-K reports a material event (generally within four business days); Form 4 reports an officer’s or director’s trade (within two business days); 13D/13G report holders crossing 5%; 10-Q and 10-K are the quarterly and annual reports.',
      'Insider buying with their own money is read as a confidence signal; insider selling has many innocent reasons (taxes, diversification). Promoters pledging shares is a warning sign.',
      'Material non-public information — facts that have not been published — is categorically different. Trading on it is illegal under SEC Rule 10b-5 and SEBI’s insider-trading regulations.',
    ],
    example: 'A director files a Form 4 showing a $2M open-market purchase. It is public the moment it is filed, so acting on it is legal — and the signal is stronger than a scheduled sale.',
    mistakes: ['Treating every insider sale as bad news.', 'Relying on tips that are not in any public filing.'],
    quiz: [
      { q: 'Which can you legally trade on?',
        options: ['A friend at the company telling you results before release', 'A Form 4 insider purchase that has been filed publicly', 'A leaked draft of a merger agreement', 'An unpublished order book'], answer: 1,
        why: 'Once filed, it is public information.' },
      { q: 'Promoters buying shares in the open market, disclosed to the exchange, is usually read as…',
        options: ['A confidence signal, though not proof', 'A sign of fraud', 'Irrelevant', 'A dividend'], answer: 0,
        why: 'Insiders know the business best; buying with their own money is informative, not decisive.' },
    ],
    related: ['corroboration', 'samplesize'],
  },
  {
    id: 'valuation', level: 'intermediate', minutes: 5,
    title: 'P/E ratio: what you pay for each rupee of profit',
    summary: 'Price-to-earnings divides the share price by earnings per share. It tells you how many years of current profit you are paying for.',
    why: 'This dashboard is mostly technical. Valuation is the other half of an investment decision: a great trend in an absurdly priced stock carries a different risk from the same trend in a cheap one.',
    body: [
      'Trailing P/E uses the last 12 months of earnings; forward P/E uses analysts’ estimates for the next 12. Earnings yield is the inverse (E/P), handy for comparing with bond yields.',
      'Compare a P/E with the same company’s history and with peers in the same sector. Banks, IT services and consumer staples have structurally different P/Es.',
      'PEG divides P/E by the expected growth rate. A P/E of 30 with 30% growth (PEG 1) can be cheaper than a P/E of 15 with 5% growth (PEG 3).',
      'Cyclical stocks (metals, cement, autos) often look cheapest at the top of the cycle, when profits peak, and most expensive at the bottom.',
    ],
    formula: 'P/E = price ÷ EPS (trailing 12 months)\nEarnings yield = EPS ÷ price × 100\nPEG = P/E ÷ annual EPS growth %',
    example: 'Price ₹1,200, EPS ₹40: P/E 30 and earnings yield 3.3%. With 20% expected EPS growth, PEG = 1.5.',
    mistakes: ['Comparing P/Es across unrelated sectors.', 'Buying cyclicals because the P/E looks low at peak earnings.', 'Ignoring one-off gains that inflate EPS.'],
    quiz: [
      { q: 'Price ₹600, EPS ₹30. The P/E is…',
        options: ['5', '20', '30', '600'], answer: 1,
        why: '600 / 30 = 20.' },
      { q: 'A steel company has a P/E of 5 at record profits. The main risk is…',
        options: ['It is obviously cheap', 'Earnings are at a cyclical peak and may fall sharply', 'Steel companies have no earnings', 'P/E does not apply to steel'], answer: 1,
        why: 'Low P/E on peak earnings often precedes falling profits.' },
    ],
    related: ['results', 'corpactions'],
  },

  // =========================================================== advanced
  {
    id: 'sectorrotation', level: 'advanced', minutes: 4, page: 'sectornews',
    title: 'Sector rotation',
    summary: 'Money moves between sectors in fairly persistent cycles. A stock inherits much of its return from its sector.',
    why: 'The Sector board and the rotation table on the Market page show which sectors are gaining ground.',
    body: [
      'A common textbook pattern: early recovery favours financials and cyclicals; late cycle favours energy and materials; contraction favours staples, utilities and pharma. Real cycles are messier, but the idea holds.',
      'What matters is the change in ranking, not the level. A sector climbing from the bottom quartile to the top over two weeks, on rising volume, is rotation in progress.',
      'Picking the right sector and an average stock in it often beats picking the best stock in the wrong sector.',
    ],
    example: 'Over five sessions Banks rise from 9th to 2nd while IT falls from 1st to 7th; average RSI for Banks is still 55. That looks like early rotation into financials, not a move that is already exhausted.',
    live: (ctx) => {
      const s = ctx.bundle?.sectors ?? [];
      if (s.length < 2) return null;
      return `5-day leaders: ${s.slice(0, 3).map((x) => `${x.sector} ${pct(x.ret_5d, 1)}`).join(', ')}. Laggards: ${s.slice(-3).map((x) => `${x.sector} ${pct(x.ret_5d, 1)}`).join(', ')}.`;
    },
    mistakes: ['Buying the sector that has already led for months with RSI above 70.', 'Ignoring sector moves when judging a single stock.'],
    quiz: [
      { q: 'What matters most when reading a sector ranking table?',
        options: ['The current level', 'Changes in ranking over time', 'Alphabetical order', 'The number of stocks'], answer: 1,
        why: 'Rotation is movement; a static ranking says less than a changing one.' },
      { q: 'In a contraction, which sectors have historically held up better?',
        options: ['Metals and autos', 'Staples, utilities and pharma', 'Small-cap tech', 'Real estate developers'], answer: 1,
        why: 'Demand for essentials is steadier when the economy slows.' },
    ],
    related: ['breadth', 'relstrength'],
  },
  {
    id: 'pricedin', level: 'advanced', minutes: 5, page: 'filings',
    title: 'Priced in: expectations and earnings surprises',
    summary: 'Prices reflect what the market expects. They move when reality differs from that expectation.',
    why: 'This explains why good news can sink a stock and why the Filings page measures actual reactions rather than assuming them.',
    body: [
      'Before results, analysts publish estimates; their average is the consensus. The earnings surprise is the gap between the reported number and that consensus.',
      '“Buy the rumour, sell the news”: when good news is widely expected, buyers have already bought, so the announcement brings selling.',
      'Post-earnings-announcement drift: researchers since the late 1960s (Ball and Brown) have documented that stocks with large positive surprises tend to keep drifting up for weeks, and negative ones down — markets under-react at first.',
      'Guidance often matters more than the quarter just reported, because prices are about future cash flows.',
    ],
    formula: 'Surprise % = (actual − consensus) ÷ |consensus| × 100',
    example: 'Consensus EPS ₹10, actual ₹11: a +10% surprise. If management also cuts next year’s guidance, the stock can still fall.',
    live: (ctx) => {
      const stats = (ctx.bundle?.event_stats ?? []).filter((s) => s.reliable);
      if (!stats.length) return null;
      const best = extreme(stats, 'mean_5d', 1);
      const worst = extreme(stats, 'mean_5d', -1);
      return `Measured in this market: “${best.label}” events averaged ${pct(best.mean_5d)} over 5 days (n=${best.n}); “${worst.label}” averaged ${pct(worst.mean_5d)} (n=${worst.n}).`;
    },
    mistakes: ['Assuming good news must lift the price.', 'Ignoring guidance and focusing only on the past quarter.'],
    quiz: [
      { q: 'Consensus EPS ₹20, actual ₹18. The surprise is…',
        options: ['+10%', '−10%', '−2%', '0%'], answer: 1,
        why: '(18 − 20) / 20 = −10%.' },
      { q: 'Post-earnings-announcement drift means…',
        options: ['Stocks always reverse after results', 'Prices keep moving in the direction of the surprise for a while', 'Results have no effect', 'Drift only affects bonds'], answer: 1,
        why: 'The initial reaction tends to be incomplete.' },
    ],
    related: ['results', 'sentiment'],
  },
  {
    id: 'probability', level: 'advanced', minutes: 5, page: 'model',
    title: 'Reading the model’s probability honestly',
    summary: 'The Model page’s percentage is the probability a stock beats the median stock over the horizon — relative strength, not direction.',
    why: 'Misreading “60%” as “60% chance it goes up” is the most common and most expensive mistake with this page.',
    body: [
      'An absolute “will it go up” target was tried first and scored an AUC of 0.49 on holdout data — worse than a coin flip — because most of a stock’s short-term return is the market’s return, which these features cannot predict.',
      'Removing the cross-sectional median strips out the market factor and leaves the part technical features can speak to. In a falling market the top-ranked stock usually still falls, just less than its peers.',
      'AUC is the chance the model ranks a random outperformer above a random underperformer. 0.50 is worthless; realistic equity models sit around 0.52–0.56. Such an edge is real but small and only shows up across many positions.',
    ],
    formula: 'AUC = P(score of a random winner > score of a random loser)\nExpected vs median ≈ (p − 0.5) × 2 × ATR × √horizon',
    example: 'p = 0.60, ATR 2%, horizon 5 days: (0.10 × 2) × 2% × √5 ≈ +0.9% expected relative to the median stock — not a price target.',
    live: (ctx) => {
      const m = ctx.meta?.model_metrics;
      if (m?.holdout_auc == null) return null;
      return `Current model: holdout AUC ${fmt(m.holdout_auc, 3)} on ${m.test_rows ?? '—'} held-out rows, ${m.horizon_days ?? 5}-day horizon.`
        + (m.holdout_auc < 0.52 ? ' That is no measurable edge: treat probabilities as coin flips.' : ' A small edge, useful only across many positions.');
    },
    mistakes: ['Reading 60% as “likely to rise”.', 'Betting big on a single high-probability name.'],
    quiz: [
      { q: 'The model says 62% for a stock. What does that mean?',
        options: ['62% chance the price rises', '62% chance it beats the median stock over the horizon', 'It will rise 62%', 'It is 62% undervalued'], answer: 1,
        why: 'The target is relative performance, not direction.' },
      { q: 'An AUC of 0.50 means…',
        options: ['Perfect ranking', 'No better than random', '50% returns', 'Half the stocks rose'], answer: 1,
        why: '0.50 is the coin-flip line.' },
    ],
    related: ['calibration', 'relstrength'],
  },
  {
    id: 'calibration', level: 'advanced', minutes: 5, page: 'model',
    title: 'Calibration and the Brier score',
    summary: 'A forecaster is calibrated if things it calls 70% happen about 70% of the time. The Brier score measures probability accuracy in one number.',
    why: 'The Model page’s live scorecard grades every matured prediction. These two ideas tell you whether to trust the percentages.',
    body: [
      'Calibration table: group predictions into buckets (50–55%, 55–60% …) and compare the average prediction with how often it actually happened. Good calibration means the two columns roughly match.',
      'Brier score is the mean squared difference between the probability and the outcome (1 if it happened, 0 if not). 0 is perfect. Always predicting the base rate p scores p × (1 − p): 0.25 when p = 0.5.',
      'A model is informative only if its Brier score beats that baseline, and its hit rate beats the base rate, over a decent sample.',
    ],
    formula: 'Brier = (1/N) × Σ (pᵢ − oᵢ)²   where oᵢ ∈ {0, 1}\nBaseline = p̄ × (1 − p̄)',
    example: 'Two forecasts: 0.7 (it happened) and 0.4 (it did not). Brier = ((1 − 0.7)² + (0 − 0.4)²) / 2 = (0.09 + 0.16) / 2 = 0.125.',
    live: (ctx) => {
      const sc = ctx.scorecard;
      if (!sc || sc.status !== 'ok') return 'The live scorecard has not matured yet; it fills in about a week after predictions start being stored.';
      return `Live scorecard: ${sc.n} graded predictions, hit rate ${fmt(sc.hit_rate * 100, 1)}% vs base rate ${fmt(sc.base_rate * 100, 1)}%, Brier ${fmt(sc.brier_score, 4)} vs baseline ${fmt(sc.brier_baseline, 4)}${sc.brier_score < sc.brier_baseline ? ' — informative' : ' — no better than guessing'}.`;
    },
    mistakes: ['Judging a probabilistic model on a handful of outcomes.', 'Ignoring calibration and looking only at accuracy.'],
    quiz: [
      { q: 'Forecasts 0.8 (happened) and 0.2 (did not happen). The Brier score is…',
        options: ['0.04', '0.2', '0.4', '0.8'], answer: 0,
        why: '((0.2)² + (0.2)²) / 2 = 0.04.' },
      { q: 'A model’s 70% predictions came true 52% of the time. The model is…',
        options: ['Well calibrated', 'Overconfident', 'Underconfident', 'Perfect'], answer: 1,
        why: 'It claimed more certainty than reality delivered.' },
    ],
    related: ['probability', 'samplesize'],
  },
  {
    id: 'samplesize', level: 'advanced', minutes: 5, page: 'filings',
    title: 'Small samples and base rates',
    summary: 'An average from a few observations is mostly noise. Always ask how many cases sit behind a statistic and what the base rate is.',
    why: 'The Filings page only shows reaction averages once an event type has enough graded cases, and it shows n next to each one. This is why.',
    body: [
      'The standard error of an average is the standard deviation divided by √n. With few observations the error band is wider than most effects you are trying to measure.',
      'Base rate: before judging a signal, know how often the outcome happens anyway. If 55% of stocks rise in a typical week, a signal that is “right 56% of the time” adds almost nothing.',
      'Survivorship bias: studying only stocks that still exist (or traders who are still around) makes every strategy look better than it was.',
    ],
    formula: 'Standard error = SD ÷ √n\n95% interval ≈ mean ± 2 × SE',
    example: 'Five-day returns after an event have SD 6%. With n = 9, SE = 6 / 3 = 2%, so a mean of +1.5% has a 95% interval of about −2.5% to +5.5%: it could easily be zero.',
    live: (ctx) => {
      const st = ctx.bundle?.event_status;
      if (!st) return null;
      return `Event log in this market: ${st.logged ?? 0} logged, ${st.graded ?? 0} graded. Averages are shown only once an event type has at least ${st.min_sample ?? 8} graded cases.`;
    },
    mistakes: ['Trusting a pattern seen three times.', 'Ignoring the base rate when evaluating a signal.'],
    quiz: [
      { q: 'SD of returns 8%, n = 16. The standard error of the mean is…',
        options: ['0.5%', '2%', '8%', '16%'], answer: 1,
        why: '8 / √16 = 8 / 4 = 2%.' },
      { q: '56% of a signal’s picks rose, and 55% of all stocks rose over the same weeks. The signal…',
        options: ['Is excellent', 'Adds almost nothing over the base rate', 'Is broken', 'Is calibrated'], answer: 1,
        why: 'Compare with the base rate, not with 50%.' },
    ],
    related: ['calibration', 'pricedin'],
  },
];

const BY_ID = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));
export const conceptTitle = (id) => BY_ID[id]?.title ?? id;

// --------------------------------------------------------------- progress
const progress = () => ({ learned: {}, quiz: {}, today: null, ...lsGet(KEY, {}) });
const save = (p) => lsSet(KEY, p);

function setLearned(id, on) {
  const p = progress();
  if (on) p.learned[id] = new Date().toISOString();
  else delete p.learned[id];
  save(p);
}

function recordAnswer(id, qi, correct) {
  const p = progress();
  p.quiz[id] = { ...(p.quiz[id] ?? {}), [qi]: correct };
  save(p);
}

function todayConcept() {
  const p = progress();
  const date = todayISO();
  if (p.today?.date === date && BY_ID[p.today.id]) return BY_ID[p.today.id];
  const dayNo = Math.floor(Date.now() / 86400e3);
  const next = CONCEPTS.find((c) => !p.learned[c.id]) ?? CONCEPTS[dayNo % CONCEPTS.length];
  p.today = { date, id: next.id };
  save(p);
  return next;
}

function advance(fromId) {
  const p = progress();
  const i = CONCEPTS.findIndex((c) => c.id === fromId);
  const order = [...CONCEPTS.slice(i + 1), ...CONCEPTS.slice(0, i + 1)];
  const next = order.find((c) => !p.learned[c.id] && c.id !== fromId) ?? order[0];
  p.today = { date: todayISO(), id: next.id };
  save(p);
}

// ------------------------------------------------------------------ views
function quiz(c) {
  const box = el('div', { class: 'quiz' });
  c.quiz.forEach((item, qi) => {
    const feedback = el('div', { class: 'q-feedback' });
    const opts = el('div', { class: 'q-opts' }, ...item.options.map((text, i) => el('button', {
      class: 'q-opt',
      onclick: (e) => {
        const right = i === item.answer;
        [...opts.children].forEach((b, j) => {
          b.disabled = true;
          b.classList.toggle('right', j === item.answer);
        });
        if (!right) e.currentTarget.classList.add('wrong');
        feedback.className = `q-feedback ${right ? 'up' : 'down'}`;
        feedback.replaceChildren(el('b', {}, right ? 'Correct. ' : 'Not quite. '), item.why);
        recordAnswer(c.id, qi, right);
      },
    }, text)));
    box.append(el('div', { class: 'q' },
      el('div', { class: 'q-text' }, `${qi + 1}. ${item.q}`), opts, feedback));
  });
  return box;
}

function conceptView(ctx, c, { onChange, close, extra = null } = {}) {
  const learned = Boolean(progress().learned[c.id]);
  let live = null;
  try { live = c.live?.(ctx) ?? null; } catch { live = null; }
  const block = (title, ...body) => el('section', { class: 'c-block' }, el('h4', {}, title), ...body);

  return el('article', { class: 'concept' },
    el('div', { class: 'row c-meta' },
      pill(c.level, LEVEL_PILL[c.level]),
      el('span', { class: 'faint' }, `${c.minutes} min`),
      learned ? pill('learned ✓', 'up') : null),
    el('h3', { class: 'c-title' }, c.title),
    el('p', { class: 'c-lead' }, c.summary),
    block('Why it matters', el('p', {}, c.why)),
    block('How it works', ...c.body.map((t) => el('p', {}, t))),
    c.formula ? block('Formula', el('pre', { class: 'c-formula' }, c.formula)) : null,
    block('Worked example', el('div', { class: 'c-example' }, c.example)),
    live ? block('On your data right now', el('div', { class: 'c-live' }, live)) : null,
    block('Common mistakes', el('ul', {}, ...c.mistakes.map((m) => el('li', {}, m)))),
    block('Check yourself', quiz(c)),
    el('div', { class: 'row c-actions' },
      el('button', {
        class: `btn${learned ? '' : ' primary'}`, 'data-learn': c.id,
        onclick: () => { setLearned(c.id, !learned); onChange?.(); },
      }, learned ? 'Mark as not learned' : 'Mark as learned ✓'),
      extra,
      c.page
        ? el('button', { class: 'btn sm', onclick: () => { close?.(); ctx.go(c.page); } },
            `See it on the ${PAGE_NAME[c.page]} page →`)
        : null,
      ...(c.related ?? []).filter((id) => BY_ID[id]).map((id) => el('button', {
        class: 'btn sm', onclick: () => openConcept(ctx, id),
      }, `📖 ${BY_ID[id].title.split(':')[0]}`))));
}

export function openConcept(ctx, id) {
  const c = BY_ID[id];
  if (!c) {
    const legacy = (ctx.curriculum ?? []).find((x) => x.id === id);
    if (legacy) modal(legacy.title, el('p', { class: 'dim', style: 'line-height:1.75;white-space:pre-wrap' }, legacy.body));
    return;
  }
  const close = modal('Concept', conceptView(ctx, c, {
    close: () => close(),
    onChange: () => { ctx.rerender(); openConcept(ctx, id); },
  }));
}

function progressCard(p) {
  const total = CONCEPTS.length;
  const done = CONCEPTS.filter((c) => p.learned[c.id]).length;
  const answers = Object.values(p.quiz).flatMap((q) => Object.values(q));
  const right = answers.filter(Boolean).length;
  return el('div', { class: 'grid g4 learn-stats' },
    el('div', { class: 'stat' },
      el('div', { class: 'k' }, 'Concepts learned'),
      el('div', { class: 'v num' }, `${done} / ${total}`),
      el('div', { class: 'bar', style: 'margin-top:8px' },
        el('i', { style: `width:${(done / total) * 100}%;background:var(--up)` }))),
    ...LEVELS.map((level) => {
      const all = CONCEPTS.filter((c) => c.level === level);
      const got = all.filter((c) => p.learned[c.id]).length;
      return el('div', { class: 'stat' },
        el('div', { class: 'k' }, level),
        el('div', { class: 'v num' }, `${got} / ${all.length}`),
        el('div', { class: 'd' }, level === 'beginner' && answers.length
          ? `quiz: ${right} of ${answers.length} correct` : `${all.reduce((a, c) => a + c.minutes, 0)} min in total`));
    }));
}

function lessonBlock(l, ctx) {
  return el('div', { class: `lesson ${l.severity}` },
    el('h4', {}, l.headline),
    el('p', {}, l.explanation),
    el('div', { class: 'row meta' },
      pill(l.kind.replace(/_/g, ' '), 'neutral'),
      el('span', {}, ago(l.ts)),
      el('span', {}, l.source?.startsWith('llm') ? `explained by ${l.source}` : 'rule-generated'),
      el('button', { class: 'btn sm', onclick: () => ctx.openStock(l.symbol) }, 'Chart'),
      ...(l.related_lessons ?? []).map((id) => (BY_ID[id] || (ctx.curriculum ?? []).some((c) => c.id === id)
        ? el('button', { class: 'btn sm', onclick: () => openConcept(ctx, id) },
            `📖 ${conceptTitle(id) === id ? (ctx.curriculum.find((c) => c.id === id)?.title ?? id) : conceptTitle(id)}`)
        : null))));
}

export function learnView(ctx) {
  const p = progress();
  const today = todayConcept();
  const lessons = ctx.bundle.lessons ?? [];
  const frag = el('div');

  frag.append(progressCard(p));

  frag.append(el('div', { class: 'card today-concept' },
    el('div', { class: 'card-head' }, 'Today’s concept',
      el('span', { class: 'sub' }, 'one new idea a day · read, check yourself, mark it learned')),
    conceptView(ctx, today, {
      onChange: ctx.rerender,
      extra: el('button', {
        class: 'btn', id: 'nextConcept',
        onclick: () => { advance(today.id); ctx.rerender(); },
      }, 'Next concept →'),
    })));

  frag.append(card('Explained: what happened today', `${lessons.length} events detected`,
    lessons.length
      ? el('div', {}, ...lessons.map((l) => lessonBlock(l, ctx)))
      : el('div', { class: 'empty' }, 'Nothing unusual happened, so there is nothing to explain. '
          + 'Lessons appear when a stock moves sharply, volume spikes, RSI hits an extreme, or news clusters.')));

  frag.append(card('Concept library', `${CONCEPTS.length} concepts · click one to study it`,
    ...LEVELS.map((level) => el('div', { class: 'lib-level' },
      el('h4', {}, level[0].toUpperCase() + level.slice(1)),
      el('div', { class: 'lib-grid' }, ...CONCEPTS.filter((c) => c.level === level).map((c) => el('button', {
        class: `lib-item${p.learned[c.id] ? ' done' : ''}${c.id === today.id ? ' current' : ''}`,
        'data-concept': c.id,
        onclick: () => openConcept(ctx, c.id),
      },
      el('span', { class: 'lib-mark' }, p.learned[c.id] ? '✓' : c.id === today.id ? '•' : ''),
      el('span', { class: 'lib-text' }, el('b', {}, c.title), el('small', {}, c.summary)))))))));

  return frag;
}
