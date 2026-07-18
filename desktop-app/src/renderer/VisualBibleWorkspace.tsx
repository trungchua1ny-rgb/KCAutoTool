import { Lock, Palette, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { TimelineSession, TimelineStyleReference, VisualBible } from "../shared/timeline";
import type { GraphicStylePreset } from "../shared/visual-style";
import { CharacterLibrary } from "./CharacterLibrary";
import { VisualBiblePanel } from "./VisualBiblePanel";

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

export function VisualBibleWorkspace({ session, onSaved }: { session: TimelineSession | null; onSaved: () => void }) {
  const [bible, setBible] = useState<VisualBible | null>(session?.visualBible || null);
  const [reference, setReference] = useState<TimelineStyleReference | null>(session?.styleReference || null);
  const [presets, setPresets] = useState<GraphicStylePreset[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [locks, setLocks] = useState<Record<ConsistencyLockKey, boolean>>(() => locksFromNotes(session?.visualBible.continuityNotes || ""));
  useEffect(() => {
    setBible(session?.visualBible || null);
    setReference(session?.styleReference || null);
    setLocks(locksFromNotes(session?.visualBible.continuityNotes || ""));
  }, [session?.id]);
  useEffect(() => {
    let active = true;
    void window.flowx?.visualStyles.list().then((items) => { if (active) setPresets(items); }, (caught) => { if (active) setError(String(caught)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!session || !bible) return undefined;
    const timer = window.setTimeout(() => {
      setSaving(true);
      void window.flowx?.timeline.saveSession({
        scenes: session.scenes,
        visualBible: bible,
        styleReference: reference,
        workflowMode: session.workflowMode,
        workflowSource: session.workflowSource,
      }).then(() => { setSaving(false); onSaved(); }, (caught) => { setSaving(false); setError(String(caught)); });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [bible, reference]);
  if (!session || !bible) return <div className="kc-empty-panel">Hãy tạo hoặc mở một phiên làm việc.</div>;
  const savePreset = (name: string) => void window.flowx?.visualStyles.save({ name, style: bible.style }).then(setPresets, (caught) => setError(String(caught)));
  const deletePreset = (id: string) => void window.flowx?.visualStyles.remove(id).then(setPresets, (caught) => setError(String(caught)));
  const toggleLock = (key: ConsistencyLockKey) => {
    const next = { ...locks, [key]: !locks[key] };
    setLocks(next);
    setBible((current) => current ? { ...current, continuityNotes: notesWithLocks(current.continuityNotes, next) } : current);
  };
  return (
    <section className="kc-visual-workspace">
      <header className="kc-section-heading"><div><span>CONSISTENCY SYSTEM</span><h2><Palette size={19} /> Visual Bible & Thư viện nhân vật</h2><p>Những quy tắc này được gửi vào ChatGPT và Google Flow cho toàn bộ scene.</p></div><div className="kc-save-state"><Lock size={14} />{saving ? "Đang lưu…" : "Đã khóa theo phiên"}</div></header>
      <VisualBiblePanel value={bible} onChange={setBible} presets={presets} presetError={error} onSavePreset={savePreset} onDeletePreset={deletePreset} styleReference={reference} onStyleReferenceChange={setReference} />
      <div className="kc-consistency-options">
        {CONSISTENCY_LOCKS.map(([key, label]) => <button type="button" className={locks[key] ? "is-locked" : ""} aria-pressed={locks[key]} key={key} onClick={() => toggleLock(key)}><Lock size={12} />{label}</button>)}
      </div>
      <div className="kc-character-subsection"><header><UsersRound size={17} /><strong>Nhân vật tham chiếu</strong><span>Dữ liệu thật từ thư viện Phase 2</span></header><CharacterLibrary /></div>
      {error && <div className="form-error">{error.replace(/^Error:\s*/i, "")}</div>}
    </section>
  );
}
