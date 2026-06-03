import { Router, type IRouter } from "express";
import { db, lotteryResultsTable } from "@workspace/db";
import { eq, desc, like, and } from "drizzle-orm";
import { runSmartAI } from "../lib/smart-ai-engine";
import type { DrawRecord } from "../lib/smart-ai-engine";
import { getSmartAIWeightsState } from "../lib/smart-ai-weights";

const router: IRouter = Router();

const TIME_SLOTS_MACAU = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];
const TIME_SLOTS_HK = ["23:00"];

const VALID_PASARANS = ["macau", "hongkong"] as const;
type ValidPasaran = typeof VALID_PASARANS[number];

// Detect target slot based on current WIB time
function detectTargetSlot(pasaran: string): string {
  const now = new Date();
  const wibHour = (now.getUTCHours() + 7) % 24;
  const wibMin = now.getUTCMinutes();
  const wibTime = wibHour * 60 + wibMin;

  if (pasaran === "hongkong") return "23:00";

  // For Macau, find the NEXT upcoming slot
  const slotMinutes = [1, 13 * 60, 16 * 60, 19 * 60, 22 * 60, 23 * 60];
  const slotNames = TIME_SLOTS_MACAU;

  for (let i = 0; i < slotMinutes.length; i++) {
    const slotMin = slotMinutes[i] ?? 0;
    if (wibTime < slotMin + 30) {
      return slotNames[i] ?? "13:00";
    }
  }
  // After 23:00 → next is 00:01 next day (but predict for 13:00 next day)
  return "13:00";
}

function todayDayOfWeek(): number {
  const now = new Date();
  return new Date(now.getTime() + 7 * 3600 * 1000).getUTCDay();
}

// GET /api/smart-ai/analyze?pasaran=macau&slot=13:00
router.get("/smart-ai/analyze", async (req, res): Promise<void> => {
  const pasaranRaw = req.query.pasaran as string;
  if (!VALID_PASARANS.includes(pasaranRaw as ValidPasaran)) {
    res.status(400).json({ error: "Invalid pasaran", valid: VALID_PASARANS });
    return;
  }
  const pasaran = pasaranRaw as ValidPasaran;
  const slot = (req.query.slot as string | undefined) ?? detectTargetSlot(pasaran);

  try {
    // Get slot-filtered draws from DB (newest first)
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

    // Honest failure: the 7 Smart AI engines need real history per slot to produce
    // meaningful candidates. Below the minimum we return an explicit 422 instead of
    // emitting low-confidence guesses on insufficient data.
    const MIN_SLOT_DRAWS = 5;
    if (slotDraws.length < MIN_SLOT_DRAWS) {
      req.log.warn({ pasaran, slot, available: slotDraws.length }, "SmartAI: insufficient slot data");
      res.status(422).json({
        error: `Data tidak cukup untuk Smart AI ${pasaran.toUpperCase()} slot ${slot} — minimal ${MIN_SLOT_DRAWS} hasil dibutuhkan, baru tersedia ${slotDraws.length}. Sinkronkan data terlebih dahulu.`,
      });
      return;
    }

    // Get previous slot result (for transition analysis)
    let prevSlotResult = "";
    const availableSlots = pasaran === "hongkong" ? TIME_SLOTS_HK : TIME_SLOTS_MACAU;
    const slotIdx = availableSlots.indexOf(slot);

    if (slotIdx > 0) {
      // Previous slot on same day (same tanggal prefix)
      const prevSlot = availableSlots[slotIdx - 1] ?? "";
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
      // For first slot of day, use last draw from yesterday's last slot
      const lastSlot = availableSlots[availableSlots.length - 1] ?? "";
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

    const dow = todayDayOfWeek();
    const result = runSmartAI(pasaran, slot, slotDraws, prevSlotResult, dow);

    req.log.info({ pasaran, slot, draws: slotDraws.length, confidence: result.overallConfidence }, "SmartAI analyze complete");
    res.json(result);
  } catch (err) {
    req.log.error({ err, pasaran, slot }, "SmartAI analyze failed");
    res.status(500).json({ error: "Analysis failed" });
  }
});

// GET /api/smart-ai/slots?pasaran=macau — list available slots with draw counts
router.get("/smart-ai/slots", async (req, res): Promise<void> => {
  const pasaranRaw = (req.query.pasaran as string) || "macau";
  const pasaran = pasaranRaw as "macau" | "hongkong";

  try {
    const slots = pasaran === "hongkong" ? TIME_SLOTS_HK : TIME_SLOTS_MACAU;

    const slotCounts = await Promise.all(slots.map(async (slot) => {
      const rows = await db
        .select({ id: lotteryResultsTable.id })
        .from(lotteryResultsTable)
        .where(and(
          eq(lotteryResultsTable.pasaran, pasaran),
          like(lotteryResultsTable.tanggal, `%${slot}%`),
        ));
      return { slot, count: rows.length };
    }));

    const targetSlot = detectTargetSlot(pasaran);

    res.json({
      pasaran,
      targetSlot,
      slots: slotCounts,
    });
  } catch (err) {
    req.log.error({ err }, "SmartAI slots failed");
    res.status(500).json({ error: "Failed to fetch slot info" });
  }
});

// GET /api/smart-ai/weights?pasaran=macau — current adaptive engine weights
router.get("/smart-ai/weights", (req, res): void => {
  const pasaran = (req.query.pasaran as string) || "macau";
  res.json(getSmartAIWeightsState(pasaran));
});

export default router;
