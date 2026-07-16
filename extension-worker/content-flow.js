// ============================================================
//  Flow Batch — content.js
//  Đây là "con bot" được tiêm thẳng vào trang Google Flow.
//  Nó tìm ô prompt, gõ chữ, bấm Generate, canh ảnh xong, rồi
//  trả ảnh về cho side panel để tải xuống.
//
//  >>> NẾU GOOGLE ĐỔI GIAO DIỆN VÀ TOOL HỎNG <<<
//  Bạn chỉ cần sửa phần CONFIG ngay bên dưới. Mở Google Flow,
//  bấm F12 -> chọn ô prompt / nút generate -> copy CSS selector
//  rồi dán vào promptSelector / generateSelector.
// ============================================================

const CONFIG = {
  // Để trống ("") thì tool TỰ DÒ. Nếu tự dò sai, điền selector vào đây.
  promptSelector: "",        // vd: 'textarea[placeholder*="create"]'
  generateSelector: "",      // vd: 'button[aria-label="Generate"]'

  // Phase 5 reference binding. Leave blank to use the accessible-label
  // heuristics below, or paste the selectors from the current Flow UI.
  addReferenceSelector: "",
  referenceInputSelector: 'input[type="file"][accept*="image"]',
  referenceTokenSelector: "",

  // Cách submit: Flow này submit bằng phím ENTER nên để true (mặc định).
  // Nếu Flow của bạn cần click nút thì đổi false.
  submitWithEnter: true,

  // Ảnh kết quả thường to; bỏ qua icon/avatar nhỏ hơn ngưỡng này (pixel)
  minImageSize: 256,

  // Canh ảnh: kiểm tra mỗi pollMs mili-giây, tối đa chờ maxWaitMs
  pollMs: 2000,
  maxWaitMs: 240000,         // 4 phút / 1 ảnh (chỉnh nếu model chậm hơn)

  // Chờ thêm sau khi thấy ảnh mới, để ảnh load đầy đủ trước khi tải
  settleMs: 1800,
};

let STOP = false;

// ---------- Tiện ích nhỏ ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(find, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = find();
    if (value) return value;
    await sleep(150);
  }
  return null;
}

function buttonLabel(button) {
  return `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`.trim();
}

function findAddReferenceButton() {
  if (CONFIG.addReferenceSelector) {
    const configured = document.querySelector(CONFIG.addReferenceSelector);
    if (configured) return configured;
  }
  const wanted = /^(add|thêm)$|add\s*(more\s*)?(ref|reference|ingredient|media)|reference\s*(image|asset)|thêm\s*(ảnh\s*)?(tham chiếu|nguyên liệu)/i;
  const candidates = [...document.querySelectorAll('button, [role="button"]')]
    .filter(isVisible)
    .filter((button) => wanted.test(buttonLabel(button)));
  const prompt = findPromptInput();
  if (!prompt || candidates.length < 2) return candidates[0] || null;
  const promptRect = prompt.getBoundingClientRect();
  return candidates.sort((left, right) => {
    const distance = (element) => {
      const rect = element.getBoundingClientRect();
      return Math.hypot(rect.left - promptRect.left, rect.top - promptRect.top);
    };
    return distance(left) - distance(right);
  })[0] || null;
}

function findReferenceFileInput() {
  const selectors = [
    CONFIG.referenceInputSelector,
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
  ].filter(Boolean);
  for (const selector of selectors) {
    const inputs = [...document.querySelectorAll(selector)];
    if (inputs.length) return inputs.at(-1);
  }
  return null;
}

function findVisibleControl(pattern) {
  return [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')]
    .filter(isVisible)
    .find((control) => pattern.test(buttonLabel(control))) || null;
}

async function openReferenceUpload() {
  const addButton = findAddReferenceButton();
  if (!addButton) return findReferenceFileInput();
  clickFully(addButton);
  await sleep(300);

  const upload = findVisibleControl(/^(upload|tải lên)$/i);
  if (upload) {
    clickFully(upload);
    await sleep(300);
  }
  const media = findVisibleControl(/^(media|phương tiện)$/i);
  if (media) {
    clickFully(media);
    await sleep(300);
  }
  return waitUntil(findReferenceFileInput);
}

function referenceFile(reference) {
  const binary = atob(reference.imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const extension = reference.mimeType === "image/png"
    ? "png"
    : reference.mimeType === "image/webp"
      ? "webp"
      : "jpg";
  return new File(
    [bytes],
    `${String(reference.token || "REFERENCE").replace(/^@/, "")}.${extension}`,
    { type: reference.mimeType },
  );
}

function assignReferenceToken(index, token) {
  if (!CONFIG.referenceTokenSelector) return;
  const inputs = [...document.querySelectorAll(CONFIG.referenceTokenSelector)];
  const input = inputs[index] || inputs.at(-1);
  if (!input) return;
  setNativeValue(input, token);
}

async function uploadReferences(references) {
  if (!Array.isArray(references) || references.length === 0) {
    return { ok: true };
  }

  for (let index = 0; index < references.length; index += 1) {
    if (STOP) return { ok: false, stopped: true };
    const input = await openReferenceUpload();
    if (!input) {
      return {
        ok: false,
        code: "FLOW_UI_CHANGED",
        error: "Không tìm thấy nút Add reference hoặc input upload ảnh trên Google Flow.",
      };
    }

    const transfer = new DataTransfer();
    transfer.items.add(referenceFile(references[index]));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await sleep(1000);
    assignReferenceToken(index, references[index].token);
  }
  return { ok: true };
}

function referenceVisualSnapshot() {
  return new Set(
    [...document.querySelectorAll('img, [role="img"]')].map((element) =>
      `${element.tagName}:${element.currentSrc || element.src || ""}:${element.getAttribute("aria-label") || ""}`,
    ),
  );
}

function promptIngredientElements() {
  const prompt = findPromptInput();
  if (!prompt) return [];
  const promptRect = prompt.getBoundingClientRect();
  return [...document.querySelectorAll('img, [role="img"]')]
    .filter(isVisible)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return (
        rect.width >= 24 && rect.height >= 24 && rect.width <= 240 && rect.height <= 240 &&
        centerX >= promptRect.left - 140 &&
        centerX <= promptRect.right + 140 &&
        centerY >= promptRect.top - 180 &&
        centerY <= promptRect.bottom + 120
      );
    });
}

function promptIngredientSnapshot() {
  return new Set(
    promptIngredientElements()
      .map((element) =>
        `${element.tagName}:${element.currentSrc || element.src || ""}:${element.getAttribute("aria-label") || ""}`,
      ),
  );
}

function promptMediaRemoveControl(mediaElement) {
  const mediaRect = mediaElement.getBoundingClientRect();
  const controls = [];
  let current = mediaElement.parentElement;
  for (let depth = 0; current && depth < 5 && current !== document.body; depth += 1) {
    const rect = current.getBoundingClientRect();
    if (rect.width <= 420 && rect.height <= 320) {
      controls.push(...current.querySelectorAll('button, [role="button"], [tabindex="0"]'));
    }
    current = current.parentElement;
  }
  const removePattern = /^(?:close|remove|delete|clear|cancel|x|đóng|xóa|gỡ)(?:\s+(?:image|media|asset|frame|ảnh|khung\s*hình))?$|remove_circle|cancel|close/i;
  return [...new Set(controls)]
    .filter(isVisible)
    .filter((control) => !control.disabled && control.getAttribute("aria-disabled") !== "true")
    .filter((control) => removePattern.test(buttonLabel(control).replace(/\s+/g, " ").trim()))
    .sort((left, right) => {
      const distance = (element) => {
        const rect = element.getBoundingClientRect();
        return Math.hypot(rect.right - mediaRect.right, rect.top - mediaRect.top);
      };
      return distance(left) - distance(right);
    })[0] || null;
}

async function clearPromptMedia() {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy ô prompt để dọn ảnh cũ." };
  }
  let removed = 0;
  for (let pass = 0; pass < 12; pass += 1) {
    const media = promptIngredientElements();
    if (media.length === 0) return { ok: true, removed };

    let removedThisPass = false;
    for (const element of media) {
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, composed: true }));
      element.parentElement?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, composed: true }));
      await sleep(120);
      const remove = promptMediaRemoveControl(element);
      if (!remove) continue;
      clickFully(remove);
      removed += 1;
      removedThisPass = true;
      await sleep(250);
      break;
    }
    if (!removedThisPass) {
      // Nearby generated-result thumbnails can fall inside the broad prompt
      // geometry but do not have a Remove control. They are not attachments.
      return { ok: true, removed, ignoredNearbyMedia: media.length };
    }
  }
  const remaining = promptIngredientElements().length;
  return remaining === 0
    ? { ok: true, removed }
    : {
      ok: false,
      code: "FLOW_STALE_MEDIA_CLEAR_FAILED",
      error: `Đã thử dọn ảnh cũ nhưng prompt vẫn còn ${remaining} thumbnail.`,
    };
}

function centerOf(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}

function findPromptAddButton() {
  const prompt = findPromptInput();
  if (!prompt) return null;
  const promptRect = prompt.getBoundingClientRect();
  const controls = [...document.querySelectorAll('button, [role="button"]')]
    .filter(isVisible)
    .filter((control) => {
      const label = buttonLabel(control).trim();
      const icon = control.querySelector('[data-icon], .material-symbols-outlined, svg');
      return /^(add|thêm|\+)$/i.test(label) || /add|plus/i.test(control.getAttribute("aria-label") || "") || icon?.textContent?.trim() === "add";
    });
  if (controls.length === 0) {
    controls.push(
      ...[...document.querySelectorAll('button, [role="button"]')]
        .filter(isVisible)
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return x >= promptRect.left - 80 && x <= promptRect.left + 180 && y >= promptRect.top - 60 && y <= promptRect.bottom + 100;
        }),
    );
  }
  const targetX = promptRect.left;
  const targetY = promptRect.bottom;
  return controls.sort((left, right) => {
    const distance = (element) => {
      const rect = element.getBoundingClientRect();
      return Math.hypot(rect.left + rect.width / 2 - targetX, rect.top + rect.height / 2 - targetY);
    };
    return distance(left) - distance(right);
  })[0] || null;
}

async function getPromptAddButton() {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy ô prompt Google Flow." };
  }
  window.__flowx_ingredient_baseline = promptIngredientSnapshot();
  window.__flowx_ingredient_baseline_elements = new Set(promptIngredientElements());
  const button = await waitUntil(findPromptAddButton, 8000);
  return button
    ? { ok: true, ...centerOf(button) }
    : { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy dấu + ở góc dưới trái ô prompt." };
}

async function getUploadMediaButton() {
  const pattern = /tải\s*nội\s*dung\s*nghe\s*nhìn|upload\s*media|upload\s*(content|asset)|tải\s*(media|phương tiện)/i;
  const button = await waitUntil(
    () => [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')]
      .filter(isVisible)
      .find((control) => pattern.test(buttonLabel(control))),
    10000,
  );
  if (!button) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Popup đã mở nhưng không tìm thấy nút Tải nội dung nghe nhìn." };
  }
  window.__flowx_picker_baseline = referenceVisualSnapshot();
  return { ok: true, ...centerOf(button) };
}

async function getFreshUploadedAsset() {
  const baseline = window.__flowx_picker_baseline || new Set();
  const asset = await waitUntil(() => {
    const fresh = [...document.querySelectorAll('img, [role="img"]')]
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 48 || rect.height < 48) return false;
        const signature = `${element.tagName}:${element.currentSrc || element.src || ""}:${element.getAttribute("aria-label") || ""}`;
        return !baseline.has(signature);
      });
    return fresh.at(-1) || null;
  }, 30000);
  return asset
    ? {
      ok: true,
      ...centerOf(asset),
      assetKey: flowAssetKeyForElement(asset),
      assetLocator: flowAssetLocatorForElement(asset),
    }
    : { ok: false, code: "FLOW_REF_UPLOAD_FAILED", error: "Không thấy thumbnail ảnh nhân vật mới trong popup sau khi chọn file." };
}

async function getAddToPromptButton() {
  const pattern = /thêm\s*vào\s*câu\s*lệnh|add\s*to\s*prompt/i;
  const button = await waitUntil(
    () => [...document.querySelectorAll('button, [role="button"]')]
      .filter(isVisible)
      .filter((control) => !control.disabled && control.getAttribute("aria-disabled") !== "true")
      .find((control) => pattern.test(buttonLabel(control))),
    10000,
  );
  return button
    ? { ok: true, ...centerOf(button) }
    : { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy nút Thêm vào câu lệnh trong popup." };
}

function findModelPickerButton() {
  const prompt = findPromptInput();
  if (!prompt) return null;
  const promptRect = prompt.getBoundingClientRect();
  const modelPattern = /nano\s*banana|imagen|image\s*model|mô\s*hình/i;
  const candidates = [...document.querySelectorAll('button, [role="button"]')]
    .filter(isVisible)
    .filter((control) => modelPattern.test(buttonLabel(control)));
  return candidates.sort((left, right) => {
    const distance = (element) => {
      const rect = element.getBoundingClientRect();
      return Math.hypot(
        rect.left + rect.width / 2 - promptRect.right,
        rect.top + rect.height / 2 - promptRect.top,
      );
    };
    return distance(left) - distance(right);
  })[0] || null;
}

function detectWorkspaceMode() {
  const activeMediaTab = [...document.querySelectorAll('button[role="tab"][aria-selected="true"], [role="tab"][data-state="active"]')]
    .filter(isVisible)
    .find((control) => {
      const identity = `${control.id || ""} ${control.getAttribute("aria-controls") || ""}`;
      return /-(?:trigger|content)-(?:IMAGE|VIDEO)$/i.test(identity);
    });
  if (activeMediaTab) {
    const identity = `${activeMediaTab.id || ""} ${activeMediaTab.getAttribute("aria-controls") || ""}`;
    if (/-VIDEO$/i.test(identity)) return { ok: true, mode: "video", evidence: identity.trim() };
    if (/-IMAGE$/i.test(identity)) return { ok: true, mode: "image", evidence: identity.trim() };
  }
  const controls = [...document.querySelectorAll('button, [role="button"], [role="option"], [aria-selected="true"], [aria-pressed="true"]')]
    .filter(isVisible)
    .filter((control) => !control.hasAttribute("data-flowx-mode-option"));
  const labels = controls.map(buttonLabel).filter(Boolean);
  const videoLabel = labels.find((label) => /\bveo\b|frames?\s*(?:to\s*)?video|video\s*model|khung\s*hình|tạo\s*video/i.test(label));
  const imageLabel = labels.find((label) => /nano\s*banana|\bimagen\b|image\s*model|tạo\s*hình\s*ảnh/i.test(label));
  if (findStartFrameButton()) {
    return { ok: true, mode: "video", evidence: videoLabel || "start-frame-control" };
  }
  if (videoLabel && !imageLabel) return { ok: true, mode: "video", evidence: videoLabel };
  if (imageLabel && !videoLabel) return { ok: true, mode: "image", evidence: imageLabel };
  if (videoLabel && imageLabel) {
    const selected = controls.find((control) =>
      control.getAttribute("aria-selected") === "true" ||
      control.getAttribute("aria-pressed") === "true" ||
      control.getAttribute("data-state") === "checked"
    );
    const selectedLabel = selected ? buttonLabel(selected) : "";
    if (/\bveo\b|video|khung\s*hình/i.test(selectedLabel)) {
      return { ok: true, mode: "video", evidence: selectedLabel };
    }
    if (/nano\s*banana|imagen|hình\s*ảnh/i.test(selectedLabel)) {
      return { ok: true, mode: "image", evidence: selectedLabel };
    }
  }
  return { ok: true, mode: "unknown", evidence: "No exposed model label" };
}

function nearbyPromptButtons(prompt) {
  const promptRect = prompt.getBoundingClientRect();
  return [...document.querySelectorAll('button, [role="button"]')]
    .filter(isVisible)
    .filter((control) => {
      const rect = control.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return rect.width >= 16 && rect.height >= 16 &&
        centerX >= promptRect.left - 160 && centerX <= promptRect.right + 160 &&
        centerY >= promptRect.top - 120 && centerY <= promptRect.bottom + 120;
    });
}

function findPromptSendControl(prompt) {
  const promptRect = prompt.getBoundingClientRect();
  const controls = nearbyPromptButtons(prompt);
  const sendPattern = /arrow_forward|generate|create|submit|send|run|gửi|paper.?plane|→/i;
  const labelled = controls.filter((control) => sendPattern.test(buttonLabel(control)));
  const candidates = labelled.length > 0 ? labelled : controls;
  return candidates.sort((left, right) => {
    const score = (element) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return Math.abs(centerX - promptRect.right) + Math.abs(centerY - promptRect.bottom) * 1.5;
    };
    return score(left) - score(right);
  })[0] || null;
}

function findMediaModePickerButton() {
  const prompt = findPromptInput();
  if (!prompt) return null;
  const promptRect = prompt.getBoundingClientRect();
  const pattern = /nano\s*banana|\bimagen\b|\bveo\b|(?:^|\s)image(?:\s|$)|(?:^|\s)video(?:\s|$)|hình\s*ảnh|tạo\s*video/i;
  const addPattern = /^(add|thêm|\+)$/i;
  const send = findPromptSendControl(prompt);
  const sendRect = send?.getBoundingClientRect();
  const candidates = nearbyPromptButtons(prompt)
    .filter((control) => control !== send)
    .filter((control) => !control.hasAttribute("data-flowx-mode-option"))
    .filter((control) => !addPattern.test(buttonLabel(control).trim()))
    .filter((control) => {
      if (!sendRect) return pattern.test(buttonLabel(control));
      const rect = control.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const sendCenterY = sendRect.top + sendRect.height / 2;
      const horizontalGap = sendRect.left - rect.right;
      return horizontalGap >= -8 && horizontalGap <= 220 &&
        Math.abs(centerY - sendCenterY) <= Math.max(28, (rect.height + sendRect.height) / 2);
    });

  if (candidates.length > 0) {
    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      if (sendRect) {
        const leftScore = Math.abs(sendRect.left - leftRect.right) + (pattern.test(buttonLabel(left)) ? 0 : 12);
        const rightScore = Math.abs(sendRect.left - rightRect.right) + (pattern.test(buttonLabel(right)) ? 0 : 12);
        return leftScore - rightScore;
      }
      return Math.abs(leftRect.right - promptRect.right) - Math.abs(rightRect.right - promptRect.right);
    })[0];
  }

  return nearbyPromptButtons(prompt)
    .filter((control) => pattern.test(buttonLabel(control)))
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return Math.abs(leftRect.right - promptRect.right) - Math.abs(rightRect.right - promptRect.right);
    })[0] || null;
}

async function getMediaModePicker(mediaType) {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy ô prompt Google Flow." };
  }
  const current = detectWorkspaceMode();
  if (current.mode === mediaType) {
    return { ok: true, alreadySelected: true, mode: mediaType, evidence: current.evidence };
  }
  const picker = await waitUntil(findMediaModePickerButton, 8000);
  if (!picker) {
    return {
      ok: false,
      code: "FLOW_MODE_PICKER_NOT_FOUND",
      error: "Không tìm thấy nút đổi Hình ảnh/Video ở bên trái nút Gửi của ô prompt Flow.",
    };
  }
  for (const previous of document.querySelectorAll("[data-flowx-mode-picker]")) {
    previous.removeAttribute("data-flowx-mode-picker");
  }
  picker.setAttribute("data-flowx-mode-picker", "true");
  return { ok: true, ...centerOf(picker), label: buttonLabel(picker) };
}

async function getMediaModeOption(mediaType) {
  const option = await waitUntil(() => {
    const suffix = mediaType === "video" ? "VIDEO" : "IMAGE";
    const exactTab = [...document.querySelectorAll(
      `button[role="tab"][id$="-trigger-${suffix}"], button[role="tab"][aria-controls$="-content-${suffix}"]`,
    )].filter(isVisible)[0];
    if (exactTab) return exactTab;

    const candidates = [...document.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"]')]
      .filter(isVisible)
      .filter((control) => !control.hasAttribute("data-flowx-mode-picker"))
      .filter((control) => {
        const label = buttonLabel(control).replace(/^(?:play_circle|image|movie|videocam)\s*/i, "").replace(/\s+/g, " ").trim();
        if (label.length > 60 || /nano\s*banana|\bimagen\b|\bveo\b/i.test(label)) return false;
        return mediaType === "video"
          ? /(?:^|\s)video(?:s)?(?:\s|$)|tạo\s*video/i.test(label)
          : /(?:^|\s)image(?:s)?(?:\s|$)|hình\s*ảnh|tạo\s*hình\s*ảnh/i.test(label) && !/video/i.test(label);
      });
    return candidates.sort((left, right) =>
      left.getBoundingClientRect().top - right.getBoundingClientRect().top
    )[0] || null;
  }, 8000);
  if (!option) {
    return {
      ok: false,
      code: "FLOW_MODE_OPTION_NOT_FOUND",
      error: `Popup chế độ không có lựa chọn ${mediaType === "image" ? "Hình ảnh" : "Video"}.`,
    };
  }
  option.setAttribute("data-flowx-mode-option", mediaType);
  return { ok: true, ...centerOf(option), label: buttonLabel(option) };
}

async function confirmMediaMode(mediaType) {
  const selected = await waitUntil(() => {
    const current = detectWorkspaceMode();
    return current.mode === mediaType ? current : null;
  }, 10000);
  for (const element of document.querySelectorAll("[data-flowx-mode-picker], [data-flowx-mode-option]")) {
    element.removeAttribute("data-flowx-mode-picker");
    element.removeAttribute("data-flowx-mode-option");
  }
  return selected
    ? { ok: true, mode: mediaType, evidence: selected.evidence }
    : {
      ok: false,
      code: "FLOW_MODE_CHANGE_FAILED",
      error: `Google Flow chưa chuyển sang chế độ ${mediaType === "image" ? "Hình ảnh" : "Video"}.`,
    };
}

function cleanFlowOptionLabel(control) {
  return buttonLabel(control)
    .replace(/^(?:category|collections|dashboard|view_carousel|photo_library|aspect_ratio|crop_(?:\d+_\d+|landscape|portrait)|timer|schedule)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function flowControlIdentity(control) {
  return `${control?.id || ""} ${control?.getAttribute?.("aria-controls") || ""}`.trim();
}

function isLandscapeAspectControl(control) {
  return /-(?:trigger|content)-(?:LANDSCAPE|WIDE|16_9)$/i.test(flowControlIdentity(control)) ||
    cleanFlowOptionLabel(control) === "16:9";
}

function selectedFlowTab(control) {
  return control?.getAttribute?.("aria-selected") === "true" ||
    control?.getAttribute?.("data-state") === "active" ||
    control?.getAttribute?.("aria-checked") === "true";
}

function videoSettingsDiagnosticSummary() {
  const controls = [...document.querySelectorAll('button[role="tab"], [role="tab"], [role="radio"]')];
  const describe = (control) => {
    const label = cleanFlowOptionLabel(control) || buttonLabel(control) || "(no label)";
    const identity = flowControlIdentity(control) || "(no id)";
    return `${label} {${identity}; selected=${selectedFlowTab(control)}; visible=${isVisible(control)}}`;
  };
  const active = controls.filter(selectedFlowTab).slice(0, 12).map(describe);
  const ratios = controls.filter((control) => /\d+\s*:\s*\d+/.test(cleanFlowOptionLabel(control)) ||
    /LANDSCAPE|PORTRAIT|WIDE|16_9|9_16/i.test(flowControlIdentity(control)))
    .slice(0, 12)
    .map(describe);
  return `Active tabs: ${active.join(" | ") || "none"}. Ratio candidates: ${ratios.join(" | ") || "none"}.`;
}

async function getVideoSettingsPicker() {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Google Flow has no visible video prompt box." };
  }
  const picker = await waitUntil(findMediaModePickerButton, 8000);
  return picker
    ? { ok: true, ...centerOf(picker), label: buttonLabel(picker) }
    : {
      ok: false,
      code: "FLOW_VIDEO_SETTINGS_NOT_FOUND",
      error: "Cannot find the video settings button immediately to the left of Send.",
    };
}

function videoModePattern(mode) {
  return mode === "frames"
    ? /^(?:frames?|start\s*(?:and|&)\s*end|khung\s*h\u00ecnh)$/i
    : /^(?:ingredients?|components?|th\u00e0nh\s*ph\u1ea7n)$/i;
}

async function getVideoGenerationModeOption(mode) {
  const normalizedMode = mode === "frames" ? "frames" : "ingredients";
  const identitySuffixes = normalizedMode === "frames"
    ? ["FRAME", "FRAMES"]
    : ["INGREDIENT", "INGREDIENTS", "COMPONENT", "COMPONENTS"];
  const option = await waitUntil(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"], [role="tab"]')].filter(isVisible);
    const exactIdentity = tabs.find((control) => {
      const identity = `${control.id || ""} ${control.getAttribute("aria-controls") || ""}`;
      return identitySuffixes.some((suffix) =>
        new RegExp(`-(?:trigger|content)-${suffix}$`, "i").test(identity)
      );
    });
    if (exactIdentity) return exactIdentity;
    return tabs.find((control) => videoModePattern(normalizedMode).test(cleanFlowOptionLabel(control))) || null;
  }, 8000);
  return option
    ? { ok: true, ...centerOf(option), label: cleanFlowOptionLabel(option) }
    : {
      ok: false,
      code: "FLOW_VIDEO_MODE_NOT_FOUND",
      error: `Video settings popup has no ${normalizedMode === "frames" ? "Frames" : "Ingredients"} tab.`,
    };
}

async function confirmVideoGenerationMode(mode) {
  const normalizedMode = mode === "frames" ? "frames" : "ingredients";
  const identitySuffixes = normalizedMode === "frames"
    ? ["FRAME", "FRAMES"]
    : ["INGREDIENT", "INGREDIENTS", "COMPONENT", "COMPONENTS"];
  const selected = await waitUntil(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"], [role="tab"]')];
    return tabs.find((control) => {
      if (!selectedFlowTab(control)) return false;
      const identity = flowControlIdentity(control);
      return identitySuffixes.some((suffix) =>
        new RegExp(`-(?:trigger|content)-${suffix}$`, "i").test(identity)
      ) || videoModePattern(normalizedMode).test(cleanFlowOptionLabel(control));
    }) || null;
  }, 7000);
  return selected
    ? { ok: true, mode: normalizedMode, label: cleanFlowOptionLabel(selected) }
    : {
      ok: false,
      code: "FLOW_VIDEO_MODE_CHANGE_FAILED",
      error: `Google Flow did not select ${normalizedMode === "frames" ? "Frames" : "Ingredients"}.`,
    };
}

function isDurationControl(control, seconds) {
  if (new RegExp(`-(?:trigger|content)-${seconds}$`, "i").test(flowControlIdentity(control))) {
    return true;
  }
  const label = cleanFlowOptionLabel(control);
  return !/\d+\s*:\s*\d+/.test(label) &&
    new RegExp(`^${seconds}(?:\\s*(?:s|sec|secs|seconds|gi\\u00e2y))?$`, "i").test(label);
}

async function getVideoAspectRatioOption() {
  const option = await waitUntil(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"], [role="tab"]')].filter(isVisible);
    return tabs.find(isLandscapeAspectControl) || null;
  }, 8000);
  return option
    ? {
      ok: true,
      ...centerOf(option),
      label: cleanFlowOptionLabel(option),
      identity: flowControlIdentity(option),
      alreadySelected: selectedFlowTab(option),
    }
    : {
      ok: false,
      code: "FLOW_VIDEO_ASPECT_RATIO_NOT_FOUND",
      error: `Video settings popup has no 16:9 option. ${videoSettingsDiagnosticSummary()}`,
    };
}

async function confirmVideoAspectRatio() {
  // Flow identifies this tab as LANDSCAPE while its visible text can include
  // a Material Symbol such as "crop_landscape". Use the same identity rule
  // for both discovery and confirmation, even if the popup closes after click.
  const selected = await waitUntil(() =>
    [...document.querySelectorAll('button[role="tab"], [role="tab"], [role="radio"]')]
      .find((control) => selectedFlowTab(control) && isLandscapeAspectControl(control)) || null, 7000);
  return selected
    ? {
      ok: true,
      aspectRatio: "16:9",
      label: cleanFlowOptionLabel(selected),
      identity: flowControlIdentity(selected),
    }
    : {
      ok: false,
      code: "FLOW_VIDEO_ASPECT_RATIO_CHANGE_FAILED",
      error: `Google Flow did not select 16:9. ${videoSettingsDiagnosticSummary()}`,
    };
}

async function getVideoDurationOption(durationSeconds) {
  const seconds = [4, 6, 8].includes(Number(durationSeconds)) ? Number(durationSeconds) : 8;
  const option = await waitUntil(() => {
    const exactTab = [...document.querySelectorAll(
      `button[role="tab"][id$="-trigger-${seconds}"], button[role="tab"][aria-controls$="-content-${seconds}"]`,
    )].filter(isVisible)[0];
    if (exactTab) return exactTab;
    return [...document.querySelectorAll('button, [role="tab"], [role="option"], [role="radio"]')]
      .filter(isVisible)
      .find((control) => {
        const label = cleanFlowOptionLabel(control);
        if (/\d+\s*:\s*\d+/.test(label)) return false; // Never confuse 9:16 with duration.
        return new RegExp(`^${seconds}(?:\\s*(?:s|sec|secs|seconds|gi\\u00e2y))?$`, "i").test(label);
      }) || null;
  }, 8000);
  return option
    ? {
      ok: true,
      ...centerOf(option),
      label: cleanFlowOptionLabel(option),
      identity: flowControlIdentity(option),
      alreadySelected: selectedFlowTab(option),
      durationSeconds: seconds,
    }
    : {
      ok: false,
      code: "FLOW_VIDEO_DURATION_NOT_FOUND",
      error: `Video settings popup has no ${seconds}-second option.`,
    };
}

async function confirmVideoDuration(durationSeconds) {
  const seconds = [4, 6, 8].includes(Number(durationSeconds)) ? Number(durationSeconds) : 8;
  const selected = await waitUntil(() => {
    return [...document.querySelectorAll('button, [role="tab"], [role="radio"]')]
      .find((control) => selectedFlowTab(control) && isDurationControl(control, seconds)) || null;
  }, 7000);
  return selected
    ? {
      ok: true,
      durationSeconds: seconds,
      label: cleanFlowOptionLabel(selected),
      identity: flowControlIdentity(selected),
    }
    : {
      ok: false,
      code: "FLOW_VIDEO_DURATION_CHANGE_FAILED",
      error: `Google Flow did not select ${seconds} seconds. ${videoSettingsDiagnosticSummary()}`,
    };
}

function findStartFrameButton() {
  const prompt = findPromptInput();
  const promptRect = prompt?.getBoundingClientRect();
  const pattern = /add\s*(?:a\s*)?start\s*frame|start\s*frame|thêm\s*khung\s*hình\s*bắt\s*đầu|khung\s*hình\s*bắt\s*đầu/i;
  const endPattern = /end\s*frame|last\s*frame|khung\s*hình\s*(?:kết\s*thúc|cuối)/i;
  const candidates = [...document.querySelectorAll('button, [role="button"], [tabindex="0"], [type="button"][aria-haspopup="dialog"]')]
    .filter(isVisible)
    .filter((control) => {
      const label = buttonLabel(control).replace(/\s+/g, " ").trim();
      const rect = control.getBoundingClientRect();
      const bareDialogLabel = control.getAttribute("aria-haspopup") === "dialog" &&
        /^(?:start|bắt\s*đầu)$/i.test(label);
      return (pattern.test(label) || bareDialogLabel) && !endPattern.test(label) &&
        rect.width >= 32 && rect.height >= 24;
    });
  if (!promptRect || candidates.length < 2) return candidates[0] || null;
  return candidates.sort((left, right) => {
    const distance = (element) => {
      const rect = element.getBoundingClientRect();
      return Math.hypot(rect.left - promptRect.left, rect.bottom - promptRect.top);
    };
    return distance(left) - distance(right);
  })[0] || null;
}

function findEndFrameButton() {
  const pattern = /add\s*(?:an?\s*)?end\s*frame|end\s*frame|last\s*frame|khung\s*h\u00ecnh\s*(?:k\u1ebft\s*th\u00fac|cu\u1ed1i)/i;
  return [...document.querySelectorAll('button, [role="button"], [tabindex="0"], [type="button"][aria-haspopup="dialog"]')]
    .filter(isVisible)
    .find((control) => {
      const rect = control.getBoundingClientRect();
      const label = buttonLabel(control).replace(/\s+/g, " ").trim();
      const bareDialogLabel = control.getAttribute("aria-haspopup") === "dialog" &&
        /^(?:end|kết\s*thúc)$/i.test(label);
      return (pattern.test(label) || bareDialogLabel) && rect.width >= 32 && rect.height >= 24;
    }) || null;
}

async function getStartFrameButton() {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy ô prompt trong cửa sổ video Flow." };
  }
  const button = await waitUntil(findStartFrameButton, 8000);
  if (!button) {
    return {
      ok: false,
      code: "FLOW_VIDEO_MODE_NOT_FOUND",
      error: "Không tìm thấy ô Khung hình bắt đầu. Hãy đặt cửa sổ video ở Video → Frames.",
    };
  }
  window.__flowx_start_frame_baseline = promptIngredientSnapshot();
  return { ok: true, ...centerOf(button), label: buttonLabel(button) };
}

async function getEndFrameButton() {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Google Flow has no visible video prompt box." };
  }
  const button = await waitUntil(findEndFrameButton, 8000);
  if (!button) {
    return {
      ok: false,
      code: "FLOW_VIDEO_MODE_NOT_FOUND",
      error: "Cannot find the End frame slot. Select Video -> Frames.",
    };
  }
  window.__flowx_end_frame_baseline = promptIngredientSnapshot();
  return { ok: true, ...centerOf(button), label: buttonLabel(button) };
}

async function getFrameApplyButton() {
  const pattern = /add\s*(?:as\s*)?(?:start\s*frame|to\s*prompt)|use\s*(?:as\s*)?(?:start\s*frame|frame)|thêm\s*vào\s*câu\s*lệnh|dùng\s*làm\s*khung|hoàn\s*tất|^done$/i;
  const button = await waitUntil(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .filter(isVisible)
      .filter((control) => !control.disabled && control.getAttribute("aria-disabled") !== "true")
      .find((control) => pattern.test(buttonLabel(control))), 2500);
  return button
    ? { ok: true, ...centerOf(button), label: buttonLabel(button) }
    : { ok: true, unavailable: true };
}

async function confirmStartFrame() {
  const baseline = window.__flowx_start_frame_baseline || new Set();
  const accepted = await waitUntil(() => {
    const uploadPopupOpen = Boolean(findVisibleControl(/tải\s*nội\s*dung\s*nghe\s*nhìn|upload\s*media/i));
    if (uploadPopupOpen) return null;
    const current = promptIngredientSnapshot();
    return [...current].some((entry) => !baseline.has(entry));
  }, 20000);
  return accepted
    ? { ok: true }
    : {
      ok: false,
      code: "FLOW_START_FRAME_ATTACH_FAILED",
      error: "Ảnh đã tải lên nhưng chưa xuất hiện trong ô Khung hình bắt đầu.",
    };
}

async function confirmEndFrame() {
  const baseline = window.__flowx_end_frame_baseline || new Set();
  const accepted = await waitUntil(() => {
    const uploadPopupOpen = Boolean(findVisibleControl(/upload\s*media|t\u1ea3i\s*n\u1ed9i\s*dung/i));
    if (uploadPopupOpen) return null;
    const current = promptIngredientSnapshot();
    return [...current].some((entry) => !baseline.has(entry));
  }, 20000);
  return accepted
    ? { ok: true }
    : {
      ok: false,
      code: "FLOW_END_FRAME_ATTACH_FAILED",
      error: "The uploaded image did not appear in the End frame slot.",
    };
}

async function getImageModelPicker() {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy ô prompt Google Flow." };
  }
  const picker = await waitUntil(findModelPickerButton, 8000);
  if (!picker) {
    return {
      ok: true,
      pickerUnavailable: true,
      label: "",
    };
  }
  return picker
    ? { ok: true, ...centerOf(picker), label: buttonLabel(picker) }
    : {
      ok: false,
      code: "FLOW_MODEL_NOT_FOUND",
      error: "Không tìm thấy nút chọn model ảnh trên Google Flow. Hãy mở chế độ Hình ảnh.",
    };
}

async function getNanoBananaProOption() {
  const option = await waitUntil(() =>
    [...document.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"]')]
      .filter(isVisible)
      .find((control) => /nano\s*banana\s*pro/i.test(buttonLabel(control))), 10000);
  if (!option) {
    return {
      ok: false,
      code: "FLOW_MODEL_NOT_FOUND",
      error: "Popup model không có Nano Banana Pro. Worker sẽ không tự chuyển sang model khác.",
    };
  }
  const containerText = `${buttonLabel(option)} ${option.parentElement?.textContent || ""}`;
  const creditMatch = containerText.match(/(?:^|\D)(\d+)\s*(?:credit|credits|tín\s*dụng)/i);
  const visibleCredits = creditMatch ? Number.parseInt(creditMatch[1], 10) : null;
  if (visibleCredits !== null && visibleCredits !== 0) {
    return {
      ok: false,
      code: "FLOW_CREDIT_CHANGED",
      error: `Nano Banana Pro đang hiển thị ${visibleCredits} tín dụng. Đã dừng trước khi tạo.`,
    };
  }
  return {
    ok: true,
    ...centerOf(option),
    credits: visibleCredits === 0 ? 0 : "not-exposed-in-dom",
  };
}

async function confirmNanoBananaPro() {
  const selected = await waitUntil(() => {
    const picker = findModelPickerButton();
    return picker && /nano\s*banana\s*pro/i.test(buttonLabel(picker)) ? picker : null;
  }, 8000);
  return selected
    ? { ok: true, model: "nano-banana-pro", zeroCredits: true }
    : {
      ok: false,
      code: "FLOW_MODEL_CHANGED",
      error: "Google Flow chưa chuyển sang Nano Banana Pro.",
    };
}

async function prepareIngredientDrop() {
  const prompt = await wakePromptBox();
  if (!prompt) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy prompt box để kéo ảnh ingredient." };
  }
  window.__flowx_ingredient_baseline = promptIngredientSnapshot();
  const rect = prompt.getBoundingClientRect();
  return {
    ok: true,
    x: Math.round(rect.left + Math.min(80, rect.width / 3)),
    y: Math.round(rect.top + rect.height / 2),
  };
}

async function confirmIngredientDrop(expectedCount) {
  const baseline = window.__flowx_ingredient_baseline || new Set();
  const baselineElements = window.__flowx_ingredient_baseline_elements || new Set();
  let pickerClosedSince = 0;
  const accepted = await waitUntil(() => {
    const elements = promptIngredientElements();
    const freshElements = elements.filter((element) => !baselineElements.has(element));
    if (freshElements.length >= expectedCount) {
      return { verification: "new-prompt-thumbnail", ingredientCount: elements.length };
    }
    const current = promptIngredientSnapshot();
    const fresh = [...current].filter((entry) => !baseline.has(entry));
    if (fresh.length >= expectedCount) {
      return { verification: "new-prompt-signature", ingredientCount: elements.length };
    }

    const pickerOpen = Boolean(findVisibleControl(
      /thêm\s*vào\s*câu\s*lệnh|add\s*to\s*prompt|tải\s*nội\s*dung\s*nghe\s*nhìn|upload\s*media/i,
    ));
    if (pickerOpen) {
      pickerClosedSince = 0;
      return null;
    }
    if (!pickerClosedSince) pickerClosedSince = Date.now();
    return Date.now() - pickerClosedSince >= 1000
      ? { verification: "picker-closed-after-add", ingredientCount: elements.length }
      : null;
  }, 25000);
  if (!accepted) {
    return {
      ok: false,
      code: "FLOW_REF_ATTACH_FAILED",
      error: "Ảnh đã được upload nhưng chưa xuất hiện trong vùng ingredient của prompt.",
    };
  }
  return { ok: true, ...accepted };
}

async function getAttachedPromptIngredient(locator, filenameHint = "") {
  await wakePromptBox();
  const elements = promptIngredientElements();
  const matched = elements.find((element) => assetMatchesLocator(element, locator, filenameHint)) || null;
  return matched
    ? {
      ok: true,
      found: true,
      assetLocator: flowAssetLocatorForElement(matched),
      ingredientCount: elements.length,
    }
    : { ok: true, found: false, ingredientCount: elements.length };
}

async function getLatestPromptAssetLocator() {
  await wakePromptBox();
  const baselineElements = window.__flowx_ingredient_baseline_elements || new Set();
  const fresh = promptIngredientElements().filter((element) => !baselineElements.has(element));
  const element = fresh.at(-1) || null;
  return element
    ? { ok: true, assetLocator: flowAssetLocatorForElement(element) }
    : { ok: true, assetLocator: null, unavailable: true };
}

async function prepareReferenceInput(targetId) {
  window.__flowx_reference_baseline = referenceVisualSnapshot();
  const input = await openReferenceUpload();
  if (!input) {
    return {
      ok: false,
      code: "FLOW_UI_CHANGED",
      error: "Không tìm thấy Add → Upload → Media hoặc input file trên Google Flow.",
    };
  }
  for (const previous of document.querySelectorAll("[data-flowx-reference-input]")) {
    previous.removeAttribute("data-flowx-reference-input");
  }
  input.setAttribute("data-flowx-reference-input", targetId);
  return { ok: true, selector: `[data-flowx-reference-input="${targetId}"]` };
}

async function confirmReferenceInput(targetId, reference) {
  const input = document.querySelector(`[data-flowx-reference-input="${targetId}"]`);
  const baseline = window.__flowx_reference_baseline || new Set();
  const accepted = await waitUntil(() => {
    const current = referenceVisualSnapshot();
    return [...current].some((entry) => !baseline.has(entry));
  }, 15000);
  input?.removeAttribute("data-flowx-reference-input");
  if (!accepted) {
    return {
      ok: false,
      code: "FLOW_REF_UPLOAD_FAILED",
      error: `Google Flow không hiển thị ảnh tham chiếu ${reference?.token || ""} sau khi upload.`,
    };
  }
  return { ok: true };
}

async function preparePromptForDebugger() {
  const input = await wakePromptBox();
  if (!input) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy ô prompt Google Flow." };
  }
  const rect = input.getBoundingClientRect();
  window.__h2dev_flow_baseline = new Set(getCompletedImages().map(srcKey));
  return {
    ok: true,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}

async function prepareVideoPromptForDebugger() {
  const input = await wakePromptBox();
  if (!input) {
    return { ok: false, code: "FLOW_UI_CHANGED", error: "Không tìm thấy ô prompt video Google Flow." };
  }
  const rect = input.getBoundingClientRect();
  window.__flowx_video_baseline = new Set(getCompletedVideos().map(videoSrcKey));
  return {
    ok: true,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}

async function confirmDebuggerSubmit() {
  const submitted = await waitUntil(() => {
    const input = findPromptInput();
    return !input || inputText(input).trim().length < 3;
  }, 10000);
  return submitted
    ? { ok: true }
    : {
        ok: false,
        code: "FLOW_SUBMIT_FAILED",
        error: "Prompt đã được dán nhưng Google Flow không nhận lệnh Generate.",
      };
}

function promptWithReferenceMapping(prompt, references) {
  if (!Array.isArray(references) || references.length === 0) return prompt;
  const mapping = references
    .map((reference) => `${reference.token} = ${reference.name} in the attached file ${String(reference.token).replace(/^@/, "")}`)
    .join("; ");
  return `Character reference mapping: ${mapping}. Preserve each referenced character's facial identity, hair, age, clothing, and body proportions.\n\n${prompt}`;
}

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
}

function area(el) {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

function srcKey(img) {
  return img.currentSrc || img.src || "";
}

function canonicalAssetUrl(value) {
  if (!/^https?:/i.test(String(value || ""))) return "";
  try {
    const url = new URL(value, location.href);
    const explicitId = ["assetId", "asset_id", "mediaId", "media_id", "id", "name"]
      .map((name) => url.searchParams.get(name))
      .find((entry) => entry && entry.length >= 8);
    if (explicitId) return `id:${explicitId}`;
    const stablePath = decodeURIComponent(url.pathname)
      .replace(/=(?:w|h|s)\d+(?:-[^/]*)?$/i, "");
    return `path:${url.origin}${stablePath}`;
  } catch {
    return "";
  }
}

function flowAssetKeyForElement(element) {
  let current = element;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    if (current instanceof HTMLElement) {
      for (const [name, value] of Object.entries(current.dataset || {})) {
        if (/asset|media|generation/i.test(name) && typeof value === "string" && value.length >= 8) {
          return `data:${name}:${value}`;
        }
      }
      const hrefKey = canonicalAssetUrl(current.getAttribute("href") || "");
      if (hrefKey) return hrefKey;
    }
  }
  return canonicalAssetUrl(srcKey(element));
}

function normalizedAssetHint(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function meaningfulAssetHint(value) {
  const hint = normalizedAssetHint(value);
  return hint.length >= 6 &&
    !/^(?:image|media|asset|thumbnail|project|add to prompt|thêm vào câu lệnh)$/i.test(hint) &&
    !/upload|tải nội dung|add to prompt|thêm vào câu lệnh/i.test(hint);
}

function assetTextHintsForElement(element) {
  const hints = new Set();
  let current = element;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    for (const value of [
      current.getAttribute?.("alt"),
      current.getAttribute?.("aria-label"),
      current.getAttribute?.("title"),
    ]) {
      const hint = normalizedAssetHint(value);
      if (hint && hint.length <= 180) hints.add(hint);
    }
    const text = normalizedAssetHint(current.textContent);
    if (text && text.length <= 180) hints.add(text);
  }
  return [...hints];
}

function flowAssetLocatorForElement(element) {
  const rawSrc = srcKey(element);
  return {
    assetKey: flowAssetKeyForElement(element),
    rawSrc: /^(?:https?:|blob:)/i.test(rawSrc) && rawSrc.length <= 2048 ? rawSrc : "",
    hints: assetTextHintsForElement(element),
  };
}

function assetMatchesLocator(element, locator, filenameHint = "") {
  const normalized = typeof locator === "string"
    ? { assetKey: locator, rawSrc: "", hints: [] }
    : locator && typeof locator === "object"
      ? locator
      : { assetKey: "", rawSrc: "", hints: [] };
  const assetKey = String(normalized.assetKey || "").trim();
  if (assetKey && flowAssetKeyForElement(element) === assetKey) return true;
  const rawSrc = String(normalized.rawSrc || "").trim();
  if (rawSrc && srcKey(element) === rawSrc) return true;
  const rawSrcKey = canonicalAssetUrl(rawSrc);
  if (rawSrcKey && flowAssetKeyForElement(element) === rawSrcKey) return true;

  const candidateHints = assetTextHintsForElement(element);
  const wantedHints = Array.isArray(normalized.hints)
    ? normalized.hints.map(normalizedAssetHint).filter(meaningfulAssetHint)
    : [];
  if (wantedHints.some((hint) => candidateHints.filter(meaningfulAssetHint).includes(hint))) return true;

  const filename = normalizedAssetHint(filenameHint).split(/[\\/]/).at(-1) || "";
  return filename.length >= 4 && candidateHints.some((hint) => hint.includes(filename));
}

function findMediaPickerRoot() {
  const upload = findVisibleControl(/tải\s*nội\s*dung\s*nghe\s*nhìn|upload\s*media/i);
  if (!upload) return null;
  const dialog = upload.closest('[role="dialog"], [role="listbox"]');
  if (dialog) return dialog;
  let current = upload.parentElement;
  while (current && current !== document.body) {
    const rect = current.getBoundingClientRect();
    if (rect.width >= 320 && rect.height >= 220 && current.querySelectorAll("img").length > 0) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function visiblePickerAssets(root) {
  return [...root.querySelectorAll("img, [role='img']")]
    .filter(isVisible)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 48 && rect.height >= 48;
    });
}

function findPickerScrollContainer(root) {
  return [root, ...root.querySelectorAll("*")]
    .filter((element) => element.scrollHeight > element.clientHeight + 24 && element.clientHeight >= 120)
    .sort((left, right) =>
      (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight)
    )[0] || null;
}

async function getExistingProjectAsset(locator, filenameHint = "") {
  const normalized = typeof locator === "string"
    ? { assetKey: locator, rawSrc: "", hints: [] }
    : locator && typeof locator === "object"
      ? locator
      : { assetKey: "", rawSrc: "", hints: [] };
  const hasLocator = Boolean(
    String(normalized.assetKey || "").trim() ||
    String(normalized.rawSrc || "").trim() ||
    (Array.isArray(normalized.hints) && normalized.hints.length > 0) ||
    String(filenameHint || "").trim(),
  );
  if (!hasLocator) return { ok: true, found: false, reason: "missing-asset-locator" };

  const root = await waitUntil(findMediaPickerRoot, 8000);
  if (!root) return { ok: true, found: false, reason: "media-picker-not-found" };
  const scrollContainer = findPickerScrollContainer(root);
  const originalScrollTop = scrollContainer?.scrollTop || 0;
  const maxScrollTop = scrollContainer
    ? Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
    : 0;
  const step = scrollContainer ? Math.max(160, Math.floor(scrollContainer.clientHeight * 0.75)) : 1;
  const positions = [...new Set([
    originalScrollTop,
    0,
    ...Array.from({ length: Math.min(30, Math.ceil(maxScrollTop / step) + 1) }, (_, index) =>
      Math.min(maxScrollTop, index * step)
    ),
    maxScrollTop,
  ])];

  for (const position of positions) {
    if (scrollContainer) {
      scrollContainer.scrollTop = position;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(280);
    }
    const asset = visiblePickerAssets(root)
      .find((element) => assetMatchesLocator(element, normalized, filenameHint));
    if (asset) {
      return {
        ok: true,
        found: true,
        ...centerOf(asset),
        assetLocator: flowAssetLocatorForElement(asset),
        searchedScrollPositions: positions.indexOf(position) + 1,
      };
    }
  }

  if (scrollContainer) {
    scrollContainer.scrollTop = originalScrollTop;
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
  return {
    ok: true,
    found: false,
    reason: "asset-not-found-after-scanning-project",
    searchedScrollPositions: positions.length,
  };
}

// ---------- 1. Tìm ô nhập prompt ----------
// kiểm tra "đang hiện" kiểu lỏng hơn (Slate khi trống vẫn có client rect)
function isShown(el) {
  if (!el) return false;
  if (isVisible(el)) return true;
  return el.getClientRects().length > 0; // dự phòng
}

function findPromptInput() {
  if (CONFIG.promptSelector) {
    const e = document.querySelector(CONFIG.promptSelector);
    if (e) return e;
  }
  // Thử lần lượt các "địa chỉ" ổn định của ô prompt Flow (Slate.js)
  const selectors = [
    '[data-slate-editor="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"][aria-multiline="true"]',
    'div[role="textbox"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    "textarea",
  ];
  for (const sel of selectors) {
    const all = [...document.querySelectorAll(sel)];
    if (!all.length) continue;
    const shown = all.filter(isShown);
    const list = shown.length ? shown : all; // ưu tiên cái đang hiện, không thì lấy đại
    const hint = /create|prompt|imagine|describe|tạo|生成|描述|생성|作成/i;
    const byText = list.find((e) =>
      hint.test(
        (e.getAttribute("placeholder") || "") +
          (e.getAttribute("aria-label") || "") +
          (e.dataset?.placeholder || "")
      )
    );
    if (byText) return byText;
    list.sort((a, b) => area(b) - area(a));
    return list[0];
  }
  return null;
}

// Đánh thức ô prompt: Slate chỉ "mọc" editor khi vùng prompt được click.
// Hàm này click vào vùng prompt (cạnh trái nút mũi tên) để editor xuất hiện.
async function wakePromptBox() {
  let ed = findPromptInput();
  if (ed) {
    clickFully(ed);
    ed.focus?.();
    await sleep(150);
    return findPromptInput();
  }
  // editor chưa mount -> click vào vùng ô prompt cạnh nút arrow_forward
  const arrow = [...document.querySelectorAll('button, [role="button"]')].find(
    (b) => /arrow_forward/i.test((b.getAttribute("aria-label") || "") + b.textContent)
  );
  if (arrow) {
    const r = arrow.getBoundingClientRect();
    const points = [
      [r.left - 150, r.top + r.height / 2],
      [r.left - 300, r.top + r.height / 2],
      [r.left - 80, r.top + r.height / 2],
    ];
    for (const [x, y] of points) {
      const t = document.elementFromPoint(x, y);
      if (!t) continue;
      ["mousedown", "mouseup", "click"].forEach((type) =>
        t.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
          })
        )
      );
      t.focus?.();
      await sleep(250);
      ed = findPromptInput();
      if (ed) {
        console.log("[KC Dev] ✓ Đánh thức được ô prompt bằng cú click.");
        return ed;
      }
    }
  }
  return findPromptInput();
}

// ---------- 2. Gõ prompt vào ô (xử lý cả React) ----------
function setNativeValue(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// Đọc text THẬT của Slate (bỏ qua placeholder)
function slateText(el) {
  return [...el.querySelectorAll("[data-slate-string]")]
    .map((s) => s.textContent)
    .join("");
}
// Ô Slate có đang trống không (placeholder còn hiện = trống)
function slateEmpty(el) {
  return !!el.querySelector("[data-slate-placeholder]") || slateText(el).trim().length === 0;
}

// Đặt con trỏ vào giữa ô (Slate cần selection mới chèn được)
function focusEditor(el) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  ["mousedown", "mouseup", "click"].forEach((t) => {
    (document.elementFromPoint(x, y) || el).dispatchEvent(
      new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window })
    );
  });
  el.focus();
}

// CHÈN CHỮ VÀO SLATE — dùng beforeinput insertText (đã test: Slate nhận cách này)
function slateInsert(el, text) {
  focusEditor(el);
  if (!slateEmpty(el)) {
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "deleteContentBackward",
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    } catch (_) {}
  }
  el.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

function setPromptText(el, text) {
  if (el.isContentEditable) {
    slateInsert(el, text);
    return;
  }
  const proto =
    el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true, data: text, inputType: "insertText" })
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// đọc nội dung hiện có trong ô prompt (Slate: đọc text thật, bỏ qua placeholder)
function inputText(el) {
  if (el.isContentEditable) {
    if (el.querySelector("[data-slate-string], [data-slate-placeholder]")) {
      return slateText(el);
    }
    return el.innerText || el.textContent || "";
  }
  return el.value || "";
}
function isBtnDisabled(b) {
  return b.disabled || b.getAttribute("aria-disabled") === "true";
}

// ---------- 3. Tìm & bấm nút Generate ----------
function findGenerateButton(input) {
  if (CONFIG.generateSelector) {
    const e = document.querySelector(CONFIG.generateSelector);
    if (e) return e;
  }
  const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(
    (b) => isVisible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true"
  );

  const label = (b) =>
    (
      (b.getAttribute("aria-label") || "") +
      " " +
      (b.title || "") +
      " " +
      b.textContent
    ).toLowerCase();

  // Nút KHÔNG được nhầm: tác nhân/agent, chọn model, xoá, đóng, thùng rác...
  const bad = /agent|tác nhân|delete|close|xoá|xóa|trash|thùng|panel|banana|model|setting/i;

  // 1) Ưu tiên tuyệt đối: nút mũi tên gửi của Flow (icon "arrow_forward")
  let b = buttons.find((x) => /arrow_forward/i.test(label(x)) && !bad.test(label(x)));
  if (b) return b;

  // 2) Các từ khoá gửi/tạo khác
  const wanted = /generate|create|submit|send|run|gửi|送信|生成|→|paper.?plane/i;
  b = buttons.find((x) => wanted.test(label(x)) && !bad.test(label(x)));
  if (b) return b;

  // 3) Nếu không thấy: chọn nút gần ô prompt nhất, BỎ QUA các nút sai
  if (input) {
    const ir = input.getBoundingClientRect();
    const near = buttons
      .filter((x) => !bad.test(label(x)))
      .map((x) => {
        const r = x.getBoundingClientRect();
        const dx = r.left - ir.right;
        const dy = r.top - ir.top;
        return { x, d: Math.hypot(dx, dy) };
      })
      .filter((o) => o.d < 600)
      .sort((a, b) => a.d - b.d);
    if (near[0]) return near[0].x;
  }
  return null;
}

function pressEnter(el) {
  el.focus();
  for (const type of ["keydown", "keypress", "keyup"]) {
    const ev = new KeyboardEvent(type, {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true, // vượt qua shadow DOM nếu có
    });
    // FIX QUAN TRỌNG: KeyboardEvent thường để keyCode = 0, khiến Flow không
    // nhận ra phím Enter. Ghi đè lại thành 13 để giống Enter thật.
    Object.defineProperty(ev, "keyCode", { get: () => 13 });
    Object.defineProperty(ev, "which", { get: () => 13 });
    el.dispatchEvent(ev);
  }
}

function clickFully(el) {
  const r = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
  };
  try {
    el.dispatchEvent(new PointerEvent("pointerdown", base));
    el.dispatchEvent(new MouseEvent("mousedown", base));
    el.dispatchEvent(new PointerEvent("pointerup", base));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
  } catch (_) {}
  el.click?.();
}

// Gửi prompt CHẮC CHẮN: click nút gửi vừa được mở khoá + Enter, rồi
// xác nhận đã gửi bằng cách kiểm tra ô prompt đã trống chưa. Thử lại vài lần.
async function submitPromptReliably(input, disabledBefore) {
  const arrow = findGenerateButton(input);
  console.log(
    "[KC Dev] Nút gửi:",
    arrow
      ? arrow.getAttribute("aria-label") ||
          arrow.textContent.trim().slice(0, 15) ||
          arrow.tagName
      : "KHÔNG THẤY"
  );

  for (let i = 0; i < 10; i++) {
    if (STOP) return false;

    // 1) Ưu tiên Enter thật (giống đúng lúc bạn tự bấm Enter -> sinh được ảnh)
    input.focus?.();
    pressEnter(input);
    await sleep(700);
    if (inputText(input).trim().length < 3) {
      console.log("[KC Dev] ✓ Gửi bằng ENTER (lần", i + 1, ")");
      return true;
    }

    // 2) Enter chưa ăn -> thử click nút mũi tên
    if (arrow) {
      clickFully(arrow);
      await sleep(700);
      if (inputText(input).trim().length < 3) {
        console.log("[KC Dev] ✓ Gửi bằng CLICK nút (lần", i + 1, ")");
        return true;
      }
    }
  }
  return false;
}

// ---------- 4. Lấy danh sách ảnh đã hoàn thành ----------
function getCompletedImages() {
  return [...document.querySelectorAll("img")].filter((img) => {
    if (!isVisible(img)) return false;
    const src = srcKey(img);
    if (!/^https?:|^blob:/.test(src)) return false;
    // bỏ qua icon/avatar nhỏ
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < CONFIG.minImageSize && h < CONFIG.minImageSize) return false;
    return true;
  });
}

// ---------- 5. Canh tới khi có ảnh MỚI xuất hiện ----------
async function waitForNewImage(baselineSet) {
  const start = Date.now();
  console.log("[KC Dev] Đang chờ ảnh mới... (số ảnh nền ban đầu:", baselineSet.size, ")");
  let lastLog = 0;
  while (Date.now() - start < CONFIG.maxWaitMs) {
    if (STOP) return { stopped: true };
    const all = getCompletedImages();
    const fresh = all.filter((i) => !baselineSet.has(srcKey(i)));
    if (fresh.length) {
      await sleep(CONFIG.settleMs); // chờ ảnh load đủ
      const newest = fresh[0];
      console.log("[KC Dev] ✓✓ Thấy ảnh mới! Đang tải:", srcKey(newest).slice(0, 70));
      return {
        img: newest,
        src: srcKey(newest),
        flowAssetKey: flowAssetKeyForElement(newest),
        flowAssetLocator: flowAssetLocatorForElement(newest),
      };
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed - lastLog >= 10) {
      lastLog = elapsed;
      console.log("[KC Dev] ...vẫn đang chờ ảnh —", elapsed, "giây trôi qua. Số ảnh ≥256px hiện có:", all.length);
    }
    await sleep(CONFIG.pollMs);
  }
  return { timeout: true };
}

function getCompletedVideos() {
  return [...document.querySelectorAll("video")].filter((video) => {
    if (!isVisible(video)) return false;
    const src = srcKey(video) || video.querySelector("source")?.src || "";
    const rect = video.getBoundingClientRect();
    return /^(?:https?:|blob:)/.test(src) && rect.width >= 240 && rect.height >= 120;
  });
}

function videoSrcKey(video) {
  return srcKey(video) || video.querySelector("source")?.src || "";
}

async function waitForNewVideo(baselineSet) {
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    if (STOP) return { stopped: true };
    const fresh = getCompletedVideos().filter((video) => !baselineSet.has(videoSrcKey(video)));
    if (fresh.length) {
      await sleep(CONFIG.settleMs);
      const newest = fresh[0];
      return { video: newest, src: videoSrcKey(newest) };
    }
    await sleep(CONFIG.pollMs);
  }
  return { timeout: true };
}

// ---------- 6. Chạy 1 prompt trọn vẹn ----------
async function runOne(prompt, references = []) {
  const uploaded = await uploadReferences(references);
  if (!uploaded.ok) return uploaded;
  prompt = promptWithReferenceMapping(prompt, references);
  // đánh thức + tìm ô prompt (Slate mount khi được click)
  let input = await wakePromptBox();
  if (!input) {
    console.warn(
      "[KC Dev] ❌ KHÔNG tìm thấy ô prompt. Đếm phần tử trong DOM →",
      "slate:", document.querySelectorAll('[data-slate-editor="true"]').length,
      "| textbox:", document.querySelectorAll('[role="textbox"]').length,
      "| contenteditable:", document.querySelectorAll('[contenteditable="true"]').length,
      "| textarea:", document.querySelectorAll("textarea").length
    );
    return { ok: false, error: "Không tìm thấy ô prompt." };
  }
  console.log("[KC Dev] ✓ Ô prompt:", input.tagName, input.getAttribute("role"));

  const baseline = new Set(getCompletedImages().map(srcKey));
  const disabledBefore = new Set(
    [...document.querySelectorAll('button, [role="button"]')].filter((b) =>
      isBtnDisabled(b)
    )
  );

  // đảm bảo focus trước khi gõ
  clickFully(input);
  input.focus?.();
  await sleep(150);

  // gõ prompt
  setPromptText(input, prompt);
  await sleep(700);

  const got = inputText(input).trim();
  console.log("[KC Dev] Sau khi gõ, nội dung ô =", JSON.stringify(got.slice(0, 50)), "(", got.length, "ký tự )");
  if (got.length < 3) {
    console.warn("[KC Dev] ❌ Gõ chữ KHÔNG vào được ô (Slate không nhận).");
    return { ok: false, error: "Gõ chữ không vào được ô prompt (Slate)." };
  }

  // gửi + xác nhận đã gửi
  const sent = await submitPromptReliably(input, disabledBefore);
  if (STOP) return { ok: false, stopped: true };
  if (!sent) {
    console.warn("[KC Dev] ❌ Gõ được nhưng KHÔNG gửi được.");
    return {
      ok: false,
      error: "Đã gõ prompt nhưng KHÔNG gửi được (nút gửi không phản hồi).",
    };
  }

  // chờ ảnh mới
  const res = await waitForNewImage(baseline);
  if (res.stopped) return { ok: false, stopped: true };
  if (res.timeout) return { ok: false, timeout: true };
  return { ok: true, src: res.src };
}

// ---------- 7. Đổi ảnh sang dataURL (dùng cho blob:) ----------
async function toDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// ---------- 8. Nhận lệnh từ side panel ----------
// Chống đăng ký listener 2 lần (khi vừa tiêm khai báo vừa tiêm tay)
if (!window.__H2DEV_FLOW_LISTENER__) {
  window.__H2DEV_FLOW_LISTENER__ = true;

  window.__FLOWX_FLOW_INTERNALS__ = {
    assetMatchesLocator,
    cleanFlowOptionLabel,
    confirmVideoAspectRatio,
    confirmVideoDuration,
    findEndFrameButton,
    findStartFrameButton,
    getMediaModeOption,
    isDurationControl,
    isLandscapeAspectControl,
    selectedFlowTab,
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING") {
      let hasInput = false;
      try {
        hasInput = !!findPromptInput();
      } catch (_) {}
      sendResponse({ ok: true, hasInput });
      return; // đồng bộ
    }

    if (msg.type === "STOP") {
      STOP = true;
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "FLOWX_PREPARE_REFERENCE") {
      STOP = false;
      prepareReferenceInput(String(msg.targetId || "flowx-ref"))
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, code: "FLOW_UI_CHANGED", error: String(error?.message || error) }));
      return true;
    }

    if (msg.type === "FLOWX_PREPARE_INGREDIENT_DROP") {
      STOP = false;
      prepareIngredientDrop()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, code: "FLOW_UI_CHANGED", error: String(error?.message || error) }));
      return true;
    }

    if (msg.type === "FLOWX_GET_PROMPT_ADD_BUTTON") {
      STOP = false;
      getPromptAddButton().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_IMAGE_MODEL_PICKER") {
      getImageModelPicker().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_DETECT_WORKSPACE_MODE") {
      sendResponse(detectWorkspaceMode());
      return;
    }

    if (msg.type === "FLOWX_GET_MEDIA_MODE_PICKER") {
      STOP = false;
      getMediaModePicker(msg.mediaType === "video" ? "video" : "image").then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_MEDIA_MODE_OPTION") {
      getMediaModeOption(msg.mediaType === "video" ? "video" : "image").then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_MEDIA_MODE") {
      confirmMediaMode(msg.mediaType === "video" ? "video" : "image").then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_VIDEO_SETTINGS_PICKER") {
      getVideoSettingsPicker().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CLEAR_PROMPT_MEDIA") {
      STOP = false;
      clearPromptMedia().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_VIDEO_GENERATION_MODE") {
      getVideoGenerationModeOption(msg.mode === "frames" ? "frames" : "ingredients").then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_VIDEO_GENERATION_MODE") {
      confirmVideoGenerationMode(msg.mode === "frames" ? "frames" : "ingredients").then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_VIDEO_ASPECT_RATIO") {
      getVideoAspectRatioOption().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_VIDEO_ASPECT_RATIO") {
      confirmVideoAspectRatio().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_VIDEO_DURATION") {
      getVideoDurationOption(msg.durationSeconds).then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_VIDEO_DURATION") {
      confirmVideoDuration(msg.durationSeconds).then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_START_FRAME_BUTTON") {
      STOP = false;
      getStartFrameButton().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_END_FRAME_BUTTON") {
      STOP = false;
      getEndFrameButton().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_FRAME_APPLY_BUTTON") {
      getFrameApplyButton().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_START_FRAME") {
      confirmStartFrame().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_END_FRAME") {
      confirmEndFrame().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_NANO_BANANA_PRO_OPTION") {
      getNanoBananaProOption().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_NANO_BANANA_PRO") {
      confirmNanoBananaPro().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_UPLOAD_MEDIA_BUTTON") {
      getUploadMediaButton().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_FRESH_UPLOADED_ASSET") {
      getFreshUploadedAsset().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_EXISTING_PROJECT_ASSET") {
      getExistingProjectAsset(msg.assetLocator || msg.assetKey, msg.filenameHint).then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_ATTACHED_PROMPT_INGREDIENT") {
      getAttachedPromptIngredient(msg.assetLocator || msg.assetKey, msg.filenameHint).then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_LATEST_PROMPT_ASSET_KEY") {
      getLatestPromptAssetLocator().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GET_ADD_TO_PROMPT_BUTTON") {
      getAddToPromptButton().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_INGREDIENT_DROP") {
      confirmIngredientDrop(Number(msg.expectedCount) || 1).then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_REFERENCE") {
      confirmReferenceInput(String(msg.targetId || "flowx-ref"), msg.reference)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, code: "FLOW_REF_UPLOAD_FAILED", error: String(error?.message || error) }));
      return true;
    }

    if (msg.type === "FLOWX_PREPARE_PROMPT") {
      preparePromptForDebugger()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, code: "FLOW_UI_CHANGED", error: String(error?.message || error) }));
      return true;
    }

    if (msg.type === "FLOWX_PREPARE_VIDEO_PROMPT") {
      prepareVideoPromptForDebugger()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, code: "FLOW_UI_CHANGED", error: String(error?.message || error) }));
      return true;
    }

    if (msg.type === "FLOWX_CONFIRM_SUBMIT") {
      confirmDebuggerSubmit().then(sendResponse);
      return true;
    }

    if (msg.type === "FLOWX_GENERATE_IMAGE") {
      STOP = false;
      (async () => {
        try {
          const result = await runOne(
            String(msg.payload?.prompt || ""),
            Array.isArray(msg.payload?.refImages) ? msg.payload.refImages : [],
          );
          if (!result.ok) {
            sendResponse(result);
            return;
          }
          let dataUrl = null;
          try {
            dataUrl = await toDataUrl(result.src);
          } catch (error) {
            console.warn("[KC Dev] Could not convert result to data URL", error);
          }
          sendResponse({ ok: true, src: result.src, dataUrl });
        } catch (error) {
          sendResponse({
            ok: false,
            code: "INTERNAL_ERROR",
            error: String(error?.message || error),
          });
        }
      })();
      return true;
    }

    // Trả về toạ độ tâm ô prompt (để background click + gõ qua debugger),
    // đồng thời chụp baseline ảnh hiện có để lát so sánh.
    if (msg.type === "GET_BOX") {
      STOP = false;
      (async () => {
        try {
          const input = await wakePromptBox();
          if (!input) {
            sendResponse({ ok: false, error: "Không tìm thấy ô prompt." });
            return;
          }
          const r = input.getBoundingClientRect();
          window.__h2dev_flow_baseline = new Set(getCompletedImages().map(srcKey));
          sendResponse({
            ok: true,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    // Chờ ảnh mới (so với baseline đã chụp ở GET_BOX) rồi trả src
    if (msg.type === "WAIT_IMAGE") {
      const baseline = window.__h2dev_flow_baseline || new Set();
      waitForNewImage(baseline).then((res) => {
        if (res.stopped) sendResponse({ ok: false, stopped: true });
        else if (res.timeout) sendResponse({ ok: false, timeout: true });
        else sendResponse({
          ok: true,
          src: res.src,
          flowAssetKey: res.flowAssetKey || "",
          flowAssetLocator: res.flowAssetLocator || null,
        });
      });
      return true;
    }

    if (msg.type === "WAIT_VIDEO") {
      const baseline = window.__flowx_video_baseline || new Set();
      waitForNewVideo(baseline).then((res) => {
        if (res.stopped) sendResponse({ ok: false, stopped: true });
        else if (res.timeout) sendResponse({ ok: false, timeout: true });
        else sendResponse({ ok: true, src: res.src });
      });
      return true;
    }

    if (msg.type === "TODATAURL") {
      toDataUrl(msg.src)
        .then((d) => sendResponse({ dataUrl: d }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    }
  });

  console.log("[KC Dev] content script đã sẵn sàng trên Google Flow.");
  chrome.runtime.sendMessage({ type: "WORKER_PAGE_READY" }).catch(() => {});
}
