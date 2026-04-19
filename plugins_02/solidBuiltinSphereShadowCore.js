/**
 * 内置球（SphereGeometry 半径 2）同心阴影核：略小内球仅 castShadow，配合 SolidPreviewLighting 对 solidShadowCore 的跳过逻辑，减轻接触区亮斑。
 * @param {import('three').Object3D} parentMesh - 外球根节点（通常为 Mesh）
 * @param {typeof import('three')} THREE
 * @param {{ outerRadius?: number, innerScale?: number }} [opts]
 */
export function attachSolidBuiltinSphereShadowCore(parentMesh, THREE, opts) {
  if (!parentMesh || !THREE) return;
  try {
    const outerR = opts && Number(opts.outerRadius) > 0 ? Number(opts.outerRadius) : 2.0;
    const innerScale = opts && Number(opts.innerScale) > 0 ? Number(opts.innerScale) : 0.99;
    const innerR = outerR * Math.max(0.5, Math.min(1, innerScale));
    const innerGeo = new THREE.SphereGeometry(innerR, 48, 48);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      depthTest: true,
    });
    try {
      innerMat.colorWrite = false;
    } catch (_cw) {}
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.userData = { type: 'builtinInnerOccluder', solidShadowCore: true };
    inner.castShadow = true;
    inner.receiveShadow = false;
    parentMesh.add(inner);
  } catch (_e) {}
}
