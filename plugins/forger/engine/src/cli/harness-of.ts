import {findHarness} from '../adapters';
import {loadConfig} from '../config';
import type {Harness} from '../ports';

/** The project's harness, for the checks that read its settings; an unknown one leaves them nothing to read. */
export function harnessOfRoot(projectRoot: string): Harness | undefined {
  try {
    return findHarness(loadConfig(projectRoot).harness);
  } catch {
    return undefined;
  }
}
