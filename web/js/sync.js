// On-demand pipeline runs: dispatch, follow, reload when done.
//
// Browsers cannot call Yahoo, NSE or Google News directly (no CORS), so a
// "real-time" update is a short GitHub Actions run: the page dispatches it,
// polls its status, and re-reads the committed data the moment it succeeds.
// One run at a time; requests made while one is running are merged into the
// next run instead of stacking up.

import * as gh from './gh.js';
import { lsGet, lsSet } from './lib.js';
import * as local from './local.js';

const KEY = 'mktdesk.sync';
const POLL_MS = 5000;
const FIND_TIMEOUT_MS = 90_000;
const RUN_TIMEOUT_MS = 30 * 60_000;
const ACTIVE = new Set(['dispatching', 'requested', 'queued', 'waiting', 'pending', 'in_progress']);

let job = lsGet(KEY, null);
let queue = [];
let timer = null;
let onDone = async () => {};
const listeners = new Set();

const emit = () => { lsSet(KEY, job); listeners.forEach((fn) => fn(job, queue)); };
const backend = () => (job?.backend === 'local' ? local : gh);

export const current = () => job;
export const busy = () => Boolean(job && ACTIVE.has(job.status));

export function subscribe(fn) {
  listeners.add(fn);
  fn(job, queue);
  return () => listeners.delete(fn);
}

/** Symbols that are being fetched right now or waiting for the next run. */
export function pendingSymbols() {
  const out = new Set(queue.flatMap((q) => [...q.symbols]));
  if (busy()) (job.symbols ?? []).forEach((s) => out.add(s));
  return out;
}

export function init({ onSuccess }) {
  onDone = onSuccess;
  // Resume following a run started before a page reload.
  if (busy() && Date.now() - Date.parse(job.startedAt) < RUN_TIMEOUT_MS) poll();
  else if (busy()) { job.status = 'completed'; job.conclusion = 'timed_out'; emit(); }
}

/**
 * Queue a run. `mode` is a pipeline mode (quick | news), `label` is what the
 * status chip shows.
 */
export function request({ mode, markets, symbols = [], label }) {
  let q = queue.find((x) => x.mode === mode);
  if (!q) queue.push(q = { mode, markets: new Set(), symbols: new Set(), labels: [] });
  markets.forEach((m) => q.markets.add(m));
  symbols.forEach((s) => q.symbols.add(s));
  if (label && !q.labels.includes(label)) q.labels.push(label);
  emit();
  if (!busy()) next();
}

export function retry() {
  if (!job || busy()) return;
  request({ mode: job.mode, markets: job.markets, symbols: job.symbols, label: job.label });
}

async function next() {
  const q = queue.shift();
  if (!q) return;
  const requestId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  job = {
    requestId, mode: q.mode, markets: [...q.markets], symbols: [...q.symbols],
    label: q.labels.join(', '), status: 'dispatching', conclusion: null,
    startedAt: new Date().toISOString(), runId: null, url: null, errors: 0,
    retried: Boolean(q.retried), backend: local.available() ? 'local' : 'github',
  };
  emit();
  try {
    const run = await backend().dispatch(job.mode, {
      markets: job.markets.join(','), symbols: job.symbols.join(','), request_id: requestId,
    });
    if (run) Object.assign(job, { runId: run.id, url: run.html_url });
    job.status = 'queued';
    emit();
    timer = setTimeout(poll, 2500);
  } catch (err) {
    const denied = job.backend === 'github' && [401, 403, 404].includes(err.status);
    if (denied) job.authError = true;
    finish('failure', denied
      ? `GitHub refused to start the update (${err.status}): this token is not allowed to run workflows on the repo.`
      : err.message);
  }
}

async function poll() {
  clearTimeout(timer);
  if (!busy()) return;
  try {
    const run = job.runId ? await backend().getRun(job.runId) : await backend().findRun(job.requestId);
    if (run) {
      Object.assign(job, { runId: run.id, url: run.html_url ?? null, status: run.status,
        conclusion: run.conclusion, error: run.error ?? job.error, errors: 0 });
    } else if (Date.now() - Date.parse(job.startedAt) > FIND_TIMEOUT_MS) {
      return finish('failure', 'The run never appeared. Check the Actions tab.');
    }
  } catch (err) {
    if (++job.errors > 6) return finish('failure', err.message);
  }

  if (job.status === 'completed') {
    if (job.conclusion === 'success') {
      emit();
      try { await onDone(job); } catch { /* the reload reports its own errors */ }
    } else if (job.conclusion === 'cancelled' && !job.retried) {
      // A newer queued run (often a scheduled one) displaced ours; go again once.
      const again = { ...job };
      finish('cancelled', 'Displaced by another run — retrying.');
      queue.unshift({ mode: again.mode, markets: new Set(again.markets),
        symbols: new Set(again.symbols), labels: [again.label], retried: true });
    } else {
      emit();
    }
    return next();
  }
  if (Date.now() - Date.parse(job.startedAt) > RUN_TIMEOUT_MS) {
    return finish('timed_out', 'Still running after 30 minutes. Check the Actions tab.');
  }
  emit();
  timer = setTimeout(poll, POLL_MS);
}

function finish(conclusion, error) {
  Object.assign(job, { status: 'completed', conclusion, error });
  emit();
  if (conclusion !== 'cancelled') next();
}
