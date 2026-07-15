import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeStoredScenes,
  normalizeTimelineResult,
  validateTimelineCoverage,
} from "./timeline";

test("normalizes generated scenes and character tokens", () => {
  const result = normalizeTimelineResult({
    visualBible: {
      style: "cinematic illustration",
      palette: "teal and gold",
      lighting: "soft sunset",
      continuityNotes: "Keep character proportions unchanged",
      aspectRatio: "16:9",
    },
    scenes: [
      {
        id: "ignored",
        order: 99,
        timeStart: "00:00:00,000",
        timeEnd: "00:00:08,000",
        imagePrompt: "Portrait of @ancestor and @GUIDE",
        videoPrompt: "Slow push in",
        usedCharacterTokens: ["ancestor", "@ANCESTOR"],
      },
    ],
  });

  assert.equal(result.scenes[0].id, "scene-001");
  assert.equal(result.scenes[0].order, 1);
  assert.equal(
    result.scenes[0].imagePrompt,
    "Portrait of @ANCESTOR and @GUIDE",
  );
  assert.deepEqual(result.scenes[0].usedCharacterTokens, [
    "@ANCESTOR",
    "@GUIDE",
  ]);
  assert.equal(result.scenes[0].imageStatus, "pending");
  assert.equal(result.visualBible.style, "cinematic illustration");
  assert.equal(result.scenes[0].characterPolicy, "selected");
  assert.deepEqual(result.scenes[0].assignedCharacterTokens, [
    "@ANCESTOR",
    "@GUIDE",
  ]);
});

test("rejects empty or malformed scene results", () => {
  assert.throws(() => normalizeTimelineResult({ scenes: [] }));
  assert.throws(() =>
    normalizeTimelineResult({
      scenes: [{ timeStart: "00:00:00,000", timeEnd: "00:00:01,000" }],
    }),
  );
});

test("enforces fixed 8-second continuous scene boundaries", () => {
  const scene = {
    imagePrompt: "A visible action",
    videoPrompt: "A moving camera",
  };
  assert.throws(
    () =>
      normalizeTimelineResult({
        scenes: [
          { ...scene, timeStart: "00:00:00", timeEnd: "00:00:04" },
        ],
      }),
    /exactly 8 seconds/,
  );
  assert.throws(
    () =>
      normalizeTimelineResult({
        scenes: [
          { ...scene, timeStart: "00:00:00", timeEnd: "00:00:08" },
          { ...scene, timeStart: "00:00:09", timeEnd: "00:00:17" },
        ],
      }),
    /start exactly/,
  );
});

test("requires complete coverage of the SRT bounds", () => {
  const result = normalizeTimelineResult({
    scenes: [
      {
        timeStart: "00:00:02",
        timeEnd: "00:00:10",
        imagePrompt: "A visible action",
        videoPrompt: "A moving camera",
      },
    ],
  });
  assert.doesNotThrow(() =>
    validateTimelineCoverage(
      result,
      "1\n00:00:02,000 --> 00:00:09,000\nSubtitle",
    ),
  );
  assert.throws(
    () =>
      validateTimelineCoverage(
        result,
        "1\n00:00:00,000 --> 00:00:09,000\nSubtitle",
      ),
    /first SRT timestamp/,
  );
});

test("restores completed results and resets interrupted scene jobs", () => {
  const base = {
    timeStart: "00:00:00",
    timeEnd: "00:00:08",
    imagePrompt: "Saved image prompt",
    videoPrompt: "Saved video prompt",
    usedCharacterTokens: [],
  };
  const [scene] = normalizeStoredScenes([
    {
      ...base,
      imageStatus: "done",
      imageResultPath: "mock://saved/image",
      imageFlowAssetKey: "path:https://flow.google/assets/saved-image",
      imageApproved: false,
      videoStatus: "generating",
      videoResultPath: "",
      videoApproved: false,
    },
  ]);

  assert.equal(scene.imageStatus, "done");
  assert.equal(scene.imageResultPath, "mock://saved/image");
  assert.equal(scene.imageFlowAssetKey, "path:https://flow.google/assets/saved-image");
  assert.equal(scene.videoStatus, "pending");
});

test("keeps explicit no-character policy independent from prompt tokens", () => {
  const [scene] = normalizeStoredScenes([{
    timeStart: "00:00:00",
    timeEnd: "00:00:08",
    imagePrompt: "A mural labeled @HERO",
    videoPrompt: "",
    characterPolicy: "none",
    assignedCharacterTokens: [],
  }]);

  assert.deepEqual(scene.usedCharacterTokens, ["@HERO"]);
  assert.equal(scene.characterPolicy, "none");
  assert.deepEqual(scene.assignedCharacterTokens, []);
});
