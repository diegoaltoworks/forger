import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync} from 'node:fs';
import {isBuiltin} from 'node:module';
import {join, relative} from 'node:path';

import {tsExtractor} from './arch';

// An installed copy of the plugin has no node_modules; a package import would
// make every command depend on the runtime fetching it (ADR 0014).
const ENGINE = join(import.meta.dir, '../../..');
const ROOTS = [join(ENGINE, 'src'), join(ENGINE, '../bin')];

// A specifier holding `${` is text in a template string that only looks like an import.
function isOwnOrRuntime(specifier: string): boolean {
  return specifier.includes('${') || specifier.startsWith('.') || specifier === 'bun' || specifier.startsWith('bun:') || isBuiltin(specifier);
}

function packageImports(files: {path: string; source: string}[]): string[] {
  return files.flatMap(f => tsExtractor.extract(f.source).filter(r => !isOwnOrRuntime(r.specifier)).map(r => `${f.path}:${r.line} imports ${r.specifier}`));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe('the engine loads no package', () => {
  test("the engine's source imports nothing but its own files and the runtime's built-in modules", () => {
    const files = ROOTS.flatMap(sourceFiles).map(path => ({path: relative(ENGINE, path), source: readFileSync(path, 'utf8')}));
    expect(files.length).toBeGreaterThan(0);
    expect(packageImports(files)).toEqual([]);
  });

  test('an import of a package in the engine\'s source is named with its file', () => {
    const files = [
      {path: 'src/adapters/raster.ts', source: "import {Resvg} from '@resvg/resvg-js';\nimport {a} from './a';\nimport {readFileSync} from 'node:fs';\nimport {join} from 'path';\nimport {test} from 'bun:test';"},
      {path: 'src/cli/late.ts', source: '\n\nconst m = await im' + "port('left-pad');"},
    ];
    expect(packageImports(files)).toEqual(['src/adapters/raster.ts:1 imports @resvg/resvg-js', 'src/cli/late.ts:3 imports left-pad']);
  });
});
