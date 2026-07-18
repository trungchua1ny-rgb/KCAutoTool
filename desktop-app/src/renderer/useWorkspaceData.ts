import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { OutputInspection, SystemStatus } from "../shared/system";
import type { TimelineSession, TimelineSessionSummary } from "../shared/timeline";

export interface WorkspaceData {
  session: TimelineSession | null;
  sessions: TimelineSessionSummary[];
  queue: ProductionQueueSnapshot | null;
  sessionQueues: Record<string, ProductionQueueSnapshot>;
  output: OutputInspection | null;
  system: SystemStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useWorkspaceData(): WorkspaceData {
  const [session, setSession] = useState<TimelineSession | null>(null);
  const [sessions, setSessions] = useState<TimelineSessionSummary[]>([]);
  const [queue, setQueue] = useState<ProductionQueueSnapshot | null>(null);
  const [sessionQueues, setSessionQueues] = useState<Record<string, ProductionQueueSnapshot>>({});
  const [output, setOutput] = useState<OutputInspection | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const activeSessionId = useRef("");

  const refresh = useCallback(async () => {
    const bridge = window.flowx;
    if (!bridge) return;
    const [active, summaries, status] = await Promise.all([
      bridge.timeline.loadSession(),
      bridge.timeline.listSessions(),
      bridge.system.getStatus(),
    ]);
    const snapshots = await Promise.all(
      summaries.map((summary) => bridge.productionQueue.getSnapshot(summary.id).catch(() => null)),
    );
    const queueMap: Record<string, ProductionQueueSnapshot> = {};
    snapshots.forEach((snapshot) => {
      if (snapshot) queueMap[snapshot.projectId] = snapshot;
    });
    const activeQueue = active ? queueMap[active.id] || null : null;
    const inspection = active
      ? await bridge.system.inspectOutput(active.id).catch(() => null)
      : null;
    setSession(active);
    activeSessionId.current = active?.id || "";
    setSessions(summaries);
    setSessionQueues(queueMap);
    setQueue(activeQueue);
    setOutput(inspection);
    setSystem(status);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        await refresh();
      } catch {
        if (active) setLoading(false);
      }
    };
    void run();
    const timer = window.setInterval(() => { if (active) void run(); }, 4_000);
    const unsubscribe = window.flowx?.productionQueue.onChanged((snapshot) => {
      if (!active) return;
      setSessionQueues((current) => ({ ...current, [snapshot.projectId]: snapshot }));
      if (activeSessionId.current === snapshot.projectId) setQueue(snapshot);
    });
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, [refresh]);

  return { session, sessions, queue, sessionQueues, output, system, loading, refresh };
}
