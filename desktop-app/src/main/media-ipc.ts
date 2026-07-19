import { ipcMain, net, protocol } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MEDIA_GET_STREAM_URL_CHANNEL, MEDIA_READ_IMAGE_CHANNEL } from "../shared/media";

const MAX_RESULT_IMAGE_BYTES = 25 * 1024 * 1024;
const STREAMABLE_MEDIA_EXTENSION = /[.](mp3|wav|m4a|mp4|webm|png|jpe?g|webp)$/i;

function detectedMimeType(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function safeMediaPath(root: string, value: string): string {
  const absolute = resolve(value);
  const relativePath = relative(resolve(root), absolute);
  if (!isAbsolute(absolute) || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("File media nằm ngoài thư mục KC Auto Tool.");
  }
  return absolute;
}

export function registerMediaIpcHandlers(generatedMediaRoot: string): void {
  ipcMain.handle(MEDIA_READ_IMAGE_CHANNEL, async (_event, value: unknown) => {
    if (typeof value !== "string" || !isAbsolute(value) || !/[.](png|jpe?g|webp)$/i.test(extname(value))) {
      throw new Error("Đường dẫn ảnh kết quả không hợp lệ.");
    }
    const file = await stat(value);
    if (!file.isFile() || file.size <= 0 || file.size > MAX_RESULT_IMAGE_BYTES) {
      throw new Error("Ảnh kết quả phải nhỏ hơn 25 MB.");
    }
    const bytes = await readFile(value);
    const mimeType = detectedMimeType(bytes);
    if (!mimeType) throw new Error("File kết quả không phải PNG, JPEG hoặc WebP.");
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  });
  ipcMain.handle(MEDIA_GET_STREAM_URL_CHANNEL, async (_event, value: unknown) => {
    if (typeof value !== "string" || !STREAMABLE_MEDIA_EXTENSION.test(extname(value))) {
      throw new Error("Đường dẫn media không hợp lệ.");
    }
    const path = safeMediaPath(generatedMediaRoot, value);
    const file = await stat(path);
    if (!file.isFile() || file.size <= 0) throw new Error("File media không tồn tại.");
    return `kc-media://local/${Buffer.from(path, "utf8").toString("base64url")}`;
  });
}

export function registerMediaProtocol(generatedMediaRoot: string): void {
  protocol.handle("kc-media", (request) => {
    const encoded = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) || "";
    try {
      const path = safeMediaPath(generatedMediaRoot, Buffer.from(encoded, "base64url").toString("utf8"));
      return net.fetch(pathToFileURL(path).toString());
    } catch {
      return new Response("Media not found", { status: 404 });
    }
  });
}
