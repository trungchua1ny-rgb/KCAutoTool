import { ChevronDown, ChevronUp, Palette, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { VisualBible } from "../shared/timeline";
import type { GraphicStylePreset } from "../shared/visual-style";

export function VisualBiblePanel({
  value,
  onChange,
  presets,
  presetError,
  onSavePreset,
  onDeletePreset,
}: {
  value: VisualBible;
  onChange: (value: VisualBible) => void;
  presets: GraphicStylePreset[];
  presetError: string;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [presetName, setPresetName] = useState("");
  const configured = [value.style, value.palette, value.lighting, value.continuityNotes]
    .filter(Boolean).length;
  const update = (field: keyof VisualBible, next: string) => {
    onChange({ ...value, [field]: next });
  };
  const selectedPreset = presets.find((preset) => preset.style === value.style);

  return (
    <section className={`visual-bible-panel ${open ? "is-open" : ""}`}>
      <button className="visual-bible-toggle" type="button" onClick={() => setOpen((current) => !current)}>
        <div className="visual-bible-heading">
          <span className="visual-bible-icon"><Palette size={18} /></span>
          <div>
            <strong>Visual Bible</strong>
            <span>{configured > 0 ? `${configured}/4 quy tắc đã thiết lập` : "Khóa màu sắc và ngữ cảnh toàn bộ dự án"}</span>
          </div>
        </div>
        <div className="visual-bible-summary">
          <span>{value.aspectRatio}</span>
          {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </div>
      </button>
      <div className="graphic-style-bar">
        <p className="visual-bible-guidance">
          Điền trước những quy tắc bạn muốn khóa. Ô nào để trống sẽ được ChatGPT tự phân tích từ toàn bộ kịch bản và điền sau khi tạo timeline.
        </p>
        <div className="graphic-style-library">
          <label className="field">
            <span>Phong cách đã lưu trên máy</span>
            <select
              value={selectedPreset?.id || ""}
              onChange={(event) => {
                const preset = presets.find((entry) => entry.id === event.target.value);
                if (preset) update("style", preset.style);
              }}
            >
              <option value="">Tùy chỉnh chưa lưu</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}{preset.builtIn ? " · mặc định" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="graphic-style-save-row">
            <input
              aria-label="Tên phong cách mới"
              value={presetName}
              placeholder="Tên để lưu, ví dụ: Người que hồ sơ"
              onChange={(event) => setPresetName(event.target.value)}
            />
            <button
              className="icon-button"
              type="button"
              title="Lưu phong cách hiện tại vào máy"
              disabled={!presetName.trim() || !value.style.trim()}
              onClick={() => {
                onSavePreset(presetName.trim());
                setPresetName("");
              }}
            >
              <Save size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="Xóa phong cách đang chọn"
              disabled={!selectedPreset || selectedPreset.builtIn}
              onClick={() => selectedPreset && onDeletePreset(selectedPreset.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
          {presetError && <small className="graphic-style-error">{presetError}</small>}
        </div>
        <label className="field graphic-style-editor">
          <span>Phong cách đồ họa gửi Google Flow</span>
          <textarea
            className="graphic-style-input"
            value={value.style}
            placeholder="Ví dụ: Stickman, flat 2D illustration, white background, bold black outlines..."
            onChange={(event) => update("style", event.target.value)}
          />
        </label>
        <small>Phong cách khóa cách vẽ. Prompt scene vẫn phải chứa bối cảnh, hành động, biểu cảm và bố cục riêng của từng cảnh.</small>
      </div>
      {open && (
        <div className="visual-bible-fields">
          <label className="field">
            <span>Bảng màu</span>
            <input value={value.palette} placeholder="Ví dụ: xanh ngọc, vàng ấm, bão hòa vừa" onChange={(event) => update("palette", event.target.value)} />
          </label>
          <label className="field">
            <span>Ánh sáng</span>
            <input value={value.lighting} placeholder="Ví dụ: hoàng hôn mềm, bóng đổ dịu" onChange={(event) => update("lighting", event.target.value)} />
          </label>
          <label className="field aspect-field">
            <span>Tỷ lệ khung hình</span>
            <input value="16:9 · Ngang (cố định)" readOnly aria-readonly="true" />
          </label>
          <label className="field continuity-field">
            <span>Quy tắc liên tục</span>
            <textarea value={value.continuityNotes} placeholder="Những chi tiết không được thay đổi: khuôn mặt, trang phục, địa điểm, đạo cụ..." onChange={(event) => update("continuityNotes", event.target.value)} />
          </label>
        </div>
      )}
    </section>
  );
}
