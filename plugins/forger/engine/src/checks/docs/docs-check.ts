/**
 * `check docs`: runs the writing rules over every tracked text file. The list
 * comes from git so untracked and ignored files (the denylist itself, build
 * output) are never scanned. The docs pack's content rules (links, images,
 * diagrams, glossary terms) run on Markdown files only when that pack is installed.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {checkAvoidedTerms, checkDiagrams, checkLinks, parseGlossaryAvoid, type AvoidedTerm, type LinkWorld} from './docs-content';
import {loadConfig} from '../../config';
import type {CommandRunner} from '../../ports';
import {checkText, parseDenylist} from './docs-rules';
import {LOCK_PATH, parseLock} from '../../packs';
import type {Finding} from '../waivers';

/** Lockfiles are generated, not written. */
const SKIP = [/(^|\/)bun\.lock$/];

/** The ids in the project's lock; no lock means no packs. */
export function installedPackIds(projectRoot: string): string[] {
  const path = join(projectRoot, LOCK_PATH);
  return existsSync(path) ? parseLock(readFileSync(path, 'utf-8')).packs.map(p => p.id) : [];
}

const GLOSSARY = 'GLOSSARY.md';

function contentRules(projectRoot: string, avoided: AvoidedTerm[]): (file: string, text: string) => Finding[] {
  const world: LinkWorld = {
    exists: p => existsSync(join(projectRoot, p)),
    read: p => (existsSync(join(projectRoot, p)) ? readFileSync(join(projectRoot, p), 'utf-8') : null),
  };
  return (file, text) => [
    ...checkLinks(file, text, world),
    ...checkDiagrams(file, text),
    ...(file === GLOSSARY ? [] : checkAvoidedTerms(file, text, avoided)),
  ];
}

export function runDocsCheck(projectRoot: string, run: CommandRunner, packs: string[] = installedPackIds(projectRoot)): Finding[] {
  const denyFile = join(projectRoot, '.forger-denylist');
  const terms = existsSync(denyFile) ? parseDenylist(readFileSync(denyFile, 'utf-8')) : [];
  const names = loadConfig(projectRoot).model_names;
  const files = run('git ls-files').split('\n').filter(f => f !== '' && !SKIP.some(s => s.test(f)));

  const glossary = join(projectRoot, GLOSSARY);
  const content =
    packs.includes('docs')
      ? contentRules(projectRoot, existsSync(glossary) ? parseGlossaryAvoid(readFileSync(glossary, 'utf-8')) : [])
      : null;

  const out: Finding[] = [];
  for (const file of files) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    if (buf.includes(0)) continue;
    const text = buf.toString('utf-8');
    out.push(...checkText(file, text, terms, names));
    if (content && file.endsWith('.md')) out.push(...content(file, text));
  }
  return out;
}
