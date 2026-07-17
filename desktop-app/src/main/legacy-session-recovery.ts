import { DEFAULT_PROJECT_ID } from "../shared/production-queue";
import { normalizeVisualBible, type Scene, type TimelineSession } from "../shared/timeline";
import type { SceneRecord } from "../shared/project";
import type { ProjectDatabase } from "./project-database";
import { ProjectRepositories } from "./project-repositories";
import type { TimelineSessionStore } from "./timeline-session-store";

function publicSceneId(projectId: string, sceneId: string): string {
  const prefix = `${projectId}:`;
  return sceneId.startsWith(prefix) ? sceneId.slice(prefix.length) : sceneId;
}

function restoredScene(projectId: string, scene: SceneRecord): Scene {
  const imagePath = scene.imageAssetPath || "";
  const videoPath = scene.videoAssetPath || "";
  return {
    id: publicSceneId(projectId, scene.id),
    order: scene.orderIndex + 1,
    timeStart: scene.timeStart,
    timeEnd: scene.timeEnd,
    imagePrompt: scene.chainRole === "continue" ? "" : scene.imagePrompt,
    imageStatus: scene.status === "image_failed" ? "error" : imagePath ? "done" : "pending",
    imageResultPath: imagePath,
    imageFlowAssetKey: scene.flowImageAssetId || "",
    imageApproved: scene.approvedImage,
    videoPrompt: scene.videoPrompt,
    videoStatus: scene.status === "video_failed" ? "error" : videoPath ? "done" : "pending",
    videoResultPath: videoPath,
    videoApproved: scene.approvedVideo,
    usedCharacterTokens: scene.usedCharacterTokens,
    characterPolicy: scene.usedCharacterTokens.length > 0 ? "selected" : "none",
    assignedCharacterTokens: scene.usedCharacterTokens,
    chainId: scene.chainId,
    chainRole: scene.chainRole,
    durationSeconds: scene.durationSeconds,
  };
}

/**
 * Recovers the former single-session timeline from SQLite when a damaged or
 * interrupted LowDB migration leaves only empty v3 workspaces. Generated media
 * paths and approval state are retained; source files are never modified.
 */
export async function recoverLegacySessionFromProject(
  database: ProjectDatabase,
  store: TimelineSessionStore,
): Promise<TimelineSession | null> {
  const summaries = await store.list();
  if (summaries.some((session) => session.sceneCount > 0)) return null;

  const repositories = new ProjectRepositories(database);
  const project = repositories.projects.get(DEFAULT_PROJECT_ID);
  const storedScenes = repositories.scenes.listByProject(DEFAULT_PROJECT_ID);
  if (!project || storedScenes.length === 0) return null;

  const bibleRecord = repositories.visualBibles.listByProject(DEFAULT_PROJECT_ID).at(-1);
  let visualBible = normalizeVisualBible({});
  try {
    visualBible = normalizeVisualBible(JSON.parse(bibleRecord?.payloadJson || "{}"));
  } catch {
    // Keep the safe empty Visual Bible and let the user fill it later.
  }
  const savedAt = storedScenes.reduce(
    (latest, scene) => scene.updatedAt > latest ? scene.updatedAt : latest,
    project.createdAt,
  );
  const recovered = await store.save({
    scenes: storedScenes.map((scene) => restoredScene(DEFAULT_PROJECT_ID, scene)),
    visualBible,
    styleReference: null,
  }, DEFAULT_PROJECT_ID);
  await store.rename(DEFAULT_PROJECT_ID, project.name || "Phiên làm việc trước đây");

  for (const session of await store.list()) {
    if (session.id !== DEFAULT_PROJECT_ID && session.sceneCount === 0) {
      await store.delete(session.id);
    }
  }
  await store.select(DEFAULT_PROJECT_ID);
  return { ...recovered, name: project.name, savedAt };
}
