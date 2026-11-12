# AURELIUM

AURELIUM is Juan's personal desktop AI assistant: a full-screen "face" made of
18,000 glowing particles, with voice, a brain, and a second brain in Obsidian.
It is being built in phases. This README is updated as each phase lands.

| Phase | What it is | Status |
|-------|------------|--------|
| 1 | The face: full-screen particle entity + HUD | Ready to test |
| 2 | Voice + brain: push-to-talk, Whisper, Claude, ElevenLabs | Ready to test |
| 3 | Second brain: Obsidian vault, memory, morning briefing | Not started |
| 4 | Actions: open apps, tasks, email drafts, web search | Not started |

## What you need on your computer

1. **Node.js** (the LTS version). Download from <https://nodejs.org>, run the installer, accept the defaults.
2. **Git** (to download this project). Windows: <https://git-scm.com/download/win>. macOS: open Terminal, type `git`, and accept the prompt to install developer tools. Linux: `sudo apt install git`.

That is all. AURELIUM detects whether you are on Windows, macOS, or Linux and adapts the launcher and the desktop shortcut automatically.

## First-time setup (one command)

Open a terminal (Windows: press Start, type **cmd**, press Enter. macOS: open **Terminal**). Then paste:

```
git clone -b claude/great-feynman-0xexlk https://github.com/itsjuann/A.I-Asstant-Aurelium-.git AURELIUM
cd AURELIUM
npm run setup
```

`npm run setup` does everything: detects your operating system, installs the
dependencies, creates a `.env` file for later phases, and puts an **AURELIUM**
shortcut on your desktop.

## Launching

Either double-click the **AURELIUM** shortcut on your desktop, or from the
project folder run:

```
npm start
```

Backup launchers if you ever need them: `start-aurelium.cmd` (Windows) or
`start-aurelium.sh` (macOS and Linux) in the project folder. Both install the
dependencies on first run.

## Testing Phase 1: the face

When the app opens you should see a black full-screen window with a blue
particle silhouette (head and shoulders) with a warm gold glow in the chest and
head. Thin panels on the edges show the clock, system stats, today's tasks,
and the transcript area.

Keys while the app is open:

| Key | What it does |
|-----|--------------|
| `1` | Idle: slow breathing |
| `2` | Listening: particles pull inward and brighten |
| `3` | Thinking: swirling orbit |
| `4` | Speaking: pulses with the voice volume (simulated until Phase 2) |
| `D` | Demo cycle through all four states, every 4 seconds |
| `F11` | Toggle between full-screen and a window |
| `Esc` or `Ctrl+Q` (`Cmd+Q` on Mac) | Exit |

Check the **RENDER** line in the top-right panel. It shows the live frame rate.
On any machine with a graphics card it should sit at your screen's refresh rate
(60 fps or higher). If it is lower, tell me what number you see and what GPU
you have.

Today's tasks on the HUD come from `data/tasks.json` for now. Phase 3 replaces
that with your Obsidian daily note.

## Phase 2: voice + brain

### The two keys you need

Open the `.env` file in the AURELIUM folder (TextEdit is fine) and fill in:

| Key | Where to get it |
|-----|-----------------|
| `ANTHROPIC_API_KEY` | <https://console.anthropic.com/settings/keys>, click **Create Key**, copy it. This powers the brain (Claude). |
| `ELEVENLABS_API_KEY` | <https://elevenlabs.io/app/settings/api-keys>, click **Create API Key**. Tick the permissions **Text to Speech**, **Speech to Text** and **Voices**. This powers the voice and, when needed, the ears. |

`ELEVENLABS_VOICE_ID` is already filled in with the voice you chose (Option A, Cate). No OpenAI key is needed.

Then check everything in one go:

```
npm run doctor
```

It prints OK or FAIL for the brain, the voice and the ears, with the fix for each FAIL in plain English.

### How speech-to-text is chosen

On a Mac with Apple Silicon and 8 GB or more, AURELIUM runs **Whisper locally** (nothing leaves your machine for transcription). The first launch downloads the speech model once, about 75 MB, into the `models` folder; the HUD shows the progress. If local Whisper cannot load, it falls back to ElevenLabs Scribe automatically. You can force a mode with `STT_MODE` in `.env` (`local`, `elevenlabs` or `openai`).

### Talking to AURELIUM

| How | What to do |
|-----|-----------|
| Hold to talk | Hold **Space**, speak, release. |
| From any app | Press **Option+Space** once to start, again to stop. (Change with `PTT_HOTKEY` in `.env`.) |
| Wake word | Press **W** in the app, or set `WAKE_WORD=on`. Then say "Aurelium, ..." followed by your request. Say just "Aurelium" and she answers "Yes, Juan?" and waits. |
| Typing | Press **Enter**, type, press Enter. Useful without a microphone. |
| Interrupt | Press Space (or the hotkey) while she is speaking to cut in. Esc stops playback. |
| Start over | Press **R** to clear the conversation. |

macOS will ask for microphone permission the first time. If you ever denied it, go to **System Settings > Privacy & Security > Microphone** and turn on Electron / AURELIUM.

### Testing Phase 2

1. Fill in the two keys, run `npm run doctor`, make sure everything says OK.
2. Launch AURELIUM. The status line under the state indicator should read `BRAIN ready · VOICE ready · EARS ...`.
3. Hold Space and say: "Aurelium, give me a quick status check." Release. You should see your words in the transcript, the entity go into thinking, then she speaks and the entity pulses with her voice.
4. Press Enter and type a question to test the brain without the microphone.
5. Press W, then say "Aurelium, what time is it?" to test the wake word.

If something fails, the transcript panel shows the reason in italics. Send me that line.

## Project layout (plain English)

- `main.js` - the Electron "backstage": opens the window, reads CPU and memory, talks to the page.
- `preload.js` - the narrow bridge between backstage and the page.
- `src/renderer/` - the page itself: `index.html` (layout), `style.css` (look), `app.js` (HUD logic), `entity.js` (the particle entity, Three.js).
- `src/main/` - the voice and brain stack: `config.js` (reads `.env`), `personality.js` (how AURELIUM speaks), `brain.js` (Claude, streaming), `tts.js` (ElevenLabs voice), `stt.js` + `whisper-worker.js` (ears: local Whisper or cloud), `pipeline.js` (ties it together).
- `scripts/` - `detect-os.js` (which OS and hardware), `setup.js` (first-time setup), `doctor.js` (checks keys and services), `make-shortcut.js` (desktop shortcut), `make-icon.js` (generates the app icon).
- `data/tasks.json` - placeholder task list for the HUD.
- `.env.example` - template for the API keys and settings. Copy to `.env` (setup does this).

## Design notes

The entity is an original design: particles are generated procedurally as
horizontal contour rings around a head-and-shoulders profile, plus a dense warm
core inside the chest and head, plus a faint halo of dust for depth. All motion
runs on the graphics card in a shader, so the CPU stays free for the voice and
brain work in later phases. No movie or game assets are used.
