import {describe, expect, test} from 'bun:test';

import {FLAGS} from './flags';
import {COMMANDS, findCommand, renderHelp} from './registry';

describe('the command registry', () => {
  test('names are unique', () => {
    const names = COMMANDS.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every flag a command reads is in the parse table', () => {
    for (const c of COMMANDS) for (const f of c.flags) expect(Object.keys(FLAGS)).toContain(f);
  });

  test('the usage text lists every command, in registry order', () => {
    const help = renderHelp();
    const at = COMMANDS.map(c => help.indexOf(c.help));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test('an unknown name finds nothing', () => {
    expect(findCommand('status')?.name).toBe('status');
    expect(findCommand('nope')).toBeUndefined();
  });
});
