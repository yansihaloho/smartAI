/**
 * Laporan Engine — Retrospective Leave-One-Out Accuracy Evaluation
 * Evaluates Smart AI predictions against actual historical results automatically.
 */
import { runSmartAI } from "./smart-ai-engine";
import type { DrawRecord } from "./smart-ai-engine";
import { updateSmartAIWeights, ENGINE_NAMES } from "./smart-ai-weights";
import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlotEval {
  date: string;         // "2026-06-01"
  dayLabel: string;     // "Kamis 01 Juni 2026"
  dow: string;          // "Kamis"
  slot: string;         // "13:00"
  actual: string;       // "2535"
  actual2d: string;     // "35"
  actual3d: string;     // "535"
  main4d: string;       // top-1 prediction
  pred2dTop5: string[]; // top-5 2D
  pred2dTop10: string[];
  pred3d: string[];
  pred4d: string[];
  colokBebas: string[];
  bbfs5d: string[];
  confidence: number;   // 0-100
  hit4d: boolean;
  hit3d: boolean;
  hit2dTop1: boolean;
  hit2dTop5: boolean;
  hit2dTop10: boolean;
  hitColokBebas: boolean;
  hitBbfs: boolean;
  hitScore: number;     // 0-7 composite
}

export interface SlotSummary {
  slot: string;
  count: number;
  hit2dTop1: number; pct2dTop1: number;
  hit2dTop5: number; pct2dTop5: number;
  hit2dTop10: number; pct2dTop10: number;
  hit3d: number; pct3d: number;
  hit4d: number; pct4d: number;
  hitColok: number; pctColok: number;
  hitBbfs: number; pctBbfs: number;
  avgConf: number;
  streak2d: number;   // consecutive recent top-5 hits
  grade: string;      // A, B, C, D
}

export interface DayGroup {
  date: string;
  dayLabel: string;
  dow: string;
  evals: SlotEval[];
  totalSlots: number;
  hit2dTop5: number;
  hit2dTop10: number;
  hitColok: number;
  hitBbfs: number;
  hit3d: number;
  pct2d: number;
  pctColok: number;
  pctBbfs: number;
  avgConf: number;
}

export interface DowSummary {
  dow: string;
  count: number;
  hit2d: number;
  pct2d: number;
  pctColok: number;
  rank: number;
}

export interface ConfBucket {
  label: string;
  count: number;
  hit2d: number;
  pct2d: number;
}

export interface LaporanSummary {
  totalEvals: number;
  hit2dTop1: number; pct2dTop1: number;
  hit2dTop5: number; pct2dTop5: number;
  hit2dTop10: number; pct2dTop10: number;
  hit3d: number; pct3d: number;
  hit4d: number; pct4d: number;
  hitColok: number; pctColok: number;
  hitBbfs: number; pctBbfs: number;
  avgConf: number;
  bestSlot: string;
  worstSlot: string;
  bestDow: string;
  worstDow: string;
  trend: "naik" | "turun" | "stabil";
  trendDetail: string;
}

export interface AutoLogEntry {
  time: string;
  event: string;
  detail: string;
  type: "sync" | "evaluate" | "predict" | "laporan" | "info";
}

export interface EngineAccuracyEntry {
  id: string;
  name: string;
  hitRate: number;     // fraction of evals where this engine's top-5 included actual 2D
  evalCount: number;
  pct: number;         // hitRate × 100 rounded
}

export interface LaporanData {
  pasaran: string;
  computedAt: string;
  computedInMs: number;
  days: number;
  summary: LaporanSummary;
  perSlot: SlotSummary[];
  daily: DayGroup[];
  recentEvals: SlotEval[];
  trendData: { date: string; pct2d: number; pctColok: number; pct3d: number }[];
  dowSummary: DowSummary[];
  calibration: ConfBucket[];
  autoLog: AutoLogEntry[];
  recommendations: string[];
  perEngineAccuracy: EngineAccuracyEntry[];
}

// ─── Auto-Log Buffer ──────────────────────────────────────────────────────────

const AUTO_LOG: AutoLogEntry[] = [];

export function addAutoLog(entry: AutoLogEntry): void {
  AUTO_LOG.unshift(entry);
  if (AUTO_LOG.length > 100) AUTO_LOG.pop();
}

export function getAutoLog(): AutoLogEntry[] {
  return [...AUTO_LOG];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL = 10 * 60 * 1000; // 10 min
const laporanCache = new Map<string, { data: LaporanData; at: number }>();
let _dirty = false;

export function markLaporanDirty(): void { _dirty = true; }

export function getCachedLaporan(key: string): LaporanData | null {
  if (_dirty) return null;
  const c = laporanCache.get(key);
  if (!c || Date.now() - c.at > CACHE_TTL) return null;
  return c.data;
}

export function setCachedLaporan(key: string, data: LaporanData): void {
  laporanCache.set(key, { data, at: Date.now() });
  _dirty = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  Januari: "01", Februari: "02", Maret: "03", April: "04",
  Mei: "05", Juni: "06", Juli: "07", Agustus: "08",
  September: "09", Oktober: "10", November: "11", Desember: "12",
};
const DOW_INDEX: Record<string, number> = {
  Minggu: 0, Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5, Sabtu: 6,
};

function extractDate(tanggal: string): string {
  const p = tanggal.split(" ");
  const day = (p[1] ?? "01").padStart(2, "0");
  const month = MONTHS[p[2] ?? ""] ?? "01";
  const year = p[3] ?? "2026";
  return `${year}-${month}-${day}`;
}

function extractDayLabel(tanggal: string): string {
  const p = tanggal.split(" ");
  return `${p[0] ?? ""} ${p[1] ?? ""} ${p[2] ?? ""} ${p[3] ?? ""}`.trim();
}

function extractDow(tanggal: string): string {
  return tanggal.split(" ")[0] ?? "Senin";
}

function extractDowIdx(tanggal: string): number {
  return DOW_INDEX[extractDow(tanggal)] ?? 1;
}

function grade(pct: number): string {
  if (pct >= 40) return "A";
  if (pct >= 25) return "B";
  if (pct >= 15) return "C";
  return "D";
}

function computeStreak(evals: SlotEval[]): number {
  let s = 0;
  for (const e of evals) {
    if (e.hit2dTop5) s++;
    else break;
  }
  return s;
}

// ─── Core Computation ─────────────────────────────────────────────────────────

export function computeLaporan(
  pasaran: string,
  allDrawsBySlot: Record<string, DrawRecord[]>,
  days: number,
  opts: { updateWeights?: boolean } = {},
): LaporanData {
  const t0 = Date.now();
  const allEvals: SlotEval[] = [];

  addAutoLog({
    time: new Date().toISOString(),
    event: "Evaluasi dimulai",
    detail: `${pasaran.toUpperCase()} — ${days} hari terakhir`,
    type: "laporan",
  });

  // Per-engine hit tracking for adaptive weight update
  const engineHits: Record<string, number> = {};
  const engineTotal: Record<string, number> = {};

  for (const slot of Object.keys(allDrawsBySlot)) {
    const draws = allDrawsBySlot[slot] ?? [];
    if (draws.length < 8) continue;

    const evalCount = Math.min(draws.length - 5, days);

    for (let i = 0; i < evalCount; i++) {
      const actual = draws[i]!;
      const training = draws.slice(i + 1);
      if (training.length < 5) continue;

      const prevResult = draws[i + 1]?.result4d ?? "";
      const dow = extractDowIdx(actual.tanggal);

      let result;
      try {
        result = runSmartAI(pasaran, slot, training, prevResult, dow);
      } catch {
        continue;
      }

      const actual2d = actual.kepala + actual.ekor;

      // Track per-engine accuracy: did this engine's top-5 include the actual 2D?
      for (const eng of result.engines) {
        engineTotal[eng.id] = (engineTotal[eng.id] ?? 0) + 1;
        if (eng.top5.includes(actual2d)) {
          engineHits[eng.id] = (engineHits[eng.id] ?? 0) + 1;
        }
      }
      const actual3d = actual.kop + actual.kepala + actual.ekor;

      const top10 = result.topDigitKandidat.slice(0, 10);
      const top5 = top10.slice(0, 5);
      const pred2dTop1 = top5[0] ?? "";

      const hit4d = result.pred4d.includes(actual.result4d);
      const hit3d = result.pred3d.some(p => p === actual3d);
      const hit2dTop1 = pred2dTop1 === actual2d;
      const hit2dTop5 = top5.includes(actual2d);
      const hit2dTop10 = top10.includes(actual2d);
      const hitColokBebas = result.colokBebas.some(d => actual.result4d.includes(d));
      // BBFS hit = every digit of the actual 4D result is covered by the bbfs set
      const hitBbfs = result.bbfs5d.length >= 4
        ? actual.result4d.split("").every(d => result.bbfs5d.includes(d))
        : false;

      const hitScore =
        (hit4d ? 4 : 0) + (hit3d ? 2 : 0) + (hit2dTop1 ? 1 : 0) +
        (hit2dTop5 ? 0.5 : 0) + (hit2dTop10 ? 0.25 : 0) +
        (hitColokBebas ? 0.5 : 0) + (hitBbfs ? 0.5 : 0);

      allEvals.push({
        date: extractDate(actual.tanggal),
        dayLabel: extractDayLabel(actual.tanggal),
        dow: extractDow(actual.tanggal),
        slot,
        actual: actual.result4d,
        actual2d,
        actual3d,
        main4d: result.main4d,
        pred2dTop5: top5,
        pred2dTop10: top10,
        pred3d: result.pred3d,
        pred4d: result.pred4d,
        colokBebas: result.colokBebas,
        bbfs5d: result.bbfs5d,
        confidence: result.overallConfidence,
        hit4d, hit3d, hit2dTop1, hit2dTop5, hit2dTop10,
        hitColokBebas, hitBbfs,
        hitScore,
      });
    }
  }

  // Compute per-engine hit rates and update Smart AI adaptive weights
  const engineHitRates: Record<string, number> = {};
  const engineEvalCounts: Record<string, number> = {};
  for (const id of Object.keys(engineTotal)) {
    const tot = engineTotal[id] ?? 0;
    engineHitRates[id] = tot > 0 ? (engineHits[id] ?? 0) / tot : 0;
    engineEvalCounts[id] = tot;
  }
  // Only the training path (scheduler / explicit force-evaluate) may mutate the
  // global Smart AI weights, and always at the fixed training horizon. Plain
  // GET /laporan reads (with user-controlled days) must NOT overwrite weights.
  if (opts.updateWeights && Object.keys(engineHitRates).length > 0) {
    updateSmartAIWeights(pasaran, engineHitRates, engineEvalCounts);
    logger.info({ pasaran, engineHitRates }, "SmartAI adaptive weights updated from backtesting");
  }

  // Sort newest first
  allEvals.sort((a, b) =>
    a.date !== b.date ? b.date.localeCompare(a.date) : a.slot.localeCompare(b.slot),
  );

  const total = allEvals.length;
  const pct = (n: number) => total > 0 ? Math.round(n / total * 100) : 0;

  // Summary
  const hit2dTop1 = allEvals.filter(e => e.hit2dTop1).length;
  const hit2dTop5 = allEvals.filter(e => e.hit2dTop5).length;
  const hit2dTop10 = allEvals.filter(e => e.hit2dTop10).length;
  const hit3d = allEvals.filter(e => e.hit3d).length;
  const hit4d = allEvals.filter(e => e.hit4d).length;
  const hitColok = allEvals.filter(e => e.hitColokBebas).length;
  const hitBbfs = allEvals.filter(e => e.hitBbfs).length;
  const avgConf = total > 0 ? Math.round(allEvals.reduce((s, e) => s + e.confidence, 0) / total) : 0;

  // Per-slot
  const slots = Object.keys(allDrawsBySlot);
  const perSlot: SlotSummary[] = slots.map(slot => {
    const se = allEvals.filter(e => e.slot === slot);
    const n = se.length;
    const pp = (x: number) => n > 0 ? Math.round(x / n * 100) : 0;
    const h1 = se.filter(e => e.hit2dTop1).length;
    const h5 = se.filter(e => e.hit2dTop5).length;
    const h10 = se.filter(e => e.hit2dTop10).length;
    const h3 = se.filter(e => e.hit3d).length;
    const h4 = se.filter(e => e.hit4d).length;
    const hC = se.filter(e => e.hitColokBebas).length;
    const hB = se.filter(e => e.hitBbfs).length;
    const aC = n > 0 ? Math.round(se.reduce((a, e) => a + e.confidence, 0) / n) : 0;
    const p5 = pp(h5);
    return {
      slot, count: n,
      hit2dTop1: h1, pct2dTop1: pp(h1),
      hit2dTop5: h5, pct2dTop5: p5,
      hit2dTop10: h10, pct2dTop10: pp(h10),
      hit3d: h3, pct3d: pp(h3),
      hit4d: h4, pct4d: pp(h4),
      hitColok: hC, pctColok: pp(hC),
      hitBbfs: hB, pctBbfs: pp(hB),
      avgConf: aC,
      streak2d: computeStreak(se),
      grade: grade(p5),
    };
  }).sort((a, b) => b.pct2dTop5 - a.pct2dTop5);

  const bestSlot = perSlot[0]?.slot ?? "-";
  const worstSlot = perSlot[perSlot.length - 1]?.slot ?? "-";

  // Daily groups
  const dateMap = new Map<string, SlotEval[]>();
  for (const e of allEvals) {
    const arr = dateMap.get(e.date) ?? [];
    arr.push(e);
    dateMap.set(e.date, arr);
  }
  const daily: DayGroup[] = [];
  for (const [date, evals] of dateMap) {
    const n = evals.length;
    const h5 = evals.filter(e => e.hit2dTop5).length;
    const h10 = evals.filter(e => e.hit2dTop10).length;
    const hC = evals.filter(e => e.hitColokBebas).length;
    const hB = evals.filter(e => e.hitBbfs).length;
    const h3 = evals.filter(e => e.hit3d).length;
    const aC = n > 0 ? Math.round(evals.reduce((a, e) => a + e.confidence, 0) / n) : 0;
    daily.push({
      date,
      dayLabel: evals[0]?.dayLabel ?? date,
      dow: evals[0]?.dow ?? "-",
      evals: evals.sort((a, b) => a.slot.localeCompare(b.slot)),
      totalSlots: n,
      hit2dTop5: h5, hit2dTop10: h10, hitColok: hC, hitBbfs: hB, hit3d: h3,
      pct2d: n > 0 ? Math.round(h5 / n * 100) : 0,
      pctColok: n > 0 ? Math.round(hC / n * 100) : 0,
      pctBbfs: n > 0 ? Math.round(hB / n * 100) : 0,
      avgConf: aC,
    });
  }
  daily.sort((a, b) => b.date.localeCompare(a.date));

  // Trend (oldest → newest for chart)
  const trendData = daily.slice(0, 14).map(d => ({
    date: d.date,
    pct2d: d.pct2d,
    pctColok: d.pctColok,
    pct3d: d.totalSlots > 0 ? Math.round(d.hit3d / d.totalSlots * 100) : 0,
  })).reverse();

  // DOW summary
  const dowMap = new Map<string, { n: number; h2d: number; hC: number }>();
  for (const e of allEvals) {
    const d = dowMap.get(e.dow) ?? { n: 0, h2d: 0, hC: 0 };
    d.n++; if (e.hit2dTop5) d.h2d++; if (e.hitColokBebas) d.hC++;
    dowMap.set(e.dow, d);
  }
  const dowSummary: DowSummary[] = [...dowMap.entries()]
    .map(([dow, d]) => ({
      dow, count: d.n,
      hit2d: d.h2d, pct2d: d.n > 0 ? Math.round(d.h2d / d.n * 100) : 0,
      pctColok: d.n > 0 ? Math.round(d.hC / d.n * 100) : 0,
      rank: 0,
    }))
    .sort((a, b) => b.pct2d - a.pct2d)
    .map((d, i) => ({ ...d, rank: i + 1 }));

  const bestDow = dowSummary[0]?.dow ?? "-";
  const worstDow = dowSummary[dowSummary.length - 1]?.dow ?? "-";

  // Confidence calibration
  const buckets = [
    { label: "50–60%", min: 50, max: 60, count: 0, hit2d: 0 },
    { label: "60–70%", min: 60, max: 70, count: 0, hit2d: 0 },
    { label: "70–80%", min: 70, max: 80, count: 0, hit2d: 0 },
    { label: "80–90%", min: 80, max: 90, count: 0, hit2d: 0 },
    { label: "90%+",   min: 90, max: 101, count: 0, hit2d: 0 },
  ];
  for (const e of allEvals) {
    for (const b of buckets) {
      if (e.confidence >= b.min && e.confidence < b.max) {
        b.count++; if (e.hit2dTop5) b.hit2d++;
        break;
      }
    }
  }
  const calibration: ConfBucket[] = buckets.map(b => ({
    label: b.label, count: b.count, hit2d: b.hit2d,
    pct2d: b.count > 0 ? Math.round(b.hit2d / b.count * 100) : 0,
  }));

  // Trend direction
  const recent7 = daily.slice(0, 7);
  const prev7 = daily.slice(7, 14);
  const avg7 = recent7.length > 0 ? recent7.reduce((a, d) => a + d.pct2d, 0) / recent7.length : 0;
  const avgPrev7 = prev7.length > 0 ? prev7.reduce((a, d) => a + d.pct2d, 0) / prev7.length : 0;
  const trend = avg7 > avgPrev7 + 2 ? "naik" : avg7 < avgPrev7 - 2 ? "turun" : "stabil";
  const trendDetail = `7 hari terakhir ${Math.round(avg7)}% vs 7 hari sebelumnya ${Math.round(avgPrev7)}%`;

  // Recommendations
  const recommendations: string[] = [];
  if (bestSlot) recommendations.push(`Slot ${bestSlot} adalah yang paling akurat (${perSlot[0]?.pct2dTop5 ?? 0}% 2D top-5 hit rate)`);
  if (bestDow) recommendations.push(`Hari ${bestDow} memiliki akurasi 2D tertinggi (${dowSummary[0]?.pct2d ?? 0}%)`);
  if (pct(hitColok) > 70) recommendations.push(`Colok Bebas sangat reliable: ${pct(hitColok)}% — gunakan sebagai backup`);
  if (trend === "naik") recommendations.push("Tren akurasi membaik — engine terus belajar dari data terbaru");
  if (trend === "turun") recommendations.push("Akurasi turun — kemungkinan pola berubah, perlu lebih banyak data sinkronisasi");
  const bestBucket = [...calibration].sort((a, b) => b.pct2d - a.pct2d)[0];
  if (bestBucket?.count && bestBucket.count > 3) {
    recommendations.push(`Saat kepercayaan ${bestBucket.label}, akurasi 2D mencapai ${bestBucket.pct2d}%`);
  }
  const worstSlotData = perSlot[perSlot.length - 1];
  if (worstSlotData && worstSlotData.pct2dTop5 < 10) {
    recommendations.push(`Slot ${worstSlotData.slot} perlu data lebih banyak — baru ${worstSlotData.count} evaluasi`);
  }

  const computedInMs = Date.now() - t0;
  addAutoLog({
    time: new Date().toISOString(),
    event: "Evaluasi selesai",
    detail: `${total} slot dievaluasi dalam ${computedInMs}ms — 2D top-5: ${pct(hit2dTop5)}%`,
    type: "laporan",
  });

  logger.info({ pasaran, total, computedInMs, pct2dTop5: pct(hit2dTop5) }, "Laporan computed");

  return {
    pasaran,
    computedAt: new Date().toISOString(),
    computedInMs,
    days,
    summary: {
      totalEvals: total,
      hit2dTop1, pct2dTop1: pct(hit2dTop1),
      hit2dTop5, pct2dTop5: pct(hit2dTop5),
      hit2dTop10, pct2dTop10: pct(hit2dTop10),
      hit3d, pct3d: pct(hit3d),
      hit4d, pct4d: pct(hit4d),
      hitColok, pctColok: pct(hitColok),
      hitBbfs, pctBbfs: pct(hitBbfs),
      avgConf, bestSlot, worstSlot, bestDow, worstDow, trend, trendDetail,
    },
    perSlot,
    daily,
    recentEvals: allEvals.slice(0, 30),
    trendData,
    dowSummary,
    calibration,
    autoLog: getAutoLog(),
    recommendations,
    perEngineAccuracy: Object.keys(engineTotal).map(id => ({
      id,
      name: ENGINE_NAMES[id] ?? `Engine ${id}`,
      hitRate: engineHitRates[id] ?? 0,
      evalCount: engineEvalCounts[id] ?? 0,
      pct: Math.round((engineHitRates[id] ?? 0) * 100),
    })).sort((a, b) => b.hitRate - a.hitRate),
  };
}
