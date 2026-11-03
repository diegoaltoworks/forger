import {slcrProvider} from '../adapters';
import type {SpecProvider} from '../ports';
import type {CommandContext} from './command';

/** The spec provider of this project: the slcr binary, the base branch from the config (main when there is none). */
export function specProvider(ctx: CommandContext): SpecProvider {
  let baseBranch = 'main';
  try {
    baseBranch = ctx.config.base_branch;
  } catch {
    // a project without a config still checks against main
  }
  return slcrProvider({projectRoot: ctx.projectRoot, baseBranch});
}
