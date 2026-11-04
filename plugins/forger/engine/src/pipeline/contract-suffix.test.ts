import {describe, expect, test} from 'bun:test';

import {contractSuffix, resultFile, SHAPES} from './contract-suffix';
import {CONTRACT_NAMES} from './contracts';

describe('contractSuffix', () => {
  test('there is a shape for every contract', () => {
    expect(Object.keys(SHAPES).sort()).toEqual([...CONTRACT_NAMES].sort());
  });

  const expected: Record<string, string> = {
    decisions:
      'When you finish, write your result to r/interview.json as JSON in this shape: [{"question":"text","answer":"text","source":"owner|default","recommended":"text"}]. Give at least one entry, or {"none": true} when nothing was open. A "default" answer must be the recommended one.',
    glossary_entries:
      'When you finish, write your result to r/glossary.json as JSON in this shape: [{"term":"text","file":"path"},{"adr":"text","file":"path"}]. Each file is in your changes and, for a term, contains it.',
    wireframe: 'When you finish, write your result to r/design.json as JSON in this shape: {"html":"path.html","png":"path.png"}. Both files exist; capture the png with the screenshot command.',
    tests_written:
      'When you finish, write your result to r/test_first.json as JSON in this shape: [{"criterion":"c1","file":"path","test":"test name"},{"criterion":"c2","waived":"reason"}]. Name every acceptance criterion of the ticket, or waive it with a reason. Each file is a test file in your changes.',
    diagnosis:
      'When you finish, write your result to r/diagnose.json as JSON in this shape: {"command":"text","exit":1,"excerpt":"text","hypothesis":"text","result":"confirmed|refuted"}. The command is the red gate or a part of it and its exit is non-zero. The excerpt is the failing output.',
    review_findings:
      'When you finish, write your result to r/review.json as JSON in this shape: [{"severity":"low|medium|high|critical","file":"path","line":1,"summary":"text","disposition":"fixed|declined","reason":"text"}]. Each file is in the diff. Every finding at medium or above has a disposition; a declined one has a reason.',
    risk_report:
      'When you finish, write your result to r/risk.json as JSON in this shape: {"beyond_diff":[{"path":"path","why":"text"}],"ran":[{"command":"text","exit":0}]}. Every command you ran has its exit code. The report informs the worker; it is not a verdict.',
    pr_body: 'When you finish, write your result to r/pr_body.md as markdown. Keep the "Closes #<issue>" line and the review sections the ticket names.',
    rebase_clean: 'When you finish, write your result to r/merge_conflicts.json as JSON in this shape: {"status":"clean"}. Write the output of the rebase command with --json once the rebase is clean.',
    verdict:
      'When you finish, write your result to r/verify.json as JSON in this shape: [{"criterion":"c1","verdict":"met|not_met|cannot_tell","evidence":[{"kind":"file|command|test|check","ref":"text"}]}]. Judge every criterion of the ticket once. A met or not_met criterion carries evidence that resolves.',
    retro_proposals:
      'When you finish, write your result to r/retro.json as JSON in this shape: [{"lesson":"text","rung":"check|test|tool|doc","target":"path"}]. Each proposal names a rung of the refinement ladder and a target path.',
  };
  const slotOf: Record<string, string> = {
    decisions: 'interview', glossary_entries: 'glossary', wireframe: 'design', tests_written: 'test_first', diagnosis: 'diagnose',
    review_findings: 'review', risk_report: 'risk', pr_body: 'pr_body', rebase_clean: 'merge_conflicts', verdict: 'verify', retro_proposals: 'retro',
  };

  test.each(CONTRACT_NAMES)('%s', name => {
    const slot = slotOf[name] as string;
    expect(contractSuffix(name, `r/${resultFile(slot, name)}`)).toBe(expected[name] as string);
  });
});
