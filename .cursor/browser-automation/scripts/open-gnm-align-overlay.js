/**
 * 打开叠显页供人工确认（需 serve:repo 已在 18080 运行）
 * npm run open:gnm-align-overlay
 */
const { execSync } = require('child_process');
const http = require('http');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/?v=20260828-warp6&t=' +
  Date.now();

function ping(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', timeout: 3000 },
      (res) => resolve(res.statusCode === 200)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function main() {
  const ok = await ping(PAGE.split('?')[0]);
  if (!ok) {
    console.error('18080 未响应。请先运行: npm run serve:repo');
    process.exit(1);
  }
  console.log('Opening:', PAGE);
  if (process.platform === 'win32') {
    execSync(`cmd.exe /c start "" "${PAGE}"`, { stdio: 'inherit' });
  } else if (process.platform === 'darwin') {
    execSync(`open "${PAGE}"`, { stdio: 'inherit' });
  } else {
    execSync(`xdg-open "${PAGE}"`, { stdio: 'inherit' });
  }
  console.log('已在系统浏览器打开叠显页，请人工确认。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
