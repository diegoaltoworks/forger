import {describe, expect, test} from 'bun:test';

import {tmpdir} from 'os';

import {execCapture, execRunner} from './exec';

describe('execCapture', () => {
  const run = execCapture(tmpdir());

  test('a success gives trimmed stdout and exit 0', () => {
    expect(run('echo hi')).toEqual({stdout: 'hi', stderr: '', exitCode: 0});
  });

  test('a failure keeps its stderr and exit code', () => {
    expect(run("sh -c 'echo partial; echo why >&2; exit 3'")).toEqual({stdout: 'partial', stderr: 'why', exitCode: 3});
  });
});

describe('execRunner', () => {
  test('gives trimmed stdout, and empty output on a failure', () => {
    const run = execRunner(tmpdir());
    expect(run('echo hi')).toBe('hi');
    expect(run("sh -c 'exit 2' 2>/dev/null")).toBe('');
  });
});
