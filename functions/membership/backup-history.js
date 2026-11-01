/**
 * 运营台可见的备份摘要（不含密文）。
 * KV：ops:backup_history → { updatedAt, entries: [...] }
 */
const HISTORY_KEY = 'ops:backup_history';
const MAX_ENTRIES = 40;

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

/** 给运营台展示的固定说明（路径在开发机，不在 CDN） */
export function backupStorageHints() {
  return {
    localDir: '历史备份文件/membership-kv/',
    keyFile: '历史备份文件/membership-kv/_backup.key',
    portalBat: '自用工具文件_不部署/0_Portal/24_备份正式站会员KV.bat',
    autoOnProdDeploy: true,
    skipEnv: 'SKIP_KV_BACKUP=1',
    requireEnv: 'REQUIRE_KV_BACKUP=1',
    note:
      '加密备份文件在本机仓库目录（已 gitignore），不在网站服务器上。运营台只显示备份摘要记录；解密需本机钥文件。'
  };
}

export async function loadBackupHistory(env) {
  const store = kv(env);
  const hints = backupStorageHints();
  if (!store) {
    return { ok: true, entries: [], hints: hints, tip: '未开通 MEMBERSHIP_KV' };
  }
  try {
    const raw = await store.get(HISTORY_KEY);
    if (!raw) return { ok: true, entries: [], hints: hints };
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
    return {
      ok: true,
      entries: entries,
      updatedAt: parsed && parsed.updatedAt ? parsed.updatedAt : null,
      hints: hints
    };
  } catch (_e) {
    return { ok: true, entries: [], hints: hints, tip: '备份记录读取失败' };
  }
}

export { HISTORY_KEY, MAX_ENTRIES };
