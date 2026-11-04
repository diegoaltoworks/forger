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
