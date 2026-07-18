import type { ReactNode } from "react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { SystemStatus } from "../shared/system";
import type { TimelineSession, TimelineSessionSummary } from "../shared/timeline";
import type { WorkerStatuses } from "../shared/worker-status";
import { ProductionQueuePanel } from "./ProductionQueuePanel";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopHeader } from "./TopHeader";
import type { AppPage } from "./app-navigation";

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
  onNavigate,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onToggleCollapsed,
  onToggleQueue,
  onSave,
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
  onNavigate: (page: AppPage) => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onToggleCollapsed: () => void;
  onToggleQueue: () => void;
  onSave: () => void;
}) {
  const errors = queue?.errors.length || 0;
  return (
    <main className={`kc-app-shell ${collapsed ? "is-sidebar-collapsed" : ""} ${queueOpen ? "is-queue-open is-queue-drawer-open" : "is-queue-closed"}`}>
      <Sidebar page={page} collapsed={collapsed} sessions={sessions} sessionQueues={sessionQueues} system={system} errorCount={errors} onNavigate={onNavigate} onCreateSession={onCreateSession} onSelectSession={onSelectSession} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} onToggleCollapsed={onToggleCollapsed} />
      <TopHeader page={page} sessionName={session?.name || ""} sessions={sessions} errorCount={errors} saving={saving} onNavigate={onNavigate} onSave={onSave} onSelectSession={onSelectSession} />
      <section className="kc-main-workspace">{children}</section>
      <button className="kc-queue-drawer-toggle" type="button" onClick={onToggleQueue}>Queue {queue?.queuedJobs || 0}{errors ? ` · ${errors} lỗi` : ""}</button>
      <ProductionQueuePanel snapshot={queue} scenes={session?.scenes || []} open={queueOpen} onClose={onToggleQueue} />
      <StatusBar session={session} queue={queue} workers={workers} system={system} online={online} />
    </main>
  );
}
