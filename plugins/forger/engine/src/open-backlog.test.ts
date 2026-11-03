import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {mergeConfig} from './config';
import {backlogSource, openBacklog} from './open-backlog';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-open-'));
  dirs.push(root);
  mkdirSync(join(root, '.claude'));
  writeFileSync(
    join(root, '.claude', 'backlog.json'),
    JSON.stringify({features: {from_file: {status: 'not_started'}}})
  );
  return root;
}

describe('backlogSource', () => {
  test('github reads issues; local and none read backlog.json', () => {
    expect(backlogSource(mergeConfig({tracker: {kind: 'github'}}))).toBe('github');
    expect(backlogSource(mergeConfig({tracker: {kind: 'local'}}))).toBe('file');
    expect(backlogSource(mergeConfig({tracker: {kind: 'none'}}))).toBe('file');
  });
});

describe('openBacklog', () => {
  test('local and none select from backlog.json and never call gh', () => {
    for (const kind of ['local', 'none'] as const) {
      const backlog = openBacklog(project(), mergeConfig({tracker: {kind}}), () => {
        throw new Error('gh must not be called');
      });
      expect(backlog.next()).toBe('from_file');
    }
  });

  test('github selects from issues through the runner', () => {
    const response = JSON.stringify([
      {
        data: {
          repository: {
            issues: {
              nodes: [
                {
                  number: 4,
                  state: 'OPEN',
                  labels: {nodes: [{name: 'ready-for-agent'}]},
                  timelineItems: {nodes: []},
                  blockedBy: {nodes: []},
                },
              ],
            },
          },
        },
      },
    ]);
    const backlog = openBacklog(project(), mergeConfig({tracker: {kind: 'github'}}), () => response);
    expect(backlog.next()).toBe('issue-4');
  });
});
