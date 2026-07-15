import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import {
  DEFAULT_VISUAL_BIBLE,
  normalizeStoredScenes,
  normalizeVisualBible,
  type Scene,
  type TimelineSession,
  type TimelineSessionInput,
} from "../shared/timeline";

interface TimelineSessionDatabase {
  version: 2;
  session: TimelineSession | null;
}

const DEFAULT_DATA: TimelineSessionDatabase = { version: 2, session: null };

export class TimelineSessionStore {
  private readonly database: Low<TimelineSessionDatabase>;
  private initializePromise: Promise<void> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {
    this.database = new Low(
      new JSONFile<TimelineSessionDatabase>(join(dataDirectory, "session.json")),
      structuredClone(DEFAULT_DATA),
    );
  }

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        await mkdir(this.dataDirectory, { recursive: true });
        await this.database.read();
        const session = this.database.data.session;
        if (session) {
          try {
            this.database.data.session = {
              scenes: normalizeStoredScenes(session.scenes),
              visualBible: normalizeVisualBible(
                (session as TimelineSession).visualBible,
              ),
              savedAt: typeof session.savedAt === "string"
                ? session.savedAt
                : new Date().toISOString(),
            };
            this.database.data.version = 2;
            await this.database.write();
          } catch {
            this.database.data = structuredClone(DEFAULT_DATA);
            await this.database.write();
          }
        }
      })();
    }
    return this.initializePromise;
  }

  load(): Promise<TimelineSession | null> {
    return this.enqueue(() => {
      const session = this.database.data.session;
      return session ? structuredClone(session) : null;
    });
  }

  save(value: unknown): Promise<TimelineSession> {
    return this.enqueue(async () => {
      const input = value && typeof value === "object" && !Array.isArray(value)
        ? value as Partial<TimelineSessionInput>
        : null;
      const scenesValue = input?.scenes ?? value;
      const scenes = normalizeStoredScenes(scenesValue);
      if (scenes.length === 0) {
        throw new Error("Khong the luu mot timeline rong.");
      }
      const visualBible = input
        ? normalizeVisualBible(input.visualBible)
        : this.database.data.session?.visualBible || structuredClone(DEFAULT_VISUAL_BIBLE);
      const session = { scenes, visualBible, savedAt: new Date().toISOString() };
      this.database.data.version = 2;
      this.database.data.session = session;
      await this.database.write();
      return structuredClone(session);
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.database.data.session = null;
      await this.database.write();
    });
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationQueue.then(async () => {
      await this.initialize();
      return operation();
    });
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
