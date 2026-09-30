// Bootstrap, state, routing, settings.

import * as gh from './gh.js';
import { $, $$, card, el, lsGet, lsSet, modal, pill, toast } from './lib.js';
import * as newsViews from './news-views.js';
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
  overview: views.overview, watchlist: views.watchlist, movers: views.movers,
  sectors: views.sectors, ideas: views.ideas, model: views.model, alerts: views.alerts,
  news: newsViews.newsFeed, sectornews: newsViews.sectorNews, filings: newsViews.filings,
  learn: views.learn, about: views.about,
};

const state = {
  market: lsGet('mktdesk.market', 'IN'),
  view: location.hash.slice(1) || 'overview',
  bundles: {},
  feeds: {},
  meta: null,
  curriculum: [],
  scorecard: null,
  watchlist: null,
};

// --------------------------------------------------------------- data load
async function getJSON(path) {
  const resp = await fetch(`${DATA_BASE}/${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`);
  return resp.json();
}

async function loadAll(force = false) {
  const [meta, curriculum, scorecard] = await Promise.all([
    getJSON('meta.json').catch(() => null),
    getJSON('curriculum.json').catch(() => []),
    getJSON('scorecard.json').catch(() => null),
  ]);
  state.meta = meta;
  state.curriculum = curriculum;
  state.scorecard = scorecard;

  for (const market of ['IN', 'US']) {
    if (force || !state.bundles[market]) {
      state.bundles[market] = await getJSON(`${market}/bundle.json`).catch(() => null);
      state.feeds[market] = await getJSON(`${market}/feed.json`).catch(() => null);
    }
  }
  reconcileWatchlist();
  decorate();
}

/** localStorage is authoritative for what the *user* sees; the repo file is
 *  authoritative for what the *pipeline* fetches. Local wins on conflict, and
 *  the settings modal is where you push local back to the repo. */
function reconcileWatchlist() {
  const local = gh.localWatchlist();
  if (local) { state.watchlist = local; return; }
  state.watchlist = {
    IN: state.bundles.IN?.watchlist ?? [],
    US: state.bundles.US?.watchlist ?? [],
  };
  gh.saveLocalWatchlist(state.watchlist);
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
async function mutateWatchlist(fn, message) {
  const next = structuredClone(state.watchlist);
  fn(next);
  state.watchlist = next;
  gh.saveLocalWatchlist(next);
  decorate();
  render();

  if (!gh.configured()) {
    toast('Saved to this browser. Turn on GitHub sync to make it stick.', 'info');
    return;
  }
  try {
    const remote = await gh.fetchRemoteWatchlist().catch(() => ({ watchlist: {} }));
    const merged = { ...remote.watchlist, ...next, version: 1 };
    await gh.pushWatchlist(merged, message);
    toast('Committed to watchlist.json', 'ok');
  } catch (err) {
    toast(`GitHub sync failed: ${err.message}`, 'error');
  }
}

const addSymbol = (sym) => {
  const list = state.watchlist[state.market];
  if (list.includes(sym)) { toast(`${sym} is already watched`); return; }
  mutateWatchlist((wl) => wl[state.market].push(sym), `chore: watch ${sym}`);
};

const removeSymbol = (sym) =>
  mutateWatchlist((wl) => {
    wl[state.market] = wl[state.market].filter((s) => s !== sym);
  }, `chore: unwatch ${sym}`);

// ------------------------------------------------------------------ context
function context() {
  return {
    bundle: state.bundles[state.market],
    feed: state.feeds[state.market],
    meta: state.meta,
    curriculum: state.curriculum,
    scorecard: state.scorecard,
    get dataBase() { return DATA_BASE; },
    watchSymbols: state.watchlist?.[state.market] ?? [],
    syncLabel: gh.configured() ? 'synced to GitHub' : 'saved in this browser only',
    addSymbol, removeSymbol, openSettings,
    rerender: render,
    openStock: (sym) => views.stockDetail(context(), sym),
  };
}

// ------------------------------------------------------------------- render
function render() {
  const main = $('#main');
  const bundle = state.bundles[state.market];

  if (!bundle) {
    main.replaceChildren(el('div', { class: 'banner err' },
      `No data file for ${state.market}. `,
      'The pipeline has not produced ', el('code', {}, `data/${state.market}/bundle.json`), ' yet. ',
      'Run the "Market pipeline" workflow in the Actions tab, or run ',
      el('code', {}, 'python pipeline/run_all.py --mode full'), ' locally.'));
    return;
  }

  const view = VIEWS[state.view] ?? views.overview;
  main.replaceChildren(view(context()));
  main.scrollTop = 0;

  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $$('#marketSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.market === state.market));

  const stamp = $('#stamp');
  stamp.textContent = state.meta?.generated_at
    ? `updated ${new Date(state.meta.generated_at).toLocaleString()}`
    : 'never updated';

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
  if (newsBadge) {
    newsBadge.textContent = unread > 99 ? '99+' : unread;
    newsBadge.classList.toggle('hidden', unread === 0);
  }
}

// ----------------------------------------------------------------- settings
function openSettings() {
  const s = gh.settings();
  const guess = gh.guessRepo();
  const owner = el('input', { type: 'text', value: s.owner || guess?.owner || '', placeholder: 'your-github-username' });
  const repo = el('input', { type: 'text', value: s.repo || guess?.repo || '', placeholder: 'market-desk' });
  const branch = el('input', { type: 'text', value: s.branch || 'main', style: 'max-width:140px' });
  const token = el('input', { type: 'password', value: s.token || '', placeholder: 'github_pat_...' });
  const status = el('div', { class: 'faint', style: 'font-size:12px;min-height:18px' });

  const field = (label, input, hint) => el('div', { style: 'margin-bottom:14px' },
    el('label', { style: 'display:block;font-size:12px;font-weight:650;margin-bottom:5px' }, label),
    input,
    hint ? el('div', { class: 'faint', style: 'font-size:11px;margin-top:4px;line-height:1.5' }, hint) : null);

  Object.assign(owner.style, { width: '100%' });
  Object.assign(repo.style, { width: '100%' });
  Object.assign(token.style, { width: '100%' });

  modal('Settings',
    card('GitHub sync', 'optional',
      el('p', { class: 'dim', style: 'font-size:12.5px;line-height:1.7;margin:0 0 16px' },
        'Without this, watchlist changes live only in this browser and the scheduled '
        + 'pipeline keeps using whatever is in watchlist.json. With it, changes commit '
        + 'straight to the repo, so news fetching and phone alerts follow your watchlist.'),
      field('Owner', owner),
      field('Repository', repo),
      field('Branch', branch),
      field('Fine-grained personal access token', token,
        ['Create at github.com/settings/personal-access-tokens — scope it to this one ',
         'repository with Contents: read and write (add Actions: read and write if you ',
         'want the Refresh button to trigger a pipeline run). The token is stored only in ',
         'this browser\'s localStorage and is sent only to api.github.com. Treat it like a ',
         'password: anyone with access to this browser profile can read it.'].join('')),
      status,
      el('div', { class: 'row' },
        el('button', {
          class: 'btn primary',
          onclick: async () => {
            gh.saveSettings({ owner: owner.value.trim(), repo: repo.value.trim(),
              branch: branch.value.trim() || 'main', token: token.value.trim() });
            status.textContent = 'Testing…';
            try {
              const info = await gh.testConnection();
              status.innerHTML = `✅ Connected to <b>${info.full_name}</b>`
                + (info.permissions?.push ? ' (write access confirmed)' : ' (read-only — writes will fail)');
            } catch (err) {
              status.innerHTML = `❌ ${err.message}`;
            }
          },
        }, 'Save & test'),
        el('button', {
          class: 'btn',
          onclick: async () => {
            try { await gh.pushWatchlist({ ...state.watchlist, version: 1 },
              'chore: sync watchlist from dashboard'); toast('Pushed', 'ok'); }
            catch (err) { toast(err.message, 'error'); }
          },
        }, '↑ Push watchlist now'),
        el('button', {
          class: 'btn',
          onclick: async () => {
            try {
              const { watchlist } = await gh.fetchRemoteWatchlist();
              state.watchlist = { IN: watchlist.IN ?? [], US: watchlist.US ?? [] };
              gh.saveLocalWatchlist(state.watchlist);
              decorate(); render(); toast('Pulled from repo', 'ok');
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '↓ Pull from repo'),
        el('button', {
          class: 'btn',
          onclick: async () => {
            try { await gh.triggerRefresh('news'); toast('Pipeline run triggered', 'ok'); }
            catch (err) { toast(`Needs Actions: write — ${err.message}`, 'error'); }
          },
        }, '▶ Run pipeline now'))),

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

    card('Display', null,
      el('div', { class: 'row' },
        el('button', {
          class: 'btn',
          onclick: () => { gh.saveSettings({ token: '' }); toast('Token cleared', 'ok'); },
        }, 'Clear stored token'),
        el('button', {
          class: 'btn',
          onclick: () => {
            try { localStorage.clear(); } catch {}
            location.reload();
          },
        }, 'Reset all local data'))));
}

// -------------------------------------------------------------------- wire
function wire() {
  $$('#nav button').forEach((b) => b.addEventListener('click', () => {
    // Leaving the feed marks everything currently loaded as seen.
    if (state.view === 'news' && b.dataset.view !== 'news') {
      lsSet(`mktdesk.lastSeen.${state.market}`, new Date().toISOString());
    }
    state.view = b.dataset.view;
    location.hash = state.view;
    $('#nav').classList.remove('open');
    render();
  }));

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
  $('#navToggle').addEventListener('click', () => $('#nav').classList.toggle('open'));

  $('#refreshBtn').addEventListener('click', async () => {
    $('#refreshBtn').textContent = '⟳';
    $('#refreshBtn').style.animation = 's .7s linear infinite';
    await loadAll(true);
    render();
    $('#refreshBtn').style.animation = '';
    toast('Reloaded', 'ok');
  });

  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    if (VIEWS[next]) { state.view = next; render(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const order = Object.keys(VIEWS);
    if (e.key === 'm') {
      state.market = state.market === 'IN' ? 'US' : 'IN';
      lsSet('mktdesk.market', state.market);
      render();
    } else if (e.key === 'j' || e.key === 'k') {
      const i = order.indexOf(state.view);
      state.view = order[(i + (e.key === 'j' ? 1 : order.length - 1)) % order.length];
      location.hash = state.view;
      render();
    }
  });

  // Refresh in the background every 5 minutes; the pipeline commits more often
  // than that during market hours.
  setInterval(() => loadAll(true).then(render).catch(() => {}), 300_000);
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
})();
