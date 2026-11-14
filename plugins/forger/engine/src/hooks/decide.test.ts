import {describe, expect, test} from 'bun:test';

import {decideSupervisor, decideWorker, type ToolCall, type WorkerFacts} from './decide';
import {DEFAULT_POLICY, type HookPolicy} from './policy';

const facts: WorkerFacts = {
  baseBranch: 'main',
  currentBranch: 'feat/issue-7',
  statePaths: ['.forger/state.json', '.forger/events.jsonl', '.forger/HALT', '.forger/runner.lock', '.forger/verdicts', '.forger/lease.json'],
};

const bash = (command: string): ToolCall => ({tool_name: 'Bash', tool_input: {command}});
const rule = (command: string, f: WorkerFacts = facts, policy: HookPolicy = DEFAULT_POLICY): string | null => {
  const d = decideWorker(policy, bash(command), f);
  return d.allow ? null : d.rule;
};

describe('merge', () => {
  test.each([
    'gh pr merge 12 --squash',
    'gh -R o/r pr merge 12',
    'env gh pr merge 12',
    'env GH_TOKEN=x gh pr merge 12',
    'FOO=1 /usr/bin/gh pr merge',
    'git push origin feat/x && gh pr merge 12 --squash',
    'true; gh pr merge 1',
    'bash -c "gh pr merge 1"',
    'sh -lc \'gh pr merge 1\'',
    'eval gh pr merge 1',
    'echo $(gh pr merge 1)',
    'echo `gh pr merge 1`',
    'gh api -X PUT repos/o/r/pulls/1/merge',
    'gh api --method=PUT /repos/o/r/pulls/1/merge -f merge_method=squash',
    'gh api repos/o/r/pulls/1/merge -f merge_method=squash',
    'curl -X PUT -H "Authorization: token t" https://api.github.com/repos/o/r/pulls/1/merge',
    'curl --request PUT https://api.github.com/repos/o/r/pulls/1/merge',
    'curl -d \'{}\' https://api.github.com/repos/o/r/pulls/1/merge',
    'gh api graphql -f query=\'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\'',
    'gh pr merge --auto 3',
  ])('refuses %s', command => expect(rule(command)).toBe('merge'));

  test.each(['gh pr view 12', 'gh pr create --title x', 'gh api repos/o/r/pulls/1/merge', 'curl https://api.github.com/repos/o/r/pulls/1/merge', 'echo "gh pr merge is refused"', 'bun work.ts merge --pr 12 --json'])(
    'allows %s',
    command => expect(rule(command)).toBeNull()
  );
});

describe('push-base', () => {
  test.each([
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin feat/x:main',
    'git push -f',
    'git push --force origin feat/x',
    'git push -uf origin feat/x',
    'git push origin +feat/x',
    'git push --mirror',
    'git push --all origin',
    'git push origin --delete main',
    'git push origin :main',
    'git -C . push origin main',
    'cd sub && git push origin main',
  ])('refuses %s', command => expect(rule(command)).toBe('push-base'));

  test('a bare push refuses only on the base branch', () => {
    expect(rule('git push', {...facts, currentBranch: 'main'})).toBe('push-base');
    expect(rule('git push origin HEAD', {...facts, currentBranch: 'main'})).toBe('push-base');
    expect(rule('git push')).toBeNull();
    expect(rule('git push', {...facts, currentBranch: null})).toBeNull();
  });

  test('the base branch comes from the facts', () => {
    expect(rule('git push origin develop', {...facts, baseBranch: 'develop'})).toBe('push-base');
    expect(rule('git push origin main', {...facts, baseBranch: 'develop'})).toBeNull();
  });

  test.each(['git push -u origin feat/issue-7', 'git push origin HEAD', 'git push --force-with-lease origin feat/issue-7', 'git push origin feat/x:feat/x', 'git fetch origin main', 'git log origin/main'])(
    'allows %s',
    command => expect(rule(command)).toBeNull()
  );
});

describe('status-write', () => {
  test.each([
    'gh api repos/o/r/statuses/abc -f state=success -f context=forger/verify',
    'gh api -X POST repos/o/r/statuses/abc',
    'gh api repos/o/r/check-runs -f name=x -f head_sha=abc',
    'gh api -X PATCH repos/o/r/check-runs/5',
    'curl -X POST https://api.github.com/repos/o/r/statuses/abc -d \'{"state":"success"}\'',
    'gh api graphql -f query=\'mutation { createCheckRun(input: {}) { clientMutationId } }\'',
  ])('refuses %s', command => expect(rule(command)).toBe('status-write'));

  test.each(['gh api repos/o/r/commits/abc/statuses', 'gh api repos/o/r/commits/abc/check-runs', 'gh pr checks 3'])('allows %s', command => expect(rule(command)).toBeNull());
});

describe('state-edit', () => {
  test.each([
    'rm .forger/HALT',
    'rm -f /repo/.forger/runner.lock',
    'echo {} > .forger/state.json',
    'echo x >>.forger/events.jsonl',
    'printf x 2> .forger/state.json',
    'cp /tmp/x .forger/state.json',
    'mv .forger/verdicts/abc.json /tmp',
    'sed -i s/a/b/ .forger/state.json',
    'tee .forger/verdicts/x.json',
    'touch .forger/HALT',
    'git checkout -- .forger/state.json',
  ])('refuses %s', command => expect(rule(command)).toBe('state-edit'));

  test.each(['cat .forger/state.json', 'cp .forger/state.json /tmp/x', 'grep x .forger/events.jsonl', 'echo hi > /tmp/out 2>&1', 'rm .forger/output/x.log', 'bun work.ts decline --ticket t --reason unclear --detail d'])(
    'allows %s',
    command => expect(rule(command)).toBeNull()
  );

  test('an edit tool on a state file is refused, elsewhere allowed', () => {
    const edit = (tool: string, file_path: string) => decideWorker(DEFAULT_POLICY, {tool_name: tool, tool_input: {file_path}}, facts);
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      expect(edit(tool, '/repo/.forger/state.json')).toMatchObject({allow: false, rule: 'state-edit'});
      expect(edit(tool, '/repo/.forger/verdicts/abc.json')).toMatchObject({allow: false, rule: 'state-edit'});
      expect(edit(tool, '/repo/src/a.ts')).toEqual({allow: true});
      expect(edit(tool, '/repo/.forger/process.md')).toEqual({allow: true});
    }
  });
});

describe('the policy', () => {
  test('a dropped default rule is not enforced', () => {
    const policy: HookPolicy = {rules: ['push-base', 'status-write', 'state-edit'], deny: []};
    expect(rule('gh pr merge 1', facts, policy)).toBeNull();
    expect(rule('git push origin main', facts, policy)).toBe('push-base');
  });

  test('a project deny rule refuses with its own message', () => {
    const policy: HookPolicy = {rules: [], deny: [{id: 'no-deploy', pattern: '^npm run deploy\\b', message: 'deploys are the owner\'s'}]};
    expect(decideWorker(policy, bash('npm test && npm run deploy'), facts)).toEqual({allow: false, rule: 'no-deploy', message: 'deploys are the owner\'s', command: 'npm test && npm run deploy'});
    expect(rule('npm test', facts, policy)).toBeNull();
  });

  test('a refusal says what to do instead', () => {
    const d = decideWorker(DEFAULT_POLICY, bash('gh pr merge 3'), facts);
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.message).toContain('work merge --pr');
      expect(d.command).toBe('gh pr merge 3');
    }
  });

  test('tools other than the shell and the editors are allowed', () => {
    expect(decideWorker(DEFAULT_POLICY, {tool_name: 'Read', tool_input: {file_path: '.forger/state.json'}}, facts)).toEqual({allow: true});
  });
});

describe('the supervisor', () => {
  const at = {engineAlive: true, cwd: '/repo', loopRoot: '/repo', worktreesDir: '/repo/.forger/worktrees'};
  const sup = (command: string, f = at) => decideSupervisor(bash(command), f).allow;

  test.each(['git checkout main', 'git reset --hard', 'git stash', 'git stash pop', 'git pull', 'git merge origin/main', 'git commit -m x', 'git switch -c x', 'git rebase main', 'git status && git checkout x', 'git -C /repo reset --hard', 'cd /repo/sub && git stash'])(
    'refuses %s while an engine is alive',
    command => expect(sup(command)).toBe(false)
  );

  test.each(['git status', 'git log --oneline', 'git fetch origin', 'git diff', 'git branch --show-current', 'git stash list', 'git rev-parse HEAD', 'gh pr merge 3'])('allows %s', command =>
    expect(sup(command)).toBe(true)
  );

  test('allows everything when no engine is alive', () => expect(sup('git checkout main', {...at, engineAlive: false})).toBe(true));

  test('a checkout outside the loop, or a worktree of it, is not guarded', () => {
    expect(sup('git checkout main', {...at, cwd: '/elsewhere'})).toBe(true);
    expect(sup('git -C /repo/.forger/worktrees/issue-7 commit -m x')).toBe(true);
    expect(sup('cd /elsewhere && git reset --hard')).toBe(true);
  });
});

describe('the read-only rule resolves the repository a git command acts on', () => {
  const at = {engineAlive: true, cwd: '/repo', loopRoot: '/repo', worktreesDir: '/repo/.forger/worktrees'};
  const allowed = (command: string) => decideSupervisor(bash(command), at).allow;

  test('the read-only rule allows a git commit with -C naming another repository', () => {
    expect(allowed('git -C /other commit -m x')).toBe(true);
    expect(allowed('git --git-dir=/other/.git commit -m x')).toBe(true);
    expect(allowed('git --git-dir /other/.git --work-tree /other commit -m x')).toBe(true);
    expect(allowed('git --work-tree=/other reset --hard')).toBe(true);
  });

  test('the read-only rule allows cd to another repository then git commit', () => {
    expect(allowed('cd /other && git commit -m x')).toBe(true);
  });

  test('the read-only rule still refuses a git commit in the engine\'s checkout', () => {
    expect(allowed('git commit -m x')).toBe(false);
    expect(allowed('git -C /repo commit -m x')).toBe(false);
    expect(allowed('git --git-dir=/repo/.git commit -m x')).toBe(false);
    expect(allowed('git --work-tree=/repo reset --hard')).toBe(false);
  });

  test('a path it cannot resolve is refused as before', () => {
    expect(allowed('git -C "$REPO" commit -m x')).toBe(false);
    expect(allowed('cd "$REPO" && git commit -m x')).toBe(false);
    expect(allowed('git -C ~/other commit -m x')).toBe(false);
  });

  test('a git command quoted in a heredoc body is not refused', () => {
    expect(allowed('gh issue create --body-file - <<EOF\nrefused: git commit -m x\nEOF')).toBe(true);
    expect(allowed("gh issue create --body \"git commit -m x\"")).toBe(true);
    expect(allowed('cat <<-\'EOF\'\n\tgit reset --hard\n\tEOF\ngit commit -m x')).toBe(false);
  });
});

describe('leave-worktree', () => {
  const wf: WorkerFacts = {...facts, worktree: {path: '/loop/.forger/worktrees/issue-7', loopRoot: '/loop', cwd: '/loop/.forger/worktrees/issue-7'}};
  const edit = (tool: string, file_path: string): ToolCall => ({tool_name: tool, tool_input: {file_path}});
  const editRule = (tool: string, path: string): string | null => {
    const d = decideWorker(DEFAULT_POLICY, edit(tool, path), wf);
    return d.allow ? null : d.rule;
  };

  test.each(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])('an editor tool call on a path in the loop\'s checkout outside the worker\'s worktree is refused as leave-worktree (%s)', tool => {
    expect(editRule(tool, '/loop/plugins/x.ts')).toBe('leave-worktree');
    expect(editRule(tool, '../../../plugins/x.ts')).toBe('leave-worktree');
  });

  test.each([
    'cd /loop',
    'cd /loop/plugins && ls',
    'pushd /loop',
    'git status && cd .. && cd ../.. && ls',
    'bash -c "cd /loop && ls"',
    'echo hi; (cd /loop)',
  ])('cd into the loop\'s checkout outside the worker\'s worktree is refused as leave-worktree: %s', command => expect(rule(command, wf)).toBe('leave-worktree'));

  test.each([
    'echo x > /loop/a.ts',
    'echo x >> /loop/a.ts',
    'cat y | tee /loop/a.ts',
    'sed -i s/a/b/ /loop/a.ts',
    'cp a.ts /loop/a.ts',
    'rm /loop/a.ts',
    'cd .. && echo x > ../../../a.ts',
  ])('a redirect or an in-place edit aimed at the loop\'s checkout outside the worker\'s worktree is refused as leave-worktree: %s', command => expect(rule(command, wf)).toBe('leave-worktree'));

  test('another worker\'s worktree counts as outside', () => {
    expect(rule('cd /loop/.forger/worktrees/issue-8', wf)).toBe('leave-worktree');
    expect(editRule('Edit', '/loop/.forger/worktrees/issue-8/a.ts')).toBe('leave-worktree');
  });

  test('a path inside the worker\'s own worktree is allowed', () => {
    expect(rule('cd /loop/.forger/worktrees/issue-7/plugins && echo x > a.ts', wf)).toBeNull();
    expect(rule('echo x > /loop/.forger/worktrees/issue-7/a.ts', wf)).toBeNull();
    expect(rule('echo x > /tmp/a.ts', wf)).toBeNull();
    expect(editRule('Write', '/loop/.forger/worktrees/issue-7/a.ts')).toBeNull();
    expect(editRule('Write', 'src/a.ts')).toBeNull();
    expect(editRule('Write', '/tmp/notes/a.md')).toBeNull();
  });

  test('reading a file of the loop\'s checkout by its absolute path is allowed, and so is running the engine from there', () => {
    expect(rule('cat /loop/docs/a.md', wf)).toBeNull();
    expect(rule('cp /loop/docs/a.md ./a.md', wf)).toBeNull();
    expect(rule('grep -r x /loop/plugins | head', wf)).toBeNull();
    expect(rule('bun /loop/plugins/forger/bin/work.ts verify --pr 3 --json', wf)).toBeNull();
  });

  test('the rule does not apply to a worker the engine did not start in a worktree, or when the policy drops it', () => {
    expect(rule('cd /loop', facts)).toBeNull();
    expect(rule('cd /loop', wf, {...DEFAULT_POLICY, rules: ['merge']})).toBeNull();
  });
});
