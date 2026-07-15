import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { WorkerJobError, WorkerServer } from "./worker-server";

function waitForMessage(
  socket: WebSocket,
  type: string,
  timeoutMs = 1_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

test("handles heartbeat, timeline results, and stop on an isolated port", async () => {
  const server = new WorkerServer(() => {}, {
    port: 0,
    heartbeatIntervalMs: 30,
    connectionTimeoutMs: 500,
    jobTimeoutMs: 1_000,
    jobAckTimeoutMs: 100,
  });
  await server.start();
  const port = server.getListeningPort();
  assert.ok(port);

  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await waitForOpen(socket);
    const pingPromise = waitForMessage(socket, "PING");
    socket.send(
      JSON.stringify({
        type: "REGISTER",
        role: "chat-worker",
        profileTag: "isolated-test",
      workerVersion: "2.18.0",
      }),
    );
    const ping = await pingPromise;
    socket.send(JSON.stringify({ type: "PONG", timestamp: ping.timestamp }));
    assert.equal(server.getStatuses()["chat-worker"].connected, true);

    const jobMessagePromise = waitForMessage(socket, "JOB");
    const resultPromise = server.generateTimeline({
      srtText: "1\n00:00:00,000 --> 00:00:08,000\nHello",
      scriptText: "@hero enters",
      visualBible: {
        style: "locked stickman style",
        palette: "locked black, white, and red accents",
        lighting: "",
        continuityNotes: "locked round heads and single-line limbs",
        aspectRatio: "16:9",
      },
    });
    const job = await jobMessagePromise;
    socket.send(
      JSON.stringify({
        type: "JOB_DONE",
        jobId: job.jobId,
        result: {
          visualBible: {
            style: "cinematic 3D animation",
            palette: "teal and warm gold",
            lighting: "soft directional sunset light",
            continuityNotes: "Keep @HERO in the same blue jacket",
            aspectRatio: "16:9",
          },
          scenes: [
            {
              timeStart: "00:00:00,000",
              timeEnd: "00:00:08,000",
              imagePrompt: "@hero enters a room",
              videoPrompt: "Slow push in",
            },
          ],
        },
      }),
    );
    const result = await resultPromise;
    assert.equal(result.scenes[0].imagePrompt, "@HERO enters a room");
    assert.equal(result.visualBible.style, "locked stickman style");
    assert.equal(result.visualBible.palette, "locked black, white, and red accents");
    assert.equal(result.visualBible.lighting, "soft directional sunset light");
    assert.equal(result.visualBible.continuityNotes, "locked round heads and single-line limbs");

    const secondJobPromise = waitForMessage(socket, "JOB");
    const stoppedResult = server.generateTimeline({
      srtText: "1\n00:00:00,000 --> 00:00:02,000\nHello",
      scriptText: "Stop this job",
      visualBible: {
        style: "",
        palette: "",
        lighting: "",
        continuityNotes: "",
        aspectRatio: "16:9",
      },
    });
    const stoppedAssertion = assert.rejects(stoppedResult, (error: unknown) => {
      assert.ok(error instanceof WorkerJobError);
      assert.equal(error.code, "STOPPED");
      return true;
    });
    const secondJob = await secondJobPromise;
    const stopPromise = waitForMessage(socket, "STOP");
    assert.equal(server.stopActiveJob("chat-worker"), true);
    const stop = await stopPromise;
    assert.equal(stop.jobId, secondJob.jobId);
    socket.send(
      JSON.stringify({
        type: "JOB_ERROR",
        jobId: secondJob.jobId,
        error: "Timeline generation stopped",
        code: "STOPPED",
      }),
    );
    await stoppedAssertion;

    const staleJobMessage = waitForMessage(socket, "JOB");
    const staleResult = server.generateTimeline({
      srtText: "1\n00:00:00,000 --> 00:00:02,000\nHello",
      scriptText: "No worker acknowledgement",
      visualBible: {
        style: "",
        palette: "",
        lighting: "",
        continuityNotes: "",
        aspectRatio: "16:9",
      },
    });
    const staleAssertion = assert.rejects(staleResult, /Reload KC Dev/);
    await staleJobMessage;
    await staleAssertion;
  } finally {
    socket.terminate();
    server.stop();
  }
});

test("routes a Phase 5 image job with bound character references", async () => {
  const server = new WorkerServer(() => {}, {
    port: 0,
    heartbeatIntervalMs: 30,
    connectionTimeoutMs: 500,
    jobTimeoutMs: 1_000,
    jobAckTimeoutMs: 100,
  });
  await server.start();
  const socket = new WebSocket(`ws://127.0.0.1:${server.getListeningPort()}`);
  try {
    await waitForOpen(socket);
    socket.send(JSON.stringify({
      type: "REGISTER",
      role: "flow-worker",
      profileTag: "phase5-test-flow",
      workerVersion: "2.18.0",
    }));
    const registrationDeadline = Date.now() + 500;
    while (
      !server.getStatuses()["flow-worker"].connected &&
      Date.now() < registrationDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(server.getStatuses()["flow-worker"].connected, true);

    const jobMessage = waitForMessage(socket, "JOB");
    const progress: string[] = [];
    const resultPromise = server.runSceneJob(
      {
        sceneId: "scene-007",
        mediaType: "image",
        prompt: "A revised image prompt",
        characterTokens: ["@HERO"],
        visualBible: {
          style: "cinematic 3D",
          palette: "teal and warm gold",
          lighting: "soft sunset",
          continuityNotes: "Keep wardrobe unchanged",
          aspectRatio: "16:9",
        },
        imageSettings: {
          model: "nano-banana-pro",
          aspectRatio: "16:9",
          outputCount: 1,
          expectedCredits: 0,
        },
        sourceImagePath: "",
        sourceFlowAssetKey: "",
        videoSettings: {
          model: "veo-3.1-lite",
          mode: "ingredients",
          aspectRatio: "16:9",
          durationSeconds: 8,
          outputCount: 1,
          expectedCredits: 0,
        },
        refImages: [{
          token: "@HERO",
          name: "Hero",
          mimeType: "image/png",
          imageBase64: "iVBORw0KGgo=",
          localPath: "C:\\FlowX\\hero.png",
        }],
      },
      (event) => progress.push(`${event.sceneId}:${event.status}`),
    );
    const job = await jobMessage;
    assert.equal(job.action, "GENERATE_IMAGE");
    assert.deepEqual(job.payload, {
      sceneId: "scene-007",
      mediaType: "image",
      prompt: "A revised image prompt",
      characterTokens: ["@HERO"],
      visualBible: {
        style: "cinematic 3D",
        palette: "teal and warm gold",
        lighting: "soft sunset",
        continuityNotes: "Keep wardrobe unchanged",
        aspectRatio: "16:9",
      },
      imageSettings: {
        model: "nano-banana-pro",
        aspectRatio: "16:9",
        outputCount: 1,
        expectedCredits: 0,
      },
      sourceImagePath: "",
      sourceFlowAssetKey: "",
      videoSettings: {
        model: "veo-3.1-lite",
        mode: "ingredients",
        aspectRatio: "16:9",
        durationSeconds: 8,
        outputCount: 1,
        expectedCredits: 0,
      },
      refImages: [{
        token: "@HERO",
        name: "Hero",
        mimeType: "image/png",
        imageBase64: "iVBORw0KGgo=",
        localPath: "C:\\FlowX\\hero.png",
      }],
    });
    socket.send(JSON.stringify({
      type: "JOB_PROGRESS",
      jobId: job.jobId,
      status: "generating",
      message: "Generating only scene 7",
    }));
    socket.send(JSON.stringify({
      type: "JOB_DONE",
      jobId: job.jobId,
      result: {
        sceneId: "scene-007",
        mediaType: "image",
        resultPath: "mock://phase4/image/scene-007/test",
        flowAssetKey: "path:https://flow.google/assets/scene-007",
      },
    }));

    const result = await resultPromise;
    assert.equal(result.sceneId, "scene-007");
    assert.equal(result.resultPath, "mock://phase4/image/scene-007/test");
    assert.equal(result.flowAssetKey, "path:https://flow.google/assets/scene-007");
    assert.deepEqual(progress, [
      "scene-007:queued",
      "scene-007:generating",
    ]);

    const videoJobMessage = waitForMessage(socket, "JOB");
    const videoResultPromise = server.runSceneJob({
      sceneId: "scene-007",
      mediaType: "video",
      prompt: "The hero turns toward the window as the camera tracks forward",
      characterTokens: [],
      visualBible: {
        style: "cinematic 3D",
        palette: "teal and warm gold",
        lighting: "soft sunset",
        continuityNotes: "Keep wardrobe unchanged",
        aspectRatio: "16:9",
      },
      imageSettings: {
        model: "nano-banana-pro",
        aspectRatio: "16:9",
        outputCount: 1,
        expectedCredits: 0,
      },
      sourceImagePath: "C:\\FlowX\\scene-007.png",
      sourceFlowAssetKey: "path:https://flow.google/assets/scene-007",
      videoSettings: {
        model: "veo-3.1-lite",
        mode: "ingredients",
        aspectRatio: "16:9",
        durationSeconds: 8,
        outputCount: 1,
        expectedCredits: 0,
      },
      refImages: [],
    }, () => {});
    const videoJob = await videoJobMessage;
    assert.equal(videoJob.action, "GENERATE_VIDEO");
    const videoPayload = videoJob.payload as Record<string, any>;
    assert.equal(videoPayload.sourceImagePath, "C:\\FlowX\\scene-007.png");
    assert.equal(videoPayload.sourceFlowAssetKey, "path:https://flow.google/assets/scene-007");
    assert.equal(videoPayload.videoSettings.model, "veo-3.1-lite");
    socket.send(JSON.stringify({
      type: "JOB_DONE",
      jobId: videoJob.jobId,
      result: {
        sceneId: "scene-007",
        mediaType: "video",
        resultPath: "C:\\FlowX\\scene-007.mp4",
        flowAssetKey: "",
      },
    }));
    const videoResult = await videoResultPromise;
    assert.equal(videoResult.resultPath, "C:\\FlowX\\scene-007.mp4");
  } finally {
    socket.terminate();
    server.stop();
  }
});
