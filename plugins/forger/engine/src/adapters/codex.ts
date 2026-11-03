/**
 * The Codex CLI harness: `codex exec` headless, prompt on stdin. Codex has no
 * project-level command files (its custom prompts are per-user), so the commands
 * are installed as repository skills in `.agents/skills/` and the worker is
 * started by mentioning its skill with `$`. There is no spend cap flag, and a
 * model is a plain id.
 */

import type {Harness} from '../ports';
import {packageAsSkill, skillName, workerSkillName} from './skill-package';

export const codexHarness: Harness = {
  id: 'codex',
  spawn({prompt, model, workerCommand}) {
    return {
      command: 'codex',
      args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--model', model],
      input: `$${workerSkillName(workerCommand)}\n\n${prompt}`,
    };
  },
  commandPath: name => `.agents/skills/${skillName(name)}/SKILL.md`,
  pluginRootVar: 'FORGER_ROOT',
  packageCommand: (source, pluginRoot, name) => packageAsSkill(source, pluginRoot, skillName(name ?? 'command')),
};
