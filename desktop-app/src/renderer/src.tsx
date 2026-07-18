import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDisconnectedStatuses,
  type WorkerStatuses,
} from "../shared/worker-status";
import { AppShell } from "./AppShell";
import { CharacterLibrary } from "./CharacterLibrary";
import { DashboardView } from "./DashboardView";
import { OutputLibrary } from "./OutputLibrary";
import { SessionsView } from "./SessionsView";
import { SettingsView } from "./SettingsView";
import { TimelineImport } from "./TimelineImport";
import { VisualBibleWorkspace } from "./VisualBibleWorkspace";
import { VoiceWorkflow } from "./VoiceWorkflow";
import { ChatGPTWorkerPanel, GoogleFlowWorkerPanel } from "./WorkerPanels";
import { PAGE_COPY, type AppPage } from "./app-navigation";
import type { HomeWorkflowMode, IntegratedWorkflowHandoff } from "./integrated-workflow";
import { useWorkspaceData } from "./useWorkspaceData";
import "./style.css";
import "./dark-fixes.css";

const PAGE_STORAGE_KEY = "kc-auto-tool.ui.page.v1";
const SIDEBAR_STORAGE_KEY = "kc-auto-tool.ui.sidebar-collapsed.v1";
const QUEUE_STORAGE_KEY = "kc-auto-tool.ui.queue-open.v1";
const VALID_PAGES = new Set<AppPage>(Object.keys(PAGE_COPY) as AppPage[]);

function storedPage(): AppPage {
  const stored = localStorage.getItem(PAGE_STORAGE_KEY);
  const value = (stored === "prompts" ? "timeline" : stored) as AppPage | null;
  return value && VALID_PAGES.has(value) ? value : "home";
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

function App() {
  const [page, setPage] = useState<AppPage>(storedPage);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
  const [queueOpen, setQueueOpen] = useState(() => localStorage.getItem(QUEUE_STORAGE_KEY) !== "false");
  const [voiceMode, setVoiceMode] = useState<"full_auto" | "step_by_step">("step_by_step");
  const [voiceUseCurrentSession, setVoiceUseCurrentSession] = useState(true);
  const [integratedHandoff, setIntegratedHandoff] = useState<IntegratedWorkflowHandoff | null>(null);
  const [statuses, setStatuses] = useState<WorkerStatuses>(() => createDisconnectedStatuses());
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const workspace = useWorkspaceData();

  useEffect(() => {
    localStorage.setItem(PAGE_STORAGE_KEY, page);
  }, [page]);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, String(queueOpen));
  }, [queueOpen]);
  useEffect(() => {
    const bridge = window.flowx;
    if (!bridge) return undefined;
    let active = true;
    const unsubscribe = bridge.workers.onStatusChange((next) => { if (active) setStatuses(next); });
    void bridge.workers.getStatuses().then((next) => { if (active && next) setStatuses(next); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const navigate = (next: AppPage) => {
    if (next === "voice") {
      setVoiceMode("step_by_step");
      setVoiceUseCurrentSession(true);
    }
    setPage(next);
  };

  const stopForSessionChange = async () => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge || !workspace.queue?.activeJobId) return;
    if (!window.confirm("Phiên hiện tại đang có công việc chạy. Dừng hàng đợi để chuyển phiên?")) {
      throw new Error("Đã hủy chuyển phiên.");
    }
    let snapshot = await bridge.stopQueue();
    const deadline = Date.now() + 12_000;
    while (snapshot.activeJobId && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      snapshot = await bridge.getSnapshot(snapshot.projectId);
    }
    if (snapshot.activeJobId) throw new Error("Công việc hiện tại chưa dừng xong.");
  };

  const createSession = async (name?: string) => {
    try {
      await stopForSessionChange();
      await window.flowx?.timeline.createSession(name || `Phiên ${workspace.sessions.length + 1}`);
      await workspace.refresh();
      setPage("home");
      setToast({ tone: "success", text: "Đã tạo phiên làm việc mới." });
      return true;
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
      return false;
    }
  };
  const selectSession = async (id: string) => {
    if (workspace.session?.id === id) return;
    try {
      await stopForSessionChange();
      await window.flowx?.timeline.selectSession(id);
      await workspace.refresh();
      setPage("home");
    } catch (error) { setToast({ tone: "error", text: cleanError(error) }); }
  };
  const renameSession = async (id: string) => {
    const current = workspace.sessions.find((session) => session.id === id);
    const name = window.prompt("Tên mới của phiên", current?.name || "");
    if (!name?.trim()) return;
    try { await window.flowx?.timeline.renameSession(id, name); await workspace.refresh(); }
    catch (error) { setToast({ tone: "error", text: cleanError(error) }); }
  };
  const deleteSession = async (id: string) => {
    const current = workspace.sessions.find((session) => session.id === id);
    if (!window.confirm(`Xóa phiên “${current?.name || id}”? Dữ liệu timeline và liên kết dự án sẽ bị xóa.`)) return;
    try {
      if (workspace.session?.id === id) await stopForSessionChange();
      await window.flowx?.timeline.deleteSession(id);
      await workspace.refresh();
      setToast({ tone: "success", text: "Đã xóa phiên làm việc." });
    } catch (error) { setToast({ tone: "error", text: cleanError(error) }); }
  };
  const saveState = async () => {
    if (!workspace.session || !window.flowx) return;
    setSaving(true);
    try {
      await window.flowx.timeline.saveSession({
        scenes: workspace.session.scenes,
        visualBible: workspace.session.visualBible,
        styleReference: workspace.session.styleReference,
        workflowMode: workspace.session.workflowMode,
        workflowSource: workspace.session.workflowSource,
      });
      await workspace.refresh();
      setToast({ tone: "success", text: "Đã lưu trạng thái phiên." });
    } catch (error) { setToast({ tone: "error", text: cleanError(error) }); }
    finally { setSaving(false); }
  };

  const startWorkflow = (mode: HomeWorkflowMode) => {
    setIntegratedHandoff(null);
    if (mode === "srt_script") {
      void createSession("Video mới").then((created) => { if (created) setPage("timeline"); });
      return;
    }
    setVoiceMode(mode);
    setVoiceUseCurrentSession(false);
    setPage("voice");
  };

  const timelineKey = `${workspace.session?.id || "none"}:${page}`;
  let content;
  if (page === "home") {
    content = <DashboardView session={workspace.session} queue={workspace.queue} output={workspace.output} workers={statuses} onStartWorkflow={startWorkflow} onNavigate={navigate} />;
  } else if (page === "sessions") {
    content = <SessionsView sessions={workspace.sessions} queues={workspace.sessionQueues} onCreate={() => void createSession()} onOpen={(id) => void selectSession(id)} onRename={(id) => void renameSession(id)} onDelete={(id) => void deleteSession(id)} />;
  } else if (page === "voice") {
    content = <VoiceWorkflow key={voiceUseCurrentSession ? workspace.session?.id || "voice" : `new:${voiceMode}`} mode={voiceMode} session={voiceUseCurrentSession ? workspace.session : null} chatConnected={statuses["chat-worker"].connected} flowConnected={statuses["flow-worker"].connected} onBack={() => setPage("home")} onComplete={(handoff) => { setIntegratedHandoff(handoff); setPage("timeline"); void workspace.refresh(); }} />;
  } else if (page === "visual-bible") {
    content = <VisualBibleWorkspace session={workspace.session} onSaved={() => void workspace.refresh()} />;
  } else if (page === "characters") {
    content = <CharacterLibrary />;
  } else if (page === "output") {
    content = <OutputLibrary inspection={workspace.output} session={workspace.session} />;
  } else if (page === "settings") {
    content = <SettingsView workers={statuses} system={workspace.system} onRefresh={() => void workspace.refresh()} />;
  } else if (page === "queue") {
    content = <div className="kc-queue-workspace"><ChatGPTWorkerPanel session={workspace.session} workers={statuses} queue={workspace.queue} onNavigate={navigate} /><GoogleFlowWorkerPanel session={workspace.session} workers={statuses} queue={workspace.queue} onNavigate={navigate} /><OutputLibrary inspection={workspace.output} session={workspace.session} compact /></div>;
  } else {
    content = <TimelineImport key={timelineKey} chatConnected={statuses["chat-worker"].connected} flowConnected={statuses["flow-worker"].connected} integratedHandoff={integratedHandoff} onIntegratedHandoffConsumed={() => { setIntegratedHandoff(null); void workspace.refresh(); }} />;
  }

  return (
    <AppShell page={page} collapsed={sidebarCollapsed} queueOpen={queueOpen} saving={saving} online={online} session={workspace.session} sessions={workspace.sessions} sessionQueues={workspace.sessionQueues} queue={workspace.queue} workers={statuses} system={workspace.system} onNavigate={navigate} onCreateSession={() => void createSession()} onSelectSession={(id) => void selectSession(id)} onRenameSession={(id) => void renameSession(id)} onDeleteSession={(id) => void deleteSession(id)} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} onToggleQueue={() => setQueueOpen((value) => !value)} onSave={() => void saveState()}>
      {workspace.loading ? <div className="kc-loading-screen"><span /><strong>Đang khôi phục phiên KC Auto Tool…</strong></div> : content}
      {toast && <div className={`kc-toast is-${toast.tone}`} role="status">{toast.text}</div>}
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
