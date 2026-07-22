import {
  ArrowRight,
  BookOpenCheck,
  Check,
  CircleAlert,
  Clock3,
  FileText,
  LoaderCircle,
  Mic2,
  Palette,
  Play,
  Radio,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import type { TimelineSession } from "../../shared/timeline";
import type { WorkerStatuses } from "../../shared/worker-status";
import type { AppPage } from "../app-navigation";
import { HOME_MODE_LABELS, readHomeCharactersReviewed } from "../home-workflow-state";
import type { HomeWorkflowMode } from "../integrated-workflow";
import { type HomeCharacterSummary, setupSteps, sourceReady } from "./homepage-model";

function dateLabel(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Chưa có dữ liệu" : parsed.toLocaleString("vi-VN");
}

function srtStats(text: string): { cues: number; duration: string } {
  const matches = [...text.matchAll(/(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})/g)];
  const end = matches.at(-1);
  return {
    cues: matches.length,
    duration: end ? `${end[5]}:${end[6]}:${end[7]}` : "Chưa phân tích",
  };
}

const STEP_ICONS = { source: FileText, characters: UsersRound, "visual-bible": Palette, start: Play } as const;

export function SetupHome({
  session,
  mode,
  characters,
  workers,
  onNavigate,
  onStart,
}: {
  session: TimelineSession;
  mode: HomeWorkflowMode;
  characters: HomeCharacterSummary;
  workers: WorkerStatuses;
  onNavigate: (page: AppPage) => void;
  onStart: () => Promise<boolean>;
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const reviewed = readHomeCharactersReviewed(session.id);
  const steps = setupSteps(session, mode, reviewed);
  const sourceDone = sourceReady(session, mode);
  const bibleDone = Boolean(session.visualBible.style.trim());
  const chatReady = workers["chat-worker"].connected;
  const flowRequired = mode === "full_auto" || mode === "screenplay_film";
  const flowReady = workers["flow-worker"].connected;
  const setupReady = sourceDone && reviewed && bibleDone;
  const canStart = setupReady && chatReady && (!flowRequired || flowReady) && !starting;
  const stats = srtStats(session.workflowSource.srtText);
  const next = !sourceDone
    ? mode === "screenplay_film"
      ? { label: "Tiếp tục chuẩn bị kịch bản hình", page: "screenplay" as AppPage }
      : { label: mode === "srt_script" ? "Tiếp tục tải SRT & kịch bản" : "Tiếp tục nhập nội dung & chọn giọng", page: mode === "srt_script" ? "timeline" : "voice" as AppPage }
    : !reviewed
      ? { label: "Tiếp tục đến Nhân vật", page: "characters" as AppPage }
      : !bibleDone
        ? { label: "Tiếp tục đến Visual Bible", page: "visual-bible" as AppPage }
        : !canStart
          ? { label: "Kiểm tra kết nối worker", page: "settings" as AppPage }
          : null;
  const start = async () => {
    if (!canStart) return;
    setStarting(true);
    setStartError("");
    try {
      if (!await onStart()) setStartError("Không thể bắt đầu workflow. Hãy kiểm tra thông báo hệ thống.");
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="kc-home-setup-v2">
      <header className="kc-home-setup-session">
        <span><LoaderCircle size={21} /></span>
        <div><small>PHIÊN ĐANG THIẾT LẬP</small><h2>{session.name}</h2><p><Clock3 size={12} /> Lưu gần nhất {dateLabel(session.savedAt)}</p></div>
        <div><b>{HOME_MODE_LABELS[mode]}</b><span className="kc-home-status is-info">Đang thiết lập</span><small><Check size={11} /> Tự động lưu theo phiên</small></div>
      </header>

      <section className="kc-home-setup-layout">
        <div className="kc-home-setup-main">
          <section className="kc-home-stepper-v2" aria-label="Tiến trình thiết lập">
            {steps.map((step, index) => {
              const Icon = STEP_ICONS[step.id];
              return <article key={step.id} className={`is-${step.status}`}><header><span>{step.status === "completed" ? <Check size={14} /> : step.status === "error" ? <CircleAlert size={14} /> : <Icon size={14} />}</span><small>BƯỚC {index + 1}</small></header><strong>{step.title}</strong><p>{step.description}</p><b>{step.status === "completed" ? "Đã hoàn thành" : step.status === "in-progress" ? "Đang thực hiện" : step.status === "error" ? "Có lỗi" : "Chưa thực hiện"}</b>{index < steps.length - 1 && <i aria-hidden="true" />}</article>;
            })}
          </section>

          <section className="kc-home-setup-summary">
            <article>
              <header><span><Mic2 size={16} /></span><div><small>{mode === "screenplay_film" ? "SCREENPLAY STUDIO" : mode === "srt_script" ? "NGUỒN TIMELINE" : "VOICE STUDIO"}</small><strong>{mode === "screenplay_film" ? "Kịch bản hình & âm thanh" : mode === "srt_script" ? "SRT & kịch bản" : "Nội dung & giọng đọc"}</strong></div><b className={sourceDone ? "is-ready" : "is-missing"}>{sourceDone ? "Đã sẵn sàng" : "Còn thiếu"}</b></header>
              <dl>{mode === "screenplay_film" ? <><div><dt>Kịch bản</dt><dd>{session.screenplay.scriptFileName || "Nội dung đã nhập"}</dd></div><div><dt>Shot đã duyệt</dt><dd>{session.screenplay.shots.filter((shot) => shot.approved).length}/{session.screenplay.shots.length}</dd></div><div><dt>Chế độ thoại</dt><dd>{session.screenplay.dialogueMode === "sound-only" ? "Không thoại" : "Thoại trực tiếp (pilot)"}</dd></div><div><dt>Ambience/SFX</dt><dd>{session.screenplay.shots.reduce((sum, shot) => sum + Number(Boolean(shot.ambience)) + shot.soundEffects.length, 0)} chỉ dẫn</dd></div></> : mode === "srt_script" ? <><div><dt>File SRT</dt><dd>{session.workflowSource.srtFileName || "Chưa chọn"}</dd></div><div><dt>Kịch bản</dt><dd>{session.workflowSource.scriptFileName || "Chưa chọn"}</dd></div><div><dt>Subtitle</dt><dd>{stats.cues || "—"}</dd></div><div><dt>Thời lượng</dt><dd>{stats.duration}</dd></div></> : <><div><dt>Nội dung thoại</dt><dd>{session.workflowSource.narrationText?.trim() ? "Đã có" : "Chưa có"}</dd></div><div><dt>Tên nội dung</dt><dd>{session.workflowSource.narrationFileName || "Nội dung đã dán"}</dd></div><div><dt>Giọng đọc</dt><dd>{session.workflowSource.voiceName || "Chưa chọn"}</dd></div><div><dt>Ngôn ngữ</dt><dd>{session.workflowSource.voiceName?.split("-").slice(0, 2).join("-") || "—"}</dd></div><div><dt>Audio</dt><dd>{session.workflowSource.audioFileName || "Chưa tạo"}</dd></div><div><dt>SRT</dt><dd>{session.workflowSource.srtFileName || "Chưa tạo"}</dd></div></>}</dl>{mode !== "srt_script" && mode !== "screenplay_film" && !session.workflowSource.audioFileName && <p>Audio và SRT sẽ được tạo khi bắt đầu workflow.</p>}
            </article>

            <article>
              <header><span><UsersRound size={16} /></span><div><small>CHARACTER SYSTEM</small><strong>Nhân vật</strong></div><b className={reviewed ? "is-ready" : "is-missing"}>{reviewed ? "Đã kiểm tra" : "Chưa kiểm tra"}</b></header>
              <dl><div><dt>Thư viện</dt><dd>{characters.total} nhân vật</dd></div><div><dt>Nhân vật chính</dt><dd>{characters.main}</dd></div><div><dt>Nhân vật lặp lại</dt><dd>{characters.recurring}</dd></div><div><dt>Sử dụng</dt><dd>{characters.total ? "Có nhân vật" : "Không sử dụng nhân vật"}</dd></div></dl>
            </article>

            <article>
              <header><span><BookOpenCheck size={16} /></span><div><small>CONSISTENCY SYSTEM</small><strong>Visual Bible</strong></div><b className={bibleDone ? "is-ready" : "is-missing"}>{bibleDone ? "Đã khóa" : "Còn thiếu"}</b></header>
              <dl><div><dt>Phong cách</dt><dd>{session.visualBible.style.trim() ? "Đã nhập" : "Chưa nhập"}</dd></div><div><dt>Ảnh tham khảo</dt><dd>{session.styleReference ? session.styleReference.name : "Không có"}</dd></div><div><dt>Tỷ lệ</dt><dd>{session.visualBible.aspectRatio || "16:9"}</dd></div><div><dt>Cập nhật</dt><dd>{dateLabel(session.savedAt)}</dd></div></dl>
            </article>

            <article className="is-workers">
              <header><span><Radio size={16} /></span><div><small>WORKER READINESS</small><strong>Sẵn sàng bắt đầu</strong></div><b className={canStart ? "is-ready" : "is-missing"}>{canStart ? "Sẵn sàng" : "Chưa sẵn sàng"}</b></header>
              <dl><div><dt>ChatGPT Worker</dt><dd className={chatReady ? "is-connected" : "is-disconnected"}>{chatReady ? "Đã kết nối" : "Mất kết nối"}</dd></div><div><dt>Google Flow</dt><dd className={flowReady ? "is-connected" : "is-disconnected"}>{flowReady ? "Đã kết nối" : flowRequired ? "Bắt buộc kết nối" : "Chưa kết nối"}</dd></div><div><dt>Chat profile</dt><dd>{workers["chat-worker"].profileTag || "Chưa đăng ký"}</dd></div><div><dt>Flow profile</dt><dd>{workers["flow-worker"].profileTag || "Chưa đăng ký"}</dd></div></dl>
            </article>
          </section>
        </div>

        <aside className="kc-home-next-action">
          <span>{canStart ? <Play size={22} /> : <ArrowRight size={22} />}</span><small>HÀNH ĐỘNG TIẾP THEO</small><h3>{next?.label || "Bắt đầu toàn bộ workflow"}</h3><p>{canStart ? "Các bước bắt buộc và worker đã sẵn sàng." : "Homepage đã chọn công việc chưa hoàn thành đầu tiên của phiên."}</p>
          {next ? <button className="button primary" type="button" onClick={() => onNavigate(next.page)}>{next.label}<ArrowRight size={15} /></button> : <button className="button primary" type="button" disabled={!canStart} onClick={() => void start()}>{starting ? <><LoaderCircle className="spin" size={15} /> Đang bắt đầu…</> : <><Play size={15} /> Bắt đầu toàn bộ workflow</>}</button>}
          {startError && <p className="form-error">{startError}</p>}
        </aside>
      </section>
    </div>
  );
}
