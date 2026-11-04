import * as THREE from 'three';
import { applyModifier, modifierLabel, makeLevel, scoreRun, coinsFor, nextState, impactRemovalIndices, destructionPotential, COSMETICS, MAX_BALLS } from './gameLogic.js';
import { initAnalytics } from './analytics.js';

const bootStartedAt = performance.now();
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const canvas = $('#game-canvas');
const shell = $('#game-shell');
const ui = Object.fromEntries(['menu','hud','pause','results','shop','settings'].map(id => [id, $(`#${id}`)]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const MAX_RENDERED_BALLS = 620;

const defaults = { level: 1, coins: 0, best: 0, selected: 'classic', owned: ['classic'], muted: false, haptics: true, graphics: 'auto', tutorialSeen: false };
let save;
try { save = { ...defaults, ...JSON.parse(localStorage.getItem('chainRushSave') || '{}') }; } catch { save = { ...defaults }; }
const persist = () => localStorage.setItem('chainRushSave', JSON.stringify(save));

const analytics = initAnalytics();
window.ChainRushProviders = Object.freeze({
  analytics,
  rewardedAds: { available: () => false, show: async () => ({ completed: false }) },
  purchases: { buy: async () => ({ verified: false }) },
  adRemoval: { active: () => false }
});
const track = (name, data = {}) => window.ChainRushProviders.analytics.track(name, data);

const detectedQuality = (navigator.deviceMemory || 8) <= 3 || (navigator.hardwareConcurrency || 8) <= 4 ? 'low' : (navigator.deviceMemory || 8) <= 6 || (navigator.hardwareConcurrency || 8) <= 6 ? 'medium' : 'high';
const qualityProfiles = { low:{ dpr:1.05, effects:.42, particles:90, shadows:false }, medium:{ dpr:1.35, effects:.68, particles:150, shadows:true }, high:{ dpr:1.7, effects:1, particles:240, shadows:true } };
let quality = save.graphics === 'auto' ? detectedQuality : (qualityProfiles[save.graphics] ? save.graphics : detectedQuality);
let lowPower = quality === 'low', effectScale = qualityProfiles[quality].effects, particleLimit = qualityProfiles[quality].particles;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, qualityProfiles[quality].dpr));
renderer.shadowMap.enabled = qualityProfiles[quality].shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
const scene = new THREE.Scene();
const skyCanvas = document.createElement('canvas'); skyCanvas.width = 16; skyCanvas.height = 256;
const skyCtx = skyCanvas.getContext('2d'), skyGradient = skyCtx.createLinearGradient(0, 0, 0, 256);
skyGradient.addColorStop(0, '#4d6eea'); skyGradient.addColorStop(.42, '#65c9ff'); skyGradient.addColorStop(1, '#d6f3ff'); skyCtx.fillStyle = skyGradient; skyCtx.fillRect(0, 0, 16, 256);
const skyTexture = new THREE.CanvasTexture(skyCanvas); skyTexture.colorSpace = THREE.SRGBColorSpace; scene.background = skyTexture;
scene.fog = new THREE.Fog(0x9bdcff, 42, 152);
const camera = new THREE.PerspectiveCamera(54, 1, .1, 260);
camera.position.set(0, 8.7, 14);
camera.lookAt(0, 0, -8);

scene.add(new THREE.HemisphereLight(0xe8f7ff, 0x6b3ab5, 3));
const sun = new THREE.DirectionalLight(0xffffff, 4.2); sun.position.set(-8, 18, 10); sun.castShadow = true;
sun.shadow.mapSize.set(quality === 'high' ? 1024 : 512, quality === 'high' ? 1024 : 512); sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -12; scene.add(sun);
const fill = new THREE.DirectionalLight(0xff74c9, 1.5); fill.position.set(9, 7, -8); scene.add(fill);
const runnerRim = new THREE.PointLight(0x74eaff, 2.4, 18, 2); runnerRim.position.set(-4, 5, 2); scene.add(runnerRim);

const world = new THREE.Group(); scene.add(world);
const deco = new THREE.Group(); scene.add(deco);
let state = 'menu', levelData, runGroup, towerGroup, gateObjects = [], obstacleObjects = [], blocks = [], shots = [], particles = [], particlePool = [];
let ballCount = 12, runZ = 0, targetX = 0, groupX = 0, fired = false, finishTimer = 0, destroyed = 0, combo = 0, maxCombo = 0, lastDestroyAt = 0, shake = 0, cameraImpulse = 0, levelStartBalls = 0, destructionLimit = Infinity;
let targetDestroy = 0, displayedDestroy = 0, slowMo = 0, finaleWarned = false, growthWave = 0, perfectCelebrated = false;
let ballMembers = [];
let pointer = { down: false, id: null, moved: false, x: 0, y: 0, startX: 0, startY: 0, aimX: 0, aimY: .2 };
const aimTarget = new THREE.Vector3(0, 2.8, -240);
const aimRaycaster = new THREE.Raycaster();
const aimPointer = new THREE.Vector2(), aimWorldPoint = new THREE.Vector3();
const towerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 240);
const clock = new THREE.Clock();
const frameMetrics = { elapsed: 0, frames: 0, samples: [] };
let isPageVisible = !document.hidden, firstFrameRendered = false, levelReady = false, lastRenderAt = 0, autoTuneElapsed = 0, autoTuneFrames = 0;

const permanentMaterials = new Set(), permanentGeometries = new Set(), textMaterialCache = new Map();
const keepMaterial = material => (permanentMaterials.add(material), material);
const keepGeometry = geometry => (permanentGeometries.add(geometry), geometry);
const glossy = (color, metal = .08, rough = .21, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive, emissiveIntensity: .35 });
const trackMat = keepMaterial(glossy(0xf8fbff, .02, .3));
const edgeMat = keepMaterial(glossy(0xd8c8ff, .05, .27));
const bonusMat = keepMaterial(glossy(0x25e2ad, .05, .18, 0x0a5b42));
const lossMat = keepMaterial(glossy(0xff496d, .02, .2, 0x7a0e26));
const obstacleMat = keepMaterial(glossy(0xff3f72, .1, .22));
const ballGeo = new THREE.SphereGeometry(.3, lowPower ? 10 : 14, lowPower ? 8 : 12);
const ballMaterial = new THREE.MeshPhysicalMaterial({ color: 0x7656ff, metalness: .16, roughness: .13, clearcoat: 1, clearcoatRoughness: .1, emissive: 0x000000, emissiveIntensity: .35 });
keepGeometry(ballGeo); keepMaterial(ballMaterial);
const ballMesh = new THREE.InstancedMesh(ballGeo, ballMaterial, MAX_RENDERED_BALLS);
ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ballMesh.castShadow = true; ballMesh.receiveShadow = true; ballMesh.count = 0;
// Instance transforms move with the runner every frame. Three's cached aggregate
// bounds otherwise remain behind and can incorrectly cull the whole ball army.
ballMesh.frustumCulled = false;
const dummy = new THREE.Object3D();
const instanceColor = new THREE.Color(), whiteInstanceColor = new THREE.Color(0xffffff);
const MAX_VOLLEY_SHOTS = 220;
const shotMesh = new THREE.InstancedMesh(ballGeo, ballMaterial, MAX_VOLLEY_SHOTS); shotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shotMesh.count = 0; shotMesh.frustumCulled = false; world.add(shotMesh);
const particleGeo = new THREE.IcosahedronGeometry(.11, 0);
const dustMat = new THREE.MeshBasicMaterial({ color: 0xf5e9d5, transparent: true, opacity: .55, depthWrite: false });
keepGeometry(particleGeo); keepMaterial(dustMat);
const particleMaterials = new Map();
const particleBatches = new Map();
const stripeGeo = keepGeometry(new THREE.BoxGeometry(8.8, .04, .16));
const finishGeo = keepGeometry(new THREE.BoxGeometry(10, .12, 4));
const checkerGeo = keepGeometry(new THREE.BoxGeometry(.96, .13, .96));
const towerBlockGeo = keepGeometry(new THREE.BoxGeometry(1.35, .88, 1.35, 2, 2, 2));
const arenaGeo = keepGeometry(new THREE.CylinderGeometry(11, 12, 1.2, 32));
const stripeMat = keepMaterial(new THREE.MeshBasicMaterial({ color:0xded7ff, transparent:true, opacity:.7 }));
const finishMat = keepMaterial(new THREE.MeshBasicMaterial({ color:0xffffff }));
const checkerMats = [keepMaterial(new THREE.MeshBasicMaterial({ color:0x3e276f })), keepMaterial(new THREE.MeshBasicMaterial({ color:0xffffff }))];
const towerMats = [0xff5aa7,0x734dff,0x23d7ed,0xffd54a].map(color => keepMaterial(glossy(color,.08,.23)));
const arenaMat = keepMaterial(glossy(0xeeeaff,.08,.3));

function applyQuality(nextQuality = quality) {
  quality = qualityProfiles[nextQuality] ? nextQuality : detectedQuality; lowPower = quality === 'low';
  effectScale = qualityProfiles[quality].effects; particleLimit = qualityProfiles[quality].particles;
  renderer.setPixelRatio(Math.min(devicePixelRatio, qualityProfiles[quality].dpr)); renderer.shadowMap.enabled = qualityProfiles[quality].shadows; sun.castShadow = qualityProfiles[quality].shadows; ballMesh.castShadow = quality !== 'low';
  resize(); updateSettings(); shell.dataset.quality = quality;
}

function hideLoading() { const loading = $('#loading-screen'); $('#loading-status').textContent = 'READY'; requestAnimationFrame(() => { loading.classList.add('ready'); setTimeout(() => { loading.hidden = true; }, 320); }); }

function cosmeticMaterial() {
  const item = COSMETICS.find(c => c.id === save.selected) || COSMETICS[0];
  const mat = ballMesh.material;
  mat.color.set(item.colors[0]); mat.metalness = item.id === 'metal' ? .88 : item.id === 'galaxy' ? .45 : .12;
  mat.roughness = item.id === 'metal' ? .13 : .18;
  mat.emissive.set(item.id === 'neon' ? item.colors[0] : item.id === 'galaxy' ? '#26006b' : '#000000');
  mat.emissiveIntensity = item.id === 'neon' ? .72 : item.id === 'galaxy' ? .35 : 0;
  mat.needsUpdate = true;
  if (item.id !== 'rainbow' && ballMesh.instanceColor) { for (let i = 0; i < ballMesh.count; i++) ballMesh.setColorAt(i, whiteInstanceColor); ballMesh.instanceColor.needsUpdate = true; }
}

function clearGroup(group) {
  if (!group) return;
  group.traverse(o => { if (o.geometry && !permanentGeometries.has(o.geometry)) o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.filter(Boolean).forEach(material => { if (permanentMaterials.has(material)) return; material.map?.dispose?.(); material.dispose?.(); }); });
  group.removeFromParent();
}

function roundedBox(w, h, d, r, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 2, 2, 2), material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}

function makeText(text, color = '#ffffff', fontSize = 72) {
  const key = `${text}|${color}|${fontSize}`; let material = textMaterialCache.get(key);
  if (!material) { const c = document.createElement('canvas'); c.width = 384; c.height = 160; const ctx = c.getContext('2d'); ctx.font = `900 ${fontSize}px Nunito, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(25,15,66,.45)'; ctx.strokeText(text, 192, 82); ctx.fillStyle = color; ctx.fillText(text, 192, 82); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; material = keepMaterial(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false })); textMaterialCache.set(key, material); }
  const spr = new THREE.Sprite(material); spr.scale.set(4.8, 2, 1); return spr;
}

function createEnvironment() {
  while (deco.children.length) deco.remove(deco.children[0]);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(8, 40), new THREE.MeshBasicMaterial({ color: 0xfff1ae, transparent: true, opacity: .7, fog: false }));
  sunDisc.position.set(-19, 22, -125); sunDisc.rotation.y = .15; deco.add(sunDisc);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .72 });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1), clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 28);
  for (let i = 0; i < 28; i++) { const size = 1 + (i % 3) * .45; dummy.position.set((i % 2 ? 1 : -1) * (9 + (i * 7) % 14), 5 + (i * 3) % 12, 15 - i * 13); dummy.scale.set(1.8 * size, .45 * size, .7 * size); dummy.rotation.set(0,0,0); dummy.updateMatrix(); clouds.setMatrixAt(i,dummy.matrix); } clouds.instanceMatrix.needsUpdate = true; deco.add(clouds);
  const islandMat = glossy(0x896bea, .04, .68);
  const islandGeo = new THREE.ConeGeometry(1, 1, 6), islands = new THREE.InstancedMesh(islandGeo, islandMat, 42);
  for (let i = 0; i < 42; i++) {
    const radius = 2 + (i % 4), islandX = (i % 2 ? 1 : -1) * (12 + (i % 5) * 4), islandZ = 5 - i * 14; dummy.position.set(islandX,-5,islandZ); dummy.scale.set(radius,8,radius); dummy.rotation.set(0,0,Math.PI); dummy.updateMatrix(); islands.setMatrixAt(i,dummy.matrix);
    if (i % 3 === 0) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2 + i % 2, .08, 6, 32), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff72c9 : 0x62efff, transparent: true, opacity: .42 }));
      ring.position.set(islandX * .88, 3 + i % 5, islandZ - 5); ring.rotation.x = Math.PI / 2; ring.userData.float = i * .5; ring.userData.baseY = ring.position.y; deco.add(ring);
    }
  } islands.instanceMatrix.needsUpdate = true; deco.add(islands);
}

function createTrack() {
  const trackDepth = levelData.trackLength + 25, trackCenter = (4 + levelData.finishZ) / 2;
  const track = roundedBox(10, .65, trackDepth, .2, trackMat); track.position.set(0, -.55, trackCenter); runGroup.add(track);
  for (const x of [-5.15, 5.15]) {
    const edge = roundedBox(.25, .55, trackDepth, .1, edgeMat); edge.position.set(x, -.1, trackCenter); runGroup.add(edge);
    const glow = roundedBox(.06, .1, trackDepth, .04, bonusMat); glow.position.set(x > 0 ? 5.02 : -5.02, .18, trackCenter); runGroup.add(glow);
  }
  for (let z = 8; z > levelData.finishZ - 2; z -= 12) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat); stripe.position.set(0, -.21, z); runGroup.add(stripe);
  }
  const finish = new THREE.Mesh(finishGeo, finishMat); finish.position.set(0, -.16, levelData.finishZ + 1); runGroup.add(finish);
  for (let x = -4.5; x <= 4.5; x += 1) for (let z = levelData.finishZ + 2.5; z >= levelData.finishZ - .5; z -= 1) { const sq = new THREE.Mesh(checkerGeo, checkerMats[Math.abs((x + Math.round(z)) | 0) % 2]); sq.position.set(x, -.08, z); runGroup.add(sq); }
}

function createGate(pair) {
  const group = new THREE.Group(); group.position.z = pair.z; group.userData = { triggered: false, pair };
  [['left', -2.55], ['right', 2.55]].forEach(([side, x]) => {
    const mod = pair[side]; const good = mod.op === '+' || mod.op === 'x'; const mat = good ? bonusMat : lossMat;
    const gateMat = new THREE.MeshStandardMaterial({ color: good ? 0x19e6a1 : 0xff395f, transparent: true, opacity: .68, metalness: .08, roughness: .18, emissive: good ? 0x087353 : 0x8a0b28, emissiveIntensity: .65 });
    const pane = roundedBox(4.62, 3.08, .24, .12, gateMat); pane.position.set(x, 1.52, 0); group.add(pane);
    for (const px of [x - 2.28, x + 2.28]) { const post = roundedBox(.3, 3.9, .38, .07, mat); post.position.set(px, 1.48, 0); group.add(post); }
    const cap = roundedBox(4.88, .32, .42, .08, mat); cap.position.set(x, 3.28, 0); group.add(cap);
    const foot = roundedBox(4.72, .12, .75, .06, new THREE.MeshBasicMaterial({ color: good ? 0x67ffce : 0xff6a83, transparent: true, opacity: .9 })); foot.position.set(x, -.15, -.08); group.add(foot);
    const label = makeText(modifierLabel(mod), '#ffffff', 84); label.position.set(x, 1.58, .28); label.scale.set(5.35, 2.2, 1); group.add(label);
    group.userData[side] = { pane, cap, label, good };
  });
  runGroup.add(group); gateObjects.push(group);
}

function createObstacle(data, i) {
  const g = new THREE.Group(); g.position.set(0, 0, data.z); g.userData = { ...data, hit: false, index: i };
  if (data.type === 'movingWall') {
    const wall = roundedBox(2.65, 2.25, 1.05, .18, obstacleMat); wall.position.set(data.x, .68, 0); g.add(wall); g.userData.wall = wall;
    const arrows = makeText('↔', '#ffffff', 90); arrows.position.set(data.x, 2.25, .62); arrows.scale.set(2.4, 1.15, 1); g.add(arrows); g.userData.arrows = arrows;
  }
  if (data.type === 'hammer') {
    const pivot = new THREE.Group(); const arm = roundedBox(6.7, .34, .5, .16, glossy(0xff4b78, .22, .2)); arm.position.y = .34; pivot.add(arm);
    for (const x of [-3.25, 3.25]) { const head = roundedBox(1.15, 1.15, 1.05, .2, glossy(0xffc23d, .2, .25)); head.position.set(x, .36, 0); pivot.add(head); }
    g.add(pivot); g.userData.pivot = pivot;
  }
  if (data.type === 'laser') {
    const laserMat = new THREE.MeshStandardMaterial({ color: 0xff315e, emissive: 0xff164c, emissiveIntensity: 2.2, transparent: true, opacity: .88 });
    const beam = roundedBox(3.7, .18, .48, .08, laserMat); beam.position.set(data.x, .48, 0); g.add(beam); g.userData.beam = beam;
    for (const x of [data.x - 1.95, data.x + 1.95]) { const post = roundedBox(.32, 2.1, .52, .12, glossy(0x46204f, .4, .24)); post.position.set(x, .7, 0); g.add(post); }
    const warning = makeText('LASER', '#ffef57', 54); warning.position.set(data.x, 2.05, .2); warning.scale.set(2.6, 1.05, 1); g.add(warning); g.userData.warning = warning;
  }
  if (data.type === 'crusher') {
    const frame = roundedBox(3.1, .35, 1.25, .12, glossy(0x43266f, .32, .22)); frame.position.set(data.x, 4.2, 0); g.add(frame);
    const plate = roundedBox(2.75, 1.15, 1.18, .16, glossy(0xff6c42, .18, .22)); plate.position.set(data.x, 2.8, 0); g.add(plate); g.userData.plate = plate;
    const down = makeText('▼', '#fff25c', 82); down.position.set(data.x, 4.85, .3); down.scale.set(2, 1, 1); g.add(down);
  }
  if (data.type === 'narrow') {
    const opening = clamp(data.x, -1.75, 1.75), gap = 3.4, leftEdge = opening - gap / 2, rightEdge = opening + gap / 2; g.userData.walls = [];
    const widths = [leftEdge + 5, 5 - rightEdge], centers = [(-5 + leftEdge) / 2, (rightEdge + 5) / 2];
    widths.forEach((width, index) => { if (width <= .15) return; const wall = roundedBox(width, 1.65, 1.3, .14, glossy(0x8f52ff, .12, .22)); wall.position.set(centers[index], .45, 0); wall.userData.halfWidth = width / 2; g.add(wall); g.userData.walls.push(wall); });
    const marker = makeText('NARROW', '#ffffff', 50); marker.position.set(opening, 2.05, .35); marker.scale.set(2.7, 1, 1); g.add(marker);
  }
  if (data.type === 'risk') {
    const laneX = clamp(data.x, -2, 2); g.userData.laneX = laneX; g.userData.bonusClaimed = false; g.userData.walls = [];
    for (const x of [laneX - 1.35, laneX + 1.35]) { const rail = roundedBox(.48, 1.65, 3.8, .14, glossy(0xff3d78, .16, .2)); rail.position.set(x, .45, 0); rail.userData.halfWidth = .5; g.add(rail); g.userData.walls.push(rail); }
    const pad = roundedBox(2.2, .08, 3.4, .15, new THREE.MeshStandardMaterial({ color: 0x2df0b3, emissive: 0x0ca778, emissiveIntensity: .9, transparent: true, opacity: .8 })); pad.position.set(laneX, -.15, 0); g.add(pad); g.userData.pad = pad;
    const reward = makeText(`+${data.bonus}`, '#fff35c', 78); reward.position.set(laneX, 1.65, .3); reward.scale.set(2.6, 1.15, 1); g.add(reward);
  }
  runGroup.add(g); obstacleObjects.push(g);
}

function createTower() {
  towerGroup = new THREE.Group(); world.add(towerGroup); blocks = [];
  const arena = new THREE.Mesh(arenaGeo, arenaMat); arena.position.set(0, -.8, levelData.towerZ); arena.receiveShadow = true; towerGroup.add(arena);
  const { rows, cols, layers } = levelData.tower;
  for (let layer = 0; layer < layers; layer++) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if ((x + y + layer + levelData.level) % 11 === 0 && y > rows - 3) continue;
    const mesh = new THREE.Mesh(towerBlockGeo, towerMats[(x + y + layer) % towerMats.length]);
    mesh.position.set((x - (cols - 1) / 2) * 1.42 + (y % 2) * .12, y * .93, levelData.towerZ + (layer - (layers - 1) / 2) * 1.5);
    mesh.userData = { alive: true, vel: new THREE.Vector3(), baseY: mesh.position.y, delay: 0, unsupported: 0, id: blocks.length }; mesh.castShadow = true; towerGroup.add(mesh); blocks.push(mesh);
  }
  const crown = makeText('CRUSH ME', '#ffe24c', 56); crown.position.set(0, rows * .95 + .7, levelData.towerZ); towerGroup.add(crown);
}

function createLevel(level, replay = false) {
  shots = []; shotMesh.count = 0; particles.forEach(particle => { if (particlePool.length < particleLimit) particlePool.push(particle); }); particles = []; particleBatches.forEach(batch => batch.mesh.count = 0); clearGroup(runGroup); clearGroup(towerGroup); runGroup = new THREE.Group(); world.add(runGroup); gateObjects = []; obstacleObjects = []; levelReady = true;
  levelData = makeLevel(level); levelStartBalls = levelData.startBalls; ballCount = levelStartBalls; resetBallFormation(ballCount); runZ = 4; groupX = targetX = 0; destroyed = combo = maxCombo = 0; fired = false; finishTimer = 0; shake = cameraImpulse = 0; targetDestroy = displayedDestroy = 0; destructionLimit = Infinity; slowMo = 0; finaleWarned = false; perfectCelebrated = false; $('#confetti-layer').replaceChildren();
  createTrack(); levelData.gates.forEach(createGate); levelData.obstacles.forEach(createObstacle); createTower();
  runGroup.add(ballMesh); cosmeticMaterial(); updateBallInstances(0); setState('running'); updateHud();
  $('#destroy-percent').textContent = '0%'; $('#destroy-fill').style.width = '0%'; camera.position.set(0, 8.7, 14); camera.lookAt(0, 0, -8); track('level_start', { level, replay });
  if (!save.tutorialSeen) { save.tutorialSeen = true; persist(); setTimeout(() => { if (state === 'running') showToast('SWIPE TO STEER', true); }, 500); }
}

function makeFormation(count) {
  const spread = Math.min(3.35, .65 + Math.sqrt(count) * .18);
  return Array.from({ length: count }, (_, i) => {
    const r = Math.sqrt(i / Math.max(1, count)) * spread, a = i * 2.399963;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * .72;
    return { x, z, tx: x, tz: z, phase: i * .7, birth: -1, popUntil: 0 };
  });
}

function resetBallFormation(count) {
  ballCount = Math.max(1, Math.min(MAX_BALLS, Math.floor(count)));
  ballMembers = makeFormation(Math.min(MAX_RENDERED_BALLS, ballCount));
}

function growBallFormation(count) {
  const next = Math.max(1, Math.min(MAX_BALLS, Math.floor(count))), visualNext = Math.min(MAX_RENDERED_BALLS, next), targets = makeFormation(visualNext), now = clock.elapsedTime, previous = ballMembers.length;
  if (ballMembers.length > visualNext) ballMembers.length = visualNext;
  for (let i = 0; i < visualNext; i++) {
    if (i < previous) {
      ballMembers[i].tx = targets[i].x; ballMembers[i].tz = targets[i].z; ballMembers[i].popUntil = now + .42;
    } else {
      ballMembers.push({ x: (Math.random() - .5) * .35, z: .2 + Math.random() * .25, tx: targets[i].x, tz: targets[i].z, phase: i * .7, birth: now + (i - previous) * .0045, popUntil: now + .5 });
    }
  }
  ballCount = next; growthWave = .7;
}

function updateBallInstances(time) {
  ballMesh.count = ballMembers.length;
  for (let i = 0; i < ballMembers.length; i++) {
    const member = ballMembers[i]; member.x = lerp(member.x, member.tx, .12); member.z = lerp(member.z, member.tz, .12);
    const bornScale = member.birth < 0 ? 1 : clamp((time - member.birth) * 5.5, 0, 1); const eased = 1 - (1 - bornScale) ** 3;
    const pop = member.popUntil > time ? Math.sin(clamp((member.popUntil - time) / .42, 0, 1) * Math.PI) * .28 : 0;
    const organicX = Math.sin(time * 1.8 + member.phase) * .035, organicZ = Math.cos(time * 1.5 + member.phase) * .028;
    const x = groupX + member.x + organicX, z = runZ + member.z + organicZ;
    dummy.position.set(x, .2 + Math.sin(time * 6 + member.phase) * .065 + pop * .16, z); const s = (.94 + (i % 7) * .011 + pop) * eased; dummy.scale.setScalar(Math.max(.02, s)); dummy.rotation.set(time + i, time * .7 + i, 0); dummy.updateMatrix(); ballMesh.setMatrixAt(i, dummy.matrix);
    if (save.selected === 'rainbow') { instanceColor.setHSL((i / Math.max(1, ballCount) + time * .08) % 1, .82, .6); ballMesh.setColorAt(i, instanceColor); }
  }
  ballMesh.instanceMatrix.needsUpdate = true; if (save.selected === 'rainbow' && ballMesh.instanceColor) ballMesh.instanceColor.needsUpdate = true;
}

function updateShotInstances() {
  shotMesh.count = shots.length;
  for (let i = 0; i < shots.length; i++) { const shot = shots[i]; dummy.position.copy(shot.position); dummy.scale.setScalar(shot.userData.scale); dummy.rotation.set(shot.rotation, shot.rotation * .7, 0); dummy.updateMatrix(); shotMesh.setMatrixAt(i, dummy.matrix); }
  shotMesh.instanceMatrix.needsUpdate = true;
}

function modifyBalls(mod, worldPos) {
  const before = ballCount, next = applyModifier(ballCount, mod), diff = next - before;
  if (diff > 0) growBallFormation(next); else resetBallFormation(Math.max(1, next));
  const multiplier = mod.op === 'x' && mod.value >= 3;
  showToast(multiplier ? `ARMY ×${mod.value}!` : `${diff >= 0 ? '+' : ''}${diff}`, diff >= 0); burst(worldPos, diff >= 0 ? 0x54ffe0 : 0xff3b6f, Math.min(lowPower ? 18 : 32, Math.abs(diff) + 9));
  sound(multiplier ? 'multiply' : diff >= 0 ? 'gate' : 'hit'); haptic(multiplier ? [25, 18, 42] : diff >= 0 ? 24 : [35, 30, 35]); cameraImpulse = multiplier ? .42 : .2; shake = Math.max(shake, multiplier ? .16 : .08); $('#ball-badge').classList.add('pop'); setTimeout(() => $('#ball-badge').classList.remove('pop'), 220); updateHud();
  if (next <= 0) showToast('LAST CHANCE!', false);
}

function obstacleHit(ob, impactWorldX) {
  if (ob.userData.hit) return; ob.userData.hit = true;
  const lossRatio = .12 + Math.min(.16, levelData.level * .004), requested = Math.max(2, Math.floor(ballCount * lossRatio)), loss = Math.min(requested, ballCount - 1);
  const impact = { x: impactWorldX - groupX, z: -.72 };
  const visualLoss = Math.min(ballMembers.length - 1, Math.max(1, Math.round(loss / ballCount * ballMembers.length)));
  const removedSet = new Set(impactRemovalIndices(ballMembers, impact, visualLoss));
  const removed = ballMembers.filter((_, index) => removedSet.has(index));
  ballMembers = ballMembers.filter((_, index) => !removedSet.has(index)); ballCount = Math.max(1, ballCount - loss);
  const targets = makeFormation(Math.min(MAX_RENDERED_BALLS, ballCount)); ballMembers.forEach((member, index) => { member.tx = targets[index]?.x ?? member.tx; member.tz = targets[index]?.z ?? member.tz; });
  removed.slice(0, Math.max(6, Math.floor(particleLimit * .22))).forEach(member => {
    const particle = acquireParticle(ballMesh.material, ballGeo); if (!particle) return; particle.position.set(groupX + member.x, .25, runZ + member.z); particle.userData.vel.set((member.x - impact.x) * 2.5 + (Math.random() - .5) * 2, 2.8 + Math.random() * 2.5, 2 + Math.random() * 2); particle.userData.life = particle.userData.maxLife = .65 + Math.random() * .35; particle.userData.startScale = .9; particle.scale = .9; particles.push(particle);
  });
  showToast(`-${loss}`, false); burst(new THREE.Vector3(impactWorldX, .4, runZ - .7), 0xff315f, 10); sound('hit'); haptic([45, 25, 35]); shake = .35; updateHud();
}

function updateRun(dt, t) {
  const speed = levelData.speed; runZ -= speed * dt; groupX = lerp(groupX, targetX, 1 - Math.exp(-dt * 12)); groupX = clamp(groupX, -4.1, 4.1); updateBallInstances(t);
  for (const g of gateObjects) {
    const glow = 1 + Math.sin(t * 4 + g.position.z) * .035; if (!g.userData.triggered) g.scale.set(glow, 1 + (glow - 1) * .5, glow);
    if (g.userData.pulse > 0) { g.userData.pulse = Math.max(0, g.userData.pulse - dt * 3.5); const kick = 1 + Math.sin(g.userData.pulse * Math.PI) * .12; g.scale.set(kick, kick, kick); }
    if (!g.userData.triggered && runZ < g.position.z + 1 && runZ > g.position.z - 2.2) { g.userData.triggered = true; g.userData.pulse = 1; const side = groupX < 0 ? 'left' : 'right'; modifyBalls(g.userData.pair[side], new THREE.Vector3(groupX, 1.4, g.position.z)); }
    // Retire scenery once it passes the camera so sprites never fill the near plane.
    if (runZ < g.position.z - 3.2) g.visible = false;
  }
  for (const ob of obstacleObjects) {
    const d = ob.userData;
    if (d.type === 'movingWall') { const x = d.x + Math.sin(t * d.speed + d.phase) * 2.15; d.wall.position.x = x; d.arrows.position.x = x; }
    if (d.type === 'hammer') d.pivot.rotation.y += dt * d.speed * 2.7;
    if (d.type === 'laser') { d.active = Math.sin(t * Math.PI * 2 / d.period + d.phase) > -.08; d.beam.visible = d.active; d.warning.visible = d.active; d.beam.material.opacity = d.active ? .9 : .12; }
    if (d.type === 'crusher') d.plate.position.y = .42 + (Math.sin(t * d.speed * 2.2 + d.phase) + 1) * 1.55;
    if (d.type === 'risk') d.pad.material.emissiveIntensity = .75 + Math.sin(t * 5 + d.phase) * .25;
    if (Math.abs(runZ - ob.position.z) < 1.45) {
      const touchesX = (x, radius) => ballMembers.some(member => Math.abs(groupX + member.x - x) < radius);
      if (d.type === 'movingWall' && touchesX(d.wall.position.x, 1.55)) obstacleHit(ob, d.wall.position.x);
      if (d.type === 'hammer') { const hammerX = Math.cos(d.pivot.rotation.y) * 3.25, leftHit = touchesX(-hammerX, .72), rightHit = touchesX(hammerX, .72); if (leftHit || rightHit) obstacleHit(ob, leftHit ? -hammerX : hammerX); }
      if (d.type === 'laser' && d.active && touchesX(d.x, 2.05)) obstacleHit(ob, d.x);
      if (d.type === 'crusher' && d.plate.position.y < 1.35 && touchesX(d.x, 1.55)) obstacleHit(ob, d.x);
      if (d.type === 'narrow') { const wall = d.walls.find(item => touchesX(item.position.x, item.userData.halfWidth + .2)); if (wall) obstacleHit(ob, wall.position.x); }
      if (d.type === 'risk') {
        if (!d.bonusClaimed && Math.abs(groupX - d.laneX) < .95) { d.bonusClaimed = true; growBallFormation(ballCount + d.bonus); showToast(`RISK +${d.bonus}`, true); burst(new THREE.Vector3(d.laneX, .25, ob.position.z), 0x35f2bd, 18); sound('multiply'); haptic([25,18,35]); updateHud(); }
        else if (!d.bonusClaimed) { const wall = d.walls.reduce((closest, item) => Math.abs(item.position.x - groupX) < Math.abs(closest.position.x - groupX) ? item : closest); obstacleHit(ob, wall.position.x); }
      }
    }
    if (runZ < ob.position.z - 6) ob.visible = false;
  }
  const progress = clamp((4 - runZ) / levelData.trackLength, 0, 1); setProgress(progress);
  if (progress > .86 && !finaleWarned) { finaleWarned = true; sound('ready'); haptic(18); }
  runnerRim.position.set(groupX - 3, 4.5, runZ + 2);
  const speedBob = Math.sin(t * 4.2) * .045; camera.position.x = lerp(camera.position.x, groupX * .34, 1 - Math.exp(-dt * 3.5)); camera.position.z = runZ + 14 + cameraImpulse; camera.position.y = 8.65 + speedBob; camera.lookAt(groupX * .28, .15, runZ - 8.5);
  cameraImpulse = lerp(cameraImpulse, 0, 1 - Math.exp(-dt * 7)); growthWave = Math.max(0, growthWave - dt);
  if (runZ <= levelData.finishZ) beginAim();
}

function beginAim() {
  state = nextState(state, 'FINISH_RUN'); shell.dataset.state = 'aiming'; runZ = levelData.finishZ - 12; targetX = groupX = 0; pointer = { ...pointer, down: false, id: null, moved: false, aimX: 0, aimY: .2 }; towerPlane.constant = -levelData.towerZ;
  const maxY = (levelData.tower.rows - 1) * .93 + .4;
  setAimTarget(new THREE.Vector3(0, maxY * .28, levelData.towerZ)); updateAimUI(); updateBallInstances(0); $('#aim-ui').classList.add('active'); $('#destruction-ui').classList.remove('active'); setProgress(1);
  showCallout('AIM & SMASH!', `${ballCount} BALL VOLLEY`, 'anticipation'); sound('ready'); haptic([25, 30, 25]); track('finale_ready', { balls: ballCount });
}

function fireVolley() {
  if (fired || state !== 'aiming') return; fired = true; state = nextState(state, 'FIRE'); shell.dataset.state = 'firing'; $('#aim-ui').classList.remove('active'); $('#destruction-ui').classList.add('active'); ballMesh.count = 0;
  const maxX = (levelData.tower.cols - 1) * .71 + .5, maxY = (levelData.tower.rows - 1) * .93 + .4;
  const potential = destructionPotential({ balls: ballCount, aimX: aimTarget.x, aimY: aimTarget.y, maxX, maxY });
  destructionLimit = Math.max(1, Math.floor(blocks.length * potential / 100));
  const visualCount = Math.min(220, ballCount, Math.max(45, Math.ceil(Math.sqrt(ballCount) * 10)));
  for (let i = 0; i < visualCount; i++) {
    const position = new THREE.Vector3((Math.random() - .5) * 2.2, .3 + Math.random() * .8, runZ + 1 + (Math.random() - .5) * 1.6);
    const flightTime = .62 + Math.random() * .13, target = aimTarget.clone(); target.x += (Math.random() - .5) * .5; target.y += (Math.random() - .5) * .42; target.z += (Math.random() - .5) * .34;
    const vel = target.sub(position).divideScalar(flightTime); vel.y += 3.4 * flightTime; shots.push({ position, rotation:0, userData:{ vel, life:0, damage:Math.max(1, ballCount / visualCount), scale:.82 + (i % 5) * .035 } });
  }
  updateShotInstances();
  finishTimer = 0; sound('launch'); haptic(70); shake = .2; cameraImpulse = .35; showCallout('VOLLEY AWAY!', `${ballCount} BALLS`, 'impact'); track('volley_fired', { balls: ballCount });
}

function hitBlock(block, shot) {
  if (!block.userData.alive || destroyed >= destructionLimit) return; block.userData.alive = false; destroyed++;
  const now = performance.now(); combo = now - lastDestroyAt < 450 ? combo + 1 : 1; lastDestroyAt = now; maxCombo = Math.max(maxCombo, combo);
  const incoming = shot?.userData?.vel || new THREE.Vector3(0, 2, -4); block.userData.vel.copy(incoming).multiplyScalar(.11 + Math.random() * .06); block.userData.vel.y += 3.4 + Math.random() * 3.2; block.userData.vel.x += (Math.random() - .5) * 3.6; block.userData.vel.z += (Math.random() - .5) * 2.4;
  burst(block.position.clone(), block.material.color.getHex(), 5); dust(block.position.clone(), combo > 7 ? 8 : 4);
  targetDestroy = destroyed / blocks.length * 100; shake = Math.min(.62, shake + .055 + combo * .003); cameraImpulse = Math.min(.5, cameraImpulse + .05); sound(combo > 6 ? 'crush' : 'pop');
  if (combo === 1 && destroyed === 1) showCallout('NICE HIT!', 'DIRECT IMPACT', 'impact');
  if (combo === 5) showCallout('CHAIN REACTION!', '×5 COMBO', 'chain');
  if (combo === 10) { showCallout('MEGA CRUSH!', '×10 COMBO', 'mega'); slowMo = .22; haptic([38, 20, 60]); }
  if (targetDestroy >= 95 && !towerGroup.userData.totalCalled) { towerGroup.userData.totalCalled = true; showCallout('TOTAL DESTRUCTION!', 'TOWER OBLITERATED', 'mega'); slowMo = .28; }
  if (targetDestroy >= 99.5) celebratePerfect();
  if (!towerGroup.userData.skillCascade) {
    towerGroup.userData.skillCascade = true;
    const cascadeCount = Math.max(0, destructionLimit - destroyed);
    blocks.filter(b => b.userData.alive).sort((a, b) => {
      const score = item => Math.hypot(item.position.x - aimTarget.x, (item.position.y - aimTarget.y) * .72, (item.position.z - aimTarget.z) * .55);
      return score(a) - score(b);
    }).slice(0, cascadeCount).forEach((b, index) => {
      b.userData.delay = .12 + Math.random() * .35 + index / Math.max(1, cascadeCount) * 1.15;
      b.userData.chainFrom = shot;
    });
  }
  const hitPower = Math.max(1, shot?.userData?.damage || 1), blastRadius = 1.6 + Math.min(1.3, Math.log2(hitPower + 1) * .28), blastChance = Math.min(.72, .12 + combo * .014 + Math.log2(hitPower + 1) * .1);
  blocks.forEach(b => {
    if (!b.userData.alive || b.userData.delay > 0) return;
    const dx = Math.abs(b.position.x - block.position.x), dz = Math.abs(b.position.z - block.position.z), dy = b.position.y - block.position.y;
    const directlyAbove = dy > .35 && dy < 1.35 && dx < 1.05 && dz < .95;
    const shockNeighbor = b.position.distanceTo(block.position) < blastRadius && Math.random() < blastChance;
    if (directlyAbove || shockNeighbor) { b.userData.delay = .05 + Math.random() * .16; b.userData.chainFrom = shot; }
  });
}

function updateFinale(dt) {
  finishTimer += dt; camera.position.x = lerp(camera.position.x, Math.sin(finishTimer * .6) * .45, 1 - Math.exp(-dt * 2)); camera.position.y = lerp(camera.position.y, 7.6 - Math.min(1, targetDestroy / 100), 1 - Math.exp(-dt * 2)); camera.position.z = lerp(camera.position.z, levelData.finishZ - 1.3 + cameraImpulse, 1 - Math.exp(-dt * 2)); camera.lookAt(0, 2.8, levelData.towerZ); cameraImpulse = lerp(cameraImpulse, 0, 1 - Math.exp(-dt * 6));
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]; s.userData.life += dt; s.userData.vel.y -= 6.8 * dt; s.position.addScaledVector(s.userData.vel, dt); s.rotation += dt * 9;
    let hit = null;
    if (s.position.z < levelData.towerZ + 4.8 && s.position.z > levelData.towerZ - 4.5) {
      let nearestDistanceSq = 2.0164;
      for (const b of blocks) {
        if (!b.userData.alive) continue;
        const distanceSq = s.position.distanceToSquared(b.position);
        if (distanceSq < nearestDistanceSq) { nearestDistanceSq = distanceSq; hit = b; }
      }
    }
    if (hit) { hitBlock(hit, s); shots.splice(i, 1); continue; }
    if (s.position.y < -.5 || s.userData.life > 5) shots.splice(i, 1);
  }
  updateShotInstances();
  for (const b of blocks) {
    if (destroyed < destructionLimit && b.userData.delay > 0) { b.userData.delay -= dt; if (b.userData.delay <= 0) hitBlock(b, b.userData.chainFrom); }
    if (destroyed < destructionLimit && b.userData.alive && b.position.y > .6 && b.userData.delay <= 0) {
      const supported = blocks.some(s => s !== b && s.userData.alive && s.position.y < b.position.y && b.position.y - s.position.y < 1.18 && Math.abs(s.position.x - b.position.x) < .82 && Math.abs(s.position.z - b.position.z) < .92);
      b.userData.unsupported = supported ? 0 : b.userData.unsupported + dt;
      if (b.userData.unsupported > .14) hitBlock(b, { userData: { vel: new THREE.Vector3((Math.random() - .5) * 2, 1, -1) } });
    }
    if (!b.userData.alive) { b.userData.vel.y -= 12 * dt; b.position.addScaledVector(b.userData.vel, dt); b.rotation.x += b.userData.vel.z * dt; b.rotation.z += b.userData.vel.x * dt; if (b.position.y < -.25) { b.position.y = -.25; b.userData.vel.y *= -.25; b.userData.vel.multiplyScalar(.91); } }
  }
  displayedDestroy = lerp(displayedDestroy, targetDestroy, 1 - Math.exp(-dt * 7)); const displayPct = Math.round(displayedDestroy); $('#destroy-percent').textContent = `${displayPct}%`; $('#destroy-fill').style.width = `${displayedDestroy}%`;
  const quiet = performance.now() - lastDestroyAt > 900;
  if (state === 'firing' && finishTimer > 3 && shots.length === 0 && quiet) finishLevel();
}

function finishLevel() {
  state = nextState(state, 'SETTLED'); const pct = Math.round(destroyed / blocks.length * 100); const score = scoreRun({ balls: ballCount, destroyed: pct, combo: maxCombo, level: levelData.level }); const coins = coinsFor({ destroyed: pct, score });
  save.coins += coins; save.best = Math.max(save.best, score); save.level = Math.max(save.level, levelData.level + 1); persist();
  $('#result-title').textContent = pct >= 100 ? 'PERFECT SMASH!' : pct > 85 ? 'TOTAL MAYHEM!' : pct > 55 ? 'CRUSHED IT!' : 'NICE HIT!'; $('#result-destroy').textContent = `${pct}%`; $('#result-balls').textContent = ballCount; $('#result-coins').textContent = coins; $('#result-score').textContent = score.toLocaleString(); $('#result-ring').style.setProperty('--pct', pct);
  setTimeout(() => setState('results'), 450); sound('victory'); haptic([60, 50, 80]); track('level_complete', { level: levelData.level, score, destruction: pct, coins });
}

function particleMaterial(color) {
  if (!particleMaterials.has(color)) particleMaterials.set(color, keepMaterial(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false })));
  return particleMaterials.get(color);
}

function acquireParticle(material, geometry = particleGeo) {
  if (particles.length >= particleLimit) return null;
  const particle = particlePool.pop() || { position:new THREE.Vector3(), scale:1, rotation:0, material, geometry, userData:{ vel:new THREE.Vector3(), life:0, maxLife:1, startScale:1 } }; particle.material = material; particle.geometry = geometry; particle.rotation = Math.random() * Math.PI; return particle;
}

function getParticleBatch(particle) {
  const key = `${particle.geometry.uuid}:${particle.material.uuid}`; let batch = particleBatches.get(key);
  if (!batch) { const mesh = new THREE.InstancedMesh(particle.geometry, particle.material, 240); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; world.add(mesh); batch = { mesh, count:0 }; particleBatches.set(key,batch); }
  return batch;
}

function renderParticles() {
  particleBatches.forEach(batch => { batch.count = 0; batch.mesh.count = 0; });
  for (const particle of particles) { const batch = getParticleBatch(particle), index = batch.count++; dummy.position.copy(particle.position); dummy.scale.setScalar(particle.scale); dummy.rotation.set(particle.rotation,particle.rotation*.7,0); dummy.updateMatrix(); batch.mesh.setMatrixAt(index,dummy.matrix); }
  particleBatches.forEach(batch => { batch.mesh.count = batch.count; if (batch.count) batch.mesh.instanceMatrix.needsUpdate = true; });
}

function burst(position, color, amount = 10) {
  const total = Math.max(2, Math.floor(amount * effectScale)), material = particleMaterial(color);
  for (let i = 0; i < total; i++) { const particle = acquireParticle(material); if (!particle) break; particle.position.copy(position); particle.userData.vel.set((Math.random() - .5) * 6, Math.random() * 5, (Math.random() - .5) * 6); particle.userData.life = particle.userData.maxLife = .55 + Math.random() * .45; particle.userData.startScale = .55 + Math.random() * .75; particle.scale = particle.userData.startScale; particles.push(particle); }
}

function dust(position, amount = 6) {
  const total = Math.max(2, Math.floor(amount * effectScale));
  for (let i = 0; i < total; i++) { const particle = acquireParticle(dustMat); if (!particle) break; particle.position.copy(position); particle.userData.vel.set((Math.random() - .5) * 2.8, .7 + Math.random() * 2.1, (Math.random() - .5) * 2.8); particle.userData.life = particle.userData.maxLife = .55 + Math.random() * .45; particle.userData.startScale = 1.2 + Math.random() * 1.4; particle.scale = particle.userData.startScale; particles.push(particle); }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.userData.life -= dt; p.userData.vel.y -= (p.material === dustMat ? 1.2 : 8) * dt; p.position.addScaledVector(p.userData.vel, dt); p.rotation += dt * 5; const ratio = clamp(p.userData.life / p.userData.maxLife, 0, 1); p.scale = p.userData.startScale * ratio; if (p.userData.life <= 0) { particles.splice(i, 1); if (particlePool.length < particleLimit) particlePool.push(p); } }
  renderParticles();
}

function showToast(text, good = true) { const el = $('#toast'); el.textContent = text; el.className = `toast show ${good ? 'good' : 'bad'}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => el.classList.remove('show'), 700); }
function showCallout(title, subtitle = '', style = 'impact') { const el = $('#combo-callout'); el.querySelector('b').textContent = title; el.querySelector('span').textContent = subtitle; el.className = `combo-callout show ${style}`; clearTimeout(showCallout.timer); showCallout.timer = setTimeout(() => el.classList.remove('show'), 1050); const flash = $('#impact-flash'); flash.classList.add('show'); setTimeout(() => flash.classList.remove('show'), 110); }
function celebratePerfect() {
  if (perfectCelebrated) return; perfectCelebrated = true; const layer = $('#confetti-layer'); const colors = ['#ffe44d','#ff4b9f','#5cf5ff','#7bffbd','#8b62ff','#ffffff'];
  for (let i = 0; i < Math.round(92 * effectScale); i++) {
    const piece = document.createElement('i'); piece.className = `confetti-piece ${i % 5 === 0 ? 'round' : i % 4 === 0 ? 'ribbon' : ''}`;
    piece.style.setProperty('--color', colors[i % colors.length]); piece.style.setProperty('--x', `${(Math.random() - .5) * 520}px`); piece.style.setProperty('--drift', `${(Math.random() - .5) * 150}px`); piece.style.setProperty('--rise', `${90 + Math.random() * 240}px`); piece.style.setProperty('--fall', `${Math.random() * 180}px`); piece.style.setProperty('--spin', `${(Math.random() > .5 ? 1 : -1) * (540 + Math.random() * 1080)}deg`); piece.style.setProperty('--duration', `${1.45 + Math.random() * 1.15}s`); piece.style.animationDelay = `${Math.random() * .28}s`; layer.append(piece); setTimeout(() => piece.remove(), 3100);
  }
  showCallout('PERFECT!', '100% DESTRUCTION', 'mega'); haptic([80,35,80,35,140]); sound('victory'); shake = .72; slowMo = .4;
}
function setProgress(p) { const pct = p * 100; $('#progress-fill').style.width = `${pct}%`; $('#progress-dot').style.left = `${pct}%`; }
function updateHud() { $('#ball-count').textContent = ballCount; $('#hud-level').textContent = levelData?.level || save.level; }
function updateMenu() { $('#menu-level').textContent = save.level; $('#menu-coins').textContent = save.coins; $('#menu-best').textContent = save.best.toLocaleString(); $('#shop-coins').textContent = save.coins; updateSettings(); }
function setState(next) { state = next; shell.dataset.state = next; Object.values(ui).forEach(x => x.classList.remove('active')); if (ui[next]) ui[next].classList.add('active'); if (['running','aiming','firing'].includes(next)) ui.hud.classList.add('active'); const hideLevel = ['menu','shop','settings'].includes(next); if (runGroup) runGroup.visible = !hideLevel; if (towerGroup) towerGroup.visible = !hideLevel; if (next === 'menu') updateMenu(); }

function renderShop() {
  const list = $('#cosmetic-list'); list.innerHTML = '';
  COSMETICS.forEach(item => { const owned = save.owned.includes(item.id), selected = save.selected === item.id; const row = document.createElement('div'); row.className = `cosmetic ${selected ? 'selected' : ''}`;
    row.innerHTML = `<div class="swatch" style="background:linear-gradient(135deg,${item.colors.join(',')})"></div><div><h3>${item.name}</h3><p>${owned ? 'UNLOCKED' : 'COSMETIC ONLY'}</p></div><button class="buy-btn" ${!owned && save.coins < item.price ? 'disabled' : ''}>${selected ? 'EQUIPPED' : owned ? 'USE' : `● ${item.price}`}</button>`;
    row.querySelector('button').onclick = () => { if (selected) return; if (!owned) { if (save.coins < item.price) return; save.coins -= item.price; save.owned.push(item.id); sound('coin'); haptic(35); } save.selected = item.id; persist(); cosmeticMaterial(); renderShop(); $('#shop-coins').textContent = save.coins; track('cosmetic_selected', { id: item.id }); }; list.append(row);
  });
}

let audioCtx;
function sound(type) { if (save.muted) return; audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); const t = audioCtx.currentTime; const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(); const types = { gate:[520,920,.14,'sine'],multiply:[290,1180,.28,'triangle'],hit:[135,62,.2,'sawtooth'],ready:[320,590,.24,'triangle'],launch:[170,540,.34,'sawtooth'],pop:[235,145,.085,'square'],crush:[105,48,.2,'sawtooth'],coin:[820,1320,.13,'sine'],victory:[440,940,.58,'triangle'] }; const p = types[type] || types.pop; osc.type = p[3]; osc.detune.value = (Math.random() - .5) * (type === 'pop' ? 90 : 35); osc.frequency.setValueAtTime(p[0],t); osc.frequency.exponentialRampToValueAtTime(p[1],t+p[2]); gain.gain.setValueAtTime(.0001,t); gain.gain.exponentialRampToValueAtTime(type==='hit'||type==='crush'?.12:.072,t+.01); gain.gain.exponentialRampToValueAtTime(.0001,t+p[2]); osc.connect(gain).connect(audioCtx.destination); osc.start(t); osc.stop(t+p[2]+.02); }
const haptic = pattern => { if (save.haptics !== false) navigator.vibrate?.(pattern); };
function updateSettings() { $('#sound-setting b').textContent = save.muted ? 'OFF' : 'ON'; $('#haptics-setting b').textContent = save.haptics === false ? 'OFF' : 'ON'; const label = save.graphics === 'auto' ? `AUTO·${quality.toUpperCase().slice(0,3)}` : quality.toUpperCase(); $('#graphics-setting b').textContent = label; }

function pointerPos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 2 - 1, y: -((e.clientY - r.top) / r.height * 2 - 1) }; }
function setAimTarget(point) {
  const maxX = (levelData.tower.cols - 1) * .71 + .5, maxY = (levelData.tower.rows - 1) * .93 + .4;
  point.x = clamp(point.x, -maxX, maxX); point.y = clamp(point.y, .35, maxY); point.z = levelData.towerZ;
  aimTarget.copy(point); pointer.aimX = aimTarget.x / Math.max(1, maxX); pointer.aimY = aimTarget.y / Math.max(1, maxY);
}
function updateAimFromPointer(p) {
  aimPointer.set(p.x,p.y); aimRaycaster.setFromCamera(aimPointer, camera);
  if (aimRaycaster.ray.intersectPlane(towerPlane, aimWorldPoint)) setAimTarget(aimWorldPoint);
  updateAimUI();
}
function updateAimUI() {
  const reticle = $('#aim-reticle'), arrow = $('.aim-arrow'); if (!reticle) return;
  const screen = aimTarget.clone().project(camera); reticle.style.left = `${clamp((screen.x + 1) * 50, 8, 92)}%`; reticle.style.top = `${clamp((1 - screen.y) * 50, 17, 67)}%`;
  if (arrow) arrow.style.transform = `translateX(${pointer.aimX * 34}px) rotate(${pointer.aimX * 18}deg)`;
}
shell.addEventListener('pointerdown', e => {
  if (!['running','aiming'].includes(state) || e.target.closest?.('button')) return;
  e.preventDefault(); shell.setPointerCapture?.(e.pointerId); const p = pointerPos(e);
  pointer = { ...pointer, down:true, id:e.pointerId, moved:false, x:p.x, y:p.y, startX:p.x, startY:p.y };
  if (state === 'aiming') { $('#aim-reticle').classList.add('dragging'); updateAimFromPointer(p); }
  sound('pop');
});
shell.addEventListener('pointermove', e => {
  if (!pointer.down || (pointer.id !== null && e.pointerId !== pointer.id)) return;
  e.preventDefault(); const p = pointerPos(e), dx = p.x - pointer.x, totalX = p.x - pointer.startX, totalY = p.y - pointer.startY;
  pointer.x = p.x; pointer.y = p.y; pointer.moved ||= Math.hypot(totalX, totalY) > .035;
  if (state === 'running') targetX = clamp(targetX + dx * 6.35, -4.1, 4.1);
  if (state === 'aiming') updateAimFromPointer(p);
});
shell.addEventListener('pointerup', e => {
  if (!pointer.down || (pointer.id !== null && e.pointerId !== pointer.id)) return;
  e.preventDefault(); pointer.down = false; pointer.id = null; $('#aim-reticle').classList.remove('dragging');
});
shell.addEventListener('pointercancel', () => { pointer.down = false; pointer.id = null; $('#aim-reticle').classList.remove('dragging'); });
window.addEventListener('keydown', e => { if (state === 'running') { if (e.key === 'ArrowLeft' || e.key === 'a') targetX -= 1.2; if (e.key === 'ArrowRight' || e.key === 'd') targetX += 1.2; } if (state === 'aiming' && e.key === ' ') fireVolley(); });

$('#play-btn').onclick = () => { track('play_clicked', { level:save.level }); createLevel(save.level); };
$('#launch-btn').onclick = () => { if (state === 'aiming') fireVolley(); };
$('#pause-btn').onclick = () => { if (state === 'running') { state = nextState(state,'PAUSE'); setState('pause'); } };
$('#resume-btn').onclick = () => { state = nextState(state,'RESUME'); setState('running'); };
$('#shop-btn').onclick = () => { renderShop(); setState('shop'); }; $('#close-shop').onclick = () => setState('menu');
$('#settings-btn').onclick = () => setState('settings'); $('#close-settings').onclick = () => setState('menu');
$('#sound-setting').onclick = () => { save.muted = !save.muted; persist(); updateSettings(); if (!save.muted) sound('coin'); };
$('#haptics-setting').onclick = () => { save.haptics = save.haptics === false; persist(); updateSettings(); haptic(28); };
$('#graphics-setting').onclick = () => { const modes = ['auto','high','medium','low'], next = modes[(modes.indexOf(save.graphics) + 1) % modes.length]; save.graphics = next; persist(); applyQuality(next === 'auto' ? detectedQuality : next); haptic(20); };
$('#next-btn').onclick = () => createLevel(levelData.level + 1); $('#replay-btn').onclick = () => createLevel(levelData.level, true); $$('[data-home]').forEach(b => b.onclick = () => setState('menu'));
$('#share-btn').onclick = async () => { const pct = Math.round(destroyed / blocks.length * 100); const text = `I destroyed ${pct}% of the tower on level ${levelData.level} in CHAIN RUSH. Can you beat me?`; try { if (navigator.share) await navigator.share({ title:'CHAIN RUSH', text, url:location.href }); else { await navigator.clipboard.writeText(`${text} ${location.href}`); showToast('COPIED!', true); } } catch {} };

function resize() { const w = shell.clientWidth, h = shell.clientHeight; renderer.setSize(w,h,false); camera.aspect = w/h; camera.fov = h/w > 1.9 ? 58 : 54; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

document.addEventListener('visibilitychange', () => { isPageVisible = !document.hidden; if (!isPageVisible) { if (state === 'running') setState('pause'); audioCtx?.suspend?.(); } else { clock.getDelta(); if (!save.muted) audioCtx?.resume?.(); } });
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); track('game_error', { type:'webgl_context_lost' }); isPageVisible = false; const loading = $('#loading-screen'); loading.hidden = false; loading.classList.remove('ready'); loading.classList.add('context-lost'); $('#loading-status').textContent = 'RESTORING GRAPHICS'; });
canvas.addEventListener('webglcontextrestored', () => { isPageVisible = true; applyQuality(quality); $('#loading-screen').classList.remove('context-lost'); hideLoading(); clock.getDelta(); });

function animate(rafTime = 0) {
  requestAnimationFrame(animate); if (!isPageVisible) return; const passive = ['menu','shop','settings','results','pause'].includes(state); if (passive && rafTime - lastRenderAt < 33) return; lastRenderAt = rafTime; const realDt = Math.min(.033, clock.getDelta()), t = clock.elapsedTime; if (slowMo > 0) slowMo = Math.max(0, slowMo - realDt); const dt = realDt * (slowMo > 0 ? .3 : 1);
  if (state === 'running') updateRun(dt, t); else if (state === 'aiming') { updateBallInstances(t); camera.position.z = lerp(camera.position.z, levelData.finishZ - .5, dt * 2); camera.position.y = lerp(camera.position.y, 8.2, dt * 2); camera.position.x = lerp(camera.position.x, 0, dt * 2); camera.lookAt(0, 2.8, levelData.towerZ); updateAimUI(); } else if (state === 'firing') updateFinale(dt);
  if (state === 'menu') { camera.position.x = Math.sin(t*.25)*3.5; camera.position.y = 9 + Math.sin(t*.4)*.4; camera.position.z = 17; camera.lookAt(0,0,-15); }
  for (const child of deco.children) if (child.userData.baseY !== undefined) { child.position.y = child.userData.baseY + Math.sin(t * .55 + child.userData.float) * .35; child.rotation.z += realDt * .08; }
  updateParticles(dt); if (shake > 0) { const s = shake * .18; camera.position.x += (Math.random()-.5)*s; camera.position.y += (Math.random()-.5)*s; shake = Math.max(0, shake-dt*1.7); }
  renderer.render(scene,camera);
  if (!firstFrameRendered) { firstFrameRendered = true; shell.dataset.bootMs = Math.round(performance.now() - bootStartedAt); hideLoading(); }
  frameMetrics.elapsed += realDt; frameMetrics.frames++; frameMetrics.samples.push(realDt * 1000); if (frameMetrics.samples.length > 240) frameMetrics.samples.shift();
  if (frameMetrics.elapsed >= 2) { const measuredFps = Math.round(frameMetrics.frames / frameMetrics.elapsed), sorted = [...frameMetrics.samples].sort((a,b) => a-b); shell.dataset.fps = measuredFps; shell.dataset.frameP95 = (sorted[Math.floor(sorted.length * .95)] || 0).toFixed(1); shell.dataset.frameMax = Math.max(...frameMetrics.samples, 0).toFixed(1); shell.dataset.drawCalls = renderer.info.render.calls; shell.dataset.triangles = renderer.info.render.triangles; if (save.graphics === 'auto' && state === 'running') { autoTuneElapsed += frameMetrics.elapsed; autoTuneFrames += frameMetrics.frames; if (autoTuneElapsed >= 6) { const average = autoTuneFrames / autoTuneElapsed; if (average < 44 && quality !== 'low') { const from = quality, to = quality === 'high' ? 'medium' : 'low'; applyQuality(to); analytics.reportPerformance({ fps:average, quality:from, issue:`auto_downgrade_to_${to}` }); } autoTuneElapsed = 0; autoTuneFrames = 0; } } frameMetrics.elapsed = 0; frameMetrics.frames = 0; }
}

$('#loading-status').textContent = 'BUILDING SCENE'; createEnvironment(); runGroup = new THREE.Group(); world.add(runGroup); levelData = makeLevel(save.level); ballCount = levelData.startBalls; cosmeticMaterial(); updateMenu(); setState('menu'); applyQuality(quality); renderer.render(scene,camera); firstFrameRendered = true; shell.dataset.bootMs = Math.round(performance.now() - bootStartedAt); analytics.reportLoad(Number(shell.dataset.bootMs)); hideLoading(); animate();
