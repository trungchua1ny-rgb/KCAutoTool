import type { TimelineSession } from "../shared/timeline";
import type { HomeWorkflowMode } from "./integrated-workflow";

const HOME_MODE_KEY_PREFIX = "kc-auto-tool.session-home-mode.v1:";
const CHARACTERS_REVIEWED_KEY_PREFIX = "kc-auto-tool.session-characters-reviewed.v1:";
const MODES = new Set<HomeWorkflowMode>(["full_auto", "srt_script", "step_by_step", "screenplay_film"]);

export type HomeSessionPhase = "choose_mode" | "setup" | "production";

export interface HomeSetupState {
  phase: HomeSessionPhase;
  mode: HomeWorkflowMode | null;
  sourceReady: boolean;
  charactersReady: boolean;
  visualBibleReady: boolean;
  timelineReady: boolean;
  continuePage: "voice" | "screenplay" | "characters" | "visual-bible" | "timeline";
  currentStep: "mode" | "source" | "characters" | "visual_bible" | "timeline" | "production";
}

function sourceHasContent(session: TimelineSession): boolean {
  if (session.productionKind === "screenplay") {
    return Boolean(session.screenplay.scriptText.trim() || session.screenplay.shots.length);
  }
  const source = session.workflowSource;
  return Boolean(
    source.narrationText?.trim() || source.narrationFileName?.trim() ||
    source.srtText.trim() || source.srtFileName.trim() || source.srtPath.trim() ||
    source.scriptText.trim() || source.scriptFileName.trim() || source.audioPath.trim(),
  );
}

function inferLegacyMode(session: TimelineSession): HomeWorkflowMode | null {
  if (session.productionKind === "screenplay") return "screenplay_film";
  if (!sourceHasContent(session) && session.scenes.length === 0) return null;
  const source = session.workflowSource;
  const usedVoice = Boolean(
    source.audioPath.trim() || source.audioFileName.trim() ||
    source.narrationText?.trim() || source.narrationFileName?.trim(),
  );
  if (!usedVoice) return "srt_script";
  return session.workflowMode === "automatic" ? "full_auto" : "step_by_step";
}

export function readHomeWorkflowMode(session: TimelineSession | null): HomeWorkflowMode | null {
  if (!session) return null;
  const stored = localStorage.getItem(`${HOME_MODE_KEY_PREFIX}${session.id}`) as HomeWorkflowMode | null;
  return stored && MODES.has(stored) ? stored : inferLegacyMode(session);
}

export function saveHomeWorkflowMode(sessionId: string, mode: HomeWorkflowMode): void {
  localStorage.setItem(`${HOME_MODE_KEY_PREFIX}${sessionId}`, mode);
}

export function readHomeCharactersReviewed(sessionId: string): boolean {
  return localStorage.getItem(`${CHARACTERS_REVIEWED_KEY_PREFIX}${sessionId}`) === "true";
}

export function markHomeCharactersReviewed(sessionId: string, reviewed = true): void {
  localStorage.setItem(`${CHARACTERS_REVIEWED_KEY_PREFIX}${sessionId}`, String(reviewed));
}

export function deriveHomeSetupState(session: TimelineSession | null): HomeSetupState {
  if (!session) return {
    phase: "choose_mode",
    mode: null,
    sourceReady: false,
    charactersReady: false,
    visualBibleReady: false,
    timelineReady: false,
    continuePage: "timeline",
    currentStep: "mode",
  };
  const mode = readHomeWorkflowMode(session);
  const source = session.workflowSource;
  const sourceReady = mode === "screenplay_film"
    ? session.screenplay.parseStatus === "approved" && session.screenplay.shots.length > 0
    : mode === "srt_script"
    ? Boolean((source.srtText.trim() || source.srtFileName.trim() || source.srtPath.trim()) && (source.scriptText.trim() || source.scriptFileName.trim()))
    : Boolean(source.narrationText?.trim() && source.voiceName?.trim());
  const visualBibleReady = Boolean(session.visualBible.style.trim());
  const timelineReady = session.scenes.length > 0;
  const charactersReady = timelineReady || readHomeCharactersReviewed(session.id);
  if (timelineReady) return {
    phase: "production",
    mode,
    sourceReady,
    charactersReady,
    visualBibleReady,
    timelineReady,
    continuePage: "timeline",
    currentStep: "production",
  };
  if (!mode) return {
    phase: "choose_mode",
    mode: null,
    sourceReady,
    charactersReady,
    visualBibleReady,
    timelineReady,
    continuePage: "timeline",
    currentStep: "mode",
  };
  const continuePage = mode === "screenplay_film" && !sourceReady
    ? "screenplay"
    : mode !== "srt_script" && !sourceReady
    ? "voice"
    : !charactersReady
      ? "characters"
      : !visualBibleReady
        ? "visual-bible"
        : "timeline";
  return {
    phase: "setup",
    mode,
    sourceReady,
    charactersReady,
    visualBibleReady,
    timelineReady,
    continuePage,
    currentStep: !sourceReady ? "source" : !charactersReady ? "characters" : !visualBibleReady ? "visual_bible" : "timeline",
  };
}

export const HOME_MODE_LABELS: Record<HomeWorkflowMode, string> = {
  full_auto: "Tự động toàn bộ video",
  srt_script: "Từ SRT và kịch bản",
  step_by_step: "Tạo từng bước",
  screenplay_film: "Phim kịch bản hình",
};
