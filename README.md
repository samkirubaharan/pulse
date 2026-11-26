# Pulse

**The observability + V&V platform that checks the pulse of your LLM application.**

> *Your dashboard is green. Your LLM is slipping. Your customer already knows.*

Pulse is two platforms in one surface:

1. **Observability** — tells you *what moved* in production.
2. **Validation & Verification** — locks it in as a regression you can’t fall for again.

Classic metrics (uptime, p95, error rate) were built for deterministic software. A model that quietly gets dumber still returns HTTP 200 — it just takes more turns, burns more tokens, and leaves a lasting dent in your brand. Pulse surfaces the signals that catch that *before the customer does*, and then helps you turn those observations into the test cases you run before the next release.

![Observe — green strip, AI Advisor with three grounded buckets, five σ-banded drift tiles, novel-intent inbox](docs/screenshot-observe.png)

---

## The USP

Three competitors own one stage each; nobody owns the loop.

> **Observe** surfaces a pattern → **Alert** fires when it crosses a line → **Debug** pinpoints the trace → **Verify** locks it in as an eval case → fix → **Observe** confirms.

That loop is Pulse. Four surfaces, one span stream.

| Surface | For | What it answers |
|---|---|---|
| **Observe** | PMs, product owners | How is the agent behaving? What do customers actually ask? Where are we blind? |
| **Alerts** | SRE, on-call | Is something critical going wrong *right now* — drift, cache miss, injection? |
| **Debug** | Engineers | What happened on *this specific trace*? What's the behavioural context? |
| **Verify** | QA, platform teams | Which production observations do I need to lock in as eval cases? |

### Cross-cutting: Flows

Every surface respects a **Flow filter** — the user-journey slice:

- **Healthy** — the baseline shape
- **Drift** — σ-band breaches across the primary numeric factors
- **Novel intent** — top retrieval similarity below the grounding floor; your KB has a hole
- **Adversarial** — prompt-injection or jailbreak patterns in the user query
- **Tool-heavy** — more loops, more cost, more places to go wrong

Pick a slice once on any tab; every other tab inherits it via `?flow=<flow>` on the URL.

![Observe filtered to the Drift flow — tiles waiting for data, chip is live red](docs/screenshot-flow-drift.png)

---

## The four surfaces

### Alerts — verdict without a click

Every card carries severity + detector + status, headline, where/why, companion-metric row for paired signals, and the tripped metric's sparkline with σ-band. Ack / resolve / reopen inline, bulk-resolve, CSV export, "Promote to eval" on every card.

![Alerts — grouped by detector, promote-to-eval on every card](docs/screenshot-alerts.png)

### Debug — flow-aware trace list

Sort by latency, tokens, judge, grounding, turns, or cost. Open any row to pin behavioural context (this trace vs σ-band baseline) on the trace detail page.

![Debug — trace explorer with flow filter and sort options](docs/screenshot-debug.png)

### Verify — V&V, observations → eval cases

Promote from Alerts, Novel-Intent, or Advisor. Status workflow: draft → ready → passing/failing/archived. JSONL/JSON export for any eval harness.

![Verify — eval case store with promotion sources](docs/screenshot-verify.png)

---

## Signature features

### 1. The 5 drift factors, σ-banded

Every LLM call emits five universal numeric signals. Pulse σ-bands all five on seeded baselines and never fires on a single sample.

| # | Factor | Catches |
|---|---|---|
| 1 | **Turn count** | Agent silently adding iterations |
| 2 | **Output tokens** | Chattiness / cost creep |
| 3 | **Input + cache_read_tokens** (paired) | Real cache invalidation vs noisy variation |
| 4 | **Latency** | Backend wobble vs real regression (3-consecutive-breach rule) |
| 5 | **Tool calls** (count + composition) | Behavioural shift (the AMD Read:Edit fingerprint) |

Plus three semantic add-ons:

6. **Grounding %** (retrieval-side)
7. **Judge score %** (generation-side, Sonnet 4.6)
8. **Novel-Intent inbox** — queries that fell below the grounding floor, grouped by nearest KB doc

### 2. AI Advisor

On the Observe tab. Three grounded buckets that read observed metrics and tell you:

- **Things to note** — signals that are moving but haven't crossed an alert threshold yet
- **Things to internalise** — step-changes that have stabilised; baseline rebase candidates
- **Things to enhance** — eval candidates, KB gaps, cost tweaks (direct "Promote to eval" buttons)

Every note cites the metric it fired on. No LLM hallucination — stage-safe, deterministic, auditable.

### 3. Alert cards: verdict without a click

Each card carries the whole story before the click:

- **Headline** — what fired. *"Output tokens +23% over baseline σ-band"*
- **Where** — nearest KB doc or cluster
- **Why** — 1-line judge rationale from the worst sample
- **Trend** — sparkline of the tripped metric, σ-band shaded
- **Companion metric** — for paired signals (cache invalidation shows both lines)
- **Actions** — Ack, Resolve, Open trace, Promote to eval

### 4. Debug: Alert → Trace with behavioural context

Each trace detail pins its values against the σ-band baseline: turns, output tokens, latency, grounding. Engineers see *why this trace was pulled* without leaving the page.

Spans are coloured by kind (retrieval=indigo, tool_call=amber, llm_call=sky, judge=emerald). Proportional duration bars, kind-specific details on expand.

### 5. Verify: observations → eval cases

Every production observation becomes a candidate test case.

- Promote **Alerts** → prefilled with headline + why + trace id
- Promote **Novel intents** → prefilled with the gap query + nearest doc
- Promote **Advisor** notes → prefilled with kind + body
- Or type a new case manually

Status progresses `draft → ready → passing | failing | archived`. Export to JSONL/JSON and pipe into any external eval harness. Each case tags its origin so a reviewer can trace it back to the signal that produced it.

### 6. Statistical methodology (non-negotiable)

- σ-band over seeded baselines (mean ± k·σ, N ≥ 5+ runs). **No hardcoded ±%.**
- Distributional gates — a single sample never fires an alert.
- Multi-metric pairing — some signals mean nothing alone (factor #3 is the canonical case).
- Consecutive-breach rule — latency requires ≥3 consecutive out-of-band to fire.
- Step-change tolerance — plateaus rebase, not spam.

---

## Architecture

```
pulse/
├── apps/
│   ├── agent/           Customer Support Assistant (hand-rolled, clean spans)
│   ├── simulator/       Phase scenarios (healthy/drift/novel/adversarial)
│   └── dashboard/       Next.js — Observe / Alerts / Debug / Verify
├── packages/
│   └── telemetry/       Span SDK (~50 lines, wraps Anthropic SDK)
└── data/
    ├── spans.duckdb     Column-store, zero ops
    └── baselines.json   Seeded σ-band baselines per tile
```

| Layer | Pick | Why |
|---|---|---|
| Runtime | Node.js + TypeScript | One language across agent + dashboard |
| Agent LLM | Claude Haiku 4.5 | Fast, cheap |
| Judge LLM | Claude Sonnet 4.6 | Higher-quality scoring, offline batches |
| Embeddings | `@xenova/transformers` (MiniLM) | Local, free |
| Dashboard | Next.js 14 (App Router) | One process, UI + API + cron |
| UI | shadcn/ui + Tremor + Tailwind | Dashboard components out of the box |
| Charts | Recharts | σ-band shading |
| Store | DuckDB (single file) | Column-store speed on spans |
| Ingestion | `POST /api/spans` | No OTel collector / broker |
| Alerting | `node-cron` → in-app bell | Simple, free |
| Stats | hand-rolled σ-band + JSD | Working math, not clever math |

All MIT / Apache 2.0. Runs locally with `pnpm dev`.

---

## Quickstart

```bash
# 1. Install
pnpm install

# 2. Start the dashboard (http://localhost:3000)
pnpm --filter @pulse/dashboard dev

# 3. Seed demo spans + alerts (dev-only endpoint)
curl -X POST http://localhost:3000/api/dev/seed

# 4. Fire scenario traffic through the real agent (requires ANTHROPIC_API_KEY)
pnpm --filter @pulse/simulator start -- --phase all
```

Open each tab and try the Flow filter at the top — every surface slices.

---

## API surface

### Ingestion
- `POST /api/spans` — zod-validated span batch insert

### Query
- `GET /api/stats?flow=<flow>` — Observe tiles (σ-banded)
- `GET /api/alerts?flow=…&status=…&minutes=…` — alert inbox
- `GET /api/flows` — per-flow counts & judge/grounding means
- `GET /api/traces?flow=…&minutes=…` — trace summaries for Debug
- `GET /api/traces/[id]` — one trace, all spans

### Lifecycle
- `PATCH /api/alerts/[id]` — open | acked | resolved
- `POST  /api/alerts/bulk`  — bulk resolve by ids
- `GET   /api/alerts/export?format=csv|json`

### Validation & Verification
- `GET  /api/evals`                  — list eval cases
- `POST /api/evals`                  — create case (manual or promoted)
- `PATCH /api/evals/[id]`            — status transitions
- `DELETE /api/evals/[id]`           — remove
- `GET  /api/evals/export?format=jsonl|json`

### AI Advisor
- `GET  /api/advisor` — fresh + persisted grounded notes
- `POST /api/advisor` — dismiss

---

## Where Pulse stops

Pulse is deliberately not:

- a chat UI for the agent — the agent is observed, not exposed
- a LangChain / LangGraph wrapper — hand-rolled SDK for trace fidelity
- an OTel collector — direct POST ingestion
- auth / multi-tenancy / RBAC (yet — see [ENTERPRISE.md](./ENTERPRISE.md))
- hallucination detection on its own — judge rationale carries it

For the enterprise-grade parity list vs LangSmith and Arize Phoenix, see **[ENTERPRISE.md](./ENTERPRISE.md)**.

---

## Design document

The full design, phases, detectors, span schema, and demo arc are in **[DESIGN.md](./DESIGN.md)** (v4).

---

## Credits

Pulse was prompted by Sam K M’s Medium piece *"Securing Your LLM Tooling Against Silent Drift — Learning Alongside AMD"* (2026), and the five-factor drift mapping comes directly from that work.

The "observations → evals" loop that Verify closes was framed by [Priya Subbukutti](https://www.linkedin.com/in/priyasubbukutti/) in a LinkedIn exchange: *"how you connect what you observe in a live workflow back to the cases you test before the next release"*. Pulse's answer: every production signal gets a one-click promotion to a Verify case.
