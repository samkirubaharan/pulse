#!/usr/bin/env node
/**
 * Simulator runner — fires scripted queries at the Customer Support Agent
 * across the four demo phases (healthy / drift / novel / adversarial).
 *
 * Usage:
 *   pnpm --filter simulator start -- --phase 1
 *   pnpm --filter simulator start -- --phase all
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import 'dotenv/config';

import { handleQuery, type SystemPromptMode } from '@pulse/agent';
import { flushSpans } from '@pulse/telemetry';

// ---------- Scenario types ----------

type IntentCluster =
  | 'schedule'
  | 'registration'
  | 'pricing'
  | 'format'
  | 'session_proposal'
  | 'conduct'
  | 'food'
  | 'networking'
  | 'sponsors'
  | 'visa'
  | `gap:${string}`;

interface ScenarioQuery {
  id: string;
  text: string;
  expect_grounding: boolean;
  expected_intent_cluster: IntentCluster;
  adversarial?: boolean;
  injection_pattern?: string;
}

interface Scenario {
  phase: number;
  name: string;
  description: string;
  system_prompt_mode: SystemPromptMode;
  inter_query_delay_ms?: number;
  queries: ScenarioQuery[];
}

interface PhaseResult {
  phase: number;
  name: string;
  queries: number;
  meanTurns: number;
  totalSpans: number;
  elapsedMs: number;
}

// ---------- CLI parsing ----------

function parseArgs(argv: string[]): { phase: string } {
  let phase = '1';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--phase') {
      phase = argv[i + 1] ?? '1';
      i++;
    } else if (arg.startsWith('--phase=')) {
      phase = arg.slice('--phase='.length);
    }
  }
  return { phase };
}

// ---------- Scenario loading ----------

const SCENARIOS_DIR = resolve(__dirname, '..', 'scenarios');

function loadScenario(filename: string): Scenario {
  const full = join(SCENARIOS_DIR, filename);
  const raw = readFileSync(full, 'utf8');
  const parsed = parseYaml(raw) as Scenario;
  if (!parsed || !Array.isArray(parsed.queries)) {
    throw new Error(`Scenario ${filename} is malformed: missing queries[]`);
  }
  return parsed;
}

function scenariosForPhase(phase: string): string[] {
  if (phase === 'all') {
    return readdirSync(SCENARIOS_DIR)
      .filter((f) => /^phase\d+_.+\.ya?ml$/i.test(f))
      .sort();
  }
  const prefix = `phase${phase}_`;
  const matches = readdirSync(SCENARIOS_DIR).filter((f) => f.startsWith(prefix));
  if (matches.length === 0) {
    throw new Error(`No scenario file found for --phase ${phase} in ${SCENARIOS_DIR}`);
  }
  return matches.sort();
}

// ---------- Sleep ----------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Rendering ----------

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : flat.slice(0, n) + '…';
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printSummaryTable(results: PhaseResult[]): void {
  console.log('');
  console.log('='.repeat(78));
  console.log('Simulator summary');
  console.log('='.repeat(78));
  const header = ['Phase', 'Name', 'Queries', 'Mean turns', 'Total spans', 'Elapsed'];
  const rows = results.map((r) => [
    String(r.phase),
    r.name,
    String(r.queries),
    r.meanTurns.toFixed(2),
    String(r.totalSpans),
    formatMs(r.elapsedMs),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(fmt(row));
  console.log('='.repeat(78));
}

// ---------- Core run loop ----------

async function runScenario(scenario: Scenario): Promise<PhaseResult> {
  const delay = scenario.inter_query_delay_ms ?? 150;
  const mode: SystemPromptMode = scenario.system_prompt_mode;
  const started = Date.now();

  console.log('');
  console.log(
    `── Phase ${scenario.phase} · ${scenario.name} · mode=${mode} · ${scenario.queries.length} queries ──`,
  );
  if (scenario.description) console.log(scenario.description);

  let totalTurns = 0;
  let totalSpans = 0;
  let completed = 0;

  for (let i = 0; i < scenario.queries.length; i++) {
    const q = scenario.queries[i];
    try {
      const res = await handleQuery(q.text, { systemPromptMode: mode });
      totalTurns += res.turns;
      totalSpans += res.spans_emitted;
      completed++;
      console.log(
        `  [${String(i + 1).padStart(3, ' ')}/${scenario.queries.length}] ${q.id} ` +
          `trace=${res.trace_id} turns=${res.turns} spans=${res.spans_emitted} ` +
          `→ ${truncate(res.response, 80)}`,
      );
    } catch (err) {
      console.error(
        `  [${String(i + 1).padStart(3, ' ')}/${scenario.queries.length}] ${q.id} FAILED: ${(err as Error).message}`,
      );
    }
    if (i < scenario.queries.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }

  // Flush after the last query so every span posts before the next phase (or exit).
  await flushSpans();

  const elapsedMs = Date.now() - started;
  const meanTurns = completed > 0 ? totalTurns / completed : 0;

  return {
    phase: scenario.phase,
    name: scenario.name,
    queries: scenario.queries.length,
    meanTurns,
    totalSpans,
    elapsedMs,
  };
}

// ---------- Entrypoint ----------

export async function runPhase(phase: string): Promise<PhaseResult[]> {
  const files = scenariosForPhase(phase);
  const results: PhaseResult[] = [];
  for (const file of files) {
    const scenario = loadScenario(file);
    const result = await runScenario(scenario);
    results.push(result);
  }
  printSummaryTable(results);
  return results;
}

async function main(): Promise<void> {
  const { phase } = parseArgs(process.argv.slice(2));
  await runPhase(phase);
}

// Only auto-run when invoked as a script (not when imported by src/index.ts).
if (require.main === module) {
  main().catch((err) => {
    console.error('Simulator failed:', err);
    process.exit(1);
  });
}
