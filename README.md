# Kill Chain Ledger

A daily intelligence desk for the defense-technology industry. Every morning a GitHub Action researches what happened across 20 sectors, writes a short plain-language brief, adds sourced updates and upcoming events, and publishes everything as a static JSON API and a website on GitHub Pages.

## How the daily update works

1. **Research** (`src/pipeline.ts` → `research`): Claude (`claude-opus-5`) uses web search to find developments since the last brief, skipping what's already on the desk. The memo is saved to `logs/<date>-research.md`.
2. **Structure** (`structure`): a second call turns the memo into schema-checked JSON (structured outputs, `src/schema.ts`): new updates, the morning brief, and new calendar events.
3. **Merge** (`src/daily.ts`): drops duplicates by id and source URL, then writes `data/`.
4. **Publish** (`src/build-api.ts`): writes `public/api/v1/`, and the workflow deploys `public/` to GitHub Pages.

The research call opts into server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), so a declined request is retried on Anthropic's recommended fallback model instead of failing the run.

## API

Served from GitHub Pages at `https://<user>.github.io/kill-chain-ledger/api/v1/`:

| Endpoint | Contents |
|---|---|
| `brief/latest.json` | Today's morning brief |
| `brief/<YYYY-MM-DD>.json` | A past brief |
| `briefs.json` | Index of all briefs |
| `updates.json` | Every sourced update, newest first |
| `sectors.json` | The 20 sector briefs |
| `catalysts.json` | Upcoming dated events |
| `companies.json`, `research.json`, `ideas.json` | Directory, library, build ideas |
| `all.json` | Everything above in one file (what the site loads) |

## Setup

1. Add your Anthropic API key as a repository secret: `gh secret set ANTHROPIC_API_KEY`
2. Enable Pages with GitHub Actions as the source: Settings → Pages → Source: GitHub Actions.
3. Run it once by hand: `gh workflow run "Daily brief"`. After that it runs every day at 10:00 UTC.

## Local use

```bash
npm ci
ANTHROPIC_API_KEY=... npm run daily      # research and write today's brief
npm run build:api                         # rebuild public/api/v1 from data/
npx serve public                          # view the site locally
```

Set `DESK_DATE=YYYY-MM-DD` to write a brief for a specific date, and `FORCE=1` to redo one that exists.

## The Claude-hosted version

`public/index.html` is the same page published as a Claude artifact. Inside Claude it reads and writes the artifact's own database and offers Ask and a private notebook. Elsewhere it reads `api/v1/all.json` and is read-only. Claude artifacts can't fetch outside URLs, so the artifact gets new data only when Claude writes it there.
