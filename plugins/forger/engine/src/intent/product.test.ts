import {describe, expect, test} from 'bun:test';

import {parseProductBrief} from './product';

const brief = `# Notes app

## Who it is for

People who keep meeting notes and lose them.

## What they must be able to do

- Capture a note: open the app and type, with no setup.
- Find a note: search by a word and open the match.
  It works with a typo.

## How success shows

A new user finds an old note in under a minute.

## Out

Sharing and sync.
`;

describe('parseProductBrief', () => {
  test('a brief with all four sections parses with no problems', () => {
    const parsed = parseProductBrief(brief);
    expect(parsed.problems).toEqual([]);
    expect(parsed.who).toBe('People who keep meeting notes and lose them.');
    expect(parsed.success).toBe('A new user finds an old note in under a minute.');
    expect(parsed.out).toBe('Sharing and sync.');
  });

  test('a missing section is a problem that names it', () => {
    const parsed = parseProductBrief(brief.replace('## Out\n\nSharing and sync.\n', ''));
    expect(parsed.problems).toEqual(['missing section "## Out"']);
    expect(parseProductBrief('').problems).toHaveLength(4);
  });

  test('an empty section, or one holding only a placeholder, is a problem that names it', () => {
    const parsed = parseProductBrief(brief.replace('A new user finds an old note in under a minute.', '<how anyone would know>\n<!-- hint -->'));
    expect(parsed.problems).toEqual(['empty section "## How success shows"']);
  });

  test('the journeys are the list items under What they must be able to do', () => {
    const parsed = parseProductBrief(brief);
    expect(parsed.journeys).toEqual([
      'Capture a note: open the app and type, with no setup.',
      'Find a note: search by a word and open the match. It works with a typo.',
    ]);
  });

  test('numbered items count and placeholder items do not', () => {
    const parsed = parseProductBrief(brief.replace(/- Capture[^\n]*\n- Find[^\n]*\n[^\n]*\n/, '1. Sign in\n2) Log out\n- <journey>\n'));
    expect(parsed.journeys).toEqual(['Sign in', 'Log out']);
  });

  test('headings match without regard to case, and prose before a heading belongs to nothing', () => {
    const parsed = parseProductBrief(brief.replace('## Out', '## out'));
    expect(parsed.out).toBe('Sharing and sync.');
    expect(parsed.who).not.toContain('Notes app');
  });

  test('a heading inside a code fence is not a section', () => {
    const parsed = parseProductBrief(`${brief}\n\`\`\`\n## Extra\n\`\`\`\n`);
    expect(parsed.out).toContain('Sharing and sync.');
  });

  test('an unrelated heading ends the section before it', () => {
    const parsed = parseProductBrief(brief.replace('## How success shows', '## Notes\n\nstray\n\n## How success shows'));
    expect(parsed.who).toBe('People who keep meeting notes and lose them.');
    expect(parsed.journeys).toHaveLength(2);
  });
});
