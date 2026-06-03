/**
 * Smart AI Adaptive Weight Store
 * Weights self-adjust after each backtesting run in laporan-engine.ts
 * based on actual per-engine hit rates from retrospective LOO evaluation.
 *
 * State is held in-memory for fast synchronous reads (runSmartAI is sync and
 * called many times per backtest), and persisted to the smart_ai_weights table
 * so trained weights survive a server restart.
 */
import { db, smartAiWeightsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface EngineWeightInfo {
  id: string;
  name: string;
  defaultWeight: number;
  adaptiveWeight: number;
  hitRate: number;     // 0-1 actual accuracy from backtesting
  evalCount: number;
}

export interface SmartAIWeightsState {
  weights: Record<string, number>;
  hitRates: Record<string, number>;
  evalCounts: Record<string, number>;
  lastUpdated: string | null;
  isAdaptive: boolean;
  pasaran: string;
  detail: EngineWeightInfo[];
}

// Default weights based on algorithm theory
export const DEFAULT_WEIGHTS: Record<string, number> = {
  A: 0.28, // Transisi Slot — Markov chain (slot-specific transitions)
  B: 0.23, // Recency Eksponensial — exponential decay frequency
  C: 0.19, // Gap / Overdue — Poisson-based overdue detection
  D: 0.10, // Pola Hari — day-of-week seasonal pattern
  E: 0.08, // Momentum Tren — relative frequency shift
  F: 0.07, // Korelasi Posisi — conditional P(ekor|kepala) joint distribution
  G: 0.05, // Kembar / Siklus — cyclic interval detection
};

export const ENGINE_NAMES: Record<string, string> = {
  A: "Transisi Slot",
  B: "Recency Eksponensial",
  C: "Gap / Overdue",
  D: "Pola Hari + Slot",
  E: "Momentum Tren",
  F: "Korelasi Posisi",
  G: "Kembar / Siklus",
};

// Blend factor: 0 = all default, 1 = all adaptive
const ALPHA = 0.65;
// Minimum evaluations before updating weights
const MIN_EVALS = 15;

// Per-pasaran state
const state: Map<string, {
  weights: Record<string, number>;
  hitRates: Record<string, number>;
  evalCounts: Record<string, number>;
  lastUpdated: string | null;
}> = new Map();

function getState(pasaran: string) {
  if (!state.has(pasaran)) {
    state.set(pasaran, {
      weights: { ...DEFAULT_WEIGHTS },
      hitRates: {},
      evalCounts: {},
      lastUpdated: null,
    });
  }
  return state.get(pasaran)!;
}

/** Get current weights for a pasaran (adaptive if available, else default) */
export function getSmartAIWeights(pasaran = "macau"): Record<string, number> {
  return { ...getState(pasaran).weights };
}

/** Get full state for display/API */
export function getSmartAIWeightsState(pasaran = "macau"): SmartAIWeightsState {
  const s = getState(pasaran);
  const detail: EngineWeightInfo[] = Object.keys(DEFAULT_WEIGHTS).map(id => ({
    id,
    name: ENGINE_NAMES[id] ?? id,
    defaultWeight: DEFAULT_WEIGHTS[id] ?? 0,
    adaptiveWeight: s.weights[id] ?? DEFAULT_WEIGHTS[id] ?? 0,
    hitRate: s.hitRates[id] ?? 0,
    evalCount: s.evalCounts[id] ?? 0,
  }));
  return {
    weights: { ...s.weights },
    hitRates: { ...s.hitRates },
    evalCounts: { ...s.evalCounts },
    lastUpdated: s.lastUpdated,
    isAdaptive: s.lastUpdated !== null,
    pasaran,
    detail,
  };
}

/**
 * Update adaptive weights from backtesting hit rates.
 * hitRates: { A: 0.12, B: 0.08, ... } — per-engine fraction of evals where engine's top-5 included actual 2D
 * evalCounts: { A: 84, ... } — how many evaluations each engine was tested on
 */
export function updateSmartAIWeights(
  pasaran: string,
  hitRates: Record<string, number>,
  evalCounts: Record<string, number>,
): void {
  const totalEvals = Object.values(evalCounts).reduce((a, b) => a + b, 0) / Object.keys(evalCounts).length;
  if (totalEvals < MIN_EVALS) return;

  const s = getState(pasaran);
  s.hitRates = { ...hitRates };
  s.evalCounts = { ...evalCounts };

  const ids = Object.keys(DEFAULT_WEIGHTS);

  // Normalize hit rates to sum to 1 (proportional accuracy)
  const totalHitRate = ids.reduce((sum, id) => sum + (hitRates[id] ?? 0), 0);
  const normHitRate: Record<string, number> = {};
  for (const id of ids) {
    normHitRate[id] = totalHitRate > 0
      ? (hitRates[id] ?? 0) / totalHitRate
      : (DEFAULT_WEIGHTS[id] ?? 0);
  }

  // Blend: ALPHA × adaptive + (1-ALPHA) × default
  const blended: Record<string, number> = {};
  let total = 0;
  for (const id of ids) {
    blended[id] = (1 - ALPHA) * (DEFAULT_WEIGHTS[id] ?? 0) + ALPHA * normHitRate[id]!;
    total += blended[id];
  }

  // Renormalize to exactly sum to 1
  for (const id of ids) {
    s.weights[id] = total > 0 ? blended[id]! / total : DEFAULT_WEIGHTS[id]!;
  }

  s.lastUpdated = new Date().toISOString();

  // Fire-and-forget persist so trained weights survive a restart. The function
  // stays synchronous for callers in the hot LOO loop.
  void persistSmartAIWeights(pasaran, s);
}

/** Persist one pasaran's trained state to the DB (upsert on pasaran). */
async function persistSmartAIWeights(
  pasaran: string,
  s: { weights: Record<string, number>; hitRates: Record<string, number>; evalCounts: Record<string, number>; lastUpdated: string | null },
): Promise<void> {
  try {
    const row = {
      pasaran,
      weightsJson: JSON.stringify(s.weights),
      hitRatesJson: JSON.stringify(s.hitRates),
      evalCountsJson: JSON.stringify(s.evalCounts),
      lastUpdated: s.lastUpdated ? new Date(s.lastUpdated) : null,
      updatedAt: new Date(),
    };
    await db
      .insert(smartAiWeightsTable)
      .values(row)
      .onConflictDoUpdate({ target: smartAiWeightsTable.pasaran, set: row });
  } catch (err) {
    logger.warn({ err, pasaran }, "Smart AI: failed to persist adaptive weights");
  }
}

/**
 * Hydrate in-memory state from the DB. Call once at startup before serving so
 * previously-trained weights are restored. Safe to call when no rows exist.
 */
export async function loadAllSmartAIWeights(): Promise<void> {
  try {
    const rows = await db.select().from(smartAiWeightsTable);
    for (const row of rows) {
      const weights = safeParse(row.weightsJson, { ...DEFAULT_WEIGHTS });
      state.set(row.pasaran, {
        weights: { ...DEFAULT_WEIGHTS, ...weights },
        hitRates: safeParse(row.hitRatesJson, {}),
        evalCounts: safeParse(row.evalCountsJson, {}),
        lastUpdated: row.lastUpdated ? row.lastUpdated.toISOString() : null,
      });
    }
    if (rows.length > 0) {
      logger.info({ count: rows.length }, "Smart AI: loaded adaptive weights from DB");
    }
  } catch (err) {
    logger.warn({ err }, "Smart AI: failed to load adaptive weights from DB (using defaults)");
  }
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
