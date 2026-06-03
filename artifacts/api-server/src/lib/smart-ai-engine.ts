import { logger } from "./logger";
import { getSmartAIWeights, getSmartAIWeightsState, DEFAULT_WEIGHTS } from "./smart-ai-weights";

export interface DrawRecord {
  id: number;
  tanggal: string;
  result4d: string;
  as: string;
  kop: string;
  kepala: string;
  ekor: string;
}

export interface SmartEngineOutput {
  id: string;
  name: string;
  weight: number;
  top5: string[];
  confidence: number;
  scores2d: Record<string, number>;
}

export interface SmartColokJitu {
  posisi: string;
  digit: string;
}

export interface SmartRekomend {
  rank: number;
  number: string;
  score: number;
  label: string;
  color: string;
}

export interface SmartAIResult {
  pasaran: string;
  slot: string;
  analyzedAt: string;
  totalSlotDraws: number;
  lastResult: string;
  lastResultAt: string;
  prevSlotResult: string;
  overallConfidence: number;
  main4d: string;
  bbfs5d: string[];
  pred4d: string[];
  pred3d: string[];
  pred2dEkor: string[];
  pred2dDepan: string[];
  pred2dTengah: string[];
  colokBebas: string[];
  colokBebas2d: string[];
  colokJitu: SmartColokJitu[];
  dasar: string;
  tengahTepi: string;
  silangHomo: string;
  kembangKempis: string;
  shio: string[];
  bom2d: string;
  topDigitKandidat: string[];
  topRekomendasi: SmartRekomend[];
  engines: SmartEngineOutput[];
}

type Pos = "as" | "kop" | "kepala" | "ekor";
const POSITIONS: Pos[] = ["as", "kop", "kepala", "ekor"];

const SHIO_MAP: Record<string, string> = {
  "0": "Tikus", "1": "Kerbau", "2": "Macan", "3": "Kelinci",
  "4": "Naga", "5": "Ular", "6": "Kuda", "7": "Kambing",
  "8": "Monyet", "9": "Ayam",
};

const SILANG_HOMO: Record<number, string> = {
  0: "Homo", 1: "Silang", 2: "Silang", 3: "Silang", 4: "Silang",
  5: "Homo", 6: "Silang", 7: "Silang", 8: "Silang", 9: "Homo",
};

function all2D(): string[] {
  const r: string[] = [];
  for (let i = 0; i <= 99; i++) r.push(String(i).padStart(2, "0"));
  return r;
}

/**
 * Softmax normalization with temperature parameter.
 * Better than linear min-max: exponentially emphasizes top-scoring candidates,
 * making the score distribution sharper and more decisive.
 * Temperature T: lower = sharper (0.1 = very concentrated, 1.0 = uniform)
 */
function softmaxNorm(scores: Record<string, number>, T = 0.25): Record<string, number> {
  const vals = Object.values(scores);
  if (vals.length === 0) return scores;
  const maxVal = Math.max(...vals, 0);
  const minVal = Math.min(...vals, 0);
  const range = maxVal - minVal || 1;
  // Scale to [0,1] then apply temperature-scaled softmax
  const scaledVals = vals.map(v => (v - minVal) / range / T);
  const maxScaled = Math.max(...scaledVals);
  const expVals = scaledVals.map(v => Math.exp(v - maxScaled)); // subtract max for numerical stability
  const sumExp = expVals.reduce((a, b) => a + b, 0) || 1;
  const keys = Object.keys(scores);
  const out: Record<string, number> = {};
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]!] = expVals[i]! / sumExp;
  }
  return out;
}

function top5From(scores: Record<string, number>): string[] {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
}

function confidenceFrom(scores: Record<string, number>, top = 10): number {
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const topSum = sorted.slice(0, top).reduce((a, b) => a + b, 0);
  const totalSum = sorted.reduce((a, b) => a + b, 0) || 1;
  return Math.round((topSum / totalSum) * 100);
}

function parseDay(tanggal: string): number {
  const DAY_MAP: Record<string, number> = {
    Minggu: 0, Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5, Sabtu: 6,
  };
  const day = tanggal.split(" ")[0] ?? "";
  return DAY_MAP[day] ?? 0;
}

// ─── Engine A: Transisi Slot ────────────────────────────────────────────────
// Analyze what 2D appears after each preceding result in this slot (Markov)
function engineTransisiSlot(draws: DrawRecord[], weight: number): SmartEngineOutput {
  const scores2d: Record<string, number> = {};
  for (const d of all2D()) scores2d[d] = 0;

  if (draws.length < 4) {
    return { id: "A", name: "Transisi Slot", weight, top5: [], confidence: 0, scores2d };
  }

  // Build transition: ekor(prev) -> 2D(cur)
  const trans: Record<string, Record<string, number>> = {};
  for (let i = 0; i < draws.length - 1; i++) {
    const cur = draws[i];
    const prev = draws[i + 1];
    const prevEkor = prev.ekor;
    const cur2d = cur.kepala + cur.ekor;
    if (!trans[prevEkor]) trans[prevEkor] = {};
    const decay = Math.exp(-0.025 * i);
    trans[prevEkor][cur2d] = (trans[prevEkor][cur2d] ?? 0) + decay;
  }

  // Also build: result4d(prev) last 2 digits → 2D(cur)
  const trans4d: Record<string, Record<string, number>> = {};
  for (let i = 0; i < draws.length - 1; i++) {
    const cur = draws[i];
    const prev = draws[i + 1];
    const prevKey = prev.kepala + prev.ekor;
    const cur2d = cur.kepala + cur.ekor;
    if (!trans4d[prevKey]) trans4d[prevKey] = {};
    const decay = Math.exp(-0.025 * i);
    trans4d[prevKey][cur2d] = (trans4d[prevKey][cur2d] ?? 0) + decay;
  }

  const latestEkor = draws[0]?.ekor ?? "0";
  const latest2dTail = (draws[0]?.kepala ?? "0") + (draws[0]?.ekor ?? "0");

  for (const d of all2D()) {
    const fromEkor = trans[latestEkor]?.[d] ?? 0;
    const fromPair = trans4d[latest2dTail]?.[d] ?? 0;
    scores2d[d] += fromEkor * 0.4 + fromPair * 0.6;
  }

  // Smoothing with global base frequency
  for (let i = 0; i < draws.length; i++) {
    const d2d = draws[i].kepala + draws[i].ekor;
    scores2d[d2d] = (scores2d[d2d] ?? 0) + Math.exp(-0.04 * i) * 0.1;
  }

  const norm = softmaxNorm(scores2d);
  return {
    id: "A", name: "Transisi Slot", weight,
    top5: top5From(norm), confidence: confidenceFrom(norm),
    scores2d: norm,
  };
}

// ─── Engine B: Recency Eksponensial ─────────────────────────────────────────
// Exponentially weighted 2D frequency for this specific slot
function engineRecencyEks(draws: DrawRecord[], weight: number): SmartEngineOutput {
  const scores2d: Record<string, number> = {};
  for (const d of all2D()) scores2d[d] = 0;

  for (let i = 0; i < draws.length; i++) {
    const w = Math.exp(-0.018 * i);
    const d2d = draws[i].kepala + draws[i].ekor;
    scores2d[d2d] = (scores2d[d2d] ?? 0) + w;
  }

  const norm = softmaxNorm(scores2d);
  return {
    id: "B", name: "Recency Eksponensial", weight,
    top5: top5From(norm), confidence: confidenceFrom(norm),
    scores2d: norm,
  };
}

// ─── Engine C: Gap / Overdue ─────────────────────────────────────────────────
// For each 2D, calculate gap since last appearance → overdue = higher score
function engineGapOverdue(draws: DrawRecord[], weight: number): SmartEngineOutput {
  const scores2d: Record<string, number> = {};
  const n = draws.length || 1;

  for (const target2d of all2D()) {
    const appearances: number[] = [];
    for (let i = 0; i < draws.length; i++) {
      if (draws[i].kepala + draws[i].ekor === target2d) appearances.push(i);
    }

    const freq = appearances.length;
    const gap = freq > 0 ? (appearances[0] ?? n) : n;
    const avgGap = freq > 0 ? n / freq : n;

    // Overdue ratio: gap/avgGap > 1 means overdue
    const overdueRatio = avgGap > 0 ? gap / avgGap : 1;
    // Nonlinear scoring: overdue gets boosted, early gets penalized
    const score = overdueRatio > 1
      ? 0.5 + Math.min(1.5, (overdueRatio - 1) * 0.8)
      : Math.max(0.05, 0.5 - (1 - overdueRatio) * 0.4);

    scores2d[target2d] = score * Math.min(1, freq / 5 + 0.3);
  }

  const norm = softmaxNorm(scores2d);
  return {
    id: "C", name: "Gap / Overdue", weight,
    top5: top5From(norm), confidence: confidenceFrom(norm),
    scores2d: norm,
  };
}

// ─── Engine D: Pola Hari + Slot ──────────────────────────────────────────────
// Day-of-week pattern: what 2D appears on this day-of-week for this slot?
function enginePolaHari(draws: DrawRecord[], targetDayOfWeek: number, weight: number): SmartEngineOutput {
  const scores2d: Record<string, number> = {};
  for (const d of all2D()) scores2d[d] = 0;

  // Draws on same day of week
  const sameDayDraws: Array<{ draw: DrawRecord; idx: number }> = [];
  for (let i = 0; i < draws.length; i++) {
    const dow = parseDay(draws[i].tanggal);
    if (dow === targetDayOfWeek) sameDayDraws.push({ draw: draws[i], idx: i });
  }

  for (const { draw, idx } of sameDayDraws) {
    const d2d = draw.kepala + draw.ekor;
    const weight = Math.exp(-0.03 * idx);
    scores2d[d2d] = (scores2d[d2d] ?? 0) + weight;
  }

  // Fallback: all draws with lower weight
  for (let i = 0; i < draws.length; i++) {
    const d2d = draws[i].kepala + draws[i].ekor;
    scores2d[d2d] = (scores2d[d2d] ?? 0) + Math.exp(-0.05 * i) * 0.1;
  }

  const norm = softmaxNorm(scores2d);
  return {
    id: "D", name: "Pola Hari + Slot", weight,
    top5: top5From(norm), confidence: confidenceFrom(norm),
    scores2d: norm,
  };
}

// ─── Engine E: Momentum Tren ─────────────────────────────────────────────────
// Compare recent N draws vs previous N draws for each 2D
function engineMomentum(draws: DrawRecord[], weight: number, windowSize = 15): SmartEngineOutput {
  const scores2d: Record<string, number> = {};
  for (const d of all2D()) scores2d[d] = 0;

  if (draws.length < windowSize * 2) {
    // Not enough data, fallback to frequency
    for (const draw of draws) {
      scores2d[draw.kepala + draw.ekor] = (scores2d[draw.kepala + draw.ekor] ?? 0) + 1;
    }
    const norm = softmaxNorm(scores2d);
    return { id: "E", name: "Momentum Tren", weight, top5: top5From(norm), confidence: confidenceFrom(norm), scores2d: norm };
  }

  const recent = draws.slice(0, windowSize);
  const older = draws.slice(windowSize, windowSize * 2);

  const recentFreq: Record<string, number> = {};
  const olderFreq: Record<string, number> = {};
  for (const d of all2D()) { recentFreq[d] = 0; olderFreq[d] = 0; }

  for (const d of recent) recentFreq[d.kepala + d.ekor] = (recentFreq[d.kepala + d.ekor] ?? 0) + 1;
  for (const d of older) olderFreq[d.kepala + d.ekor] = (olderFreq[d.kepala + d.ekor] ?? 0) + 1;

  for (const d of all2D()) {
    const r = recentFreq[d] / windowSize;
    const o = olderFreq[d] / windowSize;
    const momentum = r - o;
    scores2d[d] = 0.5 + momentum * 5;
  }

  const norm = softmaxNorm(scores2d);
  return {
    id: "E", name: "Momentum Tren", weight,
    top5: top5From(norm), confidence: confidenceFrom(norm),
    scores2d: norm,
  };
}

// ─── Engine F: Korelasi Posisi ───────────────────────────────────────────────
// Uses conditional joint distribution P(ekor | kepala) — captures actual correlations
// between digit positions, unlike the old independence assumption P(kepala) × P(ekor).
function engineKorelasiPosisi(draws: DrawRecord[], weight: number): SmartEngineOutput {
  // Build conditional matrix: kepalaToEkor[k][e] = weighted frequency of (k,e) pair
  const kepalaToEkor: Record<string, Record<string, number>> = {};
  for (let k = 0; k <= 9; k++) {
    kepalaToEkor[String(k)] = {};
    for (let e = 0; e <= 9; e++) {
      kepalaToEkor[String(k)][String(e)] = 0.05; // Laplace smoothing
    }
  }

  for (let i = 0; i < draws.length; i++) {
    const w = Math.exp(-0.022 * i);
    const k = draws[i].kepala;
    const e = draws[i].ekor;
    if (k && e) {
      kepalaToEkor[k][e] = (kepalaToEkor[k][e] ?? 0.05) + w;
    }
  }

  // Position-specific recency (recent window, faster decay)
  const posRecent: Record<Pos, Record<string, number>> = {
    as: {}, kop: {}, kepala: {}, ekor: {},
  };
  for (const pos of POSITIONS) {
    for (let d = 0; d <= 9; d++) posRecent[pos][String(d)] = 0.02;
  }
  const recentWin = Math.min(40, draws.length);
  for (let i = 0; i < recentWin; i++) {
    const w = Math.exp(-0.07 * i);
    for (const pos of POSITIONS) {
      const digit = draws[i][pos];
      if (digit) posRecent[pos][digit] = (posRecent[pos][digit] ?? 0.02) + w;
    }
  }

  // Score each 2D: joint P(kepala, ekor) = P(ekor | kepala) × P(kepala)
  const scores2d: Record<string, number> = {};
  for (const d of all2D()) {
    const kepala = d[0] ?? "0";
    const ekor = d[1] ?? "0";
    const condRow = kepalaToEkor[kepala] ?? {};
    const condTotal = Object.values(condRow).reduce((a, b) => a + b, 0) || 1;
    const pEkorGivenKepala = (condRow[ekor] ?? 0.05) / condTotal;
    const kepalaTotal = Object.values(posRecent.kepala).reduce((a, b) => a + b, 0) || 1;
    const pKepala = (posRecent.kepala[kepala] ?? 0.02) / kepalaTotal;
    scores2d[d] = pEkorGivenKepala * pKepala;
  }

  const norm = softmaxNorm(scores2d);
  return {
    id: "F", name: "Korelasi Posisi", weight,
    top5: top5From(norm), confidence: confidenceFrom(norm),
    scores2d: norm,
  };
}

// ─── Engine G: Kembar / Pola Siklus ─────────────────────────────────────────
// Detect cyclic intervals: if 2D last appeared N draws ago and avg cycle = N, score it high
function engineKembarSiklus(draws: DrawRecord[], weight: number): SmartEngineOutput {
  const scores2d: Record<string, number> = {};

  for (const target2d of all2D()) {
    const appearances: number[] = [];
    for (let i = 0; i < draws.length; i++) {
      if (draws[i].kepala + draws[i].ekor === target2d) appearances.push(i);
    }

    if (appearances.length < 2) {
      scores2d[target2d] = 0.3;
      continue;
    }

    // Calculate intervals between appearances
    const intervals: number[] = [];
    for (let i = 0; i < appearances.length - 1; i++) {
      intervals.push((appearances[i + 1] ?? 0) - (appearances[i] ?? 0));
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const currentGap = appearances[0] ?? 0; // gap from now

    // Score: how close is currentGap to avgInterval (or multiple)?
    const cyclePhase = avgInterval > 0 ? currentGap / avgInterval : 0;
    const distToNext = Math.abs(cyclePhase - Math.round(cyclePhase));
    const cycleScore = Math.max(0.1, 1 - distToNext * 2); // peak when cyclePhase ≈ integer

    // Also boost twin numbers (AA pattern)
    const isTwin = target2d[0] === target2d[1];
    const twinBonus = isTwin ? 0.1 : 0;

    scores2d[target2d] = cycleScore + twinBonus;
  }

  const norm = softmaxNorm(scores2d);
  return {
    id: "G", name: "Kembar / Pola Siklus", weight,
    top5: top5From(norm), confidence: confidenceFrom(norm),
    scores2d: norm,
  };
}

// ─── Combine Engines ────────────────────────────────────────────────────────
function combineEngines(engines: SmartEngineOutput[]): Record<string, number> {
  const combined: Record<string, number> = {};
  for (const d of all2D()) combined[d] = 0;

  const totalWeight = engines.reduce((s, e) => s + e.weight, 0) || 1;
  for (const eng of engines) {
    const normalizedW = eng.weight / totalWeight;
    for (const d of all2D()) {
      combined[d] += (eng.scores2d[d] ?? 0) * normalizedW;
    }
  }

  // Apply softmax to combined scores — sharpens the final consensus ranking
  return softmaxNorm(combined, 0.2);
}

// ─── Build 4D Candidates ────────────────────────────────────────────────────
function build4DCandidates(
  draws: DrawRecord[],
  combined2d: Record<string, number>,
  posFreq: Record<Pos, Record<string, number>>,
  topN = 20
): string[] {
  // Get top 5 for each position digit
  const topPos: Record<Pos, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  for (const pos of POSITIONS) {
    topPos[pos] = Object.entries(posFreq[pos])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([d]) => d);
  }

  // Generate 4D candidates from position cross-product
  const candidates: Array<{ num: string; score: number }> = [];
  for (const as of topPos.as) {
    for (const kop of topPos.kop) {
      for (const kepala of topPos.kepala) {
        for (const ekor of topPos.ekor) {
          const num = as + kop + kepala + ekor;
          const score2d = (combined2d[kepala + ekor] ?? 0) * 0.5 +
                          (combined2d[as + kop] ?? 0) * 0.3 +
                          (combined2d[kop + kepala] ?? 0) * 0.2;
          candidates.push({ num, score: score2d });
        }
      }
    }
  }

  // Add top-N from historical 4D patterns
  const hist4dFreq: Record<string, number> = {};
  for (let i = 0; i < draws.length; i++) {
    const num = draws[i].result4d;
    hist4dFreq[num] = (hist4dFreq[num] ?? 0) + Math.exp(-0.025 * i);
  }

  // Sort and deduplicate
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(c => { if (seen.has(c.num)) return false; seen.add(c.num); return true; })
    .slice(0, topN)
    .map(c => c.num);
}

// ─── Classify Helpers ────────────────────────────────────────────────────────
function getShio(ekor: string): string {
  return SHIO_MAP[ekor] ?? "Tikus";
}

function getSilangHomo(as: string, ekor: string): string {
  const diff = Math.abs(parseInt(as) - parseInt(ekor));
  return SILANG_HOMO[diff] ?? "Silang";
}

// Build diverse top-N 2D candidates for a pair of positions (e.g. AS+KOP for
// "depan", KOP+KEPALA for "tengah") from the per-position frequency cross-product.
function top2dForPositions(
  posFreq: Record<Pos, Record<string, number>>,
  p1: Pos,
  p2: Pos,
  n = 5,
): string[] {
  const a1 = Object.entries(posFreq[p1]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const a2 = Object.entries(posFreq[p2]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const cands: Array<{ num: string; score: number }> = [];
  for (const [d1, s1] of a1) {
    for (const [d2, s2] of a2) {
      cands.push({ num: d1 + d2, score: s1 * s2 });
    }
  }
  const seen = new Set<string>();
  return cands
    .sort((a, b) => b.score - a.score)
    .filter(c => { if (seen.has(c.num)) return false; seen.add(c.num); return true; })
    .slice(0, n)
    .map(c => c.num);
}

function scoreLabel(score: number): { label: string; color: string } {
  if (score > 0.8) return { label: "SANGAT TINGGI", color: "green" };
  if (score > 0.6) return { label: "TINGGI", color: "green" };
  if (score > 0.4) return { label: "BAIK", color: "yellow" };
  if (score > 0.2) return { label: "SEDANG", color: "orange" };
  return { label: "RENDAH", color: "red" };
}

// ─── Main Analysis Function ──────────────────────────────────────────────────
export function runSmartAI(
  pasaran: string,
  slot: string,
  slotDraws: DrawRecord[],  // draws for this specific slot, newest first
  prevSlotResult: string,   // result from the previous slot
  todayDayOfWeek: number,   // 0=Sun, 1=Mon, ..., 6=Sat
): SmartAIResult {
  const draws = slotDraws;
  const n = draws.length;

  if (n < 5) {
    logger.warn({ pasaran, slot, n }, "SmartAI: insufficient data for analysis");
  }

  // Load adaptive weights from laporan-engine backtesting (or defaults if not yet computed)
  const w = getSmartAIWeights(pasaran);

  // Run all 7 engines with adaptive weights
  const engines: SmartEngineOutput[] = [
    engineTransisiSlot(draws, w.A ?? DEFAULT_WEIGHTS.A!),
    engineRecencyEks(draws, w.B ?? DEFAULT_WEIGHTS.B!),
    engineGapOverdue(draws, w.C ?? DEFAULT_WEIGHTS.C!),
    enginePolaHari(draws, todayDayOfWeek, w.D ?? DEFAULT_WEIGHTS.D!),
    engineMomentum(draws, w.E ?? DEFAULT_WEIGHTS.E!),
    engineKorelasiPosisi(draws, w.F ?? DEFAULT_WEIGHTS.F!),
    engineKembarSiklus(draws, w.G ?? DEFAULT_WEIGHTS.G!),
  ];

  // Combined 2D scores
  const combined2d = combineEngines(engines);

  // Position frequencies for 4D building
  const posFreq: Record<Pos, Record<string, number>> = { as: {}, kop: {}, kepala: {}, ekor: {} };
  for (const pos of POSITIONS) {
    for (let d = 0; d <= 9; d++) posFreq[pos][String(d)] = 0;
  }
  for (let i = 0; i < draws.length; i++) {
    const w = Math.exp(-0.02 * i);
    const draw = draws[i];
    for (const pos of POSITIONS) {
      const dv = draw[pos];
      if (dv) posFreq[pos][dv] = (posFreq[pos][dv] ?? 0) + w;
    }
  }

  // Build 4D candidates
  const pred4d = build4DCandidates(draws, combined2d, posFreq, 25);
  const main4d = pred4d[0] ?? "0000";

  // Top 2D sorted by combined score
  const top2dSorted = Object.entries(combined2d)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  // Prediction sets
  const top10_2d = top2dSorted.slice(0, 10);
  const pred2dEkor = top10_2d.slice(0, 5); // kepala+ekor (belakang)
  // Depan = AS+KOP, Tengah = KOP+KEPALA — built from per-position frequencies so
  // each set has diverse, position-correct candidates (not repeated identicals).
  const pred2dDepan = top2dForPositions(posFreq, "as", "kop", 5);
  const pred2dTengah = top2dForPositions(posFreq, "kop", "kepala", 5);

  const pred3d = pred4d.slice(0, 5).map(n4 => n4.slice(1)); // KOP+KEPALA+EKOR
  const pred3dUniq = [...new Set(pred3d)].slice(0, 5);

  // Colok bebas: top individual digits by ekor position frequency
  const ekorRanked = Object.entries(posFreq.ekor).sort((a, b) => b[1] - a[1]);
  const colokBebas = ekorRanked.slice(0, 6).map(([d]) => d);
  const colokBebas2d = top10_2d.slice(0, 5);

  // Colok Jitu: top digit per position
  const colokJitu: SmartColokJitu[] = POSITIONS.map(pos => ({
    posisi: pos.toUpperCase(),
    digit: Object.entries(posFreq[pos]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "0",
  }));

  // BBFS 5D: unique top digits from all positions
  const allTopDigits = new Set<string>();
  for (const pos of POSITIONS) {
    for (const [d] of Object.entries(posFreq[pos]).sort((a,b) => b[1]-a[1]).slice(0, 3)) {
      allTopDigits.add(d);
    }
  }
  const bbfs5d = [...allTopDigits].slice(0, 6);

  // Dasar, TengahTepi, SilangHomo, KembangKempis
  const topEkor = ekorRanked[0]?.[0] ?? "0";
  const topAs = Object.entries(posFreq.as).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "0";
  const ekorNum = parseInt(topEkor);
  const dasar = (ekorNum % 2 === 0 ? "Genap" : "Ganjil") + " & " + (ekorNum >= 5 ? "Besar" : "Kecil");
  const tengahTepi = [0, 1, 8, 9].includes(ekorNum) ? "Tepi" : "Tengah";
  const silangHomo = getSilangHomo(topAs, topEkor);

  // KembangKempis: compare prev ekor to predicted ekor
  const prevEkor = prevSlotResult ? prevSlotResult[3] ?? "0" : draws[0]?.ekor ?? "0";
  const prevEkorNum = parseInt(prevEkor);
  const kembangKempis = ekorNum > prevEkorNum ? "Naik (Kembang)" :
                        ekorNum < prevEkorNum ? "Turun (Kempis)" : "Stabil";

  // Shio: top shio for predicted ekor
  const topShio = getShio(topEkor);
  const shio = [topShio, getShio(ekorRanked[1]?.[0] ?? "1"), getShio(ekorRanked[2]?.[0] ?? "2")]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3);

  // BOM 2D: combination prediction
  const bom2dNum = topEkor + (ekorRanked[1]?.[0] ?? "0");
  const bom2d = [bom2dNum, bom2dNum.split("").reverse().join("")]
    .filter((v, i, a) => a.indexOf(v) === i).join(", ");

  // TOP DIGIT KANDIDAT (top 2D list, more extensive)
  const topDigitKandidat = top2dSorted.slice(0, 20);

  // TOP REKOMENDASI: top 5 from 2D scoring
  const maxScore = combined2d[top2dSorted[0]] ?? 1;
  const topRekomendasi: SmartRekomend[] = top2dSorted.slice(0, 5).map((num, i) => {
    const score = combined2d[num] ?? 0;
    const pct = Math.round((score / maxScore) * 100);
    const { label, color } = scoreLabel(score);
    return { rank: i + 1, number: num, score: pct, label, color };
  });

  // Overall confidence: weighted average of engine confidences, bonus for data volume
  // Uses adaptive weights so engines with better track records contribute more to confidence
  const totalW = engines.reduce((s, e) => s + e.weight, 0) || 1;
  const baseConf = engines.reduce((acc, e) => acc + e.confidence * (e.weight / totalW), 0);
  const dataBonus = Math.min(12, Math.floor(n / 12));
  const { isAdaptive } = getSmartAIWeightsState(pasaran);
  const adaptiveBonus = isAdaptive ? 5 : 0; // small bonus when weights are data-driven
  const overallConfidence = Math.min(98, Math.max(42, Math.round(baseConf + dataBonus + adaptiveBonus)));

  return {
    pasaran,
    slot,
    analyzedAt: new Date().toISOString(),
    totalSlotDraws: n,
    lastResult: draws[0]?.result4d ?? "-",
    lastResultAt: draws[0]?.tanggal ?? "-",
    prevSlotResult,
    overallConfidence,
    main4d,
    bbfs5d,
    pred4d: pred4d.slice(0, 5),
    pred3d: pred3dUniq,
    pred2dEkor,
    pred2dDepan,
    pred2dTengah,
    colokBebas,
    colokBebas2d,
    colokJitu,
    dasar,
    tengahTepi,
    silangHomo,
    kembangKempis,
    shio,
    bom2d,
    topDigitKandidat,
    topRekomendasi,
    engines,
  };
}
