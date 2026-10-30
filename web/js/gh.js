// GitHub access: watchlist persistence, reading fresh data, triggering runs.
//
// Two layers, on purpose:
//   1. localStorage  -- instant, always works, per-browser.
//   2. GitHub        -- optional. Commits watchlist changes, dispatches the
//      pipeline for just-added tickers, and reads data straight from the repo
//      so a finished run shows up without waiting for Pages to redeploy.
//
// The token is a fine-grained PAT scoped to this one repo with Contents and
// Actions read/write, stored only in your own browser's localStorage. It is
// never sent anywhere except api.github.com. Without it the dashboard keeps
// working read-only from the published data and localStorage.

import { lsGet, lsSet } from './lib.js';

const SETTINGS_KEY = 'mktdesk.settings';
const LOCAL_WATCHLIST_KEY = 'mktdesk.watchlist';
const API = 'https://api.github.com';
const WORKFLOW = 'pipeline.yml';

export class GhError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

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
    cache: 'no-store',
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
    let message = detail;
    try { message = JSON.parse(detail).message || detail; } catch { /* plain text */ }
    throw new GhError(resp.status, `GitHub ${resp.status}: ${String(message).slice(0, 200)}`);
  }
  // Dispatch used to answer 204 with no body; newer API versions return JSON.
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

const repoPath = () => {
  const s = settings();
  return `/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`;
};

/** Read a JSON file straight from the branch -- fresher than Pages. */
export async function readJSON(path) {
  const s = settings();
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return ghFetch(`${repoPath()}/contents/${encoded}?ref=${encodeURIComponent(s.branch)}`, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
}

/** Read watchlist.json from the repo, returning its content and blob sha. */
export async function fetchRemoteWatchlist() {
  const s = settings();
  const data = await ghFetch(
    `${repoPath()}/contents/watchlist.json?ref=${encodeURIComponent(s.branch)}`);
  const json = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
  return { watchlist: json, sha: data.sha };
}

/** Commit an updated watchlist. Re-reads the sha first to avoid a stale write. */
export async function pushWatchlist(watchlist, message = 'chore: update watchlist from dashboard') {
  const s = settings();
  let sha;
  try { ({ sha } = await fetchRemoteWatchlist()); } catch { sha = undefined; }

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(watchlist, null, 2) + '\n')));
  return ghFetch(`${repoPath()}/contents/watchlist.json`, {
    method: 'PUT',
    body: JSON.stringify({ message, content, sha, branch: s.branch }),
  });
}

/**
 * Start a pipeline run. Returns {id, html_url} when GitHub reports the run
 * straight away, otherwise null -- callers then locate it via findRun() using
 * the request id, which the workflow puts in its run title.
 */
export async function dispatch(mode, { markets = 'IN,US', symbols = '', request_id = '' } = {}) {
  const s = settings();
  const res = await ghFetch(`${repoPath()}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: s.branch, inputs: { mode, markets, symbols, request_id } }),
  });
  return res?.workflow_run_id ? { id: res.workflow_run_id, html_url: res.html_url } : null;
}

export async function findRun(requestId) {
  const res = await ghFetch(
    `${repoPath()}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`);
  return (res?.workflow_runs ?? []).find((r) =>
    (r.display_title ?? r.name ?? '').includes(requestId)) ?? null;
}

export async function getRun(id) {
  return ghFetch(`${repoPath()}/actions/runs/${encodeURIComponent(id)}`);
}

export async function testConnection() {
  const repo = await ghFetch(repoPath());
  return { full_name: repo.full_name, permissions: repo.permissions };
}
