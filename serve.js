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

  // Root shows clean Quest-friendly picker of exported tours
  if (req.url === '/' || req.url === '') {
    const EXCLUDE = [
      /^vr-tour-editor/i,
      /^index/i,
      /^vr-test/i,
      /WORKING.?BACKUP/i,
      /BUGGY/i,
      /BEFORE.?RESTORE/i,
      /node_modules/i,
      /^\.git/i,
    ];
    const isExcluded = (name, rel) => EXCLUDE.some(p => p.test(name) || p.test(rel));
    const files = [];
    function scanRoot(dir, prefix) {
      try {
        fs.readdirSync(dir).forEach(f => {
          const rel = prefix ? prefix + '/' + f : f;
          if (isExcluded(f, rel)) return;
          const full = path.join(dir, f);
          try {
            const st = fs.statSync(full);
            if (st.isDirectory()) scanRoot(full, rel);
            else if (f.endsWith('.html')) files.push({ rel, mtime: st.mtimeMs, size: st.size });
          } catch(e) {}
        });
      } catch(e) {}
    }
    scanRoot(DIR, '');
    files.sort((a, b) => b.mtime - a.mtime);
    const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const formatBytes = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB';
    const formatDate = ms => {
      const d = new Date(ms);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const listHtml = files.map(f => {
      const sizeStr = formatBytes(f.size);
      const dateStr = formatDate(f.mtime);
      const href = '/' + f.rel.split('/').map(s => encodeURIComponent(s)).join('/');
      const name = f.rel.split('/').pop();
      const folder = f.rel.includes('/') ? f.rel.substring(0, f.rel.lastIndexOf('/')) : '';
      return `<a class="tour" href="${href}">
        <div class="name">${escapeHtml(name)}</div>
        <div class="meta">${folder ? escapeHtml(folder) + ' &nbsp;•&nbsp; ' : ''}${sizeStr} &nbsp;•&nbsp; ${dateStr}</div>
      </a>`;
    }).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>oYmer VR Tours</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0a0a14; color:#fff; padding:24px; margin:0; max-width:900px; margin:0 auto; }
  h1 { color:#ff7a00; font-size:32px; margin:0 0 20px; }
  .editor-link { display:inline-block; background:#00f0ff; color:#000; padding:16px 26px; border-radius:10px; text-decoration:none; font-weight:bold; font-size:20px; margin-bottom:28px; }
  .editor-link:hover { background:#00d0e0; }
  h2 { color:#888; font-size:18px; margin:28px 0 14px; font-weight:normal; }
  .tour { display:block; background:#1a1a2a; border:1px solid #2a2a40; padding:20px 22px; margin:10px 0; border-radius:12px; text-decoration:none; color:#fff; transition: background .15s; }
  .tour:hover, .tour:active { background:#ff7a00; border-color:#ff7a00; }
  .tour .name { font-size:20px; font-weight:bold; color:#ff7a00; word-break:break-word; line-height:1.3; }
  .tour:hover .name, .tour:active .name { color:#fff; }
  .tour .meta { font-size:14px; color:#888; margin-top:8px; }
  .tour:hover .meta, .tour:active .meta { color:#ffe2cc; }
  .empty { color:#666; font-style:italic; padding:20px; }
</style></head><body>
  <h1>oYmer VR Tours</h1>
  <a class="editor-link" href="/VR%20Tour%20App/vr-tour-editor.html">&#9998; Open Editor</a>
  <h2>Exported tours &mdash; newest first (${files.length})</h2>
  ${listHtml || '<div class="empty">No exported tours found.</div>'}
</body></html>`);
    return;
  }
  // Backward compat: /vr-tour-editor.html → /VR Tour App/vr-tour-editor.html
  if (req.url === '/vr-tour-editor.html') {
    res.writeHead(302, { 'Location': '/VR%20Tour%20App/vr-tour-editor.html' });
    res.end();
    return;
  }
  // Short alias: /test → tour picker (was: auto-redirect to ARMON tour)
  if (req.url === '/test') {
    res.writeHead(302, { 'Location': '/' });
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
const ipv4List = [];
for (const [name, addrs] of Object.entries(nets)) {
  for (const a of addrs) {
    if (a.family === 'IPv4' && !a.internal) ipv4List.push({ name, address: a.address });
  }
}
const lanIP = (ipv4List[0] || {}).address || 'YOUR_IP';

// HTTP server (flat viewing)
http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  VR Tour Server running!`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Local:    http://localhost:${PORT}`);
});

// HTTPS server (WebXR requires HTTPS)
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');
const httpsEnabled = fs.existsSync(certPath) && fs.existsSync(keyPath);

if (httpsEnabled) {
  const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
  https.createServer(options, handler).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`  Local:    https://localhost:${HTTPS_PORT}  (VR mode)`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Pick whichever IP your Quest can reach:`);
    if (ipv4List.length === 0) {
      console.log(`    (no non-internal IPv4 interfaces found)`);
    } else {
      for (const { name, address } of ipv4List) {
        console.log(`    https://${address}:${HTTPS_PORT}   [${name}]`);
      }
    }
    console.log(`  ─────────────────────────────────`);
    console.log(`  Use the HTTPS URL on Quest for Enter VR button\n`);
  });
} else {
  console.log(`  ─────────────────────────────────`);
  console.log(`  No cert.pem/key.pem found — HTTPS disabled`);
  console.log(`  WebXR (Enter VR) won't work over HTTP`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  HTTP IPs (flat viewing only):`);
  for (const { name, address } of ipv4List) {
    console.log(`    http://${address}:${PORT}   [${name}]`);
  }
  console.log(``);
}
