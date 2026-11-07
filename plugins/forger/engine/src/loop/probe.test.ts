import {describe, expect, test} from 'bun:test';

import {checkProbes, failedProbe, parseProbes, probeFailureComment, probePromptSection, runProbes} from './probe';
import {checkTicketCriteria} from './criteria';

const ok = (stdout: string, exitCode = 0) => ({stdout, stderr: '', exitCode});

const ticket = (probe: string) => `## Acceptance\n\n- [ ] \`bun test\` exits 0\n\n## Probe\n\n${probe}\n\n## Guards\n\nnone\n`;

describe('parseProbes', () => {
  test('reads each form and treats none or a missing section as no probe', () => {
    const probes = parseProbes(ticket('- `a` exits 0\n- `b` prints "ready"\n- `c` prints a number of at least 3'));
    expect(probes.map(p => p.expectation)).toEqual([
      {kind: 'exit', code: 0},
      {kind: 'prints', text: 'ready'},
      {kind: 'at-least', n: 3},
    ]);
    expect(parseProbes(ticket('none'))).toEqual([]);
    expect(parseProbes(ticket('- none'))).toEqual([]);
    expect(parseProbes('## Acceptance\n\n- [ ] `x` exits 0\n')).toEqual([]);
  });

  test('ignores the template comment that shows the forms', () => {
    expect(parseProbes(ticket('<!-- - `cmd` exits 0 -->'))).toEqual([]);
  });
});

describe('check ticket', () => {
  test('refuses a probe line with no expected result', () => {
    const body = ticket('- `identify -format %w logo.png`');
    expect(checkProbes(body)).toEqual([expect.stringContaining('has no expected result')]);
    const check = checkTicketCriteria(body);
    expect(check.ok).toBe(false);
    expect(check.problems.join('\n')).toContain('identify -format %w logo.png');
  });

  test('refuses a probe line with no command', () => {
    expect(checkProbes(ticket('- the width is at least 40'))).toEqual([expect.stringContaining('names no command')]);
  });

  test('accepts probes that state a result', () => {
    expect(checkTicketCriteria(ticket('- `a` exits 0')).problems).toEqual([]);
  });
});

describe('runProbes', () => {
  test('stops at the first probe that fails', () => {
    const probes = parseProbes(ticket('- `a` exits 0\n- `b` prints a number of at least 40\n- `c` exits 0'));
    const seen: string[] = [];
    const runs = runProbes(probes, cmd => (seen.push(cmd), cmd === 'b' ? ok('32') : ok('')));
    expect(seen).toEqual(['a', 'b']);
    const failed = failedProbe(runs);
    expect(failed?.probe.command).toBe('b');
    const comment = probeFailureComment(failed!);
    expect(comment).toContain('`b`');
    expect(comment).toContain('Expected: prints a number of at least 40');
    expect(comment).toContain('Actual: exit 0, output: 32');
  });

  test('a command that exits other than expected fails', () => {
    const runs = runProbes(parseProbes(ticket('- `a` exits 0')), () => ok('', 2));
    expect(failedProbe(runs)).not.toBeNull();
  });

  test('the prompt section lists what each probe printed', () => {
    const runs = runProbes(parseProbes(ticket('- `a` prints "ready"')), () => ok('ready now'));
    expect(failedProbe(runs)).toBeNull();
    expect(probePromptSection(runs)).toContain('ready now');
    expect(probePromptSection([])).toBe('');
  });
});
