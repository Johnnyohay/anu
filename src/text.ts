/** A word boundary that treats hyphens as part of the word, so "tank" does not match "anti-tank". */
export const bounded = (pattern: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${pattern})(?![\\p{L}\\p{N}_-])`, "iu");

export const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
