# AURELIUM

AURELIUM is Juan's personal desktop AI assistant. The assistant herself is
called **Motion**. The app is a full-screen "face" made of 18,000 glowing
particles, with voice, a brain, a second brain in Obsidian, and the ability
to act on the computer and search the web.
It is being built in phases. This README is updated as each phase lands.

| Phase | What it is | Status |
|-------|------------|--------|
| 1 | The face: full-screen particle entity + HUD | Ready to test |
| 2 | Voice + brain: push-to-talk, Whisper, Claude, ElevenLabs | Ready to test |
| 3 | Second brain: Obsidian vault, memory, morning briefing | Ready to test |
| 4 | Actions: open apps, tasks, email drafts, web search | Ready to test |

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

On a Mac, `npm run shortcut` builds a real **AURELIUM.app** on your desktop
(its own icon, named AURELIUM in the Dock and menu bar, and macOS asks for the
microphone as "AURELIUM"). Double-click it to launch; no Terminal needed.
`npm start` also hands off to the app and returns, so the Terminal window can
be closed. You can drag AURELIUM.app into your Applications folder if you like.

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
| `V` | Voice test: she speaks a fixed line so you can check the speakers |
| `Enter` | Type a message instead of speaking |
| `B` | Daily briefing |
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
| Wake word | Press **W** in the app, or set `WAKE_WORD=on`. Then say "Motion, ..." followed by your request. Say just "Motion" and she answers "Yes, Juan?" and waits. |
| Typing | Press **Enter**, type, press Enter. Useful without a microphone. |
| Interrupt | Press Space (or the hotkey) while she is speaking to cut in. Esc stops playback. |
| Start over | Press **R** to clear the conversation. |

**Microphone permission on macOS.** `npm start` (and the desktop shortcut) now opens the app the proper macOS way, so the first time you hold Space, macOS shows "Electron would like to access the microphone". Click **Allow**. If the app ever reports silence or "Nothing heard", open **System Settings > Privacy & Security > Microphone** and make sure **Electron** is switched on (and **Terminal**, if you launch from there), then relaunch. While you hold Space the status line shows a live microphone meter; if it stays empty the Mac is not sending audio to the app.

**Log file.** Everything the app does is written to `data/aurelium.log` inside the AURELIUM folder. If something misbehaves, send me the last 50 lines of that file:

```
tail -50 data/aurelium.log
```

### Testing Phase 2

1. Fill in the two keys, run `npm run doctor`, make sure everything says OK.
2. Launch AURELIUM. The status line under the state indicator should read `BRAIN ready · VOICE ready · EARS ...`.
3. Hold Space and say: "Motion, give me a quick status check." Release. You should see your words in the transcript, the entity go into thinking, then she speaks and the entity pulses with her voice.
4. Press Enter and type a question to test the brain without the microphone.
5. Press W, then say "Motion, what time is it?" to test the wake word.

If something fails, the transcript panel shows the reason in italics. Send me that line.

## Phase 3: the second brain (Obsidian)

### Where the vault is

On first launch AURELIUM looks for an existing Obsidian vault (home folder, Documents, Desktop, iCloud Obsidian folder). If it finds one it uses it and adds the AURELIUM folders alongside your notes. If it finds none it creates a new vault at:

```
~/AureliumBrain
```

The transcript panel tells you which happened. To force a particular vault, set `VAULT_PATH=/full/path/to/vault` in `.env`.

**To open it in Obsidian:** install Obsidian from <https://obsidian.md>, open it, click **Open folder as vault**, and choose the `AureliumBrain` folder in your home folder. Notes AURELIUM writes appear there instantly.

### Folder structure

```
Home.md                 the map of everything
00 Inbox                unsorted captures
01 Daily                one note per day (Briefing / Tasks / Notes / Log)
02 Companies            Aurelium Motion, PeakHive, Eccellenti, Vorynx Lab
03 Clients & Leads      one note per client or lead
04 SOPs                 processes
05 Ideas                one idea per note
06 People               one note per person
07 Resources            tools, links, templates
99 Archive              finished and stale things
```

Each folder has a starter note explaining what goes there.

### What AURELIUM can do with it

- **Search first.** Before answering anything about your businesses, she searches the vault and reads the matching notes.
- **"Remember this ..."** files a clean note in the right folder with links to related notes, and logs it in today's daily note.
- **"Brain dump"** then talk for as long as you like (hold Space the whole time). She splits it into organised notes, adds tasks to today, and tells you what she filed.
- **Tasks.** "Add a task: ..." goes into today's daily note. Open tasks show on the HUD in the TODAY panel.
- **Daily briefing.** On the first launch each day she speaks a briefing built from yesterday's note and open tasks, opening with "Good morning, Juan." (afternoon or evening if that's when you launch). Press **B** to hear it again any time.
- **Safety.** The tools can only create and append. Nothing can delete or overwrite a note, and she asks before adding to an existing one.

### Testing Phase 3

1. `git pull`, then `npm start`. Watch the transcript for the "Second brain" line and note the path.
2. Say: "Remember this: Bright Smile Dental is a new lead for Aurelium Motion, the owner wants a demo on Thursday." Then open the vault in Obsidian and look in `03 Clients & Leads`.
3. Say: "What do we know about Bright Smile Dental?" She should search and answer from the note.
4. Say: "Add a task: send Bright Smile the proposal." It appears in today's daily note and in the TODAY panel.
5. Say "Brain dump" and talk for a minute about anything on your mind. Check the notes she filed.
6. Press **B** for the briefing.

## Phase 4: actions and the web

Motion can now act, and every action is written to the Log section of today's daily note.

| Say | What happens |
|-----|--------------|
| "Open Safari" / "Open Obsidian" / "Open Spotify" | The app opens. Any app name works; common ones have shortcuts (browser, mail, calendar, notes, terminal, slack, zoom, settings). |
| "Open peakhive.com" / "Pull up the Shopify admin" | The site opens in your default browser. |
| "Add a task: call the dentist Friday" | A checkbox task goes into today's daily note and the TODAY panel. |
| "Draft an email to Dr Patel confirming Thursday's demo" | She writes the draft, saves it in `00 Inbox`, and opens it in your Mail app ready for you to review. **She cannot send.** Only you can press Send. |
| "What are Shopify's checkout fees this year?" / "Search the web for ..." | She searches the web and reads pages (this runs on Anthropic's side, no extra key), then briefs you and names the source. |

Her name, wake word and web access are in `.env`:

```
ASSISTANT_NAME=Motion
WAKE_WORD_TEXT=motion
WEB_SEARCH=on
```

### Teaching her what your businesses really do

Motion reads the four notes in `02 Companies` every time she answers, so those notes are the truth about each business. Two ways to fill them in:

- Say: "Motion, read aureliummotion.com and add what we actually do to the Aurelium Motion note." She fetches the site and appends an About section.
- Or open the note in Obsidian and write it yourself. Anything you put there, she knows from the next question onward.

Note on the wake word: "motion" is an ordinary English word, so with the wake word on she may react when you say it in normal conversation. Push-to-talk (hold Space) avoids that.

### Testing Phase 4

1. `git pull`, then `npm start`. The status line should start with `MOTION`.
2. Say "Motion, open Safari." Safari opens; the daily note's Log gains a line.
3. Say "Open peakhive.com."
4. Say "Add a task: send Bright Smile the proposal by Friday." Check the TODAY panel.
5. Say "Draft an email to Dr Patel confirming the demo on Thursday at 2pm." Mail opens with the draft. Do not send unless you want to.
6. Say "What's the weather in Miami right now?" or "What's new with Shopify this week?" She should search and brief you.
7. Open today's daily note in Obsidian: every action should be listed under Log.

## Project layout (plain English)

- `main.js` - the Electron "backstage": opens the window, reads CPU and memory, talks to the page.
- `preload.js` - the narrow bridge between backstage and the page.
- `src/renderer/` - the page itself: `index.html` (layout), `style.css` (look), `app.js` (HUD logic), `entity.js` (the particle entity, Three.js).
- `src/main/` - the voice and brain stack: `config.js` (reads `.env`), `personality.js` (how Motion speaks), `brain.js` (Claude, streaming, tool calls, web tools), `tts.js` (ElevenLabs voice), `stt.js` + `whisper-worker.js` (ears: local Whisper or cloud), `vault.js` (the Obsidian second brain), `tools.js` (vault tools), `actions.js` (open apps and sites, tasks, email drafts, web tool definitions), `pipeline.js` (ties it together).
- `scripts/` - `detect-os.js` (which OS and hardware), `setup.js` (first-time setup), `doctor.js` (checks keys and services), `make-shortcut.js` (desktop shortcut), `make-icon.js` (generates the app icon).
- `data/tasks.json` - placeholder task list for the HUD.
- `.env.example` - template for the API keys and settings. Copy to `.env` (setup does this).

## Design notes

The entity is an original design: particles are generated procedurally as
horizontal contour rings around a head-and-shoulders profile, plus a dense warm
core inside the chest and head, plus a faint halo of dust for depth. All motion
runs on the graphics card in a shader, so the CPU stays free for the voice and
brain work in later phases. No movie or game assets are used.
