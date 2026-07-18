import { Cloud, CloudOff, Cpu, Database, HardDrive, RadioTower } from "lucide-react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { SystemStatus } from "../shared/system";
import type { TimelineSession } from "../shared/timeline";
import type { WorkerStatuses } from "../shared/worker-status";

function bytes(value: number): string {
  if (!value) return "0 GB";
  return `${(value / (1024 ** 3)).toFixed(1)} GB`;
}

function time(value: string | undefined): string {
  if (!value) return "Chưa lưu";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Chưa lưu" : date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function StatusBar({
  session,
  queue,
  workers,
  system,
  online,
}: {
  session: TimelineSession | null;
  queue: ProductionQueueSnapshot | null;
  workers: WorkerStatuses;
  system: SystemStatus | null;
  online: boolean;
}) {
  const connected = Object.values(workers).filter((worker) => worker.connected).length;
  const queueLabel = queue?.state === "running" ? "Đang chạy" : queue?.state === "paused" ? "Tạm dừng" : queue?.state === "stopped" ? "Đã dừng" : "Rảnh";
  return (
    <footer className="kc-status-bar">
      <div><Database size={13} /><span>{session?.name || "Chưa có phiên"}</span></div>
      <div><span>Lưu gần nhất: {time(session?.savedAt)}</span><b className="is-success">Autosave</b></div>
      <div><RadioTower size={13} /><span>Worker {connected}/2</span></div>
      <div><span>Queue: {queueLabel}</span>{queue?.queuedJobs ? <b>{queue.queuedJobs} chờ</b> : null}</div>
      {system && <div className="kc-system-metrics"><Cpu size={13} /><span>CPU {system.cpuPercent === null ? "N/A" : `${system.cpuPercent.toFixed(0)}%`}</span><HardDrive size={13} /><span>RAM {bytes(system.ramUsedBytes)}/{bytes(system.ramTotalBytes)}</span>{system.gpuPercent !== null && <span>GPU {system.gpuPercent.toFixed(0)}%</span>}</div>}
      <div className="kc-status-spacer" />
      <div>{online ? <Cloud size={13} /> : <CloudOff size={13} />}<span>{online ? "Trực tuyến" : "Ngoại tuyến"}</span></div>
      <div><span>KC Auto Tool v{system?.appVersion || "…"}</span></div>
    </footer>
  );
}

