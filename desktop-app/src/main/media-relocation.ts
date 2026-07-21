import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, normalize, resolve } from "node:path";
import type { SceneJobResult } from "../shared/scene-job";

function isChromeKcDownload(path: string): boolean {
  let current = dirname(resolve(path));
  while (dirname(current) !== current) {
    if (basename(current).toLocaleLowerCase("en-US") === "kc auto tool") return true;
    current = dirname(current);
  }
  return false;
}

function samePath(left: string, right: string): boolean {
  return normalize(resolve(left)).toLocaleLowerCase("en-US") === normalize(resolve(right)).toLocaleLowerCase("en-US");
}

async function removeSourceWithRetry(path: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(path, { force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 120 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function relocateSceneJobResult(
  result: SceneJobResult,
  outputRoot: string,
  outputFolder: string,
): Promise<SceneJobResult> {
  const sourcePath = resolve(result.resultPath);
  const safeFolder = String(outputFolder || "default-session")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .slice(0, 80) || "default-session";
  const targetDirectory = resolve(outputRoot, safeFolder);
  const targetPath = join(targetDirectory, basename(sourcePath));
  if (samePath(sourcePath, targetPath) || !isChromeKcDownload(sourcePath)) return result;

  const source = await stat(sourcePath).catch(() => null);
  if (!source?.isFile() || source.size <= 0) {
    throw new Error(`File Google Flow tải xuống không tồn tại hoặc rỗng: ${sourcePath}`);
  }
  await mkdir(targetDirectory, { recursive: true });
  try {
    await rename(sourcePath, targetPath);
  } catch {
    const temporaryPath = `${targetPath}.kc-move-${randomUUID()}`;
    await copyFile(sourcePath, temporaryPath);
    const copied = await stat(temporaryPath);
    if (!copied.isFile() || copied.size !== source.size) {
      await rm(temporaryPath, { force: true });
      throw new Error(`Không thể xác minh file Google Flow sau khi chuyển sang ${targetDirectory}`);
    }
    await rm(targetPath, { force: true });
    await rename(temporaryPath, targetPath);
    await removeSourceWithRetry(sourcePath);
  }
  const target = await stat(targetPath);
  if (!target.isFile() || target.size !== source.size) {
    throw new Error(`File media ở ổ đích không hợp lệ: ${targetPath}`);
  }
  return { ...result, resultPath: targetPath };
}

