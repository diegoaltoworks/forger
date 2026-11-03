import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {renderBrand} from '../brand';
import {resvgRasteriser} from '../adapters';
import type {Command} from './command';

export const BRAND_DIR = 'assets/brand';

export const brand: Command = {
  name: 'brand',
  needs: 'root',
  flags: [],
  help: `  brand            Render the brand PNGs and favicon.ico from the SVGs in assets/brand/`,
  run({projectRoot}) {
    const dir = join(projectRoot, BRAND_DIR);
    const files = renderBrand(name => readFileSync(join(dir, name), 'utf8'), resvgRasteriser);
    mkdirSync(dir, {recursive: true});
    for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes);
    console.log([...files.keys()].map(n => `${BRAND_DIR}/${n}`).join('\n'));
  },
};
