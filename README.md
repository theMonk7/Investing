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
| Regime, breadth, VIX, one-paragraph daily brief | Overview |
| Add/remove tracked stocks, synced to the repo | Watchlist |
| Gainers, losers, unusual volume, 52-week extremes | Movers |
| Equal-weighted sector rotation with leaders/laggards | Sectors |
| Screener with the exact conditions behind every score | Ideas |
| Relative-strength probability, per-feature attribution, holdout AUC, live scorecard | Model |
| Alert history and the rules in force | Alerts |
| Headlines with sentiment, market-wide and per stock | News |
| Contextual explanations of today's moves + a lesson library | Learn |
| Phone push via ntfy / Telegram / WhatsApp / Discord | scheduled workflows |

Both markets have their own tab; switch with the toggle or press <kbd>m</kbd>.
<kbd>j</kbd> / <kbd>k</kbd> move between views.

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
# then serve the site
cd .. && python -m http.server 8000 --directory web
# and symlink or copy data/ next to web/ for local viewing:
#   ln -s ../data web/data
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

## Optional LLM

Everything works without one. With a key, the LLM re-scores ambiguous
headlines, rewrites the daily brief, and writes richer explanations in Learn.
Whichever key is present is used, in this order:

| Secret | Provider | Free tier |
|---|---|---|
| `GROQ_API_KEY` | [Groq](https://console.groq.com/) | generous, very fast |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | generous |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/) | `:free` models |

Token use is capped in code: only ambiguous headlines are re-scored, and at
most 8 lesson explanations per run. A typical full run is a few thousand
tokens.

Every LLM output is labelled in the UI with the provider that wrote it, and
the prompts forbid inventing numbers. Verify anything that matters against the
raw figures shown elsewhere on the page.

---

## Editing your watchlist

Three ways, in order of convenience:

1. **In the dashboard** — Watchlist tab. Saves to your browser immediately. To
   make it stick and drive alerts, turn on GitHub sync in ⚙ Settings: enter
   owner, repo and a **fine-grained PAT** scoped to this one repository with
   *Contents: read and write* (add *Actions: read and write* for the "Run
   pipeline now" button). The token is stored only in your browser's
   localStorage and is sent only to `api.github.com`.
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
breadth on Overview instead.

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
python tests/test_pipeline_offline.py     # synthetic data through every module
npm install && ./dev.sh &                 # then, in another shell:
PORT=8000 node tests/render-test.mjs      # every view in jsdom, real data
```

The render test clicks through all ten views in both markets, opens the stock
and settings modals, adds a watchlist symbol, and fails on any thrown error,
empty view, or `NaN` leaking into the page. Both run in CI on every push.

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
