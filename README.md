# ANU

My personal helper for learning about and keeping up with the defense-technology industry. Every morning a GitHub Action collects the latest articles from 14 defense news sources, sorts them into 20 sectors, writes a short headline brief, and publishes everything as a website and a JSON API on GitHub Pages.

**Site:** https://johnnyohay.github.io/anu/
**API:** https://johnnyohay.github.io/anu/api/v1/

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

## Ask ANU: the app (`npm run app`)

An agent that answers questions and gives advice using everything stored in `data/`. It runs on your machine, so your Claude API key never goes into the public site.

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # paid Claude API; each question costs a few cents
npm run app                           # builds the UI and opens the server at http://localhost:8787
```

- **Focus panel (dropdowns):** what you want (Teach me, What's new, Advise me, Company deep dive, Compare), sector, company, time range, answer depth (Quick / Standard / Deep), and research sources (stored data, + AI research papers, + web).
- **Suggested questions** change with your focus; today's brief stories are one click away.
- **Conversation:** answers stream in, show which lookups ANU made, and list the evidence (dated, sourced updates) behind each answer. Follow-up questions keep the context; "New conversation" starts fresh.
- **Context panel:** the selected sector's state, money, watch list, upcoming events, companies and latest news, or the selected company's profile, all read straight from `data/` with no API cost.

`npm run app:dev` runs the same thing with hot reload while you change the UI (`app/`).

**Command line:** `npm run ask -- "What should I build in counter-drone?"`, or `npm run ask` for a conversation. Add `--web` to let it search the web.

**Free lookups (no API key):** `npm run kb -- <overview|updates|sector|companies|events|research|ideas|brief|semantic|related|papers> [query] [--sector id] …` prints JSON from `data/` (and Hugging Face Papers).

**In Claude Code:** `.claude/agents/anu.md` defines a `anu` subagent that answers from the same data through `npm run kb`, using your Claude Code plan instead of the API. Ask Claude Code to "use the anu agent" in this repo.

### Hugging Face models (free, run locally)

- **Semantic search** with [`bge-small-en-v1.5`](https://huggingface.co/Xenova/bge-small-en-v1.5): ANU finds updates, companies, research and ideas by meaning, so "cheap ways to stop drone swarms" finds microwave and interceptor stories with none of those words. Keyword and meaning scores are blended in update search, and `semantic_search` / `related_updates` are extra agent tools. Vectors are cached in `.hf-cache/` and only new items are embedded.
- **Company tagging** with [`bert-base-NER`](https://huggingface.co/Xenova/bert-base-NER): the daily collector tags the companies each story mentions (matched to the directory's spelling; governments, militaries and publishers are filtered out). `npm run enrich` backfills stored updates.
- **Research papers** from [Hugging Face Papers](https://huggingface.co/papers): the `search_papers` tool and the sector panel pull recent arXiv research on the technology behind a trend. Pick the sources in the app's "Research sources" dropdown.

The models run on your CPU through `@huggingface/transformers` (ONNX). The first run downloads about 150 MB of weights; no Hugging Face account or key is needed (set `HF_TOKEN` only if you hit rate limits on Papers search).

How it works: `src/kb.ts` holds the read-only queries; `src/hf.ts` and `src/semantic.ts` run the Hugging Face models; `src/anu.ts` gives them to Claude Opus 5.5 as tools (via the SDK's tool runner); `src/server.ts` streams answers to the React app in `app/`.

## Optional: Claude-written briefs (`npm run daily:claude`)

`src/daily.ts` and `src/pipeline.ts` research the news with Claude and web search and write richer briefs. That uses the paid Claude API (`ANTHROPIC_API_KEY`), so it is **not** part of the daily job. If a Claude-written brief exists for a date, the free collector leaves it alone.

## The Claude-hosted version

`public/index.html` is the same page published as a Claude artifact. Inside Claude it reads and writes the artifact's own database and offers Ask and a private notebook. Elsewhere it reads `api/v1/all.json` and is read-only.
