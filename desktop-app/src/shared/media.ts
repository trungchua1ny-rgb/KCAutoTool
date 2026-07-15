export const MEDIA_READ_IMAGE_CHANNEL = "media:read-image";

export interface MediaBridge {
  readImageDataUrl: (path: string) => Promise<string>;
}
