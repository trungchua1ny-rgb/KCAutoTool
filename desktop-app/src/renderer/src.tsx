import { ListVideo, RadioTower, UsersRound } from "lucide-react";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDisconnectedStatuses,
  type WorkerConnectionStatus,
  type WorkerStatuses,
} from "../shared/worker-status";
import { CharacterLibrary } from "./CharacterLibrary";
import { TimelineImport } from "./TimelineImport";
import "./style.css";

type AppView = "timeline" | "characters" | "connections";

const WORKER_LABELS = {
  "chat-worker": { name: "ChatGPT", role: "Chat worker" },
  "flow-worker": { name: "Google Flow", role: "Flow worker" },
} as const;

function WorkerRow({ worker }: { worker: WorkerConnectionStatus }) {
  const label = WORKER_LABELS[worker.role];

  return (
    <article className="worker-row">
      <div
        className={`status-dot ${worker.connected ? "is-connected" : ""}`}
        aria-hidden="true"
      />
      <div className="worker-identity">
        <h3>{label.name}</h3>
        <p>{label.role}</p>
      </div>
      <div className="worker-state">
        <strong>{worker.connected ? "Đã kết nối" : "Đang chờ"}</strong>
        <span>{worker.profileTag || "Chưa có worker"}</span>
      </div>
    </article>
  );
}

function ConnectionsView({ statuses }: { statuses: WorkerStatuses }) {
  const connectedCount = Object.values(statuses).filter(
    (status) => status.connected,
  ).length;

  return (
    <section className="worker-panel" aria-live="polite">
      <header className="section-header">
        <div>
          <p className="eyebrow">Kết nối cục bộ</p>
          <h2>Workers</h2>
        </div>
        <div className="connection-total">
          <span>{connectedCount}</span>/2 online
        </div>
      </header>
      <div className="worker-list">
        <WorkerRow worker={statuses["chat-worker"]} />
        <WorkerRow worker={statuses["flow-worker"]} />
      </div>
    </section>
  );
}

function App() {
  const [view, setView] = useState<AppView>("timeline");
  const [statuses, setStatuses] = useState<WorkerStatuses>(() =>
    createDisconnectedStatuses(),
  );

  useEffect(() => {
    const bridge = window.flowx;
    if (!bridge) return undefined;

    let active = true;
    const unsubscribe = bridge.workers.onStatusChange((nextStatuses) => {
      if (active) setStatuses(nextStatuses);
    });

    void bridge.workers
      .getStatuses()
      .then((nextStatuses) => {
        if (active && nextStatuses) setStatuses(nextStatuses);
      })
      .catch((error) => console.error("Cannot read worker statuses", error));

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const connectedCount = useMemo(
    () => Object.values(statuses).filter((status) => status.connected).length,
    [statuses],
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">KC</div>
          <h1>KC Auto Tool</h1>
          <span className="phase-label">KC Dev</span>
        </div>
        <nav className="view-tabs" aria-label="Màn hình">
          <button
            type="button"
            className={view === "timeline" ? "is-active" : ""}
            aria-selected={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            <ListVideo size={16} aria-hidden="true" />
            Timeline
          </button>
          <button
            type="button"
            className={view === "characters" ? "is-active" : ""}
            aria-selected={view === "characters"}
            onClick={() => setView("characters")}
          >
            <UsersRound size={16} aria-hidden="true" />
            Nhân vật
          </button>
          <button
            type="button"
            className={view === "connections" ? "is-active" : ""}
            aria-selected={view === "connections"}
            onClick={() => setView("connections")}
          >
            <RadioTower size={16} aria-hidden="true" />
            Kết nối
            <span className="tab-count">{connectedCount}/2</span>
          </button>
        </nav>
      </header>

      <div className="workspace">
        {view === "timeline" ? (
          <TimelineImport
            chatConnected={statuses["chat-worker"].connected}
            flowConnected={statuses["flow-worker"].connected}
          />
        ) : view === "characters" ? (
          <CharacterLibrary />
        ) : (
          <ConnectionsView statuses={statuses} />
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
