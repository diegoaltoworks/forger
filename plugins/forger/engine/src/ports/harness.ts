/**
 * The harness seam: everything about running forger's worker that differs
 * between agent tools. The loop is written against `AgentRunner`, built from
 * a `Harness`; setup installs a harness's commands through it. Each harness is
 * an adapter (see adapters/). The decisions here are pure, so each adapter is
 * table-tested without spawning anything.
 */

import type {AgentRunOptions} from './agent';

export interface SpawnSpec {
  command: string;
  args: string[];
  /** Text written to the worker's stdin, when the harness reads its prompt there. */
  input?: string;
}

export interface Harness {
  id: string;
  /** How the worker is started headless for one iteration. */
  spawn(opts: AgentRunOptions): SpawnSpec;
  /**
   * Where the packaged command `name` is installed, relative to the project,
   * or null when the harness installs commands through its own plugin system.
   */
  commandPath(name: string): string | null;
  /** The variable the source commands use for the plugin root; `packageCommand` resolves it. */
  pluginRootVar: string;
  /** The source command text in this harness's format. */
  packageCommand(source: string, pluginRoot: string): string;
}
