import {
  Clipboard,
  ExternalLink,
  FileImage,
  Film,
  FolderOpen,
  RefreshCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { Scene } from "../shared/timeline";

interface SceneDetailDrawerProps {
  scene: Scene | null;
  snapshot: ProductionQueueSnapshot | null;
  thumbnail?: string;
  onClose: () => void;
  onPromptChange: (sceneId: string, mediaType: "image" | "video", prompt: string) => void;
  onSave: () => void;
  onRun: (sceneId: string, mediaType: "image" | "video", prompt: string) => void;
  onRegenerate: (sceneId: string, mediaType: "image" | "video", prompt?: string) => void;
  onClear: (sceneId: string) => void;
  onOpenFolder: () => void;
}

export function SceneDetailDrawer({
  scene,
  snapshot,
  thumbnail,
  onClose,
  onPromptChange,
  onSave,
  onRun,
  onRegenerate,
  onClear,
  onOpenFolder,
}: SceneDetailDrawerProps) {
  if (!scene) return null;
  const queueScene = snapshot?.scenes.find((entry) => entry.sceneId === scene.id);
  const jobs = snapshot?.jobs.filter((job) => job.sceneId === scene.id) || [];
  const errors = snapshot?.errors.filter((error) => error.sceneId === scene.id) || [];
  const copyPrompt = async (value: string) => navigator.clipboard.writeText(value);

  return (
    <aside className="scene-detail-drawer" aria-label={`Chi tiết Scene ${scene.order}`}>
      <header>
        <div>
          <p className="eyebrow">CHI TIẾT SCENE</p>
          <h3>Scene {scene.order}</h3>
          <span>{scene.timeStart} — {scene.timeEnd} · {scene.durationSeconds}s · {scene.chainRole}</span>
        </div>
        <button className="icon-button" type="button" title="Đóng" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="scene-detail-content">
        <section className="scene-detail-media-grid">
          <article>
            <span>Ảnh hiện tại</span>
            {thumbnail ? <img src={thumbnail} alt={`Ảnh Scene ${scene.order}`} /> : <FileImage size={28} />}
            <small>{scene.imageResultPath || "Chưa có file ảnh"}</small>
          </article>
          <article>
            <span>Video hiện tại</span>
            <Film size={30} />
            <small>{scene.videoResultPath || "Chưa có file video"}</small>
          </article>
          <article>
            <span>Frame trước</span>
            <ExternalLink size={26} />
            <small>{queueScene?.startFrameAssetPath || "Scene không dùng frame nối tiếp"}</small>
          </article>
        </section>
        <label className="scene-prompt-field">
          <span>Prompt ảnh <button type="button" title="Sao chép" onClick={() => void copyPrompt(scene.imagePrompt)}><Clipboard size={13} /></button></span>
          <textarea value={scene.imagePrompt} onChange={(event) => onPromptChange(scene.id, "image", event.target.value)} />
          <div><button className="button secondary compact" type="button" onClick={() => onRun(scene.id, "image", scene.imagePrompt)}><FileImage size={14} /> Chạy tạo ảnh</button><button className="button ghost compact" type="button" onClick={() => onRegenerate(scene.id, "image", scene.imagePrompt)}><RefreshCcw size={14} /> Tạo lại</button></div>
        </label>
        <label className="scene-prompt-field">
          <span>Prompt video <button type="button" title="Sao chép" onClick={() => void copyPrompt(scene.videoPrompt)}><Clipboard size={13} /></button></span>
          <textarea value={scene.videoPrompt} onChange={(event) => onPromptChange(scene.id, "video", event.target.value)} />
          <div><button className="button primary compact" type="button" onClick={() => onRun(scene.id, "video", scene.videoPrompt)}><Film size={14} /> Chạy tạo video</button><button className="button ghost compact" type="button" onClick={() => onRegenerate(scene.id, "video", scene.videoPrompt)}><RefreshCcw size={14} /> Tạo lại</button></div>
        </label>
        <section className="scene-reference-list">
          <h4>Tham chiếu & tính liên tục</h4>
          <span>Nhân vật: {scene.usedCharacterTokens.join(", ") || "Không có"}</span>
          <span>Ảnh Flow: {scene.imageFlowAssetKey || "Chưa liên kết"}</span>
          <span>Frame đầu: {queueScene?.startFrameAssetPath || "Không có"}</span>
        </section>
        <section className="scene-retry-history">
          <h4>Lịch sử công việc</h4>
          {jobs.length === 0 ? <p>Chưa có job cho scene này.</p> : jobs.map((job) => (
            <div key={job.id}><span>{job.jobType}</span><b className={`is-${job.status}`}>{job.status}</b><small>{job.attempts}/{job.maxAttempts}</small></div>
          ))}
          {errors.map((error) => <p className="form-error" key={error.jobId}>{error.message}</p>)}
        </section>
      </div>
      <footer>
        <button className="button secondary compact" type="button" onClick={onSave}><Save size={14} /> Lưu prompt</button>
        <button className="button secondary compact" type="button" onClick={onOpenFolder}><FolderOpen size={14} /> Mở thư mục</button>
        <button className="button danger compact" type="button" onClick={() => onClear(scene.id)}><Trash2 size={14} /> Xóa kết quả</button>
      </footer>
    </aside>
  );
}
