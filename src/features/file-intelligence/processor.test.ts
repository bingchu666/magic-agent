import { describe, expect, it } from "vitest";
import { chunkPages, extractDocument } from "@/features/file-intelligence/processor";
import JSZip from "jszip";

describe("PDF page chunking", () => {
  it("preserves individual page markers inside a multi-page chunk", () => {
    const chunks = chunkPages([
      { page: 10, text: "Ten" },
      { page: 11, text: "Eleven" },
      { page: 12, text: "Foreword by Darwin Ortiz" },
    ]);

    expect(chunks).toEqual([
      [
        "[Pages 10-12]",
        "[Page 10]",
        "Ten",
        "",
        "[Page 11]",
        "Eleven",
        "",
        "[Page 12]",
        "Foreword by Darwin Ortiz",
      ].join("\n"),
    ]);
  });
});

describe("document extraction", () => {
  it("reads Chinese and English text without guessing from the filename", async () => {
    const bytes = new TextEncoder().encode("教学测试：准备三张卡片。Practice by dealing three cards.");
    const pages = await extractDocument(bytes.buffer, "text/plain", "book.txt");
    expect(pages[0].text).toContain("准备三张卡片");
    expect(pages[0].text).toContain("Practice by dealing");
  });

  it("extracts real DOCX paragraphs and excludes XML markup", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Lesson: place the marked card in the middle.</w:t></w:r></w:p><w:p><w:r><w:t>练习五次。</w:t></w:r></w:p></w:body></w:document>');
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const pages = await extractDocument(bytes, "application/octet-stream", "book.docx");
    expect(pages[0].text).toContain("marked card in the middle");
    expect(pages[0].text).toContain("练习五次");
    expect(pages[0].text).not.toContain("<w:");
  });

  it("rejects unsupported binary media instead of treating it as a book", async () => {
    await expect(extractDocument(new ArrayBuffer(8), "video/mp4", "lesson.mp4"))
      .rejects.toThrow("Unsupported");
  });
});
