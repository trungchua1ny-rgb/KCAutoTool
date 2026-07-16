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

Version `2.24.0` stops scene-reference accumulation and improves motion. Every image job attaches its required character references plus at most one prior final frame for a real continuation; generated images are never accumulated as Visual Bible anchors. Every video uses only its own approved scene image in Flow's Start-frame slot, with no End frame. This supports exact 4/6/8-second scenes while avoiding rigid interpolation between two unrelated compositions. Motion prompts request a coherent action arc, natural acceleration/deceleration, weight transfer, follow-through, secondary overlap, and a purposeful camera instead of forcing every movement to stay small and slow. Character assets remain cached with multiple locators and are reused from the Flow media library before upload. The 2.22.0 video-setting stabilization remains: 16:9 is confirmed by both the visible label and Flow's `LANDSCAPE` tab identity, the settings popup is reopened between fields, and detailed DOM diagnostics are recorded on failure.
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
