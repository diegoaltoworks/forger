import {describe, expect, test} from 'bun:test';

import {checkText, denylist, email, formatViolations, homePath, isShipped, modelNames, nonAscii, parseDenylist, thirdPartySkills} from './docs-rules';

const EM_DASH = '\u2014';
const CURLY = '\u201C';

describe('nonAscii', () => {
  test('flags typographic punctuation with its code point', () => {
    expect(nonAscii(`a ${EM_DASH} b ${CURLY}c`)).toEqual(['U+2014', 'U+201C']);
  });
  test('passes plain ASCII', () => {
    expect(nonAscii('a - b "c" ... -> <=')).toEqual([]);
  });
});

describe('email', () => {
  test('flags an address', () => {
    expect(email('mail ' + 'someone' + '@' + 'example.com now')).toEqual(['someone' + '@' + 'example.com']);
  });
  test('ignores scoped package names and bare at-signs', () => {
    expect(email('@types/bun and a @ b and @forger/engine')).toEqual([]);
  });
});

describe('homePath', () => {
  test('flags linux and mac home directories', () => {
    expect(homePath('see ' + '/ho' + 'me/' + 'x/y and ' + '/Us' + 'ers/' + 'z')).toEqual(['/ho' + 'me/x', '/Us' + 'ers/z']);
  });
  test('ignores home as an ordinary word', () => {
    expect(homePath('go home, or ~/work')).toEqual([]);
  });
});

describe('denylist', () => {
  test('parseDenylist drops blanks and comments', () => {
    expect(parseDenylist('Acme\n\n# note\n  widget  \n')).toEqual(['Acme', 'widget']);
  });
  test('matches case-insensitively and reports the term', () => {
    expect(denylist(['Acme'])('built for ACME corp')).toEqual(['Acme']);
  });
  test('no terms means no hits', () => {
    expect(denylist([])('anything')).toEqual([]);
  });
});

describe('checkText', () => {
  test('reports file, 1-based line and rule in line order', () => {
    const v = checkText('docs/a.md', `ok\nbad ${EM_DASH}\nAcme here`, ['acme']);
    expect(v.map(x => [x.file, x.line, x.rule])).toEqual([
      ['docs/a.md', 2, 'non-ascii'],
      ['docs/a.md', 3, 'denylist'],
    ]);
  });
  test('clean text has no violations', () => {
    expect(checkText('a.md', 'plain\ntext', [])).toEqual([]);
  });
  test('formats file:line and rule, or says clean', () => {
    expect(formatViolations(checkText('a.md', EM_DASH))).toBe('a.md:1: non-ascii: U+2014');
    expect(formatViolations([])).toBe('docs check: clean');
  });
});

describe('thirdPartySkills', () => {
  test('flags a collection name and skill-tool hooks', () => {
    expect(thirdPartySkills('install mattpocock-skills')).toEqual(['mattpocock']);
    expect(thirdPartySkills('call the Skill tool with "tdd"')).toHaveLength(1);
    expect(thirdPartySkills('Skill with `coll:review`')).toHaveLength(1);
    expect(thirdPartySkills('use the matt pocock skills')).toHaveLength(1);
  });
  test('flags the collection tracker doc', () => {
    expect(thirdPartySkills('see docs/agents/issue-tracker.md')).toEqual(['docs/agents/issue-tracker.md']);
  });
  test('flags /to-tickets', () => {
    expect(thirdPartySkills('published by `/to-tickets`')).toEqual(['/to-tickets']);
  });
  test('flags /triage', () => {
    expect(thirdPartySkills('run /triage first')).toEqual(['/triage']);
  });
  test('does not flag paths that merely contain triage', () => {
    expect(thirdPartySkills('src/triage/index.ts')).toEqual([]);
  });
  test('a slot-based skill step is clean', () => {
    expect(thirdPartySkills('invoke the skill that `skills --json` resolves for the review slot')).toEqual([]);
  });
  test('plain prose is clean', () => {
    expect(thirdPartySkills('write the failing test first')).toEqual([]);
  });
  test('applies only to shipped prose', () => {
    expect(isShipped('plugins/forger/commands/plan.md')).toBe(true);
    expect(isShipped('plugins/forger/templates/process.md')).toBe(true);
    expect(isShipped('plugins/forger/README.md')).toBe(false);
    expect(isShipped('docs/07-roadmap.md')).toBe(false);
    expect(checkText('docs/a.md', 'mattpocock-skills')).toEqual([]);
    expect(checkText('README.md', 'install mattpocock-skills, then call the Skill tool with "x:y"')).toEqual([]);
    expect(checkText('plugins/forger/presets/a.json', '"mattpocock-skills:grilling"')).toEqual([]);
    expect(checkText('plugins/forger/commands/a.md', 'mattpocock-skills').map(v => v.rule)).toEqual(['third-party-skills']);
  });
});

describe('model-agnostic', () => {
  const names = ['claude', 'opus', 'openai'];
  test.each([
    ['A Claude Code session', ['Claude']],
    ['run the `claude` CLI', ['claude']],
    ['the Opus tier and OpenAI', ['Opus', 'OpenAI']],
  ])('flags %s', (line, found) => {
    expect(modelNames(names)(line)).toEqual(found);
  });
  test.each(['see .forger/process.md', 'a worker on the deep tier', 'the opus-like path', 'src/claude/x.ts', 'opuscule'])(
    'does not flag %s',
    line => {
      expect(modelNames(names)(line)).toEqual([]);
    }
  );
  test('an empty list flags nothing', () => {
    expect(modelNames([])('Claude')).toEqual([]);
  });
  test('applies to Markdown outside the adapter docs, and is waivable by opinion', () => {
    const v = checkText('docs/a.md', 'a Claude session', [], names);
    expect(v.map(x => [x.rule, x.opinion])).toEqual([['model-agnostic', 'base.model-agnostic']]);
    expect(checkText('README.md', 'a Claude session', [], names)).toEqual([]);
    expect(checkText('docs/getting-started.md', 'a Claude session', [], names)).toEqual([]);
    expect(checkText('docs/reference/adapters.md', 'a Claude session', [], names)).toEqual([]);
    expect(checkText('plugins/forger/README.md', 'a Claude session', [], names).map(x => x.rule)).toEqual(['model-agnostic']);
    expect(checkText('docs/skills/pstack.md', 'a Claude session', [], names)).toEqual([]);
    expect(checkText('plugins/forger/engine/src/adapters/README.md', 'claude', [], names)).toEqual([]);
    expect(checkText('src/a.ts', '// claude', [], names)).toEqual([]);
  });
});
