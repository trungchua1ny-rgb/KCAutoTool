import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  FileAudio,
  FileText,
  FolderOpen,
  LoaderCircle,
  Play,
  Square,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_VISUAL_BIBLE,
  type TimelineSession,
  type TimelineStyleReference,
  type TimelineWorkflowSource,
  type VisualBible,
} from "../shared/timeline";
import type { GraphicStylePreset } from "../shared/visual-style";
import type {
  VoiceCatalogEntry,
  VoiceGenerateResult,
  VoicePauseLevel,
  VoiceProgress,
} from "../shared/voice";
import { VisualBiblePanel } from "./VisualBiblePanel";
import type { HomeWorkflowMode, IntegratedWorkflowHandoff } from "./integrated-workflow";

const EMOTION_PRESETS = {
  natural: { label: "Tự nhiên", rate: 0, pitch: 0, volume: 0 },
  warm: { label: "Ấm áp", rate: -5, pitch: -5, volume: 0 },
  inspiring: { label: "Truyền cảm", rate: 5, pitch: 5, volume: 5 },
  climax: { label: "Kịch tính", rate: 10, pitch: 10, volume: 20 },
  urgent: { label: "Khẩn cấp", rate: 20, pitch: 5, volume: 10 },
  whisper: { label: "Thì thầm", rate: -10, pitch: -10, volume: -25 },
} as const;

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
    return `${country} · ${language} (${locale})`;
  } catch {
    return locale;
  }
}

export function VoiceWorkflow({
  mode,
  session,
  chatConnected,
  flowConnected,
  onBack,
  onComplete,
}: {
  mode: Exclude<HomeWorkflowMode, "srt_script">;
  session?: TimelineSession | null;
  chatConnected: boolean;
  flowConnected: boolean;
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
  const [selectedVoice, setSelectedVoice] = useState(session?.workflowSource.voiceName || "");
  const [rate, setRate] = useState(session?.workflowSource.voiceRate ?? 0);
  const [pitch, setPitch] = useState(session?.workflowSource.voicePitch ?? 0);
  const [volume, setVolume] = useState(session?.workflowSource.voiceVolume ?? 0);
  const [pauseLevel, setPauseLevel] = useState<VoicePauseLevel>(session?.workflowSource.voicePauseLevel || "medium");
  const [splitMode, setSplitMode] = useState<"paragraph" | "sentence">(session?.workflowSource.voiceSplitMode || "paragraph");
  const [maxCharsPerChunk, setMaxCharsPerChunk] = useState(session?.workflowSource.voiceMaxCharsPerChunk || 3000);
  const [exportWordSrt, setExportWordSrt] = useState(Boolean(session?.workflowSource.voiceExportWordSrt));
  const [visualBible, setVisualBible] = useState<VisualBible>(() => structuredClone(session?.visualBible || DEFAULT_VISUAL_BIBLE));
  const [styleReference, setStyleReference] = useState<TimelineStyleReference | null>(session?.styleReference || null);
  const [stylePresets, setStylePresets] = useState<GraphicStylePreset[]>([]);
  const [styleError, setStyleError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<VoiceProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VoiceGenerateResult | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [pendingHandoff, setPendingHandoff] = useState<IntegratedWorkflowHandoff | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const projectSession = useRef<{ id: string; name: string } | null>(
    session ? { id: session.id, name: session.name } : null,
  );

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
    setVisualBible(structuredClone(session.visualBible));
    setStyleReference(session.styleReference);
    setResult(null);
    setPendingHandoff(null);
    setError("");
  }, [session?.id]);

  useEffect(() => {
    let active = true;
    if (!result?.audioPath) {
      setAudioUrl("");
      return undefined;
    }
    void window.flowx?.media.getStreamUrl(result.audioPath).then(
      (url) => { if (active) setAudioUrl(url); },
      () => { if (active) setAudioUrl(""); },
    );
    return () => { active = false; };
  }, [result?.audioPath]);

  useEffect(() => {
    let active = true;
    const bridge = window.flowx;
    if (!bridge) return undefined;
    const unsubscribe = bridge.voice.onProgress((next) => {
      if (active) setProgress(next);
    });
    void Promise.all([bridge.voice.list(), bridge.visualStyles.list()]).then(
      ([catalog, presets]) => {
        if (!active) return;
        const sorted = [...catalog].sort((left, right) => {
          const leftRank = left.locale.startsWith("vi-") ? 0 : 1;
          const rightRank = right.locale.startsWith("vi-") ? 0 : 1;
          return leftRank - rightRank || left.locale.localeCompare(right.locale) || left.friendlyName.localeCompare(right.friendlyName);
        });
        setVoices(sorted);
        setStylePresets(presets);
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
      unsubscribe();
      previewAudio.current?.pause();
    };
  }, [session?.id]);

  const filteredVoices = useMemo(() => {
    const query = voiceSearch.trim().toLocaleLowerCase();
    return voices.filter((voice) => {
      if (voiceLocale && voice.locale !== voiceLocale) return false;
      if (!query) return true;
      return `${voice.friendlyName} ${voice.shortName}`.toLocaleLowerCase().includes(query);
    });
  }, [voiceLocale, voiceSearch, voices]);
  const voiceLocales = useMemo(() => [...new Set(voices.map((voice) => voice.locale))]
    .sort((left, right) => localeLabel(left).localeCompare(localeLabel(right), "vi")), [voices]);

  useEffect(() => {
    if (!filteredVoices.length || filteredVoices.some((voice) => voice.shortName === selectedVoice)) return;
    setSelectedVoice(filteredVoices[0].shortName);
  }, [filteredVoices, selectedVoice]);

  const selected = voices.find((voice) => voice.shortName === selectedVoice) || null;
  const workersReady = mode !== "full_auto" || (chatConnected && flowConnected);
  const canStart = Boolean(narrationText.trim() && selectedVoice && visualBible.style.trim() && !running && workersReady);

  const chooseTextFile = async (
    file: File | undefined,
    kind: "narration" | "script",
  ) => {
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
    }
    setError("");
  };

  const preview = async () => {
    if (!selected || !window.flowx) return;
    setError("");
    try {
      previewAudio.current?.pause();
      const dataUrl = await window.flowx.voice.preview(selected.shortName, selected.locale);
      const audio = new Audio(dataUrl);
      previewAudio.current = audio;
      await audio.play();
    } catch (caught) {
      setError(`Không nghe thử được giọng: ${message(caught)}`);
    }
  };

  const saveStylePreset = (name: string) => {
    void window.flowx?.visualStyles.save({ name, style: visualBible.style }).then(
      (saved) => setStylePresets(saved),
      (caught) => setStyleError(message(caught)),
    );
  };

  const deleteStylePreset = (id: string) => {
    void window.flowx?.visualStyles.remove(id).then(
      (saved) => setStylePresets(saved),
      (caught) => setStyleError(message(caught)),
    );
  };

  const start = async () => {
    const bridge = window.flowx;
    if (!bridge || !canStart) return;
    setRunning(true);
    setResult(null);
    setPendingHandoff(null);
    setProgress(null);
    setError("");
    try {
      const workspaceSession = projectSession.current ||
        await bridge.timeline.createSession(projectName.trim() || "Video mới");
      projectSession.current = { id: workspaceSession.id, name: workspaceSession.name };
      const generated = await bridge.voice.generate({
        projectId: workspaceSession.id,
        projectName: workspaceSession.name,
        narrationText,
        narrationFileName: narrationFileName || "loi-thoai.txt",
        voice: selectedVoice,
        prosody: { rate, pitch, volume, pauseLevel },
        splitMode,
        maxCharsPerChunk,
        exportWordSrt,
      });
      const effectiveScript = scriptText.trim() || narrationText.trim();
      const source: TimelineWorkflowSource = {
        narrationText,
        narrationFileName: narrationFileName || "loi-thoai.txt",
        narrationPath: "",
        srtText: generated.srtText,
        scriptText: effectiveScript,
        srtFileName: generated.srtFileName,
        scriptFileName: scriptFileName || narrationFileName || "loi-thoai.txt",
        srtPath: generated.srtPath,
        scriptPath: "",
        audioPath: generated.audioPath,
        audioFileName: generated.audioFileName,
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
        scenes: [],
        visualBible,
        styleReference,
        workflowMode,
        workflowSource: source,
      });
      const handoff: IntegratedWorkflowHandoff = {
        id: `${workspaceSession.id}:${Date.now()}`,
        sessionId: workspaceSession.id,
        workflowMode,
        workflowSource: source,
        visualBible,
        styleReference,
        autoGenerateTimeline: mode === "full_auto",
      };
      setResult(generated);
      setPendingHandoff(handoff);
      if (mode === "full_auto") onComplete(handoff);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="voice-workflow">
      <header className="voice-workflow-header">
        <button className="button secondary compact" type="button" disabled={running} onClick={onBack}>
          <ArrowLeft size={15} /> Trang chủ
        </button>
        <div>
          <p className="eyebrow">Voice → SRT → Video</p>
          <h2>{mode === "full_auto" ? "Tạo tự động toàn bộ video" : "Tạo video từng bước"}</h2>
          <p>File thoại là bắt buộc. Kịch bản hình ảnh có thể bỏ trống; khi đó app dùng chính nội dung thoại để dựng cảnh.</p>
        </div>
      </header>

      <div className="voice-form-grid">
        <section className="voice-card">
          <span className="voice-step-number">01</span>
          <div className="voice-card-heading"><FileText size={18} /><div><strong>Nội dung dự án</strong><small>Thoại bắt buộc · kịch bản tùy chọn</small></div></div>
          <label className="field"><span>Tên phiên</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
          <div className="voice-file-row">
            <label className="button secondary compact">Chọn file thoại
              <input className="visually-hidden-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void chooseTextFile(event.target.files?.[0], "narration")} />
            </label>
            <span>{narrationFileName || "Chưa chọn · bắt buộc"}</span>
          </div>
          <textarea className="voice-script-preview" value={narrationText} placeholder="Hoặc dán toàn bộ nội dung cần đọc vào đây…" onChange={(event) => setNarrationText(event.target.value)} />
          <div className="voice-file-row">
            <label className="button secondary compact">Chọn kịch bản hình ảnh
              <input className="visually-hidden-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void chooseTextFile(event.target.files?.[0], "script")} />
            </label>
            <span>{scriptFileName || "Không có · sẽ dùng nội dung thoại"}</span>
          </div>
        </section>

        <section className="voice-card">
          <span className="voice-step-number">02</span>
          <div className="voice-card-heading"><FileAudio size={18} /><div><strong>Chọn và điều chỉnh giọng</strong><small>Microsoft Edge neural TTS</small></div></div>
          <div className="voice-engine-grid">
            <label className="field"><span>TTS engine</span><select value="edge" disabled><option value="edge">Microsoft Edge TTS</option></select></label>
            <label className="field"><span>Ngôn ngữ</span><input value={selected?.locale || "—"} readOnly /></label>
            <label className="field"><span>Giới tính</span><input value={selected?.gender || "—"} readOnly /></label>
          </div>
          <div className="voice-filter-grid">
            <label className="field"><span>Quốc gia / ngôn ngữ</span><select value={voiceLocale} onChange={(event) => setVoiceLocale(event.target.value)}><option value="">Tất cả quốc gia</option>{voiceLocales.map((locale) => <option key={locale} value={locale}>{localeLabel(locale)}</option>)}</select></label>
            <label className="field"><span>Tên người đọc</span><input value={voiceSearch} placeholder="Ví dụ: Hoài My, Nam Minh…" onChange={(event) => setVoiceSearch(event.target.value)} /></label>
          </div>
          <div className="voice-select-row">
            <select disabled={voiceLoading} value={selectedVoice} onChange={(event) => setSelectedVoice(event.target.value)}>
              {filteredVoices.map((voice) => <option key={voice.shortName} value={voice.shortName}>{voice.friendlyName} · {localeLabel(voice.locale)} · {voice.gender}</option>)}
            </select>
            <button className="icon-button" type="button" title="Nghe thử" disabled={!selected} onClick={() => void preview()}><Play size={16} /></button>
          </div>
          <div className="emotion-row">
            {Object.entries(EMOTION_PRESETS).map(([key, preset]) => (
              <button key={key} type="button" onClick={() => { setRate(preset.rate); setPitch(preset.pitch); setVolume(preset.volume); }}>{preset.label}</button>
            ))}
          </div>
          <label className="voice-slider"><span>Tốc độ <b>{rate >= 0 ? "+" : ""}{rate}%</b></span><input type="range" min="-50" max="50" step="5" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label>
          <label className="voice-slider"><span>Cao độ <b>{pitch >= 0 ? "+" : ""}{pitch}Hz</b></span><input type="range" min="-50" max="50" step="5" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label>
          <label className="voice-slider"><span>Âm lượng <b>{volume >= 0 ? "+" : ""}{volume}%</b></span><input type="range" min="-50" max="50" step="5" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
          <label className="field"><span>Ngắt nghỉ theo câu</span><select value={pauseLevel} onChange={(event) => setPauseLevel(event.target.value as VoicePauseLevel)}><option value="off">Tắt</option><option value="medium">Vừa</option><option value="strong">Mạnh</option><option value="dramatic">Kịch tính</option></select></label>
          <div className="voice-split-controls">
            <label className="field"><span>Tách kịch bản dài</span><select value={splitMode} onChange={(event) => setSplitMode(event.target.value as "paragraph" | "sentence")}><option value="paragraph">Ưu tiên theo đoạn văn</option><option value="sentence">Ưu tiên theo câu</option></select></label>
            <label className="field"><span>Giới hạn mỗi đoạn</span><select value={maxCharsPerChunk} onChange={(event) => setMaxCharsPerChunk(Number(event.target.value))}><option value={1000}>1.000 ký tự</option><option value={2000}>2.000 ký tự</option><option value={3000}>3.000 ký tự</option></select></label>
          </div>
        </section>
      </div>

      <section className="voice-processing-panel">
        <header><AudioLines size={17} /><div><strong>Xử lý kịch bản dài</strong><span>{progress?.message || "Sẵn sàng xử lý bằng Edge TTS và FFmpeg"}</span></div></header>
        <div className="voice-stage-track">
          {["Kịch bản gốc", "Tách đoạn", "TTS xử lý", "Gộp audio", "Cân chỉnh timing", "Voice hoàn chỉnh"].map((label, index) => {
            const stageIndex = progress?.stage === "preparing" ? 1 : progress?.stage === "synthesizing" ? 2 : progress?.stage === "joining" ? 3 : progress?.stage === "pauses" || progress?.stage === "subtitles" ? 4 : progress?.stage === "done" ? 5 : 0;
            return <div key={label} className={index < stageIndex ? "is-done" : index === stageIndex && running ? "is-active" : ""}><i>{index + 1}</i><span>{label}</span></div>;
          })}
        </div>
        <div className="voice-waveform" aria-label="Tiến độ tạo voice">
          {Array.from({ length: 38 }, (_, index) => <i key={index} />)}
          <span style={{ width: `${progress?.total ? Math.round((progress.completed / progress.total) * 100) : result ? 100 : 0}%` }} />
        </div>
        {audioUrl && <audio className="voice-audio-player" controls preload="metadata" src={audioUrl} />}
        <div className="voice-srt-status">
          <div><span>Trạng thái</span><strong>{result ? "Hoàn thành" : running ? "Đang xuất" : "Chưa tạo"}</strong></div>
          <div><span>Tổng số từ</span><strong>{result?.words.length || 0}</strong></div>
          <div><span>Tổng số dòng SRT</span><strong>{result?.srtText.match(/-->/g)?.length || 0}</strong></div>
          <div className="is-path"><span>File SRT</span><strong title={result?.srtPath}>{result?.srtPath || "Chưa có đường dẫn"}</strong></div>
          <label><input type="checkbox" checked={exportWordSrt} disabled={running} onChange={(event) => setExportWordSrt(event.target.checked)} /> Xuất thêm SRT theo từng từ</label>
          <button className="button secondary compact" type="button" disabled={!projectSession.current} onClick={() => projectSession.current && void window.flowx?.system.openOutput(projectSession.current.id, "audio")}><FolderOpen size={14} /> Mở thư mục</button>
        </div>
      </section>

      <div className="voice-visual-bible">
        <span className="voice-step-number">03</span>
        <VisualBiblePanel
          value={visualBible}
          onChange={setVisualBible}
          presets={stylePresets}
          presetError={styleError}
          onSavePreset={saveStylePreset}
          onDeletePreset={deleteStylePreset}
          styleReference={styleReference}
          onStyleReferenceChange={setStyleReference}
        />
      </div>

      <section className="voice-start-bar">
        <div>
          <strong>{running ? progress?.message || "Đang tạo voice…" : result ? "Voice và SRT đã sẵn sàng" : "Sẵn sàng bắt đầu"}</strong>
          <span>{result
            ? `${result.audioFileName} · ${result.srtFileName} · ${Math.round(result.durationSeconds)} giây`
            : !visualBible.style.trim()
              ? "Hãy nhập phong cách đồ họa bắt buộc trong Visual Bible trước khi bắt đầu."
              : mode === "full_auto" && !workersReady
              ? "Hãy kết nối cả ChatGPT và Google Flow trước khi chạy tự động toàn bộ."
              : mode === "full_auto"
                ? "App sẽ tự chuyển sang timeline và sản xuất video."
                : "App sẽ dừng để bạn kiểm tra trước khi dựng video."}</span>
        </div>
        <div className="voice-start-actions">
          {running ? (
            <button className="button danger" type="button" onClick={() => void window.flowx?.voice.cancel()}><Square size={15} /> Dừng</button>
          ) : pendingHandoff && mode === "step_by_step" ? (
            <button className="button primary" type="button" onClick={() => onComplete(pendingHandoff)}><CheckCircle2 size={16} /> Đưa sang dựng video</button>
          ) : (
            <button className="button primary" type="button" disabled={!canStart} onClick={() => void start()}><WandSparkles size={16} /> Bắt đầu</button>
          )}
          {running && <LoaderCircle className="spin" size={18} />}
        </div>
      </section>
      {error && <div className="form-error">{error}</div>}
    </section>
  );
}
