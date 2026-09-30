// SVG chart primitives.
//
// Colour rules follow the dataviz method: sentiment is a DIVERGING measure,
// so it gets two poles and a neutral midpoint rather than a categorical
// palette — which also sidesteps the fact that we have ~10 sectors and no
// categorical palette survives 10 all-pairs slots. Every coloured cell also
// carries its signed number, so nothing depends on hue alone.

import { el, fmt } from './lib.js';

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
};

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Mix a pole toward the neutral midpoint by magnitude. */
export function divergingColor(value, domain = 0.6) {
  const t = Math.max(-1, Math.min(1, (value || 0) / domain));
  if (Math.abs(t) < 0.06) return 'var(--viz-mid)';
  const pole = t > 0 ? 'var(--viz-bull)' : 'var(--viz-bear)';
  const strength = Math.round(28 + Math.abs(t) * 72);   // 28%..100%
  return `color-mix(in srgb, ${pole} ${strength}%, var(--viz-mid))`;
}

// ------------------------------------------------------------------ tooltip
let tip;
function showTip(event, nodes) {
  tip ??= el('div', { class: 'viz-tip' });
  tip.replaceChildren(...nodes);
  document.body.append(tip);
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() { tip?.remove(); }

/** Attach a hover tooltip to any element. Hit target is the element itself. */
export function withTip(node, build) {
  node.addEventListener('mouseenter', (e) => showTip(e, build()));
  node.addEventListener('mousemove', (e) => showTip(e, build()));
  node.addEventListener('mouseleave', hideTip);
  node.addEventListener('focus', (e) => showTip(e, build()));
  node.addEventListener('blur', hideTip);
  return node;
}

// --------------------------------------------------------------- sparkline
/**
 * Single-series line over time. One series means no legend is needed — the
 * caller's title names it. Zero baseline drawn when the data crosses it.
 */
export function lineChart(points, {
  width = 150, height = 44, zeroLine = true, colorByEnd = true, stroke = null,
} = {}) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height,
    preserveAspectRatio: 'none', role: 'img',
  });
  if (!points || points.length < 2) {
    svg.append(svgEl('line', {
      x1: 0, y1: height / 2, x2: width, y2: height / 2,
      stroke: 'var(--viz-grid)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
    }));
    return svg;
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (max - min < 1e-9) { min -= 0.1; max += 0.1; }
  const pad = 4;
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);

  if (zeroLine && min < 0 && max > 0) {
    svg.append(svgEl('line', {
      x1: 0, y1: y(0), x2: width, y2: y(0),
      stroke: 'var(--viz-grid)', 'stroke-width': 1,
    }));
  }

  const last = values.at(-1);
  const colour = stroke
    ?? (colorByEnd ? (last >= 0 ? 'var(--viz-bull)' : 'var(--viz-bear)') : 'var(--accent)');

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', {
    d, fill: 'none', stroke: colour, 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

  // >=8px end marker with a 2px surface ring, per the mark spec.
  svg.append(svgEl('circle', {
    cx: x(points.length - 1), cy: y(last), r: 3.2,
    fill: colour, stroke: 'var(--bg-elev-2)', 'stroke-width': 2,
  }));
  return svg;
}

// -------------------------------------------------------------- bar charts
/** Horizontal bars, single series, 4px rounded data-end anchored at zero. */
export function hbars(rows, { max = null, format = (v) => fmt(v, 1), diverging = false } = {}) {
  const peak = max ?? Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  return el('div', {}, ...rows.map((r) => {
    const width = Math.max(2, (Math.abs(r.value) / peak) * 100);
    const colour = diverging
      ? (r.value >= 0 ? 'var(--viz-bull)' : 'var(--viz-bear)')
      : (r.color ?? 'var(--accent)');
    const bar = el('div', { class: 'hbar' },
      el('span', { class: 'dim', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.label),
      el('div', { class: 'track' }, el('i', { style: `width:${width}%;background:${colour}` })),
      el('span', { class: 'num', style: 'text-align:right;font-size:12px' }, format(r.value)));
    return r.tip ? withTip(bar, r.tip) : bar;
  }));
}

/** The diverging legend. Always shown wherever the scale is used. */
export function divergingLegend(label = 'News sentiment') {
  return el('div', { class: 'legend' },
    el('span', {}, label),
    el('span', {}, 'bearish'),
    el('span', { class: 'scale' }),
    el('span', {}, 'bullish'),
    el('span', { class: 'faint' },
      '— every cell also shows its signed value, so colour is never the only cue'));
}

export { cssVar };
