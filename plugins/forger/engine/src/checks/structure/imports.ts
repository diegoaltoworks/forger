/**
 * The import-based rules of `check structure`: server guards, client files
 * that import server modules, declared boundaries and import cycles. Imports
 * come from `check arch`'s extractor and resolver, so there is one import
 * parser. Pure over a list of paths and a reader for file text.
 */

import {extractorFor, resolveImport, type ImportExtractor, type ImportRef} from '../arch';
import {globToRegExp} from '../waivers';
import type {Boundary, Observation, StructureConfig} from './structure';

interface Parsed {
  path: string;
  text: string;
  extractor: ImportExtractor;
  refs: ImportRef[];
  /** Repo file each ref resolves to, or null for a package or an unresolved path. */
  targets: (string | null)[];
}

/** `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`, `node:fs` stays. */
export function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const LEADING_NOISE = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;

/** True when the first statement of the text is a bare string statement equal to a marker. */
export function startsWithMarker(text: string, markers: string[]): boolean {
  const code = text.replace(LEADING_NOISE, '');
  return markers.some(m => code.startsWith(m));
}

function groupOf(file: string, boundaries: Boundary[]): Boundary | undefined {
  return boundaries.find(b => b.paths.some(p => globToRegExp(p).test(file)));
}

function parse(sources: string[], read: (path: string) => string): Parsed[] {
  const known = new Set(sources);
  const out: Parsed[] = [];
  for (const path of sources) {
    const extractor = extractorFor(path);
    if (!extractor) continue;
    const text = read(path);
    const refs = extractor.extract(text);
    out.push({path, text, extractor, refs, targets: refs.map(r => resolveImport(path, r.specifier, extractor, p => known.has(p)))});
  }
  return out;
}

function serverGuards(files: Parsed[], config: StructureConfig): Observation[] {
  const out: Observation[] = [];
  for (const guard of config.server_guards) {
    const re = globToRegExp(guard.files);
    for (const f of files) {
      if (!re.test(f.path) || f.refs.some(r => r.specifier === guard.must_import)) continue;
      out.push({
        rule: 'structure.server-guard',
        path: f.path,
        line: 1,
        key: guard.must_import,
        message: `${f.path} matches ${guard.files} but does not import "${guard.must_import}"; the name promises server-only code, add the guard import`,
      });
    }
  }
  return out;
}

function clientImportsServer(files: Parsed[], config: StructureConfig): Observation[] {
  const server = config.server_guards.map(g => globToRegExp(g.files));
  if (server.length === 0) return [];
  const out: Observation[] = [];
  for (const f of files) {
    if (!startsWithMarker(f.text, config.client_markers)) continue;
    f.refs.forEach((ref, i) => {
      const target = f.targets[i];
      if (target === null || !server.some(re => re.test(target))) return;
      out.push({
        rule: 'structure.client-imports-server',
        path: f.path,
        line: ref.line,
        key: target,
        message: `${f.path} is a client file but imports the server module ${target}; move the shared part out or call it from the server`,
      });
    });
  }
  return out;
}

function boundaries(files: Parsed[], config: StructureConfig): Observation[] {
  if (config.boundaries.length === 0) return [];
  const out: Observation[] = [];
  for (const f of files) {
    const from = groupOf(f.path, config.boundaries);
    if (!from) continue;
    f.refs.forEach((ref, i) => {
      const target = f.targets[i];
      if (target !== null) {
        const to = groupOf(target, config.boundaries);
        if (!to || to.name === from.name || from.may_import.includes(to.name)) return;
        out.push({
          rule: 'structure.boundary',
          path: f.path,
          line: ref.line,
          key: target,
          message: `${from.name} must not import ${to.name}: ${target} (${ref.kind} import of ${ref.specifier})`,
        });
        return;
      }
      if (ref.specifier.startsWith('.') || from.external === undefined) return;
      const pkg = packageOf(ref.specifier);
      if (from.external.includes(pkg) || from.external.includes(ref.specifier)) return;
      out.push({
        rule: 'structure.boundary',
        path: f.path,
        line: ref.line,
        key: pkg,
        message: `${from.name} may not import the package "${pkg}" (${ref.kind} import of ${ref.specifier}); its external list is ${from.external.join(', ') || 'empty'}`,
      });
    });
  }
  return out;
}

/** Strongly connected components of the internal import graph that hold more than one file or a self-import. */
export function cyclesOf(graph: Map<string, string[]>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const group: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      group.push(w);
    } while (w !== v);
    if (group.length > 1 || (graph.get(v) ?? []).includes(v)) out.push(group.sort());
  };
  for (const v of [...graph.keys()].sort()) if (!index.has(v)) visit(v);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/** Type-only imports are erased, so they do not make a runtime cycle. */
function cycles(files: Parsed[]): Observation[] {
  const graph = new Map<string, string[]>();
  for (const f of files) {
    graph.set(f.path, [...new Set(f.refs.flatMap((r, i) => (r.kind === 'type' || f.targets[i] === null ? [] : [f.targets[i] as string])))]);
  }
  return cyclesOf(graph).map(group => ({
    rule: 'structure.cycle',
    path: group[0],
    line: 1,
    key: group.join(' -> '),
    message: `import cycle: ${group.join(' -> ')} -> ${group[0]}; break it by moving the shared part to a file both import`,
  }));
}

export function observeImports(sources: string[], config: StructureConfig, read: (path: string) => string): Observation[] {
  const wanted = config.server_guards.length > 0 || config.boundaries.length > 0 || config.cycles;
  if (!wanted) return [];
  const files = parse(sources, read);
  return [...serverGuards(files, config), ...clientImportsServer(files, config), ...boundaries(files, config), ...(config.cycles ? cycles(files) : [])];
}
