import {describe, expect, test} from 'bun:test';

import {ensureClosesLine, validatePrBody} from './pr-body';

describe('validatePrBody', () => {
  const expect_ = {issue: 149, sections: ['Design to review']};
  const good = 'What and why.\n\n## Design to review\n\n- a thing\n\nCloses #149\n';

  test('a body with the closing line and the sections passes', () => {
    expect(validatePrBody(good, expect_)).toEqual({ok: true, problems: []});
  });

  test('a skill body without the closing line fails', () => {
    const r = validatePrBody('Summary\n\n## Design to review\n', expect_);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['the body does not carry "Closes #149" on its own line']);
  });

  test('a different issue number does not satisfy the check', () => {
    expect(validatePrBody('Closes #1490\n## Design to review', expect_).ok).toBe(false);
  });

  test('a missing section is named', () => {
    const r = validatePrBody('Closes #149', expect_);
    expect(r.problems).toEqual(['the body has no "Design to review" section heading']);
  });

  test('a section title in prose is not a heading', () => {
    expect(validatePrBody('Closes #149\nDesign to review is below', expect_).ok).toBe(false);
  });

  test('an empty body fails; no issue and no sections expects nothing else', () => {
    expect(validatePrBody('', {issue: null, sections: []}).ok).toBe(false);
    expect(validatePrBody('text', {issue: null, sections: []}).ok).toBe(true);
  });
});

describe('ensureClosesLine', () => {
  test('appends the line when missing and leaves a complete body alone', () => {
    const out = ensureClosesLine('Summary  \n', 7);
    expect(validatePrBody(out, {issue: 7, sections: []}).ok).toBe(true);
    expect(ensureClosesLine(out, 7)).toBe(out);
  });

  test('without an issue the body is unchanged', () => {
    expect(ensureClosesLine('x', null)).toBe('x');
  });
});
