import { ipcMain } from "electron";
import {
  VOICE_CANCEL_CHANNEL,
  VOICE_GENERATE_CHANNEL,
  VOICE_LIST_CHANNEL,
  VOICE_PREVIEW_CHANNEL,
  type VoiceGenerateInput,
} from "../shared/voice";
import type { VoiceService } from "./voice-service";

export function registerVoiceIpcHandlers(service: VoiceService): void {
  ipcMain.handle(VOICE_LIST_CHANNEL, () => service.listVoices());
  ipcMain.handle(
    VOICE_PREVIEW_CHANNEL,
    (_event, value: { voice?: unknown; locale?: unknown }) => {
      const voice = typeof value?.voice === "string" ? value.voice.trim() : "";
      const locale = typeof value?.locale === "string" ? value.locale.trim() : "";
      if (!voice) throw new Error("Giọng nghe thử không hợp lệ.");
      return service.preview(voice, locale);
    },
  );
  ipcMain.handle(
    VOICE_GENERATE_CHANNEL,
    (_event, value: VoiceGenerateInput) => service.generate(value),
  );
  ipcMain.handle(VOICE_CANCEL_CHANNEL, () => service.cancel());
}

