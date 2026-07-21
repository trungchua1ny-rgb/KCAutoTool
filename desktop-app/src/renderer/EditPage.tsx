import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight,
  Download, Expand, Film, FolderSync, Gauge, HelpCircle, ImageOff, Link2,
  Lock, Maximize2, Music2, Pause, Play, Redo2, RefreshCcw, RotateCcw,
  Save, Scissors, SkipBack, SkipForward, Split, Subtitles, Trash2, Undo2,
  Unlink, Upload, Video, Volume2, VolumeX, WandSparkles, ZoomIn, ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditClip, EditExportOptions, EditProject } from "../shared/edit";
import type { TimelineSession } from "../shared/timeline";
import { DEFAULT_VIDEO_ASSEMBLY_SETTINGS, type AssemblyProgress, type AssemblyValidation, type VideoAssemblySettings } from "../shared/video-assembly";
import "./edit.css";
import "./assembly.css";

function formatTimecode(ms: number, fps = 60): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1_000);
  const frames = Math.min(fps - 1, Math.floor((safe % 1_000) / (1_000 / fps)));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, "0")).join(":");
}

function clipEnd(clip: EditClip): number { return clip.startMs + clip.durationMs; }

function hasSeriousError(project: EditProject): boolean {
  return project.clips.some((clip) => clip.visible && clip.warnings.some((warning) => warning.severity === "error"));
}

function IconButton({ title, disabled, active, onClick, children }: { title: string; disabled?: boolean; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return <button type="button" className={active ? "is-active" : ""} title={title} aria-label={title} disabled={disabled} onClick={onClick}>{children}</button>;
}

function PlaybackControls({ playing, playheadMs, durationMs, muted, volume, onToggle, onFrame, onClip, onMute, onVolume }: {
  playing: boolean; playheadMs: number; durationMs: number; muted: boolean; volume: number;
  onToggle: () => void; onFrame: (direction: -1 | 1) => void; onClip: (direction: -1 | 1) => void; onMute: () => void; onVolume: (value: number) => void;
}) {
  return <div className="edit-playback-controls">
    <code>{formatTimecode(playheadMs)} <span>/ {formatTimecode(durationMs)}</span></code>
    <div>
      <IconButton title="Clip trước" onClick={() => onClip(-1)}><SkipBack size={15} /></IconButton>
      <IconButton title="Lùi một frame" onClick={() => onFrame(-1)}><ChevronLeft size={16} /></IconButton>
      <button className="edit-play-main" type="button" aria-label={playing ? "Tạm dừng" : "Phát"} onClick={onToggle}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <IconButton title="Tiến một frame" onClick={() => onFrame(1)}><ChevronRight size={16} /></IconButton>
      <IconButton title="Clip tiếp theo" onClick={() => onClip(1)}><SkipForward size={15} /></IconButton>
    </div>
    <div className="edit-preview-volume"><IconButton title={muted ? "Bật âm thanh" : "Tắt âm thanh"} onClick={onMute}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</IconButton><input aria-label="Âm lượng preview" type="range" min="0" max="100" value={volume} onChange={(event) => onVolume(Number(event.target.value))} /><select aria-label="Chế độ fit"><option>Phù hợp</option><option>100%</option><option>Điền khung</option></select><IconButton title="Toàn màn hình"><Maximize2 size={15} /></IconButton></div>
  </div>;
}

function VideoPreview({ sourceUrl, activeClip, playing, muted, volume, onEnded, onTimeChange, videoRef }: {
  sourceUrl: string; activeClip: EditClip | null; playing: boolean; muted: boolean; volume: number; onEnded: () => void; onTimeChange: (relativeMs: number) => void; videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume / 100;
    if (playing) void video.play().catch(() => undefined); else video.pause();
  }, [muted, playing, videoRef, volume, sourceUrl]);
  return <section className="edit-preview-panel">
    <div className="edit-preview-canvas">
      <span className="edit-aspect-badge">16:9 · 1920×1080 · 60 FPS</span>
      {sourceUrl ? <video ref={videoRef} src={sourceUrl} onLoadedMetadata={(event) => { event.currentTarget.currentTime = (activeClip?.trimInMs || 0) / 1_000; }} onTimeUpdate={(event) => { if (!activeClip) return; const relativeMs = Math.max(0, event.currentTarget.currentTime * 1_000 - activeClip.trimInMs); onTimeChange(Math.min(activeClip.durationMs, relativeMs)); if (relativeMs >= activeClip.durationMs - 12) { event.currentTarget.pause(); onEnded(); } }} onEnded={onEnded} playsInline /> : <div className="edit-preview-empty"><ImageOff size={38} /><strong>{activeClip ? "Không thể tải clip" : "Chưa có clip được chọn"}</strong><span>Chọn một clip trên timeline để xem trước.</span></div>}
    </div>
  </section>;
}

function CurrentSceneInfo({ clip, project, onOpenScene }: { clip: EditClip | null; project: EditProject; onOpenScene: (sceneId: string) => void }) {
  return <section className="edit-scene-info">
    <header><div><Film size={16} /><span>SCENE HIỆN TẠI</span></div>{clip?.chainRole && <b className={`is-${clip.chainRole}`}>{clip.chainRole}</b>}</header>
    {clip ? <>
      <h2>Scene {String(clip.sceneNumber || 0).padStart(2, "0")}</h2>
      <dl><div><dt>Thời lượng</dt><dd>{(clip.durationMs / 1_000).toFixed(2)}s</dd></div><div><dt>Bắt đầu</dt><dd>{formatTimecode(clip.startMs)}</dd></div><div><dt>Kết thúc</dt><dd>{formatTimecode(clipEnd(clip))}</dd></div><div><dt>Trạng thái</dt><dd className={clip.warnings.length ? "is-warning" : "is-ok"}>{clip.warnings.length ? "Cần kiểm tra" : "OK"}</dd></div></dl>
      <div className="edit-linked-files"><p><Video size={13} /><span>{clip.sourcePath.split(/[\\/]/).at(-1) || "Thiếu video"}</span></p><p><Volume2 size={13} /><span>{project.audioPath.split(/[\\/]/).at(-1) || "Thiếu audio chính"}</span></p><p><Subtitles size={13} /><span>{project.subtitlePath.split(/[\\/]/).at(-1) || "Thiếu subtitle"}</span></p></div>
      {clip.warnings.map((warning) => <p className={`edit-inline-warning is-${warning.severity}`} key={warning.code}><AlertTriangle size={13} />{warning.message}</p>)}
      <button type="button" onClick={() => clip.sceneId && onOpenScene(clip.sceneId)}><RefreshCcw size={14} /> Quay lại scene để tạo lại</button>
    </> : <div className="edit-info-empty">Chọn clip để xem thông tin scene.</div>}
  </section>;
}

function ClipInspector({ clip, tab, onTab, onChange, onReplace, onSplit, onRemove, onRestore, onOpenScene }: {
  clip: EditClip | null; tab: "video" | "audio" | "subtitle"; onTab: (tab: "video" | "audio" | "subtitle") => void;
  onChange: (patch: Partial<EditClip>) => void; onReplace: () => void; onSplit: () => void; onRemove: () => void; onRestore: () => void; onOpenScene: () => void;
}) {
  return <aside className="edit-inspector">
    <header><div><Gauge size={16} /><strong>Chỉnh sửa clip</strong></div><button type="button" title="Thu gọn inspector"><ArrowRight size={15} /></button></header>
    <nav>{(["video", "audio", "subtitle"] as const).map((value) => <button type="button" key={value} className={tab === value ? "is-active" : ""} onClick={() => onTab(value)}>{value === "video" ? "Video" : value === "audio" ? "Audio" : "Subtitle"}</button>)}</nav>
    {!clip ? <div className="edit-inspector-empty"><Video size={30} /><strong>Chọn một clip</strong><span>Chọn clip trên timeline để chỉnh sửa.</span></div> : tab === "video" ? <div className="edit-inspector-body">
      <section><h3>THÔNG TIN FILE</h3><dl><div><dt>Tên file</dt><dd title={clip.sourcePath}>{clip.sourcePath.split(/[\\/]/).at(-1)}</dd></div><div><dt>Thời lượng gốc</dt><dd>{((clip.sourceDurationMs || clip.durationMs) / 1_000).toFixed(2)}s</dd></div><div><dt>Đang dùng</dt><dd>{(clip.durationMs / 1_000).toFixed(2)}s</dd></div><div><dt>Đầu ra</dt><dd>1080p · 60 FPS</dd></div></dl></section>
      <section><h3>ÂM THANH CLIP</h3><label className="edit-toggle-row"><span><VolumeX size={14} /> Tắt tiếng clip</span><input type="checkbox" checked={clip.muted} onChange={(event) => onChange({ muted: event.target.checked })} /></label><label className="edit-slider-row"><span>Âm lượng <b>{clip.volume}%</b></span><input type="range" min="0" max="150" value={clip.volume} onChange={(event) => onChange({ volume: Number(event.target.value) })} /></label><button className="edit-reset" type="button" onClick={() => onChange({ volume: 100, muted: false })}><RotateCcw size={13} /> Đặt lại</button></section>
      <section><h3>CÔNG CỤ</h3><div className="edit-tool-grid"><button type="button" onClick={onReplace}><Upload size={14} />Thay video</button><button type="button" onClick={() => onChange({ trimInMs: Math.min(clip.trimInMs + 100, Math.max(0, clip.trimInMs + clip.durationMs - 100)), durationMs: Math.max(100, clip.durationMs - 100) })}><Scissors size={14} />Trim đầu</button><button type="button" onClick={() => onChange({ trimOutMs: clip.trimInMs + Math.max(100, clip.durationMs - 100), durationMs: Math.max(100, clip.durationMs - 100) })}><Scissors size={14} />Trim cuối</button><button type="button" onClick={onSplit}><Split size={14} />Tách clip</button><button type="button" onClick={onOpenScene}><RefreshCcw size={14} />Về scene</button><button type="button" onClick={onRestore}><RotateCcw size={14} />Clip gốc</button><button className="is-danger" type="button" onClick={onRemove}><Trash2 size={14} />Xóa khỏi bản dựng</button></div></section>
      {clip.warnings.length > 0 && <section className="edit-warning-card"><AlertTriangle size={15} /><div><strong>Cảnh báo clip</strong>{clip.warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}</div></section>}
      <section><h3>GHI CHÚ</h3><textarea value={clip.note || ""} onChange={(event) => onChange({ note: event.target.value })} placeholder="Thêm ghi chú cho cảnh này..." maxLength={500} /><small>{(clip.note || "").length}/500 ký tự</small></section>
    </div> : tab === "audio" ? <div className="edit-inspector-body"><section><h3>AUDIO LIÊN KẾT</h3><div className="edit-mini-wave">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ height: `${25 + ((index * 17) % 70)}%` }} />)}</div><label className="edit-toggle-row"><span><VolumeX size={14} /> Tắt tiếng</span><input type="checkbox" checked={clip.muted} onChange={(event) => onChange({ muted: event.target.checked })} /></label><label className="edit-slider-row"><span>Âm lượng <b>{clip.volume}%</b></span><input type="range" min="0" max="150" value={clip.volume} onChange={(event) => onChange({ volume: Number(event.target.value) })} /></label></section><section className="edit-disabled-feature"><Lock size={14} /><p>Fade và offset audio sẽ được hỗ trợ sau khi backend audio editor hoàn tất.</p></section></div> : <div className="edit-inspector-body"><section><h3>SUBTITLE</h3><p>Subtitle của scene được lấy từ file SRT của phiên.</p><label className="edit-toggle-row"><span><Subtitles size={14} /> Hiển thị subtitle</span><input type="checkbox" defaultChecked /></label></section><section className="edit-disabled-feature"><Lock size={14} /><p>Chỉnh nội dung SRT đầy đủ được thực hiện tại nguồn subtitle.</p></section></div>}
  </aside>;
}

function TimelineToolbar({ canUndo, canRedo, snapping, zoom, onUndo, onRedo, onSplit, onRemove, onSnapping, onZoom, onFit }: {
  canUndo: boolean; canRedo: boolean; snapping: boolean; zoom: number; onUndo: () => void; onRedo: () => void; onSplit: () => void; onRemove: () => void; onSnapping: () => void; onZoom: (value: number) => void; onFit: () => void;
}) {
  return <div className="edit-timeline-toolbar"><div><IconButton title="Undo · Ctrl+Z" disabled={!canUndo} onClick={onUndo}><Undo2 size={14} /></IconButton><IconButton title="Redo · Ctrl+Shift+Z" disabled={!canRedo} onClick={onRedo}><Redo2 size={14} /></IconButton><IconButton title="Ripple edit · Chưa hỗ trợ" disabled><Link2 size={14} /></IconButton><IconButton title="Snapping" active={snapping} onClick={onSnapping}><WandSparkles size={14} /></IconButton><IconButton title="Thêm marker · Chưa hỗ trợ" disabled><Gauge size={14} /></IconButton><IconButton title="Split tại playhead · S" onClick={onSplit}><Split size={14} /></IconButton><IconButton title="Xóa clip đang chọn" onClick={onRemove}><Trash2 size={14} /></IconButton><IconButton title="Link audio · Chưa hỗ trợ" disabled><Unlink size={14} /></IconButton></div><div><IconButton title="Thu nhỏ" onClick={() => onZoom(Math.max(.35, zoom - .15))}><ZoomOut size={14} /></IconButton><input aria-label="Zoom timeline" type="range" min="35" max="240" value={zoom * 100} onChange={(event) => onZoom(Number(event.target.value) / 100)} /><span>{Math.round(zoom * 100)}%</span><IconButton title="Phóng to" onClick={() => onZoom(Math.min(2.4, zoom + .15))}><ZoomIn size={14} /></IconButton><IconButton title="Fit timeline" onClick={onFit}><Expand size={14} /></IconButton></div></div>;
}

function TimelineTracks({ project, selectedId, playheadMs, zoom, onSelect, onSeek }: { project: EditProject; selectedId: string; playheadMs: number; zoom: number; onSelect: (id: string) => void; onSeek: (ms: number) => void }) {
  const pixelsPerSecond = 30 * zoom;
  const width = Math.max(1_200, project.durationMs / 1_000 * pixelsPerSecond);
  const markers = Array.from({ length: Math.ceil(project.durationMs / 10_000) + 1 }, (_, index) => index * 10_000);
  const visibleClips = project.clips.filter((clip) => clip.kind === "video" && clip.visible);
  return <div className="edit-timeline-shell">
    <div className="edit-track-heads"><div className="edit-ruler-spacer">TRACK</div><div><strong>1</strong><span><Film size={13} />Video Scene</span><button title="Khóa track"><Lock size={12} /></button></div><div><strong>2</strong><span><Volume2 size={13} />Audio chính</span><button title="Tắt tiếng"><Volume2 size={12} /></button></div><div><strong>3</strong><span><Subtitles size={13} />Subtitle</span><button title="Hiện/ẩn"><Subtitles size={12} /></button></div><div className="is-disabled"><strong>4</strong><span><Music2 size={13} />Nhạc nền <b>Sắp ra mắt</b></span><button disabled><Lock size={12} /></button></div></div>
    <div className="edit-timeline-scroll"><div className="edit-timeline-content" style={{ width }}>
      <div className="edit-time-ruler" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, (event.clientX - box.left) / pixelsPerSecond * 1_000)); }}>{markers.map((ms) => <span key={ms} style={{ left: ms / 1_000 * pixelsPerSecond }}><i />{formatTimecode(ms).slice(0, 8)}</span>)}</div>
      <div className="edit-track is-video">{visibleClips.map((clip) => <button key={clip.id} type="button" className={`${selectedId === clip.id ? "is-selected" : ""} ${clip.warnings.length ? "has-warning" : ""}`} style={{ left: clip.startMs / 1_000 * pixelsPerSecond, width: Math.max(42, clip.durationMs / 1_000 * pixelsPerSecond) }} onClick={() => onSelect(clip.id)}><i className="edit-clip-thumb"><Film size={16} /></i><span><strong>Scene {String(clip.sceneNumber).padStart(2, "0")}</strong><small>{clip.chainRole} · {(clip.durationMs / 1_000).toFixed(1)}s</small></span>{clip.warnings.length > 0 && <AlertTriangle size={12} />}</button>)}</div>
      <div className="edit-track is-audio">{project.audioPath ? <div className="edit-audio-clip" style={{ width: Math.max(200, project.durationMs / 1_000 * pixelsPerSecond) }}><strong>{project.audioPath.split(/[\\/]/).at(-1)}</strong><div>{Array.from({ length: Math.min(240, Math.max(30, Math.round(width / 8))) }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 29) % 76)}%` }} />)}</div></div> : <span className="edit-track-missing"><AlertTriangle size={13} /> Thiếu audio chính</span>}</div>
      <div className="edit-track is-subtitle">{visibleClips.map((clip) => <button key={clip.id} type="button" style={{ left: clip.startMs / 1_000 * pixelsPerSecond, width: Math.max(34, clip.durationMs / 1_000 * pixelsPerSecond) }} onClick={() => onSelect(clip.id)}><Subtitles size={11} /> Subtitle {clip.sceneNumber}</button>)}</div>
      <div className="edit-track is-music"><span><Music2 size={14} /> Nhạc nền sẽ được hỗ trợ trong phiên bản sau.</span></div>
      <div className="edit-playhead" style={{ left: playheadMs / 1_000 * pixelsPerSecond }}><b>{formatTimecode(playheadMs)}</b><i /></div>
    </div></div>
  </div>;
}

function ExportModal({ project, exporting, result, error, onClose, onExport }: { project: EditProject; exporting: boolean; result: string; error: string; onClose: () => void; onExport: (options: EditExportOptions) => void }) {
  const [quality, setQuality] = useState<"standard" | "high">("standard");
  const [subtitles, setSubtitles] = useState(true);
  return <div className="edit-modal-backdrop"><section className="edit-export-modal" role="dialog" aria-modal="true" aria-label="Xuất video"><header><div><Download size={18} /><span><strong>Xuất video</strong><small>MP4 · H.264 · AAC</small></span></div><button type="button" disabled={exporting} onClick={onClose}>×</button></header><div className="edit-export-summary"><div><span>Độ phân giải</span><strong>1920 × 1080</strong></div><div><span>Frame rate</span><strong>60 FPS</strong></div><div><span>Thời lượng</span><strong>{formatTimecode(project.durationMs)}</strong></div><div><span>Scene</span><strong>{project.clips.filter((clip) => clip.kind === "video" && clip.visible).length}</strong></div></div><label>Chất lượng<select value={quality} onChange={(event) => setQuality(event.target.value as "standard" | "high")}><option value="standard">1080p H.264 · Chuẩn</option><option value="high">1080p H.264 · Chất lượng cao</option></select></label><label className="edit-toggle-row"><span><Subtitles size={14} /> Bao gồm subtitle</span><input type="checkbox" checked={subtitles} onChange={(event) => setSubtitles(event.target.checked)} /></label><p className="edit-export-note">Video scene được scale/pad về 16:9 và chuẩn hóa thành 60 FPS. Chế độ này không dùng nội suy chuyển động AI.</p>{error && <p className="edit-export-error"><AlertTriangle size={14} />{error}</p>}{result && <p className="edit-export-success"><Check size={14} />Đã xuất: {result}</p>}<footer><button type="button" disabled={exporting} onClick={onClose}>Hủy</button><button className="is-primary" type="button" disabled={exporting || hasSeriousError(project)} onClick={() => onExport({ includeSubtitles: subtitles, includeMusic: false, quality })}>{exporting ? <><span className="edit-spinner" /> Đang render 60 FPS…</> : <><Download size={15} /> Bắt đầu xuất</>}</button></footer></section></div>;
}

function AssemblyModal({ project, exporting, result, error, validation, progress, onClose, onValidate, onStart, onCancel }: { project: EditProject; exporting: boolean; result: string; error: string; validation: AssemblyValidation | null; progress: AssemblyProgress | null; onClose: () => void; onValidate: (settings: VideoAssemblySettings) => Promise<void>; onStart: (settings: VideoAssemblySettings) => void; onCancel: () => void }) {
  const [settings, setSettings] = useState<VideoAssemblySettings>({ ...DEFAULT_VIDEO_ASSEMBLY_SETTINGS });
  const patchSettings = (patch: Partial<VideoAssemblySettings>) => setSettings((current) => ({ ...current, ...patch }));
  const sceneCount = project.clips.filter((clip) => clip.kind === "video" && clip.visible).length;
  return <div className="edit-modal-backdrop"><section className="edit-export-modal edit-assembly-modal" role="dialog" aria-modal="true" aria-label="Ghép video hoàn chỉnh"><header><div><Download size={18} /><span><strong>Ghép video hoàn chỉnh</strong><small>FFmpeg · MP4 · H.264 · AAC · 60 FPS</small></span></div><button type="button" disabled={exporting} onClick={onClose}>×</button></header>
    <div className="edit-export-summary"><div><span>Scene hợp lệ</span><strong>{validation ? `${validation.scenes.filter((scene) => scene.status === "ready").length}/${sceneCount}` : sceneCount}</strong></div><div><span>Thời lượng scene</span><strong>{validation ? `${validation.totalDurationSeconds.toFixed(2)}s` : formatTimecode(project.durationMs)}</strong></div><div><span>Voice</span><strong>{validation ? `${validation.voiceDurationSeconds.toFixed(2)}s` : (project.audioPath ? "Đã chọn" : "Thiếu")}</strong></div><div><span>Đầu ra</span><strong>1920×1080 · 60 FPS</strong></div></div>
    <div className="edit-assembly-scene-list"><h3>SCENE THEO THỨ TỰ TIMELINE</h3>{project.clips.filter((clip) => clip.kind === "video" && clip.visible).slice().sort((left, right) => (left.sceneNumber || 0) - (right.sceneNumber || 0)).map((clip) => { const item = validation?.scenes.find((scene) => scene.sceneId === (clip.sceneId || clip.id)); return <div key={clip.id}><span>Scene {String(clip.sceneNumber || "?").padStart(2, "0")}</span><small>{clip.chainRole || "single"} · {(clip.durationMs / 1000).toFixed(2)}s</small><b className={item?.status === "ready" ? "is-ready" : item?.status ? "is-error" : ""}>{item?.status === "ready" ? "Sẵn sàng" : item?.status === "missing" ? "Thiếu file" : "Chưa kiểm tra"}</b></div>; })}</div>
    <div className="edit-assembly-grid"><section><h3>ÂM THANH</h3><label className="edit-slider-row"><span>Âm lượng voice <b>{settings.voiceVolume}%</b></span><input type="range" min="0" max="200" value={settings.voiceVolume} onChange={(event) => patchSettings({ voiceVolume: Number(event.target.value) })} /></label><label className="edit-slider-row"><span>Âm lượng video scene <b>{settings.sourceVideoVolume}%</b></span><input type="range" min="0" max="200" value={settings.sourceVideoVolume} onChange={(event) => patchSettings({ sourceVideoVolume: Number(event.target.value) })} /></label><p className="edit-export-note">Mặc định âm thanh gốc scene tắt để voice chính rõ ràng.</p></section><section><h3>FADE</h3><label className="edit-toggle-row"><span>Mờ dần đầu video</span><input type="checkbox" checked={settings.fadeInEnabled} onChange={(event) => patchSettings({ fadeInEnabled: event.target.checked })} /></label><label className="edit-number-row"><span>Fade-in (giây)</span><input type="number" min="0" max="10" step="0.1" value={settings.fadeInDurationSeconds} onChange={(event) => patchSettings({ fadeInDurationSeconds: Number(event.target.value) || 0 })} /></label><label className="edit-toggle-row"><span>Mờ dần cuối video</span><input type="checkbox" checked={settings.fadeOutEnabled} onChange={(event) => patchSettings({ fadeOutEnabled: event.target.checked })} /></label><label className="edit-number-row"><span>Fade-out (giây)</span><input type="number" min="0" max="10" step="0.1" value={settings.fadeOutDurationSeconds} onChange={(event) => patchSettings({ fadeOutDurationSeconds: Number(event.target.value) || 0 })} /></label><label className="edit-toggle-row"><span>Fade cho âm thanh</span><input type="checkbox" checked={settings.audioFadeEnabled} onChange={(event) => patchSettings({ audioFadeEnabled: event.target.checked })} /></label></section></div>
    <section className="edit-assembly-options"><h3>ĐẦU RA VÀ LỆCH THỜI LƯỢNG</h3><div><label>Độ phân giải<select value={settings.resolution} onChange={(event) => patchSettings({ resolution: event.target.value as VideoAssemblySettings["resolution"] })}><option value="1920x1080">1920 × 1080</option><option value="1280x720">1280 × 720</option></select></label><label>FPS<select value={settings.fps} onChange={(event) => patchSettings({ fps: Number(event.target.value) as VideoAssemblySettings["fps"] })}><option value="60">60 FPS</option><option value="30">30 FPS</option></select></label><label>Clip ngắn hơn<select value={settings.durationMismatchStrategy} onChange={(event) => patchSettings({ durationMismatchStrategy: event.target.value as VideoAssemblySettings["durationMismatchStrategy"] })}><option value="freeze-last-frame">Giữ frame cuối</option><option value="trim-video">Trim theo file</option><option value="keep-original">Giữ nguyên</option></select></label><label className="edit-toggle-row"><span>Chèn subtitle</span><input type="checkbox" checked={settings.includeSubtitles} onChange={(event) => patchSettings({ includeSubtitles: event.target.checked })} /></label></div></section>
    <section className="edit-assembly-validation"><div className="edit-assembly-validation-head"><h3>KIỂM TRA DỮ LIỆU</h3><button type="button" disabled={exporting} onClick={() => void onValidate(settings)}>Kiểm tra lại</button></div>{validation?.errors.map((message) => <p className="edit-export-error" key={message}><AlertTriangle size={14} />{message}</p>)}{validation?.warnings.slice(0, 5).map((message) => <p className="edit-inline-warning is-warning" key={message}><AlertTriangle size={13} />{message}</p>)}{!validation && <p className="edit-export-note">Hãy kiểm tra file trước khi ghép để phát hiện scene thiếu, voice lỗi hoặc lệch thời lượng.</p>}{validation?.valid && <p className="edit-export-success"><Check size={14} />Dữ liệu đã sẵn sàng để ghép.</p>}</section>
    {progress && exporting && <section className="edit-assembly-progress"><div><strong>{progress.currentStep}</strong><b>{progress.percent}%</b></div><progress max="100" value={progress.percent} /><small>{progress.processedTimeSeconds?.toFixed(1) || "0"} / {progress.totalDurationSeconds?.toFixed(1) || "?"} giây</small></section>}{result && <p className="edit-export-success"><Check size={14} />Đã xuất: {result}</p>}{error && <p className="edit-export-error"><AlertTriangle size={14} />{error}</p>}
    <footer><button type="button" disabled={exporting} onClick={onClose}>Hủy</button>{exporting ? <button className="is-danger" type="button" onClick={onCancel}>Hủy render</button> : <><button type="button" onClick={() => void onValidate(settings)}>Kiểm tra dữ liệu</button><button className="is-primary" type="button" disabled={!validation?.valid} onClick={() => onStart(settings)}><Download size={15} /> Bắt đầu ghép video</button></>}</footer>
  </section></div>;
}

export function EditPage({ session, onOpenScene, onBack }: { session: TimelineSession | null; onOpenScene: (sceneId: string) => void; onBack: () => void }) {
  const [project, setProject] = useState<EditProject | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(100);
  const [sourceUrl, setSourceUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [zoom, setZoom] = useState(1);
  const [snapping, setSnapping] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"video" | "audio" | "subtitle">("video");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<EditProject[]>([]);
  const [future, setFuture] = useState<EditProject[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState("");
  const [exportError, setExportError] = useState("");
  const [assemblyValidation, setAssemblyValidation] = useState<AssemblyValidation | null>(null);
  const [assemblyProgress, setAssemblyProgress] = useState<AssemblyProgress | null>(null);
  const [assemblyJobId, setAssemblyJobId] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => window.flowx?.edit.assembly.onProgress((value) => {
    setAssemblyProgress(value);
    if (exporting && !assemblyJobId) setAssemblyJobId(value.jobId);
    if (value.jobId === assemblyJobId && (value.status === "completed" || value.status === "failed" || value.status === "cancelled")) setExporting(false);
  }) || undefined, [assemblyJobId, exporting]);

  useEffect(() => {
    if (!session || !window.flowx?.edit) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    void window.flowx.edit.load(session).then((value) => { if (!active) return; setProject(value); setSelectedId(value.clips.find((clip) => clip.kind === "video")?.id || ""); setLoading(false); }).catch((caught) => { if (active) { setError(String(caught)); setLoading(false); } });
    return () => { active = false; };
  }, [session?.id]);

  const selectedClip = useMemo(() => project?.clips.find((clip) => clip.id === selectedId) || null, [project, selectedId]);
  const activeClip = useMemo(() => project?.clips.find((clip) => clip.kind === "video" && clip.visible && playheadMs >= clip.startMs && playheadMs < clipEnd(clip)) || selectedClip || null, [playheadMs, project, selectedClip]);

  useEffect(() => {
    if (!activeClip?.sourcePath || !window.flowx?.media) { setSourceUrl(""); return; }
    let alive = true;
    void window.flowx.media.getStreamUrl(activeClip.sourcePath).then((url) => { if (alive) setSourceUrl(url); }).catch(() => { if (alive) setSourceUrl(""); });
    return () => { alive = false; };
  }, [activeClip?.sourcePath]);

  useEffect(() => {
    if (!project?.audioPath || !window.flowx?.media) { setAudioUrl(""); return; }
    let alive = true;
    void window.flowx.media.getStreamUrl(project.audioPath).then((url) => { if (alive) setAudioUrl(url); }).catch(() => { if (alive) setAudioUrl(""); });
    return () => { alive = false; };
  }, [project?.audioPath]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = previewMuted;
    audio.volume = previewVolume / 100;
    if (!playing) {
      audio.pause();
      return;
    }
    // kc-media is a local protocol and may not have metadata ready when the
    // play button is pressed. Waiting for canplay prevents the preview from
    // starting at 0s and immediately stopping after the first buffered range.
    let disposed = false;
    const start = () => {
      if (!disposed) void audio.play().catch(() => undefined);
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) start();
    else audio.addEventListener("canplay", start, { once: true });
    return () => {
      disposed = true;
      audio.removeEventListener("canplay", start);
    };
  }, [audioUrl, playing, previewMuted, previewVolume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip || playing || video.readyState < 1) return;
    const expectedSeconds = (activeClip.trimInMs + Math.max(0, playheadMs - activeClip.startMs)) / 1_000;
    if (Math.abs(video.currentTime - expectedSeconds) > 0.04) video.currentTime = expectedSeconds;
  }, [activeClip, playheadMs, playing, sourceUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || playing || audio.readyState < 1) return;
    const expectedSeconds = playheadMs / 1_000;
    if (Math.abs(audio.currentTime - expectedSeconds) > 0.04) audio.currentTime = expectedSeconds;
  }, [audioUrl, playheadMs, playing]);

  useEffect(() => {
    if (!project || !dirty) return;
    const timer = window.setTimeout(() => { void window.flowx?.edit.save(project).then((saved) => { setProject(saved); setDirty(false); }); }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, project]);

  const commit = useCallback((transform: (current: EditProject) => EditProject) => {
    setProject((current) => {
      if (!current) return current;
      setHistory((items) => [...items.slice(-29), current]);
      setFuture([]);
      setDirty(true);
      return { ...transform(current), updatedAt: new Date().toISOString() };
    });
  }, []);

  const updateSelected = (patch: Partial<EditClip>) => commit((current) => ({ ...current, clips: current.clips.map((clip) => clip.id === selectedId ? { ...clip, ...patch } : clip) }));
  const undo = () => { const previous = history.at(-1); if (!previous || !project) return; setFuture((items) => [project, ...items]); setHistory((items) => items.slice(0, -1)); setProject(previous); setDirty(true); };
  const redo = () => { const next = future[0]; if (!next || !project) return; setHistory((items) => [...items, project]); setFuture((items) => items.slice(1)); setProject(next); setDirty(true); };
  const selectClip = (id: string) => { const clip = project?.clips.find((item) => item.id === id); setSelectedId(id); if (clip) { setPlayheadMs(clip.startMs); if (audioRef.current) audioRef.current.currentTime = clip.startMs / 1_000; } };
  const jumpClip = (direction: -1 | 1) => { const clips = project?.clips.filter((clip) => clip.kind === "video" && clip.visible) || []; const index = Math.max(0, clips.findIndex((clip) => clip.id === activeClip?.id)); const next = clips[Math.max(0, Math.min(clips.length - 1, index + direction))]; if (next) selectClip(next.id); };
  const splitClip = () => {
    if (!project || !selectedClip || selectedClip.locked || playheadMs <= selectedClip.startMs + 100 || playheadMs >= clipEnd(selectedClip) - 100) return;
    const firstDuration = playheadMs - selectedClip.startMs;
    const secondDuration = selectedClip.durationMs - firstDuration;
    commit((current) => ({ ...current, clips: current.clips.flatMap((clip) => clip.id !== selectedClip.id ? [clip] : [{ ...clip, durationMs: firstDuration, trimOutMs: clip.trimInMs + firstDuration }, { ...clip, id: `${clip.id}-split-${Date.now()}`, startMs: playheadMs, durationMs: secondDuration, trimInMs: clip.trimInMs + firstDuration }]) }));
  };
  const removeClip = () => { if (!selectedClip || !window.confirm("Clip sẽ bị xóa khỏi timeline nhưng file nguồn vẫn được giữ lại. Tiếp tục?")) return; commit((current) => ({ ...current, clips: current.clips.filter((clip) => clip.id !== selectedClip.id) })); setSelectedId(""); };
  const replaceClip = async () => { if (!selectedClip || !project) return; const path = await window.flowx?.edit.pickVideo(project.sessionId); if (path) updateSelected({ sourcePath: path, warnings: [] }); };
  const restoreClip = () => { if (selectedClip) updateSelected({ trimInMs: 0, trimOutMs: selectedClip.sourceDurationMs, durationMs: selectedClip.sceneNumber ? session?.scenes.find((scene) => scene.order === selectedClip.sceneNumber)?.durationSeconds! * 1_000 || selectedClip.durationMs : selectedClip.durationMs }); };
  const sync = async () => { if (!session || !window.confirm("Đồng bộ lại sẽ cập nhật video, audio và subtitle từ phiên. Các chỉnh sửa clip hiện tại có thể bị thay thế. Tiếp tục?")) return; setLoading(true); try { const next = await window.flowx?.edit.sync(session); if (next) { setProject(next); setSelectedId(next.clips[0]?.id || ""); setHistory([]); setFuture([]); } } catch (caught) { setError(String(caught)); } finally { setLoading(false); } };
  const validateAssembly = async (settings: VideoAssemblySettings) => { if (!project || !window.flowx?.edit.assembly) return; setExportError(""); try { const result = await window.flowx.edit.assembly.validate(project, settings); setAssemblyValidation(result); } catch (caught) { setAssemblyValidation(null); setExportError(String(caught)); } };
  const startAssembly = async (settings: VideoAssemblySettings) => { if (!project || !window.flowx?.edit.assembly) return; setExporting(true); setAssemblyJobId(""); setExportError(""); setExportResult(""); setAssemblyProgress(null); try { const result = await window.flowx.edit.assembly.start(project, settings); setAssemblyJobId(result.jobId); setExportResult(result.outputPath); const completed = { ...project, status: "completed" as const, lastExportPath: result.outputPath }; const saved = await window.flowx?.edit.save(completed); setProject(saved || completed); setDirty(false); } catch (caught) { setExportError(String(caught)); } finally { setExporting(false); } };
  const cancelAssembly = () => { if (assemblyJobId) void window.flowx?.edit.assembly.cancel(assemblyJobId); };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.code === "Space") { event.preventDefault(); setPlaying((value) => !value); }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") setPlayheadMs((value) => Math.max(0, Math.min(project?.durationMs || 0, value + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5_000 : 1_000 / 60))));
      if (event.key.toLowerCase() === "s") splitClip();
      if (event.key === "Delete") removeClip();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (loading) return <div className="edit-loading"><span /><strong>Đang chuẩn bị bản dựng 60 FPS…</strong></div>;
  if (!session || !project) return <div className="edit-empty-page"><Film size={44} /><h2>Chưa có phiên để dựng</h2><p>{error || "Hãy hoàn thành video scene trước khi mở Edit."}</p><button type="button" onClick={onBack}><ArrowLeft size={14} /> Quay lại</button></div>;

  const validVideos = project.clips.filter((clip) => clip.kind === "video" && clip.visible && !clip.warnings.some((warning) => warning.severity === "error"));
  const exportReady = validVideos.length > 0 && Boolean(project.audioPath) && !hasSeriousError(project);
  return <main className="kc-edit-page">
    {audioUrl && <audio
      key={audioUrl}
      ref={audioRef}
      src={audioUrl}
      preload="auto"
      aria-label="Voice chính của phiên"
      onLoadedMetadata={(event) => {
        // The full voice file is the master clock for the edit preview.
        // Seek only after metadata is available; seeking earlier can leave
        // Chromium at the end of the first buffered segment.
        event.currentTarget.currentTime = Math.min(playheadMs / 1_000, event.currentTarget.duration || 0);
      }}
      onEnded={() => setPlaying(false)}
    />}
    <header className="edit-header"><div><span>EDIT PROJECT</span><h1>Edit</h1><p>Chỉnh sửa và hoàn thiện video trước khi xuất.</p></div><div className="edit-header-meta"><span><Film size={13} /> {project.name}</span><span className={dirty ? "is-saving" : "is-saved"}>{dirty ? "Đang lưu…" : "Đã lưu"}</span></div><div><button type="button" onClick={() => void sync()}><FolderSync size={15} /> Đồng bộ lại từ phiên</button><button className="edit-export-button" type="button" disabled={!exportReady} onClick={() => setExportOpen(true)}><Download size={15} /> Xuất video</button></div></header>
    {validVideos.length !== session.scenes.length
      ? <div className="edit-readiness-banner"><AlertTriangle size={15} /><span>Bản dựng có {validVideos.length}/{session.scenes.length} scene hợp lệ. Hãy đồng bộ hoặc tạo lại scene còn thiếu.</span></div>
      : <div className="edit-readiness-placeholder" aria-hidden="true" />}
    <section className="edit-upper-workspace"><div className="edit-preview-column"><VideoPreview sourceUrl={sourceUrl} activeClip={activeClip} playing={playing} muted={previewMuted || Boolean(activeClip?.muted)} volume={Math.min(100, previewVolume * ((activeClip?.volume || 100) / 100))} onEnded={() => jumpClip(1)} onTimeChange={(relativeMs) => { if (activeClip) setPlayheadMs(activeClip.startMs + relativeMs); }} videoRef={videoRef} /><PlaybackControls playing={playing} playheadMs={playheadMs} durationMs={project.durationMs} muted={previewMuted} volume={previewVolume} onToggle={() => setPlaying((value) => !value)} onFrame={(direction) => setPlayheadMs((value) => Math.max(0, Math.min(project.durationMs, value + direction * (1_000 / 60))))} onClip={jumpClip} onMute={() => setPreviewMuted((value) => !value)} onVolume={setPreviewVolume} /></div><CurrentSceneInfo clip={activeClip} project={project} onOpenScene={onOpenScene} /><ClipInspector clip={selectedClip} tab={inspectorTab} onTab={setInspectorTab} onChange={updateSelected} onReplace={() => void replaceClip()} onSplit={splitClip} onRemove={removeClip} onRestore={restoreClip} onOpenScene={() => selectedClip?.sceneId && onOpenScene(selectedClip.sceneId)} /></section>
    <section className="edit-timeline-panel"><TimelineToolbar canUndo={history.length > 0} canRedo={future.length > 0} snapping={snapping} zoom={zoom} onUndo={undo} onRedo={redo} onSplit={splitClip} onRemove={removeClip} onSnapping={() => setSnapping((value) => !value)} onZoom={setZoom} onFit={() => setZoom(1)} /><TimelineTracks project={project} selectedId={selectedId} playheadMs={playheadMs} zoom={zoom} onSelect={selectClip} onSeek={(value) => { setPlayheadMs(value); if (audioRef.current) audioRef.current.currentTime = value / 1_000; }} /></section>
    <footer className="edit-status-bar"><div><span>Tổng thời lượng <b>{formatTimecode(project.durationMs)}</b></span><span>Timecode <code>{formatTimecode(playheadMs)}</code></span></div><span>{dirty ? <><span className="edit-spinner" /> Đang lưu thay đổi…</> : <><Check size={12} /> Tất cả thay đổi đã được lưu.</>}</span><div><button type="button"><Gauge size={12} /> Phím tắt</button><HelpCircle size={13} /><span className="is-online">● Online</span></div></footer>
    {exportOpen && <AssemblyModal project={project} exporting={exporting} result={exportResult} error={exportError} validation={assemblyValidation} progress={assemblyProgress} onClose={() => { if (!exporting) setExportOpen(false); }} onValidate={validateAssembly} onStart={startAssembly} onCancel={cancelAssembly} />}
  </main>;
}
