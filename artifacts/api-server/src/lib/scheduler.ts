import { db, lotteryResultsTable, predictionsTable } from "@workspace/db";
import { eq, desc, and, like } from "drizzle-orm";
import { scrapeAllHistorical } from "./scraper";
import { runAllEngines } from "./prediction-engine";
import { evaluateAndLearn, getAdaptiveWeights } from "./learning-engine";
import { markLaporanDirty, addAutoLog, computeLaporan, setCachedLaporan } from "./laporan-engine";
import { loadAllSmartAIWeights } from "./smart-ai-weights";
import type { DrawRecord } from "./smart-ai-engine";
import { logger } from "./logger";

const MACAU_DRAW_TIMES_WIB: [number, number][] = [
  [0, 1], [13, 0], [16, 0], [19, 0], [22, 0], [23, 0],
];

const HK_DRAW_TIME_WIB: [number, number] = [23, 0];

const MACAU_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];
const HK_SLOTS = ["23:00"];

// Per-pasaran lock so concurrent draws/requests cannot interleave weight writes.
const refreshLocks: Map<string, Promise<void>> = new Map();

// Fixed training horizon — weights are always trained on the same window so the
// adaptive state is deterministic regardless of what the UI requests.
const TRAIN_DAYS = 30;

// Recompute laporan eagerly so Smart AI adaptive weights refresh after every sync.
// This is the chain: sync → backtest (LOO) → updateSmartAIWeights → cached laporan.
async function refreshLaporanAndWeights(pasaran: string, days = TRAIN_DAYS): Promise<void> {
  // Serialize per pasaran: chain onto any in-flight refresh for the same market.
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
    const slots = pasaran === "hongkong" ? HK_SLOTS : MACAU_SLOTS;
    const allDrawsBySlot: Record<string, DrawRecord[]> = {};

    await Promise.all(slots.map(async (slot) => {
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
    logger.info({ pasaran, totalEvals: data.summary.totalEvals }, "Scheduler: laporan recomputed, Smart AI weights updated");
  } catch (err) {
    logger.warn({ err, pasaran }, "Scheduler: laporan recompute failed");
  }
}

function nowWIBMins(): number {
  const wibMs = Date.now() + 7 * 60 * 60 * 1000;
  const d = new Date(wibMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function msUntilNextMacauDraw(): number {
  const nowMins = nowWIBMins();
  for (const [h, m] of MACAU_DRAW_TIMES_WIB) {
    const slotMins = h * 60 + m;
    if (slotMins > nowMins) {
      return (slotMins - nowMins) * 60 * 1000;
    }
  }
  return ((24 * 60 - nowMins) + 1) * 60 * 1000;
}

function msUntilHkDraw(): number {
  const nowMins = nowWIBMins();
  const [hh, mm] = HK_DRAW_TIME_WIB;
  const slotMins = hh * 60 + mm;
  if (slotMins > nowMins) {
    return (slotMins - nowMins) * 60 * 1000;
  }
  return ((24 * 60 - nowMins) + slotMins) * 60 * 1000;
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
      detail: `${pasaran.toUpperCase()} — ${synced} hasil baru masuk`,
      type: "sync",
    });
  }

  return synced;
}

// Run prediction with adaptive weights from self-learning system
export async function autoPredict(pasaran = "macau"): Promise<boolean> {
  try {
    const rows = await db
      .select()
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran))
      .orderBy(desc(lotteryResultsTable.id));

    if (rows.length < 5) {
      logger.warn({ pasaran }, "Scheduler: not enough data for prediction");
      return false;
    }

    const drawData = rows.map(r => ({
      result4d: r.result4d,
      as: r.as,
      kop: r.kop,
      kepala: r.kepala,
      ekor: r.ekor,
    }));

    // Fetch adaptive weights from self-learning system
    const adaptiveWeights = await getAdaptiveWeights(pasaran);
    logger.info({ pasaran, weights: adaptiveWeights }, "Scheduler: using adaptive weights");

    const result = runAllEngines(drawData, pasaran, adaptiveWeights);

    // rows are newest-first, so [0] is the latest draw this prediction saw. Record
    // it as the look-ahead cutoff so evaluateAndLearn can score this scheduled
    // prediction out-of-sample (only against a strictly newer draw). Without this,
    // scheduler predictions — the primary automated flow — would never be eligible
    // for honest evaluation.
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

// Evaluate last prediction vs newly synced result, then generate fresh prediction with updated weights
async function syncEvaluateAndPredict(pasaran: string): Promise<void> {
  await syncMasterlive(pasaran);

  // Step 1: evaluate last prediction vs actual result that just came in
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

  // Step 2: generate new prediction using freshly updated adaptive weights
  await autoPredict(pasaran);

  // Step 3: recompute laporan → refresh Smart AI 7-engine adaptive weights
  await refreshLaporanAndWeights(pasaran);

  addAutoLog({
    time: new Date().toISOString(),
    event: "Prediksi diperbarui",
    detail: `${pasaran.toUpperCase()} — engine weights disesuaikan, prediksi baru dibuat`,
    type: "predict",
  });
}

let schedulerRunning = false;

export function startScheduler(): void {
  if (schedulerRunning) return;
  schedulerRunning = true;

  void (async () => {
    // Restore previously-trained Smart AI adaptive weights before any refresh,
    // so a restart does not reset the 7-engine state back to defaults.
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

    try {
      const hkSynced = await syncMasterlive("hongkong");
      if (hkSynced > 0) {
        await evaluateAndLearn("hongkong");
      }
      await autoPredict("hongkong");
      await refreshLaporanAndWeights("hongkong");
      logger.info({ hkSynced }, "Startup HK Lotto sync complete");
    } catch (err) {
      logger.warn({ err }, "Startup HK sync/predict failed");
    }
  })();

  function scheduleMacauNext() {
    const delay = msUntilNextMacauDraw();
    logger.info({ nextInMinutes: Math.round(delay / 60000) }, "Scheduler: next sync scheduled");

    setTimeout(async () => {
      await new Promise<void>(r => setTimeout(r, 2 * 60 * 1000));
      try {
        await syncEvaluateAndPredict("macau");
      } catch (err) {
        logger.warn({ err }, "Scheduled Macau sync failed");
      }
      scheduleMacauNext();
    }, delay);
  }

  function scheduleHkNext() {
    const delay = msUntilHkDraw();
    logger.info({ nextInMinutes: Math.round(delay / 60000) }, "HK Scheduler: next sync scheduled");

    setTimeout(async () => {
      await new Promise<void>(r => setTimeout(r, 10 * 60 * 1000));
      try {
        await syncEvaluateAndPredict("hongkong");
        logger.info("HK Lotto: daily sync + evaluate + predict complete");
      } catch (err) {
        logger.warn({ err }, "Scheduled HK sync failed");
      }
      scheduleHkNext();
    }, delay);
  }

  scheduleMacauNext();
  scheduleHkNext();

  logger.info("Scheduler started — Macau: 00:01/13:00/16:00/19:00/22:00/23:00 WIB | HK Lotto: 23:00 WIB");
}
