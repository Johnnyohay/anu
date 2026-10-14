import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { Brief, Catalyst, Sector, Update } from "./schema.ts";

export const DATA_DIR = "data";

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const full = path.join(DATA_DIR, file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(value, null, 2) + "\n");
}

export interface Desk {
  meta: Record<string, unknown>;
  sectors: Sector[];
  updates: Update[];
  companies: Record<string, unknown>[];
  catalysts: Catalyst[];
  research: Record<string, unknown>[];
  ideas: Record<string, unknown>[];
  briefs: Brief[];
}

/** Loads everything from the published JSON API (api/v1/all.json), so no local copy is needed. */
export async function loadDeskRemote(url: string): Promise<Desk> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Couldn't load data from ${url} (${res.status})`);
  const all = (await res.json()) as Omit<Desk, "meta"> & { meta: Record<string, unknown> };
  return {
    meta: all.meta,
    sectors: all.sectors,
    updates: all.updates,
    companies: all.companies,
    catalysts: all.catalysts,
    research: all.research,
    ideas: all.ideas,
    briefs: all.briefs,
  };
}

export async function loadDesk(): Promise<Desk> {
  const briefFiles = (await readdir(path.join(DATA_DIR, "briefs"))).filter((f) => f.endsWith(".json")).sort();
  return {
    meta: await readJson("meta.json"),
    sectors: await readJson("sectors.json"),
    updates: await readJson("updates.json"),
    companies: await readJson("companies.json"),
    catalysts: await readJson("catalysts.json"),
    research: await readJson("research.json"),
    ideas: await readJson("ideas.json"),
    briefs: await Promise.all(briefFiles.map((f) => readJson<Brief>(`briefs/${f}`))),
  };
}

export async function saveDaily(desk: Desk, brief: Brief | null): Promise<void> {
  const byDateDesc = (a: { d: string }, b: { d: string }) => b.d.localeCompare(a.d);
  await writeJson("updates.json", [...desk.updates].sort(byDateDesc));
  await writeJson("catalysts.json", [...desk.catalysts].sort((a, b) => a.d.localeCompare(b.d)));
  await writeJson("meta.json", desk.meta);
  if (brief) await writeJson(`briefs/${brief.date}.json`, brief);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "item";
}
