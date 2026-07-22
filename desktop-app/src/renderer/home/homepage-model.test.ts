import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionQueueSnapshot } from "../../shared/production-queue";
import { DEFAULT_TIMELINE_WORKFLOW_SOURCE, DEFAULT_VISUAL_BIBLE, type Scene, type TimelineSession } from "../../shared/timeline";
import { DEFAULT_SCREENPLAY_PROJECT } from "../../shared/screenplay";
import { deriveHomepageState, nearestScenes, productionControls, productionSummary, setupSteps, sourceReady } from "./homepage-model";

function scene(order: number, video = false): Scene {
  const start = (order - 1) * 8;
  return {
    id: `scene-${String(order).padStart(3, "0")}`,
    order,
    timeStart: `00:00:${String(start).padStart(2, "0")},000`,
    timeEnd: `00:00:${String(start + 8).padStart(2, "0")},000`,
    imagePrompt: "Visible action",
    imageStatus: "done",
    imageResultPath: `image-${order}.png`,
    imageFlowAssetKey: "",
    imageApproved: true,
    videoPrompt: "Animate action",
    videoStatus: video ? "done" : "pending",
    videoResultPath: video ? `video-${order}.mp4` : "",
    videoApproved: video,
    usedCharacterTokens: [],
    characterPolicy: "none",
    assignedCharacterTokens: [],
    chainId: null,
    chainRole: "single",
    durationSeconds: 8,
  };
}

function session(scenes: Scene[] = []): TimelineSession {
  return {
    id: "session-home-test",
    name: "Homepage test",
    createdAt: "2026-07-20T00:00:00.000Z",
    savedAt: "2026-07-20T01:00:00.000Z",
    scenes,
    visualBible: { ...DEFAULT_VISUAL_BIBLE },
    styleReference: null,
    workflowMode: "automatic",
    workflowSource: { ...DEFAULT_TIMELINE_WORKFLOW_SOURCE },
    productionKind: "narrated",
    screenplay: structuredClone(DEFAULT_SCREENPLAY_PROJECT),
  };
}

function queue(overrides: Partial<ProductionQueueSnapshot> = {}): ProductionQueueSnapshot {
  return {
    projectId: "session-home-test",
    state: "idle",
    activeJobId: "",
    activeSceneId: "",
    activeMediaType: null,
    queuedJobs: 0,
    autoApproveImages: true,
    autoApproveVideos: true,
    scenes: [],
    jobs: [],
    errors: [],
    ...overrides,
  };
}

test("homepage selects exactly one state from real session readiness", () => {
  const empty = session();
  assert.equal(deriveHomepageState(empty, null), "new-session");
  assert.equal(deriveHomepageState(empty, "full_auto"), "setup-in-progress");
  assert.equal(deriveHomepageState(session([scene(1)]), "full_auto"), "production-dashboard");
});

test("voice and SRT modes use different real source requirements", () => {
  const value = session();
  value.workflowSource.narrationText = "Nội dung thoại";
  value.workflowSource.voiceName = "vi-VN-HoaiMyNeural";
  assert.equal(sourceReady(value, "full_auto"), true);
  assert.equal(sourceReady(value, "srt_script"), false);
  value.workflowSource.srtText = "1\n00:00:00,000 --> 00:00:08,000\nTest";
  value.workflowSource.scriptText = "Test";
  assert.equal(sourceReady(value, "srt_script"), true);
});

test("screenplay mode is ready only after an approved shot plan exists", () => {
  const value = session();
  value.productionKind = "screenplay";
  value.screenplay = {
    ...structuredClone(DEFAULT_SCREENPLAY_PROJECT),
    parseStatus: "approved",
    shots: [{ id: "shot-001", order: 1, heading: "CẢNH 1", location: "Phòng", timeOfDay: "Đêm", action: "An mở cửa.", dialogueCues: [], ambience: "Mưa", soundEffects: ["Cửa mở"], durationSeconds: 4, approved: true }],
  };
  assert.equal(sourceReady(value, "screenplay_film"), true);
  assert.equal(setupSteps(value, "screenplay_film", false)[0].title, "Kịch bản hình");
});

test("setup CTA order follows source, characters, visual bible, then start", () => {
  const value = session();
  let steps = setupSteps(value, "full_auto", false);
  assert.equal(steps.find((item) => item.status === "in-progress")?.id, "source");
  value.workflowSource.narrationText = "Nội dung";
  value.workflowSource.voiceName = "vi-VN-HoaiMyNeural";
  steps = setupSteps(value, "full_auto", false);
  assert.equal(steps.find((item) => item.status === "in-progress")?.id, "characters");
  steps = setupSteps(value, "full_auto", true);
  assert.equal(steps.find((item) => item.status === "in-progress")?.id, "visual-bible");
  value.visualBible.style = "Đồ họa người que";
  steps = setupSteps(value, "full_auto", true);
  assert.equal(steps.find((item) => item.status === "in-progress")?.id, "start");
});

test("production progress is based on completed scene video paths", () => {
  const value = session([scene(1, true), scene(2, false)]);
  const summary = productionSummary(value, queue());
  assert.equal(summary.completedVideos, 1);
  assert.equal(summary.totalScenes, 2);
  assert.equal(summary.progressPercent, 50);
  assert.equal(summary.status, "ready");
});

test("queue errors render only when real errors exist and retry honors retryable", () => {
  const value = session([scene(1)]);
  const empty = productionSummary(value, queue());
  assert.equal(empty.errorJobs, 0);
  assert.equal(empty.retryableErrors.length, 0);
  const failed = productionSummary(value, queue({ errors: [{ jobId: "job-1", sceneId: "scene-001", orderIndex: 0, mediaType: "video", category: "flow_policy_violation", message: "Policy", attempts: 1, maxAttempts: 3, retryable: false, updatedAt: "2026-07-20T02:00:00.000Z" }] }));
  assert.equal(failed.status, "error");
  assert.equal(failed.errorJobs, 1);
  assert.equal(failed.retryableErrors.length, 0);
});

test("production controls enable only for matching runtime states", () => {
  const value = session([scene(1)]);
  const ready = productionSummary(value, queue());
  assert.deepEqual(productionControls(ready, true, 0), { start: true, pause: false, resume: false, stop: false, retry: false, capCut: false });
  const running = productionSummary(value, queue({ state: "running", activeJobId: "job-1", activeSceneId: "scene-001", activeMediaType: "video", jobs: [{ id: "job-1", sceneId: "scene-001", jobType: "generate_video", mediaType: "video", status: "running", dependsOn: "", attempts: 1, maxAttempts: 3 }] }));
  assert.equal(productionControls(running, true, 0).pause, true);
  assert.equal(productionControls(running, true, 0).stop, true);
  assert.equal(productionControls(running, true, 0).start, false);
  const paused = productionSummary(value, queue({ state: "paused" }));
  assert.equal(productionControls(paused, true, 0).resume, true);
});

test("CapCut is enabled only at 100 percent with validated output files", () => {
  const value = session([scene(1, true), scene(2, true)]);
  const complete = productionSummary(value, queue());
  assert.equal(productionControls(complete, true, 1).capCut, false);
  assert.equal(productionControls(complete, true, 2).capCut, true);
});

test("compact timeline returns only nearby scenes", () => {
  const scenes = Array.from({ length: 12 }, (_, index) => scene(index + 1));
  const visible = nearestScenes(session(scenes), "scene-008", 3);
  assert.equal(visible.length, 7);
  assert.equal(visible[3].id, "scene-008");
});
