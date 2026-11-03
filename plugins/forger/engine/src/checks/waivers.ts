/**
 * Waivers: the only way to switch an opinion off, and always in the open. A
 * waiver names the opinion, the paths it covers, why, and who approved it.
 * Parsing is strict at the boundary: an entry without a reason or approver is an
 * error, never a waiver. Matching is pure.
 */

export const WAIVERS_PATH = '.forger/waivers.json';

export interface Waiver {
  opinion: string;
  /** Glob over repo-relative paths: `*` stays in a segment, `**` crosses them. */
  path: string;
  reason: string;
  approved_by: string;
}

export class WaiverError extends Error {
  constructor(where: string, problem: string) {
    super(`${WAIVERS_PATH}: ${where} ${problem}`);
  }
}

function field(entry: Record<string, unknown>, name: keyof Waiver, where: string): string {
  const v = entry[name];
  if (typeof v !== 'string' || v.trim() === '') throw new WaiverError(where, `needs a non-empty "${name}"`);
  return v.trim();
}

export function parseWaivers(text: string): Waiver[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WaiverError('(file)', 'is not valid JSON');
  }
  const list = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).waivers : undefined;
  if (!Array.isArray(list)) throw new WaiverError('(root)', 'must be an object with a "waivers" list');
  return list.map((e, i) => {
    const where = `waivers[${i}]`;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new WaiverError(where, 'must be an object');
    const entry = e as Record<string, unknown>;
    return {
      opinion: field(entry, 'opinion', where),
      path: field(entry, 'path', where),
      reason: field(entry, 'reason', where),
      approved_by: field(entry, 'approved_by', where),
    };
  });
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  opinion: string;
  detail: string;
}

export interface WaivedFinding extends Finding {
  waiver: Waiver;
}

export interface WaiverOutcome {
  violations: Finding[];
  waived: WaivedFinding[];
}

/** Splits findings into open violations and waived ones; the first matching waiver wins. */
export function applyWaivers(findings: Finding[], waivers: Waiver[]): WaiverOutcome {
  const matchers = waivers.map(w => ({w, re: globToRegExp(w.path)}));
  const violations: Finding[] = [];
  const waived: WaivedFinding[] = [];
  for (const f of findings) {
    const hit = matchers.find(m => m.w.opinion === f.opinion && m.re.test(f.file));
    if (hit) waived.push({...f, waiver: hit.w});
    else violations.push(f);
  }
  return {violations, waived};
}

/** Waivers that matched no finding of any check: they should be deleted. */
export function staleWaivers(findings: Finding[], waivers: Waiver[]): Waiver[] {
  return waivers.filter(w => {
    const re = globToRegExp(w.path);
    return !findings.some(f => f.opinion === w.opinion && re.test(f.file));
  });
}
