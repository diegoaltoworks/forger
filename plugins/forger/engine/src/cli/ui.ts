import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import {loadUiConfig} from '../checks';
import {BASELINE_MANIFEST, approvalTargets, baselinePath, parseBaselines, planCaptures, withApproval, type BaselineManifest} from '../ui';
import type {Command} from './command';

export const ui: Command = {
  name: 'ui',
  needs: 'root',
  flags: ['json', 'owner'],
  help: `  ui approve STATE [--owner NAME] [--json]
                   Approve the committed screenshots of a named state (or a route, by its slug) as its
                   baseline: copies them under .forger/ui-baselines/ and records NAME (default: git user.name) in
                   the manifest. From then on check ui fails when a capture drifts beyond the tolerance.
                   Approving is the owner's action (approval ui_approve); the change lands by PR`,
  run(ctx) {
    const {values, positionals, projectRoot} = ctx;
    const fail = (message: string): void => {
      console.error(message);
      process.exitCode = 1;
    };
    if (positionals[1] !== 'approve' || positionals[2] === undefined) return fail('Usage: ui approve STATE [--owner NAME] [--json]');
    try {
      const name = positionals[2];
      const targets = approvalTargets(planCaptures(loadUiConfig(projectRoot)), name);
      if (targets.length === 0) return fail(`ui: no state or route named "${name}" in .forger/ui.json`);
      const missing = targets.filter(t => !existsSync(join(projectRoot, t.file))).map(t => t.file);
      if (missing.length > 0) return fail(`ui: capture the screenshots first (screenshot); missing:\n${missing.join('\n')}`);
      const by = (values.owner as string | undefined) ?? gitUser(ctx.run());
      if (by === '') return fail('ui: say who approves with --owner NAME');
      for (const t of targets) {
        const to = join(projectRoot, baselinePath(t.file));
        mkdirSync(dirname(to), {recursive: true});
        copyFileSync(join(projectRoot, t.file), to);
      }
      const manifestPath = join(projectRoot, BASELINE_MANIFEST);
      const manifest: BaselineManifest = existsSync(manifestPath) ? parseBaselines(readFileSync(manifestPath, 'utf-8')) : {approved: []};
      const entry = {name, approved_by: by, files: targets.map(t => t.file)};
      writeFileSync(manifestPath, JSON.stringify(withApproval(manifest, entry), null, 2) + '\n');
      console.log(values.json ? JSON.stringify(entry) : `approved "${name}" (${entry.files.length} images) by ${by}`);
    } catch (e) {
      fail((e as Error).message);
    }
  },
};

function gitUser(run: (cmd: string) => string): string {
  try {
    return run('git config user.name').trim();
  } catch {
    return '';
  }
}
