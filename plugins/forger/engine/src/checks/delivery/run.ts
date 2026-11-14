/**
 * The I/O half of `check delivery`: reads the deliver file and reports what is
 * wrong with it. It runs none of the commands the file names.
 */

import {existsSync, readFileSync} from 'fs';

import {forgerPath} from '../../config';
import type {Finding} from '../waivers';
import {DELIVER_PATH, parseDeliverConfig} from './config';

export function runDeliveryCheck(projectRoot: string): Finding[] {
  const file = forgerPath(projectRoot, DELIVER_PATH);
  if (!existsSync(file)) throw new Error(`${DELIVER_PATH} not found; the delivery pack's config is required`);
  return parseDeliverConfig(readFileSync(file, 'utf-8')).findings;
}
