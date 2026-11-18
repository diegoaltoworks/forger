import {ICO_FILE, ICO_SOURCES, packIco, pngSize, RASTERS} from './plan';

/** Draws an SVG document at the given size as PNG bytes. */
export type Rasteriser = (svg: string, width: number, height: number) => Uint8Array;

/** Every raster file the brand folder holds, by name, rendered from its SVG sources. */
export function renderBrand(readSvg: (name: string) => string, rasterise: Rasteriser): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const r of RASTERS) out.set(r.file, rasterise(readSvg(r.source), r.width, r.height));
  const images = ICO_SOURCES.map(name => {
    const png = out.get(name);
    const size = png && pngSize(png);
    if (!png || !size) throw new Error(`${name} is not a rendered PNG`);
    return {...size, png};
  });
  out.set(ICO_FILE, packIco(images));
  return out;
}
