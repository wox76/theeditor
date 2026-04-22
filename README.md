# The Editor 3D

A fully-featured, web-based 3D editor and game engine built entirely with Three.js.

## Live Demo
You can try the editor online here: [https://wox76.github.io/theeditor/](https://wox76.github.io/theeditor/)

## Key Features

**🎨 World Building & Editing**
- Import standard 3D Models (`.glb`, `.gltf`) directly via Drag & Drop.
- **NEW!** Native support for **Gaussian Splatting** (`.ply`, `.splat`, `.spz`, `.ksplat`) rendering environments via `@sparkjsdev/spark`.
- Multi-Level project architecture: save entire projects with multiple independent game levels into a single JSON file.
- Lighting system, shadow management, and visually driven properties for every object.

**🕹️ Game Engine & Mechanics**
- Player controller supporting multiple camera typologies: **First Person (FPS), Third Person (TPS), Platform 2.5D, and 8-Way**.
- **NEW!** Global Sprint mechanic configuration (Customizable sprint key, multiplier, and automatic animation acceleration).
- **NEW!** Advanced shooting logic (directional shooting synced to FPS/TPS perspective) mapped globally to mouse clicks.
- Built-in Entity Types: `Enemies`, `Bosses`, `Goals`, `Catcher`, `Bonuses`, `PowerUps`, and triggers.
- Robust collision handling utilizing `three-mesh-bvh` for highly optimized raycasting and physics calculation.

**🎬 Presentation & Post-Processing**
- Fully customizable Title Splash Screens and Game Over End Screens with support for Image/Video backgrounds and localized soundtracks.
- Integrated Post-Processing stack including Pixel Shaders and EffectComposer.

## Getting Started
Simply open `index.html` in any modern web browser or visit the live demo link above to start creating your 3D world instantly!
