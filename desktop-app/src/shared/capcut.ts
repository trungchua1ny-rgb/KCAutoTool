import type { TimelineSession } from "./timeline";

export const CAPCUT_INSPECT_BUILD_CHANNEL = "capcut:inspect-build";
export const CAPCUT_BUILD_TIMELINE_CHANNEL = "capcut:build-timeline";

export interface CapCutProjectOption {
  name: string;
  folderName: string;
  path: string;
  modifiedAt: string;
  audioCount: number;
  audioDurationSeconds: number | null;
  videoSegmentCount: number;
}

export interface CapCutBuildInspection {
  ready: boolean;
  reason: string;
  targetProjectName: string;
  targetProjectPath: string;
  sceneCount: number;
  completedSceneCount: number;
  videoDurationSeconds: number;
  audioDurationSeconds: number | null;
  existingVideoSegments: number;
  existingSessionMatch: boolean;
  selectedProjectPath: string;
  availableProjects: CapCutProjectOption[];
}

export interface CapCutBuildOptions {
  replaceExisting: boolean;
  targetProjectPath: string;
}

export interface CapCutBuildResult extends CapCutBuildInspection {
  backupPath: string;
  builtAt: string;
}

export interface CapCutBridge {
  inspectBuild: (
    session: TimelineSession,
    targetProjectPath?: string,
  ) => Promise<CapCutBuildInspection>;
  buildTimeline: (
    session: TimelineSession,
    options: CapCutBuildOptions,
  ) => Promise<CapCutBuildResult>;
}
