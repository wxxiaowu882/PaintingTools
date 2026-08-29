/**
 * Euro bone morph (V1): Farkas landmarks + semantic sliders → one TPS field on all meshes.
 * Rest on euro Static; target = rest + semantic + per-point XYZ. No SHELL bbox align.
 */
import * as THREE from "three";

const AXIS_I = { x: 0, y: 1, z: 2 };

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
  const c = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const h = [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2];
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], c, h };
}

function nrm(p, c, h) {
  return [
    (p[0] - c[0]) / Math.max(h[0], 1e-8),
    (p[1] - c[1]) / Math.max(h[1], 1e-8),
    (p[2] - c[2]) / Math.max(h[2], 1e-8),
  ];
}

function pickBest(pts, c, h, maskFn, scoreFn) {
  let best = -1;
  let bestS = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const n = nrm(pts[i], c, h);
    if (!maskFn(n, pts[i])) continue;
    const s = scoreFn(n, pts[i]);
    if (s > bestS) {
      bestS = s;
      best = i;
    }
  }
  return best >= 0 ? pts[best].slice() : null;
}

/** Detect forward (+Z or -Z) as the side with mid-face tip (nose-ish). */
function detectForwardSign(pts, c, h) {
  const tipPos = pickBest(
    pts,
    c,
    h,
    (n) => Math.abs(n[0]) < 0.2 && n[1] > -0.2 && n[1] < 0.45,
    (n) => n[2]
  );
  const tipNeg = pickBest(
    pts,
    c,
    h,
    (n) => Math.abs(n[0]) < 0.2 && n[1] > -0.2 && n[1] < 0.45,
    (n) => -n[2]
  );
  if (!tipPos || !tipNeg) return 1;
  const dPos = Math.abs(tipPos[2] - c[2]);
  const dNeg = Math.abs(tipNeg[2] - c[2]);
  return dPos >= dNeg ? 1 : -1;
}

/**
 * Auto-seed Farkas-like points on Static surface (Y-up world).
 * Returns { points: {id:[x,y,z]}, forwardSign }.
 */
export function autoSeedRest(worldPts, landmarkDefs) {
  const { c, h } = bboxOf(worldPts);
  const fwd = detectForwardSign(worldPts, c, h);
  const fz = (n) => n[2] * fwd;

  const seeds = {
    vertex: pickBest(worldPts, c, h, (n) => n[1] > 0.55, (n) => n[1]),
    trichion: pickBest(
      worldPts,
      c,
      h,
      (n) => Math.abs(n[0]) < 0.2 && n[1] > 0.35 && fz(n) > 0.05,
      (n) => n[1] + 0.2 * fz(n)
    ),
    glabella: pickBest(
      worldPts,
      c,
      h,
      (n) => Math.abs(n[0]) < 0.12 && n[1] > 0.22 && n[1] < 0.5 && fz(n) > 0.25,
      (n) => fz(n) + 0.15 * n[1]
    ),
    nasion: pickBest(
      worldPts,
      c,
      h,
      (n) => Math.abs(n[0]) < 0.1 && n[1] > 0.08 && n[1] < 0.28 && fz(n) > 0.2,
      (n) => -Math.abs(n[1] - 0.18) + 0.15 * fz(n)
    ),
    subnasale: pickBest(
      worldPts,
      c,
      h,
      (n) => Math.abs(n[0]) < 0.1 && n[1] > -0.2 && n[1] < 0.05 && fz(n) > 0.2,
      (n) => fz(n) - 0.35 * Math.abs(n[1] + 0.02)
    ),
    pronasale: pickBest(
      worldPts,
      c,
      h,
      (n) => Math.abs(n[0]) < 0.14 && n[1] > -0.05 && n[1] < 0.22 && fz(n) > 0.35,
      (n) => fz(n) * 2 - Math.abs(n[1] - 0.08)
    ),
    gnathion: pickBest(
      worldPts,
      c,
      h,
      (n) => Math.abs(n[0]) < 0.2 && n[1] < -0.4 && fz(n) > -0.2,
      (n) => -n[1]
    ),
    pogonion: pickBest(
      worldPts,
      c,
      h,
      (n) => Math.abs(n[0]) < 0.18 && n[1] < -0.25 && fz(n) > 0.05,
      (n) => fz(n) - 0.15 * n[1]
    ),
    opisthocranion: pickBest(worldPts, c, h, (n) => fz(n) < -0.35, (n) => -fz(n)),
    zygion_L: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] < -0.4 && Math.abs(n[1]) < 0.3 && Math.abs(fz(n)) < 0.45,
      (n) => -n[0]
    ),
    zygion_R: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] > 0.4 && Math.abs(n[1]) < 0.3 && Math.abs(fz(n)) < 0.45,
      (n) => n[0]
    ),
    gonion_L: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] < -0.3 && n[1] < -0.15 && fz(n) < 0.2,
      (n) => -n[0] - 0.3 * n[1]
    ),
    gonion_R: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] > 0.3 && n[1] < -0.15 && fz(n) < 0.2,
      (n) => n[0] - 0.3 * n[1]
    ),
    endocanthion_L: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] < -0.05 && n[0] > -0.28 && n[1] > 0.05 && n[1] < 0.35 && fz(n) > 0.2,
      (n) => fz(n) - Math.abs(n[0] + 0.12)
    ),
    endocanthion_R: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] > 0.05 && n[0] < 0.28 && n[1] > 0.05 && n[1] < 0.35 && fz(n) > 0.2,
      (n) => fz(n) - Math.abs(n[0] - 0.12)
    ),
    exocanthion_L: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] < -0.25 && n[0] > -0.5 && n[1] > 0.0 && n[1] < 0.35 && fz(n) > 0.05,
      (n) => -n[0] + 0.2 * fz(n)
    ),
    exocanthion_R: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] > 0.25 && n[0] < 0.5 && n[1] > 0.0 && n[1] < 0.35 && fz(n) > 0.05,
      (n) => n[0] + 0.2 * fz(n)
    ),
    alare_L: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] < -0.04 && n[0] > -0.25 && n[1] > -0.15 && n[1] < 0.15 && fz(n) > 0.25,
      (n) => -n[0] + 0.5 * fz(n)
    ),
    alare_R: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] > 0.04 && n[0] < 0.25 && n[1] > -0.15 && n[1] < 0.15 && fz(n) > 0.25,
      (n) => n[0] + 0.5 * fz(n)
    ),
    tragion_L: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] < -0.35 && Math.abs(n[1]) < 0.25 && fz(n) < 0.15,
      (n) => -n[0] - 0.4 * fz(n)
    ),
    tragion_R: pickBest(
      worldPts,
      c,
      h,
      (n) => n[0] > 0.35 && Math.abs(n[1]) < 0.25 && fz(n) < 0.15,
      (n) => n[0] - 0.4 * fz(n)
    ),
  };

  const points = {};
  const ids = (landmarkDefs || []).map((l) => l.id);
  const want = ids.length ? ids : Object.keys(seeds);
  for (const id of want) {
    if (seeds[id]) points[id] = seeds[id];
  }
  return { points, forwardSign: fwd, center: c, half: h };
}

function collectWorldPositions(mesh) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  const arr = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    arr.push([v.x, v.y, v.z]);
  }
  return arr;
}

function findStaticMeshes(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const name = (o.name || "").toLowerCase();
    if (name.includes("static")) out.push(o);
  });
  return out;
}

function findStaticMesh(root) {
  const all = findStaticMeshes(root);
  if (all.length) {
    let best = all[0];
    let bestN = best.geometry.attributes.position.count;
    for (const o of all) {
      const n = o.geometry.attributes.position.count;
      if (n > bestN) {
        best = o;
        bestN = n;
      }
    }
    return best;
  }
  let best = null;
  let bestN = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const n = o.geometry.attributes.position.count;
    if (!best || n > bestN) {
      best = o;
      bestN = n;
    }
  });
  return best;
}

export function createBoneMorphController(THREE_NS) {
  const T = THREE_NS || THREE;

  let farkas = { landmarks: [] };
  let sliderDefs = { sliders: [] };
  let rest = {}; // id -> [x,y,z]
  let xyzOffset = {}; // id -> [dx,dy,dz]
  let sliderValues = {};
  let customMeta = {}; // id -> { label, pair?, custom: true }
  let mirrorLock = true;
  let selectedId = "";
  let editRest = false; // if true, drag moves rest; else moves xyz offset (target)

  let root = null;
  let meshCache = []; // { mesh, restPos: Float32Array (local), count }
  let markerGroup = null;
  let markers = {}; // id -> Mesh
  let warpFn = null;
  let dirty = true;
  let rafApply = 0;
  let forwardSign = 1;

  let scene = null;
  let camera = null;
  let domEl = null;
  let controls = null;
  let raycaster = new T.Raycaster();
  let pointer = new T.Vector2();
  let dragging = null;
  let addMode = false;
  let addSymmetric = true;
  let pickMuscleMode = false;
  let selectedMeshKey = "";
  let selectedRegionKey = ""; // semantic colour part id cq_*
  let selectedRegionMeta = null; // { seedU, seedV, previewHex, pixelCount, partKey, partLabel, seedRgb }
  let meshColors = {}; // meshKey -> { regionId: {hex,seedU,seedV,mirror} | __layer__: hex }
  let meshOrigColors = {}; // key -> hex number
  /** 'selected' | 'muscles' | 'all' */
  let hslScope = "selected";
  let scopeHsl = {
    selected: { dh: 0, ds: 0, dl: 0 },
    muscles: { dh: 0, ds: 0, dl: 0 },
    all: { dh: 0, ds: 0, dl: 0 },
  };
  /** @type {{ quantStep: number, parts: Record<string, {label?: string}> }} */
  let semanticParts = { quantStep: 24, parts: {} };
  let historyIndex = { versions: [] };
  let onChange = () => {};
  let controlsSavedEnabled = true;

  const AXIS_NAME = ["x", "y", "z"];

  const markerGeo = new T.SphereGeometry(1, 12, 12);
  const matStd = new T.MeshBasicMaterial({ color: 0x2b8aee, depthTest: true });
  const matSel = new T.MeshBasicMaterial({ color: 0xf5a623, depthTest: true });
  const matCustom = new T.MeshBasicMaterial({ color: 0x34d399, depthTest: true });

  function allPointIds() {
    const ids = new Set();
    for (const lm of farkas.landmarks || []) ids.add(lm.id);
    for (const id of Object.keys(customMeta)) ids.add(id);
    for (const id of Object.keys(rest)) ids.add(id);
    return [...ids];
  }

  function pairOf(id) {
    const lm = (farkas.landmarks || []).find((l) => l.id === id);
    if (lm && lm.pair) return lm.pair;
    if (customMeta[id]?.pair) return customMeta[id].pair;
    if (id.endsWith("_L")) return id.slice(0, -2) + "_R";
    if (id.endsWith("_R")) return id.slice(0, -2) + "_L";
    return null;
  }

  function semanticDelta(id) {
    const d = [0, 0, 0];
    for (const s of sliderDefs.sliders || []) {
      const v = sliderValues[s.id] ?? s.default ?? 0;
      if (!v) continue;
      for (const e of s.effects || []) {
        if (e.id !== id) continue;
        const ai = AXIS_I[e.axis];
        if (ai == null) continue;
        let sign = e.sign ?? 1;
        // z effects follow detected forward (+1 or -1)
        if (e.axis === "z") sign *= forwardSign;
        d[ai] += v * sign;
      }
    }
    return d;
  }

  function targetOf(id) {
    const r = rest[id];
    if (!r) return null;
    const o = xyzOffset[id] || [0, 0, 0];
    const s = semanticDelta(id);
    return [r[0] + o[0] + s[0], r[1] + o[1] + s[1], r[2] + o[2] + s[2]];
  }

  function rebuildWarp() {
    const ids = allPointIds().filter((id) => rest[id]);
    const src = [];
    const dst = [];
    for (const id of ids) {
      const t = targetOf(id);
      if (!t) continue;
      src.push(rest[id].slice());
      dst.push(t);
    }
    // Stabilize with bbox corners of rest cloud (half blend toward identity)
    if (src.length >= 4) {
      const { min, max } = bboxOf(src);
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
        src.push(c);
        dst.push(c);
      }
    }
    warpFn = src.length >= 4 ? fitTps(src, dst, 1e-4) : null;
    dirty = false;
  }

  function applyWarpNow() {
    if (dirty) rebuildWarp();
    if (!warpFn || !meshCache.length) return;
    const v = new T.Vector3();
    const inv = new T.Matrix4();
    for (const entry of meshCache) {
      const { mesh, restPos, count } = entry;
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
    }
    updateMarkerPositions();
  }

  function scheduleApply() {
    dirty = true;
    if (rafApply) return;
    rafApply = requestAnimationFrame(() => {
      rafApply = 0;
      applyWarpNow();
    });
  }

  function markerRadius() {
    if (!root) return 0.003;
    const box = new T.Box3().setFromObject(root);
    const size = box.getSize(new T.Vector3());
    return Math.max(size.x, size.y, size.z) * 0.008;
  }

  function ensureMarkers() {
    if (!markerGroup || !scene) return;
    const r = markerRadius();
    const ids = allPointIds().filter((id) => rest[id]);
    for (const id of Object.keys(markers)) {
      if (!ids.includes(id)) {
        markerGroup.remove(markers[id]);
        markers[id].geometry?.dispose?.();
        delete markers[id];
      }
    }
    for (const id of ids) {
      let m = markers[id];
      const isCustom = !!customMeta[id] || id.startsWith("custom_");
      const mat = id === selectedId ? matSel : isCustom ? matCustom : matStd;
      if (!m) {
        m = new T.Mesh(markerGeo, mat);
        m.userData.lmId = id;
        markers[id] = m;
        markerGroup.add(m);
      } else {
        m.material = mat;
      }
      m.scale.setScalar(r);
    }
    updateMarkerPositions();
  }

  function updateMarkerPositions() {
    for (const id of Object.keys(markers)) {
      const t = targetOf(id) || rest[id];
      if (!t) continue;
      markers[id].position.set(t[0], t[1], t[2]);
    }
  }

  /** Each mesh gets its own material instance (GLTF often shares). */
  function uniquifyMaterials(rootObj) {
    rootObj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => (m ? m.clone() : m));
      } else {
        o.material = o.material.clone();
      }
    });
  }

  function textureImageData(map) {
    const img = map && map.image;
    if (!img) return null;
    const w = img.width || img.videoWidth || 0;
    const h = img.height || img.videoHeight || 0;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(img, 0, 0, w, h);
      return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
    } catch (_) {
      return null;
    }
  }

  function sampleRgb(imgData, u, v) {
    const { data, width, height } = imgData;
    let uu = u - Math.floor(u);
    let vv = v - Math.floor(v);
    if (uu < 0) uu += 1;
    if (vv < 0) vv += 1;
    const x = Math.min(width - 1, Math.max(0, Math.floor(uu * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor((1 - vv) * height)));
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }

  /** Coarse quantize for colourcoded atlas (large flat regions, not per-triangle). */
  function quantKey(r, g, b, step = 24) {
    const qr = Math.round(r / step) * step;
    const qg = Math.round(g / step) * step;
    const qb = Math.round(b / step) * step;
    return `${qr},${qg},${qb}`;
  }

  function partQuantStep() {
    return semanticParts.quantStep || 8;
  }

  function partLabelForKey(partKey, previewHex) {
    const meta = semanticParts.parts?.[partKey];
    if (meta?.label) return meta.label;
    if (previewHex && previewHex.length >= 7) {
      const r = parseInt(previewHex.slice(1, 3), 16);
      const g = parseInt(previewHex.slice(3, 5), 16);
      const b = parseInt(previewHex.slice(5, 7), 16);
      const coarse = quantKey(r, g, b, 24);
      if (semanticParts.parts?.[coarse]?.label) return semanticParts.parts[coarse].label;
    }
    return `色块 ${previewHex || partKey}`;
  }

  /** 从 meshColors / cq id / 缓存 mask 恢复选中部件 meta（session 与 Alt 点选后 HSL 依赖此项） */
  function syncSelectedRegionMetaFromStore() {
    if (!selectedMeshKey || !selectedRegionKey) {
      selectedRegionMeta = null;
      return null;
    }
    const mesh = listMeshes().find((m) => meshKey(m) === selectedMeshKey);
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas) {
      selectedRegionMeta = null;
      return null;
    }
    let entry = normalizeRegionEntry(meshColors[selectedMeshKey]?.[selectedRegionKey]);
    const isPlastymaSheet = String(selectedRegionKey) === "cq_plastyma_sheet";
    const cqMatch = /^cq_(\d+),(\d+),(\d+)$/.exec(String(selectedRegionKey));
    if ((!entry || entry.seedU == null) && isPlastymaSheet) {
      // 任意非黑低饱和像素作种子即可重建整层 mask
      const o = atlas.orig.data;
      for (let p = 0; p < atlas.w * atlas.h; p++) {
        const i = p * 4;
        const r = o[i];
        const g = o[i + 1];
        const b = o[i + 2];
        if (isNearBlack(r, g, b)) continue;
        if (rgbToHsl(r, g, b).s >= 0.22) continue;
        const x = p % atlas.w;
        const y = (p / atlas.w) | 0;
        const flipY = atlas.tex ? !!atlas.tex.flipY : false;
        entry = {
          seedU: (x + 0.5) / atlas.w,
          seedV: flipY ? 1 - (y + 0.5) / atlas.h : (y + 0.5) / atlas.h,
          partMode: "colorClass",
          partKey: "plastyma_sheet",
          partLabel: "颈阔肌",
        };
        break;
      }
    } else if ((!entry || entry.seedU == null) && cqMatch) {
      const sr = +cqMatch[1];
      const sg = +cqMatch[2];
      const sb = +cqMatch[3];
      const step = partQuantStep();
      const q0 = quantKey(sr, sg, sb, step);
      const o = atlas.orig.data;
      for (let p = 0; p < atlas.w * atlas.h; p++) {
        const i = p * 4;
        const r = o[i];
        const g = o[i + 1];
        const b = o[i + 2];
        if (isNearBlack(r, g, b)) continue;
        if (quantKey(r, g, b, step) !== q0) continue;
        const x = p % atlas.w;
        const y = (p / atlas.w) | 0;
        const flipY = atlas.tex ? !!atlas.tex.flipY : false;
        entry = {
          seedU: (x + 0.5) / atlas.w,
          seedV: flipY ? 1 - (y + 0.5) / atlas.h : (y + 0.5) / atlas.h,
          partMode: "colorClass",
          partKey: q0,
        };
        break;
      }
    }
    if (!entry || entry.seedU == null) {
      if (selectedRegionMeta?.seedU != null) {
        const mask = atlas.masks?.[selectedRegionKey];
        if (mask) selectedRegionMeta.pixelCount = maskPixelCount(mask);
        return selectedRegionMeta;
      }
      selectedRegionMeta = null;
      return null;
    }
    const p = uvToPixel(atlas, entry.seedU, entry.seedV);
    const o = atlas.orig.data;
    const r = o[p.i];
    const g = o[p.i + 1];
    const b = o[p.i + 2];
    const previewHex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    const partKey =
      entry.partKey ||
      (isPlastymaSheet ? "plastyma_sheet" : quantKey(r, g, b, partQuantStep()));
    const mask =
      atlas.masks[selectedRegionKey] ||
      ensureRegionMask(mesh, selectedRegionKey, { ...entry, partMode: entry.partMode || "colorClass" });
    if (mask) atlas.masks[selectedRegionKey] = mask;
    selectedRegionMeta = {
      seedU: entry.seedU,
      seedV: entry.seedV,
      previewHex,
      pixelCount: mask ? maskPixelCount(mask) : selectedRegionMeta?.pixelCount || 0,
      partKey,
      partLabel:
        entry.partLabel ||
        (partKey === "plastyma_sheet" ? "颈阔肌" : partLabelForKey(partKey, previewHex)),
      seedRgb: [r, g, b],
      partMode: entry.partMode || "colorClass",
    };
    return selectedRegionMeta;
  }

  function syncSelectedScopeHslFromStore() {
    if (hslScope !== "selected" || !selectedMeshKey || !selectedRegionKey) return;
    const entry = normalizeRegionEntry(meshColors[selectedMeshKey]?.[selectedRegionKey]);
    if (entry?.mode === "hsl") {
      scopeHsl.selected = {
        dh: entry.dh || 0,
        ds: entry.ds || 0,
        dl: entry.dl || 0,
      };
    } else {
      scopeHsl.selected = { dh: 0, ds: 0, dl: 0 };
    }
  }

  /**
   * 语义部件 mask：该 mesh 贴图上与种子色同属一块 colourcoded 平涂的全部像素。
   * 用紧 RGB 容差（非整图粗量化），避免不同灰阶肌/骨并成一块。
   * 例外：Plastyma（颈阔肌）纤维灰层跨很多明度，紧容差只选到「半层」→ 整层低饱和非黑像素。
   */
  function maskFromColorClass(atlas, sr, sg, sb, mesh = null) {
    if (!atlas?.orig) return null;
    const { w, h, orig } = atlas;
    const o = orig.data;
    const mask = new Uint8Array(w * h);
    const seed = rgbToHsl(sr, sg, sb);
    const meshName = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    const fibrousGraySheet =
      meshName.includes("plasty") && seed.s < 0.22;
    // 高饱和肌：稍宽；低饱和灰/骨：更紧；颈阔肌纤维：整层灰阶
    const tol = seed.s >= 0.22 ? 28 : seed.s >= 0.1 ? 16 : 12;
    let count = 0;
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      const r = o[i];
      const g = o[i + 1];
      const b = o[i + 2];
      if (isNearBlack(r, g, b)) continue;
      if (fibrousGraySheet) {
        const c = rgbToHsl(r, g, b);
        // 纤维沟纹到高光：低饱和即可；排除明显彩色（若有）
        if (c.s >= 0.28) continue;
        mask[p] = 1;
        count++;
        continue;
      }
      if (Math.abs(r - sr) > tol || Math.abs(g - sg) > tol || Math.abs(b - sb) > tol) {
        continue;
      }
      mask[p] = 1;
      count++;
    }
    if (count < 80) return null;
    return mask;
  }

  function makePartRegionId(r, g, b, mesh = null) {
    const meshName = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    const seed = rgbToHsl(r, g, b);
    // 颈阔肌整层共用稳定 id，避免点不同灰阶变成多块
    if (meshName.includes("plasty") && seed.s < 0.22) {
      return "cq_plastyma_sheet";
    }
    return `cq_${quantKey(r, g, b, partQuantStep())}`;
  }

  function keyToHex(key) {
    const [r, g, b] = key.split(",").map((n) => parseInt(n, 10));
    const h = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function hexToRgb01(hex) {
    const c = new T.Color(hex);
    return [c.r, c.g, c.b];
  }

  function hexToRgb255(hex) {
    const h = String(hex || "").replace("#", "").trim();
    if (h.length < 6) return [255, 0, 255];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  function colorDist2(r0, g0, b0, r1, g1, b1) {
    const dr = r0 - r1;
    const dg = g0 - g1;
    const db = b0 - b1;
    return dr * dr + dg * dg + db * db;
  }

  function isNearBlack(r, g, b) {
    return r + g + b < 36;
  }

  /** RGB 0–255 → HSL (h,s,l ∈ [0,1]) */
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h, s, l };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 1) + 1) % 1;
    s = Math.min(1, Math.max(0, s));
    l = Math.min(1, Math.max(0, l));
    if (s < 1e-8) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = h;
    function t(x) {
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    }
    return [
      Math.round(t(hk + 1 / 3) * 255),
      Math.round(t(hk) * 255),
      Math.round(t(hk - 1 / 3) * 255),
    ];
  }

  /**
   * 头骨保护（按 mesh）：
   * - Plastyma / Skiedras：肌/纤维层，不跳过
   * - Static/Acs：近白 + 浅冷灰 + 黄米色奶油（颅骨在这两层）
   * - Deform：只跳近白（浅冷灰多为帽状腱膜/灰肌，需可拧）
   */
  function isBonePale(r, g, b, hsl, mesh) {
    const n = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    if (n.includes("plasty") || n.includes("skiedras")) return false;
    const c = hsl || rgbToHsl(r, g, b);
    // 近白：仅极白高光（耳浅灰 L≈0.75–0.85 需可拧，勿当骨头）
    if (c.l >= 0.88 && c.s <= 0.12) return true;
    const staticLike = n.includes("static") || n.includes("acs");
    if (!staticLike) return false;
    // 浅冷灰头骨（仅 Static/Acs；Deform 冷灰留给腱膜）
    if (
      c.l >= 0.68 &&
      c.s <= 0.28 &&
      b >= r + 6 &&
      b >= g + 3 &&
      Math.min(r, g, b) >= 155
    ) {
      return true;
    }
    // 黄米色奶油颅骨（R≈G>>B），排除薄荷绿
    if (
      c.l >= 0.8 &&
      r >= 195 &&
      g >= 185 &&
      b <= Math.min(r, g) - 20 &&
      g <= r + 20 &&
      r >= b + 20
    ) {
      return true;
    }
    return false;
  }

  /**
   * 单像素 HSL：头骨跳过；低饱和灰肌消噪声色相；彩色/奶油肌正常偏移。
   */
  function shiftPixelHsl(r, g, b, dh, ds, dl, mesh, opts = {}) {
    if (isNearBlack(r, g, b)) return [r, g, b, false];
    const hsl = rgbToHsl(r, g, b);
    const protectBone = opts.protectBone !== false;
    if (protectBone && isBonePale(r, g, b, hsl, mesh)) return [r, g, b, false];
    let h;
    let s;
    let l = Math.min(1, Math.max(0, hsl.l + dl));
    if (hsl.s < 0.2) {
      h = ((dh % 1) + 1) % 1;
      s = Math.min(1, Math.max(0, hsl.s + ds));
      if (s < 0.015) {
        const v = Math.round(l * 255);
        return [v, v, v, true];
      }
    } else {
      h = hsl.h + dh;
      s = Math.min(1, Math.max(0, hsl.s + ds));
    }
    const rgb = hslToRgb(h, s, l);
    return [rgb[0], rgb[1], rgb[2], true];
  }

  function hueDist01(a, b) {
    let d = Math.abs(a - b);
    if (d > 0.5) d = 1 - d;
    return d;
  }

  /** UV → canvas pixel. glTF maps usually flipY=false. */
  function uvToPixel(atlas, u, v) {
    let uu = u - Math.floor(u);
    let vv = v - Math.floor(v);
    if (uu < 0) uu += 1;
    if (vv < 0) vv += 1;
    const flipY = atlas.tex ? !!atlas.tex.flipY : false;
    const x = Math.min(atlas.w - 1, Math.max(0, Math.floor(uu * atlas.w)));
    const y = Math.min(
      atlas.h - 1,
      Math.max(0, Math.floor((flipY ? 1 - vv : vv) * atlas.h))
    );
    return { x, y, i: (y * atlas.w + x) * 4 };
  }

  /** Clone glTF map → editable CanvasTexture. */
  function prepareEditableAtlas(mesh) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat || !mat.map || mesh.userData.bmAtlas) return !!mesh.userData.bmAtlas;
    const map = mat.map;
    const img = map.image;
    if (!img) return false;
    const w = img.width || img.videoWidth || 0;
    const h = img.height || img.videoHeight || 0;
    if (!w || !h) return false;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(img, 0, 0, w, h);
    } catch (e) {
      console.warn("[bone_morph] atlas draw failed", mesh.name, e);
      return false;
    }
    const orig = ctx.getImageData(0, 0, w, h);
    const live = ctx.createImageData(w, h);
    live.data.set(orig.data);
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = map.colorSpace || T.SRGBColorSpace;
    tex.flipY = !!map.flipY;
    tex.wrapS = map.wrapS;
    tex.wrapT = map.wrapT;
    tex.magFilter = map.magFilter;
    tex.minFilter = map.minFilter;
    mat.map = tex;
    mat.needsUpdate = true;
    mesh.userData.bmAtlas = {
      canvas,
      ctx,
      orig,
      live,
      tex,
      w,
      h,
      masks: {}, // regionId -> Uint8Array length w*h (1=in region)
    };
    return true;
  }

  function waitForMaps(rootObj) {
    const pending = [];
    rootObj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const map = m && m.map;
        if (!map || !map.image) continue;
        const img = map.image;
        if (img.complete !== false && (img.width || img.videoWidth)) continue;
        pending.push(
          new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener?.("load", done, { once: true });
            img.addEventListener?.("error", done, { once: true });
            setTimeout(done, 4000);
          })
        );
      }
    });
    return Promise.all(pending);
  }

  async function prepareAllAtlases(rootObj) {
    await waitForMaps(rootObj);
    let n = 0;
    rootObj.traverse((o) => {
      if (!o.isMesh) return;
      if (prepareEditableAtlas(o)) n++;
    });
    console.log(`[bone_morph] editable atlases: ${n}`);
    return n;
  }

  /**
   * 整肌选区：
   * - 低/中饱和：明度带 + UV 半径分层（耳局部 / 颈背整块，不吞整张灰图）
   * - 高饱和：色相族连通
   */
  function floodMaskFromSeed(atlas, seedX, seedY, hueTol01 = 26 / 360) {
    const { w, h, orig } = atlas;
    const o = orig.data;
    if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return null;
    const si = (seedY * w + seedX) * 4;
    const sr = o[si];
    const sg = o[si + 1];
    const sb = o[si + 2];
    if (isNearBlack(sr, sg, sb)) return null;
    const seed = rgbToHsl(sr, sg, sb);
    // 0=灰明度带 1=中饱和耳/灰紫 2=彩色
    let mode = 2;
    if (seed.s < 0.16) mode = 0;
    else if (seed.s < 0.32) mode = 1;
    // 浅灰 / 奶油种子走半径分层（耳可能是浅奶油岛，勿吞整颅）
    const creamLike =
      seed.l >= 0.8 && sr >= 195 && sg >= 185 && sb <= sg - 8;
    const paleSeed = (seed.l >= 0.72 && seed.s <= 0.45) || creamLike;

    function colorOk(i) {
      const r = o[i];
      const g = o[i + 1];
      const b = o[i + 2];
      if (isNearBlack(r, g, b)) return false;
      const c = rgbToHsl(r, g, b);
      if (mode === 0) {
        if (c.s >= 0.28) return false;
        return Math.abs(c.l - seed.l) <= 0.14;
      }
      if (mode === 1) {
        if (c.s < 0.06 && Math.abs(c.l - seed.l) > 0.2) return false;
        if (c.s < 0.18) return Math.abs(c.l - seed.l) <= 0.16;
        // 中低饱和：色相相近仍要卡明度，避免耳暗灰并进 galea 浅灰
        if (seed.s < 0.28 && c.s < 0.28 && Math.abs(c.l - seed.l) > 0.12) {
          return false;
        }
        return hueDist01(c.h, seed.h) <= hueTol01 + 10 / 360;
      }
      if (c.s < 0.04) return false;
      return hueDist01(c.h, seed.h) <= hueTol01;
    }

    function floodRaw(maxR) {
      const raw = new Uint8Array(w * h);
      const stack = [seedX, seedY];
      raw[seedY * w + seedX] = 1;
      let count = 1;
      const bridgeMin = mode === 0 ? 1 : mode === 1 ? 1 : 2;
      const bridgeAfter = mode === 0 ? 80 : mode === 1 ? 24 : 8;
      const use8 = mode !== 2;
      while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        const neighbors = use8
          ? [
              x - 1, y, x + 1, y, x, y - 1, x, y + 1,
              x - 1, y - 1, x + 1, y - 1, x - 1, y + 1, x + 1, y + 1,
            ]
          : [x - 1, y, x + 1, y, x, y - 1, x, y + 1];
        for (let n = 0; n < neighbors.length; n += 2) {
          const nx = neighbors[n];
          const ny = neighbors[n + 1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (maxR < 1e8) {
            const dx = nx - seedX;
            const dy = ny - seedY;
            if (dx * dx + dy * dy > maxR * maxR) continue;
          }
          const mi = ny * w + nx;
          if (raw[mi]) continue;
          if (!colorOk(mi * 4)) continue;
          if (mode === 2 || count > bridgeAfter) {
            let sameN = 0;
            const nb = [nx - 1, ny, nx + 1, ny, nx, ny - 1, nx, ny + 1];
            for (let k = 0; k < 8; k += 2) {
              const qx = nb[k];
              const qy = nb[k + 1];
              if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
              if (colorOk((qy * w + qx) * 4)) sameN++;
            }
            if (sameN < bridgeMin && count > bridgeAfter) continue;
          }
          raw[mi] = 1;
          count++;
          stack.push(nx, ny);
        }
      }
      return { raw, count };
    }

    let raw;
    let count;
    if (mode === 0 || mode === 1 || paleSeed) {
      // 半径分层：取不超过上限的最大整块（耳小、颈背中等）
      const radii = paleSeed
        ? [40, 70, 110, 150]
        : mode === 1
          ? [55, 90, 130, 180]
          : [90, 140, 200, 280];
      const cap = paleSeed ? 55000 : mode === 1 ? 70000 : 120000;
      let chosen = null;
      for (const R of radii) {
        const r = floodRaw(R);
        if (r.count < 24) continue;
        if (r.count <= cap) chosen = r;
        else break;
      }
      if (!chosen) chosen = floodRaw(radii[0]);
      raw = chosen.raw;
      count = chosen.count;
    } else {
      const r = floodRaw(1e9);
      raw = r.raw;
      count = r.count;
    }
    if (count < 24) return null;

    function erode(src) {
      const dst = new Uint8Array(src.length);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!src[i]) continue;
          if (src[i - 1] && src[i + 1] && src[i - w] && src[i + w]) dst[i] = 1;
        }
      }
      return dst;
    }
    function dilate(src) {
      const dst = new Uint8Array(src.length);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (src[i] || src[i - 1] || src[i + 1] || src[i - w] || src[i + w]) {
            dst[i] = 1;
          }
        }
      }
      return dst;
    }

    // 灰/中饱和/浅奶油：单次膨胀补缝；彩：开运算断细桥
    let opened;
    if (mode === 0 || mode === 1 || paleSeed) {
      opened = dilate(raw);
    } else {
      opened = dilate(erode(raw));
    }

    let sx = seedX;
    let sy = seedY;
    if (!opened[sy * w + sx]) {
      let found = false;
      for (let r = 1; r <= 8 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const x = seedX + dx;
            const y = seedY + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if (opened[y * w + x]) {
              sx = x;
              sy = y;
              found = true;
            }
          }
        }
      }
      if (!found) return raw;
    }

    const out = new Uint8Array(w * h);
    const st2 = [sx, sy];
    out[sy * w + sx] = 1;
    let n2 = 1;
    while (st2.length) {
      const y = st2.pop();
      const x = st2.pop();
      const neighbors = [x - 1, y, x + 1, y, x, y - 1, x, y + 1];
      for (let n = 0; n < neighbors.length; n += 2) {
        const nx = neighbors[n];
        const ny = neighbors[n + 1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const mi = ny * w + nx;
        if (out[mi] || !opened[mi]) continue;
        out[mi] = 1;
        n2++;
        st2.push(nx, ny);
      }
    }
    if (n2 < 24) return raw;
    return out;
  }

  function orMasks(a, b) {
    if (!a) return b;
    if (!b) return a;
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] | b[i];
    return out;
  }

  function maskPixelCount(mask) {
    if (!mask) return 0;
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n;
  }

  function makeRegionId(u, v) {
    return `ff_${Math.round(u * 10000)}_${Math.round(v * 10000)}`;
  }

  /** Build / cache mask：优先语义色类；旧 session 的 ff_* 仍走 flood 兼容。 */
  function ensureRegionMask(mesh, regionId, entry) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas) return null;
    if (atlas.masks[regionId]) return atlas.masks[regionId];
    if (!entry || entry.seedU == null) return null;
    const p = uvToPixel(atlas, entry.seedU, entry.seedV);
    const o = atlas.orig.data;
    const sr = o[p.i];
    const sg = o[p.i + 1];
    const sb = o[p.i + 2];
    let mask = null;
    if (String(regionId).startsWith("cq_") || entry.partMode === "colorClass") {
      mask = maskFromColorClass(atlas, sr, sg, sb, mesh);
    } else {
      mask = floodMaskFromSeed(atlas, p.x, p.y);
      if (mask && entry.mirror === true) {
        const pm = uvToPixel(atlas, 1 - entry.seedU, entry.seedV);
        const m2 = floodMaskFromSeed(atlas, pm.x, pm.y);
        if (m2) mask = orMasks(mask, m2);
      }
    }
    if (!mask) return null;
    atlas.masks[regionId] = mask;
    return mask;
  }

  /** 旧：整块填单一颜色（legacy hex） */
  function paintMaskFlat(mesh, mask, hex) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas || !mask) return 0;
    const d = ensureLive(atlas).data;
    const o = atlas.orig.data;
    const [tr, tg, tb] = hexToRgb255(hex);
    let n = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      d[i] = tr;
      d[i + 1] = tg;
      d[i + 2] = tb;
      d[i + 3] = o[i + 3];
      n++;
    }
    commitLive(atlas);
    return n;
  }

  function ensureLive(atlas) {
    if (!atlas.live) {
      atlas.live = atlas.ctx.createImageData(atlas.w, atlas.h);
      atlas.live.data.set(atlas.orig.data);
    }
    return atlas.live;
  }

  function commitLive(atlas) {
    atlas.ctx.putImageData(ensureLive(atlas), 0, 0);
    atlas.tex.needsUpdate = true;
  }

  /**
   * Ctrl+U 式：相对 orig 做 ΔH/ΔS/ΔL，保留选区内明暗起伏。
   * dh/ds/dl 均为 [-1,1] 量级（h 环绕）。
   */
  function paintMaskHsl(mesh, mask, dh, ds, dl) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas || !mask) return 0;
    const d = ensureLive(atlas).data;
    const o = atlas.orig.data;
    let n = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      // 选定区域：用户点选即拧，不再跳过头骨保护色
      const [nr, ng, nb, changed] = shiftPixelHsl(
        o[i],
        o[i + 1],
        o[i + 2],
        dh,
        ds,
        dl,
        mesh,
        { protectBone: false }
      );
      d[i] = nr;
      d[i + 1] = ng;
      d[i + 2] = nb;
      d[i + 3] = o[i + 3];
      if (changed) n++;
    }
    commitLive(atlas);
    return n;
  }

  function paintRegionEntry(mesh, mask, entry) {
    if (!entry || !mask) return 0;
    if (entry.mode === "hsl" || (entry.dh != null && entry.hex == null)) {
      return paintMaskHsl(mesh, mask, entry.dh || 0, entry.ds || 0, entry.dl || 0);
    }
    if (entry.hex) return paintMaskFlat(mesh, mask, entry.hex);
    return 0;
  }

  function restoreMask(mesh, mask) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas || !mask) return;
    const d = ensureLive(atlas).data;
    const o = atlas.orig.data;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      d[i] = o[i];
      d[i + 1] = o[i + 1];
      d[i + 2] = o[i + 2];
      d[i + 3] = o[i + 3];
    }
    commitLive(atlas);
  }

  function restoreEntireAtlas(mesh) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas) return;
    ensureLive(atlas).data.set(atlas.orig.data);
    commitLive(atlas);
  }

  function flashMask(mesh, mask) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas || !mask) return;
    const d = ensureLive(atlas).data;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      d[i] = Math.min(255, d[i] + 40);
      d[i + 1] = Math.min(255, Math.floor(d[i + 1] * 0.85 + 40));
      d[i + 2] = Math.min(255, Math.floor(d[i + 2] * 0.55));
    }
    commitLive(atlas);
    setTimeout(() => {
      replayMeshColorsOnAtlas(mesh);
    }, 220);
  }

  function samplePickAtUv(mesh, u, v) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas) return null;
    const p = uvToPixel(atlas, u, v);
    const o = atlas.orig.data;
    const r = o[p.i];
    const g = o[p.i + 1];
    const b = o[p.i + 2];
    if (isNearBlack(r, g, b)) return null;
    const mask = maskFromColorClass(atlas, r, g, b, mesh);
    if (!mask) return null;
    const regionId = makePartRegionId(r, g, b, mesh);
    const isPlastymaSheet = regionId === "cq_plastyma_sheet";
    const partKey = isPlastymaSheet
      ? "plastyma_sheet"
      : quantKey(r, g, b, partQuantStep());
    const previewHex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    return {
      seedU: u,
      seedV: v,
      seedX: p.x,
      seedY: p.y,
      seedRgb: [r, g, b],
      regionId,
      partKey,
      partLabel: isPlastymaSheet
        ? "颈阔肌"
        : partLabelForKey(partKey, previewHex),
      previewHex,
      mask,
      pixelCount: maskPixelCount(mask),
      partMode: "colorClass",
    };
  }

  function normalizeRegionEntry(v) {
    if (!v) return null;
    if (typeof v === "string") {
      return { hex: v, seedU: 0.5, seedV: 0.5, mirror: false, legacy: true, mode: "flat" };
    }
    if (v.mode === "hsl" || (v.dh != null && v.hex == null)) {
      return {
        ...v,
        mode: "hsl",
        dh: Number(v.dh) || 0,
        ds: Number(v.ds) || 0,
        dl: Number(v.dl) || 0,
      };
    }
    return { ...v, mode: v.hex ? "flat" : "hsl" };
  }

  function isMuscleLayerMesh(mesh) {
    const n = (mesh.name || meshKey(mesh) || "").toLowerCase();
    // Euro colourcoded: Deform / Static / Plastyma + Acs / Skiedras 同属可拧肌层
    return (
      n.includes("deform") ||
      n.includes("static") ||
      n.includes("plasty") ||
      n.includes("acs") ||
      n.includes("skiedras")
    );
  }

  function paintAtlasNonBlackHsl(mesh, dh, ds, dl, step = 1) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas) return 0;
    if (!dh && !ds && !dl) return 0;
    const d = ensureLive(atlas).data;
    const o = atlas.orig.data;
    const stride = Math.max(1, step | 0) * 4;
    let n = 0;
    for (let i = 0; i < d.length; i += stride) {
      const [nr, ng, nb, changed] = shiftPixelHsl(
        o[i],
        o[i + 1],
        o[i + 2],
        dh,
        ds,
        dl,
        mesh
      );
      d[i] = nr;
      d[i + 1] = ng;
      d[i + 2] = nb;
      d[i + 3] = o[i + 3];
      if (changed) n++;
      if (stride > 4) {
        for (let k = 4; k < stride && i + k + 2 < d.length; k += 4) {
          d[i + k] = nr;
          d[i + k + 1] = ng;
          d[i + k + 2] = nb;
          d[i + k + 3] = o[i + k + 3];
        }
      }
    }
    commitLive(atlas);
    return n;
  }

  /**
   * orig → (all 或 muscles 全局 HSL) → 各 region 叠加。
   * all 与 muscles 可同时非零：先 all 再 muscles（muscles 再相对 orig 叠会盖掉 all 在肌肉层上的效果）。
   * 约定：合成时对每个 mesh 取「该层生效的全局偏移」= all +（若肌肉层则再加 muscles），从 orig 一次算完，再叠 region。
   */
  function effectiveGlobalHslForMesh(mesh) {
    const a = scopeHsl.all || { dh: 0, ds: 0, dl: 0 };
    const m = scopeHsl.muscles || { dh: 0, ds: 0, dl: 0 };
    const muscle = isMuscleLayerMesh(mesh);
    return {
      dh: (a.dh || 0) + (muscle ? m.dh || 0 : 0),
      ds: (a.ds || 0) + (muscle ? m.ds || 0 : 0),
      dl: (a.dl || 0) + (muscle ? m.dl || 0 : 0),
    };
  }

  function replayMeshColorsOnAtlas(onlyMesh = null, paintStep = 1) {
    for (const mesh of listMeshes()) {
      if (onlyMesh && mesh !== onlyMesh) continue;
      const atlas = mesh.userData.bmAtlas;
      if (!atlas) continue;
      restoreEntireAtlas(mesh);
      // 保留已缓存的 flood mask，避免滑块每次重算连通域
      if (!atlas.masks) atlas.masks = {};
      const g = effectiveGlobalHslForMesh(mesh);
      if (g.dh || g.ds || g.dl) {
        paintAtlasNonBlackHsl(mesh, g.dh, g.ds, g.dl, paintStep);
      }
      const key = meshKey(mesh);
      const regions = meshColors[key];
      if (!regions || typeof regions !== "object") continue;
      for (const [rid, raw] of Object.entries(regions)) {
        if (rid === "__layer__") {
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (mat?.color) mat.color.set(typeof raw === "string" ? raw : raw.hex);
          continue;
        }
        const entry = normalizeRegionEntry(raw);
        if (!entry || entry.legacy) continue;
        const mask = ensureRegionMask(mesh, rid, entry);
        if (!mask) continue;
        if (entry.mode === "hsl" || (entry.dh != null && entry.hex == null)) {
          paintMaskHslOnCurrent(mesh, mask, entry.dh || 0, entry.ds || 0, entry.dl || 0);
        } else if (entry.hex) {
          paintRegionEntry(mesh, mask, entry);
        }
      }
    }
  }

  let hslPaintRaf = 0;
  let hslPaintQueued = null;

  function flushHslPaint() {
    hslPaintRaf = 0;
    const q = hslPaintQueued;
    hslPaintQueued = null;
    if (!q) return;
    if (q.kind === "scope") {
      // 拖动预览：隔点采样加速；松手 immediate 用全精度
      replayMeshColorsOnAtlas(null, q.preview ? 4 : 1);
    } else if (q.kind === "region") {
      applyRegionHslImmediate(q.key, q.dh, q.ds, q.dl, q.regionKey);
    }
    if (q.notify) onChange();
  }

  function scheduleHslPaint(payload) {
    // 数值立即写入，重绘合并到下一帧
    if (payload.kind === "scope") {
      scopeHsl[payload.scope] = {
        dh: payload.dh,
        ds: payload.ds,
        dl: payload.dl,
      };
      payload.preview = true;
    } else if (payload.kind === "region") {
      scopeHsl.selected = { dh: payload.dh, ds: payload.ds, dl: payload.dl };
      if (!meshColors[payload.key] || typeof meshColors[payload.key] !== "object") {
        meshColors[payload.key] = {};
      }
      meshColors[payload.key][payload.regionKey] = {
        mode: "hsl",
        dh: payload.dh,
        ds: payload.ds,
        dl: payload.dl,
        seedU: selectedRegionMeta?.seedU,
        seedV: selectedRegionMeta?.seedV,
        mirror: false,
        partMode: selectedRegionMeta?.partMode || "colorClass",
        partKey: selectedRegionMeta?.partKey,
        partLabel: selectedRegionMeta?.partLabel,
      };
    }
    hslPaintQueued = payload;
    if (hslPaintRaf) return;
    hslPaintRaf = requestAnimationFrame(flushHslPaint);
  }

  /**
   * Region 叠加：在当前 canvas（已含全局偏移）上再做 ΔHSL。
   */
  function paintMaskHslOnCurrent(mesh, mask, dh, ds, dl) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas || !mask) return 0;
    if (!dh && !ds && !dl) return 0;
    const d = ensureLive(atlas).data;
    const o = atlas.orig.data;
    const g = effectiveGlobalHslForMesh(mesh);
    const tdh = (g.dh || 0) + dh;
    const tds = (g.ds || 0) + ds;
    const tdl = (g.dl || 0) + dl;
    let n = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      const [nr, ng, nb, changed] = shiftPixelHsl(
        o[i],
        o[i + 1],
        o[i + 2],
        tdh,
        tds,
        tdl,
        mesh,
        { protectBone: false }
      );
      d[i] = nr;
      d[i + 1] = ng;
      d[i + 2] = nb;
      d[i + 3] = o[i + 3];
      if (changed) n++;
    }
    commitLive(atlas);
    return n;
  }

  function applyRegionHslImmediate(key, dh, ds, dl, regionKey) {
    const rk = regionKey || selectedRegionKey;
    syncSelectedRegionMetaFromStore();
    if (!key || !rk || !selectedRegionMeta) {
      console.warn("[bone_morph] applyRegionHsl: need picked region");
      return { ok: false, pixels: 0 };
    }
    if (!meshColors[key] || typeof meshColors[key] !== "object") meshColors[key] = {};
    const entry = {
      mode: "hsl",
      dh: Number(dh) || 0,
      ds: Number(ds) || 0,
      dl: Number(dl) || 0,
      seedU: selectedRegionMeta.seedU,
      seedV: selectedRegionMeta.seedV,
      mirror: false,
      partMode: selectedRegionMeta.partMode || "colorClass",
      partKey: selectedRegionMeta.partKey,
      partLabel: selectedRegionMeta.partLabel,
    };
    meshColors[key][rk] = entry;
    scopeHsl.selected = { dh: entry.dh, ds: entry.ds, dl: entry.dl };
    const mesh = listMeshes().find((m) => meshKey(m) === key);
    if (!mesh?.userData?.bmAtlas) return { ok: false, pixels: 0 };
    const g = effectiveGlobalHslForMesh(mesh);
    const regions = meshColors[key];
    let regionN = 0;
    for (const id of Object.keys(regions || {})) {
      if (id !== "__layer__") regionN++;
    }
    // 仅当前一块、无全局偏移：只重绘该 mask（滑块最顺）
    if (regionN <= 1 && !g.dh && !g.ds && !g.dl) {
      const mask =
        mesh.userData.bmAtlas.masks[rk] || ensureRegionMask(mesh, rk, entry);
      if (!mask) return { ok: false, pixels: 0 };
      restoreMask(mesh, mask);
      paintMaskHslOnCurrent(mesh, mask, entry.dh, entry.ds, entry.dl);
      return { ok: true, pixels: maskPixelCount(mask) };
    }
    replayMeshColorsOnAtlas(mesh);
    const mask = mesh.userData.bmAtlas.masks?.[rk];
    const n = mask ? maskPixelCount(mask) : 0;
    return { ok: n > 0, pixels: n };
  }

  function applyRegionHsl(key, { dh = 0, ds = 0, dl = 0 } = {}, { regionKey = selectedRegionKey, notify = true, immediate = false } = {}) {
    const rk = regionKey || selectedRegionKey;
    syncSelectedRegionMetaFromStore();
    if (!key || !rk || !selectedRegionMeta) {
      console.warn("[bone_morph] applyRegionHsl: need picked region");
      return { ok: false, pixels: 0 };
    }
    if (immediate) {
      if (hslPaintRaf) {
        cancelAnimationFrame(hslPaintRaf);
        hslPaintRaf = 0;
        hslPaintQueued = null;
      }
      const r = applyRegionHslImmediate(key, dh, ds, dl, rk);
      if (notify) onChange();
      return r;
    }
    scheduleHslPaint({
      kind: "region",
      key,
      dh,
      ds,
      dl,
      regionKey: rk,
      notify,
    });
    return { ok: true, pixels: selectedRegionMeta.pixelCount || 0, deferred: true };
  }

  function cacheMeshes(rootObj) {
    meshCache = [];
    rootObj.updateWorldMatrix(true, true);
    rootObj.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (o.userData && o.userData.lmId != null) return;
      const pos = o.geometry.attributes.position;
      const restPos = new Float32Array(pos.count * 3);
      const v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        restPos[i * 3] = v.x;
        restPos[i * 3 + 1] = v.y;
        restPos[i * 3 + 2] = v.z;
      }
      if (!o.userData._morphLocalRest) {
        const local = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          local[i * 3] = pos.getX(i);
          local[i * 3 + 1] = pos.getY(i);
          local[i * 3 + 2] = pos.getZ(i);
        }
        o.userData._morphLocalRest = local;
      }
      meshCache.push({ mesh: o, restPos, count: pos.count });
    });
  }

  function restoreLocalRest() {
    for (const entry of meshCache) {
      const local = entry.mesh.userData._morphLocalRest;
      if (!local) continue;
      const attr = entry.mesh.geometry.attributes.position;
      for (let i = 0; i < entry.count; i++) {
        attr.setXYZ(i, local[i * 3], local[i * 3 + 1], local[i * 3 + 2]);
      }
      attr.needsUpdate = true;
      entry.mesh.geometry.computeVertexNormals();
    }
    // rebuild world rest cache from restored local
    if (root) cacheMeshes(root);
  }

  async function loadDefs() {
    const bust = `?_=${Date.now()}`;
    const [f, s, saved, parts] = await Promise.all([
      fetch(`landmarks/farkas_core.json${bust}`).then((r) => r.json()),
      fetch(`landmarks/semantic_sliders.json${bust}`).then((r) => r.json()),
      fetch(`landmarks/euro_morph_rest.json${bust}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`landmarks/semantic_parts.json${bust}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    farkas = f;
    sliderDefs = s;
    if (parts && typeof parts === "object") {
      semanticParts = {
        quantStep: Number(parts.quantStep) || 8,
        parts: parts.parts && typeof parts.parts === "object" ? parts.parts : {},
      };
    }
    for (const sl of sliderDefs.sliders || []) {
      if (sliderValues[sl.id] == null) sliderValues[sl.id] = sl.default ?? 0;
    }
    if (saved?.points && Object.keys(saved.points).length) {
      rest = {};
      for (const [id, p] of Object.entries(saved.points)) {
        rest[id] = [p[0], p[1], p[2]];
      }
      if (saved.customMeta) customMeta = saved.customMeta;
      if (saved.forwardSign != null) forwardSign = saved.forwardSign;
    }
  }

  async function loadSession() {
    try {
      const r = await fetch(`landmarks/euro_morph_session.json?_=${Date.now()}`);
      if (!r.ok) return;
      const data = await r.json();
      if (data.sliderValues) sliderValues = { ...sliderValues, ...data.sliderValues };
      if (data.xyzOffset) {
        xyzOffset = {};
        for (const [id, p] of Object.entries(data.xyzOffset)) {
          xyzOffset[id] = [p[0], p[1], p[2]];
        }
      }
      if (typeof data.mirrorLock === "boolean") mirrorLock = data.mirrorLock;
      if (data.meshColors) meshColors = normalizeMeshColors(data.meshColors);
      if (data.selectedMeshKey) selectedMeshKey = data.selectedMeshKey;
      if (data.selectedRegionKey) selectedRegionKey = data.selectedRegionKey;
      if (data.selectedRegionMeta && typeof data.selectedRegionMeta === "object") {
        selectedRegionMeta = { ...data.selectedRegionMeta };
      }
      if (data.hslScope === "selected" || data.hslScope === "muscles" || data.hslScope === "all") {
        hslScope = data.hslScope;
      }
      if (data.scopeHsl && typeof data.scopeHsl === "object") {
        scopeHsl = {
          selected: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.selected || {}) },
          muscles: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.muscles || {}) },
          all: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.all || {}) },
        };
      }
      syncSelectedRegionMetaFromStore();
      syncSelectedScopeHslFromStore();
    } catch (_) {
      /* ignore */
    }
  }

  async function saveJson(relPath, data) {
    const res = await fetch("/api/save-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, data }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  function seedFromRoot() {
    const staticMeshes = findStaticMeshes(root);
    const targets = staticMeshes.length ? staticMeshes : [findStaticMesh(root)].filter(Boolean);
    if (!targets.length) throw new Error("未找到 Static 网格");
    const pts = [];
    for (const m of targets) pts.push(...collectWorldPositions(m));
    const seeded = autoSeedRest(pts, farkas.landmarks);
    rest = { ...seeded.points };
    forwardSign = seeded.forwardSign;
    for (const id of Object.keys(rest)) {
      if (!rest[id]) delete rest[id];
    }
  }

  function setSelected(id) {
    selectedId = id || "";
    ensureMarkers();
    onChange();
  }

  function setSlider(id, value) {
    sliderValues[id] = value;
    scheduleApply();
  }

  function setXyz(id, dx, dy, dz, { mirror = mirrorLock } = {}) {
    xyzOffset[id] = [dx, dy, dz];
    if (mirror) {
      const p = pairOf(id);
      if (p && rest[p]) {
        xyzOffset[p] = [-dx, dy, dz];
      }
    }
    scheduleApply();
  }

  function resetMorph() {
    for (const s of sliderDefs.sliders || []) sliderValues[s.id] = s.default ?? 0;
    xyzOffset = {};
    restoreLocalRest();
    dirty = true;
    applyWarpNow();
    onChange();
  }

  function deletePoint(id) {
    if (!id) return;
    const p = pairOf(id);
    delete rest[id];
    delete xyzOffset[id];
    delete customMeta[id];
    if (p && customMeta[p]) {
      delete rest[p];
      delete xyzOffset[p];
      delete customMeta[p];
    }
    if (selectedId === id || selectedId === p) selectedId = "";
    ensureMarkers();
    scheduleApply();
  }

  function addPointAt(world, { symmetric = addSymmetric } = {}) {
    const ts = Date.now();
    if (symmetric) {
      const idL = `custom_${ts}_L`;
      const idR = `custom_${ts}_R`;
      rest[idL] = [world[0], world[1], world[2]];
      rest[idR] = [-world[0], world[1], world[2]];
      customMeta[idL] = { label: `自加L`, pair: idR, custom: true };
      customMeta[idR] = { label: `自加R`, pair: idL, custom: true };
      setSelected(idL);
    } else {
      const id = `custom_${ts}`;
      rest[id] = [world[0], world[1], world[2]];
      customMeta[id] = { label: `自加`, custom: true };
      setSelected(id);
    }
    ensureMarkers();
    scheduleApply();
  }

  function projectPointer(ev) {
    const rect = domEl.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function meshKey(mesh) {
    return mesh.name || mesh.uuid;
  }

  function listMeshes() {
    return meshCache.map((e) => e.mesh);
  }

  function captureOrigColors() {
    for (const mesh of listMeshes()) {
      const key = meshKey(mesh);
      if (meshOrigColors[key] != null) continue;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat && mat.color) meshOrigColors[key] = mat.color.getHex();
    }
  }

  function clearRegionColor(key, rk) {
    if (!key || !rk) return;
    if (meshColors[key]) {
      delete meshColors[key][rk];
      if (!Object.keys(meshColors[key]).length) delete meshColors[key];
    }
    scopeHsl.selected = { dh: 0, ds: 0, dl: 0 };
    replayMeshColorsOnAtlas();
  }

  /** @deprecated flat fill — kept for debug / legacy */
  function applyMeshColor(key, hex, opts = {}) {
    const rk = opts.regionKey || selectedRegionKey;
    if (!key || !rk || !selectedRegionMeta) return;
    if (!meshColors[key] || typeof meshColors[key] !== "object") meshColors[key] = {};
    const entry = {
      mode: "flat",
      hex,
      seedU: selectedRegionMeta.seedU,
      seedV: selectedRegionMeta.seedV,
      mirror: false,
      partMode: selectedRegionMeta.partMode || "colorClass",
      partKey: selectedRegionMeta.partKey,
      partLabel: selectedRegionMeta.partLabel,
    };
    meshColors[key][rk] = entry;
    const mesh = listMeshes().find((m) => meshKey(m) === key);
    if (mesh?.userData?.bmAtlas) delete mesh.userData.bmAtlas.masks[rk];
    replayMeshColorsOnAtlas();
    onChange();
  }

  function findMeshPairKey(key) {
    const swaps = [
      [/_L\b/i, "_R"],
      [/_R\b/i, "_L"],
      [/_l\b/, "_r"],
      [/_r\b/, "_l"],
      [/Left/i, "Right"],
      [/Right/i, "Left"],
      [/\.L\b/, ".R"],
      [/\.R\b/, ".L"],
      [/-L\b/, "-R"],
      [/-R\b/, "-L"],
    ];
    for (const [re, rep] of swaps) {
      if (!re.test(key)) continue;
      const cand = key.replace(re, rep);
      if (cand !== key && listMeshes().some((m) => meshKey(m) === cand)) return cand;
    }
    return null;
  }

  function highlightSelectedMesh() {
    for (const mesh of listMeshes()) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const on = meshKey(mesh) === selectedMeshKey;
      for (const mat of mats) {
        if (!mat) continue;
        if ("emissive" in mat) {
          mat.emissive.setHex(on ? 0x222200 : 0x000000);
          mat.needsUpdate = true;
        }
      }
    }
  }

  function setPickMuscleModeInternal(v) {
    pickMuscleMode = !!v;
    if (controls) {
      if (pickMuscleMode) {
        controlsSavedEnabled = controls.enabled;
        controls.enabled = false;
        if (domEl) domEl.style.cursor = "crosshair";
      } else {
        controls.enabled = controlsSavedEnabled;
        if (domEl) domEl.style.cursor = "";
      }
    }
  }

  /** 语义部件点选：贴面优先 + 肌层优先；整色类大小只做轻微偏好 */
  function meshPickScore(mesh, pick, dist, nearDist) {
    const n = (mesh.name || "").toLowerCase();
    let layer = 0;
    if (n.includes("skiedras")) layer = 5;
    else if (n.includes("deform")) layer = 4;
    else if (n.includes("plastyma") || n.includes("plasty")) layer = 4;
    else if (n.includes("static")) layer = 3;
    else if (n.includes("acs")) layer = 1;
    if (!pick) return -1e9;
    const px = pick.pixelCount || 0;
    if (px < 80) return -1e9;
    const depth = nearDist != null ? (dist - nearDist) * 2000 : dist * 80;
    const area = Math.min(40, Math.log10(Math.min(px, 200000) + 1) * 12);
    // 颈阔肌整层：贴面时优先于背后 Static
    let bonus = 0;
    if ((n.includes("plasty") || n.includes("plastyma")) && pick.regionId === "cq_plastyma_sheet") {
      bonus = 18;
    }
    return layer * 6 + area + bonus - depth;
  }

  /** 与点击选肌同一套打分，供自测复用 */
  function pickBestFromHits(hits, maxHits = 14) {
    const scored = [];
    let nearDist = Infinity;
    const candidates = [];
    for (const hit of hits.slice(0, maxHits)) {
      if (!hit.uv) continue;
      if (hit.distance < nearDist) nearDist = hit.distance;
    }
    for (const hit of hits.slice(0, maxHits)) {
      if (!hit.uv) continue;
      if (hit.distance > nearDist * 1.025 + 0.008) {
        candidates.push({ mesh: hit.object.name, dist: hit.distance, deep: true });
        continue;
      }
      const pick = samplePickAtUv(hit.object, hit.uv.x, hit.uv.y);
      if (!pick || pick.pixelCount < 80) {
        candidates.push({
          mesh: hit.object.name,
          dist: hit.distance,
          noPick: !pick,
          px: pick?.pixelCount || 0,
        });
        continue;
      }
      scored.push({ hit, pick });
    }
    let best = null;
    let bestScore = -1e9;
    for (const s of scored) {
      const score = meshPickScore(s.hit.object, s.pick, s.hit.distance, nearDist);
      candidates.push({
        mesh: s.hit.object.name,
        dist: s.hit.distance,
        px: s.pick.pixelCount,
        hex: s.pick.previewHex,
        partKey: s.pick.partKey,
        partLabel: s.pick.partLabel,
        score,
      });
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return { best, bestScore, candidates, nearDist };
  }

  function selectMeshByRay() {
    const meshes = listMeshes();
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return false;

    const { best, bestScore } = pickBestFromHits(hits);
    if (!best) {
      console.warn("[bone_morph] pick: no semantic colour part under cursor");
      return false;
    }

    const mesh = best.hit.object;
    selectedMeshKey = meshKey(mesh);
    selectedRegionKey = best.pick.regionId;
    selectedRegionMeta = {
      seedU: best.pick.seedU,
      seedV: best.pick.seedV,
      previewHex: best.pick.previewHex,
      pixelCount: best.pick.pixelCount,
      partKey: best.pick.partKey,
      partLabel: best.pick.partLabel,
      seedRgb: best.pick.seedRgb,
      partMode: "colorClass",
    };
    if (mesh.userData.bmAtlas) {
      mesh.userData.bmAtlas.masks[selectedRegionKey] = best.pick.mask;
    }
    highlightSelectedMesh();
    flashMask(mesh, best.pick.mask);
    setPickMuscleModeInternal(false);
    hslScope = "selected";
    syncSelectedScopeHslFromStore();
    syncSelectedRegionMetaFromStore();
    console.log(
      `[bone_morph] picked part ${best.pick.partLabel} ${selectedMeshKey} ${selectedRegionKey} px=${best.pick.pixelCount} ${best.pick.previewHex} score=${bestScore.toFixed(1)}`
    );
    onChange();
    return true;
  }

  /** Constrain free hit to world X/Y/Z relative to drag start. */
  function orthoConstrain(hit, drag) {
    const start = drag.startWorld;
    const dx = hit.x - start.x;
    const dy = hit.y - start.y;
    const dz = hit.z - start.z;
    let axis = drag.lockedAxis;
    if (axis == null) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const az = Math.abs(dz);
      const thresh = drag.thresh || 1e-5;
      if (ax < thresh && ay < thresh && az < thresh) {
        return start.clone();
      }
      if (ax >= ay && ax >= az) axis = 0;
      else if (ay >= az) axis = 1;
      else axis = 2;
      drag.lockedAxis = axis;
    }
    const out = start.clone();
    if (axis === 0) out.x = hit.x;
    else if (axis === 1) out.y = hit.y;
    else out.z = hit.z;
    return out;
  }

  function onPointerDown(ev) {
    if (!camera || !domEl || !root) return;
    projectPointer(ev);
    raycaster.setFromCamera(pointer, camera);

    const markerObjs = Object.values(markers);
    const hitsM = raycaster.intersectObjects(markerObjs, false);

    // 选部：仅 Alt+左键（普通点击留给旋转 / 锚点；控制点仍优先于选部）
    const wantPick = ev.altKey && ev.button === 0;

    // 选部优先：capture 阶段 + 暂禁旋转
    if (wantPick) {
      if (controls) {
        controlsSavedEnabled = controls.enabled;
        controls.enabled = false;
      }
      const ok = selectMeshByRay();
      ev.preventDefault();
      ev.stopPropagation();
      if (!ok) {
        onChange();
      }
      return;
    }

    if (hitsM.length) {
      const id = hitsM[0].object.userData.lmId;
      setSelected(id);
      const cur = targetOf(id) || rest[id];
      dragging = {
        id,
        mode: editRest ? "rest" : "xyz",
        startWorld: new T.Vector3(cur[0], cur[1], cur[2]),
        lockedAxis: null,
        thresh: markerRadius() * 0.15,
      };
      if (controls) controls.enabled = false;
      ev.preventDefault();
      return;
    }
    if (addMode) {
      const meshes = listMeshes();
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        const p = hits[0].point;
        addPointAt([p.x, p.y, p.z]);
        addMode = false;
        onChange();
      }
      ev.preventDefault();
    }
  }

  function onPointerMove(ev) {
    if (!dragging || !camera || !domEl) return;
    projectPointer(ev);
    raycaster.setFromCamera(pointer, camera);
    const id = dragging.id;
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new T.Vector3()).negate(),
      dragging.startWorld
    );
    const hit = new T.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const constrained = orthoConstrain(hit, dragging);
    if (dragging.mode === "rest") {
      const prev = rest[id].slice();
      rest[id] = [constrained.x, constrained.y, constrained.z];
      if (mirrorLock) {
        const p = pairOf(id);
        if (p && rest[p]) {
          const dx = constrained.x - prev[0];
          const dy = constrained.y - prev[1];
          const dz = constrained.z - prev[2];
          rest[p] = [rest[p][0] - dx, rest[p][1] + dy, rest[p][2] + dz];
        }
      }
      scheduleApply();
    } else {
      const r = rest[id];
      const sem = semanticDelta(id);
      const dx = constrained.x - r[0] - sem[0];
      const dy = constrained.y - r[1] - sem[1];
      const dz = constrained.z - r[2] - sem[2];
      setXyz(id, dx, dy, dz);
    }
    updateMarkerPositions();
  }

  function onPointerUp() {
    if (dragging && controls) controls.enabled = true;
    dragging = null;
    if (!pickMuscleMode && controls) {
      controls.enabled = controlsSavedEnabled;
    }
  }

  function bindInput() {
    if (!domEl) return;
    domEl.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function unbindInput() {
    if (domEl) domEl.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function snapshotData(label) {
    const points = {};
    for (const [id, p] of Object.entries(rest)) points[id] = [p[0], p[1], p[2]];
    const xyz = {};
    for (const [id, p] of Object.entries(xyzOffset)) xyz[id] = [p[0], p[1], p[2]];
    return {
      version: 1,
      label: label || "",
      createdAt: new Date().toISOString(),
      source: "euro_ref",
      forwardSign,
      points,
      customMeta: JSON.parse(JSON.stringify(customMeta)),
      sliderValues: { ...sliderValues },
      xyzOffset: xyz,
      mirrorLock,
      meshColors: JSON.parse(JSON.stringify(meshColors)),
      selectedId,
      selectedMeshKey,
      selectedRegionKey,
      hslScope,
      scopeHsl: JSON.parse(JSON.stringify(scopeHsl)),
    };
  }

  function applySnapshot(data) {
    if (!data) return;
    rest = {};
    if (data.points) {
      for (const [id, p] of Object.entries(data.points)) rest[id] = [p[0], p[1], p[2]];
    }
    customMeta = data.customMeta ? JSON.parse(JSON.stringify(data.customMeta)) : {};
    xyzOffset = {};
    if (data.xyzOffset) {
      for (const [id, p] of Object.entries(data.xyzOffset)) xyzOffset[id] = [p[0], p[1], p[2]];
    }
    sliderValues = { ...(data.sliderValues || {}) };
    for (const s of sliderDefs.sliders || []) {
      if (sliderValues[s.id] == null) sliderValues[s.id] = s.default ?? 0;
    }
    if (typeof data.mirrorLock === "boolean") mirrorLock = data.mirrorLock;
    if (data.forwardSign != null) forwardSign = data.forwardSign;
    selectedId = data.selectedId || "";
    selectedMeshKey = data.selectedMeshKey || "";
    selectedRegionKey = data.selectedRegionKey || "";
    if (data.hslScope === "selected" || data.hslScope === "muscles" || data.hslScope === "all") {
      hslScope = data.hslScope;
    }
    if (data.scopeHsl && typeof data.scopeHsl === "object") {
      scopeHsl = {
        selected: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.selected || {}) },
        muscles: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.muscles || {}) },
        all: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.all || {}) },
      };
    }
    // restore colors
    meshColors = normalizeMeshColors(data.meshColors || {});
    replayMeshColorsOnAtlas();
    restoreLocalRest();
    ensureMarkers();
    highlightSelectedMesh();
    dirty = true;
    applyWarpNow();
    onChange();
  }

  async function loadHistoryIndex() {
    try {
      const r = await fetch(`landmarks/euro_morph_history/index.json?_=${Date.now()}`);
      if (r.ok) historyIndex = await r.json();
      else historyIndex = { versions: [] };
    } catch (_) {
      historyIndex = { versions: [] };
    }
    if (!Array.isArray(historyIndex.versions)) historyIndex.versions = [];
  }

  async function saveHistoryVersion(label) {
    await loadHistoryIndex();
    const id = `v_${Date.now()}`;
    const data = snapshotData(label || `版本 ${historyIndex.versions.length + 1}`);
    data.id = id;
    const rel = `landmarks/euro_morph_history/${id}.json`;
    await saveJson(rel, data);
    historyIndex.versions.unshift({
      id,
      label: data.label,
      createdAt: data.createdAt,
      path: rel,
      pointCount: Object.keys(data.points || {}).length,
      sliderSummary: summarizeSliders(data.sliderValues),
    });
    await saveJson("landmarks/euro_morph_history/index.json", historyIndex);
    onChange();
    return id;
  }

  function summarizeSliders(vals) {
    const parts = [];
    for (const s of sliderDefs.sliders || []) {
      const v = vals?.[s.id] ?? 0;
      if (Math.abs(v) > 1e-6) parts.push(`${s.id}:${Number(v).toFixed(3)}`);
    }
    return parts.slice(0, 4).join(" ") || "中性";
  }

  async function loadHistoryVersion(id) {
    const meta = historyIndex.versions.find((v) => v.id === id);
    const path = meta?.path || `landmarks/euro_morph_history/${id}.json`;
    const r = await fetch(`${path}?_=${Date.now()}`);
    if (!r.ok) throw new Error("版本不存在");
    const data = await r.json();
    applySnapshot(data);
  }

  async function deleteHistoryVersion(id) {
    historyIndex.versions = historyIndex.versions.filter((v) => v.id !== id);
    await saveJson("landmarks/euro_morph_history/index.json", historyIndex);
    onChange();
  }

  function normalizeMeshColors(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") out[k] = { __layer__: v };
      else if (v && typeof v === "object") out[k] = { ...v };
    }
    return out;
  }

  async function attach({
    root: rootObj,
    scene: sc,
    camera: cam,
    domElement,
    controls: ctrl,
    onChange: cb,
  }) {
    await dispose();
    root = rootObj;
    scene = sc;
    camera = cam;
    domEl = domElement;
    controls = ctrl;
    onChange = cb || (() => {});
    await loadDefs();
    await loadSession();
    await loadHistoryIndex();
    uniquifyMaterials(root);
    cacheMeshes(root);
    captureOrigColors();
    await prepareAllAtlases(root);
    meshColors = normalizeMeshColors(meshColors);
    replayMeshColorsOnAtlas();
    syncSelectedRegionMetaFromStore();
    syncSelectedScopeHslFromStore();
    if (!Object.keys(rest).length) seedFromRoot();
    markerGroup = new T.Group();
    markerGroup.name = "bone_morph_markers";
    scene.add(markerGroup);
    ensureMarkers();
    if (!selectedId) {
      const ids = allPointIds().filter((id) => rest[id]);
      selectedId = ids[0] || "";
    }
    bindInput();
    applyWarpNow();
    onChange();
  }

  async function dispose() {
    unbindInput();
    if (rafApply) {
      cancelAnimationFrame(rafApply);
      rafApply = 0;
    }
    if (markerGroup && scene) {
      scene.remove(markerGroup);
      markerGroup = null;
    }
    markers = {};
    meshCache = [];
    root = null;
    warpFn = null;
    selectedMeshKey = "";
  }

  async function saveRest() {
    const points = {};
    for (const [id, p] of Object.entries(rest)) points[id] = [p[0], p[1], p[2]];
    await saveJson("landmarks/euro_morph_rest.json", {
      version: 1,
      source: "euro_ref",
      forwardSign,
      points,
      customMeta,
      note: "Rest landmarks on euro Static (Farkas + custom). Edit in morph mode.",
    });
  }

  async function saveSession() {
    syncSelectedRegionMetaFromStore();
    await saveJson("landmarks/euro_morph_session.json", {
      version: 1,
      sliderValues,
      xyzOffset,
      mirrorLock,
      selectedId,
      meshColors,
      selectedMeshKey,
      selectedRegionKey,
      selectedRegionMeta,
      hslScope,
      scopeHsl,
    });
  }

  function getActiveHsl() {
    if (hslScope === "selected") {
      const regionEntry = normalizeRegionEntry(
        selectedMeshKey && selectedRegionKey
          ? meshColors[selectedMeshKey]?.[selectedRegionKey]
          : null
      );
      if (regionEntry?.mode === "hsl") {
        return {
          dh: regionEntry.dh || 0,
          ds: regionEntry.ds || 0,
          dl: regionEntry.dl || 0,
        };
      }
      return { ...(scopeHsl.selected || { dh: 0, ds: 0, dl: 0 }) };
    }
    return { ...(scopeHsl[hslScope] || { dh: 0, ds: 0, dl: 0 }) };
  }

  function getState() {
    const meshes = listMeshes().map((m) => {
      const key = meshKey(m);
      const regions = meshColors[key];
      let color = null;
      if (regions && typeof regions === "object") {
        const cur = selectedMeshKey === key && selectedRegionKey ? regions[selectedRegionKey] : null;
        color =
          (cur && (typeof cur === "string" ? cur : cur.hex || cur.previewHex)) ||
          regions.__layer__ ||
          null;
      }
      return {
        key,
        name: m.name || "(unnamed)",
        pair: findMeshPairKey(key),
        color,
        isMuscleLayer: isMuscleLayerMesh(m),
        hasAtlas: !!m.userData?.bmAtlas,
      };
    });
    const regionHsl = getActiveHsl();
    return {
      farkas,
      sliderDefs,
      rest,
      xyzOffset,
      sliderValues,
      customMeta,
      mirrorLock,
      selectedId,
      editRest,
      addMode,
      addSymmetric,
      pickMuscleMode,
      selectedMeshKey,
      selectedRegionKey,
      selectedRegionHex: selectedRegionMeta?.previewHex || "",
      selectedRegionPixels: selectedRegionMeta?.pixelCount || 0,
      selectedPartKey: selectedRegionMeta?.partKey || "",
      selectedPartLabel: selectedRegionMeta?.partLabel || "",
      regionHsl,
      hslScope,
      scopeHsl: {
        selected: { ...(scopeHsl.selected || { dh: 0, ds: 0, dl: 0 }) },
        muscles: { ...(scopeHsl.muscles || { dh: 0, ds: 0, dl: 0 }) },
        all: { ...(scopeHsl.all || { dh: 0, ds: 0, dl: 0 }) },
      },
      meshColors,
      meshes,
      history: historyIndex.versions.slice(),
      pointIds: allPointIds().filter((id) => rest[id]),
      targetOf,
      hasRest: Object.keys(rest).length > 0,
      dragAxisHint: dragging?.lockedAxis != null ? AXIS_NAME[dragging.lockedAxis] : null,
    };
  }

  return {
    attach,
    dispose,
    getState,
    setSelected,
    setSlider,
    setXyz,
    resetMorph,
    deletePoint,
    setMirrorLock(v) {
      mirrorLock = !!v;
      onChange();
    },
    setEditRest(v) {
      editRest = !!v;
      onChange();
    },
    setAddMode(v, symmetric = true) {
      addMode = !!v;
      addSymmetric = !!symmetric;
      if (v) setPickMuscleModeInternal(false);
      onChange();
    },
    setPickMuscleMode(v) {
      setPickMuscleModeInternal(!!v);
      if (v) addMode = false;
      onChange();
    },
    setSelectedMeshColor(hex) {
      if (!selectedMeshKey || !selectedRegionKey) return;
      applyMeshColor(selectedMeshKey, hex);
    },
    setHslScope(scope) {
      if (scope !== "selected" && scope !== "muscles" && scope !== "all") return;
      hslScope = scope;
      onChange();
    },
    setScopeHsl(dh, ds, dl, opts = {}) {
      const notify = opts.notify !== false;
      const immediate = opts.immediate === true;
      if (hslScope === "selected") {
        syncSelectedRegionMetaFromStore();
        if (!selectedMeshKey || !selectedRegionKey || !selectedRegionMeta) {
          return { ok: false, reason: "need pick" };
        }
        return applyRegionHsl(
          selectedMeshKey,
          { dh, ds, dl },
          { notify, immediate }
        );
      }
      if (immediate) {
        if (hslPaintRaf) {
          cancelAnimationFrame(hslPaintRaf);
          hslPaintRaf = 0;
          hslPaintQueued = null;
        }
        scopeHsl[hslScope] = {
          dh: Number(dh) || 0,
          ds: Number(ds) || 0,
          dl: Number(dl) || 0,
        };
        replayMeshColorsOnAtlas();
        if (notify) onChange();
        return { ok: true, scope: hslScope, ...scopeHsl[hslScope] };
      }
      scheduleHslPaint({
        kind: "scope",
        scope: hslScope,
        dh: Number(dh) || 0,
        ds: Number(ds) || 0,
        dl: Number(dl) || 0,
        notify,
      });
      return {
        ok: true,
        scope: hslScope,
        dh: Number(dh) || 0,
        ds: Number(ds) || 0,
        dl: Number(dl) || 0,
        deferred: true,
      };
    },
    setSelectedRegionHsl(dh, ds, dl, opts = {}) {
      if (!selectedMeshKey || !selectedRegionKey) return { ok: false };
      return applyRegionHsl(
        selectedMeshKey,
        { dh, ds, dl },
        { notify: opts.notify !== false }
      );
    },
    clearSelectedMeshColor() {
      if (hslScope === "selected") {
        if (!selectedMeshKey || !selectedRegionKey) return;
        clearRegionColor(selectedMeshKey, selectedRegionKey);
        onChange();
        return;
      }
      scopeHsl[hslScope] = { dh: 0, ds: 0, dl: 0 };
      replayMeshColorsOnAtlas();
      onChange();
    },
    /** 自测：统计各 mesh 在指定 scope 下非黑像素被改动数 */
    debugCountScopePaint(scope, dh = 0.25) {
      const prevScope = hslScope;
      const prev = JSON.parse(JSON.stringify(scopeHsl));
      const prevColors = JSON.parse(JSON.stringify(meshColors));
      hslScope = scope;
      if (scope === "selected") {
        hslScope = prevScope;
        scopeHsl = prev;
        meshColors = prevColors;
        return { ok: false, reason: "use pick path" };
      }
      scopeHsl = {
        selected: { dh: 0, ds: 0, dl: 0 },
        muscles: { dh: 0, ds: 0, dl: 0 },
        all: { dh: 0, ds: 0, dl: 0 },
      };
      scopeHsl[scope] = { dh, ds: 0, dl: 0 };
      meshColors = {};
      replayMeshColorsOnAtlas();
      const perMesh = [];
      for (const mesh of listMeshes()) {
        const atlas = mesh?.userData?.bmAtlas;
        if (!atlas) continue;
        const img = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
        const o = atlas.orig.data;
        let changed = 0;
        let nonBlack = 0;
        for (let i = 0; i < o.length; i += 4) {
          if (isNearBlack(o[i], o[i + 1], o[i + 2])) continue;
          nonBlack++;
          if (img[i] !== o[i] || img[i + 1] !== o[i + 1] || img[i + 2] !== o[i + 2]) {
            changed++;
          }
        }
        perMesh.push({
          name: mesh.name,
          isMuscle: isMuscleLayerMesh(mesh),
          nonBlack,
          changed,
        });
      }
      // restore
      hslScope = prevScope;
      scopeHsl = prev;
      meshColors = prevColors;
      replayMeshColorsOnAtlas();
      return { ok: true, scope, dh, perMesh };
    },
    reseed() {
      seedFromRoot();
      xyzOffset = {};
      for (const s of sliderDefs.sliders || []) sliderValues[s.id] = s.default ?? 0;
      restoreLocalRest();
      ensureMarkers();
      applyWarpNow();
      onChange();
    },
    saveRest,
    saveSession,
    saveHistoryVersion,
    loadHistoryVersion,
    deleteHistoryVersion,
    loadHistoryIndex,
    scheduleApply,
    getRoot: () => root,
    markerGroup: () => markerGroup,
    /** 自测/调试：在 NDC 点选并返回结果 */
    debugPickAtNdc(nx, ny) {
      if (!camera || !root) return { ok: false, reason: "not ready" };
      pointer.x = nx;
      pointer.y = ny;
      raycaster.setFromCamera(pointer, camera);
      const ok = selectMeshByRay();
      const st = getState();
      return {
        ok,
        selectedMeshKey: st.selectedMeshKey,
        selectedRegionKey: st.selectedRegionKey,
        selectedRegionHex: st.selectedRegionHex,
        selectedRegionPixels: st.selectedRegionPixels,
      };
    },
    debugPaintSelected(hex) {
      if (!selectedMeshKey || !selectedRegionKey) return { ok: false };
      applyMeshColor(selectedMeshKey, hex);
      const mesh = listMeshes().find((m) => meshKey(m) === selectedMeshKey);
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas) return { ok: false, reason: "no atlas" };
      const [tr, tg, tb] = hexToRgb255(hex);
      const img = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      let n = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (
          Math.abs(img[i] - tr) < 8 &&
          Math.abs(img[i + 1] - tg) < 8 &&
          Math.abs(img[i + 2] - tb) < 8
        ) {
          n++;
        }
      }
      return { ok: n > 0, pixels: n, hex };
    },
    /** 自测：HSL 偏移后选区内 RGB 不全相同，且明度方差接近原图 */
    debugHslPreserve(dh = 0.2, ds = 0, dl = 0) {
      if (!selectedMeshKey || !selectedRegionKey || !selectedRegionMeta) {
        return { ok: false, reason: "no pick" };
      }
      const mesh = listMeshes().find((m) => meshKey(m) === selectedMeshKey);
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas) return { ok: false, reason: "no atlas" };
      const entry = {
        mode: "hsl",
        dh: 0,
        ds: 0,
        dl: 0,
        seedU: selectedRegionMeta.seedU,
        seedV: selectedRegionMeta.seedV,
      };
      const mask = ensureRegionMask(mesh, selectedRegionKey, entry);
      if (!mask) return { ok: false, reason: "no mask" };
      const o = atlas.orig.data;
      let n = 0;
      let sumL0 = 0;
      let sumL02 = 0;
      const uniq0 = new Set();
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        const hsl = rgbToHsl(o[i], o[i + 1], o[i + 2]);
        sumL0 += hsl.l;
        sumL02 += hsl.l * hsl.l;
        uniq0.add(`${o[i]},${o[i + 1]},${o[i + 2]}`);
        n++;
      }
      if (n < 80) return { ok: false, reason: "tiny mask", n };
      const mean0 = sumL0 / n;
      const var0 = sumL02 / n - mean0 * mean0;

      applyRegionHsl(selectedMeshKey, { dh, ds, dl }, { notify: false });
      const img = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      let sumL1 = 0;
      let sumL12 = 0;
      const uniq1 = new Set();
      let changed = 0;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        const hsl = rgbToHsl(img[i], img[i + 1], img[i + 2]);
        sumL1 += hsl.l;
        sumL12 += hsl.l * hsl.l;
        uniq1.add(`${img[i]},${img[i + 1]},${img[i + 2]}`);
        if (
          img[i] !== o[i] ||
          img[i + 1] !== o[i + 1] ||
          img[i + 2] !== o[i + 2]
        ) {
          changed++;
        }
      }
      const mean1 = sumL1 / n;
      const var1 = sumL12 / n - mean1 * mean1;
      const flat = uniq1.size < 3;
      const varRatio = var0 > 1e-6 ? var1 / var0 : 1;
      clearRegionColor(selectedMeshKey, selectedRegionKey);

      return {
        ok: !flat && changed > n * 0.5 && varRatio > 0.5 && varRatio < 1.6,
        n,
        uniqOrig: uniq0.size,
        uniqAfter: uniq1.size,
        var0,
        var1,
        varRatio,
        changed,
        flat,
      };
    },
    /** 自测：在 Deform 贴图上找两块色差足够大的连通域，改 A 不得染 B */
    debugIsolationProbe(meshNameSubstr = "Deform") {
      const mesh = listMeshes().find((m) => (m.name || "").includes(meshNameSubstr));
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas) return { ok: false, reason: "no atlas" };
      const { w, h, orig } = atlas;
      const o = orig.data;
      function hexDist(h0, h1) {
        const p = (h) => [
          parseInt(h.slice(1, 3), 16),
          parseInt(h.slice(3, 5), 16),
          parseInt(h.slice(5, 7), 16),
        ];
        const a = p(h0);
        const b = p(h1);
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      }
      const seen = new Map(); // hex -> {u,v,px,mask,cx,cy}
      const step = Math.max(8, Math.floor(Math.min(w, h) / 48));
      for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {
          const i = (y * w + x) * 4;
          const r = o[i];
          const g = o[i + 1];
          const b = o[i + 2];
          if (isNearBlack(r, g, b)) continue;
          const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
          if (seen.has(hex)) continue;
          const mask = floodMaskFromSeed(atlas, x, y);
          if (!mask) continue;
          const px = maskPixelCount(mask);
          if (px < 200 || px > w * h * 0.25) continue;
          let sx = 0;
          let sy = 0;
          for (let p = 0; p < mask.length; p++) {
            if (!mask[p]) continue;
            sx += p % w;
            sy += Math.floor(p / w);
          }
          seen.set(hex, {
            hex,
            seedX: x,
            seedY: y,
            u: x / w,
            v: y / h,
            px,
            cx: sx / px,
            cy: sy / px,
            mask,
          });
          if (seen.size >= 40) break;
        }
        if (seen.size >= 40) break;
      }
      const regions = [...seen.values()].sort((a, b) => b.px - a.px);
      if (regions.length < 2) {
        return { ok: false, reason: "need ≥2 regions", found: regions.length };
      }

      let best = null;
      for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
          const A = regions[i];
          const B = regions[j];
          if (hexDist(A.hex, B.hex) < 18) continue; // 必须明显不同色
          const dist = Math.hypot(A.cx - B.cx, A.cy - B.cy);
          let overlap = 0;
          for (let p = 0; p < A.mask.length; p++) {
            if (A.mask[p] && B.mask[p]) overlap++;
          }
          if (overlap > 0) continue;
          const score = (1 / (1 + dist / 80)) * Math.min(A.px, B.px);
          if (!best || score > best.score) best = { A, B, dist, overlap, score };
        }
      }
      if (!best) {
        return {
          ok: false,
          reason: "no disjoint far-color pair",
          regionCount: regions.length,
        };
      }

      const { A, B, dist } = best;
      const bSamples = [];
      for (let p = 0; p < B.mask.length; p++) {
        if (!B.mask[p]) continue;
        const i = p * 4;
        bSamples.push(p, o[i], o[i + 1], o[i + 2]);
        if (bSamples.length > 4000) break;
      }

      selectedMeshKey = meshKey(mesh);
      selectedRegionKey = makeRegionId(A.u, A.v);
      selectedRegionMeta = {
        seedU: A.u,
        seedV: A.v,
        seedX: A.seedX,
        seedY: A.seedY,
        regionId: selectedRegionKey,
        previewHex: A.hex,
        mask: A.mask,
        pixelCount: A.px,
      };
      if (mesh.userData.bmAtlas) mesh.userData.bmAtlas.masks = {};
      applyMeshColor(selectedMeshKey, "#ff00aa");

      const img = atlas.ctx.getImageData(0, 0, w, h).data;
      let bleed = 0;
      for (let s = 0; s < bSamples.length; s += 4) {
        const p = bSamples[s];
        const i = p * 4;
        if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 170) bleed++;
      }
      let paintedA = 0;
      for (let p = 0; p < A.mask.length; p++) {
        if (!A.mask[p]) continue;
        const i = p * 4;
        if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 170) paintedA++;
      }

      restoreEntireAtlas(mesh);
      if (meshColors[selectedMeshKey]) {
        delete meshColors[selectedMeshKey][selectedRegionKey];
      }
      if (mesh.userData.bmAtlas) mesh.userData.bmAtlas.masks = {};

      return {
        ok: bleed === 0 && paintedA > 80,
        bleed,
        paintedA,
        regionA: { hex: A.hex, px: A.px, u: A.u, v: A.v },
        regionB: { hex: B.hex, px: B.px, u: B.u, v: B.v },
        distPx: dist,
        regionCount: regions.length,
      };
    },
    /**
     * 针对「颞肌 ↔ 帽状腱膜」类问题：
     * 在 3D 上各找一块偏绿肌 / 偏米黄腱膜区，改肌不得染腱膜。
     */
    debugTemporalisGaleaIsolation() {
      const picks = [];
      for (let y = 0.75; y >= -0.1; y -= 0.09) {
        for (let x = -0.55; x <= 0.55; x += 0.07) {
          pointer.x = x;
          pointer.y = y;
          if (!camera || !root) continue;
          raycaster.setFromCamera(pointer, camera);
          const ok = selectMeshByRay();
          if (!ok) continue;
          const st = getState();
          picks.push({
            nx: x,
            ny: y,
            hex: st.selectedRegionHex,
            px: st.selectedRegionPixels,
            rid: st.selectedRegionKey,
            key: st.selectedMeshKey,
          });
        }
      }
      function parse(h) {
        return [
          parseInt(h.slice(1, 3), 16),
          parseInt(h.slice(3, 5), 16),
          parseInt(h.slice(5, 7), 16),
        ];
      }
      // 绿系肌 / 米黄腱膜启发式
      const muscle = picks
        .filter((p) => {
          const [r, g, b] = parse(p.hex || "#000");
          return g > r + 20 && g > b + 10 && p.px > 400 && p.px < 90000;
        })
        .sort((a, b) => a.px - b.px)[0];
      const galea = picks
        .filter((p) => {
          const [r, g, b] = parse(p.hex || "#000");
          return r > 200 && g > 180 && b < 180 && p.px > 400 && p.px < 220000;
        })
        .sort((a, b) => a.px - b.px)[0];
      if (!muscle || !galea) {
        return {
          ok: false,
          reason: "missing muscle/galea candidate",
          muscle,
          galea,
          pickN: picks.length,
        };
      }

      // Snapshot galea mask
      pointer.x = galea.nx;
      pointer.y = galea.ny;
      raycaster.setFromCamera(pointer, camera);
      selectMeshByRay();
      const stG = getState();
      const mesh = listMeshes().find((m) => meshKey(m) === stG.selectedMeshKey);
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas) return { ok: false, reason: "no atlas" };
      const maskG = atlas.masks[stG.selectedRegionKey];
      if (!maskG) return { ok: false, reason: "no galea mask" };
      const o = atlas.orig.data;
      const samples = [];
      for (let p = 0; p < maskG.length; p++) {
        if (!maskG[p]) continue;
        const i = p * 4;
        samples.push([p, o[i], o[i + 1], o[i + 2]]);
        if (samples.length > 10000) break;
      }

      clearRegionColor(selectedMeshKey, selectedRegionKey);
      // 若上次选中不是同一 mesh，整图恢复更稳
      restoreEntireAtlas(mesh);
      if (mesh.userData.bmAtlas) mesh.userData.bmAtlas.masks = {};

      pointer.x = muscle.nx;
      pointer.y = muscle.ny;
      raycaster.setFromCamera(pointer, camera);
      selectMeshByRay();
      applyMeshColor(selectedMeshKey, "#ff00aa");
      const img = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      let bleed = 0;
      for (const [p] of samples) {
        const i = p * 4;
        if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 170) bleed++;
      }
      const painted = (() => {
        let n = 0;
        for (let i = 0; i < img.length; i += 4) {
          if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 170) n++;
        }
        return n;
      })();

      // restore
      restoreEntireAtlas(mesh);
      meshColors = {};
      atlas.masks = {};
      selectedRegionKey = null;
      selectedRegionMeta = null;
      onChange();

      return {
        ok: bleed === 0 && painted > 80,
        bleed,
        painted,
        muscle,
        galea,
      };
    },
    /**
     * 自测：中灰颈肌必须可调；近白/浅冷灰头骨不可调；灰区无彩虹斑驳。
     */
    debugBoneAndMottleProbe(ds = 0.35) {
      const prevScope = hslScope;
      const prev = JSON.parse(JSON.stringify(scopeHsl));
      const prevColors = JSON.parse(JSON.stringify(meshColors));
      hslScope = "all";
      scopeHsl = {
        selected: { dh: 0, ds: 0, dl: 0 },
        muscles: { dh: 0, ds: 0, dl: 0 },
        all: { dh: -55 / 360, ds, dl: -0.1 },
      };
      meshColors = {};
      replayMeshColorsOnAtlas();

      let boneTotal = 0;
      let boneChanged = 0;
      let midGrayTotal = 0;
      let midGrayChanged = 0;
      const grayHueCounts = new Map();

      for (const mesh of listMeshes()) {
        if (!mesh.userData?.bmAtlas) continue;
        const atlas = mesh.userData.bmAtlas;
        const o = atlas.orig.data;
        const img = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
        for (let i = 0; i < o.length; i += 4) {
          if (isNearBlack(o[i], o[i + 1], o[i + 2])) continue;
          const hsl = rgbToHsl(o[i], o[i + 1], o[i + 2]);
          const changed =
            img[i] !== o[i] || img[i + 1] !== o[i + 1] || img[i + 2] !== o[i + 2];
          if (isBonePale(o[i], o[i + 1], o[i + 2], hsl, mesh)) {
            boneTotal++;
            if (changed) boneChanged++;
            continue;
          }
          // 仅统计走灰肌路径的像素（s<0.2），与 shiftPixelHsl 一致
          if (hsl.s < 0.2 && hsl.l >= 0.35 && hsl.l < 0.76) {
            midGrayTotal++;
            if (changed) {
              midGrayChanged++;
              const h2 = rgbToHsl(img[i], img[i + 1], img[i + 2]);
              if (h2.s >= 0.08) {
                const bin = Math.round(h2.h * 18);
                grayHueCounts.set(bin, (grayHueCounts.get(bin) || 0) + 1);
              }
            }
          }
        }
      }

      hslScope = prevScope;
      scopeHsl = prev;
      meshColors = prevColors;
      replayMeshColorsOnAtlas();

      let hueN = 0;
      let hueMax = 0;
      for (const n of grayHueCounts.values()) {
        hueN += n;
        if (n > hueMax) hueMax = n;
      }
      const boneOk = boneTotal > 500 && boneChanged / boneTotal < 0.02;
      const muscleOk = midGrayTotal > 500 && midGrayChanged / midGrayTotal > 0.85;
      const mottleOk = hueN < 100 || hueMax / hueN >= 0.85;
      return {
        ok: boneOk && muscleOk && mottleOk,
        boneTotal,
        boneChanged,
        boneChangeRate: boneTotal ? boneChanged / boneTotal : 0,
        midGrayTotal,
        midGrayChanged,
        midGrayChangeRate: midGrayTotal ? midGrayChanged / midGrayTotal : 0,
        grayHueBins: grayHueCounts.size,
        grayHueDominance: hueN ? hueMax / hueN : 1,
        boneOk,
        muscleOk,
        mottleOk,
      };
    },
    debugGrayCoverageProbe() {
      const meshes = listMeshes().filter((m) => {
        const n = (m.name || "").toLowerCase();
        return (
          (n.includes("deform") || n.includes("static")) && m.userData?.bmAtlas
        );
      });
      const results = [];
      for (const mesh of meshes) {
        const atlas = mesh.userData.bmAtlas;
        const { w, h, orig } = atlas;
        const o = orig.data;
        const step = Math.max(6, Math.floor(Math.min(w, h) / 40));
        let best = null;
        for (let y = step; y < h - step; y += step) {
          for (let x = step; x < w - step; x += step) {
            const i = (y * w + x) * 4;
            if (isNearBlack(o[i], o[i + 1], o[i + 2])) continue;
            const hsl = rgbToHsl(o[i], o[i + 1], o[i + 2]);
            if (hsl.s >= 0.12) continue;
            const mask = floodMaskFromSeed(atlas, x, y);
            if (!mask) continue;
            const px = maskPixelCount(mask);
            if (px < 800) continue;
            let minL = 1;
            let maxL = 0;
            const uniq = new Set();
            for (let p = 0; p < mask.length; p++) {
              if (!mask[p]) continue;
              const j = p * 4;
              const c = rgbToHsl(o[j], o[j + 1], o[j + 2]);
              if (c.l < minL) minL = c.l;
              if (c.l > maxL) maxL = c.l;
              uniq.add(`${o[j]},${o[j + 1]},${o[j + 2]}`);
            }
            const cand = {
              mesh: mesh.name,
              px,
              uniq: uniq.size,
              lRange: maxL - minL,
              seedL: hsl.l,
              seed: [x, y],
            };
            if (!best || cand.px > best.px) best = cand;
          }
        }
        if (best) results.push(best);
      }
      const top = results.sort((a, b) => b.px - a.px)[0];
      if (!top) return { ok: false, reason: "no gray region", results };
      // 宽明度 + 多样本色 = 非整块碎岛
      const ok = top.px >= 5000 && top.uniq >= 40 && top.lRange >= 0.18;
      return { ok, top, results };
    },
    debugAtlasStats(meshNameSubstr = "Deform") {
      const mesh = listMeshes().find((m) => (m.name || "").includes(meshNameSubstr));
      if (!mesh?.userData?.bmAtlas) return null;
      const a = mesh.userData.bmAtlas;
      return {
        name: mesh.name,
        w: a.w,
        h: a.h,
        flipY: !!a.tex.flipY,
        hasOrig: !!a.orig,
      };
    },
    /**
     * 自测：屏幕 NDC(0..1 顶左) 射线，返回命中 mesh 与 atlas 原/当前色。
     */
    debugPickAtNdc(nx, ny) {
      if (!camera || !root) return { err: "no camera/root" };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const meshes = listMeshes().filter((m) => m.visible);
      const hits = raycaster.intersectObjects(meshes, false);
      return hits.slice(0, 8).map((h) => {
        const mesh = h.object;
        const atlas = mesh.userData?.bmAtlas;
        let atlasRgb = null;
        let origRgb = null;
        if (atlas && h.uv) {
          const flipY = !!atlas.tex.flipY;
          const x = Math.min(atlas.w - 1, Math.max(0, Math.floor(h.uv.x * atlas.w)));
          const y = Math.min(
            atlas.h - 1,
            Math.max(0, Math.floor((flipY ? 1 - h.uv.y : h.uv.y) * atlas.h))
          );
          const i = (y * atlas.w + x) * 4;
          const cur = atlas.ctx.getImageData(x, y, 1, 1).data;
          atlasRgb = [cur[0], cur[1], cur[2], cur[3]];
          origRgb = [
            atlas.orig.data[i],
            atlas.orig.data[i + 1],
            atlas.orig.data[i + 2],
            atlas.orig.data[i + 3],
          ];
        }
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        return {
          mesh: mesh.name,
          dist: h.distance,
          uv: h.uv ? [h.uv.x, h.uv.y] : null,
          atlasRgb,
          origRgb,
          transparent: !!mat?.transparent,
          opacity: mat?.opacity,
          depthWrite: mat?.depthWrite,
        };
      });
    },
    /** 自测：在 NDC 处按语义色块选肌逻辑取最优部件 */
    debugFloodPickAtNdc(nx, ny) {
      if (!camera || !root) return { err: "no camera/root" };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const meshes = listMeshes().filter((m) => m.visible);
      const hits = raycaster.intersectObjects(meshes, false);
      const { best, bestScore, candidates } = pickBestFromHits(hits);
      if (!best) return { best: null, candidates };
      return {
        best: {
          mesh: best.hit.object.name,
          key: meshKey(best.hit.object),
          dist: best.hit.distance,
          px: best.pick.pixelCount,
          hex: best.pick.previewHex,
          partKey: best.pick.partKey,
          partLabel: best.pick.partLabel,
          regionId: best.pick.regionId,
          seedU: best.pick.seedU,
          seedV: best.pick.seedV,
          score: bestScore,
        },
        candidates,
      };
    },
  };
}
