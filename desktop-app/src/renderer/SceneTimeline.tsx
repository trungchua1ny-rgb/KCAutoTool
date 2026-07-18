import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { ProductionQueueSnapshot, QueueJobView } from "../shared/production-queue";
import type { Scene } from "../shared/timeline";

interface SceneTimelineProps {
  scenes: Scene[];
  snapshot: ProductionQueueSnapshot | null;
  thumbnails: Record<string, string>;
  selectedSceneId: string;
  onSelect: (sceneId: string) => void;
  onRegenerate: (sceneId: string, mediaType: "image" | "video") => void;
  onClearResult: (sceneId: string) => void;
}

function statusLabel(status: Scene["imageStatus"]): string {
  return {
    pending: "Chưa chạy",
    queued: "Đang chờ",
    generating: "Đang xử lý",
    done: "Hoàn thành",
    review: "Chờ duyệt",
    error: "Lỗi",
  }[status];
}

export function SceneTimeline({
  scenes,
  snapshot,
  thumbnails,
  selectedSceneId,
  onSelect,
  onRegenerate,
  onClearResult,
}: SceneTimelineProps) {
  const [zoom, setZoom] = useState(1);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const jobsByScene = useMemo(() => {
    const grouped = new Map<string, QueueJobView[]>();
    for (const job of snapshot?.jobs || []) {
      grouped.set(job.sceneId, [...(grouped.get(job.sceneId) || []), job]);
    }
    return grouped;
  }, [snapshot]);
  const queueScenes = useMemo(
    () => new Map((snapshot?.scenes || []).map((scene) => [scene.sceneId, scene])),
    [snapshot],
  );

  const select = (sceneId: string, additive: boolean) => {
    onSelect(sceneId);
    if (!additive) {
      setMultiSelected(new Set([sceneId]));
      return;
    }
    setMultiSelected((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  const moveSelection = (offset: number) => {
    const currentIndex = Math.max(0, scenes.findIndex((scene) => scene.id === selectedSceneId));
    const next = scenes[Math.min(scenes.length - 1, Math.max(0, currentIndex + offset))];
    if (next) select(next.id, false);
  };

  return (
    <section className="scene-timeline-panel" aria-label="Timeline scene">
      <header className="scene-timeline-header">
        <div>
          <p className="eyebrow">TIMELINE</p>
          <h3>Chuỗi scene sản xuất</h3>
          <span>{scenes.length} scene · {multiSelected.size} đang chọn</span>
        </div>
        <div className="scene-timeline-tools">
          <button className="icon-button" type="button" title="Scene trước" onClick={() => moveSelection(-1)}><ChevronLeft size={15} /></button>
          <button className="icon-button" type="button" title="Scene sau" onClick={() => moveSelection(1)}><ChevronRight size={15} /></button>
          <button className="icon-button" type="button" title="Thu nhỏ" onClick={() => setZoom((value) => Math.max(.72, value - .12))}><Minus size={15} /></button>
          <span className="timeline-zoom-value">{Math.round(zoom * 100)}%</span>
          <button className="icon-button" type="button" title="Phóng to" onClick={() => setZoom((value) => Math.min(1.5, value + .12))}><Plus size={15} /></button>
          <button className="icon-button" type="button" title="Vừa timeline" onClick={() => setZoom(.82)}><Maximize2 size={15} /></button>
        </div>
      </header>
      <div className="scene-timeline-scroll">
        <div className="scene-timeline-track" style={{ "--timeline-zoom": zoom } as CSSProperties}>
          {scenes.map((scene, index) => {
            const queueScene = queueScenes.get(scene.id);
            const jobs = jobsByScene.get(scene.id) || [];
            const retries = jobs.reduce((total, job) => total + Math.max(0, job.attempts - 1), 0);
            const hasError = Boolean(queueScene?.lastError || scene.imageStatus === "error" || scene.videoStatus === "error");
            const hasFinalFrame = Boolean(
              scene.chainRole !== "continue" && scenes[index + 1]?.chainRole === "continue"
                ? queueScenes.get(scenes[index + 1].id)?.startFrameAssetPath
                : scene.chainRole === "continue" && queueScene?.startFrameAssetPath,
            );
            return (
              <div className="scene-timeline-node" key={scene.id}>
                {scene.chainRole === "continue" && <div className="scene-dependency-link"><span>Frame cuối</span></div>}
                <article
                  className={`scene-rail-card duration-${scene.durationSeconds} role-${scene.chainRole} ${selectedSceneId === scene.id ? "is-active" : ""} ${multiSelected.has(scene.id) ? "is-selected" : ""}`}
                  tabIndex={0}
                  onClick={(event) => select(scene.id, event.ctrlKey || event.metaKey)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") select(scene.id, event.ctrlKey || event.metaKey);
                  }}
                >
                  <header>
                    <strong>Scene {scene.order}</strong>
                    <span className={`duration-badge is-${scene.durationSeconds}`}>{scene.durationSeconds}s</span>
                  </header>
                  <div className="scene-rail-thumb">
                    {thumbnails[scene.id]
                      ? <img src={thumbnails[scene.id]} alt={`Scene ${scene.order}`} loading="lazy" />
                      : <ImageIcon size={24} />}
                    {hasError && <AlertTriangle className="scene-warning" size={17} />}
                  </div>
                  <div className="scene-rail-time">{scene.timeStart} — {scene.timeEnd}</div>
                  <div className="scene-rail-tags">
                    <span className={`role-badge is-${scene.chainRole}`}>{scene.chainRole}</span>
                    {hasFinalFrame && <span className="frame-ready"><CheckCircle2 size={11} /> frame</span>}
                  </div>
                  <dl className="scene-media-states">
                    <div><dt>Ảnh</dt><dd className={`is-${scene.imageStatus}`}>{statusLabel(scene.imageStatus)}</dd></div>
                    <div><dt>Video</dt><dd className={`is-${scene.videoStatus}`}>{statusLabel(scene.videoStatus)}</dd></div>
                  </dl>
                  <footer>
                    <span>Thử lại {retries}</span>
                    <div>
                      <button type="button" title="Tạo lại ảnh" onClick={(event) => { event.stopPropagation(); onRegenerate(scene.id, "image"); }}><RotateCcw size={13} /></button>
                      <button type="button" title="Tạo lại video" onClick={(event) => { event.stopPropagation(); onRegenerate(scene.id, "video"); }}><Play size={13} /></button>
                      <button type="button" title="Xóa kết quả" onClick={(event) => { event.stopPropagation(); onClearResult(scene.id); }}><Trash2 size={13} /></button>
                    </div>
                  </footer>
                </article>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
