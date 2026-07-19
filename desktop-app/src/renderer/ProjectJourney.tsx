import {
  AudioLines,
  BookOpenCheck,
  Check,
  CircleAlert,
  Clapperboard,
  FileOutput,
  Image as ImageIcon,
  ListTree,
  LoaderCircle,
} from "lucide-react";
import type { ProductionQueueSnapshot } from "../shared/production-queue";
import type { OutputInspection } from "../shared/system";
import type { TimelineSession } from "../shared/timeline";
import type { AppPage } from "./app-navigation";

type JourneyState = "done" | "running" | "error" | "ready" | "waiting";

interface JourneyStep {
  id: string;
  label: string;
  detail: string;
  page: AppPage;
  state: JourneyState;
  icon: typeof AudioLines;
}

function stateLabel(state: JourneyState): string {
  return {
    done: "Hoàn thành",
    running: "Đang xử lý",
    error: "Có lỗi",
    ready: "Sẵn sàng",
    waiting: "Đang chờ",
  }[state];
}

function stepState({
  done,
  running = false,
  error = false,
  ready = false,
}: {
  done: boolean;
  running?: boolean;
  error?: boolean;
  ready?: boolean;
}): JourneyState {
  if (error) return "error";
  if (running) return "running";
  if (done) return "done";
  return ready ? "ready" : "waiting";
}

export function ProjectJourney({
  session,
  queue,
  output,
  onNavigate,
}: {
  session: TimelineSession | null;
  queue: ProductionQueueSnapshot | null;
  output: OutputInspection | null;
  onNavigate: (page: AppPage) => void;
}) {
  const scenes = session?.scenes || [];
  const source = session?.workflowSource;
  const hasInput = Boolean(
    source?.narrationText?.trim() || source?.narrationFileName?.trim() ||
    source?.srtText?.trim() || source?.srtFileName?.trim() || source?.srtPath?.trim(),
  );
  const voiceReady = Boolean(source?.srtText?.trim() || source?.srtPath?.trim() || source?.srtFileName?.trim());
  const hasVisualBible = Boolean(session?.visualBible.style.trim());
  const promptScenes = scenes.filter((scene) =>
    Boolean(scene.videoPrompt.trim()) && (scene.chainRole === "continue" || Boolean(scene.imagePrompt.trim())),
  );
  const promptsReady = scenes.length > 0 && promptScenes.length === scenes.length;
  const imageScenes = scenes.filter((scene) => scene.chainRole !== "continue");
  const completedImages = imageScenes.filter((scene) => Boolean(scene.imageResultPath)).length;
  const imagesReady = imageScenes.length > 0 && completedImages === imageScenes.length;
  const completedVideos = scenes.filter((scene) => Boolean(scene.videoResultPath)).length;
  const videosReady = scenes.length > 0 && completedVideos === scenes.length;
  const videoOutputCount = output?.groups.find((group) => group.id === "videos")?.count || 0;
  const outputReady = videosReady && videoOutputCount >= scenes.length;
  const activeJob = queue?.jobs.find((job) => job.id === queue.activeJobId);
  const imageRunning = queue?.state === "running" && (
    queue.activeMediaType === "image" || queue.jobs.some((job) => job.mediaType === "image" && job.status === "queued")
  );
  const videoRunning = queue?.state === "running" && (
    queue.activeMediaType === "video" || activeJob?.jobType === "extract_last_frame" ||
    queue.jobs.some((job) => job.mediaType === "video" && job.status === "queued")
  );
  const imageErrors = queue?.errors.filter((error) => error.mediaType === "image").length || 0;
  const videoErrors = queue?.errors.filter((error) => error.mediaType === "video").length || 0;

  const steps: JourneyStep[] = [
    {
      id: "voice",
      label: "Voice & SRT",
      detail: voiceReady ? source?.srtFileName || "SRT đã sẵn sàng" : hasInput ? "Đang chuẩn bị voice/SRT" : "Chưa có nội dung đầu vào",
      page: "voice",
      state: stepState({ done: voiceReady, running: hasInput && !voiceReady, ready: !hasInput }),
      icon: AudioLines,
    },
    {
      id: "visual-bible",
      label: "Visual Bible",
      detail: hasVisualBible ? "Phong cách đồ họa đã khóa" : "Cần nhập phong cách bắt buộc",
      page: "visual-bible",
      state: stepState({ done: hasVisualBible, ready: voiceReady }),
      icon: BookOpenCheck,
    },
    {
      id: "timeline",
      label: "Timeline & Prompt",
      detail: scenes.length ? `${promptScenes.length}/${scenes.length} scene có prompt` : "Chưa chia timeline",
      page: "timeline",
      state: stepState({ done: promptsReady, ready: hasVisualBible }),
      icon: ListTree,
    },
    {
      id: "images",
      label: "Tạo ảnh",
      detail: `${completedImages}/${imageScenes.length} ảnh scene hoàn thành${imageErrors ? ` · ${imageErrors} lỗi` : ""}`,
      page: "queue",
      state: stepState({ done: imagesReady, running: imageRunning, error: imageErrors > 0, ready: promptsReady }),
      icon: ImageIcon,
    },
    {
      id: "videos",
      label: "Tạo video",
      detail: `${completedVideos}/${scenes.length} video hoàn thành${videoErrors ? ` · ${videoErrors} lỗi` : ""}`,
      page: "queue",
      state: stepState({ done: videosReady, running: videoRunning, error: videoErrors > 0, ready: promptsReady }),
      icon: Clapperboard,
    },
    {
      id: "output",
      label: "Đầu ra",
      detail: outputReady ? `${videoOutputCount} video đã kiểm tra` : `${output?.totalFiles || 0} file trong thư mục phiên`,
      page: "output",
      state: stepState({ done: outputReady, ready: completedVideos > 0 }),
      icon: FileOutput,
    },
  ];

  const imageFraction = imageScenes.length ? completedImages / imageScenes.length : 0;
  const videoFraction = scenes.length ? completedVideos / scenes.length : 0;
  const progressUnits = Number(voiceReady) + Number(hasVisualBible) + Number(promptsReady) + imageFraction + videoFraction + Number(outputReady);
  const progress = Math.max(0, Math.min(100, Math.round((progressUnits / steps.length) * 100)));
  const isMoving = hasInput && progress < 100 && queue?.state !== "stopped" && queue?.state !== "paused";

  return (
    <section className="kc-project-journey" aria-label="Tiến trình sản xuất dự án">
      <header>
        <div><span>PRODUCTION JOURNEY</span><h2>Tiến trình phiên {session?.name || "hiện tại"}</h2></div>
        <b>{progress}% hoàn thành</b>
      </header>
      <div className="kc-journey-scroll">
        <div className="kc-journey-track">
          <i className="kc-journey-line" aria-hidden="true">
            <span className={isMoving ? "is-moving" : ""} style={{ width: `${progress}%` }} />
          </i>
          <div className="kc-journey-steps">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const StateIcon = step.state === "done" ? Check : step.state === "error" ? CircleAlert : step.state === "running" ? LoaderCircle : null;
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`kc-journey-step is-${step.state}`}
                  onClick={() => onNavigate(step.page)}
                  aria-label={`${step.label}: ${stateLabel(step.state)}. ${step.detail}`}
                >
                  <span className="kc-journey-marker">
                    <Icon size={17} />
                    {StateIcon && <StateIcon className="kc-journey-state-icon" size={11} />}
                  </span>
                  <small>Mốc {index + 1}</small>
                  <strong>{step.label}</strong>
                  <em>{stateLabel(step.state)}</em>
                  <p>{step.detail}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <footer><span>Bấm vào một mốc để mở đúng khu vực làm việc và quan sát chi tiết.</span><strong>{queue?.state === "running" ? "Dây chuyền đang chạy" : queue?.state === "paused" ? "Dây chuyền đang tạm dừng" : queue?.state === "stopped" ? "Dây chuyền đã dừng" : "Dây chuyền sẵn sàng"}</strong></footer>
    </section>
  );
}
