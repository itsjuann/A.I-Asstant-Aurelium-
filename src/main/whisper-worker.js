// Runs Whisper locally (transformers.js + ONNX Runtime) in its own process.
// Protocol: receives {type:'transcribe', id, samples}, replies {type:'result', id, text}.
'use strict';
const path = require('path');
const fs = require('fs');

const port = process.parentPort;
const send = (m) => port.postMessage(m);
const modelName = process.env.AURELIUM_WHISPER_MODEL || 'Xenova/whisper-base.en';
const cacheDir = process.env.AURELIUM_MODEL_CACHE || path.join(process.cwd(), 'models');

let transcriber = null;

async function load() {
  fs.mkdirSync(cacheDir, { recursive: true });
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  send({ type: 'status', text: `Loading speech model ${modelName} (downloads once, about 75 MB)...` });
  let lastPct = -1;
  transcriber = await pipeline('automatic-speech-recognition', modelName, {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (p) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        const pct = Math.floor(p.progress);
        if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; send({ type: 'status', text: `Downloading speech model: ${pct}%` }); }
      }
    }
  });
  // Warm the pipeline with half a second of silence so the first real request is fast.
  await transcriber(new Float32Array(8000), { chunk_length_s: 30 });
  send({ type: 'status', text: 'Local speech recognition ready.' });
  send({ type: 'ready' });
}

port.on('message', async (e) => {
  const msg = e.data;
  if (msg.type !== 'transcribe') return;
  try {
    if (!transcriber) throw new Error('model not loaded');
    const samples = Float32Array.from(msg.samples);
    const out = await transcriber(samples, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (out && out.text ? out.text : '').replace(/\[.*?\]|\(.*?\)/g, '').trim();
    send({ type: 'result', id: msg.id, text });
  } catch (err) {
    send({ type: 'result', id: msg.id, error: err.message });
  }
});

load().catch((err) => { send({ type: 'fatal', error: err.message }); });
