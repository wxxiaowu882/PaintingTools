import * as THREE from 'three';

/** 与 GNM material_id 对应：skin, teeth, gums, tongue, scleras, irises, pupils */
export const GNM_MATERIAL_COLORS = [
  [0.85, 0.63, 0.51],
  [0.95, 0.93, 0.86],
  [0.77, 0.45, 0.42],
  [0.71, 0.31, 0.28],
  [0.96, 0.95, 0.93],
  [0.58, 0.42, 0.30],
  [0.01, 0.01, 0.015],
];

const EYE_COMPONENT_IDS = new Set([1, 2]);

function triVisible(model, visibility, a, b, c) {
  if (!visibility) return true;
  const comp = model.componentId;
  if (visibility[comp[a]] === false) return false;
  if (visibility[comp[b]] === false || visibility[comp[c]] === false) return false;
  return true;
}

export function buildGnmVertexColors(model) {
  const colors = new Float32Array(model.numVertices * 3);
  const matId = model.materialId;
  for (let i = 0; i < model.numVertices; i++) {
    const c = GNM_MATERIAL_COLORS[matId[i] % GNM_MATERIAL_COLORS.length];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  return colors;
}

export function buildGnmIndexGroups(model, visibility = null) {
  const tris = model.triangles;
  const comp = model.componentId;
  const mat = model.materialId;
  const body = [];
  const eyeInner = [];
  const eyeSclera = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t];
    const b = tris[t + 1];
    const c = tris[t + 2];
    if (!triVisible(model, visibility, a, b, c)) continue;
    const c0 = comp[a];
    const m0 = mat[a];
    if (EYE_COMPONENT_IDS.has(c0)) {
      if (m0 === 4) eyeSclera.push(a, b, c);
      else if (m0 === 5 || m0 === 6) eyeInner.push(a, b, c);
      else body.push(a, b, c);
    } else {
      body.push(a, b, c);
    }
  }
  return { body, eyeInner, eyeSclera };
}

function makeIndexedGeo(posAttr, colorAttr, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posAttr);
  if (colorAttr) geo.setAttribute('color', colorAttr);
  geo.setIndex(indices.length ? indices : [0, 0, 0]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * GNM 头模：身体 + 虹膜瞳孔（不透明）+ 巩膜（半透明物理材质模拟角膜/晶状体透光）
 * @param {import('./vendor/GNMModel.js').GNMHeadModel} model
 * @param {object} opts
 * @param {Float32Array} opts.positions
 * @param {boolean[]} [opts.visibility]
 * @param {boolean} [opts.dynamic]
 */
export function createGnmHeadGroup(model, opts) {
  const { positions, visibility = null, dynamic = false } = opts;
  const root = new THREE.Group();
  root.name = 'GNM_Head';

  const posAttr = new THREE.BufferAttribute(positions, 3);
  if (dynamic) posAttr.setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(buildGnmVertexColors(model), 3);

  const groups = buildGnmIndexGroups(model, visibility);
  const parts = [];

  const bodyMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.02,
  });
  const bodyMesh = new THREE.Mesh(makeIndexedGeo(posAttr, colorAttr, groups.body), bodyMat);
  bodyMesh.name = 'GNM_Body';
  bodyMesh.frustumCulled = false;
  bodyMesh.renderOrder = 0;
  root.add(bodyMesh);
  parts.push({ mesh: bodyMesh, kind: 'body' });

  let eyeInnerMesh = null;
  if (groups.eyeInner.length) {
    const innerMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0,
    });
    eyeInnerMesh = new THREE.Mesh(makeIndexedGeo(posAttr, colorAttr, groups.eyeInner), innerMat);
    eyeInnerMesh.name = 'GNM_EyeInner';
    eyeInnerMesh.frustumCulled = false;
    eyeInnerMesh.renderOrder = 1;
    root.add(eyeInnerMesh);
    parts.push({ mesh: eyeInnerMesh, kind: 'eyeInner' });
  }

  let eyeScleraMesh = null;
  if (groups.eyeSclera.length) {
    const scleraMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.04,
      metalness: 0,
      transmission: 0.14,
      thickness: 0.0009,
      ior: 1.38,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    scleraMat.userData._gnmSclera = true;
    eyeScleraMesh = new THREE.Mesh(makeIndexedGeo(posAttr, null, groups.eyeSclera), scleraMat);
    eyeScleraMesh.name = 'GNM_EyeSclera';
    eyeScleraMesh.frustumCulled = false;
    eyeScleraMesh.renderOrder = 2;
    root.add(eyeScleraMesh);
    parts.push({ mesh: eyeScleraMesh, kind: 'eyeSclera' });
  }

  return {
    root,
    positionAttr: posAttr,
    parts,
    bodyMesh,
    eyeInnerMesh,
    eyeScleraMesh,
    rebuildIndices(vis) {
      const g = buildGnmIndexGroups(model, vis);
      bodyMesh.geometry.setIndex(g.body.length ? g.body : [0, 0, 0]);
      if (eyeInnerMesh) eyeInnerMesh.geometry.setIndex(g.eyeInner.length ? g.eyeInner : [0, 0, 0]);
      if (eyeScleraMesh) eyeScleraMesh.geometry.setIndex(g.eyeSclera.length ? g.eyeSclera : [0, 0, 0]);
      bodyMesh.geometry.computeVertexNormals();
      eyeInnerMesh?.geometry?.computeVertexNormals?.();
      eyeScleraMesh?.geometry?.computeVertexNormals?.();
    },
    dispose() {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      });
    },
  };
}
