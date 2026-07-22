import type {
  TimelineStyleReference,
  TimelineWorkflowSource,
  VideoWorkflowMode,
  VisualBible,
} from "../shared/timeline";
import type { ProjectProductionKind, ScreenplayProject } from "../shared/screenplay";

export type HomeWorkflowMode = "full_auto" | "srt_script" | "step_by_step" | "screenplay_film";

export interface IntegratedWorkflowHandoff {
  id: string;
  sessionId: string;
  workflowMode: VideoWorkflowMode;
  workflowSource: TimelineWorkflowSource;
  visualBible: VisualBible;
  styleReference: TimelineStyleReference | null;
  autoGenerateTimeline: boolean;
  productionKind: ProjectProductionKind;
  screenplay: ScreenplayProject;
}
