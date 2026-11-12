// Phase 4 actions: open apps and websites, create tasks, draft emails. Never sends anything.
'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout));
});

const APP_NAME_OK = /^[A-Za-z0-9 .'_+&-]{1,60}$/;
const APP_ALIASES = {
  darwin: { browser: 'Safari', chrome: 'Google Chrome', mail: 'Mail', email: 'Mail', calendar: 'Calendar', notes: 'Notes', obsidian: 'Obsidian', terminal: 'Terminal', finder: 'Finder', messages: 'Messages', music: 'Music', spotify: 'Spotify', slack: 'Slack', zoom: 'zoom.us', vscode: 'Visual Studio Code', code: 'Visual Studio Code', settings: 'System Settings', shopify: 'Shopify' },
  win32: { browser: 'msedge', chrome: 'chrome', mail: 'outlook', email: 'outlook', calendar: 'outlookcal:', notes: 'notepad', terminal: 'wt', explorer: 'explorer', settings: 'ms-settings:' },
  linux: { browser: 'xdg-open https://', terminal: 'x-terminal-emulator' }
};

async function openApp(name) {
  const raw = String(name || '').trim();
  if (!APP_NAME_OK.test(raw)) throw new Error('App name contains unsupported characters.');
  const aliases = APP_ALIASES[process.platform] || {};
  const target = aliases[raw.toLowerCase()] || raw;
  if (process.platform === 'darwin') { await run('open', ['-a', target]); return `Opened ${target}.`; }
  if (process.platform === 'win32') { await run('cmd', ['/c', 'start', '', target]); return `Opened ${target}.`; }
  try { await run('gtk-launch', [target.toLowerCase()]); } catch (_) { await run('sh', ['-c', `nohup ${target.toLowerCase()} >/dev/null 2>&1 &`]); }
  return `Opened ${target}.`;
}

async function openUrl(url) {
  let u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { new URL(u); } catch (_) { throw new Error('That is not a valid web address.'); }
  if (process.platform === 'darwin') await run('open', [u]);
  else if (process.platform === 'win32') await run('cmd', ['/c', 'start', '', u]);
  else await run('xdg-open', [u]);
  return `Opened ${u} in the browser.`;
}

// Writes the draft into the vault and opens the default mail app with it prefilled. Nothing is sent.
async function draftEmail({ to, subject, body }, vault, { compose = true } = {}) {
  const safe = (s) => String(s || '').trim();
  const t = safe(to), sub = safe(subject), b = safe(body);
  if (!sub && !b) throw new Error('A draft needs at least a subject or a body.');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
  const title = `Email draft - ${sub || 'untitled'} - ${stamp}`;
  const content = `# ${title}\n\nStatus: DRAFT (not sent)\nTo: ${t || '(unspecified)'}\nSubject: ${sub}\n\n---\n\n${b}\n`;
  const notePath = vault.createNote('00 Inbox', title, content, []);
  let opened = false;
  if (compose) {
    const mailto = `mailto:${encodeURIComponent(t)}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(b)}`;
    try {
      if (process.platform === 'darwin') await run('open', [mailto]);
      else if (process.platform === 'win32') await run('cmd', ['/c', 'start', '', mailto.replace(/&/g, '^&')]);
      else await run('xdg-open', [mailto]);
      opened = true;
    } catch (_) { opened = false; }
  }
  return { draft: notePath, composeWindowOpened: opened, note: opened
    ? 'Draft saved in the vault and opened in the mail app for Juan to review. It has NOT been sent; only Juan can press Send.'
    : 'Draft saved in the vault (00 Inbox). The mail app could not be opened automatically. Nothing has been sent.' };
}

function buildActionTools({ vault, log }) {
  const logIt = (text) => { try { vault.appendDaily('Log', text); } catch (_) {} log && log(text); };
  const defs = [
    {
      name: 'open_app',
      description: 'Open an application on this computer by name, e.g. "Safari", "Mail", "Obsidian", "Spotify", "Slack". Use for "open ..." requests about apps.',
      input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, strict: true,
      run: async ({ name }) => { const r = await openApp(name); logIt(`Opened app: ${name}`); return { result: r }; }
    },
    {
      name: 'open_website',
      description: 'Open a website or URL in the default browser. Use for "open ..." / "go to ..." / "pull up ..." requests about sites.',
      input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Full URL or domain, e.g. https://shopify.com or peakhive.com' } }, required: ['url'], additionalProperties: false }, strict: true,
      run: async ({ url }) => { const r = await openUrl(url); logIt(`Opened website: ${url}`); return { result: r }; }
    },
    {
      name: 'create_task',
      description: 'Add a task to today\'s daily note. Use for "add a task", "remind me to", "put ... on my list".',
      input_schema: { type: 'object', properties: { text: { type: 'string' }, due: { type: 'string', description: 'Optional due date YYYY-MM-DD or a short phrase like "Friday"' } }, required: ['text'], additionalProperties: false }, strict: true,
      run: async ({ text, due }) => { const line = due ? `${text.trim()} (due ${due})` : text.trim(); const p = vault.appendDaily('Tasks', line); logIt(`Task added: ${line}`); return { added: line, note: p }; }
    },
    {
      name: 'draft_email',
      description: 'DRAFT an email: saves it as a note in the vault and opens it in the mail app for Juan to review. This tool CANNOT send. Never claim an email was sent. Use when Juan asks to draft, write or prepare an email.',
      input_schema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email address or name; empty if unknown' }, subject: { type: 'string' }, body: { type: 'string', description: 'Full email body in plain text, signed as Juan' } }, required: ['to', 'subject', 'body'], additionalProperties: false }, strict: true,
      run: async ({ to, subject, body }) => { const r = await draftEmail({ to, subject, body }, vault); logIt(`Email drafted to ${to || '(unspecified)'}: ${subject}`); return r; }
    }
  ];
  return { schemas: defs.map(({ run, ...rest }) => rest), handlers: Object.fromEntries(defs.map(d => [d.name, d.run])) };
}

// Anthropic-hosted web tools: searching and reading pages happens on Anthropic's side.
const WEB_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }
];

module.exports = { buildActionTools, openApp, openUrl, draftEmail, WEB_TOOLS };
