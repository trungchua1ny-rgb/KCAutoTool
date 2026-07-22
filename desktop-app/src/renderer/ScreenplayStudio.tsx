import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clapperboard,
  FileText,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  normalizeScreenplayProject,
  parseScreenplay,
  screenplayShotsToSrt,
  type ScreenplayDialogueMode,
  type ScreenplayProject,
  type ScreenplayShot,
  type ScreenplayShotDuration,
} from "../shared/screenplay";
import type { TimelineSession } from "../shared/timeline";

interface ScreenplayStudioProps {
  session: TimelineSession | null;
  onSaved: () => void;
  onBack: () => void;
  onContinue: () => void;
}

const DURATION_OPTIONS: ScreenplayShotDuration[] = [4, 6, 8];

function updateShot(shots: ScreenplayShot[], id: string, patch: Partial<ScreenplayShot>): ScreenplayShot[] {
  return shots.map((shot) => shot.id === id ? { ...shot, ...patch } : shot);
}

export function ScreenplayStudio({ session, onSaved, onBack, onContinue }: ScreenplayStudioProps) {
  const [project, setProject] = useState<ScreenplayProject>(() => normalizeScreenplayProject(session?.screenplay));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProject(normalizeScreenplayProject(session?.screenplay));
    setSaved(true);
    setError("");
  }, [session?.id]);

  const summary = useMemo(() => ({
    shots: project.shots.length,
    duration: project.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0),
    dialogue: project.shots.reduce((sum, shot) => sum + shot.dialogueCues.length, 0),
    effects: project.shots.reduce((sum, shot) => sum + shot.soundEffects.length, 0),
    approved: project.shots.filter((shot) => shot.approved).length,
  }), [project.shots]);
  const nativeDialogueReady = project.dialogueMode === "sound-only" || project.nativeDialoguePilotConfirmed;
  const productionLocked = Boolean(session?.scenes.length);
  const canContinue = project.parseStatus === "approved" && project.shots.length > 0 && nativeDialogueReady && !saving && !productionLocked;

  const change = (patch: Partial<ScreenplayProject>) => {
    if (productionLocked) return;
    setProject((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
    setSaved(false);
    setError("");
  };

  const analyze = () => {
    const shots = parseScreenplay(project.scriptText);
    if (!shots.length) {
      setError("Không tìm thấy nội dung kịch bản để phân tích.");
      return;
    }
    change({ shots, parseStatus: "review", reviewedAt: "" });
  };

  const approve = () => {
    if (!project.shots.length) return;
    change({
      shots: project.shots.map((shot) => ({ ...shot, approved: true })),
      parseStatus: "approved",
      reviewedAt: new Date().toISOString(),
    });
  };

  const save = async (advance = false) => {
    if (!session || !window.flowx?.timeline) {
      setError("Chưa có phiên làm việc để lưu kịch bản.");
      return false;
    }
    if (!project.scriptText.trim()) {
      setError("Hãy nhập kịch bản hình trước khi lưu.");
      return false;
    }
    if (advance && !canContinue) {
      setError("Hãy phân tích và phê duyệt shot plan trước khi tiếp tục.");
      return false;
    }
    setSaving(true);
    setError("");
    try {
      const screenplay = normalizeScreenplayProject(project);
      const srtText = screenplayShotsToSrt(screenplay.shots, screenplay.dialogueMode);
      await window.flowx.timeline.saveSession({
        scenes: session.scenes,
        visualBible: session.visualBible,
        styleReference: session.styleReference,
        workflowMode: "automatic",
        productionKind: "screenplay",
        screenplay,
        workflowSource: {
          ...session.workflowSource,
          narrationText: "",
          narrationFileName: "",
          narrationPath: "",
          voiceName: "",
          audioPath: "",
          audioFileName: "",
          scriptText: screenplay.scriptText,
          scriptFileName: screenplay.scriptFileName || "screenplay.txt",
          scriptPath: screenplay.scriptPath,
          srtText,
          srtFileName: "screenplay-shot-contract.srt",
          srtPath: "",
        },
      });
      setSaved(true);
      onSaved();
      if (advance) onContinue();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(txt|md)$/iu.test(file.name)) {
      setError("Chỉ hỗ trợ file .txt hoặc .md.");
      return;
    }
    change({ scriptText: await file.text(), scriptFileName: file.name, scriptPath: "", parseStatus: "draft", shots: [] });
  };

  const setDialogueMode = (dialogueMode: ScreenplayDialogueMode) => change({
    dialogueMode,
    nativeDialoguePilotConfirmed: dialogueMode === "sound-only" ? false : project.nativeDialoguePilotConfirmed,
  });

  return (
    <section className={`kc-screenplay-studio ${productionLocked ? "is-readonly" : ""}`}>
      <header className="kc-screenplay-header">
        <div><small>SCREENPLAY STUDIO · {session?.name || "Chưa có phiên"}</small><h1>Phim kịch bản hình</h1><p>Thiết kế shot, hành động, thoại nhân vật và âm thanh hiện trường trước khi tạo video.</p></div>
        <span className={saved ? "is-saved" : "is-dirty"}>{saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{saving ? "Đang lưu" : saved ? "Đã lưu" : "Chưa lưu"}</span>
      </header>

      <nav className="kc-screenplay-stepper" aria-label="Quy trình phim kịch bản hình">
        {["Kịch bản hình", "Nhân vật", "Visual & Sound Bible", "Bắt đầu workflow"].map((label, index) => <div key={label} className={index === 0 ? "is-active" : ""}><span>{String(index + 1).padStart(2, "0")}</span><b>{label}</b>{index < 3 && <i />}</div>)}
      </nav>

      {productionLocked && <div className="kc-screenplay-production-lock"><ShieldCheck size={17} /><div><strong>Phiên đã có Timeline/Prompt.</strong><span>Screenplay Studio đang giữ nguyên scene hiện tại. Muốn thay kịch bản, hãy xóa kết quả sản xuất và tạo lại Phase 3 bằng thao tác có xác nhận trong Timeline.</span></div></div>}

      <div className="kc-screenplay-layout">
        <main>
          <section className="kc-screenplay-card">
            <header><div><small>01 · NGUỒN SẢN XUẤT</small><h2>Kịch bản hình <em>*</em></h2></div><button type="button" className="button" onClick={() => inputRef.current?.click()}><Upload size={14} /> Nhập .txt / .md</button></header>
            <input ref={inputRef} hidden type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void importFile(event.target.files?.[0])} />
            <textarea value={project.scriptText} onChange={(event) => change({ scriptText: event.target.value, parseStatus: "draft", shots: [] })} placeholder={'Ví dụ:\nCẢNH 1 — PHÒNG KHÁCH — ĐÊM\nHÀNH ĐỘNG: An bước đến cửa sổ và kéo rèm.\nAMBIENCE: Tiếng mưa đều bên ngoài.\nSFX: Tiếng rèm trượt nhẹ.\nAN: “Mình phải đi thôi.”'} />
            <footer><span><FileText size={13} /> {project.scriptFileName || "Nội dung nhập trực tiếp"}</span><span>{project.scriptText.length.toLocaleString("vi-VN")} ký tự</span><button type="button" className="button primary" disabled={!project.scriptText.trim()} onClick={analyze}><Sparkles size={14} /> Phân tích kịch bản</button></footer>
          </section>

          <section className="kc-screenplay-card">
            <header><div><small>02 · CHẾ ĐỘ ÂM THANH</small><h2>Video có thoại hay không thoại?</h2></div></header>
            <div className="kc-screenplay-modes">
              <button type="button" className={project.dialogueMode === "sound-only" ? "is-selected" : ""} onClick={() => setDialogueMode("sound-only")}><VolumeX size={21} /><strong>Không thoại · Khuyến nghị</strong><span>Không lồng voice-over. Flow chỉ tạo ambience và SFX đồng bộ với hành động.</span></button>
              <button type="button" className={project.dialogueMode === "native-dialogue" ? "is-selected is-experimental" : "is-experimental"} onClick={() => setDialogueMode("native-dialogue")}><Volume2 size={21} /><strong>Thoại trực tiếp · Thử nghiệm</strong><span>Nhân vật nói đúng câu thoại trong shot. Chỉ nên dùng câu ngắn và tối đa hai người nói.</span></button>
            </div>
            {project.dialogueMode === "native-dialogue" && <div className="kc-screenplay-pilot"><label>Ngôn ngữ thoại<input value={project.dialogueLanguage} onChange={(event) => change({ dialogueLanguage: event.target.value })} /></label><label className="check"><input type="checkbox" checked={project.nativeDialoguePilotConfirmed} onChange={(event) => change({ nativeDialoguePilotConfirmed: event.target.checked })} /><span>Tôi hiểu thoại trực tiếp là chế độ thử nghiệm và có thể cần tạo lại một số shot.</span></label></div>}
          </section>

          <section className="kc-screenplay-card kc-screenplay-review">
            <header><div><small>03 · PARSE REVIEW</small><h2>Duyệt shot plan</h2></div><span>{summary.approved}/{summary.shots} đã duyệt</span></header>
            {!project.shots.length ? <div className="kc-screenplay-empty"><Clapperboard size={28} /><strong>Chưa có shot plan</strong><p>Nhập kịch bản rồi bấm “Phân tích kịch bản”. Hệ thống chỉ tạo timeline sau khi bạn phê duyệt.</p></div> : <div className="kc-screenplay-shot-list">{project.shots.map((shot) => <article key={shot.id} className={shot.approved ? "is-approved" : ""}>
              <header><span>SHOT {String(shot.order).padStart(2, "0")}</span><input value={shot.heading} onChange={(event) => change({ shots: updateShot(project.shots, shot.id, { heading: event.target.value, approved: false }), parseStatus: "review" })} /><select value={shot.durationSeconds} onChange={(event) => change({ shots: updateShot(project.shots, shot.id, { durationSeconds: Number(event.target.value) as ScreenplayShotDuration, approved: false }), parseStatus: "review" })}>{DURATION_OPTIONS.map((value) => <option key={value} value={value}>{value}s</option>)}</select></header>
              <textarea aria-label={`Hành động shot ${shot.order}`} value={shot.action} onChange={(event) => change({ shots: updateShot(project.shots, shot.id, { action: event.target.value, approved: false }), parseStatus: "review" })} />
              <dl><div><dt>Thoại</dt><dd>{shot.dialogueCues.length ? shot.dialogueCues.map((cue) => `${cue.speaker}: “${cue.text}”`).join(" · ") : "Không thoại"}</dd></div><div><dt>Ambience</dt><dd>{shot.ambience || "Tự suy ra từ bối cảnh đã nêu"}</dd></div><div><dt>SFX</dt><dd>{shot.soundEffects.join(" · ") || "Chỉ âm thanh từ hành động nhìn thấy"}</dd></div></dl>
            </article>)}</div>}
            {project.shots.length > 0 && <footer><div><b>{summary.shots} shot · {summary.duration}s</b><span>{summary.dialogue} câu thoại · {summary.effects} hiệu ứng âm thanh</span></div><button type="button" className="button primary" onClick={approve}><ShieldCheck size={14} /> Phê duyệt shot plan</button></footer>}
          </section>
          {error && <p className="form-error" role="alert">{error}</p>}
        </main>

        <aside>
          <section className="kc-screenplay-card kc-screenplay-summary"><small>TÓM TẮT PHIÊN</small><h2>Sẵn sàng cho phim ngắn</h2><dl><div><dt>Shot</dt><dd>{summary.shots}</dd></div><div><dt>Thời lượng</dt><dd>{summary.duration}s</dd></div><div><dt>Thoại</dt><dd>{project.dialogueMode === "sound-only" ? "Tắt" : `${summary.dialogue} câu`}</dd></div><div><dt>Âm thanh</dt><dd>Ambience + SFX</dd></div><div><dt>Đầu ra</dt><dd>Google Flow → CapCut</dd></div></dl></section>
          <section className="kc-screenplay-card kc-screenplay-note"><ShieldCheck size={21} /><h3>Nguyên tắc V1</h3><p>App không tạo voice-over. Âm thanh nằm trực tiếp trong từng video scene và sẽ được giữ nguyên khi ghép sang CapCut.</p><p>Không tạo nhạc trong Google Flow; nhạc nền được thêm ở CapCut nếu cần.</p></section>
        </aside>
      </div>

      <footer className="kc-screenplay-actions"><button type="button" className="button" onClick={onBack}><ArrowLeft size={14} /> Quay lại</button><div><button type="button" className="button" disabled={saving || saved} onClick={() => void save(false)}>Lưu bản nháp</button><button type="button" className="button primary" disabled={!canContinue} onClick={() => void save(true)}>Lưu và tiếp tục đến Nhân vật <ArrowRight size={14} /></button></div></footer>
    </section>
  );
}
