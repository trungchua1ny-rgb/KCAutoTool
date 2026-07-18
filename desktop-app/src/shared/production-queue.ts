import type { JobState, SceneState } from "./project";
import type { SceneMediaType } from "./scene-job";

export const DEFAULT_PROJECT_ID = "legacy-default-project";

export const QUEUE_SNAPSHOT_GET_CHANNEL = "production-queue:get-snapshot";
export const QUEUE_GENERATE_IMAGES_CHANNEL = "production-queue:generate-images";
export const QUEUE_GENERATE_VIDEOS_CHANNEL = "production-queue:generate-videos";
export const QUEUE_PAUSE_CHANNEL = "production-queue:pause";
export const QUEUE_RESUME_CHANNEL = "production-queue:resume";
export const QUEUE_STOP_CHANNEL = "production-queue:stop";
export const QUEUE_CLEAR_GENERATED_MEDIA_CHANNEL = "production-queue:clear-generated-media";
export const QUEUE_CLEAR_SCENE_MEDIA_CHANNEL = "production-queue:clear-scene-media";
export const QUEUE_RETRY_FAILED_CHANNEL = "production-queue:retry-failed";
export const QUEUE_RESUME_FROM_CHANNEL = "production-queue:resume-from";
export const QUEUE_REGENERATE_SCENE_CHANNEL = "production-queue:regenerate-scene";
export const QUEUE_APPROVE_SCENE_CHANNEL = "production-queue:approve-scene";
export const QUEUE_REJECT_SCENE_CHANNEL = "production-queue:reject-scene";
export const QUEUE_SET_APPROVAL_POLICY_CHANNEL = "production-queue:set-approval-policy";
export const QUEUE_CHANGED_CHANNEL = "production-queue:changed";

export type QueueRuntimeState = "idle" | "running" | "paused" | "stopped";

export const QUEUE_ERROR_CATEGORIES = [
  "dom_element_not_found",
  "flow_policy_violation",
  "response_schema_invalid",
  "timeout_no_response",
  "flow_quota_or_rate_limit",
  "extension_disconnected",
] as const;

export type QueueErrorCategory = (typeof QUEUE_ERROR_CATEGORIES)[number];

export interface QueueGenerateOptions {
  fromSceneIndex?: number;
  onlyStatuses?: SceneState[];
}

export interface QueueVideoOptions extends QueueGenerateOptions {
  onlyApprovedImages: true;
}

export interface QueueSceneView {
  sceneId: string;
  orderIndex: number;
  status: SceneState;
  imageAssetPath: string;
  flowImageAssetId: string;
  videoAssetPath: string;
  approvedImage: boolean;
  approvedVideo: boolean;
  lastError: string;
}

export interface QueueErrorView {
  jobId: string;
  sceneId: string;
  orderIndex: number;
  mediaType: SceneMediaType;
  category: QueueErrorCategory;
  message: string;
  attempts: number;
  maxAttempts: number;
  retryable: boolean;
  updatedAt: string;
}

export interface QueueJobView {
  id: string;
  sceneId: string;
  mediaType: SceneMediaType | null;
  status: JobState;
  dependsOn: string;
  attempts: number;
  maxAttempts: number;
}

export interface ProductionQueueSnapshot {
  projectId: string;
  state: QueueRuntimeState;
  activeJobId: string;
  activeSceneId: string;
  activeMediaType: SceneMediaType | null;
  queuedJobs: number;
  autoApproveImages: boolean;
  autoApproveVideos: boolean;
  scenes: QueueSceneView[];
  jobs: QueueJobView[];
  errors: QueueErrorView[];
}

export interface ClearGeneratedMediaResult {
  snapshot: ProductionQueueSnapshot;
  deletedFiles: number;
  deletedDirectories: number;
  retainedScenes: number;
}

export interface ClearSceneMediaResult {
  snapshot: ProductionQueueSnapshot;
  sceneId: string;
  deletedFiles: number;
}

export interface ProductionQueueBridge {
  getSnapshot: (projectId?: string) => Promise<ProductionQueueSnapshot>;
  generateAllImages: (
    projectId?: string,
    options?: QueueGenerateOptions,
  ) => Promise<ProductionQueueSnapshot>;
  generateAllVideos: (
    projectId?: string,
    options?: QueueVideoOptions,
  ) => Promise<ProductionQueueSnapshot>;
  pauseQueue: () => Promise<ProductionQueueSnapshot>;
  resumeQueue: () => Promise<ProductionQueueSnapshot>;
  stopQueue: () => Promise<ProductionQueueSnapshot>;
  clearGeneratedMedia: (
    projectId?: string,
  ) => Promise<ClearGeneratedMediaResult>;
  clearSceneMedia: (
    sceneId: string,
    projectId?: string,
  ) => Promise<ClearSceneMediaResult>;
  retryFailed: (
    sceneIds: string[],
    projectId?: string,
  ) => Promise<ProductionQueueSnapshot>;
  resumeFrom: (
    sceneId: string,
    mediaType: SceneMediaType,
    projectId?: string,
  ) => Promise<ProductionQueueSnapshot>;
  regenerateScene: (
    sceneId: string,
    mediaType: SceneMediaType,
    projectId?: string,
  ) => Promise<ProductionQueueSnapshot>;
  approveScene: (
    sceneId: string,
    mediaType: SceneMediaType,
    projectId?: string,
  ) => Promise<ProductionQueueSnapshot>;
  rejectScene: (
    sceneId: string,
    mediaType: SceneMediaType,
    projectId?: string,
  ) => Promise<ProductionQueueSnapshot>;
  setApprovalPolicy: (
    images: boolean,
    videos: boolean,
    projectId?: string,
  ) => Promise<ProductionQueueSnapshot>;
  onChanged: (
    callback: (snapshot: ProductionQueueSnapshot) => void,
  ) => () => void;
}
