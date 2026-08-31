/**
 * 欧版眼球对齐：GNM 巩膜外接球 ↔ 欧版虹膜/晶状体，相似变换（均匀缩放 + 平移）。
 */
import * as THREE from 'three';
import { applyNormalizePoint } from './procrustes.js';
import { meshHasEuroEyeName } from './euro-render-prep.js?v=20260829-display18';

const EYE_COMPONENT_IDS = new Set([1, 2]);
const GNM_SCLERA_MAT = 4;
const MIN_RADIUS_M = 1e-5;

function sideFromWorldX(x) {
  return x < 0 ? 'L' : 'R';
}

function centroidOf(pts) {
  const center = new THREE.Vector3();
  if (!pts.length) return center;
  for (const p of pts) center.add(p);
  center.divideScalar(pts.length);
  return center;
}

/** 外接球半径：顶点到中心的最大距离 */
function maxRadius(pts, center) {
  let r = 0;
  for (const p of pts) r = Math.max(r, p.distanceTo(center));
  return Math.max(r, MIN_RADIUS_M);
}

function ballFrameFromPoints(pts) {
  const center = centroidOf(pts);
  return { center, radius: maxRadius(pts, center) };
}

function meshSplitX(mesh) {
  const rest = mesh.userData._eyeAlignLocalRest;
  if (!rest?.length) return 0;
  const xs = [];
  for (let i = 0; i < rest.length; i += 3) xs.push(rest[i]);
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] || 0;
}

/**
 * GNM 目标：每眼巩膜 (mat4) 球心 + 外接球半径。
 */
export function sampleGnmEyeFrames(gnmModel, positionsNative, norm) {
  const comp = gnmModel.componentId;
  const mat = gnmModel.materialId;
  const n = gnmModel.numVertices;
  const byComp = new Map();
  for (let i = 0; i < n; i++) {
    if (!EYE_COMPONENT_IDS.has(comp[i])) continue;
    if (mat[i] !== GNM_SCLERA_MAT) continue;
    const cid = comp[i];
    if (!byComp.has(cid)) byComp.set(cid, []);
    const native = [
      positionsNative[i * 3],
      positionsNative[i * 3 + 1],
      positionsNative[i * 3 + 2],
    ];
    const d = applyNormalizePoint(native, norm);
    byComp.get(cid).push(new THREE.Vector3(d[0], d[1], d[2]));
  }
  const frames = {};
  for (const pts of byComp.values()) {
    if (!pts.length) continue;
    const frame = ballFrameFromPoints(pts);
    frames[sideFromWorldX(frame.center.x)] = frame;
  }
  return frames;
}

/**
 * 欧版整球（虹膜 + 晶状体全部顶点）；deformed:true 读变形后几何。
 */
export function sampleEuroEyeFrames(euroRoot, opts = {}) {
  if (!euroRoot) return {};
  const useDeformed = !!opts.deformed;
  euroRoot.updateMatrixWorld(true);
  const bySide = { L: [], R: [] };
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  euroRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    if (obj.userData?._overlayHiddenJunk) return;
    if (!meshHasEuroEyeName(obj)) return;
    const pos = obj.geometry.attributes.position;
    const rest = obj.userData._eyeAlignLocalRest;
    for (let i = 0; i < pos.count; i++) {
      if (useDeformed || !rest?.length) {
        local.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      } else {
        local.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
      }
      world.copy(local).applyMatrix4(obj.matrixWorld);
      bySide[sideFromWorldX(world.x)].push(world.clone());
    }
  });
  const frames = {};
  for (const side of ['L', 'R']) {
    if (!bySide[side].length) continue;
    frames[side] = ballFrameFromPoints(bySide[side]);
  }
  return frames;
}

/** p' = dstCenter + scale * (p - srcCenter) */
export function fitEyeSimilarity(srcCenter, dstCenter, srcRadius, dstRadius) {
  const sr = Math.max(srcRadius, MIN_RADIUS_M);
  const dr = Math.max(dstRadius, MIN_RADIUS_M);
  const scale = dr / sr;
  return {
    scale,
    srcCenter: srcCenter.clone(),
    dstCenter: dstCenter.clone(),
    srcRadius: sr,
    dstRadius: dr,
  };
}

export function transformEyeWorld(world, fit) {
  if (fit?.srcCenter && fit?.dstCenter) {
    const scale = fit.scale ?? 1;
    return fit.dstCenter.clone().add(world.clone().sub(fit.srcCenter).multiplyScalar(scale));
  }
  if (fit?.delta) return world.clone().add(fit.delta);
  return world.clone();
}

function fitsFromSnapshot(snapshot, euroFrames) {
  const fits = {};
  for (const side of ['L', 'R']) {
    const spec = snapshot[side];
    const ef = euroFrames[side];
    if (!spec?.dstCenter || !ef) continue;
    fits[side] = {
      scale: spec.scale ?? 1,
      srcCenter: ef.center.clone(),
      dstCenter: new THREE.Vector3(spec.dstCenter[0], spec.dstCenter[1], spec.dstCenter[2]),
      srcRadius: ef.radius,
      dstRadius: spec.dstRadius ?? ef.radius,
    };
  }
  return fits;
}

export function cacheEuroEyeMeshes(euroRoot) {
  const cache = [];
  if (!euroRoot) return cache;
  euroRoot.updateMatrixWorld(true);
  euroRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    if (obj.userData?._overlayHiddenJunk) return;
    if (!meshHasEuroEyeName(obj)) return;
    const pos = obj.geometry.attributes.position;
    const count = pos.count;
    if (!obj.userData._eyeAlignLocalRest) {
      const local = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        local[i * 3] = pos.getX(i);
        local[i * 3 + 1] = pos.getY(i);
        local[i * 3 + 2] = pos.getZ(i);
      }
      obj.userData._eyeAlignLocalRest = local;
    }
    cache.push({ mesh: obj, count, splitX: meshSplitX(obj) });
  });
  return cache;
}

export function restoreEuroEyeRest(cache) {
  if (!cache?.length) return;
  for (const { mesh, count } of cache) {
    const local = mesh.userData._eyeAlignLocalRest;
    if (!local) continue;
    const attr = mesh.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      attr.setXYZ(i, local[i * 3], local[i * 3 + 1], local[i * 3 + 2]);
    }
    attr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
}

function vertexSideForFit(local, mesh, fits) {
  const v = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(mesh.matrixWorld);
  if (fits.L && fits.R) {
    const dL = v.distanceToSquared(fits.L.dstCenter);
    const dR = v.distanceToSquared(fits.R.dstCenter);
    return dL <= dR ? 'L' : 'R';
  }
  return sideFromWorldX(v.x);
}

function applyFitsToCache(cache, fits) {
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  for (const { mesh, count } of cache) {
    const local = mesh.userData._eyeAlignLocalRest;
    if (!local) continue;
    mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const attr = mesh.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      const side = vertexSideForFit([local[i * 3], local[i * 3 + 1], local[i * 3 + 2]], mesh, fits);
      const fit = fits[side];
      if (!fit) continue;
      v.set(local[i * 3], local[i * 3 + 1], local[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
      w.copy(transformEyeWorld(v, fit)).applyMatrix4(inv);
      attr.setXYZ(i, w.x, w.y, w.z);
    }
    attr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
}

export function applyEuroEyeAlign(cache, snapshot, euroRoot) {
  if (!cache?.length || !snapshot?.L || !snapshot?.R) return { ok: false, reason: 'invalid-snapshot' };
  if (!euroRoot) return { ok: false, reason: 'no-root' };
  restoreEuroEyeRest(cache);
  euroRoot.updateMatrixWorld(true);
  const fits = fitsFromSnapshot(snapshot, sampleEuroEyeFrames(euroRoot));
  applyFitsToCache(cache, fits);
  return { ok: true, fits };
}

export function measureEyeSurfaceGapMm(gnmModel, positionsNative, norm, euroRoot) {
  const gnm = sampleGnmEyeFrames(gnmModel, positionsNative, norm);
  const euro = sampleEuroEyeFrames(euroRoot, { deformed: true });
  const gaps = {};
  for (const side of ['L', 'R']) {
    const g = gnm[side];
    const e = euro[side];
    if (!g || !e) continue;
    gaps[side] = {
      centerDistMm: e.center.distanceTo(g.center) * 1000,
      radiusDiffMm: (e.radius - g.radius) * 1000,
      distMm: e.center.distanceTo(g.center) * 1000,
    };
  }
  return gaps;
}

export function buildEyeAlignSnapshot(gnmFrames, euroFrames) {
  const warnings = [];
  const snapshot = { version: 6, anchor: 'sclera-envelope', L: null, R: null };
  const fits = {};
  const residuals = {};
  const radiusResiduals = {};
  for (const side of ['L', 'R']) {
    const g = gnmFrames[side];
    const e = euroFrames[side];
    if (!g || !e) {
      warnings.push(`缺${side}侧采样`);
      continue;
    }
    const fit = fitEyeSimilarity(e.center, g.center, e.radius, g.radius);
    fits[side] = fit;
    const afterCenter = transformEyeWorld(e.center, fit);
    residuals[side] = afterCenter.distanceTo(g.center) * 1000;
    radiusResiduals[side] = Math.abs(e.radius * fit.scale - g.radius) * 1000;
    snapshot[side] = {
      scale: fit.scale,
      dstCenter: [g.center.x, g.center.y, g.center.z],
      dstRadius: g.radius,
      residualMm: residuals[side],
      residualRadiusMm: radiusResiduals[side],
    };
  }
  if (!snapshot.L || !snapshot.R) {
    return { ok: false, warnings, reason: 'incomplete-frames' };
  }
  snapshot.maxResidualMm = Math.max(residuals.L || 0, residuals.R || 0);
  snapshot.maxRadiusResidualMm = Math.max(radiusResiduals.L || 0, radiusResiduals.R || 0);
  return { ok: true, snapshot, fits, residuals, radiusResiduals, warnings };
}

export function cloneEyeAlignSnapshot(snap) {
  if (!snap) return null;
  const out = {
    version: snap.version || 6,
    anchor: snap.anchor || 'sclera-envelope',
    maxResidualMm: snap.maxResidualMm,
    maxRadiusResidualMm: snap.maxRadiusResidualMm,
  };
  for (const side of ['L', 'R']) {
    const s = snap[side];
    if (!s) continue;
    out[side] = {
      scale: s.scale ?? 1,
      dstCenter: s.dstCenter?.slice(0, 3),
      dstRadius: s.dstRadius,
      residualMm: s.residualMm,
      residualRadiusMm: s.residualRadiusMm,
    };
  }
  return out.L && out.R ? out : null;
}

export function applyEuroEyeAlignFromSnapshot(cache, snapshot, euroRoot) {
  if (!cache?.length || !snapshot?.L || !snapshot?.R) return { ok: false, reason: 'invalid-snapshot' };
  if (!euroRoot) return { ok: false, reason: 'no-root' };
  restoreEuroEyeRest(cache);
  euroRoot.updateMatrixWorld(true);
  const fits = fitsFromSnapshot(snapshot, sampleEuroEyeFrames(euroRoot));
  applyFitsToCache(cache, fits);
  return { ok: true, fits };
}
