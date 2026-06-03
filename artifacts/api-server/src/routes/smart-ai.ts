import { Router, type IRouter } from "express";
import { db, lotteryResultsTable } from "@workspace/db";
import { eq, desc, like, and } from "drizzle-orm";
import { runSmartAI } from "../lib/smart-ai-engine";
import type { DrawRecord } from "../lib/smart-ai-engine";
import { getSmartAIWeightsState } from "../lib/smart-ai-weights";

const router: IRouter = Router();

const MACAU_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];
const VALID_PASARANS = ["macau"] as const;
type ValidPasaran = typeof VALID_PASARANS[number];

// Detect the next upcoming Macau slot based on current WIB time
function detectTargetSlot(): string {
  const now = new Date();
  const wibHour = (now.getUTCHours() + 7) % 24;
  const wibMin = now.getUTCMinutes();
  const wibTime = wibHour * 60 + wibMin;

  const slotMinutes = [1, 13 * 60, 16 * 60, 19 * 60, 22 * 60, 23 * 60];

  for (let i = 0; i < slotMinutes.length; i++) {
    const slotMin = slotMinutes[i] ?? 0;
    // Show next slot if we're within 30 min before or after draw time
    if (wibTime < slotMin + 30) {
      return MACAU_SLOTS[i] ?? "13:00";
    }
  }
  // After 23:30 WIB → next day's first slot
  return "00:01";
}

function todayDayOfWeekWIB(): number {
  const now = new Date();
  return new Date(now.getTime() + 7 * 3600 * 1000).getUTCDay();
}

// GET /api/smart-ai/analyze?pasaran=macau&slot=13:00
router.get("/smart-ai/analyze", async (req, res): Promise<void> => {
  const pasaranRaw = (req.query.pasaran as string) || "macau";
  if (!VALID_PASARANS.includes(pasaranRaw as ValidPasaran)) {
    res.status(400).json({ error: "Pasaran tidak valid. Hanya 'macau' yang tersedia.", valid: VALID_PASARANS });
    return;
  }
  const pasaran = pasaranRaw as ValidPasaran;
  const slot = (req.query.slot as string | undefined) ?? detectTargetSlot();

  if (!MACAU_SLOTS.includes(slot)) {
    res.status(400).json({
      error: `Slot tidak valid: ${slot}. Gunakan salah satu: ${MACAU_SLOTS.join(", ")}`,
    });
    return;
  }

  try {
    const slotPattern = `%${slot}%`;
    const allSlotRows = await db
      .select()
      .from(lotteryResultsTable)
      .where(and(
        eq(lotteryResultsTable.pasaran, pasaran),
        like(lotteryResultsTable.tanggal, slotPattern),
      ))
      .orderBy(desc(lotteryResultsTable.id))
      .limit(500);

    const slotDraws: DrawRecord[] = allSlotRows.map(r => ({
      id: r.id,
      tanggal: r.tanggal,
      result4d: r.result4d,
      as: r.as,
      kop: r.kop,
      kepala: r.kepala,
      ekor: r.ekor,
    }));

    const MIN_SLOT_DRAWS = 5;
    if (slotDraws.length < MIN_SLOT_DRAWS) {
      req.log.warn({ pasaran, slot, available: slotDraws.length }, "SmartAI: insufficient slot data");
      res.status(422).json({
        error: `Data tidak cukup untuk Smart AI slot ${slot} — minimal ${MIN_SLOT_DRAWS} hasil dibutuhkan, tersedia ${slotDraws.length}. Sync data terlebih dahulu.`,
      });
      return;
    }

    // Get previous slot result for transition analysis
    let prevSlotResult = "";
    const slotIdx = MACAU_SLOTS.indexOf(slot);

    if (slotIdx > 0) {
      const prevSlot = MACAU_SLOTS[slotIdx - 1] ?? "";
      if (prevSlot) {
        const [prevRow] = await db
          .select({ result4d: lotteryResultsTable.result4d })
          .from(lotteryResultsTable)
          .where(and(
            eq(lotteryResultsTable.pasaran, pasaran),
            like(lotteryResultsTable.tanggal, `%${prevSlot}%`),
          ))
          .orderBy(desc(lotteryResultsTable.id))
          .limit(1);
        prevSlotResult = prevRow?.result4d ?? "";
      }
    } else {
      // First slot of day → use last draw from yesterday's last slot
      const lastSlot = MACAU_SLOTS[MACAU_SLOTS.length - 1] ?? "";
      if (lastSlot) {
        const [prevRow] = await db
          .select({ result4d: lotteryResultsTable.result4d })
          .from(lotteryResultsTable)
          .where(and(
            eq(lotteryResultsTable.pasaran, pasaran),
            like(lotteryResultsTable.tanggal, `%${lastSlot}%`),
          ))
          .orderBy(desc(lotteryResultsTable.id))
          .limit(1);
        prevSlotResult = prevRow?.result4d ?? "";
      }
    }

    const dow = todayDayOfWeekWIB();
    const result = runSmartAI(pasaran, slot, slotDraws, prevSlotResult, dow);

    req.log.info({ pasaran, slot, draws: slotDraws.length, confidence: result.overallConfidence }, "SmartAI analyze complete");
    res.json(result);
  } catch (err) {
    req.log.error({ err, pasaran, slot }, "SmartAI analyze failed");
    res.status(500).json({ error: "Analisis gagal, coba lagi" });
  }
});

// GET /api/smart-ai/slots?pasaran=macau — list slots with draw counts + active slot info
router.get("/smart-ai/slots", async (req, res): Promise<void> => {
  const pasaran = "macau";

  try {
    const slotCounts = await Promise.all(MACAU_SLOTS.map(async (slot) => {
      const rows = await db
        .select({ id: lotteryResultsTable.id })
        .from(lotteryResultsTable)
        .where(and(
          eq(lotteryResultsTable.pasaran, pasaran),
          like(lotteryResultsTable.tanggal, `%${slot}%`),
        ));
      return { slot, count: rows.length };
    }));

    const targetSlot = detectTargetSlot();

    res.json({
      pasaran,
      targetSlot,
      slots: slotCounts,
    });
  } catch (err) {
    req.log.error({ err }, "SmartAI slots failed");
    res.status(500).json({ error: "Gagal mengambil info slot" });
  }
});

// GET /api/smart-ai/weights?pasaran=macau — current adaptive engine weights
router.get("/smart-ai/weights", (req, res): void => {
  const pasaran = "macau";
  void req;
  res.json(getSmartAIWeightsState(pasaran));
});

export default router;
