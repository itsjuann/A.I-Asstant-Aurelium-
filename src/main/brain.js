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

class Brain {
  constructor({ osName }) {
    this.osName = osName;
    this.history = [];
    this.client = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : null;
    this.useFallbacks = true;
  }

  get ready() { return !!this.client || config.mockBrain; }

  reset() { this.history = []; }

  // Ask Claude. Streams text deltas (onDelta) and complete sentences (onSentence). Returns the full reply.
  async ask(userText, { onDelta = () => {}, onSentence = () => {}, signal } = {}) {
    this.history.push({ role: 'user', content: userText });
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);

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

    const params = {
      model: config.claudeModel,
      max_tokens: 2048,
      system: [{ type: 'text', text: systemPrompt({ userName: config.userName, osName: this.osName, now: new Date().toString() }) }],
      messages: this.history,
      output_config: { effort: config.claudeEffort }
    };

    const run = async (withFallbacks) => {
      const stream = withFallbacks
        ? this.client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
        : this.client.messages.stream(params, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') feed(event.delta.text);
      }
      return stream.finalMessage();
    };

    let final;
    try {
      final = await run(this.useFallbacks);
    } catch (err) {
      // If the account or endpoint rejects the fallback option, retry once without it and remember that.
      if (this.useFallbacks && err instanceof Anthropic.BadRequestError && !full) {
        this.useFallbacks = false;
        final = await run(false);
      } else {
        this.history.pop();
        throw err;
      }
    }
    splitter.flush();
    if (final && final.stop_reason === 'refusal') {
      const note = 'I would rather not go there. Give me a different angle and I will help.';
      if (!full) feed(note);
    }
    this.history.push({ role: 'assistant', content: full.trim() || '...' });
    return full.trim();
  }
}

// Translate SDK errors into one plain sentence for the HUD and the voice.
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'My Anthropic key was rejected. Check ANTHROPIC_API_KEY in the dot env file.';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate limiting us. Give it a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'I cannot reach Anthropic. Check the internet connection.';
  if (err instanceof Anthropic.APIError) return `Anthropic returned an error: ${err.status || ''} ${err.message}`.trim();
  return err && err.message ? err.message : 'Unknown error.';
}

module.exports = { Brain, describeError, cleanForSpeech, SentenceSplitter };
