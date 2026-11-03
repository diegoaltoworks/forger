import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {AgentRunner, CommandRunner} from '../ports';
import {evidenceResolves, verdictFile, verifyPr, type VerifyOptions} from './verify';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'forger-verify-test-')));
  dirs.push(d);
  return d;
}

const PR_BODY = 'SECRET-PR-BODY-CLAIM';
const view = JSON.stringify({number: 5, state: 'OPEN', headRefOid: 'deadbeef', headRefName: 'feat/issue-9', body: PR_BODY, statusCheckRollup: []});
const issueBody = '## Acceptance\n- [ ] first\n- [ ] second\n';

function fixture() {
  const verdicts = join(tmp(), 'verdicts');
  const calls: string[] = [];
  const run: CommandRunner = cmd => {
    calls.push(cmd);
    if (cmd.startsWith('gh pr view')) return view;
    if (cmd.startsWith('gh issue view')) return issueBody;
    if (cmd.startsWith('gh pr diff')) return '+the diff';
    return '';
  };
  const prompts: string[] = [];
  const cwds: string[] = [];
  const agentSaying = (output: string): AgentRunner => ({
    async run(o) {
      prompts.push(o.prompt);
      cwds.push(o.cwd);
      return {exitCode: 0, signal: null, output, timedOut: false};
    },
  });
  const opts: VerifyOptions = {
    pr: 5,
    trackerKind: 'github',
    backlogFile: '',
    verdictsDir: verdicts,
    tier: {model: 'deep', budget: 1},
    model: 'opus',
    verifierCommand: 'forger:verify',
    timeoutMinutes: 1,
    killGraceSeconds: 1,
    sessionId: 's',
    now: () => new Date('2026-01-01T00:00:00Z'),
  };
  return {run, calls, prompts, cwds, agentSaying, opts, verdicts};
}

describe('verifyPr', () => {
  test('valid output is recorded against the head commit; the prompt holds the criteria and the diff, not the PR body', async () => {
    const f = fixture();
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}, {criterion: 'c2', verdict: 'cannot_tell', evidence: []}]});
    const record = await verifyPr(f.run, f.agentSaying(out), f.opts);
    expect(record.head).toBe('deadbeef');
    expect(record.ticket).toBe('issue-9');
    expect(record.decision).toBe('unclear');
    expect(JSON.parse(readFileSync(verdictFile(f.verdicts, 5, 'deadbeef'), 'utf-8'))).toEqual(record);
    expect(f.prompts[0]).toContain('first');
    expect(f.prompts[0]).toContain('+the diff');
    expect(f.prompts[0]).not.toContain(PR_BODY);
  });

  test('invalid output is recorded cannot_tell for every criterion', async () => {
    const f = fixture();
    const record = await verifyPr(f.run, f.agentSaying('all good!'), f.opts);
    expect(record.entries.map(e => e.verdict)).toEqual(['cannot_tell', 'cannot_tell']);
    expect(existsSync(verdictFile(f.verdicts, 5, 'deadbeef'))).toBe(true);
  });

  test('runs in a detached checkout of the head, made read-only, and removes it', async () => {
    const f = fixture();
    await verifyPr(f.run, f.agentSaying('x'), f.opts);
    const add = f.calls.findIndex(c => c.startsWith('git worktree add --detach'));
    expect(add).toBeGreaterThan(-1);
    expect(f.calls[add]).toContain('deadbeef');
    expect(f.calls[add]).toContain(f.cwds[0]);
    expect(f.calls.some(c => c.startsWith('chmod -R a-w'))).toBe(true);
    expect(f.calls.some(c => c.startsWith('git worktree remove --force'))).toBe(true);
  });

  describe('criteria bound to a satisfied requirement', () => {
    const bound = '## Acceptance\n- [ ] refuses a failed check [spec:R-1]\n- [ ] names the head\n';
    const report = {requirements: [{id: 'R-1', modality: 'MUST' as const, state: 'satisfied' as const}]};

    test('is met with the spec check as evidence and absent from the verifier input', async () => {
      const f = fixture();
      const run: CommandRunner = cmd => (cmd.startsWith('gh issue view') ? bound : f.run(cmd));
      const out = JSON.stringify({verdict: [{criterion: 'c2', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]});
      const record = await verifyPr(run, f.agentSaying(out), {...f.opts, specReport: () => report});
      expect(record.entries).toEqual([
        {criterion: 'c1', verdict: 'met', evidence: [{kind: 'check', ref: 'spec:R-1'}]},
        {criterion: 'c2', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]},
      ]);
      expect(record.decision).toBe('pass');
      expect(f.prompts[0]).toContain('c2: names the head');
      expect(f.prompts[0]).not.toContain('refuses a failed check');
    });

    test('when every criterion is bound and satisfied the verifier is not run', async () => {
      const f = fixture();
      const run: CommandRunner = cmd => (cmd.startsWith('gh issue view') ? '## Acceptance\n- [ ] one [spec:R-1]\n' : f.run(cmd));
      const record = await verifyPr(run, f.agentSaying('never read'), {...f.opts, specReport: () => report});
      expect(f.prompts).toEqual([]);
      expect(record.decision).toBe('pass');
      expect(existsSync(verdictFile(f.verdicts, 5, 'deadbeef'))).toBe(true);
    });

    test('an unreadable spec leaves every criterion with the verifier', async () => {
      const f = fixture();
      const run: CommandRunner = cmd => (cmd.startsWith('gh issue view') ? bound : f.run(cmd));
      await verifyPr(run, f.agentSaying('x'), {...f.opts, specReport: () => { throw new Error('boom'); }});
      expect(f.prompts[0]).toContain('c1: refuses a failed check');
    });

    test('a verifier cannot claim the spec check as its evidence', () => {
      expect(evidenceResolves(() => '', '/nowhere', {kind: 'check', ref: 'spec:R-1'})).toBe(false);
    });
  });

  test('refuses a branch that names no ticket', async () => {
    const f = fixture();
    const run: CommandRunner = c => (c.startsWith('gh pr view') ? view.replace('feat/issue-9', 'wip') : f.run(c));
    await expect(verifyPr(run, f.agentSaying('x'), f.opts)).rejects.toThrow('cannot tell the ticket');
  });

  test('refuses a ticket with no criteria', async () => {
    const f = fixture();
    const run: CommandRunner = c => (c.startsWith('gh issue view') ? 'no boxes' : f.run(c));
    await expect(verifyPr(run, f.agentSaying('x'), f.opts)).rejects.toThrow('no acceptance criteria');
  });

  test('reads criteria from a file backlog off GitHub', async () => {
    const f = fixture();
    const root = tmp();
    const file = join(root, 'backlog.json');
    writeFileSync(file, JSON.stringify({features: {'issue-9': {acceptance_criteria: ['only one']}}}));
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'cannot_tell', evidence: []}]});
    const record = await verifyPr(f.run, f.agentSaying(out), {...f.opts, trackerKind: 'local', backlogFile: file});
    expect(record.entries.map(e => e.criterion)).toEqual(['c1']);
  });
});

describe('evidenceResolves', () => {
  const run: CommandRunner = c => (c.includes("'a real test'") ? 'src/a.test.ts\n' : '');
  test('files, lines, tests and commands', () => {
    const root = tmp();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\n');
    const ok = (kind: 'file' | 'test' | 'command', ref: string) => evidenceResolves(run, root, {kind, ref});
    expect(ok('file', 'src/a.ts')).toBe(true);
    expect(ok('file', 'src/a.ts:2')).toBe(true);
    expect(ok('file', 'src/a.ts:99')).toBe(false);
    expect(ok('file', 'src/missing.ts:1')).toBe(false);
    expect(ok('file', '../outside.ts')).toBe(false);
    expect(ok('file', '/etc/passwd')).toBe(false);
    expect(ok('test', 'a real test')).toBe(true);
    expect(ok('test', 'no such test')).toBe(false);
    expect(ok('command', 'bun test')).toBe(true);
    expect(ok('command', '  ')).toBe(false);
  });
});
