/** Reads a harness's catalogue of models through the command runner. */

import type {CommandRunner, Harness} from '../../ports';
import {parseCatalogue} from './rules';

/** The ids the harness lists, or null with one logged line when it says no listing command or the command cannot run. */
export function readCatalogue(harness: Harness | undefined, run: CommandRunner, log: (line: string) => void = console.log): string[] | null {
  const says = harness?.models;
  if (!says) return null;
  try {
    const ids = parseCatalogue(run(says.listing));
    if (ids.length > 0) return ids;
    log(`could not read the models ${harness.id} lists: \`${says.listing}\` printed nothing; the form of the ids is checked`);
  } catch (e) {
    log(`could not read the models ${harness.id} lists: \`${says.listing}\` failed (${(e as Error).message.split('\n')[0]}); the form of the ids is checked`);
  }
  return null;
}
