# brand

Renders the PNG and ICO brand assets from the SVG sources in `assets/brand/`.
It is a tool of this repository, not of the engine, which loads no package (ADR 0014).

The SVGs are the source of truth; nothing here draws.

Run `bun install` here once, then `bun tools/brand/brand.ts` from the root.

## Files

- `plan.ts` - the rasters and their sizes, the `.ico` packing and the PNG
  header read. Pure.
- `render.ts` - renders every raster through an injected `Rasteriser`, then
  packs the icon. Pure given the rasteriser.
- `raster.ts` - the `Rasteriser` over resvg.
- `brand.ts` - the script that writes the result into `assets/brand/`.
- `brand.test.ts` - renders twice and compares the bytes with the committed files.
