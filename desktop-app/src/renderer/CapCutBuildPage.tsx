import { CheckCircle2, Clapperboard, Film, Music2 } from "lucide-react";
import type { TimelineSession } from "../shared/timeline";

export function CapCutBuildPage({ session, onBuild }: { session: TimelineSession | null; onBuild: () => void }) {
  const scenes = session?.scenes || [];
  const completed = scenes.filter((scene) => scene.videoStatus === "done" && Boolean(scene.videoResultPath)).length;
  const screenplay = session?.productionKind === "screenplay";
  const ready = scenes.length > 0 && completed === scenes.length && (screenplay || Boolean(session?.workflowSource?.audioPath));
  return (
    <section className="kc-capcut-launch-page">
      <div className="kc-capcut-launch-card">
        <div className="kc-capcut-launch-icon"><Clapperboard size={28} /></div>
        <div className="kc-capcut-launch-copy">
          <small>DỰNG VIDEO CUỐI CÙNG</small>
          <h1>Dựng vào project CapCut</h1>
          <p>{screenplay ? "Chọn project CapCut đích. KC Auto Tool sẽ xếp scene đúng thứ tự và giữ nguyên thoại, ambience cùng SFX nằm trong từng video." : "Chọn project CapCut đích đã có voice, sau đó KC Auto Tool sẽ giữ audio và xếp toàn bộ video scene theo đúng thứ tự timeline."}</p>
        </div>
        <button className="button primary kc-capcut-launch-button" type="button" disabled={!ready} onClick={onBuild}>
          <Clapperboard size={16} /> Tạo trên CapCut
        </button>
      </div>
      <div className="kc-capcut-launch-stats">
        <article><Film size={17} /><span>Video scene</span><strong>{completed}/{scenes.length}</strong><small>{ready ? "Đã sẵn sàng" : "Cần đủ 100% scene"}</small></article>
        <article><Music2 size={17} /><span>{screenplay ? "Âm thanh scene" : "Voice chính"}</span><strong>{screenplay ? "Giữ nguyên" : session?.workflowSource?.audioPath ? "Đã có" : "Thiếu"}</strong><small>{screenplay ? "Thoại · Ambience · SFX" : "Chèn một lần xuyên timeline"}</small></article>
        <article><CheckCircle2 size={17} /><span>Đầu ra</span><strong>60 FPS</strong><small>MP4 · H.264 · AAC</small></article>
      </div>
      {!ready && <p className="kc-capcut-launch-warning">{screenplay ? "Cần hoàn thành toàn bộ video scene trước khi dựng vào CapCut." : "Cần hoàn thành toàn bộ video scene và tạo voice chính trước khi tạo project CapCut."}</p>}
    </section>
  );
}
