# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
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
- **ViewCube Text**: Updated ViewCube faces to use single-letter abbreviations (`F`, `B`, `T`, `Bt`, `L`, `R`) and increased the font size by 3x for readability.
- **ViewCube Colors**: ViewCube faces and hover-states now dynamically sync to match the colors of the currently selected theme.
- **Camera Panning in Align Mode**: Completely decoupled pointer-down selection logic while in Align/Distribute modes. Users can now freely drag on the background or over objects to orbit the camera without losing their selection or accidentally triggering a gizmo.
- **Gizmo Usability**: Doubled the click-radius of the Align and Distribute gizmo handles (from 0.35 to 0.7).
- **Gizmo Raycasting Priority**: Optimized the Three.js raycaster to strictly prioritize gizmo handles over the bounding-box wireframe, completely resolving click-occlusion issues.
- **Asset Caching**: Added cache-busting version strings (`?v=2`) to HTML script and link tags to ensure clients receive immediate updates.

### Fixed
- **Paste Duplication Bug**: Fixed recursive reference and cloning issues when pasting groups or individual shapes, ensuring independent geometric clones.
- **Theme Material Caching**: Resolved a WebGL MultiMaterial caching bug in Three.js where the ViewCube would retain old colors when switching themes. The ViewCube mesh is now entirely destroyed and regenerated from scratch on theme change.
