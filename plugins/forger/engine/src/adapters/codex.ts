/**
 * The Codex CLI harness: `codex exec` headless, prompt on stdin. Codex has no
 * project-level command files (its custom prompts are per-user), so the commands
 * are installed as repository skills in `.agents/skills/` and the worker is
 * started by mentioning its skill with `$`. There is no spend cap flag, and a
 * model is a plain id.
 *
 * Usage: `exec --json` prints JSONL events, and `turn.completed` carries `usage` token counts and
 * no cost (https://developers.openai.com/codex/noninteractive), so the spend limit needs a price
 * for the model in the config's `model_prices`.
 */

import type {Harness} from '../ports';
import {codexHooks} from './codex-hooks';
import {codexSpentUsd, codexText} from './usage';
import {packageAsSkill, skillName, workerSkillName} from './skill-package';

export const codexHarness: Harness = {
  id: 'codex',
  usage: 'tokens',
  spentUsd: codexSpentUsd,
  plainText: codexText,
  spawn({prompt, model, workerCommand}) {
    return {
      command: 'codex',
      args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--model', model],
      input: `$${workerSkillName(workerCommand)}\n\n${prompt}`,
    };
  },
  commandPath: name => `.agents/skills/${skillName(name)}/SKILL.md`,
  pluginRootVar: 'FORGER_ROOT',
  packageCommand: (source, pluginRoot, name) => packageAsSkill(source, pluginRoot, skillName(name ?? 'command')),
  hooks: codexHooks,
};
