import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {AgentRunner, CapturingRunner, CommandRunner} from '../ports';
import {chooseSetup, commandLogFile, installStep, LOCKFILE_INSTALLS, verdictFile, verifyPr, VerifyInfraError, type VerifyOptions} from './verify';

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
  const root = tmp();
  const verdicts = join(root, 'verdicts');
  const scratch = join(root, '.forger', 'tmp');
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
      writeFileSync(`${o.cwd}.commands.jsonl`, JSON.stringify({command: 'bun test', exit: 0, output: '(pass) a real test\n'}) + '\n');
      return {exitCode: 0, signal: null, output, timedOut: false};
    },
  });
  const opts: VerifyOptions = {
    pr: 5,
    trackerKind: 'github',
    backlogFile: '',
    verdictsDir: verdicts,
    tmpDir: scratch,
    tier: {model: 'deep', budget: 1},
    setup: null,
    model: 'opus',
    verifierCommand: 'forger:verify',
    timeoutMinutes: 1,
    killGraceSeconds: 1,
    sessionId: 's',
    now: () => new Date('2026-01-01T00:00:00Z'),
  };
  const cwdOf = (cmd: string): string => /git worktree add --detach '([^']+)'/.exec(cmd)![1];
  return {run, calls, prompts, cwds, cwdOf, agentSaying, opts, verdicts, scratch};
}

describe('verifyPr', () => {
  test('valid output is recorded against the head commit; the prompt holds the criteria and the diff, not the PR body', async () => {
    const f = fixture();
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}, {criterion: 'c2', verdict: 'cannot_tell', missing: 'no_test', evidence: []}]});
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

  test('runs in a detached, writable checkout of the head, and removes it', async () => {
    const f = fixture();
    await verifyPr(f.run, f.agentSaying('x'), f.opts);
    const add = f.calls.findIndex(c => c.startsWith('git worktree add --detach'));
    expect(add).toBeGreaterThan(-1);
    expect(f.calls[add]).toContain('deadbeef');
    expect(f.calls[add]).toContain(f.cwds[0]);
    expect(f.calls.some(c => c.startsWith('chmod'))).toBe(false);
    expect(f.calls.some(c => c.startsWith('git worktree remove --force'))).toBe(true);
  });

  test('verify checks out under the state directory and removes it', async () => {
    const f = fixture();
    let during = false;
    const agent: AgentRunner = {
      async run(o) {
        during = existsSync(o.cwd);
        return f.agentSaying('x').run(o);
      },
    };
    await verifyPr(f.run, agent, f.opts);
    expect(f.cwds[0].startsWith(f.scratch + '/')).toBe(true);
    expect(during).toBe(true);
    expect(existsSync(f.cwds[0])).toBe(false);
    expect(readdirSync(f.scratch)).toEqual([]);
  });

  test('the checkout folder is removed even when git cannot remove the worktree', async () => {
    const f = fixture();
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('git worktree remove')) throw new Error('not a working tree');
      return f.run(cmd);
    };
    await verifyPr(run, f.agentSaying('x'), f.opts);
    expect(readdirSync(f.scratch)).toEqual([]);
    expect(f.calls).toContain('git worktree prune');
  });

  test('a verify that runs out of space is an infrastructure error naming the folder', async () => {
    const f = fixture();
    const run: CommandRunner = cmd => {
      if (cmd.includes('bun install')) throw Object.assign(new Error('write failed: Disk quota exceeded'), {code: 'EDQUOT'});
      return f.run(cmd);
    };
    const err = await verifyPr(run, f.agentSaying('x'), {...f.opts, setup: 'bun install'}).catch(e => e);
    expect(err).toBeInstanceOf(VerifyInfraError);
    expect(err.message).toContain(`out of space in ${f.scratch}`);
    expect(err.message).toMatch(/free/);
    expect(err.message.match(/infrastructure error/g)).toHaveLength(1);
    expect(f.prompts).toEqual([]);
    expect(existsSync(verdictFile(f.verdicts, 5, 'deadbeef'))).toBe(false);
    expect(readdirSync(f.scratch)).toEqual([]);
  });

  test('a checkout that cannot be made for lack of space is an infrastructure error', async () => {
    const f = fixture();
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('git worktree add')) throw new Error('fatal: could not create work tree dir: No space left on device');
      return f.run(cmd);
    };
    const err = await verifyPr(run, f.agentSaying('x'), f.opts).catch(e => e);
    expect(err).toBeInstanceOf(VerifyInfraError);
    expect(err.message).toContain(f.scratch);
    expect(readdirSync(f.scratch)).toEqual([]);
  });

  test('a failure that is not about space passes through unchanged', async () => {
    const f = fixture();
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('git worktree add')) throw new Error('fatal: bad object');
      return f.run(cmd);
    };
    const err = await verifyPr(run, f.agentSaying('x'), f.opts).catch(e => e);
    expect(err).not.toBeInstanceOf(VerifyInfraError);
    expect(err.message).toBe('fatal: bad object');
  });

  test('the setup runs in the copy before the model starts', async () => {
    const f = fixture();
    const order: string[] = [];
    const run: CommandRunner = cmd => {
      if (cmd.includes('bun install')) order.push('setup');
      return f.run(cmd);
    };
    const agent: AgentRunner = {
      async run(o) {
        order.push('agent');
        return f.agentSaying('x').run(o);
      },
    };
    await verifyPr(run, agent, {...f.opts, setup: 'bun install --frozen-lockfile'});
    expect(order).toEqual(['setup', 'agent']);
    const setup = f.calls.find(c => c.includes('bun install'));
    expect(setup).toContain(`cd '${f.cwds[0]}' && bun install`);
  });

  test('verify warns that no setup ran when the gates name no install step and verify.setup is unset', async () => {
    const f = fixture();
    const warnings: string[] = [];
    await verifyPr(f.run, f.agentSaying('x'), {...f.opts, warn: m => warnings.push(m)});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('verify.setup');
    expect(warnings[0]).toContain('no install step');
    expect(f.prompts[0]).toContain('No setup ran');
    const ran: string[] = [];
    await verifyPr(f.run, f.agentSaying('x'), {...f.opts, setup: 'bun install', warn: m => ran.push(m)});
    expect(ran).toEqual([]);
    expect(f.prompts[1]).toContain('with its dependencies installed');
  });

  test('a failed setup is an infrastructure error: no model run, no record, the copy removed', async () => {
    const f = fixture();
    const run: CommandRunner = cmd => {
      if (cmd.includes('bun install')) throw new Error('EROFS');
      return f.run(cmd);
    };
    const err = await verifyPr(run, f.agentSaying('x'), {...f.opts, setup: 'bun install'}).catch(e => e);
    expect(err).toBeInstanceOf(VerifyInfraError);
    expect(err.message).toContain('infrastructure error');
    expect(f.prompts).toEqual([]);
    expect(existsSync(verdictFile(f.verdicts, 5, 'deadbeef'))).toBe(false);
    expect(f.calls.some(c => c.startsWith('git worktree remove --force'))).toBe(true);
  });

  test('the engine never pushes or changes the PR while verifying', async () => {
    const f = fixture();
    await verifyPr(f.run, f.agentSaying('x'), {...f.opts, setup: 'bun install'});
    const forbidden = /git push|gh pr (edit|merge|close|comment|review|ready)|gh api .*-X (POST|PATCH|PUT|DELETE)/;
    expect(f.calls.filter(c => forbidden.test(c))).toEqual([]);
    expect(f.prompts[0]).toContain('Do not push');
    expect(f.prompts[0]).toContain('writable');
  });

  test('the setup is the configured command, else the gates install step', () => {
    const none = () => false;
    expect(chooseSetup('make deps', 'cd a && bun install', none)?.command).toBe('make deps');
    expect(chooseSetup(null, 'cd a && bun install --frozen-lockfile && bun run check && cd .. && x check', none)).toEqual({command: 'cd a && bun install --frozen-lockfile', source: 'gates'});
    expect(chooseSetup(null, 'bun test', none)).toBeNull();
    expect(installStep('npm ci && npm test')).toBe('npm ci');
  });

  test('each recognised lockfile maps to its frozen install command', () => {
    const expected: Record<string, string> = {
      'bun.lock': 'bun install --frozen-lockfile',
      'bun.lockb': 'bun install --frozen-lockfile',
      'package-lock.json': 'npm ci',
      'pnpm-lock.yaml': 'pnpm install --frozen-lockfile',
      'yarn.lock': 'yarn install --frozen-lockfile',
      'uv.lock': 'uv sync --frozen',
      'Cargo.lock': 'cargo fetch --locked',
    };
    expect(LOCKFILE_INSTALLS.map(l => l.file).sort()).toEqual(Object.keys(expected).sort());
    for (const [file, command] of Object.entries(expected)) {
      expect(chooseSetup(null, 'bun test', n => n === file)).toEqual({command, source: 'lockfile'});
    }
  });

  test('a configured verify.setup wins over the gates and the lockfile', () => {
    expect(chooseSetup('make deps', 'npm ci && npm test', () => true)).toEqual({command: 'make deps', source: 'configured'});
    expect(chooseSetup(null, 'npm ci && npm test', () => true)).toEqual({command: 'npm ci', source: 'gates'});
  });

  test('an empty verify.setup turns the setup off', async () => {
    expect(chooseSetup('', 'npm ci && npm test', () => true)).toBeNull();
    expect(chooseSetup('  ', '', () => true)).toBeNull();
    const f = fixture();
    const warnings: string[] = [];
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('git worktree add')) writeFileSync(join(f.cwdOf(cmd), 'bun.lock'), '');
      return f.run(cmd);
    };
    const record = await verifyPr(run, f.agentSaying('x'), {...f.opts, setup: '', gates: 'bun test', warn: m => warnings.push(m)});
    expect(f.calls.some(c => c.includes('install'))).toBe(false);
    expect(warnings).toEqual([]);
    expect(record.setup).toBeNull();
  });

  test('verify runs the frozen install for the lockfile at the root of the copy when nothing else names a setup', async () => {
    const f = fixture();
    const warnings: string[] = [];
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('git worktree add')) writeFileSync(join(f.cwdOf(cmd), 'package-lock.json'), '');
      return f.run(cmd);
    };
    await verifyPr(run, f.agentSaying('x'), {...f.opts, gates: 'bun test', warn: m => warnings.push(m)});
    expect(f.calls.some(c => c.includes(`cd '${f.cwds[0]}' && npm ci`))).toBe(true);
    expect(warnings).toEqual([]);
    expect(f.prompts[0]).toContain('with its dependencies installed');
  });

  test('the verdict record names the setup command that ran and where it came from', async () => {
    const f = fixture();
    const record = await verifyPr(f.run, f.agentSaying('x'), {...f.opts, setup: 'make deps'});
    expect(record.setup).toEqual({command: 'make deps', source: 'configured'});
    const onDisk = JSON.parse(readFileSync(verdictFile(f.verdicts, 5, 'deadbeef'), 'utf-8'));
    expect(onDisk.setup).toEqual({command: 'make deps', source: 'configured'});
    const viaGates = await verifyPr(f.run, f.agentSaying('x'), {...f.opts, gates: 'bun install && bun test'});
    expect(viaGates.setup).toEqual({command: 'bun install', source: 'gates'});
  });

  describe('the forger/verify status', () => {
    const met = (ids: string[]) => JSON.stringify({verdict: ids.map(criterion => ({criterion, verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}))});
    const blocked = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'not_met', evidence: [{kind: 'command', ref: 'bun test'}]}, {criterion: 'c2', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]});
    function withCapture() {
      const f = fixture();
      const statuses: string[] = [];
      const capture: CapturingRunner = cmd => {
        statuses.push(cmd);
        return {stdout: '', stderr: '', exitCode: 0};
      };
      return {...f, statuses, opts: {...f.opts, capture}};
    }

    test.each([
      ['pass', met(['c1', 'c2']), 'success'],
      ['block', blocked, 'failure'],
      ['unclear', 'not json', 'failure'],
    ])('a %s verdict sets it on the head commit, after the record is written', async (decision, output, state) => {
      const f = withCapture();
      const record = await verifyPr(f.run, f.agentSaying(output), f.opts);
      expect(record.decision).toBe(decision as 'pass');
      expect(record.status).toEqual({context: 'forger/verify', state: state as 'success'});
      expect(f.statuses).toEqual([expect.stringContaining(`statuses/deadbeef -f state=${state} -f context='forger/verify'`)]);
      expect(JSON.parse(readFileSync(verdictFile(f.verdicts, 5, 'deadbeef'), 'utf-8')).status).toBeUndefined();
    });

    test('a refused status is reported on the result and the verdict still stands', async () => {
      const f = fixture();
      const capture: CapturingRunner = () => ({stdout: '', stderr: 'gh: Resource not accessible (HTTP 403)', exitCode: 1});
      const record = await verifyPr(f.run, f.agentSaying(met(['c1', 'c2'])), {...f.opts, capture});
      expect(record.decision).toBe('pass');
      expect(record.status?.error).toContain('HTTP 403');
      expect(existsSync(verdictFile(f.verdicts, 5, 'deadbeef'))).toBe(true);
    });

    test('off GitHub no status is set', async () => {
      const f = withCapture();
      const root = tmp();
      const file = join(root, 'backlog.json');
      writeFileSync(file, JSON.stringify({features: {'issue-9': {acceptance_criteria: ['only one']}}}));
      const record = await verifyPr(f.run, f.agentSaying(met(['c1'])), {...f.opts, trackerKind: 'local', backlogFile: file});
      expect(record.status).toBeUndefined();
      expect(f.statuses).toEqual([]);
    });

    test('the previous verdict status is not part of the gate the verifier sees', async () => {
      const f = fixture();
      const rollup = [{__typename: 'StatusContext', context: 'forger/verify', state: 'FAILURE'}];
      const run: CommandRunner = c => (c.startsWith('gh pr view') ? JSON.stringify({...JSON.parse(view), statusCheckRollup: rollup}) : f.run(c));
      await verifyPr(run, f.agentSaying('x'), f.opts);
      expect(f.prompts[0]).not.toContain('forger/verify');
    });
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
  });

  test('refuses a PR with no ticket and no acceptance section, naming both fixes', async () => {
    const f = fixture();
    const noTicket = JSON.stringify({...JSON.parse(view), headRefName: 'wip', body: ''});
    const run: CommandRunner = c => (c.startsWith('gh pr view') ? noTicket : f.run(c));
    await expect(verifyPr(run, f.agentSaying('x'), f.opts)).rejects.toThrow(/Closes #<n>.*## Acceptance/);
  });

  test('takes the ticket from Closes #n in the body when the branch names none', async () => {
    const f = fixture();
    const withBody = JSON.stringify({...JSON.parse(view), headRefName: 'docs/x', body: 'Closes #9'});
    const run: CommandRunner = c => (c.startsWith('gh pr view') ? withBody : f.run(c));
    const record = await verifyPr(run, f.agentSaying('x'), f.opts);
    expect(record.ticket).toBe('issue-9');
    expect(f.prompts[0]).toContain('first');
  });

  test('verifies a PR with no ticket against the Acceptance section of its body', async () => {
    const f = fixture();
    const withBody = JSON.stringify({...JSON.parse(view), headRefName: 'docs/x', body: '## Acceptance\n- [ ] the doc names the fix\n'});
    const run: CommandRunner = c => (c.startsWith('gh pr view') ? withBody : f.run(c));
    const record = await verifyPr(run, f.agentSaying('x'), f.opts);
    expect(record.ticket).toBe('pr-5');
    expect(record.entries.map(e => e.criterion)).toEqual(['c1']);
    expect(f.prompts[0]).toContain('the doc names the fix');
  });

  test('on a local tracker takes the ticket from feat/<id> and its backlog entry', async () => {
    const f = fixture();
    const backlogFile = join(tmp(), 'backlog.json');
    writeFileSync(backlogFile, JSON.stringify({features: {'sim-engine': {acceptance_criteria: ['it simulates']}}}));
    const local = JSON.stringify({...JSON.parse(view), headRefName: 'feat/sim-engine', body: ''});
    const run: CommandRunner = c => (c.startsWith('gh pr view') ? local : f.run(c));
    const record = await verifyPr(run, f.agentSaying('x'), {...f.opts, trackerKind: 'local', backlogFile});
    expect(record.ticket).toBe('sim-engine');
    expect(f.prompts[0]).toContain('it simulates');
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
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'cannot_tell', missing: 'no_test', evidence: []}]});
    const record = await verifyPr(f.run, f.agentSaying(out), {...f.opts, trackerKind: 'local', backlogFile: file});
    expect(record.entries.map(e => e.criterion)).toEqual(['c1']);
  });
});

describe('evidence the engine could not confirm', () => {
  const unrun = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun run never-ran'}]}, {criterion: 'c2', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]});
  const fixed = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]});

  function twoAnswers(first: string, second: string) {
    const f = fixture();
    const answers = [first, second];
    const agent: AgentRunner = {async run(o) { return f.agentSaying(answers.shift() ?? second).run(o); }};
    return {...f, agent};
  }

  test('a met citing an unrun command is downgraded and re-asked with the citation named', async () => {
    const f = twoAnswers(unrun, fixed);
    const record = await verifyPr(f.run, f.agent, f.opts);
    expect(f.prompts).toHaveLength(2);
    expect(f.prompts[1]).toContain('## Second round');
    expect(f.prompts[1]).toContain('c1: command bun run never-ran');
    expect(f.prompts[1]).toContain('c1: first');
    expect(f.prompts[1]).not.toContain('c2: second');
    expect(record.decision).toBe('pass');
  });

  test('when the second round cannot back it either, it stays cannot_tell and names what was missing', async () => {
    const f = twoAnswers(unrun, unrun);
    const record = await verifyPr(f.run, f.agent, f.opts);
    const c1 = record.entries.find(e => e.criterion === 'c1');
    expect(c1?.verdict).toBe('cannot_tell');
    expect(c1?.missing).toBe('no_data');
    expect(record.decision).toBe('unclear');
  });

  test('a clean first answer is not re-asked', async () => {
    const f = fixture();
    await verifyPr(f.run, f.agentSaying(JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}, {criterion: 'c2', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]})), f.opts);
    expect(f.prompts).toHaveLength(1);
  });

  test('the prompt tells the verifier to run commands through the logger when one is configured', async () => {
    const f = fixture();
    await verifyPr(f.run, f.agentSaying('x'), {...f.opts, runLogged: 'forger run-logged'});
    expect(f.prompts[0]).toContain('forger run-logged --file');
    expect(f.prompts[0]).toContain('"missing"');
  });
});

describe('screenshot evidence', () => {
  const body = '## Acceptance\n- [ ] the page lists links\n\n## UI states\n- empty: no banner, no clear-filter button\n- filled: the links are listed\n\n## Docs\n- none\n';
  const shot = 'docs/screenshots/empty.png';
  function withScreenshots(names: string) {
    const f = fixture();
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('gh issue view')) return body;
      if (cmd.includes('--name-only')) return names;
      return f.run(cmd);
    };
    return {...f, run};
  }

  test('a named UI state with no changed screenshot is cannot_tell and the verifier is not asked about it', async () => {
    const f = withScreenshots('src/a.ts\n');
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]});
    const record = await verifyPr(f.run, f.agentSaying(out), f.opts);
    expect(record.entries.map(e => [e.criterion, e.verdict])).toEqual([['c1', 'met'], ['u1', 'cannot_tell'], ['u2', 'cannot_tell']]);
    expect(record.decision).toBe('unclear');
    expect(f.prompts[0]).not.toContain('u1:');
  });

  test('a fixture PR whose empty-state screenshot shows a banner is blocked', async () => {
    const f = withScreenshots(`${shot}\n`);
    const out = JSON.stringify({
      verdict: [
        {criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]},
        {criterion: 'u1', verdict: 'not_met', evidence: [{kind: 'screenshot', ref: shot}]},
        {criterion: 'u2', verdict: 'cannot_tell', missing: 'no_state', evidence: []},
      ],
    });
    const runWithTree: CommandRunner = cmd => {
      const dir = /^git worktree add --detach '([^']+)'/.exec(cmd)?.[1];
      if (dir) {
        mkdirSync(join(dir, 'docs/screenshots'), {recursive: true});
        writeFileSync(join(dir, shot), 'png');
        return '';
      }
      return f.run(cmd);
    };
    const record = await verifyPr(runWithTree, f.agentSaying(out), f.opts);
    expect(record.entries.find(e => e.criterion === 'u1')?.verdict).toBe('not_met');
    expect(record.decision).toBe('block');
    expect(f.prompts[0]).toContain(`- ${shot}`);
    expect(f.prompts[0]).toContain('u1: empty: no banner, no clear-filter button (UI state)');
  });

  test('an image the owner approved on the base is withheld from the verifier and named as approved', async () => {
    const f = withScreenshots(`${shot}\ndocs/screenshots/filled.png\n`);
    const manifest = JSON.stringify({approved: [{name: 'empty', approved_by: 'owner', files: [shot]}]});
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('gh pr view')) return JSON.stringify({...JSON.parse(view), baseRefName: 'main'});
      if (cmd === 'git show origin/main:.forger/ui-baselines/approved.json') return manifest;
      return f.run(cmd);
    };
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]});
    await verifyPr(run, f.agentSaying(out), f.opts);
    const prompt = f.prompts[0];
    expect(prompt.split('## Changed screenshots')[1].split('## Approved')[0]).toContain('- docs/screenshots/filled.png');
    expect(prompt.split('## Changed screenshots')[1].split('## Approved')[0]).not.toContain(shot);
    expect(prompt.split('## Approved screenshots (not shown)')[1]).toContain(`- ${shot}`);
  });

  test('a manifest the PR adds to its own head does not hide its screenshots', async () => {
    const f = withScreenshots(`${shot}\n`);
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('gh pr view')) return JSON.stringify({...JSON.parse(view), baseRefName: 'main'});
      if (cmd.startsWith('git show origin/main:')) throw new Error('does not exist');
      return f.run(cmd);
    };
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'command', ref: 'bun test'}]}]});
    await verifyPr(run, f.agentSaying(out), f.opts);
    expect(f.prompts[0]).toContain(`## Changed screenshots\n- ${shot}`);
    expect(f.prompts[0]).not.toContain('## Approved screenshots');
  });
});

describe('the kept command log', () => {
  const cmd = (ref: string) => ({kind: 'command', ref});
  const verdict = (a: object, b: object) => JSON.stringify({verdict: [{criterion: 'c1', ...a}, {criterion: 'c2', ...b}]});
  const met = (ref: string) => ({verdict: 'met', evidence: [cmd(ref)]});
  const unsure = {verdict: 'cannot_tell', missing: 'no_test', evidence: []};

  test('verify keeps the command log beside the verdict when evidence does not check out', async () => {
    const f = fixture();
    const record = await verifyPr(f.run, f.agentSaying(verdict(met('never ran'), met('bun test'))), f.opts);
    expect(record.entries[0].demoted).toContain('evidence does not check out');
    const kept = commandLogFile(f.verdicts, 5, 'deadbeef');
    expect(readFileSync(kept, 'utf-8')).toContain('bun test');
    expect(record.commandLog).toBe(kept);
  });

  test('verify keeps the command log beside the verdict when the decision is not a pass', async () => {
    const f = fixture();
    const record = await verifyPr(f.run, f.agentSaying(verdict(met('bun test'), unsure)), f.opts);
    expect(record.decision).not.toBe('pass');
    expect(existsSync(commandLogFile(f.verdicts, 5, 'deadbeef'))).toBe(true);
    expect(readdirSync(f.scratch).filter(n => n.endsWith('.commands.jsonl'))).toEqual([]);
  });

  test('verify removes the command log when the verdict passes and every citation checks out', async () => {
    const f = fixture();
    const kept = commandLogFile(f.verdicts, 5, 'deadbeef');
    mkdirSync(f.verdicts, {recursive: true});
    writeFileSync(kept, 'from an earlier verdict\n');
    const record = await verifyPr(f.run, f.agentSaying(verdict(met('bun test'), met('bun test'))), f.opts);
    expect(record.decision).toBe('pass');
    expect(existsSync(kept)).toBe(false);
    expect(record.commandLog).toBeNull();
  });

  test('the verdict record names the kept command log', async () => {
    const f = fixture();
    await verifyPr(f.run, f.agentSaying(verdict(met('bun test'), unsure)), f.opts);
    const onDisk = JSON.parse(readFileSync(verdictFile(f.verdicts, 5, 'deadbeef'), 'utf-8'));
    expect(onDisk.commandLog).toBe(commandLogFile(f.verdicts, 5, 'deadbeef'));
  });
});
