// Local mode: when the dashboard is served by pipeline/local_server.py
// (./dev.sh), the watchlist is saved to watchlist.json on disk and updates
// run the pipeline on this machine. No GitHub account or token involved.

const HEADERS = { 'Content-Type': 'application/json', 'X-Mktdesk': '1' };
let active = false;

export const available = () => active;

export async function detect() {
  try {
    const resp = await fetch('/api/health', { cache: 'no-store' });
    active = resp.ok && (await resp.json()).ok === true;
  } catch {
    active = false;
  }
  return active;
}

async function call(method, path, body) {
  const resp = await fetch(path, {
    method, cache: 'no-store', headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.error || `Local server ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

const list = (csv) => String(csv ?? '').split(',').filter(Boolean);

export const readWatchlist = () => call('GET', '/api/watchlist');
export const saveWatchlist = (wl) => call('PUT', '/api/watchlist', { IN: wl.IN, US: wl.US });

export async function dispatch(mode, { markets = '', symbols = '' } = {}) {
  const run = await call('POST', '/api/runs', { mode, markets: list(markets), symbols: list(symbols) });
  return { id: run.id, html_url: null };
}

export const getRun = (id) => call('GET', `/api/runs/${encodeURIComponent(id)}`);

// Runs get their id straight from dispatch, so there is nothing to look up.
export const findRun = async () => null;
