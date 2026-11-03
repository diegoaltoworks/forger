# brand

How the PNG and ICO brand assets are produced from the SVG sources in
`assets/brand/`. The SVGs are the source of truth; nothing here draws.

## Files

- `plan.ts` - the rasters and their sizes, the `.ico` packing and the PNG
  header read. Pure.
- `render.ts` - renders every raster through an injected `Rasteriser`, then
  packs the icon. Pure given the rasteriser.

## Entry point

`index.ts`. The `brand` command in `cli/` writes the result into the folder; the
rasteriser is `adapters/svg-raster.ts`.

## May import

Nothing outside this folder.
