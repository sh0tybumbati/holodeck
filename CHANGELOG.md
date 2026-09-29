# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Cone / cylinder tool**: The separate cone and cylinder buttons are merged into one shape with **Top R**, **Height** and **Bottom R** fields in the properties panel (mm). Equal radii make a cylinder, a zero radius a cone, anything else a truncated cone. Projects saved with the old separate shapes still open, at their old size.
- **Bevel with steps**: Cubes and cones have *Bevel (mm)* and *Bevel steps* fields (also in the toolbar dialog). The bevel reaches that far along each face; 1 step is a flat chamfer and more steps round the edge progressively. On a cone it bevels the rim where each flat end meets the side. Both are stored as parameters, so they survive undo, save and load; files with the earlier fillet/chamfer setting load unchanged.
- **Keyboard shortcut sheet**: press `?` (or the keyboard button) for the full list. Also new: `Ctrl+A` selects everything.
- **Autosave and recovery**: work is autosaved to the browser's IndexedDB two seconds after each change; if a session ends unsaved, the next launch offers to restore it (or discard it). Saving to a file clears the autosave.
- **Unsaved-changes guard**: the tab title gets a `•` and the browser asks before you close or reload with unsaved work.
- **Accessibility**: every icon button, toolbar and dynamically-built row control has an accessible name, decorative icons are hidden from screen readers, the status bar is a live region, dialogs are labelled modals with focus returned on close, and keyboard focus is visible.
- **Tooling**: `package.json` with `npm test` (unit + browser suites), `npm run test:layout`, `npm start`; `test/run-unit.mjs`; and a GitHub Actions workflow running them.
- **Mesh health checks**: Imports are analysed for open edges, non-manifold edges and inconsistent winding, and the status bar says when a mesh is not a clean closed solid (grouping and holes may then leave gaps). Two things that need no guessing are fixed automatically: zero-area triangles are removed and an inside-out closed solid is flipped. Grouping a not-clean import warns too.
- **Background booleans**: Groups above 20,000 triangles are computed in a Web Worker (`js/csg-worker.js`) instead of freezing the page, and so are re-cuts after editing a part of such a group. Both paths run the same code (`js/csg-core.js`), and a test asserts the worker's result is identical to the inline one. Smaller groups are unchanged and stay instantaneous. Undo/redo and loading still recompute inline.
- **Offline**: every library and font is vendored under `vendor/` (sources and licences in `vendor/README.md`); the app makes no network requests.
- **Precision tools**: The properties panel gains *Pos* and *Rot°* fields (numbers, or expressions using your variables; kept in sync while dragging and stepping with the arrow keys; local to the group for a sub-part). A readout beside the cursor shows the exact position/rotation/size while dragging, with the snap in force. A snap toggle (magnet) in the ViewCube panel turns snapping off, and holding Alt bypasses it for one drag. A **measure tool** (click two points; it snaps to nearby corners) draws the distance in mm with its Δx/Δy/Δz.
- **Export formats**: The export button now opens a dialog offering binary STL (new default — about a fifth the size of ASCII), ASCII STL, OBJ (shared vertices, one object per shape) and 3MF (millimetre units, Z-up for slicers, zipped without any library). Selected shapes can be exported on their own. The writers are pure functions in `js/exporters.js`, tested under node including a round-trip back through the importers.
- **Import options**: Importing now asks for the file's units (mm/cm/in/m), up axis (Y or Z up), the extrude depth for SVG, and whether to centre the model on the grid; answers are remembered. Dragging files over the page shows a drop overlay.
- **Modelling tools**: *Duplicate* (Ctrl+D), *Mirror* a copy across a world plane, linear and polar *Arrays* (the copies stay independent parametric shapes and are billed on the BOM), *Fillet/Chamfer* for a cube's edges (stored as parameters, so it survives undo/save like any primitive), and a *Sketch* tool: click a polygon onto the ground, then extrude it upward or revolve it around the Y axis. Results of mirror/sketch are stored like imported meshes.
- **Import STL / OBJ / SVG**: New import button (and drag-and-drop anywhere on the page). STL is read in binary or ASCII form — detected by file size, not by the `solid` header binary files also use; OBJ handles quads/n-gons, negative indices and `v/vt/vn` faces; SVG paths are extruded 5 mm with holes kept. Meshes are converted from mm to the scene's cm, centred and stood on the grid. Imported vertices are stored once, outside the undo history, and embedded in the `.holo` file as `assets` (format 2.2; older files still load). Files over 1,000,000 triangles are refused with a message. Dropping a `.holo` file now opens it.
- **Themes**: Introduced two new aesthetic themes: `Amber CRT` (classic amber terminal look) and `Matrix` (green-on-black). These join the existing `Blueprint` and `Holodeck` themes.
- **Math & Equations in Properties**: The properties panel now fully evaluates mathematical expressions (powered by `math.js`).
- **Variable Referencing**: Variables in the properties panel can now reference other variables (e.g., `width / 2 + 5`), with automatic multi-pass resolution for nested references.
- **Align & Distribute Toolbar**: Added dedicated `Align` and `Distribute` buttons to the top toolbar with shared 3D gizmo interactions.
- **Top Toolbar Redesign**: Merged the old left sidebar tools into a streamlined top bar using grouped, icon-only buttons with tooltips.
- **ViewCube Reorganization**: The unit snapping dropdown, unit toggle (imperial/metric), and grid visibility toggle have been relocated next to the ViewCube.
- **Unit Icons**: The imperial/metric toggle now features a dynamic icon (a foot icon for imperial, and a ruler icon for metric).
- **Keyboard Shortcuts**: 
  - `Ctrl+C` (Copy)
  - `Ctrl+X` (Cut)
  - `Ctrl+V` (Paste)
  - `Ctrl+G` (Group selected objects)
  - `Ctrl+Shift+G` (Ungroup selected objects)
  - `Delete` / `Backspace` (Delete selected objects)
- **Arrow Key Stepping**: Users can now use arrow keys to step objects along the screen-space axes (relative to camera view) with snap-precision.
  - `Shift + Arrow`: 10x snap distance
  - `Ctrl + Arrow`: 0.5x snap distance
  - `Ctrl + Shift + Arrow`: 0.1x snap distance
- **Camera Centering**: Added functionality to instantly center and focus the camera on a selected object.

### Changed
- **Layout**: The creation sidebar now scrolls instead of growing into the variables panel, and on mid-size screens (770–1500px) the tool row sits beneath the file toolbar rather than colliding with it.
- **Saving**: A `.holo` file only embeds imported meshes that its history still refers to.
- **ViewCube Text**: Updated ViewCube faces to use single-letter abbreviations (`F`, `B`, `T`, `Bt`, `L`, `R`) and increased the font size by 3x for readability.
- **ViewCube Colors**: ViewCube faces and hover-states now dynamically sync to match the colors of the currently selected theme.
- **Camera Panning in Align Mode**: Completely decoupled pointer-down selection logic while in Align/Distribute modes. Users can now freely drag on the background or over objects to orbit the camera without losing their selection or accidentally triggering a gizmo.
- **Gizmo Usability**: Doubled the click-radius of the Align and Distribute gizmo handles (from 0.35 to 0.7).
- **Gizmo Raycasting Priority**: Optimized the Three.js raycaster to strictly prioritize gizmo handles over the bounding-box wireframe, completely resolving click-occlusion issues.
- **Asset Caching**: Added cache-busting version strings (`?v=2`) to HTML script and link tags to ensure clients receive immediate updates.
- **Project File Format (2.1)**: A `.holo` file now carries a single 320px thumbnail at the top level instead of one full-resolution capture inside every history state. Files written by earlier versions still load, and the dashboard falls back to their per-state thumbnail.

### Removed
- **Scaffold CLI**: Deleted `main.go`, a cobra "hello world" left over from the original project scaffold. It declared `package main`/`func main()` in the same directory as `server.go`, so the Go build could never succeed. The module is renamed from `hello` to `holodeck` and no longer requires cobra; `server.go` uses only the standard library, so `go.sum` is gone too.

### Fixed
- **Failed booleans**: A group whose boolean removes everything (a hole larger than the solid) now reports why and leaves the shapes alone, and a rebuild that fails says so in the status bar and keeps the previous shape, rather than logging to the console only.
- **Mobile Layout**: The narrow-screen rules had never been updated for the toolbar reorganisation, so at 500px wide eight pairs of panels overlapped — all three top bars sat on the same line, and the ViewCube, variables panel and status bar piled up on each other. Narrow screens now lay out as reserved bands: two toolbar rows across the top, creation tools down the left, and a bottom strip. `.touch-mode` was being set on `<body>` from JS with no CSS behind it at all; it now enlarges tap targets.
- **Panel Overlap on Desktop**: The properties sidebar could grow down into the ViewCube. Its height is now capped to stop above it.
- **Solid/Hole Toggle Scope**: The toggle applied to the selection rather than the part shown in the panel, so marking a sub-part as a hole flagged the entire group — which then vanished from STL export, since holes are not exported. It now applies to the part being shown and re-cuts the assembly around it.
- **Typing in Variables**: Each keystroke in a variable's value re-cut every group bound to it — 138ms for four characters with a single two-shape group on screen, and worse as a model grows. Typing is now coalesced into one apply, flushed before anything that must see the result.
- **GPU Memory**: Deleted shapes never released their geometries or materials. Adding and deleting twenty cubes left all twenty resident; they are now freed. Clipboard entries get their own copy of the geometry, so cutting and pasting still works.
- **Dashboard Card Rendering**: Project cards built their markup by interpolating values straight out of the `.holo` file — the project name, category, status and thumbnail URL — into `innerHTML`. Cards are now built as DOM nodes with text set via `textContent`, and a thumbnail is only used if it is a `data:image/` URL.
- **Bill of Materials on Paste**: Pasting a part produced a second physical object that was never billed. A copy now carries its source's line item and is added to the bill on paste, including every part inside a pasted group, and for each paste of a single copy.
- **Bill of Materials Reconciliation**: Deleting an object left its row and its cost on the bill — deleting a stepper still charged $12.00. Rows created for a mesh now disappear with it, including when the mesh is inside a deleted group. Rows added by hand with *Add Custom Item* are never removed, and grouping a part keeps its row, since a grouped part is still in the assembly.
- **Save Size & Per-Action Cost**: Every `saveState()` — every shape added, every colour tweak, every arrow-key nudge — did a synchronous full-canvas render plus `toDataURL`, and wrote the result into the history state. Measured at 35.9 KB per state, so an eight-cube project saved an 897 KB file that was ~97% thumbnail. State is now 1.4 KB, the thumbnail is captured once at save time, and the undo stack is capped at 200 states.
- **Properties Panel Target**: `selectPropertyNode` read the global selection instead of the node it was given, so editing a variable with nothing selected threw, and a group's sub-part showed the group's colour and hardware parameters rather than its own. The panel now reads the node it was handed, the hardware dropdowns write to that same node (re-cutting the enclosing group when the part is inside one), and the panel's target is cleared on deselect instead of pointing at a deleted mesh.
- **Grouping**: Grouping two shapes reported `Grouping failed` and left the group in the scene anyway. The group mesh was built without a `baseSize`, which the properties panel then dereferenced.
- **Undo/Save After Grouping**: Once a group existed, every subsequent save threw and was swallowed, silently freezing undo/redo and writing stale `.holo` files for the rest of the session. The serializer still expected the old binary `left`/`right` CSG tree; groups are now stored as their n-ary `groupChildren` and the CSG result is recomputed on load.
- **Hardware Persistence**: Motors, screws, extrusions and wire routes were saved as a bare type string with no `hwProps`, and came back from undo/redo as a 2×2×2 cube. Hardware is now regenerated from its saved parameters, and `isHole` is persisted too.
- **Group Position on Rebuild**: Rebuilding a group's CSG re-based the result against `matrixWorld`, but three-csg-ts evaluates from local matrices, so every rebuild shifted the group by `-position` — visible when editing a dimension inside a group, and corrupting the solid of any group containing it.
- **STL Export**: Exports contained the transform gizmo, alignment handles, wire preview and the hidden children CSG had already consumed — a single cube exported 3,584 facets instead of 12. Export now builds a scene of the real solids only, skips holes, and refuses an empty scene.
- **Paste Duplication Bug**: Fixed recursive reference and cloning issues when pasting groups or individual shapes, ensuring independent geometric clones.
- **Theme Material Caching**: Resolved a WebGL MultiMaterial caching bug in Three.js where the ViewCube would retain old colors when switching themes. The ViewCube mesh is now entirely destroyed and regenerated from scratch on theme change.
