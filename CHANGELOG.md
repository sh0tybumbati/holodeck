# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Themes**: Added new `Amber CRT` and `Matrix` themes, along with the original `Blueprint` and `Holodeck` themes. 
- **ViewCube Customization**: ViewCube now dynamically updates to match the active theme's colors, and uses single-letter, large-font labels for faces (F, T, R, etc.).
- **Alignment System**: Introduced a powerful 3D Gizmo for aligning and distributing selected objects along specific axes.
- **Hotkeys**: Added robust keyboard shortcut support (Ctrl+C, Ctrl+V, Ctrl+X for clipboard, Ctrl+G for grouping, Delete for removal).
- **Variables**: Added support for math expressions and variable cross-referencing in the Properties panel.

### Changed
- **UI Layout**: Merged the left sidebar tools into a streamlined top bar with icon-only buttons and hover text.
- **Camera Controls**: Decoupled selection raycasting from pointerdown events in Align/Distribute modes, allowing users to orbit the camera without accidentally clicking handles or objects.
- **Gizmo Usability**: Doubled the radius of Align/Distribute handles and fixed raycast occlusion issues to ensure they are easy to click.
- **Pasting**: Fixed recursive reference issues when cloning groups and shapes.

### Fixed
- Addressed bugs with bounding box helper occlusion when clicking alignment handles.
- Fixed ViewCube caching bug by fully recreating the mesh and materials on theme change.
