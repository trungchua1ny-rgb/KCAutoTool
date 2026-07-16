import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import {
  normalizeTimelineResult,
  validateGeneratedVisualBible,
  validateTimelineCoverage,
  type JobProgressStatus,
  type PolicyPromptRewriteInput,
  type PolicyPromptRewriteResult,
  type TimelineGenerateInput,
  type TimelineProgress,
  type TimelineResult,
} from "../shared/timeline";
import {
  normalizeSceneJobResult,
  type BoundSceneJobInput,
  type SceneJobProgress,
  type SceneJobResult,
} from "../shared/scene-job";
import {
  createDisconnectedStatuses,
  WORKER_ROLES,
  type WorkerRole,
  type WorkerStatuses,
} from "../shared/worker-status";

export const WORKER_SERVER_HOST = "127.0.0.1";
export const WORKER_SERVER_PORT = 17890;

const REGISTER_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const CONNECTION_TIMEOUT_MS = 45_000;
// Phase 5 sends reference images as base64. Four 10 MB library images plus
// JSON/base64 overhead fit below this local-only WebSocket limit.
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const JOB_TIMEOUT_MS = 90 * 60 * 1_000;
const JOB_ACK_TIMEOUT_MS = 12_000;

interface WorkerServerOptions {
  host?: string;
  port?: number;
  registerTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  connectionTimeoutMs?: number;
  jobTimeoutMs?: number;
  jobAckTimeoutMs?: number;
}

interface ClientState {
  socket: WebSocket;
  role: WorkerRole | null;
  profileTag: string | null;
  workerVersion: string | null;
  connectedAt: string | null;
  lastSeenAt: number;
  registrationTimer: NodeJS.Timeout;
}

interface RegisterMessage {
  type: "REGISTER";
  role: WorkerRole;
  profileTag: string;
  workerVersion: string | null;
}

interface PendingJob {
  id: string;
  role: WorkerRole;
  action: "GENERATE_TIMELINE" | "REWRITE_POLICY_PROMPT" | "GENERATE_IMAGE" | "GENERATE_VIDEO";
  client: ClientState;
  input: TimelineGenerateInput | PolicyPromptRewriteInput | BoundSceneJobInput;
  timer: NodeJS.Timeout;
  ackTimer: NodeJS.Timeout;
  onProgress: (progress: any) => void;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

export class WorkerJobError extends Error {
  constructor(
    message: string,
    readonly code = "INTERNAL_ERROR",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "WorkerJobError";
  }
}

function isWorkerRole(value: unknown): value is WorkerRole {
  return WORKER_ROLES.includes(value as WorkerRole);
}

function workerVersionNumber(value: string | null): number {
  if (!value) return 0;
  const parts = value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return (parts[0] || 0) * 1_000_000 + (parts[1] || 0) * 1_000 + (parts[2] || 0);
}

function supportsTimelineWorker(value: string | null): boolean {
  return workerVersionNumber(value) >= 2_021_000;
}

function supportsSceneJobs(value: string | null): boolean {
  return workerVersionNumber(value) >= 2_021_000;
}

function supportsPolicyPromptRewrite(value: string | null): boolean {
  return workerVersionNumber(value) >= 2_032_000;
}

function supportsSingleNativeVideoDownload(value: string | null): boolean {
  return workerVersionNumber(value) >= 2_042_000;
}

function normalizePolicyPromptRewriteResult(
  value: unknown,
  input: PolicyPromptRewriteInput,
): PolicyPromptRewriteResult {
  if (!value || typeof value !== "object") {
    throw new Error("ChatGPT không trả về prompt thay thế hợp lệ");
  }
  const prompt = typeof (value as Record<string, unknown>).prompt === "string"
    ? String((value as Record<string, unknown>).prompt).trim()
    : "";
  const wordCount = prompt ? prompt.split(/\s+/).length : 0;
  const requiredSections = input.mediaType === "image"
    ? ["SUBJECT AND ACTION:", "EMOTION AND BODY LANGUAGE:", "SETTING AND BACKGROUND:", "DEPTH LAYERS:", "CAMERA AND COMPOSITION:"]
    : ["STARTING STATE:", "PRIMARY MOTION:", "REACTION:", "ENVIRONMENTAL MOTION:", "CAMERA MOTION:", "END FRAME:"];
  if (
    wordCount < 50 ||
    wordCount > 180 ||
    requiredSections.some((section) => !prompt.toUpperCase().includes(section))
  ) {
    throw new Error("Prompt ChatGPT sửa lại không đạt cấu trúc hoặc độ dài yêu cầu");
  }
  return { prompt };
}

function parseRegisterMessage(value: unknown): RegisterMessage | null {
  if (!value || typeof value !== "object") return null;

  const message = value as Record<string, unknown>;
  if (
    message.type !== "REGISTER" ||
    !isWorkerRole(message.role) ||
    typeof message.profileTag !== "string"
  ) {
    return null;
  }

  const profileTag = message.profileTag.trim();
  if (!profileTag || profileTag.length > 80) return null;
  const workerVersion =
    typeof message.workerVersion === "string"
      ? message.workerVersion.trim().slice(0, 20)
      : null;

  return {
    type: "REGISTER",
    role: message.role,
    profileTag,
    workerVersion,
  };
}

export class WorkerServer {
  private server: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly clients = new Set<ClientState>();
  private readonly clientsByRole = new Map<WorkerRole, ClientState>();
  private readonly statuses = createDisconnectedStatuses();
  private readonly pendingJobs = new Map<string, PendingJob>();
  private readonly activeJobsByRole = new Map<WorkerRole, PendingJob>();
  private readonly options: Required<WorkerServerOptions>;

  constructor(
    private readonly onStatusChange: (statuses: WorkerStatuses) => void,
    options: WorkerServerOptions = {},
  ) {
    this.options = {
      host: options.host ?? WORKER_SERVER_HOST,
      port: options.port ?? WORKER_SERVER_PORT,
      registerTimeoutMs: options.registerTimeoutMs ?? REGISTER_TIMEOUT_MS,
      heartbeatIntervalMs:
        options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      connectionTimeoutMs:
        options.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS,
      jobTimeoutMs: options.jobTimeoutMs ?? JOB_TIMEOUT_MS,
      jobAckTimeoutMs: options.jobAckTimeoutMs ?? JOB_ACK_TIMEOUT_MS,
    };
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.options.host,
        port: this.options.port,
        maxPayload: MAX_MESSAGE_BYTES,
      });

      const handleStartupError = (error: Error) => {
        server.removeListener("listening", handleListening);
        this.server = null;
        reject(error);
      };
      const handleListening = () => {
        server.removeListener("error", handleStartupError);
        this.server = server;
        this.heartbeatTimer = setInterval(
          () => this.runHeartbeat(),
          this.options.heartbeatIntervalMs,
        );
        resolve();
      };

      server.once("error", handleStartupError);
      server.once("listening", handleListening);
      server.on("connection", (socket) => this.handleConnection(socket));
      server.on("error", (error) => {
        console.error("[KC Auto Tool] WebSocket server error:", error);
      });
    });
  }

  getStatuses(): WorkerStatuses {
    return structuredClone(this.statuses);
  }

  getListeningPort(): number | null {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  generateTimeline(
    input: TimelineGenerateInput,
    onProgress: (progress: TimelineProgress) => void = () => {},
  ): Promise<TimelineResult> {
    return this.dispatchTimelineJob(input, onProgress);
  }

  rewritePolicyPrompt(
    input: PolicyPromptRewriteInput,
    onProgress: (progress: TimelineProgress) => void = () => {},
  ): Promise<PolicyPromptRewriteResult> {
    return this.dispatchPolicyPromptRewrite(input, onProgress);
  }

  runSceneJob(
    input: BoundSceneJobInput,
    onProgress: (progress: SceneJobProgress) => void = () => {},
  ): Promise<SceneJobResult> {
    return this.dispatchSceneJob(input, onProgress);
  }

  stopActiveJob(role: WorkerRole): boolean {
    const job = this.activeJobsByRole.get(role);
    if (!job) return false;

    job.onProgress({
      jobId: job.id,
      status: "stopping",
      message: "Đang yêu cầu worker dừng công việc",
    });
    if (job.client.socket.readyState === WebSocket.OPEN) {
      job.client.socket.send(JSON.stringify({ type: "STOP", jobId: job.id }));
    }
    this.finishJob(
      job,
      new WorkerJobError("Timeline generation stopped", "STOPPED"),
    );
    return true;
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.clients) {
      clearTimeout(client.registrationTimer);
      client.socket.terminate();
    }
    this.clients.clear();
    this.clientsByRole.clear();
    for (const job of this.pendingJobs.values()) {
      clearTimeout(job.timer);
      clearTimeout(job.ackTimer);
      job.reject(new WorkerJobError("Desktop app is stopping", "STOPPED"));
    }
    this.pendingJobs.clear();
    this.activeJobsByRole.clear();

    this.server?.close();
    this.server = null;
  }

  private handleConnection(socket: WebSocket): void {
    const client: ClientState = {
      socket,
      role: null,
      profileTag: null,
      workerVersion: null,
      connectedAt: null,
      lastSeenAt: Date.now(),
      registrationTimer: setTimeout(() => {
        socket.close(1008, "REGISTER required");
      }, this.options.registerTimeoutMs),
    };
    this.clients.add(client);

    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        socket.close(1003, "JSON text messages only");
        return;
      }

      client.lastSeenAt = Date.now();

      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(1007, "Invalid JSON");
        return;
      }

      if (!client.role) {
        const registration = parseRegisterMessage(message);
        if (!registration) {
          socket.close(1008, "First message must be REGISTER");
          return;
        }
        this.registerClient(client, registration);
        return;
      }

      if (this.handleWorkerMessage(client, message)) {
        return;
      }

      console.warn(
        `[KC Auto Tool] Ignored unsupported message from ${client.role}`,
      );
    });

    socket.on("close", () => this.handleClose(client));
    socket.on("error", (error) => {
      console.warn("[KC Auto Tool] Worker socket error:", error.message);
    });
  }

  private registerClient(
    client: ClientState,
    registration: RegisterMessage,
  ): void {
    clearTimeout(client.registrationTimer);

    const previous = this.clientsByRole.get(registration.role);
    if (previous && previous !== client) {
      const activeJob = this.activeJobsByRole.get(registration.role);
      const incomingVersion = workerVersionNumber(registration.workerVersion);
      const currentVersion = workerVersionNumber(previous.workerVersion);
      const duplicateProfile = previous.profileTag !== registration.profileTag;
      if (
        activeJob?.client === previous ||
        incomingVersion < currentVersion ||
        (incomingVersion === currentVersion && duplicateProfile)
      ) {
        client.socket.close(
          4002,
          activeJob?.client === previous
            ? "Worker role is busy"
            : "Older or duplicate worker profile rejected",
        );
        return;
      }
    }
    client.role = registration.role;
    client.profileTag = registration.profileTag;
    client.workerVersion = registration.workerVersion;
    client.connectedAt = new Date().toISOString();
    this.clientsByRole.set(registration.role, client);

    if (previous && previous !== client) {
      if (previous.socket.readyState === WebSocket.OPEN) {
        previous.socket.send(JSON.stringify({ type: "STOP" }), () => {
          previous.socket.close(4001, "Replaced by newer worker");
        });
      } else {
        previous.socket.close(4001, "Replaced by newer worker");
      }
    }

    // A browser service worker can outlive the desktop process. After an app
    // restart it may still hold a job that no server instance can identify.
    // STOP without a jobId clears only that orphaned worker-local operation.
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify({ type: "STOP" }));
    }

    this.statuses[registration.role] = {
      role: registration.role,
      connected: true,
      profileTag: registration.profileTag,
      connectedAt: client.connectedAt,
    };
    this.emitStatuses();

    console.info(
      `[KC Auto Tool] Registered ${registration.role} (${registration.profileTag}, v${registration.workerVersion || "legacy"})`,
    );
  }

  private handleClose(client: ClientState): void {
    clearTimeout(client.registrationTimer);
    this.clients.delete(client);
    if (!client.role || this.clientsByRole.get(client.role) !== client) return;

    this.clientsByRole.delete(client.role);
    const activeJob = this.activeJobsByRole.get(client.role);
    if (activeJob?.client === client) {
      this.finishJob(
        activeJob,
        new WorkerJobError(
          `${client.role} disconnected while processing the job`,
          "INTERNAL_ERROR",
          true,
        ),
      );
    }
    this.statuses[client.role] = {
      role: client.role,
      connected: false,
      profileTag: null,
      connectedAt: null,
    };
    this.emitStatuses();
  }

  private runHeartbeat(): void {
    const now = Date.now();

    for (const client of this.clientsByRole.values()) {
      if (now - client.lastSeenAt > this.options.connectionTimeoutMs) {
        client.socket.terminate();
        continue;
      }

      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify({ type: "PING", timestamp: now }));
      }
    }
  }

  private emitStatuses(): void {
    this.onStatusChange(this.getStatuses());
  }

  private dispatchTimelineJob(
    input: TimelineGenerateInput,
    onProgress: (progress: TimelineProgress) => void,
  ): Promise<TimelineResult> {
    const role: WorkerRole = "chat-worker";
    const client = this.clientsByRole.get(role);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new WorkerJobError(
          "ChatGPT worker chưa kết nối",
          "NOT_LOGGED_IN",
          true,
        ),
      );
    }
    if (!supportsTimelineWorker(client.workerVersion)) {
      return Promise.reject(
        new WorkerJobError(
          `KC Dev ${client.workerVersion || "cũ"} chưa hỗ trợ Phase 3a Beat & Chain Planning. Hãy Reload extension.`,
          "INVALID_JOB",
        ),
      );
    }
    if (this.activeJobsByRole.has(role)) {
      return Promise.reject(
        new WorkerJobError("ChatGPT worker đang xử lý timeline khác", "INVALID_JOB"),
      );
    }

    const jobId = `timeline-${randomUUID()}`;
    return new Promise<TimelineResult>((resolve, reject) => {
      const job: PendingJob = {
        id: jobId,
        role,
        action: "GENERATE_TIMELINE",
        client,
        input,
        onProgress,
        resolve,
        reject,
        ackTimer: setTimeout(() => {
          this.finishJob(
            job,
            new WorkerJobError(
              "Extension không phản hồi. Hãy Reload KC Dev và tải lại trang ChatGPT.",
              "INTERNAL_ERROR",
              true,
            ),
          );
        }, this.options.jobAckTimeoutMs),
        timer: setTimeout(() => {
          this.finishJob(
            job,
            new WorkerJobError(
              "Timed out while waiting for ChatGPT",
              "TIMEOUT",
              true,
            ),
          );
          if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(JSON.stringify({ type: "STOP", jobId }));
          }
        }, this.options.jobTimeoutMs),
      };

      this.pendingJobs.set(jobId, job);
      this.activeJobsByRole.set(role, job);
      onProgress({
        jobId,
        status: "queued",
        message: "Đã gửi yêu cầu tới ChatGPT worker",
      });

      client.socket.send(
        JSON.stringify({
          type: "JOB",
          jobId,
          action: job.action,
          payload: input,
        }),
        (error) => {
          if (error) {
            this.finishJob(
              job,
              new WorkerJobError(error.message, "INTERNAL_ERROR", true),
            );
          }
        },
      );
    });
  }

  private dispatchPolicyPromptRewrite(
    input: PolicyPromptRewriteInput,
    onProgress: (progress: TimelineProgress) => void,
  ): Promise<PolicyPromptRewriteResult> {
    const role: WorkerRole = "chat-worker";
    const client = this.clientsByRole.get(role);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new WorkerJobError("ChatGPT worker chưa kết nối", "NOT_LOGGED_IN", true),
      );
    }
    if (!supportsPolicyPromptRewrite(client.workerVersion)) {
      return Promise.reject(
        new WorkerJobError("KC Dev hiện tại chưa hỗ trợ sửa prompt chính sách. Hãy Reload extension.", "INVALID_JOB"),
      );
    }
    if (this.activeJobsByRole.has(role)) {
      return Promise.reject(
        new WorkerJobError("ChatGPT worker đang xử lý công việc khác", "INVALID_JOB"),
      );
    }

    const jobId = `policy-rewrite-${input.sceneId}-${randomUUID()}`;
    return new Promise<PolicyPromptRewriteResult>((resolve, reject) => {
      const job: PendingJob = {
        id: jobId,
        role,
        action: "REWRITE_POLICY_PROMPT",
        client,
        input,
        onProgress,
        resolve,
        reject,
        ackTimer: setTimeout(() => {
          this.finishJob(
            job,
            new WorkerJobError("ChatGPT extension không phản hồi yêu cầu sửa prompt", "INTERNAL_ERROR", true),
          );
        }, this.options.jobAckTimeoutMs),
        timer: setTimeout(() => {
          this.finishJob(job, new WorkerJobError("Hết thời gian chờ ChatGPT sửa prompt", "TIMEOUT", true));
          if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(JSON.stringify({ type: "STOP", jobId }));
          }
        }, this.options.jobTimeoutMs),
      };
      this.pendingJobs.set(jobId, job);
      this.activeJobsByRole.set(role, job);
      onProgress({ jobId, status: "queued", message: `Đang gửi prompt lỗi ${input.sceneId} tới ChatGPT` });
      client.socket.send(
        JSON.stringify({ type: "JOB", jobId, action: job.action, payload: input }),
        (error) => {
          if (error) this.finishJob(job, new WorkerJobError(error.message, "INTERNAL_ERROR", true));
        },
      );
    });
  }

  private dispatchSceneJob(
    input: BoundSceneJobInput,
    onProgress: (progress: SceneJobProgress) => void,
  ): Promise<SceneJobResult> {
    const role: WorkerRole = "flow-worker";
    const client = this.clientsByRole.get(role);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new WorkerJobError("Google Flow worker chưa kết nối", "NOT_LOGGED_IN", true),
      );
    }
    if (!supportsSceneJobs(client.workerVersion)) {
      return Promise.reject(
        new WorkerJobError(
          `KC Dev ${client.workerVersion || "cũ"} chưa hỗ trợ heartbeat cho hàng đợi tự động. Hãy Reload extension.`,
          "INVALID_JOB",
        ),
      );
    }
    if (input.mediaType === "video" && !supportsSingleNativeVideoDownload(client.workerVersion)) {
      return Promise.reject(
        new WorkerJobError(
          `KC Dev ${client.workerVersion || "cũ"} vẫn có thể tải trùng video. Hãy Reload extension 2.42.0 trở lên trước khi chạy Video.`,
          "INVALID_JOB",
        ),
      );
    }
    if (this.activeJobsByRole.has(role)) {
      return Promise.reject(
        new WorkerJobError("Google Flow worker đang xử lý scene khác", "INVALID_JOB"),
      );
    }

    const action = input.mediaType === "image" ? "GENERATE_IMAGE" : "GENERATE_VIDEO";
    const jobId = `${input.mediaType}-${input.sceneId}-${randomUUID()}`;
    return new Promise<SceneJobResult>((resolve, reject) => {
      const progress = (value: TimelineProgress) =>
        onProgress({
          ...value,
          sceneId: input.sceneId,
          mediaType: input.mediaType,
        });
      const job: PendingJob = {
        id: jobId,
        role,
        action,
        client,
        input,
        onProgress: progress,
        resolve,
        reject,
        ackTimer: setTimeout(() => {
          this.finishJob(
            job,
            new WorkerJobError("Flow worker không phản hồi scene job", "INTERNAL_ERROR", true),
          );
        }, this.options.jobAckTimeoutMs),
        timer: setTimeout(() => {
          this.finishJob(
            job,
            new WorkerJobError("Scene job timed out", "TIMEOUT", true),
          );
        }, this.options.jobTimeoutMs),
      };

      this.pendingJobs.set(jobId, job);
      this.activeJobsByRole.set(role, job);
      progress({
        jobId,
        status: "queued",
        message: `Đã gửi ${input.mediaType} job cho ${input.sceneId}`,
      });
      client.socket.send(
        JSON.stringify({ type: "JOB", jobId, action, payload: input }),
        (error) => {
          if (error) {
            this.finishJob(
              job,
              new WorkerJobError(error.message, "INTERNAL_ERROR", true),
            );
          }
        },
      );
    });
  }

  private handleWorkerMessage(client: ClientState, value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const message = value as Record<string, unknown>;
    if (message.type === "PONG") return true;
    if (
      message.type !== "JOB_PROGRESS" &&
      message.type !== "JOB_DONE" &&
      message.type !== "JOB_ERROR"
    ) {
      return false;
    }

    if (typeof message.jobId !== "string") return true;
    const job = this.pendingJobs.get(message.jobId);
    if (!job || job.client !== client) return true;
    clearTimeout(job.ackTimer);

    if (message.type === "JOB_PROGRESS") {
      const allowedStatuses: JobProgressStatus[] = [
        "queued",
        "preparing",
        "generating",
        "downloading",
        "stopping",
      ];
      if (allowedStatuses.includes(message.status as JobProgressStatus)) {
        job.onProgress({
          jobId: job.id,
          status: message.status as JobProgressStatus,
          message:
            typeof message.message === "string"
              ? message.message.slice(0, 500)
              : undefined,
        });
      }
      return true;
    }

    if (message.type === "JOB_ERROR") {
      this.finishJob(
        job,
        new WorkerJobError(
          typeof message.error === "string"
            ? message.error
            : "Worker could not generate the timeline",
          typeof message.code === "string" ? message.code : "INTERNAL_ERROR",
          message.retryable === true,
        ),
      );
      return true;
    }

    try {
      if (job.action === "GENERATE_TIMELINE") {
        const input = job.input as TimelineGenerateInput;
        const result = normalizeTimelineResult(message.result);
        const lockedBible = input.visualBible;
        for (const field of ["style", "palette", "lighting", "continuityNotes"] as const) {
          if (lockedBible[field]?.trim()) {
            result.visualBible[field] = lockedBible[field].trim();
          }
        }
        validateGeneratedVisualBible(result.visualBible);
        validateTimelineCoverage(result, input.srtText);
        this.finishJob(job, null, result);
      } else if (job.action === "REWRITE_POLICY_PROMPT") {
        this.finishJob(
          job,
          null,
          normalizePolicyPromptRewriteResult(
            message.result,
            job.input as PolicyPromptRewriteInput,
          ),
        );
      } else {
        const input = job.input as BoundSceneJobInput;
        this.finishJob(
          job,
          null,
          normalizeSceneJobResult(message.result, input),
        );
      }
    } catch (error) {
      this.finishJob(
        job,
        new WorkerJobError(
          error instanceof Error ? error.message : String(error),
          "INVALID_JOB",
        ),
      );
    }
    return true;
  }

  private finishJob(
    job: PendingJob,
    error: Error | null,
    result?: TimelineResult | PolicyPromptRewriteResult | SceneJobResult,
  ): void {
    if (!this.pendingJobs.has(job.id)) return;

    clearTimeout(job.timer);
    clearTimeout(job.ackTimer);
    this.pendingJobs.delete(job.id);
    if (this.activeJobsByRole.get(job.role) === job) {
      this.activeJobsByRole.delete(job.role);
    }

    if (error) job.reject(error);
    else if (result) job.resolve(result);
  }
}
