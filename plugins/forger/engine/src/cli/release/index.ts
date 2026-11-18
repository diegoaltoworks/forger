import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {runRelease, type ReleaseMode} from '../../supervisor';
import type {Command} from '../command';

export const release: Command = {
  name: 'release',
  needs: 'config',
  flags: ['json', 'plan', 'file-ticket', 'write', 'check', 'notes', 'bump', 'version'],
  help: `  release --plan [--json] [--bump patch|minor|major]
                   The current version, the bump from the labels of the tickets merged since its tag, the next version
                   and the changes. With no \`release.files\` in the config, says so and exits 1
  release --file   File the release ticket (not while one is open); the owner's word
  release --write --version V
                   Write V into every release file and a changelog entry on top; makes no commit
  release --check --version V
                   Exit 0 when every file holds V and the changelog starts with V, else 1 with what differs
  release --notes --version V
                   Print the changelog's entry for V, for the text of a published release; exits 1 when there is none`,
  run(ctx) {
    const {values, projectRoot, config} = ctx;
    const modes: [boolean, ReleaseMode][] = [[values.plan, 'plan'], [values['file-ticket'], 'file'], [values.write, 'write'], [values.check, 'check'], [values.notes, 'notes']];
    const chosen = modes.filter(([on]) => on).map(([, m]) => m);
    const outcome = chosen.length > 1
      ? {exitCode: 1, out: '', err: 'release: pass only one of --plan, --file, --write, --check, --notes'}
      : runRelease(
          {mode: chosen[0] ?? null, json: values.json, bump: values.bump, version: values.version},
          {
            settings: config.release,
            baseBranch: config.base_branch,
            intakeLabel: config.tracker.label,
            run: ctx.run(),
            tracker: ctx.tracker(),
            fs: {
              read: p => (existsSync(join(projectRoot, p)) ? readFileSync(join(projectRoot, p), 'utf-8') : null),
              write: (p, text) => writeFileSync(join(projectRoot, p), text),
            },
          }
        );
    if (outcome.out !== '') console.log(outcome.out);
    if (outcome.err !== '') console.error(outcome.err);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  },
};
