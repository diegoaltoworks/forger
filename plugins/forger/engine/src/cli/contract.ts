import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {parseCriteria, appendEvent, checkVerdict, terminalEvent, validatePrBody, type Evidence, type VerdictEntry} from '../loop';
import {attemptReason, CONTRACT_FOR_SLOT, contractForSlot, CONTRACT_NAMES, NO_FACTS, onContractFailure, TEST_FILE, validateContract, type ContractFacts, type ContractName} from '../pipeline';
import type {Command, CommandContext} from './command';

function lines(out: string): string[] {
  return out.split('\n').map(l => l.trim()).filter(Boolean);
}

function criteriaFor(ctx: CommandContext, issue: number | null): ContractFacts['criteria'] {
  if (issue === null) return [];
  const body = (JSON.parse(ctx.run()(`gh issue view ${issue} --json body`)) as {body?: string}).body ?? '';
  return parseCriteria(body);
}

function factsFor(ctx: CommandContext, issue: number | null): ContractFacts {
  const root = ctx.projectRoot;
  const diff = lines(ctx.run()(`git diff --name-only origin/${ctx.config.base_branch}...HEAD`));
  return {
    ...NO_FACTS,
    diffPaths: diff,
    criteria: criteriaFor(ctx, issue),
    gateCommand: ctx.config.gates || null,
    fileExists: p => existsSync(join(root, p)),
    fileContains: (p, term) => existsSync(join(root, p)) && readFileSync(join(root, p), 'utf-8').includes(term),
    isTestFile: p => TEST_FILE.test(p),
  };
}

function parseJson(raw: string): {value: unknown} | {problem: string} {
  try {
    return {value: JSON.parse(raw)};
  } catch (e) {
    return {problem: `the result is not valid JSON: ${(e as Error).message}`};
  }
}

/** The three contracts the loop already validates; the rest are pure functions of `pipeline`. */
function validateLoopContract(contract: ContractName, raw: string, ctx: CommandContext, issue: number | null): string[] | null {
  if (contract === 'pr_body') {
    return validatePrBody(raw, {issue, sections: (ctx.values.section as string[] | undefined) ?? []}).problems;
  }
  if (contract !== 'verdict' && contract !== 'rebase_clean') return null;
  const parsed = parseJson(raw);
  if ('problem' in parsed) return [parsed.problem];
  if (contract === 'rebase_clean') {
    const status = (parsed.value as {status?: unknown} | null)?.status;
    return status === 'clean' ? [] : [`the rebase is not clean (status ${JSON.stringify(status)})`];
  }
  const v = parsed.value as VerdictEntry[] | {entries?: VerdictEntry[]};
  const list = Array.isArray(v) ? v : v?.entries;
  if (!Array.isArray(list)) return ['a verdict is a list of {criterion, verdict, evidence}'];
  const resolves = (e: Evidence): boolean => (e.kind === 'file' ? existsSync(join(ctx.projectRoot, e.ref.split(':')[0] ?? '')) : true);
  return checkVerdict(criteriaFor(ctx, issue), list, resolves).problems;
}

export const contract: Command = {
  name: 'contract',
  needs: 'config',
  flags: ['json', 'slot', 'file', 'issue', 'section', 'ticket', 'attempt'],
  help: `  contract --slot SLOT --file PATH [--issue N] [--ticket ID --attempt N] [--section TITLE ...] [--json]
                   Check the result a slot's skill wrote against the slot's output contract
                   (${CONTRACT_NAMES.join(', ')}); prints {ok, problems} and, when not ok, the
                   next step (retry with the problems, the built-in step, then a decline as unclear);
                   with --ticket it records the attempt as an event; exit 1 unless ok`,
  run(ctx) {
    const {values, config, projectRoot} = ctx;
    const slot = values.slot as string | undefined;
    const file = values.file as string | undefined;
    const fail = (message: string): void => {
      console.error(`contract: ${message}`);
      process.exitCode = 1;
    };
    if (!slot || !file) return fail('--slot and --file are required');
    const name = contractForSlot(slot) ?? (CONTRACT_NAMES.find(c => c === slot) as ContractName | undefined);
    if (!name) return fail(`no contract for slot "${slot}"; slots with one: ${Object.keys(CONTRACT_FOR_SLOT).join(', ')}`);
    const issueArg = values.issue as string | undefined;
    const issue = issueArg === undefined ? null : Number(issueArg);
    if (issue !== null && !Number.isInteger(issue)) return fail(`--issue must be an issue number, got "${issueArg}"`);
    const attempt = Number((values.attempt as string | undefined) ?? '1');
    if (!Number.isInteger(attempt) || attempt < 1) return fail(`--attempt must be 1 or more, got "${values.attempt}"`);
    if (!existsSync(file)) return fail(`${file} does not exist: the skill wrote no result`);

    let problems: string[];
    try {
      const raw = readFileSync(file, 'utf-8');
      const viaLoop = validateLoopContract(name, raw, ctx, issue);
      if (viaLoop !== null) problems = viaLoop;
      else {
        const parsed = parseJson(raw);
        problems = 'problem' in parsed ? [parsed.problem] : validateContract(name, parsed.value, factsFor(ctx, issue)).problems;
      }
    } catch (e) {
      return fail((e as Error).message);
    }
    const ok = problems.length === 0;
    const next = ok ? undefined : onContractFailure(attempt, slot);
    const ticket = values.ticket as string | undefined;
    if (ticket) {
      try {
        appendEvent(join(projectRoot, config.paths.events), terminalEvent('contract_attempt', 0, ticket, attemptReason(slot, attempt, problems)));
      } catch (e) {
        console.error(`contract: the attempt was not recorded: ${(e as Error).message}`);
      }
    }
    if (!ok) process.exitCode = 1;
    const result = {ok, problems, ...(next ? {next} : {})};
    console.log(values.json ? JSON.stringify(result) : ok ? `${slot}: ${name} ok` : [`${slot}: ${name} failed`, ...problems.map(p => `  ${p}`), `next: ${next?.action}`].join('\n'));
  },
};
