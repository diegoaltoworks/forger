/**
 * Whether the evidence a verifier cites is real, judged against what the engine
 * itself recorded in the verifier's copy and not against the verifier's word.
 * Pure: the files and the command log are handed in as a `CopyRecord`.
 */

import {isAbsolute, join, normalize} from 'path';

import {EVIDENCE_DEMOTION, type Evidence} from './verdict';

/** One command run in the verifier's copy through `run-logged`, with its exit code and output. */
export interface CommandRun {
  command: string;
  exit: number;
  output: string;
  /** The folder it ran in, relative to the root of the copy; a log written without it means the root. */
  dir?: string;
  /** Set when the output was cut to the limit; the test result lines are kept whole all the same. */
  truncated?: boolean;
}

export interface CopyRecord {
  /** The number of lines of a file in the copy, or null when it does not exist. */
  fileLines(path: string): number | null;
  /** The commands the engine saw run in the copy. */
  commands: CommandRun[];
}

export const SCREENSHOTS_DIR = 'docs/screenshots/';

export const TEST_LINE = /^\s*(?:\((pass|fail)\)|(ok|not ok)\b(?:\s+\d+\s+-)?)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/;

/** Each test the recorded runs reported, with whether it passed. Reads bun's `(pass) name` and TAP's `ok N - name`. */
export function testResults(commands: CommandRun[]): {name: string; passed: boolean}[] {
  const out: {name: string; passed: boolean}[] = [];
  for (const c of commands) {
    for (const line of c.output.split(/\r?\n/)) {
      const m = TEST_LINE.exec(line);
      if (m) out.push({name: m[3], passed: m[1] === 'pass' || m[2] === 'ok'});
    }
  }
  return out;
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

const segments = (s: string) => s.split(' > ').map(squash).filter(Boolean);

/**
 * Whether a reported test name is the one a reference cites: the reference as
 * written, or its ` > ` parts in order with the last part the test's own name.
 * Test tools join the describe names and the test name with ` > `, and a
 * verifier may leave out an enclosing describe.
 */
export function testNameMatches(reported: string, ref: string): boolean {
  if (reported.includes(ref)) return true;
  const want = segments(ref);
  const have = segments(reported);
  if (want.length === 0 || have.length === 0 || want[want.length - 1] !== have[have.length - 1]) return false;
  let i = 0;
  for (const part of have.slice(0, -1)) if (i < want.length - 1 && part === want[i]) i++;
  return i === want.length - 1;
}

/** Splits a shell command line into words, honouring quotes and backslashes; operators stay words of their own when spaced. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let cur: string | null = null;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur = cur ?? '';
    } else if (ch === '\\' && i + 1 < line.length) {
      cur = (cur ?? '') + line[++i];
    } else if (/\s/.test(ch)) {
      if (cur !== null) words.push(cur);
      cur = null;
    } else {
      cur = (cur ?? '') + ch;
    }
  }
  if (cur !== null) words.push(cur);
  return words;
}

const folderOf = (p: string): string => normalize(p || '.').replace(/\/+$/, '') || '.';

/**
 * A command and the folder it ran in, in one form: a `sh -c` or `bash -c`
 * wrapper removed, a leading `cd <folder> &&` counted into the folder, and the
 * rest split into shell words so the style of quoting does not matter.
 */
export function normalizeCommand(command: string, dir = '.'): {dir: string; words: string[]} {
  let words = shellWords(command);
  let folder = folderOf(dir);
  for (let guard = 0; guard < 8; guard++) {
    if ((words[0] === 'sh' || words[0] === 'bash') && words[1] === '-c' && words.length === 3) {
      words = shellWords(words[2]);
    } else if (words[0] === 'cd' && words.length > 3 && words[2] === '&&') {
      folder = folderOf(join(folder, words[1]));
      words = words.slice(3);
    } else break;
  }
  return {dir: folder, words};
}

/** Whether a cited command is a logged one: the same folder and the same words. */
export function sameCommand(cited: string, run: CommandRun, citedDir = '.'): boolean {
  const a = normalizeCommand(cited, citedDir);
  const b = normalizeCommand(run.command, run.dir ?? '.');
  return a.dir === b.dir && a.words.length > 0 && a.words.length === b.words.length && a.words.every((w, i) => w === b.words[i]);
}

function insideCopy(path: string): string | null {
  const rel = normalize(path);
  return isAbsolute(rel) || rel.startsWith('..') ? null : rel;
}

/** Whether one piece of evidence checks out in the recorded copy. */
export function evidenceHolds(record: CopyRecord, e: Evidence): boolean {
  const ref = (e.ref ?? '').trim();
  if (ref === '') return false;
  switch (e.kind) {
    case 'file': {
      const m = /^(.*?)(?::(\d+))?$/.exec(ref);
      const path = insideCopy(m?.[1] ?? ref);
      const lines = path === null ? null : record.fileLines(path);
      if (lines === null) return false;
      if (!m?.[2]) return true;
      const line = parseInt(m[2], 10);
      return line >= 1 && line <= lines;
    }
    case 'screenshot': {
      const path = insideCopy(ref);
      return path !== null && path.startsWith(SCREENSHOTS_DIR) && record.fileLines(path) !== null;
    }
    case 'test': {
      const hits = testResults(record.commands).filter(t => testNameMatches(t.name, ref));
      return hits.length > 0 && hits.every(t => t.passed);
    }
    case 'command':
      return record.commands.some(c => c.exit === 0 && sameCommand(ref, c));
    // Only the engine's own spec check is evidence of kind check; a verifier cannot claim it.
    default:
      return false;
  }
}

/** The citations of an entry that do not check out, as "kind ref". */
export function failedCitations(evidence: Evidence[], holds: (e: Evidence) => boolean): string[] {
  return evidence.filter(e => !holds(e)).map(e => `${e.kind} ${(e.ref ?? '').trim()}`.trim());
}

export const CUT_NOTE = ' (a command output in the log was cut to its limit; run the cited test file by itself)';

/** Entries demoted over a test citation say so when a record in the log was cut, since the result may be what was dropped. */
export function noteCutOutput<E extends {demoted?: string; evidence?: Evidence[]}>(entries: E[], commands: CommandRun[]): E[] {
  if (!commands.some(c => c.truncated)) return entries;
  return entries.map(e => (e.demoted?.startsWith(EVIDENCE_DEMOTION) && (e.evidence ?? []).some(x => x.kind === 'test') ? {...e, demoted: e.demoted + CUT_NOTE} : e));
}
