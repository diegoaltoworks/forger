/**
 * The hook's decision: allow a tool call, or refuse it with the rule it broke
 * and what to do instead. A pure function of the policy, the call and a few
 * facts the caller reads (the base branch, the checkout's branch), so every
 * rule and every bypass a model reaches for is a table test.
 */

import {resolve} from 'path';

import type {DefaultRule, HookPolicy} from './policy';
import {programName, segments, type Segment} from './shell';

export interface ToolCall {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export type HookDecision = {allow: true} | {allow: false; rule: string; message: string; command: string};

export interface WorkerFacts {
  baseBranch: string;
  /** The branch checked out where the call runs, or null when it is not known. */
  currentBranch: string | null;
  /** The engine's own files, relative to the project root: a path at or under one is state. */
  statePaths: string[];
  /** The worker's own worktree and the loop's checkout; set only when the engine started the worker in a worktree, which is what `leave-worktree` needs. */
  worktree?: {path: string; loopRoot: string; cwd: string};
}

const ALLOW: HookDecision = {allow: true};

export function ruleMessage(rule: DefaultRule, baseBranch: string): string {
  switch (rule) {
    case 'merge':
      return 'Refused: a worker does not merge by hand. Stop at PR open and green: `work verify --pr <n>`, then `work merge --pr <n>`, which merges only on green checks and a passing verdict.';
    case 'push-base':
      return `Refused: never push to ${baseBranch} and never force a push. Push your own feat branch (\`git push -u origin <branch>\`); after \`work rebase\`, update it with \`git push --force-with-lease\`.`;
    case 'status-write':
      return 'Refused: commit statuses and check runs are the engine\'s. `work verify --pr <n>` records the verdict and sets forger/verify.';
    case 'state-edit':
      return 'Refused: the engine\'s state under .forger/ (state, events, verdicts, HALT, lock) is written by the engine only. Use the work commands (`work decline`, `work verify`) instead.';
    case 'leave-worktree':
      return 'Refused: this path is in the loop\'s checkout, outside your worktree. All work happens in your worktree; read the loop\'s checkout by path, never enter or write it.';
  }
}

// ---------------------------------------------------------------------------
// gh and curl: the HTTP method and endpoint a call reaches

const GH_VALUED = new Set(['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '--input', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache']);
const GH_FIELDS = new Set(['-f', '--raw-field', '-F', '--field', '--input']);

interface HttpCall {
  method: string;
  endpoint: string;
  words: string[];
}

function flagValue(words: string[], i: number, long: string, short?: string): string | null {
  const w = words[i];
  if (w === long || (short && w === short)) return words[i + 1] ?? null;
  if (w.startsWith(`${long}=`)) return w.slice(long.length + 1);
  if (short && w.startsWith(short) && w.length > short.length && !w.startsWith('--')) return w.slice(short.length);
  return null;
}

/** Skips gh's global flags to the subcommand words. */
function ghArgs(words: string[]): string[] {
  const rest = words.slice(1);
  while (rest.length > 0 && rest[0].startsWith('-')) rest.splice(0, rest[0] === '-R' || rest[0] === '--repo' ? 2 : 1);
  return rest;
}

function ghApi(words: string[]): HttpCall | null {
  const args = ghArgs(words);
  if (args[0] !== 'api') return null;
  let method: string | null = null;
  let fields = false;
  let endpoint = '';
  for (let i = 1; i < args.length; i++) {
    const w = args[i];
    const m = flagValue(args, i, '--method', '-X');
    if (m !== null) method = m.toUpperCase();
    const name = w.includes('=') && w.startsWith('--') ? w.slice(0, w.indexOf('=')) : w;
    if (GH_FIELDS.has(name) || /^-[fF]./.test(w)) fields = true;
    if (GH_VALUED.has(w)) {
      i++;
      continue;
    }
    if (!w.startsWith('-') && endpoint === '') endpoint = w;
  }
  return {method: method ?? (fields ? 'POST' : 'GET'), endpoint, words: args};
}

const CURL_DATA = /^(-d|--data|--data-raw|--data-binary|--data-urlencode|--json|-F|--form|-T|--upload-file)/;

function curl(words: string[]): HttpCall | null {
  const program = programName(words[0]);
  if (program !== 'curl' && program !== 'wget' && program !== 'http' && program !== 'https') return null;
  let method: string | null = null;
  let data = false;
  const urls: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const m = flagValue(words, i, '--request', '-X') ?? flagValue(words, i, '--method');
    if (m !== null) method = m.toUpperCase();
    if (CURL_DATA.test(w) || w.startsWith('--post-data') || w.startsWith('--body-data')) data = true;
    if (/^(PUT|POST|PATCH|DELETE)$/.test(w) && program.startsWith('http')) method = w;
    if (/^https?:\/\/|\/repos\//.test(w)) urls.push(w);
  }
  return {method: method ?? (data ? 'POST' : 'GET'), endpoint: urls.join(' '), words};
}

function httpCall(words: string[]): HttpCall | null {
  const program = programName(words[0]);
  if (program === 'gh') return ghApi(words);
  return curl(words);
}

const MERGE_ENDPOINT = /(^|\/)pulls\/[^/\s]+\/merge\/?(\s|$|\?)/;
const MERGE_MUTATION = /\b(mergePullRequest|enablePullRequestAutoMerge|mergeBranch)\b/;
const STATUS_ENDPOINT = /(^|\/)(statuses|check-runs|check-suites)(\/|\s|$|\?)/;
const STATUS_MUTATION = /\b(createCheckRun|updateCheckRun|createCheckSuite|rerequestCheckSuite|createCommitStatus)\b/;

function isGraphql(call: HttpCall): boolean {
  return /(^|\/)graphql(\s|$|\?)/.test(call.endpoint);
}

function breaksMerge(words: string[]): boolean {
  if (programName(words[0]) === 'gh') {
    const args = ghArgs(words);
    if (args[0] === 'pr' && args[1] === 'merge') return true;
  }
  const call = httpCall(words);
  if (!call) return false;
  if (isGraphql(call)) return call.words.some(w => MERGE_MUTATION.test(w));
  return call.method !== 'GET' && MERGE_ENDPOINT.test(call.endpoint);
}

function breaksStatus(words: string[]): boolean {
  const call = httpCall(words);
  if (!call) return false;
  if (isGraphql(call)) return call.words.some(w => STATUS_MUTATION.test(w));
  return call.method !== 'GET' && STATUS_ENDPOINT.test(call.endpoint);
}

// ---------------------------------------------------------------------------
// git

const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

/** The git subcommand and its arguments, the directories `-C` moves it through, and the repository `--git-dir` and `--work-tree` name. */
export function gitArgs(words: string[]): {args: string[]; dirs: string[]; gitDir?: string; workTree?: string} | null {
  if (programName(words[0]) !== 'git') return null;
  const rest = words.slice(1);
  const dirs: string[] = [];
  let gitDir: string | undefined;
  let workTree: string | undefined;
  while (rest.length > 0 && rest[0].startsWith('-')) {
    const word = rest[0];
    if (word === '-C') dirs.push(rest[1] ?? '.');
    if (word === '--git-dir') gitDir = rest[1];
    else if (word.startsWith('--git-dir=')) gitDir = word.slice('--git-dir='.length);
    if (word === '--work-tree') workTree = rest[1];
    else if (word.startsWith('--work-tree=')) workTree = word.slice('--work-tree='.length);
    rest.splice(0, GIT_VALUED.has(word) ? 2 : 1);
  }
  return {args: rest, dirs, gitDir, workTree};
}

const PUSH_VALUED = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

function branchOf(ref: string, currentBranch: string | null): string | null {
  const name = ref.replace(/^refs\/heads\//, '');
  if (name === 'HEAD' || name === '@') return currentBranch;
  return name;
}

function breaksPush(words: string[], facts: WorkerFacts): boolean {
  const git = gitArgs(words);
  if (!git || git.args[0] !== 'push') return false;
  const positionals: string[] = [];
  const args = git.args.slice(1);
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === '--force' || w === '--mirror' || w === '--all' || w === '--branches') return true;
    if (/^-[a-zA-Z]+$/.test(w) && w.includes('f')) return true;
    if (w === '--delete' || w === '-d') continue;
    if (PUSH_VALUED.has(w)) {
      i++;
      continue;
    }
    if (w.startsWith('-')) continue;
    positionals.push(w);
  }
  const refspecs = positionals.slice(1);
  if (refspecs.length === 0) return facts.currentBranch === facts.baseBranch;
  return refspecs.some(spec => {
    if (spec.startsWith('+')) return true;
    const colon = spec.indexOf(':');
    const dest = colon === -1 ? spec : spec.slice(colon + 1);
    return branchOf(dest === '' ? spec.slice(0, colon) : dest, facts.currentBranch) === facts.baseBranch;
  });
}

// ---------------------------------------------------------------------------
// the engine's state

function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/(^|\/)\.\//g, '$1').replace(/\/$/, '');
}

export function isStatePath(path: string, statePaths: string[]): boolean {
  const p = normalise(path);
  return statePaths.some(raw => {
    const s = normalise(raw);
    return p === s || p.endsWith(`/${s}`) || p.startsWith(`${s}/`) || p.includes(`/${s}/`);
  });
}

const WRITERS = new Set(['rm', 'mv', 'tee', 'truncate', 'touch', 'ln', 'unlink', 'shred', 'chmod', 'dd', 'install', 'rsync']);

/** Whether the segment writes to a path `target` accepts: a redirect, or a program that writes its operands. */
function writesTo(segment: Segment, target: (path: string) => boolean): boolean {
  if (segment.redirects.some(target)) return true;
  if (segment.words.length === 0) return false;
  const program = programName(segment.words[0]);
  const operands = segment.words.slice(1).filter(w => !w.startsWith('-'));
  const operand = (w: string): boolean => target(w.replace(/^of=/, ''));
  if (WRITERS.has(program)) return operands.some(operand);
  if (program === 'cp') return operands.length > 0 && operand(operands[operands.length - 1]);
  if ((program === 'sed' || program === 'perl') && segment.words.some(w => /^-[a-zA-Z]*i/.test(w) || w.startsWith('--in-place'))) return operands.some(operand);
  const git = gitArgs(segment.words);
  if (git && ['rm', 'mv', 'checkout', 'restore', 'add'].includes(git.args[0])) return git.args.slice(1).some(operand);
  return false;
}

function breaksState(segment: Segment, statePaths: string[]): boolean {
  return writesTo(segment, p => isStatePath(p, statePaths));
}

/** A path at or under the loop's checkout and not at or under the worker's worktree; one the shell would expand cannot be read, so it is not outside. */
function isOutside(path: string, cwd: string, w: NonNullable<WorkerFacts['worktree']>): boolean {
  if (UNRESOLVABLE.test(path)) return false;
  const p = resolve(cwd, path);
  return within(p, w.loopRoot) && !within(p, w.path);
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function inputPath(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.notebook_path ?? input.path;
  return typeof p === 'string' ? p : null;
}

export function commandOf(call: ToolCall): string | null {
  if (call.tool_name !== 'Bash') return null;
  const c = call.tool_input.command;
  return typeof c === 'string' ? c : null;
}

/** The worker's hook: the first rule the call breaks, in policy order, or allow. */
export function decideWorker(policy: HookPolicy, call: ToolCall, facts: WorkerFacts): HookDecision {
  const refuse = (rule: DefaultRule, command: string): HookDecision => ({allow: false, rule, message: ruleMessage(rule, facts.baseBranch), command});
  const leave = policy.rules.includes('leave-worktree') ? facts.worktree : undefined;
  if (EDIT_TOOLS.has(call.tool_name)) {
    const path = inputPath(call.tool_input);
    if (path !== null && leave && isOutside(path, leave.cwd, leave)) return refuse('leave-worktree', `${call.tool_name} ${path}`);
    if (path !== null && policy.rules.includes('state-edit') && isStatePath(path, facts.statePaths)) return refuse('state-edit', `${call.tool_name} ${path}`);
    return ALLOW;
  }
  const command = commandOf(call);
  if (command === null) return ALLOW;
  let cwd = leave?.cwd ?? '';
  for (const segment of segments(command)) {
    const words = segment.words;
    let wandered = false;
    if (leave) {
      if (words[0] === 'cd' || words[0] === 'pushd') {
        if (words[1] !== undefined && isOutside(words[1], cwd, leave)) wandered = true;
        else if (words[1] !== undefined && !UNRESOLVABLE.test(words[1])) cwd = resolve(cwd, words[1]);
      } else wandered = writesTo(segment, p => isOutside(p, cwd, leave));
    }
    for (const rule of policy.rules) {
      const broken =
        rule === 'leave-worktree'
          ? wandered
          : rule === 'state-edit'
            ? breaksState(segment, facts.statePaths)
            : words.length > 0 && (rule === 'merge' ? breaksMerge(words) : rule === 'push-base' ? breaksPush(words, facts) : breaksStatus(words));
      if (broken) return refuse(rule, command);
    }
    const joined = words.join(' ');
    for (const deny of policy.deny) {
      if (new RegExp(deny.pattern).test(joined)) return {allow: false, rule: deny.id, message: deny.message, command};
    }
  }
  return ALLOW;
}

// ---------------------------------------------------------------------------
// the supervisor

/** Git subcommands that move HEAD, the index or the working tree. */
export const STATE_CHANGING_GIT = ['checkout', 'switch', 'reset', 'stash', 'pull', 'merge', 'commit', 'rebase', 'restore', 'clean', 'cherry-pick', 'revert', 'am', 'apply'];

const READ_ONLY_STASH = new Set(['list', 'show']);

export interface SupervisorFacts {
  /** Whether the loop's engine holds the lock and is alive. */
  engineAlive: boolean;
  /** Where the call runs. */
  cwd: string;
  /** The loop's checkout. */
  loopRoot: string;
  /** Where the loop's worktrees live; a worktree is the worker's, not the loop's checkout. */
  worktreesDir: string;
}

export const SUPERVISOR_MESSAGE =
  'Refused: an engine is running in this checkout, and a state-changing git command here moves the ground under its worker. Read with `work facts --json`, `git log` or `git status`; let the engine finish, or stop it first.';

function within(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(`${root.replace(/\/$/, '')}/`);
}

/** A path the shell would expand is a path this reader cannot resolve. */
const UNRESOLVABLE = /[$`~*?]/;

/** The directory a git command acts on; the loop's checkout when it cannot be told. */
function repositoryOf(git: NonNullable<ReturnType<typeof gitArgs>>, cwd: string, loopRoot: string): string {
  const named = [...git.dirs, git.workTree, git.gitDir].filter((p): p is string => p !== undefined);
  if (named.some(p => UNRESOLVABLE.test(p))) return loopRoot;
  const base = git.dirs.reduce((d, c) => resolve(d, c), cwd);
  if (git.workTree !== undefined) return resolve(base, git.workTree);
  if (git.gitDir !== undefined) {
    const dir = resolve(base, git.gitDir);
    return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : dir;
  }
  return base;
}

/** The supervisor's hook: while an engine is alive, no state-changing git in the loop's checkout. */
export function decideSupervisor(call: ToolCall, facts: SupervisorFacts): HookDecision {
  if (!facts.engineAlive) return ALLOW;
  const command = commandOf(call);
  if (command === null) return ALLOW;
  let cwd = facts.cwd;
  for (const {words} of segments(command)) {
    if (words.length === 0) continue;
    if (words[0] === 'cd' || words[0] === 'pushd') {
      cwd = words[1] === undefined || UNRESOLVABLE.test(words[1]) ? facts.loopRoot : resolve(cwd, words[1]);
      continue;
    }
    const git = gitArgs(words);
    if (!git) continue;
    const dir = repositoryOf(git, cwd, facts.loopRoot);
    if (!within(dir, facts.loopRoot) || within(dir, facts.worktreesDir)) continue;
    const sub = git.args[0];
    if (!STATE_CHANGING_GIT.includes(sub)) continue;
    if (sub === 'stash' && READ_ONLY_STASH.has(git.args[1])) continue;
    return {allow: false, rule: 'supervisor-git', message: SUPERVISOR_MESSAGE, command};
  }
  return ALLOW;
}
