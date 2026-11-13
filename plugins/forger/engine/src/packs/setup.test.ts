import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

import {claudeHarness, codexHarness, copilotHarness, opencodeHarness} from '../adapters';
import {sha256} from './packs';
import {gitignoreLines, mergeGitignore, relocatableGates, renderConfig, runSetup, trackedRuntimeFiles, formatTrackedRuntime, withCheck} from './setup';

const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function emptyProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-setup-'));
  dirs.push(root);
  return root;
}

describe('withCheck', () => {
  test('appends the check to the gates', () => {
    expect(withCheck('npm test', 'forger check docs')).toBe('npm test && forger check docs');
  });
  test('does not add it twice', () => {
    expect(withCheck('npm test && x check docs', 'y check docs')).toBe('npm test && x check docs');
  });
  test('gates already ending in the check command are kept', () => {
    expect(withCheck('npm test && bun /p/bin/work.ts check', 'bun /q/bin/work.ts check')).toBe('npm test && bun /p/bin/work.ts check');
  });
  test('a bare "run check" script is not the check command', () => {
    expect(withCheck('bun run check', 'c')).toBe('bun run check && c');
  });
  test('empty gates become the check alone', () => {
    expect(withCheck(' ', 'c check docs')).toBe('c check docs');
  });
});

describe('renderConfig skills', () => {
  const template = JSON.stringify({gates: 'g', skills: {}});
  test('a flavour is recorded with its version', () => {
    expect(JSON.parse(renderConfig(template, {flavour: 'c@2'}, 'c check docs')).flavour).toBe('c@2');
  });
  test('without a flavour the config does not name one', () => {
    expect(JSON.parse(renderConfig(template, {}, 'c check docs')).flavour).toBeUndefined();
  });
});

describe('renderConfig', () => {
  const template = JSON.stringify({gates: 'old', base_branch: 'main', tracker: {kind: 'github', label: 'l'}});
  test('applies the answers and keeps the rest', () => {
    const out = JSON.parse(renderConfig(template, {gates: 'make test', baseBranch: 'dev', trackerKind: 'local'}, 'c check docs'));
    expect(out.gates).toBe('make test && c check docs');
    expect(out.base_branch).toBe('dev');
    expect(out.tracker).toEqual({kind: 'local', label: 'l'});
  });
  test('without answers the template defaults stay, plus the docs check', () => {
    const out = JSON.parse(renderConfig(template, {}, 'c check docs'));
    expect(out.gates).toBe('old && c check docs');
    expect(out.base_branch).toBe('main');
  });
});

describe('mergeGitignore', () => {
  test('adds only the missing lines, on their own line', () => {
    const r = mergeGitignore('node_modules\n.forger/HALT', ['.forger/HALT', '.forger/state.json']);
    expect(r.added).toEqual(['.forger/state.json']);
    expect(r.kept).toEqual(['.forger/HALT']);
    expect(r.text).toBe('node_modules\n.forger/HALT\n.forger/state.json\n');
  });
  test('leaves the text untouched when nothing is missing', () => {
    expect(mergeGitignore('a\n', ['a']).text).toBe('a\n');
  });
});

describe('runSetup', () => {
  test('writes every default file, then writes nothing on a second run', () => {
    const root = emptyProject();
    const first = runSetup(root, PLUGIN_ROOT, {gates: 'make test'});
    expect(first.files.every(f => f.action === 'written')).toBe(true);
    expect(first.gitignore.added).toEqual(gitignoreLines('.forger'));
    for (const f of first.files) expect(existsSync(join(root, f.path))).toBe(true);

    const second = runSetup(root, PLUGIN_ROOT, {gates: 'other'});
    expect(second.files.every(f => f.action === 'kept')).toBe(true);
    expect(second.gitignore.added).toEqual([]);
  });

  test('never overwrites a file the project already has', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    writeFileSync(join(root, '.forger/process.md'), 'mine');
    runSetup(root, PLUGIN_ROOT, {});
    expect(readFileSync(join(root, '.forger/process.md'), 'utf-8')).toBe('mine');
  });

  test('the installed process.md carries principle 0 and the default gotchas', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    const process = readFileSync(join(root, '.forger/process.md'), 'utf-8');
    expect(process).toContain('Determinism first');
    expect(process).toContain('principle 0');
    expect(process).toContain('Comments say why');
  });

  test('the gates written into the config include the check', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {gates: 'make test'});
    const config = JSON.parse(readFileSync(join(root, '.forger/workloop.config.json'), 'utf-8'));
    expect(config.gates).toBe('make test && bun "$FORGER_PLUGIN_ROOT/bin/work.ts" check');
    expect(config.gates).not.toContain(PLUGIN_ROOT);
  });

  test('a fresh repository passes its own check', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {gates: 'make test'});
    const gates = JSON.parse(readFileSync(join(root, '.forger/workloop.config.json'), 'utf-8')).gates as string;
    expect(gates).not.toMatch(/\/(home|Users)\//);
  });

  test('installs the ticket, PR, work order, report, retro and rule templates', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    for (const n of ['ticket', 'pr', 'work-order', 'report', 'retro', 'rule']) {
      expect(existsSync(join(root, `.forger/templates/${n}.md`))).toBe(true);
    }
  });

  test('writes a lock whose hashes match the installed files, and leaves it alone on a second run', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    const lockPath = join(root, '.forger/forger.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(lock.packs.map((p: {id: string}) => p.id)).toEqual(['base', 'structure']);
    expect(lock.packs[0].files.length).toBeGreaterThan(0);
    for (const f of lock.packs.flatMap((p: {files: Array<{path: string; sha256: string}>}) => p.files)) {
      expect(sha256(readFileSync(join(root, f.path)))).toBe(f.sha256);
    }
    const before = readFileSync(lockPath, 'utf-8');
    const second = runSetup(root, PLUGIN_ROOT, {});
    expect(second.files.every(f => f.action === 'kept')).toBe(true);
    expect(readFileSync(lockPath, 'utf-8')).toBe(before);
  });

  test('a file the project already had is not recorded in the lock', () => {
    const root = emptyProject();
    mkdirSync(join(root, '.forger'));
    writeFileSync(join(root, '.forger/process.md'), 'mine');
    runSetup(root, PLUGIN_ROOT, {});
    const lock = JSON.parse(readFileSync(join(root, '.forger/forger.lock.json'), 'utf-8'));
    expect(lock.packs[0].files.map((f: {path: string}) => f.path)).not.toContain('.forger/process.md');
  });

  test('an unknown pack is an error and writes nothing', () => {
    const root = emptyProject();
    expect(() => runSetup(root, PLUGIN_ROOT, {packs: ['nope']})).toThrow('Unknown pack: nope');
    expect(existsSync(join(root, '.forger'))).toBe(false);
  });
});

describe('runSetup layout and harness', () => {
  test('a fresh setup writes only .forger/ and the gitignore', () => {
    const root = emptyProject();
    const result = runSetup(root, PLUGIN_ROOT, {gates: 'make'});
    expect(result.files.every(f => f.path.startsWith('.forger/'))).toBe(true);
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, '.forger/workloop.config.json'), 'utf-8')).harness).toBeUndefined();
  });

  test('setup in a legacy repo keeps writing where the files already are', () => {
    const root = emptyProject();
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude/workloop.config.json'), '{}');
    runSetup(root, PLUGIN_ROOT, {});
    expect(existsSync(join(root, '.claude/process.md'))).toBe(true);
    expect(existsSync(join(root, '.forger'))).toBe(false);
    expect(readFileSync(join(root, '.gitignore'), 'utf-8')).toContain('.claude/runner.lock');
  });

  test('a harness records its id and has its commands installed, once, packaged for it', () => {
    const root = emptyProject();
    const first = runSetup(root, PLUGIN_ROOT, {harness: opencodeHarness});
    expect(JSON.parse(readFileSync(join(root, '.forger/workloop.config.json'), 'utf-8')).harness).toBe('opencode');
    const command = join(root, '.opencode/commands/forger-auto-ticket.md');
    const text = readFileSync(command, 'utf-8');
    expect(text).not.toContain('allowed-tools');
    expect(text).not.toContain('CLAUDE_PLUGIN_ROOT');
    expect(text).toContain(PLUGIN_ROOT);
    expect(first.files.find(f => f.path === '.opencode/commands/forger-auto-ticket.md')?.action).toBe('written');
    const second = runSetup(root, PLUGIN_ROOT, {harness: opencodeHarness});
    expect(second.files.every(f => f.action === 'kept')).toBe(true);
  });

  for (const [harness, path] of [
    [codexHarness, '.agents/skills/forger-auto-ticket/SKILL.md'],
    [copilotHarness, '.github/skills/forger-auto-ticket/SKILL.md'],
  ] as const) {
    test(`${harness.id} gets its commands as skills, once`, () => {
      const root = emptyProject();
      const first = runSetup(root, PLUGIN_ROOT, {harness});
      const text = readFileSync(join(root, path), 'utf-8');
      expect(text).toContain('name: forger-auto-ticket');
      expect(text).not.toContain('allowed-tools');
      expect(first.files.find(f => f.path === path)?.action).toBe('written');
      expect(runSetup(root, PLUGIN_ROOT, {harness}).files.every(f => f.action === 'kept')).toBe(true);
    });
  }
});

describe('setup --harness', () => {
  const START = ['setup', 'plan', 'work'];
  for (const harness of [claudeHarness, opencodeHarness, codexHarness, copilotHarness]) {
    test(`setup --harness writes the start commands for each harness: ${harness.id}`, () => {
      const root = emptyProject();
      const result = runSetup(root, PLUGIN_ROOT, {harness});
      expect(JSON.parse(readFileSync(join(root, '.forger/workloop.config.json'), 'utf-8')).harness).toBe(harness.id);
      for (const step of START) {
        const rel = harness.commandPath(step);
        if (rel === null) {
          expect(harness.id).toBe('claude');
          continue;
        }
        expect(result.files.find(f => f.path === rel)?.action).toBe('written');
        expect(existsSync(join(root, rel))).toBe(true);
      }
    });
  }
});

describe('relocatableGates', () => {
  test('swaps an absolute check command for the variable form', () => {
    expect(relocatableGates('make test && bun /opt/a/plug/bin/work.ts check')).toBe('make test && bun "$FORGER_PLUGIN_ROOT/bin/work.ts" check');
    expect(relocatableGates('bun "/opt/p/bin/work.ts" check')).toBe('bun "$FORGER_PLUGIN_ROOT/bin/work.ts" check');
  });
  test('leaves a relative or variable form alone', () => {
    expect(relocatableGates('bun plugins/forger/bin/work.ts check')).toBe('bun plugins/forger/bin/work.ts check');
    expect(relocatableGates('bun "$FORGER_PLUGIN_ROOT/bin/work.ts" check')).toBe('bun "$FORGER_PLUGIN_ROOT/bin/work.ts" check');
  });
});

describe('tracked runtime files', () => {
  test('setup reports a runtime file that git tracks and names the command that stops tracking it', () => {
    const root = emptyProject();
    const commands: string[] = [];
    const tracked = trackedRuntimeFiles(root, c => {
      commands.push(c);
      return '.forger/checks.jsonl\n';
    });
    expect(tracked).toEqual(['.forger/checks.jsonl']);
    expect(formatTrackedRuntime(tracked)).toEqual(['! git tracks .forger/checks.jsonl; stop tracking it and keep the file with: git rm --cached .forger/checks.jsonl']);
    expect(commands.every(c => c.startsWith('git ls-files'))).toBe(true);
  });
  test('setup reports nothing when no runtime file is tracked', () => {
    const root = emptyProject();
    expect(trackedRuntimeFiles(root, () => '')).toEqual([]);
    expect(trackedRuntimeFiles(root, () => { throw new Error('not a repository'); })).toEqual([]);
    expect(formatTrackedRuntime([])).toEqual([]);
  });
});
