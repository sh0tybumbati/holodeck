# Holodeck

Holodeck is a web-based, 3D CAD modeling and design tool built with Three.js. It features a modern, glassmorphic UI, robust alignment tools, math variable support, and multiple customizable themes (Blueprint, Holodeck, Amber CRT, and Matrix).

## Features

- **3D Workspace**: Add cubes, spheres, cones, cylinders, and toruses.
- **Transform Tools**: Translate, rotate, and scale your objects intuitively.
- **Advanced Alignment & Distribution**: Snap objects relative to each other's edges or centers using custom 3D gizmos.
- **Variables & Math**: Define numeric variables and formulas in the properties panel to drive your design programmatically.
- **Themes**: Switch between Light/Dark mode and four distinct color themes: Blueprint, Holodeck, Amber CRT, and Matrix.
- **Interactive ViewCube**: Quickly navigate and snap your camera to standard orthographic views.
- **Export**: Export your creations to STL format for 3D printing.
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
node test/measure-layout.mjs            # narrow screens
node test/measure-layout.mjs 1440 900   # desktop
node test/measure-layout.mjs 500 800 touch
```

Reports where every panel lands at a given viewport and fails if any two overlap or anything
runs off-screen. Every panel is absolutely positioned, so a CSS change can stack two of them
without any visible error.
