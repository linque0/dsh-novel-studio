// tools/gen-blue-noise.mjs — void-and-cluster 生成 64×64 蓝噪声，输出 ESM 模块（base64 原始字节）。
// 用法：node tools/gen-blue-noise.mjs
// 结果写进 docs/前端美化/书架-流动封面-20261103/blue-noise.js，固定种子，可复现。

import { writeFileSync } from 'node:fs';
import path from 'node:path';

const N = 64;
const COUNT = N * N;
const SIGMA = 1.9;
const RADIUS = 8;
const SEED = 20261103;
const INITIAL_RATIO = 0.1;

const kernel = [];
for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
  for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
    const w = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
    if (w > 1e-4) kernel.push([dx, dy, w]);
  }
}

const at = (x, y) => ((y % N) + N) % N * N + (((x % N) + N) % N);

function makeEnergy(pattern) {
  const energy = new Float64Array(COUNT);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (!pattern[at(x, y)]) continue;
      for (const [dx, dy, w] of kernel) energy[at(x + dx, y + dy)] += w;
    }
  }
  return energy;
}

function add(energy, x, y, sign) {
  for (const [dx, dy, w] of kernel) energy[at(x + dx, y + dy)] += sign * w;
}

function findCluster(energy, pattern) {
  let best = -1, bestValue = -Infinity;
  for (let i = 0; i < COUNT; i += 1) {
    if (pattern[i] && energy[i] > bestValue) { bestValue = energy[i]; best = i; }
  }
  return best;
}

function findVoid(energy, pattern) {
  let best = -1, bestValue = Infinity;
  for (let i = 0; i < COUNT; i += 1) {
    if (!pattern[i] && energy[i] < bestValue) { bestValue = energy[i]; best = i; }
  }
  return best;
}

// —— 1. 随机初始图案，用"移最大簇到最大洞"逼成蓝噪声分布
let seed = SEED;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const pattern = new Uint8Array(COUNT);
const initialOnes = Math.round(COUNT * INITIAL_RATIO);
for (let placed = 0; placed < initialOnes;) {
  const index = Math.floor(random() * COUNT);
  if (!pattern[index]) { pattern[index] = 1; placed += 1; }
}

let energy = makeEnergy(pattern);
for (let step = 0; step < 20000; step += 1) {
  const cluster = findCluster(energy, pattern);
  pattern[cluster] = 0;
  add(energy, cluster % N, Math.floor(cluster / N), -1);
  const voidIndex = findVoid(energy, pattern);
  if (voidIndex === cluster) {
    pattern[cluster] = 1;
    add(energy, cluster % N, Math.floor(cluster / N), 1);
    break;
  }
  pattern[voidIndex] = 1;
  add(energy, voidIndex % N, Math.floor(voidIndex / N), 1);
}

// —— 2. 给每个像素定等级（void-and-cluster 的排序阶段）
const ranks = new Int32Array(COUNT).fill(-1);

let work = Uint8Array.from(pattern);
let workEnergy = makeEnergy(work);
let ones = work.reduce((sum, value) => sum + value, 0);
for (let rank = ones - 1; rank >= 0; rank -= 1) {
  const cluster = findCluster(workEnergy, work);
  ranks[cluster] = rank;
  work[cluster] = 0;
  add(workEnergy, cluster % N, Math.floor(cluster / N), -1);
}

work = Uint8Array.from(pattern);
workEnergy = makeEnergy(work);
for (let rank = ones; rank < COUNT; rank += 1) {
  const voidIndex = findVoid(workEnergy, work);
  ranks[voidIndex] = rank;
  work[voidIndex] = 1;
  add(workEnergy, voidIndex % N, Math.floor(voidIndex / N), 1);
}

// —— 3. 归一化到 0..255 并做基本检查
const bytes = new Uint8Array(COUNT);
for (let i = 0; i < COUNT; i += 1) bytes[i] = Math.round((ranks[i] / (COUNT - 1)) * 255);

const histogram = new Array(16).fill(0);
for (const value of bytes) histogram[Math.min(15, Math.floor(value / 16))] += 1;
const spread = histogram.filter(count => count > 0).length;
let mean = 0;
for (const value of bytes) mean += value;
mean /= COUNT;

const out = path.resolve('docs/前端美化/书架-流动封面-20261103/blue-noise.js');
const base64 = Buffer.from(bytes).toString('base64');
writeFileSync(out, [
  '// blue-noise.js — 64×64 void-and-cluster 蓝噪声（原始 8bit 字节，base64）。',
  '// 由 tools/gen-blue-noise.mjs 生成，种子 ' + SEED + '，勿手改。',
  'export const BLUE_NOISE_SIZE = ' + N + ';',
  'export const BLUE_NOISE_B64 = "' + base64 + '";',
  ''
].join('\n'));

console.log(JSON.stringify({ out, size: N, bytes: COUNT, base64Length: base64.length, spread, mean: Number(mean.toFixed(2)) }));
