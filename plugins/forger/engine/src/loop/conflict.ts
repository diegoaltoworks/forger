/**
 * A conflict stop: the worker found a design that cannot meet a guarantee and
 * says so in a fixed block instead of prose, so the owner reads the constraint,
 * the measured gap, the options with their trade-offs and one recommendation.
 * Pure over text; the iteration posts the comment and halts.
 */

export const MAX_OPTIONS = 3;

export interface ConflictOption {
  text: string;
  tradeoff: string;
}

export interface Conflict {
  constraint: string;
  measured: string;
  options: ConflictOption[];
  /** What the worker recommended: an option's text or its short name. */
  recommend: string;
}

export type ConflictParse = {ok: true; conflict: Conflict} | {ok: false; problems: string[]};

const KEY = /^\s*(constraint|measured|option|tradeoff|recommend)\s*:\s*(.*)$/i;
const MEASURE = /\d[\d.,]*\s*[%A-Za-z]/;

/** The short name an option can be recommended by: the text before " - " or ": ", else its first word. */
function nameOf(option: string): string {
  const cut = /^(.+?)(?:\s+-\s+|:\s)/.exec(option);
  return (cut ? cut[1] : option.split(/\s+/)[0]).trim().toLowerCase();
}

function matches(option: string, recommend: string): boolean {
  const r = recommend.trim().toLowerCase();
  return r !== '' && (r === option.trim().toLowerCase() || r === nameOf(option));
}

interface Cursor {
  get(): string;
  set(v: string): void;
}

/** Parses the block that follows `<process>stop conflict</process>`. */
export function parseConflict(block: string): ConflictParse {
  const fields = {constraint: '', measured: '', recommend: ''};
  const options: ConflictOption[] = [];
  const problems: string[] = [];
  let last: Cursor | null = null;

  for (const line of block.split(/\r?\n/)) {
    const m = KEY.exec(line);
    if (!m) {
      if (last && line.trim() !== '') last.set(`${last.get()} ${line.trim()}`.trim());
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'option') {
      const o = {text: value, tradeoff: ''};
      options.push(o);
      last = {get: () => o.text, set: v => (o.text = v)};
    } else if (key === 'tradeoff') {
      const o = options.at(-1);
      if (!o) {
        problems.push('a tradeoff line comes before any option');
        last = null;
      } else {
        o.tradeoff = value;
        last = {get: () => o.tradeoff, set: v => (o.tradeoff = v)};
      }
    } else {
      const k = key as keyof typeof fields;
      fields[k] = value;
      last = {get: () => fields[k], set: v => (fields[k] = v)};
    }
  }

  if (fields.constraint === '') problems.push('constraint is missing');
  if (fields.measured === '') problems.push('measured is missing');
  else if (!MEASURE.test(fields.measured)) problems.push('measured needs a number and a unit');
  if (options.length < 2 || options.length > MAX_OPTIONS) problems.push(`needs two or three options, got ${options.length}`);
  options.forEach((o, i) => {
    if (o.text === '') problems.push(`option ${i + 1} is empty`);
    if (o.tradeoff === '') problems.push(`option ${i + 1} has no tradeoff`);
  });
  if (fields.recommend === '') problems.push('recommend is missing');
  else if (!options.some(o => matches(o.text, fields.recommend))) problems.push(`recommend "${fields.recommend}" names no listed option`);

  if (problems.length > 0) return {ok: false, problems};
  return {ok: true, conflict: {...fields, options}};
}

function optionLines(c: Conflict): string[] {
  return c.options.map((o, i) => `  ${i + 1}. ${o.text} (trade-off: ${o.tradeoff})`);
}

/** The comment posted on the ticket's issue. */
export function conflictComment(issue: number, c: Conflict): string {
  return [
    'The worker stopped: a design rule and a guarantee conflict, and it took none of the options.',
    '',
    `Constraint: ${c.constraint}`,
    `Measured: ${c.measured}`,
    '',
    'Options:',
    ...optionLines(c),
    '',
    `Recommendation: ${c.recommend}`,
    '',
    `Answer with: decide ${issue} "<choice>"`,
  ].join('\n');
}

/** The halt message: everything the owner needs to answer, ending on the line to answer with. */
export function conflictHalt(issue: number | null, c: Conflict): string {
  return [
    `Conflict: ${c.constraint}`,
    `Measured: ${c.measured}`,
    'Options:',
    ...optionLines(c),
    `Recommendation: ${c.recommend}`,
    `Answer with: decide ${issue === null ? '<n>' : issue} "<choice>"`,
  ].join('\n');
}

/** The line to answer a conflict halt with, read back from its message; null for any other halt. */
export function conflictAnswer(reason: string): string | null {
  const m = /^Answer with: (decide .+)$/m.exec(reason);
  return m ? m[1] : null;
}

/** What the worker is told when its block was rejected. */
export function conflictReask(problems: string[]): string {
  return [
    'Your <process>stop conflict</process> block was rejected:',
    ...problems.map(p => `- ${p}`),
    '',
    'Print the complete block once more, and nothing else: <process>stop conflict</process> then the lines',
    'constraint:, measured: (a number and a unit), two or three option: lines each followed by a tradeoff: line, and recommend: naming one listed option.',
  ].join('\n');
}
