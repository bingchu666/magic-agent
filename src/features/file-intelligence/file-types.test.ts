import { describe, expect, it } from "vitest";
import { documentMimeType, fileValidationError, MAX_FILE_SIZE } from "./file-types";

describe("supported reading uploads", () => {
  it("recognizes books even when browser MIME metadata is empty", () => {
    expect(documentMimeType("中文书籍.PDF")).toBe("application/pdf");
    expect(documentMimeType("lesson.docx")).toContain("wordprocessingml");
  });
  it("rejects unsupported media and oversized documents before upload", () => {
    expect(fileValidationError({ name: "lesson.mp4", size: 100 })).toContain("不支持");
    expect(fileValidationError({ name: "lesson.pdf", size: MAX_FILE_SIZE + 1 })).toContain("25 MB");
    expect(fileValidationError({ name: "lesson.pdf", size: 1024 })).toBeNull();
  });
});
