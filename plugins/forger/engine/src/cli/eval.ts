import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {randomUUID} from 'crypto';

import {agentFor, findHarness} from '../adapters';
import {resolveModel} from '../config';
import {resolveSlot, SLOTS, UNATTENDED_PREAMBLE, withBuiltinFile} from '../packs';
import {contractSuffix, evalContract, evalPrompt, resultFile, scoreCase, summarise, type CaseScore, type EvalCase} from '../pipeline';
import type {Command, CommandContext} from './command';

/** The cases of a slot: one directory each with `case.json` (facts, properties) and `input.md` (the task text). */
export function loadCases(pluginRoot: string, slot: string): EvalCase[] {
  const dir = join(pluginRoot, 'evals', slot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true})
    .filter(d => d.isDirectory() && existsSync(join(dir, d.name, 'case.json')))
    .map(d => {
      const meta = JSON.parse(readFileSync(join(dir, d.name, 'case.json'), 'utf-8')) as Pick<EvalCase, 'facts' | 'properties'>;
      return {name: d.name, input: readFileSync(join(dir, d.name, 'input.md'), 'utf-8'), facts: meta.facts ?? {}, properties: meta.properties ?? []};
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

type SkillRef = {name: string} | {file: string};

/** `builtin` is the slot's shipped step; an existing path or a `.md` is a file; anything else is an installed skill's name. */
function skillRef(ctx: CommandContext, slot: string, arg: string): {ref: SkillRef; label: string} | string {
  const def = SLOTS.find(s => s.slot === slot);
  if (!def) return `no slot "${slot}"`;
  if (arg === 'builtin') {
    const r = withBuiltinFile(resolveSlot(def, {}, new Set(), {pluginRoot: ctx.pluginRoot}), {pluginRoot: ctx.pluginRoot});
    return r.path ? {ref: {file: r.path}, label: 'builtin'} : `slot "${slot}" has no built-in skill file to score`;
  }
  const looksLikeFile = arg.endsWith('.md') || arg.includes('/');
  if (!looksLikeFile) return {ref: {name: arg}, label: arg};
  const path = [arg, ...ctx.collectionRoots().map(r => join(r, arg)), join(ctx.pluginRoot, arg)].find(p => existsSync(p));
  return path ? {ref: {file: path}, label: arg} : `${arg} does not exist`;
}

export const evalCommand: Command = {
  name: 'eval',
  needs: 'config',
  flags: ['json', 'slot', 'skill'],
  help: `  eval --slot SLOT --skill NAME|FILE|builtin [--json]
                   Run a slot's skill on the slot's cases (plugins/forger/evals/<slot>/) through the
                   harness and score each result with the slot's contract validator plus the case's
                   properties; prints the scores, writes them to the output directory, exit 1
                   unless every case passes`,
  async run(ctx) {
    const {values, config, projectRoot} = ctx;
    const slot = values.slot as string | undefined;
    const skillArg = values.skill as string | undefined;
    const fail = (message: string): void => {
      console.error(`eval: ${message}`);
      process.exitCode = 1;
    };
    if (!slot || !skillArg) return fail('--slot and --skill are required');
    const contract = evalContract(slot);
    if (!contract) return fail(`no contract for slot "${slot}"`);
    const skill = skillRef(ctx, slot, skillArg);
    if (typeof skill === 'string') return fail(skill);
    let cases: EvalCase[];
    try {
      cases = loadCases(ctx.pluginRoot, slot);
    } catch (e) {
      return fail(`a case is malformed: ${(e as Error).message}`);
    }
    if (cases.length === 0) return fail(`no cases under evals/${slot}/`);

    const agent = ctx.deps.agent ?? agentFor(findHarness(config.harness), config.model_prices);
    const tier = config.model_by_priority.default;
    const scores: CaseScore[] = [];
    for (const c of cases) {
      const dir = mkdtempSync(join(tmpdir(), 'forger-eval-'));
      try {
        const out = join(dir, resultFile(slot, contract));
        await agent.run({
          prompt: evalPrompt({preamble: UNATTENDED_PREAMBLE, skill: skill.ref, input: c.input, suffix: contractSuffix(contract, out)}),
          sessionId: randomUUID(),
          tier,
          model: resolveModel(tier.model, config.models),
          workerCommand: config.worker_command,
          cwd: dir,
          timeoutMinutes: 15,
          killGraceSeconds: 10,
        });
        scores.push(scoreCase(slot, c, existsSync(out) ? readFileSync(out, 'utf-8') : null));
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    }
    const summary = summarise(slot, skill.label, scores);
    const outDir = join(projectRoot, config.paths.output);
    mkdirSync(outDir, {recursive: true});
    writeFileSync(join(outDir, `eval-${slot}-${skill.label.replace(/[^A-Za-z0-9._-]/g, '_')}.json`), JSON.stringify(summary, null, 2));
    if (summary.passed !== summary.total) process.exitCode = 1;
    if (values.json) return console.log(JSON.stringify(summary));
    console.log([`${slot} / ${skill.label}: ${summary.passed}/${summary.total} cases passed, score ${summary.score.toFixed(2)}`, ...scores.map(s => `  ${s.passed ? 'pass' : 'FAIL'} ${s.case} (${s.score.toFixed(2)})${s.contract.ok ? '' : ': ' + s.contract.problems.join('; ')}${s.properties.filter(p => !p.met).map(p => `\n    missed: ${p.property}`).join('')}`)].join('\n'));
  },
};
