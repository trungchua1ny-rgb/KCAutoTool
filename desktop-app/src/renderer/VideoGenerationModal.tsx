import { Check, Film, Image as ImageIcon, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Scene, VisualBible } from "../shared/timeline";

interface VideoGenerationModalProps {
  scene: Scene;
  initialPrompt: string;
  thumbnail?: string;
  visualBible: VisualBible;
  onClose: () => void;
  onGenerate: (prompt: string) => void;
}

export function VideoGenerationModal({
  scene,
  initialPrompt,
  thumbnail,
  visualBible,
  onClose,
  onGenerate,
}: VideoGenerationModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="generation-modal" role="dialog" aria-modal="true" aria-labelledby="video-generation-title">
        <header className="generation-modal-header">
          <div>
            <p className="eyebrow">Scene {scene.order} · Phase 6</p>
            <h3 id="video-generation-title">Tạo video từ ảnh scene</h3>
          </div>
          <button className="icon-button" type="button" title="Đóng" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="generation-settings-strip">
          <div><Film size={16} /><span>Model</span><strong>Veo 3.1 Lite</strong></div>
          <div><ImageIcon size={16} /><span>Chế độ</span><strong>Khung hình đầu</strong></div>
          <div><Sparkles size={16} /><span>Video</span><strong>16:9 · {scene.durationSeconds} giây</strong></div>
          <div className="credit-zero"><Check size={16} /><span>Chi phí mục tiêu</span><strong>0 tín dụng</strong></div>
        </div>

        <div className="generation-modal-body">
          <div className="video-source-preview">
            <div className="video-source-frame">
              {thumbnail
                ? <img src={thumbnail} alt={`Khung bắt đầu scene ${scene.order}`} />
                : <ImageIcon size={28} />}
            </div>
            <div>
              <strong>Khung hình bắt đầu của video</strong>
              <span>Chỉ dùng ảnh vừa tạo của scene {scene.order}</span>
              <small>{scene.imageResultPath}</small>
            </div>
          </div>

          <label className="field generation-prompt-field">
            <span>Prompt chuyển động video</span>
            <textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>

          <div className="attachment-preflight">
            <strong>Worker sẽ tự chuyển tab Flow sang Video</strong>
            <p>Ảnh trên được đặt vào Start frame. Worker không gắn End frame và không cộng dồn ảnh từ các scene cũ.</p>
            <small>Thiết lập: Veo 3.1 Lite · Khung hình đầu · 16:9 · {scene.durationSeconds} giây. Visual Bible: {visualBible.style || "chưa thiết lập"}.</small>
          </div>
        </div>

        <footer className="generation-modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>Hủy</button>
          <button
            className="button primary"
            type="button"
            disabled={!prompt.trim() || !scene.imageResultPath}
            onClick={() => onGenerate(prompt.trim())}
          >
            <Sparkles size={16} /> Gắn khung hình đầu và tạo video
          </button>
        </footer>
      </section>
    </div>
  );
}
