# Tests

Two checks, both run without any market data or network access to Yahoo.

## `test_pipeline_offline.py`

Drives every pure pipeline module with synthetic price series: indicators,
dataset construction, model training, quote assembly, regime and sector
aggregation, the screener, lexicon sentiment, event detection, and the
template teaching output. Catches shape and key errors before a real run.

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
modals, adds a watchlist symbol, and fails on any thrown error, empty view,
or `NaN` / `undefined` leaking into the rendered text.

jsdom does not execute `<script type="module">`, so the test imports the
modules directly into a jsdom global environment and serves `data/` over
HTTP.

```bash
npm install jsdom          # once
./dev.sh &                 # serves the repo root on :8000
PORT=8000 node tests/render-test.mjs
```
