import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { applyModifier, nextState, makeLevel, levelTuning, scoreRun, impactRemovalIndices, destructionPotential } from '../dist/js/gameLogic.js';
import { classifyTraffic, retentionMilestones, durationBand, loadBand } from '../dist/js/analyticsLogic.js';

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

test('sixty deterministic levels remain valid and fair', () => {
  for (let level = 1; level <= 60; level++) {
    const data = makeLevel(level);
    assert.ok(data.startBalls > 0);
    assert.ok(data.gates.length >= 5);
    assert.ok(data.obstacles.length >= 4);
    assert.ok(data.gates.every(gate => gate.z < 0 && gate.z > data.finishZ));
    assert.ok(data.obstacles.every(obstacle => obstacle.z < 0 && obstacle.z > data.finishZ));
  }
});

test('difficulty grows in bounded tiers with sensible level durations', () => {
  let previous = levelTuning(1);
  for (let level = 2; level <= 100; level++) {
    const tuning = levelTuning(level);
    assert.ok(tuning.speed >= previous.speed);
    assert.ok(tuning.speed <= 13.8);
    assert.ok(tuning.trackLength >= previous.trackLength);
    const seconds = tuning.trackLength / tuning.speed;
    assert.ok(seconds >= 18 && seconds <= 34);
    previous = tuning;
  }
});

test('advanced obstacle types unlock progressively', () => {
  assert.deepEqual([...new Set(makeLevel(1).obstacles.map(item => item.type))], ['movingWall']);
  assert.ok(makeLevel(4).obstacles.some(item => item.type === 'hammer'));
  assert.ok(makeLevel(6).obstacles.some(item => item.type === 'laser'));
  assert.ok(makeLevel(8).obstacles.some(item => item.type === 'crusher'));
  assert.ok(makeLevel(10).obstacles.some(item => item.type === 'risk'));
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

test('destruction rewards precise low-center aiming instead of guaranteeing 100 percent', () => {
  const target = { balls: 420, maxX: 4, maxY: 6 };
  assert.equal(destructionPotential({ ...target, aimX: 0, aimY: 6 * .28 }), 100);
  assert.ok(destructionPotential({ ...target, aimX: 3.8, aimY: 5.6 }) < 40);
  assert.ok(destructionPotential({ ...target, balls: 120, aimX: 0, aimY: 6 * .28 }) < 40);
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

test('mobile performance and recovery safeguards stay enabled', async () => {
  const game = await readFile(new URL('../dist/js/game.js', import.meta.url), 'utf8');
  const serviceWorker = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(game, /THREE\.InstancedMesh/);
  assert.match(game, /visibilitychange/);
  assert.match(game, /webglcontextlost/);
  assert.match(game, /qualityProfiles/);
  assert.match(game, /particleLimit/);
  assert.match(serviceWorker, /three\.module\.js/);
});

test('privacy-safe analytics classifies social sources without storing full referrers', () => {
  assert.equal(classifyTraffic({ href:'https://game.test/?utm_source=tiktok' }), 'tiktok');
  assert.equal(classifyTraffic({ referrer:'https://www.youtube.com/watch?v=private' }), 'youtube');
  assert.equal(classifyTraffic({ referrer:'https://reddit.com/r/games' }), 'reddit');
  assert.equal(classifyTraffic({ href:'https://game.test/' }), 'direct');
});

test('analytics retention and performance buckets are deterministic', () => {
  const day = 86400000;
  assert.deepEqual(retentionMilestones(0, day, {}), ['day_1']);
  assert.deepEqual(retentionMilestones(0, 7 * day, { day1:true }), ['day_7']);
  assert.equal(durationBand(185), '3_10m');
  assert.equal(loadBand(2400), '2_3s');
});

test('analytics is opt-in and exposes a reversible privacy control', async () => {
  const analytics = await readFile(new URL('../dist/js/analytics.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(analytics, /consent !== 'granted'/);
  assert.match(analytics, /va-disable/);
  assert.match(analytics, /_vercel\/insights\/script\.js/);
  assert.match(html, /id="privacy-setting"/);
  assert.match(html, /id="analytics-decline"/);
});
