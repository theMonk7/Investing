# Market Desk

A self-hosted dashboard for Indian (NSE) and US equities: technicals, news
sentiment, a directional model over a D-day window, a screener that explains
every score it gives, phone alerts, and a teaching layer that explains why a
stock moved today.

Runs entirely on free infrastructure: **GitHub Actions** as the scheduler,
**GitHub Pages** as the host, **SQLite committed to the repo** as the database.
No server, no paid API, no monthly bill.

---

## Why not n8n

n8n needs a process running 24/7. GitHub does not host one for free, so n8n
would mean a VPS or a paid cloud plan. GitHub Actions gives the same scheduled
orchestration on the free tier, and this project's whole pipeline fits inside
it comfortably. If you already run n8n somewhere, you can call
`pipeline/run_all.py` from it instead — nothing here depends on Actions
specifically.

---

## What you get

| Feature | Where |
|---|---|
| Your tickers: price, 5D/1M, RSI, news count + tone, next corporate event; add/remove, **Update now** | Watchlist |
| News for your tickers, any typed ticker, sectors, or everything; filters + search | News |
| Board meetings, results, dividends, splits, buybacks, AGMs in a chosen window, for your watchlist, all companies, or typed tickers; click an event for quarterly results, EPS surprises, usual price reaction, news tone, analyst targets and which way the evidence leans | Calendar |
| Regime, breadth, daily brief, gainers/losers, sector rotation | Market |
| Screener with the exact conditions behind every score | More → Ideas |
| Relative-strength probability, per-feature attribution, holdout AUC, live scorecard | More → Model |
| Alert history and the rules in force | More → Alerts |
| Sector board, sentiment history, per-sector story lists | More → Sector board |
| SEC Form 4 / 8-K, India disclosures, catalysts, measured event reactions | More → Filings |
| Concept of the day (25 concepts, beginner → advanced) with formula, worked example, your own data and a quiz; explanations of today's moves | Learn |
| What the page is for, how to use it and what every metric means, with links to the matching concept | **ⓘ How to read this page** on every page |
| Phone push via ntfy / Telegram / WhatsApp / Discord | scheduled workflows |

Both markets have their own tab; switch with the toggle or press <kbd>m</kbd>.
<kbd>j</kbd> / <kbd>k</kbd> move between the four main tabs.

### Corporate calendar — where the dates come from

Companies must tell the exchange about board meetings and record/ex-dates in
advance (SEBI LODR Reg. 29 in India), so the exchange filings are the
authoritative source. The RBI publishes monetary-policy dates, not company
events.

| Market | Source | Notes |
|---|---|---|
| India | NSE board-meeting and corporate-action filings | Official. BSE's API refuses scripted requests. NSE sometimes blocks cloud IPs; the source status line on the Calendar tab shows when. |
| US | Nasdaq earnings and dividend calendars | Earnings for companies ≥ $10B market cap plus anything you track. |
| Both | Yahoo Finance | **Estimates** only, marked "est."; dropped automatically once an official filing for the same event appears. |

If NSE blocks the Actions runner, run `python run_all.py --mode events`
locally and commit `data/IN/events.json`.

### Event details — results, expectations and the lean

Click any calendar row (or **Details**) for a panel that explains the event
and, for results, puts the numbers in context:

| Section | What it shows | Source |
|---|---|---|
| How the company did | Last 5 quarters: revenue, operating margin, net profit, EPS; YoY and QoQ growth and a one-line verdict | Yahoo quarterly income statement |
| What the market expects | Next EPS estimate, implied growth, beat record, and per report: estimate, actual, surprise, day move, 5-day move | Yahoo earnings dates; moves measured from our own daily closes |
| What happened (past results) | Surprise and the price reaction, and whether the price followed the headline | same |
| How the stock usually reacts | Median results-day move, vs. its normal daily range (ATR), and behaviour after beats and misses | same |
| Going into it | Trend, 1-month return, RSI, distance from the 52-week high, news tone, market regime | bundle.json, feed.json |
| Which way might it go? (upcoming only) | Counted rules for and against, and the size of move to plan for | all of the above |
| Analysts & valuation | Rating, average/low/high target vs. price, P/E, margin, ROE, D/E, yield | Yahoo |

The lean is a tally of visible rules, not a forecast. Results data is
collected for the watchlist plus companies with results in the next 3 weeks
(`pipeline/fundamentals.py`, cached in SQLite, ≤ 25 Yahoo fetches per run,
refreshed every 4 h around a results date). Rows show a *beat / miss* or
*±x% usual* tag when data exists. Yahoo occasionally copies one quarter's
figures into another; identical quarters are dropped rather than shown.

### Signed-in indicator

The pill next to ⚙ shows who the dashboard acts as: green with your GitHub
login when the token can save and start updates, amber when it is missing a
permission, red when GitHub rejects it, *Local* in local mode, and *Sign in*
when read-only. Click it to open Settings.

### "Real-time" updates

A static page cannot call Yahoo, NSE or Google News directly (no CORS), so
fresh data always comes from a pipeline run. When GitHub sync is on:

* **Add a ticker** → it's committed to `watchlist.json`, then a `quick` run
  fetches its quote, chart, news and events.
* **Update now** (Watchlist) → `quick` run for every watched ticker.
* **⟳ menu** (top right) →
  * *Reload data*: re-reads the committed files. Instant, never needs a token.
  * *Fetch latest news*: `news` run for the current market (also on the News
    page as **↻ Fetch latest news**).
  * *Update watchlist*: `quick` run for every watched ticker.
  * *Refresh calendar*: `events` run.

The chip at the top right shows progress; the page reloads itself when the
run finishes (typically 1–2 minutes). Without a token the dashboard is
read-only and refreshes on the schedule.

**"Token cannot start workflows"** means the token can read the repo but
GitHub refuses `workflow_dispatch`. Open ⚙ Settings → **Check access**: it
tests the token without changing anything (identity, repo, Contents write,
Actions write) and lists the exact fix. For a fine-grained token: edit it at
<https://github.com/settings/personal-access-tokens>, set *Repository access*
to this repo, and set **Contents** and **Actions** to *Read and write*. The
token value does not change, so nothing needs re-pasting. A classic token
needs the `repo` scope (plus `workflow`).

**Local mode (no GitHub needed).** Run `./dev.sh` and open
<http://127.0.0.1:8000/web/index.html>. The page detects the local server
and switches to local mode (chip shows `· local`): adding a ticker writes
`watchlist.json` on disk and Update / ↻ Refresh run `pipeline/run_all.py` on
your machine, so updates land in seconds. Fetching still needs internet
(Yahoo, NSE, Nasdaq). Commit `watchlist.json` and `data/` to publish.
The server listens on 127.0.0.1 only.

---

## Setup

### 1. Create the repo

Fork or push this directory to a new GitHub repository.

```bash
git init
git add .
git commit -m "feat: market dashboard"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Turn on Pages

**Settings → Pages → Source: GitHub Actions.**

Then **Settings → Actions → General → Workflow permissions: Read and write**
(the pipeline commits refreshed data back to the repo).

### 3. Run the pipeline once

**Actions → Market pipeline → Run workflow → mode: `full`.**

First run takes 5–10 minutes: it downloads five years of history and trains
the model. Later runs take about a minute. When it finishes, the Pages deploy
fires automatically and your dashboard is live at
`https://<you>.github.io/<repo>/`.

You can also run it locally:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt
cd pipeline && python run_all.py --mode full
# other modes: quotes | news | events | quick --symbols "INFY.NS,AAPL"
# then serve the repo root with the local API (the site finds ../data on its own)
cd .. && ./dev.sh
```

---

## Phone notifications

Pick at least one. All are free. Add them under
**Settings → Secrets and variables → Actions → Secrets**, then run the
**Test notifications** workflow to confirm your phone buzzes.

### ntfy — easiest, no account

1. Install [ntfy](https://ntfy.sh/) from the App Store or Play Store.
2. Invent a topic name that nobody would guess, e.g. `mktdesk-8fk39dj2`.
   **Anyone who knows the topic can read your alerts**, so treat it as a secret.
3. Subscribe to that topic in the app.
4. Add repository secret `NTFY_TOPIC` = your topic name.

Self-hosting ntfy? Set the repository *variable* `NTFY_SERVER` to your URL.

### Telegram

1. Message [@BotFather](https://t.me/botfather), send `/newbot`, copy the token.
2. Send your new bot any message.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy
   `result[0].message.chat.id`.
4. Add secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### WhatsApp — via CallMeBot

1. Save `+34 644 66 32 62` to your contacts.
2. WhatsApp it: `I allow callmebot to send me messages`.
3. It replies with your API key.
4. Add secrets `CALLMEBOT_PHONE` (e.g. `+919876543210`) and `CALLMEBOT_APIKEY`.

CallMeBot is a free third-party relay with a rate limit and no uptime
guarantee. Your alert text passes through their server. Fine for price alerts;
do not put anything sensitive in them. For a supported path instead, use the
WhatsApp Business Cloud API free tier — that needs a Meta developer app, which
is why it is not the default here.

### Discord

Channel → Edit → Integrations → Webhooks → New Webhook → copy URL → add as
secret `DISCORD_WEBHOOK`.

### What gets sent, and when

* **Alerts** fire from the `Market pipeline` workflow, only for watchlist
  symbols, with a per-rule cooldown (default 6 hours) so a stuck condition
  cannot spam you.
* **Digests** are three scheduled summaries from the `Phone digest` workflow:
  pre-open IST, post-close IST, post-close ET.
* **Pipeline failures** push a high-priority ntfy message so you notice silent
  breakage.

---

## News, sectors and disclosures

### The feed accumulates

Every story is stored in SQLite keyed by a content hash, with a `first_seen`
timestamp recording when **this pipeline** first saw it. A refresh therefore
*adds* to the list rather than replacing it, and the "new since your last
visit" dot uses `first_seen`, not the outlet's own timestamp — so a backdated
republication cannot masquerade as breaking news. 400 stories per market are
kept in the feed file; 180 days in the database.

Filter by sector, event type, item type (news / filing / disclosure) or tone,
and search headlines, sources and tickers.

### Accuracy signals

Syndicated copies of the same story are collapsed, but the count is kept and
shown as "N outlets". How many independent outlets carried something is the
cheapest reality check there is: a genuine market-moving event is picked up
widely within hours, a single-outlet dramatic headline often is not. Sources
are always named and linked, so the primary document is one click away.

### Sector news

One targeted news query per sector, in addition to ticker matching, so
sector-moving stories that never name a tracked company (policy, commodity
prices, demand data) still land somewhere. The sector board shows news tone,
1/5-day return and story volume together; each sector is clickable for its
stories. Daily sector rollups are persisted, so the sentiment history charts
accumulate real history from the day you deploy.

### Event classification

Every headline is classified into one of ~22 event types — earnings beat/miss,
guidance, upgrade/downgrade, order win, M&A, buyback, regulatory, insider
transaction, bulk deal, stake change and so on — by keyword rules, with
optional LLM refinement of the leftovers. Rules are used because headlines are
short and the vocabulary of market news is small, stable and auditable.

### Filings and disclosures — and what this will not do

**US** — SEC EDGAR Form 4 (insider transactions by officers, directors and 10%
holders) and 8-K (material events). Free and official, but the SEC returns
`403` unless the User-Agent carries a contact email, so set the
`SEC_CONTACT_EMAIL` secret to switch this on. Nothing is defaulted; your
address goes only to sec.gov, in the header their policy requires.

**India** — NSE and BSE block datacenter IP ranges, so their filing APIs are
unreachable from GitHub Actions. The India feed falls back to Moneycontrol
bulk/block deals, Business Standard, Mint, ET and targeted queries over
disclosure language. Public, but second-hand and less complete; the UI says so
on the page.

> **On "inside information".** Everything here is public the moment it is
> posted — filed with a regulator or reported by an exchange. Reading public
> filings faster than the news cycle is a legitimate edge. Material non-public
> information is a different thing entirely: trading on it is illegal under SEC
> Rule 10b-5 and SEBI's Prohibition of Insider Trading Regulations, and it does
> not become legal because a journalist, a forum or a group chat passed it on.
> This project does not source it and will not help you source it.

### Measured event reactions, not invented priors

No free multi-year news archive exists, so no news backtest is possible at
install time. Instead every classified event on a tracked stock is **logged
when it happens** and graded once five sessions of forward prices exist. The
Filings tab then reports, per event type, the mean and median 1/3/5-day return
and the share that were positive — with the sample size always attached, and
nothing averaged below 8 observations.

This starts empty and fills in over weeks. That is the honest version: a
measured statement about a small sample of your own history, never a
prediction dressed up as one.

## Optional LLM

Everything works without one. With a key, the LLM re-scores ambiguous
headlines, rewrites the daily brief, and writes richer explanations in Learn.
Whichever key is present is used, in this order:

| Secret | Provider | Free tier |
|---|---|---|
| `GROQ_API_KEY` | [Groq](https://console.groq.com/) | generous, very fast |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | generous |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/) | `:free` models |

One more optional secret, unrelated to the LLM:

| Secret | What it unlocks |
|---|---|
| `SEC_CONTACT_EMAIL` | SEC EDGAR Form 4 and 8-K filings for the US market |

Token use is capped in code: only ambiguous headlines are re-scored, and at
most 8 lesson explanations per run. A typical full run is a few thousand
tokens.

Every LLM output is labelled in the UI with the provider that wrote it, and
the prompts forbid inventing numbers. Verify anything that matters against the
raw figures shown elsewhere on the page.

---

## Editing your watchlist

Three ways, in order of convenience:

1. **In the dashboard** — Watchlist tab. Without a token it saves to your
   browser only. To make it stick, drive alerts and fetch data for new
   tickers, connect GitHub in ⚙ Settings: owner, repo and a **fine-grained
   PAT** scoped to this one repository with *Contents: read and write* and
   *Actions: read and write*. The token is stored only in your browser's
   localStorage and is sent only to `api.github.com`.
   If GitHub rejects a save (`404 Not Found` usually means the token can
   read the public repo but has no write access to it), the change is kept
   in this browser and marked *not synced*; ⚙ Settings → **Check access**
   shows what is missing. Fix the token, then **retry**.
   With `./dev.sh` running, edits save straight to `watchlist.json` instead.
2. **Edit `watchlist.json`** in GitHub directly. The next pipeline run picks
   it up.
3. **Locally**, then commit.

Symbols use Yahoo Finance format: `.NS` for NSE, `.BO` for BSE, plain for US.

> Holding a GitHub token in browser localStorage is a real, if small, risk —
> anyone with access to that browser profile can read it. If you would rather
> not, skip step 1 and edit `watchlist.json` in GitHub. The dashboard works
> either way.

---

## Tuning

Set these as repository **variables** (not secrets):

| Variable | Default | Meaning |
|---|---|---|
| `NEWS_WINDOW_DAYS` | 7 | the D-day news window |
| `PREDICT_HORIZON_DAYS` | 5 | how far ahead the model predicts |
| `ALERT_PCT_MOVE` | 3.0 | absolute daily move that triggers an alert |
| `ALERT_VOLUME_Z` | 2.5 | volume standard deviations |
| `ALERT_RSI_HIGH` / `ALERT_RSI_LOW` | 72 / 28 | RSI extremes |
| `ALERT_COOLDOWN_HOURS` | 6 | per symbol, per rule |

Schedules live in `.github/workflows/pipeline.yml`. All crons are UTC.

---

## How it works

```
GitHub Actions (cron)
   └─ pipeline/run_all.py
        ├─ fetch_prices.py   yfinance → OHLCV
        ├─ technicals.py     RSI, MACD, ATR, Bollinger, OBV, 52w, breadth
        ├─ fetch_news.py     public RSS + Google News per ticker
        ├─ corporate_events.py  NSE filings, Nasdaq calendars, Yahoo estimates
        ├─ fundamentals.py   quarterly results, EPS surprises, analyst targets
        ├─ sentiment.py      VADER + finance lexicon (+ optional LLM)
        ├─ predict.py        logistic regression, time-based holdout
        ├─ movers.py         regime, sector rotation, transparent screener
        ├─ teach.py          event detection → explanations
        ├─ alerts.py         rules + cooldowns → ntfy/Telegram/WhatsApp/Discord
        └─ store.py          SQLite (committed) + JSON snapshots
                                  ↓
                          data/{IN,US}/bundle.json
                                  ↓
        GitHub Pages ← web/ (vanilla JS + lightweight-charts)
```

The dashboard is static. It reads JSON files and nothing else, which is why it
needs no backend and costs nothing to host.

### Open-source dependencies

[yfinance](https://github.com/ranaroussi/yfinance) (Apache-2.0) ·
[pandas](https://pandas.pydata.org/) (BSD-3) ·
[scikit-learn](https://scikit-learn.org/) (BSD-3) ·
[feedparser](https://github.com/kurtmckee/feedparser) (BSD-2) ·
[vaderSentiment](https://github.com/cjhutto/vaderSentiment) (MIT) ·
[lightweight-charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0) ·
[ntfy](https://github.com/binwiederhier/ntfy) (Apache-2.0/GPL-2.0)

---

## About the model — read before trusting a number

**The percentage is the probability a stock beats the median stock over the
horizon. It is relative strength, not direction.** 60% does not mean "likely
to rise" — in a falling market the top-ranked stock usually still falls, just
less than its peers. For a view on market direction, read the regime and
breadth on the Market tab instead.

That target was chosen after measuring the alternative. An absolute
"will it go up" label scored **holdout AUC 0.49 — worse than a coin flip** —
because most of a stock's short-horizon return is the market's return, and no
technical indicator predicts that. Demeaning the label against the
cross-section strips the market factor out; the same features then measured
**AUC 0.525** with a balanced base rate. Small, but real, and it is the right
target for a dashboard whose job is ranking stocks against each other.

The exact number from your own latest run is published on the Model tab. The
project deliberately:

* trains on **technicals only**, because no free multi-year news archive
  exists and training on recent sentiment would leak;
* applies sentiment afterwards as a **capped, separately displayed**
  adjustment, so the technical number and the news nudge stay visible apart;
* validates on a **time-based holdout**, never a random split;
* uses **logistic regression** so the per-feature contributions in the UI are
  exact, not approximated;
* stores every prediction and grades it once the horizon elapses. The **Live
  scorecard** on the Model tab shows realised hit rate, edge over base rate,
  Brier score against baseline, and a calibration table. Trust that over the
  training metric — it is measured on your data, after deployment.

Use the probability as one input among several. The screener's listed
conditions and the charts are more informative than the single number.

---

## Tests

```bash
python tests/test_config_env.py           # blank/garbage Actions variables
python tests/test_pipeline_offline.py     # synthetic data through every module
npm install && python3 -m http.server 8000 &   # then, in another shell:
PORT=8000 node tests/render-test.mjs      # every view in jsdom, real data
PORT=8000 node tests/sector-test.mjs      # sector board, tooltips, feed filters
```

The render test clicks through every view in both markets, opens the
stock and settings modals, adds and removes a watchlist ticker, exercises the
calendar and news ticker filters, and fails on any thrown
error, empty view, or `NaN` leaking into the page. The sector test additionally
asserts that **every colour-encoded cell carries its own numeric label**, so
the charts never depend on hue alone. All four run in CI on every push.

## Chart colour

Sentiment is a *diverging* measure, so it uses two poles and a neutral
midpoint rather than a categorical palette — which also sidesteps the fact
that ten sectors exceed what any categorical palette can keep distinguishable.

Green/red is the domain convention and beats a generic blue/red here, but it
is the classic colour-vision-deficiency pair. The poles were therefore chosen
by measurement, not taste, and validated against this app's own surfaces:
worst adjacent CVD ΔE **8.6 dark / 9.0 light** (≥8 target), normal-vision ΔE
29.4 / 27.2 (≥15 floor), all steps ≥3:1 contrast. On top of that every cell
shows its signed value, a legend is always present, and a plain table view of
the same figures sits below the board.

## Limitations

* Prices are end-of-day or delayed intraday. Not for live trading.
* Yahoo Finance is an unofficial endpoint: it breaks sometimes, rate-limits,
  and retroactively adjusts history for splits and dividends. Tickers also go
  stale after corporate actions — the pipeline logs and skips them, and you
  should fix `pipeline/universe.py` when it does.
* Sector definitions are hand-maintained and cover only the tracked universe.
* News sentiment measures coverage tone, not truth, and is largely priced in
  by the time you read it.
* The committed SQLite database grows the repo over time. `store.prune()`
  keeps 120 days of news and 2000 alerts; adjust if your repo gets heavy.
* GitHub disables scheduled workflows in repositories with no activity for 60
  days. Push something, or run a workflow manually, to re-enable.

## Disclaimer

Educational software. **Not investment advice.** No part of this has been
reviewed by anyone licensed to give financial advice. Data comes from free
public sources and may be delayed, incomplete or wrong. You are responsible for
your own trades.

## License

MIT.
