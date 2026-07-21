import { CheckCircle2, Clapperboard, Film, Music2 } from "lucide-react";
import type { TimelineSession } from "../shared/timeline";

export function CapCutBuildPage({ session, onBuild }: { session: TimelineSession | null; onBuild: () => void }) {
  const scenes = session?.scenes || [];
  const completed = scenes.filter((scene) => scene.videoStatus === "done" && Boolean(scene.videoResultPath)).length;
  const ready = scenes.length > 0 && completed === scenes.length && Boolean(session?.workflowSource?.audioPath);
  return (
    <section className="kc-capcut-launch-page">
      <div className="kc-capcut-launch-card">
        <div className="kc-capcut-launch-icon"><Clapperboard size={28} /></div>
        <div className="kc-capcut-launch-copy">
          <small>DỰNG VIDEO CUỐI CÙNG</small>
          <h1>Dựng vào project CapCut</h1>
          <p>Chọn project CapCut đích đã có voice, sau đó KC Auto Tool sẽ giữ audio và xếp toàn bộ video scene theo đúng thứ tự timeline.</p>
        </div>
        <button className="button primary kc-capcut-launch-button" type="button" disabled={!ready} onClick={onBuild}>
          <Clapperboard size={16} /> Tạo trên CapCut
        </button>
      </div>
      <div className="kc-capcut-launch-stats">
        <article><Film size={17} /><span>Video scene</span><strong>{completed}/{scenes.length}</strong><small>{ready ? "Đã sẵn sàng" : "Cần đủ 100% scene"}</small></article>
        <article><Music2 size={17} /><span>Voice chính</span><strong>{session?.workflowSource?.audioPath ? "Đã có" : "Thiếu"}</strong><small>Chèn một lần xuyên timeline</small></article>
        <article><CheckCircle2 size={17} /><span>Đầu ra</span><strong>60 FPS</strong><small>MP4 · H.264 · AAC</small></article>
      </div>
      {!ready && <p className="kc-capcut-launch-warning">Cần hoàn thành toàn bộ video scene và tạo voice chính trước khi tạo project CapCut.</p>}
    </section>
  );
}
