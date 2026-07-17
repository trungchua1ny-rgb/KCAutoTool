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

Version `2.40.0` starts looking immediately after Flow accepts the video prompt for an in-progress `a > div` card containing `play_circle` and any numeric percentage from `0%` to `100%`. The first time it appears the worker clicks it, then retries every two seconds using the locked anchor. After the viewer opens it waits five seconds, retries native `Tải xuống` every two seconds, waits for the file, and clicks `Xong`.
Version `2.41.0` removes duplicate native downloads: while the viewer button is disabled the worker only checks its state every two seconds; when enabled it performs exactly one DOM click, waits for Chrome to register and finish that download, then clicks `Xong`.
Version `2.42.0` enforces one video download channel. After the Flow viewer route starts, the worker never launches the former direct-URL fallback; it only observes and renames the single download created by Flow. If Chrome cannot confirm that file, the job stops with `FLOW_NATIVE_DOWNLOAD_FAILED` instead of starting a second transfer.

Version `2.43.0` makes Phase 3 continuation-aware: `continue` boundaries return an empty image prompt and only describe the next video action. KC Auto Tool supplies the final frame extracted from the preceding downloaded video directly to Flow's Start-frame slot; independent `single` and chain `start` scenes continue to use generated opening images.

Version `2.44.0` accepts an optional PNG/JPEG/WebP style reference from KC Auto Tool, attaches it to the first Phase 3a ChatGPT message, and instructs ChatGPT to retain the observed drawing system for all prompt batches. The first Visual Bible style keeps the complete user-entered base and adds a production-ready description of the reference image.

Version `2.45.0` receives a stable workspace output-folder key with every scene job. Images and videos are saved under `Downloads/KC Auto Tool/session-<workspace-id>` so repeated public IDs such as `scene-001` cannot mix files between workspaces.

Version `2.46.0` snapshots visible Flow generation errors before each submit and detects newly appearing policy/failure text on the render card or viewer. The exact message is returned to KC Auto Tool instead of waiting for a generic ten-minute timeout, where it can pre-fill the policy-repair dialog.
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
same Flow tab after switching it to Video. Every scene selects Frames, places only its opening image in Start, leaves End empty, selects the planned 4/6/8-second duration, submits the motion prompt, waits for the clip, and downloads it. A `continue` scene skips image generation and uses the extracted final frame of the preceding downloaded video directly as Start.
If the asset cannot be matched (for example, an older session or another Flow
project), the worker falls back to uploading the downloaded image file.

The Flow content worker first uses accessible labels to find **Add reference**,
the image file input, prompt editor, and Generate button. If Google changes the
page, set `addReferenceSelector`, `referenceInputSelector`,
`referenceTokenSelector`, `promptSelector`, and `generateSelector` in the
`CONFIG` block at the top of `content-flow.js`.
