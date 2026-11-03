import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { applyModifier, nextState, makeLevel, scoreRun, impactRemovalIndices } from '../dist/js/gameLogic.js';

test('gate modifiers are whole, nonnegative, and capped', () => {
  assert.equal(applyModifier(12, { op: '+', value: 25 }), 37);
  assert.equal(applyModifier(13, { op: '/', value: 2 }), 6);
  assert.equal(applyModifier(4, { op: '-', value: 10 }), 0);
  assert.equal(applyModifier(200, { op: 'x', value: 5 }), 1000);
  assert.equal(applyModifier(1500, { op: 'x', value: 5 }), 5000);
});

test('game states follow the playable loop', () => {
  assert.equal(nextState('menu', 'PLAY'), 'running');
  assert.equal(nextState('running', 'FINISH_RUN'), 'aiming');
  assert.equal(nextState('aiming', 'FIRE'), 'firing');
  assert.equal(nextState('firing', 'SETTLED'), 'results');
});

test('ten deterministic levels remain valid', () => {
  for (let level = 1; level <= 10; level++) {
    const data = makeLevel(level);
    assert.ok(data.startBalls > 0);
    assert.equal(data.gates.length, 5);
    assert.equal(data.obstacles.length, 5);
  }
});

test('a strong gate route can exceed the old 420-ball ceiling on every tested level', () => {
  for (let level = 1; level <= 10; level++) {
    const data = makeLevel(level);
    const best = data.gates.reduce((count, gate) => Math.max(applyModifier(count, gate.left), applyModifier(count, gate.right)), data.startBalls);
    assert.ok(best > 420, `level ${level} should allow more than 420 balls`);
  }
});

test('score rewards destruction and combos', () => {
  const low = scoreRun({ balls: 20, destroyed: 20, combo: 1, level: 1 });
  const high = scoreRun({ balls: 20, destroyed: 90, combo: 6, level: 1 });
  assert.ok(high > low);
});

test('obstacle damage removes balls nearest the physical impact', () => {
  const points = [{ x: -2, z: 0 }, { x: -1, z: -.5 }, { x: 1, z: 0 }, { x: 2, z: -.5 }];
  assert.deepEqual(impactRemovalIndices(points, { x: -1.8, z: -.4 }, 2), [0, 1]);
  assert.deepEqual(impactRemovalIndices(points, { x: 1.8, z: -.4 }, 2), [3, 2]);
});

test('installable app metadata uses standalone portrait mode and valid icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait-primary');
  assert.equal(manifest.start_url, '/');
  for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    const info = await stat(new URL(`../dist/icons/${icon}`, import.meta.url));
    assert.ok(info.size > 1000);
  }
});
