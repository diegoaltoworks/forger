/** The release plan: which version comes next, from the tickets that merged. Pure. */

export type Bump = 'patch' | 'minor' | 'major';

export const BUMPS: readonly Bump[] = ['patch', 'minor', 'major'];

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** One merged ticket: its pull request, the ticket it closed (null when it closed none) and that ticket's labels. */
export interface Change {
  pr: number;
  ticket: number | null;
  title: string;
  labels: string[];
}

export interface ReleasePlan {
  current: string;
  bump: Bump;
  next: string;
  changes: Change[];
}

export type PlanResult = {kind: 'plan'; plan: ReleasePlan} | {kind: 'nothing'; current: string};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(text: string): Version | null {
  const m = SEMVER.exec(text.trim());
  return m ? {major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3])} : null;
}

export function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export function isBump(text: string): text is Bump {
  return (BUMPS as readonly string[]).includes(text);
}

/** minor when a change is an enhancement, else patch; a breaking change is major, or minor while the version is below 1.0.0. */
export function bumpOf(current: Version, changes: Change[]): Bump {
  if (changes.some(c => c.labels.includes('breaking'))) return current.major < 1 ? 'minor' : 'major';
  return changes.some(c => c.labels.includes('enhancement')) ? 'minor' : 'patch';
}

export function applyBump(v: Version, bump: Bump): Version {
  if (bump === 'major') return {major: v.major + 1, minor: 0, patch: 0};
  if (bump === 'minor') return {major: v.major, minor: v.minor + 1, patch: 0};
  return {major: v.major, minor: v.minor, patch: v.patch + 1};
}

/** Throws on a version that is not x.y.z. With no change there is nothing to release. */
export function planRelease(currentText: string, changes: Change[], override?: Bump): PlanResult {
  const current = parseVersion(currentText);
  if (!current) throw new Error(`the current version "${currentText}" is not x.y.z`);
  if (changes.length === 0) return {kind: 'nothing', current: currentText};
  const bump = override ?? bumpOf(current, changes);
  return {kind: 'plan', plan: {current: currentText, bump, next: formatVersion(applyBump(current, bump)), changes}};
}

export function changeLine(c: Change): string {
  return `${c.ticket === null ? 'no ticket' : `#${c.ticket}`} ${c.title} (PR #${c.pr})`;
}

export function formatPlan(plan: ReleasePlan): string {
  return [`current ${plan.current}`, `bump ${plan.bump}`, `next ${plan.next}`, ...plan.changes.map(c => `- ${changeLine(c)}`)].join('\n');
}

/** The version the files hold, or the files that disagree. */
export function agreedVersion(held: {path: string; version: string}[]): {ok: true; version: string} | {ok: false; problem: string} {
  const versions = new Set(held.map(h => h.version));
  if (versions.size === 1) return {ok: true, version: held[0].version};
  return {ok: false, problem: `the version files disagree: ${held.map(h => `${h.path} holds ${h.version}`).join(', ')}`};
}
