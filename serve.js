const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const HTTPS_PORT = 8443;
const DIR = path.resolve(__dirname, '..');

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

function handler(req, res) {
  // === POST /save?path=... — write request body to file at DIR + path ===
  // Used by the editor's Export feature to bypass Chrome's File System Access API
  // (which fails with InvalidStateError when the file is being read by another tab,
  // e.g. the Quest browser streaming the file via this same server).
  if (req.method === 'POST' && req.url.startsWith('/save?')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    try {
      const qs = req.url.slice(req.url.indexOf('?') + 1);
      const params = Object.fromEntries(new URLSearchParams(qs));
      const relPath = decodeURIComponent(params.path || '');
      if (!relPath) { res.writeHead(400); res.end('Missing path'); return; }
      const target = path.resolve(DIR, relPath.replace(/^[/\\]+/, ''));
      // Security: path must stay inside DIR
      if (!target.startsWith(DIR + path.sep) && target !== DIR) {
        res.writeHead(403); res.end('Path outside server root'); return;
      }
      // Ensure parent directory exists
      const parent = path.dirname(target);
      try { fs.mkdirSync(parent, { recursive: true }); } catch(e) {}
      // Collect body
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          fs.writeFileSync(target, Buffer.concat(chunks));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: relPath, bytes: chunks.reduce((n, c) => n + c.length, 0) }));
        } catch (e) {
          res.writeHead(500); res.end('Write failed: ' + e.message);
        }
      });
      req.on('error', e => { res.writeHead(500); res.end('Request error: ' + e.message); });
    } catch (e) { res.writeHead(500); res.end('Server error: ' + e.message); }
    return;
  }
  // CORS preflight for /save
  if (req.method === 'OPTIONS' && req.url.startsWith('/save')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204); res.end(); return;
  }

  // Root shows file listing with editor link
  if (req.url === '/' || req.url === '') {
    const files = [];
    function scanRoot(dir, prefix) {
      try {
        fs.readdirSync(dir).forEach(f => {
          const full = path.join(dir, f);
          try {
            if (fs.statSync(full).isDirectory()) scanRoot(full, prefix ? prefix + '/' + f : f);
            else if (f.endsWith('.html') && f !== 'vr-tour-editor.html') files.push(prefix ? prefix + '/' + f : f);
          } catch(e) {}
        });
      } catch(e) {}
    }
    scanRoot(DIR, '');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body style="font-family:sans-serif;background:#222;color:#fff;padding:40px">
      <h1 style="color:#ff7a00">oYmer VR Tour Server</h1>
      <a href="/VR%20Tour%20App/vr-tour-editor.html" style="color:#00f0ff;font-size:20px;font-weight:bold">&#9998; Open Editor</a>
      <h2 style="margin-top:30px">Tour Files</h2>
      <ul>${files.map(f => '<li style="margin:10px 0"><a href="/' + f.split('/').map(s => encodeURIComponent(s)).join('/') + '" style="color:#ff7a00;font-size:18px">' + f + '</a></li>').join('')}</ul>
    </body></html>`);
    return;
  }
  // Backward compat: /vr-tour-editor.html → /VR Tour App/vr-tour-editor.html
  if (req.url === '/vr-tour-editor.html') {
    res.writeHead(302, { 'Location': '/VR%20Tour%20App/vr-tour-editor.html' });
    res.end();
    return;
  }
  // Short alias: /test → latest tour for Quest 3 VR testing
  if (req.url === '/test') {
    res.writeHead(302, { 'Location': '/ARMON%20Dir%20El%20Asad/%E2%80%8F%D7%9E%D7%A8%D7%9B%D7%96%20%D7%99%D7%95%D7%9D%20%D7%9C%D7%A7%D7%A9%D7%99%D7%A9%20%D7%93%D7%99%D7%A8%20%D7%90%D7%9C%20%D7%90%D7%A1%D7%93%2026-5.html' });
    res.end();
    return;
  }
  let filePath = path.join(DIR, decodeURIComponent(req.url));

  if (!fs.existsSync(filePath)) {
    if (req.url === '/tours') {
      const files = [];
      function scan(dir, prefix) {
        try {
          fs.readdirSync(dir).forEach(f => {
            const full = path.join(dir, f);
            try {
              if (fs.statSync(full).isDirectory()) scan(full, prefix ? prefix + '/' + f : f);
              else if (f.endsWith('.html')) files.push(prefix ? prefix + '/' + f : f);
            } catch(e) {}
          });
        } catch(e) {}
      }
      scan(DIR, '');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;background:#222;color:#fff;padding:40px">
        <h1>VR Tour Files</h1>
        <ul>${files.map(f => `<li style="margin:10px 0"><a href="/${f.split('/').map(s => encodeURIComponent(s)).join('/')}" style="color:#ff7a00;font-size:18px">${f}</a></li>`).join('')}</ul>
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
}

const nets = os.networkInterfaces();
const ip = Object.values(nets).flat().find(n => n.family === 'IPv4' && !n.internal);
const lanIP = ip ? ip.address : 'YOUR_IP';

// HTTP server (flat viewing)
http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  VR Tour Server running!`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Quest 3:  http://${lanIP}:${PORT}  (flat only)`);
});

// HTTPS server (WebXR requires HTTPS)
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
  https.createServer(options, handler).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`  Quest VR: https://${lanIP}:${HTTPS_PORT}  (VR mode!)`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Use the HTTPS URL on Quest for Enter VR button\n`);
  });
} else {
  console.log(`  ─────────────────────────────────`);
  console.log(`  No cert.pem/key.pem found — HTTPS disabled`);
  console.log(`  WebXR (Enter VR) won't work over HTTP\n`);
}
