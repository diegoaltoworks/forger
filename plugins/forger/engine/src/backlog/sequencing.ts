/**
 * Whether two open tickets that touch the same ground say which goes first.
 * Pure: the caller supplies the bodies and the native blockers.
 */
import {parseBlockedBy} from './blocked-by';
import {parseFootprint, pathsOverlap} from './schedule';

export interface OpenTicket {
  number: number;
  body: string;
  /** Numbers of the native blocked-by issues. */
  native: number[];
}

const HEADING = /^#{1,6}\s+sequencing\s*:?\s*$/i;
const ANY_HEADING = /^#{1,6}\s/;

/** The issue numbers named under the `Sequencing` heading. */
export function parseSequencing(body: string): number[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => HEADING.test(l.trim()));
  if (start === -1) return [];
  const found: number[] = [];
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADING.test(line.trim())) break;
    for (const m of line.matchAll(/#(\d+)\b/g)) found.push(Number(m[1]));
  }
  return found;
}

function ordered(from: OpenTicket, to: OpenTicket): boolean {
  return from.native.includes(to.number) || parseBlockedBy(from.body).includes(to.number) || parseSequencing(from.body).includes(to.number);
}

/** What the two footprints share: paths (either contains the other) and module names. */
export function sharedGround(a: string, b: string): string[] {
  const fa = parseFootprint(a);
  const fb = parseFootprint(b);
  if (!fa || !fb) return [];
  const shared: string[] = [];
  for (const p of fa.paths) {
    for (const q of fb.paths) if (pathsOverlap([p], [q]) && !shared.includes(p.length >= q.length ? p : q)) shared.push(p.length >= q.length ? p : q);
  }
  for (const m of fa.modules) if (fb.modules.includes(m)) shared.push(`${m} module`);
  return shared;
}

/** One problem per other ticket that shares ground with `subject` and is ordered against it neither way. */
export function checkSequencing(subject: OpenTicket, others: OpenTicket[]): string[] {
  const problems: string[] = [];
  for (const other of others) {
    if (other.number === subject.number) continue;
    const shared = sharedGround(subject.body, other.body);
    if (shared.length === 0) continue;
    if (ordered(subject, other) || ordered(other, subject)) continue;
    problems.push(
      `#${subject.number} and #${other.number} share ${shared.map(s => `\`${s}\``).join(', ')} with no order between them; link one as blocked by the other, or add a "## Sequencing" line naming the other ticket and which one re-measures`
    );
  }
  return problems;
}
