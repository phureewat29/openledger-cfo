import { describe, expect, it } from "vitest";

import { uploadExtensionOf } from "./ingest-files";

describe("uploadExtensionOf", () => {
  it.each([
    ["statement.pdf", "pdf"],
    ["Statement.PDF", "pdf"],
    ["receipt.JpEg", "jpeg"],
    ["2026.01.scan.png", "png"],
    ["photo.webp", "webp"],
  ])("reads %s as %s", (name, extension) => {
    expect(uploadExtensionOf(name)).toBe(extension);
  });

  it.each(["notes.docx", "archive.pdf.zip", "no-extension", "trailing."])(
    "refuses %s",
    (name) => {
      expect(uploadExtensionOf(name)).toBeUndefined();
    },
  );

  it("reads a leading dot as a hidden file, not an extension", () => {
    expect(uploadExtensionOf(".pdf")).toBeUndefined();
  });
});
