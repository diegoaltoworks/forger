/**
 * The GitHub Copilot CLI harness: `copilot -p` headless, with commands installed
 * as repository skills in `.github/skills/` and the worker started by naming its
 * skill with a leading slash. There is no spend cap flag; `--no-ask-user` keeps
 * an unattended run from waiting on a person.
 *
 * Usage: Copilot's headless documentation (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
 * describes no cost or token count in `-p` output, so a run here has no spend limit.
 */

import type {Harness} from '../ports';
import {copilotHooks} from './copilot-hooks';
import {packageAsSkill, skillName, workerSkillName} from './skill-package';

export const copilotHarness: Harness = {
  id: 'copilot',
  credentials: {api_key: [], subscription: 'COPILOT_GITHUB_TOKEN', howTo: 'create a fine-grained personal access token with the Copilot Requests permission and export it as COPILOT_GITHUB_TOKEN'},
  usage: 'none',
  spawn({prompt, model, workerCommand}) {
    return {
      command: 'copilot',
      args: ['-p', `/${workerSkillName(workerCommand)}\n\n${prompt}`, '--model', model, '--allow-all', '--no-ask-user'],
    };
  },
  commandPath: name => `.github/skills/${skillName(name)}/SKILL.md`,
  pluginRootVar: 'FORGER_ROOT',
  packageCommand: (source, pluginRoot, name) => packageAsSkill(source, pluginRoot, skillName(name ?? 'command')),
  hooks: copilotHooks,
};
