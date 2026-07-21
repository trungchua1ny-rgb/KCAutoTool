import {
  CheckCircle2,
  Cpu,
  ExternalLink,
  FolderOpen,
  HardDrive,
  RadioTower,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { SystemStatus } from "../shared/system";
import type { WorkerStatuses } from "../shared/worker-status";

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function SettingsView({
  workers,
  system,
  onRefresh,
}: {
  workers: WorkerStatuses;
  system: SystemStatus | null;
  onRefresh: () => void;
}) {
  const [extensionMessage, setExtensionMessage] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [pendingStorageRoot, setPendingStorageRoot] = useState("");
  const openExtensionFolder = async () => {
    const error = await window.flowx?.system.openExtensionFolder();
    setExtensionMessage(
      error || "Đã mở thư mục KC Dev. Trong Chrome, hãy chọn Tải tiện ích đã giải nén và chọn thư mục này.",
    );
  };
  const openStorage = async (target: "root" | "data" | "outputs") => {
    const error = await window.flowx?.system.openStorage(target);
    setStorageMessage(error || "Đã mở thư mục lưu trữ trên máy.");
  };
  const selectStorage = async () => {
    const result = await window.flowx?.system.selectStorage();
    if (!result?.selected) return;
    if (!result.restartRequired) {
      setStorageMessage("Thư mục này đang được sử dụng.");
      return;
    }
    setPendingStorageRoot(result.rootPath);
    setStorageMessage(`Đã chọn ${result.rootPath}. Hãy khởi động lại để chuyển dữ liệu.`);
  };
  const restart = () => {
    if (!window.confirm("Khởi động lại KC Auto Tool và chuyển dữ liệu sang nơi lưu mới?")) return;
    void window.flowx?.system.restart();
  };

  return (
    <section className="kc-settings-view">
      <header className="kc-section-heading">
        <div>
          <span>LOCAL AUTOMATION</span>
          <h2>Kết nối & hệ thống</h2>
          <p>KC Auto Tool chỉ nhận worker qua WebSocket cục bộ 127.0.0.1.</p>
        </div>
        <button type="button" onClick={onRefresh}><RefreshCcw size={14} /> Làm mới</button>
      </header>

      <div className="kc-settings-grid">
        {Object.values(workers).map((worker) => (
          <article key={worker.role}>
            <div className={`kc-settings-icon ${worker.connected ? "is-online" : ""}`}><RadioTower size={19} /></div>
            <div>
              <strong>{worker.role === "chat-worker" ? "ChatGPT Worker" : "Google Flow Worker"}</strong>
              <span>{worker.connected ? "Đã kết nối" : "Chưa kết nối"}</span>
              <small>{worker.profileTag || "Chưa có profileTag"}</small>
            </div>
            {worker.connected && <CheckCircle2 size={17} />}
          </article>
        ))}
      </div>

      <div className="kc-system-card">
        <header><ShieldCheck size={18} /><div><strong>Trạng thái ứng dụng</strong><span>Dữ liệu thực từ Electron main process</span></div></header>
        <div><span><Cpu size={15} /> CPU</span><b>{system?.cpuPercent === null || !system ? "N/A" : `${system.cpuPercent.toFixed(1)}%`}</b></div>
        <div><span><HardDrive size={15} /> RAM</span><b>{system ? `${gb(system.ramUsedBytes)} / ${gb(system.ramTotalBytes)}` : "N/A"}</b></div>
        <div><span><HardDrive size={15} /> GPU</span><b>{system?.gpuPercent === null || !system ? "Không có telemetry" : `${system.gpuPercent.toFixed(1)}%`}</b></div>
        <div><span>FFmpeg</span><b className={system?.ffmpegAvailable ? "is-ready" : "is-missing"}>{system?.ffmpegAvailable ? "Đã sẵn sàng" : "Chưa cài"}</b></div>
        <div><span>Phiên bản</span><b>KC Auto Tool v{system?.appVersion || "…"}</b></div>
      </div>

      <div className="kc-extension-setup kc-storage-setup">
        <div>
          <strong>Lưu trữ tập trung</strong>
          <span>Dữ liệu dự án và media đầu ra được tách khỏi ổ hệ thống. Máy có ổ D mặc định dùng D:\KC Auto Tool.</span>
        </div>
        <div className="kc-storage-paths">
          <p><b>Thư mục gốc</b><code>{system?.storageRoot || "Đang kiểm tra…"}</code></p>
          <p><b>Dữ liệu phiên</b><code>{system?.dataRoot || "Đang kiểm tra…"}</code></p>
          <p><b>Ảnh, video, audio</b><code>{system?.outputRoot || "Đang kiểm tra…"}</code></p>
        </div>
        <div className="kc-storage-actions">
          <button type="button" disabled={!system} onClick={() => void selectStorage()}><HardDrive size={14} /> Chọn nơi lưu</button>
          <button type="button" disabled={!system} onClick={() => void openStorage("root")}><FolderOpen size={14} /> Mở thư mục gốc</button>
          <button type="button" disabled={!system} onClick={() => void openStorage("data")}><FolderOpen size={14} /> Mở dữ liệu</button>
          <button type="button" disabled={!system} onClick={() => void openStorage("outputs")}><FolderOpen size={14} /> Mở đầu ra</button>
        </div>
        {pendingStorageRoot && <button className="kc-storage-restart" type="button" onClick={restart}><RefreshCcw size={14} /> Khởi động lại và chuyển dữ liệu</button>}
        <p className="kc-storage-note">Có thể ghi đè vị trí bằng biến môi trường <code>KC_AUTO_TOOL_STORAGE_ROOT</code>; thay đổi có hiệu lực sau khi khởi động lại app.</p>
        {storageMessage && <p>{storageMessage}</p>}
      </div>

      <div className="kc-extension-setup">
        <div><strong>KC Dev Extension</strong><span>Được đóng gói cùng ứng dụng. Chrome vẫn yêu cầu xác nhận cài đặt một lần.</span></div>
        <ol>
          <li>Mở <code>chrome://extensions</code>.</li>
          <li>Bật <b>Chế độ dành cho nhà phát triển</b>.</li>
          <li>Chọn <b>Tải tiện ích đã giải nén</b> và chọn thư mục KC Dev vừa mở.</li>
        </ol>
        <button type="button" onClick={() => void openExtensionFolder()}><FolderOpen size={14} /> Mở thư mục Extension</button>
        {extensionMessage && <p>{extensionMessage}</p>}
      </div>

      {!system?.ffmpegAvailable && (
        <div className="kc-ffmpeg-notice">
          <div><strong>Cần FFmpeg để trích frame cuối</strong><span>Cài FFmpeg riêng từ nguồn chính thức, sau đó khởi động lại KC Auto Tool.</span></div>
          <button type="button" onClick={() => window.open("https://ffmpeg.org/download.html", "_blank")}><ExternalLink size={14} /> Trang tải FFmpeg</button>
        </div>
      )}

      <div className="kc-settings-help">
        <p>Để kết nối, mở ChatGPT và Google Flow trong Chrome profile có extension KC Dev phù hợp.</p>
        <div>
          <button type="button" onClick={() => window.open("https://chatgpt.com", "_blank")}><ExternalLink size={14} /> Mở ChatGPT</button>
          <button type="button" onClick={() => window.open("https://labs.google/fx/tools/flow", "_blank")}><ExternalLink size={14} /> Mở Google Flow</button>
        </div>
      </div>
    </section>
  );
}
