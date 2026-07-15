import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import {
  WORKER_STATUS_CHANNEL,
  WORKER_STATUS_GET_CHANNEL,
  type WorkerStatuses,
} from "../shared/worker-status";
import { registerCharacterIpcHandlers } from "./character-ipc";
import { CharacterStore } from "./character-store";
import { registerTimelineIpcHandlers } from "./timeline-ipc";
import { registerTimelineSessionIpcHandlers } from "./timeline-session-ipc";
import { TimelineSessionStore } from "./timeline-session-store";
import { registerSceneJobIpcHandlers } from "./scene-job-ipc";
import { registerMediaIpcHandlers } from "./media-ipc";
import { registerVisualStyleIpcHandlers } from "./visual-style-ipc";
import { VisualStyleStore } from "./visual-style-store";
import { ProjectDatabase } from "./project-database";
import { migrateLegacyProjectData } from "./legacy-project-migration";
import { ProductionQueue } from "./production-queue";
import { registerProductionQueueIpcHandlers } from "./production-queue-ipc";
import { QUEUE_CHANGED_CHANNEL, type ProductionQueueSnapshot } from "../shared/production-queue";
import {
  WORKER_SERVER_HOST,
  WORKER_SERVER_PORT,
  WorkerServer,
} from "./worker-server";

let workerServer: WorkerServer | null = null;
let projectDatabase: ProjectDatabase | null = null;
let productionQueue: ProductionQueue | null = null;

function broadcastWorkerStatuses(statuses: WorkerStatuses): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(WORKER_STATUS_CHANNEL, statuses);
  }
}

function broadcastQueueSnapshot(snapshot: ProductionQueueSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(QUEUE_CHANGED_CHANNEL, snapshot);
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f6f8",
    title: "KC Auto Tool",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  const timelineSessionStore = new TimelineSessionStore(
    process.env.FLOWX_DATA_DIR
      ? join(process.env.FLOWX_DATA_DIR, "timeline-session")
      : join(app.getPath("userData"), "timeline-session"),
  );
  const characterStore = new CharacterStore(
    process.env.FLOWX_DATA_DIR ||
      join(app.getPath("userData"), "character-library"),
  );
  const visualStyleStore = new VisualStyleStore(
    process.env.FLOWX_DATA_DIR
      ? join(process.env.FLOWX_DATA_DIR, "visual-style-library")
      : join(app.getPath("userData"), "visual-style-library"),
  );
  projectDatabase = new ProjectDatabase(
    process.env.FLOWX_DATA_DIR
      ? join(process.env.FLOWX_DATA_DIR, "project-database", "flowx.sqlite")
      : join(app.getPath("userData"), "project-database", "flowx.sqlite"),
  );
  const configuredWorkerPort = Number.parseInt(
    process.env.FLOWX_WORKER_PORT || "",
    10,
  );
  const workerServerOptions =
    Number.isInteger(configuredWorkerPort) &&
    configuredWorkerPort > 0 &&
    configuredWorkerPort <= 65_535
      ? { port: configuredWorkerPort }
      : {};
  workerServer = new WorkerServer(broadcastWorkerStatuses, workerServerOptions);
  ipcMain.handle(WORKER_STATUS_GET_CHANNEL, () => workerServer?.getStatuses());

  try {
    await characterStore.initialize();
    await timelineSessionStore.initialize();
    await visualStyleStore.initialize();
    await projectDatabase.initialize();
    const legacyMigration = migrateLegacyProjectData(
      projectDatabase,
      await timelineSessionStore.load(),
      await visualStyleStore.list(),
      await characterStore.list(),
      { initialImportOnly: true },
    );
    registerCharacterIpcHandlers(characterStore);
    registerTimelineSessionIpcHandlers(timelineSessionStore);
    registerVisualStyleIpcHandlers(visualStyleStore);
    await workerServer.start();
    productionQueue = new ProductionQueue(
      projectDatabase,
      workerServer,
      characterStore,
      timelineSessionStore,
      broadcastQueueSnapshot,
    );
    await productionQueue.start();
    registerProductionQueueIpcHandlers(productionQueue);
    registerTimelineIpcHandlers(workerServer);
    registerSceneJobIpcHandlers(workerServer, characterStore);
    registerMediaIpcHandlers();
    console.info(
      `[KC Auto Tool] Project DB schema v${projectDatabase.schemaVersion}; legacy migration: ${legacyMigration.migrated ? `${legacyMigration.sceneCount} scenes` : "up to date"}`,
    );
    console.info(
      `[KC Auto Tool] Worker server listening on ws://${WORKER_SERVER_HOST}:${workerServer.getListeningPort() || WORKER_SERVER_PORT}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      "KC Auto Tool startup failed",
      `Could not initialize local services.\n\n${message}`,
    );
    app.quit();
    return;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  productionQueue?.shutdown();
  workerServer?.stop();
  projectDatabase?.close();
});
