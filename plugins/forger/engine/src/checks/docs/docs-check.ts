/**
 * `check docs`: runs the writing rules over every text file git tracks or
 * would track (see `projectFiles`), so ignored files (the denylist itself,
 * build output) are never scanned. The docs pack's content rules (links, images,
 * diagrams, glossary terms) run on Markdown files only when that pack is installed.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {checkAvoidedTerms, checkDiagrams, checkLinks, parseGlossaryAvoid, type AvoidedTerm, type LinkWorld} from './docs-content';
import {branchPr, branchTicket, CATALOGUE_OPINION, CATALOGUE_PATH, checkCatalogue, ticketsOf, trackerFacts, type TicketFacts} from '../../catalogue';
import {loadConfig} from '../../config';
import type {CommandRunner} from '../../ports';
import {projectFiles} from '../files';
import {checkRoadmap, ROADMAP_OPINION, ROADMAP_PATH} from './docs-roadmap';
import {checkCommandSlots, slotsByCommand, type DefinitionShape} from './docs-slots';
import {checkReadme, isCheckedReadme, type ReadmeFinding} from './docs-readme';
import {checkText, parseDenylist} from './docs-rules';
import {LOCK_PATH, parseLock} from '../../packs';
import type {Finding} from '../waivers';
import {forgerPath} from '../../config';

/** Lockfiles are generated, not written. */
const SKIP = [/(^|\/)bun\.lock$/];

/** The ids in the project's lock; no lock means no packs. */
export function installedPackIds(projectRoot: string): string[] {
  const path = forgerPath(projectRoot, LOCK_PATH);
  return existsSync(path) ? parseLock(readFileSync(path, 'utf-8')).packs.map(p => p.id) : [];
}

const GLOSSARY = 'GLOSSARY.md';
const COMMAND_FILE = /^plugins\/forger\/commands\/[^/]+\.md$/;
const DEFINITION = 'plugins/forger/pipeline/default.json';

/** The slots per command of the definition the plugin ships; null in a project that does not carry the plugin. */
function shippedSlots(projectRoot: string): Record<string, string[]> | null {
  const path = join(projectRoot, DEFINITION);
  if (!existsSync(path)) return null;
  return slotsByCommand(JSON.parse(readFileSync(path, 'utf-8')) as DefinitionShape);
}

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

/** README findings, failures and warnings, when the docs pack is installed. */
export function readmeFindings(projectRoot: string, run: CommandRunner, packs: string[] = installedPackIds(projectRoot)): ReadmeFinding[] {
  if (!packs.includes('docs')) return [];
  return projectFiles(run)
    .filter(f => isCheckedReadme(f) && existsSync(join(projectRoot, f)))
    .flatMap(f => checkReadme(f, readFileSync(join(projectRoot, f), 'utf-8')));
}

/** The warnings alone: reported by `check docs`, never failing it. */
export function runDocsWarnings(projectRoot: string, run: CommandRunner, packs?: string[]): ReadmeFinding[] {
  return readmeFindings(projectRoot, run, packs).filter(f => f.severity === 'warn');
}

/**
 * The catalogue's missing or stale statuses. Facts the tracker cannot give
 * leave only the structure checked. On a ticket branch, a Fixed row may name
 * that ticket while its issue is still open: the merge closes it. Once the
 * branch has an open PR, an Open row whose only open issue is that ticket fails.
 */
export function catalogueFindings(
  projectRoot: string,
  run: CommandRunner,
  lookup: (tickets: number[]) => TicketFacts | null = tickets => trackerFacts(run, tickets)
): Finding[] {
  const path = join(projectRoot, CATALOGUE_PATH);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const ticket = branchTicket(run);
  return checkCatalogue(text, lookup(ticketsOf(text)), ticket, ticket === null ? null : branchPr(run)).map(p => ({file: CATALOGUE_PATH, line: p.line, rule: p.rule, opinion: CATALOGUE_OPINION, detail: p.detail}));
}

/** Roadmap items that link no issue. */
export function roadmapFindings(projectRoot: string): Finding[] {
  const path = join(projectRoot, ROADMAP_PATH);
  if (!existsSync(path)) return [];
  return checkRoadmap(readFileSync(path, 'utf-8')).map(p => ({file: ROADMAP_PATH, line: p.line, rule: p.rule, opinion: ROADMAP_OPINION, detail: p.detail}));
}

export function runDocsCheck(
  projectRoot: string,
  run: CommandRunner,
  packs: string[] = installedPackIds(projectRoot),
  lookup?: (tickets: number[]) => TicketFacts | null
): Finding[] {
  const denyFile = join(projectRoot, '.forger-denylist');
  const terms = existsSync(denyFile) ? parseDenylist(readFileSync(denyFile, 'utf-8')) : [];
  const names = loadConfig(projectRoot).model_names;
  const files = projectFiles(run).filter(f => !SKIP.some(s => s.test(f)));

  const glossary = join(projectRoot, GLOSSARY);
  const content =
    packs.includes('docs')
      ? contentRules(projectRoot, existsSync(glossary) ? parseGlossaryAvoid(readFileSync(glossary, 'utf-8')) : [])
      : null;

  const slots = shippedSlots(projectRoot);
  const out: Finding[] = [];
  for (const file of files) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    if (buf.includes(0)) continue;
    const text = buf.toString('utf-8');
    out.push(...checkText(file, text, terms, names));
    if (content && file.endsWith('.md')) out.push(...content(file, text));
    if (slots && COMMAND_FILE.test(file)) out.push(...checkCommandSlots(file, text, slots));
  }
  out.push(...readmeFindings(projectRoot, run, packs).filter(f => f.severity === 'fail'));
  if (packs.includes('docs')) out.push(...catalogueFindings(projectRoot, run, lookup), ...roadmapFindings(projectRoot));
  return out;
}
