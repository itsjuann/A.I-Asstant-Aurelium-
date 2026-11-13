// CRM business rules: stages, flags, summaries, search. Pure functions over the store.
'use strict';
const { nowISO, today } = require('./store');

const STAGES = ['new', 'contacted', 'qualified', 'call', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_DEFAULT = { new: 'New lead', contacted: 'Contacted', qualified: 'Qualified', call: 'Call booked', proposal: 'Proposal sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const OPEN = STAGES.filter(s => s !== 'won' && s !== 'lost');
const ACTIVITY_TYPES = ['note', 'call', 'email_sent', 'email_draft', 'sms_sent', 'reply', 'meeting', 'stage', 'proposal', 'task', 'system', 'ai'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const daysSince = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso.length > 10 ? iso : iso + 'T12:00:00')) / 864e5) : null;
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };

function normStage(s) { s = String(s || '').toLowerCase().trim(); if (s === 'replied') return 'qualified'; if (s === 'demo' || s === 'booked') return 'call'; return STAGES.includes(s) ? s : null; }
function stageName(store, s) { return (store.config.stageNames && store.config.stageNames[s]) || STAGE_DEFAULT[s] || s; }
function dealValue(l) { return num(l.setup) + num(l.monthly); }
function isOpen(l) { return OPEN.includes(l.stage); }

function lastActivityAt(store, lead) {
  let m = lead.lastActivity || lead.updated || lead.created || '';
  for (const a of store.list('activities')) if (a.leadId === lead._id && a.at > m) m = a.at;
  return m;
}
function flags(store, lead) {
  const f = [];
  if (!isOpen(lead)) return f;
  const t = today();
  const ds = daysSince(lastActivityAt(store, lead));
  if (ds != null && ds >= num(store.config.staleDays || 7)) f.push(`Stalled ${ds}d`);
  if (!lead.nextStep && !lead.nextDate) f.push('No next step');
  else if (lead.nextDate && lead.nextDate < t) f.push('Next step overdue');
  return f;
}

function searchLeads(store, query, { stage, industry, campaign, status, limit = 25 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const l of store.list('leads')) {
    if (stage && l.stage !== stage) continue;
    if (industry && String(l.industry || '').toLowerCase() !== industry.toLowerCase()) continue;
    if (campaign && String(l.campaign || '').toLowerCase() !== campaign.toLowerCase()) continue;
    if (status && String(l.status || 'Active').toLowerCase() !== status.toLowerCase()) continue;
    const hay = `${l.business} ${l.contact} ${l.email} ${l.phone} ${l.area} ${l.industry} ${l.campaign} ${l.notes} ${(l.tags || []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of terms) { if (String(l.business || '').toLowerCase().includes(t)) score += 5; if (hay.includes(t)) score += 1; }
    if (terms.length && score === 0) continue;
    out.push({ lead: l, score });
  }
  out.sort((a, b) => b.score - a.score || String(b.lead.updated).localeCompare(String(a.lead.updated)));
  return out.slice(0, limit).map(x => x.lead);
}
function findLead(store, ref) {
  if (!ref) return null;
  const direct = store.get('leads', ref);
  if (direct) return direct;
  const hits = searchLeads(store, ref, { limit: 3 });
  return hits[0] || null;
}

function summary(store) {
  const leads = store.list('leads');
  const t = today(), weekAgo = addDays(t, -7);
  const byStage = Object.fromEntries(STAGES.map(s => [s, 0]));
  let openValue = 0, newThisWeek = 0, wonThisMonth = 0, attention = 0;
  const month = t.slice(0, 7);
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1;
    if ((l.created || '').slice(0, 10) >= weekAgo) newThisWeek++;
    if (isOpen(l)) { openValue += dealValue(l); if (flags(store, l).length) attention++; }
    if (l.stage === 'won' && (l.wonOn || l.updated || '').slice(0, 7) === month) wonThisMonth++;
  }
  const tasks = store.list('tasks');
  const dueToday = tasks.filter(x => !x.done && x.due && x.due <= t).length;
  const appts = store.list('appointments').filter(a => a.date === t && a.status !== 'cancelled');
  const followUps = leads.filter(l => isOpen(l) && l.nextDate && l.nextDate <= t);
  return { total: leads.length, open: leads.filter(isOpen).length, byStage, openValue, newThisWeek, wonThisMonth, attention, tasksDue: dueToday, appointmentsToday: appts.length, followUpsDue: followUps.length, goal: { clients: store.config.goalClients, low: store.config.goalLow, high: store.config.goalHigh } };
}

function dueToday(store) {
  const t = today();
  const leads = store.list('leads');
  const name = (id) => { const l = leads.find(x => x._id === id); return l ? l.business : ''; };
  return {
    followUps: leads.filter(l => isOpen(l) && l.nextDate && l.nextDate <= t).map(l => ({ id: l._id, business: l.business, stage: l.stage, nextStep: l.nextStep, nextDate: l.nextDate, phone: l.phone })).slice(0, 40),
    tasks: store.list('tasks').filter(x => !x.done && x.due && x.due <= t).map(x => ({ id: x._id, title: x.title, due: x.due, priority: x.priority, lead: name(x.leadId) })),
    appointments: store.list('appointments').filter(a => a.date === t && a.status !== 'cancelled').map(a => ({ id: a._id, time: a.time, title: a.title, lead: name(a.leadId), location: a.location }))
  };
}

// ----- Writes that keep the audit trail consistent -----
function logActivity(store, { leadId, type = 'note', text, by = 'Juan', extra = {} }) {
  const a = store.insert('activities', { leadId: leadId || '', type: ACTIVITY_TYPES.includes(type) ? type : 'note', text: String(text || '').trim(), at: nowISO(), by, ...extra });
  if (leadId && store.get('leads', leadId)) store.update('leads', leadId, { lastActivity: a.at });
  return a;
}
function setStage(store, leadId, stage, { by = 'Juan', reason = '' } = {}) {
  const s = normStage(stage);
  if (!s) throw new Error(`Unknown stage "${stage}". Use one of: ${STAGES.join(', ')}`);
  const lead = store.get('leads', leadId);
  if (!lead) throw new Error('Lead not found');
  const from = lead.stage;
  if (from === s) return lead;
  const at = nowISO();
  const patch = { stage: s, stageSince: at, stageHistory: [...(lead.stageHistory || []), { at, by, from, to: s }] };
  if (s === 'won') patch.wonOn = today();
  if (s === 'lost' && reason) patch.lostReason = reason;
  store.update('leads', leadId, patch);
  logActivity(store, { leadId, type: 'stage', text: `${stageName(store, from)} → ${stageName(store, s)}${reason ? ` (${reason})` : ''}`, by });
  return store.get('leads', leadId);
}
function createLead(store, fields, by = 'Juan') {
  const business = String(fields.business || '').trim();
  if (!business) throw new Error('A lead needs a business name');
  const dup = store.list('leads').find(l => String(l.business).toLowerCase() === business.toLowerCase());
  if (dup) throw new Error(`A lead for "${dup.business}" already exists (id ${dup._id}). Update it instead.`);
  const at = nowISO();
  const lead = store.insert('leads', {
    business, contact: fields.contact || '', email: fields.email || '', phone: fields.phone || '', industry: fields.industry || 'Other',
    source: fields.source || 'Other', stage: normStage(fields.stage) || 'new', status: 'Active', priority: fields.priority || '',
    setup: num(fields.setup), monthly: num(fields.monthly), nextStep: fields.nextStep || '', nextDate: fields.nextDate || '',
    notes: fields.notes || '', tags: Array.isArray(fields.tags) ? fields.tags : [], area: fields.area || '', website: fields.website || '',
    campaign: fields.campaign || '', owner: by, created: today(), stageSince: at, stageHistory: [{ at, by, from: '', to: normStage(fields.stage) || 'new' }],
    consent: { call: 'unknown', email: 'unknown', sms: 'unknown' }
  });
  logActivity(store, { leadId: lead._id, type: 'system', text: 'Lead created', by });
  return lead;
}
const EDITABLE = ['business', 'contact', 'email', 'phone', 'industry', 'source', 'priority', 'setup', 'monthly', 'nextStep', 'nextDate', 'notes', 'tags', 'area', 'website', 'campaign', 'status', 'service', 'budget', 'timeline', 'expectedClose', 'lostReason'];
function updateLead(store, leadId, fields, by = 'Juan') {
  const patch = {};
  for (const k of EDITABLE) if (fields[k] !== undefined) patch[k] = k === 'setup' || k === 'monthly' ? num(fields[k]) : fields[k];
  if (fields.stage !== undefined && normStage(fields.stage)) setStage(store, leadId, fields.stage, { by });
  if (Object.keys(patch).length) store.update('leads', leadId, patch);
  return store.get('leads', leadId);
}

module.exports = { STAGES, STAGE_DEFAULT, OPEN, ACTIVITY_TYPES, normStage, stageName, dealValue, isOpen, flags, searchLeads, findLead, summary, dueToday, logActivity, setStage, createLead, updateLead, lastActivityAt, addDays };
