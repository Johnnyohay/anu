/**
 * Company names worth printing. Directory hits are kept (a compound directory
 * entry contributes only the names that actually appear). Anything else has to
 * look like a company: a job title, a unit, or a single generic noun is dropped.
 */
import { bounded, escapeReg } from "./text.ts";

const SINGLE =
  /^(industry|defence|defense|readiness|security|systems|services|global|international|national|federal|military|government|ministry|minister|secretary|department|office|agency|command|forces|army|navy|congress|senate|house|committee|university|institute|association|council|wing|division|battalion|regiment|brigade|fleet|squadron|group|program|project|report|news|weekly|times|public|relations|academy|cavalry|guard|marines|pentagon|nato)$/i;
const UNIT =
  /\b(\d+(?:st|nd|rd|th)\b|airlift|armou?red|cavalry|battalion|regiment|brigade|squadron|task force|public relations|military academy|air wing)\b/i;
const SUFFIX = /\b(inc|corp|corporation|labs|laboratories|systems|technologies|dynamics|aerospace|industries|group|gmbh|plc)\b/i;
const JUNK_WORD = /^(industry|readiness|defence|defense|systems|services|public|relations|global|national|federal|military)$/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const nameParts = (name: string) => name.split(/\s·\s|\s\/\s/).map((s) => s.trim()).filter((s) => s.length > 2);

function hasWord(text: string, phrase: string): boolean {
  return bounded(phrase.split(/\s+/).map(escapeReg).join("\\s+")).test(text);
}

function titleContext(text: string, span: string): boolean {
  return new RegExp(`\\b(?:minister|secretary|director|deputy|undersecretary|chief)\\s+(?:of|for)\\b[^.]{0,80}\\b${escapeReg(span)}\\b`, "i").test(text);
}

/** A mention that is a title fragment or a generic noun, not an organization worth showing. */
export function junkMention(name: string, text: string): boolean {
  if (titleContext(text, name) || UNIT.test(name)) return true;
  const words = name.split(/\s+/);
  return words.every((w) => JUNK_WORD.test(w));
}

/** Non-directory name that still looks like a company. */
export function extraCompany(name: string, text: string): boolean {
  if (name.length < 3 || SINGLE.test(name) || UNIT.test(name) || titleContext(text, name)) return false;
  const words = name.split(/\s+/);
  if (words.length < 2 && !SUFFIX.test(name)) return false;
  if (words.every((w) => SINGLE.test(w))) return false;
  if (words.some((w) => SINGLE.test(w)) && !SUFFIX.test(name)) return false;
  return true;
}

/**
 * Directory spelling when `org` is that company or a longer form of it
 * ("Lockheed Martin Aeronautics" → "Lockheed Martin"). A shorter fragment
 * ("Defense") does not claim a longer name ("Defense Unicorns").
 * Compound entries ("Anthropic · OpenAI · Google · xAI") return only the part that matched.
 */
export function resolveName(org: string, text: string, names: string[]): string | null {
  const n = norm(org);
  for (const name of names) {
    const parts = nameParts(name);
    for (const part of parts) {
      const a = norm(part);
      if (n === a || n.startsWith(a + " ")) return parts.length > 1 ? part : name;
    }
  }
  return extraCompany(org, text) ? org : null;
}

/** Companies whose directory name, or one part of a compound name, appears in the text. */
export function matchCompanies(text: string, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const parts = nameParts(name);
    const hits = parts.filter((p) => hasWord(text, p));
    if (!hits.length) continue;
    out.push(...(parts.length > 1 ? hits : [name]));
  }
  return [...new Set(out)];
}
