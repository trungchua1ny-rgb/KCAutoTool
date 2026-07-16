# KC Dev

Manifest V3 browser worker installed from the same directory in both Chrome
profiles. It contains:

- `background.js`: migrated Chrome debugger input support from v1.
- `content-flow.js`: migrated Google Flow DOM automation from v1.
- `content-chat.js`: submits timeline prompts to ChatGPT, waits for the assistant
  response, and extracts structured scene JSON.
- `worker-connection.js`: WebSocket registration, heartbeat response, and
  reconnect behavior.

Load this directory through `chrome://extensions` using **Load unpacked**.
Both the legacy `labs.google/fx` URL and the current `flow.google` URL are
supported.

The worker detects its role from open tabs. A profile with ChatGPT registers as
`chat-worker`; a profile with Google Flow registers as `flow-worker`. The action
badge reads `ON` after it connects to the desktop app at
`ws://127.0.0.1:17890`.

For `GENERATE_TIMELINE`, keep a logged-in ChatGPT conversation open in the
Chat worker profile. The worker processes one timeline at a time and supports
the protocol `STOP` message.

Version `2.36.0` snapshots Flow result cards before submit and locks onto the newly-created rendering card without clicking it. Once that exact card gains a playable video source and becomes enabled, the worker opens it, clicks native `Tải xuống`, captures and names the download, then clicks `Xong`. Grid detection, direct HTTPS, and blob reads remain fallbacks. It retains 2.34.0's native download capture and 2.32.0's policy-safe prompt repair.
5.1 image preflight. The image preflight accepts an account preset when Flow
does not expose the zero-credit label in the DOM, but still stops on an explicit
non-zero value and always closes a failed model popup. The Chat worker derives one project-wide Visual Bible from
the complete script before writing the first scene batch, then preserves it in
every later batch. The Flow worker opens the model
picker and requires **Nano Banana Pro** to show zero credits before continuing.
`GENERATE_IMAGE` then uses Chrome Debugger to reproduce the Flow popup
sequence: prompt `+`, **Upload media**, intercepted local file selection,
uploaded thumbnail selection, and **Add to prompt**. It only enters the Visual
Bible and scene prompt after every selected ingredient thumbnail is visible,
then saves the result under `Downloads/KC Auto Tool`. `GENERATE_VIDEO` routes to the
same Flow tab after switching it to Video. Every scene selects Frames, places only the scene's approved image in Start, leaves End empty, selects the planned 4/6/8-second duration, submits the motion prompt, waits for the clip, and downloads it. The extracted prior last frame is reserved only as a continuity reference while creating the next image.
If the asset cannot be matched (for example, an older session or another Flow
project), the worker falls back to uploading the downloaded image file.

The Flow content worker first uses accessible labels to find **Add reference**,
the image file input, prompt editor, and Generate button. If Google changes the
page, set `addReferenceSelector`, `referenceInputSelector`,
`referenceTokenSelector`, `promptSelector`, and `generateSelector` in the
`CONFIG` block at the top of `content-flow.js`.
