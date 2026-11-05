/**
 * Every flag the CLI accepts, in one parse table. Each command names the flags
 * it reads (see `registry.ts`); they are parsed together because any flag is
 * accepted on any command.
 */

import type {parseArgs} from 'util';

export const FLAGS = {
  iterations: {type: 'string', short: 'n', default: '1'},
  continuous: {type: 'boolean', default: false},
  json: {type: 'boolean', default: false},
  update: {type: 'boolean', default: false},
  gates: {type: 'string'},
  'base-branch': {type: 'string'},
  tracker: {type: 'string'},
  issue: {type: 'string'},
  ticket: {type: 'string'},
  stage: {type: 'string'},
  slot: {type: 'string'},
  skill: {type: 'string'},
  attempt: {type: 'string'},
  remove: {type: 'boolean', default: false},
  reason: {type: 'string'},
  detail: {type: 'string'},
  pr: {type: 'string'},
  threshold: {type: 'string'},
  force: {type: 'boolean', default: false},
  list: {type: 'boolean'},
  summary: {type: 'boolean', default: false},
  preset: {type: 'string'},
  flavour: {type: 'string'},
  packs: {type: 'string'},
  harness: {type: 'string'},
  upgrade: {type: 'boolean'},
  detect: {type: 'boolean', default: false},
  presets: {type: 'boolean', default: false},
  seen: {type: 'string', default: '0'},
  timeout: {type: 'string', default: '3600'},
  last: {type: 'string'},
  window: {type: 'string'},
  from: {type: 'string'},
  since: {type: 'string'},
  report: {type: 'boolean', default: false},
  diff: {type: 'boolean', default: false},
  name: {type: 'string'},
  description: {type: 'string'},
  type: {type: 'string'},
  rule: {type: 'string'},
  owner: {type: 'string'},
  date: {type: 'string'},
  why: {type: 'string'},
  how: {type: 'string'},
  'enforced-by': {type: 'string'},
  title: {type: 'string'},
  file: {type: 'string'},
  'dry-run': {type: 'boolean', default: false},
  section: {type: 'string', multiple: true},
  fix: {type: 'boolean', default: false},
  state: {type: 'boolean', default: false},
  wireframe: {type: 'string'},
  capture: {type: 'string'},
  lesson: {type: 'string'},
  request: {type: 'string'},
  evidence: {type: 'string', multiple: true},
  help: {type: 'boolean', short: 'h', default: false},
} as const;

export type FlagName = keyof typeof FLAGS;

export type Values = ReturnType<typeof parseArgs<{args: string[]; options: typeof FLAGS; allowPositionals: true}>>['values'];
