import { ipcMain } from "electron";
import {
  TIMELINE_SESSION_CLEAR_CHANNEL,
  TIMELINE_SESSION_LOAD_CHANNEL,
  TIMELINE_SESSION_SAVE_CHANNEL,
  type TimelineSessionInput,
} from "../shared/timeline";
import type { TimelineSessionStore } from "./timeline-session-store";

export function registerTimelineSessionIpcHandlers(
  store: TimelineSessionStore,
): void {
  ipcMain.handle(TIMELINE_SESSION_LOAD_CHANNEL, () => store.load());
  ipcMain.handle(
    TIMELINE_SESSION_SAVE_CHANNEL,
    (_event, input: TimelineSessionInput) => store.save(input),
  );
  ipcMain.handle(TIMELINE_SESSION_CLEAR_CHANNEL, () => store.clear());
}
