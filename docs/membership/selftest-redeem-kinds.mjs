/**
 * 权益兑换 · 纯函数冒烟（不连 KV）
 * 运行：node docs/membership/selftest-redeem-kinds.mjs
 */
import {
  normalizeRedeemKind,
  normalizeProductUnlocks,
  unlockCoversResource,
  accountHasProductUnlock,
  SKETCH_PRODUCTS
} from '../../functions/membership/product-unlocks.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
}

assert(normalizeRedeemKind('') === 'pro', '空 kind → pro');
assert(normalizeRedeemKind('COURSE') === 'course', 'COURSE → course');
assert(normalizeRedeemKind('sketch') === 'sketch', 'sketch');
assert(!!SKETCH_PRODUCTS['sandbox:geometrysketch'], '有几何写生产品');
assert(!!SKETCH_PRODUCTS['sandbox:portrait'], '有肖像写生产品');

const unlocks = normalizeProductUnlocks([
  { productId: 'sandbox:geometrysketch', title: '几何' },
  { productId: 'sandbox:geometrysketch' },
  'sandbox:portrait'
]);
assert(unlocks.length === 2, '解锁去重');
assert(accountHasProductUnlock(unlocks, 'sandbox:portrait'), 'has portrait');
assert(
  unlockCoversResource(unlocks, 'scene:geometrysketch:uid:2000'),
  '盖过 geometrysketch 场景（uid 键）'
);
assert(
  unlockCoversResource(unlocks, 'scene:geometrysketch:name:【几何体写生】球体'),
  '盖过 geometrysketch 场景（旧 name 键仍可识别模块）'
);
assert(
  !unlockCoversResource(unlocks, 'scene:geometry:uid:001'),
  '不盖过未购 geometry 库'
);
assert(
  !unlockCoversResource(unlocks, 'ui:solid:mod:atmos'),
  '不盖过控制条模块（≠ 整站 Pro）'
);

if (failed) {
  console.error('\nselftest-redeem-kinds: ' + failed + ' failed');
  process.exit(1);
}
console.log('\nselftest-redeem-kinds: all passed');
