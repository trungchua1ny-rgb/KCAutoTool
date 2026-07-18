import { ChevronDown, ChevronUp, ImageUp, Palette, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  MAX_STYLE_REFERENCE_BYTES,
  type TimelineStyleReference,
  type VisualBible,
} from "../shared/timeline";
import type { GraphicStylePreset } from "../shared/visual-style";

export function VisualBiblePanel({
  value,
  onChange,
  presets,
  presetError,
  onSavePreset,
  onDeletePreset,
  styleReference,
  onStyleReferenceChange,
}: {
  value: VisualBible;
  onChange: (value: VisualBible) => void;
  presets: GraphicStylePreset[];
  presetError: string;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  styleReference: TimelineStyleReference | null;
  onStyleReferenceChange: (reference: TimelineStyleReference | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [presetName, setPresetName] = useState("");
  const [referenceError, setReferenceError] = useState("");
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
          Phong cách đồ họa là cấu hình render bắt buộc và chỉ do bạn quyết định. ChatGPT không được sửa hoặc lặp lại phong cách này trong prompt scene; AI chỉ phân tích nội dung nhìn thấy, bối cảnh, hành động, biểu cảm, bố cục và tính liên tục.
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
          <span>Phong cách đồ họa gửi Google Flow <b className="required-mark">Bắt buộc</b></span>
          <textarea
            className={`graphic-style-input ${value.style.trim() ? "" : "is-required"}`}
            value={value.style}
            placeholder="Ví dụ: Stickman, flat 2D illustration, white background, bold black outlines..."
            required
            aria-required="true"
            onChange={(event) => update("style", event.target.value)}
          />
          {!value.style.trim() && <small className="graphic-style-error">Hãy nhập hoặc chọn một phong cách đã lưu trước khi tạo timeline.</small>}
        </label>
        <div className="style-reference-control">
          <div className="style-reference-copy">
            <strong>Ảnh đồ họa mẫu cho ChatGPT</strong>
            <small>Ảnh chỉ giúp AI hiểu quy luật hình ảnh và tính liên tục. AI không được ghi đè, mở rộng hoặc thay đổi ô phong cách đồ họa.</small>
          </div>
          {styleReference ? (
            <div className="style-reference-preview">
              <img src={styleReference.dataUrl} alt="Ảnh phong cách mẫu" />
              <span title={styleReference.name}>{styleReference.name}</span>
              <button className="icon-button" type="button" title="Bỏ ảnh mẫu" onClick={() => onStyleReferenceChange(null)}>
                <X size={15} />
              </button>
            </div>
          ) : (
            <label className="button secondary compact style-reference-picker">
              <ImageUp size={15} /> Chọn ảnh mẫu
              <input
                className="visually-hidden-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type)) {
                    setReferenceError("Ảnh mẫu phải là PNG, JPEG hoặc WebP.");
                    return;
                  }
                  if (file.size > MAX_STYLE_REFERENCE_BYTES) {
                    setReferenceError("Ảnh mẫu vượt quá giới hạn 8 MB.");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    setReferenceError("");
                    onStyleReferenceChange({
                      name: file.name,
                      mimeType: file.type as TimelineStyleReference["mimeType"],
                      dataUrl: String(reader.result || ""),
                    });
                  };
                  reader.onerror = () => setReferenceError("Không đọc được ảnh mẫu.");
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          )}
          {referenceError && <small className="graphic-style-error">{referenceError}</small>}
        </div>
        <small>Khi gửi Google Flow, app ghép nguyên văn phong cách trên vào prompt sau cùng. Prompt Phase 3 chỉ chứa nội dung riêng của cảnh.</small>
      </div>
      {open && (
        <div className="visual-bible-fields">
          <label className="field">
            <span>Bảng màu</span>
            <input value={value.palette} placeholder="Màu chủ đạo, màu nhấn, độ bão hòa và tương phản" onChange={(event) => update("palette", event.target.value)} />
            <small>Để trống: ChatGPT phân tích từ câu chuyện, nhưng không được đổi phong cách đồ họa.</small>
          </label>
          <label className="field">
            <span>Ánh sáng</span>
            <input value={value.lighting} placeholder="Ánh sáng mặc định, hướng sáng, thời gian và độ tương phản" onChange={(event) => update("lighting", event.target.value)} />
            <small>Ánh sáng là quy tắc dự án; prompt scene chỉ nói thay đổi ánh sáng khi câu chuyện yêu cầu.</small>
          </label>
          <label className="field aspect-field">
            <span>Tỷ lệ khung hình</span>
            <input value="16:9 · Ngang (cố định)" readOnly aria-readonly="true" />
          </label>
          <label className="field continuity-field">
            <span>Nhân vật, bối cảnh và quy tắc liên tục</span>
            <textarea value={value.continuityNotes} placeholder="Thiết kế nhân vật, trang phục, tỷ lệ, địa điểm lặp lại, đạo cụ, hướng di chuyển và trạng thái cần giữ nguyên..." onChange={(event) => update("continuityNotes", event.target.value)} />
            <small>Đây là bộ nhớ xuyên scene, không phải mô tả phong cách vẽ.</small>
          </label>
        </div>
      )}
    </section>
  );
}
