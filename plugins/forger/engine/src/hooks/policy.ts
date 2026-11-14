/**
 * `.forger/hooks.json`: which boundaries the worker's hook enforces. The four
 * default rules ship on; a project may add deny rules of its own. Dropping a
 * default is allowed by the parser, so the hook honours the file as written,
 * and `check hooks` reports the drop until a waiver records who approved it.
 * Parsing is strict at the boundary. Pure.
 */

export const HOOKS_POLICY_PATH = '.forger/hooks.json';

export const DEFAULT_RULES = ['merge', 'push-base', 'status-write', 'state-edit', 'leave-worktree'] as const;

export type DefaultRule = (typeof DEFAULT_RULES)[number];

/** A project's own refusal: a regular expression over each simple command's words, joined by spaces. */
export interface DenyRule {
  id: string;
  pattern: string;
  message: string;
}

export interface HookPolicy {
  rules: DefaultRule[];
  deny: DenyRule[];
}

export const DEFAULT_POLICY: HookPolicy = {rules: [...DEFAULT_RULES], deny: []};

export class HookPolicyError extends Error {
  constructor(problem: string) {
    super(`${HOOKS_POLICY_PATH}: ${problem}`);
  }
}

function text(entry: Record<string, unknown>, name: keyof DenyRule, where: string): string {
  const v = entry[name];
  if (typeof v !== 'string' || v.trim() === '') throw new HookPolicyError(`${where} needs a non-empty "${name}"`);
  return v.trim();
}

export function parseHookPolicy(source: string): HookPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new HookPolicyError('is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HookPolicyError('must be an object');
  const obj = raw as Record<string, unknown>;
  const rules = obj.rules ?? [...DEFAULT_RULES];
  if (!Array.isArray(rules)) throw new HookPolicyError('"rules" must be a list');
  for (const r of rules) {
    if (!(DEFAULT_RULES as readonly unknown[]).includes(r)) throw new HookPolicyError(`unknown rule ${JSON.stringify(r)}; the rules are ${DEFAULT_RULES.join(', ')}`);
  }
  const deny = obj.deny ?? [];
  if (!Array.isArray(deny)) throw new HookPolicyError('"deny" must be a list');
  const ids = new Set<string>(DEFAULT_RULES);
  const parsed = deny.map((e, i): DenyRule => {
    const where = `deny[${i}]`;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new HookPolicyError(`${where} must be an object`);
    const entry = e as Record<string, unknown>;
    const rule = {id: text(entry, 'id', where), pattern: text(entry, 'pattern', where), message: text(entry, 'message', where)};
    if (ids.has(rule.id)) throw new HookPolicyError(`${where} reuses the rule id ${rule.id}`);
    ids.add(rule.id);
    try {
      new RegExp(rule.pattern);
    } catch {
      throw new HookPolicyError(`${where} has a pattern that is not a regular expression`);
    }
    return rule;
  });
  return {rules: [...new Set(rules as DefaultRule[])], deny: parsed};
}

/** The default rules a policy leaves out. */
export function droppedRules(policy: HookPolicy): DefaultRule[] {
  return DEFAULT_RULES.filter(r => !policy.rules.includes(r));
}

export function renderHookPolicy(policy: HookPolicy = DEFAULT_POLICY): string {
  return JSON.stringify(policy, null, 2) + '\n';
}
