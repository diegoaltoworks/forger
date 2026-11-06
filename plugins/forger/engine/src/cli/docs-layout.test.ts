import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {splitFences} from '../checks';
import {HARNESSES} from '../adapters';
import {COMMANDS} from './registry';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');

/** The tools a reader installs before forger; the install path cannot avoid them. */
const PREREQUISITES = ['bun', 'gh', 'git', ...HARNESSES.map(h => h.id)];

const SLASH_COMMANDS = readdirSync(join(REPO, 'plugins/forger/commands'))
  .filter(f => f.endsWith('.md'))
  .map(f => `/forger:${f.replace(/\.md$/, '')}`);
const CLI = COMMANDS.map(c => c.name);
const STEPS = SLASH_COMMANDS.map(c => c.replace('/forger:', ''));

/** How a reader starts a packaged command in each harness: `/forger:x` under Claude Code, `forger-x` as a command or skill elsewhere. */
const START_PREFIX: Record<string, string> = {claude: '/forger:', opencode: '/forger-', codex: '$forger-', copilot: '/forger-'};
const HARNESS_ROWS = (text: string, heading: string) =>
  (text.split(/^## /m).find(s => s.replace(EMOJI, '').startsWith(`${heading}\n`)) ?? '').split('\n').filter(l => /^\|\s*(Claude Code|OpenCode|Codex|Copilot)\s*\|/.test(l));
const inlineCode = (line: string) => [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]);
const HARNESS_NAMES: Record<string, string> = {claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex', copilot: 'Copilot'};

const EMOJI = /^\p{Extended_Pictographic}\uFE0F?\s+/u;

/** Heading texts with the leading section emoji removed. */
function headings(text: string): string[] {
  return splitFences(text)
    .prose.map(l => /^#{1,6}\s+(.+?)\s*$/.exec(l)?.[1])
    .filter((h): h is string => h !== undefined)
    .map(h => h.replace(EMOJI, ''));
}

/** Section headings (below the title) that start with an emoji, outside code blocks. */
function sectionHeadings(text: string): string[] {
  return splitFences(text)
    .prose.map(l => /^#{2,6}\s+(.+?)\s*$/.exec(l)?.[1])
    .filter((h): h is string => h !== undefined);
}

/** Link texts of every markdown link, outside code blocks. */
function linkTexts(text: string): string[] {
  return splitFences(text).prose.flatMap(l => [...l.matchAll(/(?<!!)\[([^\]]+)\]\([^)]+\)/g)].map(m => m[1]));
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
  const packaged = /^[/$]forger-([a-z-]+)$/.exec(line);
  if (packaged) return STEPS.includes(packaged[1]) ? null : `packaged command "${line}" is not a plugin command`;
  const tool = line.split(/\s+/)[0];
  return PREREQUISITES.includes(tool) ? null : `"${tool}" is neither a forger command nor a prerequisite`;
}

describe('docs/reference/commands.md', () => {
  test('every command in the engine\'s usage has one row in docs/reference/commands.md, and every row is a command', () => {
    const text = read('docs/reference/commands.md');
    const section = text.slice(text.indexOf('## The engine CLI'));
    const rows = section
      .split('\n')
      .filter(l => /^\| `/.test(l))
      .map(l => /^\| `([a-z-]+)/.exec(l)?.[1] ?? '');
    expect([...rows].sort()).toEqual([...CLI].sort());
  });
});

describe('the root README', () => {
  test('root README heading order', () => {
    const text = read('README.md');
    const prose = splitFences(text).prose;
    const h1 = prose.findIndex(l => /^#\s+\S/.test(l));
    const purpose = prose.slice(h1 + 1).find(l => l.trim() !== '');
    expect(purpose).toBeDefined();
    expect(purpose).not.toMatch(/^\s*(#|\[!|!\[|<|```)/);
    expect(headings(text).filter(h => prose.some(l => l.replace(/^(## )\p{Extended_Pictographic}\uFE0F?\s+/u, '$1') === `## ${h}`))).toEqual(['Install', 'Start', 'Why', 'Learn more', 'Licence']);
  });

  test('install and start commands exist', () => {
    const text = read('README.md');
    const install = HARNESS_ROWS(text, 'Install');
    expect(install.flatMap(inlineCode).some(c => c.startsWith('claude plugin install'))).toBe(true);
    const lines = [...install, ...HARNESS_ROWS(text, 'Start')].flatMap(inlineCode);
    expect(lines.map(unknownCommand).filter(Boolean)).toEqual([]);
  });

  test('root README names every supported harness', () => {
    const text = read('README.md');
    for (const section of ['Install', 'Start']) {
      const rows = HARNESS_ROWS(text, section);
      expect(rows.map(r => r.split('|')[1].trim())).toEqual(HARNESSES.map(h => HARNESS_NAMES[h.id]));
    }
    for (const h of HARNESSES.filter(h => h.id !== 'claude')) {
      const row = HARNESS_ROWS(text, 'Install').find(r => r.includes(HARNESS_NAMES[h.id])) ?? '';
      expect(row).toContain(`setup --harness ${h.id}`);
    }
  });

  test('each harness row starts setup, plan and work with that harness\'s command names', () => {
    const rows = HARNESS_ROWS(read('README.md'), 'Start');
    for (const h of HARNESSES) {
      const row = rows.find(r => r.includes(HARNESS_NAMES[h.id])) ?? '';
      expect(inlineCode(row)).toEqual(['setup', 'plan', 'work'].map(step => `${START_PREFIX[h.id]}${step}`));
    }
  });
});

describe('section emoji and link titles', () => {
  test('root README links have titles', () => {
    const bad = linkTexts(read('README.md')).filter(t => /\.md\b/.test(t) || /[\w.]\/[\w.]/.test(t) || /^`?[\w./-]+\/`?$/.test(t));
    expect(bad).toEqual([]);
  });

  test('root README section headings start with an emoji', () => {
    const hs = sectionHeadings(read('README.md'));
    expect(hs.length).toBeGreaterThan(0);
    expect(hs.filter(h => !EMOJI.test(h))).toEqual([]);
  });

  test('the same section kind carries the same emoji across the docs', () => {
    const emojiOf = (file: string) => new Map(sectionHeadings(read(file)).map(h => [h.replace(EMOJI, ''), EMOJI.exec(h)?.[0].trim()]));
    const root = emojiOf('README.md');
    const about = emojiOf('ABOUT.md');
    expect(about.get('Read in this order')).toBe(root.get('Learn more'));
    expect(emojiOf('docs/getting-started.md').get('Next')).toBe(root.get('Learn more'));
    expect(about.get('Bring your own skills')).toBe(about.get('Skills from the community'));
    for (const file of ['ABOUT.md', 'docs/getting-started.md']) {
      expect(sectionHeadings(read(file)).filter(h => !EMOJI.test(h))).toEqual([]);
    }
  });
});

describe('docs/getting-started.md', () => {
  test('getting started commands exist', () => {
    const lines = fencedCommands(read('docs/getting-started.md'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map(l => [l, unknownCommand(l)]).filter(([, why]) => why)).toEqual([]);
  });

  test('getting started covers every harness', () => {
    const text = read('docs/getting-started.md');
    for (const h of HARNESSES) expect(text).toContain(h.id === 'claude' ? 'claude plugin install' : `setup --harness ${h.id}`);
    expect(text).toContain('/forger-setup');
    expect(text).toContain('$forger-setup');
  });

  test('an unknown command is caught', () => {
    expect(unknownCommand('/forger-nope')).toContain('/forger-nope');
    expect(unknownCommand('$forger-work')).toBeNull();
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
