import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  FileAudio,
  FileText,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_VISUAL_BIBLE,
  type TimelineSession,
  type TimelineWorkflowSource,
} from "../shared/timeline";
import type { VoiceCatalogEntry, VoicePauseLevel } from "../shared/voice";
import type { HomeWorkflowMode, IntegratedWorkflowHandoff } from "./integrated-workflow";

const VOICE_PRESETS = [
  { key: "natural", label: "Tự nhiên", rate: 0, pitch: 0, volume: 0 },
  { key: "clear", label: "Chậm, rõ ràng", rate: -15, pitch: -5, volume: 0 },
  { key: "story", label: "Kể chuyện", rate: -5, pitch: -5, volume: 0 },
  { key: "fast", label: "Nhanh, năng động", rate: 15, pitch: 5, volume: 5 },
  { key: "news", label: "Tin tức", rate: 5, pitch: 0, volume: 5 },
] as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanProjectName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 100);
}

function localeLabel(locale: string): string {
  try {
    const parsed = new Intl.Locale(locale);
    const languages = new Intl.DisplayNames(["vi"], { type: "language" });
    const regions = new Intl.DisplayNames(["vi"], { type: "region" });
    const language = languages.of(parsed.language) || parsed.language;
    const country = parsed.region ? regions.of(parsed.region) || parsed.region : "Không xác định";
    return `${country} · ${language}`;
  } catch {
    return locale;
  }
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase() || "VO";
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function estimatedDuration(words: number): string {
  if (!words) return "0:00";
  const seconds = Math.max(1, Math.round(words / 2.5));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceWorkflow({
  mode,
  session,
  onBack,
  onComplete,
}: {
  mode: Exclude<HomeWorkflowMode, "srt_script">;
  session?: TimelineSession | null;
  onBack: () => void;
  onComplete: (handoff: IntegratedWorkflowHandoff) => void;
}) {
  const [projectName, setProjectName] = useState(session?.name || "Video mới");
  const [narrationFileName, setNarrationFileName] = useState(session?.workflowSource.narrationFileName || "");
  const [narrationText, setNarrationText] = useState(session?.workflowSource.narrationText || "");
  const [scriptFileName, setScriptFileName] = useState(session?.workflowSource.scriptFileName || "");
  const [scriptText, setScriptText] = useState(session?.workflowSource.scriptText || "");
  const [voices, setVoices] = useState<VoiceCatalogEntry[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceLocale, setVoiceLocale] = useState("");
  const [voiceGender, setVoiceGender] = useState<"all" | "Female" | "Male">("all");
  const [selectedVoice, setSelectedVoice] = useState(session?.workflowSource.voiceName || "");
  const [rate, setRate] = useState(session?.workflowSource.voiceRate ?? 0);
  const [pitch, setPitch] = useState(session?.workflowSource.voicePitch ?? 0);
  const [volume, setVolume] = useState(session?.workflowSource.voiceVolume ?? 0);
  const [pauseLevel, setPauseLevel] = useState<VoicePauseLevel>(session?.workflowSource.voicePauseLevel || "medium");
  const [splitMode, setSplitMode] = useState<"paragraph" | "sentence">(session?.workflowSource.voiceSplitMode || "paragraph");
  const [maxCharsPerChunk, setMaxCharsPerChunk] = useState(session?.workflowSource.voiceMaxCharsPerChunk || 3000);
  const [exportWordSrt, setExportWordSrt] = useState(Boolean(session?.workflowSource.voiceExportWordSrt));
  const [scriptOpen, setScriptOpen] = useState(Boolean(session?.workflowSource.scriptText || session?.workflowSource.scriptFileName));
  const [longTextOpen, setLongTextOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"quick" | "content">("quick");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewCurrent, setPreviewCurrent] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const projectSession = useRef<{ id: string; name: string } | null>(session ? { id: session.id, name: session.name } : null);

  useEffect(() => {
    if (!session) return;
    projectSession.current = { id: session.id, name: session.name };
    setProjectName(session.name);
    setNarrationFileName(session.workflowSource.narrationFileName || "");
    setNarrationText(session.workflowSource.narrationText || "");
    setScriptFileName(session.workflowSource.scriptFileName || "");
    setScriptText(session.workflowSource.scriptText || "");
    setSelectedVoice(session.workflowSource.voiceName || "");
    setRate(session.workflowSource.voiceRate ?? 0);
    setPitch(session.workflowSource.voicePitch ?? 0);
    setVolume(session.workflowSource.voiceVolume ?? 0);
    setPauseLevel(session.workflowSource.voicePauseLevel || "medium");
    setSplitMode(session.workflowSource.voiceSplitMode || "paragraph");
    setMaxCharsPerChunk(session.workflowSource.voiceMaxCharsPerChunk || 3000);
    setExportWordSrt(Boolean(session.workflowSource.voiceExportWordSrt));
    setScriptOpen(Boolean(session.workflowSource.scriptText || session.workflowSource.scriptFileName));
    setError("");
  }, [session?.id]);

  useEffect(() => {
    let active = true;
    const bridge = window.flowx;
    if (!bridge) return undefined;
    void bridge.voice.list().then(
      (catalog) => {
        if (!active) return;
        const sorted = [...catalog].sort((left, right) => {
          const leftRank = left.locale.startsWith("vi-") ? 0 : 1;
          const rightRank = right.locale.startsWith("vi-") ? 0 : 1;
          return leftRank - rightRank || left.locale.localeCompare(right.locale) || left.friendlyName.localeCompare(right.friendlyName);
        });
        setVoices(sorted);
        const restored = session?.workflowSource.voiceName;
        const preferred = sorted.find((voice) => voice.shortName === restored)
          || sorted.find((voice) => voice.shortName === "vi-VN-HoaiMyNeural")
          || sorted[0];
        if (preferred) setSelectedVoice((current) => current || preferred.shortName);
        setVoiceLoading(false);
      },
      (caught) => {
        if (!active) return;
        setVoiceLoading(false);
        setError(message(caught));
      },
    );
    return () => {
      active = false;
      previewAudio.current?.pause();
    };
  }, [session?.id]);

  const filteredVoices = useMemo(() => {
    const query = voiceSearch.trim().toLocaleLowerCase();
    return voices.filter((voice) => {
      if (voiceLocale && voice.locale !== voiceLocale) return false;
      if (voiceGender !== "all" && voice.gender !== voiceGender) return false;
      if (!query) return true;
      return `${voice.friendlyName} ${voice.shortName} ${voice.locale}`.toLocaleLowerCase().includes(query);
    });
  }, [voiceGender, voiceLocale, voiceSearch, voices]);
  const voiceLocales = useMemo(() => [...new Set(voices.map((voice) => voice.locale))].sort((left, right) => localeLabel(left).localeCompare(localeLabel(right), "vi")), [voices]);

  useEffect(() => {
    if (!filteredVoices.length || filteredVoices.some((voice) => voice.shortName === selectedVoice)) return;
    setSelectedVoice(filteredVoices[0].shortName);
  }, [filteredVoices, selectedVoice]);

  const selected = voices.find((voice) => voice.shortName === selectedVoice) || null;
  const words = wordCount(narrationText);
  const canContinue = Boolean(narrationText.trim() && selectedVoice && !saving);
  const contentPreview = narrationText.trim().slice(0, 180) || "Chưa có nội dung để preview.";
  const previewPercent = previewDuration ? Math.min(100, (previewCurrent / previewDuration) * 100) : 0;

  const chooseTextFile = async (file: File | undefined, kind: "narration" | "script") => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("File văn bản vượt quá giới hạn 2 MB.");
      return;
    }
    const text = await file.text();
    if (kind === "narration") {
      setNarrationFileName(file.name);
      setNarrationText(text);
      if (projectName === "Video mới") setProjectName(cleanProjectName(file.name) || "Video mới");
    } else {
      setScriptFileName(file.name);
      setScriptText(text);
      setScriptOpen(true);
    }
    setError("");
  };

  const preview = async (voiceOverride?: VoiceCatalogEntry) => {
    const voice = voiceOverride || selected;
    if (!voice || !window.flowx) return;
    setError("");
    setPreviewLoading(true);
    try {
      previewAudio.current?.pause();
      const dataUrl = await window.flowx.voice.preview(voice.shortName, voice.locale);
      const audio = new Audio(dataUrl);
      previewAudio.current = audio;
      audio.addEventListener("loadedmetadata", () => setPreviewDuration(audio.duration || 0));
      audio.addEventListener("timeupdate", () => setPreviewCurrent(audio.currentTime));
      audio.addEventListener("play", () => setPreviewPlaying(true));
      audio.addEventListener("pause", () => setPreviewPlaying(false));
      audio.addEventListener("ended", () => { setPreviewPlaying(false); setPreviewCurrent(0); });
      await audio.play();
    } catch (caught) {
      setError(`Không nghe thử được giọng: ${message(caught)}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const togglePreview = () => {
    const audio = previewAudio.current;
    if (!audio) {
      void preview();
      return;
    }
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const pasteFromClipboard = async () => {
    try {
      setNarrationText(await navigator.clipboard.readText());
      setNarrationFileName("");
      setError("");
    } catch (caught) {
      setError(`Không thể dán clipboard: ${message(caught)}`);
    }
  };

  const continueSetup = async (advance = true) => {
    const bridge = window.flowx;
    if (!bridge || (advance && !canContinue)) return;
    setSaving(true);
    setError("");
    try {
      const workspaceSession = projectSession.current || await bridge.timeline.createSession(projectName.trim() || "Video mới");
      projectSession.current = { id: workspaceSession.id, name: workspaceSession.name };
      const nextName = projectName.trim() || workspaceSession.name;
      if (nextName !== workspaceSession.name) {
        await bridge.timeline.renameSession(workspaceSession.id, nextName);
        projectSession.current = { id: workspaceSession.id, name: nextName };
      }
      const source: TimelineWorkflowSource = {
        narrationText,
        narrationFileName: narrationFileName || "loi-thoai.txt",
        narrationPath: "",
        srtText: "",
        scriptText: scriptText.trim() || narrationText.trim(),
        srtFileName: "",
        scriptFileName: scriptFileName || narrationFileName || "loi-thoai.txt",
        srtPath: "",
        scriptPath: "",
        audioPath: "",
        audioFileName: "",
        voiceName: selectedVoice,
        voiceRate: rate,
        voicePitch: pitch,
        voiceVolume: volume,
        voicePauseLevel: pauseLevel,
        voiceSplitMode: splitMode,
        voiceMaxCharsPerChunk: maxCharsPerChunk,
        voiceExportWordSrt: exportWordSrt,
      };
      const workflowMode = mode === "full_auto" ? "automatic" : "two_step";
      await bridge.timeline.saveSession({
        scenes: session?.scenes || [],
        visualBible: session?.visualBible || DEFAULT_VISUAL_BIBLE,
        styleReference: session?.styleReference || null,
        workflowMode,
        workflowSource: source,
      });
      if (advance) {
        onComplete({
          id: `${workspaceSession.id}:${Date.now()}`,
          sessionId: workspaceSession.id,
          workflowMode,
          workflowSource: source,
          visualBible: session?.visualBible || DEFAULT_VISUAL_BIBLE,
          styleReference: session?.styleReference || null,
          autoGenerateTimeline: false,
        });
      }
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="kc-voice-studio">
      <header className="kc-voice-page-header">
        <div>
          <div className="kc-voice-breadcrumb"><span>VOICE STUDIO</span><i>•</i><b>{projectName || "Video mới"}</b></div>
          <h1>Voice Studio</h1>
          <p>Chuẩn bị nội dung thoại và cấu hình giọng đọc.</p>
        </div>
        <div className="kc-voice-header-meta">
          <span className="kc-voice-session-pill"><i />{mode === "full_auto" ? "Tự động toàn bộ" : "Tạo từng bước"}</span>
          <span className="kc-voice-saved"><Check size={13} /> {saving ? "Đang lưu…" : "Đã lưu tự động"}</span>
          <button className="kc-voice-outline-button" type="button" disabled={saving} onClick={() => void continueSetup(false)}>Lưu bản nháp</button>
        </div>
      </header>

      <div className="kc-voice-stepper" aria-label="Tiến trình thiết lập">
        {[
          ["01", "Nội dung & giọng đọc", "Đang thực hiện", "active"],
          ["02", "Nhân vật", "Tiếp theo", "locked"],
          ["03", "Visual Bible", "Tiếp theo", "locked"],
          ["04", "Bắt đầu workflow", "Sau khi hoàn tất", "locked"],
        ].map(([number, title, detail, state], index) => (
          <div className={`kc-voice-step ${state}`} key={number}>
            <span className="kc-voice-step-index">{state === "locked" ? "🔒" : number}</span>
            <div><strong>{title}</strong><small>{detail}</small></div>
            {index < 3 && <span className="kc-voice-step-line" />}
          </div>
        ))}
      </div>

      <div className="kc-voice-layout">
        <div className="kc-voice-left-column">
          <article className="kc-voice-card kc-voice-script-card">
            <div className="kc-voice-card-header"><div className="kc-voice-card-title"><span className="kc-voice-card-number">01</span><div><h2>Nội dung thoại <em>*</em></h2><p>Nội dung bắt buộc để tạo Voice và SRT ở bước cuối.</p></div></div><span className="kc-voice-required">BẮT BUỘC</span></div>
            <div className="kc-voice-toolbar">
              <button type="button" onClick={() => void pasteFromClipboard()}><Clipboard size={14} /> Dán clipboard</button>
              <label><Upload size={14} /> Nhập .txt<input className="visually-hidden-file" type="file" accept=".txt,text/plain" onChange={(event) => void chooseTextFile(event.target.files?.[0], "narration")} /></label>
              <label><Upload size={14} /> Nhập .md<input className="visually-hidden-file" type="file" accept=".md,text/markdown" onChange={(event) => void chooseTextFile(event.target.files?.[0], "narration")} /></label>
              <button type="button" disabled={!narrationText} onClick={() => { setNarrationText(""); setNarrationFileName(""); }}><Trash2 size={14} /> Xóa</button>
              {narrationFileName && <span className="kc-voice-file-chip"><FileText size={12} /> {narrationFileName}</span>}
            </div>
            <textarea className="kc-voice-main-textarea" value={narrationText} placeholder="Nhập hoặc dán toàn bộ nội dung cần đọc…" onChange={(event) => setNarrationText(event.target.value)} />
            <div className="kc-voice-textarea-footer"><span>{narrationText.length.toLocaleString("vi-VN")} ký tự</span><span>{words.toLocaleString("vi-VN")} từ</span><span><Clock3 size={13} /> Ước tính {estimatedDuration(words)}</span><label>Tên phiên <input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label></div>
            {narrationText.length > 120_000 && <div className="kc-voice-inline-warning"><AlertTriangle size={14} /> Nội dung dài; app sẽ tự chia đoạn để xử lý ổn định.</div>}
            {!narrationText.trim() && <div className="kc-voice-inline-hint">Bắt đầu bằng cách dán nội dung thoại hoặc nhập file văn bản.</div>}
          </article>

          <article className={`kc-voice-card kc-voice-script-optional ${scriptOpen ? "is-open" : ""}`}>
            <button className="kc-voice-collapsible-header" type="button" onClick={() => setScriptOpen((value) => !value)}><span><FileText size={16} /><b>Kịch bản hình ảnh tùy chọn</b><small>{scriptText.trim() ? "Đã có kịch bản riêng" : "Bỏ trống để dùng nội dung thoại"}</small></span><ChevronDown size={17} /></button>
            {scriptOpen && <div className="kc-voice-collapsible-body"><div className="kc-voice-toolbar"><label><Upload size={14} /> Nhập .txt/.md<input className="visually-hidden-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void chooseTextFile(event.target.files?.[0], "script")} /></label>{scriptFileName && <span className="kc-voice-file-chip"><FileText size={12} /> {scriptFileName}</span>}<button type="button" disabled={!scriptText} onClick={() => { setScriptText(""); setScriptFileName(""); }}><Trash2 size={14} /> Xóa</button></div><textarea className="kc-voice-script-textarea" value={scriptText} placeholder="Nhập mô tả hình ảnh riêng nếu không muốn dùng nguyên văn nội dung thoại…" onChange={(event) => setScriptText(event.target.value)} /><p className="kc-voice-muted-note">Nếu bỏ trống, nội dung thoại sẽ được sử dụng làm nguồn phân tích hình ảnh.</p></div>}
          </article>

          <article className="kc-voice-card">
            <div className="kc-voice-card-header"><div className="kc-voice-card-title"><span className="kc-voice-card-number">02</span><div><h2>Điều chỉnh giọng đọc</h2><p>Thiết lập sẽ được lưu và áp dụng khi tạo Voice cuối.</p></div></div></div>
            <div className="kc-voice-preset-row">{VOICE_PRESETS.map((preset) => <button key={preset.key} className={rate === preset.rate && pitch === preset.pitch && volume === preset.volume ? "is-selected" : ""} type="button" onClick={() => { setRate(preset.rate); setPitch(preset.pitch); setVolume(preset.volume); }}>{preset.label}</button>)}</div>
            <div className="kc-voice-slider-grid">
              <label><span>Tốc độ <b>{rate >= 0 ? "+" : ""}{rate}%</b></span><input type="range" min="-50" max="50" step="5" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label>
              <label><span>Cao độ <b>{pitch >= 0 ? "+" : ""}{pitch}Hz</b></span><input type="range" min="-50" max="50" step="5" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label>
              <label><span>Âm lượng <b>{volume >= 0 ? "+" : ""}{volume}%</b></span><input type="range" min="-50" max="50" step="5" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
            </div>
            <div className="kc-voice-control-grid"><label><span>Khoảng nghỉ giữa đoạn</span><select value={pauseLevel} onChange={(event) => setPauseLevel(event.target.value as VoicePauseLevel)}><option value="off">Tắt</option><option value="medium">Vừa</option><option value="strong">Mạnh</option><option value="dramatic">Kịch tính</option></select></label><label className="kc-voice-disabled-control" title="Engine hiện tại chưa hỗ trợ tùy chọn này."><span>Cảm xúc / phong cách đọc</span><select disabled><option>Đang phát triển</option></select></label></div>
            <div className="kc-voice-card-actions"><button type="button" onClick={() => { setRate(0); setPitch(0); setVolume(0); setPauseLevel("medium"); }}><RotateCcw size={14} /> Đặt lại mặc định</button><button type="button" disabled={!selected || previewLoading} onClick={() => void preview()}><Volume2 size={14} /> Nghe thử cấu hình</button></div>
          </article>

          <article className={`kc-voice-card kc-voice-long-processing ${longTextOpen ? "is-open" : ""}`}>
            <button className="kc-voice-collapsible-header" type="button" onClick={() => setLongTextOpen((value) => !value)}><span><span className="kc-voice-card-number">03</span><b>Xử lý nội dung dài</b><small>Cấu hình cách chia đoạn trước khi bắt đầu workflow</small></span><ChevronDown size={17} /></button>
            {longTextOpen && <div className="kc-voice-collapsible-body"><div className="kc-voice-process-track">{["Kịch bản gốc", "Tách đoạn", "Tạo voice", "Gộp audio", "Cân timing", "Xuất SRT"].map((label, index) => <div key={label}><i>{index + 1}</i><span>{label}</span>{index < 5 && <b>→</b>}</div>)}</div><div className="kc-voice-control-grid"><label><span>Cách tách đoạn</span><select value={splitMode} onChange={(event) => setSplitMode(event.target.value as "paragraph" | "sentence")}><option value="paragraph">Ưu tiên theo đoạn văn</option><option value="sentence">Ưu tiên theo câu</option></select></label><label><span>Số ký tự tối đa mỗi đoạn</span><select value={maxCharsPerChunk} onChange={(event) => setMaxCharsPerChunk(Number(event.target.value))}><option value={1000}>1.000 ký tự</option><option value={2000}>2.000 ký tự</option><option value={3000}>3.000 ký tự</option></select></label></div><label className="kc-voice-checkbox"><input type="checkbox" checked={exportWordSrt} disabled={saving} onChange={(event) => setExportWordSrt(event.target.checked)} /> Xuất thêm SRT theo từng từ</label></div>}
          </article>
        </div>

        <aside className="kc-voice-right-column">
          <article className="kc-voice-card kc-voice-filter-card"><div className="kc-voice-card-header"><div className="kc-voice-card-title"><span className="kc-voice-card-number">A</span><div><h2>Tìm giọng đọc</h2><p>Lọc theo quốc gia, ngôn ngữ hoặc tên người đọc.</p></div></div></div><div className="kc-voice-filter-stack"><label className="kc-voice-disabled-control"><span>TTS engine</span><select value="edge" disabled><option value="edge">Microsoft Edge neural TTS</option></select></label><label><span>Quốc gia / ngôn ngữ</span><select value={voiceLocale} onChange={(event) => setVoiceLocale(event.target.value)}><option value="">Tất cả quốc gia</option>{voiceLocales.map((locale) => <option key={locale} value={locale}>{localeLabel(locale)}</option>)}</select></label><label className="kc-voice-search-field"><span>Tìm theo tên hoặc mã voice</span><Search size={14} /><input value={voiceSearch} placeholder="Ví dụ: Hoài My, Jenny…" onChange={(event) => setVoiceSearch(event.target.value)} /></label><div className="kc-voice-gender-filter">{[["all", "Tất cả"], ["Female", "Nữ"], ["Male", "Nam"]].map(([key, label]) => <button key={key} type="button" className={voiceGender === key ? "is-selected" : ""} onClick={() => setVoiceGender(key as "all" | "Female" | "Male")}>{label}</button>)}</div></div></article>

          <article className="kc-voice-card kc-voice-catalog-card"><div className="kc-voice-list-header"><div><h2>Danh sách giọng</h2><p>{voiceLoading ? "Đang tải catalog…" : `${filteredVoices.length} giọng phù hợp`}</p></div><FileAudio size={17} /></div><div className="kc-voice-catalog-list">{voiceLoading ? <div className="kc-voice-empty-state"><span className="kc-voice-spinner" /> Đang tải danh sách voice…</div> : !filteredVoices.length ? <div className="kc-voice-empty-state"><Search size={18} /> Không tìm thấy giọng phù hợp.</div> : filteredVoices.map((voice) => <div role="button" tabIndex={0} key={voice.shortName} className={`kc-voice-catalog-item ${voice.shortName === selectedVoice ? "is-selected" : ""}`} onClick={() => setSelectedVoice(voice.shortName)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedVoice(voice.shortName); }}><span className="kc-voice-avatar">{initials(voice.friendlyName)}</span><span className="kc-voice-catalog-copy"><strong>{voice.friendlyName}</strong><small>{localeLabel(voice.locale)} · {voice.gender === "Female" ? "Nữ" : voice.gender === "Male" ? "Nam" : voice.gender}</small><code>{voice.shortName}</code></span><span className="kc-voice-catalog-action">{voice.shortName === selectedVoice ? <span className="kc-voice-selected-badge"><Check size={12} /> Đang chọn</span> : <button type="button" aria-label={`Nghe thử ${voice.friendlyName}`} onClick={(event) => { event.stopPropagation(); setSelectedVoice(voice.shortName); void preview(voice); }}><Play size={13} /></button>}</span></div>)}</div></article>

          <article className="kc-voice-card kc-voice-selected-card"><div className="kc-voice-selected-head"><span className="kc-voice-avatar large">{selected ? initials(selected.friendlyName) : "—"}</span><div><span className="kc-voice-overline">GIỌNG ĐÃ CHỌN</span><h2>{selected?.friendlyName || "Chưa chọn giọng"}</h2><p>{selected ? `${localeLabel(selected.locale)} · ${selected.gender === "Female" ? "Nữ" : selected.gender === "Male" ? "Nam" : selected.gender}` : "Chọn một voice trong danh sách"}</p></div><span className="kc-voice-status-badge">{selected ? <><Check size={12} /> Đã chọn</> : "Thiếu"}</span></div>{selected && <div className="kc-voice-selected-meta"><code>{selected.shortName}</code><button type="button" disabled={previewLoading} onClick={() => void preview()}><Play size={13} /> Nghe thử</button><button type="button" onClick={() => document.querySelector<HTMLElement>(".kc-voice-catalog-card")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Đổi giọng</button></div>}</article>

          <article className="kc-voice-card kc-voice-preview-card"><div className="kc-voice-preview-tabs"><button type="button" className={previewTab === "quick" ? "is-active" : ""} onClick={() => setPreviewTab("quick")}>Preview nhanh</button><button type="button" className={previewTab === "content" ? "is-active" : ""} onClick={() => setPreviewTab("content")}>Dùng đoạn trong nội dung</button></div><div className="kc-voice-preview-copy"><span>{previewTab === "content" ? contentPreview : "Nghe thử giọng mẫu trước khi lưu cấu hình."}</span></div><div className="kc-voice-player"><button type="button" className="kc-voice-play-button" disabled={!selected || previewLoading} onClick={togglePreview}>{previewLoading ? <span className="kc-voice-spinner" /> : previewPlaying ? <Pause size={17} /> : <Play size={17} />}</button><div className="kc-voice-progress"><span style={{ width: `${previewPercent}%` }} /><input aria-label="Tiến trình preview" type="range" min="0" max={previewDuration || 1} step="0.01" value={previewCurrent} onChange={(event) => { if (previewAudio.current) previewAudio.current.currentTime = Number(event.target.value); }} /></div><small>{Math.floor(previewCurrent)}:{String(Math.floor(previewDuration) % 60).padStart(2, "0")}</small></div><p className="kc-voice-preview-note">Preview hiện dùng endpoint giọng mẫu; tốc độ/pitch sẽ được áp dụng khi tạo Voice cuối.</p></article>

          <article className="kc-voice-card kc-voice-readiness-card"><div className="kc-voice-list-header"><div><h2>Kiểm tra dữ liệu</h2><p>Điều kiện trước khi tiếp tục sang Nhân vật.</p></div><Check size={17} /></div><ul><li className={narrationText.trim() ? "is-valid" : "is-missing"}><span>{narrationText.trim() ? <Check size={13} /> : <AlertTriangle size={13} />}</span><b>Nội dung thoại</b><small>{narrationText.trim() ? "Đã có" : "Còn thiếu"}</small></li><li className={selected ? "is-valid" : "is-missing"}><span>{selected ? <Check size={13} /> : <AlertTriangle size={13} />}</span><b>Giọng đọc</b><small>{selected ? "Đã chọn" : "Còn thiếu"}</small></li><li className="is-valid"><span><Check size={13} /></span><b>Cấu hình giọng</b><small>Đã lưu</small></li><li className={scriptText.trim() ? "is-valid" : "is-neutral"}><span>{scriptText.trim() ? <Check size={13} /> : <FileText size={13} />}</span><b>Kịch bản hình ảnh</b><small>{scriptText.trim() ? "Có" : "Không sử dụng"}</small></li><li className="is-deferred"><span><Clock3 size={13} /></span><b>Audio + SRT</b><small>Sẽ tạo khi bắt đầu workflow</small></li></ul><div className={`kc-voice-ready-message ${canContinue ? "is-ready" : ""}`}>{canContinue ? <><Check size={14} /> Sẵn sàng để tiếp tục.</> : <><AlertTriangle size={14} /> Cần nội dung thoại và giọng đọc.</>}</div></article>
        </aside>
      </div>

      <footer className="kc-voice-action-bar"><div className="kc-voice-action-left"><button type="button" className="kc-voice-plain-button" disabled={saving} onClick={onBack}><ArrowLeft size={15} /> Quay lại</button><button type="button" className="kc-voice-plain-button" disabled={saving} onClick={() => void continueSetup(false)}><Check size={15} /> Lưu bản nháp</button></div><span>Nội dung và cấu hình giọng đọc sẽ được lưu tự động.</span><button type="button" className="kc-voice-primary-button" disabled={!canContinue} onClick={() => void continueSetup()}>{saving ? "Đang lưu…" : "Lưu và tiếp tục đến Nhân vật"}<ArrowRight size={16} /></button></footer>
      {error && <div className="kc-voice-error" role="alert"><AlertTriangle size={15} /> {error}</div>}
    </section>
  );
}
