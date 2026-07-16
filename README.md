# KC Auto Tool

KC Auto Tool by KC Dev separates workflow orchestration from browser automation:

- `desktop-app/`: Electron main process and React renderer.
- `extension-worker/`: one Manifest V3 extension installed in both Chrome profiles.
- `h2dev_flow/`: the original v1 extension, kept as a reference during migration.
- `PROTOCOL.md`: the message contract shared by the desktop app and extension.

## Desktop app

```powershell
cd desktop-app
npm install
npm run dev
```

`npm run dev` starts the Vite renderer and opens the Electron window.

## Extension worker

1. Open `chrome://extensions` in each Chrome profile.
2. Enable Developer mode.
3. Select **Load unpacked** and choose `extension-worker/`.
4. Confirm that `KC Dev` loads without errors.

## Phase 1 connection check

1. Start the desktop app first.
2. In the ChatGPT Chrome profile, open `https://chatgpt.com/`.
3. In the Google Flow Chrome profile, open a page under
   `https://labs.google/fx/`.
4. The extension badge changes to `ON` in each profile.
5. The desktop app shows `2/2 online`, with separate connected states for
   ChatGPT and Google Flow.

The desktop app listens only on `ws://127.0.0.1:17890`. Each Chrome profile
gets a random local `profileTag`; no Google account identifier is read or sent.

If both supported domains are open in one profile, the active supported tab
selects that profile's worker role. The intended setup remains one domain per
Chrome profile.

Run the server heartbeat smoke test while the desktop app is open:

```powershell
cd desktop-app
npm run smoke:workers
npm run smoke:reconnect
```

## Phase 2 character library

Open the **Nhân vật** tab to create, edit, or delete character references.

- Tokens are normalized to uppercase and stored with the `@` prefix.
- Tokens may contain letters, numbers, and underscores.
- Reference images accept PNG, JPEG, or WebP up to 10 MB.
- Character metadata is stored in `character-library/characters.json` under
  Electron's user data directory.
- Managed image copies are stored in `character-library/images/`.

The reusable `parseCharacterTokens()` helper extracts unique prompt tokens in
their original order. Run Phase 2 tests with the desktop app closed:

```powershell
cd desktop-app
npm test
npm run smoke:characters
```

## Phase 3 timeline import

Open the **Timeline** tab, select one `.srt` subtitle file and one `.txt` or
`.md` script file, then generate through the connected ChatGPT worker. Each
file is limited to 2 MB. The worker asks ChatGPT for structured JSON and the
desktop app validates and normalizes it before rendering the scene table.
The first batch analyzes the complete script and returns a project-wide Visual
Bible (`style`, `palette`, `lighting`, continuity rules, and aspect ratio).
The desktop fills the Visual Bible panel automatically, and all later batches
must preserve it while writing their image and video prompts.
The always-visible **Phong cách đồ họa** input can lock a user-provided style
before timeline generation or override it afterward. The same value is sent in
the timeline request, stored in the Visual Bible, previewed in the image modal,
and prepended to every Google Flow image prompt.
Projects are locked to 16:9 and are designed for 10-15 minute source timelines.
Character tokens are optional: the worker preserves a token only when the
source mentions that character and the scene visibly uses them; otherwise the
scene carries no character reference.
Phase 3a first sends the complete SRT and script as a `beat_planning` task. It
locks a continuous, gap-free boundary contract using 4, 6, or 8-second scenes
and marks each scene as `single`, `start`, or `continue` in a chain. Prompt
generation then runs sequentially in batches of up to 6 scenes without allowing
ChatGPT to change those boundaries. Invalid beat plans or scene JSON are retried
twice. The Phase 4 table exposes editable **Chain** and **Thời lượng** columns;
manual changes are saved with the timeline and synchronized to SQLite.
Keep the ChatGPT tab visible while timeline generation is running. This stable
rollback intentionally does not automate hidden or background-tab lifecycle.
If the extension was reloaded after ChatGPT opened, the worker reinjects the
content script into the verified main frame and retries dispatch once.

Reload `extension-worker/` from `chrome://extensions` after updating Phase 3.
Run the deterministic desktop-to-worker smoke test (it uses an isolated test
port, so the development app may remain open):

```powershell
cd desktop-app
npm run build
npm run smoke:timeline
```

## Phase 4 scene management

Generated scenes are persisted in renderer storage and displayed in an editable
management table. Image and video prompts can be edited inline, rerun, or
replaced through the alternate-prompt editor. Per-scene progress and completion
arrive through the desktop-to-Flow-Worker WebSocket job protocol and update only
the matching row.

Phase 4 intentionally uses a short mock media executor in `background.js`.
It exercises `GENERATE_IMAGE` and `GENERATE_VIDEO` end to end without operating
Google Flow; Phase 5 and Phase 6 replace those mock actions with real generation.

Reload `extension-worker/` in both Chrome profiles to version `2.11.0`, then run:

```powershell
cd desktop-app
npm test
npm run smoke:scenes
```

## Phase 5 Google Flow image generation

Phase 5.1 stores a project Visual Bible and explicit character assignments for
each scene. The image modal previews the selected Phase 2 references and locks
the Ultra preset to Nano Banana Pro, one output, and an expected cost of zero
credits. Character binding no longer depends on tokens appearing in prompt
text. The worker verifies the free model option, uploads every selected
reference, confirms each prompt thumbnail, and only then submits the compiled
Visual Bible plus scene prompt. Results are saved under Chrome's
`Downloads/KC Auto Tool` directory and restored from the saved session.

Reload `extension-worker/` to version `2.13.1` and refresh the open Google Flow
project before testing. `GENERATE_VIDEO` is still mocked until Phase 6.

```powershell
cd desktop-app
npm test
npm run smoke:phase5
```

## Phase 7 production queue

The Phase 4 table now has a crash-safe SQLite production queue. It can generate
all pending images, generate videos only from approved images, pause, resume,
stop, retry failed scenes, resume from a selected row, or regenerate exactly
one scene. Right-click a scene row for the resume/regenerate commands.

Jobs run sequentially through the Flow worker, respect `depends_on`, and retry
retryable failures with 2s/8s/20s backoff (three attempts by default). The
Error Center groups DOM, response, timeout, quota, and extension-connection
failures. Extension version `2.24.0` sends a five-second job heartbeat, records step-by-step video-setting diagnostics, reuses character assets after scanning the Flow media library, and prevents generated scene images from accumulating as references. Every video now uses its own approved scene image as the single Start frame; reload
the unpacked extension before using the production queue.

When the app restarts, orphaned `running` jobs are returned to `queued` without
creating duplicates. Completed and approved scenes are left untouched.

Use **Xóa kết quả** in the production queue to return to the Phase 3 output.
After one irreversible confirmation, the app stops the queue, removes generated
images, videos, extracted frames, orphaned older copies, and all production jobs
from `Downloads/KC Auto Tool`. Timeline boundaries, image/video prompts, the
Visual Bible, character assignments, character library, and style presets are
preserved.
