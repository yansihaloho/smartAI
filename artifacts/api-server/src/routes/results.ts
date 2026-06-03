import { Router, type IRouter } from "express";
import { db, lotteryResultsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { scrapeResults, getPasaranList, scrapeGrouped, scrapeAllHistorical } from "../lib/scraper";
import { logger } from "../lib/logger";
import { markLaporanDirty, addAutoLog } from "../lib/laporan-engine";
import {
  GetResultsQueryParams,
  GetResultsResponse,
  GetPasaransResponse,
  GetResultStatsResponse,
  GetResultStatsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const cache: Map<string, { data: unknown; ts: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, ts: Date.now() });
}

router.get("/results/pasarans", async (_req, res): Promise<void> => {
  const pasarans = getPasaranList();
  res.json(GetPasaransResponse.parse(pasarans));
});

router.get("/results/stats", async (req, res): Promise<void> => {
  const parsed = GetResultStatsQueryParams.safeParse(req.query);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  const cacheKey = `stats:${pasaran}:all`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  let rows: Array<{ as: string; kop: string; kepala: string; ekor: string; result4d: string }> = [];

  try {
    rows = await db
      .select({
        as: lotteryResultsTable.as,
        kop: lotteryResultsTable.kop,
        kepala: lotteryResultsTable.kepala,
        ekor: lotteryResultsTable.ekor,
        result4d: lotteryResultsTable.result4d,
      })
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran))
      .orderBy(desc(lotteryResultsTable.id));
    req.log.info({ pasaran, totalDraws: rows.length }, "Loaded ALL draws for stats");
  } catch (err) {
    req.log.warn({ err }, "DB query failed for stats");
  }

  if (rows.length === 0) {
    const scraped = await scrapeResults(pasaran, 9999);
    rows = scraped;
  }

  const posFreq: Record<string, Record<string, number>> = {
    as: {}, kop: {}, kepala: {}, ekor: {},
  };
  for (const pos of ["as", "kop", "kepala", "ekor"] as const) {
    for (let d = 0; d <= 9; d++) posFreq[pos][String(d)] = 0;
  }

  const combined: Record<string, number> = {};
  for (let d = 0; d <= 9; d++) combined[String(d)] = 0;

  let oddCount = 0;
  let evenCount = 0;
  let bigCount = 0;
  let smallCount = 0;

  const twoDigitFrequency: Record<string, number> = {};
  for (let i = 0; i <= 9; i++) {
    for (let j = 0; j <= 9; j++) {
      twoDigitFrequency[`${i}${j}`] = 0;
    }
  }

  rows.forEach((r) => {
    for (const pos of ["as", "kop", "kepala", "ekor"] as const) {
      const d = r[pos];
      if (d) {
        posFreq[pos][d] = (posFreq[pos][d] ?? 0) + 1;
        combined[d] = (combined[d] ?? 0) + 1;

        const dNum = parseInt(d, 10);
        if (!isNaN(dNum)) {
          if (dNum % 2 === 0) evenCount++; else oddCount++;
          if (dNum >= 5) bigCount++; else smallCount++;
        }
      }
    }

    const kepala = r.kepala;
    const ekor = r.ekor;
    if (kepala && ekor) {
      const key = `${kepala}${ekor}`;
      twoDigitFrequency[key] = (twoDigitFrequency[key] ?? 0) + 1;
    }
  });

  const sortedDigits = Object.entries(combined).sort((a, b) => b[1] - a[1]);
  const hotNumbers = sortedDigits.slice(0, 3).map(([d]) => d);
  const coldNumbers = sortedDigits.slice(-3).map(([d]) => d);

  const stats = {
    pasaran,
    totalDraws: rows.length,
    digitFrequency: combined,
    positionFrequency: posFreq,
    hotNumbers,
    coldNumbers,
    lastUpdated: new Date().toISOString(),
    oddEvenDist: { odd: oddCount, even: evenCount },
    bigSmallDist: { big: bigCount, small: smallCount },
    twoDigitFrequency,
  };

  setCache(cacheKey, stats);
  res.json(GetResultStatsResponse.parse(stats));
});

router.get("/results/grouped", async (req, res): Promise<void> => {
  const pasaran = (req.query.pasaran as string) || "macau";
  const limit = parseInt(req.query.limit as string, 10) || 60;

  const cacheKey = `grouped:${pasaran}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const days = await scrapeGrouped(pasaran, limit);
    setCache(cacheKey, days);
    res.json(days);
  } catch (err) {
    req.log.error({ err }, "Failed to get grouped results");
    res.status(500).json({ error: "Failed to fetch grouped results" });
  }
});

router.post("/results/sync", async (req, res): Promise<void> => {
  const pasaran = (req.body?.pasaran as string) || "macau";

  try {
    const { flat } = await scrapeAllHistorical(pasaran);

    if (flat.length === 0) {
      res.json({ synced: 0, message: "No data scraped" });
      return;
    }

    let synced = 0;
    for (const s of flat) {
      try {
        await db.insert(lotteryResultsTable).values({
          pasaran: s.pasaran,
          tanggal: s.tanggal,
          periode: s.periode,
          result4d: s.result4d,
          as: s.as,
          kop: s.kop,
          kepala: s.kepala,
          ekor: s.ekor,
        }).onConflictDoNothing();
        synced++;
      } catch {
        // Skip conflicts silently
      }
    }

    for (const key of cache.keys()) {
      if (key.includes(pasaran)) cache.delete(key);
    }
    cache.delete(`stats:${pasaran}:all`);

    // Trigger laporan re-evaluation so adaptive weights update on next request
    markLaporanDirty();
    addAutoLog({
      time: new Date().toISOString(),
      event: "Sync manual selesai",
      detail: `${pasaran.toUpperCase()} — ${synced} data baru disinkronkan`,
      type: "sync",
    });

    logger.info({ synced, pasaran }, "Bulk sync complete");
    res.json({ synced, total: flat.length, message: `Synced ${synced} records` });
  } catch (err) {
    req.log.error({ err }, "Sync failed");
    res.status(500).json({ error: "Sync failed" });
  }
});

router.get("/results", async (req, res): Promise<void> => {
  const parsed = GetResultsQueryParams.safeParse(req.query);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;

  const cacheKey = `results:${pasaran}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  let dbRows: typeof formatted = [];
  let formatted: Array<{
    id: number; pasaran: string; tanggal: string; periode: string;
    result4d: string; as: string; kop: string; kepala: string; ekor: string;
    result2d: string; result3d: string;
  }> = [];

  try {
    const rows = await db
      .select()
      .from(lotteryResultsTable)
      .where(eq(lotteryResultsTable.pasaran, pasaran))
      .orderBy(desc(lotteryResultsTable.id))
      .limit(limit);
    formatted = rows.map((r) => ({
      ...r,
      result2d: r.result4d.slice(2),
      result3d: r.result4d.slice(1),
    }));
    dbRows = formatted;
  } catch (err) {
    req.log.warn({ err }, "DB query failed, using scrape");
  }

  if (dbRows.length < 5) {
    req.log.info({ pasaran, limit }, "Scraping results");
    try {
      const scraped = await scrapeResults(pasaran, limit);

      if (scraped.length > 0) {
        for (const s of scraped) {
          try {
            await db.insert(lotteryResultsTable).values({
              pasaran: s.pasaran,
              tanggal: s.tanggal,
              periode: s.periode,
              result4d: s.result4d,
              as: s.as,
              kop: s.kop,
              kepala: s.kepala,
              ekor: s.ekor,
            }).onConflictDoNothing();
          } catch {
            // ignore
          }
        }

        // Re-query DB to get rows with real auto-increment IDs (not synthetic i+1)
        const freshRows = await db
          .select()
          .from(lotteryResultsTable)
          .where(eq(lotteryResultsTable.pasaran, pasaran))
          .orderBy(desc(lotteryResultsTable.id))
          .limit(limit);
        const out = freshRows.map((r) => ({
          ...r,
          result2d: r.result4d.slice(2),
          result3d: r.result4d.slice(1),
        }));

        setCache(cacheKey, out);
        res.json(GetResultsResponse.parse(out));
        return;
      }
    } catch (err) {
      req.log.error({ err }, "Scraping failed");
      res.status(500).json({ error: "Failed to fetch results" });
      return;
    }
  }

  setCache(cacheKey, formatted);
  res.json(GetResultsResponse.parse(formatted));
});

export { cache };
export default router;
