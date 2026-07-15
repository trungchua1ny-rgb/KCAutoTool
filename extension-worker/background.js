import { WorkerConnection } from "./worker-connection.js";

const RECONNECT_ALARM = "flowx-worker-reconnect";
const PROFILE_TAG_KEY = "flowxProfileTag";
const DETECTED_ROLE_KEY = "flowxDetectedRole";
const CHARACTER_ASSET_CACHE_KEY = "flowxCharacterAssetCacheV1";

let profileTagPromise = null;
let roleRefreshTimer = null;
let activeJob = null;
let activeJobHeartbeatTimer = null;
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function roleForUrl(url = "") {
  if (/^https:\/\/chatgpt\.com\//i.test(url)) return "chat-worker";
  if (/^https:\/\/(?:labs\.google\/fx\/|flow\.google\/)/i.test(url)) return "flow-worker";
  return null;
}

async function getProfileTag() {
  if (profileTagPromise) return profileTagPromise;

  profileTagPromise = (async () => {
    const stored = await chrome.storage.local.get(PROFILE_TAG_KEY);
    if (typeof stored[PROFILE_TAG_KEY] === "string") {
      return stored[PROFILE_TAG_KEY];
    }

    const profileTag = `profile-${crypto.randomUUID().slice(0, 8)}`;
    await chrome.storage.local.set({ [PROFILE_TAG_KEY]: profileTag });
    return profileTag;
  })();

  return profileTagPromise;
}

async function detectRegistration() {
  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs
    .map((tab) => ({ tab, role: roleForUrl(tab.url) }))
    .filter((entry) => entry.role);
  const availableRoles = new Set(matchingTabs.map((entry) => entry.role));

  if (availableRoles.size === 0) return null;

  let role = null;
  if (availableRoles.size === 1) {
    role = [...availableRoles][0];
    await chrome.storage.local.set({ [DETECTED_ROLE_KEY]: role });
  } else {
    role = matchingTabs.find((entry) => entry.tab.active)?.role || null;

    if (!role) {
      const stored = await chrome.storage.local.get(DETECTED_ROLE_KEY);
      const storedRole = stored[DETECTED_ROLE_KEY];
      if (availableRoles.has(storedRole)) role = storedRole;
    }
  }

  if (!role) return null;
  return {
    role,
    profileTag: await getProfileTag(),
    workerVersion: chrome.runtime.getManifest().version,
  };
}

function updateActionState(state, registration) {
  const presentation = {
    connected: { text: "ON", color: "#167c5a" },
    connecting: { text: "...", color: "#a36a00" },
    disconnected: { text: "OFF", color: "#b42318" },
    waiting: { text: "", color: "#667085" },
    idle: { text: "", color: "#667085" },
  }[state];

  void chrome.action.setBadgeText({ text: presentation.text });
  void chrome.action.setBadgeBackgroundColor({ color: presentation.color });
  void chrome.action.setTitle({
    title: registration
      ? `KC Dev - ${registration.role} - ${state}`
      : "KC Dev - waiting for ChatGPT or Google Flow",
  });
}

function sendJobError(jobId, error, code = "INTERNAL_ERROR", retryable = false) {
  console.error(`[KC Dev][${jobId}][${code}] ${error}`);
  connection.send({
    type: "JOB_ERROR",
    jobId,
    error,
    code,
    retryable,
  });
}

function sendJobProgress(jobId, status, message) {
  console.info(`[KC Dev][${jobId}][${status}] ${message}`);
  connection.send({ type: "JOB_PROGRESS", jobId, status, message });
}

function startActiveJobHeartbeat(jobId) {
  stopActiveJobHeartbeat();
  activeJobHeartbeatTimer = setInterval(() => {
    if (activeJob?.jobId !== jobId) {
      stopActiveJobHeartbeat();
      return;
    }
    connection.send({
      type: "JOB_PROGRESS",
      jobId,
      status: "generating",
      message: "Worker vẫn đang xử lý trên trang AI",
      heartbeat: true,
    });
  }, 5_000);
}

function stopActiveJobHeartbeat() {
  if (!activeJobHeartbeatTimer) return;
  clearInterval(activeJobHeartbeatTimer);
  activeJobHeartbeatTimer = null;
}

async function findChatGptTab() {
  const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function findFlowTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://labs.google/fx/*", "https://flow.google/*"],
  });
  if (tabs.length === 0) return null;
  const lastFocused = await chrome.windows.getLastFocused().catch(() => null);
  return tabs.find((tab) => tab.active && tab.windowId === lastFocused?.id) ||
    tabs.find((tab) => tab.active) ||
    tabs[0];
}

async function activateFlowWorkspace(tab) {
  if (!tab?.id) throw new Error("Flow workspace tab is unavailable");
  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await chrome.tabs.update(tab.id, { active: true });
  await pause(300);
  const activeTab = await chrome.tabs.get(tab.id);
  if (!activeTab.active) {
    throw new Error("Chrome không thể kích hoạt tab Google Flow đã chọn");
  }
  return activeTab;
}

async function ensureFlowMediaMode(tabId, mediaType) {
  await pressEscape(tabId).catch(() => {});
  await pause(120);
  const picker = await sendImageToFlowTab(tabId, {
    type: "FLOWX_GET_MEDIA_MODE_PICKER",
    mediaType,
  });
  if (!picker?.ok || picker.alreadySelected) return picker;

  let popupOpen = false;
  let completed = false;
  try {
    await clickAt(tabId, picker.x, picker.y);
    popupOpen = true;
    const option = await sendImageToFlowTab(tabId, {
      type: "FLOWX_GET_MEDIA_MODE_OPTION",
      mediaType,
    });
    if (!option?.ok) return option;
    await clickAt(tabId, option.x, option.y);
    const confirmed = await sendImageToFlowTab(tabId, {
      type: "FLOWX_CONFIRM_MEDIA_MODE",
      mediaType,
    });
    completed = confirmed?.ok === true;
    return confirmed;
  } finally {
    if (popupOpen && !completed) {
      await pressEscape(tabId).catch(() => {});
    }
  }
}

function isTimelinePayload(payload) {
  return (
    payload &&
    typeof payload.srtText === "string" &&
    payload.srtText.trim() &&
    typeof payload.scriptText === "string" &&
    payload.scriptText.trim()
  );
}

function isSceneJobPayload(payload) {
  const validVideoSettings = payload?.mediaType !== "video" || (
    payload.videoSettings &&
    (payload.videoSettings.mode === "ingredients" || payload.videoSettings.mode === "frames") &&
    [4, 6, 8].includes(Number(payload.videoSettings.durationSeconds)) &&
    (payload.videoSettings.mode !== "frames" || (
      typeof payload.startFramePath === "string" &&
      /^(?:[A-Za-z]:[\\/]|\/)/.test(payload.startFramePath) &&
      /\.(?:png|jpe?g|webp)$/i.test(payload.startFramePath)
    ))
  );
  return Boolean(
    payload &&
    /^scene-\d{3,4}$/.test(payload.sceneId || "") &&
    (payload.mediaType === "image" || payload.mediaType === "video") &&
    typeof payload.prompt === "string" &&
    payload.prompt.trim() &&
    (payload.mediaType !== "video" || (
      typeof payload.sourceImagePath === "string" &&
      /^(?:[A-Za-z]:[\\/]|\/)/.test(payload.sourceImagePath) &&
      /\.(?:png|jpe?g|webp)$/i.test(payload.sourceImagePath)
    )) &&
    validVideoSettings
  );
}

function validReferenceImages(value) {
  return Array.isArray(value) && value.length <= 10 && value.every((reference) =>
    reference &&
    /^@[A-Z0-9_]{1,40}$/.test(reference.token || "") &&
    typeof reference.name === "string" &&
    ["image/png", "image/jpeg", "image/webp"].includes(reference.mimeType) &&
    typeof reference.imageBase64 === "string" &&
    reference.imageBase64.length > 0 &&
    typeof reference.localPath === "string" &&
    /^(?:[A-Za-z]:[\\/]|\/)/.test(reference.localPath)
  );
}

function isMissingContentReceiver(error) {
  const message = String(error?.message || error);
  return (
    message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist")
  );
}

async function sendTimelineToChatTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingContentReceiver(error)) throw error;
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["content-chat.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function sendImageToFlowTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingContentReceiver(error)) throw error;
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["content-flow.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function safeSceneFileName(sceneId, mimeType) {
  const extension = mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpg" : "png";
  return `KC Auto Tool/${sceneId}-${Date.now()}.${extension}`;
}

function safeVideoFileName(sceneId, mimeType) {
  const extension = mimeType === "video/webm" ? "webm" : "mp4";
  return `KC Auto Tool/${sceneId}-${Date.now()}.${extension}`;
}

async function waitForDownload(downloadId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === "complete" && item.filename) return item.filename;
    if (item?.state === "interrupted") {
      throw new Error(`Tải ảnh bị gián đoạn: ${item.error || "unknown"}`);
    }
    await pause(250);
  }
  throw new Error("Hết thời gian chờ Chrome lưu ảnh");
}

async function downloadFlowImage(response, payload) {
  const url = typeof response.dataUrl === "string" && response.dataUrl.startsWith("data:image/")
    ? response.dataUrl
    : response.src;
  if (typeof url !== "string" || !/^(data:image\/|https?:|blob:)/i.test(url)) {
    throw new Error("Google Flow không trả về URL ảnh hợp lệ");
  }
  const mimeType = response.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));/)?.[1] || "image/png";
  const downloadId = await chrome.downloads.download({
    url,
    filename: safeSceneFileName(payload.sceneId, mimeType),
    conflictAction: "uniquify",
    saveAs: false,
  });
  return waitForDownload(downloadId);
}

async function downloadFlowVideo(response, payload) {
  const url = typeof response.dataUrl === "string" && response.dataUrl.startsWith("data:video/")
    ? response.dataUrl
    : response.src;
  if (typeof url !== "string" || !/^(data:video\/|https?:|blob:)/i.test(url)) {
    throw new Error("Google Flow không trả về URL video hợp lệ");
  }
  const mimeType = response.dataUrl?.match(/^data:(video\/(?:mp4|webm));/)?.[1] || "video/mp4";
  const downloadId = await chrome.downloads.download({
    url,
    filename: safeVideoFileName(payload.sceneId, mimeType),
    conflictAction: "uniquify",
    saveAs: false,
  });
  return waitForDownload(downloadId, 300000);
}

function stripConflictingRenderPhrases(prompt) {
  return String(prompt || "")
    .replace(/\b(?:photorealistic|hyperrealistic|realistic rendering)\b/gi, "")
    .replace(/\b(?:subtle\s+)?paper\s+(?:grain|texture)\b/gi, "")
    .replace(/\b(?:subtle\s+)?(?:film\s+)?grain\b/gi, "")
    .replace(/\bshallow\s+(?:cinematic\s+)?depth(?:\s+of\s+field)?\b/gi, "")
    .replace(/\bsoft\s+(?:directional\s+)?shadows?\b/gi, "")
    .replace(/\bvolumetric\s+(?:light|lighting)\b/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;])\s*([,;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isStickFigureStyle(style) {
  return /\bstick\s*[- ]?\s*(?:man|men|figure|figures)\b/i.test(String(style || ""));
}

function promptWithReferences(payload) {
  const sections = [];
  const bible = payload.visualBible || {};
  const graphicStyle = String(bible.style || "").trim();
  const stickFigureMode = isStickFigureStyle(graphicStyle);
  const continuity = [
    graphicStyle ? `Graphic style: ${graphicStyle}` : "",
    bible.palette ? `Color palette: ${bible.palette}` : "",
    bible.lighting ? `Lighting: ${bible.lighting}` : "",
    bible.continuityNotes ? `Continuity rules: ${bible.continuityNotes}` : "",
  ].filter(Boolean);
  if (continuity.length) {
    sections.push(`PROJECT VISUAL BIBLE — keep these properties consistent:\n${continuity.join("\n")}`);
  }
  if (payload.refImages.length) {
    const mapping = payload.refImages
      .map((reference) => `${reference.token} = ${reference.name} in the attached asset ${reference.token.replace(/^@/, "")}`)
      .join("; ");
    sections.push(stickFigureMode
      ? `Character reference mapping: ${mapping}. Translate every reference into the locked stick-figure design. Preserve only recognizable clothing colors, accessories, relative age, and proportions; do not copy realistic facial anatomy, skin, hands, or texture.`
      : `Character reference mapping: ${mapping}. Preserve each referenced character's facial identity, hair, age, clothing, and body proportions.`);
  }
  sections.push(`SCENE CONTENT:\n${stripConflictingRenderPhrases(payload.prompt)}`);
  sections.push([
    "SCENE COMPLETENESS LOCK:",
    "Render the complete story setting described in SETTING AND BACKGROUND and all three DEPTH LAYERS. Do not output an isolated character, portrait, character sheet, or empty backdrop unless the scene content explicitly calls for one.",
    "Every visible character must show the specified emotion through readable eyes, eyebrows, mouth, head angle, posture, and gesture. Keep every prop and subject in the stated spatial position and camera composition.",
  ].join("\n"));
  if (graphicStyle) {
    sections.push([
      "FINAL GRAPHIC STYLE LOCK — HIGHEST PRIORITY:",
      graphicStyle,
      "Replace any conflicting art style, medium, realism, texture, depth-of-field, lighting, or shadow wording in the scene content with this graphic style.",
      stickFigureMode
        ? "Every visible person must be an unmistakably human 2D stick figure, never a tree or plant: one circular head, one line torso, exactly two arms attached at the shoulders, and exactly two legs attached at the hips. Add only a simple expressive face with dot eyes, line eyebrows, and a small readable mouth. White canvas is only the base color; always draw the required foreground, middle-ground, and background setting. No branch-like limbs, wood texture, realistic anatomy, realistic hands, skin texture, 3D body, photo style, or cinematic depth of field. Keep identity through colors, simple clothing shapes, accessories, scale, and pose only."
        : "Do not let scene-content rendering adjectives override this style lock.",
    ].join("\n"));
  }
  return sections.join("\n\n");
}

async function clickAt(tabId, x, y) {
  await ensureAttached(tabId);
  // Give Radix popovers enough time to finish layout before using the
  // coordinates returned by the content script. The mouse move plus the
  // short holds also make each automated action visible to the operator.
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
  await pause(220);
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await pause(650);
}

async function pressEscape(tabId) {
  await ensureAttached(tabId);
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

function waitForDebuggerEvent(tabId, method, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.debugger.onEvent.removeListener(listener);
      reject(new Error(`Google Flow không mở hộp chọn file (${method}).`));
    }, timeoutMs);
    const listener = (source, eventMethod, params) => {
      if (source.tabId !== tabId || eventMethod !== method) return;
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
      resolve(params);
    };
    chrome.debugger.onEvent.addListener(listener);
  });
}

async function chooseLocalFile(tabId, x, y, localPath) {
  await ensureAttached(tabId);
  await sendCommand(tabId, "Page.enable");
  await sendCommand(tabId, "Page.setInterceptFileChooserDialog", { enabled: true });
  try {
    const chooser = waitForDebuggerEvent(tabId, "Page.fileChooserOpened");
    await clickAt(tabId, x, y);
    const event = await chooser;
    await sendCommand(tabId, "DOM.setFileInputFiles", {
      backendNodeId: event.backendNodeId,
      files: [localPath],
    });
  } finally {
    await sendCommand(tabId, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
  }
}

function reusableCharacterReference(reference) {
  return /^@(?!STYLE_ANCHOR_|CHAIN_)[A-Z0-9_]{1,40}$/.test(reference?.token || "");
}

async function referenceContentHash(reference) {
  const bytes = new TextEncoder().encode(String(reference?.imageBase64 || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function flowWorkspaceCacheKey(tabId) {
  const tab = await chrome.tabs.get(tabId);
  try {
    const url = new URL(tab.url || "");
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return `tab:${tabId}`;
  }
}

async function characterAssetCacheIdentity(tabId, reference) {
  return [
    await flowWorkspaceCacheKey(tabId),
    reference.token,
    await referenceContentHash(reference),
  ].join("|");
}

async function cachedCharacterAsset(tabId, reference) {
  if (!reusableCharacterReference(reference)) return { identity: "", assetLocator: null };
  const identity = await characterAssetCacheIdentity(tabId, reference);
  const stored = await chrome.storage.local.get(CHARACTER_ASSET_CACHE_KEY);
  const cache = stored[CHARACTER_ASSET_CACHE_KEY];
  const cached = cache && typeof cache === "object" ? cache[identity] : null;
  return {
    identity,
    assetLocator: typeof cached === "string"
      ? { assetKey: cached, rawSrc: "", hints: [] }
      : cached && typeof cached === "object"
        ? cached
        : null,
  };
}

async function rememberCharacterAsset(identity, assetLocator) {
  if (!identity || !assetLocator || typeof assetLocator !== "object") return;
  const hasLocator = Boolean(
    String(assetLocator.assetKey || "").trim() ||
    String(assetLocator.rawSrc || "").trim() ||
    (Array.isArray(assetLocator.hints) && assetLocator.hints.length > 0),
  );
  if (!hasLocator) return;
  const stored = await chrome.storage.local.get(CHARACTER_ASSET_CACHE_KEY);
  const cache = stored[CHARACTER_ASSET_CACHE_KEY] && typeof stored[CHARACTER_ASSET_CACHE_KEY] === "object"
    ? { ...stored[CHARACTER_ASSET_CACHE_KEY] }
    : {};
  cache[identity] = assetLocator;
  const entries = Object.entries(cache);
  const compact = entries.length > 200 ? Object.fromEntries(entries.slice(-200)) : cache;
  await chrome.storage.local.set({ [CHARACTER_ASSET_CACHE_KEY]: compact });
}

function localFileName(localPath) {
  return String(localPath || "").split(/[\\/]/).filter(Boolean).at(-1) || "";
}

async function addSelectedAssetToPrompt(tabId) {
  const addToPrompt = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_ADD_TO_PROMPT_BUTTON" });
  if (!addToPrompt?.ok) return addToPrompt;
  await clickAt(tabId, addToPrompt.x, addToPrompt.y);
  return sendImageToFlowTab(tabId, {
    type: "FLOWX_CONFIRM_INGREDIENT_DROP",
    expectedCount: 1,
  });
}

async function attachReferenceWithPicker(tabId, reference) {
  const cached = await cachedCharacterAsset(tabId, reference);
  const filenameHint = localFileName(reference.localPath);
  if (cached.assetLocator) {
    const attached = await sendImageToFlowTab(tabId, {
      type: "FLOWX_GET_ATTACHED_PROMPT_INGREDIENT",
      assetLocator: cached.assetLocator,
      filenameHint,
    });
    if (attached?.ok && attached.found) {
      return { ok: true, reusedProjectAsset: true, alreadyAttached: true };
    }
  }

  const add = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_PROMPT_ADD_BUTTON" });
  if (!add?.ok) return add;
  await clickAt(tabId, add.x, add.y);

  if (cached.assetLocator) {
    const existing = await sendImageToFlowTab(tabId, {
      type: "FLOWX_GET_EXISTING_PROJECT_ASSET",
      assetLocator: cached.assetLocator,
      filenameHint,
    });
    if (existing?.ok && existing.found) {
      await clickAt(tabId, existing.x, existing.y);
      const confirmed = await addSelectedAssetToPrompt(tabId);
      if (confirmed?.ok && existing.assetLocator) {
        await rememberCharacterAsset(cached.identity, existing.assetLocator);
      }
      return confirmed?.ok ? { ...confirmed, reusedProjectAsset: true } : confirmed;
    }
  }

  const upload = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_UPLOAD_MEDIA_BUTTON" });
  if (!upload?.ok) return upload;
  await chooseLocalFile(tabId, upload.x, upload.y, reference.localPath);

  const asset = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_FRESH_UPLOADED_ASSET" });
  if (!asset?.ok) return asset;
  await clickAt(tabId, asset.x, asset.y);

  const confirmed = await addSelectedAssetToPrompt(tabId);
  if (!confirmed?.ok) return confirmed;
  const latest = asset.assetLocator
    ? { assetLocator: asset.assetLocator }
    : await sendImageToFlowTab(tabId, { type: "FLOWX_GET_LATEST_PROMPT_ASSET_KEY" });
  await rememberCharacterAsset(cached.identity, latest?.assetLocator || null);
  return {
    ...confirmed,
    reusedProjectAsset: false,
    cachedAssetKey: latest?.assetLocator?.assetKey || "",
    cachedAssetLocator: Boolean(latest?.assetLocator),
  };
}

async function attachVideoIngredient(tabId, payload) {
  const alreadyAttached = await sendImageToFlowTab(tabId, {
    type: "FLOWX_GET_ATTACHED_PROMPT_INGREDIENT",
    assetKey: payload.sourceFlowAssetKey || "",
  });
  if (alreadyAttached?.ok && alreadyAttached.found) {
    return {
      ok: true,
      reusedProjectAsset: true,
      alreadyAttached: true,
      verification: "matching-ingredient-already-present",
    };
  }

  const add = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_PROMPT_ADD_BUTTON" });
  if (!add?.ok) return add;
  await clickAt(tabId, add.x, add.y);

  const existing = await sendImageToFlowTab(tabId, {
    type: "FLOWX_GET_EXISTING_PROJECT_ASSET",
    assetKey: payload.sourceFlowAssetKey || "",
  });
  if (existing?.ok && existing.found) {
    await clickAt(tabId, existing.x, existing.y);
    const addToPrompt = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_ADD_TO_PROMPT_BUTTON" });
    if (!addToPrompt?.ok) return addToPrompt;
    await clickAt(tabId, addToPrompt.x, addToPrompt.y);
    const confirmed = await sendImageToFlowTab(tabId, {
      type: "FLOWX_CONFIRM_INGREDIENT_DROP",
      expectedCount: 1,
    });
    return confirmed?.ok ? { ...confirmed, reusedProjectAsset: true } : confirmed;
  }

  const upload = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_UPLOAD_MEDIA_BUTTON" });
  if (!upload?.ok) return upload;
  await chooseLocalFile(tabId, upload.x, upload.y, payload.sourceImagePath);
  const asset = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_FRESH_UPLOADED_ASSET" });
  if (!asset?.ok) return asset;
  await clickAt(tabId, asset.x, asset.y);
  const addToPrompt = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_ADD_TO_PROMPT_BUTTON" });
  if (!addToPrompt?.ok) return addToPrompt;
  await clickAt(tabId, addToPrompt.x, addToPrompt.y);
  const confirmed = await sendImageToFlowTab(tabId, {
    type: "FLOWX_CONFIRM_INGREDIENT_DROP",
    expectedCount: 1,
  });
  return confirmed?.ok ? { ...confirmed, reusedProjectAsset: false } : confirmed;
}

async function typeAndConfirmFlowPrompt(tabId, prepareType, text) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const target = await sendImageToFlowTab(tabId, { type: prepareType });
    if (!target?.ok) return target;
    await typeAndSubmit(tabId, target.x, target.y, text);
    lastResult = await sendImageToFlowTab(tabId, { type: "FLOWX_CONFIRM_SUBMIT" });
    if (lastResult?.ok) return { ...lastResult, attempt };
    await pause(700);
  }
  return lastResult || {
    ok: false,
    code: "FLOW_SUBMIT_FAILED",
    error: "Google Flow không nhận prompt sau 3 lần thử.",
  };
}

async function ensureFreeNanoBananaPro(tabId) {
  // Close a stale model popup left behind by an interrupted/older job.
  await pressEscape(tabId).catch(() => {});
  await pause(150);
  const picker = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_IMAGE_MODEL_PICKER" });
  if (!picker?.ok) return picker;
  // Flow sometimes hides the selected model label behind an icon-only control.
  // Continue with the account's current image preset instead of blocking the job
  // on a DOM label that Flow does not expose.
  if (picker.pickerUnavailable) {
    return {
      ok: true,
      model: "account-image-preset",
      credits: "not-exposed-in-dom",
      verification: "picker-not-exposed",
    };
  }
  if (/nano\s*banana\s*pro/i.test(String(picker.label || ""))) {
    return {
      ok: true,
      model: "nano-banana-pro",
      credits: "account-preset",
    };
  }

  let popupOpen = false;
  let completed = false;
  try {
    await clickAt(tabId, picker.x, picker.y);
    popupOpen = true;

    const option = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_NANO_BANANA_PRO_OPTION" });
    if (!option?.ok) return option;
    await clickAt(tabId, option.x, option.y);

    const confirmed = await sendImageToFlowTab(tabId, { type: "FLOWX_CONFIRM_NANO_BANANA_PRO" });
    completed = confirmed?.ok === true;
    return confirmed;
  } finally {
    if (popupOpen && !completed) {
      await pressEscape(tabId).catch(() => {});
    }
  }
}

async function generateFlowImage(tabId, payload, jobId) {
  const modelReady = await ensureFreeNanoBananaPro(tabId);
  if (!modelReady?.ok) return modelReady;

  for (const reference of payload.refImages) {
    const attached = await attachReferenceWithPicker(tabId, reference);
    if (!attached?.ok) return attached;
    sendJobProgress(
      jobId,
      "preparing",
      attached.alreadyAttached
        ? `${reference.token}: ảnh nhân vật đã có trong prompt`
        : attached.reusedProjectAsset
          ? `${reference.token}: đã chọn lại ảnh nhân vật có sẵn trong thư viện Flow`
          : `${reference.token}: đã upload ảnh nhân vật lần đầu và lưu vị trí để tái sử dụng`,
    );
  }

  const submitted = await typeAndConfirmFlowPrompt(
    tabId,
    "FLOWX_PREPARE_PROMPT",
    promptWithReferences(payload),
  );
  if (!submitted?.ok) return submitted;
  sendJobProgress(jobId, "generating", "Đã gửi prompt; Google Flow đang tạo ảnh scene");
  const image = await sendImageToFlowTab(tabId, { type: "WAIT_IMAGE" });
  if (!image?.ok) return image;

  const converted = await sendImageToFlowTab(tabId, { type: "TODATAURL", src: image.src });
  return {
    ok: true,
    src: image.src,
    dataUrl: typeof converted?.dataUrl === "string" ? converted.dataUrl : null,
    flowAssetKey: typeof image.flowAssetKey === "string" ? image.flowAssetKey : "",
  };
}

function videoPromptFromComponent(payload) {
  const stickFigureMode = isStickFigureStyle(payload.visualBible?.style);
  const sections = [
    "USE THE ATTACHED SCENE IMAGE AS THE PRIMARY VIDEO INGREDIENT.",
    "Preserve the exact characters, proportions, clothing, colors, objects, environment, framing, and graphic style visible in the attached image. Animate this same scene; do not redesign it or introduce a new subject.",
    `Create one continuous ${payload.videoSettings.durationSeconds}-second 16:9 shot. Follow only this motion direction:`,
    stripConflictingRenderPhrases(payload.prompt),
    [
      "MOTION STABILITY LOCK — HIGH PRIORITY:",
      "Use one slow primary action per character and one slow camera move. Preserve the opening silhouette and body topology throughout the shot.",
      "No extra, missing, fused, duplicated, stretched, or detached limbs; no body morphing; no full-body spins; no crossed limbs; no hands passing behind the torso; no complex finger motion; no sudden pose changes; no subject replacement.",
      "Keep hands separated from the torso and other limbs, keep joint connections visible, and finish in the stable END FRAME described above.",
    ].join("\n"),
  ];
  if (stickFigureMode) {
    sections.push([
      "STICK-FIGURE JOINT LOCK:",
      "Each character must keep exactly one circular head, one torso line, two arms connected only at the shoulders, and two legs connected only at the hips for every frame.",
      "Animate with small joint-consistent rotations and short translation only. Keep line length, line thickness, head size, facial marks, and clothing-color shapes unchanged. Never turn a limb into a branch or merge one arm with the body, prop, or another character.",
    ].join("\n"));
  }
  return sections.join("\n\n");
}

function videoPromptFromFrames(payload) {
  const stickFigureMode = isStickFigureStyle(payload.visualBible?.style);
  return [
    "USE THE ATTACHED START FRAME AND END FRAME AS HARD VISUAL BOUNDARIES.",
    `Create one continuous ${payload.videoSettings.durationSeconds}-second 16:9 transition from the exact Start frame to the exact End frame. Preserve character identity, proportions, clothing, colors, line style, environment, lighting, and camera continuity. Do not replace or redesign any subject.`,
    `MOTION DIRECTION:\n${stripConflictingRenderPhrases(payload.prompt)}`,
    [
      "MOTION STABILITY LOCK — HIGH PRIORITY:",
      "Use the smallest natural movement needed to connect both frames. Keep body topology and object count fixed. No extra, missing, fused, duplicated, stretched, detached, or morphing limbs; no sudden pose or camera jump.",
      stickFigureMode
        ? "Every person remains one circular head, one torso line, two arms connected at the shoulders, and two legs connected at the hips. Use small joint-consistent rotations only."
        : "Preserve anatomy and silhouettes throughout the interpolation.",
    ].join("\n"),
  ].join("\n\n");
}

async function openFlowVideoSettingsPopup(tabId) {
  await pressEscape(tabId).catch(() => {});
  await pause(350);
  const picker = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_VIDEO_SETTINGS_PICKER" });
  if (!picker?.ok) return picker;
  await clickAt(tabId, picker.x, picker.y);
  return { ok: true, pickerLabel: picker.label || "" };
}

async function configureFlowVideoSettings(tabId, payload, jobId) {
  const mode = payload.videoSettings?.mode === "frames" ? "frames" : "ingredients";
  const durationSeconds = [4, 6, 8].includes(Number(payload.videoSettings?.durationSeconds))
    ? Number(payload.videoSettings.durationSeconds)
    : 8;

  // Ingredients is Flow's default video composition mode. Frames remains
  // explicit because continuation clips require two frame slots.
  if (mode === "frames") {
    sendJobProgress(jobId, "preparing", "Cấu hình video 1/3: đang mở lựa chọn Khung hình");
    const opened = await openFlowVideoSettingsPopup(tabId);
    if (!opened?.ok) return opened;
    const modeOption = await sendImageToFlowTab(tabId, {
      type: "FLOWX_GET_VIDEO_GENERATION_MODE",
      mode,
    });
    if (!modeOption?.ok) return modeOption;
    await clickAt(tabId, modeOption.x, modeOption.y);
    const modeConfirmed = await sendImageToFlowTab(tabId, {
      type: "FLOWX_CONFIRM_VIDEO_GENERATION_MODE",
      mode,
    });
    if (!modeConfirmed?.ok) return modeConfirmed;
    sendJobProgress(jobId, "preparing", "Cấu hình video 1/3: đã chọn Khung hình");
  } else {
    sendJobProgress(jobId, "preparing", "Cấu hình video 1/3: dùng Thành phần mặc định");
  }

  let aspectConfirmed = null;
  let lastAspectResult = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    sendJobProgress(jobId, "preparing", `Cấu hình video 2/3: chọn 16:9 (lần ${attempt}/2)`);
    const opened = await openFlowVideoSettingsPopup(tabId);
    if (!opened?.ok) {
      lastAspectResult = opened;
      continue;
    }
    const aspect = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_VIDEO_ASPECT_RATIO" });
    if (!aspect?.ok) {
      lastAspectResult = aspect;
      continue;
    }
    sendJobProgress(
      jobId,
      "preparing",
      `Đã tìm thấy nút 16:9: ${aspect.label || "16:9"} [${aspect.identity || "không có id"}]`,
    );
    if (!aspect.alreadySelected) {
      await clickAt(tabId, aspect.x, aspect.y);
    }
    aspectConfirmed = await sendImageToFlowTab(tabId, { type: "FLOWX_CONFIRM_VIDEO_ASPECT_RATIO" });
    if (aspectConfirmed?.ok) break;
    lastAspectResult = aspectConfirmed;
  }
  if (!aspectConfirmed?.ok) {
    return {
      ...(lastAspectResult || {}),
      ok: false,
      code: lastAspectResult?.code || "FLOW_VIDEO_ASPECT_RATIO_CHANGE_FAILED",
      error: `Bước chọn tỷ lệ 16:9 thất bại sau 2 lần. ${lastAspectResult?.error || "Flow không trả về trạng thái đã chọn."}`,
    };
  }
  sendJobProgress(
    jobId,
    "preparing",
    `Cấu hình video 2/3: đã xác nhận 16:9 [${aspectConfirmed.identity || "LANDSCAPE"}]`,
  );

  let durationConfirmed = null;
  let lastDurationResult = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    sendJobProgress(jobId, "preparing", `Cấu hình video 3/3: chọn ${durationSeconds}s (lần ${attempt}/2)`);
    const opened = await openFlowVideoSettingsPopup(tabId);
    if (!opened?.ok) {
      lastDurationResult = opened;
      continue;
    }
    const duration = await sendImageToFlowTab(tabId, {
      type: "FLOWX_GET_VIDEO_DURATION",
      durationSeconds,
    });
    if (!duration?.ok) {
      lastDurationResult = duration;
      continue;
    }
    if (!duration.alreadySelected) {
      await clickAt(tabId, duration.x, duration.y);
    }
    durationConfirmed = await sendImageToFlowTab(tabId, {
      type: "FLOWX_CONFIRM_VIDEO_DURATION",
      durationSeconds,
    });
    if (durationConfirmed?.ok) break;
    lastDurationResult = durationConfirmed;
  }
  if (!durationConfirmed?.ok) {
    return {
      ...(lastDurationResult || {}),
      ok: false,
      code: lastDurationResult?.code || "FLOW_VIDEO_DURATION_CHANGE_FAILED",
      error: `Bước chọn thời lượng ${durationSeconds}s thất bại sau 2 lần. ${lastDurationResult?.error || "Flow không trả về trạng thái đã chọn."}`,
    };
  }
  sendJobProgress(jobId, "preparing", `Cấu hình video 3/3: đã xác nhận ${durationSeconds}s`);
  return { ok: true, mode, aspectRatio: "16:9", durationSeconds };
}

async function attachStartFrameWithPicker(tabId, localPath) {
  return attachFrameWithPicker(tabId, localPath, "start");
}

async function attachFrameWithPicker(tabId, localPath, position) {
  const frame = await sendImageToFlowTab(tabId, {
    type: position === "end" ? "FLOWX_GET_END_FRAME_BUTTON" : "FLOWX_GET_START_FRAME_BUTTON",
  });
  if (!frame?.ok) return frame;
  await clickAt(tabId, frame.x, frame.y);

  const upload = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_UPLOAD_MEDIA_BUTTON" });
  if (!upload?.ok) return upload;
  await chooseLocalFile(tabId, upload.x, upload.y, localPath);

  const asset = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_FRESH_UPLOADED_ASSET" });
  if (!asset?.ok) return asset;
  await clickAt(tabId, asset.x, asset.y);

  const apply = await sendImageToFlowTab(tabId, { type: "FLOWX_GET_FRAME_APPLY_BUTTON" });
  if (apply?.ok && !apply.unavailable) {
    await clickAt(tabId, apply.x, apply.y);
  }
  return sendImageToFlowTab(tabId, {
    type: position === "end" ? "FLOWX_CONFIRM_END_FRAME" : "FLOWX_CONFIRM_START_FRAME",
  });
}

async function generateFlowVideo(tabId, payload, jobId) {
  await pressEscape(tabId).catch(() => {});
  await pause(150);
  const configured = await configureFlowVideoSettings(tabId, payload, jobId);
  if (!configured?.ok) return configured;
  await pressEscape(tabId).catch(() => {});

  if (payload.videoSettings.mode === "frames") {
    const startAttached = await attachStartFrameWithPicker(tabId, payload.startFramePath);
    if (!startAttached?.ok) return startAttached;
    const endAttached = await attachFrameWithPicker(tabId, payload.sourceImagePath, "end");
    if (!endAttached?.ok) return endAttached;
    sendJobProgress(jobId, "preparing", "Đã gắn frame cuối clip trước và ảnh scene hiện tại vào Start/End frame");
  } else {
    const attached = await attachVideoIngredient(tabId, payload);
    if (!attached?.ok) return attached;
    sendJobProgress(
      jobId,
      "preparing",
      attached.alreadyAttached
        ? "Ảnh scene đã có sẵn trong Thành phần; tiếp tục dán prompt video"
        : attached.reusedProjectAsset
          ? "Đã chọn lại ảnh scene có sẵn trong project Flow"
          : "Đã dùng file ảnh scene trên máy làm Thành phần",
    );
    if ((payload.refImages || []).length > 0) {
      sendJobProgress(
        jobId,
        "preparing",
        "Video chỉ dùng ảnh scene đã duyệt; không gắn lại ảnh nhân vật vì nhân vật đã nằm trong scene",
      );
    }
  }

  const submitted = await typeAndConfirmFlowPrompt(
    tabId,
    "FLOWX_PREPARE_VIDEO_PROMPT",
    payload.videoSettings.mode === "frames"
      ? videoPromptFromFrames(payload)
      : videoPromptFromComponent(payload),
  );
  if (!submitted?.ok) return submitted;
  sendJobProgress(
    jobId,
    "generating",
    `Đã gửi prompt; Google Flow đang tạo video ${payload.videoSettings.durationSeconds} giây`,
  );
  const video = await sendImageToFlowTab(tabId, { type: "WAIT_VIDEO" });
  if (!video?.ok) return video;

  const converted = await sendImageToFlowTab(tabId, { type: "TODATAURL", src: video.src });
  return {
    ok: true,
    src: video.src,
    dataUrl: typeof converted?.dataUrl === "string" ? converted.dataUrl : null,
  };
}

async function handleTimelineJob(message) {
  const { jobId, action, payload } = message;
  if (typeof jobId !== "string" || action !== "GENERATE_TIMELINE") {
    if (typeof jobId === "string") {
      sendJobError(jobId, "Unsupported or malformed job", "INVALID_JOB");
    }
    return;
  }
  if (connection.registration?.role !== "chat-worker") {
    sendJobError(jobId, "GENERATE_TIMELINE requires chat-worker", "WRONG_ROLE");
    return;
  }
  if (activeJob) {
    sendJobError(jobId, "Worker is already processing another job", "INVALID_JOB");
    return;
  }
  if (!isTimelinePayload(payload)) {
    sendJobError(jobId, "SRT and script text are required", "INVALID_JOB");
    return;
  }

  const tab = await findChatGptTab();
  if (!tab?.id) {
    sendJobError(
      jobId,
      "Không tìm thấy tab ChatGPT trong Chrome profile này",
      "NOT_LOGGED_IN",
      true,
    );
    return;
  }

  const currentTab = await chrome.tabs.get(tab.id);
  if (!/^https:\/\/chatgpt\.com\//i.test(currentTab.url || "")) {
    sendJobError(
      jobId,
      "Tab đích không còn là ChatGPT. Hãy tải lại trang ChatGPT rồi thử lại.",
      "NOT_LOGGED_IN",
      true,
    );
    return;
  }

  const job = { kind: "timeline", jobId, tabId: tab.id, stopping: false };
  activeJob = job;
  startActiveJobHeartbeat(jobId);
  sendJobProgress(jobId, "preparing", "Đang chuẩn bị yêu cầu cho ChatGPT");

  try {
    const response = await sendTimelineToChatTab(tab.id, {
      type: "FLOWX_GENERATE_TIMELINE",
      jobId,
      tabId: tab.id,
      payload,
    });

    if (activeJob !== job) return;
    if (!response?.ok) {
      sendJobError(
        jobId,
        response?.error || "ChatGPT content worker failed",
        response?.code || "INTERNAL_ERROR",
        response?.retryable === true,
      );
      return;
    }

    connection.send({ type: "JOB_DONE", jobId, result: response.result });
  } catch (error) {
    if (activeJob === job) {
      sendJobError(
        jobId,
        String(error?.message || error),
        job.stopping ? "STOPPED" : "INTERNAL_ERROR",
        !job.stopping,
      );
    }
  } finally {
    stopActiveJobHeartbeat();
    if (activeJob === job) activeJob = null;
    await detachDebugger();
  }
}

async function handleSceneJob(message) {
  const { jobId, action, payload } = message;
  if (
    typeof jobId !== "string" ||
    (action !== "GENERATE_IMAGE" && action !== "GENERATE_VIDEO")
  ) {
    if (typeof jobId === "string") {
      sendJobError(jobId, "Unsupported scene job", "INVALID_JOB");
    }
    return;
  }
  if (connection.registration?.role !== "flow-worker") {
    sendJobError(jobId, `${action} requires flow-worker`, "WRONG_ROLE");
    return;
  }
  if (activeJob) {
    sendJobError(jobId, "Worker is already processing another job", "INVALID_JOB");
    return;
  }
  if (!isSceneJobPayload(payload)) {
    sendJobError(jobId, "Scene id, media type, and prompt are required", "INVALID_JOB");
    return;
  }

  if (!validReferenceImages(payload.refImages)) {
    sendJobError(jobId, "Danh sách ảnh tham chiếu không hợp lệ", "INVALID_JOB");
    return;
  }

  const tab = await findFlowTab();
  if (!tab?.id) {
    sendJobError(
      jobId,
      "Không tìm thấy tab Google Flow đang mở trong Chrome profile này.",
      "FLOW_WORKSPACE_NOT_FOUND",
      true,
    );
    return;
  }

  try {
    await activateFlowWorkspace(tab);
    const modeReady = await ensureFlowMediaMode(tab.id, payload.mediaType);
    if (!modeReady?.ok) {
      sendJobError(
        jobId,
        modeReady?.error || "Google Flow không đổi được chế độ Hình ảnh/Video",
        modeReady?.code || "FLOW_MODE_CHANGE_FAILED",
        true,
      );
      return;
    }
  } catch (error) {
    sendJobError(
      jobId,
      `Không thể tự chuyển tab hoặc chế độ Google Flow: ${String(error?.message || error)}`,
      "FLOW_WORKSPACE_ACTIVATION_FAILED",
      true,
    );
    return;
  }

  const job = { kind: "scene", jobId, tabId: tab.id, stopping: false };
  activeJob = job;
  startActiveJobHeartbeat(jobId);
  try {
    if (payload.mediaType === "image") {
      sendJobProgress(jobId, "preparing", "Đã tự chuyển tab Flow sang chế độ Hình ảnh");
      sendJobProgress(jobId, "preparing", `Đang gắn ${payload.refImages.length} ảnh nhân vật vào Flow`);
    } else {
      sendJobProgress(jobId, "preparing", "Đã tự chuyển tab Flow sang chế độ Video");
      sendJobProgress(
        jobId,
        "preparing",
        payload.videoSettings.mode === "frames"
          ? "Đang gắn Start/End frame trong Flow"
          : "Đang gắn ảnh scene và ảnh neo làm Thành phần trong Flow",
      );
    }
    const response = payload.mediaType === "image"
      ? await generateFlowImage(tab.id, payload, jobId)
      : await generateFlowVideo(tab.id, payload, jobId);
    if (activeJob !== job || job.stopping) return;
    if (!response?.ok) {
      const code = response?.timeout ? "TIMEOUT" : response?.code || "INTERNAL_ERROR";
      sendJobError(
        jobId,
        response?.error || (response?.timeout ? `Google Flow tạo ${payload.mediaType === "image" ? "ảnh" : "video"} quá thời gian` : `Google Flow không tạo được ${payload.mediaType === "image" ? "ảnh" : "video"}`),
        code,
        ["TIMEOUT", "FLOW_UI_CHANGED", "FLOW_REF_UPLOAD_FAILED", "FLOW_REF_ATTACH_FAILED", "FLOW_START_FRAME_ATTACH_FAILED", "FLOW_END_FRAME_ATTACH_FAILED", "FLOW_VIDEO_MODE_NOT_FOUND", "FLOW_VIDEO_MODE_CHANGE_FAILED", "FLOW_VIDEO_SETTINGS_NOT_FOUND", "FLOW_VIDEO_ASPECT_RATIO_NOT_FOUND", "FLOW_VIDEO_ASPECT_RATIO_CHANGE_FAILED", "FLOW_VIDEO_DURATION_NOT_FOUND", "FLOW_VIDEO_DURATION_CHANGE_FAILED", "FLOW_SUBMIT_FAILED"].includes(code),
      );
      return;
    }
    sendJobProgress(jobId, "downloading", `Đang lưu ${payload.mediaType === "image" ? "ảnh" : "video"} vào Downloads/KC Auto Tool`);
    const resultPath = payload.mediaType === "image"
      ? await downloadFlowImage(response, payload)
      : await downloadFlowVideo(response, payload);
    if (activeJob !== job || job.stopping) return;
    connection.send({
      type: "JOB_DONE",
      jobId,
      result: {
        sceneId: payload.sceneId,
        mediaType: payload.mediaType,
        resultPath,
        flowAssetKey: payload.mediaType === "image" ? response.flowAssetKey || "" : "",
      },
    });
  } catch (error) {
    if (activeJob === job) {
      sendJobError(jobId, String(error?.message || error), job.stopping ? "STOPPED" : "INTERNAL_ERROR", !job.stopping);
    }
  } finally {
    stopActiveJobHeartbeat();
    if (activeJob === job) activeJob = null;
    await detachDebugger();
  }
}

async function handleStop(message) {
  if (!activeJob) return;
  if (message.jobId && message.jobId !== activeJob.jobId) return;

  const job = activeJob;
  job.stopping = true;
  activeJob = null;
  stopActiveJobHeartbeat();
  sendJobProgress(job.jobId, "stopping", "Đang dừng tạo timeline");
  if (job.kind === "scene") {
    if (job.tabId) {
      try {
        await chrome.tabs.sendMessage(job.tabId, { type: "STOP" });
      } catch (_) {
        // The Flow tab may already be closed.
      }
    }
    await detachDebugger();
    sendJobError(job.jobId, "Scene job stopped", "STOPPED");
    return;
  }
  try {
    await chrome.tabs.sendMessage(job.tabId, {
      type: "FLOWX_STOP_TIMELINE",
      jobId: job.jobId,
    });
  } catch {
    sendJobError(job.jobId, "Timeline generation stopped", "STOPPED");
  }
  await detachDebugger();
}

function handleDesktopMessage(message) {
  if (message?.type === "JOB") {
    if (message.action === "GENERATE_TIMELINE") {
      void handleTimelineJob(message);
    } else {
      void handleSceneJob(message);
    }
  } else if (message?.type === "STOP") {
    void handleStop(message);
  }
}

const connection = new WorkerConnection({
  getRegistration: detectRegistration,
  onStateChange: updateActionState,
  onMessage: handleDesktopMessage,
});

function queueRoleRefresh() {
  if (roleRefreshTimer) clearTimeout(roleRefreshTimer);
  roleRefreshTimer = setTimeout(() => {
    roleRefreshTimer = null;
    void connection.refreshRegistration();
  }, 250);
}

async function ensureReconnectAlarm() {
  const existing = await chrome.alarms.get(RECONNECT_ALARM);
  if (!existing) {
    await chrome.alarms.create(RECONNECT_ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: 0.5,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureReconnectAlarm();
  void connection.ensureConnected();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureReconnectAlarm();
  void connection.ensureConnected();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    void connection.ensureConnected();
  }
});

chrome.tabs.onCreated.addListener(queueRoleRefresh);
chrome.tabs.onRemoved.addListener(queueRoleRefresh);
chrome.tabs.onActivated.addListener(queueRoleRefresh);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") queueRoleRefresh();
});

chrome.action.onClicked.addListener(() => {
  void connection.ensureConnected();
});

void ensureReconnectAlarm();
void connection.start();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let attachedTab = null;

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === attachedTab) {
    console.warn("[KC Dev] Debugger detached from tab", source.tabId);
    attachedTab = null;
  }
});

function sendCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function ensureAttached(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https:\/\/(?:chatgpt\.com\/|labs\.google\/fx\/|flow\.google\/)/i.test(tab.url || "")) {
    throw new Error("Debugger target is not a supported KC Dev tab");
  }
  if (attachedTab === tabId) return;

  if (attachedTab !== null) {
    try {
      await chrome.debugger.detach({ tabId: attachedTab });
    } catch (_) {
      // The previous tab may already be closed.
    }
    attachedTab = null;
  }

  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
  attachedTab = tabId;
}

async function detachDebugger() {
  if (attachedTab === null) return;

  try {
    await chrome.debugger.detach({ tabId: attachedTab });
  } catch (_) {
    // Detaching is idempotent from the worker's perspective.
  }
  attachedTab = null;
}

async function typeAndSubmit(tabId, x, y, prompt) {
  await ensureAttached(tabId);

  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
  await wait(220);
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await wait(180);

  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    modifiers: 2,
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 2,
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await wait(60);

  await sendCommand(tabId, "Input.insertText", { text: prompt });
  // Leave the filled prompt visible long enough to verify it before Submit.
  await wait(900);

  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return undefined;

  if (message.type === "WORKER_PAGE_READY") {
    queueRoleRefresh();
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.type === "DEBUG_SUBMIT") {
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "Cannot determine the active tab" });
      return undefined;
    }
    typeAndSubmit(tabId, message.x, message.y, message.prompt)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: String(error.message || error) }),
      );
    return true;
  }

  if (message.type === "DEBUG_DETACH") {
    detachDebugger().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (
    message.type === "TIMELINE_PROGRESS" &&
    activeJob?.jobId === message.jobId
  ) {
    sendJobProgress(
      activeJob.jobId,
      message.status === "preparing" ? "preparing" : "generating",
      typeof message.message === "string" ? message.message.slice(0, 500) : undefined,
    );
    sendResponse({ ok: true });
    return undefined;
  }

  return undefined;
});
