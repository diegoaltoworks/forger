import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';

import type {AgentRunOptions} from '../ports';
import {critiquePr, RESULT_FILE, type CritiqueOptions, type CritiqueTracker} from './run';

const PLAN = '# Plan\n\n## Brief, verbatim\n\nAn 8-bit demo, think a handheld RPG.\n\n## Interpretation of references\n\nCharm.\n\n## Goal\n\nx\n';
const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, {recursive: true, force: true});
});

const dims = ['feel', 'readability', 'feedback', 'fidelity'].map(name => ({name, score: 3, reason: 'ok'}));
const finding = (severity: string, title: string) => ({severity, dimension: 'feel', title, body: `do ${title}`, evidence: 'docs/screenshots/home.png'});

interface World {
  changed: string[];
  plan: string | null;
  captures: string[];
}

function setup(world: World) {
  const records = mkdtempSync(join(tmpdir(), 'critique-records-'));
  tmp.push(records);
  const commands: string[] = [];
  let copy = '';
  const run = (cmd: string): string => {
    commands.push(cmd);
    if (cmd.startsWith('gh pr diff')) return world.changed.join('\n');
    if (cmd.startsWith('gh pr view')) return JSON.stringify({headRefOid: 'abc1234def'});
    if (cmd.startsWith('git worktree add')) {
      copy = /--detach '([^']+)'/.exec(cmd)?.[1] ?? '';
      if (world.plan !== null) {
        mkdirSync(join(copy, 'docs'), {recursive: true});
        writeFileSync(join(copy, 'docs/plan-demo.md'), world.plan);
      }
      mkdirSync(join(copy, 'docs/screenshots'), {recursive: true});
      for (const c of world.captures) writeFileSync(join(copy, c), 'x');
      return '';
    }
    if (cmd.includes("ls-files 'docs/plan*.md'")) return world.plan === null ? '' : 'docs/plan-demo.md';
    if (cmd.includes("ls-files 'docs/screenshots/'")) return world.captures.join('\n');
    return '';
  };
  const filed: Array<{title: string; body: string}> = [];
  const tracker: CritiqueTracker = {
    fileTicket(title, body) {
      filed.push({title, body});
      return `https://example.test/issues/${filed.length}`;
    },
  };
  const opts: CritiqueOptions = {
    pr: 7,
    force: false,
    threshold: 'medium',
    visualPaths: ['src/ui/**'],
    recordsDir: join(records, 'critiques'),
    tmpDir: join(records, 'tmp'),
    tier: {role: 'fast', budget: 1} as unknown as CritiqueOptions['tier'],
    model: 'm',
    critiqueCommand: 'forger:critique',
    timeoutMinutes: 1,
    killGraceSeconds: 1,
    sessionId: 's',
    now: () => new Date('2026-01-01T00:00:00Z'),
  };
  return {run, tracker, opts, commands, filed, copy: () => copy};
}

/** A critic that writes each answer in turn to the path its prompt names. */
function critic(answers: unknown[]) {
  const prompts: string[] = [];
  const agent = {
    async run(o: AgentRunOptions) {
      prompts.push(o.prompt);
      const path = /write your result to (\S+) as JSON/.exec(o.prompt)?.[1] as string;
      expect(dirname(path)).toBe(o.cwd);
      const answer = answers[prompts.length - 1];
      if (answer !== undefined) writeFileSync(path, JSON.stringify(answer));
      return {exitCode: 0, signal: null, output: '', timedOut: false};
    },
  };
  return {agent, prompts};
}

const WORLD: World = {changed: ['src/ui/App.tsx'], plan: PLAN, captures: ['docs/screenshots/home.png']};

describe('critiquePr', () => {
  test('files the findings above the threshold, reports the rest and records the critique', async () => {
    const s = setup(WORLD);
    const c = critic([{dimensions: dims, findings: [finding('high', 'Give the hero a face'), finding('medium', 'Sound on every move'), finding('low', 'Trim the title')]}]);
    const r = await critiquePr(s.run, c.agent, s.tracker, s.opts);
    if (r.status !== 'critiqued') throw new Error(`expected critiqued, got ${r.status}`);
    expect(r.filed.map(x => [x.title, x.ticket])).toEqual([
      ['Give the hero a face', 'https://example.test/issues/1'],
      ['Sound on every move', 'https://example.test/issues/2'],
    ]);
    expect(r.reported.map(x => x.title)).toEqual(['Trim the title']);
    expect(s.filed[0]?.body).toContain('PR #7');
    expect(c.prompts[0]).toContain('An 8-bit demo, think a handheld RPG.');
    expect(c.prompts[0]).toContain('docs/screenshots/home.png');
    const files = readdirSync(s.opts.recordsDir);
    expect(files).toEqual(['pr-7-abc1234def.json']);
    expect(JSON.parse(readFileSync(join(s.opts.recordsDir, files[0] as string), 'utf-8'))).toMatchObject({status: 'critiqued', pr: 7, at: '2026-01-01T00:00:00.000Z'});
  });

  test('a change that touches nothing the audience sees is skipped without running the critic', async () => {
    const s = setup({...WORLD, changed: ['src/engine.ts']});
    const c = critic([]);
    const r = await critiquePr(s.run, c.agent, s.tracker, s.opts);
    expect(r).toMatchObject({status: 'skipped'});
    expect(c.prompts).toHaveLength(0);
    expect(s.commands.some(x => x.startsWith('git worktree add'))).toBe(false);
  });

  test('force runs on a change the path test would skip', async () => {
    const s = setup({...WORLD, changed: ['src/engine.ts']});
    const c = critic([{dimensions: dims, findings: []}]);
    const r = await critiquePr(s.run, c.agent, s.tracker, {...s.opts, force: true});
    expect(r).toMatchObject({status: 'critiqued', filed: [], reported: []});
  });

  test('a capture in the diff counts as a visual change', async () => {
    const s = setup({...WORLD, changed: ['docs/screenshots/home.png']});
    const c = critic([{dimensions: dims, findings: []}]);
    expect((await critiquePr(s.run, c.agent, s.tracker, s.opts)).status).toBe('critiqued');
  });

  test('no brief in any plan doc means nothing to judge against', async () => {
    const s = setup({...WORLD, plan: null});
    const r = await critiquePr(s.run, critic([]).agent, s.tracker, s.opts);
    expect(r).toMatchObject({status: 'skipped', reason: expect.stringContaining('brief')});
  });

  test('no capture means nothing to look at', async () => {
    const s = setup({...WORLD, captures: []});
    const r = await critiquePr(s.run, critic([]).agent, s.tracker, s.opts);
    expect(r).toMatchObject({status: 'skipped', reason: expect.stringContaining('capture')});
  });

  test('a broken answer is retried once with the problems shown', async () => {
    const s = setup(WORLD);
    const c = critic([{dimensions: [], findings: []}, {dimensions: dims, findings: [finding('high', 'Hero')]}]);
    const r = await critiquePr(s.run, c.agent, s.tracker, s.opts);
    expect(r.status).toBe('critiqued');
    expect(c.prompts).toHaveLength(2);
    expect(c.prompts[1]).toContain('critique.dimensions has no feel dimension');
    expect(s.filed).toHaveLength(1);
  });

  test('two broken answers file nothing and leave no record', async () => {
    const s = setup(WORLD);
    const c = critic([{dimensions: dims, findings: [finding('high', 'x')].map(x => ({...x, evidence: 'docs/screenshots/gone.png'}))}, undefined]);
    const r = await critiquePr(s.run, c.agent, s.tracker, s.opts);
    expect(r).toMatchObject({status: 'invalid', problems: [`${RESULT_FILE} was not written as valid JSON`]});
    expect(s.filed).toHaveLength(0);
    expect(existsSync(s.opts.recordsDir)).toBe(false);
  });

  test('the disposable copy is removed even when the critic fails', async () => {
    const s = setup(WORLD);
    const agent = {
      async run(): Promise<never> {
        throw new Error('harness down');
      },
    };
    await expect(critiquePr(s.run, agent, s.tracker, s.opts)).rejects.toThrow('harness down');
    expect(s.commands.some(x => x.startsWith('git worktree remove'))).toBe(true);
  });
});
