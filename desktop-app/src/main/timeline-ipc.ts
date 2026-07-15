import { BrowserWindow, ipcMain } from "electron";
import {
  MAX_TIMELINE_FILE_BYTES,
  TIMELINE_CANCEL_CHANNEL,
  TIMELINE_GENERATE_CHANNEL,
  TIMELINE_PROGRESS_CHANNEL,
  normalizeVisualBible,
  type TimelineGenerateInput,
  type TimelineProgress,
} from "../shared/timeline";
import { normalizeCharacterToken } from "../shared/character";
import { WorkerServer } from "./worker-server";

function validateText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} không được để trống`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_TIMELINE_FILE_BYTES) {
    throw new Error(`${label} vượt quá giới hạn 2 MB`);
  }
  return value;
}

function validateInput(value: unknown): TimelineGenerateInput {
  if (!value || typeof value !== "object") {
    throw new Error("Dữ liệu timeline không hợp lệ");
  }
  const input = value as Record<string, unknown>;
  const srtText = validateText(input.srtText, "File phụ đề");
  if (!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(srtText)) {
    throw new Error("File phụ đề không chứa timestamp SRT hợp lệ");
  }

  const characterRoster = Array.isArray(input.characterRoster)
    ? input.characterRoster.slice(0, 100).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const source = entry as Record<string, unknown>;
      const token = typeof source.token === "string"
        ? normalizeCharacterToken(source.token)
        : null;
      const name = typeof source.name === "string" ? source.name.trim().slice(0, 80) : "";
      return token && name ? [{ token, name }] : [];
    })
    : [];

  return {
    srtText,
    scriptText: validateText(input.scriptText, "File kịch bản"),
    visualBible: normalizeVisualBible(input.visualBible),
    characterRoster,
  };
}

function broadcastProgress(progress: TimelineProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(TIMELINE_PROGRESS_CHANNEL, progress);
  }
}

export function registerTimelineIpcHandlers(server: WorkerServer): void {
  ipcMain.handle(TIMELINE_GENERATE_CHANNEL, (_event, value: unknown) =>
    server.generateTimeline(validateInput(value), broadcastProgress),
  );
  ipcMain.handle(TIMELINE_CANCEL_CHANNEL, () =>
    server.stopActiveJob("chat-worker"),
  );
}
