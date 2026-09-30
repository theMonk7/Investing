// Watchlist persistence.
//
// Two layers, on purpose:
//   1. localStorage  -- instant, always works, per-browser.
//   2. GitHub commit -- optional, makes the change durable and picked up by
//      the next scheduled pipeline run so alerts follow your watchlist.
//
// The token is a fine-grained PAT scoped to this one repo with Contents:write,
// stored only in your own browser's localStorage. It is never sent anywhere
// except api.github.com. If you would rather not hold a token in the browser,
// leave it unset and edit watchlist.json in GitHub directly -- the dashboard
// keeps working from localStorage either way.

import { lsGet, lsSet } from './lib.js';

const SETTINGS_KEY = 'mktdesk.settings';
const LOCAL_WATCHLIST_KEY = 'mktdesk.watchlist';
const API = 'https://api.github.com';

export function settings() {
  return lsGet(SETTINGS_KEY, { owner: '', repo: '', branch: 'main', token: '' });
}

export function saveSettings(patch) {
  const next = { ...settings(), ...patch };
  lsSet(SETTINGS_KEY, next);
  return next;
}

export function configured() {
  const s = settings();
  return Boolean(s.owner && s.repo && s.token);
}

/** Guess owner/repo from a github.io Pages URL so setup is usually one field. */
export function guessRepo() {
  const host = location.hostname;
  const match = host.match(/^([\w-]+)\.github\.io$/);
  if (!match) return null;
  const owner = match[1];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg || `${owner}.github.io` };
}

export function localWatchlist() {
  return lsGet(LOCAL_WATCHLIST_KEY, null);
}

export function saveLocalWatchlist(wl) {
  lsSet(LOCAL_WATCHLIST_KEY, wl);
}

async function ghFetch(path, options = {}) {
  const s = settings();
  const resp = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${s.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`GitHub ${resp.status}: ${detail.slice(0, 200)}`);
  }
  return resp.json();
}

/** Read watchlist.json from the repo, returning its content and blob sha. */
export async function fetchRemoteWatchlist() {
  const s = settings();
  const data = await ghFetch(
    `/repos/${s.owner}/${s.repo}/contents/watchlist.json?ref=${encodeURIComponent(s.branch)}`);
  const json = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
  return { watchlist: json, sha: data.sha };
}

/** Commit an updated watchlist. Re-reads the sha first to avoid a stale write. */
export async function pushWatchlist(watchlist, message = 'chore: update watchlist from dashboard') {
  const s = settings();
  let sha;
  try { ({ sha } = await fetchRemoteWatchlist()); } catch { sha = undefined; }

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(watchlist, null, 2) + '\n')));
  return ghFetch(`/repos/${s.owner}/${s.repo}/contents/watchlist.json`, {
    method: 'PUT',
    body: JSON.stringify({ message, content, sha, branch: s.branch }),
  });
}

/** Kick the pipeline immediately instead of waiting for the next cron tick. */
export async function triggerRefresh(mode = 'news') {
  const s = settings();
  return ghFetch(`/repos/${s.owner}/${s.repo}/actions/workflows/pipeline.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: s.branch, inputs: { mode } }),
  });
}

export async function testConnection() {
  const s = settings();
  const repo = await ghFetch(`/repos/${s.owner}/${s.repo}`);
  return { full_name: repo.full_name, permissions: repo.permissions };
}
