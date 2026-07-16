import { BrowserWindow, ipcMain } from "electron";
import {
  SCENE_JOB_PROGRESS_CHANNEL,
  SCENE_JOB_CANCEL_CHANNEL,
  SCENE_JOB_RUN_CHANNEL,
  normalizeSceneJobInput,
  type SceneJobProgress,
} from "../shared/scene-job";
import { WorkerServer } from "./worker-server";
import type { CharacterStore } from "./character-store";

function broadcastProgress(progress: SceneJobProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SCENE_JOB_PROGRESS_CHANNEL, progress);
  }
}

export function registerSceneJobIpcHandlers(
  server: WorkerServer,
  characterStore: CharacterStore,
): void {
  ipcMain.handle(SCENE_JOB_CANCEL_CHANNEL, () => server.stopActiveJob("flow-worker"));
  ipcMain.handle(SCENE_JOB_RUN_CHANNEL, async (_event, value: unknown) => {
    const input = normalizeSceneJobInput(value);
    const refImages = input.mediaType === "image"
      ? await characterStore.resolveReferences(input.characterTokens)
      : [];
    return server.runSceneJob({ ...input, refImages }, broadcastProgress);
  });
}
