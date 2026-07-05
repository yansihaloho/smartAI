import { Router, type IRouter } from "express";
import { db, lotteryResultsTable, predictionsTable, predictionAccuracyTable } from "@workspace/db";
import { eq, desc, and, isNotNull, count } from "drizzle-orm";
import { scrapeResults } from "../lib/scraper";
import { runAllEngines } from "../lib/prediction-engine";
import { getAdaptiveWeights, evaluateAndLearn, getLearningLog, getEnginePerformance, getWeightTable } from "../lib/learning-engine";
import {
  RunPredictionBody,
  RunPredictionResponse,
  GetLatestPredictionQueryParams,
  GetLatestPredictionResponse,
  GetPredictionAccuracyQueryParams,
  GetPredictionAccuracyResponse,
  TriggerEvaluateBody,
  TriggerEvaluateResponse,
  GetLearningLogQueryParams,
  GetLearningLogResponse,
  GetEnginePerformanceQueryParams,
  GetEnginePerformanceResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function computeAccuracyRecord(records: typeof predictionAccuracyTable.$inferSelect[], days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const slice = records.filter(r => r.checkedAt && r.checkedAt >= cutoff);
  const total = slice.length;
  const hit4d = slice.filter(r => r.hit4d).length;
  const hit3d = slice.filter(r => r.hit3d).length;
  const hit2d = slice.filter(r => r.hit2d).length;
  const hitBbfs6 = slice.filter(r => r.hitBbfs6).length;
  const hitColokBebas = slice.filter(r => r.hitColokBebas).length;
  return {
    days,
    totalChecked: total,
    hit4d,
    hit3d,
    hit2d,
    hitBbfs6,
    hitColokBebas,
    winRate4d: total > 0 ? Math.round((hit4d / total) * 1000) / 10 : 0,
    winRate3d: total > 0 ? Math.round((hit3d / total) * 1000) / 10 : 0,
    winRate2d: total > 0 ? Math.round((hit2d / total) * 1000) / 10 : 0,
    winRateBbfs6: total > 0 ? Math.round((hitBbfs6 / total) * 1000) / 10 : 0,
    winRateColokBebas: total > 0 ? Math.round((hitColokBebas / total) * 1000) / 10 : 0,
  };
}

// POST /api/predict — run engines with adaptive weights, store result
router.post("/predict", async (req, res): Promise<void> => {
  const parsed = RunPredictionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { pasaran, slot } = parsed.data;
  req.log.info({ pasaran, slot }, "Running AI prediction with adaptive weights — slot-aware");

  // Valid Macau slots
  const VALID_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];
  const targetSlot = slot && VALID_SLOTS.includes(slot) ? slot : null;

  let drawData: Array<{ as: string; kop: string; kepala: string; ekor: string; result4d: string }> = [];
  let dataCutoffPeriode: string | null = null;

  try {
    const dbRows = await db
      .select()
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran))
      .orderBy(desc(lotteryResultsTable.periode));

    if (dbRows.length >= 10) {
      // Filter by slot if specified: periode format = "YYYYMMDD-HHMM"
      // slot "13:00" → matches periode ending in "-1300"
      const filtered = targetSlot
        ? dbRows.filter(r => {
            const slotSuffix = targetSlot.replace(":", "");
            return r.periode.endsWith(`-${slotSuffix}`);
          })
        : dbRows;

      const useRows = filtered.length >= 10 ? filtered : dbRows;
      drawData = useRows.map((r) => ({
        result4d: r.result4d,
        as: r.as,
        kop: r.kop,
        kepala: r.kepala,
        ekor: r.ekor,
      }));
      dataCutoffPeriode = useRows[0]?.periode ?? null;
      req.log.info({ pasaran, slot: targetSlot, totalDraws: useRows.length }, "Loaded draws from DB for prediction");
    }
  } catch (err) {
    req.log.warn({ err }, "DB fetch failed, scraping");
  }

  if (drawData.length < 10) {
    try {
      const scraped = await scrapeResults(pasaran, 9999);
      drawData = scraped;
      // scrapeResults returns newest-first, so [0] is the latest draw seen. This
      // ensures the scrape-fallback path can NOT later be scored in-sample against
      // a draw it already ingested.
      dataCutoffPeriode = scraped[0]?.periode ?? null;
    } catch (err) {
      req.log.error({ err }, "Scrape failed");
      res.status(500).json({ error: "Could not fetch historical data" });
      return;
    }
  }

  // Honest failure: never run the engines on too little (or fabricated) data.
  // The scraper no longer returns synthetic numbers, so an empty/short dataset
  // must surface as an explicit error instead of a meaningless prediction.
  if (drawData.length < 10) {
    req.log.warn({ pasaran, available: drawData.length }, "Insufficient data for prediction");
    res.status(422).json({
      error: `Data tidak cukup untuk pasaran ${pasaran.toUpperCase()} — minimal 10 hasil dibutuhkan, baru tersedia ${drawData.length}. Coba sinkronkan data terlebih dahulu.`,
    });
    return;
  }

  // Fetch adaptive weights from self-learning system
  const adaptiveWeights = await getAdaptiveWeights(pasaran);
  req.log.info({ pasaran, adaptiveWeights }, "Adaptive weights applied");

  const result = runAllEngines(drawData, pasaran, adaptiveWeights);

  let predictionId: number | undefined;
  try {
    const [inserted] = await db.insert(predictionsTable).values({
      pasaran,
      slot: targetSlot ?? undefined,
      dataCutoffPeriode,
      consensus4d: result.consensus4d,
      consensus3d: result.consensus3d,
      consensus2d: result.consensus2d,
      colokBebas: result.colokBebas,
      bbfs5: result.bbfs5,
      bbfs6: result.bbfs6,
      bbfs7: result.bbfs7,
      overallConfidence: result.overallConfidence,
      enginesJson: JSON.stringify(result.engines),
      explanationsJson: JSON.stringify(result.explanations),
      contributionsJson: JSON.stringify(result.engineContributions),
    }).returning({ id: predictionsTable.id });
    predictionId = inserted?.id;
  } catch (dbErr) {
    req.log.warn({ dbErr }, "Failed to store prediction in DB");
  }

  // NOTE: predictions are intentionally NOT scored here. Scoring a freshly-made
  // prediction against the latest known result is in-sample/look-ahead (the model
  // already saw that draw) and inflates accuracy. Honest scoring happens later in
  // evaluateAndLearn, once a genuinely new draw arrives that this prediction did
  // not see — only then is a predictionAccuracy row written.
  void predictionId;

  res.json(RunPredictionResponse.parse(result));
});

// GET /api/predict/latest
router.get("/predict/latest", async (req, res): Promise<void> => {
  const parsed = GetLatestPredictionQueryParams.safeParse(req.query);
  if (!parsed.success || !parsed.data.pasaran) {
    res.status(400).json({ error: "pasaran is required" });
    return;
  }

  const { pasaran } = parsed.data;

  try {
    const [row] = await db
      .select()
      .from(predictionsTable)
      .where(eq(predictionsTable.pasaran, pasaran))
      .orderBy(desc(predictionsTable.generatedAt))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "No prediction found for this pasaran" });
      return;
    }

    const engines = JSON.parse(row.enginesJson);
    const explanations: string[] = (() => {
      try { return JSON.parse(row.explanationsJson || "[]"); } catch { return []; }
    })();
    const engineContributions: { category: string; contribution: number }[] = (() => {
      try { return JSON.parse(row.contributionsJson || "[]"); } catch { return []; }
    })();

    const topEngines = [...engines]
      .sort((a: { weight: number; confidence: number }, b: { weight: number; confidence: number }) =>
        (b.weight * b.confidence) - (a.weight * a.confidence))
      .slice(0, 5)
      .map((e: { engineName: string; category: string; weight: number; confidence: number }) => ({
        name: e.engineName,
        category: e.category,
        weight: Math.round(e.weight * e.confidence * 1000) / 10,
      }));

    const engineSummary = engines.reduce(
      (acc: Record<string, number>, e: { category: string; confidence: number }) => {
        if (!acc[e.category]) acc[e.category] = 0;
        acc[e.category] += e.confidence;
        return acc;
      },
      {}
    );

    // Single COUNT query — no need to fetch all rows just to get a number
    const [{ value: totalDrawsUsed }] = await db
      .select({ value: count() })
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran));

    const result = {
      pasaran: row.pasaran,
      slot: row.slot ?? undefined,
      generatedAt: row.generatedAt.toISOString(),
      totalDrawsUsed,
      engines,
      consensus4d: row.consensus4d,
      consensus3d: row.consensus3d,
      consensus2d: row.consensus2d,
      colokBebas: row.colokBebas,
      bbfs5: row.bbfs5,
      bbfs6: row.bbfs6,
      bbfs7: row.bbfs7 ?? [],
      overallConfidence: row.overallConfidence,
      engineSummary,
      explanations,
      engineContributions: engineContributions.length > 0 ? engineContributions : Object.entries(engineSummary).map(([category, conf]) => ({
        category,
        contribution: Math.round((conf as number) / engines.length * 100),
      })).sort((a, b) => b.contribution - a.contribution),
      topEngines,
    };

    res.json(GetLatestPredictionResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch latest prediction");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/predict/accuracy
router.get("/predict/accuracy", async (req, res): Promise<void> => {
  const parsed = GetPredictionAccuracyQueryParams.safeParse(req.query);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";

  try {
    const [totalPredictions, totalScored] = await Promise.all([
      db.select().from(predictionsTable).where(eq(predictionsTable.pasaran, pasaran)),
      db.select().from(predictionAccuracyTable)
        .where(and(eq(predictionAccuracyTable.pasaran, pasaran), isNotNull(predictionAccuracyTable.checkedAt))),
    ]);

    const scored = totalScored;

    const recentScores = scored
      .sort((a, b) => (b.checkedAt?.getTime() ?? 0) - (a.checkedAt?.getTime() ?? 0))
      .slice(0, 20)
      .map(r => ({
        date: r.checkedAt?.toISOString() ?? r.createdAt.toISOString(),
        actual: r.actualResult ?? "—",
        hit4d: r.hit4d ?? false,
        hit3d: r.hit3d ?? false,
        hit2d: r.hit2d ?? false,
        hitBbfs6: r.hitBbfs6 ?? false,
        hitColokBebas: r.hitColokBebas ?? false,
      }));

    const stats = {
      pasaran,
      totalPredictions: totalPredictions.length,
      totalScored: scored.length,
      last7: computeAccuracyRecord(scored, 7),
      last30: computeAccuracyRecord(scored, 30),
      last90: computeAccuracyRecord(scored, 90),
      recentScores,
    };

    res.json(GetPredictionAccuracyResponse.parse(stats));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch accuracy stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/predict/evaluate — manually trigger self-evaluation for a pasaran
router.post("/predict/evaluate", async (req, res): Promise<void> => {
  const parsed = TriggerEvaluateBody.safeParse(req.body);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  req.log.info({ pasaran }, "Manual evaluation triggered");
  try {
    const result = await evaluateAndLearn(pasaran);
    res.json(TriggerEvaluateResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Manual evaluate failed");
    res.status(500).json({ error: "Evaluation failed" });
  }
});

// GET /api/predict/learning-log — get recent self-learning evaluations
router.get("/predict/learning-log", async (req, res): Promise<void> => {
  const parsed = GetLearningLogQueryParams.safeParse(req.query);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  const limit = parsed.success ? Math.min(50, parsed.data.limit ?? 20) : 20;
  try {
    const log = await getLearningLog(pasaran, limit);
    res.json(GetLearningLogResponse.parse({ pasaran, log }));
  } catch (err) {
    req.log.error({ err }, "Learning log fetch failed");
    res.status(500).json({ error: "Failed to fetch learning log" });
  }
});

// GET /api/predict/engine-performance — per-category performance stats
router.get("/predict/engine-performance", async (req, res): Promise<void> => {
  const parsed = GetEnginePerformanceQueryParams.safeParse(req.query);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  const limit = parsed.success ? Math.min(200, parsed.data.limit ?? 50) : 50;
  try {
    const [performance, weights] = await Promise.all([
      getEnginePerformance(pasaran, limit),
      getWeightTable(pasaran),
    ]);
    res.json(GetEnginePerformanceResponse.parse({ pasaran, performance, weights }));
  } catch (err) {
    req.log.error({ err }, "Engine performance fetch failed");
    res.status(500).json({ error: "Failed to fetch engine performance" });
  }
});

export default router;
