import { Router, type IRouter } from "express";
import { db, lotteryResultsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { scrapeResults } from "../lib/scraper";
import { runDeepAnalysis } from "../lib/deep-analysis";
import { RunDeepAnalysisBody, RunDeepAnalysisResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/deep/analyze", async (req, res): Promise<void> => {
  const parsed = RunDeepAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { pasaran } = parsed.data;
  let { timeSlot } = parsed.data;

  if (pasaran === "hongkong") {
    timeSlot = timeSlot && timeSlot !== "ALL" ? "23:00" : undefined;
  }

  req.log.info({ pasaran, timeSlot }, "Running deep analysis — ALL draws");

  let drawData: Array<{ as: string; kop: string; kepala: string; ekor: string; result4d: string; tanggal: string }> = [];

  try {
    const dbRows = await db
      .select()
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran))
      .orderBy(desc(lotteryResultsTable.id));

    if (dbRows.length >= 5) {
      const allDrawData = dbRows.map((r) => ({
        result4d: r.result4d,
        as: r.as,
        kop: r.kop,
        kepala: r.kepala,
        ekor: r.ekor,
        tanggal: r.tanggal,
      }));

      if (timeSlot && timeSlot !== "ALL") {
        const slotFiltered = allDrawData.filter((r) => r.tanggal.includes(timeSlot as string));
        drawData = slotFiltered.length >= 10 ? slotFiltered : allDrawData;
        req.log.info({ slotFiltered: slotFiltered.length, totalAll: allDrawData.length, timeSlot }, "Time-slot filtering applied");
      } else {
        drawData = allDrawData;
      }
      req.log.info({ pasaran, totalDraws: drawData.length }, "Loaded ALL draws for deep analysis");
    }
  } catch (err) {
    req.log.warn({ err }, "DB fetch failed, scraping for deep analysis");
  }

  if (drawData.length < 5) {
    try {
      const scraped = await scrapeResults(pasaran, 9999);
      drawData = scraped.map(s => ({ ...s, tanggal: s.tanggal }));
    } catch (err) {
      req.log.error({ err }, "Scrape failed for deep analysis");
      res.status(500).json({ error: "Could not fetch historical data" });
      return;
    }
  }

  // Honest failure: the scraper no longer fabricates data, so refuse to run the
  // analysis on too few real draws instead of returning misleading numbers.
  if (drawData.length < 5) {
    req.log.warn({ pasaran, available: drawData.length }, "Insufficient data for deep analysis");
    res.status(422).json({
      error: `Data tidak cukup untuk analisis mendalam pasaran ${pasaran.toUpperCase()} — minimal 5 hasil dibutuhkan, baru tersedia ${drawData.length}.`,
    });
    return;
  }

  const lastResult = drawData[0]?.result4d ?? "0000";
  const effectiveSlot = pasaran === "hongkong" ? "23:00" : (timeSlot ?? "ALL");

  const result = runDeepAnalysis(drawData, pasaran, effectiveSlot, lastResult);

  res.json(RunDeepAnalysisResponse.parse(result));
});

export default router;
