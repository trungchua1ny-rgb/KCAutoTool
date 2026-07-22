import { ArrowLeft, ArrowRight, Check, Info, LockKeyhole, Palette, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterView } from "../shared/character";
import type { TimelineSession, TimelineStyleReference, VisualBible } from "../shared/timeline";
import type { GraphicStylePreset } from "../shared/visual-style";
import { normalizeSoundBible, type SoundBible } from "../shared/screenplay";
import { type ConsistencyLockItem, VisualBiblePanel } from "./VisualBiblePanel";

const CONSISTENCY_LOCKS = [
  ["face", "Giữ đặc điểm khuôn mặt", "Keep facial features unchanged"],
  ["hair", "Giữ kiểu tóc", "Keep hairstyle unchanged"],
  ["clothing", "Giữ trang phục", "Keep clothing and accessories unchanged"],
  ["color", "Giữ màu sắc", "Keep character and environment colors unchanged"],
  ["body", "Giữ tỷ lệ cơ thể", "Keep body proportions unchanged"],
  ["setting", "Giữ bối cảnh", "Keep recurring location geometry and props unchanged"],
  ["style", "Giữ phong cách hình ảnh", "Keep the image style unchanged"],
] as const;

type ConsistencyLockKey = (typeof CONSISTENCY_LOCKS)[number][0];
const LOCK_MARKER = "KC CONSISTENCY LOCKS:";

function locksFromNotes(notes: string): Record<ConsistencyLockKey, boolean> {
  const hasMarker = notes.includes(LOCK_MARKER);
  return Object.fromEntries(CONSISTENCY_LOCKS.map(([key, , prompt]) => [key, hasMarker ? notes.includes(`- ${prompt}`) : true])) as Record<ConsistencyLockKey, boolean>;
}

function notesWithLocks(notes: string, locks: Record<ConsistencyLockKey, boolean>): string {
  const base = notes.split(`\n\n${LOCK_MARKER}`)[0].trim();
  const rules = CONSISTENCY_LOCKS.filter(([key]) => locks[key]).map(([, , prompt]) => `- ${prompt}`);
  return rules.length ? `${base}${base ? "\n\n" : ""}${LOCK_MARKER}\n${rules.join("\n")}` : base;
}

function modeLabel(session: TimelineSession): string {
  if (session.productionKind === "screenplay") return "Phim kịch bản hình";
  if (session.workflowMode === "automatic") return "Tự động toàn bộ";
  return session.workflowSource.srtText ? "Từ SRT & kịch bản" : "Tạo từng bước";
}

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).replace(/^Error:\s*/i, "");
  return error.message.replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "");
}

function styleEntryKey(sessionId: string): string {
  return `kc-visual-style-entered:${sessionId}`;
}

function bibleForEditor(session: TimelineSession | null): VisualBible | null {
  if (!session) return null;
  const alreadyEntered = window.localStorage.getItem(styleEntryKey(session.id)) === "true";
  return session.scenes.length === 0 && !alreadyEntered
    ? { ...session.visualBible, style: "" }
    : session.visualBible;
}

export function VisualBibleWorkspace({
  session,
  onSaved,
  onContinue,
  onBack,
  onOpenCharacters,
}: {
  session: TimelineSession | null;
  onSaved: () => void;
  onContinue?: () => void;
  onBack?: () => void;
  onOpenCharacters?: () => void;
}) {
  const [bible, setBible] = useState<VisualBible | null>(() => bibleForEditor(session));
  const [reference, setReference] = useState<TimelineStyleReference | null>(session?.styleReference || null);
  const [soundBible, setSoundBible] = useState<SoundBible>(() => normalizeSoundBible(session?.screenplay.soundBible));
  const [presets, setPresets] = useState<GraphicStylePreset[]>([]);
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [savedAt, setSavedAt] = useState(session?.savedAt || "");
  const initialBibleRef = useRef<VisualBible | null>(bibleForEditor(session));
  const sessionRef = useRef(session);
  const soundBibleRef = useRef(soundBible);
  const onSavedRef = useRef(onSaved);
  const [locks, setLocks] = useState<Record<ConsistencyLockKey, boolean>>(() => locksFromNotes(session?.visualBible.continuityNotes || ""));
  sessionRef.current = session;
  soundBibleRef.current = soundBible;
  onSavedRef.current = onSaved;

  useEffect(() => {
    const editableBible = bibleForEditor(session);
    setBible(editableBible);
    setReference(session?.styleReference || null);
    setSoundBible(normalizeSoundBible(session?.screenplay.soundBible));
    setSavedAt(session?.savedAt || "");
    initialBibleRef.current = editableBible;
    setLocks(locksFromNotes(session?.visualBible.continuityNotes || ""));
  }, [session?.id]);

  useEffect(() => {
    if (session && bible?.style.trim()) window.localStorage.setItem(styleEntryKey(session.id), "true");
  }, [bible?.style, session?.id]);

  useEffect(() => {
    let active = true;
    void Promise.all([window.flowx?.visualStyles.list() || Promise.resolve([]), window.flowx?.characters.list() || Promise.resolve([])])
      .then(([styleItems, characterItems]) => { if (active) { setPresets(styleItems); setCharacters(characterItems); } })
      .catch((caught) => { if (active) setError(cleanError(caught)); });
    return () => { active = false; };
  }, [session?.id]);

  const saveSnapshot = useCallback(async (nextBible: VisualBible, nextReference: TimelineStyleReference | null) => {
    const activeSession = sessionRef.current;
    if (!window.flowx?.timeline || !activeSession) return false;
    setSaving(true); setError("");
    try {
      await window.flowx.timeline.saveSession({
        scenes: activeSession.scenes,
        visualBible: nextBible,
        styleReference: nextReference,
        workflowMode: activeSession.workflowMode,
        workflowSource: activeSession.workflowSource,
        productionKind: activeSession.productionKind,
        screenplay: activeSession.productionKind === "screenplay"
          ? { ...activeSession.screenplay, soundBible: soundBibleRef.current, updatedAt: new Date().toISOString() }
          : activeSession.screenplay,
      });
      setSavedAt(new Date().toISOString());
      onSavedRef.current();
      return true;
    } catch (caught) { setError(cleanError(caught)); return false; }
    finally { setSaving(false); }
  }, []);

  useEffect(() => {
    if (!session || !bible) return undefined;
    const timer = window.setTimeout(() => { void saveSnapshot(bible, reference); }, 500);
    return () => window.clearTimeout(timer);
  }, [bible, reference, soundBible, saveSnapshot, session?.id]);

  if (!session || !bible) return <div className="kc-empty-panel">Hãy tạo hoặc mở một phiên làm việc.</div>;

  const savePreset = (name: string) => void window.flowx?.visualStyles.save({ name, style: bible.style }).then(setPresets, (caught) => setError(cleanError(caught)));
  const deletePreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset || !window.confirm(`Xóa phong cách “${preset.name}” khỏi máy?`)) return;
    void window.flowx?.visualStyles.remove(id).then(setPresets, (caught) => setError(cleanError(caught)));
  };
  const toggleLock = (key: string) => {
    if (!CONSISTENCY_LOCKS.some(([itemKey]) => itemKey === key)) return;
    const typedKey = key as ConsistencyLockKey;
    const next = { ...locks, [typedKey]: !locks[typedKey] };
    setLocks(next);
    setBible((current) => current ? { ...current, continuityNotes: notesWithLocks(current.continuityNotes, next) } : current);
  };
  const lockItems: ConsistencyLockItem[] = CONSISTENCY_LOCKS.map(([key, label]) => ({ key, label, enabled: locks[key] }));
  const continueToTimeline = async () => {
    if (!bible.style.trim() || saving || continuing) return;
    setContinuing(true);
    const saved = await saveSnapshot(bible, reference);
    if (saved) onContinue?.();
    setContinuing(false);
  };
  const formattedSavedAt = savedAt ? new Date(savedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "Chưa lưu";
  const lockedCount = lockItems.filter((item) => item.enabled).length;

  return (
    <section className="kc-vb-studio">
      <header className="kc-vb-page-header">
        <div><p className="kc-vb-eyebrow">WORKFLOW / PHASE 3</p><h1><Palette size={23} /> Visual Bible</h1><p>Khóa phong cách đồ họa, màu sắc, ánh sáng và quy tắc nhất quán cho toàn bộ dự án.</p></div>
        <div className="kc-vb-header-session"><span>Phiên hiện tại</span><strong>{session.name}</strong><small>{modeLabel(session)} · {saving ? "Đang lưu..." : `Đã lưu ${formattedSavedAt}`}</small><button type="button" onClick={() => void saveSnapshot(bible, reference)} disabled={saving}><Save size={14} /> Lưu bản nháp</button></div>
      </header>

      <nav className="kc-vb-stepper" aria-label="Tiến trình thiết lập">
        <div className="kc-vb-step is-done"><span><Check size={14} /></span><div><strong>01 {session.productionKind === "screenplay" ? "Kịch bản hình" : "Nội dung & giọng đọc"}</strong><small>Đã hoàn thành</small></div><i /></div>
        <div className="kc-vb-step is-done"><span><Check size={14} /></span><div><strong>02 Nhân vật</strong><small>{characters.length ? "Đã hoàn thành" : "Không sử dụng"}</small></div><i /></div>
        <div className="kc-vb-step is-active"><span>03</span><div><strong>{session.productionKind === "screenplay" ? "Visual & Sound Bible" : "Visual Bible"}</strong><small>Đang thực hiện</small></div><i /></div>
        <div className="kc-vb-step is-locked"><span><LockKeyhole size={13} /></span><div><strong>04 Bắt đầu workflow</strong><small>Chưa mở</small></div></div>
      </nav>

      {session.scenes.length > 0 && <div className="kc-vb-production-warning"><Info size={16} /><div><strong>Phiên này đã có Timeline/Prompt.</strong><span>Chỉnh sửa Visual Bible có thể yêu cầu tạo lại timeline, hình ảnh hoặc video để áp dụng nhất quán.</span></div></div>}

      <div className="kc-vb-quick-status">
        <div className={bible.style.trim() ? "is-ready" : "is-error"}><Palette size={15} /><span>Phong cách đồ họa<b>{bible.style.trim() ? "Đã nhập" : "Bắt buộc"}</b></span></div>
        <div className={reference ? "is-ready" : "is-optional"}><span className="kc-vb-status-icon">◫</span><span>Ảnh tham khảo<b>{reference ? "Đã thêm" : "Tùy chọn"}</b></span></div>
        <div className={bible.palette.trim() ? "is-ready" : "is-optional"}><span className="kc-vb-status-icon">●</span><span>Bảng màu<b>{bible.palette.trim() ? "Đã thiết lập" : "Chưa nhập"}</b></span></div>
        <div className={bible.lighting.trim() ? "is-ready" : "is-optional"}><span className="kc-vb-status-icon">☀</span><span>Ánh sáng<b>{bible.lighting.trim() ? "Đã thiết lập" : "Chưa nhập"}</b></span></div>
        <div className="is-ready"><span className="kc-vb-status-icon">▭</span><span>Tỷ lệ khung hình<b>16:9 · Ngang</b></span></div>
        <div className="is-ready"><ShieldCheck size={15} /><span>Quy tắc khóa<b>{lockedCount}/7 đang bật</b></span></div>
      </div>

      <VisualBiblePanel value={bible} initialValue={initialBibleRef.current || bible} onChange={setBible} presets={presets} presetError={error} onSavePreset={savePreset} onDeletePreset={deletePreset} styleReference={reference} onStyleReferenceChange={setReference} locks={lockItems} onToggleLock={toggleLock} characters={characters} onOpenCharacters={onOpenCharacters || onBack} />

      {session.productionKind === "screenplay" && <section className="kc-vb-sound-bible">
        <header><div><small>SOUND BIBLE</small><h2>Âm thanh xuyên shot</h2></div><span>Nhạc trong Flow: Tắt</span></header>
        <p>Quy tắc âm thanh được gửi cùng từng batch Phase 3 để ambience, hiệu ứng và thoại trực tiếp không bị trôi giữa các scene.</p>
        <div><label>Quy tắc ambience<textarea value={soundBible.ambienceRules} onChange={(event) => setSoundBible((current) => ({ ...current, ambienceRules: event.target.value }))} /></label><label>Quy tắc hiệu ứng âm thanh<textarea value={soundBible.soundEffectRules} onChange={(event) => setSoundBible((current) => ({ ...current, soundEffectRules: event.target.value }))} /></label><label>Quy tắc thoại trực tiếp<textarea value={soundBible.dialogueRules} onChange={(event) => setSoundBible((current) => ({ ...current, dialogueRules: event.target.value }))} /></label></div>
      </section>}

      {error && <div className="kc-vb-error" role="alert">{error}</div>}
      <footer className="kc-vb-action-bar"><div><button type="button" onClick={onBack} disabled={!onBack}><ArrowLeft size={14} /> Quay lại Nhân vật</button><button type="button" onClick={() => void saveSnapshot(bible, reference)} disabled={saving}><Save size={14} /> {saving ? "Đang lưu" : "Lưu bản nháp"}</button></div><span><Info size={13} /> Phong cách đồ họa sẽ được giữ nguyên khi gửi Google Flow.</span><button className="is-primary" type="button" disabled={saving || continuing || !bible.style.trim()} onClick={() => void continueToTimeline()}>{bible.style.trim() ? continuing ? "Đang chuyển bước..." : "Tiếp tục đến Bắt đầu workflow" : "Nhập phong cách đồ họa để tiếp tục"}<ArrowRight size={15} /></button></footer>
    </section>
  );
}
