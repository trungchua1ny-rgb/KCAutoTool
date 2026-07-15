import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

test("persists and clears the latest timeline session", async () => {
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
    });
    assert.equal(saved.scenes[0].imagePrompt, "A saved scene");
    assert.equal(saved.visualBible.palette, "teal and gold");

    const reloaded = new TimelineSessionStore(directory);
    const restored = await reloaded.load();
    assert.equal(restored?.scenes.length, 1);
    assert.equal(restored?.scenes[0].imageResultPath, SCENES[0].imageResultPath);
    assert.equal(restored?.scenes[0].imageFlowAssetKey, SCENES[0].imageFlowAssetKey);
    assert.equal(restored?.visualBible.style, "cinematic 3D");

    await reloaded.clear();
    assert.equal(await reloaded.load(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
