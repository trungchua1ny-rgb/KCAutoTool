import { AudioLines, CheckCircle2, Clapperboard, FolderArchive, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { CapCutBuildInspection, CapCutBuildResult } from "../shared/capcut";

function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Không xác định";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function CapCutBuildDialog({
  inspection,
  result,
  loading,
  building,
  error,
  onClose,
  onConfirm,
  onSelectProject,
  onRefresh,
}: {
  inspection: CapCutBuildInspection | null;
  result: CapCutBuildResult | null;
  loading: boolean;
  building: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
  onSelectProject: (projectPath: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !building) onClose(); }}>
      <section className="kc-capcut-dialog" role="dialog" aria-modal="true" aria-labelledby="capcut-build-title">
        <header>
          <div className="kc-capcut-dialog-title"><span><Clapperboard size={20} /></span><div><small>BƯỚC CUỐI WORKFLOW</small><h2 id="capcut-build-title">Dựng timeline vào CapCut</h2></div></div>
          <button type="button" onClick={onClose} disabled={building} aria-label="Đóng"><X size={17} /></button>
        </header>
        {loading ? (
          <div className="kc-capcut-dialog-loading"><LoaderCircle className="spin" size={24} /><strong>Đang kiểm tra project CapCut phù hợp…</strong></div>
        ) : result ? (
          <div className="kc-capcut-dialog-success">
            <CheckCircle2 size={38} />
            <h3>Đã dựng xong {result.sceneCount} scene</h3>
            <p>Video đã được xếp đúng thứ tự trong project <b>{result.targetProjectName}</b>. Audio gốc được giữ nguyên và âm thanh trong từng scene đã được tắt.</p>
            <div><FolderArchive size={15} /><span>Đã sao lưu: {result.backupPath}</span></div>
          </div>
        ) : inspection ? (
          <>
            <div className="kc-capcut-preparation">
              <AudioLines size={18} />
              <div>
                <strong>Dựng trực tiếp vào project bạn chọn</strong>
                <span>Chọn project đã có audio. KC Auto Tool sẽ sao lưu project, giữ nguyên audio và thay riêng video track bằng toàn bộ scene đúng thứ tự.</span>
              </div>
            </div>
            <label className="kc-capcut-project-select">
              <span className="kc-capcut-project-select-title">Project CapCut đích <button type="button" onClick={onRefresh} disabled={building || loading}><RefreshCw size={13} /> Làm mới</button></span>
              <select
                value={inspection.selectedProjectPath}
                onChange={(event) => onSelectProject(event.target.value)}
                disabled={building}
              >
                {inspection.availableProjects.map((project) => (
                  <option key={project.path} value={project.path}>
                    {project.folderName} · {project.name} · {project.audioCount} audio · {project.videoSegmentCount} video
                  </option>
                ))}
              </select>
              <small>Tên đầu là tên thư mục, tiếp theo là tên hiển thị trong CapCut. Hãy đóng CapCut và bấm Làm mới sau khi chèn audio.</small>
            </label>
            <div className={`kc-capcut-readiness ${inspection.ready ? "is-ready" : "is-blocked"}`}>
              {inspection.ready ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
              <div><strong>{inspection.ready ? "Sẵn sàng dựng" : "Chưa thể dựng"}</strong><span>{inspection.reason}</span></div>
            </div>
            <div className="kc-capcut-build-grid">
              <article><span>Project đích</span><strong>{inspection.targetProjectName || "Chưa tìm thấy"}</strong></article>
              <article><span>Video scene</span><strong>{inspection.completedSceneCount}/{inspection.sceneCount}</strong></article>
              <article><span>Thời lượng video</span><strong>{durationLabel(inspection.videoDurationSeconds)}</strong></article>
              <article><span>Thời lượng voice</span><strong>{durationLabel(inspection.audioDurationSeconds)}</strong></article>
            </div>
            {inspection.existingVideoSegments > 0 && (
              <div className="kc-capcut-replace-warning"><TriangleAlert size={16} /><span>Video track đã có {inspection.existingVideoSegments} scene của phiên này. Dựng lại sẽ sao lưu rồi thay thế riêng video track; audio không bị xóa.</span></div>
            )}
            <ol className="kc-capcut-build-flow">
              <li><span>1</span><div><strong>Kiểm tra 100% scene</strong><small>File video phải còn đầy đủ trên máy.</small></div></li>
              <li><span>2</span><div><strong>Giữ audio của project đích</strong><small>App chỉ thay video track và không xóa voice đã chèn.</small></div></li>
              <li><span>3</span><div><strong>Sao lưu trước khi dựng</strong><small>Toàn bộ project đích được sao lưu để có thể khôi phục.</small></div></li>
              <li><span>4</span><div><strong>Xếp scene và kiểm tra</strong><small>Không bỏ scene, không chồng clip, giữ nguyên audio.</small></div></li>
            </ol>
          </>
        ) : null}
        {error && <div className="form-error">{error}</div>}
        <footer>
          <button className="button secondary" type="button" onClick={onClose} disabled={building}>{result ? "Đóng" : "Hủy"}</button>
          {!result && <button className="button primary" type="button" disabled={!inspection?.ready || loading || building} onClick={onConfirm}>{building ? <><LoaderCircle className="spin" size={15} /> Đang dựng…</> : <><Clapperboard size={15} /> {inspection?.existingVideoSegments ? "Dựng lại timeline" : "Dựng vào CapCut"}</>}</button>}
        </footer>
      </section>
    </div>
  );
}
