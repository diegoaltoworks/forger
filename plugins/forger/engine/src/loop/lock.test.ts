import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {RunnerLock, decideLock, parsePid, pidAlive} from './lock';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

describe('decideLock', () => {
  const alive = (pids: number[]) => (p: number) => pids.includes(p);

  test('no lock is acquired', () => {
    expect(decideLock(null, 10, alive([]))).toEqual({action: 'acquire'});
  });
  test('a live holder refuses', () => {
    expect(decideLock('99\n', 10, alive([99]))).toEqual({action: 'refuse', holder: 99});
  });
  test('a dead holder is taken over', () => {
    expect(decideLock('99', 10, alive([]))).toEqual({action: 'takeover', stalePid: 99});
  });
  test('garbage holds nothing', () => {
    expect(decideLock('not a pid', 10, alive([]))).toEqual({action: 'takeover', stalePid: null});
  });
  test('our own pid is ours', () => {
    expect(decideLock('10', 10, alive([10]))).toEqual({action: 'acquire'});
  });
});

describe('parsePid', () => {
  test('accepts positive integers only', () => {
    expect(parsePid('42\n')).toBe(42);
    expect(parsePid('0')).toBeNull();
    expect(parsePid('-3')).toBeNull();
    expect(parsePid('1.5')).toBeNull();
    expect(parsePid('')).toBeNull();
    expect(parsePid(null)).toBeNull();
  });
});

describe('pidAlive', () => {
  test('sees this process and not an impossible pid', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe('RunnerLock', () => {
  function file(): string {
    const d = mkdtempSync(join(tmpdir(), 'forger-lock-'));
    dirs.push(d);
    return join(d, 'runner.lock');
  }

  test('writes its pid and releases it', () => {
    const f = file();
    const lock = new RunnerLock(f, 10, () => false);
    expect(lock.acquire().ok).toBe(true);
    expect(readFileSync(f, 'utf-8')).toBe('10');
    lock.release();
    expect(existsSync(f)).toBe(false);
  });

  test('refuses while a live runner holds it and leaves the lock alone', () => {
    const f = file();
    writeFileSync(f, '99');
    const lock = new RunnerLock(f, 10, p => p === 99);
    expect(lock.acquire()).toEqual({ok: false, holder: 99});
    lock.release();
    expect(readFileSync(f, 'utf-8')).toBe('99');
  });

  test('takes over a lock whose pid is dead', () => {
    const f = file();
    writeFileSync(f, '99');
    const lock = new RunnerLock(f, 10, () => false);
    expect(lock.acquire()).toEqual({ok: true, tookOver: 99});
    expect(readFileSync(f, 'utf-8')).toBe('10');
  });

  test('liveHolder reports only a live pid', () => {
    const f = file();
    writeFileSync(f, '99');
    expect(new RunnerLock(f, 10, () => true).liveHolder()).toBe(99);
    expect(new RunnerLock(f, 10, () => false).liveHolder()).toBeNull();
    expect(new RunnerLock(f, 10, () => false).holder()).toBe(99);
  });
});
