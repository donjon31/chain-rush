import * as THREE from 'three';
import { applyModifier, modifierLabel, makeLevel, scoreRun, coinsFor, nextState, COSMETICS, MAX_BALLS } from './gameLogic.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const canvas = $('#game-canvas');
const shell = $('#game-shell');
const ui = Object.fromEntries(['menu','hud','pause','results','shop'].map(id => [id, $(`#${id}`)]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const defaults = { level: 1, coins: 0, best: 0, selected: 'classic', owned: ['classic'], muted: false };
let save;
try { save = { ...defaults, ...JSON.parse(localStorage.getItem('chainRushSave') || '{}') }; } catch { save = { ...defaults }; }
const persist = () => localStorage.setItem('chainRushSave', JSON.stringify(save));

// Monetization and analytics extension points intentionally do nothing until real providers are connected.
window.ChainRushProviders = Object.freeze({
  analytics: { track: () => {} },
  rewardedAds: { available: () => false, show: async () => ({ completed: false }) },
  purchases: { buy: async () => ({ verified: false }) },
  adRemoval: { active: () => false }
});
const track = (name, data = {}) => window.ChainRushProviders.analytics.track(name, data);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x71b9ff);
scene.fog = new THREE.Fog(0x81d6ff, 38, 145);
const camera = new THREE.PerspectiveCamera(54, 1, .1, 260);
camera.position.set(0, 8.7, 14);
camera.lookAt(0, 0, -8);

scene.add(new THREE.HemisphereLight(0xe8f7ff, 0x6b3ab5, 3));
const sun = new THREE.DirectionalLight(0xffffff, 4.2); sun.position.set(-8, 18, 10); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -12; scene.add(sun);
const fill = new THREE.DirectionalLight(0xff74c9, 1.5); fill.position.set(9, 7, -8); scene.add(fill);

const world = new THREE.Group(); scene.add(world);
const deco = new THREE.Group(); scene.add(deco);
let state = 'menu', levelData, runGroup, towerGroup, gateObjects = [], obstacleObjects = [], blocks = [], shots = [], particles = [];
let ballCount = 12, runZ = 0, targetX = 0, groupX = 0, fired = false, finishTimer = 0, destroyed = 0, combo = 0, maxCombo = 0, lastDestroyAt = 0, shake = 0, levelStartBalls = 0;
let pointer = { down: false, x: 0, y: 0, startX: 0, startY: 0, aimX: 0, aimY: .18 };
const clock = new THREE.Clock();

const glossy = (color, metal = .08, rough = .21, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive, emissiveIntensity: .35 });
const trackMat = glossy(0xf8fbff, .02, .3);
const edgeMat = glossy(0xd8c8ff, .05, .27);
const bonusMat = glossy(0x25e2ad, .05, .18, 0x0a5b42);
const lossMat = glossy(0xff496d, .02, .2, 0x7a0e26);
const obstacleMat = glossy(0xff3f72, .1, .22);
const ballGeo = new THREE.SphereGeometry(.29, 12, 10);
const ballMesh = new THREE.InstancedMesh(ballGeo, glossy(0x7656ff, .12, .16), MAX_BALLS);
ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ballMesh.castShadow = true; ballMesh.receiveShadow = true; ballMesh.count = 0;
const dummy = new THREE.Object3D();

function cosmeticMaterial() {
  const item = COSMETICS.find(c => c.id === save.selected) || COSMETICS[0];
  const mat = ballMesh.material;
  mat.color.set(item.colors[0]); mat.metalness = item.id === 'metal' ? .88 : item.id === 'galaxy' ? .45 : .12;
  mat.roughness = item.id === 'metal' ? .13 : .18;
  mat.emissive.set(item.id === 'neon' ? item.colors[0] : item.id === 'galaxy' ? '#26006b' : '#000000');
  mat.emissiveIntensity = item.id === 'neon' ? .72 : item.id === 'galaxy' ? .35 : 0;
  mat.needsUpdate = true;
}

function clearGroup(group) {
  if (!group) return;
  group.traverse(o => { if (o.geometry && o !== ballMesh) o.geometry.dispose(); if (o.material && o !== ballMesh && ![trackMat,edgeMat,bonusMat,lossMat,obstacleMat].includes(o.material)) o.material.dispose?.(); });
  group.removeFromParent();
}

function roundedBox(w, h, d, r, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 2, 2, 2), material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}

function makeText(text, color = '#ffffff', fontSize = 72) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 160;
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); ctx.font = `900 ${fontSize}px Nunito, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(25,15,66,.45)'; ctx.strokeText(text, 192, 82); ctx.fillStyle = color; ctx.fillText(text, 192, 82);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); spr.scale.set(4.8, 2, 1); return spr;
}

function createEnvironment() {
  while (deco.children.length) deco.remove(deco.children[0]);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .6 });
  for (let i = 0; i < 28; i++) {
    const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + (i % 3) * .45, 1), cloudMat);
    cloud.position.set((i % 2 ? 1 : -1) * (9 + (i * 7) % 14), 4 + (i * 3) % 12, 15 - i * 13); cloud.scale.y = .38; deco.add(cloud);
  }
  const islandMat = glossy(0xb584ff, .02, .76);
  for (let i = 0; i < 22; i++) {
    const island = new THREE.Mesh(new THREE.ConeGeometry(2 + (i % 4), 8, 6), islandMat);
    island.position.set((i % 2 ? 1 : -1) * (12 + (i % 5) * 4), -5, 5 - i * 14); island.rotation.z = Math.PI; deco.add(island);
  }
}

function createTrack() {
  const track = roundedBox(10, .65, 242, .2, trackMat); track.position.set(0, -.55, -104); runGroup.add(track);
  for (const x of [-5.15, 5.15]) { const edge = roundedBox(.25, .55, 242, .1, edgeMat); edge.position.set(x, -.1, -104); runGroup.add(edge); }
  for (let z = 8; z > -215; z -= 12) {
    const stripe = roundedBox(8.8, .04, .16, 0, new THREE.MeshBasicMaterial({ color: 0xded7ff, transparent: true, opacity: .7 })); stripe.position.set(0, -.21, z); runGroup.add(stripe);
  }
  const finish = roundedBox(10, .12, 4, 0, new THREE.MeshBasicMaterial({ color: 0xffffff })); finish.position.set(0, -.16, -213); runGroup.add(finish);
  for (let x = -4.5; x <= 4.5; x += 1) for (let z = -211.5; z >= -214.5; z -= 1) { const sq = roundedBox(.96, .13, .96, 0, new THREE.MeshBasicMaterial({ color: ((x + z) | 0) % 2 ? 0x3e276f : 0xffffff })); sq.position.set(x, -.08, z); runGroup.add(sq); }
}

function createGate(pair) {
  const group = new THREE.Group(); group.position.z = pair.z; group.userData = { triggered: false, pair };
  [['left', -2.55], ['right', 2.55]].forEach(([side, x]) => {
    const mod = pair[side]; const good = mod.op === '+' || mod.op === 'x'; const mat = good ? bonusMat : lossMat;
    const pane = roundedBox(4.7, 3.2, .18, .1, new THREE.MeshStandardMaterial({ color: good ? 0x16dc9d : 0xff466d, transparent: true, opacity: .42, emissive: good ? 0x0b704e : 0x771126, emissiveIntensity: .4 })); pane.position.set(x, 1.5, 0); group.add(pane);
    for (const px of [x - 2.25, x + 2.25]) { const post = roundedBox(.22, 3.8, .28, .05, mat); post.position.set(px, 1.45, 0); group.add(post); }
    const label = makeText(modifierLabel(mod)); label.position.set(x, 1.55, .18); group.add(label);
  });
  runGroup.add(group); gateObjects.push(group);
}

function createObstacle(data, i) {
  const g = new THREE.Group(); g.position.set(0, 0, data.z); g.userData = { ...data, hit: false, index: i };
  if (data.type === 'spinner') { const bar = roundedBox(7.6, .45, .58, .2, obstacleMat); bar.position.y = .25; g.add(bar); }
  if (data.type === 'block') { const block = roundedBox(2.4, 2.1, 1.1, .2, obstacleMat); block.position.set(data.x, .65, 0); g.add(block); }
  if (data.type === 'zone') { const zone = roundedBox(3.1, .06, 4.5, .2, new THREE.MeshStandardMaterial({ color: 0xff214d, emissive: 0xa8001f, emissiveIntensity: .5, transparent: true, opacity: .72 })); zone.position.set(data.x, -.16, 0); g.add(zone); }
  if (data.type === 'gap') { for (const x of [-3.55, 3.55]) { const block = roundedBox(2.7, 1.8, 1.1, .2, obstacleMat); block.position.set(x, .52, 0); g.add(block); } }
  runGroup.add(g); obstacleObjects.push(g);
}

function createTower() {
  towerGroup = new THREE.Group(); world.add(towerGroup); blocks = [];
  const arena = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, 1.2, 48), glossy(0xeeeaff, .08, .3)); arena.position.set(0, -.8, -240); arena.receiveShadow = true; towerGroup.add(arena);
  const { rows, cols, layers } = levelData.tower;
  const palette = [0xff5aa7, 0x734dff, 0x23d7ed, 0xffd54a];
  for (let layer = 0; layer < layers; layer++) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if ((x + y + layer + levelData.level) % 11 === 0 && y > 1) continue;
    const w = 1.35, h = .88, d = 1.35; const mesh = roundedBox(w, h, d, .08, glossy(palette[(x + y + layer) % palette.length], .08, .23));
    mesh.position.set((x - (cols - 1) / 2) * 1.42 + (y % 2) * .12, y * .93, -240 + (layer - (layers - 1) / 2) * 1.5);
    mesh.userData = { alive: true, vel: new THREE.Vector3(), baseY: mesh.position.y, delay: 0, id: blocks.length }; mesh.castShadow = true; towerGroup.add(mesh); blocks.push(mesh);
  }
  const crown = makeText('CRUSH ME', '#ffe24c', 56); crown.position.set(0, rows * .95 + .7, -240); towerGroup.add(crown);
}

function createLevel(level, replay = false) {
  clearGroup(runGroup); clearGroup(towerGroup); runGroup = new THREE.Group(); world.add(runGroup); gateObjects = []; obstacleObjects = []; shots = []; particles = [];
  levelData = makeLevel(level); levelStartBalls = levelData.startBalls; ballCount = levelStartBalls; runZ = 4; groupX = targetX = 0; destroyed = combo = maxCombo = 0; fired = false; finishTimer = 0; shake = 0;
  createTrack(); levelData.gates.forEach(createGate); levelData.obstacles.forEach(createObstacle); createTower();
  runGroup.add(ballMesh); cosmeticMaterial(); updateBallInstances(0); setState('running'); updateHud();
  camera.position.set(0, 8.7, 14); camera.lookAt(0, 0, -8); track('level_start', { level, replay });
}

function updateBallInstances(time) {
  ballMesh.count = ballCount; const spread = Math.min(3.35, .65 + Math.sqrt(ballCount) * .18);
  for (let i = 0; i < ballCount; i++) {
    const r = Math.sqrt(i / Math.max(1, ballCount)) * spread; const a = i * 2.399963;
    const x = groupX + Math.cos(a) * r, z = runZ + Math.sin(a) * r * .72;
    dummy.position.set(x, .18 + Math.sin(time * 6 + i * .7) * .055, z); const s = .92 + (i % 7) * .012; dummy.scale.setScalar(s); dummy.rotation.set(time + i, time * .7 + i, 0); dummy.updateMatrix(); ballMesh.setMatrixAt(i, dummy.matrix);
    if (save.selected === 'rainbow') ballMesh.setColorAt(i, new THREE.Color().setHSL((i / Math.max(1, ballCount) + time * .08) % 1, .82, .6));
  }
  ballMesh.instanceMatrix.needsUpdate = true; if (ballMesh.instanceColor) ballMesh.instanceColor.needsUpdate = true;
}

function modifyBalls(mod, worldPos) {
  const before = ballCount; ballCount = applyModifier(ballCount, mod); const diff = ballCount - before;
  showToast(`${diff >= 0 ? '+' : ''}${diff}`, diff >= 0); burst(worldPos, diff >= 0 ? 0x54ffe0 : 0xff3b6f, Math.min(22, Math.abs(diff) + 6));
  sound(diff >= 0 ? 'gate' : 'hit'); haptic(diff >= 0 ? 24 : [35, 30, 35]); $('#ball-badge').classList.add('pop'); setTimeout(() => $('#ball-badge').classList.remove('pop'), 180); updateHud();
  if (ballCount <= 0) { ballCount = 1; showToast('LAST CHANCE!', false); }
}

function obstacleHit(ob) {
  if (ob.userData.hit) return; ob.userData.hit = true; const loss = Math.max(2, Math.floor(ballCount * (.12 + levelData.level * .006))); ballCount = Math.max(1, ballCount - loss);
  showToast(`-${loss}`, false); burst(new THREE.Vector3(groupX, .4, runZ), 0xff315f, 18); sound('hit'); haptic([45, 25, 35]); shake = .35; updateHud();
}

function updateRun(dt, t) {
  const speed = 10.3 + Math.min(4, levelData.level * .3); runZ -= speed * dt; groupX = lerp(groupX, targetX, 1 - Math.exp(-dt * 12)); groupX = clamp(groupX, -4.1, 4.1); updateBallInstances(t);
  for (const g of gateObjects) {
    if (!g.userData.triggered && runZ < g.position.z + 1 && runZ > g.position.z - 2.2) { g.userData.triggered = true; const side = groupX < 0 ? 'left' : 'right'; modifyBalls(g.userData.pair[side], new THREE.Vector3(groupX, 1.4, g.position.z)); }
    // Retire scenery once it passes the camera so sprites never fill the near plane.
    if (runZ < g.position.z - 7) g.visible = false;
  }
  for (const ob of obstacleObjects) {
    const d = ob.userData; if (d.type === 'spinner') ob.rotation.y += dt * d.speed * 2.5;
    if (d.type === 'block') ob.children[0].position.x = d.x + Math.sin(t * d.speed) * 1.5;
    if (Math.abs(runZ - ob.position.z) < 1.3) {
      if (d.type === 'spinner' && Math.abs(Math.sin(ob.rotation.y) * 3.8 - groupX) < 1.2) obstacleHit(ob);
      if (d.type === 'block' && Math.abs(ob.children[0].position.x - groupX) < 1.55) obstacleHit(ob);
      if (d.type === 'zone' && Math.abs(d.x - groupX) < 1.85) obstacleHit(ob);
      if (d.type === 'gap' && Math.abs(groupX) > 2.05) obstacleHit(ob);
    }
  }
  const progress = clamp((-runZ + 4) / 217, 0, 1); setProgress(progress);
  camera.position.x = lerp(camera.position.x, groupX * .3, dt * 3); camera.position.z = runZ + 14; camera.position.y = 8.7; camera.lookAt(groupX * .25, .1, runZ - 8);
  if (runZ <= -214) beginAim();
}

function beginAim() {
  state = nextState(state, 'FINISH_RUN'); runZ = -226; targetX = groupX = 0; updateBallInstances(0); $('#aim-ui').classList.add('active'); $('#destruction-ui').classList.add('active'); setProgress(1);
  showToast('AIM & SMASH!', true); sound('ready'); haptic([25, 30, 25]); track('finale_ready', { balls: ballCount });
}

function fireVolley() {
  if (fired || state !== 'aiming') return; fired = true; state = nextState(state, 'FIRE'); $('#aim-ui').classList.remove('active'); ballMesh.count = 0;
  const visualCount = Math.min(130, ballCount), power = 16 + Math.min(8, ballCount / 28);
  for (let i = 0; i < visualCount; i++) {
    const mesh = new THREE.Mesh(ballGeo, ballMesh.material); mesh.scale.setScalar(.82 + (i % 5) * .035); mesh.castShadow = true;
    mesh.position.set((Math.random() - .5) * 2.2, .3 + Math.random() * .8, -225 + (Math.random() - .5) * 1.6);
    const dir = new THREE.Vector3(pointer.aimX * .48 + (Math.random() - .5) * .08, .19 + pointer.aimY * .18 + Math.random() * .05, -1).normalize();
    mesh.userData.vel = dir.multiplyScalar(power * (.88 + Math.random() * .22)); mesh.userData.life = 0; mesh.userData.damage = Math.max(1, ballCount / visualCount); world.add(mesh); shots.push(mesh);
  }
  finishTimer = 0; sound('launch'); haptic(70); shake = .2; track('volley_fired', { balls: ballCount });
}

function hitBlock(block, shot) {
  if (!block.userData.alive) return; block.userData.alive = false; destroyed++;
  const now = performance.now(); combo = now - lastDestroyAt < 450 ? combo + 1 : 1; lastDestroyAt = now; maxCombo = Math.max(maxCombo, combo);
  block.userData.vel.copy(shot.userData.vel).multiplyScalar(.1 + Math.random() * .07); block.userData.vel.y += 3 + Math.random() * 3; block.userData.vel.x += (Math.random() - .5) * 3; block.userData.vel.z += (Math.random() - .5) * 2;
  burst(block.position.clone(), block.material.color.getHex(), 5); if (combo > 2 && combo % 3 === 0) showToast(`×${combo} COMBO`, true); shake = Math.min(.6, shake + .08); sound(combo > 5 ? 'crush' : 'pop');
  const pct = Math.round(destroyed / blocks.length * 100); $('#destroy-percent').textContent = `${pct}%`; $('#destroy-fill').style.width = `${pct}%`;
  if (combo >= 5) blocks.forEach(b => { if (b.userData.alive && b.position.distanceTo(block.position) < 1.7 && Math.random() < .24) { b.userData.delay = .04 + Math.random() * .15; b.userData.chainFrom = shot; } });
}

function updateFinale(dt) {
  finishTimer += dt; camera.position.x = lerp(camera.position.x, 0, dt * 2); camera.position.y = lerp(camera.position.y, 7.8, dt * 2); camera.position.z = lerp(camera.position.z, -215.2, dt * 2); camera.lookAt(0, 3, -240);
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]; s.userData.life += dt; s.userData.vel.y -= 6.8 * dt; s.position.addScaledVector(s.userData.vel, dt); s.rotation.x += dt * 9;
    let hit = null; if (s.position.z < -235.2 && s.position.z > -244.5) for (const b of blocks) if (b.userData.alive && s.position.distanceTo(b.position) < 1.05) { hit = b; break; }
    if (hit) { hitBlock(hit, s); world.remove(s); shots.splice(i, 1); continue; }
    if (s.position.y < -.5 || s.userData.life > 5) { world.remove(s); shots.splice(i, 1); }
  }
  for (const b of blocks) {
    if (b.userData.delay > 0) { b.userData.delay -= dt; if (b.userData.delay <= 0) hitBlock(b, b.userData.chainFrom); }
    if (!b.userData.alive) { b.userData.vel.y -= 12 * dt; b.position.addScaledVector(b.userData.vel, dt); b.rotation.x += b.userData.vel.z * dt; b.rotation.z += b.userData.vel.x * dt; if (b.position.y < -.25) { b.position.y = -.25; b.userData.vel.y *= -.25; b.userData.vel.multiplyScalar(.91); } }
  }
  if (state === 'firing' && finishTimer > 2.3 && shots.length === 0) finishLevel();
}

function finishLevel() {
  state = nextState(state, 'SETTLED'); const pct = Math.round(destroyed / blocks.length * 100); const score = scoreRun({ balls: ballCount, destroyed: pct, combo: maxCombo, level: levelData.level }); const coins = coinsFor({ destroyed: pct, score });
  save.coins += coins; save.best = Math.max(save.best, score); save.level = Math.max(save.level, levelData.level + 1); persist();
  $('#result-title').textContent = pct > 85 ? 'TOTAL MAYHEM!' : pct > 55 ? 'CRUSHED IT!' : 'NICE HIT!'; $('#result-destroy').textContent = `${pct}%`; $('#result-balls').textContent = ballCount; $('#result-coins').textContent = coins; $('#result-score').textContent = score.toLocaleString(); $('#result-ring').style.setProperty('--pct', pct);
  setTimeout(() => setState('results'), 450); sound('victory'); haptic([60, 50, 80]); track('level_complete', { level: levelData.level, score, destruction: pct, coins });
}

function burst(position, color, amount = 10) {
  for (let i = 0; i < amount; i++) { const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.07 + Math.random() * .1, 0), new THREE.MeshBasicMaterial({ color })); mesh.position.copy(position); mesh.userData.vel = new THREE.Vector3((Math.random() - .5) * 6, Math.random() * 5, (Math.random() - .5) * 6); mesh.userData.life = .6 + Math.random() * .5; world.add(mesh); particles.push(mesh); }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.userData.life -= dt; p.userData.vel.y -= 8 * dt; p.position.addScaledVector(p.userData.vel, dt); p.scale.setScalar(Math.max(0, p.userData.life)); if (p.userData.life <= 0) { world.remove(p); particles.splice(i, 1); } }
}

function showToast(text, good = true) { const el = $('#toast'); el.textContent = text; el.className = `toast show ${good ? 'good' : 'bad'}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => el.classList.remove('show'), 700); }
function setProgress(p) { const pct = p * 100; $('#progress-fill').style.width = `${pct}%`; $('#progress-dot').style.left = `${pct}%`; }
function updateHud() { $('#ball-count').textContent = ballCount; $('#hud-level').textContent = levelData?.level || save.level; }
function updateMenu() { $('#menu-level').textContent = save.level; $('#menu-coins').textContent = save.coins; $('#menu-best').textContent = save.best.toLocaleString(); $('#shop-coins').textContent = save.coins; renderShop(); updateMute(); }
function setState(next) { state = next; Object.values(ui).forEach(x => x.classList.remove('active')); if (ui[next]) ui[next].classList.add('active'); if (['running','aiming','firing'].includes(next)) ui.hud.classList.add('active'); if (next === 'menu') updateMenu(); }

function renderShop() {
  const list = $('#cosmetic-list'); list.innerHTML = '';
  COSMETICS.forEach(item => { const owned = save.owned.includes(item.id), selected = save.selected === item.id; const row = document.createElement('div'); row.className = `cosmetic ${selected ? 'selected' : ''}`;
    row.innerHTML = `<div class="swatch" style="background:linear-gradient(135deg,${item.colors.join(',')})"></div><div><h3>${item.name}</h3><p>${owned ? 'UNLOCKED' : 'COSMETIC ONLY'}</p></div><button class="buy-btn" ${!owned && save.coins < item.price ? 'disabled' : ''}>${selected ? 'EQUIPPED' : owned ? 'USE' : `● ${item.price}`}</button>`;
    row.querySelector('button').onclick = () => { if (selected) return; if (!owned) { if (save.coins < item.price) return; save.coins -= item.price; save.owned.push(item.id); sound('coin'); haptic(35); } save.selected = item.id; persist(); cosmeticMaterial(); renderShop(); $('#shop-coins').textContent = save.coins; track('cosmetic_selected', { id: item.id }); }; list.append(row);
  });
}

let audioCtx;
function sound(type) { if (save.muted) return; audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); const t = audioCtx.currentTime; const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(); const types = { gate:[520,880,.12,'sine'],hit:[130,70,.18,'sawtooth'],ready:[320,560,.22,'triangle'],launch:[180,520,.32,'sawtooth'],pop:[220,150,.08,'square'],crush:[100,55,.16,'sawtooth'],coin:[800,1200,.12,'sine'],victory:[440,880,.55,'triangle'] }; const p = types[type] || types.pop; osc.type = p[3]; osc.frequency.setValueAtTime(p[0],t); osc.frequency.exponentialRampToValueAtTime(p[1],t+p[2]); gain.gain.setValueAtTime(.0001,t); gain.gain.exponentialRampToValueAtTime(type==='hit'?.12:.07,t+.01); gain.gain.exponentialRampToValueAtTime(.0001,t+p[2]); osc.connect(gain).connect(audioCtx.destination); osc.start(t); osc.stop(t+p[2]+.02); }
const haptic = pattern => navigator.vibrate?.(pattern);
function updateMute() { $('#mute-menu').textContent = save.muted ? '×' : '♪'; }

function pointerPos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 2 - 1, y: -((e.clientY - r.top) / r.height * 2 - 1) }; }
shell.addEventListener('pointerdown', e => { if (!['running','aiming'].includes(state) || e.target.closest?.('button')) return; shell.setPointerCapture(e.pointerId); const p = pointerPos(e); pointer = { ...pointer, down:true, x:p.x, y:p.y, startX:p.x, startY:p.y }; if (state === 'running') targetX = p.x * 4.3; sound('pop'); });
shell.addEventListener('pointermove', e => { if (!pointer.down) return; const p = pointerPos(e), dx = p.x - pointer.x; pointer.x = p.x; pointer.y = p.y; if (state === 'running') targetX = clamp(targetX + dx * 7.5, -4.1, 4.1); if (state === 'aiming') { pointer.aimX = clamp((p.x - pointer.startX) * .95, -.82, .82); pointer.aimY = clamp((p.y - pointer.startY) * .75 + .18, .06, .7); camera.position.x = -pointer.aimX * 2; } });
shell.addEventListener('pointerup', () => { if (!pointer.down) return; pointer.down = false; if (state === 'aiming') fireVolley(); });
window.addEventListener('keydown', e => { if (state === 'running') { if (e.key === 'ArrowLeft' || e.key === 'a') targetX -= 1.2; if (e.key === 'ArrowRight' || e.key === 'd') targetX += 1.2; } if (state === 'aiming' && e.key === ' ') fireVolley(); });

$('#play-btn').onclick = () => createLevel(save.level);
$('#pause-btn').onclick = () => { if (state === 'running') { state = nextState(state,'PAUSE'); setState('pause'); } };
$('#resume-btn').onclick = () => { state = nextState(state,'RESUME'); setState('running'); };
$('#shop-btn').onclick = () => setState('shop'); $('#close-shop').onclick = () => setState('menu');
$('#next-btn').onclick = () => createLevel(levelData.level + 1); $('#replay-btn').onclick = () => createLevel(levelData.level, true); $$('[data-home]').forEach(b => b.onclick = () => setState('menu'));
$('#mute-menu').onclick = () => { save.muted = !save.muted; persist(); updateMute(); if (!save.muted) sound('coin'); };
$('#share-btn').onclick = async () => { const pct = Math.round(destroyed / blocks.length * 100); const text = `I destroyed ${pct}% of the tower on level ${levelData.level} in CHAIN RUSH. Can you beat me?`; try { if (navigator.share) await navigator.share({ title:'CHAIN RUSH', text, url:location.href }); else { await navigator.clipboard.writeText(`${text} ${location.href}`); showToast('COPIED!', true); } } catch {} };

function resize() { const w = shell.clientWidth, h = shell.clientHeight; renderer.setSize(w,h,false); camera.aspect = w/h; camera.fov = h/w > 1.9 ? 58 : 54; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

function animate() {
  requestAnimationFrame(animate); const dt = Math.min(.033, clock.getDelta()), t = clock.elapsedTime;
  if (state === 'running') updateRun(dt, t); else if (state === 'aiming') { updateBallInstances(t); camera.position.z = lerp(camera.position.z, -214.5, dt * 2); camera.position.y = lerp(camera.position.y, 8.2, dt * 2); camera.lookAt(pointer.aimX * 2, 2.8, -240); } else if (state === 'firing') updateFinale(dt);
  if (state === 'menu') { camera.position.x = Math.sin(t*.25)*3.5; camera.position.y = 9 + Math.sin(t*.4)*.4; camera.position.z = 17; camera.lookAt(0,0,-15); }
  updateParticles(dt); if (shake > 0) { const s = shake * .18; camera.position.x += (Math.random()-.5)*s; camera.position.y += (Math.random()-.5)*s; shake = Math.max(0, shake-dt*1.7); }
  renderer.render(scene,camera);
}

createEnvironment(); runGroup = new THREE.Group(); world.add(runGroup); levelData = makeLevel(save.level); createTrack(); createTower(); ballCount = levelData.startBalls; runZ = -10; groupX = 0; runGroup.add(ballMesh); cosmeticMaterial(); updateBallInstances(0); updateMenu(); setState('menu'); animate();
