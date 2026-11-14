import {afterEach, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {parseCommandLog} from '../loop';
import {main} from './main';

const startCwd = process.cwd();
const dirs: string[] = [];
afterEach(() => {
  process.chdir(startCwd);
  process.exitCode = 0;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function copy(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'run-logged-')));
  dirs.push(d);
  mkdirSync(join(d, 'app'));
  return d;
}

async function runLogged(argv: string[]): Promise<void> {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    await main(['run-logged', ...argv]);
  } finally {
    process.stdout.write = write;
  }
}

test('run-logged keeps an argument that holds a space as one argument', async () => {
  const d = copy();
  const log = join(d, 'log.jsonl');
  await runLogged(['--file', log, '--', 'printf', '%s|', 'one two', 'three']);
  const [run] = parseCommandLog(readFileSync(log, 'utf-8'));
  expect(run.exit).toBe(0);
  expect(run.output).toBe('one two|three|');
  expect(run.command).toBe(`printf '%s|' 'one two' three`);
});

test('run-logged records the folder a command ran in, relative to the copy', async () => {
  const d = copy();
  const log = join(d, 'log.jsonl');
  process.chdir(d);
  await runLogged(['--file', log, '--root', d, '--', 'true']);
  process.chdir(join(d, 'app'));
  await runLogged(['--file', log, '--root', d, '--', 'true']);
  expect(parseCommandLog(readFileSync(log, 'utf-8')).map(r => r.dir)).toEqual(['.', 'app']);
});

test('run-logged keeps the result lines of a long output and marks the record truncated', async () => {
  const d = copy();
  const log = join(d, 'log.jsonl');
  await runLogged(['--file', log, '--', `echo '(pass) early test'; head -c 300000 /dev/zero | tr '\\0' x`]);
  const [run] = parseCommandLog(readFileSync(log, 'utf-8'));
  expect(run.truncated).toBe(true);
  expect(run.output).toContain('(pass) early test');
  expect(run.output.length).toBeLessThan(201_000);
});
