/**
 * The GitHub Copilot CLI harness: `copilot -p` headless, with commands installed
 * as repository skills in `.github/skills/` and the worker started by naming its
 * skill with a leading slash. There is no spend cap flag; `--no-ask-user` keeps
 * an unattended run from waiting on a person.
 */

import type {Harness} from '../ports';
import {packageAsSkill, skillName, workerSkillName} from './skill-package';

export const copilotHarness: Harness = {
  id: 'copilot',
  spawn({prompt, model, workerCommand}) {
    return {
      command: 'copilot',
      args: ['-p', `/${workerSkillName(workerCommand)}\n\n${prompt}`, '--model', model, '--allow-all', '--no-ask-user'],
    };
  },
  commandPath: name => `.github/skills/${skillName(name)}/SKILL.md`,
  pluginRootVar: 'FORGER_ROOT',
  packageCommand: (source, pluginRoot, name) => packageAsSkill(source, pluginRoot, skillName(name ?? 'command')),
};
