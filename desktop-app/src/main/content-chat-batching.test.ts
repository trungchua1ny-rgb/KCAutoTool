import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

interface Boundary {
  startMs: number;
  endMs: number;
  start?: string;
  end?: string;
  durationSeconds?: 4 | 6 | 8;
  chainId?: string | null;
  chainRole?: "single" | "start" | "continue";
}

interface TimelineBatch {
  boundaries: Boundary[];
  srtText: string;
}

test("splits a long SRT into batches of six 8-second scenes", async () => {
  const source = await readFile(
    resolve(process.cwd(), "../extension-worker/content-chat.js"),
    "utf8",
  );
  const windowValue: Record<string, unknown> = {};
  const context = {
    window: windowValue,
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: () => Promise.resolve(),
      },
    },
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    HTMLElement: class {},
    HTMLTextAreaElement: class {},
    Event: class {},
    InputEvent: class {},
  };
  vm.runInNewContext(source, context);

  const internals = windowValue.__FLOWX_CHAT_INTERNALS__ as {
    createTimelineBatches: (srtText: string) => TimelineBatch[];
    buildBeatPlanningPrompt: (srtText: string, scriptText: string) => string;
    parseBeatPlanningResponse: (text: string) => Array<Record<string, unknown>>;
    validateBeatPlanningResult: (
      beats: Array<Record<string, unknown>>,
      srtText: string,
    ) => Boundary[];
    buildTimelinePrompt: (
      batch: TimelineBatch & { index: number },
      batchCount: number,
      scriptText: string,
      visualBible?: {
        style: string;
        palette: string;
        lighting: string;
        continuityNotes: string;
        aspectRatio: "16:9";
      },
      characterRoster?: Array<{ token: string; name: string }>,
    ) => string;
    validateBatchResult: (
      result: { scenes: Array<Record<string, unknown>>; visualBible?: unknown },
      batch: TimelineBatch & { index: number },
    ) => void;
  };
  const batches = internals.createTimelineBatches(`1
00:00:00,000 --> 00:00:04,000
Opening

2
00:03:20,000 --> 00:03:21,000
Ending`);

  assert.deepEqual(
    Array.from(batches, (batch) => batch.boundaries.length),
    [6, 6, 6, 6, 2],
  );
  assert.equal(batches[0].boundaries[0].startMs, 0);
  const finalEnd = batches[4].boundaries.at(-1)?.endMs;
  assert.equal(finalEnd, 208_000);
  assert.equal(finalEnd! - 201_000, 7_000);
  assert.match(batches[0].srtText, /Opening/);
  assert.match(batches[4].srtText, /Ending/);

  const beatSrt = `1
00:00:00,000 --> 00:00:08,000
The hero enters.

2
00:00:08,000 --> 00:00:18,000
The hero crosses the hall.`;
  const beatPrompt = internals.buildBeatPlanningPrompt(beatSrt, "A continuous walk through one hall.");
  assert.match(beatPrompt, /JOB TYPE: beat_planning/);
  assert.match(beatPrompt, /sum of durationSeconds MUST equal exactly 18 seconds/);
  const beatPlan = internals.validateBeatPlanningResult(
    internals.parseBeatPlanningResponse(JSON.stringify({ beats: [
      { timeStart: "00:00:00,000", timeEnd: "00:00:08,000", durationSeconds: 8, chainId: "hall", chainRole: "start" },
      { timeStart: "00:00:08,000", timeEnd: "00:00:14,000", durationSeconds: 6, chainId: "hall", chainRole: "continue" },
      { timeStart: "00:00:14,000", timeEnd: "00:00:18,000", durationSeconds: 4, chainId: null, chainRole: "single" },
    ] })),
    beatSrt,
  );
  assert.deepEqual(Array.from(beatPlan, (beat) => beat.durationSeconds), [8, 6, 4]);
  assert.equal(beatPlan.at(-1)?.endMs, 18_000);
  assert.throws(() => internals.validateBeatPlanningResult([
    { timeStart: "00:00:00,000", timeEnd: "00:00:08,000", durationSeconds: 8, chainId: null, chainRole: "single" },
    { timeStart: "00:00:10,000", timeEnd: "00:00:18,000", durationSeconds: 8, chainId: null, chainRole: "single" },
  ], beatSrt), /gap, overlap/);

  const plannedBatches = (internals.createTimelineBatches as unknown as (
    srtText: string,
    boundaries: Boundary[],
  ) => TimelineBatch[])(beatSrt, beatPlan);
  assert.deepEqual(
    Array.from(plannedBatches[0].boundaries, (boundary) => boundary.durationSeconds),
    [8, 6, 4],
  );

  const firstPrompt = internals.buildTimelinePrompt(
    batches[0] as TimelineBatch & { index: number },
    batches.length,
    "A complete cinematic story with a recurring blue-coated hero.",
  );
  assert.match(firstPrompt, /PROJECT VISUAL BIBLE — REQUIRED/);
  assert.match(firstPrompt, /"visualBible"/);
  assert.match(firstPrompt, /complete supporting script/i);
  assert.match(firstPrompt, /aspectRatio must always be exactly "16:9"/);
  assert.match(firstPrompt, /Never invent a character/);
  assert.doesNotMatch(firstPrompt, /Stickman, flat 2D illustration/);

  const rosterPrompt = internals.buildTimelinePrompt(
    batches[0] as TimelineBatch & { index: number },
    batches.length,
    "Gullit enters and Gullit returns later.",
    undefined,
    [{ token: "@GULLIT", name: "Gullit" }],
  );
  assert.match(rosterPrompt, /Gullit = @GULLIT/);
  assert.match(rosterPrompt, /token beside the name/);
  assert.match(rosterPrompt, /mention alone does not make the person visible/i);

  const lockedStylePrompt = internals.buildTimelinePrompt(
    batches[0] as TimelineBatch & { index: number },
    batches.length,
    "A complete story.",
    {
      style: "Stickman, flat 2D illustration, white background",
      palette: "black, white, red accents",
      lighting: "",
      continuityNotes: "",
      aspectRatio: "16:9",
    },
  );
  assert.match(lockedStylePrompt, /Non-empty user fields are locked/);
  assert.match(lockedStylePrompt, /generate values for these blank fields: lighting, continuityNotes/);
  assert.match(lockedStylePrompt, /Stickman, flat 2D illustration, white background/);
  assert.match(lockedStylePrompt, /Do NOT repeat global graphic style, palette, default lighting/);
  assert.match(lockedStylePrompt, /facial expression, head angle, posture, gesture/);
  assert.match(lockedStylePrompt, /foreground element, one middle-ground subject\/object, and one background element/);
  assert.match(lockedStylePrompt, /one continuous, physically possible shot lasting exactly the required boundary duration/);
  assert.match(lockedStylePrompt, /SETTING AND BACKGROUND:/);
  assert.match(lockedStylePrompt, /Avoid fast gestures, crossed or overlapping limbs/);

  const filler = Array.from({ length: 72 }, (_, index) => `visible${index}`).join(" ");
  const detailedImagePrompt = `SUBJECT AND ACTION: a figure opens a door. EMOTION AND BODY LANGUAGE: worried eyes and tense shoulders. SETTING AND BACKGROUND: an old farmhouse at night. DEPTH LAYERS: fence foreground, figure middle-ground, forest background. CAMERA AND COMPOSITION: medium eye-level shot. ${filler}`;
  const detailedVideoPrompt = `STARTING STATE: the figure holds the door. PRIMARY MOTION: one arm slowly pulls it open. REACTION: the face changes from worry to alarm. ENVIRONMENTAL MOTION: a curtain moves gently. CAMERA MOTION: one slow push forward. END FRAME: the figure pauses beside the open doorway. ${filler}`;
  const validationBatch = batches[1] as TimelineBatch & { index: number };
  const validationScenes = validationBatch.boundaries.map((boundary) => ({
    timeStart: String((boundary as unknown as { start?: string }).start || ""),
    timeEnd: String((boundary as unknown as { end?: string }).end || ""),
    imagePrompt: detailedImagePrompt,
    videoPrompt: detailedVideoPrompt,
  }));
  assert.doesNotThrow(() => internals.validateBatchResult(
    { scenes: validationScenes },
    validationBatch,
  ));
  validationScenes[0].imagePrompt = "too short";
  assert.throws(
    () => internals.validateBatchResult({ scenes: validationScenes }, validationBatch),
    /required 80-150/,
  );
  validationScenes[0].imagePrompt = detailedImagePrompt.replace("SETTING AND BACKGROUND:", "SETTING:");
  validationScenes[0].videoPrompt = detailedVideoPrompt;
  assert.throws(
    () => internals.validateBatchResult({ scenes: validationScenes }, validationBatch),
    /missing required visual sections/,
  );

  const laterPrompt = internals.buildTimelinePrompt(
    batches[1] as TimelineBatch & { index: number },
    batches.length,
    "This must not be repeated in later batches.",
  );
  assert.match(laterPrompt, /Reuse the exact Visual Bible established in batch 1/);
  assert.doesNotMatch(laterPrompt, /"visualBible":/);
});
