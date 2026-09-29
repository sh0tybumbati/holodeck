# Holodeck

Holodeck is a web-based, 3D CAD modeling and design tool built with Three.js. It features a modern, glassmorphic UI, robust alignment tools, math variable support, and multiple customizable themes (Blueprint, Holodeck, Amber CRT, and Matrix).

## Features

- **3D Workspace**: Add cubes, spheres, cones, cylinders, and toruses.
- **Modelling**: Duplicate (Ctrl+D), mirror, linear/polar arrays, fillet/chamfer on cubes, and a sketch tool that extrudes or revolves a drawn polygon.
- **Transform Tools**: Translate, rotate, and scale your objects intuitively, or type exact position and rotation values; a live readout shows the snapped value while dragging, and a measure tool reports distances between points.
- **Advanced Alignment & Distribution**: Snap objects relative to each other's edges or centers using custom 3D gizmos.
- **Variables & Math**: Define numeric variables and formulas in the properties panel to drive your design programmatically.
- **Themes**: Switch between Light/Dark mode and four distinct color themes: Blueprint, Holodeck, Amber CRT, and Matrix.
- **Interactive ViewCube**: Quickly navigate and snap your camera to standard orthographic views.
- **Export**: STL (binary or ASCII), OBJ and 3MF, all in millimetres; optionally just the selected shapes.
- **Import**: Bring in **STL** (binary or ASCII), **OBJ** and **SVG** files with the import button or by dropping them on the page. STL/OBJ are read as millimetres (matching the STL export, so a file round-trips at its original size); an SVG is extruded 5 mm, 1 user unit = 1 CSS px, holes preserved. Imported meshes are ordinary shapes: move, scale, colour, group, mark as holes, and they are saved inside the `.holo` file. Limit: 1,000,000 triangles.
- **Safety net**: autosave with restore-on-launch, an unsaved-changes guard, and mesh health warnings for imports that boolean operations may choke on. Large groups compute in a background worker.
- **Hotkeys**: press `?` in the app for the full list. Supports standard shortcuts (Ctrl+C, Ctrl+V, Ctrl+X, Delete) and object grouping (Ctrl+G / Ctrl+Shift+G).

## Usage
Serve the folder with any static file server and open it in a modern browser — for example `go run server.go` (port 8080) or `npx serve`. There is no build step, and all libraries are bundled in `vendor/`, so it works offline. (Opening `index.html` straight from disk does not work: browsers block ES modules and workers on `file://` pages.)

## Tests

```
npm test                 # unit tests + the browser suite
npm run test:unit        # pure node, no browser: parsers, exporters, modelling, mesh health
npm run test:browser     # node test/run-regression.mjs
npm run test:layout      # panel overlap checks at several screen sizes
```

The browser suite serves the project locally, drives it in a headless Chromium-family browser
through the real toolbar buttons and dialogs, and asserts on the exported files and the saved
`.holo` payload. It needs a browser binary (brave/chromium/chrome; set `HOLODECK_BROWSER` to
point at one) and no network — everything is vendored. If the browser sits behind a proxy the
runner passes `HTTPS_PROXY` through. It covers grouping, undo/save round-trips, every import and
export format, the modelling tools, measuring, the CSG worker (checked against the inline path),
autosave and restore (in a second copy of the app), the bill of materials, GPU resource release,
and variable-edit cost.

```
node test/measure-layout.mjs            # narrow screens
node test/measure-layout.mjs 1440 900   # desktop
node test/measure-layout.mjs 500 800 touch
```

Reports where every panel lands at a given viewport and fails if any two overlap or anything
runs off-screen. Every panel is absolutely positioned, so a CSS change can stack two of them
without any visible error.
