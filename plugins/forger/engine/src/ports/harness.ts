/**
 * The harness seam: everything about running forger's worker that differs
 * between agent tools. The loop is written against `AgentRunner`, built from
 * a `Harness`; setup installs a harness's commands through it. Each harness is
 * an adapter (see adapters/). The decisions here are pure, so each adapter is
 * table-tested without spawning anything.
 */

import type {ModelPrice} from '../config';

import type {AgentRunOptions} from './agent';

export interface SpawnSpec {
  command: string;
  args: string[];
  /** Text written to the worker's stdin, when the harness reads its prompt there. */
  input?: string;
}

export interface Harness {
  id: string;
  /**
   * What the harness's headless output reports of usage: `cap` when the harness enforces the budget
   * itself, `cost` when the output states USD, `tokens` when it states token counts only (the cost then
   * needs a price from the config), `none` when it states nothing and the worker runs under the timeout alone.
   */
  usage: 'cap' | 'cost' | 'tokens' | 'none';
  /**
   * The spend, in USD, the harness's own output reports so far, or null when it states none.
   * A `tokens` harness prices the counts with `price`, and states none without one.
   */
  spentUsd?(output: string, price?: ModelPrice): number | null;
  /** The worker's own words, decoded from a structured output stream, when the harness prints one. */
  plainText?(output: string): string;
  /** How the worker is started headless for one iteration. */
  spawn(opts: AgentRunOptions): SpawnSpec;
  /**
   * Where the packaged command `name` is installed, relative to the project,
   * or null when the harness installs commands through its own plugin system.
   */
  commandPath(name: string): string | null;
  /** The variable the source commands use for the plugin root; `packageCommand` resolves it. */
  pluginRootVar: string;
  /** The source command text in this harness's format; `name` is the command's file name without extension. */
  packageCommand(source: string, pluginRoot: string, name?: string): string;
  /** Where the harness reads a project's tool-call hooks, or null when it has none forger can install into. */
  hooks: HarnessHooks | null;
}

export interface HarnessHooks {
  /** The settings file, relative to the project. */
  path: string;
  /** Whether the settings text already runs forger's hook. */
  installed(settings: string | null): boolean;
  /** The settings with forger's hook command added; text that already runs it comes back unchanged. */
  install(settings: string | null, command: string): string;
}
