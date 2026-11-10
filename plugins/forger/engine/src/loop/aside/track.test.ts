import {describe, expect, test} from 'bun:test';

import {avoidedFootprints, setAsideUpdate, type SetAsideEntry} from './track';

const entry = (ticket: string, paths: string[] | null = null): SetAsideEntry => ({
  ticket,
  reason: `${ticket} stopped`,
  iteration: 1,
  footprint: paths ? {paths, modules: []} : null,
});

describe('setAsideUpdate', () => {
  test('a set-aside is kept and counted without halting while the run is short', () => {
    const u = setAsideUpdate([], 0, entry('issue-1'), false, 3);
    expect(u.set_aside_tasks.map(e => e.ticket)).toEqual(['issue-1']);
    expect(u.consecutive_set_asides).toBe(1);
    expect(u.halt).toBeNull();
  });

  test('maxSetAside tickets set aside in a row halts the loop, naming each', () => {
    let u = setAsideUpdate([], 0, entry('issue-1'), false, 3);
    u = setAsideUpdate(u.set_aside_tasks, u.consecutive_set_asides, entry('issue-2'), false, 3);
    expect(u.halt).toBeNull();
    u = setAsideUpdate(u.set_aside_tasks, u.consecutive_set_asides, entry('issue-3'), false, 3);
    expect(u.consecutive_set_asides).toBe(3);
    expect(u.halt).toContain('Set aside 3 tickets in a row with no merge between them: issue-1, issue-2, issue-3');
  });

  test('a merge between two set-asides resets the count', () => {
    let u = setAsideUpdate([], 0, entry('issue-1'), false, 2);
    u = setAsideUpdate(u.set_aside_tasks, u.consecutive_set_asides, null, true, 2);
    expect(u.consecutive_set_asides).toBe(0);
    u = setAsideUpdate(u.set_aside_tasks, u.consecutive_set_asides, entry('issue-2'), false, 2);
    expect(u.consecutive_set_asides).toBe(1);
    expect(u.halt).toBeNull();
  });

  test('a run that is not a merge and sets nothing aside leaves the count alone', () => {
    expect(setAsideUpdate([entry('issue-1')], 1, null, false, 3).consecutive_set_asides).toBe(1);
  });

  test('a ticket set aside twice is listed once, with the latest reason', () => {
    const again = {...entry('issue-1'), reason: 'second'};
    const u = setAsideUpdate([entry('issue-1')], 1, again, false, 9);
    expect(u.set_aside_tasks).toEqual([again]);
  });
});

describe('avoidedFootprints', () => {
  test('lists the declared footprints and leaves out a ticket that declared none', () => {
    const avoided = avoidedFootprints([entry('issue-1', ['src/loop/outcome.ts']), entry('issue-2')]);
    expect(avoided).toEqual([{paths: ['src/loop/outcome.ts'], modules: []}]);
  });
});
