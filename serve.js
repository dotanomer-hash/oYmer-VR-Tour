const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Generate self-signed certificate on the fly
function generateCert() {
  const { generateKeyPairSync, createSign, X509Certificate } = crypto;
  // Use Node's built-in TLS with a self-signed cert via openssl-like approach
  // Fallback: just use HTTP if crypto doesn't support x509
  return null;
}

// Simple HTTP server (Quest 3 browser actually supports WebXR over HTTP on local network!)
const PORT = 8080;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(DIR, decodeURIComponent(req.url === '/' ? '/index.html' : req.url));

  if (!fs.existsSync(filePath)) {
    // List directory if it's a folder
    if (req.url === '/' || req.url === '') {
      const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;background:#222;color:#fff;padding:40px">
        <h1>VR Tour Files</h1>
        <ul>${files.map(f => `<li style="margin:10px 0"><a href="/${f}" style="color:#ff7a00;font-size:18px">${f}</a></li>`).join('')}</ul>
      </body></html>`);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': mime,
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  VR Tour Server running!`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Quest 3: http://10.100.102.5:${PORT}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Open the Quest 3 URL above in Quest browser\n`);
});
