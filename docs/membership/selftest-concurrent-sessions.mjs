/**
 * 本地自测：设备白名单 ≤3 + 同时在线 ≤2（不连 KV / 不发站）
 * 用法：node docs/membership/selftest-concurrent-sessions.mjs
 */
import {
  touchDevice,
  touchSession,
  deviceAllowed,
  sessionAllowed,
  MAX_DEVICES,
  MAX_CONCURRENT_SESSIONS
} from '../../functions/membership/accounts.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

function blankAcct() {
  return {
    accountId: 'acct-test',
    phone: '19900001111',
    devices: [],
    activeSessions: []
  };
}

function run() {
  assert(MAX_DEVICES === 3, 'MAX_DEVICES');
  assert(MAX_CONCURRENT_SESSIONS === 2, 'MAX_CONCURRENT_SESSIONS');

  const A = 'deviceAAA01';
  const B = 'deviceBBB02';
  const C = 'deviceCCC03';
  const D = 'deviceDDD04';

  // --- 同时在线：第 3 处踢最老 ---
  let acct = blankAcct();
  assert(touchDevice(acct, A, 'phone').ok);
  assert(touchSession(acct, A).ok);
  assert(sessionAllowed(acct, A));

  assert(touchDevice(acct, B, 'pad').ok);
  const sB = touchSession(acct, B);
  assert(sB.ok && !sB.kickedSessionDeviceId);
  assert(sessionAllowed(acct, A) && sessionAllowed(acct, B));

  assert(touchDevice(acct, C, 'pc').ok);
  // 预填：A、B 已在会话表；C 进入应踢最老（A，因 B 后登录更「新」——实际按 lastActiveAt）
  // 先让 A 更旧：再次 touch B 刷新 B
  touchSession(acct, B);
  const sC = touchSession(acct, C);
  assert(sC.ok, 'touchSession C');
  assert(sC.kickedSessionDeviceId === A, 'should kick A, got ' + sC.kickedSessionDeviceId);
  assert(!sessionAllowed(acct, A), 'A session kicked');
  assert(sessionAllowed(acct, B) && sessionAllowed(acct, C), 'B+C online');
  // 设备白名单仍保留 A
  assert(deviceAllowed(acct, A), 'A still on device whitelist');

  // --- 设备白名单：第 4 台踢设备（与会话分开）---
  acct = blankAcct();
  touchDevice(acct, A, '1');
  touchDevice(acct, B, '2');
  touchDevice(acct, C, '3');
  const dD = touchDevice(acct, D, '4');
  assert(dD.ok && dD.kickedDeviceId === A, '4th device kicks A');
  assert(!deviceAllowed(acct, A));
  assert(deviceAllowed(acct, B) && deviceAllowed(acct, C) && deviceAllowed(acct, D));

  // --- 迁移预填：已有 3 设备、无会话表时，登录第 4 逻辑前先预填最近 2 ---
  acct = {
    accountId: 'acct-mig',
    devices: [
      { deviceId: A, lastSeenAt: 100, boundAt: 100 },
      { deviceId: B, lastSeenAt: 200, boundAt: 200 },
      { deviceId: C, lastSeenAt: 300, boundAt: 300 }
    ]
    // 无 activeSessions
  };
  const mig = touchSession(acct, C);
  assert(mig.ok && !mig.kickedSessionDeviceId, 'seed should include C');
  assert(acct.activeSessions.length === 2, 'seeded to 2');
  assert(sessionAllowed(acct, B) && sessionAllowed(acct, C));
  assert(!sessionAllowed(acct, A), 'oldest A not in seeded sessions');

  console.log('selftest-concurrent-sessions: PASS');
}

try {
  run();
} catch (e) {
  console.error('selftest-concurrent-sessions: FAIL', e && e.message ? e.message : e);
  process.exit(1);
}
