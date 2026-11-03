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

export function makeLevel(index) {
  const level = Math.max(1, Math.floor(index));
  const gateSets = [
    [['+', 25], ['x', 2]], [['+', 50], ['-', 10]], [['x', 3], ['+', 25]],
    [['/', 2], ['+', 50]], [['x', 2], ['+', 10]], [['x', 5], ['-', 10]],
    [['+', 50], ['x', 3]], [['+', 25], ['/', 2]]
  ];
  const gates = [36, 68, 101, 134, 168].map((z, i) => {
    const pair = gateSets[(level * 3 + i * 5) % gateSets.length];
    return { z: -z, left: { op: pair[0][0], value: pair[0][1] }, right: { op: pair[1][0], value: pair[1][1] } };
  });
  const obstacles = [53, 86, 118, 151, 184].map((z, i) => ({
    z: -z - ((level + i) % 3) * 2,
    type: ['spinner', 'block', 'zone', 'gap'][(level + i) % 4],
    x: (((level * 13 + i * 7) % 5) - 2) * 1.55,
    speed: 0.65 + level * 0.045 + i * 0.06
  }));
  return {
    level,
    startBalls: 12 + ((level - 1) % 5) * 3,
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
