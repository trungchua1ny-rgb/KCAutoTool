import { FileClock, ListChecks, Sparkles, Workflow } from "lucide-react";
import type { HomeWorkflowMode } from "./integrated-workflow";

export function HomeView({ onSelect }: { onSelect: (mode: HomeWorkflowMode) => void }) {
  return (
    <section className="home-view">
      <div className="home-hero">
        <div className="home-hero-icon"><Workflow size={26} /></div>
        <div>
          <p className="eyebrow">KC Auto Tool · Production workspace</p>
          <h2>Bắt đầu một video mới</h2>
          <p>Chọn mức tự động hóa phù hợp. Tất cả đầu vào và kết quả được lưu riêng theo từng phiên.</p>
        </div>
      </div>

      <div className="home-mode-grid">
        <button type="button" className="home-mode-card is-primary" onClick={() => onSelect("full_auto")}>
          <span className="home-mode-icon"><Sparkles size={22} /></span>
          <span className="home-mode-copy">
            <strong>Tạo tự động toàn bộ video</strong>
            <small>File thoại → voice + SRT → timeline/prompt → ảnh và video trên Google Flow.</small>
          </span>
          <span className="home-mode-tag">Một lần bấm</span>
        </button>

        <button type="button" className="home-mode-card" onClick={() => onSelect("srt_script")}>
          <span className="home-mode-icon"><FileClock size={22} /></span>
          <span className="home-mode-copy">
            <strong>Tạo từ file SRT và kịch bản</strong>
            <small>Dùng SRT có sẵn, đưa thẳng vào công cụ chia timeline và viết prompt hiện tại.</small>
          </span>
          <span className="home-mode-tag">Bỏ qua voice</span>
        </button>

        <button type="button" className="home-mode-card" onClick={() => onSelect("step_by_step")}>
          <span className="home-mode-icon"><ListChecks size={22} /></span>
          <span className="home-mode-copy">
            <strong>Tạo từng bước</strong>
            <small>Tạo và nghe thử voice/SRT trước, kiểm tra prompt, rồi chủ động chạy hàng đợi ảnh/video.</small>
          </span>
          <span className="home-mode-tag">Kiểm soát cao</span>
        </button>
      </div>

      <div className="home-output-note">
        <strong>Đầu ra theo phiên</strong>
        <span>Voice · SRT · source ảnh · source video · Visual Bible · prompt từng scene</span>
      </div>
    </section>
  );
}

