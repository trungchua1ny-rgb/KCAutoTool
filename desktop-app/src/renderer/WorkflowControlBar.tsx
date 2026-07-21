import {
  Clapperboard,
  Image as ImageIcon,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { WorkflowSceneView } from "./workflow-scene-view";

export function WorkflowControlBar({
  scenes,
  snapshot,
  flowConnected,
  busy,
  onStart,
  onGenerateImages,
  onGenerateVideos,
  onPause,
  onResume,
  onStop,
  onRetryErrors,
  onClearResults,
  onBuildVideo,
  onRefresh,
}: {
  scenes: WorkflowSceneView[];
  snapshot: ProductionQueueSnapshot | null;
  flowConnected: boolean;
  busy: boolean;
  onStart: () => void;
  onGenerateImages: () => void;
  onGenerateVideos: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetryErrors: () => void;
  onClearResults: () => void;
  onBuildVideo: () => void;
  onRefresh: () => void;
}) {
  const running = snapshot?.state === "running";
  const paused = snapshot?.state === "paused";
  const stoppable = running || paused || Boolean(snapshot?.activeJobId);
  const videosReady = scenes.length > 0 && scenes.every((item) => item.videoStatus === "completed" || item.videoStatus === "approved");
  const hasErrors = Boolean(snapshot?.errors.length);
  return (
    <section className="workflow-control-bar" aria-label="Điều khiển workflow">
      <button className="workflow-control is-primary" type="button" disabled={!flowConnected || running || busy} onClick={onStart}><Sparkles size={15} /> Bắt đầu toàn bộ workflow</button>
      <button className="workflow-control is-primary" type="button" disabled={!flowConnected || running || busy} onClick={onGenerateImages}><ImageIcon size={15} /> Tạo toàn bộ ảnh</button>
      <button className="workflow-control is-primary" type="button" disabled={!flowConnected || running || busy} onClick={onGenerateVideos}><Play size={15} /> Tạo video đã duyệt</button>
      <button className="workflow-control is-pause" type="button" disabled={!running || busy} onClick={onPause}><Pause size={15} /> Tạm dừng</button>
      <button className="workflow-control is-resume" type="button" disabled={!paused || busy} onClick={onResume}><Play size={15} /> Tiếp tục</button>
      <button className="workflow-control is-stop" type="button" disabled={!stoppable || busy} onClick={() => { if (window.confirm("Dừng toàn bộ workflow của phiên hiện tại? Công việc đang chạy sẽ được yêu cầu hủy.")) onStop(); }}><Square size={14} /> Dừng</button>
      <button className="workflow-control is-retry" type="button" disabled={!hasErrors || running || busy} onClick={onRetryErrors}><RotateCcw size={15} /> Thử lại tất cả lỗi</button>
      <button className="workflow-control is-clear" type="button" disabled={running || busy} onClick={onClearResults}><Trash2 size={15} /> Xóa kết quả, giữ timeline/prompt</button>
      <button className="workflow-control is-build" type="button" disabled={!videosReady || busy} onClick={onBuildVideo}><Clapperboard size={15} /> Dựng video khi đạt 100%</button>
      <button className="workflow-control-icon" type="button" title="Làm mới trạng thái queue" disabled={busy} aria-label="Làm mới trạng thái queue" onClick={onRefresh}><RefreshCcw size={15} /></button>
    </section>
  );
}
