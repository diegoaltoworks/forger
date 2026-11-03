/**
 * The dependencies a ticket's text declares. A worker or an author writes
 * `## Blocked by` in prose; the engine reads the native blocked-by. These pure
 * functions read the prose and compare the two, so a dependency written only
 * in the body is still seen, and the disagreement is reported.
 */

const HEADING = /^#{1,6}\s+blocked\s+by\s*:?\s*$/i;
const ANY_HEADING = /^#{1,6}\s/;

/** The issue numbers named under the `Blocked by` heading, in order, once each. */
export function parseBlockedBy(body: string | undefined): number[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => HEADING.test(l.trim()));
  if (start === -1) return [];
  const found: number[] = [];
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADING.test(line.trim())) break;
    for (const m of line.matchAll(/#(\d+)\b/g)) {
      const n = Number(m[1]);
      if (!found.includes(n)) found.push(n);
    }
  }
  return found;
}

export interface DependencyView {
  number: number;
  /** Numbers under the body's `Blocked by` heading. */
  declared: number[];
  /** Numbers of the native blocked-by issues. */
  native: number[];
}

/**
 * Where the body and the native links disagree, as one line each naming the
 * issues. `unfinished` says whether a blocker still stands; a finished one is
 * no longer worth reconciling.
 */
export function dependencyAnomalies(view: DependencyView, unfinished: (issue: number) => boolean): string[] {
  const out: string[] = [];
  for (const n of view.declared) {
    if (!view.native.includes(n) && unfinished(n)) {
      out.push(`#${view.number} lists #${n} under Blocked by but it is not linked as blocked-by`);
    }
  }
  for (const n of view.native) {
    if (!view.declared.includes(n) && unfinished(n)) {
      out.push(`#${view.number} is linked as blocked by #${n} but its Blocked by section does not list it`);
    }
  }
  return out;
}

/** The blockers still to link: declared, not already native, not the issue itself. */
export function blockersToLink(issue: number, declared: number[], native: number[]): number[] {
  return declared.filter(n => n !== issue && !native.includes(n));
}
