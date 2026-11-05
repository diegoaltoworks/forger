/**
 * Mechanical assertions on a named UI state: parsed once from ui.json and
 * evaluated over a page model the browser adapter captured. Pure, so a
 * cropped canvas or a wrong-hued region is a fixture, not a browser run.
 */

import type {ElementModel, PageModel, Probe} from '../ports';

/** A hue arc in degrees, clockwise from `from` to `to`; it may wrap past 360. */
export type HueArc = [number, number];

export interface ColourAssertion {
  selector: string;
  /** The name or the numbers the config gave, for the failure message. */
  label: string;
  arc: HueArc;
  /** Degrees the dominant hue may sit outside the arc. */
  tolerance: number;
}

export interface StateAssertions {
  no_console_errors: boolean;
  not_blank: string[];
  in_viewport: string[];
  visible: string[];
  hidden: string[];
  colour: ColourAssertion[];
}

export interface AssertionFailure {
  /** The assertion and its selector, e.g. `in_viewport "#view"`. */
  assertion: string;
  detail: string;
}

export const HUE_NAMES: Record<string, HueArc> = {
  red: [345, 15],
  orange: [15, 45],
  yellow: [45, 70],
  green: [70, 170],
  cyan: [170, 200],
  blue: [200, 260],
  purple: [260, 300],
  magenta: [300, 345],
};

export const DEFAULT_ASSERTIONS: StateAssertions = {no_console_errors: true, not_blank: [], in_viewport: [], visible: [], hidden: [], colour: []};

const KEYS = ['no_console_errors', 'not_blank', 'in_viewport', 'visible', 'hidden', 'colour'];
const MAX_TOLERANCE = 90;

function selectors(v: unknown, where: string, fail: (m: string) => never): string[] {
  const list = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(list) || list.length === 0 || list.some(s => typeof s !== 'string' || s.trim() === '')) {
    return fail(`${where} must be a selector or a non-empty list of selectors`);
  }
  return (list as string[]).map(s => s.trim());
}

function degrees(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 360;
}

function colour(v: unknown, where: string, fail: (m: string) => never): ColourAssertion {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(`${where} must be an object with selector and hue`);
  const o = v as Record<string, unknown>;
  if (typeof o.selector !== 'string' || o.selector.trim() === '') return fail(`${where}.selector must be one selector`);
  let arc: HueArc;
  let label: string;
  if (typeof o.hue === 'string' && o.hue in HUE_NAMES) {
    arc = HUE_NAMES[o.hue];
    label = o.hue;
  } else if (Array.isArray(o.hue) && o.hue.length === 2 && degrees(o.hue[0]) && degrees(o.hue[1])) {
    arc = [o.hue[0], o.hue[1]];
    label = `${o.hue[0]}-${o.hue[1]} degrees`;
  } else {
    return fail(`${where}.hue must be one of ${Object.keys(HUE_NAMES).join(', ')} or [from, to] in degrees`);
  }
  const tolerance = o.tolerance === undefined ? 0 : o.tolerance;
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > MAX_TOLERANCE) {
    return fail(`${where}.tolerance must be a number of degrees from 0 to ${MAX_TOLERANCE}`);
  }
  return {selector: o.selector.trim(), label, arc, tolerance};
}

/** Parses a state's `assert` value; `fail` throws the caller's config error. */
export function parseAssertions(v: unknown, where: string, fail: (message: string) => never): StateAssertions {
  if (v === undefined) return {...DEFAULT_ASSERTIONS};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(`${where} must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) return fail(`${where}.${k} is not an assertion; use ${KEYS.join(', ')}`);
  if (o.no_console_errors !== undefined && typeof o.no_console_errors !== 'boolean') return fail(`${where}.no_console_errors must be true or false`);
  const list = (k: 'not_blank' | 'in_viewport' | 'visible' | 'hidden'): string[] => (o[k] === undefined ? [] : selectors(o[k], `${where}.${k}`, fail));
  const colours = o.colour === undefined ? [] : Array.isArray(o.colour) ? o.colour : [o.colour];
  const out: StateAssertions = {
    no_console_errors: o.no_console_errors !== false,
    not_blank: list('not_blank'),
    in_viewport: list('in_viewport'),
    visible: list('visible'),
    hidden: list('hidden'),
    colour: colours.map((c, i) => colour(c, `${where}.colour[${i}]`, fail)),
  };
  const shown = [...out.visible, ...out.not_blank, ...out.in_viewport, ...out.colour.map(c => c.selector)];
  for (const s of out.hidden) if (shown.includes(s)) return fail(`${where}: "${s}" cannot be both hidden and shown`);
  return out;
}

/** What the page must be asked about so the assertions can be evaluated. */
export function probeFor(a: StateAssertions): Probe {
  const pixels = [...new Set([...a.not_blank, ...a.colour.map(c => c.selector)])];
  const boxes = [...new Set([...pixels, ...a.in_viewport, ...a.visible, ...a.hidden])];
  return {boxes, pixels};
}

const FLAT = 2;

function isFlat(pixels: ElementModel['pixels']): boolean {
  const [first] = pixels;
  return pixels.every(p => p.every((c, i) => Math.abs(c - first[i]) <= FLAT));
}

function hsl([r, g, b]: [number, number, number]): {h: number; s: number; l: number} {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return {h: 0, s: 0, l};
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60;
  return {h, s, l};
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const BIN = 10;
const MIN_SATURATION = 0.15;

/** The hue most of the coloured pixels share, or null when the region has no colour (greys, black, white). */
export function dominantHue(pixels: ElementModel['pixels']): number | null {
  const coloured = pixels.map(hsl).filter(p => p.s >= MIN_SATURATION && p.l >= 0.08 && p.l <= 0.95);
  if (coloured.length === 0) return null;
  const bins = new Array<number>(360 / BIN).fill(0);
  for (const p of coloured) bins[Math.min(bins.length - 1, Math.floor(p.h / BIN))]++;
  const centre = bins.indexOf(Math.max(...bins)) * BIN + BIN / 2;
  let x = 0;
  let y = 0;
  for (const p of coloured) {
    if (circularDistance(p.h, centre) <= BIN / 2) {
      x += Math.cos((p.h * Math.PI) / 180);
      y += Math.sin((p.h * Math.PI) / 180);
    }
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Degrees from a hue to an arc; 0 inside it. */
export function distanceToArc(h: number, [from, to]: HueArc): number {
  const span = (to - from + 360) % 360;
  if ((h - from + 360) % 360 <= span) return 0;
  return Math.min(circularDistance(h, from), circularDistance(h, to));
}

const EDGE = 1;

export function evaluateAssertions(a: StateAssertions, page: PageModel): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const fail = (assertion: string, detail: string): void => void failures.push({assertion, detail});
  const shown = (s: string): ElementModel | null => {
    const e = page.elements[s];
    return e !== undefined && e.found && e.visible ? e : null;
  };

  if (a.no_console_errors && page.console.length > 0) {
    fail('no_console_errors', `${page.console.length} console error${page.console.length === 1 ? '' : 's'}, first: ${page.console[0]}`);
  }
  for (const s of a.visible) {
    if (page.elements[s]?.found !== true) fail(`visible "${s}"`, 'no element matches');
    else if (shown(s) === null) fail(`visible "${s}"`, 'the element is not shown');
  }
  for (const s of a.hidden) {
    if (shown(s) !== null) fail(`hidden "${s}"`, 'the element is shown');
  }
  for (const s of a.in_viewport) {
    const e = page.elements[s];
    if (e === undefined || !e.found || e.box === null) {
      fail(`in_viewport "${s}"`, 'no element matches');
      continue;
    }
    const {x, y, width, height} = e.box;
    const {width: vw, height: vh} = page.viewport;
    const out: string[] = [];
    if (x < -EDGE) out.push(`${Math.round(-x)}px past the left edge`);
    if (y < -EDGE) out.push(`${Math.round(-y)}px past the top edge`);
    if (x + width > vw + EDGE) out.push(`${Math.round(x + width - vw)}px past the right edge`);
    if (y + height > vh + EDGE) out.push(`${Math.round(y + height - vh)}px past the bottom edge`);
    if (out.length > 0) fail(`in_viewport "${s}"`, `the ${Math.round(width)}x${Math.round(height)} box at ${Math.round(x)},${Math.round(y)} is ${out.join(' and ')} of the ${vw}x${vh} viewport`);
  }
  for (const s of a.not_blank) {
    const e = shown(s);
    if (e === null) fail(`not_blank "${s}"`, 'no shown element matches');
    else if (e.pixels.length === 0) fail(`not_blank "${s}"`, 'no pixels were sampled');
    else if (isFlat(e.pixels)) fail(`not_blank "${s}"`, `the region is one flat colour (rgb ${e.pixels[0].join(', ')})`);
  }
  for (const c of a.colour) {
    const name = `colour "${c.selector}"`;
    const e = shown(c.selector);
    if (e === null) fail(name, 'no shown element matches');
    else if (e.pixels.length === 0) fail(name, 'no pixels were sampled');
    else {
      const hue = dominantHue(e.pixels);
      if (hue === null) fail(name, `the region has no dominant hue; expected ${c.label}`);
      else if (distanceToArc(hue, c.arc) > c.tolerance) fail(name, `the dominant hue is ${Math.round(hue)} degrees; expected ${c.label} (${c.arc[0]}-${c.arc[1]}, tolerance ${c.tolerance})`);
    }
  }
  return failures;
}
