export const MAX_BALLS = 5000;

export function applyModifier(count, modifier) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const value = Number(modifier.value) || 0;
  let next = n;
  if (modifier.op === '+') next = n + value;
  if (modifier.op === '-') next = n - value;
  if (modifier.op === 'x') next = n * value;
  if (modifier.op === '/') next = value ? Math.floor(n / value) : n;
  return Math.max(0, Math.min(MAX_BALLS, Math.floor(next)));
}

export function modifierLabel(modifier) {
  const symbols = { x: '×', '/': '÷' };
  return `${symbols[modifier.op] || modifier.op}${modifier.value}`;
}

export function scoreRun({ balls, destroyed, combo, level }) {
  return Math.max(0, Math.floor(balls * 18 + destroyed * 42 + combo * 90 + level * 250));
}

export function coinsFor({ destroyed, score }) {
  return Math.max(5, Math.floor(destroyed * 0.7 + score / 900));
}

export function impactRemovalIndices(points, impact, amount) {
  const take = Math.max(0, Math.min(points.length, Math.floor(amount)));
  return points
    .map((point, index) => ({
      index,
      distance: (point.x - impact.x) ** 2 + (point.z - impact.z) ** 2 * 0.7
    }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, take)
    .map(item => item.index);
}

export function nextState(state, event) {
  const map = {
    menu: { PLAY: 'running', SHOP: 'shop' },
    shop: { CLOSE: 'menu' },
    running: { FINISH_RUN: 'aiming', PAUSE: 'paused', FAIL: 'results' },
    paused: { RESUME: 'running', QUIT: 'menu' },
    aiming: { FIRE: 'firing', QUIT: 'menu' },
    firing: { SETTLED: 'results' },
    results: { NEXT: 'running', REPLAY: 'running', HOME: 'menu' }
  };
  return map[state]?.[event] || state;
}

export function levelTuning(index) {
  const level = Math.max(1, Math.floor(index));
  if (level <= 5) return { speed: 8.8 + (level - 1) * .18, trackLength: 170 + (level - 1) * 6, gateCount: 5, obstacleCount: 4 + Math.floor((level - 1) / 2) };
  if (level <= 15) return { speed: 9.8 + (level - 6) * .12, trackLength: 215 + (level - 6) * 5, gateCount: 6, obstacleCount: 6 + Math.floor((level - 6) / 4) };
  if (level <= 30) return { speed: 10.9 + (level - 16) * .08, trackLength: 275 + (level - 16) * 4, gateCount: 7, obstacleCount: 8 + Math.floor((level - 16) / 6) };
  if (level <= 50) return { speed: 12.1 + (level - 31) * .045, trackLength: 340 + (level - 31) * 2, gateCount: 8, obstacleCount: 10 };
  return { speed: Math.min(13.8, 13 + (level - 51) * .025), trackLength: 390 + Math.min(40, (level - 51) * 1.5), gateCount: 8 + (level % 3 === 0 ? 1 : 0), obstacleCount: 11 };
}

export function destructionPotential({ balls, aimX, aimY, maxX, maxY }) {
  const safeX = Math.max(1, Math.abs(maxX));
  const safeY = Math.max(1, Math.abs(maxY));
  const idealY = safeY * .28;
  const distance = Math.hypot((aimX / safeX) * .82, ((aimY - idealY) / safeY) * 1.08);
  const precision = Math.max(0, 1 - distance);
  const ballPower = Math.min(1, Math.max(0, (Math.max(0, balls) - 20) / 400));
  return Math.round(Math.min(100, Math.max(12, 12 + 88 * precision * ballPower)));
}

function deterministic(level, index, salt = 0) {
  const value = Math.sin(level * 91.17 + index * 47.63 + salt * 13.37) * 43758.5453;
  return value - Math.floor(value);
}

export function makeLevel(index) {
  const level = Math.max(1, Math.floor(index));
  const tuning = levelTuning(level);
  const gateSets = [
    [['+', 25], ['x', 2]], [['+', 50], ['-', 10]], [['x', 3], ['+', 25]],
    [['/', 2], ['+', 50]], [['x', 2], ['+', 10]], [['x', 5], ['-', 10]],
    [['+', 50], ['x', 3]], [['+', 25], ['/', 2]], [['+', 10], ['x', 2]],
    [['-', 10], ['+', 50]], [['x', 3], ['/', 2]], [['+', 25], ['x', 5]]
  ];
  const gates = Array.from({ length: tuning.gateCount }, (_, i) => {
    const distance = 34 + i * (tuning.trackLength - 72) / Math.max(1, tuning.gateCount - 1);
    const pair = gateSets[(level * 3 + i * 5) % gateSets.length];
    const flip = deterministic(level, i, 1) > .5;
    const left = flip ? pair[1] : pair[0], right = flip ? pair[0] : pair[1];
    return { z: 4 - distance, left: { op: left[0], value: left[1] }, right: { op: right[0], value: right[1] } };
  });
  const obstacleTypes = ['movingWall'];
  if (level >= 2) obstacleTypes.push('narrow');
  if (level >= 4) obstacleTypes.push('hammer');
  if (level >= 6) obstacleTypes.push('laser');
  if (level >= 8) obstacleTypes.push('crusher');
  if (level >= 10) obstacleTypes.push('risk');
  const obstacles = Array.from({ length: tuning.obstacleCount }, (_, i) => {
    const distance = 55 + i * (tuning.trackLength - 105) / Math.max(1, tuning.obstacleCount - 1);
    const type = obstacleTypes[(level + i) % obstacleTypes.length];
    return {
      z: 4 - distance,
      type,
      x: (deterministic(level, i, 2) * 2 - 1) * 2.45,
      speed: .72 + Math.min(.9, level * .012) + deterministic(level, i, 3) * .28,
      phase: deterministic(level, i, 4) * Math.PI * 2,
      period: 1.7 + deterministic(level, i, 5) * 1.1,
      bonus: Math.min(50, 12 + level * 2)
    };
  });
  const finishZ = 4 - tuning.trackLength;
  return {
    level,
    startBalls: 12 + ((level - 1) % 5) * 3,
    ...tuning,
    finishZ,
    towerZ: finishZ - 26,
    gates,
    obstacles,
    tower: { rows: 6 + Math.min(4, Math.floor(level / 2)), cols: 5 + (level % 3), layers: 2 + (level % 2) },
    theme: level % 3
  };
}

export const COSMETICS = [
  { id: 'classic', name: 'Classic', price: 0, colors: ['#7c5cff', '#32d9ff'] },
  { id: 'neon', name: 'Neon Pulse', price: 180, colors: ['#00ffc6', '#f7ff00'] },
  { id: 'metal', name: 'Liquid Metal', price: 420, colors: ['#dce8ff', '#7282a8'] },
  { id: 'rainbow', name: 'Rainbow Rush', price: 700, colors: ['#ff4d88', '#ffd84d', '#44e5ff'] },
  { id: 'galaxy', name: 'Deep Galaxy', price: 1100, colors: ['#29106b', '#d445ff', '#39bfff'] }
];
