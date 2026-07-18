import {
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clapperboard,
  FileOutput,
  House,
  Images,
  ListChecks,
  MoreHorizontal,
  Palette,
  Plus,
  Settings,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { SystemStatus } from "../shared/system";
import type { TimelineSessionSummary } from "../shared/timeline";
import type { AppPage } from "./app-navigation";

const NAVIGATION: Array<{ page: AppPage; label: string; icon: typeof House }> = [
  { page: "home", label: "Trang chủ", icon: House },
  { page: "sessions", label: "Phiên làm việc", icon: CircleUserRound },
  { page: "voice", label: "Voice Studio", icon: AudioWaveform },
  { page: "visual-bible", label: "Visual Bible", icon: Palette },
  { page: "characters", label: "Nhân vật", icon: UsersRound },
  { page: "timeline", label: "Timeline & Prompt", icon: Clapperboard },
  { page: "queue", label: "Production Queue", icon: ListChecks },
  { page: "output", label: "Xuất dữ liệu", icon: FileOutput },
  { page: "settings", label: "Cài đặt", icon: Settings },
];

function formatStorage(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function sessionStatus(
  summary: TimelineSessionSummary,
  snapshot: ProductionQueueSnapshot | undefined,
): { label: string; tone: string } {
  if (snapshot?.errors.length) return { label: "Lỗi", tone: "error" };
  if (snapshot?.state === "running") return { label: "Đang sản xuất", tone: "running" };
  if (snapshot?.state === "paused" || snapshot?.state === "stopped") {
    return { label: "Tạm dừng", tone: "paused" };
  }
  if (snapshot?.queuedJobs) return { label: "Đang chờ", tone: "waiting" };
  if (summary.sceneCount > 0 && snapshot?.scenes.length && snapshot.scenes.every((scene) => Boolean(scene.videoAssetPath))) {
    return { label: "Hoàn thành", tone: "complete" };
  }
  if (summary.sceneCount > 0) return { label: "Đang phân tích", tone: "analysis" };
  return { label: "Đang chờ", tone: "waiting" };
}

export function Sidebar({
  page,
  collapsed,
  sessions,
  sessionQueues,
  system,
  errorCount,
  onNavigate,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onToggleCollapsed,
}: {
  page: AppPage;
  collapsed: boolean;
  sessions: TimelineSessionSummary[];
  sessionQueues: Record<string, ProductionQueueSnapshot>;
  system: SystemStatus | null;
  errorCount: number;
  onNavigate: (page: AppPage) => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onToggleCollapsed: () => void;
}) {
  const [menuSessionId, setMenuSessionId] = useState("");
  const diskUsed = system?.diskTotalBytes && system.diskFreeBytes !== null
    ? Math.max(0, system.diskTotalBytes - system.diskFreeBytes)
    : 0;
  const diskPercent = system?.diskTotalBytes
    ? Math.min(100, (diskUsed / system.diskTotalBytes) * 100)
    : 0;

  return (
    <aside className={`kc-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="kc-brand-block">
        <div className="kc-logo" aria-hidden="true"><Images size={19} /></div>
        {!collapsed && <div><strong>KC Auto Tool</strong><span>AI Video Production Automation</span></div>}
      </div>

      <button className="kc-new-session" type="button" onClick={onCreateSession} title="Tạo phiên mới">
        <Plus size={17} />{!collapsed && <span>Tạo phiên mới</span>}
      </button>

      <nav className="kc-nav" aria-label="Điều hướng chính">
        {NAVIGATION.map((item) => {
          const Icon = item.icon;
          const badge = item.page === "queue" && errorCount > 0 ? errorCount : 0;
          return (
            <button
              key={item.page}
              type="button"
              className={page === item.page ? "is-active" : ""}
              aria-current={page === item.page ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.page)}
            >
              <Icon size={17} />
              {!collapsed && <span>{item.label}</span>}
              {badge > 0 && <b>{badge}</b>}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <section className="kc-session-section">
          <header>PHIÊN LÀM VIỆC</header>
          <div className="kc-session-list">
            {sessions.slice(0, 7).map((summary) => {
              const status = sessionStatus(summary, sessionQueues[summary.id]);
              const errors = sessionQueues[summary.id]?.errors.length || 0;
              return (
                <article key={summary.id} className={summary.active ? "is-active" : ""}>
                  <button className="kc-session-main" type="button" onClick={() => onSelectSession(summary.id)}>
                    <span className={`kc-status-dot is-${status.tone}`} />
                    <span><strong>{summary.name}</strong><small>{status.label}</small></span>
                    {errors > 0 && <b>{errors}</b>}
                  </button>
                  <button
                    className="kc-session-more"
                    type="button"
                    aria-label={`Thao tác ${summary.name}`}
                    onClick={() => setMenuSessionId((current) => current === summary.id ? "" : summary.id)}
                  ><MoreHorizontal size={15} /></button>
                  {menuSessionId === summary.id && (
                    <div className="kc-session-menu">
                      <button type="button" onClick={() => { onSelectSession(summary.id); setMenuSessionId(""); }}>Mở phiên</button>
                      <button type="button" onClick={() => { onRenameSession(summary.id); setMenuSessionId(""); }}>Đổi tên</button>
                      <button type="button" className="is-danger" onClick={() => { onDeleteSession(summary.id); setMenuSessionId(""); }}>Xóa phiên</button>
                    </div>
                  )}
                </article>
              );
            })}
            {!sessions.length && <p>Chưa có phiên.</p>}
          </div>
        </section>
      )}

      <div className="kc-sidebar-footer">
        {!collapsed && (
          <div className="kc-storage">
            <div><span>Dung lượng ổ đĩa</span><strong>{diskPercent.toFixed(0)}%</strong></div>
            <i><span style={{ width: `${diskPercent}%` }} /></i>
            <small>{formatStorage(diskUsed)} / {formatStorage(system?.diskTotalBytes || 0)}</small>
          </div>
        )}
        <button className="kc-collapse" type="button" onClick={onToggleCollapsed} title={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
