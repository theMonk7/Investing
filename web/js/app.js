// Bootstrap, state, routing, data loading, on-demand updates, settings.

import * as calendar from './calendar.js';
import { openEvent } from './event-detail.js';
import * as gh from './gh.js';
import { pageHead } from './guides.js';
import * as learn from './learn.js';
import { $, $$, ago, card, display, el, lsGet, lsSet, modal, pill, toast } from './lib.js';
import * as local from './local.js';
import * as newsViews from './news-views.js';
import * as sync from './sync.js';
import * as views from './views.js';

// Pages publishes web/ with data/ copied inside it. A local `python -m
// http.server` from the repo root serves web/ as a subdirectory instead, so
// probe both rather than forcing a symlink.
let DATA_BASE = './data';

async function resolveDataBase() {
  for (const base of ['./data', '../data']) {
    try {
      const resp = await fetch(`${base}/meta.json`, { method: 'HEAD', cache: 'no-store' });
      if (resp.ok) { DATA_BASE = base; return; }
    } catch { /* try the next one */ }
  }
}
const VIEWS = {
  watchlist: views.watchlist, news: newsViews.newsFeed, calendar: calendar.calendar,
  market: views.market, ideas: views.ideas, model: views.model, alerts: views.alerts,
  sectornews: newsViews.sectorNews, filings: newsViews.filings, learn: learn.learnView,
  about: views.about,
};
const MAIN_TABS = ['watchlist', 'news', 'calendar', 'market', 'learn'];
// Old bookmarks keep working.
const ALIASES = { overview: 'market', movers: 'market', sectors: 'market' };
const MARKET_NAME = { IN: 'India', US: 'US' };
const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.&=-]{0,19}$/;

const routeOf = (hash) => {
  const view = ALIASES[hash] ?? hash;
  return VIEWS[view] ? view : 'watchlist';
};
const marketOf = (sym) => (/\.(NS|BO)$/.test(sym) ? 'IN' : 'US');
// Local server first (this machine runs the pipeline), else GitHub Actions.
const canUpdate = () => local.available() || gh.configured();
const syncMode = () => {
  if (local.available()) return 'local';
  return gh.configured() ? 'github' : 'readonly';
};
const UNSYNCED_KEY = 'mktdesk.watchlist.unsynced';
const FIX_ACCESS = { label: 'Fix access', onClick: () => openSettings({ check: true }) };
const blocked = () => syncMode() === 'github' && gh.dispatchBlocked();

/** Gate for updates the user asked for; explains instead of failing again. */
function canFetch() {
  if (local.available()) return true;
  if (!gh.configured()) { openSettings(); return false; }
  if (gh.dispatchBlocked()) { openSettings({ check: true }); return false; }
  return true;
}

/** Follow-up runs after a save: skipped with a note when the token cannot start them. */
function queueRun(opts) {
  if (blocked()) {
    toast('Saved. This token cannot start updates, so data arrives with the next scheduled run.',
      'info', FIX_ACCESS);
    return;
  }
  sync.request(opts);
}

const state = {
  market: lsGet('mktdesk.market', 'IN'),
  view: routeOf(location.hash.slice(1)),
  bundles: {},
  feeds: {},
  events: {},
  fundamentals: {},
  meta: null,
  curriculum: [],
  scorecard: null,
  watchlist: null,
  source: 'pages',
  saving: new Set(),       // tickers whose watchlist commit is in flight
  unsynced: lsGet(UNSYNCED_KEY, false),   // local edits GitHub has not accepted yet
};

// --------------------------------------------------------------- data load
async function pagesJSON(path) {
  const resp = await fetch(`${DATA_BASE}/${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Connected to GitHub: read straight from the branch, so a run that has just
 * finished shows up at once (Pages redeploys a minute or two later).
 * Otherwise, or if the API fails, read the published copy.
 */
async function loadAll() {
  let repo = gh.configured() && !local.available();
  let repoError = null;
  const get = async (path) => {
    if (repo) {
      try { return await gh.readJSON(`data/${path}`); }
      catch (err) {
        if (err.status === 404) return null;
        repo = false;
        repoError = err.message;
      }
    }
    return pagesJSON(path).catch(() => null);
  };

  const [meta, scorecard, curriculum, ...perMarket] = await Promise.all([
    get('meta.json'),
    get('scorecard.json'),
    state.curriculum.length ? state.curriculum : pagesJSON('curriculum.json').catch(() => []),
    ...['IN', 'US'].flatMap((m) => [get(`${m}/bundle.json`), get(`${m}/feed.json`),
      get(`${m}/events.json`), get(`${m}/fundamentals.json`)]),
  ]);
  Object.assign(state, { meta, scorecard, curriculum: curriculum ?? [] });
  ['IN', 'US'].forEach((m, i) => {
    state.bundles[m] = perMarket[i * 4];
    state.feeds[m] = perMarket[i * 4 + 1];
    state.events[m] = perMarket[i * 4 + 2];
    state.fundamentals[m] = perMarket[i * 4 + 3];
  });
  state.source = repo ? 'repo' : 'pages';
  await loadWatchlist(repo);
  decorate();
  if (repoError) toast(`GitHub read failed, showing published data. ${repoError}`, 'error');
}

/** Local mode: watchlist.json on disk. Connected: watchlist.json in the repo,
 *  unless this browser holds edits GitHub refused. Otherwise this browser's
 *  copy, seeded from the pipeline's. */
async function loadWatchlist(repo) {
  const source = local.available() || (repo && !state.unsynced);
  if (source && !state.saving.size) {
    try {
      const wl = local.available()
        ? await local.readWatchlist() : await gh.readJSON('watchlist.json');
      state.watchlist = { IN: wl.IN ?? [], US: wl.US ?? [] };
      gh.saveLocalWatchlist(state.watchlist);
      return;
    } catch { /* fall back to the local copy */ }
  }
  state.watchlist = state.watchlist ?? gh.localWatchlist() ?? {
    IN: state.bundles.IN?.watchlist ?? [],
    US: state.bundles.US?.watchlist ?? [],
  };
  gh.saveLocalWatchlist(state.watchlist);
}

async function loadChart(sym) {
  const path = `${marketOf(sym)}/charts/${sym}.json`;
  if (state.source === 'repo') return gh.readJSON(`data/${path}`);
  return pagesJSON(`${marketOf(sym)}/charts/${encodeURIComponent(sym)}.json`);
}

/** Flatten prediction probability onto quotes so the table can sort on it. */
function decorate() {
  for (const market of ['IN', 'US']) {
    const b = state.bundles[market];
    if (!b) continue;
    const watched = new Set(state.watchlist?.[market] ?? []);
    for (const q of b.quotes ?? []) {
      q.prob = b.predictions?.[q.symbol]?.prob_outperform ?? null;
      q.watched = watched.has(q.symbol);
    }
  }
}

// ------------------------------------------------------------- watchlist ops
/** "wipro" on the India tab becomes WIPRO.NS; returns null if not a ticker. */
function normalise(raw) {
  let sym = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!sym) return null;
  const market = /\.(NS|BO)$/.test(sym) ? 'IN' : state.market;
  if (market === 'IN' && !sym.includes('.') && !sym.startsWith('^')) sym += '.NS';
  return SYMBOL_RE.test(sym) ? { sym, market: marketOf(sym) } : null;
}

// Commits run one after another so two quick edits cannot race on the sha.
let writeChain = Promise.resolve();

function commitWatchlist(message) {
  const snapshot = structuredClone(state.watchlist);
  const run = writeChain.then(async () => {
    if (local.available()) return local.saveWatchlist(snapshot);
    const remote = await gh.fetchRemoteWatchlist().catch(() => ({ watchlist: {} }));
    await gh.pushWatchlist({ ...remote.watchlist, IN: snapshot.IN, US: snapshot.US, version: 1 },
      message);
  });
  writeChain = run.catch(() => {});
  return run;
}

function saveLocally() {
  gh.saveLocalWatchlist(state.watchlist);
  decorate();
}

function setUnsynced(value) {
  state.unsynced = value;
  lsSet(UNSYNCED_KEY, value);
}

/** The edit is already saved in this browser; say why GitHub did not take it. */
function reportWriteFailure(err) {
  if (local.available()) {
    toast(`Could not save watchlist.json: ${err.message}`, 'error');
    return;
  }
  setUnsynced(true);
  const s = gh.settings();
  const why = {
    401: 'the token is invalid or expired',
    403: `the token cannot write to ${s.owner}/${s.repo}`,
    404: `the token cannot write to ${s.owner}/${s.repo} (GitHub answers 404 when a token lacks access)`,
  }[err.status] ?? err.message;
  toast(`Saved in this browser only: ${why}. Fix the token in ⚙ Settings, then Retry.`, 'error');
}

const missingQuote = (sym) =>
  !(state.bundles[marketOf(sym)]?.quotes ?? []).some((q) => q.symbol === sym);

/** Push edits GitHub refused earlier, then fetch any ticker still without data. */
async function retrySync({ quiet = false } = {}) {
  if (!state.unsynced || local.available() || !gh.configured()) return;
  try {
    await commitWatchlist('chore: sync watchlist from dashboard');
  } catch (err) {
    if (!quiet) reportWriteFailure(err);
    return;
  }
  setUnsynced(false);
  const todo = [...state.watchlist.IN, ...state.watchlist.US].filter(missingQuote);
  if (todo.length) {
    queueRun({ mode: 'quick', markets: [...new Set(todo.map(marketOf))], symbols: todo,
      label: todo.map(display).join(', ') });
  }
  if (!quiet) toast('Watchlist synced to GitHub', 'ok');
  render();
}

async function addSymbols(raws) {
  const added = [];
  for (const raw of raws) {
    const n = normalise(raw);
    if (!n) { toast(`"${raw}" is not a valid ticker`, 'error'); continue; }
    const list = state.watchlist[n.market];
    if (list.includes(n.sym)) { toast(`${display(n.sym)} is already on your watchlist`); continue; }
    list.push(n.sym);
    added.push(n);
  }
  if (!added.length) return;
  saveLocally();
  const syms = added.map((a) => a.sym);

  if (!canUpdate()) {
    render();
    toast('Saved in this browser. Connect GitHub (⚙) or run ./dev.sh to fetch its data now.');
    return;
  }
  syms.forEach((s) => state.saving.add(s));
  render();
  try {
    // Commit first: the run reads watchlist.json to decide what to keep.
    await commitWatchlist(`chore: watch ${syms.join(', ')}`);
    queueRun({
      mode: 'quick', markets: [...new Set(added.map((a) => a.market))], symbols: syms,
      label: syms.map(display).join(', '),
    });
  } catch (err) {
    reportWriteFailure(err);
  } finally {
    syms.forEach((s) => state.saving.delete(s));
    render();
  }
}

async function removeSymbol(sym) {
  const market = state.watchlist.IN.includes(sym) ? 'IN' : 'US';
  state.watchlist[market] = state.watchlist[market].filter((s) => s !== sym);
  saveLocally();
  render();
  if (!canUpdate()) return;
  try { await commitWatchlist(`chore: unwatch ${sym}`); }
  catch (err) { reportWriteFailure(err); render(); }
}

/** Fetch prices, news and events for tickers without watching them. */
function fetchSymbols(raws, what = 'data') {
  if (!canFetch()) return;
  const list = raws.map(normalise).filter(Boolean);
  if (!list.length) return;
  sync.request({
    mode: 'quick', markets: [...new Set(list.map((n) => n.market))],
    symbols: list.map((n) => n.sym),
    label: `${what} for ${list.map((n) => display(n.sym)).join(', ')}`,
  });
  render();
}

function updateWatchlist() {
  const syms = state.watchlist[state.market];
  if (!syms.length) { toast('Your watchlist is empty. Add a ticker first.'); return; }
  if (!canFetch()) return;
  sync.request({ mode: 'quick', markets: [state.market], symbols: syms,
    label: `${MARKET_NAME[state.market]} watchlist` });
  render();
}

function fetchEvents() {
  if (!canFetch()) return;
  sync.request({ mode: 'events', markets: [state.market],
    label: `${MARKET_NAME[state.market]} calendar` });
  render();
}

function fetchNews() {
  if (!canFetch()) return;
  sync.request({ mode: 'news', markets: [state.market],
    label: `${MARKET_NAME[state.market]} news` });
  render();
}

/** Re-read the saved data files. Instant, and never needs a token. */
async function reloadData() {
  const btn = $('#refreshBtn');
  btn.classList.add('spinning');
  try {
    await loadAll();
    render();
    toast(`Reloaded · data from ${ago(state.bundles[state.market]?.generated_at)}`, 'ok');
  } catch (err) {
    toast(`Reload failed: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('spinning');
  }
  await retrySync({ quiet: true });
}

// ------------------------------------------------------------ refresh menu
function refreshItems() {
  const m = MARKET_NAME[state.market];
  const via = !canUpdate() ? 'connect GitHub or run ./dev.sh'
    : blocked() ? 'token needs Actions access'
    : syncMode() === 'local' ? 'runs on this machine' : '1–2 min on GitHub';
  return [
    ['reload', 'Reload data', 'Show the latest saved files · instant', reloadData],
    ['news', 'Fetch latest news', `${m} headlines, filings and calendar · ${via}`, fetchNews],
    ['watchlist', 'Update watchlist', `Prices, charts and news for your ${m} tickers · ${via}`, updateWatchlist],
    ['calendar', 'Refresh calendar', `${m} results, board meetings, dividends · ${via}`, fetchEvents],
  ];
}

function toggleRefreshMenu(open) {
  const list = $('#refreshList');
  const show = open ?? !list.classList.contains('open');
  if (show) {
    list.replaceChildren(...refreshItems().map(([id, label, sub, fn]) => el('button', {
      'data-action': id,
      onclick: () => { list.classList.remove('open'); fn(); },
    }, el('span', {}, label), el('small', {}, sub))));
  }
  list.classList.toggle('open', show);
  $('#refreshBtn').setAttribute('aria-expanded', show);
}

// ------------------------------------------------------------------ context
function context() {
  const m = state.market;
  return {
    market: m,
    bundle: state.bundles[m],
    feed: state.feeds[m],
    events: state.events[m],
    fundamentals: state.fundamentals[m],
    meta: state.meta,
    curriculum: state.curriculum,
    scorecard: state.scorecard,
    watchSymbols: state.watchlist?.[m] ?? [],
    connected: canUpdate(),
    mode: syncMode(),
    unsynced: state.unsynced && syncMode() === 'github',
    retrySync: () => retrySync(),
    pending: new Set([...sync.pendingSymbols(), ...state.saving]),
    syncBusy: sync.busy(),
    addSymbol: (sym) => addSymbols([sym]),
    addSymbols, removeSymbol, fetchSymbols, fetchEvents, fetchNews, updateWatchlist, openSettings,
    normalise, loadChart,
    openConcept: (id) => learn.openConcept(context(), id),
    rerender: render,
    go: navigate,
    openStock: (sym) => views.stockDetail(context(), sym),
    openEvent: (e) => openEvent(context(), e),
  };
}

// ------------------------------------------------------------------- render
function render() {
  const main = $('#main');
  const bundle = state.bundles[state.market];

  $$('#nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('#moreBtn').classList.toggle('active', !MAIN_TABS.includes(state.view));
  $$('#marketSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.market === state.market));
  updateChip();

  if (!bundle) {
    main.replaceChildren(el('div', { class: 'banner err' },
      `No data file for ${state.market}. `,
      'The pipeline has not produced ', el('code', {}, `data/${state.market}/bundle.json`), ' yet. ',
      'Run the "Market pipeline" workflow in the Actions tab, or run ',
      el('code', {}, 'python pipeline/run_all.py --mode full'), ' locally.'));
    return;
  }

  const ctx = context();
  main.replaceChildren(pageHead(state.view, ctx), VIEWS[state.view](ctx));

  const count = (bundle.alerts ?? []).filter(
    (a) => Date.now() - new Date(a.ts).getTime() < 86400e3).length;
  const badge = $('#alertBadge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);

  // Unread count uses first_seen (when WE saw the story), not the outlet's
  // publish time, so backdated items still register as new to the reader.
  const lastSeen = lsGet(`mktdesk.lastSeen.${state.market}`, null);
  const unread = lastSeen
    ? (state.feeds[state.market]?.items ?? [])
        .filter((i) => (i.first_seen ?? '') > lastSeen).length
    : 0;
  const newsBadge = $('#newsBadge');
  newsBadge.textContent = unread > 99 ? '99+' : unread;
  newsBadge.classList.toggle('hidden', unread === 0);
}

// ---------------------------------------------------------------- sync chip
let chipTimer = null;

/** Who is signed in, as a coloured dot: green ready, amber limited, grey read-only. */
function updateAccount() {
  const btn = $('#acctBtn');
  if (!btn) return;
  const a = gh.configured() ? gh.lastAccess() : null;
  let kind, text, title;
  if (local.available()) {
    [kind, text, title] = ['ok', 'Local', 'Local mode: saves and updates run on this machine. No sign-in needed.'];
  } else if (!gh.configured()) {
    [kind, text, title] = ['off', 'Sign in', 'Read-only. Connect GitHub to save your watchlist and fetch data on demand.'];
  } else if (!a) {
    [kind, text, title] = ['pending', 'Connected', `Token saved for ${gh.settings().owner}/${gh.settings().repo}. Checking access…`];
  } else if (!a.valid) {
    [kind, text, title] = ['bad', 'Token rejected', 'GitHub rejected the saved token. Click to fix.'];
  } else if (a.contents === false || a.actions === false || a.repoFound === false) {
    [kind, text, title] = ['warn', a.login, `Signed in as ${a.login}, but this token cannot `
      + `${a.contents === false ? 'save the watchlist' : 'start updates'} on ${a.repo}. Click to fix.`];
  } else {
    [kind, text, title] = ['ok', a.login, `Signed in to GitHub as ${a.login} · can save and update ${a.repo}.`];
  }
  btn.className = `acct ${kind}`;
  btn.replaceChildren(el('span', { class: 'acct-dot' }), el('span', { class: 'acct-name' }, text));
  btn.title = title;
  btn.setAttribute('aria-label', title);
}

/** Learn the GitHub login (and what the token may do) once a day, quietly. */
function refreshAccount() {
  if (local.available() || !gh.configured()) return;
  const a = gh.lastAccess();
  if (a && Date.now() - Date.parse(a.at) < 86400e3) return;
  gh.checkAccess().then(updateChip).catch(() => {});
}

function updateChip() {
  updateAccount();
  const chip = $('#syncChip');
  const job = sync.current();
  const stamp = state.bundles[state.market]?.generated_at ?? state.meta?.generated_at;
  clearTimeout(chipTimer);

  if (sync.busy()) {
    const secs = Math.max(0, Math.round((Date.now() - Date.parse(job.startedAt)) / 1000));
    const phase = job.status === 'in_progress' ? 'Updating' : 'Starting';
    chip.className = 'sync-chip running';
    chip.textContent = `${phase} ${job.label || 'data'}… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    chip.title = job.backend === 'local'
      ? 'The pipeline is running on this machine (see the dev.sh terminal).'
      : 'A pipeline run is fetching fresh data. Click to open it on GitHub.';
    chipTimer = setTimeout(updateChip, 1000);
    return;
  }
  const failed = job?.conclusion && job.conclusion !== 'success'
    && Date.now() - Date.parse(job.startedAt) < 3600e3;
  if (failed && canUpdate()) {
    chip.className = 'sync-chip failed';
    chip.textContent = job.authError ? 'Update refused · fix token' : 'Update failed · retry';
    chip.title = job.error || `Run ended: ${job.conclusion}`;
    return;
  }
  if (blocked()) {
    chip.className = 'sync-chip warn';
    chip.textContent = `Updated ${ago(stamp)} · can't fetch`;
    chip.title = 'This GitHub token can read data but cannot start updates. Click to see how to fix it.';
    return;
  }
  const mode = syncMode();
  chip.className = `sync-chip${mode === 'readonly' ? ' readonly' : ''}`;
  chip.textContent = `Updated ${ago(stamp)}${{ local: ' · local', readonly: ' · read-only', github: '' }[mode]}`;
  chip.title = {
    local: 'Running locally: updates run the pipeline on this machine. Click to fetch fresh data.',
    github: `Reading live from GitHub (${state.source}). Click to fetch fresh data.`,
    readonly: 'Showing the published data. Click to connect GitHub and update on demand.',
  }[mode];
}

function onChipClick() {
  const job = sync.current();
  if (sync.busy()) {
    if (job.url) window.open(job.url, '_blank', 'noopener');
  } else if (!canUpdate()) {
    openSettings();
  } else if (blocked() || job?.authError) {
    openSettings({ check: true });
  } else if ($('#syncChip').classList.contains('failed')) {
    sync.retry();
  } else {
    toggleRefreshMenu(true);
  }
}

let lastReported = null;

function onSyncChange(job) {
  updateChip();
  if (!job || job.status !== 'completed' || job.requestId === lastReported) return;
  lastReported = job.requestId;
  if (job.authError) {
    // Record what the token can do so later clicks explain instead of failing.
    gh.checkAccess().then(updateChip).catch(() => {});
    toast(job.error, 'error', FIX_ACCESS);
  } else if (job.conclusion !== 'success' && job.conclusion !== 'cancelled') {
    toast(job.error || `Update ${job.conclusion ?? 'failed'}. Open the run from the status chip.`, 'error');
  }
  // Swap "Fetching…" placeholders back, unless the user is mid-typing.
  if (job.conclusion !== 'success' && !document.activeElement?.matches('#main input')) render();
}

async function onSyncSuccess(job) {
  await loadAll();
  render();
  const missing = job.symbols.filter((s) =>
    (state.watchlist[marketOf(s)] ?? []).includes(s) && missingQuote(s));
  if (missing.length) {
    toast(`No price data for ${missing.map(display).join(', ')}. Check the ticker on Yahoo Finance.`, 'error');
  } else {
    toast(`Updated ${job.label || 'data'}`, 'ok');
  }
}

// ----------------------------------------------------------------- settings
const ext = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

/** Ordered steps that get this token from what it can do to what it needs. */
function accessFix(a) {
  const owner = gh.settings().owner;
  if (!a.valid) {
    return ['GitHub rejected the token: it is mistyped, expired or revoked. Create a new one '
      + '(steps below), paste it above and press Save & connect.'];
  }
  const steps = [];
  if (a.repoFound === false) steps.push(`GitHub cannot find ${a.repo}. Check the Owner and Repository fields.`);
  if (a.workflow === false) {
    steps.push(['The workflow file is not on GitHub yet. Push your local changes (',
      el('code', {}, 'git push'), ') so ', el('code', {}, '.github/workflows/pipeline.yml'), ' exists.']);
  }
  const needs = [a.contents === false && 'Contents', a.actions === false && 'Actions'].filter(Boolean);
  if (!needs.length) return steps;

  if (a.push === false && a.login?.toLowerCase() !== owner.toLowerCase()) {
    steps.push(`Your account (${a.login}) cannot write to ${a.repo}. Use a token from the `
      + `${owner} account, or ask to be added as a collaborator.`);
  }
  if (a.kind === 'classic') {
    steps.push(`This is a classic token with scopes: ${a.scopes || 'none'}. It needs the "repo" scope.`,
      ['Open ', ext('https://github.com/settings/tokens', 'github.com/settings/tokens'),
        ', edit the token, tick ', el('b', {}, 'repo'), ' and save. Or switch to a fine-grained token (safer).'],
      'Click Check access again.');
    return steps;
  }
  steps.push(
    ['Open ', ext('https://github.com/settings/personal-access-tokens', 'github.com/settings/personal-access-tokens'),
      ' and edit this token (a fine-grained token, the ', el('code', {}, 'github_pat_'), ' kind).'],
    ['Repository access: ', el('b', {}, 'Only select repositories'), ' → ', el('b', {}, a.repo),
      `. The resource owner must be ${owner}; if it is not, generate a new token instead.`],
    ['Repository permissions: set ', el('b', {}, 'Contents'), ' and ', el('b', {}, 'Actions'),
      ' to ', el('b', {}, 'Read and write'), `. Missing now: ${needs.join(' and ')}.`],
    'Save. The token value does not change, so just click Check access again here.');
  return steps;
}

function accessReport(a) {
  const row = (ok, label, detail) => el('div', { class: `check ${ok === true ? 'ok' : ok === false ? 'bad' : 'unknown'}` },
    el('span', { class: 'mark' }, ok === true ? '✓' : ok === false ? '✕' : '?'),
    el('div', {}, el('div', {}, label), detail ? el('div', { class: 'faint' }, detail) : null));
  const rows = [row(a.valid, 'Token is valid',
    a.valid ? `Signed in as ${a.login} · ${a.kind} token` : 'Rejected by GitHub')];
  if (a.valid) {
    rows.push(
      row(a.repoFound, `Repository ${a.repo}`, a.repoFound ? 'found' : 'not found'),
      row(a.workflow, 'Pipeline workflow', a.workflow ? 'pipeline.yml is on GitHub' : 'missing on GitHub'),
      row(a.contents, 'Save the watchlist', 'needs Contents: Read and write'),
      row(a.actions, 'Start updates (Refresh, Update, new tickers)', a.actions === null && !a.workflow
        ? 'cannot test until the workflow exists' : 'needs Actions: Read and write'));
  }
  const steps = accessFix(a);
  return el('div', { class: 'access' },
    ...rows,
    steps.length
      ? el('div', { class: 'access-fix' }, el('b', {}, 'How to fix'),
          el('ol', {}, ...steps.map((s) => el('li', {}, s))))
      : el('p', { class: 'up', style: 'margin:10px 0 0;font-size:12.5px' },
          'All set: adding tickers, Fetch latest news and Update will work.'),
    el('div', { class: 'faint', style: 'font-size:11px;margin-top:8px' }, `Checked ${ago(a.at)}. `
      + 'The check changes nothing: GitHub rejects its test requests either way.'));
}

function openSettings({ check = false } = {}) {
  const s = gh.settings();
  const guess = gh.guessRepo();
  const owner = el('input', { type: 'text', value: s.owner || guess?.owner || '', placeholder: 'your-github-username' });
  const repo = el('input', { type: 'text', value: s.repo || guess?.repo || '', placeholder: 'repository' });
  const branch = el('input', { type: 'text', value: s.branch || 'main', style: 'max-width:140px' });
  const token = el('input', { type: 'password', value: s.token || '', placeholder: 'github_pat_...' });
  const status = el('div', { class: 'faint', style: 'font-size:12px;min-height:18px;margin-bottom:12px' },
    gh.configured()
      ? `${gh.lastAccess()?.login ? `Signed in as ${gh.lastAccess().login} · ` : ''}Connected to ${s.owner}/${s.repo}.`
      : 'Not connected: the dashboard is read-only.');

  const field = (label, input, hint) => el('div', { style: 'margin-bottom:14px' },
    el('label', { style: 'display:block;font-size:12px;font-weight:650;margin-bottom:5px' }, label),
    input,
    hint ? el('div', { class: 'faint', style: 'font-size:11px;margin-top:4px;line-height:1.5' }, hint) : null);

  Object.assign(owner.style, { width: '100%' });
  Object.assign(repo.style, { width: '100%' });
  Object.assign(token.style, { width: '100%' });

  const last = gh.configured() ? gh.lastAccess() : null;
  const accessBox = el('div', { class: 'access-box' }, last ? accessReport(last) : null);
  const runCheck = async () => {
    accessBox.replaceChildren(el('div', { class: 'faint' }, 'Checking what this token can do…'));
    try {
      const a = await gh.checkAccess();
      accessBox.replaceChildren(accessReport(a));
      updateChip();
      return a;
    } catch (err) {
      accessBox.replaceChildren(el('div', { class: 'down' }, `Check failed: ${err.message}`));
      return null;
    }
  };

  const connect = async () => {
    gh.saveSettings({ owner: owner.value.trim(), repo: repo.value.trim(),
      branch: branch.value.trim() || 'main', token: token.value.trim() });
    status.textContent = 'Checking…';
    const a = await runCheck();
    if (!a?.valid || !a.repoFound) {
      status.textContent = 'Could not connect. See the checklist below.';
      return;
    }
    if (!a.contents) {
      status.textContent = `Reading ${a.repo}. Saving and updates need the fixes below.`;
      await loadAll();
      render();
      return;
    }
    try {
      status.textContent = `Connected to ${a.repo}. Syncing watchlist…`;
      const extras = await adoptRemoteWatchlist();
      setUnsynced(false);
      await loadAll();
      render();
      status.textContent = `Connected to ${a.repo}.`
        + (extras.length ? ` Added ${extras.map(display).join(', ')} from this browser.` : '');
    } catch (err) {
      status.textContent = `Could not connect: ${err.message}`;
    }
  };

  modal('Settings',
    local.available()
      ? card('Running locally', 'no GitHub needed',
          el('p', { class: 'dim', style: 'font-size:12.5px;line-height:1.7;margin:0' },
            'This page is served by ', el('code', {}, 'pipeline/local_server.py'), '. Adding a '
            + 'ticker saves it to ', el('code', {}, 'watchlist.json'), ' and Refresh / Update run '
            + 'the pipeline on this machine. Commit and push ', el('code', {}, 'watchlist.json'),
            ' and ', el('code', {}, 'data/'), ' yourself to publish. The GitHub connection below '
            + 'is used only by the published site.'))
      : null,
    card('GitHub connection', gh.configured() ? 'connected' : 'optional',
      el('p', { class: 'dim', style: 'font-size:12.5px;line-height:1.7;margin:0 0 16px' },
        'Connect to update on demand. Refresh, Update and adding a ticker start a short '
        + 'pipeline run in GitHub Actions (about 1–2 minutes); the page follows it and '
        + 'reloads when it finishes. Your watchlist is saved to watchlist.json, so '
        + 'scheduled runs and phone alerts follow it too.'),
      field('Owner', owner),
      field('Repository', repo),
      field('Branch', branch),
      field('Fine-grained personal access token', token,
        ['Create at github.com/settings/personal-access-tokens, scoped to this one ',
         'repository, with Contents: read and write and Actions: read and write. ',
         'It is stored only in this browser\'s localStorage and sent only to ',
         'api.github.com. Treat it like a password.'].join('')),
      status,
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', onclick: connect }, 'Save & connect'),
        gh.configured()
          ? el('button', { class: 'btn', id: 'checkAccess', onclick: runCheck }, 'Check access')
          : null,
        gh.configured()
          ? el('button', {
              class: 'btn',
              onclick: () => {
                gh.saveSettings({ token: '' });
                gh.forgetAccess();
                token.value = '';
                accessBox.replaceChildren();
                status.textContent = 'Disconnected. The token was removed from this browser.';
                loadAll().then(render);
              },
            }, 'Disconnect')
          : null,
        gh.configured()
          ? el('button', {
              class: 'btn',
              title: 'Prices, news, model retrain and calendar for both markets. Takes ~10 minutes.',
              onclick: () => {
                if (!canFetch()) return;
                sync.request({ mode: 'full', markets: ['IN', 'US'], label: 'full rebuild' });
                toast('Full rebuild queued', 'ok');
              },
            }, 'Run full rebuild')
          : null),
      accessBox),

    card('Phone alerts', 'configured in the repo, not here',
      el('p', { class: 'dim', style: 'font-size:12.5px;line-height:1.8;margin:0' },
        'Alert delivery runs inside GitHub Actions, so the credentials live in repository '
        + 'secrets — never in this browser. Set any of: ',
        el('code', {}, 'NTFY_TOPIC'), ' (easiest — install the ntfy app, subscribe to a '
        + 'topic name only you know), ', el('code', {}, 'TELEGRAM_BOT_TOKEN'), ' + ',
        el('code', {}, 'TELEGRAM_CHAT_ID'), ', ', el('code', {}, 'CALLMEBOT_PHONE'), ' + ',
        el('code', {}, 'CALLMEBOT_APIKEY'), ' for WhatsApp, or ', el('code', {}, 'DISCORD_WEBHOOK'),
        '. Full setup steps are in the README.'),
      el('div', { class: 'row', style: 'margin-top:12px' },
        ...['ntfy', 'telegram', 'whatsapp', 'discord'].map((c) => pill(c, 'neutral')))),

    card('This browser', null,
      el('div', { class: 'row' },
        el('button', {
          class: 'btn',
          onclick: () => {
            try { localStorage.clear(); } catch {}
            location.reload();
          },
        }, 'Reset all local data'))));
  if (check && gh.configured()) runCheck();
}

/** On connect the repo's watchlist wins, but tickers added in this browser
 *  while disconnected are added to it rather than dropped. */
async function adoptRemoteWatchlist() {
  const { watchlist: remote } = await gh.fetchRemoteWatchlist()
    .catch(() => ({ watchlist: {} }));
  const local = state.watchlist ?? { IN: [], US: [] };
  const merged = { IN: [...(remote.IN ?? [])], US: [...(remote.US ?? [])] };
  const extras = [];
  for (const m of ['IN', 'US']) {
    for (const sym of local[m] ?? []) {
      if (!merged[m].includes(sym)) { merged[m].push(sym); extras.push(sym); }
    }
  }
  state.watchlist = merged;
  saveLocally();
  if (extras.length) {
    await commitWatchlist(`chore: watch ${extras.join(', ')}`);
    queueRun({ mode: 'quick', markets: [...new Set(extras.map(marketOf))],
      symbols: extras, label: extras.map(display).join(', ') });
  }
  return extras;
}

// -------------------------------------------------------------------- wire
function navigate(view) {
  // Leaving the feed marks everything currently loaded as seen.
  if (state.view === 'news' && view !== 'news') {
    lsSet(`mktdesk.lastSeen.${state.market}`, new Date().toISOString());
  }
  state.view = routeOf(view);
  $('#moreList').classList.remove('open');
  if (location.hash.slice(1) !== state.view) history.replaceState(null, '', `#${state.view}`);
  render();
  window.scrollTo(0, 0);
}

function wire() {
  $$('#nav [data-view]').forEach((b) =>
    b.addEventListener('click', () => navigate(b.dataset.view)));

  const more = $('#moreList');
  $('#moreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    more.classList.toggle('open');
    $('#moreBtn').setAttribute('aria-expanded', more.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.more')) more.classList.remove('open');
    if (!e.target.closest('#refreshMenu') && !e.target.closest('#syncChip')) toggleRefreshMenu(false);
  });

  $$('#marketSwitch button').forEach((b) => b.addEventListener('click', () => {
    state.market = b.dataset.market;
    lsSet('mktdesk.market', state.market);
    render();
  }));

  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    lsSet('mktdesk.theme', next);
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#acctBtn').addEventListener('click', () => openSettings({ check: gh.configured() && !local.available() }));
  $('#refreshBtn').addEventListener('click', () => toggleRefreshMenu());
  $('#syncChip').addEventListener('click', onChipClick);

  window.addEventListener('hashchange', () => {
    const next = routeOf(location.hash.slice(1));
    if (next !== state.view) navigate(next);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { more.classList.remove('open'); toggleRefreshMenu(false); }
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'm') {
      state.market = state.market === 'IN' ? 'US' : 'IN';
      lsSet('mktdesk.market', state.market);
      render();
    } else if (e.key === 'j' || e.key === 'k') {
      const i = Math.max(0, MAIN_TABS.indexOf(state.view));
      navigate(MAIN_TABS[(i + (e.key === 'j' ? 1 : MAIN_TABS.length - 1)) % MAIN_TABS.length]);
    }
  });

  // Pick up scheduled runs in the background. Skipped while typing so a
  // re-render never eats what you are entering.
  setInterval(() => {
    if (document.activeElement?.matches('#main input')) return;
    loadAll().then(render).catch(() => {});
  }, 300_000);
}

// -------------------------------------------------------------------- boot
(async function boot() {
  document.documentElement.dataset.theme = lsGet('mktdesk.theme', 'dark');
  wire();
  try {
    await Promise.all([resolveDataBase(), local.detect()]);
    await loadAll();
  } catch (err) {
    $('#main').replaceChildren(el('div', { class: 'banner err' },
      `Could not load data: ${err.message}. `,
      'If this is a fresh clone, run the pipeline once to generate the data/ files.'));
    return;
  }
  render();
  refreshAccount();
  // A run that ended before this page load was already reported.
  if (!sync.busy()) lastReported = sync.current()?.requestId ?? null;
  sync.subscribe(onSyncChange);
  sync.init({ onSuccess: onSyncSuccess });
})();
