import { Bell, Check, Play, Search, Settings, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineSessionSummary } from "../shared/timeline";
import { PAGE_COPY, type AppPage } from "./app-navigation";

const SEARCHABLE_PAGES: AppPage[] = [
  "home", "sessions", "voice", "visual-bible", "characters", "timeline", "queue", "output", "settings",
];

export function TopHeader({
  page,
  sessionName,
  sessions,
  errorCount,
  saving,
  onNavigate,
  onSave,
  onSelectSession,
}: {
  page: AppPage;
  sessionName: string;
  sessions: TimelineSessionSummary[];
  errorCount: number;
  saving: boolean;
  onNavigate: (page: AppPage) => void;
  onSave: () => void;
  onSelectSession: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const copy = PAGE_COPY[page];
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const results = useMemo(() => {
    const folded = query.trim().toLocaleLowerCase("vi-VN");
    if (!folded) return [];
    return [
      ...SEARCHABLE_PAGES.filter((candidate) =>
        `${PAGE_COPY[candidate].title} ${PAGE_COPY[candidate].description}`.toLocaleLowerCase("vi-VN").includes(folded)
      ).map((candidate) => ({ id: `page:${candidate}`, label: PAGE_COPY[candidate].title, kind: "Màn hình", run: () => onNavigate(candidate) })),
      ...sessions.filter((session) => session.name.toLocaleLowerCase("vi-VN").includes(folded))
        .map((session) => ({ id: `session:${session.id}`, label: session.name, kind: "Phiên", run: () => onSelectSession(session.id) })),
    ].slice(0, 7);
  }, [query, sessions, onNavigate, onSelectSession]);

  return (
    <header className="kc-top-header">
      <div className="kc-page-heading">
        <span>{sessionName || "Chưa có phiên"}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </div>
      <div className="kc-header-actions">
        <button className="kc-header-save" type="button" onClick={onSave} disabled={saving}>
          <Check size={15} /> {saving ? "Đang lưu" : "Lưu trạng thái"}
        </button>
        <button className="kc-header-continue" type="button" onClick={() => onNavigate("timeline")}>
          <Play size={14} /> Tiếp tục dự án
        </button>
        <div className="kc-search">
          <Search size={15} />
          <input ref={searchRef} value={query} placeholder="Tìm kiếm…" onChange={(event) => setQuery(event.target.value)} />
          <kbd>Ctrl K</kbd>
          {results.length > 0 && (
            <div className="kc-search-results">
              {results.map((result) => (
                <button key={result.id} type="button" onClick={() => { result.run(); setQuery(""); }}>
                  <span>{result.label}</span><small>{result.kind}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="kc-header-icon" type="button" title="Thông báo lỗi" onClick={() => onNavigate("queue")}>
          <Bell size={17} />{errorCount > 0 && <b>{errorCount}</b>}
        </button>
        <button className="kc-header-icon" type="button" title="Cài đặt" onClick={() => onNavigate("settings")}><Settings size={17} /></button>
        <div className="kc-user-avatar" title="Hồ sơ cục bộ"><UserRound size={17} /></div>
      </div>
    </header>
  );
}
