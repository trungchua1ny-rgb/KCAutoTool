import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDisconnectedStatuses,
  type WorkerStatuses,
} from "../shared/worker-status";
import { AppShell } from "./AppShell";
import { CharacterLibrary } from "./CharacterLibrary";
import { DashboardView } from "./DashboardView";
import { LaunchSplash } from "./LaunchSplash";
import { OutputLibrary } from "./OutputLibrary";
import { SessionsView } from "./SessionsView";
import { SettingsView } from "./SettingsView";
import { TimelineImport } from "./TimelineImport";
import { VisualBibleWorkspace } from "./VisualBibleWorkspace";
import { VoiceWorkflow } from "./VoiceWorkflow";
import { CapCutBuildPage } from "./CapCutBuildPage";
import { ScreenplayStudio } from "./ScreenplayStudio";
import { ChatGPTWorkerPanel, GoogleFlowWorkerPanel } from "./WorkerPanels";
import { CapCutBuildDialog } from "./CapCutBuildDialog";
import { CompletedSetupStep, type CompletedSetupStepKind } from "./CompletedSetupStep";
import type { CapCutBuildInspection, CapCutBuildResult } from "../shared/capcut";
import { PAGE_COPY, type AppPage } from "./app-navigation";
import type { HomeWorkflowMode, IntegratedWorkflowHandoff } from "./integrated-workflow";
import { markHomeCharactersReviewed, readHomeWorkflowMode, saveHomeWorkflowMode } from "./home-workflow-state";
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
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);
  const [capCutDialogOpen, setCapCutDialogOpen] = useState(false);
  const [capCutInspection, setCapCutInspection] = useState<CapCutBuildInspection | null>(null);
  const [capCutResult, setCapCutResult] = useState<CapCutBuildResult | null>(null);
  const [capCutLoading, setCapCutLoading] = useState(false);
  const [capCutBuilding, setCapCutBuilding] = useState(false);
  const [capCutError, setCapCutError] = useState("");
  const [capCutSelectedProjectPath, setCapCutSelectedProjectPath] = useState("");
  const [reopenedCompletedStep, setReopenedCompletedStep] = useState("");
  const workspace = useWorkspaceData();
  const phase3Running = Boolean(
    workspace.timelineProgress &&
    !["succeeded", "failed", "cancelled"].includes(workspace.timelineProgress.status),
  );

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
  useEffect(() => {
    const timer = window.setTimeout(() => setShowLaunchSplash(false), 3_500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (phase3Running || (workspace.session?.scenes.length || 0) > 0) {
      setReopenedCompletedStep("");
    }
  }, [phase3Running, workspace.session?.id, workspace.session?.scenes.length]);
  const navigate = (next: AppPage) => {
    setReopenedCompletedStep("");
    if (next === "voice") {
      setVoiceMode("step_by_step");
      setVoiceUseCurrentSession(true);
    }
    setPage(next);
  };

  const assertSessionStopped = () => {
    const timelineBusy = Boolean(
      workspace.timelineProgress && !["succeeded", "failed", "cancelled"].includes(workspace.timelineProgress.status),
    );
    const queueBusy = Boolean(
      workspace.queue?.activeJobId || workspace.queue?.state === "running" || workspace.queue?.state === "paused",
    );
    if (!timelineBusy && !queueBusy) return;
    throw new Error("Phiên hiện tại chưa dừng. Hãy mở bảng Tiến trình và bấm “Dừng phiên” trước khi chuyển hoặc tạo phiên khác.");
  };

  const pauseActiveQueue = async () => {
    try {
      await window.flowx?.productionQueue.pauseQueue();
      await workspace.refresh();
      setToast({ tone: "success", text: "Flow sẽ tạm dừng sau công việc hiện tại." });
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
    }
  };

  const resumeActiveQueue = async () => {
    try {
      await window.flowx?.productionQueue.resumeQueue();
      await workspace.refresh();
      setToast({ tone: "success", text: "Đã tiếp tục workflow của phiên hiện tại." });
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
    }
  };

  const stopActiveSession = async () => {
    const bridge = window.flowx;
    if (!bridge) return;
    try {
      await Promise.allSettled([bridge.timeline.cancel(), bridge.sceneJobs.cancel()]);
      let snapshot = await bridge.productionQueue.stopQueue();
      const deadline = Date.now() + 12_000;
      while (snapshot.activeJobId && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        snapshot = await bridge.productionQueue.getSnapshot(snapshot.projectId);
      }
      await workspace.refresh();
      if (snapshot.activeJobId) throw new Error("Worker chưa dừng xong. Hãy chờ vài giây rồi thử lại.");
      setToast({ tone: "success", text: "Đã dừng phiên. Bây giờ có thể chuyển sang phiên khác." });
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
    }
  };

  const createSession = async (name?: string) => {
    try {
      assertSessionStopped();
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
      assertSessionStopped();
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
      if (workspace.session?.id === id) assertSessionStopped();
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
        productionKind: workspace.session.productionKind,
        screenplay: workspace.session.screenplay,
      });
      await workspace.refresh();
      setToast({ tone: "success", text: "Đã lưu trạng thái phiên." });
    } catch (error) { setToast({ tone: "error", text: cleanError(error) }); }
    finally { setSaving(false); }
  };

  const startWorkflow = async (mode: HomeWorkflowMode) => {
    const bridge = window.flowx?.timeline;
    if (!bridge) return false;
    setIntegratedHandoff(null);
    try {
      let session = workspace.session;
      if (!session) session = await bridge.createSession("Video mới");
      saveHomeWorkflowMode(session.id, mode);
      const screenplayMode = mode === "screenplay_film";
      await bridge.saveSession({
        scenes: session.scenes,
        visualBible: session.visualBible,
        styleReference: session.styleReference,
        workflowMode: mode === "full_auto" || screenplayMode ? "automatic" : "two_step",
        workflowSource: session.workflowSource,
        productionKind: screenplayMode ? "screenplay" : "narrated",
        screenplay: screenplayMode ? session.screenplay : undefined,
      });
      await workspace.refresh();
      if (screenplayMode) {
        setPage("screenplay");
        return true;
      }
      if (mode === "srt_script") {
        setPage("timeline");
        return true;
      }
      setVoiceMode(mode);
      setVoiceUseCurrentSession(true);
      setPage("voice");
      return true;
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
      return false;
    }
  };

  const renameCurrentSessionFromHome = async (name: string) => {
    const session = workspace.session;
    if (!session || !name.trim() || !window.flowx?.timeline) return false;
    const duplicate = workspace.sessions.some((item) => item.id !== session.id && item.name.trim().toLocaleLowerCase("vi-VN") === name.trim().toLocaleLowerCase("vi-VN"));
    if (duplicate) {
      setToast({ tone: "error", text: "Đã có một phiên khác sử dụng tên này." });
      return false;
    }
    try {
      await window.flowx.timeline.renameSession(session.id, name.trim());
      await workspace.refresh();
      setToast({ tone: "success", text: "Đã đổi tên phiên." });
      return true;
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
      return false;
    }
  };

  const deleteCurrentSessionFromHome = async () => {
    const session = workspace.session;
    if (!session || !window.flowx?.timeline) return false;
    try {
      assertSessionStopped();
      await window.flowx.timeline.deleteSession(session.id);
      await workspace.refresh();
      setPage("home");
      setToast({ tone: "success", text: "Đã xóa phiên làm việc." });
      return true;
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
      return false;
    }
  };

  const startConfiguredWorkflow = async () => {
    const session = workspace.session;
    if (!session) return false;
    setIntegratedHandoff({
      id: `${session.id}:home-start:${Date.now()}`,
      sessionId: session.id,
      workflowMode: session.workflowMode,
      workflowSource: session.workflowSource,
      visualBible: session.visualBible,
      styleReference: session.styleReference,
      autoGenerateTimeline: true,
      productionKind: session.productionKind,
      screenplay: session.screenplay,
    });
    setPage("timeline");
    return true;
  };

  const startActiveProduction = async () => {
    const session = workspace.session;
    const bridge = window.flowx?.productionQueue;
    if (!session || !bridge) return;
    try {
      if (workspace.queue?.state === "paused" || (workspace.queue?.state === "stopped" && workspace.queue.queuedJobs > 0)) {
        await bridge.resumeQueue();
      } else {
        await bridge.generateAllImages(session.id);
      }
      await workspace.refresh();
      setToast({ tone: "success", text: "Đã bắt đầu Production Queue." });
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
    }
  };

  const retryActiveErrors = async (sceneIds?: string[]) => {
    const session = workspace.session;
    const bridge = window.flowx?.productionQueue;
    if (!session || !bridge) return;
    const targets = sceneIds?.length
      ? sceneIds
      : [...new Set((workspace.queue?.errors || []).filter((error) => error.retryable).map((error) => error.sceneId))];
    if (!targets.length) return;
    try {
      await bridge.retryFailed(targets, session.id);
      await workspace.refresh();
      setToast({ tone: "success", text: `Đã xếp lại ${targets.length} scene lỗi.` });
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
    }
  };

  const checkWorkerConnections = async () => {
    try {
      const next = await window.flowx?.workers.getStatuses();
      if (next) setStatuses(next);
      await workspace.refresh();
      setToast({ tone: "success", text: "Đã cập nhật trạng thái kết nối worker." });
    } catch (error) {
      setToast({ tone: "error", text: cleanError(error) });
    }
  };

  const openSceneFromHome = (sceneId: string) => {
    const session = workspace.session;
    if (session) localStorage.setItem(`kc-auto-tool:selected-scene:${session.id}`, sceneId);
    setPage("timeline");
  };

  const openCapCutBuild = async () => {
    if (!workspace.session || !window.flowx?.capcut) return;
    setCapCutDialogOpen(true);
    setCapCutInspection(null);
    setCapCutResult(null);
    setCapCutError("");
    setCapCutLoading(true);
    try {
      const inspection = await window.flowx.capcut.inspectBuild(workspace.session);
      setCapCutInspection(inspection);
      setCapCutSelectedProjectPath(inspection.selectedProjectPath);
    } catch (error) {
      setCapCutError(cleanError(error));
    } finally {
      setCapCutLoading(false);
    }
  };

  const selectCapCutProject = async (targetProjectPath: string) => {
    if (!workspace.session || !window.flowx?.capcut) return;
    setCapCutSelectedProjectPath(targetProjectPath);
    setCapCutError("");
    setCapCutLoading(true);
    try {
      setCapCutInspection(await window.flowx.capcut.inspectBuild(workspace.session, targetProjectPath));
    } catch (error) {
      setCapCutError(cleanError(error));
    } finally {
      setCapCutLoading(false);
    }
  };

  const confirmCapCutBuild = async () => {
    if (!workspace.session || !window.flowx?.capcut || !capCutInspection?.ready) return;
    setCapCutBuilding(true);
    setCapCutError("");
    try {
      const result = await window.flowx.capcut.buildTimeline(workspace.session, {
        replaceExisting: capCutInspection.existingVideoSegments > 0,
        targetProjectPath: capCutSelectedProjectPath || capCutInspection.selectedProjectPath,
      });
      setCapCutResult(result);
      setToast({ tone: "success", text: `Đã dựng ${result.sceneCount} scene vào CapCut ${result.targetProjectName}.` });
    } catch (error) {
      setCapCutError(cleanError(error));
    } finally {
      setCapCutBuilding(false);
    }
  };

  const timelineKey = `${workspace.session?.id || "none"}:${page}`;
  const completedSetupStep = (["voice", "characters", "visual-bible"] as const).includes(page as CompletedSetupStepKind)
    ? page as CompletedSetupStepKind
    : null;
  const completedStepKey = completedSetupStep && workspace.session
    ? `${workspace.session.id}:${completedSetupStep}`
    : "";
  const protectCompletedStep = Boolean(
    completedSetupStep &&
    workspace.session &&
    (workspace.session.scenes.length > 0 || phase3Running) &&
    reopenedCompletedStep !== completedStepKey,
  );
  let content;
  if (protectCompletedStep && completedSetupStep && workspace.session) {
    content = <CompletedSetupStep kind={completedSetupStep} session={workspace.session} phase3Running={phase3Running} onKeep={() => navigate("timeline")} onRedo={() => setReopenedCompletedStep(completedStepKey)} />;
  } else if (page === "home") {
    content = <DashboardView session={workspace.session} queue={workspace.queue} output={workspace.output} workers={statuses} onStartWorkflow={startWorkflow} onStartConfiguredWorkflow={startConfiguredWorkflow} onRenameSession={renameCurrentSessionFromHome} onDeleteSession={deleteCurrentSessionFromHome} onNavigate={navigate} onOpenScene={openSceneFromHome} onStartProduction={startActiveProduction} onPause={pauseActiveQueue} onResume={resumeActiveQueue} onStop={stopActiveSession} onRetry={retryActiveErrors} onBuildVideo={() => void openCapCutBuild()} onCheckConnections={checkWorkerConnections} />;
  } else if (page === "sessions") {
    content = <SessionsView sessions={workspace.sessions} queues={workspace.sessionQueues} onCreate={() => void createSession()} onOpen={(id) => void selectSession(id)} onRename={(id) => void renameSession(id)} onDelete={(id) => void deleteSession(id)} />;
  } else if (page === "voice") {
    content = <VoiceWorkflow key={voiceUseCurrentSession ? workspace.session?.id || "voice" : `new:${voiceMode}`} mode={voiceMode} session={voiceUseCurrentSession ? workspace.session : null} onBack={() => setPage("home")} onComplete={(handoff) => { setIntegratedHandoff(handoff); setPage("characters"); void workspace.refresh(); }} />;
  } else if (page === "screenplay") {
    content = <ScreenplayStudio session={workspace.session} onSaved={() => void workspace.refresh()} onBack={() => setPage("home")} onContinue={() => { if (workspace.session) markHomeCharactersReviewed(workspace.session.id, false); setPage("characters"); }} />;
  } else if (page === "visual-bible") {
    content = <VisualBibleWorkspace session={workspace.session} onSaved={() => void workspace.refresh()} onBack={() => setPage("characters")} onOpenCharacters={() => setPage("characters")} onContinue={() => setPage("timeline")} />;
  } else if (page === "characters") {
    content = <CharacterLibrary workflowStep onBack={() => setPage(readHomeWorkflowMode(workspace.session) === "screenplay_film" ? "screenplay" : "voice")} onContinue={() => { if (workspace.session) markHomeCharactersReviewed(workspace.session.id); setPage("visual-bible"); }} />;
  } else if (page === "output") {
    content = <OutputLibrary inspection={workspace.output} session={workspace.session} />;
  } else if (page === "settings") {
    content = <SettingsView workers={statuses} system={workspace.system} onRefresh={() => void workspace.refresh()} />;
  } else if (page === "queue") {
    content = <div className="kc-queue-workspace"><ChatGPTWorkerPanel session={workspace.session} workers={statuses} queue={workspace.queue} onNavigate={navigate} /><GoogleFlowWorkerPanel session={workspace.session} workers={statuses} queue={workspace.queue} onNavigate={navigate} /><OutputLibrary inspection={workspace.output} session={workspace.session} compact /></div>;
  } else if (page === "edit") {
    content = <CapCutBuildPage session={workspace.session} onBuild={() => void openCapCutBuild()} />;
  } else {
    content = <TimelineImport key={timelineKey} chatConnected={statuses["chat-worker"].connected} flowConnected={statuses["flow-worker"].connected} integratedHandoff={integratedHandoff} onIntegratedHandoffConsumed={() => { setIntegratedHandoff(null); void workspace.refresh(); }} onWorkflowReady={() => { setReopenedCompletedStep(""); void workspace.refresh(); }} onBack={() => setPage("visual-bible")} onBuildVideo={() => void openCapCutBuild()} />;
  }

  const showQueuePanel = page !== "timeline" && page !== "home" && page !== "edit";
  return (
    <AppShell page={page} collapsed={sidebarCollapsed} queueOpen={showQueuePanel && queueOpen} saving={saving} online={online} session={workspace.session} sessions={workspace.sessions} sessionQueues={workspace.sessionQueues} queue={workspace.queue} workers={statuses} system={workspace.system} timelineProgress={workspace.timelineProgress} onNavigate={navigate} onCreateSession={() => void createSession()} onSelectSession={(id) => void selectSession(id)} onRenameSession={(id) => void renameSession(id)} onDeleteSession={(id) => void deleteSession(id)} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} onToggleQueue={() => setQueueOpen((value) => !value)} onSave={() => void saveState()} onBuildVideo={() => void openCapCutBuild()} onPauseQueue={pauseActiveQueue} onResumeQueue={resumeActiveQueue} onStopSession={stopActiveSession}>
      {workspace.loading ? <div className="kc-loading-screen"><span /><strong>Đang khôi phục phiên KC Auto Tool…</strong></div> : content}
      {toast && <div className={`kc-toast is-${toast.tone}`} role="status">{toast.text}</div>}
      {showLaunchSplash && <LaunchSplash onContinue={() => setShowLaunchSplash(false)} />}
      {capCutDialogOpen && <CapCutBuildDialog inspection={capCutInspection} result={capCutResult} loading={capCutLoading} building={capCutBuilding} error={capCutError} onClose={() => { if (!capCutBuilding) setCapCutDialogOpen(false); }} onConfirm={() => void confirmCapCutBuild()} onSelectProject={(projectPath) => void selectCapCutProject(projectPath)} onRefresh={() => void selectCapCutProject(capCutSelectedProjectPath)} />}
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
