// AURELIUM CRM data store: plain JSON files, one per collection, inside the vault folder.
// Simple to back up (copy the folder), no database server, no native modules.
'use strict';
const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['leads', 'activities', 'appointments', 'proposals', 'invoices', 'tasks', 'projects'];
const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

class Store {
  constructor(dir) {
    this.dir = dir;
    this.data = {};
    this.config = {};
    this.listeners = new Set();
    this._dirty = new Set();
    this._timer = null;
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    for (const c of COLLECTIONS) this.data[c] = this._load(c, []);
    this.config = this._load('config', { goalClients: 2, goalLow: 3000, goalHigh: 5000, ownerName: 'Juan', staleDays: 7, stageNames: {} });
    this._backupDaily();
  }
  _file(name) { return path.join(this.dir, `${name}.json`); }
  _load(name, fallback) {
    try { return JSON.parse(fs.readFileSync(this._file(name), 'utf8')); } catch (_) { return fallback; }
  }
  _backupDaily() {
    const dir = path.join(this.dir, 'backups', today());
    if (fs.existsSync(dir)) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const c of [...COLLECTIONS, 'config']) if (fs.existsSync(this._file(c))) fs.copyFileSync(this._file(c), path.join(dir, `${c}.json`));
      // keep the last 30 days of backups
      const all = fs.readdirSync(path.join(this.dir, 'backups')).sort();
      for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(this.dir, 'backups', old), { recursive: true, force: true });
    } catch (_) {}
  }
  _save(name) { this._dirty.add(name); if (!this._timer) this._timer = setTimeout(() => this.flush(), 150); }
  flush() {
    clearTimeout(this._timer); this._timer = null;
    for (const name of this._dirty) {
      const body = JSON.stringify(name === 'config' ? this.config : this.data[name], null, 1);
      const tmp = this._file(name) + '.tmp';
      fs.writeFileSync(tmp, body); fs.renameSync(tmp, this._file(name));
    }
    this._dirty.clear();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(col, id, kind) { for (const fn of this.listeners) { try { fn({ collection: col, id, kind }); } catch (_) {} } }

  list(col) { return this.data[col] || []; }
  get(col, id) { return (this.data[col] || []).find(d => d._id === id) || null; }
  insert(col, doc) {
    if (!this.data[col]) throw new Error(`Unknown collection ${col}`);
    const d = { ...doc, _id: doc._id || uid(col[0]), created: doc.created || nowISO(), updated: nowISO() };
    this.data[col].push(d); this._save(col); this._emit(col, d._id, 'insert');
    return d;
  }
  update(col, id, patch) {
    const d = this.get(col, id);
    if (!d) throw new Error(`No ${col.slice(0, -1)} with id ${id}`);
    Object.assign(d, patch, { updated: nowISO() });
    this._save(col); this._emit(col, id, 'update');
    return d;
  }
  remove(col, id) {
    const i = (this.data[col] || []).findIndex(d => d._id === id);
    if (i === -1) return false;
    this.data[col].splice(i, 1); this._save(col); this._emit(col, id, 'remove');
    return true;
  }
  setConfig(patch) { Object.assign(this.config, patch); this._save('config'); this._emit('config', 'main', 'update'); return this.config; }

  // Import an HQ export (or an AURELIUM export). Existing ids are kept untouched unless overwrite is true.
  importBundle(bundle, { overwrite = false } = {}) {
    const cols = bundle.collections || bundle;
    const report = {};
    for (const col of COLLECTIONS) {
      const docs = Array.isArray(cols[col]) ? cols[col] : [];
      let added = 0, skipped = 0, replaced = 0;
      for (const raw of docs) {
        const id = raw._id || raw.id;
        if (!id) continue;
        const doc = { ...raw, _id: id };
        delete doc.id;
        const i = this.data[col].findIndex(d => d._id === id);
        if (i === -1) { this.data[col].push(doc); added++; }
        else if (overwrite) { this.data[col][i] = doc; replaced++; }
        else skipped++;
      }
      if (added || replaced) this._save(col);
      report[col] = { added, skipped, replaced };
    }
    this.flush(); this._emit('all', null, 'import');
    return report;
  }
  exportBundle() {
    return { exportedAt: nowISO(), source: 'AURELIUM CRM', config: this.config, collections: Object.fromEntries(COLLECTIONS.map(c => [c, this.data[c]])) };
  }
}

module.exports = { Store, COLLECTIONS, uid, nowISO, today };
