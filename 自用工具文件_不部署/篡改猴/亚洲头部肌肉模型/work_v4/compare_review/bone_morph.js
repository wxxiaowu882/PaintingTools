/**
 * Euro bone morph (V1): Farkas landmarks + semantic sliders → one TPS field on all meshes.
 * Rest on euro Static; target = rest + semantic + per-point XYZ. No SHELL bbox align.
 */
import * as THREE from "three";
import { synthIslandJob } from "./vendor/texture-quilt/island-synth-job.js";
import { renormalizeNormalPixels, synthOrientedFiberExemplar } from "./vendor/texture-quilt/fiber-warp.js";

const AXIS_I = { x: 0, y: 1, z: 2 };
const BM_BUILD_ID = "sculpt-brush-20260908ag";
const BRUSH_LS_KEY = "compare_review_sculpt_brush_v29";
const ISLAND_FLASH_MS = 680;
const ISLAND_FLASH_STYLE = { color: 0xffea00, opacity: 0.62 };
const ISLAND_PREVIEW_SIZE = 112;
const MAX_ISLAND_PREVIEW_SLOTS = 12;
const EAR_REF_HEAD_HEIGHT = 0.24;

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
  let markersUiVisible = true;
  let warpFn = null;
  let dirty = true;
  let rafApply = 0;
  let forwardSign = 1;
  /** Per-project storage root, e.g. projects/p_20260829_xxx */
  let projectStorageBase = "";

  function pathRest() {
    return projectStorageBase ? `${projectStorageBase}/rest.json` : "landmarks/euro_morph_rest.json";
  }
  function pathHistoryIndex() {
    return projectStorageBase
      ? `${projectStorageBase}/history/index.json`
      : "landmarks/euro_morph_history/index.json";
  }
  function pathHistoryVersion(id) {
    return projectStorageBase
      ? `${projectStorageBase}/history/${id}.json`
      : `landmarks/euro_morph_history/${id}.json`;
  }

  function setProjectStorage(projectId) {
    projectStorageBase = projectId ? `projects/${projectId}` : "";
    historyIndex = { versions: [] };
  }

  function getProjectStorage() {
    return projectStorageBase;
  }

  let scene = null;
  let camera = null;
  let domEl = null;
  let controls = null;
  let raycaster = new T.Raycaster();
  let pointer = new T.Vector2();
  let dragging = null;
  let addMode = false;
  let addSymmetric = true;
  let brushMode = false;
  /** 世界坐标半径 */
  let brushRadius = 0.02;
  /** 0=硬边圆盘 … 1=中心强、边缘柔 */
  let brushSoftness = 0.88;
  /** 相对半径的每笔位移比例 */
  let brushStrength = 0.22;
  /** +1 堆料 / -1 减料 */
  let brushSign = 1;
  let brushing = false;
  let brushLastStamp = null; // Vector3 | null
  let brushPreview = null;
  let brushPreviewMat = null;
  /** 笔刷抬笔撤销：存「笔画开始前」的 restPos 快照 */
  let brushUndoStack = [];
  const BRUSH_UNDO_MAX = 20;
  /** 当前拖刷开始前的快照（抬笔时入栈） */
  let brushStrokeBaseline = null;
  let brushStrokeTouched = false;
  /** @type {"warp"|"move"|"addSym"|"addAsym"|"brush"} */
  // Derived from editRest/addMode/brushMode; kept in sync via setAnchorToolMode.
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
  /** 语义部件目录树（整件变色，非颜色 flood） */
  let anatomyCatalog = { quantStep: 8, tree: [] };
  let anatomyPartTree = [];
  let selectedAnatomyPartId = "";
  let anatomyColorIndex = new Map();
  let historyIndex = { versions: [] };
  let onChange = () => {};
  let controlsSavedEnabled = true;
  let showSelectionOverlay = false;
  /** 工程级预烘焙整耳选区：后台分步构建，Alt 点耳读缓存 */
  let earPickCache = { L: null, R: null };
  let earPickCacheReady = false;
  let earCacheRebuildTimer = 0;
  let earCacheBuildJob = null;

  /** Part tree: scene-graph rigid translate */
  let partNodes = new Map(); // uuid -> { object, restPos: Vector3 }
  let partTree = [];
  let partChecked = new Set();
  /** 设色：几何孤岛 token = meshKey::gi_N */
  let islandChecked = new Set();
  /** 仅闪一下期间非空，结束后自动清空 */
  let islandHighlightToken = "";
  /** Alt+点 / 点行：树节点持续高亮，直到点其它孤岛或空白 */
  let islandFocusToken = "";
  let islandFlashTimer = 0;
  /** token -> [dx,dy,dz] 世界坐标位移 */
  let islandOffsetsByToken = new Map();
  let islandPreviewDock = null;
  const islandPreviewSlots = new Map();
  let sharedIslandPreviewRenderer = null;
  let sharedIslandPreviewCanvas = null;
  const _previewCamDir = new T.Vector3();
  /** meshKey → 折叠（默认扫描后全部折叠） */
  let islandTreeCollapsed = new Set();
  let islandScanDone = false;
  /** token -> { seed, similarity, blockScale, bbox, pixels, meshKey, regionId } */
  let islandTextureSynth = new Map();
  let islandTextureSynthParams = { seed: 12345, similarity: 0.7, blockScale: 24 };
  let islandTextureSynthBusy = false;
  let islandTextureSynthLastError = "";
  let textureSynthDebounceTimer = 0;
  let textureSynthRunPromise = null;
  let textureQuiltWorker = null;
  let textureSynthJobId = 0;
  const TEXTURE_SYNTH_DEBOUNCE_MS = 220;
  const TEXTURE_QUILT_WORKER_URL = new URL(
    `./vendor/texture-quilt/texture-quilt-worker.js?build=${BM_BUILD_ID}`,
    import.meta.url
  );
  /** uuid -> [dx, dy, dz] 每件独立位移，切换选中不丢失 */
  let partOffsetsById = new Map();
  let partHighlightId = "";
  /** 滑块编辑目标：取消高亮后仍指向最近编辑的部件 */
  let partEditTargetId = "";
  let pendingPartTree = null;

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

  function getAnchorToolMode() {
    if (brushMode) return "brush";
    if (addMode) return addSymmetric ? "addSym" : "addAsym";
    if (editRest) return "move";
    return "warp";
  }

  function setAnchorToolMode(mode) {
    const m =
      mode === "move" || mode === "addSym" || mode === "addAsym" || mode === "brush"
        ? mode
        : "warp";
    brushMode = false;
    brushing = false;
    brushLastStamp = null;
    if (m === "warp") {
      addMode = false;
      editRest = false;
    } else if (m === "move") {
      addMode = false;
      editRest = true;
    } else if (m === "addSym") {
      addMode = true;
      addSymmetric = true;
      editRest = false;
      setPickMuscleModeInternal(false);
    } else if (m === "addAsym") {
      addMode = true;
      addSymmetric = false;
      editRest = false;
      setPickMuscleModeInternal(false);
    } else {
      addMode = false;
      editRest = false;
      brushMode = true;
      setPickMuscleModeInternal(false);
      if (brushRadius < 1e-6) {
        brushRadius = markerRadius() * 8;
        loadBrushPrefs();
      }
      ensureBrushPreview();
    }
    syncBrushPreviewVisible();
    onChange();
  }

  function recomputeMeshNormals(geom) {
    if (!geom?.attributes?.position) return;
    // Three.js 在已有 normal 且 count 偏小时不会扩容，加密后会留下错法线→发黑网格
    if (geom.attributes.normal && geom.attributes.normal.count !== geom.attributes.position.count) {
      geom.deleteAttribute("normal");
    }
    geom.computeVertexNormals();
  }

  function brushFalloff(t, soft) {
    if (t >= 1) return 0;
    const s = Math.min(1, Math.max(0, soft));
    // soft 越高，中心平台越小；边缘用 smootherstep 再平方，避免「硬鼓包」
    const inner = Math.max(0, (1 - s) * 0.35);
    if (t <= inner) return 1;
    const u = (t - inner) / (1 - inner + 1e-8);
    const sm = u * u * u * (u * (u * 6 - 15) + 10);
    const edge = 1 - sm;
    return edge * edge;
  }

  /** 命中法线统一朝向相机，避免 DoubleSide/翻面网格把「堆料」变成挖穿黑洞 */
  function brushNormalFromHit(hit) {
    const n = hit?.face?.normal
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
      : new T.Vector3(0, 0, 1);
    if (!camera || !hit?.point) return n;
    const toCam = camera.position.clone().sub(hit.point);
    if (toCam.lengthSq() > 1e-12) {
      toCam.normalize();
      if (n.dot(toCam) < 0) n.negate();
    }
    return n;
  }

  function modelBrushScale() {
    return Math.max(markerRadius(), 1e-5);
  }

  function loadBrushPrefs() {
    try {
      const raw = localStorage.getItem(BRUSH_LS_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (typeof o.softness === "number") brushSoftness = Math.min(1, Math.max(0, o.softness));
      if (typeof o.strength === "number") brushStrength = Math.min(1, Math.max(0.02, o.strength));
      if (o.sign != null) brushSign = Number(o.sign) < 0 ? -1 : 1;
      if (typeof o.radiusScale === "number" && o.radiusScale > 0) {
        brushRadius = Math.max(1e-5, o.radiusScale * modelBrushScale());
      } else if (typeof o.radius === "number" && o.radius > 0) {
        brushRadius = Math.max(1e-5, o.radius);
      }
    } catch (_) {
      /* ignore */
    }
  }

  function saveBrushPrefs() {
    try {
      localStorage.setItem(
        BRUSH_LS_KEY,
        JSON.stringify({
          v: 1,
          softness: brushSoftness,
          strength: brushStrength,
          sign: brushSign,
          radiusScale: brushRadius / modelBrushScale(),
        })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function ensureBrushPreview() {
    if (!scene || brushPreview) return;
    const cnv = document.createElement("canvas");
    cnv.width = 128;
    cnv.height = 128;
    const ctx = cnv.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.55, "rgba(160,160,160,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new T.CanvasTexture(cnv);
    brushPreviewMat = new T.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: T.DoubleSide,
    });
    brushPreview = new T.Mesh(new T.PlaneGeometry(1, 1), brushPreviewMat);
    brushPreview.name = "sculpt_brush_preview";
    brushPreview.renderOrder = 999;
    brushPreview.visible = false;
    scene.add(brushPreview);
  }

  function disposeBrushPreview() {
    if (brushPreview && scene) scene.remove(brushPreview);
    brushPreview?.geometry?.dispose?.();
    brushPreviewMat?.map?.dispose?.();
    brushPreviewMat?.dispose?.();
    brushPreview = null;
    brushPreviewMat = null;
  }

  function syncBrushPreviewVisible() {
    if (!brushPreview) return;
    brushPreview.visible = !!(brushMode && markersUiVisible);
  }

  function updateBrushPreview(hitWorld, hitNormal) {
    if (!brushMode) {
      if (brushPreview) brushPreview.visible = false;
      return;
    }
    ensureBrushPreview();
    if (!brushPreview || !hitWorld) return;
    brushPreview.visible = !!markersUiVisible;
    brushPreview.position.copy(hitWorld);
    const n = hitNormal?.clone?.() || new T.Vector3(0, 0, 1);
    if (n.lengthSq() < 1e-10) n.set(0, 0, 1);
    else n.normalize();
    brushPreview.position.addScaledVector(n, markerRadius() * 0.4);
    const look = brushPreview.position.clone().add(n);
    brushPreview.lookAt(look);
    const s = Math.max(brushRadius * 2, 1e-4);
    brushPreview.scale.set(s, s, 1);
  }

  function ensureBrushAdj(entry) {
    if (entry.brushAdj && entry.brushAdjCount === entry.count) return entry.brushAdj;
    const { mesh, count } = entry;
    const adj = Array.from({ length: count }, () => []);
    const geom = mesh.geometry;
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(geom.attributes.position.count / 3);
    const addEdge = (a, b) => {
      if (a === b) return;
      if (!adj[a].includes(b)) adj[a].push(b);
      if (!adj[b].includes(a)) adj[b].push(a);
    };
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      addEdge(ia, ib);
      addEdge(ib, ic);
      addEdge(ic, ia);
    }
    // 平均边长（世界 rest 近似）：用于限制单笔位移，防撑破
    let edgeSum = 0;
    let edgeN = 0;
    const restPos = entry.restPos;
    for (let i = 0; i < count; i++) {
      const nbs = adj[i];
      const i3 = i * 3;
      for (let k = 0; k < nbs.length; k++) {
        const j = nbs[k];
        if (j <= i) continue;
        const j3 = j * 3;
        const dx = restPos[i3] - restPos[j3];
        const dy = restPos[i3 + 1] - restPos[j3 + 1];
        const dz = restPos[i3 + 2] - restPos[j3 + 2];
        edgeSum += Math.sqrt(dx * dx + dy * dy + dz * dz);
        edgeN++;
      }
    }
    entry.brushAdj = adj;
    entry.brushAdjCount = count;
    entry.brushAvgEdge = edgeN > 0 ? edgeSum / edgeN : modelBrushScale();
    return adj;
  }

  function smoothBrushRegion(entry, affected, hitNormal, mix, faceOk, opts = {}) {
    if (!affected.length || mix <= 1e-5) return;
    const adj = ensureBrushAdj(entry);
    const restPos = entry.restPos;
    const nx = hitNormal.x;
    const ny = hitNormal.y;
    const nz = hitNormal.z;
    // 堆料允许少量法向圆滑（抹平鼓包棱）；减料仍只切向，防薄壳拉穿
    const allowNormal = opts.allowNormal === true;
    const affectedSet = new Set(affected);
    const tmp = new Float32Array(affected.length * 3);
    for (let a = 0; a < affected.length; a++) {
      const i = affected[a];
      const i3 = i * 3;
      const nbs = adj[i];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let nUse = 0;
      for (let k = 0; k < nbs.length; k++) {
        const j = nbs[k];
        // 只跟「同侧且本笔刷到的点」圆滑，避免耳缘把正反面拉穿成筛子
        if (!affectedSet.has(j)) continue;
        if (faceOk && !faceOk[j]) continue;
        const j3 = j * 3;
        sx += restPos[j3];
        sy += restPos[j3 + 1];
        sz += restPos[j3 + 2];
        nUse++;
      }
      if (!nUse) {
        tmp[a * 3] = restPos[i3];
        tmp[a * 3 + 1] = restPos[i3 + 1];
        tmp[a * 3 + 2] = restPos[i3 + 2];
        continue;
      }
      const invN = 1 / nUse;
      tmp[a * 3] = sx * invN;
      tmp[a * 3 + 1] = sy * invN;
      tmp[a * 3 + 2] = sz * invN;
    }
    for (let a = 0; a < affected.length; a++) {
      const i = affected[a];
      const i3 = i * 3;
      const ax = restPos[i3];
      const ay = restPos[i3 + 1];
      const az = restPos[i3 + 2];
      let tx = tmp[a * 3] - ax;
      let ty = tmp[a * 3 + 1] - ay;
      let tz = tmp[a * 3 + 2] - az;
      if (!allowNormal) {
        const along = tx * nx + ty * ny + tz * nz;
        tx -= nx * along;
        ty -= ny * along;
        tz -= nz * along;
      }
      restPos[i3] = ax + tx * mix;
      restPos[i3 + 1] = ay + ty * mix;
      restPos[i3 + 2] = az + tz * mix;
    }
  }

  /** 只圆滑位移的法向分量，抹平鼓包高度，不改顶点邻接位置（薄壳安全） */
  function smoothDeltaAlongNormal(entry, delta, affected, faceOk, hitNormal, mix) {
    if (!affected.length || mix <= 1e-5) return;
    const adj = ensureBrushAdj(entry);
    const nx = hitNormal.x;
    const ny = hitNormal.y;
    const nz = hitNormal.z;
    const affectedSet = new Set(affected);
    const tmp = new Float32Array(affected.length);
    for (let a = 0; a < affected.length; a++) {
      const i = affected[a];
      const i3 = i * 3;
      const self = delta[i3] * nx + delta[i3 + 1] * ny + delta[i3 + 2] * nz;
      const nbs = adj[i];
      let sum = self;
      let nUse = 1;
      for (let k = 0; k < nbs.length; k++) {
        const j = nbs[k];
        if (!affectedSet.has(j)) continue;
        if (faceOk && !faceOk[j]) continue;
        const j3 = j * 3;
        sum += delta[j3] * nx + delta[j3 + 1] * ny + delta[j3 + 2] * nz;
        nUse++;
      }
      tmp[a] = sum / nUse;
    }
    for (let a = 0; a < affected.length; a++) {
      const i = affected[a];
      const i3 = i * 3;
      const cur = delta[i3] * nx + delta[i3 + 1] * ny + delta[i3 + 2] * nz;
      const next = cur + (tmp[a] - cur) * mix;
      const tangX = delta[i3] - nx * cur;
      const tangY = delta[i3 + 1] - ny * cur;
      const tangZ = delta[i3 + 2] - nz * cur;
      delta[i3] = tangX + nx * next;
      delta[i3 + 1] = tangY + ny * next;
      delta[i3 + 2] = tangZ + nz * next;
    }
  }

  /**
   * 耳模等 GLB 常有「视觉邻接但索引不共享」的缝：直接加密会撕成纱窗。
   * 落笔前把笔刷圆盘内、同侧近点焊成同一索引，再细分。
   */
  function weldBrushRegion(entry, hitWorld, hitNormal, R) {
    const mesh = entry.mesh;
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    if (!posAttr || !geom.index) return 0;
    const nx = hitNormal.x;
    const ny = hitNormal.y;
    const nz = hitNormal.z;
    const avgEdge = entry.brushAvgEdge || modelBrushScale();
    const eps = Math.max(avgEdge * 0.05, 1e-7);
    const eps2 = eps * eps;
    const depthMax = Math.min(R * 0.55, avgEdge * 2.8);
    const R2 = R * 1.2;
    const rest = entry.restPos;
    const count = entry.count;
    const nAttr = geom.attributes.normal;
    const candidates = [];
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const dx = rest[i3] - hitWorld.x;
      const dy = rest[i3 + 1] - hitWorld.y;
      const dz = rest[i3 + 2] - hitWorld.z;
      const along = dx * nx + dy * ny + dz * nz;
      if (along < -avgEdge * 0.1 || along > depthMax) continue;
      const tangential = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      if (tangential > R2) continue;
      // 只焊朝向笔刷法线的一侧，避免把薄壳正反面焊穿
      candidates.push(i);
    }
    if (candidates.length < 2) return 0;

    // 世界法线缓存（只对候选）
    const worldN = new Float32Array(candidates.length * 3);
    const vn = new T.Vector3();
    mesh.updateWorldMatrix(true, false);
    for (let c = 0; c < candidates.length; c++) {
      const i = candidates[c];
      if (nAttr) {
        vn.set(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i)).transformDirection(mesh.matrixWorld);
        if (vn.lengthSq() > 1e-12) vn.normalize();
        else vn.set(nx, ny, nz);
      } else {
        vn.set(nx, ny, nz);
      }
      // 与命中法线反向的点（壳背面）不参与焊接
      if (vn.x * nx + vn.y * ny + vn.z * nz < 0.25) {
        candidates[c] = -1;
        continue;
      }
      worldN[c * 3] = vn.x;
      worldN[c * 3 + 1] = vn.y;
      worldN[c * 3 + 2] = vn.z;
    }
    const live = candidates.filter((i) => i >= 0);
    if (live.length < 2) return 0;

    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    const find = (a) => {
      let x = a;
      while (parent[x] !== x) x = parent[x];
      let y = a;
      while (y !== x) {
        const p = parent[y];
        parent[y] = x;
        y = p;
      }
      return x;
    };
    const unite = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    const invCell = 1 / Math.max(eps, 1e-8);
    const buckets = new Map();
    const cellKey = (x, y, z) =>
      `${Math.floor(x * invCell)}|${Math.floor(y * invCell)}|${Math.floor(z * invCell)}`;
    const candSet = new Set(live);
    const candMeta = new Map();
    for (let c = 0; c < candidates.length; c++) {
      const i = candidates[c];
      if (i < 0) continue;
      candMeta.set(i, c);
    }

    for (const i of live) {
      const i3 = i * 3;
      const k = cellKey(rest[i3], rest[i3 + 1], rest[i3 + 2]);
      let arr = buckets.get(k);
      if (!arr) {
        arr = [];
        buckets.set(k, arr);
      }
      arr.push(i);
    }

    let merges = 0;
    for (const i of live) {
      const i3 = i * 3;
      const px = rest[i3];
      const py = rest[i3 + 1];
      const pz = rest[i3 + 2];
      const ci = candMeta.get(i);
      const nix = worldN[ci * 3];
      const niy = worldN[ci * 3 + 1];
      const niz = worldN[ci * 3 + 2];
      const ix0 = Math.floor(px * invCell);
      const iy0 = Math.floor(py * invCell);
      const iz0 = Math.floor(pz * invCell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const arr = buckets.get(`${ix0 + dx}|${iy0 + dy}|${iz0 + dz}`);
            if (!arr) continue;
            for (const j of arr) {
              if (j <= i) continue;
              if (!candSet.has(j)) continue;
              const j3 = j * 3;
              const qx = rest[j3] - px;
              const qy = rest[j3 + 1] - py;
              const qz = rest[j3 + 2] - pz;
              if (qx * qx + qy * qy + qz * qz > eps2) continue;
              const cj = candMeta.get(j);
              const njx = worldN[cj * 3];
              const njy = worldN[cj * 3 + 1];
              const njz = worldN[cj * 3 + 2];
              if (nix * njx + niy * njy + niz * njz < 0.5) continue;
              if (find(i) !== find(j)) {
                unite(i, j);
                merges++;
              }
            }
          }
        }
      }
    }
    if (merges <= 0) return 0;

    // 每组代表：取最小索引，位置取平均
    const members = new Map();
    for (let i = 0; i < count; i++) {
      const r = find(i);
      let arr = members.get(r);
      if (!arr) {
        arr = [];
        members.set(r, arr);
      }
      arr.push(i);
    }
    const remap = new Int32Array(count);
    const posLocal = Array.from(posAttr.array);
    const uvAttr = geom.attributes.uv;
    const uvArr = uvAttr ? Array.from(uvAttr.array) : null;
    const newRest = [];
    const newPos = [];
    const newUv = uvArr ? [] : null;
    let newCount = 0;
    for (let i = 0; i < count; i++) {
      const r = find(i);
      if (r !== i) continue;
      const group = members.get(r);
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let lx = 0;
      let ly = 0;
      let lz = 0;
      let uu = 0;
      let vv = 0;
      for (const j of group) {
        const j3 = j * 3;
        sx += rest[j3];
        sy += rest[j3 + 1];
        sz += rest[j3 + 2];
        lx += posLocal[j3];
        ly += posLocal[j3 + 1];
        lz += posLocal[j3 + 2];
        if (newUv) {
          uu += uvArr[j * 2];
          vv += uvArr[j * 2 + 1];
        }
      }
      const invN = 1 / group.length;
      const ni = newCount++;
      for (const j of group) remap[j] = ni;
      newRest.push(sx * invN, sy * invN, sz * invN);
      newPos.push(lx * invN, ly * invN, lz * invN);
      if (newUv) newUv.push(uu * invN, vv * invN);
    }
    // 非代表已在上面随 r===i 处理；未进 weld 的点 r===i 且 group=[i]
    // 上面循环对所有 i 的 find(i)===i 都会建点，覆盖全体

    const indexArr = Array.from(geom.index.array);
    const nextIdx = [];
    for (let t = 0; t < indexArr.length; t += 3) {
      const a = remap[indexArr[t]];
      const b = remap[indexArr[t + 1]];
      const c = remap[indexArr[t + 2]];
      if (a === b || b === c || c === a) continue;
      nextIdx.push(a, b, c);
    }

    geom.setAttribute("position", new T.BufferAttribute(new Float32Array(newPos), 3));
    if (newUv) geom.setAttribute("uv", new T.BufferAttribute(new Float32Array(newUv), 2));
    geom.setIndex(nextIdx);
    geom.attributes.position.needsUpdate = true;
    if (geom.attributes.uv) geom.attributes.uv.needsUpdate = true;
    recomputeMeshNormals(geom);
    entry.restPos = new Float32Array(newRest);
    entry.count = newCount;
    entry.brushAdj = null;
    entry.brushAdjCount = -1;
    entry.brushAvgEdge = 0;
    mesh.userData._morphLocalRest = new Float32Array(newPos);
    mesh.userData.bmWarpedPos = null;
    return merges;
  }

  /**
   * 笔刷圆盘内局部加密：过长边插中点并细分三角。
   * 关键：凡被切开的边，两侧三角都必须共用中点重三角化，否则 T 接缝→白缝筛孔。
   */
  function densifyBrushRegion(entry, hitWorld, hitNormal, R) {
    const mesh = entry.mesh;
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    if (!posAttr || !geom.index) return 0;
    if (entry.count > 380000) return 0;
    const nx = hitNormal.x;
    const ny = hitNormal.y;
    const nz = hitNormal.z;
    const avgEdge = entry.brushAvgEdge || modelBrushScale();
    // 直径上大约 16~22 段，堆料才够圆滑
    const maxEdge = Math.max(R * 0.045, Math.min(R * 0.075, avgEdge * 0.42));
    const depthMax = Math.min(R * 0.55, avgEdge * 2.8);
    const R2 = R * 1.18;
    const rest = Array.from(entry.restPos);
    const posLocal = Array.from(posAttr.array);
    const uvAttr = geom.attributes.uv;
    const uvArr = uvAttr ? Array.from(uvAttr.array) : null;
    let indexArr = Array.from(geom.index.array);
    const midCache = new Map();
    let addedFaces = 0;
    const maxAdded = 1800;
    const mw = new T.Vector3();
    mesh.updateWorldMatrix(true, false);

    const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const edgeLen = (a, b) => {
      const a3 = a * 3;
      const b3 = b * 3;
      return Math.hypot(rest[a3] - rest[b3], rest[a3 + 1] - rest[b3 + 1], rest[a3 + 2] - rest[b3 + 2]);
    };
    const vertInBrush = (i) => {
      const i3 = i * 3;
      const dx = rest[i3] - hitWorld.x;
      const dy = rest[i3 + 1] - hitWorld.y;
      const dz = rest[i3 + 2] - hitWorld.z;
      const along = dx * nx + dy * ny + dz * nz;
      if (along < -avgEdge * 0.08 || along > depthMax) return false;
      const tangential = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      return tangential <= R2;
    };
    const faceFront = (a, b, c) => {
      const a3 = a * 3;
      const b3 = b * 3;
      const c3 = c * 3;
      const mx = (rest[a3] + rest[b3] + rest[c3]) / 3;
      const my = (rest[a3 + 1] + rest[b3 + 1] + rest[c3 + 1]) / 3;
      const mz = (rest[a3 + 2] + rest[b3 + 2] + rest[c3 + 2]) / 3;
      const along =
        (mx - hitWorld.x) * nx + (my - hitWorld.y) * ny + (mz - hitWorld.z) * nz;
      // 只加密命中侧薄壳，避免把背面也切开
      if (along < -avgEdge * 0.12 || along > depthMax) return false;
      const e1x = rest[b3] - rest[a3];
      const e1y = rest[b3 + 1] - rest[a3 + 1];
      const e1z = rest[b3 + 2] - rest[a3 + 2];
      const e2x = rest[c3] - rest[a3];
      const e2y = rest[c3 + 1] - rest[a3 + 1];
      const e2z = rest[c3 + 2] - rest[a3 + 2];
      const fx = e1y * e2z - e1z * e2y;
      const fy = e1z * e2x - e1x * e2z;
      const fz = e1x * e2y - e1y * e2x;
      const fl = Math.hypot(fx, fy, fz);
      if (fl < 1e-14) return false;
      // |dot| 会把薄壳正反面一起加密→纱窗；只加密与命中法线同向的面
      return (fx * nx + fy * ny + fz * nz) / fl > 0.35;
    };
    const getMid = (a, b) => {
      const key = edgeKey(a, b);
      if (midCache.has(key)) return midCache.get(key);
      const i = posLocal.length / 3;
      const a3 = a * 3;
      const b3 = b * 3;
      // 中点必须在局部空间取平均，再乘 matrixWorld → rest，避免非均匀缩放错位撕裂
      const lx = (posLocal[a3] + posLocal[b3]) * 0.5;
      const ly = (posLocal[a3 + 1] + posLocal[b3 + 1]) * 0.5;
      const lz = (posLocal[a3 + 2] + posLocal[b3 + 2]) * 0.5;
      posLocal.push(lx, ly, lz);
      mw.set(lx, ly, lz).applyMatrix4(mesh.matrixWorld);
      rest.push(mw.x, mw.y, mw.z);
      if (uvArr) {
        const au = a * 2;
        const bu = b * 2;
        uvArr.push((uvArr[au] + uvArr[bu]) * 0.5, (uvArr[au + 1] + uvArr[bu + 1]) * 0.5);
      }
      midCache.set(key, i);
      return i;
    };
    /** 按边上已有中点重三角化，保持 a→b→c 绕序 */
    const remeshTri = (a, b, c, mab, mbc, mca, out) => {
      const nMid = (mab != null ? 1 : 0) + (mbc != null ? 1 : 0) + (mca != null ? 1 : 0);
      if (nMid === 0) {
        out.push(a, b, c);
        return 0;
      }
      if (nMid === 3) {
        out.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca);
        return 3;
      }
      if (nMid === 1) {
        if (mab != null) {
          out.push(a, mab, c, mab, b, c);
        } else if (mbc != null) {
          out.push(a, b, mbc, a, mbc, c);
        } else {
          out.push(a, b, mca, b, c, mca);
        }
        return 1;
      }
      // nMid === 2
      if (mab != null && mbc != null) {
        out.push(a, mab, c, mab, b, mbc, mab, mbc, c);
      } else if (mbc != null && mca != null) {
        out.push(a, b, mbc, a, mbc, mca, mbc, c, mca);
      } else {
        // mab + mca
        out.push(a, mab, mca, mab, b, c, mab, c, mca);
      }
      return 2;
    };

    for (let pass = 0; pass < 12 && addedFaces < maxAdded; pass++) {
      const triCount = indexArr.length / 3;
      const splitKeys = new Set();
      // 1) 笔刷同侧过长边列入切开集合
      for (let t = 0; t < triCount; t++) {
        if (addedFaces >= maxAdded) break;
        const a = indexArr[t * 3];
        const b = indexArr[t * 3 + 1];
        const c = indexArr[t * 3 + 2];
        if (!(vertInBrush(a) || vertInBrush(b) || vertInBrush(c))) continue;
        if (!faceFront(a, b, c)) continue;
        if (edgeLen(a, b) > maxEdge) splitKeys.add(edgeKey(a, b));
        if (edgeLen(b, c) > maxEdge) splitKeys.add(edgeKey(b, c));
        if (edgeLen(c, a) > maxEdge) splitKeys.add(edgeKey(c, a));
      }
      if (!splitKeys.size) break;
      // 预算将满时只切最长的若干边，但仍对已选边做邻面闭合
      if (addedFaces > maxAdded * 0.85 && splitKeys.size > 80) {
        const ranked = [...splitKeys].map((k) => {
          const i = k.indexOf("_");
          const ia = Number(k.slice(0, i));
          const ib = Number(k.slice(i + 1));
          return { k, len: edgeLen(ia, ib) };
        });
        ranked.sort((u, v) => v.len - u.len);
        splitKeys.clear();
        for (let i = 0; i < 80; i++) splitKeys.add(ranked[i].k);
      }
      // 2) 为切开边建中点（邻面共用同一中点，消灭 T 接缝）
      const parseKey = (k) => {
        const i = k.indexOf("_");
        return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
      };
      for (const k of splitKeys) {
        const [ia, ib] = parseKey(k);
        getMid(ia, ib);
      }
      // 3) 凡碰到切开边的三角一律重三角化（含笔刷外邻面）
      const next = [];
      let passGain = 0;
      for (let t = 0; t < triCount; t++) {
        const a = indexArr[t * 3];
        const b = indexArr[t * 3 + 1];
        const c = indexArr[t * 3 + 2];
        const kab = edgeKey(a, b);
        const kbc = edgeKey(b, c);
        const kca = edgeKey(c, a);
        const mab = splitKeys.has(kab) ? midCache.get(kab) : null;
        const mbc = splitKeys.has(kbc) ? midCache.get(kbc) : null;
        const mca = splitKeys.has(kca) ? midCache.get(kca) : null;
        if (mab == null && mbc == null && mca == null) {
          next.push(a, b, c);
          continue;
        }
        // 已切开边必须两侧闭合，即便超过 maxAdded 也不留 T 缝
        passGain += remeshTri(a, b, c, mab, mbc, mca, next);
      }
      if (passGain <= 0) break;
      addedFaces += passGain;
      indexArr = next;
      // 本轮用过的切开边不再重复（midCache 仍保留，供几何一致）
      // 下轮按新边长再选过长边
    }

    if (addedFaces <= 0) return 0;

    geom.setAttribute("position", new T.BufferAttribute(new Float32Array(posLocal), 3));
    if (uvArr) geom.setAttribute("uv", new T.BufferAttribute(new Float32Array(uvArr), 2));
    geom.setIndex(indexArr);
    geom.attributes.position.needsUpdate = true;
    if (geom.attributes.uv) geom.attributes.uv.needsUpdate = true;
    recomputeMeshNormals(geom);
    entry.restPos = new Float32Array(rest);
    entry.count = rest.length / 3;
    entry.brushAdj = null;
    entry.brushAdjCount = -1;
    entry.brushAvgEdge = 0;
    mesh.userData._morphLocalRest = new Float32Array(posLocal);
    mesh.userData.bmWarpedPos = null;
    return addedFaces;
  }

  function clearBrushUndo() {
    brushUndoStack = [];
    brushStrokeBaseline = null;
    brushStrokeTouched = false;
  }

  function snapshotBrushRestPos() {
    return meshCache.map((e) => ({
      mesh: e.mesh,
      restPos: new Float32Array(e.restPos),
      local: e.mesh.userData._morphLocalRest
        ? new Float32Array(e.mesh.userData._morphLocalRest)
        : null,
      count: e.count,
    }));
  }

  function restoreBrushRestSnapshot(snap) {
    if (!snap?.length) return false;
    const byMesh = new Map(snap.map((s) => [s.mesh, s]));
    for (const entry of meshCache) {
      const s = byMesh.get(entry.mesh);
      if (!s || s.count !== entry.count || s.restPos.length !== entry.restPos.length) continue;
      entry.restPos.set(s.restPos);
      if (s.local && entry.mesh.userData._morphLocalRest?.length === s.local.length) {
        entry.mesh.userData._morphLocalRest.set(s.local);
      }
    }
    dirty = true;
    applyWarpNow();
    return true;
  }

  function beginBrushStrokeBaseline() {
    brushStrokeBaseline = snapshotBrushRestPos();
    brushStrokeTouched = false;
  }

  function commitBrushStrokeUndo() {
    if (!brushStrokeTouched || !brushStrokeBaseline) {
      brushStrokeBaseline = null;
      brushStrokeTouched = false;
      return;
    }
    brushUndoStack.push(brushStrokeBaseline);
    if (brushUndoStack.length > BRUSH_UNDO_MAX) brushUndoStack.shift();
    brushStrokeBaseline = null;
    brushStrokeTouched = false;
  }

  function undoBrushStroke() {
    if (!brushUndoStack.length) return false;
    const snap = brushUndoStack.pop();
    const ok = restoreBrushRestSnapshot(snap);
    onChange();
    return ok;
  }

  /**
   * 贴面控制点环：中心 + 1～2 圈，总数 ≤25；射线落到表面。
   */
  function seedBrushControlPoints(hitWorld, hitNormal, hitMesh, R) {
    const nx = hitNormal.x;
    const ny = hitNormal.y;
    const nz = hitNormal.z;
    const meshes = listMeshes();
    const origin = new T.Vector3();
    const dir = new T.Vector3(-nx, -ny, -nz);
    // 切向基底
    const up = Math.abs(ny) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0);
    const tx = new T.Vector3().crossVectors(up, hitNormal);
    if (tx.lengthSq() < 1e-12) tx.set(1, 0, 0);
    else tx.normalize();
    const ty = new T.Vector3().crossVectors(hitNormal, tx).normalize();
    const avgE = modelBrushScale();
    const lift = Math.max(avgE * 3, R * 0.08);

    const project = (wx, wy, wz) => {
      origin.set(wx + nx * lift, wy + ny * lift, wz + nz * lift);
      raycaster.set(origin, dir);
      const hs = raycaster.intersectObjects(meshes, false);
      if (!hs.length) return null;
      const h = hs[0];
      // 只要同侧附近命中，优先命中网格
      if (hitMesh && h.object !== hitMesh) {
        const same = hs.find((x) => x.object === hitMesh && x.point.distanceTo(hitWorld) <= R * 1.25);
        if (same) {
          const n = brushNormalFromHit(same);
          if (n.dot(hitNormal) < 0.25) return null;
          return { point: same.point.clone(), mesh: same.object, normal: n };
        }
      }
      const n = brushNormalFromHit(h);
      if (n.dot(hitNormal) < 0.25) return null;
      if (h.point.distanceTo(hitWorld) > R * 1.35) return null;
      return { point: h.point.clone(), mesh: h.object, normal: n };
    };

    const pts = [];
    const pushUnique = (p) => {
      if (!p || pts.length >= 25) return;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].point.distanceToSquared(p.point) < (R * 0.12) * (R * 0.12)) return;
      }
      pts.push(p);
    };

    pushUnique(project(hitWorld.x, hitWorld.y, hitWorld.z) || {
      point: hitWorld.clone(),
      mesh: hitMesh,
      normal: hitNormal.clone(),
    });

    const rings = [
      { r: R * 0.38, n: 6 },
      { r: R * 0.72, n: 10 },
      { r: R * 0.95, n: 8 },
    ];
    for (const ring of rings) {
      for (let i = 0; i < ring.n && pts.length < 25; i++) {
        const a = (i / ring.n) * Math.PI * 2;
        const cx = hitWorld.x + (tx.x * Math.cos(a) + ty.x * Math.sin(a)) * ring.r;
        const cy = hitWorld.y + (tx.y * Math.cos(a) + ty.y * Math.sin(a)) * ring.r;
        const cz = hitWorld.z + (tx.z * Math.cos(a) + ty.z * Math.sin(a)) * ring.r;
        pushUnique(project(cx, cy, cz));
      }
    }
    return pts;
  }

  /**
   * 笔刷一笔 = 临时 TPS 拧形（与锚点同原理），再烘焙进 restPos。
   * 不对单侧顶点做硬推，避免薄壳/多材质接缝撕成纱窗。
   */
  function applyBrushStamp(hitWorld, hitNormal, hitMesh = null) {
    if (!meshCache.length || !hitWorld || !hitNormal) return false;
    const R = Math.max(brushRadius, 1e-6);
    const strength = Math.min(1, Math.max(0.02, brushStrength));
    const soft = Math.max(brushSoftness, 0.55);
    const nx = hitNormal.x;
    const ny = hitNormal.y;
    const nz = hitNormal.z;
    const maxStep = Math.min(R * strength * 0.18, R * 0.3);
    if (Math.abs(maxStep) < 1e-12) return false;

    const ctrls = seedBrushControlPoints(hitWorld, hitNormal, hitMesh, R);
    if (!ctrls.length) return false;

    const src = [];
    const dst = [];
    const pushPair = (x, y, z, ox, oy, oz) => {
      src.push([x, y, z]);
      dst.push([x + ox, y + oy, z + oz]);
    };

    for (const c of ctrls) {
      const tang = c.point.distanceTo(hitWorld);
      const w = brushFalloff(Math.min(1, tang / R), soft);
      const mag = maxStep * brushSign * w;
      pushPair(c.point.x, c.point.y, c.point.z, nx * mag, ny * mag, nz * mag);
    }

    // 笔刷外圈钉死：局部化变形，等同锚点拧形时的「远处不动」
    const up = Math.abs(ny) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0);
    const tx = new T.Vector3().crossVectors(up, hitNormal);
    if (tx.lengthSq() < 1e-12) tx.set(1, 0, 0);
    else tx.normalize();
    const ty = new T.Vector3().crossVectors(hitNormal, tx).normalize();
    const pinR = R * 1.35;
    const pinN = 10;
    const meshes = listMeshes();
    const origin = new T.Vector3();
    const dir = new T.Vector3(-nx, -ny, -nz);
    const lift = Math.max(modelBrushScale() * 3, R * 0.08);
    for (let i = 0; i < pinN; i++) {
      const a = (i / pinN) * Math.PI * 2;
      const cx = hitWorld.x + (tx.x * Math.cos(a) + ty.x * Math.sin(a)) * pinR;
      const cy = hitWorld.y + (tx.y * Math.cos(a) + ty.y * Math.sin(a)) * pinR;
      const cz = hitWorld.z + (tx.z * Math.cos(a) + ty.z * Math.sin(a)) * pinR;
      origin.set(cx + nx * lift, cy + ny * lift, cz + nz * lift);
      raycaster.set(origin, dir);
      const hs = raycaster.intersectObjects(meshes, false);
      let px = cx;
      let py = cy;
      let pz = cz;
      if (hs.length && hs[0].point.distanceTo(hitWorld) <= pinR * 1.4) {
        px = hs[0].point.x;
        py = hs[0].point.y;
        pz = hs[0].point.z;
      }
      pushPair(px, py, pz, 0, 0, 0);
    }

    // 整模包围盒角点钉死（与 rebuildWarp 相同稳形手段）
    const cloud = [];
    for (const entry of meshCache) {
      const rp = entry.restPos;
      const step = Math.max(1, Math.floor(entry.count / 40));
      for (let i = 0; i < entry.count; i += step) {
        const i3 = i * 3;
        cloud.push([rp[i3], rp[i3 + 1], rp[i3 + 2]]);
      }
    }
    if (cloud.length >= 2) {
      const { min, max } = bboxOf(cloud);
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
      for (const c of corners) pushPair(c[0], c[1], c[2], 0, 0, 0);
    }

    if (src.length < 4) return false;
    // 略提高 smooth，鼓包更泥、更少尖刺
    const stampFn = fitTps(src, dst, 8e-4);

    const inv = new T.Matrix4();
    const v = new T.Vector3();
    let touched = false;
    let maxDisp = 0;
    // 全网格同一连续场：同位/接缝一起走，不挑单侧顶点
    for (const entry of meshCache) {
      const { mesh, restPos, count } = entry;
      let local = mesh.userData._morphLocalRest;
      if (!local || local.length !== count * 3) {
        local = new Float32Array(count * 3);
        mesh.userData._morphLocalRest = local;
      }
      mesh.updateWorldMatrix(true, false);
      inv.copy(mesh.matrixWorld).invert();
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const px = restPos[i3];
        const py = restPos[i3 + 1];
        const pz = restPos[i3 + 2];
        const w = stampFn([px, py, pz]);
        const ddx = w[0] - px;
        const ddy = w[1] - py;
        const ddz = w[2] - pz;
        const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (d > 1e-12) {
          restPos[i3] = w[0];
          restPos[i3 + 1] = w[1];
          restPos[i3 + 2] = w[2];
          touched = true;
          if (d > maxDisp) maxDisp = d;
        }
        v.set(restPos[i3], restPos[i3 + 1], restPos[i3 + 2]).applyMatrix4(inv);
        local[i3] = v.x;
        local[i3 + 1] = v.y;
        local[i3 + 2] = v.z;
      }
    }

    if (touched && maxDisp > 1e-12) {
      brushStrokeTouched = true;
      dirty = true;
      applyWarpNow();
      return true;
    }
    return false;
  }

  function hitMeshUnderPointer() {
    const meshes = listMeshes();
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0] : null;
  }

  function defaultLandmarkIdSet() {
    const ids = new Set();
    for (const lm of farkas.landmarks || []) {
      if (lm?.id) ids.add(lm.id);
    }
    return ids;
  }

  function hasDefaultLandmarks() {
    const defs = defaultLandmarkIdSet();
    for (const id of Object.keys(rest)) {
      if (defs.has(id)) return true;
    }
    return false;
  }

  function clearDefaultLandmarks() {
    const defs = defaultLandmarkIdSet();
    let cleared = false;
    for (const id of [...Object.keys(rest)]) {
      if (!defs.has(id)) continue;
      delete rest[id];
      delete xyzOffset[id];
      delete customMeta[id];
      cleared = true;
    }
    if (defs.has(selectedId)) selectedId = "";
    if (cleared) {
      ensureMarkers();
      scheduleApply();
      onChange();
    }
    return cleared;
  }

  function isTypingTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    return !!el.closest?.("[contenteditable='true']");
  }

  function nudgeSelectedByKey(key, shiftKey) {
    if (!selectedId || !rest[selectedId] || !camera) return false;
    const step = markerRadius() * 0.15 * (shiftKey ? 0.2 : 1);
    const right = new T.Vector3();
    const up = new T.Vector3();
    const forward = new T.Vector3();
    camera.matrixWorld.extractBasis(right, up, forward);
    right.normalize();
    up.normalize();
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (key === "ArrowLeft") {
      dx = -right.x * step;
      dy = -right.y * step;
      dz = -right.z * step;
    } else if (key === "ArrowRight") {
      dx = right.x * step;
      dy = right.y * step;
      dz = right.z * step;
    } else if (key === "ArrowUp") {
      dx = up.x * step;
      dy = up.y * step;
      dz = up.z * step;
    } else if (key === "ArrowDown") {
      dx = -up.x * step;
      dy = -up.y * step;
      dz = -up.z * step;
    } else {
      return false;
    }
    const id = selectedId;
    if (editRest) {
      const prev = rest[id].slice();
      rest[id] = [prev[0] + dx, prev[1] + dy, prev[2] + dz];
      if (mirrorLock) {
        const p = pairOf(id);
        if (p && rest[p]) {
          rest[p] = [rest[p][0] - dx, rest[p][1] + dy, rest[p][2] + dz];
        }
      }
      scheduleApply();
      updateMarkerPositions();
      onChange();
    } else {
      const cur = xyzOffset[id] || [0, 0, 0];
      setXyz(id, cur[0] + dx, cur[1] + dy, cur[2] + dz);
      updateMarkerPositions();
      onChange();
    }
    return true;
  }

  function onKeyDown(ev) {
    if (!markersUiVisible || !root) return;
    if (isTypingTarget(ev.target)) return;
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "z" || ev.key === "Z") && !ev.shiftKey) {
      if (brushMode && brushUndoStack.length) {
        undoBrushStroke();
        ev.preventDefault();
        return;
      }
    }
    if (ev.key === "Escape") {
      if (addMode || brushMode) {
        setAnchorToolMode("warp");
        ev.preventDefault();
        return;
      }
      if (selectedId) {
        setSelected("");
        ev.preventDefault();
      }
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (!selectedId || brushMode) return;
      deletePoint(selectedId);
      ev.preventDefault();
      return;
    }
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      if (addMode || brushMode) return;
      if (nudgeSelectedByKey(ev.key, ev.shiftKey)) ev.preventDefault();
    }
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
    if (meshCache.length) {
      const v = new T.Vector3();
      const inv = new T.Matrix4();
      for (const entry of meshCache) {
        const { mesh, restPos, count } = entry;
        inv.copy(mesh.matrixWorld).invert();
        const attr = mesh.geometry.attributes.position;
        for (let i = 0; i < count; i++) {
          const i3 = i * 3;
          let wx = restPos[i3];
          let wy = restPos[i3 + 1];
          let wz = restPos[i3 + 2];
          if (warpFn) {
            const w = warpFn([wx, wy, wz]);
            wx = w[0];
            wy = w[1];
            wz = w[2];
          }
          v.set(wx, wy, wz).applyMatrix4(inv);
          attr.setXYZ(i, v.x, v.y, v.z);
        }
        attr.needsUpdate = true;
        recomputeMeshNormals(mesh.geometry);
      }
      updateMarkerPositions();
      invalidateEarPickCache();
    }
    snapshotWarpedMeshPositions();
    applyIslandOffsets();
    refreshIslandFlashOverlay();
  }

  function snapshotWarpedMeshPositions() {
    for (const mesh of listMeshes()) {
      const attr = mesh.geometry?.attributes?.position;
      if (!attr) continue;
      const n = attr.count * 3;
      if (!mesh.userData.bmWarpedPos || mesh.userData.bmWarpedPos.length !== n) {
        mesh.userData.bmWarpedPos = new Float32Array(n);
      }
      mesh.userData.bmWarpedPos.set(attr.array);
    }
  }

  function triangleVertexIndexSet(mesh, triSet) {
    const out = new Set();
    if (!mesh?.geometry || !triSet?.size) return out;
    const index = mesh.geometry.index;
    for (const t of triSet) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      out.add(ia);
      out.add(ib);
      out.add(ic);
    }
    return out;
  }

  function applyIslandOffsets() {
    const hasOffset = [...islandOffsetsByToken.values()].some(
      (o) => o && (o[0] || o[1] || o[2])
    );
    const v = new T.Vector3();
    const inv = new T.Matrix4();
    for (const mesh of listMeshes()) {
      const attr = mesh.geometry?.attributes?.position;
      const base = mesh.userData?.bmWarpedPos;
      if (!attr || !base || base.length !== attr.count * 3) continue;
      attr.array.set(base);
      if (!hasOffset) {
        attr.needsUpdate = true;
        continue;
      }
      mesh.updateWorldMatrix(true, false);
      inv.copy(mesh.matrixWorld).invert();
      for (const [token, off] of islandOffsetsByToken) {
        if (!off || (!off[0] && !off[1] && !off[2])) continue;
        const hit = resolveIslandFromToken(token);
        if (!hit || hit.mesh !== mesh) continue;
        const verts = triangleVertexIndexSet(mesh, hit.isl.triangleSet);
        for (const vi of verts) {
          v.fromBufferAttribute(attr, vi);
          v.applyMatrix4(mesh.matrixWorld);
          v.x += off[0];
          v.y += off[1];
          v.z += off[2];
          v.applyMatrix4(inv);
          attr.setXYZ(vi, v.x, v.y, v.z);
        }
      }
      attr.needsUpdate = true;
      recomputeMeshNormals(mesh.geometry);
    }
    if (hasOffset) invalidateEarPickCache();
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

  /** 拧形后头围相对欧版基准缩放耳 ROI（clamp 防极端） */
  function earScaleFactor() {
    if (!root) return 1;
    const box = new T.Box3().setFromObject(root);
    const size = box.getSize(new T.Vector3());
    const h = Math.max(size.x, size.y, size.z);
    if (!h || h < 0.01) return 1;
    const s = h / EAR_REF_HEAD_HEIGHT;
    return Math.min(1.25, Math.max(0.85, s));
  }

  function earS(v) {
    return v * earScaleFactor();
  }

  function ensureMarkers() {
    if (!markerGroup || !scene) return;
    markerGroup.visible = markersUiVisible;
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

  function isPlastymaGraySheet(mesh, sr, sg, sb) {
    const meshName = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    return meshName.includes("plasty") && rgbToHsl(sr, sg, sb).s < 0.22;
  }

  /** 耳与后脖颈/背常共用暗冷灰，需靠局部连通区分 */
  function isEarNeckSharedGrayKey(partKey) {
    return (
      partKey === "104,104,136" ||
      partKey === "96,96,144" ||
      partKey === "104,104,128" ||
      partKey === "112,112,144" ||
      partKey === "112,112,136"
    );
  }

  function isStaticMesh(mesh) {
    const n = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    return n.includes("static");
  }

  /** Static 耳软骨：贴图内多灰阶 + 暖奶油耳色岛，按空间半径聚成整耳 */
  function isStaticEarWarmCream(r, g, b) {
    const c = rgbToHsl(r, g, b);
    return (
      c.l >= 0.76 &&
      c.s <= 0.38 &&
      r >= 185 &&
      g >= 168 &&
      b >= 125 &&
      b <= g + 6 &&
      r >= b + 12 &&
      g >= b - 8
    );
  }

  function isStaticEarCartilageSeed(mesh, sr, sg, sb) {
    if (!isStaticMesh(mesh)) return false;
    if (isNearBlack(sr, sg, sb)) return false;
    if (isStaticEarWarmCream(sr, sg, sb)) return true;
    if (isBonePale(sr, sg, sb, null, mesh)) return false;
    const c = rgbToHsl(sr, sg, sb);
    if (c.s >= 0.24) return false;
    if (c.l < 0.4 || c.l > 0.87) return false;
    return true;
  }

  function isStaticEarFloodPixel(r, g, b, mesh) {
    if (isNearBlack(r, g, b)) return false;
    if (isStaticEarWarmCream(r, g, b)) return true;
    const c = rgbToHsl(r, g, b);
    if (c.l >= 0.88 && c.s <= 0.12) return false;
    if (
      c.l >= 0.68 &&
      c.s <= 0.28 &&
      b >= r + 6 &&
      b >= g + 3 &&
      Math.min(r, g, b) >= 155
    ) {
      return false;
    }
    if (c.s >= 0.24) return false;
    if (c.l < 0.4 || c.l > 0.87) return false;
    if (c.s < 0.1 && b >= r + 14 && b >= g + 10 && c.l < 0.52) return false;
    return true;
  }

  function isStaticEarCartilagePixel(r, g, b, mesh) {
    return isStaticEarFloodPixel(r, g, b, mesh);
  }

  function floodStaticEarCartilageMask(atlas, seedX, seedY, mesh) {
    const { w, h, orig } = atlas;
    const o = orig.data;
    if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return null;

    function floodRaw(maxR) {
      const raw = new Uint8Array(w * h);
      const stack = [seedX, seedY];
      raw[seedY * w + seedX] = 1;
      let count = 1;
      while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        const neighbors = [
          x - 1, y, x + 1, y, x, y - 1, x, y + 1,
          x - 1, y - 1, x + 1, y - 1, x - 1, y + 1, x + 1, y + 1,
        ];
        for (let n = 0; n < neighbors.length; n += 2) {
          const nx = neighbors[n];
          const ny = neighbors[n + 1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const dx = nx - seedX;
          const dy = ny - seedY;
          if (dx * dx + dy * dy > maxR * maxR) continue;
          const mi = ny * w + nx;
          if (raw[mi]) continue;
          const i = mi * 4;
          if (!isStaticEarFloodPixel(o[i], o[i + 1], o[i + 2], mesh)) continue;
          raw[mi] = 1;
          count++;
          stack.push(nx, ny);
        }
      }
      return { raw, count };
    }

    const radii = [72, 105, 138, 172];
    const cap = 32000;
    let chosen = null;
    for (const R of radii) {
      const r = floodRaw(R);
      if (r.count < 24) continue;
      if (r.count <= cap) chosen = r;
      else break;
    }
    if (!chosen) chosen = floodRaw(radii[0]);
    if (chosen.count < 24) return null;

    function dilate(src) {
      const dst = new Uint8Array(src.length);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (src[i] || src[i - 1] || src[i + 1] || src[i - w] || src[i + w]) dst[i] = 1;
        }
      }
      return dst;
    }

    let opened = dilate(chosen.raw);
    opened = dilate(opened);
    const maxR2 = radii[radii.length - 1] + 6;
    const out = new Uint8Array(w * h);
    let sx = seedX;
    let sy = seedY;
    if (!opened[sy * w + sx]) {
      let found = false;
      for (let r = 1; r <= 10 && !found; r++) {
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
      if (!found) return chosen.raw;
    }

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
        const dx = nx - seedX;
        const dy = ny - seedY;
        if (dx * dx + dy * dy > maxR2 * maxR2) continue;
        const mi = ny * w + nx;
        if (out[mi] || !opened[mi]) continue;
        const pi = mi * 4;
        if (!isStaticEarFloodPixel(o[pi], o[pi + 1], o[pi + 2], mesh)) continue;
        out[mi] = 1;
        n2++;
        st2.push(nx, ny);
      }
    }
    return n2 >= 24 ? out : chosen.raw;
  }

  function partLabelForSemanticPick(partKey, previewHex, pixelCount) {
    if (isEarNeckSharedGrayKey(partKey)) {
      return pixelCount < 14000 ? "耳周肌" : "后脖颈/背灰肌";
    }
    if (
      partKey === "168,168,168" ||
      partKey === "160,160,160" ||
      partKey === "152,152,152" ||
      partKey === "144,144,144" ||
      partKey === "136,136,136"
    ) {
      return pixelCount < 22000 ? "耳软骨" : partLabelForKey(partKey, previewHex);
    }
    return partLabelForKey(partKey, previewHex);
  }

  function isAnatomyPartRegionId(regionId) {
    return String(regionId || "").startsWith("sp_");
  }

  function anatomyPartIdFromRegionId(regionId) {
    return String(regionId || "").startsWith("sp_") ? String(regionId).slice(3) : "";
  }

  function meshNameMatchesAnatomyFilter(mesh, filters) {
    const n = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    if (!filters?.length) return true;
    return filters.some((f) => n.includes(String(f).toLowerCase()));
  }

  function flattenAnatomyNodes(nodes, out = []) {
    for (const n of nodes || []) {
      out.push(n);
      if (n.children?.length) flattenAnatomyNodes(n.children, out);
    }
    return out;
  }

  function findAnatomyPartDef(partId) {
    if (!partId) return null;
    const flat = flattenAnatomyNodes(anatomyPartTree);
    return flat.find((n) => n.id === partId && (!n.children?.length || n.colorKeys || n.special));
  }

  function collectCatalogColorKeys(set) {
    for (const n of flattenAnatomyNodes(anatomyCatalog.tree || [])) {
      if (n.children?.length && !n.colorKeys) continue;
      for (const k of n.colorKeys || []) set.add(k);
    }
  }

  function scanAtlasSemanticColors() {
    const step = partQuantStep();
    const map = new Map();
    for (const mesh of listMeshes()) {
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas?.orig) continue;
      const mk = meshKey(mesh);
      const o = atlas.orig.data;
      const w = atlas.w;
      const h = atlas.h;
      const stride = Math.max(1, Math.floor((w * h) / 120000));
      for (let p = 0; p < w * h; p += stride) {
        const i = p * 4;
        const r = o[i];
        const g = o[i + 1];
        const b = o[i + 2];
        if (isNearBlack(r, g, b)) continue;
        const key = quantKey(r, g, b, step);
        if (!map.has(key)) {
          map.set(key, { meshes: new Set(), rgb: [r, g, b], px: 0 });
        }
        const row = map.get(key);
        row.meshes.add(mk);
        row.px += 1;
      }
    }
    return map;
  }

  function rebuildAnatomyPartTree() {
    anatomyColorIndex = new Map();
    const catalogKeys = new Set();
    collectCatalogColorKeys(catalogKeys);
    const tree = JSON.parse(JSON.stringify(anatomyCatalog.tree || []));
    const scanned = root ? scanAtlasSemanticColors() : new Map();
    const autoLeaves = [];
    for (const [key, info] of scanned) {
      if (catalogKeys.has(key)) continue;
      if (info.px < 40) continue;
      const meshes = [...info.meshes].map((m) => {
        const n = (m || "").toLowerCase();
        if (n.includes("deform")) return "deform";
        if (n.includes("static")) return "static";
        if (n.includes("plasty")) return "plastyma";
        if (n.includes("skiedras")) return "skiedras";
        if (n.includes("acs")) return "acs";
        return "all";
      });
      const uniqueMeshes = [...new Set(meshes)].filter((m) => m !== "all");
      const id = `auto_${key.replace(/,/g, "_")}`;
      const label = partLabelForKey(key, `#${info.rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`);
      autoLeaves.push({
        id,
        label,
        colorKeys: [key],
        meshes: uniqueMeshes.length ? uniqueMeshes : ["deform", "static"],
        auto: true,
        pixelHint: info.px,
      });
      anatomyColorIndex.set(key, id);
    }
    autoLeaves.sort((a, b) => (b.pixelHint || 0) - (a.pixelHint || 0));
    if (autoLeaves.length) {
      tree.push({
        id: "grp_auto",
        label: "未归类色块（自动发现）",
        children: autoLeaves,
      });
    }
    for (const n of flattenAnatomyNodes(tree)) {
      if (n.children?.length && !n.colorKeys) continue;
      for (const k of n.colorKeys || []) anatomyColorIndex.set(k, n.id);
      if (n.special === "plastyma_sheet") anatomyColorIndex.set("__plastyma__", n.id);
    }
    anatomyPartTree = tree;
    return anatomyPartTree;
  }

  function resolveAnatomyPartFromPixel(mesh, r, g, b) {
    const key = quantKey(r, g, b, partQuantStep());
    if (isPlastymaGraySheet(mesh, r, g, b)) {
      const pid = anatomyColorIndex.get("__plastyma__");
      if (pid) return findAnatomyPartDef(pid);
    }
    const flat = flattenAnatomyNodes(anatomyPartTree);
    const matches = [];
    for (const def of flat) {
      if (def.children?.length && !def.colorKeys && !def.special) continue;
      if (def.special === "plastyma_sheet") continue;
      if (!def.colorKeys?.includes(key)) continue;
      if (!meshNameMatchesAnatomyFilter(mesh, def.meshes)) continue;
      matches.push(def);
    }
    if (matches.length) {
      matches.sort((a, b) => (a.auto ? 1 : 0) - (b.auto ? 1 : 0));
      return matches[0];
    }
    const autoId = anatomyColorIndex.get(key);
    if (autoId) return findAnatomyPartDef(autoId);
    return null;
  }

  function buildMasksForAnatomyPartDef(def) {
    const layers = [];
    if (!def) return layers;
    const regionId = `sp_${def.id}`;
    if (def.special === "plastyma_sheet") {
      for (const mesh of listMeshes()) {
        if (!meshNameMatchesAnatomyFilter(mesh, def.meshes || ["plastyma"])) continue;
        const atlas = mesh.userData?.bmAtlas;
        if (!atlas?.orig) continue;
        const o = atlas.orig.data;
        for (let p = 0; p < atlas.w * atlas.h; p++) {
          const i = p * 4;
          if (!isPlastymaGraySheet(mesh, o[i], o[i + 1], o[i + 2])) continue;
          const x = p % atlas.w;
          const y = (p / atlas.w) | 0;
          const mask = maskFromColorClass(atlas, o[i], o[i + 1], o[i + 2], mesh);
          if (!mask) break;
          layers.push({
            mesh,
            meshKey: meshKey(mesh),
            mask,
            regionId: "cq_plastyma_sheet",
            pixelCount: maskPixelCount(mask),
          });
          break;
        }
      }
      return layers;
    }
    for (const mesh of listMeshes()) {
      if (!meshNameMatchesAnatomyFilter(mesh, def.meshes)) continue;
      const atlas = mesh.userData?.bmAtlas;
      if (!atlas?.orig) continue;
      let mask = null;
      let seedRgb = null;
      for (const key of def.colorKeys || []) {
        const parts = key.split(",").map((n) => parseInt(n, 10));
        if (parts.length < 3) continue;
        const [sr, sg, sb] = parts;
        const m = maskFromColorClass(atlas, sr, sg, sb, mesh);
        if (!m) continue;
        mask = mask ? orMasks(mask, m) : m;
        if (!seedRgb) seedRgb = [sr, sg, sb];
      }
      if (!mask || maskPixelCount(mask) < 80) continue;
      const s = seedUvFromMask(atlas, mask);
      const p = uvToPixel(atlas, s.seedU, s.seedV);
      const o = atlas.orig.data;
      const sr = seedRgb ? seedRgb[0] : o[p.i];
      const sg = seedRgb ? seedRgb[1] : o[p.i + 1];
      const sb = seedRgb ? seedRgb[2] : o[p.i + 2];
      layers.push({
        mesh,
        meshKey: meshKey(mesh),
        mask,
        regionId,
        pixelCount: maskPixelCount(mask),
        seedU: s.seedU,
        seedV: s.seedV,
        seedRgb: [sr, sg, sb],
        previewHex: `#${[sr, sg, sb].map((n) => n.toString(16).padStart(2, "0")).join("")}`,
        partKey: def.colorKeys?.[0] || def.id,
        partLabel: def.label,
        partMode: "anatomyPart",
      });
    }
    return layers;
  }

  function applyAnatomyPartSelection(def, layers) {
    if (!layers?.length) return false;
    layers.sort((a, b) => (b.pixelCount || 0) - (a.pixelCount || 0));
    const primary = layers[0];
    const companions = layers.slice(1);
    selectedAnatomyPartId = def.id;
    selectedMeshKey = primary.meshKey;
    selectedRegionKey = primary.regionId;
    let companionPx = 0;
    if (primary.mesh?.userData?.bmAtlas) {
      primary.mesh.userData.bmAtlas.masks[primary.regionId] = primary.mask;
    }
    for (const c of companions) {
      const cm = c.mesh || listMeshes().find((m) => meshKey(m) === c.meshKey);
      if (cm?.userData?.bmAtlas) {
        cm.userData.bmAtlas.masks[c.regionId] = c.mask;
        companionPx += c.pixelCount || 0;
      }
    }
    selectedRegionMeta = {
      seedU: primary.seedU,
      seedV: primary.seedV,
      previewHex: primary.previewHex,
      pixelCount: (primary.pixelCount || 0) + companionPx,
      partKey: primary.partKey,
      partLabel: def.label,
      seedRgb: primary.seedRgb,
      partMode: "anatomyPart",
      anatomyPartId: def.id,
      companions: companions.map((c) => ({
        meshKey: c.meshKey,
        regionId: c.regionId,
        seedU: c.seedU,
        seedV: c.seedV,
        partMode: c.partMode || "anatomyPart",
        partKey: c.partKey,
        partLabel: c.partLabel || def.label,
        pixelCount: c.pixelCount,
        pick: c,
      })),
    };
    const hslSeed = {
      dh: 0,
      ds: 0,
      dl: 0,
      mode: "hsl",
      partMode: "anatomyPart",
      anatomyPartId: def.id,
      partLabel: def.label,
    };
    if (!meshColors[primary.meshKey]) meshColors[primary.meshKey] = {};
    meshColors[primary.meshKey][primary.regionId] = {
      ...hslSeed,
      seedU: primary.seedU,
      seedV: primary.seedV,
      partKey: primary.partKey,
    };
    for (const c of companions) {
      if (!meshColors[c.meshKey]) meshColors[c.meshKey] = {};
      meshColors[c.meshKey][c.regionId] = {
        ...hslSeed,
        seedU: c.seedU,
        seedV: c.seedV,
        partKey: c.partKey,
      };
    }
    highlightSelectedMesh();
    flashMask(primary.mesh, primary.mask);
    for (const c of companions) {
      const cm = c.mesh || listMeshes().find((m) => meshKey(m) === c.meshKey);
      if (cm) flashMask(cm, c.mask);
    }
    setPickMuscleModeInternal(false);
    hslScope = "selected";
    syncSelectedScopeHslFromStore();
    return true;
  }

  function selectAnatomyPart(partId) {
    const def = findAnatomyPartDef(partId);
    if (!def) return false;
    const layers = buildMasksForAnatomyPartDef(def);
    if (!layers.length) {
      console.warn("[bone_morph] anatomy part empty:", partId, def.label);
      return false;
    }
    const ok = applyAnatomyPartSelection(def, layers);
    if (ok) {
      console.log(
        `[bone_morph] anatomy part ${def.label} (${partId}) px=${selectedRegionMeta?.pixelCount} layers=${layers.length}`
      );
      onChange();
    }
    return ok;
  }

  const _earV0 = new T.Vector3();
  const _earV1 = new T.Vector3();
  const _earV2 = new T.Vector3();

  function isEarGeometryRegionId(regionId) {
    return regionId === "cq_ear_geom_L" || regionId === "cq_ear_geom_R";
  }

  function earGeometrySideFromRegionId(regionId) {
    return String(regionId).endsWith("_L") ? "L" : "R";
  }

  function earGeometryCenter(side) {
    const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!t) return null;
    const sign = side === "L" ? -1 : 1;
    return [t[0] + sign * earS(0.022), t[1] - earS(0.006), t[2] - earS(0.004)];
  }

  function earGeometryRadii() {
    return [earS(0.072), earS(0.092), earS(0.066)];
  }

  function earDeformGeometryRadii() {
    return [earS(0.066), earS(0.076), earS(0.06)];
  }

  /** 耳区 3D 边界：脖子 + 内侧（Static / 结构光栅化） */
  function worldPointInEarNeckGuard(wx, wy, wz, side) {
    const trag = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!trag) return true;
    if (worldPointInStaticEarLobule(wx, wy, wz, side)) return true;
    if (wy < trag[1] - earS(0.022)) return false;
    if (side === "L" && wx > trag[0] + earS(0.022)) return false;
    if (side === "R" && wx < trag[0] - earS(0.022)) return false;
    if (wz < trag[2] - earS(0.048)) return false;
    return true;
  }

  /** Static 耳垂：tragion 下方窄盒，避免脖子但含整耳垂壳 */
  function worldPointInStaticEarLobule(wx, wy, wz, side) {
    const trag = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!trag) return false;
    const [tx, ty, tz] = trag;
    if (wy > ty - earS(0.005) || wy < ty - earS(0.062)) return false;
    if (Math.abs(wz - tz) > earS(0.044)) return false;
    if (side === "L") {
      if (wx > tx + earS(0.01)) return false;
      if (wx < tx - earS(0.058)) return false;
    } else {
      if (wx < tx - earS(0.01)) return false;
      if (wx > tx + earS(0.058)) return false;
    }
    return true;
  }

  /** Deform 专用：再加颞肌上缘，防止染到颞肌 */
  function worldPointInEarDeformBounds(wx, wy, wz, side) {
    if (!worldPointInEarNeckGuard(wx, wy, wz, side)) return false;
    const trag = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (trag && wy > trag[1] + earS(0.02)) return false;
    return true;
  }

  function worldPointInEarBounds(wx, wy, wz, side) {
    return worldPointInEarNeckGuard(wx, wy, wz, side);
  }

  function worldPointInDeformEar(wx, wy, wz, side) {
    const center = earGeometryCenter(side);
    if (!center) return false;
    const [rx, ry, rz] = earDeformGeometryRadii();
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    if (side === "L" && wx > cx + earS(0.016)) return false;
    if (side === "R" && wx < cx - earS(0.016)) return false;
    const dx = (wx - cx) / rx;
    const dy = (wy - cy) / ry;
    const dz = (wz - cz) / rz;
    return dx * dx + dy * dy + dz * dz <= 1;
  }

  function worldPointInEarStrict(wx, wy, wz, side, isDeform = false) {
    const inE = isDeform
      ? worldPointInDeformEar(wx, wy, wz, side)
      : worldPointInEar(wx, wy, wz, side);
    if (!inE) return false;
    const trag = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!trag) return true;
    if (wy < trag[1] - earS(0.02)) return false;
    if (side === "L" && wx > trag[0] + earS(0.028)) return false;
    if (side === "R" && wx < trag[0] - earS(0.028)) return false;
    if (wz < trag[2] - earS(0.058)) return false;
    return true;
  }

  function worldPointInEar(wx, wy, wz, side) {
    const center = earGeometryCenter(side);
    if (!center) return false;
    const [rx, ry, rz] = earGeometryRadii();
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    if (side === "L" && wx > cx + earS(0.024)) return false;
    if (side === "R" && wx < cx - earS(0.024)) return false;
    const dx = (wx - cx) / rx;
    const dy = (wy - cy) / ry;
    const dz = (wz - cz) / rz;
    return dx * dx + dy * dy + dz * dz <= 1;
  }

  function isEarGeometryMesh(mesh) {
    const n = (mesh.name || meshKey(mesh) || "").toLowerCase();
    return n.includes("static") || n.includes("deform") || n.includes("acs");
  }

  function vertexInEarRegion(wx, wy, wz, side) {
    if (worldPointInEar(wx, wy, wz, side)) return true;
    const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!t) return false;
    if (side === "L" && wx > -earS(0.012)) return false;
    if (side === "R" && wx < earS(0.012)) return false;
    if (wy < t[1] - earS(0.028)) return false;
    if (wy > t[1] + earS(0.038)) return false;
    const dz = Math.abs(wz - t[2]);
    const dx = Math.abs(wx - t[0]);
    return dz <= earS(0.048) && dx <= earS(0.048);
  }

  /** Deform 耳肌：比 vertexInEarRegion 更紧，避免 SCM/面颊肌渗入 */
  function vertexInDeformEarRegion(wx, wy, wz, side) {
    if (worldPointInDeformEar(wx, wy, wz, side)) return true;
    if (!worldPointInEar(wx, wy, wz, side)) return false;
    const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!t) return false;
    if (wy < t[1] - earS(0.004)) return false;
    if (wy > t[1] + earS(0.03)) return false;
    if (side === "L" && wx > t[0] + earS(0.016)) return false;
    if (side === "R" && wx < t[0] - earS(0.016)) return false;
    const dz = Math.abs(wz - t[2]);
    const dx = Math.abs(wx - t[0]);
    return dz <= earS(0.04) && dx <= earS(0.036);
  }

  function vertexInEarMask(wx, wy, wz, side) {
    return worldPointInEar(wx, wy, wz, side);
  }

  /** 点击点落在耳部区域 → 几何整耳（不依赖贴图灰阶/连通） */
  function detectEarSideFromWorldPoint(p) {
    const wx = p.x != null ? p.x : p[0];
    const wy = p.y != null ? p.y : p[1];
    const wz = p.z != null ? p.z : p[2];
    let best = null;
    let bestD = Infinity;
    for (const side of ["L", "R"]) {
      if (!vertexInEarRegion(wx, wy, wz, side)) continue;
      const c = earGeometryCenter(side);
      if (!c) continue;
      const dx = wx - c[0];
      const dy = wy - c[1];
      const dz = wz - c[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = side;
      }
    }
    return best;
  }

  function dilateMaskPixels(mask, w, h, radius) {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            out[ny * w + nx] = 1;
          }
        }
      }
    }
    return out;
  }

  function uvNorm01(u) {
    let uu = u - Math.floor(u);
    if (uu < 0) uu += 1;
    return uu;
  }

  /** 在贴图 UV 空间光栅化三角面，填满耳区结构 mask（不只打顶点邻域） */
  function rasterizeUvTriangle(mask, atlas, o, u0, v0, u1, v1, u2, v2) {
    const { w, h } = atlas;
    const flipY = !!atlas.tex?.flipY;
    function toPx(u, v) {
      const uu = uvNorm01(u);
      const vv = uvNorm01(v);
      return { x: uu * w, y: (flipY ? 1 - vv : vv) * h };
    }
    const a = toPx(u0, v0);
    const b = toPx(u1, v1);
    const c = toPx(u2, v2);
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-6) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        const pi = y * w + x;
        const oi = pi * 4;
        if (isNearBlack(o[oi], o[oi + 1], o[oi + 2])) continue;
        mask[pi] = 1;
      }
    }
  }

  /** 几何孤岛 mask：按三角 UV 全覆盖，不跳过贴图黑边（避免耳等区域只高亮一半） */
  function rasterizeUvTriangleGeom(mask, atlas, u0, v0, u1, v1, u2, v2) {
    const { w, h } = atlas;
    const flipY = !!atlas.tex?.flipY;
    function toPx(u, v) {
      const uu = uvNorm01(u);
      const vv = uvNorm01(v);
      return { x: uu * w, y: (flipY ? 1 - vv : vv) * h };
    }
    const a = toPx(u0, v0);
    const b = toPx(u1, v1);
    const c = toPx(u2, v2);
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-6) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        mask[y * w + x] = 1;
      }
    }
  }

  function buildTriangleAdjacency(geom) {
    const index = geom.index;
    const pos = geom.attributes.position;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    const edgeMap = new Map();
    function edgeKey(a, b) {
      return a < b ? `${a}_${b}` : `${b}_${a}`;
    }
    function addEdge(a, b, tri) {
      const k = edgeKey(a, b);
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(tri);
    }
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      addEdge(ia, ib, t);
      addEdge(ib, ic, t);
      addEdge(ic, ia, t);
    }
    const adj = Array.from({ length: triCount }, () => []);
    for (const tris of edgeMap.values()) {
      if (tris.length < 2) continue;
      for (let i = 0; i < tris.length; i++) {
        for (let j = i + 1; j < tris.length; j++) {
          adj[tris[i]].push(tris[j]);
          adj[tris[j]].push(tris[i]);
        }
      }
    }
    return adj;
  }

  /** 按世界坐标焊接共边（解决 UV 接缝处重复顶点导致耳等被拆成多岛） */
  function buildTriangleAdjacencyWelded(geom, eps = 1e-5) {
    const index = geom.index;
    const pos = geom.attributes.position;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    const inv = eps > 0 ? 1 / eps : 100000;
    const edgeMap = new Map();
    function vKey(i) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      return `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    }
    function addEdge(a, b, tri) {
      const ka = vKey(a);
      const kb = vKey(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(tri);
    }
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      addEdge(ia, ib, t);
      addEdge(ib, ic, t);
      addEdge(ic, ia, t);
    }
    const adj = Array.from({ length: triCount }, () => []);
    for (const tris of edgeMap.values()) {
      if (tris.length < 2) continue;
      for (let i = 0; i < tris.length; i++) {
        for (let j = i + 1; j < tris.length; j++) {
          adj[tris[i]].push(tris[j]);
          adj[tris[j]].push(tris[i]);
        }
      }
    }
    return adj;
  }

  function triangleWorldData(mesh, triIndex) {
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const uvAttr = geom.attributes.uv;
    const index = geom.index;
    const ia = index ? index.getX(triIndex * 3) : triIndex * 3;
    const ib = index ? index.getX(triIndex * 3 + 1) : triIndex * 3 + 1;
    const ic = index ? index.getX(triIndex * 3 + 2) : triIndex * 3 + 2;
    const verts = [ia, ib, ic];
    const wx = [];
    const wy = [];
    const wz = [];
    const uvs = [];
    for (const vi of verts) {
      _earV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
      wx.push(_earV0.x);
      wy.push(_earV0.y);
      wz.push(_earV0.z);
      uvs.push([uvAttr.getX(vi), uvAttr.getY(vi)]);
    }
    return {
      wx,
      wy,
      wz,
      uvs,
      cx: (wx[0] + wx[1] + wx[2]) / 3,
      cy: (wy[0] + wy[1] + wy[2]) / 3,
      cz: (wz[0] + wz[1] + wz[2]) / 3,
    };
  }

  function findTriangleAtPoint(mesh, point, maxDist = 0.012) {
    const geom = mesh.geometry;
    const pos = geom?.attributes?.position;
    const index = geom.index;
    if (!pos || !point) return null;
    mesh.updateWorldMatrix(true, false);
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    let bestTri = -1;
    let bestD = Infinity;
    for (let t = 0; t < triCount; t++) {
      const td = triangleWorldData(mesh, t);
      const dx = td.cx - point.x;
      const dy = td.cy - point.y;
      const dz = td.cz - point.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestTri = t;
      }
    }
    if (bestTri < 0 || bestD > maxDist * maxDist) return null;
    return { faceIndex: bestTri, point };
  }

  function findDeformSeedFromHits(mesh, hits, side) {
    const direct = findMeshHitTriangle(mesh, hits);
    if (direct) return direct;
    for (const h of hits || []) {
      if (!h.point) continue;
      const n = (h.object?.name || meshKey(h.object) || "").toLowerCase();
      if (!n.includes("static") && !n.includes("deform") && !n.includes("acs")) continue;
      for (const maxDist of [0.02, 0.035, 0.05, 0.07, 0.09]) {
        const tri = findTriangleAtPoint(mesh, h.point, maxDist);
        if (!tri) continue;
        if (!triangleAllowedForEar(triangleWorldData(mesh, tri.faceIndex), side, h.point, 0.12, true)) {
          continue;
        }
        return { ...tri, point: h.point };
      }
    }
    return findEarSeedTriangle(mesh, side);
  }

  function findMeshHitTriangle(mesh, hits) {
    let best = null;
    for (const h of hits || []) {
      if (h.object !== mesh || !h.point) continue;
      if (h.faceIndex == null) continue;
      if (!best || h.distance < best.distance) best = h;
    }
    if (best) return best;
    for (const h of hits || []) {
      if (h.object !== mesh || !h.point) continue;
      const tri = findTriangleAtPoint(mesh, h.point);
      if (!tri) continue;
      if (!best || h.distance < best.distance) {
        best = { ...h, faceIndex: tri.faceIndex, point: h.point };
      }
    }
    return best;
  }

  function triangleAllowedForEar(td, side, seedPoint, maxDist, isDeform) {
    const trag = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (side === "L" && td.cx > 0.03) return false;
    if (side === "R" && td.cx < -0.03) return false;
    if (trag && td.cy < trag[1] - 0.034) {
      if (!worldPointInStaticEarLobule(td.cx, td.cy, td.cz, side)) return false;
    }
    if (isDeform && trag && td.cy > trag[1] + 0.022) return false;
    if (trag) {
      if (side === "L" && td.cx > trag[0] + 0.02) return false;
      if (side === "R" && td.cx < trag[0] - 0.02) return false;
      const zFloor = isDeform ? trag[2] - 0.05 : trag[2] - 0.058;
      if (td.cz < zFloor) return false;
    }
    const dx = td.cx - seedPoint.x;
    const dy = td.cy - seedPoint.y;
    const dz = td.cz - seedPoint.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const expand = isDeform ? maxDist * 0.92 : maxDist;
    if (dist > expand) return false;
    if (dist <= expand * 0.72) {
      if (!isDeform) return true;
      return (
        (worldPointInDeformEar(td.cx, td.cy, td.cz, side) ||
          worldPointInEar(td.cx, td.cy, td.cz, side) ||
          vertexInDeformEarRegion(td.cx, td.cy, td.cz, side)) &&
        worldPointInEarNeckGuard(td.cx, td.cy, td.cz, side)
      );
    }
    const inCentroid = isDeform
      ? worldPointInDeformEar(td.cx, td.cy, td.cz, side) ||
        worldPointInEar(td.cx, td.cy, td.cz, side) ||
        worldPointInStaticEarLobule(td.cx, td.cy, td.cz, side) ||
        vertexInDeformEarRegion(td.cx, td.cy, td.cz, side)
      : worldPointInEar(td.cx, td.cy, td.cz, side) ||
        worldPointInStaticEarLobule(td.cx, td.cy, td.cz, side);
    return inCentroid && worldPointInEarNeckGuard(td.cx, td.cy, td.cz, side);
  }

  /** 从点击命中 + tragion 种子做拓扑扩展，补上可见耳垂等 UV 岛 */
  function augmentEarMaskFromHits(mesh, side, mask, hits, staticMask = null) {
    if (!mask) return mask;
    const atlas = mesh.userData?.bmAtlas;
    if (!atlas) return mask;
    const isDeform = /deform/i.test(mesh.name || meshKey(mesh) || "");
    const dists = isDeform
      ? [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
      : [0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11];
    const maxPx = isDeform ? 18000 : 24000;
    for (const h of hits || []) {
      if (h.object !== mesh || !h.point) continue;
      ensureHitUvInMask(mask, atlas, h);
      for (const maxDist of dists) {
        const exp = maskEarByMeshExpansion(mesh, side, h, { maxDist });
        if (!exp) continue;
        const merged = orMasks(mask, exp);
        if (merged && maskPixelCount(merged) <= maxPx) mask = merged;
      }
    }
    const tragSeed = findEarSeedTriangle(mesh, side);
    if (tragSeed) {
      for (const maxDist of dists) {
        const exp = maskEarByMeshExpansion(mesh, side, tragSeed, { maxDist });
        if (!exp) continue;
        const merged = orMasks(mask, exp);
        if (merged && maskPixelCount(merged) <= maxPx) mask = merged;
      }
    }
    if (isDeform && staticMask) {
      mask = clipDeformToStaticMask(mask, staticMask, atlas, 1800);
    }
    return mask;
  }

  /** Deform 耳肌 mask 终裁：以 Static 耳软骨为权威边界 */
  function clipDeformToStaticMask(mask, staticMask, atlas, minPx = 1800) {
    if (!mask || !staticMask || !atlas) return mask;
    const clipped = andMasks(mask, dilateMaskPixels(staticMask, atlas.w, atlas.h, 2));
    const px = clipped ? maskPixelCount(clipped) : 0;
    if (px >= minPx) return clipped;
    console.warn(
      `[bone_morph] deform ear clip to static too small (${px}px < ${minPx}), keeping unclipped`
    );
    return mask;
  }

  function ensureHitUvInMask(mask, atlas, hit) {
    if (!mask || !atlas || !hit?.uv) return mask;
    const p = uvToPixel(atlas, hit.uv.x, hit.uv.y);
    const w = atlas.w;
    const h = atlas.h;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        mask[y * w + x] = 1;
      }
    }
    return mask;
  }

  /** 从点击命中的三角面出发，按网格拓扑 + 3D 距离扩展整耳（非颜色 flood） */
  function maskEarByMeshExpansion(mesh, side, seedHit, opts = {}) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas?.orig || !seedHit?.point) return null;
    let seedTri = seedHit.faceIndex;
    if (seedTri == null) {
      const tri = findTriangleAtPoint(mesh, seedHit.point);
      if (!tri) return null;
      seedTri = tri.faceIndex;
    }
    const isDeform = /deform/i.test(mesh.name || meshKey(mesh) || "");
    const maxDist = opts.maxDist ?? (isDeform ? 0.088 : 0.104);
    const geom = mesh.geometry;
    const pos = geom?.attributes?.position;
    const uvAttr = geom?.attributes?.uv;
    if (!pos || !uvAttr) return null;
    mesh.updateWorldMatrix(true, false);
    const { w, h, orig } = atlas;
    const o = orig.data;
    const mask = new Uint8Array(w * h);
    const adj = buildTriangleAdjacency(geom);
    if (seedTri < 0 || seedTri >= adj.length) return null;
    const seedPoint = seedHit.point;
    const included = new Set([seedTri]);
    const queue = [seedTri];
    while (queue.length) {
      const t = queue.shift();
      const td = triangleWorldData(mesh, t);
      rasterizeUvTriangle(
        mask,
        atlas,
        o,
        td.uvs[0][0],
        td.uvs[0][1],
        td.uvs[1][0],
        td.uvs[1][1],
        td.uvs[2][0],
        td.uvs[2][1]
      );
      for (const nb of adj[t] || []) {
        if (included.has(nb)) continue;
        const ntd = triangleWorldData(mesh, nb);
        if (!triangleAllowedForEar(ntd, side, seedPoint, maxDist, isDeform)) continue;
        included.add(nb);
        queue.push(nb);
      }
    }
    if (maskPixelCount(mask) < 80) return null;
    const meshHit = findMeshHitTriangle(mesh, [seedHit]);
    if (meshHit) ensureHitUvInMask(mask, atlas, meshHit);
    return mask;
  }

  function maskEarByStructure(mesh, side, opts) {
    const tight = opts?.tight === true;
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas?.orig || !side) return null;
    if (!earGeometryCenter(side)) return null;
    const isDeform = /deform/i.test(mesh.name || meshKey(mesh) || "");
    const { w, h, orig } = atlas;
    const o = orig.data;
    const mask = new Uint8Array(w * h);
    const geom = mesh.geometry;
    const pos = geom?.attributes?.position;
    const uvAttr = geom?.attributes?.uv;
    if (!pos || !uvAttr) return null;
    mesh.updateWorldMatrix(true, false);

    function inEar(wx, wy, wz) {
      if (isDeform) {
        const ok =
          worldPointInDeformEar(wx, wy, wz, side) ||
          worldPointInEar(wx, wy, wz, side) ||
          worldPointInStaticEarLobule(wx, wy, wz, side) ||
          vertexInEarRegion(wx, wy, wz, side);
        if (!ok) return false;
        return worldPointInEarNeckGuard(wx, wy, wz, side);
      }
      if (!isDeform) {
        if (worldPointInStaticEarLobule(wx, wy, wz, side)) return true;
        if (worldPointInEar(wx, wy, wz, side)) {
          return worldPointInEarNeckGuard(wx, wy, wz, side);
        }
        const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
        if (!t) return false;
        if (wy < t[1] - 0.062) return false;
        if (side === "L" && wx > -0.01) return false;
        if (side === "R" && wx < 0.01) return false;
        const dz = Math.abs(wz - t[2]);
        const dx = Math.abs(wx - t[0]);
        return dz <= 0.048 && dx <= 0.048 && worldPointInEarNeckGuard(wx, wy, wz, side);
      }
    }

    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    const structCull = earWorldCullBox(side, isDeform ? "deform" : "static");
    for (let t = 0; t < triCount; t++) {
      if (!triangleCentroidInEarCullBox(mesh, t, structCull)) continue;
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const verts = [ia, ib, ic];
      const wx = [];
      const wy = [];
      const wz = [];
      const uvs = [];
      let any = false;
      for (const vi of verts) {
        _earV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
        wx.push(_earV0.x);
        wy.push(_earV0.y);
        wz.push(_earV0.z);
        uvs.push([uvAttr.getX(vi), uvAttr.getY(vi)]);
        if (inEar(_earV0.x, _earV0.y, _earV0.z)) any = true;
      }
      const mx = (wx[0] + wx[1] + wx[2]) / 3;
      const my = (wy[0] + wy[1] + wy[2]) / 3;
      const mz = (wz[0] + wz[1] + wz[2]) / 3;
      let centroidOk = worldPointInEarNeckGuard(mx, my, mz, side);
      if (!any || !centroidOk) continue;
      rasterizeUvTriangle(
        mask,
        atlas,
        o,
        uvs[0][0],
        uvs[0][1],
        uvs[1][0],
        uvs[1][1],
        uvs[2][0],
        uvs[2][1]
      );
    }

    if (maskPixelCount(mask) < 80) return null;
    return mask;
  }

  /** Deform 裁切用：仅椭球 + 脖子护栏，不含 vertexInEarRegion 扩展 */
  function maskEarByEllipsoidOnly(mesh, side) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas?.orig || !side) return null;
    const geom = mesh.geometry;
    const pos = geom?.attributes?.position;
    const uvAttr = geom?.attributes?.uv;
    if (!pos || !uvAttr) return null;
    mesh.updateWorldMatrix(true, false);
    const { w, h, orig } = atlas;
    const o = orig.data;
    const mask = new Uint8Array(w * h);
    const isDeform = /deform/i.test(mesh.name || meshKey(mesh) || "");
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const verts = [ia, ib, ic];
      const wx = [];
      const wy = [];
      const wz = [];
      const uvs = [];
      let any = false;
      for (const vi of verts) {
        _earV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
        wx.push(_earV0.x);
        wy.push(_earV0.y);
        wz.push(_earV0.z);
        uvs.push([uvAttr.getX(vi), uvAttr.getY(vi)]);
        const inE = isDeform
          ? worldPointInDeformEar(_earV0.x, _earV0.y, _earV0.z, side) ||
            worldPointInEar(_earV0.x, _earV0.y, _earV0.z, side)
          : worldPointInEar(_earV0.x, _earV0.y, _earV0.z, side);
        if (inE) any = true;
      }
      const mx = (wx[0] + wx[1] + wx[2]) / 3;
      const my = (wy[0] + wy[1] + wy[2]) / 3;
      const mz = (wz[0] + wz[1] + wz[2]) / 3;
      let centroidOk = worldPointInEarNeckGuard(mx, my, mz, side);
      if (!any || !centroidOk) continue;
      rasterizeUvTriangle(
        mask,
        atlas,
        o,
        uvs[0][0],
        uvs[0][1],
        uvs[1][0],
        uvs[1][1],
        uvs[2][0],
        uvs[2][1]
      );
    }
    return maskPixelCount(mask) >= 80 ? mask : null;
  }

  function maskEarByGeometry(mesh, side) {
    return maskEarByStructure(mesh, side, { tight: false });
  }

  /** 在 mesh 上找耳椭球内距耳心最近的顶点，作 Deform 耳肌 flood 种子 */
  function findEarSeedOnMesh(mesh, side) {
    const center = earGeometryCenter(side);
    if (!center) return null;
    const pos = mesh.geometry?.attributes?.position;
    const uvAttr = mesh.geometry?.attributes?.uv;
    if (!pos || !uvAttr) return null;
    mesh.updateWorldMatrix(true, false);
    let bestVi = -1;
    let bestD = Infinity;
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    for (let vi = 0; vi < pos.count; vi++) {
      _earV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
      if (!vertexInEarRegion(_earV0.x, _earV0.y, _earV0.z, side)) continue;
      const dx = _earV0.x - cx;
      const dy = _earV0.y - cy;
      const dz = _earV0.z - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestVi = vi;
      }
    }
    const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (bestVi < 0 && t) {
      for (let vi = 0; vi < pos.count; vi++) {
        _earV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
        if (side === "L" && _earV0.x > -0.008) continue;
        if (side === "R" && _earV0.x < 0.008) continue;
        const dy = Math.abs(_earV0.y - t[1]);
        const dz = Math.abs(_earV0.z - t[2]);
        if (dy > 0.085 || dz > 0.07) continue;
        const dx = _earV0.x - t[0];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestVi = vi;
        }
      }
    }
    if (bestVi < 0) return null;
    _earV0.fromBufferAttribute(pos, bestVi).applyMatrix4(mesh.matrixWorld);
    return {
      uv: { x: uvAttr.getX(bestVi), y: uvAttr.getY(bestVi) },
      point: { x: _earV0.x, y: _earV0.y, z: _earV0.z },
    };
  }

  function findUvNearWorldPoint(mesh, wx, wy, wz, side = null) {
    const pos = mesh.geometry?.attributes?.position;
    const uvAttr = mesh.geometry?.attributes?.uv;
    if (!pos || !uvAttr) return null;
    mesh.updateWorldMatrix(true, false);
    let bestVi = -1;
    let bestD = Infinity;
    for (let vi = 0; vi < pos.count; vi++) {
      _earV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
      if (side === "L" && _earV0.x > 0.02) continue;
      if (side === "R" && _earV0.x < -0.02) continue;
      const dx = _earV0.x - wx;
      const dy = _earV0.y - wy;
      const dz = _earV0.z - wz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestVi = vi;
      }
    }
    if (bestVi < 0) return null;
    return { x: uvAttr.getX(bestVi), y: uvAttr.getY(bestVi) };
  }

  function floodDeformEarNearTragion(deformMesh, side) {
    return finalizeStructuralEarMask(deformMesh, side);
  }

  function floodStaticEarNearTragion(staticMesh, side) {
    return finalizeStructuralEarMask(staticMesh, side);
  }

  function seedUvFromMask(atlas, mask) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      sx += p % atlas.w;
      sy += (p / atlas.w) | 0;
      c++;
    }
    if (!c) return { seedU: 0.5, seedV: 0.5 };
    const px = sx / c + 0.5;
    const py = sy / c + 0.5;
    const flipY = !!atlas.tex?.flipY;
    return {
      seedU: px / atlas.w,
      seedV: flipY ? 1 - py / atlas.h : py / atlas.h,
    };
  }

  function earMeshLocalFlood(mesh, atlas, seedX, seedY, sr, sg, sb, worldPoint = null) {
    if (isStaticEarCartilageSeed(mesh, sr, sg, sb)) {
      const m = floodStaticEarCartilageMask(atlas, seedX, seedY, mesh);
      if (m && maskPixelCount(m) <= 28000) return m;
      return null;
    }
    const mn = (mesh.name || meshKey(mesh) || "").toLowerCase();
    if (mn.includes("deform") || mn.includes("acs")) {
      const flooded = floodMaskFromSeed(atlas, seedX, seedY, 26 / 360, mesh, worldPoint);
      if (flooded && maskPixelCount(flooded) <= 22000) return flooded;
    }
    return null;
  }

  function findEarSeedTriangle(mesh, side) {
    const seed = findEarSeedOnMesh(mesh, side);
    if (!seed?.point) return null;
    const geom = mesh.geometry;
    const pos = geom?.attributes?.position;
    const index = geom.index;
    if (!pos) return null;
    mesh.updateWorldMatrix(true, false);
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    let bestTri = -1;
    let bestD = Infinity;
    const sp = seed.point;
    for (let t = 0; t < triCount; t++) {
      const td = triangleWorldData(mesh, t);
      if (!triangleAllowedForEar(td, side, sp, 0.08, /deform/i.test(mesh.name || ""))) continue;
      const dx = td.cx - sp.x;
      const dy = td.cy - sp.y;
      const dz = td.cz - sp.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestTri = t;
      }
    }
    if (bestTri < 0) return null;
    const td = triangleWorldData(mesh, bestTri);
    return {
      faceIndex: bestTri,
      point: { x: td.cx, y: td.cy, z: td.cz },
    };
  }

  function finalizeStructuralEarMask(mesh, side, staticMask = null, hits = null) {
    const atlas = mesh.userData?.bmAtlas;
    if (!atlas) return null;
    const isDeform = /deform/i.test(mesh.name || meshKey(mesh) || "");
    const w = atlas.w;
    const h = atlas.h;

    function acceptCandidate(raw) {
      if (!raw) return null;
      let m = dilateMaskPixels(raw, w, h, 1);
      const meshHit = findMeshHitTriangle(mesh, hits);
      if (meshHit) ensureHitUvInMask(m, atlas, meshHit);
      if (hits) {
        for (const h0 of hits) {
          if (h0.object !== mesh || !h0.uv) continue;
          ensureHitUvInMask(m, atlas, h0);
        }
      }
      const px = maskPixelCount(m);
      const maxPx = isDeform ? 18000 : 22000;
      const minPx = isDeform ? 1800 : 3500;
      if (px < minPx || px > maxPx) return null;
      return m;
    }

    let mask = acceptCandidate(maskEarByStructure(mesh, side, { tight: true }));

    const hitSeed = isDeform
      ? findDeformSeedFromHits(mesh, hits, side)
      : findMeshHitTriangle(mesh, hits);
    const dists = isDeform
      ? [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
      : [0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11];

    if (hitSeed) {
      let bestExp = null;
      let bestPx = 0;
      for (const maxDist of dists) {
        const accepted = acceptCandidate(
          maskEarByMeshExpansion(mesh, side, hitSeed, { maxDist })
        );
        if (!accepted) continue;
        const px = maskPixelCount(accepted);
        if (px > bestPx) {
          bestPx = px;
          bestExp = accepted;
        }
      }
      if (bestExp) {
        if (mask) {
          const merged = acceptCandidate(orMasks(mask, bestExp));
          if (merged) mask = merged;
        } else {
          mask = bestExp;
        }
      }
    }

    if (!mask && isDeform) {
      const tragSeed = findEarSeedTriangle(mesh, side);
      if (tragSeed) {
        for (const maxDist of dists) {
          const accepted = acceptCandidate(
            maskEarByMeshExpansion(mesh, side, tragSeed, { maxDist })
          );
          if (accepted) {
            mask = accepted;
            break;
          }
        }
      }
    }

    if (!mask && isDeform && staticMask) {
      const bounded = acceptCandidate(
        andMasks(maskEarByStructure(mesh, side, { tight: true }), staticMask)
      );
      if (bounded) mask = bounded;
    }

    if (!mask && !isDeform) {
      const tragSeed = findEarSeedTriangle(mesh, side);
      if (tragSeed) {
        for (const maxDist of dists) {
          const accepted = acceptCandidate(
            maskEarByMeshExpansion(mesh, side, tragSeed, { maxDist })
          );
          if (accepted) {
            mask = accepted;
            break;
          }
        }
      }
    }

    if (mask && isDeform) {
      const pxBefore = maskPixelCount(mask);
      if (staticMask && pxBefore > 5500) {
        const clippedStatic = andMasks(mask, dilateMaskPixels(staticMask, w, h, 2));
        const pxStatic = maskPixelCount(clippedStatic);
        if (pxStatic >= 1800 && pxStatic <= 18000) {
          mask = clippedStatic;
        }
      }
      if (maskPixelCount(mask) > 8000) {
        const ellipsoid = maskEarByEllipsoidOnly(mesh, side);
        if (ellipsoid) {
          const clipped = andMasks(mask, dilateMaskPixels(ellipsoid, w, h, 3));
          const accepted = acceptCandidate(clipped);
          if (accepted) mask = accepted;
        }
      }
    }

    return mask;
  }

  function maskTriangleTouchesMask(atlas, staticMask, uvs) {
    const { w, h } = atlas;
    for (const uv of uvs) {
      const p = uvToPixel(atlas, uv[0], uv[1]);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (staticMask[y * w + x]) return true;
    }
    return false;
  }

  /** 从 Static 耳软骨 mask 收集 3D 种子点（用于 Deform 世界空间跟随） */
  function collectStaticEarWorldSeeds(staticMesh, staticMask, maxSamples) {
    const cap = maxSamples || 480;
    const geom = staticMesh?.geometry;
    const atlas = staticMesh?.userData?.bmAtlas;
    if (!geom || !staticMask || !atlas) return [];
    staticMesh.updateWorldMatrix(true, false);
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(geom.attributes.position.count / 3);
    const seeds = [];
    for (let t = 0; t < triCount; t++) {
      const td = triangleWorldData(staticMesh, t);
      if (!maskTriangleTouchesMask(atlas, staticMask, td.uvs)) continue;
      seeds.push({ x: td.cx, y: td.cy, z: td.cz });
      if (seeds.length >= cap) break;
    }
    return seeds;
  }

  /**
   * Deform 耳肌：三角面质心须在 Static 耳软骨 3D 邻域内 + 颞肌上缘护栏。
   * 不依赖 UV 岛重叠，避免染到颞肌/脖子。
   */
  function maskDeformEarByWorldProximity(deformMesh, staticMesh, staticMask, side) {
    const atlas = deformMesh?.userData?.bmAtlas;
    if (!atlas?.orig || !staticMesh || !staticMask) return null;
    const seeds = collectStaticEarWorldSeeds(staticMesh, staticMask);
    if (seeds.length < 6) return null;

    const maxDistSq = 0.058 * 0.058;
    const stride = seeds.length > 220 ? Math.ceil(seeds.length / 220) : 1;

    deformMesh.updateWorldMatrix(true, false);
    const geom = deformMesh.geometry;
    const pos = geom?.attributes?.position;
    const uvAttr = geom?.attributes?.uv;
    if (!pos || !uvAttr) return null;

    const { w, h, orig } = atlas;
    const o = orig.data;
    const mask = new Uint8Array(w * h);
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);

    for (let t = 0; t < triCount; t++) {
      const td = triangleWorldData(deformMesh, t);
      if (!worldPointInEarNeckGuard(td.cx, td.cy, td.cz, side)) continue;
      if (!vertexInDeformEarRegion(td.cx, td.cy, td.cz, side)) continue;
      let near = false;
      for (let si = 0; si < seeds.length; si += stride) {
        const s = seeds[si];
        const dx = td.cx - s.x;
        const dy = td.cy - s.y;
        const dz = td.cz - s.z;
        if (dx * dx + dy * dy + dz * dz <= maxDistSq) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      rasterizeUvTriangle(
        mask,
        atlas,
        o,
        td.uvs[0][0],
        td.uvs[0][1],
        td.uvs[1][0],
        td.uvs[1][1],
        td.uvs[2][0],
        td.uvs[2][1]
      );
    }
    return maskPixelCount(mask) >= 80 ? mask : null;
  }

  /** colourcoded 高饱和肌块（颞肌绿等）—— 耳区 Deform 必须排除 */
  function isColouredMuscleOrigPixel(r, g, b) {
    const c = rgbToHsl(r, g, b);
    if (isNearBlack(r, g, b)) return false;
    return c.s >= 0.2;
  }

  /** Deform 耳周：低饱和灰（非颞肌/颊肌彩色块） */
  function isEarPeriauricularGray(r, g, b) {
    const c = rgbToHsl(r, g, b);
    if (isNearBlack(r, g, b)) return false;
    if (c.s >= 0.28) return false;
    return c.l >= 0.3 && c.l <= 0.82;
  }

  function origRgbAtUv(atlas, u, v) {
    const p = uvToPixel(atlas, u, v);
    if (p.x < 0 || p.y < 0 || p.x >= atlas.w || p.y >= atlas.h) return null;
    const oi = (p.y * atlas.w + p.x) * 4;
    const o = atlas.orig.data;
    return [o[oi], o[oi + 1], o[oi + 2]];
  }

  /**
   * 解剖 ROI（tragion 锚定）：三角面光栅化到 UV，不用颜色 flood / 邻近扩展。
   * 参考 mesh-painter / 医学标注：世界空间区域 → 投影到贴图。
   */
  function earAnatomicalROI(wx, wy, wz, side, layer) {
    const trag = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!trag) return false;
    if (!worldPointInEarNeckGuard(wx, wy, wz, side)) return false;
    if (side === "L" && wx > trag[0] + earS(0.034)) return false;
    if (side === "R" && wx < trag[0] - earS(0.034)) return false;
    const yLo = trag[1] - earS(0.044);
    const yHi = layer === "static" ? trag[1] + earS(0.058) : trag[1] + earS(0.008);
    if (wy < yLo || wy > yHi) return false;
    if (wz < trag[2] - earS(0.064) || wz > trag[2] + earS(0.05)) return false;
    if (Math.abs(wx - trag[0]) > earS(0.06)) return false;
    return true;
  }

  const _earCullBoxCache = {};

  /** 耳部三角面光栅化粗筛：质心须在 tragion 邻域包围盒内 */
  function earWorldCullBox(side, layer) {
    const key = `${side}|${layer}`;
    if (_earCullBoxCache[key]) return _earCullBoxCache[key];
    const trag = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!trag) return null;
    const [tx, ty, tz] = trag;
    const box = {
      minX: side === "L" ? tx - earS(0.072) : tx - earS(0.072),
      maxX: side === "L" ? tx + earS(0.038) : tx + earS(0.072),
      minY: ty - earS(0.048),
      maxY: layer === "static" ? ty + earS(0.062) : ty + earS(0.012),
      minZ: tz - earS(0.068),
      maxZ: tz + earS(0.054),
    };
    _earCullBoxCache[key] = box;
    return box;
  }

  function triangleCentroidInEarCullBox(mesh, triIndex, box) {
    if (!box) return true;
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const index = geom.index;
    const ia = index ? index.getX(triIndex * 3) : triIndex * 3;
    const ib = index ? index.getX(triIndex * 3 + 1) : triIndex * 3 + 1;
    const ic = index ? index.getX(triIndex * 3 + 2) : triIndex * 3 + 2;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const vi of [ia, ib, ic]) {
      _earV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
      sx += _earV0.x;
      sy += _earV0.y;
      sz += _earV0.z;
    }
    const cx = sx / 3;
    const cy = sy / 3;
    const cz = sz / 3;
    return (
      cx >= box.minX &&
      cx <= box.maxX &&
      cy >= box.minY &&
      cy <= box.maxY &&
      cz >= box.minZ &&
      cz <= box.maxZ
    );
  }

  function bakeEarMaskByAnatomy(mesh, side, hits = null) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas?.orig || !side) return null;
    const n = (mesh.name || meshKey(mesh) || "").toLowerCase();
    const layer = /deform/i.test(n) ? "deform" : /static/i.test(n) ? "static" : null;
    if (!layer) return null;
    const geom = mesh.geometry;
    const pos = geom?.attributes?.position;
    const uvAttr = geom?.attributes?.uv;
    if (!pos || !uvAttr) return null;
    mesh.updateWorldMatrix(true, false);
    const { w, h, orig } = atlas;
    const o = orig.data;
    const mask = new Uint8Array(w * h);
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    const cullBox = earWorldCullBox(side, layer);

    for (let t = 0; t < triCount; t++) {
      if (!triangleCentroidInEarCullBox(mesh, t, cullBox)) continue;
      const td = triangleWorldData(mesh, t);
      let inRoi = earAnatomicalROI(td.cx, td.cy, td.cz, side, layer);
      if (!inRoi && layer === "static") {
        for (let i = 0; i < 3; i++) {
          if (earAnatomicalROI(td.wx[i], td.wy[i], td.wz[i], side, layer)) {
            inRoi = true;
            break;
          }
        }
      }
      if (!inRoi && layer === "deform") {
        if (
          earAnatomicalROI(td.cx, td.cy, td.cz, side, layer) ||
          vertexInDeformEarRegion(td.cx, td.cy, td.cz, side)
        ) {
          inRoi = true;
        } else {
          for (let i = 0; i < 3; i++) {
            if (
              earAnatomicalROI(td.wx[i], td.wy[i], td.wz[i], side, layer) ||
              vertexInDeformEarRegion(td.wx[i], td.wy[i], td.wz[i], side)
            ) {
              inRoi = true;
              break;
            }
          }
        }
      }
      if (!inRoi) continue;

      const cu = (td.uvs[0][0] + td.uvs[1][0] + td.uvs[2][0]) / 3;
      const cv = (td.uvs[0][1] + td.uvs[1][1] + td.uvs[2][1]) / 3;
      const rgb = origRgbAtUv(atlas, cu, cv);
      if (!rgb) continue;

      if (layer === "static" && isColouredMuscleOrigPixel(rgb[0], rgb[1], rgb[2])) {
        continue;
      }

      rasterizeUvTriangle(
        mask,
        atlas,
        o,
        td.uvs[0][0],
        td.uvs[0][1],
        td.uvs[1][0],
        td.uvs[1][1],
        td.uvs[2][0],
        td.uvs[2][1]
      );
    }

    if (hits) {
      const hit = findMeshHitTriangle(mesh, hits);
      if (hit) ensureHitUvInMask(mask, atlas, hit);
    }
    return maskPixelCount(mask) >= 80 ? mask : null;
  }

  function stripColouredMuscleFromMask(mesh, mask) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas?.orig || !mask) return null;
    const o = atlas.orig.data;
    const out = new Uint8Array(mask.length);
    let n = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      if (isColouredMuscleOrigPixel(o[i], o[i + 1], o[i + 2])) continue;
      out[p] = 1;
      n++;
    }
    return n >= 80 ? out : null;
  }

  /** 权威耳 mask：单遍三角面光栅化（结构+解剖），避免 attach/点选时多次全网格扫描 */
  function worldPointQualifiesForEarMask(wx, wy, wz, side, isDeform) {
    if (isDeform) {
      const ok =
        worldPointInDeformEar(wx, wy, wz, side) ||
        worldPointInEar(wx, wy, wz, side) ||
        worldPointInStaticEarLobule(wx, wy, wz, side) ||
        vertexInEarRegion(wx, wy, wz, side);
      if (!ok) return false;
      return worldPointInEarNeckGuard(wx, wy, wz, side);
    }
    if (worldPointInStaticEarLobule(wx, wy, wz, side)) return true;
    if (worldPointInEar(wx, wy, wz, side)) {
      return worldPointInEarNeckGuard(wx, wy, wz, side);
    }
    const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
    if (!t) return false;
    if (wy < t[1] - 0.062) return false;
    if (side === "L" && wx > -0.01) return false;
    if (side === "R" && wx < 0.01) return false;
    const dz = Math.abs(wz - t[2]);
    const dx = Math.abs(wx - t[0]);
    return dz <= 0.048 && dx <= 0.048 && worldPointInEarNeckGuard(wx, wy, wz, side);
  }

  function triangleQualifiesForAuthoritativeEar(td, side, isDeform) {
    const layer = isDeform ? "deform" : "static";
    let any = false;
    for (let i = 0; i < 3; i++) {
      if (worldPointQualifiesForEarMask(td.wx[i], td.wy[i], td.wz[i], side, isDeform)) {
        any = true;
      }
      if (earAnatomicalROI(td.wx[i], td.wy[i], td.wz[i], side, layer)) any = true;
    }
    if (!any) {
      if (worldPointQualifiesForEarMask(td.cx, td.cy, td.cz, side, isDeform)) any = true;
      if (earAnatomicalROI(td.cx, td.cy, td.cz, side, layer)) any = true;
      if (isDeform && vertexInDeformEarRegion(td.cx, td.cy, td.cz, side)) any = true;
    }
    if (!any) return false;
    return worldPointInEarNeckGuard(td.cx, td.cy, td.cz, side);
  }

  function buildAuthoritativeEarMask(mesh, side, staticMask = null) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas?.orig || !side) return null;
    const isDeform = /deform/i.test(mesh.name || meshKey(mesh) || "");
    const layer = isDeform ? "deform" : "static";
    const { w, h, orig } = atlas;
    const o = orig.data;
    const geom = mesh.geometry;
    const pos = geom?.attributes?.position;
    const uvAttr = geom?.attributes?.uv;
    if (!pos || !uvAttr) return null;
    mesh.updateWorldMatrix(true, false);
    let mask = new Uint8Array(w * h);
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);

    for (let t = 0; t < triCount; t++) {
      const td = triangleWorldData(mesh, t);
      if (!triangleQualifiesForAuthoritativeEar(td, side, isDeform)) continue;
      const cu = (td.uvs[0][0] + td.uvs[1][0] + td.uvs[2][0]) / 3;
      const cv = (td.uvs[0][1] + td.uvs[1][1] + td.uvs[2][1]) / 3;
      const rgb = origRgbAtUv(atlas, cu, cv);
      if (!rgb) continue;
      if (layer === "static" && isColouredMuscleOrigPixel(rgb[0], rgb[1], rgb[2])) {
        continue;
      }
      rasterizeUvTriangle(
        mask,
        atlas,
        o,
        td.uvs[0][0],
        td.uvs[0][1],
        td.uvs[1][0],
        td.uvs[1][1],
        td.uvs[2][0],
        td.uvs[2][1]
      );
    }

    if (maskPixelCount(mask) < 80) mask = null;

    if (isDeform && staticMask && mask) {
      mask = clipDeformToStaticMask(mask, staticMask, atlas, 400);
      if (!mask || maskPixelCount(mask) < 400) {
        const staticMesh = listMeshes().find(
          (m) => /static/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
        );
        const prox = staticMesh
          ? maskDeformEarByWorldProximity(mesh, staticMesh, staticMask, side)
          : null;
        if (prox) mask = prox;
      }
    }

    const minPx = isDeform ? 400 : 800;
    if (!mask || maskPixelCount(mask) < minPx) return null;
    let out = dilateMaskPixels(mask, w, h, isDeform ? 2 : 3);
    if (!isDeform && maskPixelCount(out) < 6000) {
      const seedTri = findEarSeedTriangle(mesh, side);
      if (seedTri) {
        const expanded = maskEarByMeshExpansion(mesh, side, seedTri, { maxDist: 0.11 });
        if (expanded) out = orMasks(out, expanded);
        out = dilateMaskPixels(out, w, h, 1);
      }
    }
    return out;
  }

  function invalidateEarPickCache(clearTimer = true) {
    earPickCache = { L: null, R: null };
    earPickCacheReady = false;
    earCacheBuildJob = null;
    for (const k of Object.keys(_earCullBoxCache)) delete _earCullBoxCache[k];
    if (clearTimer && earCacheRebuildTimer) {
      clearTimeout(earCacheRebuildTimer);
      earCacheRebuildTimer = 0;
    }
  }

  /** 仅在该侧耳 mask 已按需构建后，恢复 session 里保存的耳部设色 */
  function replaySavedEarColorsForSide(side) {
    const rid = side === "L" ? "cq_ear_geom_L" : "cq_ear_geom_R";
    let hasEar = false;
    for (const mesh of listMeshes()) {
      const regions = meshColors[meshKey(mesh)];
      if (!regions?.[rid]) continue;
      hasEar = true;
      ensureEarGeometryMask(mesh, rid);
    }
    if (hasEar) replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true });
  }

  let earCacheWarmToken = 0;

  /** 空闲时预建左右耳选区缓存（不阻塞打开页面；拧形后会 invalidate） */
  function warmEarPickCacheOnIdle() {
    if (earPickCacheReady) return;
    const token = ++earCacheWarmToken;
    const run = () => {
      if (token !== earCacheWarmToken || earPickCacheReady || !root) return;
      const staticMesh = listMeshes().find(
        (m) => /static/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
      );
      if (!staticMesh) return;
      for (const side of ["L", "R"]) {
        if (earPickCache[side]?.primary) continue;
        const seed = findEarSeedOnMesh(staticMesh, side);
        if (!seed?.point) continue;
        const hits = [
          {
            point: seed.point,
            object: staticMesh,
            distance: 0,
            uv: seed.uv,
          },
        ];
        const built = pickEarLayersFromHit(hits, side);
        if (built?.primary && (built.primary.pixelCount || 0) >= 8000) {
          earPickCache[side] = built;
        }
      }
      earPickCacheReady = !!(earPickCache.L || earPickCache.R);
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 12000 });
    } else {
      setTimeout(run, 1800);
    }
  }

  function buildEarPickForSide(side, staticMesh, deformMesh) {
    if (earPickCache[side]?.primary) return earPickCache[side];
    if (!staticMesh || !deformMesh) return null;
    if (!targetOf(side === "L" ? "tragion_L" : "tragion_R")) return null;

    console.log(`[bone_morph] ear pick: on-demand build ${side} (Alt+click only)`);
    const staticMask = buildAuthoritativeEarMask(staticMesh, side, null);
    if (!staticMask) {
      console.warn(`[bone_morph] ear pick: static ${side} failed`);
      return null;
    }
    const deformMask = buildAuthoritativeEarMask(deformMesh, side, staticMask);
    if (!deformMask) {
      console.warn(`[bone_morph] ear pick: deform ${side} failed`);
      return null;
    }
    const primary = layerPickFromMask(staticMesh, side, staticMask, "耳软骨");
    const companion = layerPickFromMask(deformMesh, side, deformMask, "耳肌");
    if (!primary || !companion) return null;
    const pick = { side, primary, companions: [companion] };
    earPickCache[side] = pick;
    earPickCacheReady = !!(earPickCache.L || earPickCache.R);
    replaySavedEarColorsForSide(side);
    return pick;
  }

  function resetProjectSessionState() {
    showSelectionOverlay = false;
    if (hslPaintRaf) {
      cancelAnimationFrame(hslPaintRaf);
      hslPaintRaf = 0;
    }
    hslPaintQueued = null;
    meshColors = {};
    meshOrigColors = {};
    selectedMeshKey = "";
    selectedRegionKey = "";
    selectedAnatomyPartId = "";
    islandChecked.clear();
    islandHighlightToken = "";
    islandFocusToken = "";
    islandOffsetsByToken.clear();
    clearIslandFlashTimer();
    clearCheckedIslandPreviews();
    islandTreeCollapsed.clear();
    islandScanDone = false;
    disposeTextureQuiltWorker();
    islandTextureSynth.clear();
    islandTextureSynthBusy = false;
    if (textureSynthDebounceTimer) {
      clearTimeout(textureSynthDebounceTimer);
      textureSynthDebounceTimer = 0;
    }
    islandTextureSynthParams = { seed: 12345, similarity: 0.7, blockScale: 24 };
    clearIslandMeshHighlight();
    selectedRegionMeta = null;
    hslScope = "selected";
    scopeHsl = {
      selected: { dh: 0, ds: 0, dl: 0 },
      muscles: { dh: 0, ds: 0, dl: 0 },
      all: { dh: 0, ds: 0, dl: 0 },
      parts: { dh: 0, ds: 0, dl: 0 },
    };
    xyzOffset = {};
    sliderValues = {};
    mirrorLock = false;
    rest = {};
    customMeta = {};
    forwardSign = 1;
    selectedId = "";
    pendingPartTree = null;
    dirty = false;
    warpFn = null;
    invalidateEarPickCache();
  }

  /** 耳几何 mask：读预烘焙缓存（与 Alt 点选同一权威 mask） */
  function ensureEarGeometryMask(mesh, regionId) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas || !isEarGeometryRegionId(regionId)) return null;
    if (atlas.masks[regionId]) return atlas.masks[regionId];
    const side = earGeometrySideFromRegionId(regionId);
    const cached = earPickCache[side];
    if (cached?.primary) {
      const isDeform = /deform/i.test(mesh.name || meshKey(mesh) || "");
      const layer = isDeform ? cached.companions?.[0] : cached.primary;
      if (layer?.mask && (layer.mesh === mesh || layer.meshKey === meshKey(mesh))) {
        atlas.masks[regionId] = layer.mask;
        return layer.mask;
      }
    }
    if (!earPickCacheReady) return null;
    return null;
  }

  function prebuildEarGeometryMasksForReplay() {
    if (!earPickCacheReady) return;
  }

  /** Deform 耳肌：结构三角面；Static mask 权威裁剪 */
  function buildDeformEarMask(mesh, side, hits, staticMask = null) {
    const atlas = mesh.userData?.bmAtlas;
    let mask = finalizeStructuralEarMask(mesh, side, staticMask, hits);

    if (!mask || maskPixelCount(mask) < 1800) {
      mask = bakeEarMaskByAnatomy(mesh, side, hits);
    }

    if (staticMask && atlas) {
      mask = clipDeformToStaticMask(mask, staticMask, atlas, 1800);
    }

    if (mask && maskPixelCount(mask) > 18000 && atlas) {
      const ellipsoid = maskEarByEllipsoidOnly(mesh, side);
      if (ellipsoid) {
        const clipped = andMasks(mask, dilateMaskPixels(ellipsoid, atlas.w, atlas.h, 2));
        if (clipped && maskPixelCount(clipped) >= 1800) mask = clipped;
      }
    }

    mask = augmentEarMaskFromHits(mesh, side, mask, hits, staticMask);

    if (staticMask && atlas) {
      mask = clipDeformToStaticMask(mask, staticMask, atlas, 1800);
    }

    return mask;
  }

  /** Static 耳软骨：finalizeStructuralEarMask 为主，解剖 ROI 兜底 */
  function buildStaticEarMask(mesh, side, hits) {
    let mask = finalizeStructuralEarMask(mesh, side, null, hits);
    if (!mask || maskPixelCount(mask) < 2500) {
      const fallback = maskEarByStructure(mesh, side, { tight: false });
      if (fallback && maskPixelCount(fallback) >= 2500) {
        mask = fallback;
      } else {
        mask = bakeEarMaskByAnatomy(mesh, side, hits) || mask || fallback;
      }
      if (mask) {
        mask = augmentEarMaskFromHits(mesh, side, mask, hits, null);
      }
    }
    return mask;
  }

  function buildStaticEarLayer(mesh, side, hits) {
    const mask = buildStaticEarMask(mesh, side, hits);
    if (!mask || maskPixelCount(mask) < 3500) return null;
    return layerPickFromMask(mesh, side, mask, "耳软骨");
  }

  function buildDeformEarLayer(hits, side, staticLayer) {
    const deformMesh = listMeshes().find(
      (m) => (m.name || meshKey(m) || "").toLowerCase().includes("deform") && m.userData?.bmAtlas
    );
    if (!deformMesh) return null;
    const mask = buildDeformEarMask(deformMesh, side, hits, staticLayer?.mask || null);
    if (!mask || maskPixelCount(mask) < 1800) return null;
    return layerPickFromMask(deformMesh, side, mask, "耳肌");
  }

  function buildEarGeometryLayer(mesh, side, hits) {
    return buildStaticEarLayer(mesh, side, hits);
  }

  function inferEarSideFromPoint(p) {
    if (!p) return null;
    const side = detectEarSideFromWorldPoint(p);
    if (side) return side;
    const x = p.x != null ? p.x : p[0];
    if (Math.abs(x) < 0.032) return null;
    return x < 0 ? "L" : "R";
  }

  function inferEarSideFromHit(hits) {
    for (const hit of hits.slice(0, 14)) {
      if (!hit.point) continue;
      const side = detectEarSideFromWorldPoint(hit.point);
      if (side) return side;
    }
    for (const hit of hits.slice(0, 8)) {
      if (!hit.point) continue;
      const { x, y, z } = hit.point;
      if (Math.abs(x) > 0.045) {
        const side = x < 0 ? "L" : "R";
        if (
          worldPointInEar(x, y, z, side) ||
          vertexInEarRegion(x, y, z, side)
        ) {
          return side;
        }
      }
    }
    const tL = targetOf("tragion_L");
    const tR = targetOf("tragion_R");
    if (tL && tR) {
      const ty = (tL[1] + tR[1]) / 2;
      const tz = (tL[2] + tR[2]) / 2;
      for (const hit of hits.slice(0, 14)) {
        if (!hit.point) continue;
        const { x, y, z } = hit.point;
        if (Math.abs(x) < 0.042) continue;
        if (Math.abs(y - ty) > 0.11) continue;
        if (Math.abs(z - tz) > 0.1) continue;
        return x < 0 ? "L" : "R";
      }
    }
    for (const hit of hits.slice(0, 14)) {
      const side = inferEarSideFromPoint(hit.point);
      if (side) return side;
    }
    return null;
  }

  function isEarLikePick(mesh, pick) {
    if (!mesh || !pick) return false;
    const rgb = pick.seedRgb || [];
    if (isStaticEarCartilageSeed(mesh, rgb[0], rgb[1], rgb[2])) return true;
    if (isEarCompositePrimary(mesh, pick)) return true;
    if (isEarNeckSharedGrayKey(pick.partKey) && pick.pixelCount < 22000) return true;
    const label = pick.partLabel || "";
    if (label === "耳软骨" || label === "耳周肌") return true;
    return false;
  }

  function layerPickFromMask(mesh, side, mask, partLabel = "耳") {
    const atlas = mesh.userData.bmAtlas;
    const regionId = side === "L" ? "cq_ear_geom_L" : "cq_ear_geom_R";
    const s = seedUvFromMask(atlas, mask);
    const p = uvToPixel(atlas, s.seedU, s.seedV);
    const o = atlas.orig.data;
    const r = o[p.i];
    const g = o[p.i + 1];
    const b = o[p.i + 2];
    return {
      mesh,
      meshKey: meshKey(mesh),
      mask,
      pixelCount: maskPixelCount(mask),
      regionId,
      seedU: s.seedU,
      seedV: s.seedV,
      seedRgb: [r, g, b],
      previewHex: `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`,
      partMode: "earGeometry",
      partKey: `ear_geom_${side}`,
      partLabel,
    };
  }

  function rebuildEarPickCache() {
    if (!root) return;
    const staticMesh = listMeshes().find(
      (m) => /static/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
    );
    const deformMesh = listMeshes().find(
      (m) => /deform/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
    );
    if (!staticMesh || !deformMesh) return;
    earPickCache = { L: null, R: null };
    earPickCacheReady = false;
    for (const side of ["L", "R"]) {
      buildEarPickForSide(side, staticMesh, deformMesh);
    }
    earPickCacheReady = !!(earPickCache.L || earPickCache.R);
  }

  function ensureEarPickCacheBuilt() {
    return earPickCacheReady && !!(earPickCache.L || earPickCache.R);
  }

  function earPickPatchHits(cached, hits) {
    if (!cached?.primary || !hits?.length) return;
    const layers = [cached.primary, ...(cached.companions || [])];
    for (const layer of layers) {
      const mesh = layer.mesh;
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas || !layer.mask) continue;
      for (const h of hits) {
        if (h.object === mesh && h.uv) {
          ensureHitUvInMask(layer.mask, atlas, h);
        }
      }
    }
  }

  /**
   * 耳部选区：tragion 解剖 ROI 三角面光栅化（Static + Deform），不用全图烘焙/颜色 flood。
   */
  function pickEarLayersFromHit(hits, side) {
    const staticMesh = listMeshes().find(
      (m) => /static/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
    );
    const deformMesh = listMeshes().find(
      (m) => /deform/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
    );
    if (!staticMesh || !deformMesh || !side) return null;

    let staticMask = bakeEarMaskByAnatomy(staticMesh, side, hits);
    const structMask = maskEarByStructure(staticMesh, side, { tight: false });
    if (staticMask && structMask) {
      staticMask = orMasks(staticMask, structMask);
    } else if (!staticMask || maskPixelCount(staticMask) < 2500) {
      staticMask = structMask || staticMask;
    }
    const staticAtlas = staticMesh.userData.bmAtlas;
    if (staticMask && hits?.length) {
      for (const h of hits) {
        if (h.object === staticMesh) ensureHitUvInMask(staticMask, staticAtlas, h);
      }
    }
    for (const h of hits || []) {
      if (h.object !== staticMesh || !h.uv) continue;
      const p = uvToPixel(staticAtlas, h.uv.x, h.uv.y);
      const o = staticAtlas.orig.data;
      const oi = (p.y * staticAtlas.w + p.x) * 4;
      if (!isStaticEarCartilageSeed(staticMesh, o[oi], o[oi + 1], o[oi + 2])) continue;
      const flood = floodStaticEarCartilageMask(staticAtlas, p.x, p.y, staticMesh);
      if (flood) staticMask = staticMask ? orMasks(staticMask, flood) : flood;
    }
    if (!staticMask || maskPixelCount(staticMask) < 3500) return null;

    const dAtlas = deformMesh.userData.bmAtlas;
    let deformMask = bakeEarMaskByAnatomy(deformMesh, side, hits);
    if (deformMask && dAtlas) {
      deformMask = clipDeformToStaticMask(deformMask, staticMask, dAtlas, 1800);
    }
    if (!deformMask || maskPixelCount(deformMask) < 1800) return null;

    const primary = layerPickFromMask(staticMesh, side, staticMask, "耳软骨");
    const companion = layerPickFromMask(deformMesh, side, deformMask, "耳肌");
    if (!primary || !companion) return null;
    return { side, primary, companions: [companion] };
  }

  /** Alt 点耳热路径：读预烘焙缓存，不再每次全量 buildFullEarGeometryPick */
  function resolveEarGeometryPick(hits, preferredSide) {
    const side =
      preferredSide ||
      inferEarSideFromHit(hits) ||
      inferEarSideFromPoint(hits[0]?.point);
    if (!side) return null;
    let cached = earPickCache[side];
    if (cached?.primary) {
      earPickPatchHits(cached, hits);
      return {
        side: cached.side,
        primary: cached.primary,
        companions: cached.companions || [],
      };
    }
    const built = pickEarLayersFromHit(hits, side);
    if (!built?.primary) return null;
    earPickCache[side] = built;
    earPickCacheReady = true;
    earPickPatchHits(built, hits);
    return {
      side: built.side,
      primary: built.primary,
      companions: built.companions || [],
    };
  }

  /** Static 壳挡住 Deform 时，用 3D 邻近 Static 补上 Deform 耳肌层（语义路径专用，不走全网格烘焙） */
  function ensureDeformEarCompanion(hits, side, companions) {
    const hasDeform = (companions || []).some((c) =>
      /deform/i.test(c.meshKey || c.pick?.mesh?.name || "")
    );
    if (hasDeform) return companions || [];
    const deformMesh = listMeshes().find(
      (m) => (m.name || meshKey(m) || "").toLowerCase().includes("deform") && m.userData?.bmAtlas
    );
    if (!deformMesh) return companions || [];
    const staticCompanion = (companions || []).find((c) =>
      /static/i.test(c.meshKey || c.pick?.mesh?.name || "")
    );
    const staticMesh = listMeshes().find(
      (m) => /static/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
    );
    const staticMask = staticCompanion?.pick?.mask || staticCompanion?.mask;
    let mask = null;
    if (staticMesh && staticMask) {
      mask = maskDeformEarByWorldProximity(deformMesh, staticMesh, staticMask, side);
    }
    if (!mask) {
      const deformSeed = findDeformSeedFromHits(deformMesh, hits, side);
      if (deformSeed) {
        mask = maskEarByMeshExpansion(deformMesh, side, deformSeed, { maxDist: 0.072 });
        const dAtlas = deformMesh.userData?.bmAtlas;
        if (mask && staticMask && dAtlas) {
          mask = clipDeformToStaticMask(mask, staticMask, dAtlas, 250);
        }
      }
    }
    if (!mask) return companions || [];
    const pick = layerPickFromMask(deformMesh, side, mask, "耳肌");
    const out = [...(companions || [])];
    out.push({ meshKey: meshKey(deformMesh), pick });
    return out;
  }

  function tryEarGeometryPickForSide(hits, side) {
    if (!hits?.length || !side) return null;
    let staticLayer = null;
    for (const mesh of listMeshes()) {
      if (!isEarGeometryMesh(mesh) || !mesh.userData?.bmAtlas) continue;
      if (!/static/i.test(mesh.name || meshKey(mesh) || "")) continue;
      staticLayer = buildEarGeometryLayer(mesh, side, hits);
      if (staticLayer) break;
    }
    if (!staticLayer) return null;
    const deformLayer = buildDeformEarLayer(hits, side, staticLayer);
    if (!deformLayer) return null;
    return {
      side,
      regionId: staticLayer.regionId,
      primary: staticLayer,
      companions: [deformLayer],
    };
  }

  function tryEarGeometryPick(hits) {
    const side =
      inferEarSideFromHit(hits) || inferEarSideFromPoint(hits[0]?.point);
    return tryEarGeometryPickForSide(hits, side);
  }

  function normalizeEarGeometryPick(earGeom) {
    if (!earGeom?.primary) return null;
    const layers = [earGeom.primary, ...(earGeom.companions || [])];
    const staticL = layers.find((l) =>
      /static/i.test(l.mesh?.name || l.meshKey || "")
    );
    if (!staticL) return null;
    const companions = layers.filter((l) => l !== staticL);
    const deformL = companions.find((l) =>
      /deform/i.test(l.mesh?.name || l.meshKey || "")
    );
    if (!deformL) return null;
    const totalPx =
      staticL.pixelCount +
      companions.reduce((s, c) => s + (c.pixelCount || 0), 0);
    if (staticL.pixelCount < 3500 || deformL.pixelCount < 1800) return null;
    if (staticL.pixelCount > 24000 || deformL.pixelCount > 18000) return null;
    if (totalPx < 9000 || totalPx > 42000) return null;
    return {
      side: earGeom.side,
      primary: staticL,
      companions,
    };
  }

  function buildFullEarGeometryPick(hits, sideIn) {
    const sidesToTry = [];
    if (sideIn) sidesToTry.push(sideIn);
    for (const s of ["L", "R"]) {
      if (!sidesToTry.includes(s)) sidesToTry.push(s);
    }
    const inferred = inferEarSideFromHit(hits);

    function rankPick(pick, side) {
      if (!pick?.primary) return 0;
      const total =
        pick.primary.pixelCount +
        (pick.companions || []).reduce((sum, c) => sum + (c.pixelCount || 0), 0);
      if (inferred && side === inferred) return total + 8000;
      if (sideIn && side === sideIn) return total + 4000;
      return total;
    }

    let best = null;
    let bestRank = 0;

    for (const side of sidesToTry) {
      const norm = normalizeEarGeometryPick(tryEarGeometryPickForSide(hits, side));
      if (norm) {
        const rank = rankPick(norm, side);
        if (rank > bestRank) {
          bestRank = rank;
          best = norm;
        }
      }
    }
    if (best) return best;

    for (const side of sidesToTry) {
      let staticLayer = null;
      for (const mesh of listMeshes()) {
        if (!isEarGeometryMesh(mesh) || !mesh.userData?.bmAtlas) continue;
        if (!/static/i.test(mesh.name || meshKey(mesh) || "")) continue;
        staticLayer = buildEarGeometryLayer(mesh, side, hits);
        if (staticLayer) break;
      }
      const deformLayer = staticLayer ? buildDeformEarLayer(hits, side, staticLayer) : null;
      if (!staticLayer || !deformLayer) continue;
      const totalPx = staticLayer.pixelCount + deformLayer.pixelCount;
      if (
        staticLayer.pixelCount >= 3500 &&
        staticLayer.pixelCount <= 24000 &&
        deformLayer.pixelCount >= 1800 &&
        deformLayer.pixelCount <= 18000 &&
        totalPx >= 9000 &&
        totalPx <= 42000
      ) {
        const rank = rankPick({ primary: staticLayer, companions: [deformLayer] }, side);
        if (rank > bestRank) {
          bestRank = rank;
          best = { side, primary: staticLayer, companions: [deformLayer] };
        }
      }
    }
    if (best) return best;

    for (const side of sidesToTry) {
      const layers = [];
      let staticPick = null;
      for (const mesh of listMeshes()) {
        if (!isEarGeometryMesh(mesh) || !mesh.userData?.bmAtlas) continue;
        if (!/static/i.test(mesh.name || meshKey(mesh) || "")) continue;
        const mask = buildStaticEarMask(mesh, side, hits);
        if (!mask) continue;
        staticPick = layerPickFromMask(mesh, side, mask, "耳软骨");
        layers.push(staticPick);
        break;
      }
      for (const mesh of listMeshes()) {
        if (!isEarGeometryMesh(mesh) || !mesh.userData?.bmAtlas) continue;
        if (!/deform/i.test(mesh.name || meshKey(mesh) || "")) continue;
        const staticL = layers.find((l) =>
          /static/i.test(l.mesh?.name || l.meshKey || "")
        );
        const mask = buildDeformEarMask(mesh, side, hits, staticL?.mask || null);
        if (!mask) continue;
        layers.push(layerPickFromMask(mesh, side, mask, "耳肌"));
        break;
      }
      const staticL = layers.find((l) =>
        /static/i.test(l.mesh?.name || l.meshKey || "")
      );
      const deformL = layers.find((l) =>
        /deform/i.test(l.mesh?.name || l.meshKey || "")
      );
      if (!staticL || !deformL) continue;
      const companions = layers.filter((l) => l !== staticL);
      const totalPx =
        staticL.pixelCount +
        companions.reduce((s, c) => s + (c.pixelCount || 0), 0);
      if (staticL.pixelCount < 3500 || deformL.pixelCount < 1800) continue;
      if (staticL.pixelCount > 24000 || deformL.pixelCount > 18000) continue;
      if (totalPx < 9000 || totalPx > 42000) continue;
      const rank = rankPick({ primary: staticL, companions }, side);
      if (rank > bestRank) {
        bestRank = rank;
        best = { side, primary: staticL, companions };
      }
    }
    return best;
  }

  function trySelectEarGeometry(hits) {
    return resolveEarGeometryPick(hits, null);
  }

  function applyEarGeometrySelection(earGeom) {
    const p = earGeom.primary;
    const mesh = p.mesh;
    const companions = earGeom.companions || [];
    selectedMeshKey = p.meshKey;
    selectedRegionKey = p.regionId;
    let companionPx = 0;
    if (mesh.userData.bmAtlas) {
      mesh.userData.bmAtlas.masks[selectedRegionKey] = p.mask;
    }
    for (const c of companions) {
      const cm = c.mesh;
      if (cm?.userData?.bmAtlas) {
        cm.userData.bmAtlas.masks[c.regionId] = c.mask;
        companionPx += c.pixelCount;
      }
    }
    selectedRegionMeta = {
      seedU: p.seedU,
      seedV: p.seedV,
      previewHex: p.previewHex,
      pixelCount: p.pixelCount + companionPx,
      partKey: p.partKey,
      partLabel: companions.length > 0 ? "整耳" : p.partLabel,
      seedRgb: p.seedRgb,
      partMode: "earGeometry",
      earSide: earGeom.side,
      companions: companions.map((c) => ({
        meshKey: c.meshKey,
        regionId: c.regionId,
        seedU: c.seedU,
        seedV: c.seedV,
        partMode: c.partMode || "earGeometry",
        partKey: c.partKey,
        partLabel: c.partLabel,
        pixelCount: c.pixelCount,
        pick: c,
      })),
    };
    const hslSeed = { dh: 0, ds: 0, dl: 0, mode: "hsl" };
    if (!meshColors[p.meshKey]) meshColors[p.meshKey] = {};
    meshColors[p.meshKey][selectedRegionKey] = {
      ...hslSeed,
      seedU: p.seedU,
      seedV: p.seedV,
      mirror: false,
      partMode: "earGeometry",
      partKey: p.partKey,
      partLabel: "整耳",
    };
    for (const c of selectedRegionMeta.companions) {
      if (!meshColors[c.meshKey]) meshColors[c.meshKey] = {};
      meshColors[c.meshKey][c.regionId] = {
        ...hslSeed,
        seedU: c.seedU,
        seedV: c.seedV,
        mirror: false,
        partMode: c.partMode || "earGeometry",
        partKey: c.partKey,
        partLabel: c.partLabel,
      };
    }
    highlightSelectedMesh();
    flashMask(mesh, p.mask);
    for (const c of companions) {
      if (c.mesh) flashMask(c.mesh, c.mask);
    }
    setPickMuscleModeInternal(false);
    hslScope = "selected";
    syncSelectedScopeHslFromStore();
    console.log(
      `[bone_morph] picked ear geometry ${earGeom.side} ${selectedMeshKey} px=${selectedRegionMeta.pixelCount}`
    );
    onChange();
    return true;
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
    const isEarGeom = isEarGeometryRegionId(selectedRegionKey);
    const isAnatomyPart = isAnatomyPartRegionId(selectedRegionKey);
    const anatomyPartId = isAnatomyPart ? anatomyPartIdFromRegionId(selectedRegionKey) : "";
    if (isAnatomyPart) selectedAnatomyPartId = anatomyPartId;
    const cqMatch = /^cq_(\d+),(\d+),(\d+)(?:_(\d+)_(\d+))?$/.exec(String(selectedRegionKey));
    if ((!entry || entry.seedU == null) && isAnatomyPart && anatomyPartId) {
      const def = findAnatomyPartDef(anatomyPartId);
      if (def) {
        entry = {
          seedU: entry?.seedU ?? 0.5,
          seedV: entry?.seedV ?? 0.5,
          partMode: "anatomyPart",
          anatomyPartId,
          partLabel: def.label,
        };
      }
    } else if ((!entry || entry.seedU == null) && isEarGeom) {
      const mask = atlas.masks[selectedRegionKey];
      const s = seedUvFromMask(atlas, mask);
      if (s?.seedU != null) {
        const p = uvToPixel(atlas, s.seedU, s.seedV);
        const o = atlas.orig.data;
        entry = {
          seedU: s.seedU,
          seedV: s.seedV,
          partMode: "floodSeed",
          partKey: quantKey(o[p.i], o[p.i + 1], o[p.i + 2], partQuantStep()),
        };
      }
    } else if ((!entry || entry.seedU == null) && isPlastymaSheet) {
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
      if (cqMatch[4] != null && cqMatch[5] != null) {
        entry = {
          seedU: +cqMatch[4] / 10000,
          seedV: +cqMatch[5] / 10000,
          partMode: "floodSeed",
          partKey: q0,
        };
      } else {
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
          const hsl = rgbToHsl(r, g, b);
          entry = {
            seedU: (x + 0.5) / atlas.w,
            seedV: flipY ? 1 - (y + 0.5) / atlas.h : (y + 0.5) / atlas.h,
            partMode: hsl.s < 0.35 ? "floodSeed" : "colorClass",
            partKey: q0,
          };
          break;
        }
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
      (isAnatomyPart && anatomyPartId
        ? (() => {
            const def = findAnatomyPartDef(anatomyPartId);
            const layer = def
              ? buildMasksForAnatomyPartDef(def).find((l) => meshKey(mesh) === l.meshKey)
              : null;
            return layer?.mask || null;
          })()
        : isEarGeom
        ? ensureEarGeometryMask(mesh, selectedRegionKey)
        : ensureRegionMask(mesh, selectedRegionKey, {
            ...entry,
            partMode: entry.partMode || "floodSeed",
          }));
    if (mask) atlas.masks[selectedRegionKey] = mask;
    const px = mask ? maskPixelCount(mask) : selectedRegionMeta?.pixelCount || 0;
    const prevCompanions = selectedRegionMeta?.companions;
    const prevLabel = selectedRegionMeta?.partLabel;
    selectedRegionMeta = {
      seedU: entry.seedU,
      seedV: entry.seedV,
      previewHex,
      pixelCount: px,
      partKey,
      partLabel:
        entry.partLabel ||
        (partKey === "plastyma_sheet"
          ? "颈阔肌"
          : partLabelForSemanticPick(partKey, previewHex, px)),
      seedRgb: [r, g, b],
      partMode: entry.partMode || "floodSeed",
    };
    if (prevCompanions?.length) {
      selectedRegionMeta.companions = prevCompanions;
      selectedRegionMeta.partLabel = prevLabel || selectedRegionMeta.partLabel;
      let totalPx = px;
      for (const c of prevCompanions) totalPx += c.pixelCount || 0;
      selectedRegionMeta.pixelCount = totalPx;
    }
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

  function isDeformGaleaLikeSeed(mesh, sr, sg, sb) {
    const meshName = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    if (!meshName.includes("deform")) return false;
    const c = rgbToHsl(sr, sg, sb);
    return c.s >= 0.08 && c.s < 0.35 && sb >= sr + 4 && c.l >= 0.55 && c.l <= 0.82;
  }

  /**
   * 语义部件 mask：整色类（authoring 平涂色），不做 flood 局部连通。
   */
  function maskForSemanticPick(atlas, seedX, seedY, sr, sg, sb, mesh = null, worldPoint = null) {
    if (isPlastymaGraySheet(mesh, sr, sg, sb)) {
      return maskFromColorClass(atlas, sr, sg, sb, mesh);
    }
    return maskFromColorClass(atlas, sr, sg, sb, mesh);
  }

  function makePartRegionId(r, g, b, mesh = null, seedU = null, seedV = null, partMode = "floodSeed") {
    if (isPlastymaGraySheet(mesh, r, g, b)) {
      return "cq_plastyma_sheet";
    }
    const key = quantKey(r, g, b, partQuantStep());
    if (partMode === "floodSeed" && seedU != null && seedV != null && rgbToHsl(r, g, b).s < 0.35) {
      return `cq_${key}_${Math.round(seedU * 10000)}_${Math.round(seedV * 10000)}`;
    }
    return `cq_${key}`;
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
      origGlb: new Uint8ClampedArray(orig.data),
      live,
      tex,
      w,
      h,
      masks: {}, // regionId -> Uint8Array length w*h (1=in region)
    };
    return true;
  }

  /** colourcoded 肌块的纤维细节在 normalMap；与 bmAtlas 同尺寸。 */
  function prepareEditableNormalAtlas(mesh) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat || !mat.normalMap || mesh.userData.bmNormalAtlas) return !!mesh.userData.bmNormalAtlas;
    const map = mat.normalMap;
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
      console.warn("[bone_morph] normal atlas draw failed", mesh.name, e);
      return false;
    }
    const orig = ctx.getImageData(0, 0, w, h);
    const live = ctx.createImageData(w, h);
    live.data.set(orig.data);
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.NoColorSpace;
    tex.flipY = !!map.flipY;
    tex.wrapS = map.wrapS;
    tex.wrapT = map.wrapT;
    tex.magFilter = map.magFilter;
    tex.minFilter = map.minFilter;
    mat.normalMap = tex;
    mat.needsUpdate = true;
    mesh.userData.bmNormalAtlas = { canvas, ctx, orig, live, tex, w, h };
    return true;
  }

  function waitForMaps(rootObj) {
    const pending = [];
    rootObj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of ["map", "normalMap"]) {
          const map = m && m[key];
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
      prepareEditableNormalAtlas(o);
    });
    console.log(`[bone_morph] editable atlases: ${n}`);
    return n;
  }

  /**
   * 整肌选区：
   * - 低/中饱和：明度带 + UV 半径分层（耳局部 / 颈背整块，不吞整张灰图）
   * - 高饱和：色相族连通
   */
  function floodMaskFromSeed(atlas, seedX, seedY, hueTol01 = 26 / 360, mesh = null, worldPoint = null) {
    const { w, h, orig } = atlas;
    const o = orig.data;
    if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return null;
    const si = (seedY * w + seedX) * 4;
    const sr = o[si];
    const sg = o[si + 1];
    const sb = o[si + 2];
    if (isNearBlack(sr, sg, sb)) return null;
    const seed = rgbToHsl(sr, sg, sb);
    const meshName = ((mesh && (mesh.name || meshKey(mesh))) || "").toLowerCase();
    const inEarRegion = worldPoint ? !!detectEarSideFromWorldPoint(worldPoint) : false;
    // 0=灰明度带 1=中饱和耳/灰紫 2=彩色
    let mode = 2;
    if (seed.s < 0.16) mode = 0;
    else if (seed.s < 0.32) mode = 1;
    // 浅灰 / 奶油种子走半径分层（耳可能是浅奶油岛，勿吞整颅）
    const creamLike =
      seed.l >= 0.8 && sr >= 195 && sg >= 185 && sb <= sg - 8;
    const paleSeed = (seed.l >= 0.72 && seed.s <= 0.45) || creamLike;
    // 耳周暗冷灰：与后脖颈/背同色但应局部选，收紧半径与细桥（仅耳区）
    const earNeckGray =
      inEarRegion &&
      seed.s < 0.28 &&
      sb >= sr + 4 &&
      sb >= sg + 2 &&
      seed.l >= 0.32 &&
      seed.l <= 0.58;
    // Deform 耳周浅蓝灰：与帽状腱膜同色但应局部选（仅耳区）
    const deformEarPale =
      inEarRegion &&
      meshName.includes("deform") &&
      seed.s >= 0.08 &&
      seed.s < 0.35 &&
      sb >= sr + 4 &&
      seed.l >= 0.55 &&
      seed.l <= 0.82;
    const localEarGray = earNeckGray || deformEarPale;

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
      const bridgeAfter = localEarGray ? 18 : mode === 0 ? 80 : mode === 1 ? 24 : 8;
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
    if (mode === 0 || mode === 1 || paleSeed || localEarGray) {
      // 半径分层：耳小、后脖颈/背中等，不吞整张灰图
      const radii = localEarGray
        ? [32, 48, 68, 96]
        : paleSeed
          ? [40, 70, 110, 150]
          : mode === 1
            ? [55, 90, 130, 180]
            : [90, 140, 200, 280];
      const cap = localEarGray ? 18000 : paleSeed ? 55000 : mode === 1 ? 70000 : 120000;
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

  function andMasks(a, b) {
    if (!a || !b) return null;
    const out = new Uint8Array(a.length);
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      out[i] = a[i] && b[i] ? 1 : 0;
      if (out[i]) n++;
    }
    return n ? out : null;
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

  /** Build / cache mask：floodSeed=局部连通；colorClass=整色类（颈阔肌等）。 */
  function ensureRegionMask(mesh, regionId, entry) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas) return null;
    if (atlas.masks[regionId]) return atlas.masks[regionId];
    if (isColorIslandRegionId(regionId)) {
      const mask = getIslandMask(mesh, regionId);
      if (mask) {
        atlas.masks[regionId] = mask;
        return mask;
      }
    }
    if (isAnatomyPartRegionId(regionId)) {
      const partId = anatomyPartIdFromRegionId(regionId);
      const def = findAnatomyPartDef(partId);
      if (def) {
        const layers = buildMasksForAnatomyPartDef(def);
        const layer = layers.find((l) => meshKey(mesh) === l.meshKey);
        if (layer?.mask) {
          atlas.masks[regionId] = layer.mask;
          return layer.mask;
        }
      }
    }
    if (isEarGeometryRegionId(regionId)) {
      return ensureEarGeometryMask(mesh, regionId);
    }
    if (!entry || entry.seedU == null) return null;
    const p = uvToPixel(atlas, entry.seedU, entry.seedV);
    const o = atlas.orig.data;
    const sr = o[p.i];
    const sg = o[p.i + 1];
    const sb = o[p.i + 2];
    let mask = null;
    if (String(regionId) === "cq_plastyma_sheet" || entry.partMode === "colorClass") {
      mask = maskFromColorClass(atlas, sr, sg, sb, mesh);
    } else {
      mask = maskForSemanticPick(atlas, p.x, p.y, sr, sg, sb, mesh);
      if (mask && entry.mirror === true) {
        const pm = uvToPixel(atlas, 1 - entry.seedU, entry.seedV);
        const m2 = maskForSemanticPick(atlas, pm.x, pm.y, sr, sg, sb, mesh);
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

  function atlasOrigDiffersFromGlb(atlas) {
    const glb = atlas?.origGlb;
    const cur = atlas?.orig?.data;
    if (!glb || !cur || glb.length !== cur.length) return false;
    for (let i = 0; i < glb.length; i++) {
      if (glb[i] !== cur[i]) return true;
    }
    return false;
  }

  function encodeAtlasOrigPng(atlas) {
    const tmp = document.createElement("canvas");
    tmp.width = atlas.w;
    tmp.height = atlas.h;
    const tctx = tmp.getContext("2d");
    if (!tctx) return "";
    tctx.putImageData(atlas.orig, 0, 0);
    return tmp.toDataURL("image/png");
  }

  function collectBakedAlbedoSnapshot() {
    const out = {};
    for (const mesh of listMeshes()) {
      const atlas = mesh.userData?.bmAtlas;
      if (!atlas?.orig || !atlasOrigDiffersFromGlb(atlas)) continue;
      out[meshKey(mesh)] = encodeAtlasOrigPng(atlas);
    }
    return Object.keys(out).length ? out : undefined;
  }

  function restoreBakedAlbedoFromSnapshot(bakedAlbedo) {
    if (!bakedAlbedo || typeof bakedAlbedo !== "object") return Promise.resolve();
    const tasks = [];
    for (const mesh of listMeshes()) {
      const key = meshKey(mesh);
      const dataUrl = bakedAlbedo[key];
      if (!dataUrl) continue;
      const atlas = mesh.userData?.bmAtlas;
      if (!atlas) continue;
      tasks.push(
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              atlas.ctx.clearRect(0, 0, atlas.w, atlas.h);
              atlas.ctx.drawImage(img, 0, 0, atlas.w, atlas.h);
              atlas.orig = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h);
              atlas.live = null;
              commitLive(atlas);
              resolve();
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = () => reject(new Error(`无法恢复贴图 ${key}`));
          img.src = dataUrl;
        })
      );
    }
    return Promise.all(tasks);
  }

  function bakeAlbedoAtlasesToOrig() {
    for (const mesh of listMeshes()) {
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas?.orig) continue;
      const live = ensureLive(atlas);
      atlas.orig.data.set(live.data);
      commitLive(atlas);
    }
  }

  function clearColorAdjustmentState() {
    meshColors = {};
    scopeHsl = {
      selected: { dh: 0, ds: 0, dl: 0 },
      muscles: { dh: 0, ds: 0, dl: 0 },
      all: { dh: 0, ds: 0, dl: 0 },
      parts: { dh: 0, ds: 0, dl: 0 },
    };
    islandChecked.clear();
    syncCheckedIslandPreviews();
  }

  async function applyCommittedColorAdjustments() {
    if (hslPaintRaf) {
      cancelAnimationFrame(hslPaintRaf);
      hslPaintRaf = 0;
      hslPaintQueued = null;
    }
    replayMeshColorsOnAtlas(null, 1, {
      skipEarPrebuild: true,
      skipTextureSynth: true,
      skipOverlay: true,
    });
    bakeAlbedoAtlasesToOrig();
    clearColorAdjustmentState();
    replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true, skipOverlay: true });
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const historyId = await saveHistoryVersion(`设色应用 ${stamp}`);
    onChange();
    return { ok: true, historyId };
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
    if (atlas) {
      ensureLive(atlas).data.set(atlas.orig.data);
      commitLive(atlas);
    }
    const normalAtlas = mesh.userData.bmNormalAtlas;
    if (normalAtlas) {
      ensureLive(normalAtlas).data.set(normalAtlas.orig.data);
      commitLive(normalAtlas);
    }
  }

  function collectSelectionOverlayTargets() {
    const out = [];
    if (selectedMeshKey && selectedRegionKey) {
      const mesh = listMeshes().find((m) => meshKey(m) === selectedMeshKey);
      if (mesh) out.push({ mesh, regionId: selectedRegionKey });
    }
    for (const c of selectedRegionMeta?.companions || []) {
      const cm = listMeshes().find((m) => meshKey(m) === c.meshKey);
      if (cm && c.regionId) out.push({ mesh: cm, regionId: c.regionId });
    }
    return out;
  }

  /** 在 live atlas 上叠半透明高亮（不重算设色） */
  function paintMaskOverlayOnLive(mesh, mask, rgb = [90, 200, 120], strength = 0.45) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas || !mask) return;
    const d = ensureLive(atlas).data;
    const keep = 1 - strength;
    const [or, og, ob] = rgb;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      d[i] = Math.min(255, Math.floor(d[i] * keep + or * strength));
      d[i + 1] = Math.min(255, Math.floor(d[i + 1] * keep + og * strength));
      d[i + 2] = Math.min(255, Math.floor(d[i + 2] * keep + ob * strength));
    }
    commitLive(atlas);
  }

  function clearIslandFlashTimer() {
    if (!islandFlashTimer) return;
    clearTimeout(islandFlashTimer);
    islandFlashTimer = 0;
  }

  function clearIslandMeshHighlight() {
    for (const mesh of listMeshes()) {
      const hm = mesh.userData?._islandHighlightMesh;
      if (!hm) continue;
      mesh.remove(hm);
      hm.geometry?.dispose?.();
      if (hm.material) {
        const mats = Array.isArray(hm.material) ? hm.material : [hm.material];
        for (const m of mats) m?.dispose?.();
      }
      delete mesh.userData._islandHighlightMesh;
    }
  }

  function buildIslandSubsetGeometry(mesh, triSet, space = "local") {
    if (!mesh || !triSet?.size) return null;
    const geom = mesh.geometry;
    const posAttr = geom?.attributes?.position;
    if (!posAttr) return null;
    const index = geom.index;
    const v = new T.Vector3();
    const verts = [];
    const idx = [];
    let base = 0;
    const useWorld = space === "world";
    if (useWorld) mesh.updateWorldMatrix(true, false);
    const m = useWorld ? mesh.matrixWorld : null;
    for (const t of triSet) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      for (const vi of [ia, ib, ic]) {
        v.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
        if (m) v.applyMatrix4(m);
        verts.push(v.x, v.y, v.z);
      }
      idx.push(base, base + 1, base + 2);
      base += 3;
    }
    const hg = new T.BufferGeometry();
    hg.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
    hg.setIndex(idx);
    hg.computeVertexNormals();
    return hg;
  }

  function fitIslandPreviewCamera(camera, geom, padding = 1.18) {
    geom.computeBoundingBox();
    const box = geom.boundingBox;
    if (!box) return;
    const size = new T.Vector3();
    const center = new T.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const fh = maxDim * padding;
    camera.left = -fh / 2;
    camera.right = fh / 2;
    camera.top = fh / 2;
    camera.bottom = -fh / 2;
    camera.near = -maxDim * 12;
    camera.far = maxDim * 12;
    camera.position.set(center.x, center.y, center.z + maxDim * 2.6);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  function applyIslandMeshHighlight(mesh, triSet, style = ISLAND_FLASH_STYLE) {
    clearIslandMeshHighlight();
    if (!mesh || !triSet?.size) return;
    const hg = buildIslandSubsetGeometry(mesh, triSet);
    if (!hg) return;
    const mat = new T.MeshBasicMaterial({
      color: style.color ?? ISLAND_FLASH_STYLE.color,
      transparent: true,
      opacity: style.opacity ?? ISLAND_FLASH_STYLE.opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const overlay = new T.Mesh(hg, mat);
    overlay.name = "__bm_island_highlight";
    overlay.renderOrder = 12;
    mesh.add(overlay);
    mesh.userData._islandHighlightMesh = overlay;
  }

  function refreshIslandFlashOverlay() {
    if (!islandHighlightToken) {
      clearIslandMeshHighlight();
      return;
    }
    const hit = resolveIslandFromToken(islandHighlightToken);
    if (!hit?.isl?.triangleSet?.size) {
      clearIslandMeshHighlight();
      return;
    }
    applyIslandMeshHighlight(hit.mesh, hit.isl.triangleSet, ISLAND_FLASH_STYLE);
  }

  function setIslandFocusToken(token) {
    const next = token || "";
    if (islandFocusToken === next) return;
    islandFocusToken = next;
    onChange();
  }

  function endIslandFlash() {
    clearIslandFlashTimer();
    islandHighlightToken = "";
    clearIslandMeshHighlight();
    onChange();
  }

  function flashIsland(token, ms = ISLAND_FLASH_MS) {
    if (!token) {
      endIslandFlash();
      return;
    }
    const hit = resolveIslandFromToken(token);
    if (!hit) {
      endIslandFlash();
      return;
    }
    clearIslandFlashTimer();
    islandHighlightToken = token;
    applyIslandMeshHighlight(hit.mesh, hit.isl.triangleSet, ISLAND_FLASH_STYLE);
    islandFlashTimer = setTimeout(() => {
      islandFlashTimer = 0;
      islandHighlightToken = "";
      clearIslandMeshHighlight();
      onChange();
    }, ms);
    console.log(
      `[bone_morph] flash island ${hit.isl.label} tris=${hit.isl.triangleCount} px=${hit.isl.pixelCount}`
    );
    onChange();
  }

  function disposeSharedIslandPreviewRenderer() {
    if (sharedIslandPreviewRenderer) {
      sharedIslandPreviewRenderer.dispose();
      sharedIslandPreviewRenderer = null;
    }
    sharedIslandPreviewCanvas = null;
  }

  function ensureSharedIslandPreviewRenderer() {
    if (sharedIslandPreviewRenderer) return sharedIslandPreviewRenderer;
    sharedIslandPreviewCanvas = document.createElement("canvas");
    sharedIslandPreviewRenderer = new T.WebGLRenderer({
      canvas: sharedIslandPreviewCanvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    sharedIslandPreviewRenderer.setPixelRatio(1);
    sharedIslandPreviewRenderer.setSize(ISLAND_PREVIEW_SIZE, ISLAND_PREVIEW_SIZE, false);
    if ("outputColorSpace" in sharedIslandPreviewRenderer) {
      sharedIslandPreviewRenderer.outputColorSpace = T.SRGBColorSpace;
    }
    if ("toneMapping" in sharedIslandPreviewRenderer) {
      sharedIslandPreviewRenderer.toneMapping = T.LinearToneMapping;
    }
    if ("toneMappingExposure" in sharedIslandPreviewRenderer) {
      sharedIslandPreviewRenderer.toneMappingExposure = 1.35;
    }
    return sharedIslandPreviewRenderer;
  }

  function disposeIslandPreviewSlot(token) {
    const slot = islandPreviewSlots.get(token);
    if (!slot) return;
    slot.geom?.dispose?.();
    if (slot.mat) {
      const mats = Array.isArray(slot.mat) ? slot.mat : [slot.mat];
      for (const m of mats) {
        if (!m) continue;
        m.dispose?.();
      }
    }
    slot.itemEl?.remove?.();
    islandPreviewSlots.delete(token);
  }

  function clearCheckedIslandPreviews() {
    for (const token of [...islandPreviewSlots.keys()]) disposeIslandPreviewSlot(token);
    disposeSharedIslandPreviewRenderer();
    if (islandPreviewDock) {
      islandPreviewDock.innerHTML = "";
      islandPreviewDock.hidden = true;
    }
  }

  function createIslandPreviewSlot(token) {
    const hit = resolveIslandFromToken(token);
    if (!hit?.isl?.triangleSet?.size || !islandPreviewDock) return;
    const geom = buildIslandSubsetGeometry(hit.mesh, hit.isl.triangleSet, "world");
    if (!geom) return;
    geom.computeBoundingBox();
    const center = new T.Vector3();
    geom.boundingBox.getCenter(center);
    geom.translate(-center.x, -center.y, -center.z);
    geom.computeBoundingBox();
    const size = new T.Vector3();
    geom.boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);

    const itemEl = document.createElement("div");
    itemEl.className = "island-preview-item";
    itemEl.dataset.islandToken = token;
    const canvas = document.createElement("canvas");
    canvas.width = ISLAND_PREVIEW_SIZE;
    canvas.height = ISLAND_PREVIEW_SIZE;
    const labelEl = document.createElement("span");
    labelEl.textContent = hit.isl.shortLabel || hit.isl.label || token;
    itemEl.appendChild(canvas);
    itemEl.appendChild(labelEl);
    islandPreviewDock.appendChild(itemEl);

    const scene = new T.Scene();
    scene.background = new T.Color(0xffffff);
    const hemi = new T.HemisphereLight(0xffffff, 0xdddddd, 1.25);
    scene.add(hemi);
    const dir = new T.DirectionalLight(0xffffff, 1.05);
    dir.position.set(1.4, 2.2, 1.6);
    scene.add(dir);
    const fill = new T.DirectionalLight(0xffffff, 0.65);
    fill.position.set(-2.5, 1.2, -1.5);
    scene.add(fill);

    let mat = null;
    const srcMat = hit.mesh.material;
    if (srcMat) {
      const sm = Array.isArray(srcMat) ? srcMat[0] : srcMat;
      if (sm?.clone) {
        mat = sm.clone();
        if (mat.map && sm.map) mat.map = sm.map;
      }
    }
    if (!mat) {
      mat = new T.MeshLambertMaterial({ color: hit.isl.previewHex || 0xcccccc });
    }
    const previewMesh = new T.Mesh(geom, mat);
    scene.add(previewMesh);

    const camera = new T.OrthographicCamera(-1, 1, 1, -1, -100, 100);

    islandPreviewSlots.set(token, {
      scene,
      camera,
      canvas,
      geom,
      mat,
      itemEl,
      labelEl,
      maxDim,
    });
  }

  function updateIslandPreviewCameras() {
    if (!camera || !controls || !islandPreviewSlots.size) return;
    for (const slot of islandPreviewSlots.values()) {
      const cam = slot.camera;
      const maxDim = slot.maxDim || 0.01;
      const fh = maxDim * 1.22;
      cam.left = -fh / 2;
      cam.right = fh / 2;
      cam.top = fh / 2;
      cam.bottom = -fh / 2;
      cam.near = -maxDim * 12;
      cam.far = maxDim * 12;
      _previewCamDir.subVectors(camera.position, controls.target);
      if (_previewCamDir.lengthSq() < 1e-10) _previewCamDir.set(0, 0, 1);
      _previewCamDir.normalize();
      cam.position.copy(_previewCamDir).multiplyScalar(Math.max(maxDim * 2.8, 0.02));
      cam.up.copy(camera.up);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
    }
  }

  function renderCheckedIslandPreviews() {
    if (!islandPreviewSlots.size) return;
    updateIslandPreviewCameras();
    const renderer = ensureSharedIslandPreviewRenderer();
    const src = sharedIslandPreviewCanvas;
    if (!src) return;
    for (const slot of islandPreviewSlots.values()) {
      renderer.render(slot.scene, slot.camera);
      const ctx = slot.canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(src, 0, 0, ISLAND_PREVIEW_SIZE, ISLAND_PREVIEW_SIZE);
    }
  }

  function syncCheckedIslandPreviews() {
    if (!islandPreviewDock) return;
    const want = new Set(islandChecked);
    for (const token of [...islandPreviewSlots.keys()]) {
      if (!want.has(token)) disposeIslandPreviewSlot(token);
    }
    const previewTokens = [...want].slice(0, MAX_ISLAND_PREVIEW_SLOTS);
    for (const token of previewTokens) {
      if (!islandPreviewSlots.has(token)) createIslandPreviewSlot(token);
    }
    if (want.size > MAX_ISLAND_PREVIEW_SLOTS) {
      let note = islandPreviewDock.querySelector(".island-preview-more");
      if (!note) {
        note = document.createElement("div");
        note.className = "island-preview-more";
        islandPreviewDock.appendChild(note);
      }
      note.textContent = `+${want.size - MAX_ISLAND_PREVIEW_SLOTS} 块未预览`;
    } else {
      islandPreviewDock.querySelector(".island-preview-more")?.remove();
    }
    if (!islandPreviewSlots.size) disposeSharedIslandPreviewRenderer();
    islandPreviewDock.hidden = islandChecked.size === 0;
    renderCheckedIslandPreviews();
  }

  function revealIslandTreeToken(token) {
    const parsed = parseIslandToken(token);
    if (!parsed) return;
    if (islandTreeCollapsed.has(parsed.meshKey)) {
      islandTreeCollapsed.delete(parsed.meshKey);
      onChange();
    }
  }

  function setIslandPreviewDock(el) {
    if (islandPreviewDock === el) return;
    clearCheckedIslandPreviews();
    islandPreviewDock = el || null;
    if (islandPreviewDock) syncCheckedIslandPreviews();
  }

  function paintIslandOverlays() {
    const painted = new Set();
    if (!islandHighlightToken) clearIslandMeshHighlight();
    if (showSelectionOverlay) {
      for (const token of islandChecked) {
        if (painted.has(token)) continue;
        const parsed = parseIslandToken(token);
        if (!parsed) continue;
        const mesh = listMeshes().find((m) => meshKey(m) === parsed.meshKey);
        const mask = mesh && getIslandMask(mesh, parsed.regionId);
        if (mesh && mask) {
          paintMaskOverlayOnLive(mesh, mask, [70, 160, 240], 0.36);
          painted.add(token);
        }
      }
      for (const { mesh, regionId } of collectSelectionOverlayTargets()) {
        if (isColorIslandRegionId(regionId)) continue;
        const atlas = mesh.userData?.bmAtlas;
        if (!atlas) continue;
        let mask = atlas.masks?.[regionId];
        if (!mask && isEarGeometryRegionId(regionId)) {
          mask = ensureEarGeometryMask(mesh, regionId);
        } else if (!mask) {
          const entry = normalizeRegionEntry(meshColors[meshKey(mesh)]?.[regionId]);
          if (entry) mask = ensureRegionMask(mesh, regionId, entry);
        }
        if (mask) paintMaskOverlayOnLive(mesh, mask, [90, 200, 120], 0.45);
      }
    }
  }

  /** 在 live atlas 上叠青绿半透明高亮（不重算设色） */
  function paintSelectionOverlayTint() {
    paintIslandOverlays();
  }

  function refreshSelectionOverlay() {
    if (!showSelectionOverlay) return;
    replayMeshColorsOnAtlas(null, 1, { skipOverlay: true });
    paintSelectionOverlayTint();
  }

  function setShowSelectionOverlay(on) {
    showSelectionOverlay = !!on;
    if (showSelectionOverlay) {
      refreshSelectionOverlay();
    } else {
      replayMeshColorsOnAtlas(null, 1, { skipOverlay: true });
    }
    onChange();
  }

  function toggleSelectionOverlay() {
    setShowSelectionOverlay(!showSelectionOverlay);
    return showSelectionOverlay;
  }

  function flashMask(mesh, mask) {
    if (islandHighlightToken || showSelectionOverlay) {
      replayMeshColorsOnAtlas(null, 1, { skipOverlay: false, skipEarPrebuild: true });
    }
  }

  function samplePickAtUv(mesh, u, v, worldPoint = null) {
    const atlas = mesh.userData.bmAtlas;
    if (!atlas) return null;
    const p = uvToPixel(atlas, u, v);
    const o = atlas.orig.data;
    const r = o[p.i];
    const g = o[p.i + 1];
    const b = o[p.i + 2];
    if (isNearBlack(r, g, b)) return null;
    const partMode = "colorClass";
    const mask = maskFromColorClass(atlas, r, g, b, mesh);
    if (!mask) return null;
    const def = resolveAnatomyPartFromPixel(mesh, r, g, b);
    const partKey = def?.colorKeys?.[0] || quantKey(r, g, b, partQuantStep());
    const regionId = def ? `sp_${def.id}` : makePartRegionId(r, g, b, mesh, u, v, partMode);
    const previewHex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    const px = maskPixelCount(mask);
    return {
      seedU: u,
      seedV: v,
      seedX: p.x,
      seedY: p.y,
      seedRgb: [r, g, b],
      regionId,
      partKey,
      partLabel: def?.label || partLabelForSemanticPick(partKey, previewHex, px),
      anatomyPartId: def?.id || "",
      previewHex,
      mask,
      pixelCount: px,
      partMode,
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

  function replayMeshColorsOnAtlas(onlyMesh = null, paintStep = 1, opts = {}) {
    if (!opts.skipEarPrebuild) prebuildEarGeometryMasksForReplay();
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
      const pHsl = scopeHsl.parts || { dh: 0, ds: 0, dl: 0 };
      if ((pHsl.dh || pHsl.ds || pHsl.dl) && islandChecked.size) {
        for (const token of islandChecked) {
          const parsed = parseIslandToken(token);
          if (!parsed || meshKey(mesh) !== parsed.meshKey) continue;
          const mask = getIslandMask(mesh, parsed.regionId);
          if (mask) {
            paintMaskHslOnCurrent(mesh, mask, pHsl.dh, pHsl.ds, pHsl.dl);
          }
        }
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
        if (
          opts.skipEarReplay &&
          (isEarGeometryRegionId(rid) || entry.partMode === "earGeometry")
        ) {
          continue;
        }
        const mask = ensureRegionMask(mesh, rid, entry);
        if (!mask) continue;
        if (entry.mode === "hsl" || (entry.dh != null && entry.hex == null)) {
          paintMaskHslOnCurrent(mesh, mask, entry.dh || 0, entry.ds || 0, entry.dl || 0);
        } else if (entry.hex) {
          paintRegionEntry(mesh, mask, entry);
        }
      }
    }
    for (const mesh of listMeshes()) {
      if (onlyMesh && mesh !== onlyMesh) continue;
      if (!opts.skipTextureSynth) applyIslandTextureSynthToMesh(mesh);
    }
    if (!opts.skipOverlay) {
      paintIslandOverlays();
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
      const companionPx = applyEarCompanionHsl(selectedRegionMeta.companions, entry);
      return { ok: true, pixels: maskPixelCount(mask) + companionPx };
    }
    replayMeshColorsOnAtlas(mesh);
    const mask = mesh.userData.bmAtlas.masks?.[rk];
    const companionPx = applyEarCompanionHsl(selectedRegionMeta.companions, entry);
    const n = (mask ? maskPixelCount(mask) : 0) + companionPx;
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
    clearBrushUndo();
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

  function refreshMeshCacheWorldRest() {
    if (!root || !meshCache.length) return;
    root.updateWorldMatrix(true, true);
    const v = new T.Vector3();
    for (const entry of meshCache) {
      const { mesh, restPos, count } = entry;
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        restPos[i * 3] = v.x;
        restPos[i * 3 + 1] = v.y;
        restPos[i * 3 + 2] = v.z;
      }
    }
    updateMarkerPositions();
  }

  function isPartMovable(o) {
    if (!o || o === markerGroup) return false;
    if (o.name === "bone_morph_markers") return false;
    if (o.userData?.lmId != null) return false;
    if (o.isBone || o.isLight || o.isCamera) return false;
    if (o.isMesh) return !!(o.geometry?.attributes?.position);
    if (o.children?.length) {
      for (const c of o.children) {
        if (c === markerGroup) continue;
        if (isPartMovable(c)) return true;
      }
    }
    return false;
  }

  function partNodeLabel(o, index = 0) {
    if (o.name) return o.name;
    if (o.isMesh) return `Mesh_${index + 1}`;
    if (o.isGroup) return `Group_${index + 1}`;
    return `Node_${index + 1}`;
  }

  function shouldRegisterPartNode(o) {
    if (!o || o === markerGroup || o === root) return false;
    if (o.name === "bone_morph_markers") return false;
    if (o.userData?.lmId != null) return false;
    if (o.isBone || o.isLight || o.isCamera) return false;
    return true;
  }

  function buildPartTreeFlatFallback() {
    const nodes = [];
    let i = 0;
    for (const entry of meshCache) {
      const mesh = entry.mesh;
      if (!mesh || partNodes.has(mesh.uuid)) continue;
      partNodes.set(mesh.uuid, {
        object: mesh,
        restPos: mesh.position.clone(),
      });
      nodes.push({
        id: mesh.uuid,
        name: partNodeLabel(mesh, i),
        type: "Mesh",
        children: [],
      });
      i += 1;
    }
    return nodes;
  }

  function buildPartTree(rootObj) {
    partNodes.clear();
    partTree = [];
    if (!rootObj || !meshCache.length) return partTree;
    rootObj.updateWorldMatrix(true, true);

    const nodeMap = new Map();

    function ensureNode(o) {
      if (!shouldRegisterPartNode(o)) return null;
      if (!nodeMap.has(o.uuid)) {
        const idx = nodeMap.size;
        nodeMap.set(o.uuid, {
          id: o.uuid,
          name: partNodeLabel(o, idx),
          type: o.isMesh ? "Mesh" : o.isGroup ? "Group" : "Node",
          children: [],
          _obj: o,
        });
        partNodes.set(o.uuid, {
          object: o,
          restPos: o.position.clone(),
        });
      }
      return nodeMap.get(o.uuid);
    }

    for (const entry of meshCache) {
      let o = entry.mesh;
      const chain = [];
      while (o && o !== rootObj && o !== markerGroup) {
        if (shouldRegisterPartNode(o)) chain.unshift(o);
        o = o.parent;
      }
      for (const obj of chain) ensureNode(obj);
    }

    for (const [, node] of nodeMap) {
      const p = node._obj.parent;
      if (p && nodeMap.has(p.uuid)) {
        const parentNode = nodeMap.get(p.uuid);
        if (!parentNode.children.some((c) => c.id === node.id)) {
          parentNode.children.push(node);
        }
      }
    }

    const roots = [];
    for (const [, node] of nodeMap) {
      const p = node._obj.parent;
      if (!p || p === rootObj || p === markerGroup || !nodeMap.has(p.uuid)) {
        roots.push(node);
      }
    }

    function finalize(n) {
      delete n._obj;
      n.children.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      n.children.forEach(finalize);
      return n;
    }

    roots.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    partTree = roots.map(finalize);

    if (!partTree.length) {
      partTree = buildPartTreeFlatFallback();
    }
    return partTree;
  }

  function getPartOffset(id) {
    if (!id) return [0, 0, 0];
    const off = partOffsetsById.get(id);
    return off ? [off[0], off[1], off[2]] : [0, 0, 0];
  }

  function getFocusPartOffset() {
    return getPartOffset(partHighlightId);
  }

  function resolvePartEditTarget() {
    if (partHighlightId && partNodes.has(partHighlightId)) return partHighlightId;
    if (partEditTargetId && partNodes.has(partEditTargetId)) return partEditTargetId;
    if (partChecked.size === 1) {
      const [only] = partChecked;
      if (partNodes.has(only)) return only;
    }
    return "";
  }

  function isDescendantOfPartNode(id, ancestorId) {
    if (!id || !ancestorId || id === ancestorId) return false;
    const entry = partNodes.get(id);
    if (!entry) return false;
    let o = entry.object.parent;
    while (o) {
      if (o.uuid === ancestorId) return true;
      o = o.parent;
    }
    return false;
  }

  /** 勾选父 Group 时不再重复移动其子 Mesh，避免叠加位移 */
  function prunePartOffsetTargets(ids) {
    const list = (ids || []).filter((id) => partNodes.has(id));
    if (list.length <= 1) return list;
    return list.filter(
      (id) => !list.some((other) => other !== id && isDescendantOfPartNode(id, other))
    );
  }

  function findPartNodeIdForObject(obj) {
    if (!obj) return "";
    let best = "";
    let o = obj;
    while (o && o !== root && o !== markerGroup) {
      if (partNodes.has(o.uuid)) best = o.uuid;
      o = o.parent;
    }
    return best;
  }

  function collectMeshesUnderPartIds(ids) {
    const meshes = new Set();
    for (const id of prunePartOffsetTargets(ids || [])) {
      const entry = partNodes.get(id);
      if (!entry?.object) continue;
      entry.object.traverse((o) => {
        if (o.isMesh && o.userData?.bmAtlas) meshes.add(o);
      });
    }
    return meshes;
  }

  function pickPartNodeFromMesh(mesh) {
    const partId = findPartNodeIdForObject(mesh);
    if (!partId) return false;
    if (!partChecked.has(partId)) partChecked.add(partId);
    partEditTargetId = partId;
    highlightPartNode(partId);
    setPickMuscleModeInternal(false);
    const entry = partNodes.get(partId);
    console.log(
      `[bone_morph] pick part tree ${entry?.object?.name || partId} checked=${partChecked.size}`
    );
    onChange();
    return true;
  }

  function isColorIslandRegionId(regionId) {
    const id = String(regionId || "");
    return id.startsWith("gi_") || id.startsWith("ci_");
  }

  function islandToken(meshKeyStr, regionId) {
    return `${meshKeyStr}::${regionId}`;
  }

  function parseIslandToken(token) {
    const i = String(token || "").indexOf("::");
    if (i < 1) return null;
    return {
      meshKey: token.slice(0, i),
      regionId: token.slice(i + 2),
    };
  }

  function scanMeshGeometryIslands(mesh) {
    const atlas = mesh?.userData?.bmAtlas;
    const geom = mesh?.geometry;
    const uvAttr = geom?.attributes?.uv;
    if (!atlas?.orig || !geom?.attributes?.position || !uvAttr) return [];
    if (!atlas.masks) atlas.masks = {};

    const adj = buildTriangleAdjacencyWelded(geom);
    const index = geom.index;
    const triCount = adj.length;
    const visited = new Uint8Array(triCount);
    const o = atlas.orig.data;
    const islands = [];
    const minPx = 320;
    const minTri = 8;
    const flipY = atlas.tex ? !!atlas.tex.flipY : false;

    for (let start = 0; start < triCount; start++) {
      if (visited[start]) continue;
      const queue = [start];
      visited[start] = 1;
      const tris = [];
      while (queue.length) {
        const t = queue.pop();
        tris.push(t);
        for (const nb of adj[t]) {
          if (visited[nb]) continue;
          visited[nb] = 1;
          queue.push(nb);
        }
      }
      if (tris.length < minTri) continue;

      const mask = new Uint8Array(atlas.w * atlas.h);
      const triSet = new Set(tris);
      for (const t of tris) {
        const ia = index ? index.getX(t * 3) : t * 3;
        const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        rasterizeUvTriangleGeom(
          mask,
          atlas,
          uvAttr.getX(ia),
          uvAttr.getY(ia),
          uvAttr.getX(ib),
          uvAttr.getY(ib),
          uvAttr.getX(ic),
          uvAttr.getY(ic)
        );
      }
      const px = maskPixelCount(mask);
      if (px < minPx) continue;

      let seedX = -1;
      let seedY = -1;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let p = 0; p < atlas.w * atlas.h; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        if (isNearBlack(o[i], o[i + 1], o[i + 2])) continue;
        seedX = p % atlas.w;
        seedY = (p / atlas.w) | 0;
        sr = o[i];
        sg = o[i + 1];
        sb = o[i + 2];
        break;
      }
      if (seedX < 0) continue;
      const seedU = (seedX + 0.5) / atlas.w;
      const seedV = flipY ? 1 - (seedY + 0.5) / atlas.h : (seedY + 0.5) / atlas.h;
      const previewHex = `#${[sr, sg, sb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
      const regionId = `gi_${islands.length}`;
      const pxLabel = px >= 1000 ? `${(px / 1000).toFixed(1)}k px` : `${px}px`;
      const label = `几何孤岛 ${islands.length + 1} · ${tris.length} 三角面 · ${pxLabel}`;
      islands.push({
        id: islands.length,
        regionId,
        mask,
        pixelCount: px,
        triangleCount: tris.length,
        triangleSet: triSet,
        previewHex,
        label,
        seedU,
        seedV,
        seedRgb: [sr, sg, sb],
        kind: "geometry",
      });
      atlas.masks[regionId] = mask;
    }
    mesh.userData.bmIslands = islands;
    return islands;
  }

  function rebuildMeshColorIslands() {
    islandScanDone = false;
    let total = 0;
    for (const mesh of listMeshes()) {
      mesh.userData.bmIslands = [];
      const n = scanMeshGeometryIslands(mesh).length;
      total += n;
    }
    islandScanDone = true;
    const valid = new Set();
    for (const mesh of listMeshes()) {
      const mk = meshKey(mesh);
      for (const isl of mesh.userData.bmIslands || []) {
        valid.add(islandToken(mk, isl.regionId));
      }
    }
    islandChecked = new Set([...islandChecked].filter((t) => valid.has(t)));
    if (islandHighlightToken && !valid.has(islandHighlightToken)) islandHighlightToken = "";
    if (islandFocusToken && !valid.has(islandFocusToken)) islandFocusToken = "";
    for (const token of [...islandOffsetsByToken.keys()]) {
      if (!valid.has(token)) islandOffsetsByToken.delete(token);
    }
    if (!islandTreeCollapsed.size) {
      for (const mesh of listMeshes()) {
        const mk = meshKey(mesh);
        if ((mesh.userData.bmIslands || []).length) islandTreeCollapsed.add(mk);
      }
    }
    console.log(`[bone_morph] geometry islands scanned: ${total}`);
    syncCheckedIslandPreviews();
    onChange();
    return total;
  }

  function formatIslandPx(px) {
    const n = Number(px) || 0;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  function humanMeshLabel(name, key) {
    const s = `${name || ""} ${key || ""}`.toLowerCase();
    if (s.includes("deform")) return "变形层网格";
    if (s.includes("static")) return "静态层网格";
    if (s.includes("muscle")) return "肌肉层网格";
    if (s.includes("bone") || s.includes("skull")) return "颅骨网格";
    if (s.includes("plasty")) return "颈阔肌网格";
    return name || key || "未命名网格";
  }

  function resolveIslandFromToken(token) {
    const parsed = parseIslandToken(token);
    if (!parsed) return null;
    const mesh = listMeshes().find((m) => meshKey(m) === parsed.meshKey);
    if (!mesh) return null;
    const isl = (mesh.userData.bmIslands || []).find((x) => x.regionId === parsed.regionId);
    if (!isl) return null;
    return { parsed, mesh, isl };
  }

  function highlightIsland(token) {
    setIslandFocusToken(token);
    flashIsland(token);
  }

  function getIslandOffset(token) {
    const off = islandOffsetsByToken.get(token);
    return off ? [off[0], off[1], off[2]] : [0, 0, 0];
  }

  function resolveIslandOffsetTargets() {
    if (islandChecked.size > 0) return [...islandChecked];
    if (islandFocusToken) return [islandFocusToken];
    return [];
  }

  function getUiIslandOffset() {
    const targets = resolveIslandOffsetTargets();
    if (!targets.length) return [0, 0, 0];
    const ref = islandFocusToken && targets.includes(islandFocusToken) ? islandFocusToken : targets[0];
    const refOff = getIslandOffset(ref);
    const allSame = targets.every((token) => {
      const off = getIslandOffset(token);
      return off[0] === refOff[0] && off[1] === refOff[1] && off[2] === refOff[2];
    });
    return allSame ? refOff : getIslandOffset(ref);
  }

  function countAdjustedIslands() {
    let n = 0;
    for (const off of islandOffsetsByToken.values()) {
      if (off[0] || off[1] || off[2]) n += 1;
    }
    return n;
  }

  function setIslandOffset(dx, dy, dz) {
    const targets = resolveIslandOffsetTargets();
    if (!targets.length) return false;
    for (const token of targets) {
      islandOffsetsByToken.set(token, [dx, dy, dz]);
    }
    applyIslandOffsets();
    onChange();
    return true;
  }

  function resetIslandOffsets() {
    islandOffsetsByToken.clear();
    applyIslandOffsets();
    onChange();
  }

  function toggleIslandTreeCollapsed(meshKeyStr) {
    const mk = String(meshKeyStr || "");
    if (!mk) return;
    if (islandTreeCollapsed.has(mk)) islandTreeCollapsed.delete(mk);
    else islandTreeCollapsed.add(mk);
    onChange();
  }

  function setIslandTreeCollapsed(meshKeys, collapsed = true) {
    for (const mk of meshKeys || []) {
      if (!mk) continue;
      if (collapsed) islandTreeCollapsed.add(mk);
      else islandTreeCollapsed.delete(mk);
    }
    onChange();
  }

  function expandAllIslandGroups() {
    islandTreeCollapsed.clear();
    onChange();
  }

  function collapseAllIslandGroups() {
    islandTreeCollapsed.clear();
    for (const mesh of listMeshes()) {
      if ((mesh.userData.bmIslands || []).length) islandTreeCollapsed.add(meshKey(mesh));
    }
    onChange();
  }

  function islandTokensForMesh(meshKeyStr) {
    const mesh = listMeshes().find((m) => meshKey(m) === meshKeyStr);
    if (!mesh) return [];
    return (mesh.userData.bmIslands || []).map((isl) => islandToken(meshKeyStr, isl.regionId));
  }

  function toggleIslandMeshChecked(meshKeyStr) {
    const tokens = islandTokensForMesh(meshKeyStr);
    if (!tokens.length) return;
    const allOn = tokens.every((t) => islandChecked.has(t));
    if (allOn) {
      for (const t of tokens) islandChecked.delete(t);
    } else {
      for (const t of tokens) islandChecked.add(t);
    }
    replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true });
    syncCheckedIslandPreviews();
    onChange();
  }

  function disposeTextureQuiltWorker() {
    if (textureQuiltWorker) {
      textureQuiltWorker.terminate();
      textureQuiltWorker = null;
    }
    textureSynthRunPromise = null;
  }

  function getTextureQuiltWorker() {
    if (textureQuiltWorker) return textureQuiltWorker;
    try {
      textureQuiltWorker = new Worker(TEXTURE_QUILT_WORKER_URL, { type: "module" });
      textureQuiltWorker.onerror = (e) => {
        console.warn("[bone_morph] texture quilt worker error", e);
        islandTextureSynthBusy = false;
        onChange();
      };
    } catch (e) {
      console.warn("[bone_morph] texture quilt worker unavailable", e);
      textureQuiltWorker = null;
    }
    return textureQuiltWorker;
  }

  function hashTokenForSeed(token, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < token.length; i++) {
      h = Math.imul(h ^ token.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 15;
    }
    return h >>> 0;
  }

  function maskIntersect(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    const out = new Uint8Array(a.length);
    let count = 0;
    for (let p = 0; p < a.length; p++) {
      if (a[p] && b[p]) {
        out[p] = 1;
        count++;
      }
    }
    return count ? out : null;
  }

  function erodeMask1(mask, w, h) {
    const out = new Uint8Array(mask.length);
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!mask[p]) continue;
        if (
          x <= 0 ||
          y <= 0 ||
          x >= w - 1 ||
          y >= h - 1 ||
          !mask[p - 1] ||
          !mask[p + 1] ||
          !mask[p - w] ||
          !mask[p + w]
        ) {
          continue;
        }
        out[p] = 1;
        count++;
      }
    }
    return count ? out : mask;
  }

  function tightenMaskBySeedColor(mask, atlas, seedRgb, seedHsl) {
    const o = atlas.orig.data;
    const [sr, sg, sb] = seedRgb || [0, 0, 0];
    const out = new Uint8Array(mask.length);
    let count = 0;
    const maxDist = seedHsl.s >= 0.22 ? 36 : 48;
    const minSat = Math.max(0.12, (seedHsl.s || 0) * 0.5);
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      const dist = Math.abs(o[i] - sr) + Math.abs(o[i + 1] - sg) + Math.abs(o[i + 2] - sb);
      if (dist > maxDist) continue;
      const hsl = rgbToHsl(o[i], o[i + 1], o[i + 2]);
      if (hsl.s < minSat) continue;
      if (seedHsl.s >= 0.22 && hueDist01(hsl.h, seedHsl.h) > 18 / 360) continue;
      out[p] = 1;
      count++;
    }
    return count >= 500 ? out : mask;
  }

  /**
   * 几何孤岛可能 3D 焊接了多种 authoring 色块；纹理变体只应在种子色连通域内 shuffle。
   */
  function refineTextureSynthMask(mesh, regionId) {
    const geomMask = getIslandMask(mesh, regionId);
    if (!geomMask) return null;
    const atlas = mesh?.userData?.bmAtlas;
    const isl = (mesh.userData.bmIslands || []).find((x) => x.regionId === regionId);
    if (!atlas || !isl) return geomMask;
    const flipY = atlas.tex ? !!atlas.tex.flipY : false;
    const seedX = Math.min(
      atlas.w - 1,
      Math.max(0, Math.round(isl.seedU * atlas.w - 0.5))
    );
    const seedY = flipY
      ? Math.min(atlas.h - 1, Math.max(0, Math.round((1 - isl.seedV) * atlas.h - 0.5)))
      : Math.min(atlas.h - 1, Math.max(0, Math.round(isl.seedV * atlas.h - 0.5)));
    const [sr, sg, sb] = isl.seedRgb || [0, 0, 0];
    const seedHsl = rgbToHsl(sr, sg, sb);
    const hueTol = seedHsl.s >= 0.22 ? 18 / 360 : 26 / 360;
    const colorMask = floodMaskFromSeed(atlas, seedX, seedY, hueTol, mesh);
    let refined = colorMask ? maskIntersect(geomMask, colorMask) : null;
    if (!refined || maskPixelCount(refined) < 500) return geomMask;
    refined = tightenMaskBySeedColor(refined, atlas, isl.seedRgb, seedHsl);
    refined = erodeMask1(refined, atlas.w, atlas.h);
    if (maskPixelCount(refined) < 500) return geomMask;
    return refined;
  }

  /** 纹理合成用 mask：平涂肌必须用几何 mask，否则 colour flood 会缩到错误 UV 壳。 */
  function textureSynthMaskForIsland(mesh, regionId) {
    const geomMask = getIslandMask(mesh, regionId);
    if (!geomMask) return refineTextureSynthMask(mesh, regionId);
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas) return geomMask;
    const bbox = maskBBox(geomMask, atlas.w, atlas.h);
    if (!bbox || bbox.w < 8 || bbox.h < 8) return geomMask;
    const maskLocal = buildLocalMask(geomMask, atlas.w, bbox);
    const flatExample = extractExampleCrop(atlas, bbox);
    if (isColourcodedFlatMuscleExample(flatExample, maskLocal, bbox.w, bbox.h)) {
      return geomMask;
    }
    return refineTextureSynthMask(mesh, regionId) || geomMask;
  }

  function maskBBox(mask, atlasW, atlasH, pad = 1) {
    let minX = atlasW;
    let minY = atlasH;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      count++;
      const x = p % atlasW;
      const y = (p / atlasW) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (count === 0 || maxX < 0) return null;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    return {
      x,
      y,
      w: Math.min(atlasW, maxX + pad + 1) - x,
      h: Math.min(atlasH, maxY + pad + 1) - y,
      count,
    };
  }

  function extractExampleCrop(atlas, bbox) {
    const { x, y, w, h } = bbox;
    const out = new Uint8ClampedArray(w * h * 4);
    const src = atlas.orig.data;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const si = ((y + row) * atlas.w + (x + col)) * 4;
        const di = (row * w + col) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      }
    }
    return out;
  }

  function buildLocalMask(mask, atlasW, bbox) {
    const local = new Uint8Array(bbox.w * bbox.h);
    for (let row = 0; row < bbox.h; row++) {
      for (let col = 0; col < bbox.w; col++) {
        const p = (bbox.y + row) * atlasW + (bbox.x + col);
        local[row * bbox.w + col] = mask[p] ? 1 : 0;
      }
    }
    return local;
  }

  function stampSynthPixelsToMapAtlas(atlas, bbox, px, mask) {
    if (!atlas || !px || !bbox || !mask) return false;
    const d = ensureLive(atlas).data;
    const { x, y, w, h } = bbox;
    let touched = false;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const ax = x + col;
        const ay = y + row;
        const p = ay * atlas.w + ax;
        if (!mask[p]) continue;
        const di = p * 4;
        const li = (row * w + col) * 4;
        d[di] = px[li];
        d[di + 1] = px[li + 1];
        d[di + 2] = px[li + 2];
        d[di + 3] = px[li + 3];
        touched = true;
      }
    }
    if (touched) commitLive(atlas);
    return touched;
  }

  function refreshCanvasMapTexture(mesh) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas?.canvas) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat) return;
    const prev = atlas.tex;
    const tex = new T.CanvasTexture(atlas.canvas);
    if (prev) {
      tex.colorSpace = prev.colorSpace || T.SRGBColorSpace;
      tex.flipY = !!prev.flipY;
      tex.wrapS = prev.wrapS ?? T.ClampToEdgeWrapping;
      tex.wrapT = prev.wrapT ?? T.ClampToEdgeWrapping;
      tex.magFilter = prev.magFilter ?? T.LinearFilter;
      tex.minFilter = prev.minFilter ?? T.LinearMipmapLinearFilter;
      prev.dispose?.();
    }
    atlas.tex = tex;
    mat.map = tex;
    mat.needsUpdate = true;
    tex.needsUpdate = true;
  }

  function refreshCanvasNormalTexture(mesh) {
    const normalAtlas = mesh?.userData?.bmNormalAtlas;
    if (!normalAtlas?.canvas) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat) return;
    const prev = normalAtlas.tex;
    const tex = new T.CanvasTexture(normalAtlas.canvas);
    if (prev) {
      tex.colorSpace = prev.colorSpace || T.NoColorSpace;
      tex.flipY = !!prev.flipY;
      tex.wrapS = prev.wrapS ?? T.ClampToEdgeWrapping;
      tex.wrapT = prev.wrapT ?? T.ClampToEdgeWrapping;
      tex.magFilter = prev.magFilter ?? T.LinearFilter;
      tex.minFilter = prev.minFilter ?? T.LinearMipmapLinearFilter;
      prev.dispose?.();
    }
    normalAtlas.tex = tex;
    mat.normalMap = tex;
    mat.needsUpdate = true;
    tex.needsUpdate = true;
  }

  function stampSynthPixelsToAtlas(mesh, bbox, px, mask) {
    return stampSynthPixelsToMapAtlas(mesh?.userData?.bmAtlas, bbox, px, mask);
  }

  function synthMapIslandPixels(atlas, bbox, maskLocal, blockScale, similarity, seed, exampleRgba = null, hardShuffle = false) {
    const example = exampleRgba || extractExampleCrop(atlas, bbox);
    const result = synthIslandJob({
      exampleRgba: example,
      bboxW: bbox.w,
      bboxH: bbox.h,
      maskLocal,
      blockScale,
      similarity,
      seed,
      hardShuffle,
    });
    return result.outRgba;
  }

  function estimateMaskLocalContrast(rgba, maskLocal, w, h) {
    let sum = 0;
    let n = 0;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w - 1; col++) {
        const i = row * w + col;
        if (!maskLocal[i] || !maskLocal[i + 1]) continue;
        const di = i * 4;
        const dj = (i + 1) * 4;
        sum +=
          Math.abs(rgba[di] - rgba[dj]) +
          Math.abs(rgba[di + 1] - rgba[dj + 1]) +
          Math.abs(rgba[di + 2] - rgba[dj + 2]);
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  /** colourcoded 平涂肌：把法线纤维印到颜色贴图，肉眼才能看到条纹变化。 */
  function imprintColourcodedStripesOnAlbedo(outAlbedo, normalRgba, maskLocal, w, h, seedRgb, quiltSeed = 0) {
    const br = seedRgb?.[0] ?? 128;
    const bg = seedRgb?.[1] ?? 128;
    const bb = seedRgb?.[2] ?? 128;
    const phase = ((quiltSeed % 360) / 360) * Math.PI * 2;
    const freqCol = 0.038 + ((quiltSeed >>> 3) % 11) * 0.004;
    const freqRow = 0.024 + ((quiltSeed >>> 7) % 9) * 0.0035;
    for (let i = 0; i < w * h; i++) {
      if (!maskLocal[i]) continue;
      const di = i * 4;
      const col = i % w;
      const row = (i / w) | 0;
      const nx = normalRgba[di] / 255 - 0.5;
      const ny = normalRgba[di + 1] / 255 - 0.5;
      const ridge = Math.sqrt(nx * nx + ny * ny);
      const wave = 0.5 + 0.5 * Math.sin(col * freqCol + row * freqRow + phase);
      const shade = (0.12 + 1.95 * Math.min(1, ridge * 10.5)) * (0.42 + 0.58 * wave);
      outAlbedo[di] = Math.min(255, Math.round(br * shade));
      outAlbedo[di + 1] = Math.min(255, Math.round(bg * shade));
      outAlbedo[di + 2] = Math.min(255, Math.round(bb * shade));
      outAlbedo[di + 3] = 255;
    }
    return outAlbedo;
  }



  /** 平涂肌：褶皱在法线里；按 seed 重排纤维起伏，同色但褶皱走向明显变。 */
  function buildFlatMuscleWrinkleNormal(normalAtlas, bbox, maskLocal, seed, similarity = 0.7, blockScale = 24) {
    const base = extractExampleCrop(normalAtlas, bbox);
    const w = bbox.w;
    const h = bbox.h;
    const out = new Uint8ClampedArray(base);
    const seedU = seed >>> 0;
    const sim = Math.max(0.4, Math.min(1, similarity));
    const blk = Math.max(8, Math.min(48, blockScale));
    const blockSize = Math.max(4, Math.round(blk));
    const chaos = (1.22 - sim) * 5.4 + 0.1;
    const freqAlong = (Math.PI * 2) / Math.max(2, blk * 0.24);
    const freqAcross = (Math.PI * 2) / Math.max(4, blk * 0.52);
    const bumpAmp = 1.35 + chaos * 1.15;

    for (let i = 0; i < w * h; i++) {
      if (!maskLocal[i]) continue;
      const col = i % w;
      const row = (i / w) | 0;
      const di = i * 4;
      let nx = (base[di] / 255) * 2 - 1;
      let ny = (base[di + 1] / 255) * 2 - 1;
      let nz = (base[di + 2] / 255) * 2 - 1;
      const bx = (col / blockSize) | 0;
      const by = (row / blockSize) | 0;
      const bh = (Math.imul(bx + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(by + seedU, 0xc2b2ae35)) >>> 0;
      const baseAngle = ((seedU % 360) / 360) * Math.PI * 2 + (blk / 48) * Math.PI * 2.4;
      const blockAngle = baseAngle + (((bh % 360) / 360) - 0.5) * Math.PI * chaos;
      const fx = Math.cos(blockAngle);
      const fy = Math.sin(blockAngle);
      const along = col * fx + row * fy;
      const across = -col * fy + row * fx;
      const phase1 = (bh % 628) / 100 + blk * 0.07 - sim * 2.1;
      const phase2 = ((bh >>> 8) % 360) / 57;
      const bump =
        bumpAmp * Math.sin(along * freqAlong + phase1) +
        0.42 * Math.sin(along * freqAlong * 2.05 + phase2) +
        0.28 * Math.sin(across * freqAcross + phase1 * 0.6);
      nx += bump * -fy * 1.55;
      ny += bump * fx * 1.55;
      const nlen = Math.hypot(nx, ny, nz) + 1e-5;
      nx /= nlen;
      ny /= nlen;
      nz /= nlen;
      out[di] = Math.min(255, Math.max(0, Math.round((nx * 0.5 + 0.5) * 255)));
      out[di + 1] = Math.min(255, Math.max(0, Math.round((ny * 0.5 + 0.5) * 255)));
      out[di + 2] = Math.min(255, Math.max(0, Math.round((nz * 0.5 + 0.5) * 255)));
      out[di + 3] = 255;
    }
    return out;
  }

  /** 平涂肌：沿平滑纤维场从原法线范例重采样，整体走向一致、丝条相位随滑块变化。 */
  function synthFlatMuscleVariant(atlas, normalAtlas, bbox, maskLocal, seedRgb, seed, similarity = 0.7, blockScale = 24) {
    const normalBase = extractExampleCrop(normalAtlas, bbox);
    const albedoBase = extractExampleCrop(atlas, bbox);
    const w = bbox.w;
    const h = bbox.h;
    const normalPixels = synthOrientedFiberExemplar(
      normalBase,
      normalBase,
      maskLocal,
      w,
      h,
      seed >>> 0,
      similarity,
      blockScale
    );
    const normalOut = renormalizeNormalPixels(normalPixels, maskLocal, w, h);
    return { albedo: new Uint8ClampedArray(albedoBase), normal: normalOut };
  }

  function buildFlatMuscleWrinkleAlbedoFromNormal(atlas, normal, bbox, maskLocal, seedRgb, seed, similarity = 0.7, blockScale = 24) {
    const flat = extractExampleCrop(atlas, bbox);
    const w = bbox.w;
    const h = bbox.h;
    const out = new Uint8ClampedArray(flat);
    const br = seedRgb?.[0] ?? 128;
    const bg = seedRgb?.[1] ?? 128;
    const bb = seedRgb?.[2] ?? 128;
    const seedU = seed >>> 0;
    const sim = Math.max(0.4, Math.min(1, similarity));
    const blk = Math.max(8, Math.min(48, blockScale));
    const blockSize = Math.max(4, Math.round(blk));
    const stripePitch = Math.max(2, blk * 0.38);
    const chaos = (1.15 - sim) * 5.6 + 0.18;

    for (let i = 0; i < w * h; i++) {
      if (!maskLocal[i]) continue;
      const col = i % w;
      const row = (i / w) | 0;
      const di = i * 4;
      const bx = (col / blockSize) | 0;
      const by = (row / blockSize) | 0;
      const bh = (Math.imul(bx + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(by + seedU, 0xc2b2ae35)) >>> 0;
      const blockAngle =
        ((seedU % 48) / 48) * Math.PI * 0.55 +
        (blk / 48) * Math.PI * 2.35 +
        (((bh % 360) / 360) - 0.5) * Math.PI * chaos;
      const fx = Math.cos(blockAngle);
      const fy = Math.sin(blockAngle);
      const along = col * fx + row * fy;
      const phase = blk * 0.24 - sim * 4.6 + (bh % 97) * 0.11;
      const band = Math.floor(along / stripePitch + phase);
      const stripe = ((band % 2) + 2) % 2;
      const lx = col - bx * blockSize;
      const ly = row - by * blockSize;
      const edge = Math.min(lx, ly, blockSize - lx, blockSize - ly) / blockSize;
      const dark = 0.03 + (1 - sim) * 0.14;
      const bright = 1.78 + sim * 0.22;
      let shade = stripe ? bright : dark;
      shade *= 0.62 + ((bh % 17) / 17) * 0.68 * Math.min(2.2, chaos);
      if (edge < 0.14) shade *= 0.18 + sim * 0.12;
      out[di] = Math.min(255, Math.round(br * shade));
      out[di + 1] = Math.min(255, Math.round(bg * shade));
      out[di + 2] = Math.min(255, Math.round(bb * shade));
      out[di + 3] = 255;
    }
    return out;
  }

  /** 平涂肌：用 quilt 后的法线印同色条纹到 albedo，换 seed 肉眼可辨。 */
  function imprintFlatMuscleAlbedoFromSynthNormal(atlas, normalPixels, bbox, maskLocal, seedRgb, seed) {
    const flat = extractExampleCrop(atlas, bbox);
    return imprintColourcodedStripesOnAlbedo(
      new Uint8ClampedArray(flat),
      normalPixels,
      maskLocal,
      bbox.w,
      bbox.h,
      seedRgb,
      seed
    );
  }

  /** 平涂肌：seed 驱动高对比褶皱，换一版必须肉眼可辨。 */
  function buildFlatMuscleWrinkleAlbedo(atlas, normalAtlas, bbox, maskLocal, seedRgb, seed) {
    const flat = extractExampleCrop(atlas, bbox);
    const normal = extractExampleCrop(normalAtlas, bbox);
    const w = bbox.w;
    const h = bbox.h;
    const out = new Uint8ClampedArray(flat);
    const br = seedRgb?.[0] ?? 128;
    const bg = seedRgb?.[1] ?? 128;
    const bb = seedRgb?.[2] ?? 128;
    const seedU = seed >>> 0;
    const rotAngle = ((seedU % 360) / 360) * Math.PI * 2;
    const cosR = Math.cos(rotAngle);
    const sinR = Math.sin(rotAngle);
    const phase1 = ((seedU % 997) / 997) * Math.PI * 2;
    const phase2 = (((seedU >>> 9) % 991) / 991) * Math.PI * 2;
    const phase3 = (((seedU >>> 18) % 983) / 983) * Math.PI * 2;
    const freqAlong = 0.14 + (seedU % 23) * 0.014;
    const freqAcross = 0.05 + ((seedU >>> 4) % 17) * 0.011;
    const blockSize = 8 + (seedU % 13);

    for (let i = 0; i < w * h; i++) {
      if (!maskLocal[i]) continue;
      const col = i % w;
      const row = (i / w) | 0;
      const di = i * 4;
      const nx = normal[di] / 255 - 0.5;
      const ny = normal[di + 1] / 255 - 0.5;
      const len = Math.hypot(nx, ny) + 1e-5;
      let fx = nx / len;
      let fy = ny / len;
      const rfx = fx * cosR - fy * sinR;
      const rfy = fx * sinR + fy * cosR;
      fx = rfx;
      fy = rfy;
      const along = col * fx + row * fy;
      const across = -col * fy + row * fx;
      const bx = (col / blockSize) | 0;
      const by = (row / blockSize) | 0;
      const blockJitter = 0.22 * Math.sin(bx * 5.1 + by * 3.7 + seedU * 0.0023);

      const w1 = 0.5 + 0.5 * Math.sin(along * freqAlong + phase1 + blockJitter);
      const w2 = 0.5 + 0.5 * Math.sin(along * freqAlong * 2.17 + phase2);
      const w3 = 0.5 + 0.5 * Math.sin(across * freqAcross + phase3);
      const ridge = Math.min(1, len * 11 + 0.25);
      const fold = (w1 * 0.52 + w2 * 0.33 + w3 * 0.22) * ridge;
      const shade = 0.08 + 2.25 * fold;

      out[di] = Math.min(255, Math.round(br * shade));
      out[di + 1] = Math.min(255, Math.round(bg * shade));
      out[di + 2] = Math.min(255, Math.round(bb * shade));
      out[di + 3] = 255;
    }
    return out;
  }

  function synthFlatMuscleAlbedo(atlas, normalAtlas, bbox, maskLocal, seedRgb, seed, blockScale, similarity) {
    const wrinkle = buildFlatMuscleWrinkleAlbedo(atlas, normalAtlas, bbox, maskLocal, seedRgb, seed);
    const quiltBlock = Math.max(16, Math.min(blockScale, 26));
    const quiltSim = Math.min(0.28, similarity);
    return synthMapIslandPixels(atlas, bbox, maskLocal, quiltBlock, quiltSim, seed, wrinkle, true);
  }

  function isColourcodedFlatMuscleExample(exampleRgba, maskLocal, w, h) {
    return estimateMaskLocalContrast(exampleRgba, maskLocal, w, h) < 6;
  }

  /** 平涂肌：先用法线原图印出高对比条纹，再 quilt；禁止事后再盖掉重排结果。 */
  function buildColourcodedStripeExample(atlas, normalAtlas, bbox, maskLocal, seedRgb, quiltSeed = 0) {
    const exampleRgba = extractExampleCrop(atlas, bbox);
    if (!normalAtlas || !isColourcodedFlatMuscleExample(exampleRgba, maskLocal, bbox.w, bbox.h)) {
      return exampleRgba;
    }
    return imprintColourcodedStripesOnAlbedo(
      new Uint8ClampedArray(exampleRgba),
      extractExampleCrop(normalAtlas, bbox),
      maskLocal,
      bbox.w,
      bbox.h,
      seedRgb,
      quiltSeed
    );
  }

  function nudgeFlatMusclePixelsBySeed(pixels, maskLocal, w, h, seed) {
    const out = new Uint8ClampedArray(pixels);
    const src = pixels;
    const spanX = Math.max(20, (w / 3) | 0);
    const spanY = Math.max(20, (h / 3) | 0);
    const shiftX = ((Math.imul(seed, 1103515245) >>> 0) % spanX) - (spanX >> 1);
    const shiftY = ((Math.imul(seed + 0x517cc1, 1103515245) >>> 0) % spanY) - (spanY >> 1);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (!maskLocal[i]) continue;
        let sr = row;
        let sc = col;
        for (let step = 0; step < w + h; step++) {
          sr = (sr + shiftY + h * 8) % h;
          sc = (sc + shiftX + w * 8) % w;
          const si = sr * w + sc;
          if (!maskLocal[si]) continue;
          const di = i * 4;
          const sj = si * 4;
          out[di] = src[sj];
          out[di + 1] = src[sj + 1];
          out[di + 2] = src[sj + 2];
          out[di + 3] = src[sj + 3];
          break;
        }
      }
    }
    return out;
  }

  function stampNeutralNormalInMask(normalAtlas, bbox, mask) {
    if (!normalAtlas || !bbox || !mask) return false;
    const d = ensureLive(normalAtlas).data;
    const { x, y, w, h } = bbox;
    let touched = false;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const ax = x + col;
        const ay = y + row;
        const p = ay * normalAtlas.w + ax;
        if (!mask[p]) continue;
        const di = p * 4;
        d[di] = 128;
        d[di + 1] = 128;
        d[di + 2] = 255;
        d[di + 3] = 255;
        touched = true;
      }
    }
    if (touched) commitLive(normalAtlas);
    return touched;
  }

  function finalizeIslandSynthEntry(
    mesh,
    isl,
    mask,
    bbox,
    maskLocal,
    params,
    token,
    albedoPixels,
    normalPixels,
    flatMuscle = false
  ) {
    islandTextureSynth.set(
      token,
      buildIslandSynthCacheEntry(mesh, isl, mask, bbox, params, token, albedoPixels, normalPixels, flatMuscle)
    );
  }

  function buildIslandSynthCacheEntry(mesh, isl, mask, bbox, params, token, albedoPixels, normalPixels, flatMuscle = false) {
    return {
      seed: params.seed ?? islandTextureSynthParams.seed,
      similarity: params.similarity ?? islandTextureSynthParams.similarity,
      blockScale: params.blockScale ?? islandTextureSynthParams.blockScale,
      bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
      pixels: albedoPixels,
      normalPixels,
      flatMuscle: !!flatMuscle,
      synthMask: mask,
      meshKey: meshKey(mesh),
      regionId: isl.regionId,
    };
  }

  function applyIslandTextureSynthToMesh(mesh) {
    const atlas = mesh?.userData?.bmAtlas;
    const normalAtlas = mesh?.userData?.bmNormalAtlas;
    if ((!atlas && !normalAtlas) || !islandTextureSynth.size) return;
    const mk = meshKey(mesh);
    let touched = false;
    for (const [token, entry] of islandTextureSynth) {
      const parsed = parseIslandToken(token);
      if (!parsed || parsed.meshKey !== mk || !entry?.bbox) continue;
      if (!entry?.pixels?.length && !entry?.normalPixels?.length) continue;
      const mask =
        entry.synthMask ||
        textureSynthMaskForIsland(mesh, parsed.regionId) ||
        getIslandMask(mesh, parsed.regionId);
      if (!mask) continue;
      if (entry.pixels?.length && stampSynthPixelsToAtlas(mesh, entry.bbox, entry.pixels, mask)) {
        touched = true;
      }
      if (
        entry.normalPixels?.length &&
        normalAtlas &&
        stampSynthPixelsToMapAtlas(normalAtlas, entry.bbox, entry.normalPixels, mask)
      ) {
        touched = true;
      }
    }
    if (touched) {
      refreshCanvasMapTexture(mesh);
      refreshCanvasNormalTexture(mesh);
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat?.normalScale) {
        mat.normalScale.set(2.2, 2.2);
        mat.needsUpdate = true;
      }
    }
  }

  function applyIslandTextureSynthReplay() {
    for (const mesh of listMeshes()) {
      applyIslandTextureSynthToMesh(mesh);
    }
  }

  function synthOneIslandTokenSync(token, params) {
    const resolved = resolveIslandFromToken(token);
    if (!resolved) throw new Error("孤岛无效");
    const { mesh, isl } = resolved;
    const atlas = mesh.userData?.bmAtlas;
    const mask = textureSynthMaskForIsland(mesh, isl.regionId);
    if (!atlas || !mask) throw new Error("无贴图或 mask");
    const bbox = maskBBox(mask, atlas.w, atlas.h);
    if (!bbox || bbox.w < 32 || bbox.h < 32 || bbox.count < 500) {
      throw new Error("孤岛太小，无法合成");
    }
    const maskLocal = buildLocalMask(mask, atlas.w, bbox);
    const seed = hashTokenForSeed(token, params.seed ?? islandTextureSynthParams.seed);
    const similarity = params.similarity ?? islandTextureSynthParams.similarity;
    const blockScale = params.blockScale ?? islandTextureSynthParams.blockScale;
    if (!mesh.userData.bmNormalAtlas) prepareEditableNormalAtlas(mesh);
    const normalAtlas = mesh.userData.bmNormalAtlas;
    const flatExample = extractExampleCrop(atlas, bbox);
    const flatMuscle = isColourcodedFlatMuscleExample(flatExample, maskLocal, bbox.w, bbox.h);
    let albedoPixels = null;
    let normalPixels = null;
    if (flatMuscle) {
      const flatVariant = synthFlatMuscleVariant(atlas, normalAtlas, bbox, maskLocal, isl.seedRgb, seed, similarity, blockScale);
      albedoPixels = flatVariant.albedo;
      normalPixels = flatVariant.normal;
    } else {
      const stripeExample = buildColourcodedStripeExample(atlas, normalAtlas, bbox, maskLocal, isl.seedRgb, seed);
      albedoPixels = synthMapIslandPixels(
        atlas,
        bbox,
        maskLocal,
        blockScale,
        similarity,
        seed,
        stripeExample,
        false
      );
      if (normalAtlas && normalAtlas.w === atlas.w && normalAtlas.h === atlas.h) {
        normalPixels = synthMapIslandPixels(
          normalAtlas,
          bbox,
          maskLocal,
          blockScale,
          similarity,
          (seed + 0x517cc1) >>> 0
        );
      }
    }
    finalizeIslandSynthEntry(
      mesh,
      isl,
      mask,
      bbox,
      maskLocal,
      params,
      token,
      albedoPixels,
      normalPixels,
      flatMuscle
    );
    return token;
  }

  function synthOneIslandToken(token, params) {
    const resolved = resolveIslandFromToken(token);
    if (!resolved) return Promise.reject(new Error("孤岛无效"));
    const { mesh, isl } = resolved;
    const atlas = mesh.userData?.bmAtlas;
    const mask = textureSynthMaskForIsland(mesh, isl.regionId);
    if (!atlas || !mask) return Promise.reject(new Error("无贴图或 mask"));
    const bbox = maskBBox(mask, atlas.w, atlas.h);
    if (!bbox || bbox.w < 32 || bbox.h < 32 || bbox.count < 500) {
      return Promise.reject(new Error("孤岛太小，无法合成"));
    }
    const maskLocal = buildLocalMask(mask, atlas.w, bbox);
    if (!mesh.userData.bmNormalAtlas) prepareEditableNormalAtlas(mesh);
    const normalAtlasPrep = mesh.userData.bmNormalAtlas;
    const flatExample = extractExampleCrop(atlas, bbox);
    const flatMuscle = isColourcodedFlatMuscleExample(flatExample, maskLocal, bbox.w, bbox.h);
    if (flatMuscle) {
      try {
        return Promise.resolve(synthOneIslandTokenSync(token, params));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    const seed = hashTokenForSeed(token, params.seed ?? islandTextureSynthParams.seed);
    const exampleRgba = buildColourcodedStripeExample(
      atlas,
      normalAtlasPrep,
      bbox,
      maskLocal,
      isl.seedRgb,
      seed
    );
    let similarity = params.similarity ?? islandTextureSynthParams.similarity;
    let blockScale = params.blockScale ?? islandTextureSynthParams.blockScale;
    const worker = getTextureQuiltWorker();
    if (!worker) {
      try {
        return Promise.resolve(synthOneIslandTokenSync(token, params));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    const jobId = ++textureSynthJobId;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishSync = (reason) => {
        if (settled) return;
        settled = true;
        worker.removeEventListener("message", onDone);
        clearTimeout(timer);
        try {
          resolve(synthOneIslandTokenSync(token, params));
        } catch (e) {
          reject(new Error(reason ? `${reason}: ${e.message}` : e.message));
        }
      };
      const onDone = (ev) => {
        if (!ev.data || ev.data.id !== jobId) return;
        if (settled) return;
        settled = true;
        worker.removeEventListener("message", onDone);
        clearTimeout(timer);
        if (!ev.data.ok) {
          finishSync(ev.data.error || "Worker 合成失败");
          return;
        }
        let albedoPixels = new Uint8ClampedArray(ev.data.outRgba);
        if (!mesh.userData.bmNormalAtlas) prepareEditableNormalAtlas(mesh);
        const normalAtlas = mesh.userData.bmNormalAtlas;
        const flatExample = extractExampleCrop(atlas, bbox);
        const flatMuscle = isColourcodedFlatMuscleExample(flatExample, maskLocal, bbox.w, bbox.h);
        if (flatMuscle) {
          albedoPixels = nudgeFlatMusclePixelsBySeed(albedoPixels, maskLocal, bbox.w, bbox.h, seed);
        }
        let normalPixels = null;
        if (!flatMuscle && normalAtlas && normalAtlas.w === atlas.w && normalAtlas.h === atlas.h) {
          normalPixels = synthMapIslandPixels(
            normalAtlas,
            bbox,
            maskLocal,
            blockScale,
            similarity,
            (seed + 0x517cc1) >>> 0
          );
        }
        finalizeIslandSynthEntry(
          mesh,
          isl,
          mask,
          bbox,
          maskLocal,
          params,
          token,
          albedoPixels,
          normalPixels,
          flatMuscle
        );
        resolve(token);
      };
      const timer = setTimeout(() => finishSync("Worker 超时"), 120000);
      worker.addEventListener("message", onDone);
      try {
        const exampleCopy = exampleRgba.slice();
        const maskCopy = maskLocal.slice();
        worker.postMessage(
          {
            type: "synth",
            id: jobId,
            token,
            job: {
              exampleRgba: exampleCopy,
              bboxW: bbox.w,
              bboxH: bbox.h,
              maskLocal: maskCopy,
              blockScale,
              similarity,
              seed,
              hardShuffle: flatMuscle,
            },
          },
          [exampleCopy.buffer, maskCopy.buffer]
        );
      } catch (e) {
        finishSync(e?.message || "Worker 投递失败");
      }
    });
  }

  async function runIslandTextureSynth(tokens, params = {}) {
    const list = (tokens || [...islandChecked]).filter(Boolean);
    if (!list.length) return { ok: true, done: [], skipped: [], errors: [] };
    islandTextureSynthBusy = true;
    onChange();
    const merged = { ...islandTextureSynthParams, ...params };
    islandTextureSynthParams = {
      seed: merged.seed ?? islandTextureSynthParams.seed,
      similarity: merged.similarity ?? islandTextureSynthParams.similarity,
      blockScale: merged.blockScale ?? islandTextureSynthParams.blockScale,
    };
    const results = { ok: true, done: [], skipped: [], errors: [] };
    islandTextureSynthLastError = "";
    for (const token of list) {
      try {
        await synthOneIslandToken(token, islandTextureSynthParams);
        results.done.push(token);
      } catch (e) {
        console.warn("[bone_morph] texture synth", token, e);
        const msg = e?.message || String(e);
        results.errors.push({ token, error: msg });
        islandTextureSynthLastError = msg;
      }
    }
    results.ok = results.errors.length === 0;
    islandTextureSynthBusy = false;
    replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true, skipOverlay: true });
    renderCheckedIslandPreviews();
    onChange();
    return results;
  }

  function scheduleIslandTextureSynth(opts = {}) {
    if (opts.seed != null || opts.similarity != null || opts.blockScale != null) {
      islandTextureSynthParams = {
        seed: opts.seed ?? islandTextureSynthParams.seed,
        similarity: opts.similarity ?? islandTextureSynthParams.similarity,
        blockScale: opts.blockScale ?? islandTextureSynthParams.blockScale,
      };
    }
    if (textureSynthDebounceTimer) clearTimeout(textureSynthDebounceTimer);
    let resolveScheduled;
    const scheduled = new Promise((resolve) => {
      resolveScheduled = resolve;
    });
    textureSynthDebounceTimer = setTimeout(() => {
      textureSynthDebounceTimer = 0;
      textureSynthRunPromise = runIslandTextureSynth(opts.tokens, islandTextureSynthParams)
        .catch((e) => {
          console.warn("[bone_morph] texture synth run failed", e);
          return { ok: false, errors: [{ error: e?.message || String(e) }] };
        })
        .finally(() => {
          textureSynthRunPromise = null;
          resolveScheduled();
        });
    }, opts.immediate ? 0 : TEXTURE_SYNTH_DEBOUNCE_MS);
    return scheduled;
  }

  async function flushIslandTextureSynth() {
    if (textureSynthDebounceTimer) {
      clearTimeout(textureSynthDebounceTimer);
      textureSynthDebounceTimer = 0;
      textureSynthRunPromise = runIslandTextureSynth();
    }
    if (textureSynthRunPromise) {
      await textureSynthRunPromise;
      textureSynthRunPromise = null;
    }
    while (islandTextureSynthBusy) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  function clearIslandTextureSynth(tokens) {
    const list = tokens || [...islandChecked];
    for (const token of list) {
      islandTextureSynth.delete(token);
    }
    replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true });
    onChange();
  }

  function randomizeIslandTextureSeed() {
    islandTextureSynthParams.seed = (Math.random() * 0xffffffff) >>> 0;
    return scheduleIslandTextureSynth({ immediate: true });
  }

  function setIslandTextureSynthParams(params = {}) {
    if (params.seed != null) islandTextureSynthParams.seed = params.seed >>> 0;
    if (params.similarity != null) {
      islandTextureSynthParams.similarity = Math.max(0.4, Math.min(1, params.similarity));
    }
    if (params.blockScale != null) {
      islandTextureSynthParams.blockScale = Math.max(8, Math.min(48, params.blockScale));
    }
    onChange();
  }

  function countIslandTextureSynth() {
    let n = 0;
    for (const token of islandChecked) {
      const entry = islandTextureSynth.get(token);
      if (entry?.pixels?.length || entry?.normalPixels?.length) n++;
    }
    return n;
  }

  function islandTextureSynthSnapshotPayload() {
    return Object.fromEntries(
      [...islandTextureSynth].map(([token, entry]) => [
        token,
        {
          seed: entry.seed,
          similarity: entry.similarity,
          blockScale: entry.blockScale,
          bbox: entry.bbox,
          meshKey: entry.meshKey,
          regionId: entry.regionId,
          flatMuscle: !!entry.flatMuscle,
        },
      ])
    );
  }

  function importIslandTextureSynthSnapshot(data, { regenerate = false } = {}) {
    if (data?.islandTextureSynthParams && typeof data.islandTextureSynthParams === "object") {
      islandTextureSynthParams = {
        seed: data.islandTextureSynthParams.seed ?? 12345,
        similarity: data.islandTextureSynthParams.similarity ?? 0.7,
        blockScale: data.islandTextureSynthParams.blockScale ?? 24,
      };
    }
    islandTextureSynth.clear();
    if (data?.islandTextureSynth && typeof data.islandTextureSynth === "object") {
      for (const [token, entry] of Object.entries(data.islandTextureSynth)) {
        if (!token || !entry) continue;
        islandTextureSynth.set(token, {
          seed: entry.seed,
          similarity: entry.similarity,
          blockScale: entry.blockScale,
          bbox: entry.bbox,
          meshKey: entry.meshKey,
          regionId: entry.regionId,
          flatMuscle: !!entry.flatMuscle,
          pixels: null,
          normalPixels: null,
        });
      }
    }
    if (regenerate && islandTextureSynth.size) {
      scheduleIslandTextureSynth({ immediate: true });
    }
  }

  function setMarkersVisible(visible) {
    markersUiVisible = !!visible;
    if (markerGroup) markerGroup.visible = markersUiVisible;
    syncBrushPreviewVisible();
  }

  function getIslandMask(mesh, regionId) {
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas) return null;
    if (atlas.masks?.[regionId]) return atlas.masks[regionId];
    const isl = (mesh.userData.bmIslands || []).find((x) => x.regionId === regionId);
    if (isl?.mask) {
      atlas.masks[regionId] = isl.mask;
      return isl.mask;
    }
    return null;
  }

  function getColorIslandGroups() {
    const groups = [];
    for (const mesh of listMeshes()) {
      const islands = mesh.userData?.bmIslands;
      if (!islands?.length) continue;
      const mk = meshKey(mesh);
      const meshLabel = humanMeshLabel(mesh.name, mk);
      groups.push({
        meshKey: mk,
        meshLabel,
        meshRawName: mesh.name || mk,
        collapsed: islandTreeCollapsed.has(mk),
        islands: islands
          .map((isl) => ({
            token: islandToken(mk, isl.regionId),
            regionId: isl.regionId,
            label: isl.label,
            shortLabel: `孤岛 ${isl.id + 1}`,
            subLabel: `${(isl.triangleCount || 0).toLocaleString()} 三角 · ${formatIslandPx(isl.pixelCount)} 像素`,
            previewHex: isl.previewHex,
            pixelCount: isl.pixelCount,
            triangleCount: isl.triangleCount || 0,
          }))
          .sort((a, b) => b.pixelCount - a.pixelCount),
      });
    }
    groups.sort((a, b) => a.meshLabel.localeCompare(b.meshLabel, "zh-CN"));
    return groups;
  }

  function setIslandChecked(tokens) {
    islandChecked = new Set((tokens || []).filter(Boolean));
    replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true });
    syncCheckedIslandPreviews();
    onChange();
  }

  function toggleIslandChecked(token) {
    if (!token) return;
    if (islandChecked.has(token)) islandChecked.delete(token);
    else islandChecked.add(token);
    replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true });
    syncCheckedIslandPreviews();
    onChange();
  }

  function pickIslandFromRay() {
    const meshes = listMeshes();
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return false;
    const hit = hits[0];
    const mesh = hit.object;
    const atlas = mesh.userData?.bmAtlas;
    if (!atlas) return pickPartNodeFromMesh(mesh);
    if (!mesh.userData.bmIslands?.length && islandScanDone) {
      scanMeshGeometryIslands(mesh);
    }
    let isl = null;
    if (typeof hit.faceIndex === "number" && hit.faceIndex >= 0) {
      isl = (mesh.userData.bmIslands || []).find((x) => x.triangleSet?.has(hit.faceIndex));
    }
    if (!isl && hit.uv) {
      const p = uvToPixel(atlas, hit.uv.x, hit.uv.y);
      if (p.x >= 0 && p.y >= 0 && p.x < atlas.w && p.y < atlas.h) {
        const idx = p.y * atlas.w + p.x;
        isl = (mesh.userData.bmIslands || []).find((x) => x.mask?.[idx]);
      }
    }
    if (!isl) return false;
    const token = islandToken(meshKey(mesh), isl.regionId);
    revealIslandTreeToken(token);
    setIslandFocusToken(token);
    flashIsland(token);
    setPickMuscleModeInternal(false);
    if (atlas.masks) atlas.masks[isl.regionId] = isl.mask;
    console.log(`[bone_morph] pick island ${isl.label} on ${mesh.name || meshKey(mesh)}`);
    onChange();
    return true;
  }

  function resolvePartOffsetTargets() {
    if (partChecked.size > 0) {
      return prunePartOffsetTargets([...partChecked]);
    }
    const id = resolvePartEditTarget();
    return id ? [id] : [];
  }

  function getUiPartOffset() {
    const targets = resolvePartOffsetTargets();
    if (!targets.length) return [0, 0, 0];
    if (targets.length === 1) return getPartOffset(targets[0]);
    const refId =
      partEditTargetId && targets.includes(partEditTargetId) ? partEditTargetId : targets[0];
    const ref = getPartOffset(refId);
    const allSame = targets.every((id) => {
      const off = getPartOffset(id);
      return off[0] === ref[0] && off[1] === ref[1] && off[2] === ref[2];
    });
    return allSame ? ref : getPartOffset(refId);
  }

  function countAdjustedParts() {
    let n = 0;
    for (const off of partOffsetsById.values()) {
      if (off[0] || off[1] || off[2]) n += 1;
    }
    return n;
  }

  function rebuildPartTree() {
    if (!root) return partTree;
    const savedChecked = [...partChecked];
    const savedOffsets = new Map(partOffsetsById);
    const savedHighlight = partHighlightId;
    const savedEditTarget = partEditTargetId;
    buildPartTree(root);
    partOffsetsById = new Map([...savedOffsets].filter(([id]) => partNodes.has(id)));
    initPartRest();
    partChecked = new Set(savedChecked.filter((id) => partNodes.has(id)));
    partEditTargetId = savedEditTarget && partNodes.has(savedEditTarget) ? savedEditTarget : "";
    if (savedHighlight && partNodes.has(savedHighlight)) highlightPartNode(savedHighlight);
    else highlightPartNode("");
    applyPartTransforms();
    return partTree;
  }

  function initPartRest() {
    const v = new T.Vector3();
    for (const [id, entry] of partNodes) {
      const off = partOffsetsById.get(id) || [0, 0, 0];
      v.set(off[0], off[1], off[2]);
      entry.restPos = entry.object.position.clone().sub(v);
      entry.object.userData._partRestPos = entry.restPos.clone();
    }
  }

  function isMeshUnderPart(mesh, partId) {
    if (!partId || !mesh) return false;
    let o = mesh;
    while (o) {
      if (o.uuid === partId) return true;
      o = o.parent;
    }
    return false;
  }

  function clearPartHighlight() {
    for (const mesh of listMeshes()) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat.userData?._partHighlight) {
          if (mat.emissive && mat.userData._partHighlightOrigEmissive != null) {
            mat.emissive.setHex(mat.userData._partHighlightOrigEmissive);
            delete mat.userData._partHighlightOrigEmissive;
          }
          if ("emissiveIntensity" in mat && mat.userData._partHighlightOrigIntensity != null) {
            mat.emissiveIntensity = mat.userData._partHighlightOrigIntensity;
            delete mat.userData._partHighlightOrigIntensity;
          }
          if (mat.color && mat.userData._partHighlightOrigColor != null) {
            mat.color.setHex(mat.userData._partHighlightOrigColor);
            delete mat.userData._partHighlightOrigColor;
          }
          mat.needsUpdate = true;
          delete mat.userData._partHighlight;
        }
      }
    }
  }

  function highlightPartNode(id) {
    partHighlightId = id || "";
    if (partHighlightId) partEditTargetId = partHighlightId;
    clearPartHighlight();
    if (!partHighlightId) {
      onChange();
      return;
    }
    for (const mesh of listMeshes()) {
      if (!isMeshUnderPart(mesh, partHighlightId)) continue;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat.emissive) {
          mat.userData._partHighlightOrigEmissive = mat.emissive.getHex();
          mat.emissive.setHex(0x33ff88);
          if ("emissiveIntensity" in mat) {
            mat.userData._partHighlightOrigIntensity = mat.emissiveIntensity;
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 0.9);
          }
        } else if (mat.color) {
          mat.userData._partHighlightOrigColor = mat.color.getHex();
          mat.color.setHex(0x66ff99);
        }
        mat.userData._partHighlight = true;
        mat.needsUpdate = true;
      }
    }
    onChange();
  }

  function applyPartTransforms() {
    const v = new T.Vector3();
    for (const [id, entry] of partNodes) {
      const off = partOffsetsById.get(id) || [0, 0, 0];
      v.set(off[0], off[1], off[2]);
      entry.object.position.copy(entry.restPos).add(v);
    }
    refreshMeshCacheWorldRest();
    dirty = true;
    scheduleApply();
    onChange();
  }

  function setPartChecked(ids) {
    partChecked = new Set((ids || []).filter((id) => partNodes.has(id)));
    onChange();
  }

  function togglePartChecked(id) {
    if (!partNodes.has(id)) return;
    if (partChecked.has(id)) partChecked.delete(id);
    else partChecked.add(id);
    onChange();
  }

  function setPartOffset(dx, dy, dz) {
    const targets = resolvePartOffsetTargets();
    if (!targets.length) return false;
    for (const id of targets) {
      partOffsetsById.set(id, [dx, dy, dz]);
      if (!partChecked.has(id)) partChecked.add(id);
    }
    if (targets.length === 1) partEditTargetId = targets[0];
    else if (partEditTargetId && targets.includes(partEditTargetId)) {
      // keep current edit target for slider display
    } else {
      partEditTargetId = targets[0];
    }
    applyPartTransforms();
    return true;
  }

  function resetPartOffsets() {
    partOffsetsById.clear();
    partChecked.clear();
    partEditTargetId = "";
    highlightPartNode("");
    for (const [, entry] of partNodes) {
      entry.object.position.copy(entry.restPos);
    }
    refreshMeshCacheWorldRest();
    dirty = true;
    scheduleApply();
    onChange();
  }

  function applyPendingPartTree() {
    if (!pendingPartTree) return;
    const data = pendingPartTree;
    pendingPartTree = null;
    partChecked = new Set((data.checked || []).filter((id) => partNodes.has(id)));
    partOffsetsById.clear();
    if (data.offsets && typeof data.offsets === "object") {
      for (const [id, off] of Object.entries(data.offsets)) {
        if (!partNodes.has(id) || !Array.isArray(off) || off.length < 3) continue;
        partOffsetsById.set(id, [off[0], off[1], off[2]]);
      }
    } else if (Array.isArray(data.offset) && data.offset.length >= 3) {
      for (const id of partChecked) {
        partOffsetsById.set(id, [data.offset[0], data.offset[1], data.offset[2]]);
      }
    }
    if (data.editTargetId && partNodes.has(data.editTargetId)) {
      partEditTargetId = data.editTargetId;
    } else if (partChecked.size === 1) {
      partEditTargetId = [...partChecked][0];
    }
    applyPartTransforms();
  }

  function partTreeSessionPayload() {
    const offsets = {};
    for (const [id, off] of partOffsetsById) {
      offsets[id] = [off[0], off[1], off[2]];
    }
    return {
      checked: [...partChecked],
      offsets,
      editTargetId: partEditTargetId || "",
      offset: getUiPartOffset(),
    };
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
    const [f, s, saved, parts, anatomy] = await Promise.all([
      fetch(`landmarks/farkas_core.json${bust}`).then((r) => r.json()),
      fetch(`landmarks/semantic_sliders.json${bust}`).then((r) => r.json()),
      fetch(`${pathRest()}${bust}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`landmarks/semantic_parts.json${bust}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`landmarks/anatomy_catalog.json${bust}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    farkas = f;
    sliderDefs = s;
    if (parts && typeof parts === "object") {
      semanticParts = {
        quantStep: Number(parts.quantStep) || 8,
        parts: parts.parts && typeof parts.parts === "object" ? parts.parts : {},
      };
    }
    if (anatomy && typeof anatomy === "object") {
      anatomyCatalog = {
        quantStep: Number(anatomy.quantStep) || semanticParts.quantStep || 8,
        tree: Array.isArray(anatomy.tree) ? anatomy.tree : [],
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

  function initSliderDefaults() {
    for (const sl of sliderDefs.sliders || []) {
      if (sliderValues[sl.id] == null) sliderValues[sl.id] = sl.default ?? 0;
    }
  }

  /** 刷新/重进不恢复调整参数；仅「保存历史」可还原设色/拧形/纹理变体等。 */
  async function loadSession() {
    return;
  }

  async function saveJson(relPath, data) {
    const res = await fetch("/api/save-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, data }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function deleteJson(relPath) {
    const res = await fetch("/api/delete-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath }),
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
    clearBrushUndo();
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
    if (
      selectedRegionMeta?.companions &&
      key === selectedMeshKey &&
      rk === selectedRegionKey
    ) {
      for (const c of selectedRegionMeta.companions) {
        if (meshColors[c.meshKey]) {
          delete meshColors[c.meshKey][c.regionId];
          if (!Object.keys(meshColors[c.meshKey]).length) delete meshColors[c.meshKey];
        }
      }
    }
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
  function isEarCompositePrimary(mesh, pick) {
    if (!mesh || !pick) return false;
    const rgb = pick.seedRgb || [];
    if (isStaticEarCartilageSeed(mesh, rgb[0], rgb[1], rgb[2])) return true;
    const n = (mesh.name || meshKey(mesh) || "").toLowerCase();
    return (
      n.includes("deform") &&
      isEarNeckSharedGrayKey(pick.partKey) &&
      pick.pixelCount < 14000
    );
  }

  function isDeformEarCompanionPick(mesh, pick) {
    const mn = (mesh.name || meshKey(mesh) || "").toLowerCase();
    if (!mn.includes("deform") || !pick) return false;
    if (pick.pixelCount >= 28000) return false;
    if (isEarNeckSharedGrayKey(pick.partKey) && pick.pixelCount < 14000) return true;
    const rgb = pick.seedRgb || [];
    const c = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return c.s >= 0.04 && c.s < 0.35 && rgb[2] >= rgb[0] + 4 && pick.pixelCount < 22000;
  }

  function collectEarCompanionPicks(hits, primaryMesh, primaryPick) {
    const companions = [];
    if (!isEarCompositePrimary(primaryMesh, primaryPick)) return companions;
    const primaryKey = meshKey(primaryMesh);
    const primaryStatic = isStaticEarCartilageSeed(
      primaryMesh,
      primaryPick.seedRgb[0],
      primaryPick.seedRgb[1],
      primaryPick.seedRgb[2]
    );
    let nearDist = Infinity;
    for (const hit of hits) {
      if (hit.uv && hit.distance < nearDist) nearDist = hit.distance;
    }
    const depthMax = nearDist + 0.085;
    for (const hit of hits) {
      if (!hit.uv) continue;
      if (hit.distance > depthMax) continue;
      const m = hit.object;
      if (meshKey(m) === primaryKey) continue;
      const pick = samplePickAtUv(m, hit.uv.x, hit.uv.y, hit.point);
      if (!pick || pick.pixelCount < 80) continue;
      const n = (m.name || meshKey(m) || "").toLowerCase();
      if (primaryStatic && isDeformEarCompanionPick(m, pick)) {
        companions.push({ meshKey: meshKey(m), pick });
      } else if (!primaryStatic && n.includes("static")) {
        const rgb = pick.seedRgb || [];
        if (isStaticEarCartilageSeed(m, rgb[0], rgb[1], rgb[2])) {
          companions.push({ meshKey: meshKey(m), pick });
        }
      }
    }
    const byKey = new Map();
    for (const c of companions) {
      const prev = byKey.get(c.meshKey);
      if (!prev || c.pick.pixelCount > prev.pick.pixelCount) byKey.set(c.meshKey, c);
    }
    return [...byKey.values()];
  }

  function applyEarCompanionHsl(companions, entry) {
    let pixels = 0;
    for (const c of companions || []) {
      const ck = c.meshKey;
      const rid = c.regionId || c.pick?.regionId;
      const pick = c.pick || c;
      if (!ck || !rid) continue;
      if (!meshColors[ck]) meshColors[ck] = {};
      meshColors[ck][rid] = {
        mode: "hsl",
        dh: entry.dh,
        ds: entry.ds,
        dl: entry.dl,
        seedU: pick.seedU,
        seedV: pick.seedV,
        mirror: false,
        partMode: pick.partMode || "floodSeed",
        partKey: pick.partKey,
        partLabel: pick.partLabel,
      };
      const cm = listMeshes().find((m) => meshKey(m) === ck);
      if (!cm?.userData?.bmAtlas) continue;
      const mask =
        pick.mask ||
        cm.userData.bmAtlas.masks[rid] ||
        ensureRegionMask(cm, rid, meshColors[ck][rid]);
      if (mask) cm.userData.bmAtlas.masks[rid] = mask;
      replayMeshColorsOnAtlas(cm);
      pixels += mask ? maskPixelCount(mask) : 0;
    }
    return pixels;
  }

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
      const pick = samplePickAtUv(hit.object, hit.uv.x, hit.uv.y, hit.point);
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

  function attemptEarGeometryPick(hits, preferredSide) {
    return resolveEarGeometryPick(hits, preferredSide);
  }

  function clickInEarRegion(hits) {
    const side = inferEarSideFromHit(hits);
    if (side) {
      const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
      for (const hit of hits.slice(0, 14)) {
        if (!hit.point) continue;
        const { x, y, z } = hit.point;
        if (worldPointInEar(x, y, z, side) || vertexInEarRegion(x, y, z, side)) return true;
        if (
          t &&
          ((side === "L" && x < -0.02) || (side === "R" && x > 0.02)) &&
          Math.abs(y - t[1]) < 0.14 &&
          Math.abs(z - t[2]) < 0.12
        ) {
          return true;
        }
      }
    }
    for (const hit of hits.slice(0, 14)) {
      if (!hit.point) continue;
      const { x, y, z } = hit.point;
      for (const s of ["L", "R"]) {
        if (worldPointInEar(x, y, z, s) || vertexInEarRegion(x, y, z, s)) return true;
      }
    }
    return false;
  }

  /** 射线命中 Static 耳软骨色 → 必须几何整耳 */
  function hitsTouchStaticEarCartilage(hits) {
    for (const hit of hits.slice(0, 14)) {
      if (!hit.uv || !hit.object) continue;
      const mesh = hit.object;
      if (!/static/i.test(mesh.name || meshKey(mesh) || "")) continue;
      const atlas = mesh.userData?.bmAtlas;
      if (!atlas?.orig) continue;
      const p = uvToPixel(atlas, hit.uv.x, hit.uv.y);
      if (p.x < 0 || p.y < 0 || p.x >= atlas.w || p.y >= atlas.h) continue;
      const oi = (p.y * atlas.w + p.x) * 4;
      const o = atlas.orig.data;
      if (isStaticEarCartilageSeed(mesh, o[oi], o[oi + 1], o[oi + 2])) return true;
    }
    return false;
  }

  /** 耳区点击（含四分之三视角、Static 软骨色）→ 强制结构双层选耳 */
  function shouldForceEarPick(hits) {
    if (hitsTouchStaticEarCartilage(hits)) return true;
    if (clickInEarRegion(hits)) return true;
    for (const hit of hits.slice(0, 12)) {
      if (!hit.point || !hit.object) continue;
      const mesh = hit.object;
      const n = (mesh.name || meshKey(mesh) || "").toLowerCase();
      if (!/static|deform/i.test(n)) continue;
      const side = inferEarSideFromPoint(hit.point);
      if (!side) continue;
      const t = targetOf(side === "L" ? "tragion_L" : "tragion_R");
      if (!t) continue;
      const { x, y, z } = hit.point;
      if (
        Math.abs(x - t[0]) < 0.09 &&
        Math.abs(y - t[1]) < 0.1 &&
        Math.abs(z - t[2]) < 0.09
      ) {
        return true;
      }
      if (/static/i.test(n) && hit.uv) {
        const atlas = mesh.userData?.bmAtlas;
        if (atlas?.orig) {
          const p = uvToPixel(atlas, hit.uv.x, hit.uv.y);
          if (p.x >= 0 && p.y >= 0 && p.x < atlas.w && p.y < atlas.h) {
            const oi = (p.y * atlas.w + p.x) * 4;
            const o = atlas.orig.data;
            if (isStaticEarCartilageSeed(mesh, o[oi], o[oi + 1], o[oi + 2])) return true;
          }
        }
      }
    }
    return false;
  }

  function selectMeshByRay() {
    const meshes = listMeshes();
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return false;
    return pickIslandFromRay();
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

    // 笔刷：点模型堆/减料；空白处不拦截 → 旋转
    if (brushMode && ev.button === 0) {
      const hit = hitMeshUnderPointer();
      if (hit) {
        brushing = true;
        brushLastStamp = hit.point.clone();
        beginBrushStrokeBaseline();
        if (controls) {
          controlsSavedEnabled = controls.enabled;
          controls.enabled = false;
        }
        applyBrushStamp(hit.point, brushNormalFromHit(hit), hit.object);
        updateBrushPreview(hit.point, brushNormalFromHit(hit));
        onChange();
        ev.preventDefault();
      }
      return;
    }

    if (hitsM.length && ev.button === 0) {
      const id = hitsM[0].object.userData.lmId;
      setSelected(id);
      // 加点模式：点球只选中，不拖
      if (addMode) {
        ev.preventDefault();
        return;
      }
      // 拧形 / 移锚点：点球即拖（editRest=移锚点 rest，否则拧形 xyz）
      const cur = targetOf(id) || rest[id];
      if (!cur) {
        ev.preventDefault();
        return;
      }
      dragging = {
        id,
        mode: editRest ? "rest" : "xyz",
        startWorld: new T.Vector3(cur[0], cur[1], cur[2]),
        lockedAxis: null,
        thresh: markerRadius() * 0.15,
      };
      if (controls) {
        controlsSavedEnabled = controls.enabled;
        controls.enabled = false;
      }
      ev.preventDefault();
      return;
    }
    if (addMode && ev.button === 0) {
      const meshes = listMeshes();
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        const p = hits[0].point;
        addPointAt([p.x, p.y, p.z]);
        // 粘性加点：保持 addMode，可连续点击
        onChange();
        // 点在模型上才拦截；空白处不 preventDefault，保证能旋转
        ev.preventDefault();
      }
      return;
    }
    // 空白处 / 非锚点：不拦截，交给 OrbitControls 旋转
    // 点视口空白取消孤岛树高亮
    if (ev.button === 0 && !ev.altKey && islandFocusToken) {
      const meshes = listMeshes();
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) setIslandFocusToken("");
    }
    if (ev.button === 0 && !ev.altKey && partHighlightId) {
      const meshes = listMeshes();
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) highlightPartNode("");
    }
  }

  function onPointerMove(ev) {
    if (!camera || !domEl) return;
    projectPointer(ev);
    raycaster.setFromCamera(pointer, camera);

    if (brushMode) {
      const hit = hitMeshUnderPointer();
      if (hit) {
        const n = brushNormalFromHit(hit);
        updateBrushPreview(hit.point, n);
        if (brushing) {
          // 步距略大，避免一划叠很多笔把薄壳撕开
          const minStep = Math.max(brushRadius * 0.08, 1e-6);
          if (!brushLastStamp || brushLastStamp.distanceTo(hit.point) >= minStep) {
            applyBrushStamp(hit.point, n, hit.object);
            brushLastStamp = hit.point.clone();
            onChange();
          }
        }
      } else if (brushPreview) {
        brushPreview.visible = false;
      }
      return;
    }

    if (!dragging) return;
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
    onChange();
  }

  function onPointerUp() {
    const wasDragging = !!dragging;
    const wasBrushing = brushing;
    dragging = null;
    brushing = false;
    brushLastStamp = null;
    if (wasBrushing) commitBrushStrokeUndo();
    if (controls) {
      if (pickMuscleMode) {
        controls.enabled = false;
      } else {
        controls.enabled = true;
        controlsSavedEnabled = true;
      }
    }
    if (wasDragging || wasBrushing) onChange();
  }

  function bindInput() {
    if (!domEl) return;
    domEl.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
  }

  function unbindInput() {
    if (domEl) domEl.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
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
      islandChecked: [...islandChecked],
      islandTextureSynthParams: { ...islandTextureSynthParams },
      islandTextureSynth: islandTextureSynthSnapshotPayload(),
      bakedAlbedo: collectBakedAlbedoSnapshot(),
      partTree: partTreeSessionPayload(),
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
    if (data.hslScope === "selected" || data.hslScope === "muscles" || data.hslScope === "all" || data.hslScope === "parts") {
      hslScope = data.hslScope;
    }
    if (Array.isArray(data.islandChecked)) {
      islandChecked = new Set(data.islandChecked.filter(Boolean));
    } else {
      islandChecked.clear();
    }
    if (data.scopeHsl && typeof data.scopeHsl === "object") {
      scopeHsl = {
        selected: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.selected || {}) },
        muscles: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.muscles || {}) },
        all: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.all || {}) },
        parts: { dh: 0, ds: 0, dl: 0, ...(data.scopeHsl.parts || {}) },
      };
    }
    // restore colors
    meshColors = normalizeMeshColors(data.meshColors || {});
    replayMeshColorsOnAtlas();
    importIslandTextureSynthSnapshot(data, { regenerate: true });
    restoreLocalRest();
    if (data.partTree && typeof data.partTree === "object") {
      pendingPartTree = data.partTree;
      if (partNodes.size) applyPendingPartTree();
    }
    ensureMarkers();
    highlightSelectedMesh();
    dirty = true;
    applyWarpNow();
    onChange();
  }

  async function loadHistoryIndex() {
    try {
      const r = await fetch(`${pathHistoryIndex()}?_=${Date.now()}`);
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
    const rel = pathHistoryVersion(id);
    await saveJson(rel, data);
    historyIndex.versions.unshift({
      id,
      label: data.label,
      createdAt: data.createdAt,
      path: rel,
      pointCount: Object.keys(data.points || {}).length,
      sliderSummary: summarizeSliders(data.sliderValues),
    });
    await saveJson(pathHistoryIndex(), historyIndex);
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
    const path = meta?.path || pathHistoryVersion(id);
    const r = await fetch(`${path}?_=${Date.now()}`);
    if (!r.ok) throw new Error("版本不存在");
    const data = await r.json();
    if (data.bakedAlbedo) await restoreBakedAlbedoFromSnapshot(data.bakedAlbedo);
    applySnapshot(data);
  }

  async function deleteHistoryVersion(id) {
    const meta = historyIndex.versions.find((v) => v.id === id);
    const rel = meta?.path || pathHistoryVersion(id);
    historyIndex.versions = historyIndex.versions.filter((v) => v.id !== id);
    await saveJson(pathHistoryIndex(), historyIndex);
    try {
      await deleteJson(rel);
    } catch (e) {
      console.warn("[bone_morph] delete history json failed", rel, e);
    }
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
    projectId,
    islandPreviewDockEl,
  }) {
    const previewDockRef = islandPreviewDockEl || islandPreviewDock;
    await dispose({ keepPreviewDock: true });
    resetProjectSessionState();
    if (projectId) setProjectStorage(projectId);
    root = rootObj;
    scene = sc;
    camera = cam;
    domEl = domElement;
    controls = ctrl;
    onChange = cb || (() => {});
    if (previewDockRef) setIslandPreviewDock(previewDockRef);
    await loadDefs();
    await loadSession();
    initSliderDefaults();
    await loadHistoryIndex();
    uniquifyMaterials(root);
    cacheMeshes(root);
    brushRadius = markerRadius() * 8;
    loadBrushPrefs();
    captureOrigColors();
    await prepareAllAtlases(root);
    meshColors = normalizeMeshColors(meshColors);
    replayMeshColorsOnAtlas(null, 1, {
      skipEarPrebuild: true,
      skipEarReplay: true,
    });
    syncSelectedScopeHslFromStore();
    // 通用布点：空 rest 不再自动播种头部 Farkas 锚点
    markerGroup = new T.Group();
    markerGroup.name = "bone_morph_markers";
    scene.add(markerGroup);
    ensureMarkers();
    if (!selectedId) {
      const ids = allPointIds().filter((id) => rest[id]);
      selectedId = ids[0] || "";
    }
    bindInput();
    buildPartTree(root);
    if (selectedMeshKey && selectedRegionKey) syncSelectedRegionMetaFromStore();
    initPartRest();
    applyPendingPartTree();
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        rebuildMeshColorIslands();
        applyWarpNow();
        syncCheckedIslandPreviews();
        onChange();
        resolve();
      });
    });
  }

  async function dispose(opts = {}) {
    unbindInput();
    clearIslandFlashTimer();
    clearIslandMeshHighlight();
    if (!opts.keepPreviewDock) {
      clearCheckedIslandPreviews();
      islandPreviewDock = null;
    }
    clearPartHighlight();
    if (hslPaintRaf) {
      cancelAnimationFrame(hslPaintRaf);
      hslPaintRaf = 0;
    }
    hslPaintQueued = null;
    if (rafApply) {
      cancelAnimationFrame(rafApply);
      rafApply = 0;
    }
    if (markerGroup && scene) {
      scene.remove(markerGroup);
      markerGroup = null;
    }
    disposeBrushPreview();
    brushMode = false;
    brushing = false;
    brushLastStamp = null;
    clearBrushUndo();
    invalidateEarPickCache();
    markers = {};
    meshCache = [];
    partNodes.clear();
    partTree = [];
    partChecked.clear();
    partOffsetsById.clear();
    partEditTargetId = "";
    partHighlightId = "";
    pendingPartTree = null;
    root = null;
    warpFn = null;
    disposeTextureQuiltWorker();
    resetProjectSessionState();
  }

  async function saveRest() {
    const points = {};
    for (const [id, p] of Object.entries(rest)) points[id] = [p[0], p[1], p[2]];
    await saveJson(pathRest(), {
      version: 1,
      source: "euro_ref",
      forwardSign,
      points,
      customMeta,
      note: "Rest landmarks on euro Static (Farkas + custom). Edit in morph mode.",
    });
  }

  async function prepareAtlasForExport(onProgress) {
    const report = (pct, msg) => {
      try {
        onProgress?.(pct, msg);
      } catch (_) {}
    };
    report(5, "等待纹理合成完成…");
    await flushIslandTextureSynth();
    report(45, "重放设色与纹理变体…");
    replayMeshColorsOnAtlas(null, 1, { skipEarPrebuild: true });
    report(75, "更新贴图缓存…");
    for (const mesh of listMeshes()) {
      const atlas = mesh.userData?.bmAtlas;
      if (atlas?.tex) atlas.tex.needsUpdate = true;
      const normalAtlas = mesh.userData?.bmNormalAtlas;
      if (normalAtlas?.tex) normalAtlas.tex.needsUpdate = true;
    }
    report(100, "贴图准备完成");
  }

  /** 导出 GLB 前剥离 userData（含贴图/mask 缓存），避免 GLTFExporter JSON.stringify 卡死或爆内存。 */
  function beginGltfExportSanitize(exportRoot) {
    // 保证导出几何 = 刷烘焙 + 锚点拧形后的当前所见
    applyWarpNow();
    clearIslandMeshHighlight();
    const stash = [];
    if (!exportRoot) return stash;
    exportRoot.traverse((o) => {
      const ud = o.userData;
      if (!ud || !Object.keys(ud).length) return;
      stash.push({ obj: o, userData: ud });
      o.userData = {};
    });
    return stash;
  }

  function endGltfExportSanitize(stash) {
    if (!stash?.length) return;
    for (const item of stash) {
      if (item?.obj) item.obj.userData = item.userData;
    }
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
      anchorToolMode: getAnchorToolMode(),
      brushMode,
      brushRadius,
      brushSoftness,
      brushStrength,
      brushSign,
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
        parts: { ...(scopeHsl.parts || { dh: 0, ds: 0, dl: 0 }) },
      },
      meshColors,
      meshes,
      history: historyIndex.versions.slice(),
      pointIds: allPointIds().filter((id) => rest[id]),
      targetOf,
      hasRest: Object.keys(rest).length > 0,
      dragAxisHint: dragging?.lockedAxis != null ? AXIS_NAME[dragging.lockedAxis] : null,
      partTree,
      partChecked: [...partChecked],
      partOffset: getUiPartOffset(),
      partOffsetTargetCount: resolvePartOffsetTargets().length,
      partAdjustedCount: countAdjustedParts(),
      partHighlightId,
      partEditTargetId,
      islandChecked: [...islandChecked],
      islandHighlightToken,
      islandFocusToken,
      islandOffset: getUiIslandOffset(),
      islandOffsetTargetCount: resolveIslandOffsetTargets().length,
      islandAdjustedCount: countAdjustedIslands(),
      islandTreeCollapsed: [...islandTreeCollapsed],
      colorIslandGroups: getColorIslandGroups(),
      islandScanDone,
      islandTextureSynthParams: { ...islandTextureSynthParams },
      islandTextureSynthBusy,
      islandTextureSynthCount: islandTextureSynth.size,
      islandTextureSynthCheckedCount: countIslandTextureSynth(),
      islandTextureSynthLastError,
      buildId: BM_BUILD_ID,
      brushUndoCount: brushUndoStack.length,
      showSelectionOverlay,
      earScaleFactor: earScaleFactor(),
      selectedRegionMeta: selectedRegionMeta
        ? {
            partLabel: selectedRegionMeta.partLabel,
            companions: (selectedRegionMeta.companions || []).map((c) => ({
              meshKey: c.meshKey,
              regionId: c.regionId,
              pixelCount: c.pixelCount,
            })),
          }
        : null,
    };
  }

  return {
    attach,
    dispose,
    getState,
    getBuildId: () => BM_BUILD_ID,
    setShowSelectionOverlay,
    toggleSelectionOverlay,
    setSelected,
    setSlider,
    setXyz,
    resetMorph,
    undoBrushStroke,
    deletePoint,
    hasDefaultLandmarks,
    clearDefaultLandmarks,
    setAnchorToolMode,
    getAnchorToolMode,
    setMirrorLock(v) {
      mirrorLock = !!v;
      onChange();
    },
    setEditRest(v) {
      editRest = !!v;
      if (v) {
        addMode = false;
        brushMode = false;
      }
      syncBrushPreviewVisible();
      onChange();
    },
    setAddMode(v, symmetric = true) {
      addMode = !!v;
      addSymmetric = !!symmetric;
      if (v) {
        editRest = false;
        brushMode = false;
        setPickMuscleModeInternal(false);
      }
      syncBrushPreviewVisible();
      onChange();
    },
    setPickMuscleMode(v) {
      setPickMuscleModeInternal(!!v);
      if (v) {
        addMode = false;
        brushMode = false;
      }
      syncBrushPreviewVisible();
      onChange();
    },
    setBrushRadius(v) {
      brushRadius = Math.max(1e-5, Number(v) || brushRadius);
      saveBrushPrefs();
      onChange();
    },
    setBrushSoftness(v) {
      brushSoftness = Math.min(1, Math.max(0, Number(v) || 0));
      saveBrushPrefs();
      onChange();
    },
    setBrushStrength(v) {
      brushStrength = Math.min(1, Math.max(0.02, Number(v) || 0.25));
      saveBrushPrefs();
      onChange();
    },
    setBrushSign(v) {
      brushSign = Number(v) < 0 ? -1 : 1;
      saveBrushPrefs();
      onChange();
    },
    /** 自测：在表面打一笔，返回位移/翻面指标（不写入存档） */
    selftestBrushStamp(opts = {}) {
      if (!root || !meshCache.length) return { ok: false, reason: "no mesh" };
      const prevStrength = brushStrength;
      const prevRadius = brushRadius;
      const prevSign = brushSign;
      const prevSoft = brushSoftness;
      if (opts.strength != null) brushStrength = opts.strength;
      if (opts.radius != null) brushRadius = opts.radius;
      if (opts.sign != null) brushSign = opts.sign < 0 ? -1 : 1;
      if (opts.softness != null) brushSoftness = opts.softness;
      root.updateWorldMatrix(true, true);
      const box = new T.Box3().setFromObject(root);
      const size0 = box.getSize(new T.Vector3());
      const vol0 = Math.max(size0.x, 1e-9) * Math.max(size0.y, 1e-9) * Math.max(size0.z, 1e-9);
      // 快照世界 rest
      const snaps = meshCache.map((e) => new Float32Array(e.restPos));
      // 取最大网格中心附近一点：用包围盒中心朝 +Z 偏移一点再沿 -Z 射线
      const center = box.getCenter(new T.Vector3());
      const maxDim = Math.max(size0.x, size0.y, size0.z) || 1;
      if (!camera || !domEl) {
        brushStrength = prevStrength;
        brushRadius = prevRadius;
        brushSign = prevSign;
        brushSoftness = prevSoft;
        return { ok: false, reason: "no camera" };
      }
      // 从相机扫 NDC 网格，优先高 Y 命中（耳轮），避免打到基板边缘导致假黑斑
      const meshes = listMeshes();
      let hit2 = null;
      let bestScore = -Infinity;
      const grid = opts.ndc ? [opts.ndc] : null;
      const samples = grid || (() => {
        const pts = [];
        for (let gy = -2; gy <= 3; gy++) {
          for (let gx = -3; gx <= 3; gx++) {
            pts.push({ x: gx * 0.18, y: gy * 0.16 });
          }
        }
        pts.push({ x: 0, y: 0 });
        return pts;
      })();
      for (const p of samples) {
        pointer.x = p.x;
        pointer.y = p.y;
        raycaster.setFromCamera(pointer, camera);
        const hs = raycaster.intersectObjects(meshes, false);
        if (!hs.length) continue;
        const h = hs[0];
        const score = h.point.y * 4 - h.distance * 0.15;
        if (score > bestScore) {
          bestScore = score;
          hit2 = h;
        }
      }
      if (!hit2) {
        pointer.x = 0;
        pointer.y = 0;
        raycaster.setFromCamera(pointer, camera);
        const hs = raycaster.intersectObjects(meshes, false);
        hit2 = hs[0] || null;
      }
      if (!hit2) {
        brushStrength = prevStrength;
        brushRadius = prevRadius;
        brushSign = prevSign;
        brushSoftness = prevSoft;
        return { ok: false, reason: "no hit" };
      }
      const n = brushNormalFromHit(hit2);
      if (!opts.radius) brushRadius = Math.max(modelBrushScale() * 4, maxDim * 0.04);
      const vertsBefore = meshCache.reduce((s, e) => s + e.count, 0);
      const trisBefore = meshCache.reduce((s, e) => {
        const idx = e.mesh.geometry.index;
        return s + (idx ? idx.count / 3 : Math.floor(e.count / 3));
      }, 0);
      applyBrushStamp(hit2.point, n, hit2.object);
      const vertsAfter = meshCache.reduce((s, e) => s + e.count, 0);
      const trisAfter = meshCache.reduce((s, e) => {
        const idx = e.mesh.geometry.index;
        return s + (idx ? idx.count / 3 : Math.floor(e.count / 3));
      }, 0);
      // 指标（加密后 rest 变长，只比重叠前缀）
      let maxDisp = 0;
      let moved = 0;
      for (let ei = 0; ei < meshCache.length; ei++) {
        const restPos = meshCache[ei].restPos;
        const snap = snaps[ei];
        if (!snap) continue;
        const nCmp = Math.min(restPos.length, snap.length);
        for (let i = 0; i < nCmp; i += 3) {
          const dx = restPos[i] - snap[i];
          const dy = restPos[i + 1] - snap[i + 1];
          const dz = restPos[i + 2] - snap[i + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > 1e-10) moved++;
          if (d > maxDisp) maxDisp = d;
        }
        if (restPos.length > snap.length) moved += (restPos.length - snap.length) / 3;
      }
      root.updateWorldMatrix(true, true);
      const box1 = new T.Box3().setFromObject(root);
      const size1 = box1.getSize(new T.Vector3());
      const vol1 = Math.max(size1.x, 1e-9) * Math.max(size1.y, 1e-9) * Math.max(size1.z, 1e-9);
      const avgEdge = meshCache[0]?.brushAvgEdge || modelBrushScale();
      // 翻面：抽查若干三角，法线与刷前差异过大；并检查命中附近朝向
      let flip = 0;
      let tris = 0;
      let backNear = 0;
      let nearTris = 0;
      const hitPt = hit2.point;
      const hitN = n;
      for (const entry of meshCache) {
        const mesh = entry.mesh;
        const geom = mesh.geometry;
        const pos = geom.attributes.position;
        const index = geom.index;
        const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
        const sample = Math.min(triCount, 400);
        const stepT = Math.max(1, Math.floor(triCount / sample));
        const a = new T.Vector3();
        const b = new T.Vector3();
        const c = new T.Vector3();
        const e1 = new T.Vector3();
        const e2 = new T.Vector3();
        const nn = new T.Vector3();
        const mid = new T.Vector3();
        mesh.updateWorldMatrix(true, false);
        for (let t = 0; t < triCount; t += stepT) {
          const ia = index ? index.getX(t * 3) : t * 3;
          const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          a.fromBufferAttribute(pos, ia);
          b.fromBufferAttribute(pos, ib);
          c.fromBufferAttribute(pos, ic);
          e1.subVectors(b, a);
          e2.subVectors(c, a);
          nn.crossVectors(e1, e2);
          const area = nn.length();
          tris++;
          if (area < 1e-14) flip++; // 退化三角 ≈ 筛孔前兆
        }
        // 全量抽查命中圆盘同侧：法线应与命中法线同向（绕序翻面会大量背向）
        // 深度带收窄到贴面层，避免把堆料鼓包侧面误判成翻面
        const stepNear = Math.max(1, Math.floor(triCount / 2500));
        const depthBand = Math.max(brushRadius * 0.12, avgEdge * 0.8);
        for (let t = 0; t < triCount; t += stepNear) {
          const ia = index ? index.getX(t * 3) : t * 3;
          const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
          b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
          c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
          mid.set((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
          const dx = mid.x - hitPt.x;
          const dy = mid.y - hitPt.y;
          const dz = mid.z - hitPt.z;
          const along = dx * hitN.x + dy * hitN.y + dz * hitN.z;
          if (along < -brushRadius * 0.05 || along > depthBand) continue;
          const tang = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
          if (tang > brushRadius * 1.15) continue;
          e1.subVectors(b, a);
          e2.subVectors(c, a);
          nn.crossVectors(e1, e2);
          if (nn.lengthSq() < 1e-20) continue;
          nn.normalize();
          nearTris++;
          if (nn.dot(hitN) < -0.15) backNear++;
        }
      }
      const backFacingRatio = backNear / Math.max(nearTris, 1);
      const topologyStable = vertsAfter === vertsBefore && trisAfter === trisBefore;
      // 允许随笔刷半径的位移；勿用 markerRadius 卡死小耳模的合法堆料
      const dispCap = Math.max(avgEdge * 2.5, brushRadius * 0.55, 1e-4);
      const report = {
        ok:
          moved > 0 &&
          topologyStable &&
          maxDisp <= dispCap &&
          vol1 / vol0 < 1.35 &&
          flip / Math.max(tris, 1) < 0.02 &&
          backFacingRatio < 0.12,
        moved,
        maxDisp,
        avgEdge,
        volRatio: vol1 / vol0,
        degenerateRatio: flip / Math.max(tris, 1),
        backFacingRatio,
        nearTris,
        vertsBefore,
        vertsAfter,
        trisBefore,
        trisAfter,
        densified: false,
        topologyStable,
        strength: brushStrength,
        radius: brushRadius,
        hit: [hit2.point.x, hit2.point.y, hit2.point.z],
      };
      brushStrength = prevStrength;
      brushRadius = prevRadius;
      brushSign = prevSign;
      brushSoftness = prevSoft;
      return report;
    },
    setSelectedMeshColor(hex) {
      if (!selectedMeshKey || !selectedRegionKey) return;
      applyMeshColor(selectedMeshKey, hex);
    },
    setHslScope(scope) {
      if (scope !== "selected" && scope !== "muscles" && scope !== "all" && scope !== "parts") return;
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
      if (hslScope === "parts" && !islandChecked.size) {
        return { ok: false, reason: "need checked islands" };
      }
      const scope = hslScope;
      if (immediate) {
        if (hslPaintRaf) {
          cancelAnimationFrame(hslPaintRaf);
          hslPaintRaf = 0;
          hslPaintQueued = null;
        }
        scopeHsl[scope] = {
          dh: Number(dh) || 0,
          ds: Number(ds) || 0,
          dl: Number(dl) || 0,
        };
        replayMeshColorsOnAtlas();
        if (notify) onChange();
        return { ok: true, scope, ...scopeHsl[scope] };
      }
      scheduleHslPaint({
        kind: "scope",
        scope,
        dh: Number(dh) || 0,
        ds: Number(ds) || 0,
        dl: Number(dl) || 0,
        notify,
      });
      return {
        ok: true,
        scope,
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
    saveHistoryVersion,
    applyCommittedColorAdjustments,
    loadHistoryVersion,
    deleteHistoryVersion,
    loadHistoryIndex,
    scheduleApply,
    getRoot: () => root,
    setProjectStorage,
    getProjectStorage,
    markerGroup: () => markerGroup,
    setMarkersVisible,
    getPartTree: () => partTree,
    pickPartNodeFromMesh,
    pickIslandFromRay,
    rebuildMeshColorIslands,
    getColorIslandGroups,
    setIslandChecked,
    toggleIslandChecked,
    highlightIsland,
    flashIsland,
    setIslandFocusToken,
    setIslandOffset,
    resetIslandOffsets,
    setIslandPreviewDock,
    syncCheckedIslandPreviews,
    renderCheckedIslandPreviews,
    revealIslandTreeToken,
    toggleIslandTreeCollapsed,
    setIslandTreeCollapsed,
    expandAllIslandGroups,
    collapseAllIslandGroups,
    toggleIslandMeshChecked,
    rebuildPartTree,
    rebuildAnatomyPartTree,
    selectAnatomyPart,
    setPartChecked,
    togglePartChecked,
    setPartOffset,
    resetPartOffsets,
    highlightPartNode,
    scheduleIslandTextureSynth,
    flushIslandTextureSynth,
    clearIslandTextureSynth,
    randomizeIslandTextureSeed,
    setIslandTextureSynthParams,
    runIslandTextureSynth,
    prepareAtlasForExport,
    beginGltfExportSanitize,
    endGltfExportSanitize,
    debugTextureSynthAtlasHash(token) {
      const entry = islandTextureSynth.get(token);
      const resolved = resolveIslandFromToken(token);
      if (!entry?.bbox || !resolved?.mesh?.userData?.bmAtlas) return null;
      const atlas = resolved.mesh.userData.bmAtlas;
      const live = ensureLive(atlas).data;
      const { x, y, w, h } = entry.bbox;
      let hash = 0;
      let n = 0;
      for (let row = 0; row < h; row += 3) {
        for (let col = 0; col < w; col += 3) {
          const p = (y + row) * atlas.w + (x + col);
          const di = p * 4;
          hash = (Math.imul(hash, 31) + live[di] + live[di + 1] * 3 + live[di + 2] * 7) >>> 0;
          n++;
        }
      }
      return {
        hash,
        n,
        flatMuscle: !!entry.flatMuscle,
        similarity: entry.similarity,
        blockScale: entry.blockScale,
        cacheHash: entry.pixels?.length
          ? (() => {
              let h2 = 0;
              for (let i = 0; i < entry.pixels.length; i += 97 * 4) {
                h2 = (Math.imul(h2, 31) + entry.pixels[i]) >>> 0;
              }
              return h2;
            })()
          : 0,
      };
    },
    debugFindIslandOwnersForPixels(pixels) {
      const out = [];
      for (const px of pixels || []) {
        if (!px || px.length < 2) continue;
        const [x, y] = px;
        const owners = [];
        for (const mesh of listMeshes()) {
          const atlas = mesh.userData?.bmAtlas;
          if (!atlas) continue;
          const mk = meshKey(mesh);
          const p = y * atlas.w + x;
          for (const isl of mesh.userData?.bmIslands || []) {
            if (isl.mask?.[p]) {
              owners.push({
                token: islandToken(mk, isl.regionId),
                regionId: isl.regionId,
                label: isl.label,
                previewHex: isl.previewHex,
                mesh: mesh.name,
              });
            }
          }
          const refined = refineTextureSynthMask(mesh, "gi_18");
          if (refined?.[p]) owners.push({ kind: "refined_gi_18", mesh: mesh.name });
          const geom = getIslandMask(mesh, "gi_18");
          if (geom?.[p]) owners.push({ kind: "geom_gi_18", mesh: mesh.name });
        }
        out.push({ px, owners });
      }
      const entry = islandTextureSynth.get(
        [...islandTextureSynth.keys()].find((t) => t.includes("gi_18")) || ""
      );
      return { pixels: out, gi18BBox: entry?.bbox || null, gi18Count: entry?.synthMask ? maskPixelCount(entry.synthMask) : 0 };
    },
    debugProjectIslandScreenCrop(token, padFrac = 0.05) {
      const hit = resolveIslandFromToken(token);
      if (!hit?.mesh || !hit.isl?.triangleSet?.size || !camera || !domEl) return null;
      const mesh = hit.mesh;
      const geom = mesh.geometry;
      const posAttr = geom?.attributes?.position;
      if (!posAttr) return null;
      const index = geom.index;
      const rect = domEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      mesh.updateWorldMatrix(true, false);
      const v = new T.Vector3();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let n = 0;
      const step = Math.max(1, (hit.isl.triangleSet.size / 140) | 0);
      let ti = 0;
      for (const t of hit.isl.triangleSet) {
        ti++;
        if (ti % step !== 0) continue;
        const ia = index ? index.getX(t * 3) : t * 3;
        const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        for (const vi of [ia, ib, ic]) {
          v.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
          v.applyMatrix4(mesh.matrixWorld);
          v.project(camera);
          if (v.z < -1 || v.z > 1) continue;
          const sx = ((v.x + 1) * 0.5) * rect.width;
          const sy = ((1 - v.y) * 0.5) * rect.height;
          if (sx < minX) minX = sx;
          if (sy < minY) minY = sy;
          if (sx > maxX) maxX = sx;
          if (sy > maxY) maxY = sy;
          n++;
        }
      }
      if (n < 6 || !isFinite(minX)) return null;
      const padX = Math.max(10, (maxX - minX) * padFrac);
      const padY = Math.max(10, (maxY - minY) * padFrac);
      const x0 = Math.max(0, Math.floor(minX - padX));
      const y0 = Math.max(0, Math.floor(minY - padY));
      const x1 = Math.min(rect.width - 1, Math.ceil(maxX + padX));
      const y1 = Math.min(rect.height - 1, Math.ceil(maxY + padY));
      return { box: [x0, y0, x1, y1], n, canvas: [rect.width, rect.height] };
    },
    debugPickAtlasAtClient(clientX, clientY) {
      if (!camera || !domEl) return null;
      const rect = domEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(listMeshes(), false);
      const hit = hits[0];
      if (!hit?.uv) return { hit: false };
      const mesh = hit.object;
      const atlas = mesh.userData?.bmAtlas;
      if (!atlas) return { hit: true, mesh: mesh.name, noAtlas: true };
      const px = uvToPixel(atlas, hit.uv.x, hit.uv.y);
      const live = ensureLive(atlas).data;
      const di = px.i;
      const entry = islandTextureSynth.get(islandToken(meshKey(mesh), "gi_18"));
      const mask = entry?.synthMask || getIslandMask(mesh, "gi_18");
      const p = px.y * atlas.w + px.x;
      return {
        hit: true,
        mesh: mesh.name,
        uv: [hit.uv.x, hit.uv.y],
        px: [px.x, px.y],
        rgb: [live[di], live[di + 1], live[di + 2]],
        inGi18Mask: !!(mask && mask[p]),
        inSynthBBox:
          entry?.bbox &&
          px.x >= entry.bbox.x &&
          px.x < entry.bbox.x + entry.bbox.w &&
          px.y >= entry.bbox.y &&
          px.y < entry.bbox.y + entry.bbox.h,
      };
    },
    /** 自测/调试：在 NDC 点选并返回结果 */
    debugClearMeshColors() {
      meshColors = {};
      selectedMeshKey = null;
      selectedRegionKey = null;
      selectedRegionMeta = null;
      hslScope = "selected";
      scopeHsl = {
        selected: { dh: 0, ds: 0, dl: 0 },
        muscles: { dh: 0, ds: 0, dl: 0 },
        all: { dh: 0, ds: 0, dl: 0 },
      };
      for (const mesh of listMeshes()) {
        const atlas = mesh.userData?.bmAtlas;
        if (!atlas) continue;
        atlas.masks = {};
        restoreEntireAtlas(mesh);
      }
      replayMeshColorsOnAtlas();
      onChange();
      return { ok: true };
    },
    debugMeshExpansionAtCanvas(side, nx, ny) {
      const deformMesh = listMeshes().find(
        (m) => /deform/i.test(m.name || meshKey(m) || "") && m.userData?.bmAtlas
      );
      if (!deformMesh || !camera || !root) return { ok: false };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(listMeshes(), false);
      const hitSeed = findMeshHitTriangle(deformMesh, hits);
      const deformSeed = findDeformSeedFromHits(deformMesh, hits, side);
      const tragSeed = findEarSeedTriangle(deformMesh, side);
      const row = (label, seedHit) => {
        if (!seedHit) return { label, px: 0 };
        const raw = maskEarByMeshExpansion(deformMesh, side, seedHit, { maxDist: 0.095 });
        return { label, px: raw ? maskPixelCount(raw) : 0, faceIndex: seedHit.faceIndex };
      };
      return {
        side,
        hit: row("hit", hitSeed),
        deform: row("deform", deformSeed),
        trag: row("trag", tragSeed),
      };
    },
    debugEarExpansionSweep(side, nx, ny) {
      if (!camera || !root) return { ok: false };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(listMeshes(), false);
      const dists = [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12];
      const layers = [];
      for (const mesh of listMeshes()) {
        const n = (mesh.name || meshKey(mesh) || "").toLowerCase();
        if (!/static|deform/i.test(n) || !mesh.userData?.bmAtlas) continue;
        const hitSeed = findMeshHitTriangle(mesh, hits);
        const deformSeed = n.includes("deform")
          ? findDeformSeedFromHits(mesh, hits, side)
          : null;
        const tragSeed = findEarSeedTriangle(mesh, side);
        const rows = [];
        for (const d of dists) {
          for (const [label, seed] of [
            ["hit", hitSeed],
            ["deformSeed", deformSeed],
            ["trag", tragSeed],
          ]) {
            if (!seed) continue;
            const raw = maskEarByMeshExpansion(mesh, side, seed, { maxDist: d });
            rows.push({ d, label, px: raw ? maskPixelCount(raw) : 0 });
          }
        }
        layers.push({ name: mesh.name, rows });
      }
      return { side, nx, ny, layers };
    },
    debugEarCacheState() {
      return {
        ready: earPickCacheReady,
        building: !!earCacheBuildJob,
        L: earPickCache.L
          ? (earPickCache.L.primary?.pixelCount || 0) +
            (earPickCache.L.companions?.reduce((n, x) => n + (x.pixelCount || 0), 0) || 0)
          : 0,
        R: earPickCache.R
          ? (earPickCache.R.primary?.pixelCount || 0) +
            (earPickCache.R.companions?.reduce((n, x) => n + (x.pixelCount || 0), 0) || 0)
          : 0,
      };
    },
    debugEarGeometryProbe(side) {
      const layers = [];
      let staticMask = null;
      for (const mesh of listMeshes()) {
        if (!isEarGeometryMesh(mesh) || !mesh.userData?.bmAtlas) continue;
        if (/static/i.test(mesh.name || meshKey(mesh) || "")) {
          staticMask = finalizeStructuralEarMask(mesh, side);
        }
      }
      for (const mesh of listMeshes()) {
        if (!isEarGeometryMesh(mesh) || !mesh.userData?.bmAtlas) continue;
        const loose = maskEarByGeometry(mesh, side);
        const tight = maskEarByStructure(mesh, side, { tight: true });
        const finalMask = /static/i.test(mesh.name || meshKey(mesh) || "")
          ? finalizeStructuralEarMask(mesh, side)
          : finalizeStructuralEarMask(mesh, side, staticMask);
        const structBound =
          /deform/i.test(mesh.name || meshKey(mesh) || "") && staticMask && loose
            ? maskPixelCount(andMasks(loose, staticMask))
            : 0;
        layers.push({
          name: mesh.name,
          loosePx: loose ? maskPixelCount(loose) : 0,
          tightPx: tight ? maskPixelCount(tight) : 0,
          structBoundPx: structBound,
          finalPx: finalMask ? maskPixelCount(finalMask) : 0,
        });
      }
      return {
        side,
        tragionL: !!targetOf("tragion_L"),
        tragionR: !!targetOf("tragion_R"),
        staticMaskPx: staticMask ? maskPixelCount(staticMask) : 0,
        layers,
      };
    },
    /** 自测：画布 0..1 坐标点选，等同 Alt+左键 */
    debugEarPickTrace(nx, ny) {
      if (!camera || !root) return { ok: false, reason: "no camera" };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(listMeshes(), false);
      const earSide =
        inferEarSideFromHit(hits) || inferEarSideFromPoint(hits[0]?.point);
      const forceEar = shouldForceEarPick(hits);
      const side = earSide || (hits[0]?.point?.x < 0 ? "L" : "R");
      let staticPx = 0;
      let deformPx = 0;
      let staticSource = "";
      for (const mesh of listMeshes()) {
        if (!/static/i.test(mesh.name || meshKey(mesh) || "")) continue;
        if (!mesh.userData?.bmAtlas) continue;
        const mask = buildStaticEarMask(mesh, side, hits);
        staticPx = mask ? maskPixelCount(mask) : 0;
        staticSource = mask ? "buildStaticEarMask" : "null";
        break;
      }
      let staticPick = null;
      for (const mesh of listMeshes()) {
        if (!/static/i.test(mesh.name || meshKey(mesh) || "")) continue;
        staticPick = buildStaticEarLayer(mesh, side, hits);
        if (staticPick) break;
      }
      const deformPick = staticPick
        ? buildDeformEarLayer(hits, side, staticPick)
        : null;
      deformPx = deformPick?.pixelCount || 0;
      const full = buildFullEarGeometryPick(hits, side);
      const norm = normalizeEarGeometryPick(tryEarGeometryPickForSide(hits, side));
      const bothSides = ["L", "R"].map((s) => {
        let sp = null;
        for (const mesh of listMeshes()) {
          if (!/static/i.test(mesh.name || meshKey(mesh) || "")) continue;
          sp = buildStaticEarLayer(mesh, s, hits);
          if (sp) break;
        }
        const dp = sp ? buildDeformEarLayer(hits, s, sp) : null;
        return { side: s, staticPx: sp?.pixelCount || 0, deformPx: dp?.pixelCount || 0 };
      });
      return {
        forceEar,
        earSide,
        firstHitX: hits[0]?.point?.x,
        hitMeshes: hits.slice(0, 6).map((h) => h.object?.name),
        staticPx,
        staticLayerPx: staticPick?.pixelCount || 0,
        deformPx,
        staticSource,
        bothSides,
        full: full
          ? {
              staticPx: full.primary?.pixelCount,
              deformPx: full.companions?.[0]?.pixelCount,
            }
          : null,
        norm: norm
          ? {
              staticPx: norm.primary?.pixelCount,
              deformPx: norm.companions?.[0]?.pixelCount,
            }
          : null,
      };
    },
    debugPickEarLayersFromHit(nx, ny) {
      if (!camera || !root) return { ok: false };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(listMeshes(), false);
      const side =
        inferEarSideFromHit(hits) || inferEarSideFromPoint(hits[0]?.point);
      const t0 = performance.now();
      const built = pickEarLayersFromHit(hits, side);
      return {
        side,
        forceEar: shouldForceEarPick(hits),
        hitMesh: hits[0]?.object?.name,
        hitX: hits[0]?.point?.x,
        ms: Math.round(performance.now() - t0),
        built: built
          ? {
              staticPx: built.primary?.pixelCount,
              deformPx: built.companions?.[0]?.pixelCount,
            }
          : null,
      };
    },
    debugSelectAtCanvas01(nx, ny) {
      if (!camera || !root) return false;
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      return selectMeshByRay();
    },
    /** 自测：画布点射线命中处贴图是否已设色（用于脖子渗漏探测） */
    debugProbeCanvasPaint(nx, ny, diffThresh = 25) {
      if (!camera || !root) return [];
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(listMeshes(), false).slice(0, 8);
      const out = [];
      for (const hit of hits) {
        const mesh = hit.object;
        const atlas = mesh.userData?.bmAtlas;
        if (!atlas || !hit.uv) continue;
        const p = uvToPixel(atlas, hit.uv.x, hit.uv.y);
        const o = atlas.orig.data;
        const d = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
        const i = p.i;
        const diff =
          Math.abs(o[i] - d[i]) +
          Math.abs(o[i + 1] - d[i + 1]) +
          Math.abs(o[i + 2] - d[i + 2]);
        let inMask = false;
        for (const rid of Object.keys(atlas.masks || {})) {
          if (atlas.masks[rid]?.[p.y * atlas.w + p.x]) {
            inMask = true;
            break;
          }
        }
        out.push({
          mesh: mesh.name || meshKey(mesh),
          changed: diff > diffThresh,
          inMask,
          dist: hit.distance,
        });
      }
      return out;
    },
    /** 自测：当前 HSL 设色后各层像素统计（含 mask 内覆盖率与 mask 外渗漏） */
    debugAtlasPaintStats(diffThresh = 25) {
      function meshStats(substr) {
        let mesh = null;
        root.traverse((o) => {
          if (o.isMesh && (o.name || "").toLowerCase().includes(substr)) mesh = o;
        });
        const atlas = mesh?.userData?.bmAtlas;
        if (!atlas) return null;
        const o = atlas.orig.data;
        const d = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
        const masks = atlas.masks || {};
        let changed = 0;
        let inMaskChanged = 0;
        let inMaskTotal = 0;
        let outMaskChanged = 0;
        for (let p = 0; p < atlas.w * atlas.h; p++) {
          const i = p * 4;
          if (isNearBlack(o[i], o[i + 1], o[i + 2])) continue;
          const diff =
            Math.abs(o[i] - d[i]) +
            Math.abs(o[i + 1] - d[i + 1]) +
            Math.abs(o[i + 2] - d[i + 2]);
          const isChanged = diff > diffThresh;
          let inMask = false;
          for (const rid of Object.keys(masks)) {
            if (masks[rid]?.[p]) {
              inMask = true;
              break;
            }
          }
          if (inMask) {
            inMaskTotal++;
            if (isChanged) inMaskChanged++;
          } else if (isChanged) outMaskChanged++;
          if (isChanged) changed++;
        }
        return {
          name: mesh.name,
          changed,
          inMaskChanged,
          inMaskTotal,
          inMaskCoverage: inMaskTotal ? inMaskChanged / inMaskTotal : 0,
          outMaskChanged,
        };
      }
      const st = getState();
      return {
        pick: {
          label: st.selectedPartLabel,
          px: st.selectedRegionPixels,
          key: st.selectedMeshKey,
          region: st.selectedRegionKey,
        },
        meshColorKeys: Object.keys(st.meshColors || {}),
        static: meshStats("static"),
        deform: meshStats("deform"),
      };
    },
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
    debugSamplePickAtNdc(nx, ny, meshNameSubstr = "Deform") {
      if (!camera || !root) return { err: "no camera/root" };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const meshes = listMeshes().filter((m) => m.visible);
      const hits = raycaster.intersectObjects(meshes, false);
      const hit = hits.find((h) =>
        h.uv && (h.object.name || "").toLowerCase().includes(meshNameSubstr.toLowerCase())
      );
      if (!hit?.uv) return { err: "no hit", hits: hits.length };
      const pick = samplePickAtUv(hit.object, hit.uv.x, hit.uv.y, hit.point);
      return {
        mesh: hit.object.name,
        dist: hit.distance,
        uv: [hit.uv.x, hit.uv.y],
        pick: pick
          ? {
              px: pick.pixelCount,
              hex: pick.previewHex,
              partKey: pick.partKey,
              regionId: pick.regionId,
            }
          : null,
      };
    },
    /** 自测：在 NDC 处按语义色块选肌逻辑取最优部件 */
    debugFloodPickAtNdc(nx, ny) {
      if (!camera || !root) return { err: "no camera/root" };
      pointer.x = nx * 2 - 1;
      pointer.y = -(ny * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const meshes = listMeshes().filter((m) => m.visible);
      const hits = raycaster.intersectObjects(meshes, false);
      const earGeom = tryEarGeometryPick(hits);
      if (earGeom) {
        const p = earGeom.primary;
        const companionPx = (earGeom.companions || []).reduce((s, c) => s + c.pixelCount, 0);
        return {
          best: {
            mesh: p.mesh.name,
            key: p.meshKey,
            dist: hits[0]?.distance,
            px: p.pixelCount + companionPx,
            hex: p.previewHex,
            partKey: p.partKey,
            partLabel: p.partLabel,
            regionId: p.regionId,
            seedU: p.seedU,
            seedV: p.seedV,
            score: 100,
            earGeometry: true,
          },
          candidates: [],
          companions: (earGeom.companions || []).map((c) => ({
            mesh: c.mesh.name,
            meshKey: c.meshKey,
            px: c.pixelCount,
            hex: c.previewHex,
            regionId: c.regionId,
          })),
        };
      }
      const { best, bestScore, candidates } = pickBestFromHits(hits);
      const companions = best
        ? collectEarCompanionPicks(hits, best.hit.object, best.pick).map((c) => ({
            mesh: c.pick ? listMeshes().find((m) => meshKey(m) === c.meshKey)?.name : c.meshKey,
            meshKey: c.meshKey,
            px: c.pick?.pixelCount,
            hex: c.pick?.previewHex,
            partKey: c.pick?.partKey,
            regionId: c.pick?.regionId,
          }))
        : [];
      if (!best) return { best: null, candidates, companions };
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
        companions,
      };
    },
  };
}
