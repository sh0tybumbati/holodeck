# Holodeck

Holodeck is a web-based, 3D CAD modeling and design tool built with Three.js. It features a modern, glassmorphic UI, robust alignment tools, math variable support, and multiple customizable themes (Blueprint, Holodeck, Amber CRT, and Matrix).

## Features

- **3D Workspace**: Add cubes, spheres, cones, cylinders, and toruses.
- **Modelling**: Duplicate (Ctrl+D), mirror, linear/polar arrays, fillet/chamfer on cubes, and a sketch tool that extrudes or revolves a drawn polygon.
- **Transform Tools**: Translate, rotate, and scale your objects intuitively.
- **Advanced Alignment & Distribution**: Snap objects relative to each other's edges or centers using custom 3D gizmos.
- **Variables & Math**: Define numeric variables and formulas in the properties panel to drive your design programmatically.
- **Themes**: Switch between Light/Dark mode and four distinct color themes: Blueprint, Holodeck, Amber CRT, and Matrix.
- **Interactive ViewCube**: Quickly navigate and snap your camera to standard orthographic views.
- **Export**: Export your creations to STL format for 3D printing.
- **Import**: Bring in **STL** (binary or ASCII), **OBJ** and **SVG** files with the import button or by dropping them on the page. STL/OBJ are read as millimetres (matching the STL export, so a file round-trips at its original size); an SVG is extruded 5 mm, 1 user unit = 1 CSS px, holes preserved. Imported meshes are ordinary shapes: move, scale, colour, group, mark as holes, and they are saved inside the `.holo` file. Limit: 1,000,000 triangles.
- **Hotkeys**: Supports standard shortcuts (Ctrl+C, Ctrl+V, Ctrl+X, Delete) and object grouping (Ctrl+G / Ctrl+Shift+G).

## Usage
Simply open `index.html` in a modern web browser to start using Holodeck. No build step or local server is strictly required for the core application, though a local server is recommended for loading external assets if added in the future.

## Tests

```
node test/run-regression.mjs
```

Serves the project locally, drives it in a headless Chromium-family browser through the real
toolbar buttons, and asserts on the exported STL and the saved `.holo` payload. Needs a browser
binary (brave/chromium/chrome) and network access for the CDN scripts; no npm dependencies.
Covers grouping, the undo/save round-trip for groups and hardware, STL export contents, the
bill of materials, GPU resource release, and variable-edit cost.

```
node test/test-importers.mjs
node test/test-modeling.mjs
```

Unit tests for the STL/OBJ parsers; pure node, no browser. (SVG needs `THREE.SVGLoader`, so it is
covered by the browser suite above.) If your browser sits behind a proxy the runner passes
`HTTPS_PROXY` through, and `HOLODECK_BROWSER` overrides browser discovery.

```
node test/measure-layout.mjs            # narrow screens
node test/measure-layout.mjs 1440 900   # desktop
node test/measure-layout.mjs 500 800 touch
```

Reports where every panel lands at a given viewport and fails if any two overlap or anything
runs off-screen. Every panel is absolutely positioned, so a CSS change can stack two of them
without any visible error.
