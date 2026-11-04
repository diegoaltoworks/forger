/**
 * Classifies a planning request as `product` or `creative` from the request
 * text and the dependencies the repo already declares. Pure: the caller reads
 * the repo and hands the facts in.
 */

export type Intent = 'product' | 'creative';

export interface IntentFacts {
  request: string;
  /** Dependency names from the repo's manifest. */
  dependencies: string[];
}

export interface IntentSignal {
  id: string;
  source: 'request' | 'repo';
  /** The text or dependency that matched. */
  match: string;
}

export interface IntentResult {
  intent: Intent;
  signals: IntentSignal[];
}

interface RequestRule {
  id: string;
  pattern: RegExp;
}

// "think <X>" only counts at the start of a clause: "I think Postgres" is an opinion, not a reference.
const REQUEST_RULES: RequestRule[] = [
  {id: 'game', pattern: /\bgames?\b/i},
  {id: 'demo', pattern: /\bdemos?\b/i},
  {id: 'pitch', pattern: /\bpitch(?:es|ing)?\b/i},
  {id: 'playful', pattern: /\bplayful(?:ly|ness)?\b/i},
  {id: 'animation', pattern: /\banimat(?:ion|ions|ed|e)\b/i},
  {id: 'pixel-art', pattern: /\b(?:\d+-bit|pixel[- ]art|sprites?)\b/i},
  {id: 'style-of', pattern: /\bin the style of\b/i},
  {id: 'think-reference', pattern: /(?:^|[(,;:.\-]\s*)[Tt]hink\s+(?:of\s+|like\s+)?(?:"[^"]+"|'[^']+'|<[^>]+>|[A-Z][\w-]*)/m},
];

const CREATIVE_DEPENDENCIES = [
  'canvas',
  'phaser',
  'pixi.js',
  'three',
  'p5',
  'kaboom',
  'excalibur',
  'howler',
  'matter-js',
  'babylonjs',
  'konva',
  'gsap',
  'lottie-web',
];

function isCreativeDependency(name: string): boolean {
  return CREATIVE_DEPENDENCIES.some(d => name === d || name.startsWith(`${d}/`) || name.startsWith(`@${d}/`) || name.startsWith(`${d}-`));
}

/**
 * Creative when the request names a creative signal, or when the repo already
 * leans on two or more canvas or game dependencies. One such dependency alone
 * proves little: a product can chart on a canvas.
 */
export function classifyIntent(facts: IntentFacts): IntentResult {
  const signals: IntentSignal[] = [];
  for (const rule of REQUEST_RULES) {
    const m = rule.pattern.exec(facts.request);
    if (m) signals.push({id: rule.id, source: 'request', match: m[0].trim()});
  }
  for (const dep of facts.dependencies) {
    if (isCreativeDependency(dep)) signals.push({id: 'dependency', source: 'repo', match: dep});
  }
  const fromRequest = signals.filter(s => s.source === 'request').length;
  const fromRepo = signals.length - fromRequest;
  return {intent: fromRequest > 0 || fromRepo >= 2 ? 'creative' : 'product', signals};
}
