/**
 * 将 GLB 顶点平移到：底部贴 y=0，水平中心在 xz=0（不改朝向）
 * 用法：node scripts/recenter-glb-ground.js <in.glb> [out.glb]
 */
'use strict';

const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

const inPath = process.argv[2];
const outPath = process.argv[3] || inPath;
if (!inPath) {
  console.error('usage: node scripts/recenter-glb-ground.js <in.glb> [out.glb]');
  process.exit(1);
}

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.resolve(inPath));
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  const attrSet = new Set();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      attrSet.add(pos);
      for (let i = 0; i < arr.length; i += 3) {
        min[0] = Math.min(min[0], arr[i]);
        max[0] = Math.max(max[0], arr[i]);
        min[1] = Math.min(min[1], arr[i + 1]);
        max[1] = Math.max(max[1], arr[i + 1]);
        min[2] = Math.min(min[2], arr[i + 2]);
        max[2] = Math.max(max[2], arr[i + 2]);
      }
    }
  }
  const attrs = Array.from(attrSet);
  if (!attrs.length || !Number.isFinite(min[0])) {
    console.error('no POSITION');
    process.exit(1);
  }
  const dx = -((min[0] + max[0]) / 2);
  const dy = -min[1];
  const dz = -((min[2] + max[2]) / 2);
  for (const pos of attrs) {
    const arr = pos.getArray();
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += dx;
      arr[i + 1] += dy;
      arr[i + 2] += dz;
    }
    pos.setArray(arr);
  }
  // 清掉节点平移，避免二次偏移（保留旋转/缩放）
  for (const node of doc.getRoot().listNodes()) {
    const t = node.getTranslation();
    if (t && (t[0] || t[1] || t[2])) node.setTranslation([0, 0, 0]);
  }
  await io.write(path.resolve(outPath), doc);
  console.log(JSON.stringify({
    in: inPath,
    out: outPath,
    before: { min, max },
    shift: [dx, dy, dz],
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
