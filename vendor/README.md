# Vendored libraries

Everything the page needs is served from this folder, so Holodeck works with no network.
Nothing here is modified except where noted. To upgrade one, fetch the new file from the URL
below over the old one and run `npm test`.

| Path | Source | Licence |
| --- | --- | --- |
| `three/three.min.js`, `three/examples/**` | three@0.140.0 (`build/` and `examples/js/`) via jsDelivr | MIT |
| `three-csg-ts/csg.js` | three-csg-ts@3.1.11 `+esm` bundle. **Edited:** its `import` of three points at `./three.module.js` instead of a CDN path | MIT |
| `three-csg-ts/three.module.js` | three@0.143.0 `+esm` bundle (the version that build of three-csg-ts was made against) | MIT |
| `math.js` | mathjs@11.8.0 via cdnjs | Apache-2.0 |
| `gsap.min.js` | gsap@3.12.2 via cdnjs | GSAP standard licence (free to use) |
| `fontawesome/**` | Font Awesome Free 6.4.0 (CSS + the solid, regular and v4-compat woff2 files; the unused brand icons are not included) | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT |
| `fonts/inter*` | Inter variable, latin subset, via Google Fonts | SIL OFL 1.1 |
