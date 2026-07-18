export const VOICE_LIST_CHANNEL = "voice:list";
export const VOICE_PREVIEW_CHANNEL = "voice:preview";
export const VOICE_GENERATE_CHANNEL = "voice:generate";
export const VOICE_CANCEL_CHANNEL = "voice:cancel";
export const VOICE_PROGRESS_CHANNEL = "voice:progress";

export type VoicePauseLevel = "off" | "medium" | "strong" | "dramatic";

export interface VoiceCatalogEntry {
  shortName: string;
  locale: string;
  gender: string;
  friendlyName: string;
}

export interface VoiceProsody {
  rate: number;
  pitch: number;
  volume: number;
  pauseLevel: VoicePauseLevel;
}

export interface VoiceGenerateInput {
  projectId: string;
  projectName: string;
  narrationText: string;
  narrationFileName: string;
  voice: string;
  prosody: VoiceProsody;
  splitMode?: "paragraph" | "sentence";
  maxCharsPerChunk?: number;
  exportWordSrt?: boolean;
}

export interface VoiceWordTiming {
  text: string;
  start: number;
  end: number;
}

export interface VoiceGenerateResult {
  audioPath: string;
  audioFileName: string;
  srtPath: string;
  srtFileName: string;
  srtText: string;
  wordSrtPath: string;
  wordSrtFileName: string;
  durationSeconds: number;
  words: VoiceWordTiming[];
}

export interface VoiceProgress {
  stage: "preparing" | "synthesizing" | "joining" | "pauses" | "subtitles" | "done" | "stopping";
  completed: number;
  total: number;
  message: string;
}

export interface VoiceBridge {
  list: () => Promise<VoiceCatalogEntry[]>;
  preview: (voice: string, locale: string) => Promise<string>;
  generate: (input: VoiceGenerateInput) => Promise<VoiceGenerateResult>;
  cancel: () => Promise<boolean>;
  onProgress: (callback: (progress: VoiceProgress) => void) => () => void;
}
