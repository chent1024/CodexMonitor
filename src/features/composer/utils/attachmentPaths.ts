const imageExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".heic",
  ".heif",
];

export function isImageAttachmentPath(path: string) {
  if (path.startsWith("data:image/")) {
    return true;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return true;
  }
  const lower = path.toLowerCase();
  return imageExtensions.some((ext) => lower.endsWith(ext));
}

export function splitAttachmentPaths(paths: string[]) {
  const images: string[] = [];
  const files: string[] = [];
  paths.forEach((path) => {
    if (isImageAttachmentPath(path)) {
      images.push(path);
    } else {
      files.push(path);
    }
  });
  return { images, files };
}

