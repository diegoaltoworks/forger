import {describe, expect, test} from 'bun:test';

import {checkObservation, type Observation} from './assertions';

const good: Observation = {
  home: '/tmp/h',
  project: '/tmp/h/project',
  forgerDirs: ['/tmp/h/project'],
  config: '{"gates": "bun test && bun \\"$FORGER_PLUGIN_ROOT/bin/work.ts\\" check"}',
  detected: ['docs', 'testing'],
  coverage: {report_present: false, gates_write_report: true},
  reportWritten: true,
};

const issues = (o: Observation) => checkObservation(o).map(f => f.issue);

describe('setup fixture assertions', () => {
  test('a correct setup has no failures', () => {
    expect(checkObservation(good)).toEqual([]);
  });

  test('fails on a .forger/ written into the home directory (#183)', () => {
    expect(issues({...good, forgerDirs: ['/tmp/h']})).toEqual([183]);
  });

  test('fails when setup found no project root at all (#183)', () => {
    expect(issues({...good, forgerDirs: []})).toEqual([183]);
  });

  test('fails on an absolute home path in the config (#184)', () => {
    expect(issues({...good, config: '{"gates": "bun /tmp/h/plugin/bin/work.ts check"}'})).toEqual([184]);
    expect(issues({...good, config: `{"gates": "bun ${['', 'home', 'dev'].join('/')}/x/bin/work.ts check"}`})).toEqual([184]);
  });

  test('fails when the testing pack is not detected (#185)', () => {
    expect(issues({...good, detected: ['docs']})).toEqual([185]);
  });

  test('fails when setup gives no coverage advice (#186)', () => {
    expect(issues({...good, coverage: undefined})).toEqual([186]);
  });

  test('fails when the gates do not write the coverage report (#186)', () => {
    expect(issues({...good, coverage: {report_present: false, gates_write_report: false}})).toEqual([186]);
    expect(issues({...good, reportWritten: false})).toEqual([186]);
  });
});
