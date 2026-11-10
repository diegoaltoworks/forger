import {mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';

import {forgerPath} from '../config';

import {assessDemotion, DEFAULT_MIN_MERGED, demotionCandidates, draftDemotion, draftUpstreamIssue, formatCandidates, formatNumbers, renderRule, ruleFilePath, ruleProblem, type RuleRecord} from '../supervisor';
import type {Command} from './command';
import {loadOpinionFailures} from './measure';

export const retro: Command = {
  name: 'retro',
  needs: 'root',
  flags: ['json', 'name', 'description', 'type', 'rule', 'owner', 'date', 'why', 'how', 'enforced-by', 'title', 'lesson', 'evidence', 'opinion', 'list', 'min-merged'],
  help: `  retro rule --name S --description S --type T --rule S --owner S --date D --why S --how S [--enforced-by S]
                   Write a rule record to .forger/rules/ (verbatim owner words)
  retro upstream --title S --lesson S --evidence S [--evidence S ...]
                   Print an issue draft for forger, carrying the evidence
  retro demote --list [--min-merged N] [--json]
  retro demote --opinion ID [--min-merged N] [--json]
                   Print the opinions that do not earn their place (a check that never failed over --min-merged merged tickets,
                   or whose failures ended waived more often than fixed), or an issue draft proposing one rung down or removal; files nothing`,
  run(ctx) {
    const {values, positionals, projectRoot} = ctx;
    if (positionals[1] === 'demote') {
      const min = values['min-merged'] === undefined ? DEFAULT_MIN_MERGED : Number(values['min-merged']);
      if (!Number.isInteger(min) || min < 0) {
        console.error('--min-merged must be a whole number');
        process.exitCode = 1;
        return;
      }
      const loaded = loadOpinionFailures(ctx);
      if (loaded === null || (!values.list && values.opinion === undefined)) {
        console.error(loaded === null ? 'nothing is recorded yet: no check run inside a worker has written records' : 'Usage: retro demote --list | --opinion ID');
        process.exitCode = 1;
        return;
      }
      if (values.list) {
        const list = demotionCandidates(loaded.rows, loaded.rungs, loaded.merged, min);
        console.log(values.json ? JSON.stringify({candidates: list}) : formatCandidates(list));
        return;
      }
      const row = loaded.rows.find(r => r.opinion === values.opinion);
      const rung = loaded.rungs.get(values.opinion ?? '');
      if (row === undefined || rung === undefined) {
        console.error(`${values.opinion} is not an installed opinion with a check`);
        process.exitCode = 1;
        return;
      }
      const a = assessDemotion(row, rung, loaded.merged, min);
      if (!a.candidate) {
        console.error(`${formatNumbers(a)}: not a candidate for demotion`);
        process.exitCode = 1;
        return;
      }
      const d = draftDemotion(a);
      console.log(values.json ? JSON.stringify({...d, assessment: a}) : `${d.title}\n\n${d.body}`);
      return;
    }
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
    console.error('Usage: retro rule|upstream|demote ...');
    process.exitCode = 1;
  },
};
