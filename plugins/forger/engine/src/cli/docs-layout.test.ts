import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {splitFences} from '../checks';
import {COMMANDS} from './registry';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');

/** The tools a reader installs before forger; the install path cannot avoid them. */
const PREREQUISITES = ['bun', 'claude', 'gh'];

const SLASH_COMMANDS = readdirSync(join(REPO, 'plugins/forger/commands'))
  .filter(f => f.endsWith('.md'))
  .map(f => `/forger:${f.replace(/\.md$/, '')}`);
const CLI = COMMANDS.map(c => c.name);

function headings(text: string): string[] {
  return splitFences(text)
    .prose.map(l => /^#{1,6}\s+(.+?)\s*$/.exec(l)?.[1])
    .filter((h): h is string => h !== undefined);
}

function fencedCommands(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (inFence && line.trim() !== '' && !line.trim().startsWith('#')) out.push(line.trim());
  }
  return out;
}

/** Why a command line is not one a reader can run, or null when it is. */
function unknownCommand(line: string): string | null {
  const engine = /work\.ts\s+([a-z-]+)/.exec(line);
  if (engine) return CLI.includes(engine[1]) ? null : `engine command "${engine[1]}" is not in the usage`;
  const slash = /^\/forger:[a-z-]+/.exec(line);
  if (slash) return SLASH_COMMANDS.includes(slash[0]) ? null : `slash command "${slash[0]}" is not a plugin command`;
  const tool = line.split(/\s+/)[0];
  return PREREQUISITES.includes(tool) ? null : `"${tool}" is neither a forger command nor a prerequisite`;
}

describe('the root README', () => {
  test('root README heading order', () => {
    const text = read('README.md');
    const prose = splitFences(text).prose;
    const h1 = prose.findIndex(l => /^#\s+\S/.test(l));
    const purpose = prose.slice(h1 + 1).find(l => l.trim() !== '');
    expect(purpose).toBeDefined();
    expect(purpose).not.toMatch(/^\s*(#|\[!|!\[|<|```)/);
    expect(headings(text).filter(h => prose.includes(`## ${h}`))).toEqual(['Install', 'Start', 'Why', 'Learn more', 'Licence']);
  });

  test('install and start commands exist', () => {
    const text = read('README.md');
    const section = (name: string) => text.split(/^## /m).find(s => s.startsWith(`${name}\n`)) ?? '';
    const lines = [...fencedCommands(section('Install')), ...fencedCommands(section('Start'))];
    expect(lines.some(l => l.startsWith('claude plugin install'))).toBe(true);
    expect(lines).toContain('/forger:setup');
    expect(lines).toContain('/forger:work');
    expect(lines.map(unknownCommand).filter(Boolean)).toEqual([]);
  });
});

describe('docs/getting-started.md', () => {
  test('getting started commands exist', () => {
    const lines = fencedCommands(read('docs/getting-started.md'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map(l => [l, unknownCommand(l)]).filter(([, why]) => why)).toEqual([]);
  });

  test('an unknown command is caught', () => {
    expect(unknownCommand('bun <forger>/bin/work.ts nope')).toContain('nope');
    expect(unknownCommand('/forger:nope')).toContain('/forger:nope');
    expect(unknownCommand('make start')).toContain('make');
    expect(unknownCommand('bun <forger>/bin/work.ts status')).toBeNull();
  });
});

/** Every section heading (below the title) the two READMEs carried before they became launch pads. */
const FORMER_HEADINGS = {
  'README.md': ['Skills from the community', 'Quality is asserted by commands', 'The three layers', 'Bring your own skills', 'Read in this order', 'Status', 'Licence'],
  'plugins/forger/README.md': [
    'Command surface',
    'Human entry points',
    'Machine-internal',
    'The pipeline',
    'Tracker: GitHub Issues',
    'Bring your own skills',
    'The pipeline as data',
    'Output contracts',
    'Comparing skills',
    'Adapters',
    'Install and update',
    'Prerequisites',
    'Onboard a repo',
    'Configuration',
    'How the engine runs',
    'Engine development',
    'Safety',
  ],
};

describe('the moved README sections', () => {
  test('no README section is dropped', () => {
    const reference = readdirSync(join(REPO, 'docs/reference')).filter(f => f.endsWith('.md'));
    const kept = new Set([...headings(read('ABOUT.md')), ...reference.flatMap(f => headings(read(`docs/reference/${f}`)))]);
    const dropped = Object.entries(FORMER_HEADINGS).flatMap(([file, list]) => {
      const now = new Set(headings(read(file)));
      return list.filter(h => !now.has(h) && !kept.has(h)).map(h => `${file}: ${h}`);
    });
    expect(dropped).toEqual([]);
  });
});
