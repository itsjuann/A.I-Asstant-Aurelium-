// The brain: streams replies from Claude and hands finished sentences to the voice.
'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('./config');
const { systemPrompt } = require('./personality');

const MAX_HISTORY = 40;          // messages kept in the rolling conversation
const SENTENCE_MIN_CHARS = 24;   // avoid speaking tiny fragments like "Mr."

// Turns a text stream into spoken sentences.
class SentenceSplitter {
  constructor(onSentence) { this.buf = ''; this.onSentence = onSentence; }
  push(text) {
    this.buf += text;
    // Split on sentence enders followed by whitespace, keep accumulating short bits.
    let m;
    const re = /[.!?…]+["')\]]?\s+/g;
    let last = 0;
    while ((m = re.exec(this.buf)) !== null) {
      const end = m.index + m[0].length;
      const candidate = this.buf.slice(last, end).trim();
      if (candidate.length >= SENTENCE_MIN_CHARS) { this.onSentence(candidate); last = end; }
    }
    this.buf = this.buf.slice(last);
  }
  flush() { const rest = this.buf.trim(); this.buf = ''; if (rest) this.onSentence(rest); }
}

// Strip anything that would sound wrong when read aloud.
function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_TOOL_ROUNDS = 8;

class Brain {
  constructor({ osName, tools = null, vaultRoot = '', onToolUse = () => {}, onServerTool = () => {}, webTools = [], getCompanies = () => [] }) {
    this.getCompanies = getCompanies;
    this.osName = osName;
    this.tools = tools;            // { schemas, handlers } or null
    this.vaultRoot = vaultRoot;
    this.onToolUse = onToolUse;
    this.onServerTool = onServerTool;
    this.webTools = webTools;      // Anthropic-hosted tools (web search / fetch)
    this.webEnabled = webTools.length > 0;
    this.history = [];
    this.client = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : null;
    this.useFallbacks = true;
  }

  get ready() { return !!this.client || config.mockBrain; }

  reset() { this.history = []; }

  // Ask Claude. Streams text deltas (onDelta) and complete sentences (onSentence). Returns the full reply.
  async ask(userText, { onDelta = () => {}, onSentence = () => {}, signal } = {}) {
    this.history.push({ role: 'user', content: userText });

    const splitter = new SentenceSplitter((s) => onSentence(cleanForSpeech(s)));
    let full = '';
    const feed = (t) => { full += t; onDelta(t); splitter.push(t); };

    if (config.mockBrain || !this.client) {
      const reply = config.mockBrain
        ? `Understood, ${config.userName}. This is the rehearsal brain speaking, so I cannot think yet. Once your Anthropic key is in place, I will.`
        : `I am not connected to Claude yet, ${config.userName}. Add your Anthropic key to the dot env file and restart me.`;
      for (const word of reply.split(' ')) { feed(word + ' '); await new Promise(r => setTimeout(r, 25)); }
      splitter.flush();
      this.history.push({ role: 'assistant', content: full.trim() });
      return full.trim();
    }

    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const params = {
      model: config.claudeModel,
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt({
        userName: config.userName, osName: this.osName, now: today.toString(), vaultRoot: this.vaultRoot,
        today: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
        assistantName: config.assistantName, web: this.webEnabled, companies: this.getCompanies()
      }) }],
      messages: this.history,
      output_config: { effort: config.claudeEffort }
    };
    const toolList = [...(this.tools ? this.tools.schemas.map(t => ({ ...t })) : []), ...(this.webEnabled ? this.webTools : [])];
    // API limits for strict tools: at most 20 strict tools, and at most 24 optional parameters across them.
    // Relax the tools with the most optional parameters first, rather than fail the request.
    const optionalCount = (t) => { const props = Object.keys((t.input_schema && t.input_schema.properties) || {}); const req = (t.input_schema && t.input_schema.required) || []; return props.filter(p => !req.includes(p)).length; };
    const strictTools = () => toolList.filter(t => t.strict);
    while (strictTools().length > 20 || strictTools().reduce((n, t) => n + optionalCount(t), 0) > 24) {
      const worst = strictTools().sort((a, b) => optionalCount(b) - optionalCount(a))[0];
      if (!worst) break;
      worst.strict = false;
    }
    if (toolList.length) params.tools = toolList;

    const run = async (withFallbacks) => {
      const stream = withFallbacks
        ? this.client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
        : this.client.messages.stream(params, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') feed(event.delta.text);
      }
      return stream.finalMessage();
    };

    const startLen = this.history.length;
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let final;
        try {
          final = await run(this.useFallbacks);
        } catch (err) {
          if (err instanceof Anthropic.BadRequestError && !full && this.webEnabled && /web_search|web_fetch/i.test(err.message)) {
            // This account cannot use the hosted web tools: drop them and carry on.
            this.webEnabled = false;
            params.tools = this.tools ? this.tools.schemas : undefined;
            final = await run(this.useFallbacks);
          } else if (this.useFallbacks && err instanceof Anthropic.BadRequestError && !full) {
            // If the account or endpoint rejects the fallback option, retry once without it and remember that.
            this.useFallbacks = false; final = await run(false);
          } else throw err;
        }
        // Keep the full content (thinking + text + tool_use + web results) so the conversation stays valid.
        this.history.push({ role: 'assistant', content: final.content });
        for (const b of final.content) if (b.type === 'server_tool_use') this.onServerTool(b.name, b.input);
        if (final.stop_reason === 'refusal') { if (!full) feed('I would rather not go there. Give me a different angle and I will help.'); break; }
        if (final.stop_reason === 'pause_turn') continue;   // server-side web work paused; resend to let it resume
        if (final.stop_reason !== 'tool_use' || !this.tools) break;
        const uses = final.content.filter(b => b.type === 'tool_use');
        const results = [];
        for (const u of uses) {
          let input = u.input;
          if (typeof input === 'string') { try { input = JSON.parse(input); } catch (_) { input = {}; } }
          this.onToolUse(u.name, input);
          try {
            const handler = this.tools.handlers[u.name];
            if (!handler) throw new Error(`Unknown tool ${u.name}`);
            const out = await handler(input || {});
            results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) });
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: u.id, content: `Error: ${err.message}`, is_error: true });
          }
        }
        this.history.push({ role: 'user', content: results });
        if (round === MAX_TOOL_ROUNDS) feed(' I have gone as far as I can on that for now.');
      }
    } catch (err) {
      this.history.length = startLen - 1;   // drop this turn entirely so history stays consistent
      throw err;
    }
    splitter.flush();
    if (this.history.length > MAX_HISTORY) this._trimHistory();
    return full.trim();
  }

  // Trim from the front but never split a tool_use / tool_result pair.
  _trimHistory() {
    let cut = this.history.length - MAX_HISTORY;
    while (cut < this.history.length && !(this.history[cut].role === 'user' && typeof this.history[cut].content === 'string')) cut++;
    this.history = this.history.slice(cut);
  }
}

// Translate SDK errors into one plain sentence for the HUD and the voice.
function describeError(err) {
  const msg = (err && err.message) || '';
  if (/credit balance|billing|insufficient/i.test(msg)) return 'Anthropic says the account has no credit left. Add credit at console.anthropic.com under Billing, then try again.';
  if (err instanceof Anthropic.AuthenticationError) return 'My Anthropic key was rejected. Check ANTHROPIC_API_KEY in the dot env file.';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate limiting us. Give it a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'I cannot reach Anthropic. Check the internet connection.';
  if (err instanceof Anthropic.APIError) return `Anthropic returned an error: ${err.status || ''} ${err.message}`.trim();
  return err && err.message ? err.message : 'Unknown error.';
}

module.exports = { Brain, describeError, cleanForSpeech, SentenceSplitter };
