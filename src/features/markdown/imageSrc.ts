export type FileSrcConverter = (path: string) => string;

export function markdownImageDirectory(filePath: string): string {
  const normalized = filePath
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "");
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

export function markdownImageRoot(filePath: string, roots: string[]): string {
  const path = normalizeLocalPath(filePath);
  const matching = roots
    .map(normalizeLocalPath)
    .filter((root) => {
      const onWindows = /^[a-z]:/i.test(root) || root.startsWith("//");
      const candidate = onWindows ? path.toLowerCase() : path;
      const boundary = onWindows ? root.toLowerCase() : root;
      return candidate.startsWith(`${boundary}/`);
    })
    .sort((left, right) => right.length - left.length)[0];
  return matching ?? markdownImageDirectory(filePath);
}

function normalizeLocalPath(path: string): string {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "");
  const prefix = normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : "";
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return prefix + segments.join("/");
}

export function resolveMarkdownImageSrc(
  src: string | undefined,
  imageBaseDir: string | undefined,
  convertFileSrc: FileSrcConverter,
  imageRootDir = imageBaseDir,
  allowRemoteImages = false,
): string {
  if (!src) return "";
  if (/^https:\/\//i.test(src)) return allowRemoteImages ? src : "";
  if (!imageBaseDir || !imageRootDir) return "";
  // 默认不加载网络或内嵌图片；本地路径只能落在用户选定的目录范围内。
  let relative: string;
  try {
    relative = decodeURIComponent(src);
  } catch {
    return "";
  }
  if (
    /^[a-z][\w+.-]*:/i.test(relative) ||
    relative.startsWith("/") ||
    relative.startsWith("\\") ||
    relative.includes("?") ||
    relative.includes("#")
  )
    return "";
  const root = normalizeLocalPath(imageRootDir);
  const resolved = normalizeLocalPath(`${imageBaseDir}/${relative}`);
  const onWindows = /^[a-z]:/i.test(root) || root.startsWith("//");
  const actualRoot = onWindows ? root.toLowerCase() : root;
  const actualPath = onWindows ? resolved.toLowerCase() : resolved;
  if (!actualPath.startsWith(`${actualRoot}/`)) return "";
  return convertFileSrc(resolved);
}
