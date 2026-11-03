# START HERE — CHAIN RUSH

This folder contains the complete source for **CHAIN RUSH**, a portrait-oriented mobile browser game.

If you are ChatGPT or another coding assistant, read this file first, then inspect the files listed under **File map**. The project is intentionally small and uses no framework or backend.

## What the app is

CHAIN RUSH is a playable hyper-casual arcade game. The player steers a moving group of glossy balls through mathematical gates, avoids obstacles, and launches the surviving balls into a destructible tower.

The gameplay loop is:

1. Start a level with a small ball group.
2. Drag horizontally while the group moves forward automatically.
3. Choose between mathematical gates such as `+50`, `×3`, `−10`, and `÷2`.
4. Avoid moving blocks, rotating barriers, red zones, and narrow passages.
5. Reach the finale and drag to aim.
6. Release to fire all collected balls into a block tower.
7. Earn a score and coins based on destruction and combos.
8. Unlock cosmetic ball materials and continue to the next level.

## Important implementation details

- Rendering engine: Three.js loaded through an import map.
- UI: semantic HTML and responsive CSS layered over the WebGL canvas.
- Ball rendering: one GPU `InstancedMesh`, capped at 420 visible runner balls.
- Ball damage: obstacle collisions remove the members nearest the physical impact point. Removed balls become short-lived physical particles; the opposite side of the group is preserved.
- Destruction: lightweight custom projectile and block physics, designed for mobile performance.
- Polish pass: animated gate impacts, ball growth waves, support-aware tower cascades, pooled dust/debris, contextual combo messaging, and adaptive effects for slower devices.
- Levels: deterministic reusable generator with at least ten playable variations.
- Persistence: browser `localStorage` stores level, coins, best score, owned cosmetics, selected cosmetic, and mute state.
- Audio: synthesized at runtime with Web Audio; there are no copyrighted audio assets.
- Controls: touch, pointer/mouse, and keyboard.
- Backend: none required.

## File map

- `dist/index.html` — complete game shell and UI screens.
- `dist/styles.css` — portrait layout, HUD, menus, shop, results, and responsive presentation.
- `dist/js/game.js` — Three.js scene, input, rendering, obstacles, local ball damage, destruction finale, sound, saves, and UI integration.
- `dist/js/gameLogic.js` — pure gate math, scoring, state transitions, collision selection, cosmetics, and level generation.
- `tests/gameLogic.test.mjs` — automated tests for gate math, states, level generation, scoring, and local obstacle damage.
- `scripts/build.mjs` — static production build script.
- `package.json` — development, test, and build commands.
- `README.md` — concise developer setup and architecture notes.
- `PROJECT_MANIFEST.json` — machine-readable project summary.

## How to run

Node.js 18 or newer is recommended.

```bash
npm run dev
```

Then open the printed local URL in a browser.

## How to verify

```bash
npm test
npm run build
```

The game itself is a static site. The deployable files are in `dist/`.

## Current live version

`https://chain-rush-arcade.pernillehoejer.chatgpt.site`

## Guidance for future changes

- Keep the game mobile-first and portrait-oriented.
- Preserve one-finger controls and the immediate three-second understanding of the game.
- Do not replace real gameplay with decorative animation.
- Keep obstacle damage spatial: only balls near the obstacle contact point should be removed.
- Maintain the performance benefits of instancing and pooled/lightweight effects.
- Cosmetics must remain visual only.
- Do not simulate ads, purchases, or rewarded-ad completion without a real provider response.

## Known limitations

- Physics are purpose-built rather than powered by a full rigid-body library.
- Three.js and the Nunito web font are loaded from public CDNs when the game runs.
- Saves are device/browser-local and do not sync between devices.
