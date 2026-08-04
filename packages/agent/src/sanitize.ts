/**
 * Merchant names and descriptions come from bank-statement-style data. They are
 * untrusted text that reaches an LLM prompt, so they are cleaned once here
 * rather than at each tool: C0/DEL controls and Unicode bidi/zero-width runs can
 * reorder or hide what a reader sees, and a pipe would break the delimiter of a
 * prompt block.
 */

const DEL = 0x7f;
const SPACE = 0x20;
const ZERO_WIDTH_START = 0x200b;
const ZERO_WIDTH_END = 0x200f;
const BIDI_START = 0x202a;
const BIDI_END = 0x202e;
const INVISIBLE_START = 0x2060;
const INVISIBLE_END = 0x206f;
const BOM = 0xfeff;

const MAX_LENGTH = 80;

const isControl = (codePoint: number) => codePoint < SPACE || codePoint === DEL;

const isInvisible = (codePoint: number) =>
  (codePoint >= ZERO_WIDTH_START && codePoint <= ZERO_WIDTH_END) ||
  (codePoint >= BIDI_START && codePoint <= BIDI_END) ||
  (codePoint >= INVISIBLE_START && codePoint <= INVISIBLE_END) ||
  codePoint === BOM;

/** Controls collapse to a space so joined words stay separated; the rest vanish. */
const clean = (character: string): string => {
  const codePoint = character.codePointAt(0) ?? 0;
  if (isControl(codePoint)) return " ";
  if (isInvisible(codePoint)) return "";
  if (character === "|") return "/";
  return character;
};

export const sanitizeLabel = (value: string): string => {
  const collapsed = Array.from(value, clean)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length <= MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_LENGTH - 1)}…`;
};

export const sanitizeOptional = (value: string | null): string | null => {
  if (value === null) return null;
  const cleaned = sanitizeLabel(value);
  return cleaned.length === 0 ? null : cleaned;
};
