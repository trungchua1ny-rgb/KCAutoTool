import type { ReactNode } from "react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { SystemStatus } from "../shared/system";
import type { TimelineProgress, TimelineSession, TimelineSessionSummary } from "../shared/timeline";
import type { WorkerStatuses } from "../shared/worker-status";
import { ProductionQueuePanel } from "./ProductionQueuePanel";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopHeader } from "./TopHeader";
import type { AppPage } from "./app-navigation";
import { WorkflowProgressDock } from "./WorkflowProgressDock";

export function AppShell({
  children,
  page,
  collapsed,
  queueOpen,
  saving,
  online,
  session,
  sessions,
  sessionQueues,
  queue,
  workers,
  system,
  timelineProgress,
  onNavigate,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onToggleCollapsed,
  onToggleQueue,
  onSave,
  onBuildVideo,
  onPauseQueue,
  onResumeQueue,
  onStopSession,
}: {
  children: ReactNode;
  page: AppPage;
  collapsed: boolean;
  queueOpen: boolean;
  saving: boolean;
  online: boolean;
  session: TimelineSession | null;
  sessions: TimelineSessionSummary[];
  sessionQueues: Record<string, ProductionQueueSnapshot>;
  queue: ProductionQueueSnapshot | null;
  workers: WorkerStatuses;
  system: SystemStatus | null;
  timelineProgress: TimelineProgress | null;
  onNavigate: (page: AppPage) => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onToggleCollapsed: () => void;
  onToggleQueue: () => void;
  onSave: () => void;
  onBuildVideo: () => void;
  onPauseQueue: () => Promise<void>;
  onResumeQueue: () => Promise<void>;
  onStopSession: () => Promise<void>;
}) {
  const errors = queue?.errors.length || 0;
  const timelineRunning = Boolean(timelineProgress && !["succeeded", "failed", "cancelled"].includes(timelineProgress.status));
  const queueRunning = Boolean(queue?.activeJobId || queue?.state === "running" || queue?.state === "paused");
  const setupPages: AppPage[] = ["voice", "characters", "visual-bible", "timeline"];
  const workflowActivePage: AppPage | null = queueRunning
    ? "queue"
    : timelineRunning
      ? "timeline"
      : setupPages.includes(page)
        ? page
        : null;
  return (
    <main className={`kc-app-shell ${collapsed ? "is-sidebar-collapsed" : ""} ${queueOpen ? "is-queue-open is-queue-drawer-open" : "is-queue-closed"}`}>
      <Sidebar page={page} collapsed={collapsed} sessions={sessions} sessionQueues={sessionQueues} system={system} errorCount={errors} workflowActivePage={workflowActivePage} onNavigate={onNavigate} onCreateSession={onCreateSession} onSelectSession={onSelectSession} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} onToggleCollapsed={onToggleCollapsed} />
      <TopHeader page={page} sessionName={session?.name || ""} sessionSavedAt={session?.savedAt || ""} sessions={sessions} errorCount={errors} saving={saving} workers={workers} onNavigate={onNavigate} onSave={onSave} onSelectSession={onSelectSession} />
      <WorkflowProgressDock session={session} queue={queue} timelineProgress={timelineProgress} onNavigate={onNavigate} onBuildVideo={onBuildVideo} onPauseQueue={onPauseQueue} onResumeQueue={onResumeQueue} onStopSession={onStopSession} />
      <section className="kc-main-workspace">{children}</section>
      {page !== "home" && <button className="kc-queue-drawer-toggle" type="button" onClick={onToggleQueue}>Queue {queue?.queuedJobs || 0}{errors ? ` · ${errors} lỗi` : ""}</button>}
      <ProductionQueuePanel snapshot={queue} scenes={session?.scenes || []} open={queueOpen} onClose={onToggleQueue} />
      <StatusBar session={session} queue={queue} workers={workers} system={system} online={online} />
    </main>
  );
}
