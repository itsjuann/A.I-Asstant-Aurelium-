// The second brain: an Obsidian vault on disk. Finds or creates it, builds the folder
// structure, and offers safe, append-only note operations. Nothing here deletes or overwrites.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const FOLDERS = ['00 Inbox', '01 Daily', '02 Companies', '03 Clients & Leads', '04 SOPs', '05 Ideas', '06 People', '07 Resources', '99 Archive'];
const COMPANIES = {
  'Aurelium Motion': 'AI growth agency selling AI receptionists to local businesses.',
  'PeakHive': 'Shopify store, home goods.',
  'Eccellenti': 'Streetwear brand.',
  'Vorynx Lab': 'SaaS for personal trainers.'
};

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const longDate = (d = new Date()) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeNow = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const safeName = (s) => String(s).replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);

// ---------- Discovery ----------
function findExistingVaults(home = os.homedir()) {
  const roots = [
    home,
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents'),
    path.join(home, 'OneDrive'), path.join(home, 'Dropbox'), path.join(home, 'Google Drive')
  ];
  const found = new Set();
  const visit = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    if (entries.some(e => e.isDirectory() && e.name === '.obsidian')) { found.add(dir); return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || ['node_modules', 'Library', 'Applications'].includes(e.name)) continue;
      visit(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) if (fs.existsSync(r)) visit(r, 0);
  return [...found];
}

// ---------- Templates ----------
function templates() {
  const t = {};
  t['Home.md'] = `# AURELIUM Brain

Welcome, Juan. This vault is AURELIUM's memory. She searches it before answering anything about your businesses, files what you ask her to remember, and writes a daily note every day.

## Map
- [[00 Inbox/Inbox|Inbox]]: things to sort later
- [[01 Daily/${dateKey()}|Today's daily note]]
- Companies: [[02 Companies/Aurelium Motion|Aurelium Motion]] · [[02 Companies/PeakHive|PeakHive]] · [[02 Companies/Eccellenti|Eccellenti]] · [[02 Companies/Vorynx Lab|Vorynx Lab]]
- [[03 Clients & Leads/Clients & Leads|Clients & Leads]]
- [[04 SOPs/SOPs|SOPs]]
- [[05 Ideas/Ideas|Ideas]]
- [[06 People/People|People]]
- [[07 Resources/Resources|Resources]]

## How to use it with AURELIUM
- "Remember this: ..." files a note in the right folder.
- "Brain dump" then talk; she files organised notes.
- "What do we know about ..." searches here first.
`;
  t['00 Inbox/Inbox.md'] = `# Inbox\n\nUnsorted captures land here. AURELIUM files things here when she is unsure where they belong. Review weekly and move notes into their proper folder.\n`;
  t['03 Clients & Leads/Clients & Leads.md'] = `# Clients & Leads\n\nOne note per client or lead. Suggested fields:\n\n- Company:\n- Contact: [[06 People/Name]]\n- Business: (which of yours) [[02 Companies/Aurelium Motion]]\n- Stage: lead / demo booked / proposal / closed\n- Next step:\n- Notes:\n`;
  t['04 SOPs/SOPs.md'] = `# SOPs\n\nStandard operating procedures. One note per process. Template:\n\n# Process name\nOwner:\nWhen it runs:\n## Steps\n1.\n2.\n## Done when\n`;
  t['05 Ideas/Ideas.md'] = `# Ideas\n\nOne idea per note. Keep the title short and the first line the pitch. Tag the company it belongs to with a link.\n`;
  t['06 People/People.md'] = `# People\n\nOne note per person. Suggested fields:\n\n- Role:\n- Company:\n- How we know them:\n- Last contact:\n- Notes:\n`;
  t['07 Resources/Resources.md'] = `# Resources\n\nTools, links, reference material, and templates. Group by business where it helps.\n`;
  t['99 Archive/Archive.md'] = `# Archive\n\nFinished projects and stale notes. AURELIUM never moves things here on her own; ask her and confirm.\n`;
  for (const [name, desc] of Object.entries(COMPANIES)) {
    t[`02 Companies/${name}.md`] = `# ${name}\n\n${desc}\n\n## Status\n- \n\n## Offer\n- \n\n## Numbers\n- \n\n## Current priorities\n- [ ] \n\n## Related\n- [[Home]]\n`;
  }
  return t;
}

function dailyTemplate(d = new Date()) {
  return `# ${longDate(d)}\n\n## Briefing\n\n## Tasks\n\n## Notes\n\n## Log\n`;
}

// ---------- Vault ----------
class Vault {
  constructor(root) { this.root = path.resolve(root); this._index = null; this._indexTime = 0; }

  // Resolve a note path inside the vault, refusing anything that escapes it.
  resolve(rel) {
    let p = String(rel || '').replace(/^\/+/, '');
    if (!p.toLowerCase().endsWith('.md')) p += '.md';
    const abs = path.resolve(this.root, p);
    if (!abs.startsWith(this.root + path.sep)) throw new Error('Path escapes the vault');
    return abs;
  }
  relOf(abs) { return path.relative(this.root, abs).split(path.sep).join('/'); }
  exists(rel) { try { return fs.existsSync(this.resolve(rel)); } catch (_) { return false; } }

  ensureStructure() {
    const created = [];
    fs.mkdirSync(this.root, { recursive: true });
    const obs = path.join(this.root, '.obsidian');
    if (!fs.existsSync(obs)) { fs.mkdirSync(obs); fs.writeFileSync(path.join(obs, 'app.json'), '{}\n'); created.push('.obsidian'); }
    for (const f of FOLDERS) { const d = path.join(this.root, f); if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); created.push(f); } }
    for (const [rel, body] of Object.entries(templates())) {
      const abs = this.resolve(rel);
      if (!fs.existsSync(abs)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, body); created.push(rel); }
    }
    this._index = null;
    return created;
  }

  // ----- Reading -----
  listNotes(folder = '') {
    const base = folder ? path.resolve(this.root, folder) : this.root;
    if (!base.startsWith(this.root)) throw new Error('Path escapes the vault');
    const out = [];
    const walk = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
      }
    };
    walk(base);
    return out.map(p => this.relOf(p)).sort();
  }
  readNote(rel) {
    const abs = this.resolve(rel);
    if (!fs.existsSync(abs)) throw new Error(`No note at ${rel}`);
    return fs.readFileSync(abs, 'utf8');
  }
  _buildIndex() {
    const now = Date.now();
    if (this._index && now - this._indexTime < 15000) return this._index;
    const idx = [];
    for (const rel of this.listNotes()) {
      try {
        const abs = this.resolve(rel);
        const text = fs.readFileSync(abs, 'utf8');
        idx.push({ rel, title: path.basename(rel, '.md'), text, lower: text.toLowerCase(), mtime: fs.statSync(abs).mtimeMs });
      } catch (_) {}
    }
    this._index = idx; this._indexTime = now;
    return idx;
  }
  search(query, limit = 8) {
    const terms = String(query).toLowerCase().split(/[^a-z0-9áéíóúñü]+/i).filter(t => t.length > 1);
    if (!terms.length) return [];
    const results = [];
    for (const n of this._buildIndex()) {
      let score = 0;
      const titleL = n.title.toLowerCase();
      for (const t of terms) {
        if (titleL.includes(t)) score += 6;
        let i = -1, c = 0; while ((i = n.lower.indexOf(t, i + 1)) !== -1 && c < 20) c++;
        score += c;
      }
      if (n.lower.includes(String(query).toLowerCase())) score += 10;
      if (score > 0) {
        const first = terms.map(t => n.lower.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0] || 0;
        const start = Math.max(0, first - 80);
        const snippet = n.text.slice(start, start + 240).replace(/\s+/g, ' ').trim();
        results.push({ path: n.rel, title: n.title, score, snippet, modified: new Date(n.mtime).toISOString().slice(0, 10) });
      }
    }
    return results.sort((a, b) => b.score - a.score || b.modified.localeCompare(a.modified)).slice(0, limit);
  }

  // ----- Writing (append-only) -----
  createNote(folder, title, content, links = []) {
    const f = FOLDERS.includes(folder) ? folder : (FOLDERS.find(x => x.toLowerCase().includes(String(folder).toLowerCase())) || '00 Inbox');
    const name = safeName(title) || `Note ${dateKey()} ${timeNow().replace(':', '')}`;
    let rel = `${f}/${name}`;
    if (this.exists(rel)) throw new Error(`A note already exists at ${rel}.md. Append to it with append_note, or choose another title.`);
    const abs = this.resolve(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let body = content.trim().startsWith('#') ? content.trim() : `# ${name}\n\n${content.trim()}`;
    body += `\n\n---\nCaptured by AURELIUM on ${dateKey()} ${timeNow()}.`;
    const linkLine = this._linkLine(links, `[[01 Daily/${dateKey()}]]`);
    body += `\nRelated: ${linkLine}\n`;
    fs.writeFileSync(abs, body);
    this._index = null;
    return rel + '.md';
  }
  appendNote(rel, text) {
    const abs = this.resolve(rel);
    if (!fs.existsSync(abs)) throw new Error(`No note at ${rel}`);
    const cur = fs.readFileSync(abs, 'utf8');
    fs.writeFileSync(abs, cur.replace(/\s*$/, '') + `\n\n${text.trim()}\n`);
    this._index = null;
    return this.relOf(abs);
  }
  _linkLine(links, extra = '') {
    const items = (links || []).map(l => { let s = String(l).trim().replace(/^\[\[|\]\]$/g, ''); if (s.toLowerCase().endsWith('.md')) s = s.slice(0, -3); return `[[${s}]]`; });
    if (extra) items.push(extra);
    return [...new Set(items)].join(', ');
  }
  linkNotes(fromRel, toRel, context = '') {
    if (!this.exists(toRel)) throw new Error(`No note at ${toRel}`);
    const target = String(toRel).replace(/\.md$/i, '');
    return this.appendNote(fromRel, `${context ? context + ' ' : ''}See [[${target}]].`);
  }

  // ----- Daily notes -----
  dailyPath(d = new Date()) { return `01 Daily/${dateKey(d)}.md`; }
  ensureDaily(d = new Date()) {
    const rel = this.dailyPath(d);
    const abs = this.resolve(rel);
    if (!fs.existsSync(abs)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, dailyTemplate(d)); this._index = null; }
    return rel;
  }
  appendDaily(section, text, d = new Date()) {
    const rel = this.ensureDaily(d);
    const abs = this.resolve(rel);
    let body = fs.readFileSync(abs, 'utf8');
    const sec = ['Briefing', 'Tasks', 'Notes', 'Log'].find(s => s.toLowerCase() === String(section || 'notes').toLowerCase()) || 'Notes';
    const line = sec === 'Tasks' ? `- [ ] ${text.trim().replace(/^- \[ \] /, '')}` : sec === 'Log' ? `- ${timeNow()} ${text.trim()}` : text.trim();
    const header = `## ${sec}`;
    const i = body.indexOf(header);
    if (i === -1) body = body.replace(/\s*$/, '') + `\n\n${header}\n${line}\n`;
    else {
      const next = body.indexOf('\n## ', i + header.length);
      const end = next === -1 ? body.length : next;
      const chunk = body.slice(i, end).replace(/\s*$/, '');
      body = body.slice(0, i) + chunk + `\n${line}\n` + (next === -1 ? '' : '\n' + body.slice(next + 1));
    }
    fs.writeFileSync(abs, body);
    this._index = null;
    return rel;
  }
  openTasks(days = 7) {
    const tasks = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const rel = this.dailyPath(d);
      if (!this.exists(rel)) continue;
      for (const line of this.readNote(rel).split('\n')) {
        const m = line.match(/^\s*- \[( |x|X)\] (.+)$/);
        if (m && m[2].trim()) tasks.push({ text: m[2].trim(), done: m[1] !== ' ', date: dateKey(d) });
      }
    }
    return tasks;
  }
  yesterdayNote() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const rel = this.dailyPath(d);
    return this.exists(rel) ? this.readNote(rel) : '';
  }
}

// Find the vault to use, or create one at ~/AureliumBrain.
function openVault({ preferred, onStatus = () => {} }) {
  let root = preferred && preferred.trim() ? path.resolve(preferred.replace(/^~/, os.homedir())) : '';
  let discovered = false;
  if (!root) {
    const found = findExistingVaults();
    const mine = found.find(p => path.basename(p) === 'AureliumBrain');
    if (mine) root = mine;
    else if (found.length) { root = found[0]; discovered = true; }
    else root = path.join(os.homedir(), 'AureliumBrain');
  }
  const existed = fs.existsSync(root);
  const vault = new Vault(root);
  const created = vault.ensureStructure();
  onStatus(existed
    ? `Second brain: ${discovered ? 'found your Obsidian vault at' : 'using'} ${root}${created.length ? ` (added ${created.length} starter folders/notes)` : ''}.`
    : `Second brain: created a new vault at ${root}. Open it in Obsidian with "Open folder as vault".`);
  return { vault, root, created, existed, discovered };
}

module.exports = { Vault, openVault, findExistingVaults, FOLDERS, dateKey, longDate };
