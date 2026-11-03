import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {type BacklogData, backlogFrom} from '../backlog';
import {mergeConfig} from '../config';
import {AutomationRunner} from './runner';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const data: BacklogData = {features: {the_ticket: {priority: 'P0', status: 'not_started', depends_on: []}}};

describe('runIteration', () => {
  test('a runner given no agent runner refuses to run an iteration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-iteration-'));
    dirs.push(root);
    const config = mergeConfig({});
    const runner = new AutomationRunner(root, config, backlogFrom(() => data, config), {gitRunner: () => ''});
    await expect(runner.runIteration(1)).rejects.toThrow('no agent runner was given to this runner');
  });
});
