import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CharacterStore } from "./character-store";
import { ProjectDatabase } from "./project-database";
import { ProjectRepositories } from "./project-repositories";
import { ProductionQueue } from "./production-queue";
import { syncTimelineSessionToProject } from "./production-session-sync";
import { TimelineSessionStore } from "./timeline-session-store";
import { WorkerJobError } from "./worker-server";
import { DEFAULT_PROJECT_ID } from "../shared/production-queue";
import type { BoundSceneJobInput, SceneJobProgress } from "../shared/scene-job";
import type { TimelineSessionInput } from "../shared/timeline";
import type { WorkerConnectionStatus } from "../shared/worker-status";

function timeline(sceneCount = 2): TimelineSessionInput {
  return {
    visualBible: {
      style: "Stickman, flat 2D illustration",
      palette: "Black, white and muted blue",
      lighting: "Soft daylight",
      continuityNotes: "Keep every character and location consistent",
      aspectRatio: "16:9",
    },
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      id: `scene-${String(index + 1).padStart(3, "0")}`,
      order: index + 1,
      timeStart: `00:00:${String(index * 8).padStart(2, "0")},000`,
      timeEnd: `00:00:${String((index + 1) * 8).padStart(2, "0")},000`,
      imagePrompt: `Image prompt ${index + 1}`,
      imageStatus: "pending" as const,
      imageResultPath: "",
      imageFlowAssetKey: "",
      imageApproved: false,
      videoPrompt: `Video prompt ${index + 1}`,
      videoStatus: "pending" as const,
      videoResultPath: "",
      videoApproved: false,
      usedCharacterTokens: [],
      characterPolicy: "none" as const,
      assignedCharacterTokens: [],
      chainId: null,
      chainRole: "single" as const,
      durationSeconds: 8 as const,
    })),
  };
}

function statuses(connected: boolean) {
  const status = (role: "chat-worker" | "flow-worker"): WorkerConnectionStatus => ({
    role,
    connected: role === "flow-worker" ? connected : false,
    profileTag: connected ? "queue-test" : null,
    connectedAt: connected ? new Date().toISOString() : null,
  });
  return { "chat-worker": status("chat-worker"), "flow-worker": status("flow-worker") };
}

class FakeQueueWorker {
  readonly calls: string[] = [];
  readonly inputs: BoundSceneJobInput[] = [];
  failFirstSceneOnce = false;
  connected = true;
  resultDirectory = "C:\\FlowX";
  persistResults = false;

  getStatuses() {
    return statuses(this.connected);
  }

  stopActiveJob(): boolean {
    return false;
  }

  async runSceneJob(
    input: BoundSceneJobInput,
    onProgress: (progress: SceneJobProgress) => void = () => {},
  ) {
    this.calls.push(`${input.sceneId}:${input.mediaType}`);
    this.inputs.push(input);
    onProgress({
      jobId: `fake-${this.calls.length}`,
      sceneId: input.sceneId,
      mediaType: input.mediaType,
      status: "generating",
    });
    if (
      this.failFirstSceneOnce &&
      input.sceneId === "scene-001" &&
      this.calls.filter((call) => call === "scene-001:image").length === 1
    ) {
      throw new WorkerJobError("Flow DOM element not found", "FLOW_UI_CHANGED", true);
    }
    const resultPath = join(this.resultDirectory, `${input.sceneId}.${input.mediaType === "image" ? "png" : "mp4"}`);
    if (this.persistResults) await writeFile(resultPath, `fake-${input.mediaType}`);
    return {
      sceneId: input.sceneId,
      mediaType: input.mediaType,
      resultPath,
      flowAssetKey: input.mediaType === "image" ? `asset:${input.sceneId}` : "",
    };
  }
}

class StuckQueueWorker extends FakeQueueWorker {
  private rejectActive: ((error: Error) => void) | null = null;

  override runSceneJob(
    input: BoundSceneJobInput,
    _onProgress: (progress: SceneJobProgress) => void = () => {},
  ): Promise<never> {
    this.calls.push(`${input.sceneId}:${input.mediaType}`);
    return new Promise((_resolve, reject) => {
      this.rejectActive = reject;
    });
  }

  override stopActiveJob(): boolean {
    if (!this.rejectActive) return false;
    const reject = this.rejectActive;
    this.rejectActive = null;
    reject(new WorkerJobError("Worker stopped after heartbeat timeout", "STOPPED"));
    return true;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for queue state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flowx-production-queue-"));
  const database = new ProjectDatabase(join(directory, "flowx.sqlite"));
  const sessionStore = new TimelineSessionStore(join(directory, "timeline"));
  const characterStore = new CharacterStore(join(directory, "characters"));
  await Promise.all([database.initialize(), sessionStore.initialize(), characterStore.initialize()]);
  await sessionStore.save(timeline());
  return { directory, database, sessionStore, characterStore };
}

test("syncs Beat & Chain planning metadata from the saved timeline into SQLite", async () => {
  const context = await fixture();
  try {
    const original = await context.sessionStore.load();
    assert.ok(original);
    const planned = await context.sessionStore.save({
      ...original,
      scenes: original.scenes.map((scene, index) => index === 0
        ? {
            ...scene,
            timeEnd: "00:00:06,000",
            durationSeconds: 6,
            chainId: "walk-cycle",
            chainRole: "start",
          }
        : {
            ...scene,
            timeStart: "00:00:06,000",
            timeEnd: "00:00:10,000",
            durationSeconds: 4,
            chainId: "walk-cycle",
            chainRole: "continue",
          }),
    });
    syncTimelineSessionToProject(context.database, planned, []);
    const stored = new ProjectRepositories(context.database).scenes.listByProject(DEFAULT_PROJECT_ID);
    assert.deepEqual(stored.map((scene) => ({
      durationSeconds: scene.durationSeconds,
      chainId: scene.chainId,
      chainRole: scene.chainRole,
      timeStart: scene.timeStart,
      timeEnd: scene.timeEnd,
    })), [
      { durationSeconds: 6, chainId: "walk-cycle", chainRole: "start", timeStart: "00:00:00,000", timeEnd: "00:00:06,000" },
      { durationSeconds: 4, chainId: "walk-cycle", chainRole: "continue", timeStart: "00:00:06,000", timeEnd: "00:00:10,000" },
    ]);
  } finally {
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("runs a continuation chain through video, last-frame extraction, and Frames mode", async () => {
  const context = await fixture();
  const worker = new FakeQueueWorker();
  worker.resultDirectory = context.directory;
  worker.persistResults = true;
  const original = await context.sessionStore.load();
  assert.ok(original);
  await context.sessionStore.save({
    ...original,
    scenes: original.scenes.map((scene, index) => ({
      ...scene,
      timeStart: index === 0 ? "00:00:00,000" : "00:00:06,000",
      timeEnd: index === 0 ? "00:00:06,000" : "00:00:10,000",
      chainId: "chain-a",
      chainRole: index === 0 ? "start" as const : "continue" as const,
      durationSeconds: index === 0 ? 6 as const : 4 as const,
    })),
  });
  const queue = new ProductionQueue(
    context.database,
    worker,
    context.characterStore,
    context.sessionStore,
    () => {},
    {
      retryBackoffMs: [5],
      extractLastFrame: async (_videoPath, outputPath) => {
        await writeFile(outputPath, "fake-png-frame");
      },
    },
  );
  try {
    await queue.start();
    queue.setApprovalPolicy(true, false, DEFAULT_PROJECT_ID);
    await queue.generateAllImages(DEFAULT_PROJECT_ID);
    await waitFor(() => queue.getSnapshot().state === "idle");

    assert.deepEqual(worker.calls, [
      "scene-001:image",
      "scene-001:video",
      "scene-002:image",
      "scene-002:video",
    ]);
    const firstVideo = worker.inputs.find((input) =>
      input.sceneId === "scene-001" && input.mediaType === "video");
    const continuedImage = worker.inputs.find((input) =>
      input.sceneId === "scene-002" && input.mediaType === "image");
    const continuedVideo = worker.inputs.find((input) =>
      input.sceneId === "scene-002" && input.mediaType === "video");
    assert.equal(firstVideo?.videoSettings.mode, "ingredients");
    assert.equal(firstVideo?.videoSettings.durationSeconds, 6);
    assert.ok(continuedImage?.refImages.some((reference) => reference.token === "@CHAIN_START_FRAME"));
    assert.ok(continuedImage?.refImages.some((reference) => reference.token === "@STYLE_ANCHOR_1"));
    assert.equal(continuedVideo?.videoSettings.mode, "frames");
    assert.equal(continuedVideo?.videoSettings.durationSeconds, 4);
    assert.match(continuedVideo?.startFramePath || "", /-last-frame\.png$/);

    const extractJob = context.database.db.prepare(
      "SELECT status FROM jobs WHERE job_type = 'extract_last_frame'",
    ).get() as { status: string };
    assert.equal(extractJob.status, "succeeded");
  } finally {
    queue.shutdown();
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("rebuilds a clean automatic pipeline after an older image-only queue was stopped", async () => {
  const context = await fixture();
  const worker = new FakeQueueWorker();
  syncTimelineSessionToProject(context.database, (await context.sessionStore.load())!, []);
  const repositories = new ProjectRepositories(context.database);
  const [first, second] = repositories.scenes.listByProject(DEFAULT_PROJECT_ID);
  const firstQueued = repositories.scenes.transition({
    sceneId: first.id,
    to: "image_queued",
    jobType: "image_generation",
    payloadHash: "old-first-image",
  });
  repositories.jobs.updateStatus(firstQueued.job.id, "running", { attempts: 1 });
  repositories.scenes.updateState({ sceneId: first.id, to: "image_generating" });
  repositories.jobs.updateStatus(firstQueued.job.id, "succeeded");
  repositories.scenes.updateState({
    sceneId: first.id,
    to: "image_done",
    imageAssetPath: "C:\\FlowX\\scene-001.png",
    flowImageAssetId: "asset:scene-001",
  });
  const staleSecond = repositories.scenes.transition({
    sceneId: second.id,
    to: "image_queued",
    jobType: "image_generation",
    payloadHash: "stale-second-image",
  });
  const queue = new ProductionQueue(
    context.database,
    worker,
    context.characterStore,
    context.sessionStore,
    () => {},
    { retryBackoffMs: [5] },
  );
  try {
    queue.setApprovalPolicy(true, false, DEFAULT_PROJECT_ID);
    await queue.generateAllImages(DEFAULT_PROJECT_ID);
    await waitFor(() => queue.getSnapshot().state === "idle");

    assert.equal(repositories.jobs.get(staleSecond.job.id), null);
    assert.deepEqual(worker.calls, [
      "scene-001:image",
      "scene-001:video",
      "scene-002:image",
      "scene-002:video",
    ]);
    assert.equal(queue.getSnapshot().queuedJobs, 0);
  } finally {
    queue.shutdown();
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("runs scenes sequentially, retries with backoff, and auto-enqueues approved videos", async () => {
  const context = await fixture();
  const worker = new FakeQueueWorker();
  worker.failFirstSceneOnce = true;
  const queue = new ProductionQueue(
    context.database,
    worker,
    context.characterStore,
    context.sessionStore,
    () => {},
    { retryBackoffMs: [30, 60, 90], watchdogIntervalMs: 20, heartbeatTimeoutMs: 500 },
  );
  try {
    await queue.start();
    await queue.generateAllImages(DEFAULT_PROJECT_ID);
    await waitFor(() => queue.getSnapshot().state === "idle");

    assert.deepEqual(worker.calls, [
      "scene-001:image",
      "scene-002:image",
      "scene-001:image",
    ]);
    const firstPass = queue.getSnapshot();
    assert.equal(firstPass.errors.length, 0);
    assert.ok(firstPass.scenes.every((scene) => scene.status === "image_done"));
    const firstJob = firstPass.jobs.find((job) => job.sceneId === "scene-001");
    assert.equal(firstJob?.attempts, 2);

    queue.setApprovalPolicy(true, false, DEFAULT_PROJECT_ID);
    await queue.regenerateScene("scene-001", "image", DEFAULT_PROJECT_ID);
    await waitFor(() => queue.getSnapshot().state === "idle");
    assert.deepEqual(worker.calls.slice(-2), ["scene-001:image", "scene-001:video"]);
    const autoApproved = queue.getSnapshot().scenes[0];
    assert.equal(autoApproved.approvedImage, true);
    assert.equal(autoApproved.status, "video_done");
    const imageJob = queue.getSnapshot().jobs.filter((job) =>
      job.sceneId === "scene-001" && job.mediaType === "image").at(-1)!;
    const videoJob = queue.getSnapshot().jobs.filter((job) =>
      job.sceneId === "scene-001" && job.mediaType === "video").at(-1)!;
    assert.equal(videoJob.dependsOn, imageJob.id);
  } finally {
    queue.shutdown();
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("does not dequeue a dependent job before its parent succeeds", async () => {
  const context = await fixture();
  try {
    const session = await context.sessionStore.load();
    assert.ok(session);
    syncTimelineSessionToProject(context.database, session, []);
    const repositories = new ProjectRepositories(context.database);
    const scene = repositories.scenes.listByProject(DEFAULT_PROJECT_ID)[0];
    const createdAt = new Date().toISOString();
    const parent = repositories.jobs.create({
      id: "parent-job",
      projectId: DEFAULT_PROJECT_ID,
      sceneId: scene.id,
      jobType: "image_generation",
      status: "running",
      dependsOn: null,
      attempts: 1,
      maxAttempts: 3,
      lastHeartbeatAt: createdAt,
      lastError: null,
      payloadHash: "parent",
      createdAt,
      updatedAt: createdAt,
    });
    repositories.jobs.create({
      id: "child-job",
      projectId: DEFAULT_PROJECT_ID,
      sceneId: scene.id,
      jobType: "video_generation",
      status: "queued",
      dependsOn: parent.id,
      attempts: 0,
      maxAttempts: 3,
      lastHeartbeatAt: null,
      lastError: null,
      payloadHash: "child",
      createdAt,
      updatedAt: createdAt,
    });
    assert.equal(repositories.jobs.nextRunnable(DEFAULT_PROJECT_ID), null);
    repositories.jobs.updateStatus(parent.id, "succeeded");
    assert.equal(repositories.jobs.nextRunnable(DEFAULT_PROJECT_ID)?.id, "child-job");
  } finally {
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("marks a job stuck without heartbeat as timeout_no_response", async () => {
  const context = await fixture();
  const worker = new StuckQueueWorker();
  const queue = new ProductionQueue(
    context.database,
    worker,
    context.characterStore,
    context.sessionStore,
    () => {},
    {
      maxAttempts: 1,
      heartbeatTimeoutMs: 25,
      watchdogIntervalMs: 5,
      retryBackoffMs: [5],
    },
  );
  try {
    await queue.start();
    await queue.generateAllImages(DEFAULT_PROJECT_ID, {
      onlyStatuses: ["prompt_ready"],
    });
    await waitFor(() => queue.getSnapshot().errors.length > 0);
    const error = queue.getSnapshot().errors[0];
    assert.equal(error.category, "timeout_no_response");
    assert.equal(error.attempts, 1);
    assert.equal(error.retryable, false);
  } finally {
    queue.shutdown();
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("manual media completion supersedes an older queued job before approve or reject", async () => {
  const context = await fixture();
  const original = await context.sessionStore.load();
  assert.ok(original);
  syncTimelineSessionToProject(context.database, original, []);
  const repositories = new ProjectRepositories(context.database);
  const scene = repositories.scenes.listByProject(DEFAULT_PROJECT_ID)[0];
  const queued = repositories.scenes.transition({
    sceneId: scene.id,
    to: "image_queued",
    jobType: "image_generation",
    payloadHash: "older-queued-job",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await context.sessionStore.save({
    ...original,
    scenes: original.scenes.map((item, index) => index === 0 ? {
      ...item,
      imageStatus: "pending",
      imageResultPath: "C:\\FlowX\\scene-001-manual.png",
      imageFlowAssetKey: "manual:scene-001",
    } : item),
  });

  const worker = new FakeQueueWorker();
  worker.connected = false;
  const queue = new ProductionQueue(
    context.database,
    worker,
    context.characterStore,
    context.sessionStore,
  );
  try {
    await queue.start();
    const approved = await queue.approveScene("scene-001", "image", DEFAULT_PROJECT_ID);
    assert.equal(repositories.jobs.get(queued.job.id)?.status, "succeeded");
    assert.equal(approved.scenes[0].status, "image_approved");
    assert.equal(approved.scenes[0].approvedImage, true);

    const rejected = await queue.rejectScene("scene-001", "image", DEFAULT_PROJECT_ID);
    assert.equal(rejected.scenes[0].status, "needs_review");
    assert.equal(rejected.scenes[0].approvedImage, false);
  } finally {
    queue.shutdown();
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("recovers a running job after reopening without creating a duplicate", async () => {
  const context = await fixture();
  const session = await context.sessionStore.load();
  assert.ok(session);
  syncTimelineSessionToProject(context.database, session, []);
  let repositories = new ProjectRepositories(context.database);
  const scene = repositories.scenes.listByProject(DEFAULT_PROJECT_ID)[0];
  const queued = repositories.scenes.transition({
    sceneId: scene.id,
    to: "image_queued",
    jobType: "image_generation",
    payloadHash: "crash-test",
  });
  repositories.jobs.updateStatus(queued.job.id, "running", {
    attempts: 1,
    heartbeatAt: new Date().toISOString(),
  });
  repositories.scenes.updateState({ sceneId: scene.id, to: "image_generating" });
  context.database.close();

  const reopened = new ProjectDatabase(join(context.directory, "flowx.sqlite"));
  await reopened.initialize();
  const worker = new FakeQueueWorker();
  worker.connected = false;
  const queue = new ProductionQueue(
    reopened,
    worker,
    context.characterStore,
    context.sessionStore,
    () => {},
    { disconnectedPollMs: 50, watchdogIntervalMs: 20 },
  );
  try {
    await queue.start();
    repositories = new ProjectRepositories(reopened);
    assert.equal(repositories.jobs.get(queued.job.id)?.status, "queued");
    assert.equal(repositories.scenes.get(scene.id)?.status, "image_queued");
    await queue.generateAllImages(DEFAULT_PROJECT_ID);
    assert.equal(
      repositories.jobs.listByScene(scene.id).filter((job) => job.jobType === "image_generation").length,
      1,
    );
    assert.equal(queue.pauseQueue().state, "paused");
    assert.equal(queue.resumeQueue().state, "running");
    assert.equal(queue.stopQueue().state, "stopped");
  } finally {
    queue.shutdown();
    reopened.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("persists an explicit stop so reopening does not auto-resume queued work", async () => {
  const context = await fixture();
  const firstWorker = new FakeQueueWorker();
  firstWorker.connected = false;
  const firstQueue = new ProductionQueue(
    context.database,
    firstWorker,
    context.characterStore,
    context.sessionStore,
    () => {},
    { disconnectedPollMs: 20 },
  );
  await firstQueue.start();
  await firstQueue.generateAllImages(DEFAULT_PROJECT_ID);
  assert.equal(firstQueue.stopQueue().state, "stopped");
  firstQueue.shutdown();
  context.database.close();

  const reopened = new ProjectDatabase(join(context.directory, "flowx.sqlite"));
  await reopened.initialize();
  const secondWorker = new FakeQueueWorker();
  const secondQueue = new ProductionQueue(
    reopened,
    secondWorker,
    context.characterStore,
    context.sessionStore,
    () => {},
    { disconnectedPollMs: 20 },
  );
  try {
    await secondQueue.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(secondQueue.getSnapshot().state, "stopped");
    assert.equal(secondQueue.getSnapshot().queuedJobs, 2);
    assert.deepEqual(secondWorker.calls, []);
  } finally {
    secondQueue.shutdown();
    reopened.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("regenerate only one scene does not wake other stopped jobs and may chain its own video", async () => {
  const context = await fixture();
  const worker = new FakeQueueWorker();
  worker.connected = false;
  const queue = new ProductionQueue(
    context.database,
    worker,
    context.characterStore,
    context.sessionStore,
    () => {},
    { disconnectedPollMs: 10 },
  );
  try {
    await queue.start();
    await queue.generateAllImages(DEFAULT_PROJECT_ID);
    queue.stopQueue();
    worker.connected = true;

    await queue.regenerateScene("scene-002", "image", DEFAULT_PROJECT_ID);
    await waitFor(() => queue.getSnapshot().state === "stopped");
    assert.deepEqual(worker.calls, ["scene-002:image"]);
    assert.equal(queue.getSnapshot().queuedJobs, 1);

    queue.setApprovalPolicy(true, false, DEFAULT_PROJECT_ID);
    await queue.regenerateScene("scene-001", "image", DEFAULT_PROJECT_ID);
    await waitFor(() => worker.calls.includes("scene-001:video"));
    await waitFor(() => queue.getSnapshot().state === "stopped");
    assert.deepEqual(worker.calls, [
      "scene-002:image",
      "scene-001:image",
      "scene-001:video",
    ]);
  } finally {
    queue.shutdown();
    context.database.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});
