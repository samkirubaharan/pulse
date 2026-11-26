# Enterprise-grade parity — what Pulse still needs

**Target peers:** LangSmith (LangChain) · Arize Phoenix / AX · Datadog LLM Observability · Weights & Biases Weave.

This doc is the candid gap list between today's Pulse and an enterprise-grade AI observability + validation platform. Pulse's DNA is the loop (Observe → Alert → Debug → Verify) and the σ-band discipline — none of what follows gets added if it weakens either.

## Legend

- ✅ shipped
- 🟡 partial / demo-grade; needs hardening
- ⬜ not started
- 🔵 Pulse differentiator (either already distinct or planned-distinct)

---

## 1. Ingestion & SDK

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Hand-rolled TypeScript SDK | ✅ | ✅ | ✅ | ~50 lines, wraps Anthropic SDK |
| Python SDK | ⬜ | ✅ | ✅ | Required for broadest coverage |
| OpenTelemetry collector compatibility | ⬜ | ✅ | ✅ | OTel LLM semantic conventions |
| Direct HTTP ingest (`POST /spans`) | ✅ | ✅ | ✅ | zod-validated |
| Batched + streaming ingestion | 🟡 | ✅ | ✅ | We batch; need backpressure + retry |
| Auto-instrumentation (LangChain, LlamaIndex, OpenAI SDK) | ⬜ | ✅ | ✅ | Opt-in middleware |
| Multi-language agents (Python, Go, Rust) | ⬜ | ✅ | ✅ | At least Python next |
| Client-side sampling + head-based sampling | ⬜ | ✅ | ✅ | For traffic-shaped bills |
| Span redaction (PII) at the SDK | ⬜ | ✅ | ✅ | Required for SOC2 |

## 2. Data model & storage

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Hierarchical spans (trace → span → child) | 🟡 | ✅ | ✅ | We model parent_span_id; agent doesn't nest yet |
| OTel-compatible schema | ⬜ | ✅ | ✅ | Map attrs → gen-ai.* namespace |
| Attachments (tool-call payloads, retrieval docs) | 🟡 | ✅ | ✅ | Store inline today; large payloads need blob store |
| Dataset versioning | ⬜ | ✅ | ✅ | For eval reproducibility |
| Columnar store | ✅ | ✅ | ✅ | DuckDB; scales to single-node 100M spans |
| Partitioning / TTL retention | ⬜ | ✅ | ✅ | Needed for multi-month history |
| Multi-tenant isolation | ⬜ | ✅ | ✅ | Org / project / environment hierarchy |
| S3 / ClickHouse / BigQuery sinks | ⬜ | ✅ | ✅ | Export pipeline for data teams |

## 3. Observability (Observe tab)

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Traditional metrics strip (uptime/p95/err/req) | ✅ | ✅ | ✅ | The "always green" frame 🔵 |
| σ-band on primary numeric factors (5) | ✅ | 🟡 | 🟡 | 🔵 Both peers rely on thresholds or anomaly ML rather than seeded σ-bands |
| Paired-signal tile (input + cache_read) | ✅ | ⬜ | ⬜ | 🔵 Pulse-native |
| Composition-shift tile (Jensen-Shannon on tool.name) | ✅ | 🟡 | 🟡 | 🔵 "AMD fingerprint" |
| Grounding % (retrieval-side) | ✅ | ✅ | ✅ | |
| Judge score % (generation-side) | ✅ | ✅ | ✅ | We use Sonnet 4.6 |
| Novel-Intent inbox | ✅ | 🟡 | 🟡 | 🔵 Grouped by nearest KB doc, directly promotable to eval |
| AI Advisor | ✅ | ⬜ | ⬜ | 🔵 Three-bucket grounded guidance |
| Cost tracking + budget alerting | 🟡 | ✅ | ✅ | $ overlay on output-tokens tile; budget not built |
| User-level segmentation | ⬜ | ✅ | ✅ | Group by user_id, session, tenant |
| Latency percentiles (p50/p95/p99) | 🟡 | ✅ | ✅ | p95 only today; expose all three |
| Slice & dice by arbitrary attribute | ⬜ | ✅ | ✅ | Needs a query builder; Flow filter is the MVP |
| Comparison view (A/B two prompts or models) | ⬜ | ✅ | ✅ | Essential for release validation |

## 4. Alerting

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Rule-based (σ-band detectors) | ✅ | ✅ | ✅ | 8 detectors ship today |
| Ack / Resolve / Reopen | ✅ | ✅ | ✅ | |
| Bulk resolve + CSV export | ✅ | ✅ | ✅ | |
| Group-by detector view | ✅ | 🟡 | 🟡 | |
| Time-window filter | ✅ | ✅ | ✅ | |
| Slack / PagerDuty / Email webhooks | ⬜ | ✅ | ✅ | Required for on-call |
| SLO tracking (error budget burn) | ⬜ | ✅ | ✅ | For SRE teams |
| Rule editor UI | ⬜ | ✅ | ✅ | No-code detector tuning |
| Noise suppression (dedupe across windows) | ✅ | ✅ | ✅ | 5-min dedupe on (detector, metric) |
| Multi-metric fingerprint matching | ✅ | 🟡 | 🟡 | 🔵 Advisor surfaces drift signatures across ≥2 tiles |

## 5. Debug & trace explorer

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Trace timeline (proportional bars, kind-coloured) | ✅ | ✅ | ✅ | |
| Inline retrieval-hits visualisation | ✅ | ✅ | ✅ | Bar per doc score |
| Tool-call args/result inspector | ✅ | ✅ | ✅ | |
| Behavioural context panel (this trace vs baseline) | ✅ | 🟡 | 🟡 | 🔵 Side-by-side σ-band compare on the trace |
| Full-text search across traces | 🟡 | ✅ | ✅ | Client-side today; needs server-side indexing |
| Jump from alert → specific trace | ✅ | ✅ | ✅ | |
| Similar-trace discovery | ⬜ | ✅ | ✅ | Cluster by embedding / detector fingerprint |
| Diff two traces | ⬜ | ✅ | ✅ | For regression hunting |
| Replay / fork a trace | ⬜ | ✅ | ✅ | Paste the trace into the playground |

## 6. Validation & Verification (Verify tab)

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Eval case store (DuckDB) | ✅ | ✅ | ✅ | |
| Observations → eval promotion | ✅ | 🟡 | 🟡 | 🔵 One-click from Alert, Novel-Intent, or Advisor |
| Case status workflow (draft → ready → passing/failing) | ✅ | ✅ | ✅ | |
| JSONL / JSON export | ✅ | ✅ | ✅ | Pipe into any external harness |
| Built-in eval runner | ⬜ | ✅ | ✅ | Execute cases against the agent, record pass/fail |
| LLM-as-judge integration | 🟡 | ✅ | ✅ | Sonnet 4.6 judges spans today; needs a case-vs-case flow |
| Human review queue | ⬜ | ✅ | ✅ | QA annotations, inter-rater agreement |
| Dataset versioning + snapshots | ⬜ | ✅ | ✅ | Pin an eval set to a release tag |
| Regression report (this release vs last) | ⬜ | ✅ | 🟡 | |
| Golden set + promotion workflow | ⬜ | ✅ | ✅ | Validated cases → canary / blocking in CI |
| A/B prompt comparison on cases | ⬜ | ✅ | 🟡 | |
| Programmatic rubric evaluators | ⬜ | ✅ | ✅ | Code-based assertions: contains, regex, cosine sim |

## 7. Multi-tenant & governance

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Orgs / projects / environments | ⬜ | ✅ | ✅ | Prerequisite for team use |
| SSO (SAML, OIDC) | ⬜ | ✅ | ✅ | Enterprise table-stakes |
| RBAC | ⬜ | ✅ | ✅ | Reader / writer / admin |
| Audit log | ⬜ | ✅ | ✅ | Who acked what, when |
| API keys (scoped, rotatable) | ⬜ | ✅ | ✅ | For CI + SDK auth |
| PII redaction in transit + at rest | ⬜ | ✅ | ✅ | SOC2 / HIPAA / GDPR |
| Data residency (region pinning) | ⬜ | ✅ | ✅ | EU-only ingest option |
| Private cloud / on-prem deploy | ⬜ | ✅ | ✅ | Helm chart or docker-compose |

## 8. Experimentation / playground

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| In-app prompt playground | ⬜ | ✅ | ✅ | Replay a trace with a new prompt |
| Model comparison runner | ⬜ | ✅ | ✅ | Haiku vs Sonnet on the same eval set |
| Prompt versioning + diff | ⬜ | ✅ | ✅ | Linked to trace lineage |
| Shareable public reports | ⬜ | ✅ | ✅ | Export a drift story as a link |

## 9. Ops & platform

| Capability | Pulse | LangSmith | Arize | Notes |
|---|---|---|---|---|
| Health dashboard for Pulse itself | ⬜ | ✅ | ✅ | Ingestion lag, detector latency, DB size |
| Horizontal scale ingestion | ⬜ | ✅ | ✅ | Current: single Next.js process |
| Backpressure + replay | ⬜ | ✅ | ✅ | Kafka or similar in front of the DB |
| Backup + point-in-time restore | ⬜ | ✅ | ✅ | DuckDB file today; tar + S3 shortest path |
| Observability for the observer | ⬜ | ✅ | ✅ | self-telemetry (ironic but needed) |

---

## The 20% that gets 80% of enterprise readiness

If someone were to ship this to a Fortune 500 account tomorrow, this is the prioritised build order:

1. **SSO + RBAC + orgs/projects/environments** — the gate on every enterprise deal.
2. **Slack / PagerDuty webhooks + rule-editor UI** — makes Alerts actionable without a redeploy.
3. **Python SDK + OTel compatibility** — unlocks ~80% of production LLM stacks.
4. **Comparison view (A/B two prompts or models)** — the single most-requested observability feature from release engineers.
5. **Eval runner that executes Verify cases against the agent** — closes the loop end-to-end rather than exporting to an external harness.
6. **PII redaction at the SDK + at rest** — prerequisite for anything in regulated industries.
7. **Dataset versioning + regression report** — pin an eval set to a git tag, compare passes/fails across releases.
8. **Horizontal ingestion + back-pressure (Kafka / SQS)** — the reason the single-process demo starts to wobble past ~1k req/s.

Everything else is either a nice-to-have, or follows naturally once the above lands.

---

## What Pulse already does better

Keep these as the moat — don't trade them away in the parity push:

- **The loop.** Observe → Alert → Debug → Verify on one span stream, in one UI, with one data model.
- **σ-band discipline.** Peers alert on thresholds or black-box anomaly ML; Pulse alerts on seeded σ-bands with consecutive-breach and paired-signal rules.
- **Multi-tile fingerprint.** The AMD-style read of *several* metrics moving together, not one.
- **Novel-Intent inbox.** Drift isn't only model regression — Pulse exposes world-shift explicitly.
- **AI Advisor on Observe.** Three grounded buckets; cites the metric that fired; no LLM hallucination.
- **Observations → Verify.** One-click promotion from any production signal. Peers make you do this through APIs and SDK calls.
- **The pitch itself.** *"Your dashboard is green. Your LLM is slipping. Your customer already knows."* That line sells before the demo opens.
