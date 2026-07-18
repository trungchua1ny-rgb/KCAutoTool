import { contextBridge, ipcRenderer } from "electron";
import {
  TIMELINE_CANCEL_CHANNEL,
  TIMELINE_GENERATE_CHANNEL,
  PROMPT_POLICY_REWRITE_CHANNEL,
  TIMELINE_PROGRESS_CHANNEL,
  TIMELINE_SESSION_CLEAR_CHANNEL,
  TIMELINE_SESSION_CREATE_CHANNEL,
  TIMELINE_SESSION_DELETE_CHANNEL,
  TIMELINE_SESSION_LIST_CHANNEL,
  TIMELINE_SESSION_LOAD_CHANNEL,
  TIMELINE_SESSION_RENAME_CHANNEL,
  TIMELINE_SESSION_SAVE_CHANNEL,
  TIMELINE_SESSION_SELECT_CHANNEL,
  type TimelineProgress,
} from "../shared/timeline";
import {
  CHARACTER_CREATE_CHANNEL,
  CHARACTER_DELETE_CHANNEL,
  CHARACTER_LIST_CHANNEL,
  CHARACTER_UPDATE_CHANNEL,
} from "../shared/character";
import {
  SCENE_JOB_PROGRESS_CHANNEL,
  SCENE_JOB_RUN_CHANNEL,
  SCENE_JOB_CANCEL_CHANNEL,
  type SceneJobProgress,
} from "../shared/scene-job";
import {
  WORKER_STATUS_CHANNEL,
  WORKER_STATUS_GET_CHANNEL,
  type KCAutoToolBridge,
  type WorkerStatuses,
} from "../shared/worker-status";
import { MEDIA_READ_IMAGE_CHANNEL } from "../shared/media";
import {
  VISUAL_STYLE_DELETE_CHANNEL,
  VISUAL_STYLE_LIST_CHANNEL,
  VISUAL_STYLE_SAVE_CHANNEL,
} from "../shared/visual-style";
import {
  QUEUE_APPROVE_SCENE_CHANNEL,
  QUEUE_CLEAR_GENERATED_MEDIA_CHANNEL,
  QUEUE_CLEAR_SCENE_MEDIA_CHANNEL,
  QUEUE_CHANGED_CHANNEL,
  QUEUE_GENERATE_IMAGES_CHANNEL,
  QUEUE_GENERATE_VIDEOS_CHANNEL,
  QUEUE_PAUSE_CHANNEL,
  QUEUE_REGENERATE_SCENE_CHANNEL,
  QUEUE_REJECT_SCENE_CHANNEL,
  QUEUE_RESUME_CHANNEL,
  QUEUE_RESUME_FROM_CHANNEL,
  QUEUE_RETRY_FAILED_CHANNEL,
  QUEUE_SET_APPROVAL_POLICY_CHANNEL,
  QUEUE_SNAPSHOT_GET_CHANNEL,
  QUEUE_STOP_CHANNEL,
  type ProductionQueueSnapshot,
} from "../shared/production-queue";

const bridge: KCAutoToolBridge = {
  platform: process.platform,
  characters: {
    list: () => ipcRenderer.invoke(CHARACTER_LIST_CHANNEL),
    create: (input) => ipcRenderer.invoke(CHARACTER_CREATE_CHANNEL, input),
    update: (input) => ipcRenderer.invoke(CHARACTER_UPDATE_CHANNEL, input),
    remove: (token) => ipcRenderer.invoke(CHARACTER_DELETE_CHANNEL, token),
  },
  timeline: {
    generate: (input) => ipcRenderer.invoke(TIMELINE_GENERATE_CHANNEL, input),
    rewritePolicyPrompt: (input) => ipcRenderer.invoke(PROMPT_POLICY_REWRITE_CHANNEL, input),
    cancel: () => ipcRenderer.invoke(TIMELINE_CANCEL_CHANNEL),
    loadSession: () => ipcRenderer.invoke(TIMELINE_SESSION_LOAD_CHANNEL),
    saveSession: (input) => ipcRenderer.invoke(TIMELINE_SESSION_SAVE_CHANNEL, input),
    clearSession: () => ipcRenderer.invoke(TIMELINE_SESSION_CLEAR_CHANNEL),
    listSessions: () => ipcRenderer.invoke(TIMELINE_SESSION_LIST_CHANNEL),
    createSession: (name) => ipcRenderer.invoke(TIMELINE_SESSION_CREATE_CHANNEL, name),
    selectSession: (id) => ipcRenderer.invoke(TIMELINE_SESSION_SELECT_CHANNEL, id),
    renameSession: (id, name) => ipcRenderer.invoke(TIMELINE_SESSION_RENAME_CHANNEL, { id, name }),
    deleteSession: (id) => ipcRenderer.invoke(TIMELINE_SESSION_DELETE_CHANNEL, id),
    onProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: TimelineProgress,
      ) => callback(value);
      ipcRenderer.on(TIMELINE_PROGRESS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(TIMELINE_PROGRESS_CHANNEL, listener);
    },
  },
  sceneJobs: {
    run: (input) => ipcRenderer.invoke(SCENE_JOB_RUN_CHANNEL, input),
    cancel: () => ipcRenderer.invoke(SCENE_JOB_CANCEL_CHANNEL),
    onProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: SceneJobProgress,
      ) => callback(value);
      ipcRenderer.on(SCENE_JOB_PROGRESS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(SCENE_JOB_PROGRESS_CHANNEL, listener);
    },
  },
  media: {
    readImageDataUrl: (path) => ipcRenderer.invoke(MEDIA_READ_IMAGE_CHANNEL, path),
  },
  visualStyles: {
    list: () => ipcRenderer.invoke(VISUAL_STYLE_LIST_CHANNEL),
    save: (input) => ipcRenderer.invoke(VISUAL_STYLE_SAVE_CHANNEL, input),
    remove: (id) => ipcRenderer.invoke(VISUAL_STYLE_DELETE_CHANNEL, id),
  },
  productionQueue: {
    getSnapshot: (projectId) => ipcRenderer.invoke(QUEUE_SNAPSHOT_GET_CHANNEL, projectId),
    generateAllImages: (projectId, options) =>
      ipcRenderer.invoke(QUEUE_GENERATE_IMAGES_CHANNEL, { projectId, options }),
    generateAllVideos: (projectId, options) =>
      ipcRenderer.invoke(QUEUE_GENERATE_VIDEOS_CHANNEL, { projectId, options }),
    pauseQueue: () => ipcRenderer.invoke(QUEUE_PAUSE_CHANNEL),
    resumeQueue: () => ipcRenderer.invoke(QUEUE_RESUME_CHANNEL),
    stopQueue: () => ipcRenderer.invoke(QUEUE_STOP_CHANNEL),
    clearGeneratedMedia: (projectId) =>
      ipcRenderer.invoke(QUEUE_CLEAR_GENERATED_MEDIA_CHANNEL, { projectId }),
    clearSceneMedia: (sceneId, projectId) =>
      ipcRenderer.invoke(QUEUE_CLEAR_SCENE_MEDIA_CHANNEL, { sceneId, projectId }),
    retryFailed: (sceneIds, projectId) =>
      ipcRenderer.invoke(QUEUE_RETRY_FAILED_CHANNEL, { sceneIds, projectId }),
    resumeFrom: (sceneId, mediaType, projectId) =>
      ipcRenderer.invoke(QUEUE_RESUME_FROM_CHANNEL, { sceneId, mediaType, projectId }),
    regenerateScene: (sceneId, mediaType, projectId) =>
      ipcRenderer.invoke(QUEUE_REGENERATE_SCENE_CHANNEL, { sceneId, mediaType, projectId }),
    approveScene: (sceneId, mediaType, projectId) =>
      ipcRenderer.invoke(QUEUE_APPROVE_SCENE_CHANNEL, { sceneId, mediaType, projectId }),
    rejectScene: (sceneId, mediaType, projectId) =>
      ipcRenderer.invoke(QUEUE_REJECT_SCENE_CHANNEL, { sceneId, mediaType, projectId }),
    setApprovalPolicy: (images, videos, projectId) =>
      ipcRenderer.invoke(QUEUE_SET_APPROVAL_POLICY_CHANNEL, { images, videos, projectId }),
    onChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: ProductionQueueSnapshot,
      ) => callback(value);
      ipcRenderer.on(QUEUE_CHANGED_CHANNEL, listener);
      return () => ipcRenderer.removeListener(QUEUE_CHANGED_CHANNEL, listener);
    },
  },
  workers: {
    getStatuses: () => ipcRenderer.invoke(WORKER_STATUS_GET_CHANNEL),
    onStatusChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: WorkerStatuses) => {
        callback(value);
      };
      ipcRenderer.on(WORKER_STATUS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(WORKER_STATUS_CHANNEL, listener);
    },
  },
};

contextBridge.exposeInMainWorld("flowx", bridge);
