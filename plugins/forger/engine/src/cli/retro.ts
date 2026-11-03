import {mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';

import {forgerPath} from '../config';

import {draftUpstreamIssue, renderRule, ruleFilePath, ruleProblem, type RuleRecord} from '../supervisor';
import type {Command} from './command';

export const retro: Command = {
  name: 'retro',
  needs: 'root',
  flags: ['json', 'name', 'description', 'type', 'rule', 'owner', 'date', 'why', 'how', 'enforced-by', 'title', 'lesson', 'evidence'],
  help: `  retro rule --name S --description S --type T --rule S --owner S --date D --why S --how S [--enforced-by S]
                   Write a rule record to .forger/rules/ (verbatim owner words)
  retro upstream --title S --lesson S --evidence S [--evidence S ...]
                   Print an issue draft for forger, carrying the evidence`,
  run({values, positionals, projectRoot}) {
    if (positionals[1] === 'upstream') {
      try {
        const d = draftUpstreamIssue({title: values.title ?? '', lesson: values.lesson ?? '', evidence: values.evidence ?? []});
        console.log(values.json ? JSON.stringify(d) : `${d.title}\n\n${d.body}`);
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    if (positionals[1] === 'rule') {
      const rule: RuleRecord = {
        name: values.name ?? '',
        description: values.description ?? '',
        type: (values.type ?? '') as RuleRecord['type'],
        rule: values.rule ?? '',
        ownerWords: values.owner ?? '',
        date: values.date ?? '',
        why: values.why ?? '',
        howToApply: values.how ?? '',
        enforcedBy: values['enforced-by'] ?? '',
      };
      const problem = ruleProblem(rule);
      if (problem) {
        console.error(problem);
        process.exitCode = 1;
        return;
      }
      const path = ruleFilePath(rule.name);
      const file = forgerPath(projectRoot, path);
      mkdirSync(dirname(file), {recursive: true});
      writeFileSync(file, renderRule(rule));
      console.log(values.json ? JSON.stringify({path}) : path);
      return;
    }
    console.error('Usage: retro rule|upstream ...');
    process.exitCode = 1;
  },
};
