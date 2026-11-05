import {afterAll, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {execCapture} from './exec';
import {gitStateStore} from './git-state-store';

const root = mkdtempSync(join(tmpdir(), 'forger-git-state-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));

const sh = (cwd: string, cmd: string) => {
  const r = execCapture(cwd)(cmd);
  if (r.exitCode !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout;
};

let n = 0;
function scene() {
  const dir = join(root, String(n++));
  sh(root, `git init --bare -q ${dir}/remote.git`);
  const clone = (name: string) => {
    const c = join(dir, name);
    sh(root, `git clone -q ${dir}/remote.git ${c} 2>/dev/null`);
    writeFileSync(join(c, 'code.txt'), 'work');
    sh(c, 'git add . && git -c user.name=t -c user.email=t@t commit -qm code');
    return c;
  };
  return {remote: `${dir}/remote.git`, clone};
}
const at = new Date('2026-01-01T00:00:00Z');
const req = (self: string, now = at) => ({self, host: 'h', ttlSeconds: 900, now});

describe('gitStateStore', () => {
  test('state and events round-trip through the remote without moving HEAD or the tree', () => {
    const s = scene();
    const a = s.clone('a');
    const b = s.clone('b');
    const headA = sh(a, 'git rev-parse HEAD');
    const store = gitStateStore({repo: a});
    expect(store.readState()).toBeNull();
    store.writeState('{"iteration":3}');
    store.appendEvent('{"e":1}', at);
    store.appendEvent('{"e":2}', at);
    store.appendEvent('{"e":3}', new Date('2026-01-02T00:00:00Z'));

    const other = gitStateStore({repo: b});
    expect(other.readState()).toBe('{"iteration":3}');
    expect(other.readEvents()).toBe('{"e":1}\n{"e":2}\n{"e":3}\n');

    expect(sh(a, 'git rev-parse HEAD')).toBe(headA);
    expect(sh(a, 'git status --porcelain')).toBe('');
    expect(sh(a, 'git rev-parse --abbrev-ref HEAD')).not.toBe('forger-state');
    expect(sh(s.remote, 'git ls-tree -r --name-only forger-state').split('\n')).toEqual([
      'events/2026-01-01.jsonl',
      'events/2026-01-02.jsonl',
      'state.json',
    ]);
  });

  test('two writers racing for the lease: exactly one wins', () => {
    const s = scene();
    const a = gitStateStore({repo: s.clone('a')});
    const b = gitStateStore({repo: s.clone('b')});
    const first = a.claimLease(req('a'));
    const second = b.claimLease(req('b'));
    expect(first).toMatchObject({ok: true, action: 'acquire'});
    expect(second).toMatchObject({ok: false, reason: 'held', holder: 'a'});
  });

  test('a rejected push is retried on a fresh read, up to the bound', () => {
    const s = scene();
    const hook = join(s.remote, 'hooks', 'pre-receive');
    const marker = join(s.remote, 'refused-once');
    writeFileSync(hook, `#!/bin/sh\nif [ ! -e "${marker}" ]; then touch "${marker}"; exit 1; fi\n`, {mode: 0o755});
    const a = gitStateStore({repo: s.clone('a')});
    expect(a.claimLease(req('a'))).toMatchObject({ok: true, action: 'acquire'});

    const stubborn = scene();
    writeFileSync(join(stubborn.remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', {mode: 0o755});
    const b = gitStateStore({repo: stubborn.clone('b'), attempts: 3});
    expect(b.claimLease(req('b'))).toEqual({ok: false, reason: 'lost'});
  });

  test('a takeover names the previous holder; the loser of a renewal sees it', () => {
    const s = scene();
    const a = gitStateStore({repo: s.clone('a')});
    const b = gitStateStore({repo: s.clone('b')});
    a.claimLease(req('a'));
    const later = new Date('2026-01-01T01:00:00Z');
    expect(b.claimLease(req('b', later))).toMatchObject({ok: true, action: 'takeover', previousHolder: 'a'});
    expect(a.claimLease(req('a', new Date('2026-01-01T01:01:00Z')))).toMatchObject({ok: false, reason: 'held', holder: 'b'});
  });

  test('a renewal that cannot be pushed is a lost lease', () => {
    const s = scene();
    const a = gitStateStore({repo: s.clone('a'), attempts: 2});
    a.claimLease(req('a'));
    rmSync(s.remote, {recursive: true, force: true});
    expect(a.claimLease(req('a', new Date('2026-01-01T00:01:00Z')))).toEqual({ok: false, reason: 'lost'});
  });

  test('release frees the lease for the next claimant', () => {
    const s = scene();
    const a = gitStateStore({repo: s.clone('a')});
    const b = gitStateStore({repo: s.clone('b')});
    a.claimLease(req('a'));
    a.releaseLease('a');
    expect(b.claimLease(req('b'))).toMatchObject({ok: true, action: 'acquire'});
  });

  test('a branch name that is not plain is refused', () => {
    expect(() => gitStateStore({repo: root, branch: "x'; rm -rf /"})).toThrow();
  });
});

describe('gitStateStore refused write', () => {
  test('the message names the identity in use and the scoped identity fix', () => {
    const s = scene();
    const a = s.clone('a');
    sh(s.remote, 'printf "#!/bin/sh\\nexit 1\\n" > hooks/pre-receive && chmod +x hooks/pre-receive');
    const store = gitStateStore({repo: a, attempts: 1, identity: () => 'someone-else'});
    expect(() => store.writeState('{}')).toThrow(/identity in use is "someone-else".*scoped identity must be set/);
    expect(() => store.appendEvent('{}', at)).toThrow(/someone-else/);
  });
  test('an unreadable identity is said so', () => {
    const s = scene();
    const a = s.clone('a');
    sh(s.remote, 'printf "#!/bin/sh\\nexit 1\\n" > hooks/pre-receive && chmod +x hooks/pre-receive');
    const store = gitStateStore({repo: a, attempts: 1, identity: () => null});
    expect(() => store.writeState('{}')).toThrow(/could not be read.*scoped identity/);
  });
});
