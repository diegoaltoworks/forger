import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';

import {resvgRasteriser} from './raster';
import {renderBrand} from './render';

export const BRAND_DIR = join(import.meta.dir, '../../assets/brand');

if (import.meta.main) {
  const files = renderBrand(name => readFileSync(join(BRAND_DIR, name), 'utf8'), resvgRasteriser);
  mkdirSync(BRAND_DIR, {recursive: true});
  for (const [name, bytes] of files) writeFileSync(join(BRAND_DIR, name), bytes);
  console.log([...files.keys()].map(n => relative(process.cwd(), join(BRAND_DIR, n))).join('\n'));
}
