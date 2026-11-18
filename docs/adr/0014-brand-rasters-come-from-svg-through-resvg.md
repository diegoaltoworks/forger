# Brand rasters come from the SVGs through resvg

Status: Accepted

The brand started as one generated sheet, which is a boxed, lossy picture and cannot serve as a favicon, an avatar or a README header. The owner asked for the pieces as individual files, used in the README.

## Context

The symbol is simple geometry, so it can be drawn exactly. The wordmark and the social preview carry text, which must not depend on a font the viewer or the build machine has. The PNGs and the icon are derived files: they must come from a command and be byte-identical on every run, or a regenerate shows a diff nobody made (principle 0).

## Options

1. **Crop the sheet.** No dependency, but blurry and boxed, and the sheet's social preview names the wrong repository.
2. **Render with a system tool** (a browser, ImageMagick, librsvg). Output varies with the installed version and fonts, and the tool is not there on every machine.
3. **A rasteriser package.** `@resvg/resvg-js` renders an SVG to PNG with prebuilt binaries, no system library and no font when the text is already outlines. Chosen.

## Decision

The SVGs under `assets/brand/` are the source of truth, with text turned into outlines from an open-licensed font (recorded in `assets/brand/README.md`). `bun tools/brand/brand.ts` renders the PNGs and `favicon.ico` through resvg, behind the `Rasteriser` type so the logic is tested apart from it. A test renders twice, compares the bytes, and compares them with the committed files, so a changed SVG that was not re-rendered fails the gates.

`@resvg/resvg-js` belongs to the repository's brand tool in `tools/brand`, with a `package.json` of its own, and the gates install it and run the tool's test. The engine loads no package: an installed copy of the plugin has no `node_modules`, and a package anywhere in the engine's imports makes every command depend on the runtime fetching it. A test in `checks/arch` fails on any engine import that is neither a relative path nor built into the runtime.

The rasteriser is not loaded late inside the engine either: the logo of this repository is not part of a loop other repositories run, and a late import would leave the package and the command in every installed copy. Nor is it replaced by a rasteriser of our own: curves that match byte for byte are a project of their own, and the tool is the one place that needs them.

## Consequences

- A change to an SVG is followed by `bun tools/brand/brand.ts`; the gates fail until the committed rasters match.
- The GitHub social preview cannot be set through any API, so uploading `social-preview.png` is an owner step.
- A different rasteriser later is one adapter; the plan and the packing do not change.
