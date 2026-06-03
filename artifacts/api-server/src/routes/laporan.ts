import { Router, type IRouter } from "express";
import { db, lotteryResultsTable } from "@workspace/db";
import { eq, desc, like, and } from "drizzle-orm";
import {
  computeLaporan, getCachedLaporan, setCachedLaporan,
  markLaporanDirty, getAutoLog, addAutoLog,
} from "../lib/laporan-engine";
import type { DrawRecord } from "../lib/smart-ai-engine";

const router: IRouter = Router();

const MACAU_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];
const HK_SLOTS = ["23:00"];

// GET /api/laporan?pasaran=macau&days=30
router.get("/laporan", async (req, res): Promise<void> => {
  const pasaran = (req.query.pasaran as string) || "macau";
  const days = Math.min(60, Math.max(7, parseInt(String(req.query.days ?? "30"), 10)));

  const cacheKey = `${pasaran}:${days}`;
  const cached = getCachedLaporan(cacheKey);
  if (cached) {
    req.log.info({ pasaran, days, cached: true }, "Laporan served from cache");
    res.json(cached);
    return;
  }

  try {
    const slots = pasaran === "hongkong" ? HK_SLOTS : MACAU_SLOTS;

    // Load all draws grouped by slot in parallel
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
        .limit(days + 10); // a few extra for edge cases

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

    const data = computeLaporan(pasaran, allDrawsBySlot, days);
    setCachedLaporan(cacheKey, data);

    req.log.info({ pasaran, days, totalEvals: data.summary.totalEvals, ms: data.computedInMs }, "Laporan computed");
    res.json(data);
  } catch (err) {
    req.log.error({ err, pasaran }, "Laporan compute failed");
    res.status(500).json({ error: "Gagal menghitung laporan" });
  }
});

// GET /api/laporan/log — auto-evaluation activity log
router.get("/laporan/log", (_req, res): void => {
  res.json({ log: getAutoLog() });
});

// POST /api/laporan/force-evaluate — invalidate cache + recompute
router.post("/laporan/force-evaluate", async (req, res): Promise<void> => {
  const pasaran = (req.body?.pasaran as string) || "macau";
  const days = Math.min(60, Math.max(7, parseInt(String(req.body?.days ?? "30"), 10)));

  markLaporanDirty();
  addAutoLog({
    time: new Date().toISOString(),
    event: "Force evaluasi",
    detail: `${pasaran.toUpperCase()} ${days} hari — dipicu manual`,
    type: "evaluate",
  });

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
        id: r.id, tanggal: r.tanggal, result4d: r.result4d,
        as: r.as, kop: r.kop, kepala: r.kepala, ekor: r.ekor,
      }));
    }));

    // Force-evaluate is an explicit training trigger → allowed to update weights.
    const data = computeLaporan(pasaran, allDrawsBySlot, days, { updateWeights: true });
    const cacheKey = `${pasaran}:${days}`;
    setCachedLaporan(cacheKey, data);

    res.json({ ok: true, computedAt: data.computedAt, totalEvals: data.summary.totalEvals, computedInMs: data.computedInMs });
  } catch (err) {
    req.log.error({ err }, "Force evaluate failed");
    res.status(500).json({ error: "Gagal force evaluate" });
  }
});

export default router;
