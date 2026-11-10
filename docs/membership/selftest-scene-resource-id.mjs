/**
 * 场景权限 ID：模块+uid 主键 + name 双读
 * node docs/membership/selftest-scene-resource-id.mjs
 */
import {
  sceneResourceId,
  sceneResourceIds,
  resourceRequire,
  resourceRequireAny
} from '../../functions/membership/policy.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
}

assert(
  sceneResourceId('geometrysketch', { uid: '2000', name: '【几何体写生】球体' }) ===
    'scene:geometrysketch:uid:2000',
  '有 uid 时主键用 uid'
);
assert(
  sceneResourceId('anatomy', { name: '头骨详解' }) === 'scene:anatomy:name:头骨详解',
  '无 uid 回退 name'
);
assert(
  JSON.stringify(sceneResourceIds('headform', { uid: '001', name: '【外轮廓规律】正面' })) ===
    JSON.stringify([
      'scene:headform:uid:001',
      'scene:headform:name:【外轮廓规律】正面'
    ]),
  '双读候选 uid 优先'
);

const policy = {
  defaultRequire: 'public',
  resources: {
    'scene:headform:name:【外轮廓规律】正面': { require: 'member', enabled: true },
    'scene:geometrysketch:uid:2000': { require: 'user', enabled: true }
  }
};

assert(
  resourceRequireAny(policy, sceneResourceIds('headform', { uid: '007', name: '【外轮廓规律】正面' })) ===
    'member',
  'headform 无专属 uid 键时回落到同名 name 键'
);
assert(
  resourceRequire(policy, 'scene:geometrysketch:uid:2000') === 'user',
  '写生台 uid 键可读'
);
assert(
  resourceRequireAny(policy, ['scene:geometrysketch:uid:9999', 'scene:geometrysketch:name:不存在']) ===
    'public',
  '皆无则 defaultRequire'
);

if (failed) {
  console.error('\nselftest-scene-resource-id: ' + failed + ' failed');
  process.exit(1);
}
console.log('\nselftest-scene-resource-id: all passed');
