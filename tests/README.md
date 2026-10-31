# Tests

Two checks, both run without any market data or network access to Yahoo.

## `test_pipeline_offline.py`

Drives every pure pipeline module with synthetic price series: indicators,
dataset construction, model training, quote assembly, regime and sector
aggregation, the screener, lexicon sentiment, event detection, and the
template teaching output. Catches shape and key errors before a real run.

Also covers the corporate calendar without touching NSE or Nasdaq: the
filing parsers and type classifier, the rule that an estimate never
overwrites an exchange-sourced row, export de-duplication of Yahoo estimates
once an official date exists, and `run_all.parse_symbols` rejecting
anything that isn't a ticker.

Results data (`fundamentals.py`) with synthetic statements and prices:
quarter extraction and YoY/QoQ maths, dropping Yahoo's duplicated quarters,
the price-reaction window for after-close, pre-open and unknown-time
announcements, surprise history merged with exchange dates, JSON-safe stats,
and the refresh rules (watchlist only, forced symbols skip anything fetched
in the last hour).

```bash
python tests/test_pipeline_offline.py
```

## `test_config_env.py`

Runs `config.py` under the environment GitHub Actions actually produces. An
unset `${{ vars.X }}` is substituted as an **empty string**, not omitted, so
`os.getenv(name, default)` returns `""` and `int("")` raises — a real run
failed on exactly that. Covers blank, whitespace-only, absent, unparseable
and real values.

```bash
python tests/test_config_env.py
```

## `render-test.mjs`

Loads the real dashboard in jsdom against the committed `data/` snapshots,
clicks through every view in both markets, opens the stock and settings
modals, adds and removes a watchlist ticker (including one with no data yet),
exercises the calendar's window/scope/type/ticker filters, opens the event
detail panel for every calendar row in both markets (with and without
results data), checks the signed-in indicator, the news
ticker filter, opens the ⓘ guide drawer on every page (and its "Learn"
links), answers a Learn quiz, marks a concept learned and advances to the
next, checks the ⟳ menu items, and fails on any thrown error, empty view,
or `NaN` / `undefined` leaking into the rendered text.

jsdom does not execute `<script type="module">`, so the test imports the
modules directly into a jsdom global environment and serves `data/` over
HTTP.

```bash
npm install                # once
python3 -m http.server 8000 &   # read-only mode (no side effects)
PORT=8000 node tests/render-test.mjs
```

Against `./dev.sh` instead, the page runs in local mode: the add/remove
ticker step writes `watchlist.json` and starts a real local `quick` run.

## `sector-test.mjs`

Drills into the sector board: opens a sector panel, fires a hover tooltip,
exercises the news view's scope, kind filter, sector chips and search, and asserts that **every
colour-encoded cell carries a numeric label** and the diverging legend is
present — the accessibility rule that keeps the charts readable without
colour.

```bash
PORT=8000 node tests/sector-test.mjs
```
