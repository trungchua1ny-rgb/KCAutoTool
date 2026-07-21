import {
  CheckCircle2,
  Clapperboard,
  FileAudio,
  Palette,
  RotateCcw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { TimelineSession } from "../shared/timeline";

export type CompletedSetupStepKind = "voice" | "characters" | "visual-bible";

const STEP_COPY: Record<CompletedSetupStepKind, {
  title: string;
  description: string;
  consequence: string;
  icon: typeof FileAudio;
}> = {
  voice: {
    title: "Voice & SRT đã hoàn thành",
    description: "Phiên này đã đi qua bước chọn giọng và đã hoàn thành Phase 3.",
    consequence: "Nếu thay đổi nội dung hoặc giọng đọc, bạn cần chạy lại bước Bắt đầu để tạo Voice, SRT, Timeline và Prompt mới.",
    icon: FileAudio,
  },
  characters: {
    title: "Bước Nhân vật đã hoàn thành",
    description: "Nhân vật đã được kiểm tra và các scene Phase 3 đã lưu nametag liên quan.",
    consequence: "Nếu thay đổi ảnh hoặc thông tin nhân vật, hãy chạy lại Phase 3 để cập nhật việc gán nhân vật trong prompt.",
    icon: UsersRound,
  },
  "visual-bible": {
    title: "Visual Bible đã hoàn thành",
    description: "Phong cách đồ họa của phiên đã được khóa trước khi tạo Timeline và Prompt.",
    consequence: "Nếu thay đổi Visual Bible, prompt cũ không tự đổi. Bạn cần chạy lại Phase 3 để tạo bộ prompt mới theo phong cách vừa cập nhật.",
    icon: Palette,
  },
};

function compact(value: string | undefined, fallback: string): string {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 92 ? `${text.slice(0, 89)}…` : text;
}

export function CompletedSetupStep({
  kind,
  session,
  phase3Running = false,
  onKeep,
  onRedo,
}: {
  kind: CompletedSetupStepKind;
  session: TimelineSession;
  phase3Running?: boolean;
  onKeep: () => void;
  onRedo: () => void;
}) {
  const copy = STEP_COPY[kind];
  const Icon = copy.icon;
  const characterTokens = new Set(
    session.scenes.flatMap((scene) => scene.assignedCharacterTokens || scene.usedCharacterTokens || []),
  );
  const details = kind === "voice"
    ? [
      ["Giọng đọc", session.workflowSource.voiceName || "Không dùng Voice Studio"],
      ["Audio", session.workflowSource.audioFileName || "Đã lưu cấu hình, chưa có file"],
      ["SRT", session.workflowSource.srtFileName || "Đã lưu trong hồ sơ phiên"],
      ["Timeline", `${session.scenes.length} scene đã tạo`],
    ]
    : kind === "characters"
      ? [
        ["Nhân vật đã gán", characterTokens.size ? `${characterTokens.size} nametag` : "Không có nhân vật lặp lại"],
        ["Scene có nhân vật", `${session.scenes.filter((scene) => (scene.assignedCharacterTokens || scene.usedCharacterTokens || []).length > 0).length}/${session.scenes.length} scene`],
        ["Phase 3", `${session.scenes.length} scene đã phân tích`],
        ["Trạng thái", "Đã hoàn thành"],
      ]
      : [
        ["Phong cách", compact(session.visualBible.style, "Chưa có phong cách")],
        ["Bảng màu", compact(session.visualBible.palette, "Không khóa bảng màu riêng")],
        ["Tỷ lệ", session.visualBible.aspectRatio || "16:9"],
        ["Phase 3", `${session.scenes.length} prompt scene đã tạo`],
      ];
  const visibleDetails = phase3Running
    ? details.map(([label, value]) => [label, label === "Timeline" || label === "Phase 3" ? "Đang tạo…" : value])
    : details;

  return (
    <section className="kc-completed-step" aria-labelledby={`completed-${kind}-title`}>
      <div className="kc-completed-step-icon"><Icon size={30} /><CheckCircle2 size={19} /></div>
      <header>
        <p className="eyebrow">{phase3Running ? "WORKFLOW ĐANG CHẠY" : "BƯỚC ĐÃ HOÀN THÀNH"}</p>
        <h2 id={`completed-${kind}-title`}>{phase3Running ? "Dữ liệu bước này đã được khóa" : copy.title}</h2>
        <p>{phase3Running ? "KC Auto Tool đang dùng dữ liệu đã lưu của bước này để tạo Timeline, Prompt và scene. Form nhập được ẩn để tránh thay đổi dữ liệu giữa lúc xử lý." : copy.description}</p>
      </header>
      <div className="kc-completed-step-details">
        {visibleDetails.map(([label, value]) => <article key={label}><small>{label}</small><strong title={value}>{value}</strong></article>)}
      </div>
      <div className="kc-completed-step-warning">
        <ShieldCheck size={18} />
        <div><strong>{phase3Running ? "Không thể sửa trong khi workflow đang chạy" : "Bạn có cần tạo lại bước này không?"}</strong><span>{phase3Running ? "Hãy dừng workflow trước nếu thực sự cần thay đổi dữ liệu đầu vào." : copy.consequence}</span></div>
      </div>
      <footer>
        <button className="button primary" type="button" onClick={onKeep}><Clapperboard size={15} /> Mở tiến trình và quản lý scene</button>
        <button className="button danger" type="button" disabled={phase3Running} title={phase3Running ? "Hãy dừng workflow trước khi sửa lại bước này" : "Mở lại form để tạo lại dữ liệu"} onClick={onRedo}><RotateCcw size={15} /> Có, mở để tạo lại</button>
      </footer>
    </section>
  );
}
