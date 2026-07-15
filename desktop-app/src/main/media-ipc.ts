import { ipcMain } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { MEDIA_READ_IMAGE_CHANNEL } from "../shared/media";

const MAX_RESULT_IMAGE_BYTES = 25 * 1024 * 1024;

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

export function registerMediaIpcHandlers(): void {
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
}
