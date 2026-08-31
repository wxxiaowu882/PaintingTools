/**
 * 欧版网格 TPS 拧形：按粉黄路标对应关系，将欧版顶点非刚性变形向 GNM 形态靠拢。
 * 算法与 compare_review/bone_morph.js 同源（薄板样条 + 包围盒角点稳定）。
 */
import * as THREE from 'three';
import { shouldSkipEuroWarp } from './euro-render-prep.js?v=20260829-display18';

function thinPlate(r) {
  if (r < 1e-12) return 0;
  return r * r * Math.log(r);
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-14) continue;
    if (piv !== col) {
      const tmp = M[col];
      M[col] = M[piv];
      M[piv] = tmp;
    }
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (Math.abs(f) < 1e-15) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/** Fit 3D TPS: src[i] -> dst[i]. Returns warp(xyz) -> xyz. */
export function fitTps(src, dst, smooth = 1e-4) {
  const n = src.length;
  if (n < 4) {
    return (p) => p.slice();
  }
  const K = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = src[i][0] - src[j][0];
      const dy = src[i][1] - src[j][1];
      const dz = src[i][2] - src[j][2];
      const v = thinPlate(Math.sqrt(dx * dx + dy * dy + dz * dz));
      K[i][j] = v;
      K[j][i] = v;
    }
    K[i][i] = smooth;
  }
  const P = src.map((p) => [1, p[0], p[1], p[2]]);
  const size = n + 4;
  const L = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) L[i][j] = K[i][j];
    for (let j = 0; j < 4; j++) {
      L[i][n + j] = P[i][j];
      L[n + j][i] = P[i][j];
    }
  }
  const W = [[], [], []];
  const A = [[], [], []];
  for (let dim = 0; dim < 3; dim++) {
    const rhs = new Array(size).fill(0);
    for (let i = 0; i < n; i++) rhs[i] = dst[i][dim];
    const coef = solveLinear(L, rhs);
    for (let i = 0; i < n; i++) W[dim][i] = coef[i];
    for (let j = 0; j < 4; j++) A[dim][j] = coef[n + j];
  }

  return function warp(p) {
    let x = A[0][0] + A[0][1] * p[0] + A[0][2] * p[1] + A[0][3] * p[2];
    let y = A[1][0] + A[1][1] * p[0] + A[1][2] * p[1] + A[1][3] * p[2];
    let z = A[2][0] + A[2][1] * p[0] + A[2][2] * p[1] + A[2][3] * p[2];
    for (let i = 0; i < n; i++) {
      const dx = p[0] - src[i][0];
      const dy = p[1] - src[i][1];
      const dz = p[2] - src[i][2];
      const phi = thinPlate(Math.sqrt(dx * dx + dy * dy + dz * dz));
      x += W[0][i] * phi;
      y += W[1][i] * phi;
      z += W[2][i] * phi;
    }
    return [x, y, z];
  };
}

function bboxOf(pts) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function withStabilizers(src, dst) {
  const outSrc = src.map((p) => p.slice());
  const outDst = dst.map((p) => p.slice());
  if (outSrc.length >= 4) {
    const { min, max } = bboxOf(outSrc);
    const corners = [
      [min[0], min[1], min[2]],
      [max[0], min[1], min[2]],
      [min[0], max[1], min[2]],
      [max[0], max[1], min[2]],
      [min[0], min[1], max[2]],
      [max[0], min[1], max[2]],
      [min[0], max[1], max[2]],
      [max[0], max[1], max[2]],
    ];
    for (const c of corners) {
      outSrc.push(c);
      outDst.push(c);
    }
  }
  return { src: outSrc, dst: outDst };
}

/**
 * 缓存欧版各 mesh 的「未拧」局部坐标与当前世界坐标 rest。
 * @param {THREE.Object3D} rootObj 通常为 euroPivot
 */
export function cacheEuroMeshes(rootObj) {
  const meshCache = [];
  rootObj.updateWorldMatrix(true, true);
  rootObj.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (o.userData?._overlayHiddenJunk) return;
    if (shouldSkipEuroWarp(o)) o.userData._skipEuroWarp = true;
    const pos = o.geometry.attributes.position;
    if (!o.userData._warpLocalRest) {
      const local = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        local[i * 3] = pos.getX(i);
        local[i * 3 + 1] = pos.getY(i);
        local[i * 3 + 2] = pos.getZ(i);
      }
      o.userData._warpLocalRest = local;
    }
    const restPos = new Float32Array(pos.count * 3);
    const local = o.userData._warpLocalRest;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(local[i * 3], local[i * 3 + 1], local[i * 3 + 2]).applyMatrix4(o.matrixWorld);
      restPos[i * 3] = v.x;
      restPos[i * 3 + 1] = v.y;
      restPos[i * 3 + 2] = v.z;
    }
    meshCache.push({ mesh: o, restPos, count: pos.count });
  });
  return meshCache;
}

/** 恢复为 GLB 初始局部坐标（撤销拧形；跳过虹膜/晶状体） */
export function restoreEuroRest(meshCache) {
  for (const entry of meshCache) {
    if (entry.mesh.userData?._skipEuroWarp) continue;
    const local = entry.mesh.userData._warpLocalRest;
    if (!local) continue;
    const attr = entry.mesh.geometry.attributes.position;
    for (let i = 0; i < entry.count; i++) {
      attr.setXYZ(i, local[i * 3], local[i * 3 + 1], local[i * 3 + 2]);
    }
    attr.needsUpdate = true;
    entry.mesh.geometry.computeVertexNormals();
  }
}

/**
 * 按路标对应关系拧形欧版网格（始终从初始 rest 出发，可重复点击）。
 * @param {{ mesh: THREE.Mesh, restPos: Float32Array, count: number }[]} meshCache
 * @param {number[][]} src 黄点世界坐标
 * @param {number[][]} dst 粉点世界坐标
 */
export function applyLandmarkWarp(meshCache, src, dst, smooth = 1e-4) {
  if (!meshCache?.length) {
    return { ok: false, reason: 'no-meshes' };
  }
  if (src.length < 4) {
    return { ok: false, reason: 'pairs<4', nPairs: src.length };
  }
  const stabilized = withStabilizers(src, dst);
  const warpFn = fitTps(stabilized.src, stabilized.dst, smooth);

  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let totalVerts = 0;
  for (const entry of meshCache) {
    const { mesh, restPos, count } = entry;
    if (mesh.userData?._skipEuroWarp) continue;
    inv.copy(mesh.matrixWorld).invert();
    const attr = mesh.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const w = warpFn([restPos[i3], restPos[i3 + 1], restPos[i3 + 2]]);
      v.set(w[0], w[1], w[2]).applyMatrix4(inv);
      attr.setXYZ(i, v.x, v.y, v.z);
    }
    attr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    totalVerts += count;
  }

  let maxResidualMm = 0;
  for (let i = 0; i < src.length; i++) {
    const w = warpFn(src[i]);
    const d =
      Math.hypot(w[0] - dst[i][0], w[1] - dst[i][1], w[2] - dst[i][2]) * 1000;
    if (d > maxResidualMm) maxResidualMm = d;
  }

  return {
    ok: true,
    nPairs: src.length,
    nVerts: totalVerts,
    landmarkResidualMm: maxResidualMm,
  };
}
