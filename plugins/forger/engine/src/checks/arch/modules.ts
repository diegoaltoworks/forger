/**
 * The module rules of `check arch`: a folder declared as a module has a README,
 * and code outside it reaches it only through its entry file. Both are pure
 * functions over the tracked paths and the import graph.
 */

import {extractorFor, resolveImport, EXTRACTORS, type ArchConfig, type ImportExtractor, type SourceFile} from './arch';
import {globToRegExp, type Finding} from '../waivers';

export const MODULE_README_OPINION = 'architecture.module-readme';
export const PUBLIC_ENTRY_OPINION = 'architecture.public-entry';

/** The outermost ancestor folder of a file that matches a module glob, or null. */
export function moduleOf(file: string, patterns: RegExp[]): string | null {
  const segs = file.split('/').slice(0, -1);
  for (let n = 1; n <= segs.length; n++) {
    const dir = segs.slice(0, n).join('/');
    if (patterns.some(re => re.test(dir))) return dir;
  }
  return null;
}

export function moduleReadmeFindings(paths: string[], config: ArchConfig): Finding[] {
  if (!config.modules) return [];
  const patterns = config.modules.paths.map(globToRegExp);
  const have = new Set(paths);
  const dirs = new Set<string>();
  for (const p of paths) {
    const dir = moduleOf(p, patterns);
    if (dir !== null) dirs.add(dir);
  }
  return [...dirs]
    .sort()
    .filter(dir => !have.has(`${dir}/README.md`))
    .map(dir => ({
      file: `${dir}/README.md`,
      line: 1,
      rule: 'missing-readme',
      opinion: MODULE_README_OPINION,
      detail: `module ${dir} has no README.md`,
    }));
}

export function publicEntryFindings(files: SourceFile[], config: ArchConfig, extractors: ImportExtractor[] = EXTRACTORS): Finding[] {
  if (!config.modules) return [];
  const {entry} = config.modules;
  const patterns = config.modules.paths.map(globToRegExp);
  const known = new Set(files.map(f => f.path));
  const out: Finding[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const extractor = extractorFor(file.path, extractors);
    if (!extractor) continue;
    const here = moduleOf(file.path, patterns);
    for (const ref of extractor.extract(file.text)) {
      const target = resolveImport(file.path, ref.specifier, extractor, p => known.has(p));
      if (target === null) continue;
      const there = moduleOf(target, patterns);
      if (there === null || there === here || target === `${there}/${entry}`) continue;
      out.push({
        file: file.path,
        line: ref.line,
        rule: 'internal-import',
        opinion: PUBLIC_ENTRY_OPINION,
        detail: `${target} is internal to ${there}; import through ${there}/${entry} (${ref.kind} import of ${ref.specifier})`,
      });
    }
  }
  return out;
}
