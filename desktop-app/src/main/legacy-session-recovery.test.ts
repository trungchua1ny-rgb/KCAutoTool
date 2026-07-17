import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_PROJECT_ID } from "../shared/production-queue";
import { recoverLegacySessionFromProject } from "./legacy-session-recovery";
import { ProjectDatabase } from "./project-database";
import { ProjectRepositories } from "./project-repositories";
import { TimelineSessionStore } from "./timeline-session-store";

test("recovers an empty v3 workspace from the legacy SQLite project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kc-legacy-recovery-"));
  const database = new ProjectDatabase(join(directory, "project.sqlite"));
  try {
    await database.initialize();
    const repositories = new ProjectRepositories(database);
    repositories.projects.create({
      id: DEFAULT_PROJECT_ID,
      name: "Recovered project",
      createdAt: "2026-07-16T10:00:00.000Z",
    });
    const bible = repositories.visualBibles.create({
      id: `${DEFAULT_PROJECT_ID}:visual-bible:1`,
      projectId: DEFAULT_PROJECT_ID,
      version: 1,
      stylePresetId: null,
      payloadJson: JSON.stringify({
        style: "hand drawn",
        palette: "black and white",
        lighting: "flat daylight",
        continuityNotes: "stable proportions",
        aspectRatio: "16:9",
      }),
      contentHash: "legacy-hash",
      locked: false,
      anchorImagePaths: [],
      createdAt: "2026-07-16T10:00:00.000Z",
    });
    repositories.scenes.create({
      id: `${DEFAULT_PROJECT_ID}:scene-001`,
      projectId: DEFAULT_PROJECT_ID,
      batchIndex: 0,
      orderIndex: 0,
      timeStart: "00:00:00,000",
      timeEnd: "00:00:08,000",
      imagePrompt: "Recovered image prompt",
      videoPrompt: "Recovered video prompt",
      usedCharacterTokens: [],
      narrationSrtRange: null,
      visualBibleId: bible.id,
      chainId: null,
      chainRole: "single",
      durationSeconds: 8,
      startFrameAssetPath: null,
      status: "video_done",
      imageAssetPath: "C:/KC/scene-001.png",
      flowImageAssetId: "asset:scene-001",
      videoAssetPath: "C:/KC/scene-001.mp4",
      approvedImage: true,
      approvedVideo: false,
      lastError: null,
      updatedAt: "2026-07-16T11:00:00.000Z",
    });

    const store = new TimelineSessionStore(join(directory, "timeline"));
    const recovered = await recoverLegacySessionFromProject(database, store);
    assert.equal(recovered?.scenes.length, 1);
    assert.equal((await store.load())?.id, DEFAULT_PROJECT_ID);
    assert.equal((await store.load())?.scenes[0].videoResultPath, "C:/KC/scene-001.mp4");
    assert.deepEqual((await store.list()).map((session) => session.sceneCount), [1]);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
