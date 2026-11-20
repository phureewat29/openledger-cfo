import { describe, expect, it } from "vitest";

import { pathKeyOf, safeUploadName, uploadExtensionOf } from "./files";

describe("uploadExtensionOf", () => {
  it.each([
    ["statement.pdf", "pdf"],
    ["Statement.PDF", "pdf"],
    ["receipt.JpEg", "jpeg"],
    ["2026.01.scan.png", "png"],
  ])("reads %s as %s", (name, extension) => {
    expect(uploadExtensionOf(name)).toBe(extension);
  });

  it.each([
    "notes.docx",
    "photo.webp",
    "archive.pdf.zip",
    "no-extension",
    "trailing.",
  ])("refuses %s", (name) => {
    expect(uploadExtensionOf(name)).toBeUndefined();
  });

  it("reads a leading dot as a hidden file, not an extension", () => {
    expect(uploadExtensionOf(".pdf")).toBeUndefined();
  });
});

describe("safeUploadName", () => {
  it.each([
    ["statement.pdf", "statement.pdf"],
    ["C:\\fakepath\\May.pdf", "May.pdf"],
    ["../../etc/x.pdf", "x.pdf"],
    ["a:b*c?.pdf", "a-b-c-.pdf"],
    ["console.pdf", "console.pdf"],
    ["com10.pdf", "com10.pdf"],
  ])("reduces %s to %s", (raw, name) => {
    expect(safeUploadName(raw)).toBe(name);
  });

  it.each([
    ["CON.pdf", "_CON.pdf"],
    ["nul.png", "_nul.png"],
    ["COM1.pdf", "_COM1.pdf"],
    ["lpt9.jpeg", "_lpt9.jpeg"],
    ["PRN.tar.pdf", "_PRN.tar.pdf"],
    ["AUX .pdf", "_AUX .pdf"],
    ["COM\u00b9.pdf", "_COM1.pdf"],
  ])("moves the device name %s aside as %s", (raw, name) => {
    expect(safeUploadName(raw)).toBe(name);
  });

  it.each(["", "   ", ".pdf", "dir/.hidden.pdf"])("refuses %j", (raw) => {
    expect(safeUploadName(raw)).toBeUndefined();
  });
});

describe("pathKeyOf", () => {
  it("gives every Windows spelling of a file one key", () => {
    expect(pathKeyOf("2026\\KBank-May.PDF", "win32")).toBe(
      pathKeyOf("2026/kbank-may.pdf", "win32"),
    );
  });

  it.each(["linux", "darwin"] as const)(
    "keeps case and backslashes on %s",
    (platform) => {
      expect(pathKeyOf("2026\\KBank-May.PDF", platform)).toBe(
        "2026\\KBank-May.PDF",
      );
    },
  );
});
