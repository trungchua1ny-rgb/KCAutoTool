import type { CharactersBridge } from "./character";
import type { TimelineBridge } from "./timeline";
import type { SceneJobsBridge } from "./scene-job";
import type { MediaBridge } from "./media";
import type { VisualStylesBridge } from "./visual-style";
import type { ProductionQueueBridge } from "./production-queue";
import type { VoiceBridge } from "./voice";
import type { SystemBridge } from "./system";
import type { CapCutBridge } from "./capcut";
import type { EditBridge } from "./edit";

export const WORKER_ROLES = ["chat-worker", "flow-worker"] as const;

export type WorkerRole = (typeof WORKER_ROLES)[number];

export interface WorkerConnectionStatus {
  role: WorkerRole;
  connected: boolean;
  profileTag: string | null;
  connectedAt: string | null;
}

export type WorkerStatuses = Record<WorkerRole, WorkerConnectionStatus>;

export interface KCAutoToolBridge {
  platform: string;
  characters: CharactersBridge;
  timeline: TimelineBridge;
  sceneJobs: SceneJobsBridge;
  media: MediaBridge;
  visualStyles: VisualStylesBridge;
  productionQueue: ProductionQueueBridge;
  voice: VoiceBridge;
  system: SystemBridge;
  capcut: CapCutBridge;
  edit: EditBridge;
  workers: {
    getStatuses: () => Promise<WorkerStatuses>;
    onStatusChange: (
      callback: (statuses: WorkerStatuses) => void,
    ) => () => void;
  };
}

export const WORKER_STATUS_CHANNEL = "workers:status";
export const WORKER_STATUS_GET_CHANNEL = "workers:get-statuses";

export function createDisconnectedStatuses(): WorkerStatuses {
  return {
    "chat-worker": {
      role: "chat-worker",
      connected: false,
      profileTag: null,
      connectedAt: null,
    },
    "flow-worker": {
      role: "flow-worker",
      connected: false,
      profileTag: null,
      connectedAt: null,
    },
  };
}
