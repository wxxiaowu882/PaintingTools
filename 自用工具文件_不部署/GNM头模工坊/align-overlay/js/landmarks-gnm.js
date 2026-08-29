/**
 * Heuristic Farkas-like landmarks on GNM neutral skin (component_id === 0).
 * positions: Float32Array xyz; componentId: Uint8Array|similar
 */

function bboxOf(positions, n, mask) {
  let minX = 1e9,
    minY = 1e9,
    minZ = 1e9,
    maxX = -1e9,
    maxY = -1e9,
    maxZ = -1e9,
    c = 0;
  for (let i = 0; i < n; i++) {
    if (!mask(i)) continue;
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
    c++;
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    w: maxX - minX,
    h: maxY - minY,
    d: maxZ - minZ,
    c,
  };
}

function argBest(positions, n, mask, scoreFn) {
  let best = -1;
  let bestS = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!mask(i)) continue;
    const s = scoreFn(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], i);
    if (s > bestS) {
      bestS = s;
      best = i;
    }
  }
  if (best < 0) return null;
  return [positions[best * 3], positions[best * 3 + 1], positions[best * 3 + 2]];
}

function pt(positions, i) {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

/**
 * Core ids used for Umeyama (skip unstable trichion / tragion / opisthocranion by default).
 * Weights emphasize mid-face width & jaw.
 */
export const ALIGN_CORE_IDS = [
  'glabella',
  'nasion',
  'pronasale',
  'subnasale',
  'endocanthion_L',
  'endocanthion_R',
  'exocanthion_L',
  'exocanthion_R',
  'alare_L',
  'alare_R',
  'zygion_L',
  'zygion_R',
  'gonion_L',
  'gonion_R',
  'pogonion',
  // gnathion：euro_morph_rest 该点可疑，本轮不参与拟合（仍可在全量采样里看见）
  'vertex',
];

export const ALIGN_WEIGHTS = {
  glabella: 1.2,
  nasion: 1.0,
  pronasale: 1.4,
  subnasale: 1.1,
  endocanthion_L: 1.3,
  endocanthion_R: 1.3,
  exocanthion_L: 1.3,
  exocanthion_R: 1.3,
  alare_L: 0.9,
  alare_R: 0.9,
  zygion_L: 1.5,
  zygion_R: 1.5,
  gonion_L: 1.5,
  gonion_R: 1.5,
  pogonion: 0.5,
  gnathion: 0.25,
  vertex: 0.8,
};

/** Farkas id → 中文显示名（与 compare_review/farkas_core 一致） */
export const LANDMARK_ZH = {
  trichion: '发际中',
  glabella: '眉心',
  nasion: '鼻根',
  subnasale: '鼻底',
  pronasale: '鼻尖',
  endocanthion_L: '内眼角L',
  endocanthion_R: '内眼角R',
  exocanthion_L: '外眼角L',
  exocanthion_R: '外眼角R',
  alare_L: '鼻翼L',
  alare_R: '鼻翼R',
  cheilion_L: '口角L',
  cheilion_R: '口角R',
  zygion_L: '颧突L',
  zygion_R: '颧突R',
  gonion_L: '下颌角L',
  gonion_R: '下颌角R',
  gnathion: '颏下',
  pogonion: '颏前',
  tragion: '耳屏',
  tragion_L: '耳屏L',
  tragion_R: '耳屏R',
  otobasion: '耳垂附',
  opisthocranion: '枕突',
  vertex: '颅顶',
};

export function landmarkLabel(id) {
  return LANDMARK_ZH[id] || id;
}

/**
 * @returns {{ points: Record<string, number[]>, bbox: object }}
 */
export function sampleGnmFarkasLandmarks(positions, componentId) {
  const n = positions.length / 3;
  const skin = (i) => componentId[i] === 0;
  const b = bboxOf(positions, n, skin);
  const midX = (x) => Math.abs(x) < b.w * 0.06;
  const yFrac = (y) => (y - b.minY) / (b.h || 1);
  const zFrac = (z) => (z - b.minZ) / (b.d || 1);

  const points = {};

  points.vertex = argBest(positions, n, skin, (x, y, z) => y + (midX(x) ? 0.02 : 0));

  points.trichion = argBest(
    positions,
    n,
    (i) => skin(i) && yFrac(positions[i * 3 + 1]) > 0.82 && zFrac(positions[i * 3 + 2]) > 0.35,
    (x, y, z) => z - Math.abs(x) * 2
  );

  points.glabella = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      const z = zFrac(positions[i * 3 + 2]);
      return skin(i) && midX(positions[i * 3]) && y > 0.62 && y < 0.78 && z > 0.55;
    },
    (x, y, z) => z
  );

  points.nasion = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && midX(positions[i * 3]) && y > 0.55 && y < 0.68 && zFrac(positions[i * 3 + 2]) > 0.55;
    },
    (x, y, z) => -Math.abs(y - (b.minY + b.h * 0.6)) + z * 0.3
  );

  points.pronasale = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && midX(positions[i * 3]) && y > 0.42 && y < 0.58;
    },
    (x, y, z) => z
  );

  points.subnasale = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && midX(positions[i * 3]) && y > 0.36 && y < 0.48 && zFrac(positions[i * 3 + 2]) > 0.5;
    },
    (x, y, z) => z - Math.abs(y - (b.minY + b.h * 0.42)) * 0.5
  );

  // Eye corners: left = -X
  points.endocanthion_L = argBest(
    positions,
    n,
    (i) => {
      const x = positions[i * 3],
        y = yFrac(positions[i * 3 + 1]),
        z = zFrac(positions[i * 3 + 2]);
      return skin(i) && x < 0 && x > -b.w * 0.12 && y > 0.55 && y < 0.7 && z > 0.55;
    },
    (x, y, z) => z - Math.abs(x)
  );
  points.endocanthion_R = argBest(
    positions,
    n,
    (i) => {
      const x = positions[i * 3],
        y = yFrac(positions[i * 3 + 1]),
        z = zFrac(positions[i * 3 + 2]);
      return skin(i) && x > 0 && x < b.w * 0.12 && y > 0.55 && y < 0.7 && z > 0.55;
    },
    (x, y, z) => z - Math.abs(x)
  );

  points.exocanthion_L = argBest(
    positions,
    n,
    (i) => {
      const x = positions[i * 3],
        y = yFrac(positions[i * 3 + 1]),
        z = zFrac(positions[i * 3 + 2]);
      return skin(i) && x < -b.w * 0.12 && x > -b.w * 0.28 && y > 0.52 && y < 0.72 && z > 0.4;
    },
    (x, y, z) => -x + z * 0.3
  );
  points.exocanthion_R = argBest(
    positions,
    n,
    (i) => {
      const x = positions[i * 3],
        y = yFrac(positions[i * 3 + 1]),
        z = zFrac(positions[i * 3 + 2]);
      return skin(i) && x > b.w * 0.12 && x < b.w * 0.28 && y > 0.52 && y < 0.72 && z > 0.4;
    },
    (x, y, z) => x + z * 0.3
  );

  points.alare_L = argBest(
    positions,
    n,
    (i) => {
      const x = positions[i * 3],
        y = yFrac(positions[i * 3 + 1]),
        z = zFrac(positions[i * 3 + 2]);
      return skin(i) && x < 0 && Math.abs(x) < b.w * 0.12 && y > 0.42 && y < 0.55 && z > 0.55;
    },
    (x, y, z) => -x + z * 0.5
  );
  points.alare_R = argBest(
    positions,
    n,
    (i) => {
      const x = positions[i * 3],
        y = yFrac(positions[i * 3 + 1]),
        z = zFrac(positions[i * 3 + 2]);
      return skin(i) && x > 0 && Math.abs(x) < b.w * 0.12 && y > 0.42 && y < 0.55 && z > 0.55;
    },
    (x, y, z) => x + z * 0.5
  );

  points.zygion_L = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && positions[i * 3] < 0 && y > 0.45 && y < 0.65;
    },
    (x, y, z) => -x
  );
  points.zygion_R = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && positions[i * 3] > 0 && y > 0.45 && y < 0.65;
    },
    (x, y, z) => x
  );

  points.gonion_L = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && positions[i * 3] < 0 && y > 0.12 && y < 0.38;
    },
    (x, y, z) => -x - y * 0.2
  );
  points.gonion_R = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && positions[i * 3] > 0 && y > 0.12 && y < 0.38;
    },
    (x, y, z) => x - y * 0.2
  );

  points.pogonion = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      return skin(i) && midX(positions[i * 3]) && y > 0.08 && y < 0.32;
    },
    (x, y, z) => z
  );

  points.gnathion = argBest(
    positions,
    n,
    (i) => skin(i) && midX(positions[i * 3]) && yFrac(positions[i * 3 + 1]) < 0.22,
    (x, y, z) => -y + z * 0.15
  );

  points.tragion_L = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      const z = zFrac(positions[i * 3 + 2]);
      return skin(i) && positions[i * 3] < -b.w * 0.28 && y > 0.45 && y < 0.7 && z < 0.45;
    },
    (x, y, z) => -x - z
  );
  points.tragion_R = argBest(
    positions,
    n,
    (i) => {
      const y = yFrac(positions[i * 3 + 1]);
      const z = zFrac(positions[i * 3 + 2]);
      return skin(i) && positions[i * 3] > b.w * 0.28 && y > 0.45 && y < 0.7 && z < 0.45;
    },
    (x, y, z) => x - z
  );

  points.opisthocranion = argBest(
    positions,
    n,
    (i) => skin(i) && yFrac(positions[i * 3 + 1]) > 0.45 && yFrac(positions[i * 3 + 1]) < 0.85,
    (x, y, z) => -z - Math.abs(x) * 0.2
  );

  // Drop nulls
  for (const k of Object.keys(points)) {
    if (!points[k]) delete points[k];
  }

  return { points, bbox: b };
}

export function pairLandmarks(euroPoints, gnmPoints, ids = ALIGN_CORE_IDS) {
  const src = [];
  const dst = [];
  const used = [];
  const weights = [];
  for (const id of ids) {
    const e = euroPoints[id];
    const g = gnmPoints[id];
    if (!e || !g) continue;
    src.push(e.slice(0, 3));
    dst.push(g.slice(0, 3));
    used.push(id);
    weights.push(ALIGN_WEIGHTS[id] ?? 1);
  }
  return { src, dst, used, weights };
}
