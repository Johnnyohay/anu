# Kill Chain Ledger

A free daily intelligence desk for the defense-technology industry. Every morning a GitHub Action collects the latest articles from 14 defense news sources, sorts them into 20 sectors, writes a short headline brief, and publishes everything as a website and a JSON API on GitHub Pages.

**Site:** https://johnnyohay.github.io/kill-chain-ledger/
**API:** https://johnnyohay.github.io/kill-chain-ledger/api/v1/

Running it costs nothing: GitHub Actions and Pages are free for public repos, and the daily job uses no paid APIs.

## How the daily update works (`npm run collect`)

1. **Collect** (`src/collect.ts`): reads RSS feeds from Breaking Defense, DefenseScoop, Defense News, The War Zone, Air & Space Forces, USNI News, SpaceNews, C4ISRNET, GovConWire, Defense One, the Department of War, CSIS, Defence Blog and ExecutiveGov, keeping articles from the last 3 days.
2. **Sort**: keyword rules tag each article with sectors (AI, drones, space, missile defense, counter-drone, minerals, policy…) and a type (contract, funding, policy, deal…). Personnel moves and other noise are dropped; duplicates are removed by URL.
3. **Brief**: if there's no brief for today yet, it picks the five strongest stories across different sectors (deals, contracts and policy first), adds a plain-language "why it matters" for each sector, the next date on the calendar, and an idea to build.
4. **Publish** (`src/build-api.ts`): writes `public/api/v1/`, commits `data/`, and deploys `public/` to GitHub Pages.

Runs daily at 10:00 UTC (6:00 New York time in summer, 5:00 in winter). Run it by hand with `gh workflow run "Daily brief"`.

## API

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

## Local use

```bash
npm ci
npm run collect        # fetch news, add updates, write today's brief if missing
npm run build:api      # rebuild public/api/v1 from data/
npx serve public       # view the site locally
```

`DESK_DATE=YYYY-MM-DD` sets the date; `LOOKBACK_DAYS=N` changes how far back it reads (default 3).

## Optional: Claude-written briefs (`npm run daily:claude`)

`src/daily.ts` and `src/pipeline.ts` research the news with Claude and web search and write richer briefs. That uses the paid Claude API (`ANTHROPIC_API_KEY`), so it is **not** part of the daily job. If a Claude-written brief exists for a date, the free collector leaves it alone.

## The Claude-hosted version

`public/index.html` is the same page published as a Claude artifact. Inside Claude it reads and writes the artifact's own database and offers Ask and a private notebook. Elsewhere it reads `api/v1/all.json` and is read-only.
