import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clapperboard,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  LoaderCircle,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  matchCharacterNames,
  parseCharacterTokens,
  recurringCharacterRoster,
  type CharacterView,
} from "../shared/character";
import {
  projectOutputFolder,
  type SceneMediaType,
  type SceneJobProgress,
} from "../shared/scene-job";
import {
  DEFAULT_TIMELINE_WORKFLOW_SOURCE,
  DEFAULT_VISUAL_BIBLE,
  MAX_TIMELINE_FILE_BYTES,
  normalizeStoredScenes,
  recalculateScenePlanning,
  SCENE_DURATION_OPTIONS,
  type Scene,
  type SceneChainRole,
  type SceneDurationSeconds,
  type TimelineProgress,
  type TimelineSession,
  type TimelineSessionSummary,
  type TimelineStyleReference,
  type TimelineWorkflowSource,
  type VideoWorkflowMode,
  type VisualBible,
} from "../shared/timeline";
import { ImageGenerationModal } from "./ImageGenerationModal";
import { VideoGenerationModal } from "./VideoGenerationModal";
import { VisualBiblePanel } from "./VisualBiblePanel";
import { WorkflowDashboard, type WorkflowDashboardActions } from "./WorkflowDashboard";
import type { GraphicStylePreset } from "../shared/visual-style";
import type { IntegratedWorkflowHandoff } from "./integrated-workflow";
import {
  DEFAULT_PROJECT_ID,
  type ProductionQueueSnapshot,
  type QueueErrorView,
} from "../shared/production-queue";

interface TimelineImportProps {
  chatConnected: boolean;
  flowConnected: boolean;
  integratedHandoff?: IntegratedWorkflowHandoff | null;
  onIntegratedHandoffConsumed?: () => void;
  onWorkflowReady?: () => void;
  onBuildVideo?: () => void;
  onBack?: () => void;
}

const TIMELINE_STORAGE_KEY = "flowx.timeline.scenes.v1";

const POLICY_REASON_OPTIONS = [
  {
    value: "auto",
    label: "Tự nhận diện từ Flow",
    description: "Ưu tiên nguyên văn thông báo vừa xuất hiện trên card render.",
  },
  {
    value: "violence",
    label: "Bạo lực hoặc gây hại",
    description: "Thương tích, máu me, đe dọa, hành hung hoặc kích động bạo lực.",
  },
  {
    value: "sexual",
    label: "Tình dục hoặc khỏa thân",
    description: "Nội dung tình dục rõ ràng, gợi dục hoặc hình ảnh thân mật không đồng thuận.",
  },
  {
    value: "child_safety",
    label: "An toàn trẻ em",
    description: "Trẻ vị thành niên trong ngữ cảnh tình dục, bóc lột, bạo lực hoặc nguy hiểm.",
  },
  {
    value: "hate_harassment",
    label: "Thù ghét hoặc quấy rối",
    description: "Lăng mạ, đe dọa, bắt nạt hoặc nhắm tới một nhóm được bảo vệ.",
  },
  {
    value: "self_harm",
    label: "Tự làm hại bản thân",
    description: "Tự sát, tự gây thương tích hoặc hành vi nguy hiểm với bản thân.",
  },
  {
    value: "illegal_dangerous",
    label: "Phi pháp hoặc nguy hiểm",
    description: "Vũ khí, chất cấm, phạm tội, khủng bố hoặc hướng dẫn hành vi nguy hiểm.",
  },
  {
    value: "rights_identity",
    label: "Quyền riêng tư hoặc danh tính",
    description: "Người thật, mạo danh, sinh trắc học, quyền riêng tư hoặc tài sản trí tuệ.",
  },
  {
    value: "deception",
    label: "Lừa đảo hoặc thông tin sai lệch",
    description: "Gian lận, lừa đảo, tuyên bố gây hiểu nhầm hoặc nội dung chính trị nhạy cảm.",
  },
  {
    value: "other",
    label: "Khác / không rõ",
    description: "Dùng ô chi tiết để nhập đúng nội dung Flow hiển thị.",
  },
] as const;

type PolicyReason = (typeof POLICY_REASON_OPTIONS)[number]["value"];

interface PolicyRepairModalState {
  sceneId: string;
  mediaType: SceneMediaType;
  detectedError: string;
}

function loadStoredScenes(): Scene[] {
  try {
    const value = JSON.parse(localStorage.getItem(TIMELINE_STORAGE_KEY) || "[]");
    return normalizeStoredScenes(value);
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function isDetectedPolicyError(value: string | undefined): boolean {
  return /policy|safety|moderation|responsible\s+ai|prohibited|violation|blocked.{0,30}prompt|prompt.{0,30}blocked|vi\s*phạm|chính\s*sách/i.test(
    value || "",
  );
}

function applyQueueSnapshotToScenes(
  scenes: Scene[],
  snapshot: ProductionQueueSnapshot,
): Scene[] {
  const byId = new Map(snapshot.scenes.map((scene) => [scene.sceneId, scene]));
  return scenes.map((scene) => {
    const queued = byId.get(scene.id);
    if (!queued) return scene;
    const imageNeedsReview = queued.status === "needs_review" &&
      Boolean(queued.imageAssetPath) &&
      !queued.videoAssetPath;
    const videoNeedsReview = queued.status === "needs_review" && Boolean(queued.videoAssetPath);
    const imageStatus = queued.status === "image_failed"
      ? "error"
      : queued.status === "image_queued"
        ? "queued"
        : queued.status === "image_generating"
        ? "generating"
        : imageNeedsReview
          ? "review"
        : queued.imageAssetPath
          ? "done"
          : "pending";
    const videoStatus = queued.status === "video_failed"
      ? "error"
      : queued.status === "video_queued"
        ? "queued"
        : queued.status === "video_generating"
        ? "generating"
        : videoNeedsReview
          ? "review"
        : queued.videoAssetPath
          ? "done"
          : "pending";
    return {
      ...scene,
      imageStatus,
      imageResultPath: queued.imageAssetPath,
      imageFlowAssetKey: queued.flowImageAssetId,
      imageApproved: queued.approvedImage,
      videoStatus,
      videoResultPath: queued.videoAssetPath,
      videoApproved: queued.approvedVideo,
    };
  });
}

function FilePicker({
  id,
  label,
  accept,
  file,
  savedName,
  onChange,
}: {
  id: string;
  label: string;
  accept: string;
  file: File | null;
  savedName?: string;
  onChange: (file: File | null) => void;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.files?.[0] || null);
  };

  return (
    <div className={`timeline-file ${file || savedName ? "has-file" : ""}`}>
      <div className="timeline-file-icon" aria-hidden="true">
        <FileText size={20} />
      </div>
      <div className="timeline-file-details">
        <strong>{label}</strong>
        <span>{file
          ? `${file.name} · ${formatBytes(file.size)}`
          : savedName
            ? `${savedName} · đã lưu trong phiên`
            : "Chưa chọn file"}</span>
      </div>
      <label className="button secondary compact" htmlFor={id}>
        <Upload size={15} aria-hidden="true" />
        Chọn file
      </label>
      <input
        key={file ? `${file.name}-${file.size}` : "empty"}
        id={id}
        className="visually-hidden-file"
        type="file"
        accept={accept}
        onChange={handleChange}
      />
    </div>
  );
}

const STATUS_LABELS = {
  pending: "Chờ",
  queued: "Trong hàng đợi",
  generating: "Đang chạy",
  done: "Hoàn tất",
  review: "Cần làm lại",
  error: "Lỗi",
} as const;

function SceneStatusCell({
  scene,
  mediaType,
  error,
  onRun,
  onAlternative,
  disabled = false,
  disabledTitle,
  approved = false,
  onApprove,
  onReject,
}: {
  scene: Scene;
  mediaType: SceneMediaType;
  error?: string;
  onRun: () => void;
  onAlternative: () => void;
  disabled?: boolean;
  disabledTitle?: string;
  approved?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const status = mediaType === "image" ? scene.imageStatus : scene.videoStatus;
  const busy = status === "generating";
  return (
    <div className="scene-job-cell">
      <span className={`scene-status is-${status}`} title={error || STATUS_LABELS[status]}>
        {busy ? <LoaderCircle className="spin" size={13} /> : status === "done" ? <Check size={13} /> : status === "error" ? <CircleAlert size={13} /> : null}
        {STATUS_LABELS[status]}
      </span>
      {approved && <small className="scene-approved"><Check size={12} /> Đã duyệt</small>}
      {error && <small className="scene-job-error" role="alert">{error}</small>}
      <div className="scene-job-actions">
        <button className="icon-button compact-icon" type="button" title={disabledTitle || `Tạo lại ${mediaType === "image" ? "ảnh" : "video"}`} disabled={busy || disabled} onClick={onRun}>
          <RotateCcw size={14} aria-hidden="true" />
        </button>
        <button className="icon-button compact-icon" type="button" title={disabledTitle || "Dùng prompt khác"} disabled={busy || disabled} onClick={onAlternative}>
          <PencilLine size={14} aria-hidden="true" />
        </button>
        {(status === "done" || status === "review") && !approved && onApprove && (
          <>
            <button className="icon-button compact-icon approve-icon" type="button" title="Duyệt kết quả" onClick={onApprove}>
              <Check size={14} aria-hidden="true" />
            </button>
            {status === "done" && onReject && (
              <button className="icon-button compact-icon reject-icon" type="button" title="Từ chối · đánh dấu cần làm lại" onClick={onReject}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TimelineTable({
  scenes,
  errors,
  thumbnails,
  onPromptChange,
  onPlanningChange,
  onRun,
  onRegenerate,
  onResumeFrom,
  onClearSceneMedia,
  onApprove,
  onReject,
  onRepairPolicy,
  repairingPromptKey,
  clearingSceneId,
  chatConnected,
}: {
  scenes: Scene[];
  errors: Record<string, string>;
  thumbnails: Record<string, string>;
  onPromptChange: (sceneId: string, mediaType: SceneMediaType, prompt: string) => void;
  onPlanningChange: (
    sceneId: string,
    change: Partial<Pick<Scene, "chainId" | "chainRole" | "durationSeconds">>,
  ) => void;
  onRun: (sceneId: string, mediaType: SceneMediaType, prompt: string) => void;
  onRegenerate: (sceneId: string, mediaType: SceneMediaType) => void;
  onResumeFrom: (sceneId: string, mediaType: SceneMediaType) => void;
  onClearSceneMedia: (sceneId: string) => void;
  onApprove: (sceneId: string, mediaType: SceneMediaType) => void;
  onReject: (sceneId: string, mediaType: SceneMediaType) => void;
  onRepairPolicy: (sceneId: string, mediaType: SceneMediaType) => void;
  repairingPromptKey: string;
  clearingSceneId: string;
  chatConnected: boolean;
}) {
  const [alternative, setAlternative] = useState<{ sceneId: string; mediaType: SceneMediaType } | null>(null);
  const [draft, setDraft] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    sceneId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const openAlternative = (scene: Scene, mediaType: SceneMediaType) => {
    setAlternative({ sceneId: scene.id, mediaType });
    setDraft(mediaType === "image" ? scene.imagePrompt : scene.videoPrompt);
  };

  return (
    <div className="timeline-table-wrap">
      <table className="timeline-table">
        <thead>
          <tr>
            <th scope="col">Scene</th>
            <th scope="col">Chain</th>
            <th scope="col">Thời lượng</th>
            <th scope="col">Thumbnail</th>
            <th scope="col">Prompt ảnh</th>
            <th scope="col">Ảnh</th>
            <th scope="col">Prompt video</th>
            <th scope="col">Video</th>
            <th scope="col">Nhân vật</th>
          </tr>
        </thead>
        <tbody>
          {scenes.map((scene) => {
            const isAlternative = alternative?.sceneId === scene.id;
            const hasSceneWork = Boolean(
              scene.imageResultPath ||
              scene.videoResultPath ||
              scene.imageStatus !== "pending" ||
              scene.videoStatus !== "pending"
            );
            return [
              <tr
                key={scene.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ sceneId: scene.id, x: event.clientX, y: event.clientY });
                }}
              >
                <td className="scene-identity">
                  <strong>{scene.order}</strong>
                  <span>{scene.timeStart}</span>
                  <span>{scene.timeEnd}</span>
                  <button
                    className="icon-button compact-icon danger-icon scene-delete-result"
                    type="button"
                    title="Xóa ảnh, video và job của riêng scene này; giữ nguyên prompt"
                    aria-label={`Xóa kết quả scene ${scene.order}`}
                    disabled={!hasSceneWork || Boolean(clearingSceneId)}
                    onClick={() => onClearSceneMedia(scene.id)}
                  >
                    {clearingSceneId === scene.id
                      ? <LoaderCircle className="spin" size={13} />
                      : <Trash2 size={13} />}
                  </button>
                </td>
                <td className="scene-chain-cell">
                  <select
                    aria-label={`Vai trò chain scene ${scene.order}`}
                    value={scene.chainRole}
                    onChange={(event) => onPlanningChange(scene.id, {
                      chainRole: event.target.value as SceneChainRole,
                    })}
                  >
                    <option value="single">Độc lập</option>
                    <option value="start">Bắt đầu</option>
                    <option value="continue">Tiếp nối</option>
                  </select>
                  <input
                    aria-label={`Mã chain scene ${scene.order}`}
                    value={scene.chainId || ""}
                    disabled={scene.chainRole === "single"}
                    placeholder="chain-001"
                    onChange={(event) => onPlanningChange(scene.id, { chainId: event.target.value })}
                  />
                </td>
                <td className="scene-duration-cell">
                  <select
                    aria-label={`Thời lượng scene ${scene.order}`}
                    value={scene.durationSeconds}
                    onChange={(event) => onPlanningChange(scene.id, {
                      durationSeconds: Number(event.target.value) as SceneDurationSeconds,
                    })}
                  >
                    {SCENE_DURATION_OPTIONS.map((seconds) => (
                      <option key={seconds} value={seconds}>{seconds} giây</option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className={`scene-thumbnail is-${scene.imageStatus}`}>
                    {thumbnails[scene.id]
                      ? <img src={thumbnails[scene.id]} alt={`Kết quả scene ${scene.order}`} loading="lazy" />
                      : scene.imageStatus === "generating"
                        ? <LoaderCircle className="spin" size={20} />
                        : scene.imageStatus === "done"
                          ? <Check size={22} />
                          : <ImageIcon size={22} />}
                  </div>
                </td>
                <td>
                  <div className="scene-prompt-cell">
                    <textarea className="scene-prompt" aria-label={`Prompt ảnh scene ${scene.order}`} value={scene.imagePrompt} onChange={(event) => onPromptChange(scene.id, "image", event.target.value)} />
                    {Boolean(scene.imagePrompt.trim()) && (
                      <button
                        className="button secondary compact policy-repair-button"
                        type="button"
                        disabled={!chatConnected || Boolean(repairingPromptKey)}
                        title={chatConnected
                          ? isDetectedPolicyError(errors[`${scene.id}:image`])
                            ? "Đã có lỗi Flow: gửi thẳng lỗi sang ChatGPT, sửa prompt và chạy tiếp"
                            : "Chưa đọc được lỗi Flow: mở danh sách lý do để bạn chọn"
                          : "ChatGPT worker chưa kết nối"}
                        onClick={() => onRepairPolicy(scene.id, "image")}
                      >
                        {repairingPromptKey === `${scene.id}:image` ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}
                        {isDetectedPolicyError(errors[`${scene.id}:image`]) ? "Sửa nhanh theo lỗi Flow" : "Sửa chính sách"}
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  <SceneStatusCell
                    scene={scene}
                    mediaType="image"
                    error={errors[`${scene.id}:image`]}
                    approved={scene.imageApproved}
                    onRun={() => onRun(scene.id, "image", scene.imagePrompt)}
                    onAlternative={() => openAlternative(scene, "image")}
                    onApprove={() => onApprove(scene.id, "image")}
                    onReject={() => onReject(scene.id, "image")}
                  />
                </td>
                <td>
                  <div className="scene-prompt-cell">
                    <textarea className="scene-prompt" aria-label={`Prompt video scene ${scene.order}`} value={scene.videoPrompt} onChange={(event) => onPromptChange(scene.id, "video", event.target.value)} />
                    {Boolean(scene.videoPrompt.trim()) && (
                      <button
                        className="button secondary compact policy-repair-button"
                        type="button"
                        disabled={!chatConnected || Boolean(repairingPromptKey)}
                        title={chatConnected
                          ? isDetectedPolicyError(errors[`${scene.id}:video`])
                            ? "Đã có lỗi Flow: gửi thẳng lỗi sang ChatGPT, sửa prompt và chạy tiếp"
                            : "Chưa đọc được lỗi Flow: mở danh sách lý do để bạn chọn"
                          : "ChatGPT worker chưa kết nối"}
                        onClick={() => onRepairPolicy(scene.id, "video")}
                      >
                        {repairingPromptKey === `${scene.id}:video` ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}
                        {isDetectedPolicyError(errors[`${scene.id}:video`]) ? "Sửa nhanh theo lỗi Flow" : "Sửa chính sách"}
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  <SceneStatusCell
                    scene={scene}
                    mediaType="video"
                    error={errors[`${scene.id}:video`]}
                    disabled={scene.imageStatus !== "done" || !scene.imageResultPath}
                    disabledTitle="Cần tạo xong ảnh scene trước khi tạo video"
                    approved={scene.videoApproved}
                    onRun={() => onRun(scene.id, "video", scene.videoPrompt)}
                    onAlternative={() => openAlternative(scene, "video")}
                    onApprove={() => onApprove(scene.id, "video")}
                    onReject={() => onReject(scene.id, "video")}
                  />
                </td>
                <td>
                  <div className="scene-tokens">
                    {scene.characterPolicy === "selected" && scene.assignedCharacterTokens.length > 0
                      ? scene.assignedCharacterTokens.map((token) => <span key={token}>{token}</span>)
                      : <span className="no-character">Không</span>}
                  </div>
                </td>
              </tr>,
              isAlternative ? (
                <tr className="scene-alternative-row" key={`${scene.id}-alternative`}>
                  <td colSpan={9}>
                    <div className="scene-alternative-editor">
                      <div>
                        <strong>Prompt {alternative.mediaType === "image" ? "ảnh" : "video"} thay thế · Scene {scene.order}</strong>
                        <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
                      </div>
                      <div className="scene-alternative-actions">
                        <button className="icon-button" type="button" title="Hủy" onClick={() => setAlternative(null)}><X size={16} /></button>
                        <button className="button primary" type="button" disabled={!draft.trim()} onClick={() => { onPromptChange(scene.id, alternative.mediaType, draft); onRun(scene.id, alternative.mediaType, draft); setAlternative(null); }}>
                          <Save size={15} /> Dùng prompt này
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {contextMenu && (
        <div
          className="scene-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{contextMenu.sceneId}</strong>
          <button type="button" role="menuitem" onClick={() => { onResumeFrom(contextMenu.sceneId, "image"); setContextMenu(null); }}>
            Resume ảnh từ đây
          </button>
          <button type="button" role="menuitem" onClick={() => { onResumeFrom(contextMenu.sceneId, "video"); setContextMenu(null); }}>
            Resume video từ đây
          </button>
          <button type="button" role="menuitem" onClick={() => { onRegenerate(contextMenu.sceneId, "image"); setContextMenu(null); }}>
            Tạo lại ảnh chỉ scene này
          </button>
          <button type="button" role="menuitem" onClick={() => { onRegenerate(contextMenu.sceneId, "video"); setContextMenu(null); }}>
            Tạo lại video chỉ scene này
          </button>
        </div>
      )}
    </div>
  );
}

const ERROR_CATEGORY_LABELS: Record<QueueErrorView["category"], string> = {
  dom_element_not_found: "Không tìm thấy phần tử Flow",
  flow_policy_violation: "Vi phạm chính sách Flow",
  flow_generation_failed: "Flow không tạo được video",
  response_schema_invalid: "Phản hồi không hợp lệ",
  timeout_no_response: "Quá thời gian phản hồi",
  flow_quota_or_rate_limit: "Giới hạn Google Flow",
  extension_disconnected: "Extension mất kết nối",
};

function ErrorCenter({
  errors,
  onRetry,
}: {
  errors: QueueErrorView[];
  onRetry: (sceneIds: string[]) => void;
}) {
  if (errors.length === 0) return null;
  return (
    <section className="error-center" aria-labelledby="error-center-title">
      <header>
        <div>
          <p className="eyebrow">Production queue</p>
          <h3 id="error-center-title">Error Center · {errors.length} lỗi</h3>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => onRetry([...new Set(errors.map((item) => item.sceneId))])}
        >
          <RotateCcw size={14} /> Thử lại lỗi
        </button>
      </header>
      <div className="error-center-list">
        {errors.map((item) => (
          <article key={item.jobId}>
            <CircleAlert size={17} aria-hidden="true" />
            <div>
              <strong>Scene {item.orderIndex + 1} · {item.mediaType === "image" ? "Ảnh" : "Video"}</strong>
              <span>{ERROR_CATEGORY_LABELS[item.category]} · lần {item.attempts}/{item.maxAttempts}</span>
              <p>{item.message}</p>
            </div>
            <button
              className="button secondary compact"
              type="button"
              onClick={() => onRetry([item.sceneId])}
            >
              Thử lại
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TimelineImport({
  chatConnected,
  flowConnected,
  integratedHandoff = null,
  onIntegratedHandoffConsumed,
  onWorkflowReady,
  onBuildVideo,
  onBack,
}: TimelineImportProps) {
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [workflowMode, setWorkflowMode] = useState<VideoWorkflowMode>("two_step");
  const [workflowSource, setWorkflowSource] = useState<TimelineWorkflowSource>(
    () => structuredClone(DEFAULT_TIMELINE_WORKFLOW_SOURCE),
  );
  const [workflowNotice, setWorkflowNotice] = useState("");
  const [scenes, setScenes] = useState<Scene[]>(loadStoredScenes);
  const [visualBible, setVisualBible] = useState<VisualBible>(() => structuredClone(DEFAULT_VISUAL_BIBLE));
  const [styleReference, setStyleReference] = useState<TimelineStyleReference | null>(null);
  const [sessions, setSessions] = useState<TimelineSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_PROJECT_ID);
  const [sessionNameDraft, setSessionNameDraft] = useState("Phiên làm việc");
  const [switchingSession, setSwitchingSession] = useState(false);
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [stylePresets, setStylePresets] = useState<GraphicStylePreset[]>([]);
  const [stylePresetError, setStylePresetError] = useState("");
  const [imageModal, setImageModal] = useState<{ sceneId: string; prompt: string } | null>(null);
  const [videoModal, setVideoModal] = useState<{ sceneId: string; prompt: string } | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [clearMediaConfirmOpen, setClearMediaConfirmOpen] = useState(false);
  const [clearingGeneratedMedia, setClearingGeneratedMedia] = useState(false);
  const [clearSceneMediaTarget, setClearSceneMediaTarget] = useState<string | null>(null);
  const [clearingSceneId, setClearingSceneId] = useState("");
  const [clearMediaNotice, setClearMediaNotice] = useState("");
  const [progress, setProgress] = useState<TimelineProgress | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [sceneErrors, setSceneErrors] = useState<Record<string, string>>({});
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const [queueSnapshot, setQueueSnapshot] = useState<ProductionQueueSnapshot | null>(null);
  const [queueCommandError, setQueueCommandError] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [repairingPromptKey, setRepairingPromptKey] = useState("");
  const [policyRepairModal, setPolicyRepairModal] = useState<PolicyRepairModalState | null>(null);
  const [policyReason, setPolicyReason] = useState<PolicyReason>("auto");
  const [policyDetail, setPolicyDetail] = useState("");
  const sessionSaveVersion = useRef(0);
  const settledSceneJobs = useRef(new Set<string>());
  const sceneJobSessions = useRef(new Map<string, string>());
  const activeSessionIdRef = useRef(activeSessionId);
  const consumedHandoffIds = useRef(new Set<string>());
  const loadedThumbnailPaths = useRef(new Map<string, string>());
  const timelineRootRef = useRef<HTMLElement>(null);
  const activeProjectId = activeSessionId || DEFAULT_PROJECT_ID;

  useEffect(() => {
    if (scenes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      const dashboard = timelineRootRef.current?.querySelector<HTMLElement>(".workflow-dashboard");
      dashboard?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scenes.length]);

  const applySession = (session: TimelineSession) => {
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    setSessionNameDraft(session.name);
    setScenes(session.scenes);
    setVisualBible(session.visualBible);
    setStyleReference(session.styleReference);
    setWorkflowMode(session.workflowMode);
    setWorkflowSource(session.workflowSource);
    setWorkflowNotice("");
    setSrtFile(null);
    setScriptFile(null);
    setProgress(null);
    setError("");
    setSceneErrors({});
    setThumbnails({});
    setImageModal(null);
    setVideoModal(null);
    const restoredSceneId = localStorage.getItem(`kc-auto-tool:selected-scene:${session.id}`) || "";
    const nextSceneId = session.scenes.some((scene) => scene.id === restoredSceneId)
      ? restoredSceneId
      : session.scenes[0]?.id || "";
    setSelectedSceneId(nextSceneId);
    setClearSceneMediaTarget(null);
    setClearingSceneId("");
    loadedThumbnailPaths.current.clear();
    settledSceneJobs.current.clear();
    sceneJobSessions.current.clear();
  };

  useEffect(() => {
    let active = true;
    void window.flowx?.characters.list().then(
      (items) => { if (active) setCharacters(items); },
      () => { if (active) setCharacters([]); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void window.flowx?.visualStyles.list().then(
      (items) => { if (active) setStylePresets(items); },
      (caught) => { if (active) setStylePresetError(errorMessage(caught)); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const media = window.flowx?.media;
    if (!media) return;
    const sessionId = activeProjectId;
    const currentPaths = new Map(
      scenes
        .filter((scene) => scene.imageStatus === "done" && Boolean(scene.imageResultPath))
        .map((scene) => [scene.id, scene.imageResultPath] as const),
    );
    for (const [sceneId, path] of loadedThumbnailPaths.current) {
      if (currentPaths.get(sceneId) !== path) loadedThumbnailPaths.current.delete(sceneId);
    }
    setThumbnails((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([sceneId]) => currentPaths.has(sceneId)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    for (const scene of scenes) {
      const path = scene.imageResultPath;
      if (
        scene.imageStatus !== "done" ||
        !path ||
        path.startsWith("mock://") ||
        loadedThumbnailPaths.current.get(scene.id) === path
      ) {
        continue;
      }
      loadedThumbnailPaths.current.set(scene.id, path);
      void media.getStreamUrl(path).then(
        (streamUrl) => {
          if (
            activeSessionIdRef.current !== sessionId ||
            loadedThumbnailPaths.current.get(scene.id) !== path
          ) return;
          setThumbnails((current) => ({ ...current, [scene.id]: streamUrl }));
        },
        () => {
          if (loadedThumbnailPaths.current.get(scene.id) === path) {
            loadedThumbnailPaths.current.delete(scene.id);
          }
        },
      );
    }
  }, [activeProjectId, scenes]);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const bridge = window.flowx?.timeline;
      if (!bridge) {
        if (active) {
          setSessionReady(true);
          setSessionStatus("error");
        }
        return;
      }

      try {
        let availableSessions = await bridge.listSessions();
        let stored = await bridge.loadSession();
        if (!stored) {
          stored = await bridge.createSession("Phiên 1");
          availableSessions = await bridge.listSessions();
        }
        if (!active) return;
        if (stored.scenes.length) {
          applySession(stored);
        } else {
          const legacyScenes = loadStoredScenes();
          if (legacyScenes.length > 0) {
            const migrated = await bridge.saveSession({
              scenes: legacyScenes,
              visualBible: structuredClone(DEFAULT_VISUAL_BIBLE),
              styleReference: null,
            });
            if (!active) return;
            applySession(migrated);
          } else {
            applySession(stored);
          }
        }
        setSessions(availableSessions);
        localStorage.removeItem(TIMELINE_STORAGE_KEY);
        setSessionStatus("saved");
      } catch {
        if (active) setSessionStatus("error");
      } finally {
        if (active) setSessionReady(true);
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const bridge = window.flowx?.timeline;
    if (!bridge) return undefined;
    return bridge.onProgress(setProgress);
  }, []);

  useEffect(() => {
    const bridge = window.flowx?.sceneJobs;
    if (!bridge) return undefined;
    return bridge.onProgress((job: SceneJobProgress) => {
      const key = `${job.sceneId}:${job.mediaType}`;
      if (
        settledSceneJobs.current.has(key) ||
        sceneJobSessions.current.get(key) !== activeSessionIdRef.current
      ) return;
      setScenes((current) =>
        current.map((scene) => {
          if (scene.id !== job.sceneId) return scene;
          const status = job.status === "stopping" ? "pending" : "generating";
          return job.mediaType === "image"
            ? { ...scene, imageStatus: status }
            : { ...scene, videoStatus: status };
        }),
      );
    });
  }, []);

  useEffect(() => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return undefined;
    const applySnapshot = (snapshot: ProductionQueueSnapshot) => {
      if (snapshot.projectId !== activeSessionIdRef.current) return;
      setQueueSnapshot(snapshot);
      setScenes((current) => applyQueueSnapshotToScenes(current, snapshot));
      setSceneErrors((current) => {
        const next = { ...current };
        for (const scene of snapshot.scenes) {
          if (scene.status !== "image_failed") delete next[`${scene.sceneId}:image`];
          if (scene.status !== "video_failed") delete next[`${scene.sceneId}:video`];
        }
        for (const queueError of snapshot.errors) {
          next[`${queueError.sceneId}:${queueError.mediaType}`] = queueError.message;
        }
        return next;
      });
    };
    void bridge.getSnapshot(activeProjectId).then(applySnapshot, () => {});
    return bridge.onChanged(applySnapshot);
  }, [activeProjectId]);

  useEffect(() => {
    // Clearing generated media performs its own ordered session writes. Pause
    // the debounced renderer autosave so an older scene snapshot cannot be
    // queued behind the clear operation and restore deleted result paths.
    if (!sessionReady || clearingGeneratedMedia || Boolean(clearingSceneId)) return undefined;
    const saveVersion = ++sessionSaveVersion.current;
    setSessionStatus("saving");
    const timer = window.setTimeout(() => {
      const bridge = window.flowx?.timeline;
      if (!bridge) return;
      const operation = bridge.saveSession({
        scenes,
        visualBible,
        styleReference,
        workflowMode,
        workflowSource,
      });
      void operation.then(
        (saved) => {
          localStorage.removeItem(TIMELINE_STORAGE_KEY);
          setSessions((current) => current.map((entry) => entry.id === saved.id
            ? { ...entry, name: saved.name, sceneCount: saved.scenes.length, savedAt: saved.savedAt, active: true }
            : { ...entry, active: false }));
          if (sessionSaveVersion.current === saveVersion) {
            setSessionStatus("saved");
          }
        },
        () => {
          if (sessionSaveVersion.current === saveVersion) {
            setSessionStatus("error");
          }
        },
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    scenes,
    visualBible,
    styleReference,
    workflowMode,
    workflowSource,
    sessionReady,
    clearingGeneratedMedia,
    clearingSceneId,
  ]);

  const validateFile = (
    file: File | null,
    label: string,
    extensions: string[],
  ): file is File => {
    if (!file) {
      setError(`Hãy chọn ${label.toLowerCase()}`);
      return false;
    }
    if (file.size > MAX_TIMELINE_FILE_BYTES) {
      setError(`${label} vượt quá giới hạn 2 MB`);
      return false;
    }
    if (!extensions.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      setError(`${label} phải có định dạng ${extensions.join(" hoặc ")}`);
      return false;
    }
    return true;
  };

  const updatePrompt = (
    sceneId: string,
    mediaType: SceneMediaType,
    prompt: string,
  ) => {
    setScenes((current) =>
      current.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const next = mediaType === "image"
          ? { ...scene, imagePrompt: prompt }
          : { ...scene, videoPrompt: prompt };
        return {
          ...next,
          usedCharacterTokens: parseCharacterTokens(
            `${next.imagePrompt}\n${next.videoPrompt}`,
          ),
        };
      }),
    );
  };

  const selectScene = (sceneId: string) => {
    setSelectedSceneId(sceneId);
    localStorage.setItem(`kc-auto-tool:selected-scene:${activeProjectId}`, sceneId);
  };

  const saveCurrentSession = async () => {
    const bridge = window.flowx?.timeline;
    if (!bridge) return;
    setSessionStatus("saving");
    try {
      await bridge.saveSession({ scenes, visualBible, styleReference, workflowMode, workflowSource });
      setSessionStatus("saved");
    } catch (caught) {
      setSessionStatus("error");
      setQueueCommandError(errorMessage(caught));
    }
  };

  const updatePlanning = (
    sceneId: string,
    change: Partial<Pick<Scene, "chainId" | "chainRole" | "durationSeconds">>,
  ) => {
    setScenes((current) => recalculateScenePlanning(current, sceneId, change));
  };

  const executeSceneJob = async (
    sceneId: string,
    mediaType: SceneMediaType,
    prompt: string,
    characterTokens: string[] = [],
  ) => {
    const key = `${sceneId}:${mediaType}`;
    const jobSessionId = activeSessionIdRef.current;
    sceneJobSessions.current.set(key, jobSessionId);
    settledSceneJobs.current.delete(key);
    setSceneErrors((current) => ({ ...current, [key]: "" }));
    if (!flowConnected || !window.flowx?.sceneJobs) {
      setSceneErrors((current) => ({
        ...current,
        [key]: "Google Flow worker chưa kết nối",
      }));
      setScenes((current) => current.map((scene) => scene.id === sceneId
        ? mediaType === "image"
          ? { ...scene, imageStatus: "error" }
          : { ...scene, videoStatus: "error" }
        : scene));
      return;
    }

    setScenes((current) => current.map((scene) => scene.id === sceneId
      ? mediaType === "image"
        ? { ...scene, imageStatus: "generating" }
        : { ...scene, videoStatus: "generating" }
      : scene));
    try {
      const sourceScene = scenes.find((scene) => scene.id === sceneId);
      const result = await window.flowx.sceneJobs.run({
        sceneId,
        outputFolder: projectOutputFolder(activeProjectId, sessionNameDraft),
        mediaType,
        prompt: prompt.trim(),
        characterTokens: mediaType === "image" ? characterTokens : [],
        visualBible,
        imageSettings: {
          model: "nano-banana-pro",
          aspectRatio: visualBible.aspectRatio,
          outputCount: 1,
          expectedCredits: 0,
        },
        sourceImagePath: mediaType === "video" ? sourceScene?.imageResultPath || "" : "",
        sourceFlowAssetKey: mediaType === "video" ? sourceScene?.imageFlowAssetKey || "" : "",
        startFramePath: "",
        videoSettings: {
          model: "veo-3.1-lite",
          mode: "first-frame",
          aspectRatio: visualBible.aspectRatio,
          durationSeconds: sourceScene?.durationSeconds || 8,
          outputCount: 1,
          expectedCredits: 0,
        },
      });
      if (activeSessionIdRef.current !== jobSessionId) return;
      settledSceneJobs.current.add(key);
      setScenes((current) => current.map((scene) => scene.id === sceneId
        ? mediaType === "image"
          ? {
            ...scene,
            imageStatus: "done",
            imageResultPath: result.resultPath,
            imageFlowAssetKey: result.flowAssetKey,
            imageApproved: false,
            videoStatus: "pending",
            videoResultPath: "",
            videoApproved: false,
          }
          : { ...scene, videoStatus: "done", videoResultPath: result.resultPath, videoApproved: false }
        : scene));
    } catch (caught) {
      if (activeSessionIdRef.current !== jobSessionId) return;
      settledSceneJobs.current.add(key);
      setSceneErrors((current) => ({ ...current, [key]: errorMessage(caught) }));
      setScenes((current) => current.map((scene) => scene.id === sceneId
        ? mediaType === "image"
          ? { ...scene, imageStatus: "error" }
          : { ...scene, videoStatus: "error" }
        : scene));
    }
  };

  const requestSceneJob = (
    sceneId: string,
    mediaType: SceneMediaType,
    prompt: string,
  ) => {
    if (mediaType === "image") {
      setImageModal({ sceneId, prompt });
      return;
    }
    const scene = scenes.find((entry) => entry.id === sceneId);
    if (!scene || scene.imageStatus !== "done" || !scene.imageResultPath) {
      setSceneErrors((current) => ({
        ...current,
        [`${sceneId}:video`]: "Hãy tạo xong ảnh scene trước khi tạo video.",
      }));
      return;
    }
    setVideoModal({ sceneId, prompt });
  };

  const confirmImageGeneration = (value: {
    prompt: string;
    characterPolicy: Scene["characterPolicy"];
    characterTokens: string[];
  }) => {
    if (!imageModal) return;
    const { sceneId } = imageModal;
    setScenes((current) => current.map((scene) => scene.id === sceneId
      ? {
        ...scene,
        imagePrompt: value.prompt,
        characterPolicy: value.characterPolicy,
        assignedCharacterTokens: value.characterTokens,
      }
      : scene));
    setImageModal(null);
    void executeSceneJob(sceneId, "image", value.prompt, value.characterTokens);
  };

  const confirmVideoGeneration = (prompt: string) => {
    if (!videoModal) return;
    const { sceneId } = videoModal;
    setScenes((current) => current.map((scene) => scene.id === sceneId
      ? { ...scene, videoPrompt: prompt }
      : scene));
    setVideoModal(null);
    void executeSceneJob(sceneId, "video", prompt);
  };

  const runQueueCommand = async (
    operation: () => Promise<ProductionQueueSnapshot>,
    flushSession = true,
    sessionScenes: Scene[] = scenes,
  ) => {
    const commandSessionId = activeSessionIdRef.current;
    setQueueCommandError("");
    try {
      if (flushSession && sessionScenes.length > 0) {
        await window.flowx?.timeline.saveSession({
          scenes: sessionScenes,
          visualBible,
          styleReference,
          workflowMode,
          workflowSource,
        });
      }
      const snapshot = await operation();
      if (activeSessionIdRef.current !== commandSessionId) return;
      setQueueSnapshot(snapshot);
      setScenes((current) => applyQueueSnapshotToScenes(current, snapshot));
    } catch (caught) {
      if (activeSessionIdRef.current !== commandSessionId) return;
      setQueueCommandError(errorMessage(caught));
    }
  };

  const refreshQueueSnapshot = async () => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    setQueueCommandError("");
    try {
      const snapshot = await bridge.getSnapshot(activeProjectId);
      setQueueSnapshot(snapshot);
      setScenes((current) => applyQueueSnapshotToScenes(current, snapshot));
      setWorkflowNotice("Đã làm mới trạng thái workflow từ queue.");
    } catch (caught) {
      setQueueCommandError(errorMessage(caught));
    }
  };

  const regenerateQueuedScene = (
    sceneId: string,
    mediaType: SceneMediaType,
    promptOverride?: string,
  ) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    const nextScenes = typeof promptOverride === "string"
      ? scenes.map((scene) => scene.id === sceneId
        ? mediaType === "image"
          ? { ...scene, imagePrompt: promptOverride }
          : { ...scene, videoPrompt: promptOverride }
        : scene)
      : scenes;
    if (nextScenes !== scenes) setScenes(nextScenes);
    void runQueueCommand(
      () => bridge.regenerateScene(sceneId, mediaType, activeProjectId),
      true,
      nextScenes,
    );
  };

  const runOrRegenerateScene = (
    sceneId: string,
    mediaType: SceneMediaType,
    prompt: string,
  ) => {
    const scene = scenes.find((entry) => entry.id === sceneId);
    const hasOldResult = mediaType === "image"
      ? Boolean(scene?.imageResultPath || scene?.videoResultPath)
      : Boolean(scene?.videoResultPath);
    if (hasOldResult) {
      regenerateQueuedScene(sceneId, mediaType, prompt);
      return;
    }
    requestSceneJob(sceneId, mediaType, prompt);
  };

  const resumeQueueFromScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(() => bridge.resumeFrom(sceneId, mediaType, activeProjectId));
  };

  const repairPolicyPromptAndResume = async (
    sceneId: string,
    mediaType: SceneMediaType,
    selectedReason: PolicyReason,
    detail: string,
  ) => {
    const key = `${sceneId}:${mediaType}`;
    if (repairingPromptKey) return;
    const scene = scenes.find((entry) => entry.id === sceneId);
    const timeline = window.flowx?.timeline;
    const queue = window.flowx?.productionQueue;
    if (!scene || !timeline || !queue || !chatConnected) {
      setSceneErrors((current) => ({
        ...current,
        [key]: !chatConnected ? "ChatGPT worker chưa kết nối" : "Bridge sửa prompt chưa sẵn sàng",
      }));
      return;
    }

    setRepairingPromptKey(key);
    setQueueCommandError("");
    try {
      const stopped = await queue.stopQueue();
      setQueueSnapshot(stopped);
      await window.flowx?.sceneJobs.cancel().catch(() => false);

      const originalPrompt = mediaType === "image" ? scene.imagePrompt : scene.videoPrompt;
      const pairedPrompt = mediaType === "image" ? scene.videoPrompt : scene.imagePrompt;
      const queueError = queueSnapshot?.errors.find((item) =>
        item.sceneId === sceneId && item.mediaType === mediaType
      )?.message || "";
      const detectedError = sceneErrors[key] || queueError;
      const selectedOption = POLICY_REASON_OPTIONS.find((option) => option.value === selectedReason);
      const policyReasonText = selectedReason === "auto"
        ? detectedError || "Google Flow rejected this prompt under its safety policy."
        : `${selectedOption?.label || "Không rõ loại vi phạm"}: ${selectedOption?.description || ""}`;
      const normalizedDetail = detail.trim();
      const additionalDetail = normalizedDetail && (
        selectedReason !== "auto" || normalizedDetail !== detectedError
      )
        ? `Chi tiết hoặc thông báo Flow: ${normalizedDetail}`
        : "";
      const rewritten = await timeline.rewritePolicyPrompt({
        sceneId,
        mediaType,
        prompt: originalPrompt,
        policyError: [policyReasonText, additionalDetail].filter(Boolean).join("\n"),
        timeStart: scene.timeStart,
        timeEnd: scene.timeEnd,
        pairedPrompt,
        visualBible,
      });

      const nextScenes = scenes.map((entry) => {
        if (entry.id !== sceneId) return entry;
        if (mediaType === "image") {
          return {
            ...entry,
            imagePrompt: rewritten.prompt,
            imageStatus: "pending" as const,
            imageResultPath: "",
            imageFlowAssetKey: "",
            imageApproved: false,
            videoStatus: "pending" as const,
            videoResultPath: "",
            videoApproved: false,
            usedCharacterTokens: parseCharacterTokens(`${rewritten.prompt}\n${entry.videoPrompt}`),
          };
        }
        return {
          ...entry,
          videoPrompt: rewritten.prompt,
          imageApproved: entry.imageResultPath ? true : entry.imageApproved,
          videoStatus: "pending" as const,
          videoResultPath: "",
          videoApproved: false,
          usedCharacterTokens: parseCharacterTokens(`${entry.imagePrompt}\n${rewritten.prompt}`),
        };
      });
      setScenes(nextScenes);
      await timeline.saveSession({
        scenes: nextScenes,
        visualBible,
        styleReference,
        workflowMode,
        workflowSource,
      });
      setSceneErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      const resumed = await queue.resumeFrom(sceneId, mediaType, activeProjectId);
      setQueueSnapshot(resumed);
      setScenes((current) => applyQueueSnapshotToScenes(current, resumed));
      setPolicyRepairModal(null);
    } catch (caught) {
      setSceneErrors((current) => ({
        ...current,
        [key]: `Không thể tự sửa prompt: ${errorMessage(caught)}. Hàng đợi vẫn đang dừng.`,
      }));
    } finally {
      setRepairingPromptKey("");
    }
  };

  const openPolicyRepairModal = (sceneId: string, mediaType: SceneMediaType) => {
    const key = `${sceneId}:${mediaType}`;
    const queueError = queueSnapshot?.errors.find((item) =>
      item.sceneId === sceneId && item.mediaType === mediaType
    );
    const detectedError = sceneErrors[key] || queueError?.message || "";
    if (queueError?.category === "flow_policy_violation" || isDetectedPolicyError(detectedError)) {
      void repairPolicyPromptAndResume(sceneId, mediaType, "auto", detectedError);
      return;
    }
    setPolicyReason("other");
    setPolicyDetail("");
    setPolicyRepairModal({ sceneId, mediaType, detectedError: "" });
  };

  const approveQueuedScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(
      () => bridge.approveScene(sceneId, mediaType, activeProjectId),
      true,
    );
  };

  const rejectQueuedScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(
      () => bridge.rejectScene(sceneId, mediaType, activeProjectId),
      true,
    );
  };

  const startAutomaticImageVideoPipeline = () => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(async () => {
      await bridge.setApprovalPolicy(
        true,
        true,
        activeProjectId,
      );
      const snapshot = await bridge.generateAllImages(activeProjectId);
      setWorkflowNotice("Bước sản xuất đã bắt đầu: app tự tạo ảnh, duyệt và dựng video theo thứ tự scene.");
      return snapshot;
    });
  };

  const clearAllGeneratedMedia = async () => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge || clearingGeneratedMedia || Boolean(clearingSceneId)) return;
    setClearingGeneratedMedia(true);
    setQueueCommandError("");
    setClearMediaNotice("");
    try {
      await window.flowx?.timeline.saveSession({
        scenes,
        visualBible,
        styleReference,
        workflowMode,
        workflowSource,
      });
      const result = await bridge.clearGeneratedMedia(activeProjectId);
      setQueueSnapshot(result.snapshot);
      setScenes((current) => applyQueueSnapshotToScenes(current, result.snapshot));
      setSceneErrors({});
      setThumbnails({});
      setImageModal(null);
      setVideoModal(null);
      settledSceneJobs.current.clear();
      loadedThumbnailPaths.current.clear();
      setClearMediaConfirmOpen(false);
      setClearMediaNotice(
        `Đã xóa ${result.deletedFiles} file trên máy trong ${result.deletedDirectories} thư mục; giữ nguyên ${result.retainedScenes} scene và toàn bộ prompt Phase 3. Nội dung trong thư viện Google Flow không bị xóa.`,
      );
    } catch (caught) {
      setQueueCommandError(errorMessage(caught));
    } finally {
      setClearingGeneratedMedia(false);
    }
  };

  const clearOneSceneMedia = async () => {
    const sceneId = clearSceneMediaTarget;
    const bridge = window.flowx?.productionQueue;
    if (!bridge || !sceneId || clearingSceneId || clearingGeneratedMedia) return;
    setClearingSceneId(sceneId);
    setQueueCommandError("");
    setClearMediaNotice("");
    try {
      await window.flowx?.timeline.saveSession({
        scenes,
        visualBible,
        styleReference,
        workflowMode,
        workflowSource,
      });
      const result = await bridge.clearSceneMedia(sceneId, activeProjectId);
      setQueueSnapshot(result.snapshot);
      setScenes((current) => applyQueueSnapshotToScenes(current, result.snapshot));
      setSceneErrors((current) => {
        const next = { ...current };
        delete next[`${sceneId}:image`];
        delete next[`${sceneId}:video`];
        return next;
      });
      setThumbnails((current) => {
        const next = { ...current };
        delete next[sceneId];
        return next;
      });
      settledSceneJobs.current.delete(`${sceneId}:image`);
      settledSceneJobs.current.delete(`${sceneId}:video`);
      loadedThumbnailPaths.current.clear();
      setImageModal((current) => current?.sceneId === sceneId ? null : current);
      setVideoModal((current) => current?.sceneId === sceneId ? null : current);
      setClearSceneMediaTarget(null);
      setClearMediaNotice(
        `Đã xóa ${result.deletedFiles} file và toàn bộ job của ${sceneId}; prompt Phase 3 vẫn được giữ nguyên.`,
      );
    } catch (caught) {
      setQueueCommandError(errorMessage(caught));
    } finally {
      setClearingSceneId("");
    }
  };

  const generate = async (handoff?: IntegratedWorkflowHandoff) => {
    const sourceInput = handoff?.workflowSource || workflowSource;
    const bibleInput = handoff?.visualBible || visualBible;
    const referenceInput = handoff ? handoff.styleReference : styleReference;
    const modeInput = handoff?.workflowMode || workflowMode;
    const automaticInput = modeInput === "automatic";
    const targetProjectId = handoff?.sessionId || activeProjectId;
    const hasDeferredVoice = Boolean(sourceInput.narrationText?.trim() && sourceInput.voiceName?.trim());
    setError("");
    setWorkflowNotice("");
    if (!bibleInput.style.trim()) {
      setError("Phong cách đồ họa trong Visual Bible là bắt buộc. Hãy nhập hoặc chọn một phong cách đã lưu.");
      return;
    }
    if (automaticInput) {
      if (!sourceInput.narrationText?.trim()) { setError("Chế độ Tự động hoàn toàn chưa nhận được nội dung thoại từ Voice Studio."); return; }
      if (!sourceInput.voiceName?.trim()) { setError("Chế độ Tự động hoàn toàn chưa nhận được giọng đọc từ Voice Studio."); return; }
    } else {
      if (!handoff && srtFile && !validateFile(srtFile, "File phụ đề", [".srt"])) return;
      if (!handoff && scriptFile && !validateFile(scriptFile, "File kịch bản", [".txt", ".md"])) return;
      if (!srtFile && !sourceInput.srtText.trim()) { setError("Hãy chọn file phụ đề SRT."); return; }
      if (!scriptFile && !sourceInput.scriptText.trim()) { setError("Hãy chọn file kịch bản."); return; }
    }
    if (!chatConnected) {
      setError("ChatGPT worker chưa kết nối");
      return;
    }
    if (!window.flowx?.timeline) {
      setError("Timeline bridge chưa sẵn sàng");
      return;
    }

    setRunning(true);
    setProgress(null);
    try {
      let preparedSource = sourceInput;
      if (!srtFile && !sourceInput.srtText.trim() && hasDeferredVoice) {
        const voice = window.flowx?.voice;
        if (!voice || !sourceInput.narrationText?.trim() || !sourceInput.voiceName?.trim()) {
          throw new Error("Cấu hình Voice chưa đầy đủ để bắt đầu workflow");
        }
        setWorkflowNotice("Bước 1/3 · Đang tạo Voice và SRT từ cấu hình đã lưu…");
        const generatedVoice = await voice.generate({
          projectId: targetProjectId,
          projectName: sessionNameDraft,
          narrationText: sourceInput.narrationText,
          narrationFileName: sourceInput.narrationFileName || "loi-thoai.txt",
          voice: sourceInput.voiceName,
          prosody: {
            rate: sourceInput.voiceRate ?? 0,
            pitch: sourceInput.voicePitch ?? 0,
            volume: sourceInput.voiceVolume ?? 0,
            pauseLevel: sourceInput.voicePauseLevel || "medium",
          },
          splitMode: sourceInput.voiceSplitMode || "paragraph",
          maxCharsPerChunk: sourceInput.voiceMaxCharsPerChunk || 3000,
          exportWordSrt: Boolean(sourceInput.voiceExportWordSrt),
        });
        preparedSource = {
          ...sourceInput,
          srtText: generatedVoice.srtText,
          srtFileName: generatedVoice.srtFileName,
          srtPath: generatedVoice.srtPath,
          audioPath: generatedVoice.audioPath,
          audioFileName: generatedVoice.audioFileName,
          scriptText: sourceInput.scriptText.trim() || sourceInput.narrationText.trim(),
          scriptFileName: sourceInput.scriptFileName || sourceInput.narrationFileName || "loi-thoai.txt",
        };
        setWorkflowSource(preparedSource);
        await window.flowx.timeline.saveSession({
          scenes,
          visualBible: bibleInput,
          styleReference: referenceInput,
          workflowMode: modeInput,
          workflowSource: preparedSource,
        });
        setWorkflowNotice("Bước 2/3 · Voice và SRT đã hoàn thành. Đang chia Timeline và viết Prompt…");
      }
      const [srtText, scriptText, availableCharacters] = await Promise.all([
        !automaticInput && !handoff && srtFile ? srtFile.text() : Promise.resolve(preparedSource.srtText),
        !automaticInput && !handoff && scriptFile ? scriptFile.text() : Promise.resolve(preparedSource.scriptText),
        window.flowx?.characters.list() || Promise.resolve(characters),
      ]);
      const nextWorkflowSource: TimelineWorkflowSource = {
        ...preparedSource,
        srtText,
        scriptText,
        srtFileName: (!automaticInput && !handoff ? srtFile?.name : "") || preparedSource.srtFileName || "timeline.srt",
        scriptFileName: (!automaticInput && !handoff ? scriptFile?.name : "") || preparedSource.scriptFileName || "kich-ban.txt",
      };
      setWorkflowSource(nextWorkflowSource);
      setCharacters(availableCharacters);
      const characterRoster = recurringCharacterRoster(
        scriptText,
        availableCharacters.filter((character) => character.isRecurring !== false || character.isMain),
        2,
      );
      const result = await window.flowx.timeline.generate({
        srtText,
        scriptText,
        visualBible: bibleInput,
        characterRoster,
        styleReference: referenceInput,
      });
      const preparedScenes: Scene[] = result.scenes.map((scene) => {
        const detectedTokens = matchCharacterNames(
          `${scene.imagePrompt}\n${scene.videoPrompt}`,
          characterRoster,
        );
        const tokens = [...new Set([...scene.usedCharacterTokens, ...detectedTokens])].slice(0, 4);
        return {
          ...scene,
          usedCharacterTokens: tokens,
          characterPolicy: tokens.length > 0 ? "selected" : "none",
          assignedCharacterTokens: tokens,
        };
      });
      setScenes(preparedScenes);
      setVisualBible(result.visualBible);
      setStyleReference(referenceInput);
      setWorkflowMode(modeInput);
      setProgress(null);
      const saved = await window.flowx.timeline.saveSession({
        scenes: preparedScenes,
        visualBible: result.visualBible,
        styleReference: referenceInput,
        workflowMode: modeInput,
        workflowSource: nextWorkflowSource,
      });
      setSessions((current) => current.map((entry) => entry.id === saved.id
        ? {
          ...entry,
          name: saved.name,
          sceneCount: saved.scenes.length,
          savedAt: saved.savedAt,
          active: true,
          workflowMode: saved.workflowMode,
        }
        : { ...entry, active: false }));
      onWorkflowReady?.();

      if (modeInput === "automatic") {
        const queue = window.flowx?.productionQueue;
        if (!queue) throw new Error("Production queue chưa sẵn sàng");
        const policyFlaggedScenes = preparedScenes.filter((scene) => scene.policyFlag);
        if (policyFlaggedScenes.length > 0) {
          setWorkflowNotice(
            `Timeline và prompt đã được lưu. Có ${policyFlaggedScenes.length} scene cần kiểm tra chính sách trước khi bắt đầu sản xuất.`,
          );
          return;
        }
        try {
          await queue.setApprovalPolicy(true, true, targetProjectId);
          const snapshot = await queue.generateAllImages(targetProjectId);
          setQueueSnapshot(snapshot);
          setScenes((current) => applyQueueSnapshotToScenes(current, snapshot));
          setWorkflowNotice("Đã tạo timeline. App đang tự động chuyển sang sản xuất ảnh và video.");
        } catch (queueError) {
          setQueueCommandError(errorMessage(queueError));
          setWorkflowNotice(flowConnected
            ? "Timeline và prompt đã được lưu. Hàng đợi tự động chưa khởi động; có thể tiếp tục từ Production Queue."
            : "Voice, SRT, Timeline và prompt đã được lưu. Hãy mở Google Flow để extension kết nối, sau đó tiếp tục Production Queue.");
        }
      } else {
        setWorkflowNotice("Timeline và prompt đã hoàn tất. Hãy kiểm tra rồi chạy tạo ảnh và video.");
      }
    } catch (caught) {
      const message = errorMessage(caught);
      if (!/STOPPED|generation stopped|đã dừng/i.test(message)) {
        setError(message);
      }
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (
      !sessionReady ||
      !integratedHandoff ||
      consumedHandoffIds.current.has(integratedHandoff.id)
    ) return;
    consumedHandoffIds.current.add(integratedHandoff.id);
    let active = true;
    const apply = async () => {
      try {
        const timeline = window.flowx?.timeline;
        if (!timeline) throw new Error("Timeline bridge chưa sẵn sàng");
        const session = activeSessionIdRef.current === integratedHandoff.sessionId
          ? await timeline.loadSession()
          : await timeline.selectSession(integratedHandoff.sessionId);
        if (!session) throw new Error("Không tìm thấy phiên vừa tạo voice.");
        if (!active) return;
        applySession(session);
        setSessions(await timeline.listSessions());
        onIntegratedHandoffConsumed?.();
        if (integratedHandoff.autoGenerateTimeline) {
          await generate({
            ...integratedHandoff,
            workflowMode: session.workflowMode,
            workflowSource: session.workflowSource,
            visualBible: session.visualBible,
            styleReference: session.styleReference,
          });
        } else {
          setWorkflowNotice("Voice và SRT đã được đưa vào dự án. Kiểm tra đầu vào rồi bấm Tạo timeline & prompt.");
        }
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      }
    };
    void apply();
    return () => { active = false; };
  }, [sessionReady, integratedHandoff]);

  const cancel = async () => {
    try {
      await window.flowx?.timeline.cancel();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const canLeaveActiveSession = () => {
    const queueBusy = Boolean(
      queueSnapshot?.activeJobId || queueSnapshot?.state === "running" || queueSnapshot?.state === "paused",
    );
    if (!running && !queueBusy) return true;
    setError("Phiên hiện tại chưa dừng. Hãy bấm “Dừng” hoặc “Dừng hàng đợi” trước khi chuyển, tạo hay xóa phiên.");
    return false;
  };

  const switchSession = async (id: string) => {
    const timeline = window.flowx?.timeline;
    if (!timeline || id === activeSessionId || switchingSession || clearingGeneratedMedia || Boolean(clearingSceneId)) return;
    if (!canLeaveActiveSession()) return;
    setSwitchingSession(true);
    setSessionReady(false);
    setError("");
    try {
      await timeline.saveSession({
        scenes,
        visualBible,
        styleReference,
        workflowMode,
        workflowSource,
      });
      const selected = await timeline.selectSession(id);
      applySession(selected);
      setSessions(await timeline.listSessions());
      const snapshot = await window.flowx?.productionQueue.getSnapshot(selected.id);
      if (snapshot) setQueueSnapshot(snapshot);
      setSessionStatus("saved");
    } catch (caught) {
      setError(errorMessage(caught));
      setSessionStatus("error");
    } finally {
      setSessionReady(true);
      setSwitchingSession(false);
    }
  };

  const createSession = async () => {
    const timeline = window.flowx?.timeline;
    if (!timeline || switchingSession || clearingGeneratedMedia || Boolean(clearingSceneId)) return;
    if (!canLeaveActiveSession()) return;
    setSwitchingSession(true);
    setSessionReady(false);
    try {
      await timeline.saveSession({
        scenes,
        visualBible,
        styleReference,
        workflowMode,
        workflowSource,
      });
      const created = await timeline.createSession(`Phiên ${sessions.length + 1}`);
      applySession(created);
      setSessions(await timeline.listSessions());
      const snapshot = await window.flowx?.productionQueue.getSnapshot(created.id);
      if (snapshot) setQueueSnapshot(snapshot);
      setSessionStatus("saved");
    } catch (caught) {
      setError(errorMessage(caught));
      setSessionStatus("error");
    } finally {
      setSessionReady(true);
      setSwitchingSession(false);
    }
  };

  const renameActiveSession = async () => {
    const timeline = window.flowx?.timeline;
    const name = sessionNameDraft.trim();
    if (!timeline || !name || switchingSession || clearingGeneratedMedia || Boolean(clearingSceneId)) return;
    try {
      setSessions(await timeline.renameSession(activeSessionId, name));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const deleteActiveSession = async () => {
    const timeline = window.flowx?.timeline;
    if (!timeline || switchingSession || clearingGeneratedMedia || Boolean(clearingSceneId)) return;
    if (!canLeaveActiveSession()) return;
    setSwitchingSession(true);
    setSessionReady(false);
    try {
      const deleted = await timeline.deleteSession(activeSessionId);
      const next = deleted.activeSession || await timeline.createSession("Phiên 1");
      applySession(next);
      setSessions(await timeline.listSessions());
      const snapshot = await window.flowx?.productionQueue.getSnapshot(next.id);
      if (snapshot) setQueueSnapshot(snapshot);
      setResetConfirmOpen(false);
      setSessionStatus("saved");
    } catch (caught) {
      setError(errorMessage(caught));
      setSessionStatus("error");
    } finally {
      setSessionReady(true);
      setSwitchingSession(false);
    }
  };

  const saveStylePreset = (name: string) => {
    setStylePresetError("");
    void window.flowx?.visualStyles.save({ name, style: visualBible.style }).then(
      setStylePresets,
      (caught) => setStylePresetError(errorMessage(caught)),
    );
  };

  const deleteStylePreset = (id: string) => {
    setStylePresetError("");
    void window.flowx?.visualStyles.remove(id).then(
      setStylePresets,
      (caught) => setStylePresetError(errorMessage(caught)),
    );
  };

  const hasDeferredVoice = Boolean(workflowSource.narrationText?.trim() && workflowSource.voiceName?.trim());
  const automaticMode = workflowMode === "automatic";
  const hasSrtInput = Boolean(srtFile || workflowSource.srtText.trim() || hasDeferredVoice);
  const hasScriptInput = Boolean(scriptFile || workflowSource.scriptText.trim() || workflowSource.narrationText?.trim());
  const startInputBlockers = (automaticMode ? [
    !workflowSource.narrationText?.trim() ? "nội dung thoại từ Voice Studio" : "",
    !workflowSource.voiceName?.trim() ? "giọng đọc" : "",
    !visualBible.style.trim() ? "phong cách Visual Bible" : "",
  ] : [
    !hasSrtInput ? "file SRT" : "",
    !hasScriptInput ? "kịch bản" : "",
    !visualBible.style.trim() ? "phong cách Visual Bible" : "",
  ]).filter(Boolean);
  const startConnectionWarnings = [
    !chatConnected ? "ChatGPT chưa kết nối" : "",
    workflowMode === "automatic" && !flowConnected ? "Google Flow chưa kết nối; ảnh/video sẽ chờ trong Production Queue" : "",
  ].filter(Boolean);
  const completedVideoCount = scenes.filter((scene) => scene.videoStatus === "done").length;
  const productionStarted = Boolean(
    queueSnapshot?.activeJobId ||
    queueSnapshot?.queuedJobs ||
    scenes.some((scene) => scene.imageStatus !== "pending" || scene.videoStatus !== "pending"),
  );
  const workflowBusy = running || queueSnapshot?.state === "running";
  const sessionChangeLocked = Boolean(
    running || queueSnapshot?.activeJobId || queueSnapshot?.state === "running" || queueSnapshot?.state === "paused",
  );
  const workflowDashboardActions: WorkflowDashboardActions = {
    onStart: startAutomaticImageVideoPipeline,
    onGenerateImages: () => {
      const bridge = window.flowx?.productionQueue;
      if (bridge) void runQueueCommand(() => bridge.generateAllImages(activeProjectId));
    },
    onGenerateVideos: () => {
      const bridge = window.flowx?.productionQueue;
      if (bridge) void runQueueCommand(() => bridge.generateAllVideos(activeProjectId, { onlyApprovedImages: true }));
    },
    onPause: () => {
      const bridge = window.flowx?.productionQueue;
      if (bridge) void runQueueCommand(() => bridge.pauseQueue(), false);
    },
    onResume: () => {
      const bridge = window.flowx?.productionQueue;
      if (bridge) void runQueueCommand(() => bridge.resumeQueue(), false);
    },
    onStop: () => {
      const bridge = window.flowx?.productionQueue;
      if (bridge) void runQueueCommand(() => bridge.stopQueue(), false);
    },
    onRetryErrors: () => {
      const bridge = window.flowx?.productionQueue;
      const sceneIds = [...new Set(queueSnapshot?.errors.map((item) => item.sceneId) || [])];
      if (bridge && sceneIds.length) void runQueueCommand(() => bridge.retryFailed(sceneIds, activeProjectId));
    },
    onClearResults: () => setClearMediaConfirmOpen(true),
    onBuildVideo: onBuildVideo || (() => undefined),
    onRefresh: () => void refreshQueueSnapshot(),
    onAutoApproveChange: (enabled) => {
      const bridge = window.flowx?.productionQueue;
      if (bridge) void runQueueCommand(() => bridge.setApprovalPolicy(enabled, queueSnapshot?.autoApproveVideos || false, activeProjectId), false);
    },
    onSelect: selectScene,
    onPromptChange: updatePrompt,
    onSave: () => void saveCurrentSession(),
    onRun: (sceneId, mediaType, prompt) => {
      const selectedScene = scenes.find((entry) => entry.id === sceneId);
      if (mediaType === "video" && selectedScene?.chainRole === "continue") {
        resumeQueueFromScene(sceneId, "video");
        return;
      }
      runOrRegenerateScene(sceneId, mediaType, prompt);
    },
    onRegenerate: regenerateQueuedScene,
    onApprove: approveQueuedScene,
    onReject: (sceneId, mediaType, reason) => {
      setWorkflowNotice(`Đã ghi nhận lý do từ chối Scene ${scenes.find((entry) => entry.id === sceneId)?.order || sceneId}: ${reason}`);
      rejectQueuedScene(sceneId, mediaType);
    },
    onRepairPolicy: openPolicyRepairModal,
    onResumeFrom: resumeQueueFromScene,
    onClear: setClearSceneMediaTarget,
    onOpenFolder: () => void window.flowx?.system.openOutput(activeProjectId),
  };

  return (
    <section className="timeline-import" ref={timelineRootRef}>
      <header className="section-header">
        <div>
          <p className="eyebrow">Dựng video</p>
          <h2>{hasDeferredVoice ? "Kiểm tra thiết lập → bắt đầu toàn bộ quy trình" : "SRT + kịch bản → timeline và prompt"}</h2>
        </div>
        <div className="timeline-readiness">
          <div className={`chat-readiness ${chatConnected ? "is-ready" : ""}`}>
            <span aria-hidden="true" />
            {chatConnected ? "ChatGPT đã kết nối" : "ChatGPT chưa kết nối"}
          </div>
          <div className={`chat-readiness ${flowConnected ? "is-ready" : ""}`}>
            <span aria-hidden="true" />
            {flowConnected ? "Flow đã kết nối" : "Flow chưa kết nối"}
          </div>
        </div>
      </header>

      {scenes.length === 0 && (
        <nav className="kc-start-stepper" aria-label="Tiến trình thiết lập workflow">
          <div className="kc-start-step is-done"><span><Check size={14} /></span><div><strong>01 Nội dung & giọng đọc</strong><small>Đã hoàn thành</small></div><i /></div>
          <div className="kc-start-step is-done"><span><Check size={14} /></span><div><strong>02 Nhân vật</strong><small>{characters.length ? "Đã hoàn thành" : "Không sử dụng"}</small></div><i /></div>
          <div className="kc-start-step is-done"><span><Check size={14} /></span><div><strong>03 Visual Bible</strong><small>Đã hoàn thành</small></div><i /></div>
          <div className="kc-start-step is-active"><span>04</span><div><strong>Bắt đầu workflow</strong><small>Kiểm tra và bắt đầu</small></div></div>
        </nav>
      )}

      <section className="workspace-session-bar" aria-label="Quản lý phiên làm việc">
        <label className="field workspace-session-select">
          <span>Phiên đang mở</span>
          <select
            value={activeSessionId}
            disabled={switchingSession || sessionChangeLocked || clearingGeneratedMedia || Boolean(clearingSceneId)}
            onChange={(event) => void switchSession(event.target.value)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name} · {session.sceneCount} scene
              </option>
            ))}
          </select>
        </label>
        <label className="field workspace-session-name">
          <span>Tên phiên</span>
          <input
            value={sessionNameDraft}
            maxLength={100}
            disabled={switchingSession || clearingGeneratedMedia || Boolean(clearingSceneId)}
            onChange={(event) => setSessionNameDraft(event.target.value)}
            onBlur={() => void renameActiveSession()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void renameActiveSession();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <div className="workspace-session-actions">
          <button className="button secondary compact" type="button" disabled={switchingSession || sessionChangeLocked || clearingGeneratedMedia || Boolean(clearingSceneId)} onClick={() => void createSession()}>
            <FolderPlus size={15} /> Phiên mới
          </button>
          <button className="icon-button" type="button" title={sessionChangeLocked ? "Hãy dừng phiên trước khi xóa" : "Xóa phiên đang mở"} disabled={switchingSession || sessionChangeLocked || clearingGeneratedMedia || Boolean(clearingSceneId)} onClick={() => setResetConfirmOpen(true)}>
            <Trash2 size={16} />
          </button>
        </div>
        {sessionChangeLocked && (
          <div className="workspace-session-lock" role="status">
            <ShieldCheck size={14} /> Phiên đang được khóa để tránh chuyển nhầm khi workflow chưa dừng.
          </div>
        )}
      </section>

      {running && scenes.length === 0 && (
        <section className="workflow-preparing-dashboard" aria-live="polite" aria-label="Đang chuẩn bị quản lý scene">
          <header>
            <div><LoaderCircle className="spin" size={21} /><div><p className="eyebrow">ĐANG TẠO DỮ LIỆU SCENE</p><h3>Đang chuẩn bị giao diện quản lý scene</h3></div></div>
            <div className="workflow-preparing-status"><span>{progress?.message || workflowNotice || "ChatGPT đang chia timeline và viết prompt…"}</span><button className="button danger compact" type="button" onClick={() => void cancel()}><Square size={13} /> Dừng</button></div>
          </header>
          <div className="workflow-preparing-steps">
            <article className="is-done"><Check size={15} /><div><strong>Voice, SRT và dữ liệu đầu vào</strong><small>Đã khóa và sẵn sàng</small></div></article>
            <i />
            <article className="is-active"><LoaderCircle className="spin" size={15} /><div><strong>Timeline và Prompt</strong><small>Đang phân tích nội dung</small></div></article>
            <i />
            <article><Clapperboard size={15} /><div><strong>Quản lý scene</strong><small>Sẽ tự mở ngay khi có kết quả</small></div></article>
          </div>
          <div className="workflow-preparing-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>
          <p>Không cần nhập lại dữ liệu. Bạn có thể theo dõi tiến trình tại đây; danh sách scene sẽ thay thế màn hình này ngay khi Phase 3 hoàn tất.</p>
        </section>
      )}

      {scenes.length > 0 && (
        <WorkflowDashboard sessionName={sessionNameDraft} scenes={scenes} snapshot={queueSnapshot} thumbnails={thumbnails} characters={characters} selectedSceneId={selectedSceneId} flowConnected={flowConnected} busy={workflowBusy || clearingGeneratedMedia || Boolean(clearingSceneId)} actions={workflowDashboardActions} />
      )}

      <section className="video-workflow-panel is-locked-mode" aria-label="Quy trình của phiên">
        <div className="video-workflow-heading">
          <div>
            <p className="eyebrow">Quy trình đã chọn</p>
            <strong>{workflowMode === "automatic" ? "Tự động hoàn toàn" : hasDeferredVoice ? "Tạo từng bước" : "Từ SRT và kịch bản"} · {sessionNameDraft}</strong>
          </div>
          <span className="workflow-save-hint">Chế độ được khóa từ lúc tạo phiên để tránh thay đổi nhầm</span>
        </div>
        <div className="workflow-step-strip" aria-label="Tiến trình dựng video">
          <div className={scenes.length > 0 ? "is-complete" : running ? "is-active" : "is-active"}>
            <span>1</span>
            <p><strong>{hasDeferredVoice ? "Voice & SRT" : "Nguồn SRT"}</strong><small>{hasDeferredVoice ? "Tạo audio và SRT từ cấu hình Voice Studio" : "Dùng file SRT và kịch bản đã chọn"}</small></p>
          </div>
          <i aria-hidden="true" />
          <div className={scenes.length > 0 ? "is-complete" : running ? "is-active" : ""}>
            <span>2</span>
            <p><strong>Timeline & prompt</strong><small>ChatGPT chia scene và viết prompt nội dung</small></p>
          </div>
          <i aria-hidden="true" />
          <div className={completedVideoCount === scenes.length && scenes.length > 0
            ? "is-complete"
            : productionStarted
              ? "is-active"
              : ""}>
            <span>3</span>
            <p><strong>Sản xuất video</strong><small>Google Flow tạo ảnh, frame nối tiếp và video</small></p>
          </div>
        </div>
      </section>

      {automaticMode ? (
        <section className="workflow-source-review" aria-label="Thiết lập sẵn sàng để bắt đầu">
          <header><div><p className="eyebrow">Kiểm tra trước khi chạy</p><h3>{startInputBlockers.length ? "Cần hoàn tất dữ liệu từ các bước trước" : "Đã nhận đủ dữ liệu từ các bước trước"}</h3></div><span className={startInputBlockers.length ? "is-blocked" : ""}>{startInputBlockers.length ? <CircleAlert size={14} /> : <Check size={14} />} {startInputBlockers.length ? "Thiếu dữ liệu" : "Sẵn sàng"}</span></header>
          <div>
            <article><FileText size={17} /><p><strong>Nội dung thoại</strong><span>{workflowSource.narrationText?.trim() ? workflowSource.narrationFileName || `${workflowSource.narrationText.trim().length.toLocaleString("vi-VN")} ký tự đã nhập` : "Chưa nhận dữ liệu từ Voice Studio"}</span></p></article>
            <article><Play size={17} /><p><strong>Giọng đọc</strong><span>{workflowSource.voiceName || "Chưa chọn giọng đọc"}</span></p></article>
            <article><ShieldCheck size={17} /><p><strong>Nhân vật</strong><span>{characters.length > 0 ? `${characters.length} nhân vật trong thư viện` : "Không sử dụng nhân vật"}</span></p></article>
            <article><Sparkles size={17} /><p><strong>Phong cách đồ họa</strong><span>{visualBible.style.trim() ? "Đã khóa trong Visual Bible" : "Chưa thiết lập"}</span></p></article>
          </div>
          <small>Chế độ Tự động hoàn toàn không yêu cầu tải SRT hoặc kịch bản tại bước này. Khi bấm Bắt đầu, app tạo Voice + SRT, dùng nội dung thoại làm nguồn phân tích hình ảnh nếu chưa có kịch bản riêng, sau đó chia timeline và chạy Google Flow.</small>
        </section>
      ) : (
        <section className="manual-timeline-source" aria-label="Nguồn SRT và kịch bản">
          <header><p className="eyebrow">Nguồn đầu vào</p><h3>Chọn SRT và kịch bản cho chế độ không dùng Voice Studio</h3></header>
          <div className="timeline-file-grid">
            <FilePicker
              id="timeline-srt-file"
              label="Phụ đề SRT"
              accept=".srt,application/x-subrip,text/plain"
              file={srtFile}
              savedName={workflowSource.srtFileName}
              onChange={setSrtFile}
            />
            <FilePicker
              id="timeline-script-file"
              label="Kịch bản"
              accept=".txt,.md,text/plain,text/markdown"
              file={scriptFile}
              savedName={workflowSource.scriptFileName}
              onChange={setScriptFile}
            />
          </div>
          <VisualBiblePanel
            value={visualBible}
            onChange={setVisualBible}
            presets={stylePresets}
            presetError={stylePresetError}
            onSavePreset={saveStylePreset}
            onDeletePreset={deleteStylePreset}
            styleReference={styleReference}
            onStyleReferenceChange={setStyleReference}
          />
        </section>
      )}

      <div className="timeline-command-bar">
        <div className="timeline-progress" aria-live="polite">
          {running ? (
            <>
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
              <span>{progress?.message || "Đang khởi tạo timeline"}</span>
            </>
          ) : scenes.length > 0 ? (
            <span>
              {scenes.length} scene · {sessionStatus === "saving"
                ? "Đang lưu phiên"
                : sessionStatus === "error"
                  ? "Lỗi lưu phiên"
                  : "Đã lưu phiên"}
            </span>
          ) : (
            <span>Video 10–15 phút · 16:9 · scene 8 giây</span>
          )}
        </div>
        <div className="timeline-actions">
          <button className="button secondary" type="button" disabled={running || !onBack} onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Quay lại Visual Bible
          </button>
          <button className="button secondary" type="button" disabled={running || sessionStatus === "saving"} onClick={() => void saveCurrentSession()}>
            <Save size={14} aria-hidden="true" />
            {sessionStatus === "saving" ? "Đang lưu" : "Lưu bản nháp"}
          </button>
          {(startInputBlockers.length > 0 || startConnectionWarnings.length > 0) && (
            <small className={startInputBlockers.length > 0 ? "kc-start-check is-blocked" : "kc-start-check is-warning"}>
              {startInputBlockers.length > 0
                ? `Còn thiếu: ${startInputBlockers.join(", ")}`
                : startConnectionWarnings.join(" · ")}
            </small>
          )}
          {running ? (
            <button className="button secondary" type="button" onClick={cancel}>
              <Square size={14} aria-hidden="true" />
              Dừng
            </button>
          ) : (
            <button
              className="button primary"
              type="button"
              disabled={
                startInputBlockers.length > 0
              }
              onClick={() => void generate()}
            >
              <Sparkles size={16} aria-hidden="true" />
              {workflowMode === "automatic" ? "Bắt đầu toàn bộ quy trình" : "Bắt đầu tạo Timeline & Prompt"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {scenes.length > 0 && (
        <section className="production-queue-bar" aria-label="Hàng đợi sản xuất">
          <div className="production-queue-summary">
            <span className={`queue-state is-${queueSnapshot?.state || "idle"}`}>
              {queueSnapshot?.state === "running"
                ? <><LoaderCircle className="spin" size={14} /> Đang chạy</>
                : queueSnapshot?.state === "paused"
                  ? <><Pause size={14} /> Đã tạm dừng</>
                  : queueSnapshot?.state === "stopped"
                    ? <><Square size={13} /> Đã dừng</>
                    : <><Check size={14} /> Sẵn sàng</>}
            </span>
            <span>{queueSnapshot?.queuedJobs || 0} job chờ tiếp theo</span>
            {queueSnapshot?.activeSceneId && (
              <span>Đang xử lý {queueSnapshot.activeSceneId} · {queueSnapshot.activeMediaType === "image" ? "ảnh" : "video"}</span>
            )}
          </div>
          <div className="production-queue-actions">
            <label className="queue-policy-toggle">
              <input
                type="checkbox"
                checked={queueSnapshot?.autoApproveImages || false}
                onChange={(event) => {
                  const bridge = window.flowx?.productionQueue;
                  if (!bridge) return;
                  void runQueueCommand(
                    () => bridge.setApprovalPolicy(
                      event.target.checked,
                      queueSnapshot?.autoApproveVideos || false,
                      activeProjectId,
                    ),
                    false,
                  );
                }}
              />
              Tự duyệt ảnh; ảnh xong tự xếp video
            </label>
            <button
              className="button primary compact"
              type="button"
              disabled={!flowConnected}
              title="Chạy lần lượt ảnh scene 1 → video scene 1 → ảnh scene 2 → video scene 2"
              onClick={startAutomaticImageVideoPipeline}
            >
              <Sparkles size={15} /> {workflowMode === "two_step" ? "Chạy tạo ảnh & video" : "Tiếp tục tự động"}
            </button>
            <button
              className="button secondary compact"
              type="button"
              disabled={!flowConnected}
              onClick={() => {
                const bridge = window.flowx?.productionQueue;
                if (bridge) void runQueueCommand(() => bridge.generateAllImages(activeProjectId));
              }}
            >
              <ImageIcon size={15} /> Tạo toàn bộ ảnh
            </button>
            <button
              className="button secondary compact"
              type="button"
              disabled={!flowConnected}
              onClick={() => {
                const bridge = window.flowx?.productionQueue;
                if (bridge) void runQueueCommand(() => bridge.generateAllVideos(activeProjectId, { onlyApprovedImages: true }));
              }}
            >
              <Play size={15} /> Tạo video đã duyệt
            </button>
            {completedVideoCount === scenes.length && scenes.length > 0 && (
              <button
                className="button primary compact is-build-ready"
                type="button"
                onClick={onBuildVideo}
              >
                <Clapperboard size={15} /> Dựng video hoàn chỉnh
              </button>
            )}
            <button
              className="button danger compact"
              type="button"
              disabled={clearingGeneratedMedia || Boolean(clearingSceneId)}
              title="Xóa ảnh, video và frame trên máy; giữ nguyên prompt Phase 3 và thư viện Google Flow"
              onClick={() => setClearMediaConfirmOpen(true)}
            >
              {clearingGeneratedMedia
                ? <LoaderCircle className="spin" size={15} />
                : <Trash2 size={15} />}
              Xóa kết quả
            </button>
            {queueSnapshot?.state === "running" ? (
              <button className="icon-button" type="button" title="Tạm dừng sau job hiện tại" onClick={() => {
                const bridge = window.flowx?.productionQueue;
                if (bridge) void runQueueCommand(() => bridge.pauseQueue(), false);
              }}><Pause size={16} /></button>
            ) : (queueSnapshot?.state === "paused" || queueSnapshot?.state === "stopped") ? (
              <button className="icon-button" type="button" title="Tiếp tục hàng đợi" onClick={() => {
                const bridge = window.flowx?.productionQueue;
                if (bridge) void runQueueCommand(() => bridge.resumeQueue(), false);
              }}><Play size={16} /></button>
            ) : null}
            {(queueSnapshot?.state === "running" || queueSnapshot?.state === "paused") && (
              <button className="icon-button danger-icon" type="button" title="Dừng hàng đợi" onClick={() => {
                const bridge = window.flowx?.productionQueue;
                if (bridge) void runQueueCommand(() => bridge.stopQueue(), false);
              }}><Square size={15} /></button>
            )}
          </div>
        </section>
      )}
      {queueCommandError && <div className="form-error">{queueCommandError}</div>}
      {workflowNotice && <div className="form-success">{workflowNotice}</div>}
      {clearMediaNotice && <div className="form-success">{clearMediaNotice}</div>}

      {(hasSrtInput || hasScriptInput || scenes.length > 0) && (
        <section className="workflow-output-panel" aria-label="Đầu vào và đầu ra của phiên">
          <header>
            <div>
              <p className="eyebrow">Hồ sơ dự án</p>
              <h3>Đầu vào và đầu ra được giữ theo phiên</h3>
            </div>
            <span>{completedVideoCount}/{scenes.length || 0} source video hoàn tất</span>
          </header>
          <div className="workflow-output-grid">
            <article>
              <FileText size={17} />
              <div><strong>SRT</strong><span>{srtFile?.name || workflowSource.srtFileName || (hasDeferredVoice ? "Sẽ tạo tự động khi bấm Bắt đầu" : "Chưa có")}</span></div>
            </article>
            <article>
              <FileText size={17} />
              <div><strong>Voice</strong><span>{workflowSource.audioFileName || (hasDeferredVoice ? `Đã liên kết Voice Studio · ${workflowSource.voiceName}` : "Phiên không sử dụng Voice Studio")}</span></div>
            </article>
            <article>
              <Play size={17} />
              <div><strong>Source ảnh & video</strong><span>{projectOutputFolder(activeProjectId, sessionNameDraft)}</span></div>
            </article>
          </div>
        </section>
      )}
      <ErrorCenter
        errors={queueSnapshot?.errors || []}
        onRetry={(sceneIds) => {
          const bridge = window.flowx?.productionQueue;
          if (bridge) void runQueueCommand(() => bridge.retryFailed(sceneIds, activeProjectId));
        }}
      />
      {scenes.length > 0 ? (
        <>
          <details className="workflow-batch-editor">
            <summary><PencilLine size={15} /> Bảng chỉnh prompt và planning hàng loạt</summary>
            <TimelineTable scenes={scenes} errors={sceneErrors} thumbnails={thumbnails} onPromptChange={updatePrompt} onPlanningChange={updatePlanning} onRun={runOrRegenerateScene} onRegenerate={regenerateQueuedScene} onResumeFrom={resumeQueueFromScene} onClearSceneMedia={setClearSceneMediaTarget} onApprove={approveQueuedScene} onReject={rejectQueuedScene} onRepairPolicy={openPolicyRepairModal} repairingPromptKey={repairingPromptKey} clearingSceneId={clearingSceneId} chatConnected={chatConnected} />
          </details>
        </>
      ) : (
        <p className="empty-state timeline-empty">Chưa có dữ liệu scene.</p>
      )}

      {policyRepairModal && (() => {
        const scene = scenes.find((entry) => entry.id === policyRepairModal.sceneId);
        const selectedOption = POLICY_REASON_OPTIONS.find((option) => option.value === policyReason);
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !repairingPromptKey) {
              setPolicyRepairModal(null);
            }
          }}>
            <section className="policy-repair-modal" role="dialog" aria-modal="true" aria-labelledby="policy-repair-title">
              <header>
                <div>
                  <p className="eyebrow">Google Flow safety</p>
                  <h3 id="policy-repair-title">
                    Sửa prompt {policyRepairModal.mediaType === "image" ? "ảnh" : "video"}
                    {scene ? ` · Scene ${scene.order}` : ""}
                  </h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="Đóng"
                  disabled={Boolean(repairingPromptKey)}
                  onClick={() => setPolicyRepairModal(null)}
                >
                  <X size={18} />
                </button>
              </header>

              {policyRepairModal.detectedError && (
                <div className="policy-detected-error" role="status">
                  <CircleAlert size={16} />
                  <div>
                    <strong>App đọc được từ Flow</strong>
                    <p>{policyRepairModal.detectedError}</p>
                  </div>
                </div>
              )}

              <div className="policy-reason-list" role="radiogroup" aria-label="Loại vi phạm chính sách">
                {POLICY_REASON_OPTIONS.map((option) => (
                  <label key={option.value} className={policyReason === option.value ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="policy-reason"
                      value={option.value}
                      checked={policyReason === option.value}
                      onChange={() => setPolicyReason(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>

              <label className="field policy-detail-field">
                <span>Thông báo hoặc lý do bổ sung</span>
                <textarea
                  value={policyDetail}
                  maxLength={2_000}
                  placeholder="Dán nguyên văn thông báo trên card render, hoặc mô tả chi tiết nào cần làm nhẹ đi…"
                  onChange={(event) => setPolicyDetail(event.target.value)}
                />
                <small>
                  ChatGPT chỉ làm mềm phần có nguy cơ vi phạm; vẫn phải giữ nguyên câu chuyện, nhân vật, bối cảnh và chuyển động.
                </small>
              </label>

              <footer>
                <div className="policy-selected-summary">
                  <ShieldCheck size={15} />
                  <span>{selectedOption?.label}</span>
                </div>
                <button
                  className="button secondary"
                  type="button"
                  disabled={Boolean(repairingPromptKey)}
                  onClick={() => setPolicyRepairModal(null)}
                >
                  Hủy
                </button>
                <button
                  className="button primary"
                  type="button"
                  disabled={!chatConnected || Boolean(repairingPromptKey)}
                  onClick={() => void repairPolicyPromptAndResume(
                    policyRepairModal.sceneId,
                    policyRepairModal.mediaType,
                    policyReason,
                    policyDetail,
                  )}
                >
                  {repairingPromptKey
                    ? <LoaderCircle className="spin" size={15} />
                    : <ShieldCheck size={15} />}
                  Sửa và chạy tiếp
                </button>
              </footer>
            </section>
          </div>
        );
      })()}

      {clearMediaConfirmOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !clearingGeneratedMedia) {
            setClearMediaConfirmOpen(false);
          }
        }}>
          <section className="session-reset-modal" role="alertdialog" aria-modal="true" aria-labelledby="clear-media-title">
            <header>
              <div>
                <p className="eyebrow">Xác nhận xóa kết quả</p>
                <h3 id="clear-media-title">Xóa toàn bộ kết quả đã tải về máy?</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                title="Đóng"
                disabled={clearingGeneratedMedia}
                onClick={() => setClearMediaConfirmOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              App sẽ dừng hàng đợi rồi xóa toàn bộ job, ảnh scene, video và frame trung gian trong thư mục KC Auto Tool trên máy. Thao tác này không thể hoàn tác. Timeline, prompt ảnh, prompt video, Visual Bible và gán nhân vật của Phase 3 được giữ nguyên.
            </p>
            <p>
              Lưu ý: nút này không xóa ảnh hoặc video đang nằm trong thư viện dự án Google Flow. Nội dung đó phải được xóa riêng trên Google Flow.
            </p>
            <footer>
              <button
                className="button secondary"
                type="button"
                disabled={clearingGeneratedMedia}
                onClick={() => setClearMediaConfirmOpen(false)}
              >
                Hủy
              </button>
              <button
                className="button danger"
                type="button"
                disabled={clearingGeneratedMedia}
                onClick={() => void clearAllGeneratedMedia()}
              >
                {clearingGeneratedMedia && <LoaderCircle className="spin" size={15} />}
                Xác nhận xóa kết quả
              </button>
            </footer>
          </section>
        </div>
      )}

      {clearSceneMediaTarget && (() => {
        const targetScene = scenes.find((scene) => scene.id === clearSceneMediaTarget);
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !clearingSceneId) {
              setClearSceneMediaTarget(null);
            }
          }}>
            <section className="session-reset-modal" role="alertdialog" aria-modal="true" aria-labelledby="clear-scene-media-title">
              <header>
                <div>
                  <p className="eyebrow">Xóa kết quả một scene</p>
                  <h3 id="clear-scene-media-title">
                    Xóa kết quả Scene {targetScene?.order || clearSceneMediaTarget}?
                  </h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="Đóng"
                  disabled={Boolean(clearingSceneId)}
                  onClick={() => setClearSceneMediaTarget(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <p>
                App sẽ dừng hàng đợi, xóa ảnh, video, frame trung gian và job của riêng scene này trên máy. Prompt ảnh, prompt video, gán nhân vật và timeline Phase 3 vẫn được giữ nguyên.
              </p>
              <p>Nội dung đã tạo trong thư viện Google Flow không bị xóa.</p>
              <footer>
                <button
                  className="button secondary"
                  type="button"
                  disabled={Boolean(clearingSceneId)}
                  onClick={() => setClearSceneMediaTarget(null)}
                >
                  Hủy
                </button>
                <button
                  className="button danger"
                  type="button"
                  disabled={Boolean(clearingSceneId)}
                  onClick={() => void clearOneSceneMedia()}
                >
                  {clearingSceneId && <LoaderCircle className="spin" size={15} />}
                  Xác nhận xóa scene này
                </button>
              </footer>
            </section>
          </div>
        );
      })()}

      {resetConfirmOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResetConfirmOpen(false);
        }}>
          <section className="session-reset-modal" role="alertdialog" aria-modal="true" aria-labelledby="session-reset-title">
            <header>
              <div>
                <p className="eyebrow">Xác nhận xóa phiên</p>
                <h3 id="session-reset-title">Xóa phiên “{sessionNameDraft}”?</h3>
              </div>
              <button className="icon-button" type="button" title="Đóng" onClick={() => setResetConfirmOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <p>Timeline, trạng thái scene, prompt, Visual Bible và ảnh phong cách mẫu của riêng phiên này sẽ bị xóa. Những phiên khác và các ảnh hoặc video đã tải xuống máy vẫn được giữ nguyên.</p>
            <footer>
              <button className="button secondary" type="button" onClick={() => setResetConfirmOpen(false)}>Giữ phiên</button>
              <button className="button danger" type="button" disabled={switchingSession} onClick={() => void deleteActiveSession()}>
                {switchingSession && <LoaderCircle className="spin" size={15} />}
                Xác nhận xóa phiên
              </button>
            </footer>
          </section>
        </div>
      )}

      {imageModal && (() => {
        const scene = scenes.find((entry) => entry.id === imageModal.sceneId);
        return scene ? (
          <ImageGenerationModal
            scene={scene}
            initialPrompt={imageModal.prompt}
            characters={characters}
            visualBible={visualBible}
            onClose={() => setImageModal(null)}
            onGenerate={confirmImageGeneration}
          />
        ) : null;
      })()}

      {videoModal && (() => {
        const scene = scenes.find((entry) => entry.id === videoModal.sceneId);
        return scene ? (
          <VideoGenerationModal
            scene={scene}
            initialPrompt={videoModal.prompt}
            thumbnail={thumbnails[scene.id]}
            visualBible={visualBible}
            onClose={() => setVideoModal(null)}
            onGenerate={confirmVideoGeneration}
          />
        ) : null;
      })()}
    </section>
  );
}
