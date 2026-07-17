import {
  Check,
  CircleAlert,
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
  type VisualBible,
} from "../shared/timeline";
import { ImageGenerationModal } from "./ImageGenerationModal";
import { VideoGenerationModal } from "./VideoGenerationModal";
import { VisualBiblePanel } from "./VisualBiblePanel";
import type { GraphicStylePreset } from "../shared/visual-style";
import {
  DEFAULT_PROJECT_ID,
  type ProductionQueueSnapshot,
  type QueueErrorView,
} from "../shared/production-queue";

interface TimelineImportProps {
  chatConnected: boolean;
  flowConnected: boolean;
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
  onChange,
}: {
  id: string;
  label: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.files?.[0] || null);
  };

  return (
    <div className={`timeline-file ${file ? "has-file" : ""}`}>
      <div className="timeline-file-icon" aria-hidden="true">
        <FileText size={20} />
      </div>
      <div className="timeline-file-details">
        <strong>{label}</strong>
        <span>{file ? `${file.name} · ${formatBytes(file.size)}` : "Chưa chọn file"}</span>
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
  onApprove,
  onReject,
  onRepairPolicy,
  repairingPromptKey,
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
  onApprove: (sceneId: string, mediaType: SceneMediaType) => void;
  onReject: (sceneId: string, mediaType: SceneMediaType) => void;
  onRepairPolicy: (sceneId: string, mediaType: SceneMediaType) => void;
  repairingPromptKey: string;
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
                      ? <img src={thumbnails[scene.id]} alt={`Kết quả scene ${scene.order}`} />
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

export function TimelineImport({ chatConnected, flowConnected }: TimelineImportProps) {
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [scriptFile, setScriptFile] = useState<File | null>(null);
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
  const [repairingPromptKey, setRepairingPromptKey] = useState("");
  const [policyRepairModal, setPolicyRepairModal] = useState<PolicyRepairModalState | null>(null);
  const [policyReason, setPolicyReason] = useState<PolicyReason>("auto");
  const [policyDetail, setPolicyDetail] = useState("");
  const sessionSaveVersion = useRef(0);
  const settledSceneJobs = useRef(new Set<string>());
  const sceneJobSessions = useRef(new Map<string, string>());
  const activeSessionIdRef = useRef(activeSessionId);
  const loadedThumbnailPaths = useRef(new Set<string>());
  const activeProjectId = activeSessionId || DEFAULT_PROJECT_ID;

  const applySession = (session: TimelineSession) => {
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    setSessionNameDraft(session.name);
    setScenes(session.scenes);
    setVisualBible(session.visualBible);
    setStyleReference(session.styleReference);
    setSrtFile(null);
    setScriptFile(null);
    setProgress(null);
    setError("");
    setSceneErrors({});
    setThumbnails({});
    setImageModal(null);
    setVideoModal(null);
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
    for (const scene of scenes) {
      const path = scene.imageResultPath;
      if (
        scene.imageStatus !== "done" ||
        !path ||
        path.startsWith("mock://") ||
        loadedThumbnailPaths.current.has(path)
      ) {
        continue;
      }
      loadedThumbnailPaths.current.add(path);
      void media.readImageDataUrl(path).then(
        (dataUrl) => setThumbnails((current) => ({ ...current, [scene.id]: dataUrl })),
        () => loadedThumbnailPaths.current.delete(path),
      );
    }
  }, [scenes]);

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
    if (!sessionReady || clearingGeneratedMedia) return undefined;
    const saveVersion = ++sessionSaveVersion.current;
    setSessionStatus("saving");
    const timer = window.setTimeout(() => {
      const bridge = window.flowx?.timeline;
      if (!bridge) return;
      const operation = bridge.saveSession({ scenes, visualBible, styleReference });
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
  }, [scenes, visualBible, styleReference, sessionReady, clearingGeneratedMedia]);

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
  ) => {
    const commandSessionId = activeSessionIdRef.current;
    setQueueCommandError("");
    try {
      if (flushSession && scenes.length > 0) {
        await window.flowx?.timeline.saveSession({ scenes, visualBible, styleReference });
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

  const regenerateQueuedScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(() => bridge.regenerateScene(sceneId, mediaType, activeProjectId));
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
      await timeline.saveSession({ scenes: nextScenes, visualBible, styleReference });
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
        queueSnapshot?.autoApproveVideos || false,
        activeProjectId,
      );
      return bridge.generateAllImages(activeProjectId);
    });
  };

  const clearAllGeneratedMedia = async () => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge || clearingGeneratedMedia) return;
    setClearingGeneratedMedia(true);
    setQueueCommandError("");
    setClearMediaNotice("");
    try {
      await window.flowx?.timeline.saveSession({ scenes, visualBible, styleReference });
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

  const generate = async () => {
    setError("");
    if (!validateFile(srtFile, "File phụ đề", [".srt"])) return;
    if (!validateFile(scriptFile, "File kịch bản", [".txt", ".md"])) return;
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
      const [srtText, scriptText, availableCharacters] = await Promise.all([
        srtFile.text(),
        scriptFile.text(),
        window.flowx?.characters.list() || Promise.resolve(characters),
      ]);
      setCharacters(availableCharacters);
      const characterRoster = recurringCharacterRoster(
        scriptText,
        availableCharacters,
        2,
      );
      const result = await window.flowx.timeline.generate({
        srtText,
        scriptText,
        visualBible,
        characterRoster,
        styleReference,
      });
      setScenes(result.scenes.map((scene) => {
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
      }));
      setVisualBible(result.visualBible);
      setProgress(null);
    } catch (caught) {
      const message = errorMessage(caught);
      if (!/STOPPED|generation stopped|đã dừng/i.test(message)) {
        setError(message);
      }
    } finally {
      setRunning(false);
    }
  };

  const cancel = async () => {
    try {
      await window.flowx?.timeline.cancel();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const stopProductionForSessionChange = async () => {
    await window.flowx?.sceneJobs.cancel().catch(() => false);
    const queue = window.flowx?.productionQueue;
    if (!queue) return;
    let snapshot = await queue.stopQueue();
    const deadline = Date.now() + 12_000;
    while (snapshot.activeJobId && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      snapshot = await queue.getSnapshot(snapshot.projectId || activeProjectId);
    }
    if (snapshot.activeJobId) {
      throw new Error("Công việc hiện tại chưa dừng xong. Hãy thử chuyển phiên lại sau vài giây.");
    }
  };

  const switchSession = async (id: string) => {
    const timeline = window.flowx?.timeline;
    if (!timeline || id === activeSessionId || switchingSession || clearingGeneratedMedia) return;
    setSwitchingSession(true);
    setSessionReady(false);
    setError("");
    try {
      if (running) await timeline.cancel();
      await stopProductionForSessionChange();
      await timeline.saveSession({ scenes, visualBible, styleReference });
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
    if (!timeline || switchingSession || clearingGeneratedMedia) return;
    setSwitchingSession(true);
    setSessionReady(false);
    try {
      if (running) await timeline.cancel();
      await stopProductionForSessionChange();
      await timeline.saveSession({ scenes, visualBible, styleReference });
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
    if (!timeline || !name || switchingSession || clearingGeneratedMedia) return;
    try {
      setSessions(await timeline.renameSession(activeSessionId, name));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const deleteActiveSession = async () => {
    const timeline = window.flowx?.timeline;
    if (!timeline || switchingSession || clearingGeneratedMedia) return;
    setSwitchingSession(true);
    setSessionReady(false);
    try {
      if (running) await timeline.cancel();
      await stopProductionForSessionChange();
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

  return (
    <section className="timeline-import">
      <header className="section-header">
        <div>
          <p className="eyebrow">ChatGPT worker</p>
          <h2>Nhập timeline</h2>
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

      <section className="workspace-session-bar" aria-label="Quản lý phiên làm việc">
        <label className="field workspace-session-select">
          <span>Phiên đang mở</span>
          <select
            value={activeSessionId}
            disabled={switchingSession || running || clearingGeneratedMedia}
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
            disabled={switchingSession || clearingGeneratedMedia}
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
          <button className="button secondary compact" type="button" disabled={switchingSession || running || clearingGeneratedMedia} onClick={() => void createSession()}>
            <FolderPlus size={15} /> Phiên mới
          </button>
          <button className="icon-button" type="button" title="Xóa phiên đang mở" disabled={switchingSession || running || clearingGeneratedMedia} onClick={() => setResetConfirmOpen(true)}>
            <Trash2 size={16} />
          </button>
        </div>
      </section>

      <div className="timeline-file-grid">
        <FilePicker
          id="timeline-srt-file"
          label="Phụ đề SRT"
          accept=".srt,application/x-subrip,text/plain"
          file={srtFile}
          onChange={setSrtFile}
        />
        <FilePicker
          id="timeline-script-file"
          label="Kịch bản"
          accept=".txt,.md,text/plain,text/markdown"
          file={scriptFile}
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
          {running ? (
            <button className="button secondary" type="button" onClick={cancel}>
              <Square size={14} aria-hidden="true" />
              Dừng
            </button>
          ) : (
            <button
              className="button primary"
              type="button"
              disabled={!chatConnected || !srtFile || !scriptFile}
              onClick={generate}
            >
              <Sparkles size={16} aria-hidden="true" />
              Tạo timeline
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
              <Sparkles size={15} /> Chạy tự động Ảnh → Video
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
            <button
              className="button danger compact"
              type="button"
              disabled={clearingGeneratedMedia}
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
      {clearMediaNotice && <div className="form-success">{clearMediaNotice}</div>}
      <ErrorCenter
        errors={queueSnapshot?.errors || []}
        onRetry={(sceneIds) => {
          const bridge = window.flowx?.productionQueue;
          if (bridge) void runQueueCommand(() => bridge.retryFailed(sceneIds, activeProjectId));
        }}
      />
      {scenes.length > 0 ? (
          <TimelineTable
            scenes={scenes}
            errors={sceneErrors}
            thumbnails={thumbnails}
            onPromptChange={updatePrompt}
            onPlanningChange={updatePlanning}
            onRun={requestSceneJob}
            onRegenerate={regenerateQueuedScene}
            onResumeFrom={resumeQueueFromScene}
            onApprove={approveQueuedScene}
            onReject={rejectQueuedScene}
            onRepairPolicy={openPolicyRepairModal}
            repairingPromptKey={repairingPromptKey}
            chatConnected={chatConnected}
          />
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
