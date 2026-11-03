/**
 * The `SpecProvider` over the `slcr` binary: runs `slcr check --format json`,
 * `slcr query` and `slcr slice` through the process runner and parses them at
 * the boundary. The base side is the base branch exported to a scratch folder,
 * so the working tree and HEAD are never touched. No binary, or no SLCR.toml on
 * a side, is an absent report (a gap for the check), never a pass.
 */

import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {SpecOutputError, type CapturingRunner, type SpecProvider, type SpecReport} from '../ports';
import {execCapture} from './exec';
import {MODALITY_QUERY, buildReport, parseCheckSpecs, parseModalities} from './slcr-report';

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const NO_PROJECT = /could not find SLCR\.toml/;

export interface SlcrOptions {
  projectRoot: string;
  baseBranch: string;
  /** A runner for commands in a directory; real process execution by default. */
  runIn?: (cwd: string) => CapturingRunner;
  /** Exports the base branch into a folder; false when it cannot. */
  exportBase?: (dir: string) => boolean;
  /** Makes and removes the scratch folder the base branch is exported to. */
  scratch?: {make(): string; remove(dir: string): void};
}

const realScratch = {
  make: () => mkdtempSync(join(tmpdir(), 'forger-spec-base-')),
  remove: (dir: string) => rmSync(dir, {recursive: true, force: true}),
};

export function slcrProvider(options: SlcrOptions): SpecProvider {
  const runIn = options.runIn ?? execCapture;
  const scratch = options.scratch ?? realScratch;
  const exportBase =
    options.exportBase ??
    ((dir: string) => execCapture(options.projectRoot)(`git archive ${quote(options.baseBranch)} | tar -x -C ${quote(dir)}`).exitCode === 0);

  function readIn(dir: string): SpecReport | null {
    const run = runIn(dir);
    const checked = run('slcr check --format json');
    if (checked.exitCode === 127) return null;
    if (checked.stdout === '' && NO_PROJECT.test(checked.stderr)) return null;
    const specs = parseCheckSpecs(checked.stdout);
    return buildReport(
      specs.map(spec => {
        const queried = run(`slcr query ${quote(MODALITY_QUERY)} ${quote(spec.file)} --format json`);
        if (queried.exitCode !== 0) throw new SpecOutputError(`slcr query failed for ${spec.file} (exit ${queried.exitCode}): ${queried.stderr}`);
        return {spec, modalities: parseModalities(queried.stdout)};
      }),
    );
  }

  function readBase(): SpecReport | null {
    const dir = scratch.make();
    try {
      if (!exportBase(dir)) return null;
      return readIn(dir);
    } finally {
      scratch.remove(dir);
    }
  }

  return {
    report: side => (side === 'head' ? readIn(options.projectRoot) : readBase()),
    slice(id) {
      const out = runIn(options.projectRoot)(`slcr slice ${quote(id)}`);
      if (out.exitCode === 127) return null;
      if (out.exitCode !== 0) throw new SpecOutputError(`slcr slice ${id} failed (exit ${out.exitCode}): ${out.stderr}`);
      return out.stdout;
    },
  };
}

