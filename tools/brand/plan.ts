/** One raster the brand generator writes, and the SVG it is drawn from. */
export interface Raster {
  file: string;
  source: string;
  width: number;
  height: number;
}

export const RASTERS: Raster[] = [
  {file: 'favicon-16.png', source: 'favicon.svg', width: 16, height: 16},
  {file: 'favicon-32.png', source: 'favicon.svg', width: 32, height: 32},
  {file: 'avatar-128.png', source: 'avatar.svg', width: 128, height: 128},
  {file: 'avatar-500.png', source: 'avatar.svg', width: 500, height: 500},
  {file: 'social-preview.png', source: 'social-preview.svg', width: 1280, height: 640},
];

/** The PNGs that go into `favicon.ico`, smallest first. */
export const ICO_SOURCES = ['favicon-16.png', 'favicon-32.png'];
export const ICO_FILE = 'favicon.ico';

/** A `.ico` holding the given PNG images, each stored whole. Pure. */
export function packIco(images: {width: number; height: number; png: Uint8Array}[]): Uint8Array {
  const headerSize = 6 + 16 * images.length;
  const total = images.reduce((n, i) => n + i.png.length, headerSize);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((img, i) => {
    const at = 6 + 16 * i;
    out[at] = img.width >= 256 ? 0 : img.width;
    out[at + 1] = img.height >= 256 ? 0 : img.height;
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, img.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

/** The width and height a PNG declares in its header, or null when it is not a PNG. */
export function pngSize(png: Uint8Array): {width: number; height: number} | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || signature.some((b, i) => png[i] !== b)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {width: view.getUint32(16), height: view.getUint32(20)};
}
