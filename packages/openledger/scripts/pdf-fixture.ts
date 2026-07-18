/**
 * A statement the ingest pipeline can actually read, assembled here so the
 * smoke run needs no binary fixtures. Latin-1 throughout: the xref table
 * addresses bytes, and a multi-byte character would shift every offset after it.
 */

const WIDTH = 612;
const HEIGHT = 792;

const buildPdf = (objects: string[]): Buffer => {
  const header = "%PDF-1.4\n";
  const bodies = objects.map(
    (body, index) => `${index + 1} 0 obj${body}endobj\n`,
  );

  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "latin1");
  for (const body of bodies) {
    offsets.push(cursor);
    cursor += Buffer.byteLength(body, "latin1");
  }

  const size = objects.length + 1;
  const xref =
    `xref\n0 ${String(size)}\n0000000000 65535 f \n` +
    offsets
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("");
  const trailer = `trailer<</Size ${String(size)}/Root 1 0 R>>\nstartxref\n${String(cursor)}\n%%EOF\n`;

  return Buffer.from(header + bodies.join("") + xref + trailer, "latin1");
};

const streamObject = (content: string): string =>
  `<</Length ${String(Buffer.byteLength(content, "latin1"))}>>stream\n${content}\nendstream`;

// 20 lines clears the character bar that decides a page carries a real text layer.
const pageContent = (page: number): string => {
  const lines = Array.from(
    { length: 20 },
    (_, line) =>
      `(page${String(page)} line ${String(line).padStart(2, "0")} 1234.56 THB DEBIT ACME) Tj T*\n`,
  );
  return `BT /F1 11 Tf 36 756 Td 14 TL\n${lines.join("")}ET\n`;
};

/** Object 1 is the catalog, 2 the page tree, then a page/content pair each, then the font. */
export const textPdf = (pageCount: number): Buffer => {
  const firstPage = 3;
  const fontNumber = firstPage + pageCount * 2;
  const kids = Array.from(
    { length: pageCount },
    (_, index) => `${String(firstPage + index * 2)} 0 R`,
  ).join(" ");

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${kids}]/Count ${String(pageCount)}>>`,
  ];
  for (let index = 0; index < pageCount; index++) {
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${String(WIDTH)} ${String(HEIGHT)}]` +
        `/Resources<</Font<</F1 ${String(fontNumber)} 0 R>>>>/Contents ${String(firstPage + index * 2 + 1)} 0 R>>`,
    );
    objects.push(streamObject(pageContent(index + 1)));
  }
  objects.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");

  return buildPdf(objects);
};
