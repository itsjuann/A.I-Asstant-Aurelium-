// Tools the brain can call. Each has a JSON schema for Claude and a handler that runs locally.
'use strict';
const { FOLDERS } = require('./vault');

function buildTools({ vault, log }) {
  const defs = [
    {
      name: 'search_vault',
      description: 'Search Juan\'s second brain (Obsidian vault) for notes matching a query. Use this BEFORE answering anything about his businesses, clients, people, plans, numbers or past decisions. Returns the best matching notes with snippets.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Keywords or a short phrase' }, limit: { type: 'integer', description: 'How many results, 1 to 20' } }, required: ['query'], additionalProperties: false },
      strict: false,
      run: ({ query, limit }) => ({ results: vault.search(query, Math.max(1, Math.min(20, limit || 8))) })
    },
    {
      name: 'read_note',
      description: 'Read the full content of one note by its vault path, e.g. "02 Companies/PeakHive.md".',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      strict: false,
      run: ({ path }) => ({ path, content: vault.readNote(path).slice(0, 12000) })
    },
    {
      name: 'list_notes',
      description: 'List note paths in the vault, optionally within one folder.',
      input_schema: { type: 'object', properties: { folder: { type: 'string', description: `One of: ${FOLDERS.join(', ')} or empty for all` } }, required: [], additionalProperties: false },
      strict: false,
      run: ({ folder }) => ({ notes: vault.listNotes(folder || '').slice(0, 300) })
    },
    {
      name: 'create_note',
      description: 'Create a NEW note. Never overwrites: fails if a note with that title exists in the folder. Use for "remember this", brain dumps, new clients, people, ideas, SOPs. Write clean Markdown with a short title. Add wikilinks to related notes via the links field.',
      input_schema: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: `Exactly one of: ${FOLDERS.join(', ')}` },
          title: { type: 'string' },
          content: { type: 'string', description: 'Markdown body. Start with a one-line summary.' },
          links: { type: 'array', items: { type: 'string' }, description: 'Related note paths or titles for [[wikilinks]], e.g. "02 Companies/PeakHive"' }
        },
        required: ['folder', 'title', 'content'], additionalProperties: false
      },
      strict: true,
      run: ({ folder, title, content, links }) => {
        const p = vault.createNote(folder, title, content, links || []);
        vault.appendDaily('Log', `Filed note [[${p.replace(/\.md$/, '')}]]`);
        log && log('note created', p);
        return { created: p };
      }
    },
    {
      name: 'append_note',
      description: 'Append text to the end of an existing note. Never replaces content. Ask Juan before appending anything large or changing meaning.',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'], additionalProperties: false },
      strict: true,
      run: ({ path, text }) => { const p = vault.appendNote(path, text); vault.appendDaily('Log', `Appended to [[${p.replace(/\.md$/, '')}]]`); return { appended: p }; }
    },
    {
      name: 'append_daily',
      description: 'Append to today\'s daily note. section: "Tasks" adds a checkbox task, "Notes" adds a note, "Log" adds a timestamped log line, "Briefing" adds briefing text.',
      input_schema: { type: 'object', properties: { section: { type: 'string', enum: ['Tasks', 'Notes', 'Log', 'Briefing'] }, text: { type: 'string' } }, required: ['section', 'text'], additionalProperties: false },
      strict: true,
      run: ({ section, text }) => ({ daily: vault.appendDaily(section, text) })
    },
    {
      name: 'link_notes',
      description: 'Add a [[wikilink]] from one note to another (appends a "See [[...]]" line). Both notes must exist.',
      input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, context: { type: 'string', description: 'Optional short reason for the link' } }, required: ['from', 'to'], additionalProperties: false },
      strict: true,
      run: ({ from, to, context }) => ({ linked: vault.linkNotes(from, to, context || '') })
    },
    {
      name: 'open_tasks',
      description: 'List open (unchecked) and done tasks from the daily notes of the last few days.',
      input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'How many days back, 1 to 30' } }, required: [], additionalProperties: false },
      strict: false,
      run: ({ days }) => ({ tasks: vault.openTasks(Math.max(1, Math.min(30, days || 7))) })
    }
  ];
  const handlers = Object.fromEntries(defs.map(d => [d.name, d.run]));
  const schemas = defs.map(({ run, ...rest }) => rest);
  return { schemas, handlers };
}

module.exports = { buildTools };
