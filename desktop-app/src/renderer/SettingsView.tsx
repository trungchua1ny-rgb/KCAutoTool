import { CheckCircle2, Cpu, ExternalLink, HardDrive, RadioTower, RefreshCcw, ShieldCheck } from "lucide-react";
import type { SystemStatus } from "../shared/system";
import type { WorkerStatuses } from "../shared/worker-status";

function gb(bytes: number): string { return `${(bytes / 1024 ** 3).toFixed(1)} GB`; }

export function SettingsView({ workers, system, onRefresh }: { workers: WorkerStatuses; system: SystemStatus | null; onRefresh: () => void }) {
  return (
    <section className="kc-settings-view">
      <header className="kc-section-heading"><div><span>LOCAL AUTOMATION</span><h2>Kết nối & hệ thống</h2><p>KC Auto Tool chỉ nhận worker qua WebSocket cục bộ 127.0.0.1.</p></div><button type="button" onClick={onRefresh}><RefreshCcw size={14} /> Làm mới</button></header>
      <div className="kc-settings-grid">
        {Object.values(workers).map((worker) => <article key={worker.role}><div className={`kc-settings-icon ${worker.connected ? "is-online" : ""}`}><RadioTower size={19} /></div><div><strong>{worker.role === "chat-worker" ? "ChatGPT Worker" : "Google Flow Worker"}</strong><span>{worker.connected ? "Đã kết nối" : "Chưa kết nối"}</span><small>{worker.profileTag || "Chưa có profileTag"}</small></div>{worker.connected && <CheckCircle2 size={17} />}</article>)}
      </div>
      <div className="kc-system-card">
        <header><ShieldCheck size={18} /><div><strong>Trạng thái ứng dụng</strong><span>Dữ liệu thực từ Electron main process</span></div></header>
        <div><span><Cpu size={15} /> CPU</span><b>{system?.cpuPercent === null || !system ? "N/A" : `${system.cpuPercent.toFixed(1)}%`}</b></div>
        <div><span><HardDrive size={15} /> RAM</span><b>{system ? `${gb(system.ramUsedBytes)} / ${gb(system.ramTotalBytes)}` : "N/A"}</b></div>
        <div><span><HardDrive size={15} /> GPU</span><b>{system?.gpuPercent === null || !system ? "Không có telemetry" : `${system.gpuPercent.toFixed(1)}%`}</b></div>
        <div><span>Phiên bản</span><b>KC Auto Tool v{system?.appVersion || "…"}</b></div>
      </div>
      <div className="kc-settings-help"><p>Để kết nối, mở ChatGPT và Google Flow trong Chrome profile có extension KC Dev phiên bản phù hợp.</p><div><button type="button" onClick={() => window.open("https://chatgpt.com", "_blank")}><ExternalLink size={14} /> Mở ChatGPT</button><button type="button" onClick={() => window.open("https://labs.google/fx/tools/flow", "_blank")}><ExternalLink size={14} /> Mở Google Flow</button></div></div>
    </section>
  );
}
