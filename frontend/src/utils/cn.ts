/**
 * Lightweight className utility — merges conditional class strings.
 * No external dependencies; sufficient for Tailwind v4 class merging.
 */
type ClassValue =
  | string
  | undefined
  | null
  | false
  | 0
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];

  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === "string") {
      classes.push(input);
    } else if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) classes.push(inner);
    }
  }

  return classes.join(" ");
}
