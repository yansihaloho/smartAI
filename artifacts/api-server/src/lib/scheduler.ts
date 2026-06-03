import { db, lotteryResultsTable, predictionsTable } from "@workspace/db";
import { eq, desc, and, like } from "drizzle-orm";
import { scrapeAllHistorical } from "./scraper";
import { runAllEngines } from "./prediction-engine";
import { evaluateAndLearn, getAdaptiveWeights } from "./learning-engine";
import { markLaporanDirty, addAutoLog, computeLaporan, setCachedLaporan } from "./laporan-engine";
import { loadAllSmartAIWeights } from "./smart-ai-weights";
import type { DrawRecord } from "./smart-ai-engine";
import { logger } from "./logger";

// Macau draw times (WIB = UTC+7)
const MACAU_DRAW_TIMES_WIB: [number, number][] = [
  [0, 1], [13, 0], [16, 0], [19, 0], [22, 0], [23, 0],
];

const MACAU_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];

// Fixed training window — deterministic weight training regardless of UI requests
const TRAIN_DAYS = 30;

// Per-pasaran lock to prevent interleaved weight writes during concurrent draws
const refreshLocks: Map<string, Promise<void>> = new Map();

async function refreshLaporanAndWeights(pasaran: string, days = TRAIN_DAYS): Promise<void> {
  const prev = refreshLocks.get(pasaran) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => doRefreshLaporanAndWeights(pasaran, days));
  refreshLocks.set(pasaran, run);
  try {
    await run;
  } finally {
    if (refreshLocks.get(pasaran) === run) refreshLocks.delete(pasaran);
  }
}

async function doRefreshLaporanAndWeights(pasaran: string, days: number): Promise<void> {
  try {
    const allDrawsBySlot: Record<string, DrawRecord[]> = {};

    await Promise.all(MACAU_SLOTS.map(async (slot) => {
      const rows = await db
        .select()
        .from(lotteryResultsTable)
        .where(and(
          eq(lotteryResultsTable.pasaran, pasaran),
          like(lotteryResultsTable.tanggal, `%${slot}%`),
        ))
        .orderBy(desc(lotteryResultsTable.id))
        .limit(days + 10);

      allDrawsBySlot[slot] = rows.map(r => ({
        id: r.id,
        tanggal: r.tanggal,
        result4d: r.result4d,
        as: r.as,
        kop: r.kop,
        kepala: r.kepala,
        ekor: r.ekor,
      }));
    }));

    const data = computeLaporan(pasaran, allDrawsBySlot, days, { updateWeights: true });
    setCachedLaporan(`${pasaran}:${days}`, data);
    logger.info({ pasaran, totalEvals: data.summary.totalEvals, computedInMs: data.computedInMs }, "Scheduler: laporan recomputed, Smart AI weights updated");
  } catch (err) {
    logger.warn({ err, pasaran }, "Scheduler: laporan recompute failed");
  }
}

function nowWIBMins(): number {
  const wibMs = Date.now() + 7 * 60 * 60 * 1000;
  const d = new Date(wibMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// Returns ms until the next scheduled Macau draw slot
function msUntilNextMacauDraw(): number {
  const nowMins = nowWIBMins();
  for (const [h, m] of MACAU_DRAW_TIMES_WIB) {
    const slotMins = h * 60 + m;
    if (slotMins > nowMins) {
      return (slotMins - nowMins) * 60 * 1000;
    }
  }
  // Past 23:00 → wait for 00:01 next day
  const minutesToMidnight = 24 * 60 - nowMins;
  return (minutesToMidnight + 1) * 60 * 1000;
}

export async function syncMasterlive(pasaran = "macau"): Promise<number> {
  logger.info({ pasaran }, "Scheduler: syncing from masterlive.net");
  const { flat } = await scrapeAllHistorical(pasaran);
  if (flat.length === 0) {
    logger.warn({ pasaran }, "Scheduler: no data scraped");
    return 0;
  }

  let synced = 0;
  for (const s of flat) {
    try {
      const inserted = await db.insert(lotteryResultsTable).values({
        pasaran: s.pasaran,
        tanggal: s.tanggal,
        periode: s.periode,
        result4d: s.result4d,
        as: s.as,
        kop: s.kop,
        kepala: s.kepala,
        ekor: s.ekor,
      }).onConflictDoNothing().returning({ id: lotteryResultsTable.id });
      if (inserted.length > 0) synced++;
    } catch {
      // ignore conflicts
    }
  }
  logger.info({ synced, total: flat.length, pasaran }, "Scheduler: sync complete");

  if (synced > 0) {
    markLaporanDirty();
    addAutoLog({
      time: new Date().toISOString(),
      event: "Data sinkronisasi",
      detail: `${pasaran.toUpperCase()} — ${synced} hasil baru masuk dari masterlive.net`,
      type: "sync",
    });
  }

  return synced;
}

export async function autoPredict(pasaran = "macau"): Promise<boolean> {
  try {
    const rows = await db
      .select()
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran))
      .orderBy(desc(lotteryResultsTable.id));

    if (rows.length < 10) {
      logger.warn({ pasaran, available: rows.length }, "Scheduler: not enough data for prediction (min 10)");
      return false;
    }

    const drawData = rows.map(r => ({
      result4d: r.result4d,
      as: r.as,
      kop: r.kop,
      kepala: r.kepala,
      ekor: r.ekor,
    }));

    const adaptiveWeights = await getAdaptiveWeights(pasaran);
    logger.info({ pasaran, weights: adaptiveWeights }, "Scheduler: using adaptive weights");

    const result = runAllEngines(drawData, pasaran, adaptiveWeights);

    // Record the data cutoff for honest out-of-sample evaluation later
    const dataCutoffPeriode = rows[0]?.periode ?? null;

    await db.insert(predictionsTable).values({
      pasaran,
      dataCutoffPeriode,
      consensus4d: result.consensus4d,
      consensus3d: result.consensus3d,
      consensus2d: result.consensus2d,
      colokBebas: result.colokBebas,
      bbfs5: result.bbfs5,
      bbfs6: result.bbfs6,
      overallConfidence: result.overallConfidence,
      enginesJson: JSON.stringify(result.engines),
      explanationsJson: JSON.stringify(result.explanations),
      contributionsJson: JSON.stringify(result.engineContributions),
    });

    logger.info({ pasaran, totalDraws: rows.length }, "Scheduler: prediction generated");
    return true;
  } catch (err) {
    logger.warn({ err, pasaran }, "Scheduler: prediction failed");
    return false;
  }
}

async function syncEvaluateAndPredict(pasaran: string): Promise<void> {
  // Step 1: sync fresh data
  await syncMasterlive(pasaran);

  // Step 2: evaluate last prediction vs actual result that just arrived
  const evalResult = await evaluateAndLearn(pasaran);
  if (evalResult.evaluated) {
    logger.info({
      pasaran,
      actual: evalResult.actualResult,
      hit4d: evalResult.hit4d,
      hit2d: evalResult.hit2d,
      bestCategory: evalResult.bestCategory,
    }, "Scheduler: self-learning evaluation complete");
  }

  // Step 3: generate new prediction with updated adaptive weights
  await autoPredict(pasaran);

  // Step 4: recompute laporan → refresh Smart AI 7-engine adaptive weights
  await refreshLaporanAndWeights(pasaran);

  addAutoLog({
    time: new Date().toISOString(),
    event: "Prediksi diperbarui",
    detail: `MACAU — engine weights disesuaikan berdasarkan hasil aktual, prediksi baru dibuat`,
    type: "predict",
  });
}

let schedulerRunning = false;

export function startScheduler(): void {
  if (schedulerRunning) return;
  schedulerRunning = true;

  void (async () => {
    // Restore saved Smart AI adaptive weights first — prevents weight reset on restart
    await loadAllSmartAIWeights();

    try {
      const macauSynced = await syncMasterlive("macau");
      if (macauSynced > 0) {
        await evaluateAndLearn("macau");
      }
      await autoPredict("macau");
      await refreshLaporanAndWeights("macau");
    } catch (err) {
      logger.warn({ err }, "Startup Macau sync/predict failed");
    }
  })();

  function scheduleMacauNext() {
    const delay = msUntilNextMacauDraw();
    logger.info({ nextInMinutes: Math.round(delay / 60000) }, "Scheduler: next sync scheduled");

    setTimeout(async () => {
      // Wait 2 minutes after draw time to ensure result is published
      await new Promise<void>(r => setTimeout(r, 2 * 60 * 1000));
      try {
        await syncEvaluateAndPredict("macau");
      } catch (err) {
        logger.warn({ err }, "Scheduled Macau sync failed");
      }
      scheduleMacauNext();
    }, delay);
  }

  scheduleMacauNext();

  logger.info("Scheduler started — Macau: 00:01/13:00/16:00/19:00/22:00/23:00 WIB");
}
