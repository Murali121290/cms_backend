// Character catalogue for the editor's "Insert Symbol" (Ω) picker.

export type SpecialCharCategory = "spaces" | "punctuation" | "math" | "greek";

export type SpecialChar = {
  char: string;
  name: string;
  code: string; // "U+2003"
  category: SpecialCharCategory;
  /** Short visible label for characters that render blank (spaces). */
  label?: string;
  keywords?: string[];
};

const u = (char: string) =>
  "U+" + char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");

const mk = (
  category: SpecialCharCategory,
  rows: Array<[string, string, string?, string[]?]>,
): SpecialChar[] =>
  rows.map(([char, name, label, keywords]) => ({
    char,
    name,
    code: u(char),
    category,
    ...(label ? { label } : {}),
    ...(keywords ? { keywords } : {}),
  }));

export const SPACES: SpecialChar[] = mk("spaces", [
  [" ", "En space", "EN", ["n space", "nut"]],
  [" ", "Em space", "EM", ["m space", "mutton", "quad"]],
  [" ", "Thin space", "THIN"],
  [" ", "Hair space", "HAIR"],
  [" ", "Non-breaking space", "NBSP", ["nbsp", "no break"]],
  [" ", "Narrow non-breaking space", "NNBSP", ["nnbsp", "narrow no break"]],
  [" ", "Figure space", "FIG", ["digit space", "numeric"]],
  [" ", "Punctuation space", "PUNC"],
]);

export const PUNCTUATION: SpecialChar[] = mk("punctuation", [
  ["…", "Ellipsis", undefined, ["dots", "three dots", "..."]],
  ["–", "En dash", undefined, ["n dash", "range"]],
  ["—", "Em dash", undefined, ["m dash"]],
  ["‑", "Non-breaking hyphen", undefined, ["no break hyphen"]],
  ["−", "Minus sign", undefined, ["minus"]],
  ["•", "Bullet"],
  ["·", "Middle dot", undefined, ["interpunct"]],
  ["§", "Section sign", undefined, ["section"]],
  ["¶", "Pilcrow", undefined, ["paragraph sign"]],
  ["†", "Dagger"],
  ["‡", "Double dagger"],
  ["′", "Prime", undefined, ["minutes", "feet"]],
  ["″", "Double prime", undefined, ["seconds", "inches"]],
  ["°", "Degree sign", undefined, ["degree"]],
  ["©", "Copyright sign", undefined, ["copyright"]],
  ["®", "Registered sign", undefined, ["registered"]],
  ["™", "Trade mark sign", undefined, ["trademark", "tm"]],
]);

export const MATH: SpecialChar[] = mk("math", [
  ["±", "Plus-minus sign", undefined, ["plus minus"]],
  ["×", "Multiplication sign", undefined, ["times", "multiply"]],
  ["÷", "Division sign", undefined, ["divide"]],
  ["≈", "Almost equal to", undefined, ["approximately"]],
  ["≠", "Not equal to"],
  ["≤", "Less-than or equal to", undefined, ["less than", "lte"]],
  ["≥", "Greater-than or equal to", undefined, ["greater than", "gte"]],
  ["∞", "Infinity"],
  ["√", "Square root", undefined, ["root", "radical"]],
  ["∑", "N-ary summation", undefined, ["sum", "sigma"]],
  ["∏", "N-ary product", undefined, ["product"]],
  ["∫", "Integral"],
  ["∂", "Partial differential", undefined, ["partial"]],
  ["∆", "Increment", undefined, ["delta", "change"]],
  ["∇", "Nabla", undefined, ["del", "gradient"]],
  ["∈", "Element of", undefined, ["in"]],
  ["∉", "Not an element of", undefined, ["not in"]],
  ["⊂", "Subset of"],
  ["⊃", "Superset of"],
  ["∪", "Union"],
  ["∩", "Intersection"],
  ["→", "Rightwards arrow", undefined, ["arrow right"]],
  ["←", "Leftwards arrow", undefined, ["arrow left"]],
  ["↔", "Left right arrow", undefined, ["arrow both"]],
  ["⇒", "Rightwards double arrow", undefined, ["implies"]],
  ["⇔", "Left right double arrow", undefined, ["if and only if", "iff"]],
  ["∴", "Therefore"],
  ["∵", "Because"],
  ["∝", "Proportional to"],
  ["∠", "Angle"],
  ["⊥", "Up tack", undefined, ["perpendicular"]],
  ["∥", "Parallel to", undefined, ["parallel"]],
  ["‰", "Per mille sign", undefined, ["per mille", "per thousand"]],
  ["µ", "Micro sign", undefined, ["micro", "mu"]],
]);

const GREEK_NAMES = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho",
  "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
];
// Lower-case α (U+03B1) … ω (U+03C9), skipping final sigma U+03C2.
const GREEK_LOWER = "αβγδεζηθικλμνξοπρστυφχψω";
const GREEK_UPPER = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const GREEK: SpecialChar[] = [
  ...mk("greek", GREEK_NAMES.map((n, i) => [GREEK_LOWER[i], `Greek small ${n}`, undefined, [n]])),
  ...mk("greek", GREEK_NAMES.map((n, i) => [GREEK_UPPER[i], `Greek capital ${cap(n)}`, undefined, [n]])),
];

export const ALL_SPECIAL_CHARS: SpecialChar[] = [...SPACES, ...PUNCTUATION, ...MATH, ...GREEK];

export const SPECIAL_CHAR_BY_CHAR: Record<string, SpecialChar> = Object.fromEntries(
  ALL_SPECIAL_CHARS.map((c) => [c.char, c]),
);

/** Special-space character → display name (used by the on-screen markers). */
export const SPECIAL_SPACE_NAMES: Record<string, string> = Object.fromEntries(
  SPACES.map((c) => [c.char, c.name]),
);

export function searchSpecialChars(query: string): SpecialChar[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_SPECIAL_CHARS.filter(
    (c) =>
      c.char === query.trim() ||
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.label ?? "").toLowerCase() === q ||
      (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
  );
}
