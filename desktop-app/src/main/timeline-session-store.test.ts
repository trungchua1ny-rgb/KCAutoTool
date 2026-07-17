import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TimelineSessionStore } from "./timeline-session-store";

const SCENES = [
  {
    id: "scene-001",
    order: 1,
    timeStart: "00:00:00,000",
    timeEnd: "00:00:08,000",
    imagePrompt: "A saved scene",
    imageStatus: "done" as const,
    imageResultPath: "mock://phase4/image/scene-001/saved",
    imageFlowAssetKey: "path:https://flow.google/assets/scene-001",
    imageApproved: false,
    videoPrompt: "Camera tracks forward",
    videoStatus: "pending" as const,
    videoResultPath: "",
    videoApproved: false,
    usedCharacterTokens: [],
  },
];

test("persists, switches, renames, and deletes multiple timeline sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowx-timeline-"));
  try {
    const store = new TimelineSessionStore(directory);
    const saved = await store.save({
      scenes: SCENES,
      visualBible: {
        style: "cinematic 3D",
        palette: "teal and gold",
        lighting: "soft sunset",
        continuityNotes: "Keep wardrobe unchanged",
        aspectRatio: "16:9",
      },
      styleReference: {
        name: "sample.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    assert.equal(saved.scenes[0].imagePrompt, "A saved scene");
    assert.equal(saved.visualBible.palette, "teal and gold");

    const reloaded = new TimelineSessionStore(directory);
    const restored = await reloaded.load();
    assert.equal(restored?.scenes.length, 1);
    assert.equal(restored?.scenes[0].imageResultPath, SCENES[0].imageResultPath);
    assert.equal(restored?.scenes[0].imageFlowAssetKey, SCENES[0].imageFlowAssetKey);
    assert.equal(restored?.visualBible.style, "cinematic 3D");
    assert.equal(restored?.styleReference?.name, "sample.png");

    const second = await reloaded.create("Project two");
    assert.equal((await reloaded.list()).length, 2);
    assert.equal((await reloaded.load())?.id, second.id);
    await reloaded.save({
      scenes: [],
      visualBible: {
        style: "flat 2D",
        palette: "black and white",
        lighting: "flat",
        continuityNotes: "stable shapes",
        aspectRatio: "16:9",
      },
    });
    assert.equal((await reloaded.load())?.scenes.length, 0);
    await reloaded.rename(second.id, "Renamed project");
    assert.equal((await reloaded.list()).find((item) => item.id === second.id)?.name, "Renamed project");

    await reloaded.select(saved.id);
    assert.equal((await reloaded.load())?.scenes.length, 1);
    const deleted = await reloaded.delete(saved.id);
    assert.equal(deleted.activeSession?.id, second.id);
    assert.equal(deleted.sessions.length, 1);

    await reloaded.clear();
    assert.equal((await reloaded.load())?.scenes.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migrates the version 2 single session without losing its timeline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowx-timeline-v2-"));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "session.json"), JSON.stringify({
      version: 2,
      session: {
        scenes: SCENES,
        visualBible: {
          style: "legacy hand drawn style",
          palette: "black and white",
          lighting: "flat daylight",
          continuityNotes: "preserve proportions",
          aspectRatio: "16:9",
        },
        savedAt: "2026-07-16T12:00:00.000Z",
      },
    }));
    const store = new TimelineSessionStore(directory);
    const migrated = await store.load();
    assert.equal(migrated?.id, "legacy-default-project");
    assert.equal(migrated?.name, "Phiên làm việc trước đây");
    assert.equal(migrated?.scenes[0].imageResultPath, SCENES[0].imageResultPath);
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
