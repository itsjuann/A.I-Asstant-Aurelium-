// What Motion can do with the CRM. Reads are free; writes are logged to the daily note.
'use strict';
const L = require('./logic');

const brief = (l) => ({ id: l._id, business: l.business, contact: l.contact, phone: l.phone, email: l.email, industry: l.industry, area: l.area, stage: l.stage, priority: l.priority, nextStep: l.nextStep, nextDate: l.nextDate, setup: l.setup, monthly: l.monthly, campaign: l.campaign, notes: (l.notes || '').slice(0, 400), updated: l.updated });

function buildCrmTools({ store, vault, log = () => {} }) {
  const logIt = (text) => { try { vault.appendDaily('Log', text); } catch (_) {} log(text); };
  const by = () => store.config.ownerName || 'Juan';
  const mustFind = (ref) => { const l = L.findLead(store, ref); if (!l) throw new Error(`No lead matches "${ref}". Try crm_search_leads.`); return l; };
  const defs = [
    { name: 'crm_pipeline_summary', description: 'Counts and totals for the CRM: leads per stage, open pipeline value, new this week, follow-ups and tasks due, appointments today, and the monthly goal. Use for "how is the pipeline", briefings, and any numbers question about leads.',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: false,
      run: () => L.summary(store) },
    { name: 'crm_search_leads', description: 'Search leads/contacts in the CRM by name, phone, email, area, industry, campaign or notes. Optional stage filter. Returns compact lead records with ids.',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, stage: { type: 'string', description: `Optional: ${L.STAGES.join(', ')}` }, limit: { type: 'integer', description: '1 to 50' } }, required: ['query'], additionalProperties: false }, strict: false,
      run: ({ query, stage, limit }) => ({ leads: L.searchLeads(store, query, { stage: L.normStage(stage) || undefined, limit: Math.max(1, Math.min(50, limit || 10)) }).map(brief) }) },
    { name: 'crm_get_lead', description: 'Full record for one lead (by id or business name) including its recent activity timeline and flags.',
      input_schema: { type: 'object', properties: { lead: { type: 'string', description: 'Lead id or business name' } }, required: ['lead'], additionalProperties: false }, strict: false,
      run: ({ lead }) => { const l = mustFind(lead); const acts = store.list('activities').filter(a => a.leadId === l._id).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 15); return { ...l, flags: L.flags(store, l), activities: acts.map(a => ({ at: a.at, type: a.type, text: a.text })) }; } },
    { name: 'crm_due_today', description: 'Everything due today or overdue: follow-ups with a next-step date, open tasks, and appointments. Use for "what do I need to do today" and the morning briefing.',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: false,
      run: () => L.dueToday(store) },
    { name: 'crm_add_lead', description: 'Create a new lead/contact in the CRM. Fails if a lead with the same business name exists.',
      input_schema: { type: 'object', properties: { business: { type: 'string' }, contact: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, industry: { type: 'string' }, source: { type: 'string' }, area: { type: 'string' }, notes: { type: 'string' }, nextStep: { type: 'string' }, nextDate: { type: 'string', description: 'YYYY-MM-DD' }, monthly: { type: 'number' }, setup: { type: 'number' } }, required: ['business'], additionalProperties: false }, strict: true,
      run: (f) => { const l = L.createLead(store, f, by()); logIt(`CRM: new lead ${l.business}`); return brief(l); } },
    { name: 'crm_update_lead', description: 'Update fields on a lead: contact details, next step and date, notes (appended, not replaced), priority, value, tags. For stage changes use crm_set_stage.',
      input_schema: { type: 'object', properties: { lead: { type: 'string', description: 'Lead id or business name' }, contact: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, nextStep: { type: 'string' }, nextDate: { type: 'string', description: 'YYYY-MM-DD, empty to clear' }, appendNote: { type: 'string', description: 'Text to add to the notes' }, priority: { type: 'string', description: 'A, B or C' }, monthly: { type: 'number' }, setup: { type: 'number' }, website: { type: 'string' }, industry: { type: 'string' } }, required: ['lead'], additionalProperties: false }, strict: true,
      run: ({ lead, appendNote, ...fields }) => { const l = mustFind(lead); if (appendNote) fields.notes = `${l.notes ? l.notes + '\n' : ''}${new Date().toISOString().slice(0, 10)}: ${appendNote}`; const out = L.updateLead(store, l._id, fields, by()); logIt(`CRM: updated ${out.business} (${Object.keys(fields).join(', ')})`); return brief(out); } },
    { name: 'crm_set_stage', description: `Move a lead to a pipeline stage. Stages: ${L.STAGES.join(', ')}. Confirm with Juan first unless he explicitly asked for the move. For "lost", give a reason.`,
      input_schema: { type: 'object', properties: { lead: { type: 'string' }, stage: { type: 'string' }, reason: { type: 'string' } }, required: ['lead', 'stage'], additionalProperties: false }, strict: true,
      run: ({ lead, stage, reason }) => { const l = mustFind(lead); const out = L.setStage(store, l._id, stage, { by: by(), reason: reason || '' }); logIt(`CRM: ${out.business} → ${L.stageName(store, out.stage)}`); return brief(out); } },
    { name: 'crm_log_activity', description: 'Log an interaction on a lead: a call, a note, an email or text sent, a reply received, a meeting. Use after Juan tells you what happened ("I just called Vera Bar, they want a demo Friday").',
      input_schema: { type: 'object', properties: { lead: { type: 'string' }, type: { type: 'string', description: 'note, call, email_sent, sms_sent, reply, meeting' }, text: { type: 'string' } }, required: ['lead', 'type', 'text'], additionalProperties: false }, strict: true,
      run: ({ lead, type, text }) => { const l = mustFind(lead); const a = L.logActivity(store, { leadId: l._id, type, text, by: by() }); logIt(`CRM: ${type} on ${l.business}: ${text.slice(0, 80)}`); return { logged: a._id, lead: l.business }; } },
    { name: 'crm_add_task', description: 'Add a CRM task, optionally tied to a lead, with a due date.',
      input_schema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' }, lead: { type: 'string' }, priority: { type: 'string', description: 'High, Normal or Low' } }, required: ['title'], additionalProperties: false }, strict: true,
      run: ({ title, due, lead, priority }) => { const l = lead ? mustFind(lead) : null; const t = store.insert('tasks', { title, due: due || '', leadId: l ? l._id : '', priority: priority || 'Normal', done: false, kind: 'manual' }); logIt(`CRM task: ${title}${due ? ` (due ${due})` : ''}`); return { id: t._id, title: t.title, due: t.due, lead: l ? l.business : '' }; } },
    { name: 'crm_complete_task', description: 'Mark a CRM task done (by id or by its title).',
      input_schema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'], additionalProperties: false }, strict: false,
      run: ({ task }) => { const t = store.get('tasks', task) || store.list('tasks').find(x => !x.done && x.title.toLowerCase().includes(task.toLowerCase())); if (!t) throw new Error('Task not found'); store.update('tasks', t._id, { done: true, doneAt: new Date().toISOString() }); logIt(`CRM task done: ${t.title}`); return { done: t.title }; } },
    { name: 'crm_schedule_appointment', description: 'Book an appointment or call with a lead in the CRM schedule.',
      input_schema: { type: 'object', properties: { lead: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM 24h' }, title: { type: 'string' }, durationMin: { type: 'integer' }, location: { type: 'string' } }, required: ['lead', 'date', 'time'], additionalProperties: false }, strict: true,
      run: ({ lead, date, time, title, durationMin, location }) => { const l = mustFind(lead); const a = store.insert('appointments', { leadId: l._id, date, time, title: title || 'Call', durationMin: durationMin || 30, location: location || 'Phone', status: 'booked', notes: '' }); L.logActivity(store, { leadId: l._id, type: 'meeting', text: `Booked: ${a.title} ${date} ${time}`, by: by() }); if (L.OPEN.includes(l.stage) && ['new', 'contacted', 'qualified'].includes(l.stage)) L.setStage(store, l._id, 'call', { by: by() }); logIt(`CRM: booked ${a.title} with ${l.business} ${date} ${time}`); return { id: a._id, lead: l.business, date, time, title: a.title }; } }
  ];
  return { schemas: defs.map(({ run, ...rest }) => rest), handlers: Object.fromEntries(defs.map(d => [d.name, d.run])) };
}

module.exports = { buildCrmTools };
