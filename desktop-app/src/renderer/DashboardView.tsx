import { AlertTriangle, CheckCircle2, Clock3, Layers3, LoaderCircle, TimerReset } from "lucide-react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { OutputInspection } from "../shared/system";
import type { TimelineSession } from "../shared/timeline";
import type { WorkerStatuses } from "../shared/worker-status";
import { HomeView } from "./HomeView";
import type { HomeWorkflowMode } from "./integrated-workflow";
import { OutputLibrary } from "./OutputLibrary";
import { ProjectJourney } from "./ProjectJourney";
import { ChatGPTWorkerPanel, GoogleFlowWorkerPanel } from "./WorkerPanels";
import type { AppPage } from "./app-navigation";

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function DashboardView({
  session,
  queue,
  output,
  workers,
  onStartWorkflow,
  onNavigate,
}: {
  session: TimelineSession | null;
  queue: ProductionQueueSnapshot | null;
  output: OutputInspection | null;
  workers: WorkerStatuses;
  onStartWorkflow: (mode: HomeWorkflowMode) => void;
  onNavigate: (page: AppPage) => void;
}) {
  const scenes = session?.scenes || [];
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const completed = scenes.filter((scene) => scene.videoResultPath).length;
  const completion = scenes.length ? Math.round((completed / scenes.length) * 100) : 0;
  return (
    <div className="kc-dashboard">
      <HomeView onSelect={onStartWorkflow} />
      <ProjectJourney session={session} queue={queue} output={output} onNavigate={onNavigate} />
      <section className="kc-project-overview">
        <header><div><span>PROJECT OVERVIEW</span><h2>Tổng quan phiên hiện tại</h2></div><b>{completion}% hoàn thành</b></header>
        <div className="kc-overview-grid">
          <article><Layers3 size={17} /><span>Tổng scene</span><strong>{scenes.length}</strong></article>
          <article><Clock3 size={17} /><span>Tổng thời lượng</span><strong>{durationLabel(totalDuration)}</strong></article>
          <article><CheckCircle2 size={17} /><span>Video hoàn thành</span><strong>{completed}/{scenes.length}</strong></article>
          <article><LoaderCircle size={17} /><span>Đang xử lý</span><strong>{queue?.activeJobId ? 1 : 0}</strong></article>
          <article className="is-error"><AlertTriangle size={17} /><span>Công việc lỗi</span><strong>{queue?.errors.length || 0}</strong></article>
          <article><TimerReset size={17} /><span>Đang chờ</span><strong>{queue?.queuedJobs || 0}</strong></article>
        </div>
        <i className="kc-project-progress"><span style={{ width: `${completion}%` }} /></i>
      </section>
      <div className="kc-worker-grid"><ChatGPTWorkerPanel session={session} workers={workers} queue={queue} onNavigate={onNavigate} /><GoogleFlowWorkerPanel session={session} workers={workers} queue={queue} onNavigate={onNavigate} /></div>
      <section className="kc-dashboard-timeline">
        <header><div><span>SCENE TIMELINE</span><h2>Timeline gần nhất</h2></div><button type="button" onClick={() => onNavigate("timeline")}>Mở toàn bộ timeline</button></header>
        <div className="kc-mini-timeline">
          {scenes.slice(0, 16).map((scene) => <button key={scene.id} type="button" className={`is-${scene.chainRole} duration-${scene.durationSeconds}`} onClick={() => onNavigate("timeline")}><span>Scene {scene.order}</span><strong>{scene.durationSeconds}s</strong><small>{scene.chainRole} · {scene.videoStatus === "done" ? "video xong" : scene.imageStatus === "done" ? "đã có ảnh" : "đang chờ"}</small></button>)}
          {!scenes.length && <div className="kc-empty-panel">Chưa có scene. Chọn một chế độ ở phía trên để bắt đầu.</div>}
        </div>
      </section>
      <OutputLibrary inspection={output} session={session} compact />
    </div>
  );
}
