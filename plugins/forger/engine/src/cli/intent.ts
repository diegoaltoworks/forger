import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {classifyIntent} from '../intent';
import type {Command} from './command';

/** Dependency names from the repo's root manifest; none when it has no readable one. */
export function manifestDependencies(projectRoot: string): string[] {
  const file = join(projectRoot, 'package.json');
  if (!existsSync(file)) return [];
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const names = (key: string): string[] => {
      const section = pkg[key];
      return section && typeof section === 'object' ? Object.keys(section) : [];
    };
    return [...names('dependencies'), ...names('devDependencies')];
  } catch {
    return [];
  }
}

export const intent: Command = {
  name: 'intent',
  needs: 'root',
  flags: ['request', 'json'],
  help: `  intent --request <text> [--json]
                   Classify a planning request as product or creative from its text and the repo's
                   dependencies, and print the signals that decided it`,
  run(ctx) {
    const request = ctx.values.request;
    if (typeof request !== 'string' || request.trim() === '') {
      console.error('Usage: intent --request <text> [--json]');
      process.exitCode = 1;
      return;
    }
    const result = classifyIntent({request, dependencies: manifestDependencies(ctx.projectRoot)});
    if (ctx.values.json) console.log(JSON.stringify(result));
    else {
      console.log(result.intent);
      for (const s of result.signals) console.log(`  ${s.source}: ${s.id} (${s.match})`);
    }
  },
};
