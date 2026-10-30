// Bootstrap, state, routing, data loading, on-demand updates, settings.

import * as calendar from './calendar.js';
import * as gh from './gh.js';
import { $, $$, ago, card, display, el, lsGet, lsSet, modal, pill, toast } from './lib.js';
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
  sectornews: newsViews.sectorNews, filings: newsViews.filings, learn: views.learn,
  about: views.about,
};
const MAIN_TABS = ['watchlist', 'news', 'calendar', 'market'];
// Old bookmarks keep working.
const ALIASES = { overview: 'market', movers: 'market', sectors: 'market' };
const MARKET_NAME = { IN: 'India', US: 'US' };
const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.&=-]{0,19}$/;

const routeOf = (hash) => {
  const view = ALIASES[hash] ?? hash;
  return VIEWS[view] ? view : 'watchlist';
};
const marketOf = (sym) => (/\.(NS|BO)$/.test(sym) ? 'IN' : 'US');

const state = {
  market: lsGet('mktdesk.market', 'IN'),
  view: routeOf(location.hash.slice(1)),
  bundles: {},
  feeds: {},
  events: {},
  meta: null,
  curriculum: [],
  scorecard: null,
  watchlist: null,
  source: 'pages',
  saving: new Set(),       // tickers whose watchlist commit is in flight
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
  let repo = gh.configured();
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
    ...['IN', 'US'].flatMap((m) =>
      [get(`${m}/bundle.json`), get(`${m}/feed.json`), get(`${m}/events.json`)]),
  ]);
  Object.assign(state, { meta, scorecard, curriculum: curriculum ?? [] });
  ['IN', 'US'].forEach((m, i) => {
    state.bundles[m] = perMarket[i * 3];
    state.feeds[m] = perMarket[i * 3 + 1];
    state.events[m] = perMarket[i * 3 + 2];
  });
  state.source = repo ? 'repo' : 'pages';
  await loadWatchlist(repo);
  decorate();
  if (repoError) toast(`GitHub read failed, showing published data. ${repoError}`, 'error');
}

/** Connected: watchlist.json in the repo is the truth, since every edit is
 *  committed. Disconnected: this browser's copy, seeded from the pipeline's. */
async function loadWatchlist(repo) {
  if (repo && !state.saving.size) {
    try {
      const wl = await gh.readJSON('watchlist.json');
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

  if (!gh.configured()) {
    render();
    toast('Saved in this browser. Connect GitHub (⚙) to fetch its data right away.');
    return;
  }
  syms.forEach((s) => state.saving.add(s));
  render();
  try {
    // Commit first: the run reads watchlist.json to decide what to keep.
    await commitWatchlist(`chore: watch ${syms.join(', ')}`);
    sync.request({
      mode: 'quick', markets: [...new Set(added.map((a) => a.market))], symbols: syms,
      label: syms.map(display).join(', '),
    });
  } catch (err) {
    toast(`Could not save to GitHub: ${err.message}`, 'error');
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
  if (!gh.configured()) return;
  try { await commitWatchlist(`chore: unwatch ${sym}`); }
  catch (err) { toast(`Could not save to GitHub: ${err.message}`, 'error'); }
}

/** Fetch prices, news and events for tickers without watching them. */
function fetchSymbols(raws, what = 'data') {
  if (!gh.configured()) { openSettings(); return; }
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
  if (!gh.configured()) { openSettings(); return; }
  const syms = state.watchlist[state.market];
  if (!syms.length) return;
  sync.request({ mode: 'quick', markets: [state.market], symbols: syms,
    label: `${MARKET_NAME[state.market]} watchlist` });
  render();
}

function fetchEvents() {
  if (!gh.configured()) { openSettings(); return; }
  sync.request({ mode: 'events', markets: [state.market],
    label: `${MARKET_NAME[state.market]} calendar` });
  render();
}

/** Refresh: show whatever is committed now, then fetch fresh data. */
async function refresh() {
  const btn = $('#refreshBtn');
  btn.classList.add('spinning');
  try { await loadAll(); render(); }
  finally { btn.classList.remove('spinning'); }
  if (!gh.configured()) {
    toast('Reloaded the published data. Connect GitHub (⚙) to fetch fresh data on demand.');
    return;
  }
  sync.request({ mode: 'news', markets: [state.market],
    label: `${MARKET_NAME[state.market]} refresh` });
}

// ------------------------------------------------------------------ context
function context() {
  const m = state.market;
  return {
    market: m,
    bundle: state.bundles[m],
    feed: state.feeds[m],
    events: state.events[m],
    meta: state.meta,
    curriculum: state.curriculum,
    scorecard: state.scorecard,
    watchSymbols: state.watchlist?.[m] ?? [],
    connected: gh.configured(),
    pending: new Set([...sync.pendingSymbols(), ...state.saving]),
    syncBusy: sync.busy(),
    addSymbol: (sym) => addSymbols([sym]),
    addSymbols, removeSymbol, fetchSymbols, fetchEvents, updateWatchlist, openSettings,
    normalise, loadChart,
    rerender: render,
    go: navigate,
    openStock: (sym) => views.stockDetail(context(), sym),
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

  main.replaceChildren(VIEWS[state.view](context()));

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

function updateChip() {
  const chip = $('#syncChip');
  const job = sync.current();
  const stamp = state.bundles[state.market]?.generated_at ?? state.meta?.generated_at;
  clearTimeout(chipTimer);

  if (sync.busy()) {
    const secs = Math.max(0, Math.round((Date.now() - Date.parse(job.startedAt)) / 1000));
    const phase = job.status === 'in_progress' ? 'Updating' : 'Starting';
    chip.className = 'sync-chip running';
    chip.textContent = `${phase} ${job.label || 'data'}… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    chip.title = 'A pipeline run is fetching fresh data. Click to open it on GitHub.';
    chipTimer = setTimeout(updateChip, 1000);
    return;
  }
  const failed = job && job.conclusion && job.conclusion !== 'success'
    && Date.now() - Date.parse(job.startedAt) < 3600e3;
  if (failed && gh.configured()) {
    chip.className = 'sync-chip failed';
    chip.textContent = 'Update failed · retry';
    chip.title = job.error || `Run ended: ${job.conclusion}`;
    return;
  }
  chip.className = `sync-chip${gh.configured() ? '' : ' readonly'}`;
  chip.textContent = `Updated ${ago(stamp)}${gh.configured() ? '' : ' · read-only'}`;
  chip.title = gh.configured()
    ? `Reading live from GitHub (${state.source}). Click to fetch fresh data.`
    : 'Showing the published data. Click to connect GitHub and update on demand.';
}

function onChipClick() {
  const job = sync.current();
  if (sync.busy()) {
    if (job.url) window.open(job.url, '_blank', 'noopener');
  } else if (!gh.configured()) {
    openSettings();
  } else if ($('#syncChip').classList.contains('failed')) {
    sync.retry();
  } else {
    refresh();
  }
}

let lastReported = null;

function onSyncChange(job) {
  updateChip();
  if (!job || job.status !== 'completed' || job.requestId === lastReported) return;
  lastReported = job.requestId;
  if (job.conclusion !== 'success' && job.conclusion !== 'cancelled') {
    toast(job.error || `Update ${job.conclusion ?? 'failed'}. Open the run from the status chip.`, 'error');
  }
  // Swap "Fetching…" placeholders back, unless the user is mid-typing.
  if (job.conclusion !== 'success' && !document.activeElement?.matches('#main input')) render();
}

async function onSyncSuccess(job) {
  await loadAll();
  render();
  const missing = job.symbols.filter((s) =>
    (state.watchlist[marketOf(s)] ?? []).includes(s)
    && !(state.bundles[marketOf(s)]?.quotes ?? []).some((q) => q.symbol === s));
  if (missing.length) {
    toast(`No price data for ${missing.map(display).join(', ')}. Check the ticker on Yahoo Finance.`, 'error');
  } else {
    toast(`Updated ${job.label || 'data'}`, 'ok');
  }
}

// ----------------------------------------------------------------- settings
function openSettings() {
  const s = gh.settings();
  const guess = gh.guessRepo();
  const owner = el('input', { type: 'text', value: s.owner || guess?.owner || '', placeholder: 'your-github-username' });
  const repo = el('input', { type: 'text', value: s.repo || guess?.repo || '', placeholder: 'repository' });
  const branch = el('input', { type: 'text', value: s.branch || 'main', style: 'max-width:140px' });
  const token = el('input', { type: 'password', value: s.token || '', placeholder: 'github_pat_...' });
  const status = el('div', { class: 'faint', style: 'font-size:12px;min-height:18px;margin-bottom:12px' },
    gh.configured() ? `Connected to ${s.owner}/${s.repo}.` : 'Not connected: the dashboard is read-only.');

  const field = (label, input, hint) => el('div', { style: 'margin-bottom:14px' },
    el('label', { style: 'display:block;font-size:12px;font-weight:650;margin-bottom:5px' }, label),
    input,
    hint ? el('div', { class: 'faint', style: 'font-size:11px;margin-top:4px;line-height:1.5' }, hint) : null);

  Object.assign(owner.style, { width: '100%' });
  Object.assign(repo.style, { width: '100%' });
  Object.assign(token.style, { width: '100%' });

  const connect = async () => {
    gh.saveSettings({ owner: owner.value.trim(), repo: repo.value.trim(),
      branch: branch.value.trim() || 'main', token: token.value.trim() });
    status.textContent = 'Checking…';
    try {
      const info = await gh.testConnection();
      if (!info.permissions?.push) {
        status.textContent = `Reached ${info.full_name}, but the token cannot write. `
          + 'Give it Contents: read and write.';
        return;
      }
      status.textContent = `Connected to ${info.full_name}. Syncing watchlist…`;
      const extras = await adoptRemoteWatchlist();
      await loadAll();
      render();
      status.textContent = `Connected to ${info.full_name}.`
        + (extras.length ? ` Added ${extras.map(display).join(', ')} from this browser and started fetching.` : '');
    } catch (err) {
      status.textContent = `Could not connect: ${err.message}`;
    }
  };

  modal('Settings',
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
          ? el('button', {
              class: 'btn',
              onclick: () => {
                gh.saveSettings({ token: '' });
                token.value = '';
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
                sync.request({ mode: 'full', markets: ['IN', 'US'], label: 'full rebuild' });
                toast('Full rebuild queued', 'ok');
              },
            }, 'Run full rebuild')
          : null)),

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
    sync.request({ mode: 'quick', markets: [...new Set(extras.map(marketOf))],
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
  $('#refreshBtn').addEventListener('click', refresh);
  $('#syncChip').addEventListener('click', onChipClick);

  window.addEventListener('hashchange', () => {
    const next = routeOf(location.hash.slice(1));
    if (next !== state.view) navigate(next);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') more.classList.remove('open');
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
    await resolveDataBase();
    await loadAll();
  } catch (err) {
    $('#main').replaceChildren(el('div', { class: 'banner err' },
      `Could not load data: ${err.message}. `,
      'If this is a fresh clone, run the pipeline once to generate the data/ files.'));
    return;
  }
  render();
  // A run that ended before this page load was already reported.
  if (!sync.busy()) lastReported = sync.current()?.requestId ?? null;
  sync.subscribe(onSyncChange);
  sync.init({ onSuccess: onSyncSuccess });
})();
