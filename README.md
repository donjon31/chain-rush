# CHAIN RUSH

A mobile-first Three.js hyper-casual game. Drag to steer through gates, dodge obstacles, then aim and release to demolish the tower.

## Run

Requires Node.js 18+.

- Development server: `npm run dev`
- Tests: `npm test`
- Production build: `npm run build`

Open the dev URL in a browser. Touch, mouse, and keyboard controls are supported.

## Architecture

- `dist/js/gameLogic.js`: deterministic gate math, scoring, progression, and level generation.
- `dist/js/game.js`: Three.js scene, pooled ball rendering, controls, lightweight collision/destruction simulation, UI, audio, and saves.
- `dist/index.html` and `dist/styles.css`: portrait game shell and responsive HUD.
- `tests/`: Node tests for modifiers, state transitions, level validity, and scoring.

Progression and cosmetic ownership are stored in `localStorage`. Extension hooks for analytics, rewarded ads, purchases, and ad removal are intentionally inert until real providers are connected.

## Current limitations

- Physics are purpose-built and deterministic rather than a full rigid-body engine, keeping the finale smooth on mobile.
- Audio is synthesized with Web Audio to avoid copyrighted assets.
- Desktop landscape is framed as a portrait handset; phones use the full viewport.
