import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {formatBytes, freeBytes, isOutOfSpace, makeScratch, outOfSpaceMessage, removeScratch} from './scratch';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

describe('isOutOfSpace', () => {
  test('knows the codes and the messages of a full disk or quota', () => {
    expect(isOutOfSpace(Object.assign(new Error('x'), {code: 'ENOSPC'}))).toBe(true);
    expect(isOutOfSpace(Object.assign(new Error('x'), {code: 'EDQUOT'}))).toBe(true);
    expect(isOutOfSpace(new Error('write /tmp/a: No space left on device'))).toBe(true);
    expect(isOutOfSpace(new Error('error: Disk quota exceeded'))).toBe(true);
    expect(isOutOfSpace(new Error('bun install failed: EDQUOT'))).toBe(true);
  });

  test('anything else is not', () => {
    expect(isOutOfSpace(new Error('fatal: bad object'))).toBe(false);
    expect(isOutOfSpace(Object.assign(new Error('x'), {code: 'EACCES'}))).toBe(false);
    expect(isOutOfSpace(null)).toBe(false);
  });
});

describe('outOfSpaceMessage', () => {
  test('names the folder, the free space and the cause', () => {
    expect(outOfSpaceMessage('/p/.forger/tmp', 1536, 'EDQUOT')).toBe('out of space in /p/.forger/tmp (1.5 KiB free): EDQUOT');
    expect(outOfSpaceMessage('/p/.forger/tmp', null, 'EDQUOT')).toBe('out of space in /p/.forger/tmp (free space unknown): EDQUOT');
  });

  test('formats bytes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB');
  });
});

describe('scratch folders', () => {
  test('are made under a root that is created when missing, and removed with their contents', () => {
    const base = mkdtempSync(join(tmpdir(), 'forger-scratch-test-'));
    dirs.push(base);
    const dir = makeScratch(join(base, 'tmp'), 'verify-1-');
    expect(dir.startsWith(join(base, 'tmp', 'verify-1-'))).toBe(true);
    writeFileSync(join(dir, 'f'), 'x');
    removeScratch(dir);
    expect(existsSync(dir)).toBe(false);
  });

  test('the free space of a real folder is a number, of a missing one null', () => {
    expect(typeof freeBytes(tmpdir())).toBe('number');
    expect(freeBytes('/no/such/folder/here')).toBeNull();
  });
});
