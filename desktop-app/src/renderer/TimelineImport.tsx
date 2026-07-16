import {
  Check,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Save,
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
import type { SceneMediaType, SceneJobProgress } from "../shared/scene-job";
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
                  <textarea className="scene-prompt" aria-label={`Prompt ảnh scene ${scene.order}`} value={scene.imagePrompt} onChange={(event) => onPromptChange(scene.id, "image", event.target.value)} />
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
                  <textarea className="scene-prompt" aria-label={`Prompt video scene ${scene.order}`} value={scene.videoPrompt} onChange={(event) => onPromptChange(scene.id, "video", event.target.value)} />
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
  const sessionSaveVersion = useRef(0);
  const settledSceneJobs = useRef(new Set<string>());
  const loadedThumbnailPaths = useRef(new Set<string>());

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
        const stored = await bridge.loadSession();
        if (!active) return;
        if (stored?.scenes.length) {
          setScenes(stored.scenes);
          setVisualBible(stored.visualBible);
        } else {
          const legacyScenes = loadStoredScenes();
          if (legacyScenes.length > 0) {
            const migrated = await bridge.saveSession({
              scenes: legacyScenes,
              visualBible: structuredClone(DEFAULT_VISUAL_BIBLE),
            });
            if (!active) return;
            setScenes(migrated.scenes);
            setVisualBible(migrated.visualBible);
          }
        }
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
      if (settledSceneJobs.current.has(`${job.sceneId}:${job.mediaType}`)) return;
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
    void bridge.getSnapshot(DEFAULT_PROJECT_ID).then(applySnapshot, () => {});
    return bridge.onChanged(applySnapshot);
  }, []);

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
      const operation = scenes.length > 0
        ? bridge.saveSession({ scenes, visualBible })
        : bridge.clearSession();
      void operation.then(
        () => {
          localStorage.removeItem(TIMELINE_STORAGE_KEY);
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
  }, [scenes, visualBible, sessionReady, clearingGeneratedMedia]);

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
    setQueueCommandError("");
    try {
      if (flushSession && scenes.length > 0) {
        await window.flowx?.timeline.saveSession({ scenes, visualBible });
      }
      const snapshot = await operation();
      setQueueSnapshot(snapshot);
      setScenes((current) => applyQueueSnapshotToScenes(current, snapshot));
    } catch (caught) {
      setQueueCommandError(errorMessage(caught));
    }
  };

  const regenerateQueuedScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(() => bridge.regenerateScene(sceneId, mediaType, DEFAULT_PROJECT_ID));
  };

  const resumeQueueFromScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(() => bridge.resumeFrom(sceneId, mediaType, DEFAULT_PROJECT_ID));
  };

  const approveQueuedScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(
      () => bridge.approveScene(sceneId, mediaType, DEFAULT_PROJECT_ID),
      true,
    );
  };

  const rejectQueuedScene = (sceneId: string, mediaType: SceneMediaType) => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge) return;
    void runQueueCommand(
      () => bridge.rejectScene(sceneId, mediaType, DEFAULT_PROJECT_ID),
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
        DEFAULT_PROJECT_ID,
      );
      return bridge.generateAllImages(DEFAULT_PROJECT_ID);
    });
  };

  const clearAllGeneratedMedia = async () => {
    const bridge = window.flowx?.productionQueue;
    if (!bridge || clearingGeneratedMedia) return;
    setClearingGeneratedMedia(true);
    setQueueCommandError("");
    setClearMediaNotice("");
    try {
      await window.flowx?.timeline.saveSession({ scenes, visualBible });
      const result = await bridge.clearGeneratedMedia(DEFAULT_PROJECT_ID);
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

  const resetSession = () => {
    void window.flowx?.productionQueue.stopQueue();
    setSrtFile(null);
    setScriptFile(null);
    setScenes([]);
    setVisualBible(structuredClone(DEFAULT_VISUAL_BIBLE));
    setProgress(null);
    setError("");
    setSceneErrors({});
    setThumbnails({});
    setImageModal(null);
    setVideoModal(null);
    setResetConfirmOpen(false);
    loadedThumbnailPaths.current.clear();
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
          {scenes.length > 0 && !running && (
            <button className="icon-button" type="button" title="Xóa phiên làm việc" onClick={() => setResetConfirmOpen(true)}>
              <RotateCcw size={16} aria-hidden="true" />
            </button>
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
                      DEFAULT_PROJECT_ID,
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
                if (bridge) void runQueueCommand(() => bridge.generateAllImages(DEFAULT_PROJECT_ID));
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
                if (bridge) void runQueueCommand(() => bridge.generateAllVideos(DEFAULT_PROJECT_ID, { onlyApprovedImages: true }));
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
          if (bridge) void runQueueCommand(() => bridge.retryFailed(sceneIds, DEFAULT_PROJECT_ID));
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
          />
      ) : (
        <p className="empty-state timeline-empty">Chưa có dữ liệu scene.</p>
      )}

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
                <h3 id="session-reset-title">Xóa toàn bộ phiên làm việc hiện tại?</h3>
              </div>
              <button className="icon-button" type="button" title="Đóng" onClick={() => setResetConfirmOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <p>Timeline, trạng thái scene, prompt và Visual Bible trong app sẽ bị xóa. Các ảnh hoặc video đã tải xuống máy vẫn được giữ nguyên.</p>
            <footer>
              <button className="button secondary" type="button" onClick={() => setResetConfirmOpen(false)}>Giữ phiên</button>
              <button className="button danger" type="button" onClick={resetSession}>Xác nhận xóa phiên</button>
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
