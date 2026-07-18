import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileDown,
  Image,
  LoaderCircle,
  Pause,
  Play,
  RefreshCcw,
  Scissors,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ProductionQueueSnapshot, QueueJobView } from "../shared/production-queue";
import type { Scene } from "../shared/timeline";

function jobLabel(job: QueueJobView): string {
  if (job.jobType === "extract_last_frame") return "Trích xuất frame cuối";
  if (job.jobType === "image_generation") return "Tạo ảnh";
  if (job.jobType === "video_generation") return "Tạo video";
  if (/download/i.test(job.jobType)) return "Download";
  if (/policy/i.test(job.jobType)) return "Sửa chính sách";
  return job.jobType.replace(/_/g, " ");
}

function JobIcon({ job }: { job: QueueJobView }) {
  if (job.jobType === "extract_last_frame") return <Scissors size={14} />;
  if (job.mediaType === "image") return <Image size={14} />;
  if (job.mediaType === "video") return <Video size={14} />;
  return <FileDown size={14} />;
}

function stateLabel(job: QueueJobView): string {
  if (job.status === "running") return "Đang xử lý";
  if (job.status === "queued") return "Đang chờ";
  if (job.status === "succeeded") return "Hoàn thành";
  return "Lỗi";
}

export function ProductionQueuePanel({
  snapshot,
  scenes,
  open,
  onClose,
}: {
  snapshot: ProductionQueueSnapshot | null;
  scenes: Scene[];
  open: boolean;
  onClose: () => void;
}) {
  const [commandError, setCommandError] = useState("");
  const [busy, setBusy] = useState(false);
  const sceneMap = useMemo(() => new Map(scenes.map((scene) => [scene.id, scene])), [scenes]);
  const jobMap = useMemo(() => new Map((snapshot?.jobs || []).map((job) => [job.id, job])), [snapshot?.jobs]);
  const jobs = useMemo(() => [...(snapshot?.jobs || [])]
    .sort((left, right) => {
      const rank = { running: 0, failed: 1, queued: 2, succeeded: 3 } as const;
      return rank[left.status] - rank[right.status];
    }).slice(0, 80), [snapshot?.jobs]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setCommandError("");
    try { await operation(); } catch (error) {
      setCommandError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/i, "") : String(error));
    } finally { setBusy(false); }
  };
  const bridge = window.flowx?.productionQueue;
  const projectId = snapshot?.projectId;
  const startAll = () => {
    if (!bridge || !projectId) return;
    void run(async () => {
      await bridge.setApprovalPolicy(true, true, projectId);
      await bridge.generateAllImages(projectId);
    });
  };
  const retryErrors = () => {
    if (!bridge || !projectId || !snapshot?.errors.length) return;
    void run(() => bridge.retryFailed([...new Set(snapshot.errors.map((error) => error.sceneId))], projectId));
  };
  const clearResults = () => {
    if (!bridge || !projectId || !window.confirm("Xóa toàn bộ file đã tạo của phiên này? Timeline và prompt vẫn được giữ nguyên.")) return;
    void run(() => bridge.clearGeneratedMedia(projectId));
  };

  return (
    <aside className={`kc-production-queue kc-queue-panel ${open ? "is-open" : ""}`} aria-label="Production Queue">
      <header className="kc-queue-header">
        <div><span>PRODUCTION</span><h2>Production Queue</h2></div>
        <button type="button" onClick={onClose} aria-label="Đóng hàng đợi"><X size={17} /></button>
      </header>
      <div className="kc-queue-summary">
        <span className={`is-${snapshot?.state || "idle"}`}>{snapshot?.state === "running" ? <LoaderCircle className="spin" size={13} /> : <span />}{snapshot?.state === "running" ? "Đang chạy" : snapshot?.state === "paused" ? "Tạm dừng" : snapshot?.state === "stopped" ? "Đã dừng" : "Sẵn sàng"}</span>
        <b>{snapshot?.queuedJobs || 0} đang chờ</b>
      </div>
      <div className="kc-queue-controls">
        <button type="button" className="is-primary" disabled={!bridge || busy} onClick={startAll}><Play size={14} /> Bắt đầu tất cả</button>
        {snapshot?.state === "running" ? (
          <button type="button" disabled={busy} onClick={() => bridge && void run(() => bridge.pauseQueue())}><Pause size={14} /> Tạm dừng</button>
        ) : (
          <button type="button" disabled={!bridge || busy} onClick={() => bridge && void run(() => bridge.resumeQueue())}><Play size={14} /> Tiếp tục</button>
        )}
        <button type="button" disabled={!bridge || busy} onClick={() => bridge && void run(() => bridge.stopQueue())}><Square size={13} /> Dừng</button>
        <button type="button" disabled={!snapshot?.errors.length || busy} onClick={retryErrors}><RefreshCcw size={13} /> Thử lỗi</button>
      </div>
      {commandError && <div className="kc-queue-error"><AlertTriangle size={14} />{commandError}</div>}
      <div className="kc-queue-list">
        {!jobs.length && <div className="kc-queue-empty"><Check size={19} /><strong>Hàng đợi trống</strong><span>Chưa có công việc sản xuất.</span></div>}
        {jobs.map((job, index) => {
          const scene = sceneMap.get(job.sceneId);
          const dependency = job.dependsOn ? jobMap.get(job.dependsOn) : null;
          const progress = job.status === "succeeded" ? 100 : job.status === "running" ? 58 : job.status === "failed" ? 100 : 8;
          return (
            <article key={job.id} className={`kc-queue-item is-${job.status}`}>
              <span className="kc-queue-order">{index + 1}</span>
              <div className="kc-queue-thumb"><JobIcon job={job} /></div>
              <div className="kc-queue-item-body">
                <div><strong>{scene ? `Scene ${scene.order}` : job.sceneId || "Project"}</strong><span>{scene?.chainRole || "single"}</span></div>
                <p>{jobLabel(job)}</p>
                <i><span style={{ width: `${progress}%` }} /></i>
                <small>{stateLabel(job)} · lần {job.attempts}/{job.maxAttempts}</small>
                {dependency && <em><ChevronRight size={11} /> phụ thuộc {dependency.sceneId || dependency.id.slice(0, 8)}</em>}
              </div>
              {job.status === "failed" && <AlertTriangle className="kc-queue-warning" size={15} />}
            </article>
          );
        })}
      </div>
      <footer className="kc-queue-footer">
        <button type="button" disabled={!bridge || !snapshot || busy || snapshot.state === "running"} onClick={() => bridge && void run(() => bridge.resumeQueue())}><RefreshCcw size={13} /> Khôi phục hàng đợi</button>
        <button type="button" className="is-danger" disabled={!snapshot || busy} onClick={clearResults}><Trash2 size={13} /> Xóa kết quả</button>
      </footer>
    </aside>
  );
}
