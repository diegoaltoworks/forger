import {describe, expect, test} from 'bun:test';

import {parseSchedule, scheduleLine, type ScheduleRecord} from '../loop';
import {formatIterationLog} from '../loop';
import {computeMeasures, formatMeasures, parseIterationLog} from './measure';
import {computeParallelMeasures, type RunFact} from './parallel-measures';

const T0 = Date.parse('2026-01-01T00:00:00Z');
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

function run(iteration: number, ticket: string, status: string, startMin: number, minutes: number, parallelism: number | null): RunFact {
  return {iteration, ticket, status, startedAt: at(startMin), elapsedSeconds: minutes * 60, parallelism};
}
const decision = (ticket: string, other: string, verdict: 'parallel' | 'serial', reason: string): ScheduleRecord => ({at: at(0), ticket, other, verdict, reason});

describe('merges per hour by parallelism', () => {
  test('overlapping workers count the wall clock once', () => {
    const m = computeParallelMeasures(
      [run(1, 'a', 'completed', 0, 30, 1), run(2, 'b', 'completed', 30, 30, 1), run(3, 'c', 'completed', 120, 60, 2), run(4, 'd', 'completed', 120, 60, 2), run(5, 'e', 'failed', 180, 60, 2)],
      []
    );
    expect(m.by_parallelism).toEqual([
      {parallelism: 1, merges: 2, wall_seconds: 3600, merges_per_hour: 2},
      {parallelism: 2, merges: 2, wall_seconds: 7200, merges_per_hour: 1},
    ]);
  });
  test('a log without the setting is one worker at a time, summed', () => {
    const old: RunFact = {iteration: 1, ticket: 'a', status: 'completed', startedAt: null, elapsedSeconds: 1800, parallelism: null};
    expect(computeParallelMeasures([old], []).by_parallelism).toEqual([{parallelism: 1, merges: 1, wall_seconds: 1800, merges_per_hour: 2}]);
  });
  test('no runs, no rates', () => {
    expect(computeParallelMeasures([], []).by_parallelism).toEqual([]);
  });
});

describe('conflicts and rework', () => {
  const runs = [
    run(1, 'a', 'completed', 0, 20, 2),
    run(2, 'b', 'conflict', 5, 20, 2),
    run(3, 'c', 'completed', 100, 10, 2),
    run(4, 'b', 'completed', 200, 10, 1),
    run(5, 'd', 'conflict', 300, 10, 1),
  ];
  const m = computeParallelMeasures(runs, []);
  test('rate is conflicts over merged-or-conflicted runs', () => {
    expect(m.conflicts.conflicted).toBe(2);
    expect(m.conflicts.rate).toBe(2 / 5);
  });
  test('pairs are the tickets that overlapped a conflicted run', () => {
    expect(m.conflicts.pairs).toEqual([['a', 'b']]);
  });
  test('a ticket re-run after a conflict is rework', () => {
    expect(m.rework.rerun_after_conflict).toBe(1);
  });
});

describe('verdict mix', () => {
  test('counts verdicts and reasons', () => {
    const m = computeParallelMeasures([], [
      decision('a', 'b', 'parallel', 'disjoint'),
      decision('c', 'b', 'serial', 'same-folder'),
      decision('d', 'b', 'serial', 'same-folder'),
      decision('e', 'b', 'serial', 'unknown-footprint'),
    ]);
    expect(m.verdicts).toEqual({parallel: 1, serial: 3, serial_share: 0.75, by_reason: {disjoint: 1, 'same-folder': 2, 'unknown-footprint': 1}});
  });
  test('no decisions is a zero share', () => {
    expect(computeParallelMeasures([], []).verdicts.serial_share).toBe(0);
  });
});

describe('the files the measures read', () => {
  test('the iteration log round-trips start time and parallelism', () => {
    const text = formatIterationLog({iteration: 7, ticket: 't', elapsedSeconds: 60, exitCode: 0, signal: null, timedOut: false, timeoutMinutes: 45, output: '', status: 'completed', startedAt: at(0), parallelism: 2});
    expect(parseIterationLog(text)).toMatchObject({startedAt: at(0), parallelism: 2, status: 'completed'});
  });
  test('schedule lines parse back and a torn line is skipped', () => {
    const r = decision('a', 'b', 'serial', 'dependent');
    expect(parseSchedule(`${scheduleLine(r)}{"tic\n`)).toEqual([r]);
  });
  test('computeMeasures carries the section through to json and text', () => {
    const iterations = [{iteration: 1, ticket: 'a', elapsedSeconds: 1800, cause: 'ok' as const, status: 'completed', startedAt: at(0), parallelism: 1}];
    const m = computeMeasures({iterations, budgets: [], events: [], ciRuns: [], last: null, schedule: [decision('a', 'b', 'serial', 'dependent')]});
    expect(m.parallel.by_parallelism[0].merges_per_hour).toBe(2);
    expect(JSON.parse(JSON.stringify(m)).parallel.verdicts.serial).toBe(1);
    expect(formatMeasures(m)).toContain('scheduling rule: serial 100% (1 of 1): dependent 1');
  });
});
