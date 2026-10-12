export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const FILE_ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";
export const FILE_FORMAT_LABEL = "PDF · DOCX · TXT · MD · PNG · JPG · WebP";

const extensions: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function documentMimeType(fileName: string): string | null {
  return extensions[fileName.split(".").pop()?.toLowerCase() || ""] || null;
}

export function fileValidationError(file: { name: string; size: number }) {
  if (!documentMimeType(file.name)) {
    return `不支持 ${file.name} 的格式。请上传 ${FILE_FORMAT_LABEL}。`;
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return `${file.name} 无法上传：单个文件不能超过 25 MB，且不能为空。`;
  }
  return null;
}
