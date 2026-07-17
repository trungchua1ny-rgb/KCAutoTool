import {
  normalizeCharacterToken,
  parseCharacterTokens,
  type CharacterRosterEntry,
} from "./character";

export const TIMELINE_GENERATE_CHANNEL = "timeline:generate";
export const TIMELINE_CANCEL_CHANNEL = "timeline:cancel";
export const TIMELINE_PROGRESS_CHANNEL = "timeline:progress";
export const PROMPT_POLICY_REWRITE_CHANNEL = "timeline:rewrite-policy-prompt";
export const TIMELINE_SESSION_LOAD_CHANNEL = "timeline-session:load";
export const TIMELINE_SESSION_SAVE_CHANNEL = "timeline-session:save";
export const TIMELINE_SESSION_CLEAR_CHANNEL = "timeline-session:clear";

export const MAX_TIMELINE_FILE_BYTES = 2 * 1024 * 1024;

export type SceneStatus = "pending" | "queued" | "generating" | "done" | "review" | "error";
export type CharacterPolicy = "none" | "selected";
export type ProjectAspectRatio = "16:9";
export type SceneChainRole = "single" | "start" | "continue";
export type SceneDurationSeconds = 4 | 6 | 8;

export const SCENE_DURATION_OPTIONS: SceneDurationSeconds[] = [4, 6, 8];

export interface VisualBible {
  style: string;
  palette: string;
  lighting: string;
  continuityNotes: string;
  aspectRatio: ProjectAspectRatio;
}

export const DEFAULT_VISUAL_BIBLE: VisualBible = {
  style: "",
  palette: "",
  lighting: "",
  continuityNotes: "",
  aspectRatio: "16:9",
};
export type JobProgressStatus =
  | "queued"
  | "preparing"
  | "generating"
  | "downloading"
  | "stopping";

export interface Scene {
  id: string;
  order: number;
  timeStart: string;
  timeEnd: string;
  imagePrompt: string;
  imageStatus: SceneStatus;
  imageResultPath: string;
  imageFlowAssetKey: string;
  imageApproved: boolean;
  videoPrompt: string;
  videoStatus: SceneStatus;
  videoResultPath: string;
  videoApproved: boolean;
  usedCharacterTokens: string[];
  characterPolicy: CharacterPolicy;
  assignedCharacterTokens: string[];
  chainId: string | null;
  chainRole: SceneChainRole;
  durationSeconds: SceneDurationSeconds;
}

export interface TimelineGenerateInput {
  srtText: string;
  scriptText: string;
  visualBible: VisualBible;
  characterRoster: CharacterRosterEntry[];
}

export interface PolicyPromptRewriteInput {
  sceneId: string;
  mediaType: "image" | "video";
  prompt: string;
  policyError: string;
  timeStart: string;
  timeEnd: string;
  pairedPrompt: string;
  visualBible: VisualBible;
}

export interface PolicyPromptRewriteResult {
  prompt: string;
}

export interface TimelineResult {
  scenes: Scene[];
  visualBible: VisualBible;
}

export interface TimelineSession {
  scenes: Scene[];
  visualBible: VisualBible;
  savedAt: string;
}

export interface TimelineSessionInput {
  scenes: Scene[];
  visualBible: VisualBible;
}

export interface TimelineProgress {
  jobId: string;
  status: JobProgressStatus;
  message?: string;
}

export interface TimelineBridge {
  generate: (input: TimelineGenerateInput) => Promise<TimelineResult>;
  rewritePolicyPrompt: (
    input: PolicyPromptRewriteInput,
  ) => Promise<PolicyPromptRewriteResult>;
  cancel: () => Promise<boolean>;
  loadSession: () => Promise<TimelineSession | null>;
  saveSession: (input: TimelineSessionInput) => Promise<TimelineSession>;
  clearSession: () => Promise<void>;
  onProgress: (callback: (progress: TimelineProgress) => void) => () => void;
}

function requiredString(
  value: unknown,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new Error(`Scene field ${field} must be a string`);
  }

  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    throw new Error(`Scene field ${field} cannot be empty`);
  }
  return normalized;
}

function normalizeTimecode(value: unknown, field: string): {
  text: string;
  milliseconds: number;
} {
  const raw = requiredString(value, field);
  const match = raw.match(/^(\d{1,3}):([0-5]\d):([0-5]\d)(?:[,.](\d{1,3}))?$/);
  if (!match) {
    throw new Error(`Scene field ${field} must use HH:MM:SS,mmm`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[4] || "0").padEnd(3, "0"));
  return {
    text: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`,
    milliseconds:
      ((hours * 60 * 60 + minutes * 60 + seconds) * 1_000) + milliseconds,
  };
}

function normalizeDurationSeconds(
  value: unknown,
  actualDurationMilliseconds: number,
  sceneOrder: number,
): SceneDurationSeconds {
  const actualSeconds = actualDurationMilliseconds / 1_000;
  const requested = typeof value === "number" ? value : actualSeconds;
  if (!SCENE_DURATION_OPTIONS.includes(requested as SceneDurationSeconds)) {
    throw new Error(`Scene ${sceneOrder} durationSeconds must be 4, 6, or 8`);
  }
  if (actualDurationMilliseconds !== requested * 1_000) {
    throw new Error(`Scene ${sceneOrder} boundary must match durationSeconds`);
  }
  return requested as SceneDurationSeconds;
}

function normalizeChain(
  scene: Record<string, unknown>,
  sceneOrder: number,
  previous: Pick<Scene, "chainId" | "chainRole"> | null,
): Pick<Scene, "chainId" | "chainRole"> {
  const chainRole: SceneChainRole = scene.chainRole === "start" || scene.chainRole === "continue"
    ? scene.chainRole
    : "single";
  if (chainRole === "single") return { chainId: null, chainRole };

  const chainId = typeof scene.chainId === "string"
    ? scene.chainId.trim().slice(0, 80)
    : "";
  if (!chainId) {
    throw new Error(`Scene ${sceneOrder} ${chainRole} must have a chainId`);
  }
  if (
    chainRole === "continue" &&
    (!previous || previous.chainId !== chainId || previous.chainRole === "single")
  ) {
    throw new Error(`Scene ${sceneOrder} continue must follow the same chain`);
  }
  return { chainId, chainRole };
}

function normalizeTokens(value: unknown, promptText: string): string[] {
  const tokens = Array.isArray(value)
    ? value
        .map((token) =>
          typeof token === "string" ? normalizeCharacterToken(token) : null,
        )
        .filter((token): token is string => Boolean(token))
    : [];

  return [...new Set([...tokens, ...parseCharacterTokens(promptText)])];
}

function normalizeAssignedTokens(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((token) => typeof token === "string" ? normalizeCharacterToken(token) : null)
    .filter((token): token is string => Boolean(token)))].slice(0, 4);
}

function optionalText(value: unknown, maxLength = 4_000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeVisualBible(value: unknown): VisualBible {
  const bible = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    style: optionalText(bible.style),
    palette: optionalText(bible.palette),
    lighting: optionalText(bible.lighting),
    continuityNotes: optionalText(bible.continuityNotes, 8_000),
    aspectRatio: "16:9",
  };
}

export function validateGeneratedVisualBible(value: VisualBible): void {
  if (
    !value.style ||
    !value.palette ||
    !value.lighting ||
    !value.continuityNotes ||
    value.aspectRatio !== "16:9"
  ) {
    throw new Error("Timeline worker phải trả về Visual Bible hoàn chỉnh");
  }
}

function normalizePromptTokens(value: string): string {
  return value.replace(
    /(?<![A-Za-z0-9._%+-])@([A-Za-z0-9_]{1,40})\b/g,
    (_match, token: string) => `@${token.toUpperCase()}`,
  );
}

export function normalizeTimelineResult(value: unknown): TimelineResult {
  const result = value as { scenes?: unknown } | null;
  const scenesValue = Array.isArray(value) ? value : result?.scenes;
  if (!Array.isArray(scenesValue) || scenesValue.length === 0) {
    throw new Error("Timeline result must contain at least one scene");
  }
  if (scenesValue.length > 1_000) {
    throw new Error("Timeline result exceeds 1000 scenes");
  }

  let previousEnd: number | null = null;
  let previousScene: Scene | null = null;
  const scenes = scenesValue.map((entry, index): Scene => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Scene ${index + 1} is invalid`);
    }

    const scene = entry as Record<string, unknown>;
    const order = index + 1;
    const timeStart = normalizeTimecode(scene.timeStart, "timeStart");
    const timeEnd = normalizeTimecode(scene.timeEnd, "timeEnd");
    const duration = timeEnd.milliseconds - timeStart.milliseconds;
    const durationSeconds = normalizeDurationSeconds(
      scene.durationSeconds,
      duration,
      order,
    );
    if (previousEnd !== null && timeStart.milliseconds !== previousEnd) {
      throw new Error(`Scene ${order} must start exactly when scene ${order - 1} ends`);
    }
    previousEnd = timeEnd.milliseconds;
    const chain = normalizeChain(scene, order, previousScene);
    const imagePrompt = chain.chainRole === "continue"
      ? ""
      : normalizePromptTokens(requiredString(scene.imagePrompt, "imagePrompt"));
    const videoPrompt = normalizePromptTokens(
      requiredString(scene.videoPrompt, "videoPrompt", true),
    );

    const usedCharacterTokens = normalizeTokens(
      scene.usedCharacterTokens,
      `${imagePrompt}\n${videoPrompt}`,
    );
    const normalizedScene: Scene = {
      id: `scene-${String(order).padStart(3, "0")}`,
      order,
      timeStart: timeStart.text,
      timeEnd: timeEnd.text,
      imagePrompt,
      imageStatus: "pending",
      imageResultPath: "",
      imageFlowAssetKey: "",
      imageApproved: false,
      videoPrompt,
      videoStatus: "pending",
      videoResultPath: "",
      videoApproved: false,
      usedCharacterTokens,
      characterPolicy: usedCharacterTokens.length > 0 ? "selected" : "none",
      assignedCharacterTokens: usedCharacterTokens,
      ...chain,
      durationSeconds,
    };
    previousScene = normalizedScene;
    return normalizedScene;
  });

  return {
    scenes,
    visualBible: normalizeVisualBible(
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).visualBible
        : undefined,
    ),
  };
}

export function recalculateScenePlanning(
  scenes: Scene[],
  sceneId: string,
  change: Partial<Pick<Scene, "chainId" | "chainRole" | "durationSeconds">>,
): Scene[] {
  if (scenes.length === 0) return scenes;
  const targetIndex = scenes.findIndex((scene) => scene.id === sceneId);
  if (targetIndex < 0) return scenes;
  const previousChainId = scenes[targetIndex].chainId;

  const updated = scenes.map((scene, index) => {
    if (index !== targetIndex) return { ...scene };
    const chainRole = change.chainRole ?? scene.chainRole;
    const durationSeconds = change.durationSeconds ?? scene.durationSeconds;
    if (!SCENE_DURATION_OPTIONS.includes(durationSeconds)) return { ...scene };
    const fallbackChainId = chainRole === "continue"
      ? scenes[index - 1]?.chainId || scene.chainId || `chain-${String(scene.order).padStart(3, "0")}`
      : scene.chainId || `chain-${String(scene.order).padStart(3, "0")}`;
    return {
      ...scene,
      durationSeconds,
      chainRole,
      chainId: chainRole === "single"
        ? null
        : (change.chainId === undefined
            ? fallbackChainId
            : (change.chainId || "").trim().slice(0, 80)) || fallbackChainId,
    };
  });

  const target = updated[targetIndex];
  if (target.chainRole === "continue") {
    if (targetIndex === 0) {
      target.chainRole = "start";
    } else {
      let cursorIndex = targetIndex - 1;
      while (cursorIndex >= 0 && updated[cursorIndex].chainRole === "continue") {
        updated[cursorIndex].chainId = target.chainId;
        cursorIndex -= 1;
      }
      if (cursorIndex >= 0) {
        updated[cursorIndex].chainRole = "start";
        updated[cursorIndex].chainId = target.chainId;
      }
    }
  }
  if (target.chainRole === "start" || target.chainRole === "continue") {
    for (let index = targetIndex + 1; index < updated.length; index += 1) {
      const candidate = updated[index];
      if (candidate.chainRole !== "continue" || candidate.chainId !== previousChainId) break;
      candidate.chainId = target.chainId;
    }
  } else {
    const following = updated[targetIndex + 1];
    if (following?.chainRole === "continue" && following.chainId === previousChainId) {
      following.chainRole = "start";
    }
  }

  let cursor = normalizeTimecode(updated[0].timeStart, "timeStart").milliseconds;
  return updated.map((scene) => {
    const start = cursor;
    cursor += scene.durationSeconds * 1_000;
    return {
      ...scene,
      timeStart: formatTimecode(start),
      timeEnd: formatTimecode(cursor),
    };
  });
}

function formatTimecode(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

export function normalizeStoredScenes(value: unknown): Scene[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  const normalized = normalizeTimelineResult({ scenes: value }).scenes;
  return normalized.map((scene, index) => {
    const stored = value[index] as Record<string, unknown>;
    const imageStatus = stored.imageStatus === "done" || stored.imageStatus === "error"
      ? stored.imageStatus
      : "pending";
    const videoStatus = stored.videoStatus === "done" || stored.videoStatus === "error"
      ? stored.videoStatus
      : "pending";

    const assignedCharacterTokens = normalizeAssignedTokens(
      stored.assignedCharacterTokens,
    );
    const hasStoredAssignment = Array.isArray(stored.assignedCharacterTokens);
    const migratedAssignments = hasStoredAssignment
      ? assignedCharacterTokens
      : scene.usedCharacterTokens;
    const characterPolicy: CharacterPolicy = stored.characterPolicy === "selected"
      ? "selected"
      : stored.characterPolicy === "none"
        ? "none"
        : migratedAssignments.length > 0
          ? "selected"
          : "none";

    return {
      ...scene,
      imageStatus,
      imageResultPath:
        typeof stored.imageResultPath === "string" ? stored.imageResultPath : "",
      imageFlowAssetKey:
        typeof stored.imageFlowAssetKey === "string"
          ? stored.imageFlowAssetKey.trim().slice(0, 4_096)
          : "",
      imageApproved: stored.imageApproved === true,
      videoStatus,
      videoResultPath:
        typeof stored.videoResultPath === "string" ? stored.videoResultPath : "",
      videoApproved: stored.videoApproved === true,
      characterPolicy,
      assignedCharacterTokens: characterPolicy === "selected"
        ? migratedAssignments
        : [],
    };
  });
}

export function validateTimelineCoverage(
  result: TimelineResult,
  srtText: string,
): void {
  const timecode = "\\d{1,3}:[0-5]\\d:[0-5]\\d(?:[,.]\\d{1,3})?";
  const matches = [
    ...srtText.matchAll(new RegExp(`(${timecode})\\s*-->\\s*(${timecode})`, "g")),
  ];
  if (matches.length === 0) {
    throw new Error("SRT source does not contain a valid timeline");
  }

  const expectedStart = normalizeTimecode(matches[0][1], "SRT start");
  const expectedEnd = normalizeTimecode(matches.at(-1)![2], "SRT end");
  const actualStart = normalizeTimecode(result.scenes[0].timeStart, "timeStart");
  const actualEnd = normalizeTimecode(
    result.scenes.at(-1)!.timeEnd,
    "timeEnd",
  );

  if (actualStart.milliseconds !== expectedStart.milliseconds) {
    throw new Error("Timeline must start at the first SRT timestamp");
  }
  const finalPadding = actualEnd.milliseconds - expectedEnd.milliseconds;
  if (finalPadding < 0 || finalPadding >= 8_000) {
    throw new Error(
      "Timeline must cover the final SRT timestamp with less than 8 seconds of final padding",
    );
  }
}
