/**
 * Company names worth printing. Directory hits are kept (a compound directory
 * entry contributes only the names that actually appear). Anything else has to
 * look like a company: a job title, a unit, or a single generic noun is dropped.
 */
import { bounded, escapeReg } from "./text.ts";

const SINGLE =
  /^(industry|defence|defense|readiness|security|systems|services|global|international|national|federal|military|government|ministry|minister|secretary|department|office|agency|command|forces|army|navy|congress|senate|house|committee|university|institute|association|council|wing|division|battalion|regiment|brigade|fleet|squadron|group|program|project|report|news|weekly|times|public|relations|academy|cavalry|guard|marines|pentagon|nato|energy|infrastructure|community|college|school|training|officer|journal|street|wall|grid|service|guardian)$/i;
const UNIT =
  /\b(\d+(?:st|nd|rd|th)\b|airlift|armou?red|cavalry|battalion|regiment|brigade|squadron|task force|public relations|military academy|air wing)\b/i;
const SUFFIX = /\b(inc|corp|corporation|labs|laboratories|systems|technologies|dynamics|aerospace|industries|group|gmbh|plc)\b/i;
const JUNK_WORD = /^(industry|readiness|defence|defense|systems|services|public|relations|global|national|federal|military|energy|infrastructure|community|college|school|training|officer|journal|street|wall|grid|service|guardian|the|all|first)$/i;
const TRAILING_VERB =
  /^(reports|says|said|orders|lands|wins|closes|acquires|launches|takes|joins|sets|gives|wants|seeks|warns|announces|plans|eyes|gets|makes|builds|opens|signs|noted|shows|sees)$/i;
const OUTLET =
  /\b(wall street journal|new york times|washington post|financial times|associated press|reuters|bloomberg|politico|axios|business insider|the hill|usa today|the guardian|forbes|breaking defense|defense news|defensenews|defense one|the war zone|spacenews|space news)\b/i;
const OUTLET_TAIL = /\b(journal|times|post|gazette|tribune|herald|chronicle|magazine|newspaper)\b/i;
const SCHOOL = /\b(college|university|academy|high school|training school|community college)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const nameParts = (name: string) => name.split(/\s·\s|\s\/\s/).map((s) => s.trim()).filter((s) => s.length > 2);

function hasWord(text: string, phrase: string): boolean {
  return bounded(phrase.split(/\s+/).map(escapeReg).join("\\s+")).test(text);
}

function titleContext(text: string, span: string): boolean {
  return new RegExp(`\\b(?:minister|secretary|director|deputy|undersecretary|chief)\\s+(?:of|for)\\b[^.]{0,80}\\b${escapeReg(span)}\\b`, "i").test(text);
}

/** "Amentum Reports" is the company plus the headline verb. */
export function stripTrailingVerb(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2 && TRAILING_VERB.test(words.at(-1) ?? "")) return words.slice(0, -1).join(" ");
  return name.trim();
}

/** News outlets, schools, and a name that is only the front of a unit ("First All-Guardian Squadron"). */
export function blockedMention(name: string, text: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (OUTLET.test(n) || SCHOOL.test(n)) return true;
  if (OUTLET_TAIL.test(n) && /\b(the|street|new|york|washington|wall)\b/i.test(n)) return true;
  if (new RegExp(`\\b${escapeReg(n)}\\s+(squadron|wing|regiment|battalion|brigade|school|division|class)\\b`, "i").test(text)) return true;
  return false;
}

/** A mention that is a title fragment or a generic noun, not an organization worth showing. */
export function junkMention(name: string, text: string): boolean {
  const stripped = stripTrailingVerb(name);
  if (blockedMention(name, text) || blockedMention(stripped, text)) return true;
  if (titleContext(text, name) || titleContext(text, stripped) || UNIT.test(name) || UNIT.test(stripped)) return true;
  const words = stripped.split(/\s+/);
  return words.every((w) => JUNK_WORD.test(w));
}

/** Non-directory name that still looks like a company. */
export function extraCompany(name: string, text: string): boolean {
  const original = name.trim();
  const stripped = stripTrailingVerb(original);
  if (blockedMention(original, text) || blockedMention(stripped, text)) return false;
  if (stripped.length < 3 || SINGLE.test(stripped) || UNIT.test(stripped) || titleContext(text, stripped)) return false;
  const words = stripped.split(/\s+/);
  if (words.length < 2 && !SUFFIX.test(stripped)) {
    return stripped !== original && /^[A-Z]/.test(stripped) && !JUNK_WORD.test(stripped);
  }
  if (words.every((w) => SINGLE.test(w) || JUNK_WORD.test(w))) return false;
  if (words.some((w) => SINGLE.test(w)) && !SUFFIX.test(stripped)) return false;
  return true;
}

/**
 * Directory spelling when `org` is that company or a longer form of it
 * ("Lockheed Martin Aeronautics" → "Lockheed Martin"). A shorter fragment
 * ("Defense") does not claim a longer name ("Defense Unicorns").
 * Compound entries ("Anthropic · OpenAI · Google · xAI") return only the part that matched.
 */
export function resolveName(org: string, text: string, names: string[]): string | null {
  const stripped = stripTrailingVerb(org);
  for (const candidate of [stripped, org.trim()]) {
    const n = norm(candidate);
    for (const name of names) {
      const parts = nameParts(name);
      for (const part of parts) {
        const a = norm(part);
        if (n === a || n.startsWith(a + " ")) return parts.length > 1 ? part : name;
      }
    }
  }
  if (!extraCompany(org, text)) return null;
  return stripped;
}

/**
 * The name to store, or null when it is a trailing verb, a news outlet, a school,
 * or a generic noun. Directory spelling wins when the stem is a known company.
 */
export function cleanMention(name: string, text: string, directory: string[] = []): string | null {
  const raw = name.trim();
  if (!raw || junkMention(raw, text)) return null;
  return resolveName(raw, text, directory);
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
