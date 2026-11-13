// Local web server for the CRM dashboard: serves the UI and a JSON API on 127.0.0.1 only.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('./logic');
const { COLLECTIONS } = require('./store');

const UI_DIR = path.join(__dirname, '..', '..', 'crm-ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function startCrmServer({ store, port = 4747, onAction = () => {}, assetsDir }) {
  const sseClients = new Set();
  store.onChange((ev) => { const line = `data: ${JSON.stringify(ev)}\n\n`; for (const res of sseClients) { try { res.write(line); } catch (_) {} } });

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let buf = ''; req.on('data', (c) => { buf += c; if (buf.length > 20 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });

  async function api(req, res, url) {
    // A custom header forces a CORS preflight, which blocks writes from other websites open in the browser.
    if (req.method !== 'GET' && req.headers['x-aurelium-crm'] !== '1') return json(res, 403, { error: 'Missing X-Aurelium-CRM header' });
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const [col, id, sub] = parts;
    const by = store.config.ownerName || 'Juan';

    if (req.method === 'GET' && col === 'bootstrap') {
      const leads = store.list('leads').map(l => ({ ...l, flags: L.flags(store, l), lastActivityAt: L.lastActivityAt(store, l) }));
      return json(res, 200, { leads, activities: store.list('activities'), appointments: store.list('appointments'), proposals: store.list('proposals'), invoices: store.list('invoices'), tasks: store.list('tasks'), projects: store.list('projects'), config: store.config, summary: L.summary(store), today: L.dueToday(store), stages: L.STAGES, stageNames: Object.fromEntries(L.STAGES.map(s => [s, L.stageName(store, s)])) });
    }
    if (req.method === 'GET' && col === 'summary') return json(res, 200, L.summary(store));
    if (req.method === 'GET' && col === 'export') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="aurelium-crm-export-${new Date().toISOString().slice(0, 10)}.json"` }); return res.end(JSON.stringify(store.exportBundle(), null, 1)); }
    if (req.method === 'GET' && col === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('data: {"kind":"hello"}\n\n'); sseClients.add(res); req.on('close', () => sseClients.delete(res)); return;
    }
    const body = req.method === 'GET' ? {} : await readBody(req);
    if (req.method === 'POST' && col === 'import') { const report = store.importBundle(body.bundle || body, { overwrite: !!body.overwrite }); onAction(`Imported CRM data: ${Object.entries(report).map(([k, v]) => `${k} +${v.added}`).join(', ')}`); return json(res, 200, { report }); }
    if (req.method === 'POST' && col === 'config') return json(res, 200, store.setConfig(body));

    if (col === 'leads') {
      if (req.method === 'POST' && !id) { const lead = L.createLead(store, body, by); onAction(`CRM: new lead ${lead.business}`); return json(res, 201, lead); }
      if (req.method === 'PATCH' && id && !sub) { const lead = L.updateLead(store, id, body, by); return json(res, 200, lead); }
      if (req.method === 'POST' && id && sub === 'stage') { const lead = L.setStage(store, id, body.stage, { by, reason: body.reason || '' }); onAction(`CRM: ${lead.business} → ${L.stageName(store, lead.stage)}`); return json(res, 200, lead); }
      if (req.method === 'POST' && id && sub === 'activity') { const a = L.logActivity(store, { leadId: id, type: body.type, text: body.text, by, extra: body.extra || {} }); return json(res, 201, a); }
      if (req.method === 'GET' && id) { const lead = store.get('leads', id); return lead ? json(res, 200, { ...lead, flags: L.flags(store, lead), activities: store.list('activities').filter(a => a.leadId === id).sort((a, b) => (b.at || '').localeCompare(a.at || '')) }) : json(res, 404, { error: 'Not found' }); }
      if (req.method === 'GET' && !id) return json(res, 200, L.searchLeads(store, url.searchParams.get('q') || '', { stage: url.searchParams.get('stage') || undefined, limit: Number(url.searchParams.get('limit')) || 50 }));
    }
    if (['tasks', 'appointments', 'proposals', 'invoices', 'projects'].includes(col)) {
      if (req.method === 'POST' && !id) { const d = store.insert(col, body); onAction(`CRM: ${col.slice(0, -1)} added${d.title ? `: ${d.title}` : ''}`); return json(res, 201, d); }
      if (req.method === 'PATCH' && id) return json(res, 200, store.update(col, id, body));
      if (req.method === 'DELETE' && id && col === 'tasks') return json(res, 200, { removed: store.remove(col, id) });
    }
    return json(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      // Static UI
      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      let base = UI_DIR;
      if (file.startsWith('/assets/') && assetsDir) { base = assetsDir; file = file.slice('/assets'.length); }
      const abs = path.resolve(base, '.' + file);
      if (!abs.startsWith(base) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(abs).pipe(res);
    } catch (err) {
      json(res, err.message && /not found/i.test(err.message) ? 404 : 400, { error: err.message });
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${port}`, close: () => server.close() }));
  });
}

module.exports = { startCrmServer };
