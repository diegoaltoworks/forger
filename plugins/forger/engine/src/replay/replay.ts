/**
 * Turns a stored request set into the issues to file. Pure: text in, plan out.
 * The order of the set is the order of filing, so a request may only wait on
 * one that comes before it.
 */

export interface Request {
  id: string;
  title: string;
  body: string;
  /** Ids of earlier requests this one waits on. */
  blockedBy: string[];
}

export interface IssuePlan extends Request {
  /** Position in the set, from 1. */
  position: number;
}

export type Parsed = {ok: true; requests: Request[]} | {ok: false; problems: string[]};

function str(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** Reads the requests file: `{"requests": [{id, title, body, blockedBy?}]}`. */
export function parseRequests(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {ok: false, problems: [`not valid JSON: ${(e as Error).message}`]};
  }
  const list = (raw as {requests?: unknown} | null)?.requests;
  if (!Array.isArray(list) || list.length === 0) return {ok: false, problems: ['"requests" must be a non-empty array']};

  const problems: string[] = [];
  const requests: Request[] = [];
  const seen = new Set<string>();
  list.forEach((item: Record<string, unknown> | null, i) => {
    const at = `request ${i + 1}`;
    if (!item || typeof item !== 'object') return void problems.push(`${at}: must be an object`);
    if (!str(item.id)) problems.push(`${at}: id is required`);
    if (!str(item.title)) problems.push(`${at}: title is required`);
    if (item.body !== undefined && typeof item.body !== 'string') problems.push(`${at}: body must be text`);
    const blockedBy = item.blockedBy ?? [];
    if (!Array.isArray(blockedBy) || !blockedBy.every(str)) {
      problems.push(`${at}: blockedBy must be a list of ids`);
      return;
    }
    if (!str(item.id) || !str(item.title)) return;
    if (seen.has(item.id)) problems.push(`${at}: id "${item.id}" is used twice`);
    for (const b of blockedBy as string[]) {
      if (!seen.has(b)) problems.push(`${at}: blockedBy "${b}" is not an earlier request`);
    }
    seen.add(item.id);
    requests.push({id: item.id, title: item.title, body: (item.body as string | undefined) ?? '', blockedBy: blockedBy as string[]});
  });
  return problems.length ? {ok: false, problems} : {ok: true, requests};
}

/** The issues to file, in filing order. */
export function planReplay(requests: Request[]): IssuePlan[] {
  return requests.map((r, i) => ({...r, position: i + 1}));
}

/** The body to file once the numbers of the blockers are known. */
export function issueBody(plan: IssuePlan, numbers: Record<string, number>): string {
  const blockers = plan.blockedBy.map(id => `#${numbers[id]}`);
  const parts = [plan.body.trim()];
  if (blockers.length) parts.push(`## Blocked by\n${blockers.map(b => `- ${b}`).join('\n')}`);
  return parts.filter(Boolean).join('\n\n');
}
