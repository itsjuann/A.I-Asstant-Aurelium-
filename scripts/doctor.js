// Checks every service AURELIUM depends on and explains problems in plain English.
'use strict';
const path = require('path');
const { config, readiness } = require('../src/main/config');
const { describeOS } = require('./detect-os');

const ok = (m) => console.log(`  [OK]   ${m}`);
const bad = (m) => console.log(`  [FAIL] ${m}`);
const info = (m) => console.log(`         ${m}`);

async function checkAnthropic() {
  console.log('\nBrain (Anthropic / Claude)');
  if (!config.anthropicKey) { bad('ANTHROPIC_API_KEY is empty in .env'); info('Get one at https://console.anthropic.com/settings/keys and paste it into .env'); return false; }
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.anthropicKey });
  try {
    const r = await client.messages.create({ model: config.claudeModel, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
    const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    ok(`Claude answered on model ${config.claudeModel}: "${text.slice(0, 40)}"`); return true;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) bad('The Anthropic key was rejected. Re-copy it from the console.');
    else if (err instanceof Anthropic.NotFoundError) bad(`Model ${config.claudeModel} not found. Change CLAUDE_MODEL in .env.`);
    else bad(`Anthropic error: ${err.message}`);
    return false;
  }
}

async function checkElevenLabs() {
  console.log('\nVoice (ElevenLabs)');
  if (!config.elevenKey) { bad('ELEVENLABS_API_KEY is empty in .env'); info('Get one at https://elevenlabs.io/app/settings/api-keys (enable Text to Speech, Speech to Text and Voices)'); return false; }
  if (!config.elevenVoiceId) { bad('ELEVENLABS_VOICE_ID is empty in .env'); return false; }
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/voices/${config.elevenVoiceId}`, { headers: { 'xi-api-key': config.elevenKey } });
    if (res.status === 401) { bad('ElevenLabs rejected the key.'); return false; }
    if (res.status === 404) { bad(`Voice ${config.elevenVoiceId} is not in your ElevenLabs account. Add it from the voice library or change ELEVENLABS_VOICE_ID.`); return false; }
    if (!res.ok) { bad(`ElevenLabs returned ${res.status}`); return false; }
    const v = await res.json();
    ok(`Voice found: ${v.name}`);
    const { synthesize } = require('../src/main/tts');
    const buf = await synthesize('Systems check complete.');
    ok(`Text-to-speech works (${(buf.length / 1024).toFixed(0)} KB of audio in model ${config.elevenModel})`);
    return buf;
  } catch (err) { bad(`ElevenLabs error: ${err.message}`); return false; }
}

async function checkSTT(sampleMp3) {
  console.log(`\nEars (speech-to-text) - mode: ${config.sttResolved}`);
  const r = readiness();
  if (config.sttResolved === 'local') {
    info(`Local Whisper model: ${config.whisperModel}. First load downloads about 75 MB into ${config.modelCacheDir}.`);
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = config.modelCacheDir;
      const t0 = Date.now();
      const asr = await pipeline('automatic-speech-recognition', config.whisperModel, { dtype: 'q8', device: 'cpu' });
      const out = await asr(new Float32Array(16000), { chunk_length_s: 30 });
      ok(`Local Whisper loaded and ran in ${((Date.now() - t0) / 1000).toFixed(1)}s (output on silence: "${(out.text || '').trim()}")`);
    } catch (err) { bad(`Local Whisper failed: ${err.message}`); info('AURELIUM will fall back to ElevenLabs Scribe or OpenAI if a key is set. Or set STT_MODE=elevenlabs in .env.'); }
  } else if (config.sttResolved === 'elevenlabs') {
    if (!config.elevenKey) { bad(r.stt); return; }
    ok('Using ElevenLabs Scribe (cloud).');
  } else if (config.sttResolved === 'openai') {
    if (!config.openaiKey) { bad(r.stt); return; }
    ok('Using OpenAI Whisper API (cloud).');
  }
}

(async () => {
  const os = describeOS();
  console.log(`AURELIUM doctor on ${os.name} ${os.version} (${os.arch}), ${os.ramGB} GB RAM, ${os.cpuCount} cores`);
  console.log(`Config file: ${path.join(config.root, '.env')}`);
  const brain = await checkAnthropic();
  const voice = await checkElevenLabs();
  await checkSTT(voice);
  console.log('\nSummary');
  console.log(`  Brain: ${brain ? 'ready' : 'NOT ready'} | Voice: ${voice ? 'ready' : 'NOT ready'} | Push-to-talk: hold Space in the app, or ${config.pttHotkey} from anywhere | Wake word: ${config.wakeWord ? 'on' : 'off (set WAKE_WORD=on in .env, or press W in the app)'}`);
  if (!brain || !voice) console.log('  Fix the FAIL lines above, then run: npm run doctor');
  process.exit(0);
})();
