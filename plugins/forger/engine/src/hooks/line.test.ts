import {describe, expect, test} from 'bun:test';

import {hookCommandLine} from './line';

/** Runs the line through a shell with exactly the environment given. */
function run(call: string, env: Record<string, string>): {status: number | null; stdout: string; stderr: string} {
  const r = Bun.spawnSync(['sh', '-c', hookCommandLine(call)], {env: {PATH: process.env.PATH ?? '', ...env}, stdin: Buffer.from('{}')});
  return {status: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString()};
}

const worker = {FORGER_ROLE: 'worker'};

describe('the hook line', () => {
  test('the hook line refuses a worker\'s call when the hook cannot run', () => {
    for (const call of ['sh -c "exit 7"', 'no-such-command-forger-482', 'sh -c "kill -9 \\$\\$"']) {
      const r = run(call, worker);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('forger hook could not run');
      expect(r.stderr).toContain('this call is refused');
      expect(r.stderr).toMatch(/status \d+/);
    }
  });

  test('the hook line passes a refusal and an allowed call through with their status', () => {
    for (const env of [worker, {} as Record<string, string>]) {
      const refused = run('sh -c "echo use the merge tool >&2; exit 2"', env);
      expect(refused).toMatchObject({status: 2, stderr: 'use the merge tool\n'});
      const allowed = run('echo fine', env);
      expect(allowed).toMatchObject({status: 0, stdout: 'fine\n', stderr: ''});
    }
  });

  test('the hook line lets a session that is not a worker through and says it is not guarded', () => {
    for (const env of [{} as Record<string, string>, {FORGER_ROLE: 'supervisor'}]) {
      const r = run('sh -c "exit 7"', env);
      expect(r.status).toBe(7);
      expect(r.stderr).toContain('forger hook could not run (status 7); this session is not guarded');
    }
  });
});
