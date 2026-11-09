import {describe, expect, test} from 'bun:test';

import {checkTicketCriteria} from './criteria';

const base = '## Acceptance\n- [ ] `bun run check` exits 0\n\n## Guards\n\nnone\n\n## Placement\n\nnone\n';

describe('absolute UI rules', () => {
  test('check ticket warns on an absolute UI rule with no measured number', () => {
    const r = checkTicketCriteria(`${base}\n## UI states\n\nThe label never shrinks.\n`);
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toContain('with no measured number');
  });

  test('a named ui.json state counts as a UI state', () => {
    const r = checkTicketCriteria(`${base}\nIn the checkout-error state the title is always one line.\n`, {uiStates: ['checkout-error']});
    expect(r.warnings.join('\n')).toContain('"always one line"');
  });

  test('a measured number silences the warning', () => {
    const r = checkTicketCriteria(`${base}\n## UI states\n\nThe label never shrinks. measure: 212px of 240px at 200%.\n`);
    expect(r.warnings).toEqual([]);
  });

  test('a ticket with no UI states is left alone', () => {
    expect(checkTicketCriteria(`${base}\nThe cache never shrinks.\n`).warnings).toEqual([]);
  });
});
