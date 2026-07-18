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
    buildBeatPlanningPrompt: (
      srtText: string,
      scriptText: string,
      previousError?: string,
      hasStyleReference?: boolean,
    ) => string;
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
      hasStyleReference?: boolean,
    ) => string;
    buildTimelineRetryPrompt: (
      batch: TimelineBatch & { index: number },
      batchCount: number,
      reason: string,
      attempt: number,
      visualBible?: Record<string, string>,
      characterRoster?: Array<{ token: string; name: string }>,
      hasStyleReference?: boolean,
    ) => string;
    validateBatchResult: (
      result: { scenes: Array<Record<string, unknown>>; visualBible?: unknown },
      batch: TimelineBatch & { index: number },
    ) => void;
    buildPolicyRewritePrompt: (payload: Record<string, unknown>) => string;
    parsePolicyRewriteResponse: (text: string, mediaType: "image" | "video") => { prompt: string };
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
  const referenceBeatPrompt = internals.buildBeatPlanningPrompt(
    beatSrt,
    "A continuous walk through one hall.",
    "",
    true,
  );
  assert.match(referenceBeatPrompt, /style reference image is attached/i);
  assert.match(referenceBeatPrompt, /graphic style text is authoritative/);
  assert.match(referenceBeatPrompt, /never inject style-reference terminology into scene prompts/);
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
  const rewriteRequest = internals.buildPolicyRewritePrompt({
    sceneId: "scene-004",
    mediaType: "video",
    prompt: "Unsafe original prompt",
    policyError: "Safety policy",
    timeStart: "00:00:24,000",
    timeEnd: "00:00:32,000",
    pairedPrompt: "Opening frame context",
    visualBible: { aspectRatio: "16:9" },
  });
  assert.match(rewriteRequest, /policy_safe_prompt_rewrite/);
  assert.match(rewriteRequest, /Do not evade, disguise, encode/);
  const safeVideoPrompt = `STARTING STATE: a worried figure pauses beside a closed doorway in a quiet hallway. PRIMARY MOTION: the figure steps backward while keeping both hands visible and turning toward a distant sound. REACTION: concern changes into alert attention through the eyes, eyebrows, head angle, and guarded posture. ENVIRONMENTAL MOTION: a loose curtain moves gently beside the window while soft dust crosses the light. CAMERA MOTION: a steady medium tracking shot follows the retreat at natural speed without sudden movement. END FRAME: the figure stops safely near the hallway corner and looks toward the unseen source.`;
  assert.equal(
    internals.parsePolicyRewriteResponse(JSON.stringify({ prompt: safeVideoPrompt }), "video").prompt,
    safeVideoPrompt,
  );
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
  const plannedPrompt = internals.buildTimelinePrompt(
    plannedBatches[0] as TimelineBatch & { index: number },
    plannedBatches.length,
    "A continuous walk through one hall.",
  );
  assert.match(plannedPrompt, /chainRole=continue \| chainId=hall/);
  assert.match(plannedPrompt, /For chainRole continue, write ONLY the video prompt/);
  assert.match(plannedPrompt, /imagePrompt MUST be exactly ""/);
  const referencedStylePrompt = internals.buildTimelinePrompt(
    plannedBatches[0] as TimelineBatch & { index: number },
    plannedBatches.length,
    "A continuous walk through one hall.",
    {
      style: "User-locked stickman base",
      palette: "",
      lighting: "",
      continuityNotes: "",
      aspectRatio: "16:9",
    },
    [],
    true,
  );
  assert.match(referencedStylePrompt, /Copy it character-for-character/);
  assert.match(referencedStylePrompt, /creates no exception to the immutable style rule/);

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
  assert.match(lockedStylePrompt, /Copy it character-for-character from the user input/);
  assert.match(lockedStylePrompt, /Treat graphic style as external Google Flow configuration, not scene content/);
  assert.match(lockedStylePrompt, /Spend the prompt budget on the other visible parts of the shot/);
  assert.match(lockedStylePrompt, /Do NOT repeat global graphic style, palette, default lighting/);
  assert.match(lockedStylePrompt, /facial expression, head angle, posture, gesture/);
  assert.match(lockedStylePrompt, /foreground element, one middle-ground subject\/object, and one background element/);
  assert.match(lockedStylePrompt, /one continuous, physically possible shot lasting exactly the required boundary duration/);
  assert.match(lockedStylePrompt, /SETTING AND BACKGROUND:/);
  assert.match(lockedStylePrompt, /natural timing: appropriate acceleration and deceleration/);
  assert.match(lockedStylePrompt, /do not force every shot to be slow/);
  assert.match(lockedStylePrompt, /Primary motion must visibly occupy at least 60%/);
  assert.match(lockedStylePrompt, /For 4s: begin the primary motion immediately/);
  assert.match(lockedStylePrompt, /For 8s: anticipation is at most 1.5s/);
  assert.match(lockedStylePrompt, /never slow-motion, floaty, suspended, or dreamlike/);

  const retryPrompt = internals.buildTimelineRetryPrompt(
    batches[0] as TimelineBatch & { index: number },
    batches.length,
    "invalid output",
    1,
  );
  assert.match(retryPrompt, /Primary motion visibly occupies at least 60%/);
  assert.match(retryPrompt, /For 6s, primary motion occupies about 3.5–4.5s/);
  assert.match(retryPrompt, /never stretch a small gesture to fill 8s/);

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

  const continuationBatch = {
    ...plannedBatches[0],
    index: 1,
  } as TimelineBatch & { index: number };
  const continuationScenes: Array<Record<string, unknown>> = continuationBatch.boundaries.map((boundary) => ({
    timeStart: String(boundary.start || ""),
    timeEnd: String(boundary.end || ""),
    ...(boundary.chainRole === "continue" ? {} : { imagePrompt: detailedImagePrompt }),
    videoPrompt: detailedVideoPrompt,
  }));
  assert.doesNotThrow(() => internals.validateBatchResult(
    { scenes: continuationScenes },
    continuationBatch,
  ));
  assert.equal(continuationScenes[1].imagePrompt, "");

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
