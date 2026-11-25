import type { Desk } from "./store.ts";
import type { Update } from "./schema.ts";
import { tagOrganizations } from "./hf.ts";
import { cleanMention, junkMention, matchCompanies, nameParts, resolveName } from "./names.ts";

const inDirectory = (name: string, names: string[]) =>
  names.some((n) => n === name || nameParts(n).includes(name));

/**
 * Fills `companies` (and `orgs`, every organization mentioned) on updates using the
 * Hugging Face NER model. Directory hits keep the directory's spelling, and a
 * compound entry ("Anthropic · OpenAI · Google · xAI") contributes only the member
 * that appears. Title fragments and generic nouns are dropped. Mutates the updates
 * in place and returns how many gained at least one company.
 */
export async function tagCompanies(desk: Desk, updates: Update[]): Promise<number> {
  const names = desk.companies.map((c) => String(c.name));
  const tags = await tagOrganizations(updates.map((u) => `${u.title}. ${u.body}`));
  let gained = 0;
  updates.forEach((u, i) => {
    const before = u.companies.length;
    const text = `${u.title}. ${u.body}`;
    const fromNer = tags[i].companies
      .map((org) => resolveName(org, text, names))
      .filter((s): s is string => !!s);
    u.orgs = [...new Set(tags[i].orgs.map((org) => cleanMention(org, text, names) ?? (junkMention(org, text) ? "" : org)).filter((s) => !!s))];
    u.companies = [...new Set([...matchCompanies(text, names), ...u.companies, ...fromNer].map((name) => cleanMention(name, text, names) ?? ""))]
      .filter((name) => !!name && (inDirectory(name, names) || fromNer.includes(name)));
    if (!before && u.companies.length) gained++;
  });
  return gained;
}
