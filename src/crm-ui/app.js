/* AURELIUM CRM dashboard. Plain JavaScript, talks to the local API, refreshes live when Motion writes. */
(function () {
  'use strict';
  const API = '/api';
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(4)) { if (k == null || k === false) continue; e.append(k.nodeType ? k : document.createTextNode(String(k))); }
    return e;
  };
  const fmt$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-').map(Number); if (!y) return s; return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const fmtStamp = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const daysSince = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso.length > 10 ? iso : iso + 'T12:00:00')) / 864e5) : null;

  const S = { data: null, tab: (location.hash || '#home').slice(1), filters: { q: '', stage: '', industry: '', campaign: '', status: '' }, sort: { key: 'updated', dir: -1 }, drawer: null };
  const TABS = [['home', 'Home'], ['leads', 'Leads'], ['pipeline', 'Pipeline'], ['today', 'Today'], ['schedule', 'Schedule'], ['tasks', 'Tasks'], ['proposals', 'Proposals'], ['settings', 'Settings']];

  async function api(method, path, body) {
    const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', 'X-Aurelium-CRM': '1' }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    return j;
  }
  function toast(msg, bad) { const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg }); $('#toast-root').append(t); setTimeout(() => t.remove(), 2800); }
  async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; } }

  async function load() { S.data = await api('GET', '/bootstrap'); window.__crmLoaded = true; render(); }
  const leads = () => S.data.leads;
  const leadById = (id) => leads().find(l => l._id === id);
  const stageName = (s) => (S.data.stageNames && S.data.stageNames[s]) || s;
  const isOpen = (l) => !['won', 'lost'].includes(l.stage);

  /* ---------- shell ---------- */
  function renderTabs() {
    const sum = S.data.summary;
    const counts = { leads: sum.total, pipeline: sum.open, today: sum.followUpsDue + sum.tasksDue + sum.appointmentsToday, tasks: S.data.tasks.filter(t => !t.done).length, schedule: S.data.appointments.filter(a => a.date >= today() && a.status !== 'cancelled').length, proposals: S.data.proposals.length };
    const nav = $('#tabs'); nav.innerHTML = '';
    for (const [id, label] of TABS) nav.append(h('button', { class: S.tab === id ? 'active' : '', onclick: () => go(id) }, label, counts[id] != null ? h('span', { class: 'n', text: counts[id] }) : null));
  }
  function go(tab) { S.tab = tab; location.hash = tab; render(); }
  function render() { if (!S.data) return; renderTabs(); const v = $('#view'); v.innerHTML = ''; ({ home: viewHome, leads: viewLeads, pipeline: viewPipeline, today: viewToday, schedule: viewSchedule, tasks: viewTasks, proposals: viewProposals, settings: viewSettings }[S.tab] || viewHome)(v); }

  /* ---------- Home ---------- */
  function viewHome(v) {
    const s = S.data.summary;
    const hour = new Date().getHours();
    v.append(h('h1', {}, `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${S.data.config.ownerName || 'Juan'}.`));
    v.append(h('div', { class: 'grid kpis' },
      kpi('Open leads', s.open, `${s.total} total`, () => go('pipeline')),
      kpi('New this week', s.newThisWeek, 'created in 7 days', () => { S.filters.q = ''; go('leads'); }),
      kpi('Due today', s.followUpsDue + s.tasksDue, `${s.followUpsDue} follow-ups · ${s.tasksDue} tasks`, () => go('today'), s.followUpsDue + s.tasksDue ? 'gold' : ''),
      kpi('Needs attention', s.attention, 'stalled or no next step', () => { S.filters.q = 'flag:'; go('leads'); }, s.attention ? 'bad' : ''),
      kpi('Pipeline value', fmt$(s.openValue), 'setup + monthly, open leads', () => go('pipeline')),
      kpi('Won this month', s.wonThisMonth, `goal ${s.goal.clients} clients`, () => go('leads'))
    ));
    const pct = Math.min(100, Math.round((s.wonThisMonth / Math.max(1, s.goal.clients)) * 100));
    v.append(h('div', { class: 'panel goal', style: 'margin-top:14px' }, h('h2', {}, 'This month'), h('div', { class: 'spread' }, h('span', {}, `${s.wonThisMonth} of ${s.goal.clients} new clients · target ${fmt$(s.goal.low)} to ${fmt$(s.goal.high)} monthly`), h('span', { class: 'mono muted' }, pct + '%')), h('div', { class: 'meter' }, h('i', { style: `width:${pct}%` }))));
    const funnel = h('div', { class: 'panel' }, h('h2', {}, 'Pipeline'));
    const max = Math.max(1, ...Object.values(s.byStage));
    for (const st of S.data.stages) funnel.append(h('div', { class: 'row', style: 'margin:6px 0; cursor:pointer', onclick: () => { S.filters.stage = st; go('leads'); } }, h('span', { style: 'width:120px', class: 'muted' }, stageName(st)), h('span', { style: `flex:1;height:8px;border-radius:99px;background:${st === 'won' ? 'var(--gold)' : st === 'lost' ? 'rgba(207,227,255,0.2)' : 'var(--blue)'};transform-origin:left;transform:scaleX(${(s.byStage[st] || 0) / max})` }), h('span', { class: 'mono', style: 'width:40px;text-align:right' }, s.byStage[st] || 0)));
    const attention = leads().filter(l => isOpen(l) && l.flags.length).sort((a, b) => (a.priority || 'Z').localeCompare(b.priority || 'Z') || (a.nextDate || '9').localeCompare(b.nextDate || '9')).slice(0, 8);
    const attn = h('div', { class: 'panel' }, h('h2', {}, 'Needs attention'), attention.length ? h('ul', { class: 'list' }, attention.map(l => h('li', { onclick: () => openLead(l._id) }, h('div', {}, h('div', { class: 't' }, l.business), h('div', { class: 'm' }, l.flags.map(f => h('span', { class: 'flag' + (/No next/.test(f) ? ' y' : '') }, f)), ` ${stageName(l.stage)}`)), h('span', { class: 'pill dim' }, l.priority ? 'P' + l.priority : l.industry || '')))) : h('div', { class: 'empty' }, 'All clear.'));
    const recent = S.data.activities.slice().sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 8);
    const feed = h('div', { class: 'panel' }, h('h2', {}, 'Latest activity'), recent.length ? h('ul', { class: 'timeline' }, recent.map(a => { const l = leadById(a.leadId); return h('li', { class: a.type, onclick: () => l && openLead(l._id), style: 'cursor:pointer' }, h('div', {}, l ? h('b', {}, l.business + ' · ') : null, a.text), h('div', { class: 'at' }, `${fmtStamp(a.at)} · ${a.by || ''}`)); })) : h('div', { class: 'empty' }, 'No activity yet.'));
    v.append(h('div', { class: 'grid two' }, funnel, attn, feed));
  }
  function kpi(lbl, val, sub, onclick, cls) { return h('div', { class: 'panel kpi' + (onclick ? ' clickable' : ''), onclick }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val ' + (cls || '') }, val), h('div', { class: 'sub' }, sub)); }

  /* ---------- Leads table ---------- */
  function viewLeads(v) {
    const f = S.filters;
    const industries = [...new Set(leads().map(l => l.industry).filter(Boolean))].sort();
    const campaigns = [...new Set(leads().map(l => l.campaign).filter(Boolean))].sort();
    const sel = (key, opts, label) => h('select', { onchange: (e) => { f[key] = e.target.value; render(); } }, h('option', { value: '' }, label), opts.map(o => h('option', { value: Array.isArray(o) ? o[0] : o, selected: f[key] === (Array.isArray(o) ? o[0] : o) }, Array.isArray(o) ? o[1] : o)));
    v.append(h('h1', {}, 'Leads'));
    v.append(h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: 'Search name, phone, email, area, notes…', value: f.q, oninput: (e) => { f.q = e.target.value; render(); } }),
      sel('stage', S.data.stages.map(s => [s, stageName(s)]), 'All stages'), sel('industry', industries, 'All industries'), sel('campaign', campaigns, 'All campaigns'),
      sel('status', ['Active', 'Nurture', 'Client', 'Do not contact', 'Archived'], 'Any status'),
      h('button', { class: 'btn ghost sm', onclick: () => { S.filters = { q: '', stage: '', industry: '', campaign: '', status: '' }; render(); } }, 'Clear')));
    let rows = leads().filter(l => (!f.stage || l.stage === f.stage) && (!f.industry || l.industry === f.industry) && (!f.campaign || l.campaign === f.campaign) && (!f.status || (l.status || 'Active') === f.status));
    const q = f.q.trim().toLowerCase();
    if (q === 'flag:') rows = rows.filter(l => l.flags.length);
    else if (q) rows = rows.filter(l => `${l.business} ${l.contact} ${l.email} ${l.phone} ${l.area} ${l.industry} ${l.campaign} ${l.notes} ${(l.tags || []).join(' ')}`.toLowerCase().includes(q));
    const k = S.sort.key, dir = S.sort.dir;
    rows.sort((a, b) => { const x = a[k] == null ? '' : a[k], y = b[k] == null ? '' : b[k]; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; });
    const th = (label, key, cls) => h('th', { class: cls, onclick: () => { S.sort = { key, dir: S.sort.key === key ? -S.sort.dir : 1 }; render(); } }, label, S.sort.key === key ? (dir > 0 ? ' ↑' : ' ↓') : '');
    v.append(h('div', { class: 'muted', style: 'margin:0 0 8px' }, `${rows.length} leads`));
    v.append(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, th('Business', 'business'), th('Stage', 'stage'), th('Priority', 'priority'), th('Industry', 'industry'), th('Area', 'area'), th('Phone', 'phone'), th('Next step', 'nextStep'), th('Next date', 'nextDate'), th('Monthly', 'monthly', 'num'), th('Updated', 'updated'))),
      h('tbody', {}, rows.slice(0, 400).map(l => h('tr', { onclick: () => openLead(l._id) }, h('td', {}, h('b', {}, l.business), l.flags.length ? h('div', {}, l.flags.map(x => h('span', { class: 'flag' + (/No next/.test(x) ? ' y' : '') }, x))) : null), h('td', {}, h('span', { class: 'pill' + (l.stage === 'won' ? ' gold' : l.stage === 'lost' ? ' dim' : '') }, stageName(l.stage))), h('td', {}, l.priority || ''), h('td', {}, l.industry || ''), h('td', {}, l.area || ''), h('td', { class: 'mono' }, l.phone || ''), h('td', {}, l.nextStep || ''), h('td', { class: l.nextDate && l.nextDate < today() && isOpen(l) ? 'mono' : 'mono muted', style: l.nextDate && l.nextDate < today() && isOpen(l) ? 'color:var(--bad)' : '' }, fmtDate(l.nextDate)), h('td', { class: 'num' }, l.monthly ? fmt$(l.monthly) : ''), h('td', { class: 'muted' }, fmtDate(l.updated))))))));
    if (rows.length > 400) v.append(h('div', { class: 'muted', style: 'margin-top:8px' }, 'Showing the first 400. Narrow the search to see the rest.'));
  }

  /* ---------- Pipeline board ---------- */
  function viewPipeline(v) {
    v.append(h('div', { class: 'spread' }, h('h1', {}, 'Pipeline'), h('span', { class: 'muted' }, 'Drag a card to change its stage')));
    const board = h('div', { class: 'board' });
    for (const st of S.data.stages) {
      const cards = leads().filter(l => l.stage === st).sort((a, b) => (a.priority || 'Z').localeCompare(b.priority || 'Z') || (b.updated || '').localeCompare(a.updated || ''));
      const col = h('div', { class: 'col', 'data-stage': st, ondragover: (e) => { e.preventDefault(); col.classList.add('drop'); }, ondragleave: () => col.classList.remove('drop'), ondrop: async (e) => { e.preventDefault(); col.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id) await act(() => api('POST', `/leads/${id}/stage`, { stage: st }), `Moved to ${stageName(st)}`); } },
        h('h3', {}, stageName(st), h('span', {}, cards.length)));
      for (const l of cards.slice(0, 80)) col.append(h('div', { class: 'card', draggable: 'true', ondragstart: (e) => e.dataTransfer.setData('text/plain', l._id), onclick: () => openLead(l._id) }, h('div', { class: 't' }, l.business), h('div', { class: 'm' }, [l.priority ? 'P' + l.priority : null, l.industry, l.area].filter(Boolean).join(' · ')), l.nextStep ? h('div', { class: 'm' }, `→ ${l.nextStep}${l.nextDate ? ' · ' + fmtDate(l.nextDate) : ''}`) : null, l.flags.length ? h('div', { class: 'fl' }, l.flags.map(x => h('span', { class: 'flag' + (/No next/.test(x) ? ' y' : '') }, x))) : null));
      if (cards.length > 80) col.append(h('div', { class: 'muted', style: 'padding:8px;font-size:12px' }, `+${cards.length - 80} more in Leads`));
      board.append(col);
    }
    v.append(board);
  }

  /* ---------- Today ---------- */
  function viewToday(v) {
    const t = S.data.today;
    v.append(h('h1', {}, 'Today'));
    const appts = h('div', { class: 'panel' }, h('h2', {}, 'Appointments'), t.appointments.length ? h('ul', { class: 'list' }, t.appointments.map(a => h('li', {}, h('div', {}, h('div', { class: 't' }, `${a.time} · ${a.title}`), h('div', { class: 'm' }, `${a.lead} · ${a.location || ''}`))))) : h('div', { class: 'empty' }, 'Nothing booked today.'));
    const tasks = h('div', { class: 'panel' }, h('h2', {}, 'Tasks due'), t.tasks.length ? t.tasks.map(x => taskRow(S.data.tasks.find(y => y._id === x.id))) : h('div', { class: 'empty' }, 'No tasks due.'));
    const fu = t.followUps.slice().sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));
    const follow = h('div', { class: 'panel' }, h('h2', {}, `Follow-ups due (${t.followUps.length})`), fu.length ? h('ul', { class: 'list' }, fu.slice(0, 40).map(l => h('li', { onclick: () => openLead(l.id) }, h('div', {}, h('div', { class: 't' }, l.business), h('div', { class: 'm' }, `${l.nextStep || 'Follow up'} · due ${fmtDate(l.nextDate)} · ${l.phone || ''}`)), h('span', { class: 'pill' }, stageName(l.stage))))) : h('div', { class: 'empty' }, 'No follow-ups due.'));
    v.append(h('div', { class: 'grid two' }, appts, tasks, follow));
  }

  /* ---------- Schedule ---------- */
  function viewSchedule(v) {
    v.append(h('div', { class: 'spread' }, h('h1', {}, 'Schedule'), h('button', { class: 'btn primary', onclick: () => apptModal() }, '+ Appointment')));
    const list = S.data.appointments.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const upcoming = list.filter(a => a.date >= today()), past = list.filter(a => a.date < today()).reverse();
    const block = (title, items) => h('div', { class: 'panel', style: 'margin-top:14px' }, h('h2', {}, title), items.length ? h('ul', { class: 'list' }, items.map(a => { const l = leadById(a.leadId); return h('li', { onclick: () => l && openLead(l._id) }, h('div', {}, h('div', { class: 't' }, `${fmtDate(a.date)} ${a.time} · ${a.title}`), h('div', { class: 'm' }, `${l ? l.business : ''} · ${a.location || ''} · ${a.durationMin || 30} min`)), h('span', { class: 'pill ' + (a.status === 'no_show' ? 'bad' : a.status === 'done' ? 'ok' : a.status === 'cancelled' ? 'dim' : '') }, a.status || 'booked')); })) : h('div', { class: 'empty' }, 'Nothing here.'));
    v.append(block('Upcoming', upcoming), block('Past', past.slice(0, 30)));
  }
  function apptModal(leadId) {
    const f = {};
    modal('New appointment', h('div', { class: 'form' },
      field('Lead', leadPicker(leadId, (id) => f.leadId = id), 'full'), field('Title', input('text', 'Call', (v) => f.title = v)), field('Location', input('text', 'Phone', (v) => f.location = v)),
      field('Date', input('date', today(), (v) => f.date = v)), field('Time', input('time', '10:00', (v) => f.time = v)), field('Minutes', input('number', '30', (v) => f.durationMin = Number(v)))),
      async () => { if (!f.leadId || !f.date || !f.time) throw new Error('Pick a lead, date and time'); await api('POST', '/appointments', { leadId: f.leadId, title: f.title || 'Call', location: f.location || 'Phone', date: f.date, time: f.time, durationMin: f.durationMin || 30, status: 'booked' }); await api('POST', `/leads/${f.leadId}/activity`, { type: 'meeting', text: `Booked: ${f.title || 'Call'} ${f.date} ${f.time}` }); toast('Booked'); });
  }

  /* ---------- Tasks ---------- */
  function taskRow(t) {
    if (!t) return null;
    const l = leadById(t.leadId);
    return h('div', { class: 'check' + (t.done ? ' done' : '') }, h('input', { type: 'checkbox', checked: t.done, onchange: async (e) => { await act(() => api('PATCH', `/tasks/${t._id}`, { done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null })); } }),
      h('div', { class: 't', onclick: () => l && openLead(l._id) }, h('div', {}, t.title), h('div', { class: 'muted', style: 'font-size:12px' }, [t.due ? 'due ' + fmtDate(t.due) : null, t.priority, l ? l.business : null].filter(Boolean).join(' · '))),
      h('button', { class: 'btn ghost sm', onclick: () => act(() => api('DELETE', `/tasks/${t._id}`), 'Removed') }, '×'));
  }
  function viewTasks(v) {
    v.append(h('div', { class: 'spread' }, h('h1', {}, 'Tasks'), h('button', { class: 'btn primary', onclick: () => taskModal() }, '+ Task')));
    const open = S.data.tasks.filter(t => !t.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    const done = S.data.tasks.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 20);
    v.append(h('div', { class: 'panel' }, h('h2', {}, `Open (${open.length})`), open.length ? open.map(taskRow) : h('div', { class: 'empty' }, 'Nothing open.')));
    v.append(h('div', { class: 'panel', style: 'margin-top:14px' }, h('h2', {}, 'Done'), done.length ? done.map(taskRow) : h('div', { class: 'empty' }, 'Nothing yet.')));
  }
  function taskModal(leadId) {
    const f = { leadId: leadId || '' };
    modal('New task', h('div', { class: 'form' }, field('Title', input('text', '', (v) => f.title = v), 'full'), field('Due', input('date', '', (v) => f.due = v)), field('Priority', select(['Normal', 'High', 'Low'], 'Normal', (v) => f.priority = v)), field('Lead (optional)', leadPicker(leadId, (id) => f.leadId = id), 'full')),
      async () => { if (!f.title) throw new Error('Give the task a title'); await api('POST', '/tasks', { title: f.title, due: f.due || '', priority: f.priority || 'Normal', leadId: f.leadId || '', done: false, kind: 'manual' }); toast('Task added'); });
  }

  /* ---------- Proposals ---------- */
  function viewProposals(v) {
    v.append(h('div', { class: 'spread' }, h('h1', {}, 'Proposals'), h('button', { class: 'btn primary', onclick: () => proposalModal() }, '+ Proposal')));
    const list = S.data.proposals.slice().sort((a, b) => (b.updated || b.created || '').localeCompare(a.updated || a.created || ''));
    v.append(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Title'), h('th', {}, 'Lead'), h('th', {}, 'Service'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Monthly'), h('th', {}, 'Status'), h('th', {}, 'Updated'))),
      h('tbody', {}, list.length ? list.map(p => { const l = leadById(p.leadId); return h('tr', { onclick: () => proposalModal(p) }, h('td', {}, h('b', {}, p.title || '(untitled)')), h('td', {}, l ? l.business : ''), h('td', {}, p.service || ''), h('td', { class: 'num' }, fmt$(p.price)), h('td', { class: 'num' }, p.monthly ? fmt$(p.monthly) : ''), h('td', {}, h('span', { class: 'pill ' + (p.status === 'accepted' ? 'gold' : p.status === 'sent' ? '' : 'dim') }, p.status || 'draft')), h('td', { class: 'muted' }, fmtDate(p.updated || p.created))); }) : h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'No proposals yet.'))))));
  }
  function proposalModal(p) {
    const f = Object.assign({ status: 'draft', service: 'Website development' }, p || {});
    modal(p ? 'Proposal' : 'New proposal', h('div', { class: 'form' },
      field('Lead', leadPicker(f.leadId, (id) => f.leadId = id), 'full'), field('Title', input('text', f.title || '', (v) => f.title = v), 'full'),
      field('Service', select(['Website development', 'App development', 'AI receptionist', 'Custom CRM / SaaS', 'Get Found (SEO)', 'Google Reviews & Reputation', 'Marketing services', 'Monthly retainer', 'Other'], f.service, (v) => f.service = v)), field('Status', select(['draft', 'sent', 'accepted', 'declined'], f.status, (v) => f.status = v)),
      field('One-time price', input('number', f.price || '', (v) => f.price = Number(v))), field('Monthly', input('number', f.monthly || '', (v) => f.monthly = Number(v))),
      field('Scope', textarea(f.scope || '', (v) => f.scope = v), 'full'), field('Deliverables', textarea(f.deliverables || '', (v) => f.deliverables = v), 'full'), field('Terms', textarea(f.terms || '', (v) => f.terms = v), 'full')),
      async () => { if (!f.leadId) throw new Error('Pick a lead'); const body = { leadId: f.leadId, title: f.title, service: f.service, status: f.status, price: f.price || 0, monthly: f.monthly || 0, scope: f.scope || '', deliverables: f.deliverables || '', terms: f.terms || '' }; if (p) await api('PATCH', `/proposals/${p._id}`, body); else { await api('POST', '/proposals', body); await api('POST', `/leads/${f.leadId}/activity`, { type: 'proposal', text: `Proposal created: ${f.title || f.service}` }); } toast('Saved'); });
  }

  /* ---------- Settings ---------- */
  function viewSettings(v) {
    const c = S.data.config;
    v.append(h('h1', {}, 'Settings'));
    const f = { ...c };
    v.append(h('div', { class: 'panel' }, h('h2', {}, 'Goals'), h('div', { class: 'form' }, field('Your name', input('text', c.ownerName || 'Juan', (x) => f.ownerName = x)), field('Stalled after (days)', input('number', c.staleDays || 7, (x) => f.staleDays = Number(x))), field('New clients per month', input('number', c.goalClients || 2, (x) => f.goalClients = Number(x))), field('Monthly revenue goal (low)', input('number', c.goalLow || 3000, (x) => f.goalLow = Number(x))), field('Monthly revenue goal (high)', input('number', c.goalHigh || 5000, (x) => f.goalHigh = Number(x)))), h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn primary', onclick: () => act(() => api('POST', '/config', f), 'Saved') }, 'Save'))));
    const dz = h('div', { class: 'dropzone' }, 'Drop an export file here (from HQ or from this CRM), or click to choose one.');
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: (e) => importFile(e.target.files[0]) });
    dz.onclick = () => fileInput.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); importFile(e.dataTransfer.files[0]); };
    async function importFile(file) { if (!file) return; try { const text = await file.text(); const bundle = JSON.parse(text); const r = await api('POST', '/import', { bundle }); toast('Imported: ' + Object.entries(r.report).filter(([, x]) => x.added).map(([k, x]) => `${k} +${x.added}`).join(', ') || 'nothing new'); } catch (e) { toast('Import failed: ' + e.message, true); } }
    v.append(h('div', { class: 'panel', style: 'margin-top:14px' }, h('h2', {}, 'Import and export'), dz, fileInput, h('div', { class: 'row', style: 'margin-top:12px' }, h('a', { class: 'btn ghost', href: '/api/export', download: '' }, 'Download a full export'), h('span', { class: 'muted' }, 'Daily backups are kept automatically in the CRM folder inside your vault.'))));
    v.append(h('div', { class: 'panel', style: 'margin-top:14px' }, h('h2', {}, 'Motion'), h('p', { class: 'muted' }, 'Motion reads and writes this CRM directly. Try: "Motion, how is the pipeline?", "What is next with Jack\'s Firehouse?", "I just called Vera Bar, they want a demo Friday", "Move Manayunk Brewing to contacted", "Add a task: send the Taproom proposal by Friday".')));
  }

  /* ---------- Lead drawer ---------- */
  async function openLead(id) {
    const l = await api('GET', `/leads/${id}`);
    closeDrawer();
    const root = $('#drawer-root');
    const scrim = h('div', { class: 'scrim', onclick: closeDrawer });
    const d = h('div', { class: 'drawer' });
    const stageSel = h('select', { onchange: async (e) => { const st = e.target.value; let reason = ''; if (st === 'lost') reason = prompt('Reason it was lost?') || ''; await act(() => api('POST', `/leads/${id}/stage`, { stage: st, reason }), `Moved to ${stageName(st)}`); openLead(id); } }, S.data.stages.map(s => h('option', { value: s, selected: l.stage === s }, stageName(s))));
    d.append(h('div', { class: 'spread' }, h('div', {}, h('h1', {}, l.business), h('div', { class: 'muted' }, [l.contact, l.industry, l.area].filter(Boolean).join(' · '))), h('button', { class: 'btn ghost sm', onclick: closeDrawer }, 'Close')));
    d.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'muted' }, 'Stage'), stageSel, l.flags.map(x => h('span', { class: 'flag' + (/No next/.test(x) ? ' y' : '') }, x))));
    d.append(h('div', { class: 'row', style: 'margin-top:12px' }, l.phone ? h('a', { class: 'btn sm', href: `tel:${l.phone.replace(/\D/g, '')}` }, 'Call ' + l.phone) : null, l.email ? h('a', { class: 'btn sm', href: `mailto:${l.email}` }, 'Email') : null, l.website ? h('a', { class: 'btn sm ghost', href: l.website, target: '_blank', rel: 'noopener' }, 'Website') : null, h('button', { class: 'btn sm ghost', onclick: () => taskModal(id) }, '+ Task'), h('button', { class: 'btn sm ghost', onclick: () => apptModal(id) }, '+ Appointment'), h('button', { class: 'btn sm ghost', onclick: () => editLead(l) }, 'Edit')));
    // quick log
    const txt = h('textarea', { placeholder: 'Log a call, a note, what they said…', style: 'width:100%;min-height:70px' });
    const type = select([['note', 'Note'], ['call', 'Call'], ['email_sent', 'Email sent'], ['sms_sent', 'Text sent'], ['reply', 'Reply received'], ['meeting', 'Meeting']], 'note', () => {});
    d.append(h('section', {}, h('h2', {}, 'Log activity'), h('div', { class: 'form' }, h('div', { class: 'full' }, txt), field('Type', type), h('div', { style: 'align-self:end' }, h('button', { class: 'btn primary', onclick: async () => { if (!txt.value.trim()) return; await act(() => api('POST', `/leads/${id}/activity`, { type: type.value, text: txt.value.trim() }), 'Logged'); openLead(id); } }, 'Save')))));
    const next = h('div', { class: 'form' }, field('Next step', input('text', l.nextStep || '', (v) => l.nextStep = v)), field('Next date', input('date', l.nextDate || '', (v) => l.nextDate = v)), h('div', { style: 'align-self:end' }, h('button', { class: 'btn sm', onclick: async () => { await act(() => api('PATCH', `/leads/${id}`, { nextStep: l.nextStep, nextDate: l.nextDate }), 'Next step saved'); openLead(id); } }, 'Save next step')));
    d.append(h('section', {}, h('h2', {}, 'Next step'), next));
    d.append(h('section', {}, h('h2', {}, 'Details'), h('dl', { class: 'kv' }, ...[['Contact', l.contact], ['Phone', l.phone], ['Email', l.email], ['Website', l.website], ['Source', l.source], ['Campaign', l.campaign], ['Priority', l.priority], ['Status', l.status || 'Active'], ['Setup', l.setup ? fmt$(l.setup) : ''], ['Monthly', l.monthly ? fmt$(l.monthly) : ''], ['Created', fmtDate(l.created)], ['In stage since', l.stageSince ? daysSince(l.stageSince) + ' days' : ''], ['Tags', (l.tags || []).join(', ')]].filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))));
    if (l.notes) d.append(h('section', {}, h('h2', {}, 'Notes'), h('div', { style: 'white-space:pre-wrap;font-size:13px' }, l.notes)));
    const props = S.data.proposals.filter(p => p.leadId === id), appts = S.data.appointments.filter(a => a.leadId === id), tasks = S.data.tasks.filter(t => t.leadId === id && !t.done);
    if (props.length || appts.length || tasks.length) d.append(h('section', {}, h('h2', {}, 'Related'), h('ul', { class: 'list' }, props.map(p => h('li', { onclick: () => proposalModal(p) }, h('span', { class: 't' }, 'Proposal: ' + (p.title || p.service)), h('span', { class: 'pill' }, p.status || 'draft'))), appts.map(a => h('li', {}, h('span', { class: 't' }, `${a.title} ${fmtDate(a.date)} ${a.time}`), h('span', { class: 'pill' }, a.status || 'booked'))), tasks.map(t => h('li', {}, h('span', { class: 't' }, 'Task: ' + t.title), h('span', { class: 'pill dim' }, t.due ? fmtDate(t.due) : ''))))));
    d.append(h('section', {}, h('h2', {}, 'Timeline'), l.activities.length ? h('ul', { class: 'timeline' }, l.activities.map(a => h('li', { class: a.type }, h('div', {}, a.text), h('div', { class: 'at' }, `${fmtStamp(a.at)} · ${a.by || ''}`)))) : h('div', { class: 'muted' }, 'No activity yet.')));
    root.append(scrim, d);
    S.drawer = id;
  }
  function closeDrawer() { $('#drawer-root').innerHTML = ''; S.drawer = null; }
  function editLead(l) {
    const f = { ...l };
    modal('Edit lead', leadForm(f), async () => { await api('PATCH', `/leads/${l._id}`, pick(f, ['business', 'contact', 'email', 'phone', 'industry', 'source', 'priority', 'setup', 'monthly', 'notes', 'area', 'website', 'campaign', 'status'])); toast('Saved'); openLead(l._id); });
  }
  function newLead() {
    const f = { industry: 'Other', source: 'Other', priority: '' };
    modal('New lead', leadForm(f), async () => { const l = await api('POST', '/leads', f); toast('Lead added'); openLead(l._id); });
  }
  function leadForm(f) {
    const inds = ['Bar / restaurant', 'Cleaning / janitorial', 'HVAC', 'Landscaping', 'Dental / medical', 'Salon / spa', 'Law office', 'Real estate', 'Construction / trades', 'Auto', 'Fitness', 'Other'];
    const srcs = ['Website form', 'Inbound', 'Cold email', 'Cold call / text', 'LinkedIn', 'Referral', 'Walk-in / local', 'AI receptionist', 'Other'];
    return h('div', { class: 'form' }, field('Business', input('text', f.business || '', (v) => f.business = v), 'full'), field('Contact name', input('text', f.contact || '', (v) => f.contact = v)), field('Phone', input('tel', f.phone || '', (v) => f.phone = v)), field('Email', input('email', f.email || '', (v) => f.email = v)), field('Website', input('text', f.website || '', (v) => f.website = v)), field('Industry', select(inds, f.industry, (v) => f.industry = v)), field('Source', select(srcs, f.source, (v) => f.source = v)), field('Area', input('text', f.area || '', (v) => f.area = v)), field('Priority', select([['', '—'], ['A', 'A'], ['B', 'B'], ['C', 'C']], f.priority || '', (v) => f.priority = v)), field('Setup fee', input('number', f.setup || '', (v) => f.setup = Number(v))), field('Monthly', input('number', f.monthly || '', (v) => f.monthly = Number(v))), field('Campaign', input('text', f.campaign || '', (v) => f.campaign = v)), field('Status', select(['Active', 'Nurture', 'Client', 'Do not contact', 'Archived'], f.status || 'Active', (v) => f.status = v)), field('Notes', textarea(f.notes || '', (v) => f.notes = v), 'full'));
  }

  /* ---------- form helpers ---------- */
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  function field(label, control, cls) { return h('label', { class: cls || '' }, label, control); }
  function input(type, value, on) { return h('input', { type, value: value == null ? '' : value, oninput: (e) => on(e.target.value) }); }
  function textarea(value, on) { return h('textarea', { oninput: (e) => on(e.target.value) }, value || ''); }
  function select(opts, value, on) { const s = h('select', { onchange: (e) => on(e.target.value) }, opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === value }, l); })); return s; }
  function leadPicker(value, on) {
    const list = leads().slice().sort((a, b) => a.business.localeCompare(b.business));
    const s = h('select', { onchange: (e) => on(e.target.value) }, h('option', { value: '' }, '— choose a lead —'), list.map(l => h('option', { value: l._id, selected: l._id === value }, l.business)));
    if (value) on(value);
    return s;
  }
  function modal(title, body, onSave) {
    const root = $('#modal-root'); root.innerHTML = '';
    const box = h('div', { class: 'box' }, h('div', { class: 'spread' }, h('h1', {}, title), h('button', { class: 'btn ghost sm', onclick: () => root.innerHTML = '' }, 'Close')), body, h('div', { class: 'row', style: 'margin-top:16px;justify-content:flex-end' }, h('button', { class: 'btn ghost', onclick: () => root.innerHTML = '' }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { await onSave(); root.innerHTML = ''; } catch (e) { toast(e.message, true); } } }, 'Save')));
    root.append(h('div', { class: 'modal', onclick: (e) => { if (e.target.classList.contains('modal')) root.innerHTML = ''; } }, box));
  }

  /* ---------- wiring ---------- */
  $('#btn-new-lead').onclick = newLead;
  $('#global-search').oninput = (e) => { S.filters.q = e.target.value; if (S.tab !== 'leads') go('leads'); else render(); };
  window.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); $('#global-search').focus(); } if (e.key === 'Escape') { closeDrawer(); $('#modal-root').innerHTML = ''; } });
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== S.tab) { S.tab = t; render(); } });
  // Live refresh when Motion (or another window) changes data.
  let refreshTimer = null;
  try { const es = new EventSource(API + '/events'); es.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.kind === 'hello') return; } catch (_) {} clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => { await load(); if (S.drawer) openLead(S.drawer); }, 300); }; } catch (_) {}
  load().catch((e) => { $('#view').innerHTML = `<div class="empty">Could not reach the CRM service: ${e.message}. Is AURELIUM running?</div>`; });
})();
