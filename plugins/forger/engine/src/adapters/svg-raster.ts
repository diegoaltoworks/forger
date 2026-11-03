import {Resvg} from '@resvg/resvg-js';

import type {Rasteriser} from '../brand';

/**
 * The `Rasteriser` over resvg. The SVGs outline their text, so no font is
 * loaded: the output does not depend on the machine's fonts, and the same
 * input gives the same bytes.
 */
export const resvgRasteriser: Rasteriser = (svg, width, height) => {
  const png = new Resvg(svg, {fitTo: {mode: 'width', value: width}, font: {loadSystemFonts: false}}).render();
  if (png.width !== width || png.height !== height) throw new Error(`rendered ${png.width}x${png.height}, wanted ${width}x${height}`);
  return png.asPng();
};
