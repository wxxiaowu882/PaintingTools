#!/usr/bin/env node
/**
 * 生成正式兑换码（HMAC，与 functions/membership/codes.js 一致）
 *
 * 用法：
 *   set MEMBERSHIP_SECRET=你的密钥
 *   node 自用工具文件_不部署/membership/gen-redeem-code.mjs --tier member_3m
 *   node ... --tier member_1y --count 5
 *   node ... --tier member_forever --code-days 60
 *
 * 档位：member_3m (90天会员) / member_1y (365) / member_forever (永久)
 * --code-days：兑换码本身多久内可兑（默认 30）
 */
import crypto from 'crypto';

const TIERS = {
  member_3m: { durationDays: 90 },
  member_1y: { durationDays: 365 },
  member_forever: { durationDays: null }
};

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signPayload(obj, secret) {
  const body = b64url(Buffer.from(JSON.stringify(obj), 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(body).digest();
  return body + '.' + b64url(sig);
}

function parseArgs(argv) {
  const out = { tier: 'member_3m', count: 1, codeDays: 30 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tier') out.tier = argv[++i];
    else if (a === '--count') out.count = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--code-days') out.codeDays = Math.max(1, parseInt(argv[++i], 10) || 30);
  }
  return out;
}

const secret = process.env.MEMBERSHIP_SECRET || '';
if (!secret || secret.length < 16) {
  console.error('请设置环境变量 MEMBERSHIP_SECRET（至少 16 字符），并与 Cloudflare Pages 密钥一致。');
  process.exit(1);
}

const args = parseArgs(process.argv);
const tierDef = TIERS[args.tier];
if (!tierDef) {
  console.error('未知档位', args.tier, '可选', Object.keys(TIERS).join(', '));
  process.exit(1);
}

const now = Date.now();
const codes = [];
for (let i = 0; i < args.count; i++) {
  const payload = {
    v: 1,
    tierId: args.tier,
    durationDays: tierDef.durationDays,
    jti: crypto.randomUUID(),
    nbf: now,
    exp: now + args.codeDays * 86400000
  };
  codes.push('WXM1.' + signPayload(payload, secret));
}

console.log(JSON.stringify({
  tier: args.tier,
  durationDays: tierDef.durationDays,
  codeExpiresInDays: args.codeDays,
  codes
}, null, 2));
