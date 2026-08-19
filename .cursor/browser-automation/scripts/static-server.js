const http = require('http');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm'
};

function resolvePath(urlPath) {
  let pathname = decodeURIComponent((urlPath || '/').split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const cleaned = pathname.replace(/^\/+/, '');
  let absolutePath = path.resolve(repoRoot, cleaned);

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    const htmlCandidate = path.join(absolutePath, 'index.html');
    if (fs.existsSync(htmlCandidate)) absolutePath = htmlCandidate;
  } else if (!fs.existsSync(absolutePath) && !path.extname(absolutePath)) {
    const htmlCandidate = `${absolutePath}.html`;
    if (fs.existsSync(htmlCandidate)) absolutePath = htmlCandidate;
  }

  if (!absolutePath.startsWith(repoRoot)) return null;
  return absolutePath;
}

const server = http.createServer((req, res) => {
  try {
    const filePath = resolvePath(req.url);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error.message}`);
  }
});

server.listen(port, () => {
  console.log(`Browser automation static server running at http://localhost:${port}`);
  console.log(`Serving repo root: ${repoRoot}`);
});
