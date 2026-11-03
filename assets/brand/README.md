# Brand assets

The SVGs are the source; the PNGs and `favicon.ico` are generated from them.
`brand-sheet.jpg` is the original reference the geometry was measured from. Do
not use it directly: it is boxed, lossy, and its social preview names another
repository.

## Files

| File | For |
|---|---|
| `symbol.svg` | the mark in ember orange, readable on light and dark |
| `symbol-light.svg`, `symbol-dark.svg` | the mark for a light, or a dark, background |
| `wordmark-light.svg`, `wordmark-dark.svg`, `wordmark-orange.svg` | the word "forger" for a light background, a dark one, and in ember |
| `lockup-light.svg`, `lockup-dark.svg` | the horizontal lockup, mark and wordmark, for a light or dark background; the README header |
| `favicon.svg` | the favicon source, the mark on a charcoal tile |
| `favicon-16.png`, `favicon-32.png`, `favicon.ico` | generated favicons; the icon holds both sizes |
| `avatar.svg` | the avatar source |
| `avatar-128.png`, `avatar-500.png` | generated avatars |
| `social-preview.svg`, `social-preview.png` | the repository social preview at 1280x640; the PNG is generated |

## Palette

| Name | Value |
|---|---|
| Ember | `#FF5722` |
| Steel | `#708090` |
| Charcoal | `#1E1E1E` |

## Type

The wordmark and the social preview are set in Outfit (weights 600 and 500),
licensed under the SIL Open Font License 1.1. The glyphs are converted to
outlines in the SVGs, so nothing renders with a font at runtime and Outfit is
not needed to use the files.

## Regenerating the rasters

```
bun plugins/forger/bin/work.ts brand
```

The output is deterministic; the engine tests fail when a committed raster no
longer matches its SVG. The social preview must be uploaded by hand: see
`.forger/human.md`.
