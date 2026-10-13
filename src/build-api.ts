import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDesk, type Desk } from "./store.ts";

const API_DIR = path.join("public", "api", "v1");

async function put(file: string, value: unknown) {
  const full = path.join(API_DIR, file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(value) + "\n");
}

/** Writes the static JSON API that GitHub Pages serves under /api/v1/. */
export async function buildApi(desk: Desk): Promise<void> {
  const briefs = [...desk.briefs].sort((a, b) => b.date.localeCompare(a.date));
  const updates = [...desk.updates].sort((a, b) => b.d.localeCompare(a.d));
  const generatedAt = new Date().toISOString();

  await put("all.json", { generatedAt, meta: desk.meta, briefs: briefs.slice(0, 30), sectors: desk.sectors, updates, companies: desk.companies, catalysts: desk.catalysts, research: desk.research, ideas: desk.ideas });
  await put("brief/latest.json", briefs[0] ?? null);
  await put("briefs.json", briefs.map((b) => ({ date: b.date, title: b.title })));
  for (const b of briefs) await put(`brief/${b.date}.json`, b);
  await put("updates.json", updates);
  await put("sectors.json", desk.sectors);
  await put("companies.json", desk.companies);
  await put("catalysts.json", desk.catalysts);
  await put("research.json", desk.research);
  await put("ideas.json", desk.ideas);
  await put("meta.json", { ...desk.meta, generatedAt });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await buildApi(await loadDesk());
  console.log(`API written to ${API_DIR}/`);
}
