/**
 * 欧版肌肉 GLB · Three.js 预览显示契约（叠显 / 工坊共用）
 *
 * 对齐 GLB 管理器 model-viewer PBR（neutral）：
 * - 肌肉 + Static + 虹膜：GLB 原 PBR
 * - 虹膜「+」形几何孔 → 局部黑球堵住（圆盘会露出十字伪影）
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DISPLAY_REV = '20260829-display18';

const _pupilPlugMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  side: THREE.DoubleSide,
  depthWrite: true,
  depthTest: true,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});

export function isEuroJunkOverlayName(name) {
  const n = (name || '').toLowerCase();
  return n.includes('melns');
}

export function isEuroIrisMeshName(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('melns') || n.includes('acsleca')) return false;
  if (/\bacs_0\b|_acs_0|acs_0_|eye_with_texture/.test(n)) return true;
  if (/\bacs\b|_acs|acs_/.test(n) && !n.includes('leca')) return true;
  return false;
}

export function isEuroEyeMeshName(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('melns')) return false;
  if (n.includes('acsleca')) return true;
  return isEuroIrisMeshName(n);
}

export function meshHasEuroEyeName(mesh) {
  const n = `${mesh?.name || ''} ${mesh?.parent?.name || ''}`;
  return isEuroEyeMeshName(n);
}

export function shouldSkipEuroWarp(mesh) {
  return meshHasEuroEyeName(mesh);
}

export function isEuroStaticName(name) {
  const n = (name || '').toLowerCase();
  return n.includes('static') || n === 'skin' || n.includes('head_static');
}

export function isEuroMuscleLayerName(name) {
  const n = (name || '').toLowerCase();
  return n.includes('deform') || n.includes('skiedras') || n.includes('plastyma');
}

export function isEuroLensMeshName(name) {
  const n = (name || '').toLowerCase();
  return n.includes('acsleca');
}

export function healOpaqueBlendMaterial(m) {
  void m;
}

function healMaterialMaps(m) {
  if (!m) return;
  if (m.map && 'colorSpace' in m.map) {
    m.map.colorSpace = THREE.SRGBColorSpace;
    m.map.needsUpdate = true;
  }
}

function materialExtras(m) {
  return m?.extras || m?.userData || {};
}

export function tagSfSparsePatchMeshes(root) {
  if (!root) return 0;
  let n = 0;
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    if (mats.some((m) => materialExtras(m).sfSparsePatch)) {
      node.visible = false;
      node.userData._overlayHiddenJunk = true;
      n += 1;
    }
  });
  return n;
}

/** 虹膜「+」形孔洞：取内圈顶点估中心/法线/孔径 */
function irisPupilHoleSpecs(mesh) {
  const pos = mesh.geometry?.attributes?.position;
  const norm = mesh.geometry?.attributes?.normal;
  if (!pos?.count) return [];
  const xs = [];
  for (let i = 0; i < pos.count; i++) xs.push(pos.getX(i));
  xs.sort((a, b) => a - b);
  const med = xs[Math.floor(xs.length / 2)];
  const specs = [];
  for (let ci = 0; ci < 2; ci++) {
    const pts = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (ci === 0 ? x < med : x >= med) {
        pts.push({
          p: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)),
          n: norm
            ? new THREE.Vector3(norm.getX(i), norm.getY(i), norm.getZ(i))
            : new THREE.Vector3(0, 0, 1),
        });
      }
    }
    if (!pts.length) continue;
    let c = new THREE.Vector3();
    for (const { p } of pts) c.add(p);
    c.divideScalar(pts.length);
    const ranked = pts.map(({ p, n }) => ({ p, n, r: p.distanceTo(c) })).sort((a, b) => a.r - b.r);
    const innerN = Math.max(6, Math.floor(ranked.length * 0.12));
    const inner = ranked.slice(0, innerN);
    let holeC = new THREE.Vector3();
    let holeN = new THREE.Vector3();
    let maxR = 0;
    for (const { p, n, r } of inner) {
      holeC.add(p);
      holeN.add(n);
      if (r > maxR) maxR = r;
    }
    holeC.divideScalar(inner.length);
    holeN.divideScalar(inner.length).normalize();
    if (holeN.lengthSq() < 1e-6) holeN.set(0, 0, 1);
    // 「+」形孔：圆盘须略大于孔洞外缘（display16 的 0.55 太小呈十字）
    const radius = Math.max(maxR * 1.12, 0.001);
    specs.push({ center: holeC, normal: holeN, radius });
  }
  return specs;
}

function removeIrisPupilPlugs(mesh) {
  for (let i = mesh.children.length - 1; i >= 0; i--) {
    const ch = mesh.children[i];
    if (ch.userData?._euroPupilDisc || ch.userData?._euroPupilPlug) {
      ch.removeFromParent();
      ch.geometry?.dispose();
    }
  }
}

/** 虹膜几何孔：局部黑盘（略大于「+」孔外缘，避免十字伪影） */
export function installIrisPupilHoleDiscs(root) {
  if (!root) return 0;
  let n = 0;
  const zAxis = new THREE.Vector3(0, 0, 1);
  root.traverse((node) => {
    if (!node.isMesh) return;
    const label = `${node.name || ''} ${node.parent?.name || ''}`;
    if (!isEuroIrisMeshName(label)) return;
    removeIrisPupilPlugs(node);
    for (const { center, normal, radius } of irisPupilHoleSpecs(node)) {
      const geo = new THREE.CircleGeometry(radius, 32);
      const disc = new THREE.Mesh(geo, _pupilPlugMat);
      disc.name = 'EuroPupilHoleDisc';
      disc.userData._euroPupilPlug = true;
      disc.userData._euroPupilDisc = true;
      disc.position.copy(center).addScaledVector(normal, radius * 0.65);
      disc.quaternion.setFromUnitVectors(zAxis, normal.clone().normalize());
      disc.renderOrder = (node.renderOrder || 0) + 12;
      node.add(disc);
      n += 1;
    }
  });
  return n;
}

export function createGlbManagerSfEyeballMaterial(m) {
  if (!m) return m;
  if (m.map) {
    healMaterialMaps(m);
    m.map.flipY = true;
    if ('wrapS' in m.map) {
      m.map.wrapS = THREE.ClampToEdgeWrapping;
      m.map.wrapT = THREE.ClampToEdgeWrapping;
    }
    m.map.needsUpdate = true;
    const eye = new THREE.MeshBasicMaterial({
      map: m.map,
      color: new THREE.Color(1, 1, 1),
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    eye.name = m.name || 'EuroIrisUnlit';
    eye.userData.sfEyeball = true;
    return eye;
  }
  const eye = new THREE.MeshPhongMaterial({
    color: new THREE.Color(0.2, 0.18, 0.17),
    specular: new THREE.Color(0.95, 0.95, 1),
    shininess: 220,
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
  });
  eye.name = m.name || 'EuroIrisPhong';
  eye.userData.sfEyeball = true;
  return eye;
}

export function applyEuroGlbManagerEyeMaterials(root) {
  if (!root) return 0;
  let n = 0;
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const label = `${node.name || ''} ${node.parent?.name || ''}`;
    if (!isEuroIrisMeshName(label)) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    const next = mats.map((m) => {
      if (!m || m.userData?.sfEyeball) return m;
      const ex = materialExtras(m);
      if (!ex.sfEyeball && !isEuroIrisMeshName(label)) return m;
      return createGlbManagerSfEyeballMaterial(m);
    });
    node.material = Array.isArray(node.material) ? next : next[0];
    n += 1;
  });
  return n;
}

export function installEuroPupilOccluders(root, opts = {}) {
  void opts;
  return installIrisPupilHoleDiscs(root);
}

export function upgradeEuroIrisUnlit(root) {
  return applyEuroGlbManagerEyeMaterials(root);
}

export function prepareEuroMaterials(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m) continue;
    healMaterialMaps(m);
    m.needsUpdate = true;
  }
}

export function prepareEuroScene(root, opts = {}) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (isEuroJunkOverlayName(obj.name) || isEuroJunkOverlayName(obj.parent?.name)) {
      obj.visible = false;
      obj.userData._overlayHiddenJunk = true;
      return;
    }
    prepareEuroMaterials(obj);
  });
  tagSfSparsePatchMeshes(root);
  if (opts.matcapEye) applyEuroGlbManagerEyeMaterials(root);
  if (opts.pupilHoleDiscs !== false) installIrisPupilHoleDiscs(root);
}

export function applyEuroPreviewEnvironment(scene, renderer) {
  if (!scene || !renderer || scene.environment) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environmentIntensity = 0.65;
  pmrem.dispose();
}

export function prepareEuroMeshesForExport(mesh) {
  if (!mesh?.isMesh) return;
  mesh.visible = true;
  delete mesh.userData._overlayHiddenJunk;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m) continue;
    healMaterialMaps(m);
    m.needsUpdate = true;
  }
}

export function cloneMaterialForExport(m) {
  if (!m?.clone) return m;
  const c = m.clone();
  if (m.map) c.map = m.map;
  if (m.normalMap) c.normalMap = m.normalMap;
  if (m.roughnessMap) c.roughnessMap = m.roughnessMap;
  if (m.metalnessMap) c.metalnessMap = m.metalnessMap;
  if (m.alphaMap) c.alphaMap = m.alphaMap;
  if (m.emissiveMap) c.emissiveMap = m.emissiveMap;
  return c;
}

export { DISPLAY_REV };
