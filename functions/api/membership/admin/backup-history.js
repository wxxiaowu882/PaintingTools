import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { loadBackupHistory } from '../../../membership/backup-history.js';

/** GET：备份摘要列表 + 本机存储路径说明 */
export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  const result = await loadBackupHistory(context.env);
  return jsonResponse(result);
}
