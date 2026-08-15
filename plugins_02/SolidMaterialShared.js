// 消费端 Solid.html 与生产端 Solid_Portrait_Create 共用：单模型材质 resolve + apply。

const SOLID_MAT_LABELS = {
  origin: '自带材质',
  '0': '哑光石膏',
  '1': '亮面陶瓷',
  '2': '镜面金属',
  '3': '透明玻璃',
  '4': '磨砂玻璃',
};

const SOLID_MAT_ROUGHS = [0.95, 0.15, 0.3, 0.05, 0.4];
const SOLID_MAT_METALS = [0.0, 0.0, 0.85, 0.0, 0.0];
const SOLID_MAT_TRANS = [0.0, 0.0, 0.0, 1.0, 1.0];

export function normalizeSolidMatType(val) {
  const s = String(val != null ? val : 'origin');
  if (s === 'origin') return 'origin';
  const n = parseInt(s, 10);
  if (n >= 0 && n <= 4) return String(n);
  return 'origin';
}

export function resolveSolidItemEffectiveMat(item, envDefaultMat) {
  if (item && item.mat != null && String(item.mat).trim() !== '') {
    return normalizeSolidMatType(item.mat);
  }
  return normalizeSolidMatType(envDefaultMat != null ? envDefaultMat : 'origin');
}

export function solidMatLabelForType(matType) {
  const key = normalizeSolidMatType(matType);
  return SOLID_MAT_LABELS[key] || SOLID_MAT_LABELS.origin;
}

export function syncSolidMatPanelFromType(matType) {
  const targetMat = normalizeSolidMatType(matType);
  const matchedOpt = document.querySelector(`#mat-options .custom-option[onclick*="'${targetMat}'"]`);
  if (!matchedOpt) return;
  const trigger = document.getElementById('mat-trigger');
  if (trigger) trigger.innerText = matchedOpt.innerText;
  document.querySelectorAll('#mat-options .custom-option').forEach(opt => opt.classList.remove('selected'));
  matchedOpt.classList.add('selected');
}

export function buildSolidMaterialDeps({
  flatMat, sphereMat, plasterMat, safeDispose, materialRefEqual, isUnderGlbRoot, stampMeshOriginal,
}) {
  return {
    flatMat,
    sphereMat,
    plasterMat,
    safeDispose,
    materialRefEqual,
    isUnderGlbRoot,
    stampMeshOriginal,
  };
}

function _isSysMatRef(mat, deps) {
  if (!mat) return false;
  const { flatMat, sphereMat, plasterMat } = deps;
  if (mat === flatMat || mat === sphereMat || mat === plasterMat) return true;
  if (Array.isArray(mat)) return mat.every(m => m === flatMat || m === sphereMat || m === plasterMat);
  return false;
}

function _shouldDisposeReplaced(oldMat, originalMat, deps) {
  if (!oldMat) return false;
  if (deps.materialRefEqual(oldMat, originalMat)) return false;
  if (_isSysMatRef(oldMat, deps)) return false;
  return true;
}

function _buildBuiltinOriginMat(ud, deps) {
  const m = ud.isFlat ? deps.flatMat.clone() : (ud.shape === 'sphere' ? deps.sphereMat.clone() : deps.plasterMat.clone());
  if (ud.customColor && m.color) m.color.set(ud.customColor);
  return m;
}

function _applyPreviewParams(m, idx, ud, isGlb) {
  if (!m || !m.isMaterial) return m;
  const c = m.clone ? m.clone() : m;
  if (!isGlb && c.color) c.color.set(ud.customColor || '#e8e8e8');
  if (c.roughness !== undefined) c.roughness = (ud.shape === 'sphere' && idx === 0) ? 0.6 : SOLID_MAT_ROUGHS[idx];
  if (c.metalness !== undefined) c.metalness = SOLID_MAT_METALS[idx];
  if (c.transmission !== undefined) c.transmission = SOLID_MAT_TRANS[idx];
  if (c.transparent !== undefined) c.transparent = SOLID_MAT_TRANS[idx] > 0;
  if (c.ior !== undefined) c.ior = 1.5;
  if (ud.isFlat && c.flatShading !== undefined) c.flatShading = true;
  return c;
}

function _buildPreviewFromOriginal(originalMat, idx, ud, isGlb) {
  if (!originalMat) return null;
  if (Array.isArray(originalMat)) return originalMat.map(m => _applyPreviewParams(m, idx, ud, isGlb));
  return _applyPreviewParams(originalMat, idx, ud, isGlb);
}

function _buildBuiltinPreviewMat(idx, ud, deps) {
  const m = deps.plasterMat.clone();
  if (m.color) m.color.set(ud.customColor || '#e8e8e8');
  m.roughness = (ud.shape === 'sphere' && idx === 0) ? 0.6 : SOLID_MAT_ROUGHS[idx];
  m.metalness = SOLID_MAT_METALS[idx];
  m.transmission = SOLID_MAT_TRANS[idx];
  m.transparent = SOLID_MAT_TRANS[idx] > 0;
  m.ior = 1.5;
  if (ud.isFlat) m.flatShading = true;
  return m;
}

function _resolveNextMaterial(child, matTypeVal, deps) {
  const ud = child.userData || {};
  const isGlb = deps.isUnderGlbRoot(child);
  const orig = ud.originalMaterial;
  const matNorm = normalizeSolidMatType(matTypeVal);
  if (matNorm === 'origin') {
    if (orig) return orig;
    if (isGlb) {
      deps.stampMeshOriginal(child);
      if (child.userData.originalMaterial) return child.userData.originalMaterial;
      return child.material;
    }
    return _buildBuiltinOriginMat(ud, deps);
  }
  const idx = parseInt(matNorm, 10);
  if (isGlb) {
    const fromOrig = _buildPreviewFromOriginal(orig, idx, ud, true);
    if (fromOrig) return fromOrig;
    return _buildBuiltinPreviewMat(idx, ud, deps);
  }
  return _buildBuiltinPreviewMat(idx, ud, deps);
}

export function applySolidMaterialToRoot(root, matTypeVal, deps) {
  if (!root || !root.traverse || !deps) return;
  const matNorm = normalizeSolidMatType(matTypeVal);
  const _updates = [];
  root.traverse(child => {
    if (!child.isMesh) return;
    if (child.userData && child.userData.solidShadowCore) return;
    if (child.userData && child.userData.isFrame) return;
    const prevMat = child.material;
    const nextMat = _resolveNextMaterial(child, matNorm, deps);
    if (!deps.materialRefEqual(prevMat, nextMat)) {
      _updates.push({ child, prevMat, nextMat, originalMat: child.userData && child.userData.originalMaterial });
    }
  });
  for (let ui = 0; ui < _updates.length; ui++) {
    const u = _updates[ui];
    u.child.material = u.nextMat;
    if (_shouldDisposeReplaced(u.prevMat, u.originalMat, deps) && deps.safeDispose) deps.safeDispose(u.prevMat);
  }
}

export function applySolidMaterialToSceneGroup(group, getMatForRoot, deps) {
  if (!group || !group.children || !deps) return;
  for (let i = 0; i < group.children.length; i++) {
    const root = group.children[i];
    const mat = getMatForRoot(root, i);
    if (mat != null) applySolidMaterialToRoot(root, mat, deps);
  }
}

export function applySolidMaterialsFromSceneItems(group, items, envDefaultMat, deps) {
  if (!group || !group.children || !deps) return;
  const envMat = envDefaultMat;
  for (let i = 0; i < group.children.length; i++) {
    const root = group.children[i];
    const item = items && items[i] ? items[i] : {};
    const mat = resolveSolidItemEffectiveMat(item, envMat);
    if (!root.userData) root.userData = {};
    root.userData.matType = mat;
    applySolidMaterialToRoot(root, mat, deps);
  }
}
