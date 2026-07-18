import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Circle,
  ExternalLink,
  FileJson,
  LoaderCircle,
  Pause,
  Play,
  RadioTower,
  RefreshCcw,
  Square,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { TimelineSession } from "../shared/timeline";
import type { WorkerStatuses } from "../shared/worker-status";
import type { AppPage } from "./app-navigation";

type TaskState = "idle" | "waiting" | "running" | "done" | "error" | "skipped";

function StateIcon({ state }: { state: TaskState }) {
  if (state === "done") return <Check size={12} />;
  if (state === "running") return <LoaderCircle className="spin" size={12} />;
  if (state === "error") return <AlertTriangle size={12} />;
  return <Circle size={9} />;
}

function stateLabel(state: TaskState): string {
  return state === "done" ? "Hoàn thành" : state === "running" ? "Đang xử lý" : state === "error" ? "Lỗi" : state === "waiting" ? "Đang chờ" : state === "skipped" ? "Đã bỏ qua" : "Chưa chạy";
}

export function ChatGPTWorkerPanel({ session, workers, queue, onNavigate }: {
  session: TimelineSession | null;
  workers: WorkerStatuses;
  queue: ProductionQueueSnapshot | null;
  onNavigate: (page: AppPage) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const scenes = session?.scenes || [];
  const hasScenes = scenes.length > 0;
  const bibleReady = Boolean(session && Object.values(session.visualBible).every(Boolean));
  const hasCharacters = scenes.some((scene) => scene.assignedCharacterTokens.length > 0);
  const policyError = queue?.errors.some((error) => error.category === "flow_policy_violation") || false;
  const connected = workers["chat-worker"].connected;
  const tasks: Array<{ label: string; state: TaskState }> = [
    { label: "Phân tích SRT và kịch bản", state: hasScenes ? "done" : connected ? "idle" : "waiting" },
    { label: "Điền Visual Bible còn thiếu", state: bibleReady ? "done" : hasScenes ? "waiting" : "idle" },
    { label: "Phát hiện nhân vật xuất hiện nhiều lần", state: hasScenes ? hasCharacters ? "done" : "skipped" : "idle" },
    { label: "Chia timeline thành scene 4s, 6s hoặc 8s", state: hasScenes ? "done" : "idle" },
    { label: "Phân loại single, start và continue", state: hasScenes ? "done" : "idle" },
    { label: "Viết prompt ảnh", state: scenes.some((scene) => scene.imagePrompt) ? "done" : "idle" },
    { label: "Viết prompt video", state: scenes.some((scene) => scene.videoPrompt) ? "done" : "idle" },
    { label: "Kiểm tra tính liên tục", state: hasScenes && scenes.every((scene, index) => index === 0 || scene.timeStart === scenes[index - 1].timeEnd) ? "done" : "idle" },
    { label: "Sửa prompt bị Google Flow từ chối", state: policyError ? "error" : "idle" },
    { label: "Kiểm tra đầu ra JSON", state: hasScenes ? "done" : "idle" },
    { label: "Lưu prompt vào phiên làm việc", state: hasScenes && Boolean(session?.savedAt) ? "done" : "idle" },
  ];
  return (
    <section className="kc-worker-panel">
      <header><div className="kc-worker-title"><Bot size={18} /><div><span>AI ORCHESTRATOR</span><h3>ChatGPT Worker</h3></div></div><b className={connected ? "is-online" : "is-offline"}><span />{connected ? "Sẵn sàng" : "Chưa kết nối"}</b></header>
      <div className="kc-worker-task-list">
        {tasks.map((task) => <div key={task.label} className={`is-${task.state}`}><span><StateIcon state={task.state} /></span><strong>{task.label}</strong><small>{stateLabel(task.state)}</small>{task.state === "error" && <button type="button" onClick={() => onNavigate("timeline")}><RefreshCcw size={12} /></button>}</div>)}
      </div>
      <footer><button type="button" onClick={() => void window.flowx?.timeline.cancel()}><Square size={13} /> Dừng</button><button type="button" onClick={() => setLogOpen((value) => !value)}><FileJson size={13} /> Xem trạng thái</button></footer>
      {logOpen && <div className="kc-worker-log">Worker: {workers["chat-worker"].profileTag || "chưa đăng ký"}<br />Scene đã lưu: {scenes.length}<br />Visual Bible: {bibleReady ? "đủ 4 nhóm" : "chưa đầy đủ"}</div>}
    </section>
  );
}

export function GoogleFlowWorkerPanel({ session, workers, queue, onNavigate }: {
  session: TimelineSession | null;
  workers: WorkerStatuses;
  queue: ProductionQueueSnapshot | null;
  onNavigate: (page: AppPage) => void;
}) {
  const connected = workers["flow-worker"].connected;
  const active = Boolean(queue?.activeJobId);
  const failed = Boolean(queue?.errors.length);
  const lastJobSucceeded = useMemo(() => [...(queue?.jobs || [])].reverse().some((job) => job.status === "succeeded"), [queue?.jobs]);
  const steps = [
    "Chọn chế độ ảnh hoặc video", "Chọn tỷ lệ 16:9", "Thiết lập thời lượng 4s, 6s hoặc 8s", "Upload ảnh nhân vật", "Upload ảnh scene", "Upload frame cuối video trước", "Dán prompt", "Gửi render", "Theo dõi trạng thái", "Tải kết quả", "Lưu đúng thư mục phiên", "Trích xuất frame cuối", "Dùng frame cho scene continue tiếp theo",
  ];
  const stateFor = (index: number): TaskState => {
    if (!queue?.jobs.length) return connected ? "idle" : "waiting";
    if (failed && !active) return index === 8 ? "error" : "waiting";
    if (active) return index === 0 ? "running" : "waiting";
    return lastJobSucceeded ? "done" : "idle";
  };
  const bridge = window.flowx?.productionQueue;
  return (
    <section className="kc-worker-panel is-flow">
      <header><div className="kc-worker-title"><RadioTower size={18} /><div><span>BROWSER AUTOMATION</span><h3>Google Flow Worker</h3></div></div><b className={failed ? "is-error" : connected ? "is-online" : "is-offline"}><span />{failed ? "Cần xử lý" : active ? "Đang thao tác" : connected ? "Sẵn sàng" : "Extension chưa kết nối"}</b></header>
      <div className="kc-flow-steps">
        {steps.map((label, index) => { const state = stateFor(index); return <div key={label} className={`is-${state}`}><span>{index + 1}</span><p>{label}</p><StateIcon state={state} />{index < steps.length - 1 && <ChevronRight size={11} />}</div>; })}
      </div>
      <footer className="kc-flow-actions">
        <button type="button" onClick={() => onNavigate("settings")}><RadioTower size={13} /> Kiểm tra tab</button>
        <button type="button" onClick={() => onNavigate("timeline")}><Play size={13} /> Chạy scene</button>
        {queue?.state === "running" ? <button type="button" onClick={() => bridge && void bridge.pauseQueue()}><Pause size={13} /> Tạm dừng</button> : <button type="button" onClick={() => bridge && void bridge.resumeQueue()}><Play size={13} /> Tiếp tục</button>}
        <button type="button" onClick={() => onNavigate("queue")}><FileJson size={13} /> Xem log</button>
        <button type="button" onClick={() => window.open("https://labs.google/fx/tools/flow", "_blank")}><ExternalLink size={13} /> Mở Flow</button>
      </footer>
      {!session && <p className="kc-worker-note">Chưa có phiên để chạy Google Flow.</p>}
    </section>
  );
}
