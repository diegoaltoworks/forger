/**
 * Whether an acceptance criterion can be checked, as a pure decision. A
 * criterion takes one of four forms: a named test, a command with its expected
 * exit code or output, a number with a unit and a source, or a named UI state.
 * A subjective word fails it whatever else it says. The words are matched on
 * the text alone, so the same rule runs on the engine's pick and when a ticket
 * is filed.
 */

import {checkGuards} from './guards';
import {checkProbes} from './probe';
import {parseCriteria} from './verdict';

export type CriterionForm = 'test' | 'command' | 'number' | 'ui';

export const SUBJECTIVE_WORDS: readonly string[] = [
  'sharpen', 'sharpens', 'better', 'nice', 'nicer', 'looks right', 'looks good', 'feels right', 'fast', 'faster', 'quick', 'quickly',
  'smooth', 'smoother', 'clean', 'cleaner', 'intuitive', 'improved', 'polished', 'robust', 'reasonable', 'appropriate', 'properly',
];

export interface CriterionOptions {
  /** Words the project adds to the built-in list. */
  subjectiveWords?: string[];
  /** The named UI states of `ui.json`. */
  uiStates?: string[];
}

export interface CriterionVerdict {
  text: string;
  /** The form it takes; null when it takes none. */
  form: CriterionForm | null;
  subjective: string[];
  ok: boolean;
  /** Why it fails, in words the ticket's author can act on; empty when ok. */
  problem: string;
}

const UNITS = '(?:deg|degrees?|ms|milliseconds?|seconds?|s|min|px|%|percent|kb|mb|gb|kib|mib|mm|cm|m|km|hz|khz|dpi|rem|em|pt|fps|bytes?)';
const NUMBER_WITH_UNIT = new RegExp(`(?<![\\w.])\\d+(?:\\.\\d+)?\\s?${UNITS}(?![\\w])`, 'i');
const SOURCE = /\b(?:source|spike|thresholds?\s+(?:row|table)|adr[\s-]*\d+|per\s+(?:the\s+)?(?:adr|spec|standard|datasheet|reference)|cited|citation)\b|https?:\/\/|docs\/adr\//i;
const TEST = /\b(?:tested|unit test|test(?:s)? (?:in|at|named|called|asserts?|that|for|passes?|fails?)|named test|[\w./-]+\.(?:test|spec)\.\w+)\b|`[^`]*(?:test|spec)[^`]*`|\btest\b.*\b(?:passes|pass|fails|asserts)\b|\b(?:passes|pass|fails|asserts)\b.*\btest\b/i;
/** A citation of a spike's thresholds row: the row carries the value, unit and source. */
const THRESHOLD_ROW = /\bthresholds?\s+(?:table|row)s?\b.*\brow\b|\brow\b.*\bthresholds?\s+(?:table|row)s?\b|\bthresholds?\s+row\b/i;
const EXPECTED = /\b(?:exit(?:s|ed)?(?:\s+code)?|output|prints?|returns?|reports?|non-zero|zero|passes|fails|refuses|accepts|rejects)\b/i;
const BACKTICKED_COMMAND = /`[^`]*\s[^`]*`/;
const GATES = /\bgates?\b.*\b(?:green|pass(?:es)?)\b/i;
const UI_STATE = /\bui state\b|\bscreenshots?\b/i;

/** Text a command is said to print is quoted data, whatever words it holds. */
const QUOTED_OUTPUT = /(\b(?:prints?|outputs?|reports?)\b[^"'`]*?)(?:"[^"]*"|(?<![\w])'[^']*')/gi;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The subjective words a criterion uses, lower case. A word joined by a hyphen to another is part of a longer word. */
export function subjectiveWordsIn(text: string, extra: string[] = []): string[] {
  text = text.replace(QUOTED_OUTPUT, '$1');
  const found: string[] = [];
  for (const word of [...SUBJECTIVE_WORDS, ...extra]) {
    const w = word.trim().toLowerCase();
    if (w === '' || found.includes(w)) continue;
    if (new RegExp(`(?<![\\w-])${escapeRegex(w)}(?![\\w-])`, 'i').test(text)) found.push(w);
  }
  return found;
}

export function classifyCriterion(text: string, options: CriterionOptions = {}): CriterionVerdict {
  const subjective = subjectiveWordsIn(text, options.subjectiveWords);
  const fail = (problem: string, form: CriterionForm | null = null): CriterionVerdict => ({text, form, subjective, ok: false, problem});
  if (subjective.length > 0) {
    return fail(`uses subjective ${subjective.length === 1 ? 'word' : 'words'} ${subjective.map(w => `"${w}"`).join(', ')}; state a test, a command with its result, a sourced number or a UI state`);
  }
  const named = (options.uiStates ?? []).some(s => s.trim() !== '' && text.toLowerCase().includes(s.toLowerCase()));
  const sourced = SOURCE.test(text);
  const hasNumber = NUMBER_WITH_UNIT.test(text);
  let form: CriterionForm | null = null;
  if (named || (UI_STATE.test(text) && /["`']/.test(text))) form = 'ui';
  else if (TEST.test(text)) form = 'test';
  else if ((BACKTICKED_COMMAND.test(text) && EXPECTED.test(text)) || GATES.test(text)) form = 'command';
  else if ((hasNumber && sourced) || THRESHOLD_ROW.test(text)) form = 'number';
  if (form === null) {
    return fail(hasNumber ? 'gives a number with a unit but no source; cite a spike thresholds row, an ADR or a reference' : 'is not one of the four checkable forms: a named test, a command with its expected result, a number with a unit and a source, or a named UI state');
  }
  return {text, form, subjective, ok: true, problem: ''};
}

export interface TicketCheck {
  ok: boolean;
  criteria: CriterionVerdict[];
  /** A ticket with no criteria cannot be checked either. */
  problems: string[];
  /** What is worth fixing but does not refuse the ticket. */
  warnings: string[];
}

export function checkTicketCriteria(body: string, options: CriterionOptions = {}): TicketCheck {
  const criteria = parseCriteria(body).map(c => classifyCriterion(c.text, options));
  const problems = criteria.filter(c => !c.ok).map(c => `"${c.text}" ${c.problem}`);
  if (criteria.length === 0) problems.push('the ticket has no acceptance criteria (checkbox items under an Acceptance heading)');
  const guards = checkGuards(body);
  problems.push(...guards.problems, ...checkProbes(body));
  return {ok: problems.length === 0, criteria, problems, warnings: guards.warnings};
}
