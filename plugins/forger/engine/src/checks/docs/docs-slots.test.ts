import {describe, expect, test} from 'bun:test';

import {checkCommandSlots, slotsByCommand} from './docs-slots';

const def = {
  stages: [
    {command: 'plan', slots: [{slot: 'interview'}, {slot: 'glossary'}]},
    {command: 'auto-ticket', slots: [{slot: 'test_first'}]},
    {command: 'auto-ticket', slots: [{slot: 'review'}, {slot: 'test_first'}]},
    {command: 'auto-plan', slots: []},
  ],
};
const by = slotsByCommand(def);

describe('slotsByCommand', () => {
  test('gathers a command\'s slots across its stages without repeats', () => {
    expect(by).toEqual({plan: ['interview', 'glossary'], 'auto-ticket': ['test_first', 'review'], 'auto-plan': []});
  });
});

describe('checkCommandSlots', () => {
  const cases: Array<[string, string, string, number[]]> = [
    ['a slot of its own stage passes', 'plugins/forger/commands/auto-ticket.md', 'Work in the `test_first` slot.', []],
    ['both stages of a command pass', 'plugins/forger/commands/auto-ticket.md', 'the `review` slot, then the `test_first` slot', []],
    ['another stage\'s slot fails', 'plugins/forger/commands/auto-ticket.md', 'ok\nRun the `interview` slot.', [2]],
    ['a command with no slots fails on any', 'plugins/forger/commands/auto-plan.md', 'the `review` slot', [1]],
    ['a command the definition lacks fails on any', 'plugins/forger/commands/setup.md', 'the `glossary` slot', [1]],
    ['backticks that are not a slot mention pass', 'plugins/forger/commands/setup.md', 'Run `skills --json` and read the slot.', []],
  ];
  for (const [name, file, text, lines] of cases) {
    test(name, () => {
      const found = checkCommandSlots(file, text, by);
      expect(found.map(f => f.line)).toEqual(lines);
      for (const f of found) expect(f.detail).toContain('names the slot');
    });
  }
});
