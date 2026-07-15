import type { JobProgressStatus } from "./timeline";
import {
  normalizeVisualBible,
  type ProjectAspectRatio,
  type SceneDurationSeconds,
  type VisualBible,
} from "./timeline";
import { normalizeCharacterToken } from "./character";

export const SCENE_JOB_RUN_CHANNEL = "scene-job:run";
export const SCENE_JOB_PROGRESS_CHANNEL = "scene-job:progress";

export const SCENE_MEDIA_TYPES = ["image", "video"] as const;
export type SceneMediaType = (typeof SCENE_MEDIA_TYPES)[number];

export interface SceneJobInput {
  sceneId: string;
  mediaType: SceneMediaType;
  prompt: string;
  characterTokens: string[];
  visualBible: VisualBible;
  imageSettings: ImageGenerationSettings;
  sourceImagePath: string;
  sourceFlowAssetKey: string;
  startFramePath: string;
  videoSettings: VideoGenerationSettings;
}

export interface ImageGenerationSettings {
  model: "nano-banana-pro";
  aspectRatio: ProjectAspectRatio;
  outputCount: 1;
  expectedCredits: 0;
}

export interface VideoGenerationSettings {
  model: "veo-3.1-lite";
  mode: "ingredients" | "frames";
  aspectRatio: ProjectAspectRatio;
  durationSeconds: SceneDurationSeconds;
  outputCount: 1;
  expectedCredits: 0;
}

export interface SceneReferenceImage {
  token: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  imageBase64: string;
  localPath: string;
}

export interface BoundSceneJobInput extends SceneJobInput {
  refImages: SceneReferenceImage[];
}

export interface SceneJobProgress {
  jobId: string;
  sceneId: string;
  mediaType: SceneMediaType;
  status: JobProgressStatus;
  message?: string;
}

export interface SceneJobResult {
  sceneId: string;
  mediaType: SceneMediaType;
  resultPath: string;
  flowAssetKey: string;
}

export interface SceneJobsBridge {
  run: (input: SceneJobInput) => Promise<SceneJobResult>;
  onProgress: (callback: (progress: SceneJobProgress) => void) => () => void;
}

export function normalizeSceneJobInput(value: unknown): SceneJobInput {
  if (!value || typeof value !== "object") {
    throw new Error("Scene job input is invalid");
  }
  const input = value as Record<string, unknown>;
  const sceneId = typeof input.sceneId === "string" ? input.sceneId.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!/^scene-\d{3,4}$/.test(sceneId)) {
    throw new Error("Scene job requires a valid scene id");
  }
  if (!SCENE_MEDIA_TYPES.includes(input.mediaType as SceneMediaType)) {
    throw new Error("Scene job media type is invalid");
  }
  if (!prompt || prompt.length > 20_000) {
    throw new Error("Scene prompt must contain 1-20000 characters");
  }
  const characterTokens = Array.isArray(input.characterTokens)
    ? [...new Set(input.characterTokens
      .map((token) => typeof token === "string" ? normalizeCharacterToken(token) : null)
      .filter((token): token is string => Boolean(token)))]
    : [];
  if (characterTokens.length > 4) {
    throw new Error("Mỗi scene chỉ hỗ trợ tối đa 4 nhân vật tham chiếu");
  }
  const visualBible = normalizeVisualBible(input.visualBible);
  const imageSettings: ImageGenerationSettings = {
    model: "nano-banana-pro",
    aspectRatio: "16:9",
    outputCount: 1,
    expectedCredits: 0,
  };
  const sourceImagePath = typeof input.sourceImagePath === "string"
    ? input.sourceImagePath.trim()
    : "";
  if (
    input.mediaType === "video" &&
    (!/^(?:[A-Za-z]:[\\/]|\/)/.test(sourceImagePath) ||
      !/\.(?:png|jpe?g|webp)$/i.test(sourceImagePath))
  ) {
    throw new Error("Video scene requires the completed image as its visual ingredient");
  }
  const videoSettings: VideoGenerationSettings = {
    model: "veo-3.1-lite",
    mode: input.videoSettings && typeof input.videoSettings === "object" &&
      (input.videoSettings as Record<string, unknown>).mode === "frames"
      ? "frames"
      : "ingredients",
    aspectRatio: "16:9",
    durationSeconds: input.videoSettings && typeof input.videoSettings === "object" &&
      [4, 6, 8].includes(Number((input.videoSettings as Record<string, unknown>).durationSeconds))
      ? Number((input.videoSettings as Record<string, unknown>).durationSeconds) as SceneDurationSeconds
      : 8,
    outputCount: 1,
    expectedCredits: 0,
  };
  const sourceFlowAssetKey = typeof input.sourceFlowAssetKey === "string"
    ? input.sourceFlowAssetKey.trim().slice(0, 4_096)
    : "";
  const startFramePath = typeof input.startFramePath === "string"
    ? input.startFramePath.trim()
    : "";
  if (
    input.mediaType === "video" &&
    videoSettings.mode === "frames" &&
    (!/^(?:[A-Za-z]:[\\/]|\/)/.test(startFramePath) || !/\.(?:png|jpe?g|webp)$/i.test(startFramePath))
  ) {
    throw new Error("Frames video requires an extracted start frame");
  }
  return {
    sceneId,
    mediaType: input.mediaType as SceneMediaType,
    prompt,
    characterTokens,
    visualBible,
    imageSettings,
    sourceImagePath: input.mediaType === "video" ? sourceImagePath : "",
    sourceFlowAssetKey: input.mediaType === "video" ? sourceFlowAssetKey : "",
    startFramePath: input.mediaType === "video" ? startFramePath : "",
    videoSettings,
  };
}

export function normalizeSceneJobResult(
  value: unknown,
  input: SceneJobInput,
): SceneJobResult {
  if (!value || typeof value !== "object") {
    throw new Error("Scene worker result is invalid");
  }
  const result = value as Record<string, unknown>;
  const resultPath =
    typeof result.resultPath === "string" ? result.resultPath.trim() : "";
  const flowAssetKey = typeof result.flowAssetKey === "string"
    ? result.flowAssetKey.trim().slice(0, 4_096)
    : "";
  if (
    result.sceneId !== input.sceneId ||
    result.mediaType !== input.mediaType ||
    !resultPath ||
    resultPath.length > 2_048
  ) {
    throw new Error("Scene worker result does not match the requested scene");
  }
  return {
    sceneId: input.sceneId,
    mediaType: input.mediaType,
    resultPath,
    flowAssetKey: input.mediaType === "image" ? flowAssetKey : "",
  };
}
