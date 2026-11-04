/**
 * Whether the evidence a verifier cites is real, judged against what the engine
 * itself recorded in the verifier's copy and not against the verifier's word.
 * Pure: the files and the command log are handed in as a `CopyRecord`.
 */

import {isAbsolute, normalize} from 'path';

import type {Evidence} from './verdict';

/** One command run in the verifier's copy through `run-logged`, with its exit code and output. */
export interface CommandRun {
  command: string;
  exit: number;
  output: string;
}

export interface CopyRecord {
  /** The number of lines of a file in the copy, or null when it does not exist. */
  fileLines(path: string): number | null;
  /** The commands the engine saw run in the copy. */
  commands: CommandRun[];
}

export const SCREENSHOTS_DIR = 'docs/screenshots/';

const TEST_LINE = /^\s*(?:\((pass|fail)\)|(ok|not ok)\b(?:\s+\d+\s+-)?)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/;

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
      const hits = testResults(record.commands).filter(t => t.name.includes(ref));
      return hits.length > 0 && hits.every(t => t.passed);
    }
    case 'command':
      return record.commands.some(c => squash(c.command) === squash(ref) && c.exit === 0);
    // Only the engine's own spec check is evidence of kind check; a verifier cannot claim it.
    default:
      return false;
  }
}

/** The citations of an entry that do not check out, as "kind ref". */
export function failedCitations(evidence: Evidence[], holds: (e: Evidence) => boolean): string[] {
  return evidence.filter(e => !holds(e)).map(e => `${e.kind} ${(e.ref ?? '').trim()}`.trim());
}
