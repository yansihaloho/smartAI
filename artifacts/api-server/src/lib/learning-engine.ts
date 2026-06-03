// Self-Learning Engine: evaluates predictions vs actual results, adjusts engine weights dynamically
import { db, engineWeightsTable, missAnalysisTable, predictionsTable, lotteryResultsTable, predictionAccuracyTable } from "@workspace/db";
import { eq, desc, lt, and, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

export type CategoryKey = "markov" | "gap" | "bayes" | "ts" | "nn" | "pattern" | "stat" | "shio" | "momentum";

export interface CategoryWeightMap {
  [key: string]: number;
  markov: number;
  gap: number;
  bayes: number;
  ts: number;
  nn: number;
  pattern: number;
  stat: number;
  shio: number;
  momentum: number;
}

const DEFAULT_WEIGHTS: CategoryWeightMap = {
  markov: 1.0, gap: 1.0, bayes: 1.0, ts: 1.0, nn: 1.0,
  pattern: 1.0, stat: 1.0, shio: 1.0, momentum: 1.0,
};

// Maps engine category display names → internal keys
const CATEGORY_TO_KEY: Record<string, CategoryKey> = {
  "Markov Chain": "markov",
  "Poisson & Gap Analysis": "gap",
  "Bayesian & Probabilistic": "bayes",
  "Time Series & Recency": "ts",
  "Neural Network": "nn",
  "Pattern Recognition": "pattern",
  "Statistical Analysis": "stat",
  "Shio & Numerology": "shio",
  "Momentum & Volatility": "momentum",
};

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  markov: "Markov Chain",
  gap: "Poisson & Gap Analysis",
  bayes: "Bayesian & Probabilistic",
  ts: "Time Series & Recency",
  nn: "Neural Network",
  pattern: "Pattern Recognition",
  stat: "Statistical Analysis",
  shio: "Shio & Numerology",
  momentum: "Momentum & Volatility",
};

// EMA smoothing factor: how fast new data updates old weights
// 0.15 = slow and stable (15% of weight from newest evaluation)
const EMA_ALPHA = 0.15;

// Neutral baseline: expected score if engine picks randomly in top-3 across 4 positions
// P(random top-1 hit) = 0.1, top-2 = 0.1, top-3 = 0.1 → weighted = 0.1*1+0.1*0.5+0.1*0.25 = 0.175
const NEUTRAL_SCORE = 0.175;

// Score an engine's top-3 picks against the actual result for a single draw
// Returns 0.0 (complete miss) to 1.0 (perfect: top-1 correct on all 4 positions)
function scoreEngineVsActual(
  engineDigits: { as: string[]; kop: string[]; kepala: string[]; ekor: string[] },
  actual: { as: string; kop: string; kepala: string; ekor: string }
): number {
  const positions = ["as", "kop", "kepala", "ekor"] as const;
  let total = 0;
  for (const pos of positions) {
    const picks = engineDigits[pos] ?? [];
    const a = actual[pos];
    if (picks[0] === a) total += 1.0;
    else if (picks[1] === a) total += 0.5;
    else if (picks[2] === a) total += 0.25;
  }
  return total / 4;
}

// Get adaptive weight multipliers from DB (or defaults if not enough data)
export async function getAdaptiveWeights(pasaran: string): Promise<CategoryWeightMap> {
  try {
    const [row] = await db
      .select()
      .from(engineWeightsTable)
      .where(eq(engineWeightsTable.pasaran, pasaran))
      .limit(1);

    if (!row || row.sampleSize < 3) {
      return { ...DEFAULT_WEIGHTS };
    }

    const stored = JSON.parse(row.weightsJson) as Record<string, number>;
    const merged: CategoryWeightMap = { ...DEFAULT_WEIGHTS };
    for (const [k, v] of Object.entries(stored)) {
      if (typeof v === "number") merged[k] = v;
    }
    return merged;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

// Get readable weight table for display
export async function getWeightTable(pasaran: string): Promise<Array<{ category: string; key: string; multiplier: number; sampleSize: number }>> {
  const weights = await getAdaptiveWeights(pasaran);
  const [row] = await db
    .select({ sampleSize: engineWeightsTable.sampleSize })
    .from(engineWeightsTable)
    .where(eq(engineWeightsTable.pasaran, pasaran))
    .limit(1);

  const sampleSize = row?.sampleSize ?? 0;
  return (Object.keys(weights) as CategoryKey[]).map(key => ({
    key,
    category: CATEGORY_LABELS[key],
    multiplier: Math.round(weights[key] * 1000) / 1000,
    sampleSize,
  }));
}

// Core self-learning: evaluate the most recent prediction vs the latest actual result
// Called automatically after each new draw result is synced
export async function evaluateAndLearn(pasaran: string): Promise<{
  evaluated: boolean;
  actualResult: string;
  hit4d: boolean;
  hit2d: boolean;
  hit3d: boolean;
  hitBbfs6: boolean;
  hitColokBebas: boolean;
  learningNote: string;
  bestCategory: string;
  worstCategory: string;
  categoryScores: Record<string, number>;
}> {
  const defaultResult = {
    evaluated: false,
    actualResult: "",
    hit4d: false, hit2d: false, hit3d: false, hitBbfs6: false, hitColokBebas: false,
    learningNote: "Tidak ada data untuk dievaluasi",
    bestCategory: "",
    worstCategory: "",
    categoryScores: {},
  };

  try {
    // Get the most recent actual lottery result
    const [latestResult] = await db
      .select()
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran))
      .orderBy(desc(lotteryResultsTable.id))
      .limit(1);

    if (!latestResult) return defaultResult;

    // Get the most recent prediction whose DATA CUTOFF is strictly older than this
    // result's periode. The cutoff is the latest draw the prediction was allowed to
    // see when it was generated, so requiring `dataCutoffPeriode < latestResult.periode`
    // proves the prediction is being scored against a draw it never ingested — a true
    // out-of-sample evaluation. This is stronger than the old `generatedAt < createdAt`
    // (DB sync time) guard, which could still score a draw that was publicly visible
    // before it was synced into the DB.
    const [prediction] = await db
      .select()
      .from(predictionsTable)
      .where(and(
        eq(predictionsTable.pasaran, pasaran),
        isNotNull(predictionsTable.dataCutoffPeriode),
        lt(predictionsTable.dataCutoffPeriode, latestResult.periode),
      ))
      .orderBy(desc(predictionsTable.generatedAt))
      .limit(1);

    if (!prediction) {
      return { ...defaultResult, learningNote: "Belum ada prediksi out-of-sample (dengan cutoff data lebih lama dari hasil ini) — tidak bisa dievaluasi tanpa look-ahead" };
    }

    // Skip if we've already evaluated this combination recently (same prediction + same result)
    const recentEval = await db
      .select({ id: missAnalysisTable.id })
      .from(missAnalysisTable)
      .where(
        and(
          eq(missAnalysisTable.pasaran, pasaran),
          eq(missAnalysisTable.actualResult, latestResult.result4d),
          eq(missAnalysisTable.predictionId, prediction.id)
        )
      )
      .limit(1);

    if (recentEval.length > 0) {
      logger.info({ pasaran, predictionId: prediction.id }, "Learning: already evaluated this draw");
      return { ...defaultResult, evaluated: false, learningNote: "Sudah dievaluasi sebelumnya" };
    }

    const actual = {
      as: latestResult.as,
      kop: latestResult.kop,
      kepala: latestResult.kepala,
      ekor: latestResult.ekor,
    };
    const actual4d = latestResult.result4d;

    // Parse prediction engines
    const engines: Array<{
      engineId: number;
      engineName: string;
      category: string;
      digits: { as: string[]; kop: string[]; kepala: string[]; ekor: string[] };
      confidence: number;
      weight: number;
    }> = (() => {
      try { return JSON.parse(prediction.enginesJson); } catch { return []; }
    })();

    if (engines.length === 0) {
      return { ...defaultResult, learningNote: "Tidak ada engine data dalam prediksi tersimpan" };
    }

    // Score each engine vs actual result
    const engineScores: Array<{ category: string; key: CategoryKey; score: number; weight: number }> = [];
    for (const eng of engines) {
      const catKey = CATEGORY_TO_KEY[eng.category];
      if (!catKey) continue;
      const score = scoreEngineVsActual(eng.digits, actual);
      engineScores.push({ category: eng.category, key: catKey, score, weight: eng.weight });
    }

    // Group by category → weighted average score
    const categoryScoreMap: Record<CategoryKey, { totalScore: number; totalWeight: number }> = {} as any;
    for (const es of engineScores) {
      if (!categoryScoreMap[es.key]) categoryScoreMap[es.key] = { totalScore: 0, totalWeight: 0 };
      categoryScoreMap[es.key].totalScore += es.score * es.weight;
      categoryScoreMap[es.key].totalWeight += es.weight;
    }

    const categoryScores: Record<string, number> = {};
    let bestCat = { key: "markov" as CategoryKey, score: -1 };
    let worstCat = { key: "shio" as CategoryKey, score: 999 };

    for (const [key, { totalScore, totalWeight }] of Object.entries(categoryScoreMap) as [CategoryKey, { totalScore: number; totalWeight: number }][]) {
      const avgScore = totalWeight > 0 ? totalScore / totalWeight : 0;
      categoryScores[key] = Math.round(avgScore * 1000) / 1000;
      if (avgScore > bestCat.score) bestCat = { key, score: avgScore };
      if (avgScore < worstCat.score) worstCat = { key, score: avgScore };
    }

    // Hit checks
    const hit4d = prediction.consensus4d.includes(actual4d);
    const hit3d = prediction.consensus3d.includes(actual4d.slice(1));
    const hit2d = prediction.consensus2d.includes(actual4d.slice(2));
    const hitBbfs6 = actual4d.split("").every(d => prediction.bbfs6.includes(d));
    const hitColokBebas = prediction.colokBebas.includes(actual4d[3] ?? "");

    const asHit = prediction.consensus4d.some(n => n[0] === actual.as);
    const kopHit = prediction.consensus4d.some(n => n[1] === actual.kop);
    const kepalaHit = prediction.consensus2d.some(n => n[0] === actual.kepala);
    const ekorHit = prediction.colokBebas.includes(actual.ekor);

    // Build learning note
    const hitPositions = [
      asHit && "AS", kopHit && "KOP", kepalaHit && "KEPALA", ekorHit && "EKOR"
    ].filter(Boolean);

    const missPositions = [
      !asHit && "AS", !kopHit && "KOP", !kepalaHit && "KEPALA", !ekorHit && "EKOR"
    ].filter(Boolean);

    const bestLabel = CATEGORY_LABELS[bestCat.key] ?? bestCat.key;
    const worstLabel = CATEGORY_LABELS[worstCat.key] ?? worstCat.key;
    const bestPct = Math.round(bestCat.score / NEUTRAL_SCORE * 100);
    const worstPct = Math.round(worstCat.score / NEUTRAL_SCORE * 100);

    let learningNote = "";
    if (hit4d) {
      learningNote = `✅ JACKPOT 4D! Hasil ${actual4d} tepat di prediksi. Engine ${bestLabel} memimpin (skor ${bestPct}% di atas baseline).`;
    } else if (hit2d) {
      learningNote = `⚡ HIT 2D! Hasil ${actual4d} — Kepala+Ekor (${actual4d.slice(2)}) tepat. ` +
        `Posisi meleset: ${missPositions.join(", ")}. Engine terbaik: ${bestLabel}. ` +
        `Evaluasi: tingkatkan bobot ${bestLabel}, kurangi ${worstLabel} (${worstPct}% baseline).`;
    } else {
      learningNote = `❌ MISS. Hasil ${actual4d}. Prediksi meleset di: ${missPositions.join(", ")}. ` +
        `Posisi tepat: ${hitPositions.length > 0 ? hitPositions.join(", ") : "tidak ada"}. ` +
        `Engine ${bestLabel} paling mendekati (${bestPct}% baseline). ` +
        `Engine ${worstLabel} performa terburuk (${worstPct}% baseline). ` +
        `Sistem sedang menyesuaikan bobot untuk pengeluaran berikutnya.`;
    }

    // Update adaptive weights using EMA
    const currentWeights = await getAdaptiveWeights(pasaran);
    const newWeights = { ...currentWeights };
    const adjustments: Record<string, number> = {};

    for (const [key, score] of Object.entries(categoryScores) as [CategoryKey, number][]) {
      const normalizedScore = score / NEUTRAL_SCORE; // 1.0 = baseline random performance
      const clampedScore = Math.max(0.3, Math.min(2.5, normalizedScore));
      const oldMultiplier = currentWeights[key] ?? 1.0;
      // EMA: mostly keep old weight, slowly incorporate new data
      const newMultiplier = oldMultiplier * (1 - EMA_ALPHA) + clampedScore * EMA_ALPHA;
      newWeights[key] = Math.round(Math.max(0.3, Math.min(2.5, newMultiplier)) * 1000) / 1000;
      adjustments[key] = Math.round((newWeights[key] - oldMultiplier) * 1000) / 1000;
    }

    // Get current sample size
    const [existingRow] = await db
      .select({ sampleSize: engineWeightsTable.sampleSize })
      .from(engineWeightsTable)
      .where(eq(engineWeightsTable.pasaran, pasaran))
      .limit(1);

    const newSampleSize = (existingRow?.sampleSize ?? 0) + 1;

    // Upsert engine weights
    await db
      .insert(engineWeightsTable)
      .values({
        pasaran,
        weightsJson: JSON.stringify(newWeights),
        sampleSize: newSampleSize,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: engineWeightsTable.pasaran,
        set: {
          weightsJson: JSON.stringify(newWeights),
          sampleSize: newSampleSize,
          updatedAt: new Date(),
        },
      });

    // Store miss analysis record
    await db.insert(missAnalysisTable).values({
      pasaran,
      predictionId: prediction.id,
      actualResult: actual4d,
      predicted4dTop5: prediction.consensus4d.slice(0, 5),
      predicted2dTop5: prediction.consensus2d.slice(0, 5),
      asHit,
      kopHit,
      kepalaHit,
      ekorHit,
      hit2d,
      hit3d,
      hit4d,
      hitBbfs6,
      hitColokBebas,
      bestCategory: bestCat.key,
      bestCategoryScore: bestCat.score,
      worstCategory: worstCat.key,
      worstCategoryScore: worstCat.score,
      learningNote,
      categoryScoresJson: JSON.stringify(categoryScores),
      weightAdjustmentsJson: JSON.stringify(adjustments),
      createdAt: new Date(),
    });

    // Record an HONEST accuracy row: this prediction was made before the result
    // was synced (guaranteed by the look-ahead guard above), so /predict/accuracy
    // reflects genuine out-of-sample performance, not in-sample scoring.
    try {
      await db.insert(predictionAccuracyTable).values({
        pasaran,
        predictionId: prediction.id,
        predicted4d: prediction.consensus4d,
        predicted2d: prediction.consensus2d,
        predictedBbfs6: prediction.bbfs6,
        predictedColokBebas: prediction.colokBebas,
        actualResult: actual4d,
        hit4d,
        hit3d,
        hit2d,
        hitBbfs6,
        hitColokBebas,
        checkedAt: new Date(),
      });
    } catch (accErr) {
      logger.warn({ accErr, pasaran, predictionId: prediction.id }, "Learning: failed to record accuracy row");
    }

    logger.info({
      pasaran,
      actual: actual4d,
      hit4d,
      hit2d,
      hit3d,
      sampleSize: newSampleSize,
      bestCategory: bestCat.key,
      worstCategory: worstCat.key,
    }, "Learning: evaluation complete, weights updated");

    return {
      evaluated: true,
      actualResult: actual4d,
      hit4d,
      hit2d,
      hit3d,
      hitBbfs6,
      hitColokBebas,
      learningNote,
      bestCategory: bestLabel,
      worstCategory: worstLabel,
      categoryScores,
    };
  } catch (err) {
    logger.error({ err, pasaran }, "Learning: evaluation failed");
    return { ...defaultResult, learningNote: `Error evaluasi: ${String(err)}` };
  }
}

// Get recent evaluation logs
export async function getLearningLog(pasaran: string, limit = 20): Promise<Array<{
  id: number;
  actualResult: string;
  hit4d: boolean;
  hit3d: boolean;
  hit2d: boolean;
  hitBbfs6: boolean;
  hitColokBebas: boolean;
  asHit: boolean;
  kopHit: boolean;
  kepalaHit: boolean;
  ekorHit: boolean;
  predicted4dTop5: string[];
  bestCategory: string;
  worstCategory: string;
  bestCategoryScore: number;
  worstCategoryScore: number;
  categoryScores: Record<string, number>;
  weightAdjustments: Record<string, number>;
  learningNote: string;
  createdAt: string;
}>> {
  try {
    const rows = await db
      .select()
      .from(missAnalysisTable)
      .where(eq(missAnalysisTable.pasaran, pasaran))
      .orderBy(desc(missAnalysisTable.createdAt))
      .limit(limit);

    return rows.map(r => ({
      id: r.id,
      actualResult: r.actualResult,
      hit4d: r.hit4d,
      hit3d: r.hit3d,
      hit2d: r.hit2d,
      hitBbfs6: r.hitBbfs6,
      hitColokBebas: r.hitColokBebas,
      asHit: r.asHit,
      kopHit: r.kopHit,
      kepalaHit: r.kepalaHit,
      ekorHit: r.ekorHit,
      predicted4dTop5: r.predicted4dTop5,
      bestCategory: r.bestCategory ?? "",
      worstCategory: r.worstCategory ?? "",
      bestCategoryScore: r.bestCategoryScore ?? 0,
      worstCategoryScore: r.worstCategoryScore ?? 0,
      categoryScores: (() => { try { return JSON.parse(r.categoryScoresJson); } catch { return {}; } })(),
      weightAdjustments: (() => { try { return JSON.parse(r.weightAdjustmentsJson); } catch { return {}; } })(),
      learningNote: r.learningNote,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    logger.error({ err, pasaran }, "Learning: failed to get learning log");
    return [];
  }
}

// Get engine category performance summary over last N evaluations
export async function getEnginePerformance(pasaran: string, limit = 50): Promise<Array<{
  key: string;
  category: string;
  avgScore: number;
  multiplier: number;
  trend: "up" | "down" | "stable";
  evaluationCount: number;
}>> {
  try {
    const rows = await db
      .select({ categoryScoresJson: missAnalysisTable.categoryScoresJson })
      .from(missAnalysisTable)
      .where(eq(missAnalysisTable.pasaran, pasaran))
      .orderBy(desc(missAnalysisTable.createdAt))
      .limit(limit);

    if (rows.length === 0) {
      const weights = await getAdaptiveWeights(pasaran);
      return (Object.keys(weights) as CategoryKey[]).map(key => ({
        key, category: CATEGORY_LABELS[key], avgScore: NEUTRAL_SCORE,
        multiplier: weights[key], trend: "stable" as const, evaluationCount: 0,
      }));
    }

    const catSums: Record<CategoryKey, number[]> = {} as any;
    for (const row of rows) {
      const scores: Record<string, number> = (() => { try { return JSON.parse(row.categoryScoresJson); } catch { return {}; } })();
      for (const [key, score] of Object.entries(scores)) {
        const k = key as CategoryKey;
        if (!catSums[k]) catSums[k] = [];
        catSums[k].push(score);
      }
    }

    const weights = await getAdaptiveWeights(pasaran);
    const result: ReturnType<typeof getEnginePerformance> extends Promise<infer T> ? T : never[] = [];

    for (const key of Object.keys(DEFAULT_WEIGHTS) as CategoryKey[]) {
      const scores = catSums[key] ?? [];
      if (scores.length === 0) {
        result.push({ key, category: CATEGORY_LABELS[key], avgScore: NEUTRAL_SCORE, multiplier: weights[key] ?? 1.0, trend: "stable", evaluationCount: 0 });
        continue;
      }
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const recentHalf = scores.slice(0, Math.floor(scores.length / 2));
      const oldHalf = scores.slice(Math.floor(scores.length / 2));
      const recentAvg = recentHalf.length > 0 ? recentHalf.reduce((a, b) => a + b, 0) / recentHalf.length : avgScore;
      const oldAvg = oldHalf.length > 0 ? oldHalf.reduce((a, b) => a + b, 0) / oldHalf.length : avgScore;
      const trend: "up" | "down" | "stable" = recentAvg > oldAvg + 0.01 ? "up" : recentAvg < oldAvg - 0.01 ? "down" : "stable";
      result.push({
        key,
        category: CATEGORY_LABELS[key],
        avgScore: Math.round(avgScore * 1000) / 1000,
        multiplier: Math.round((weights[key] ?? 1.0) * 1000) / 1000,
        trend,
        evaluationCount: scores.length,
      });
    }

    return result.sort((a, b) => b.avgScore - a.avgScore);
  } catch (err) {
    logger.error({ err, pasaran }, "Learning: failed to get engine performance");
    return [];
  }
}
