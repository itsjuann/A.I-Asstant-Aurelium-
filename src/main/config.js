// Loads .env and exposes AURELIUM's configuration with sensible defaults.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) require('dotenv').config({ path: ENV_FILE, quiet: true });

// Honour an HTTPS proxy if the machine has one (corporate networks, sandboxes). Harmless otherwise.
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  try { const { setGlobalDispatcher, EnvHttpProxyAgent } = require('undici'); setGlobalDispatcher(new EnvHttpProxyAgent()); } catch (_) {}
}

const str = (k, d = '') => (process.env[k] || '').trim() || d;
const bool = (k, d = false) => { const v = str(k).toLowerCase(); return v ? ['1', 'true', 'on', 'yes'].includes(v) : d; };

const config = {
  root: ROOT,
  userName: str('USER_NAME', 'Juan'),
  assistantName: str('ASSISTANT_NAME', 'Motion'),
  webSearch: bool('WEB_SEARCH', true),
  anthropicKey: str('ANTHROPIC_API_KEY'),
  claudeModel: str('CLAUDE_MODEL', 'claude-opus-5-5'),
  claudeEffort: str('CLAUDE_EFFORT', 'low'),
  elevenKey: str('ELEVENLABS_API_KEY'),
  elevenVoiceId: str('ELEVENLABS_VOICE_ID'),
  elevenModel: str('ELEVENLABS_MODEL', 'eleven_flash_v2_5'),
  openaiKey: str('OPENAI_API_KEY'),
  sttMode: str('STT_MODE', 'auto').toLowerCase(),         // auto | local | elevenlabs | openai
  whisperModel: str('WHISPER_MODEL', 'Xenova/whisper-base.en'),
  modelCacheDir: str('MODEL_CACHE_DIR', path.join(ROOT, 'models')),
  wakeWord: bool('WAKE_WORD', true),
  followUpSeconds: parseInt(str('FOLLOW_UP_SECONDS', '12'), 10) || 12,
  wakeWordText: str('WAKE_WORD_TEXT', str('ASSISTANT_NAME', 'Motion')).toLowerCase(),
  pttHotkey: str('PTT_HOTKEY', 'Alt+Space'),
  vaultPath: str('VAULT_PATH'),
  crmPort: parseInt(str('CRM_PORT', '4747'), 10) || 4747,
  crmDir: str('CRM_DIR'),
  mockBrain: bool('AURELIUM_MOCK_BRAIN', false)
};

// Decide where speech-to-text should run. Apple Silicon with 8 GB+ handles local Whisper comfortably.
function resolveSttMode() {
  if (config.sttMode !== 'auto') return config.sttMode;
  const ramGB = os.totalmem() / 1024 / 1024 / 1024;
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const strongIntel = os.cpus().length >= 8 && ramGB >= 16;
  if ((appleSilicon && ramGB >= 8) || strongIntel) return 'local';
  if (config.elevenKey) return 'elevenlabs';
  if (config.openaiKey) return 'openai';
  return 'local';
}
config.sttResolved = resolveSttMode();

// Human-readable readiness report shown in the HUD and by `npm run doctor`.
function readiness() {
  return {
    brain: config.anthropicKey ? 'ready' : 'missing ANTHROPIC_API_KEY',
    voice: !config.elevenKey ? 'missing ELEVENLABS_API_KEY' : (!config.elevenVoiceId ? 'missing ELEVENLABS_VOICE_ID' : 'ready'),
    stt: config.sttResolved === 'local' ? `local Whisper (${config.whisperModel})`
      : config.sttResolved === 'elevenlabs' ? (config.elevenKey ? 'ElevenLabs Scribe' : 'missing ELEVENLABS_API_KEY')
      : config.sttResolved === 'openai' ? (config.openaiKey ? 'OpenAI Whisper API' : 'missing OPENAI_API_KEY')
      : `unknown STT_MODE "${config.sttResolved}"`,
    wakeWord: config.wakeWord ? `on ("${config.wakeWordText}")` : 'off',
    hotkey: config.pttHotkey,
    assistantName: config.assistantName,
    followUpSeconds: config.followUpSeconds,
    wakeOn: config.wakeWord,
    web: config.webSearch ? 'on' : 'off',
    crmUrl: `http://127.0.0.1:${config.crmPort}`
  };
}

module.exports = { config, readiness };
