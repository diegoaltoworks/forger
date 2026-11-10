import {appendFileSync, mkdirSync} from 'fs';
import {dirname, resolve} from 'path';

import type {CheckReport} from '../checks';
import {recordsFromReport} from './from-report';

/**
 * Appends the run's records to the checks file under the loop's root, only
 * inside a worker. Returns a warning line when the write failed; a record
 * never changes the exit code of `check`.
 */
export function appendCheckRecords(report: CheckReport, worker: {ticket: string; iteration: number} | null, loopRoot: string, file: string, now: Date = new Date()): string | null {
  if (!worker) return null;
  try {
    const records = recordsFromReport(report, {at: now.toISOString(), ...worker});
    const path = resolve(loopRoot, file);
    mkdirSync(dirname(path), {recursive: true});
    appendFileSync(path, records.map(r => JSON.stringify(r) + '\n').join(''));
    return null;
  } catch (e) {
    return `warning: could not record the check results: ${(e as Error).message}`;
  }
}
