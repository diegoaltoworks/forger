import {describe, expect, test} from 'bun:test';

import {checkTicketCriteria, classifyCriterion, subjectiveWordsIn} from './criteria';

describe('classifyCriterion', () => {
  test('a vague criterion fails and names the subjective word', () => {
    const v = classifyCriterion('Relief sharpens at the ridges');
    expect(v.ok).toBe(false);
    expect(v.subjective).toEqual(['sharpens']);
    expect(v.problem).toContain('"sharpens"');
  });

  test('a threshold with no source fails', () => {
    const v = classifyCriterion('The slope error is at most 0.05 deg');
    expect(v.ok).toBe(false);
    expect(v.problem).toContain('no source');
  });

  test('restated criteria pass, one per form', () => {
    expect(classifyCriterion('The classifier is a pure function, tested with the real criteria').form).toBe('test');
    expect(classifyCriterion('`ridge.test.ts` passes').form).toBe('test');
    expect(classifyCriterion('`bun run check` exits 0').form).toBe('command');
    expect(classifyCriterion('Gates green').form).toBe('command');
    expect(classifyCriterion('Slope error is at most 0.2 deg, the thresholds row "slope" of the spike').form).toBe('number');
    expect(classifyCriterion('The empty state shows the prompt', {uiStates: ['empty state']}).form).toBe('ui');
    expect(classifyCriterion('The "loading" UI state has a screenshot under docs/screenshots').form).toBe('ui');
  });

  test('a citation of a thresholds row from the spike template passes', () => {
    const v = classifyCriterion('Slope error is within the `slope` row of the thresholds table in the spike');
    expect(v.ok).toBe(true);
    expect(v.form).toBe('number');
  });

  test('a subjective word fails even beside a checkable form', () => {
    expect(classifyCriterion('`bun run check` exits 0 and is fast').ok).toBe(false);
  });

  test('a hyphenated compound is not the subjective word', () => {
    expect(subjectiveWordsIn('uses fast-forward only')).toEqual([]);
  });

  test('the project extends the word list', () => {
    expect(classifyCriterion('`bun test` passes and the page feels snappy', {subjectiveWords: ['snappy']}).ok).toBe(false);
  });

  test('a plain statement takes no form', () => {
    const v = classifyCriterion('The settings page works');
    expect(v.form).toBeNull();
    expect(v.problem).toContain('four checkable forms');
  });
});

describe('checkTicketCriteria', () => {
  test('reads the Acceptance section and names each failing criterion', () => {
    const body = '## Acceptance\n- [ ] Relief sharpens\n- [ ] Gates green\n\n## Knock-on\n- [ ] ignored';
    const r = checkTicketCriteria(body);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('Relief sharpens');
  });

  test('a ticket with no criteria fails', () => {
    expect(checkTicketCriteria('just prose').ok).toBe(false);
  });

  test('a ticket whose criteria all pass is ok', () => {
    expect(checkTicketCriteria('## Acceptance\n- [ ] `bun test` passes\n- [ ] Gates green').ok).toBe(true);
  });
});

describe('quoted expected output', () => {
  test('a subjective word inside a quoted expected output is not flagged', () => {
    expect(subjectiveWordsIn('`work.ts check hooks` prints "hooks check: clean"')).toEqual([]);
    expect(subjectiveWordsIn("the command reports 'all clean' and exits 0")).toEqual([]);
  });

  test('a subjective word outside the quotes is still flagged', () => {
    expect(subjectiveWordsIn('the code is clean and prints "ok"')).toEqual(['clean']);
  });
});

describe('text-only criteria warning', () => {
  const WARN = 'name a test or a journey';
  const ticket = (criteria: string[], knock = '`src/a.ts`') => `## Acceptance\n${criteria.map(c => `- [ ] ${c}`).join('\n')}\n\n## Placement\n\nnone\n\n## Knock-on\n\n${knock}\n`;
  const warned = (body: string) => checkTicketCriteria(body).warnings.some(w => w.includes(WARN));

  test('a ticket whose criteria are all text counts or listings gets the warning', () => {
    const body = ticket(['`grep -c "retry" src/a.ts` prints a number of at least 1', '`ls src/a.ts` exits 0', '`test -f src/b.ts` exits 0', '`cat a.txt | wc -l` prints 3']);
    expect(warned(body)).toBe(true);
    expect(checkTicketCriteria(body).ok).toBe(true);
  });

  test('one criterion that names a test is enough to drop the warning', () => {
    expect(warned(ticket(['`grep -c "x" a.ts` prints 1', 'Test `retries once` passes']))).toBe(false);
  });

  test('Gates green and check docs are not counted either way', () => {
    expect(warned(ticket(['`grep -c "x" a.ts` prints 1', 'Gates green', '`bun work.ts check docs` exits 0']))).toBe(true);
    expect(warned(ticket(['Gates green', '`bun work.ts check docs` exits 0']))).toBe(false);
  });

  test('a ticket that touches only Markdown gets no warning', () => {
    expect(warned(ticket(['`grep -c "x" docs/a.md` prints 1'], '`docs/a.md`'))).toBe(false);
  });
});
