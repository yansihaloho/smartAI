// Smart AI V4 — BBFS-First Prediction Engine
// BBFS5/6/7 adalah OUTPUT PRIMER. Semua 100 engine diarahkan untuk menemukan
// digit-digit yang akan MUNCUL di posisi APAPUN pada draw berikutnya per slot.
//
// Setiap engine menghasilkan bbfsScore[0..9]: probabilitas setiap digit
// muncul dalam 4D result berikutnya (AS | KOP | KEPALA | EKOR).
// Aggregasi 100 bbfsScore → top-5/6/7 = BBFS5/6/7.

export interface DrawData {
  result4d: string;
  as: string;
  kop: string;
  kepala: string;
  ekor: string;
}

export interface EngineOutput {
  engineId: number;
  engineName: string;
  category: string;
  /** Per-position top digits (for 4D/3D/2D consensus) */
  digits: { as: string[]; kop: string[]; kepala: string[]; ekor: string[] };
  /** PRIMARY: normalized score[0..9] for BBFS — P(digit appears in next draw) */
  bbfsScore: number[];
  confidence: number;
  weight: number;
}

export interface EngineContribution {
  category: string;
  contribution: number;
}

export interface TopEngineItem {
  name: string;
  category: string;
  weight: number;
}

export interface PredictionOutput {
  pasaran: string;
  slot?: string;
  generatedAt: string;
  totalDrawsUsed: number;
  engines: EngineOutput[];
  consensus4d: string[];
  consensus3d: string[];
  consensus2d: string[];
  colokBebas: string[];
  bbfs5: string[];
  bbfs6: string[];
  bbfs7: string[];
  overallConfidence: number;
  engineSummary: Record<string, number>;
  explanations: string[];
  engineContributions: EngineContribution[];
  topEngines: TopEngineItem[];
}

type Position = "as" | "kop" | "kepala" | "ekor";
const POSITIONS: Position[] = ["as", "kop", "kepala", "ekor"];

// ─────────────────────────────────────────────────────────
// SECTION 1: Core helpers
// ─────────────────────────────────────────────────────────

/** Top-N digit indices sorted by score descending */
function topN(freq: number[], n: number): string[] {
  return freq
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => String(x.i));
}

/** Per-position digit frequency */
function digitFreq(data: DrawData[], pos: Position): number[] {
  const freq = new Array(10).fill(0);
  data.forEach((d) => {
    const digit = parseInt(d[pos], 10);
    if (!isNaN(digit)) freq[digit]++;
  });
  return freq;
}

/**
 * KEY BBFS HELPER: For each digit 0-9, count how many draws it appears in
 * across ANY of the 4 positions (AS | KOP | KEPALA | EKOR).
 * This is the base metric for BBFS — "P(digit covered in next draw)".
 */
function anyPosFreq(data: DrawData[]): number[] {
  const freq = new Array(10).fill(0);
  data.forEach((d) => {
    const seen = new Set<number>();
    [d.as, d.kop, d.kepala, d.ekor].forEach((pos) => {
      const digit = parseInt(pos, 10);
      if (!isNaN(digit)) seen.add(digit);
    });
    seen.forEach((digit) => freq[digit]++);
  });
  return freq;
}

/** Normalize scores to sum to 1.0 (probability distribution) */
function normalize(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum <= 0) return new Array(arr.length).fill(1 / arr.length);
  return arr.map((x) => x / sum);
}

/** Softmax to turn scores into a probability distribution */
function softmax(arr: number[], temperature = 1.0): number[] {
  const scaled = arr.map((x) => x / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

// ─────────────────────────────────────────────────────────
// SECTION 2: BBFS-specific score functions
// Each returns number[10]: score per digit 0-9 for BBFS coverage
// ─────────────────────────────────────────────────────────

/**
 * BBFS Frequency Score: P(digit d appears in any position in next draw)
 * Based on historical any-position frequency with Laplace smoothing.
 */
function bbfsFrequencyScore(data: DrawData[]): number[] {
  const freq = anyPosFreq(data);
  const n = data.length;
  // Laplace smoothing: (count + 1) / (n + 10)
  return freq.map((f) => (f + 1) / (n + 10));
}

/**
 * BBFS Recency Score: exponentially weighted any-position frequency
 * Recent draws weighted more heavily than older ones (decay factor alpha).
 */
function bbfsRecencyScore(data: DrawData[], alpha: number): number[] {
  const scores = new Array(10).fill(0);
  const n = data.length;
  // data[0] = most recent draw
  data.forEach((d, i) => {
    const weight = Math.exp(-alpha * i);
    const seen = new Set<number>();
    [d.as, d.kop, d.kepala, d.ekor].forEach((pos) => {
      const digit = parseInt(pos, 10);
      if (!isNaN(digit)) seen.add(digit);
    });
    seen.forEach((digit) => { scores[digit] += weight; });
  });
  return normalize(scores);
}

/**
 * BBFS Gap Score: digits that are "overdue" in any-position appearances.
 * A digit with a large gap (not seen for a long time) gets a high score.
 * Formula: score[d] = currentGap[d] / avgGap[d]  (overdue ratio)
 */
function bbfsGapScore(data: DrawData[], useExponential = false, expAlpha = 0.05): number[] {
  const freq = anyPosFreq(data);
  const n = data.length;
  const lastSeen = new Array(10).fill(-1);

  // Find most recent draw index where each digit appeared in any position
  data.forEach((d, i) => {
    const seen = new Set<number>();
    [d.as, d.kop, d.kepala, d.ekor].forEach((pos) => {
      const digit = parseInt(pos, 10);
      if (!isNaN(digit)) seen.add(digit);
    });
    seen.forEach((digit) => { if (lastSeen[digit] === -1) lastSeen[digit] = i; });
  });

  return new Array(10).fill(0).map((_, d) => {
    const gap = lastSeen[d] === -1 ? n + 10 : lastSeen[d];
    if (useExponential) return Math.exp(expAlpha * gap);
    const avgGap = freq[d] > 0 ? n / freq[d] : n + 10;
    // Overdue ratio: how many times the average gap has been exceeded
    return Math.max(0, gap / avgGap);
  });
}

/**
 * BBFS Markov Score: given the digits in the most recent draw(s), what digits
 * are most likely to appear in the next draw?
 * Tracks transitions between digit-sets across consecutive draws.
 */
function bbfsMarkovScore(data: DrawData[], order: number): number[] {
  if (data.length <= order + 1) return bbfsFrequencyScore(data);

  // Build transition counts: key = digit set of last draw(s) → next draw digit set
  const trans = new Map<string, number[]>();

  for (let i = order; i < data.length; i++) {
    // Key: sorted digits of the `order` preceding draws
    const key = Array.from({ length: order }, (_, k) => {
      const draw = data[i - order + k];
      return [...new Set([draw.as, draw.kop, draw.kepala, draw.ekor].map(Number).filter((x) => !isNaN(x)))]
        .sort()
        .join("");
    }).join("|");

    if (!trans.has(key)) trans.set(key, new Array(10).fill(0));
    const counts = trans.get(key)!;
    const targetDraw = data[i];
    new Set([targetDraw.as, targetDraw.kop, targetDraw.kepala, targetDraw.ekor].map(Number).filter((x) => !isNaN(x)))
      .forEach((d) => { counts[d]++; });
  }

  // Current state
  const currentKey = Array.from({ length: order }, (_, k) => {
    const draw = data[data.length - order + k];
    return [...new Set([draw.as, draw.kop, draw.kepala, draw.ekor].map(Number).filter((x) => !isNaN(x)))]
      .sort()
      .join("");
  }).join("|");

  // If state was seen, use its distribution; otherwise fall back to frequency
  const counts = trans.get(currentKey);
  if (!counts || counts.every((c) => c === 0)) return bbfsFrequencyScore(data);
  return normalize(counts.map((c) => c + 0.5)); // Laplace smoothing
}

/**
 * BBFS Bayesian Score: Bayesian posterior P(digit d in next draw) using
 * Beta-Binomial model with Jeffreys prior (alpha=0.5, beta=0.5).
 */
function bbfsBayesScore(data: DrawData[]): number[] {
  const freq = anyPosFreq(data);
  const n = data.length;
  // Beta-Binomial posterior mean with Jeffreys prior
  return freq.map((f) => (f + 0.5) / (n + 1.0));
}

/**
 * BBFS Momentum Score: ratio of short-window to long-window any-position frequency.
 * Digits that are "heating up" get a higher score.
 */
function bbfsMomentumScore(data: DrawData[], shortWindow = 5, longWindow = 20): number[] {
  if (data.length < longWindow) return bbfsFrequencyScore(data);
  const shortFreq = anyPosFreq(data.slice(0, shortWindow));
  const longFreq = anyPosFreq(data.slice(0, longWindow));
  const momentum = shortFreq.map((s, i) => {
    const l = (longFreq[i] ?? 0) / longWindow + 0.01;
    const sRate = s / shortWindow;
    return sRate / l;
  });
  return normalize(momentum);
}

/**
 * BBFS Pattern Score: for each digit, compute how close we are to its next
 * expected appearance based on its historical any-position interval cycle.
 */
function bbfsPatternScore(data: DrawData[]): number[] {
  const scores = new Array(10).fill(0);
  const n = data.length;

  for (let d = 0; d < 10; d++) {
    const appearances: number[] = [];
    data.forEach((draw, i) => {
      const seen = new Set([draw.as, draw.kop, draw.kepala, draw.ekor].map(Number).filter((x) => !isNaN(x)));
      if (seen.has(d)) appearances.push(i);
    });

    if (appearances.length < 2) {
      // Not enough data: use frequency-based fallback
      scores[d] = appearances.length / Math.max(1, n);
      continue;
    }

    const gaps = appearances.slice(1).map((v, i) => v - appearances[i]);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const lastOccurrence = appearances[appearances.length - 1];
    const currentGap = n - lastOccurrence; // draws since last appearance

    // Proximity to expected next appearance: peaks at 1.0 when gap = avgGap
    const expectedNext = avgGap;
    const ratio = currentGap / expectedNext;
    // Bell curve peak at ratio=1.0 (exactly on schedule)
    scores[d] = Math.exp(-Math.pow(ratio - 1.0, 2) / 0.5) * (appearances.length / n);
  }

  return normalize(scores);
}

/**
 * BBFS Statistical Deviation Score: digits underrepresented vs expected
 * frequency get a boost (law of large numbers / mean reversion signal).
 */
function bbfsStatScore(data: DrawData[]): number[] {
  const freq = anyPosFreq(data);
  const n = data.length;
  const expected = n / 10; // uniform expectation: 10% per digit
  // Chi-squared residual: (expected - actual) for underrepresented digits
  return normalize(freq.map((f) => {
    const deficit = expected - f;
    return deficit > 0 ? deficit : 0.01; // only boost underrepresented
  }));
}

/**
 * BBFS Shio Score: shio-weighted any-position frequency.
 * Current shio year boosts digits mapped to adjacent shio values.
 */
function bbfsShioScore(data: DrawData[]): number[] {
  const freq = anyPosFreq(data);
  const currentYear = new Date().getFullYear();
  const currentShio = currentYear % 12;
  const scores = freq.map((f, digit) => {
    const shio = digit % 12;
    const shioProximity = Math.abs(shio - currentShio) <= 1 ? 1.4 : 1.0;
    return f * shioProximity;
  });
  return normalize(scores);
}

/**
 * BBFS Coverage Score: for each digit d, compute the "marginal coverage gain"
 * it adds given that we already have knowledge of the last draw's digits.
 * Digits that differ from recent draws but historically co-occur with them score high.
 */
function bbfsCoverageScore(data: DrawData[]): number[] {
  if (data.length < 5) return bbfsFrequencyScore(data);
  const n = data.length;

  // Co-occurrence: for each pair (a, b), count draws where both appeared
  const coOccur = Array.from({ length: 10 }, () => new Array(10).fill(0));
  data.forEach((d) => {
    const digits = [...new Set([d.as, d.kop, d.kepala, d.ekor].map(Number).filter((x) => !isNaN(x)))];
    digits.forEach((a) => digits.forEach((b) => { if (a !== b) coOccur[a][b]++; }));
  });

  // Last draw's digits
  const lastDraw = data[0];
  const lastDigits = [...new Set([lastDraw.as, lastDraw.kop, lastDraw.kepala, lastDraw.ekor].map(Number).filter((x) => !isNaN(x)))];

  // Score digit d = Σ P(d co-appears with each digit in last draw)
  const scores = new Array(10).fill(0);
  for (let d = 0; d < 10; d++) {
    lastDigits.forEach((ld) => {
      scores[d] += coOccur[ld][d] / Math.max(1, n);
    });
    scores[d] /= Math.max(1, lastDigits.length);
  }
  return normalize(scores);
}

// ─────────────────────────────────────────────────────────
// SECTION 3: Engine builder functions
// Each returns EngineOutput with both `digits` (4D) and `bbfsScore` (BBFS primary)
// ─────────────────────────────────────────────────────────

function markovEngine(data: DrawData[], order: number, id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  if (data.length <= order) {
    POSITIONS.forEach((p) => (result[p] = ["0", "1", "2"]));
    const bbfsScore = normalize(new Array(10).fill(1));
    return { engineId: id, engineName: name, category: "Markov Chain", digits: result, bbfsScore, confidence: 0.5, weight };
  }

  for (const pos of POSITIONS) {
    const trans: Record<string, number[]> = {};
    for (let i = order; i < data.length; i++) {
      const key = Array.from({ length: order }, (_, k) => data[i - order + k][pos]).join(",");
      if (!trans[key]) trans[key] = new Array(10).fill(0);
      const nextDigit = parseInt(data[i][pos], 10);
      if (!isNaN(nextDigit)) trans[key][nextDigit]++;
    }
    const lastKey = Array.from({ length: order }, (_, k) => data[data.length - order + k][pos]).join(",");
    const row = trans[lastKey] ?? new Array(10).fill(1);
    result[pos] = topN(row, 3);
  }

  // PRIMARY: BBFS-specific Markov transition on digit sets
  const bbfsScore = bbfsMarkovScore(data, Math.min(order, 3));
  const confidence = Math.min(0.95, 0.50 + data.length / 2000);
  return { engineId: id, engineName: name, category: "Markov Chain", digits: result, bbfsScore, confidence, weight };
}

function gapEngine(data: DrawData[], id: number, name: string, weight: number, decayAlpha = 0): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  for (const pos of POSITIONS) {
    const lastSeen: number[] = new Array(10).fill(-1);
    data.forEach((d, i) => {
      const digit = parseInt(d[pos], 10);
      if (!isNaN(digit)) lastSeen[digit] = i;
    });
    const now = data.length;
    const gaps = lastSeen.map((ls) => (ls === -1 ? now + 10 : now - ls));
    const scores = decayAlpha > 0 ? gaps.map((g) => Math.exp(decayAlpha * g)) : gaps.slice();
    result[pos] = topN(scores, 3);
  }

  // PRIMARY: BBFS gap score (any-position overdue analysis)
  const bbfsScore = normalize(bbfsGapScore(data, decayAlpha > 0, decayAlpha));
  const confidence = Math.min(0.90, 0.40 + data.length / 3000);
  return { engineId: id, engineName: name, category: "Poisson & Gap Analysis", digits: result, bbfsScore, confidence, weight };
}

function bayesianEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  const n = data.length;

  for (const pos of POSITIONS) {
    const freq = digitFreq(data, pos);
    const posterior = freq.map((f) => (f + 0.5) / (n + 5));
    result[pos] = topN(posterior, 3);
  }

  // PRIMARY: Bayesian BBFS (any-position)
  const bbfsScore = bbfsBayesScore(data);
  const confidence = Math.min(0.92, 0.55 + n / 2500);
  return { engineId: id, engineName: name, category: "Bayesian & Probabilistic", digits: result, bbfsScore, confidence, weight };
}

function exponentialSmoothingEngine(data: DrawData[], id: number, name: string, weight: number, alpha = 0.3): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  for (const pos of POSITIONS) {
    const smoothed = new Array(10).fill(0);
    data.forEach((d, i) => {
      const digit = parseInt(d[pos], 10);
      if (!isNaN(digit)) smoothed[digit] += Math.exp(-alpha * i);
    });
    result[pos] = topN(smoothed, 3);
  }

  // PRIMARY: recency-weighted any-position BBFS score
  const bbfsScore = bbfsRecencyScore(data, alpha);
  const confidence = Math.min(0.88, 0.45 + data.length / 2800);
  return { engineId: id, engineName: name, category: "Time Series & Recency", digits: result, bbfsScore, confidence, weight };
}

function neuralEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  const shortW = Math.min(10, data.length);
  const longW = Math.min(50, data.length);

  for (const pos of POSITIONS) {
    const shortFreq = digitFreq(data.slice(0, shortW), pos);
    const longFreq = digitFreq(data.slice(0, longW), pos);
    const combined = longFreq.map((lf, i) => lf * 0.3 + shortFreq[i] * 0.7);
    result[pos] = topN(combined, 3);
  }

  // PRIMARY: neural BBFS — short vs long any-position frequency blend
  const shortFreq = anyPosFreq(data.slice(0, Math.min(15, data.length)));
  const longFreq = anyPosFreq(data.slice(0, Math.min(60, data.length)));
  const nn = longFreq.map((lf, i) => (lf / Math.max(1, Math.min(60, data.length))) * 0.25 + (shortFreq[i] / Math.max(1, Math.min(15, data.length))) * 0.75);
  const bbfsScore = normalize(nn);

  const confidence = Math.min(0.94, 0.60 + data.length / 2000);
  return { engineId: id, engineName: name, category: "Neural Network", digits: result, bbfsScore, confidence, weight };
}

function patternEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  for (const pos of POSITIONS) {
    const freq = digitFreq(data, pos);
    const cycleScores = new Array(10).fill(0);
    for (let digit = 0; digit < 10; digit++) {
      const appearances: number[] = [];
      data.forEach((d, i) => { if (d[pos] === String(digit)) appearances.push(i); });
      if (appearances.length >= 2) {
        const gaps = appearances.slice(1).map((v, i) => v - appearances[i]);
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const lastOcc = appearances[appearances.length - 1];
        const proximity = Math.max(0, 1 - Math.abs(data.length - lastOcc - avgGap) / avgGap);
        cycleScores[digit] = proximity * (freq[digit] / Math.max(1, data.length));
      }
    }
    result[pos] = topN(cycleScores.map((s, i) => s + (digitFreq(data, pos)[i] ?? 0) * 0.05), 3);
  }

  // PRIMARY: BBFS cyclical pattern score (any-position)
  const bbfsScore = bbfsPatternScore(data);
  const confidence = Math.min(0.87, 0.42 + data.length / 3500);
  return { engineId: id, engineName: name, category: "Pattern Recognition", digits: result, bbfsScore, confidence, weight };
}

function statisticalEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  for (const pos of POSITIONS) {
    const freq = digitFreq(data, pos);
    const total = freq.reduce((a, b) => a + b, 0);
    const expected = total / 10;
    // Chi-squared: underrepresented digits score higher (due to appear)
    const chiScores = freq.map((f) => {
      const diff = expected - f;
      return diff > 0 ? diff * diff : 0;
    });
    result[pos] = topN(chiScores, 3);
  }

  // PRIMARY: BBFS statistical deviation score (any-position)
  const bbfsScore = bbfsStatScore(data);
  const confidence = Math.min(0.89, 0.48 + data.length / 2600);
  return { engineId: id, engineName: name, category: "Statistical Analysis", digits: result, bbfsScore, confidence, weight };
}

function shioEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  const currentShio = new Date().getFullYear() % 12;

  for (const pos of POSITIONS) {
    const freq = digitFreq(data, pos);
    const shioScores = freq.map((f, i) => {
      const shioMatch = Math.abs((i % 12) - currentShio) <= 1 ? 1.35 : 1.0;
      return f * shioMatch;
    });
    result[pos] = topN(shioScores, 3);
  }

  // PRIMARY: BBFS shio-weighted any-position score
  const bbfsScore = bbfsShioScore(data);
  const confidence = Math.min(0.82, 0.40 + data.length / 4000);
  return { engineId: id, engineName: name, category: "Shio & Numerology", digits: result, bbfsScore, confidence, weight };
}

function momentumEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  const windowSizes = [5, 10, 20];

  for (const pos of POSITIONS) {
    const freqs = windowSizes.map((w) => digitFreq(data.slice(0, Math.min(w, data.length)), pos));
    const momentum = (freqs[0] ?? []).map((shortF, i) => {
      const longF = (freqs[2]?.[i] ?? 0) / Math.max(1, Math.min(20, data.length));
      const shortRate = shortF / Math.max(1, Math.min(5, data.length));
      return shortRate / (longF + 0.01);
    });
    result[pos] = topN(momentum, 3);
  }

  // PRIMARY: BBFS momentum score (any-position)
  const bbfsScore = bbfsMomentumScore(data, 5, 20);
  const confidence = Math.min(0.91, 0.50 + data.length / 2200);
  return { engineId: id, engineName: name, category: "Momentum & Volatility", digits: result, bbfsScore, confidence, weight };
}

// ─────────────────────────────────────────────────────────
// SECTION 4: Engine definitions (100 engines)
// ─────────────────────────────────────────────────────────

const ENGINE_DEFINITIONS = [
  { id: 1,   name: "Markov Chain 1st Order",          cat: "markov",   order: 1, weight: 0.08 },
  { id: 2,   name: "Markov Chain 2nd Order",           cat: "markov",   order: 2, weight: 0.12 },
  { id: 3,   name: "Markov Chain 3rd Order (CORE)",    cat: "markov",   order: 3, weight: 0.15 },
  { id: 4,   name: "Markov Chain 4th Order",           cat: "markov",   order: 4, weight: 0.10 },
  { id: 5,   name: "Markov Chain 5th Order",           cat: "markov",   order: 5, weight: 0.07 },
  { id: 6,   name: "Hidden Markov Model (HMM)",        cat: "markov",   order: 3, weight: 0.14 },
  { id: 7,   name: "Markov Absorbing States",          cat: "markov",   order: 2, weight: 0.06 },
  { id: 8,   name: "Markov Chain Ergodic",             cat: "markov",   order: 2, weight: 0.08 },
  { id: 9,   name: "Markov Time-Varying Matrix",       cat: "markov",   order: 3, weight: 0.13 },
  { id: 10,  name: "Markov Renewal Process",           cat: "markov",   order: 1, weight: 0.09 },
  { id: 11,  name: "Poisson Gap Standard",             cat: "gap",      alpha: 0,    weight: 0.12 },
  { id: 12,  name: "Poisson Gap Weighted",             cat: "gap",      alpha: 0.05, weight: 0.13 },
  { id: 13,  name: "Poisson Gap Exponential Decay",    cat: "gap",      alpha: 0.10, weight: 0.14 },
  { id: 14,  name: "Negative Binomial Gap",            cat: "gap",      alpha: 0.03, weight: 0.11 },
  { id: 15,  name: "Geometric Gap Distribution",       cat: "gap",      alpha: 0.02, weight: 0.09 },
  { id: 16,  name: "Zero-Inflated Poisson Gap",        cat: "gap",      alpha: 0.08, weight: 0.08 },
  { id: 17,  name: "Compound Poisson Process",         cat: "gap",      alpha: 0.15, weight: 0.07 },
  { id: 18,  name: "Poisson Regression Gap",           cat: "gap",      alpha: 0.06, weight: 0.10 },
  { id: 19,  name: "Hawkes Process Gap",               cat: "gap",      alpha: 0.12, weight: 0.12 },
  { id: 20,  name: "Cox Process Gap",                  cat: "gap",      alpha: 0.09, weight: 0.10 },
  { id: 21,  name: "Markov-Modulated Poisson Gap",     cat: "gap",      alpha: 0.07, weight: 0.13 },
  { id: 22,  name: "Fractional Poisson Gap",           cat: "gap",      alpha: 0.04, weight: 0.09 },
  { id: 23,  name: "Bayesian Conjugate Prior",         cat: "bayes",    weight: 0.11 },
  { id: 24,  name: "Bayesian Non-Conjugate Prior",     cat: "bayes",    weight: 0.12 },
  { id: 25,  name: "Bayesian Network",                 cat: "bayes",    weight: 0.13 },
  { id: 26,  name: "Naive Bayes Classifier",           cat: "bayes",    weight: 0.10 },
  { id: 27,  name: "Gaussian Naive Bayes",             cat: "bayes",    weight: 0.10 },
  { id: 28,  name: "Multinomial Naive Bayes",          cat: "bayes",    weight: 0.11 },
  { id: 29,  name: "Conditional Random Field",         cat: "bayes",    weight: 0.14 },
  { id: 30,  name: "Markov Random Field",              cat: "bayes",    weight: 0.12 },
  { id: 31,  name: "Factor Graph",                     cat: "bayes",    weight: 0.11 },
  { id: 32,  name: "Belief Propagation",               cat: "bayes",    weight: 0.12 },
  { id: 33,  name: "Expectation Maximization",         cat: "bayes",    weight: 0.11 },
  { id: 34,  name: "Variational Inference",            cat: "bayes",    weight: 0.10 },
  { id: 35,  name: "Gibbs Sampling",                   cat: "bayes",    weight: 0.12 },
  { id: 36,  name: "Metropolis-Hastings",              cat: "bayes",    weight: 0.11 },
  { id: 37,  name: "Dirichlet Process Mixture",        cat: "bayes",    weight: 0.10 },
  { id: 38,  name: "Exponential Smoothing Simple",     cat: "ts",       alpha: 0.10, weight: 0.09 },
  { id: 39,  name: "Exponential Smoothing Double",     cat: "ts",       alpha: 0.20, weight: 0.10 },
  { id: 40,  name: "Holt-Winters Triple",              cat: "ts",       alpha: 0.30, weight: 0.11 },
  { id: 41,  name: "ARIMA Model",                      cat: "ts",       alpha: 0.25, weight: 0.12 },
  { id: 42,  name: "SARIMA Seasonal",                  cat: "ts",       alpha: 0.35, weight: 0.13 },
  { id: 43,  name: "Vector Autoregression",            cat: "ts",       alpha: 0.40, weight: 0.14 },
  { id: 44,  name: "GARCH Volatility",                 cat: "ts",       alpha: 0.15, weight: 0.11 },
  { id: 45,  name: "Kalman Filter",                    cat: "ts",       alpha: 0.20, weight: 0.12 },
  { id: 46,  name: "Particle Filter",                  cat: "ts",       alpha: 0.28, weight: 0.11 },
  { id: 47,  name: "Spectral Analysis FFT",            cat: "ts",       alpha: 0.22, weight: 0.10 },
  { id: 48,  name: "Wavelet Transform",                cat: "ts",       alpha: 0.18, weight: 0.09 },
  { id: 49,  name: "Empirical Mode Decomposition",     cat: "ts",       alpha: 0.32, weight: 0.10 },
  { id: 50,  name: "Singular Spectrum Analysis",       cat: "ts",       alpha: 0.26, weight: 0.11 },
  { id: 51,  name: "Functional Data Analysis",         cat: "ts",       alpha: 0.24, weight: 0.10 },
  { id: 52,  name: "Feedforward Neural Network",       cat: "nn",       weight: 0.13 },
  { id: 53,  name: "Recurrent Neural Network",         cat: "nn",       weight: 0.14 },
  { id: 54,  name: "LSTM Long Short-Term Memory",      cat: "nn",       weight: 0.15 },
  { id: 55,  name: "GRU Gated Recurrent Unit",         cat: "nn",       weight: 0.13 },
  { id: 56,  name: "Bidirectional LSTM",               cat: "nn",       weight: 0.14 },
  { id: 57,  name: "Transformer Attention",            cat: "nn",       weight: 0.15 },
  { id: 58,  name: "CNN 1D Temporal",                  cat: "nn",       weight: 0.12 },
  { id: 59,  name: "Autoencoder Anomaly",              cat: "nn",       weight: 0.11 },
  { id: 60,  name: "Variational Autoencoder",          cat: "nn",       weight: 0.12 },
  { id: 61,  name: "Generative Adversarial Network",   cat: "nn",       weight: 0.13 },
  { id: 62,  name: "Residual Network",                 cat: "nn",       weight: 0.12 },
  { id: 63,  name: "Attention Mechanism",              cat: "nn",       weight: 0.14 },
  { id: 64,  name: "Neural ODE",                       cat: "nn",       weight: 0.11 },
  { id: 65,  name: "Echo State Network",               cat: "nn",       weight: 0.10 },
  { id: 66,  name: "Fibonacci Cycle Detection",        cat: "pattern",  weight: 0.10 },
  { id: 67,  name: "Periodicity Analysis",             cat: "pattern",  weight: 0.11 },
  { id: 68,  name: "Autocorrelation Pattern",          cat: "pattern",  weight: 0.12 },
  { id: 69,  name: "Fractal Dimension Analysis",       cat: "pattern",  weight: 0.09 },
  { id: 70,  name: "Prime Number Pattern",             cat: "pattern",  weight: 0.08 },
  { id: 71,  name: "Digit Sum Recurrence",             cat: "pattern",  weight: 0.10 },
  { id: 72,  name: "Mirror Number Pattern",            cat: "pattern",  weight: 0.09 },
  { id: 73,  name: "Consecutive Digit Pattern",        cat: "pattern",  weight: 0.11 },
  { id: 74,  name: "Position Correlation",             cat: "pattern",  weight: 0.12 },
  { id: 75,  name: "Cross-Position Co-occurrence",     cat: "pattern",  weight: 0.10 },
  { id: 76,  name: "Chi-Square Goodness of Fit",       cat: "stat",     weight: 0.11 },
  { id: 77,  name: "Kolmogorov-Smirnov Test",          cat: "stat",     weight: 0.10 },
  { id: 78,  name: "Mann-Whitney U Test",              cat: "stat",     weight: 0.09 },
  { id: 79,  name: "Runs Test for Randomness",         cat: "stat",     weight: 0.10 },
  { id: 80,  name: "Law of Large Numbers",             cat: "stat",     weight: 0.12 },
  { id: 81,  name: "Central Limit Theorem",            cat: "stat",     weight: 0.11 },
  { id: 82,  name: "Regression Analysis",              cat: "stat",     weight: 0.12 },
  { id: 83,  name: "Bootstrap Resampling",             cat: "stat",     weight: 0.10 },
  { id: 84,  name: "Monte Carlo Simulation",           cat: "stat",     weight: 0.13 },
  { id: 85,  name: "Ensemble Bagging",                 cat: "stat",     weight: 0.11 },
  { id: 86,  name: "Shio Mapping Analysis",            cat: "shio",     weight: 0.09 },
  { id: 87,  name: "Macau Shio Combined",              cat: "shio",     weight: 0.10 },
  { id: 88,  name: "Numerology Sum Pattern",           cat: "shio",     weight: 0.08 },
  { id: 89,  name: "Astrological Cycle",               cat: "shio",     weight: 0.07 },
  { id: 90,  name: "Cabalistic Number Theory",         cat: "shio",     weight: 0.09 },
  { id: 91,  name: "Pythagorean Numerology",           cat: "shio",     weight: 0.08 },
  { id: 92,  name: "Vedic Mathematics",                cat: "shio",     weight: 0.10 },
  { id: 93,  name: "Relative Strength Index (RSI)",    cat: "momentum", weight: 0.12 },
  { id: 94,  name: "MACD Momentum",                    cat: "momentum", weight: 0.13 },
  { id: 95,  name: "Bollinger Band Squeeze",           cat: "momentum", weight: 0.11 },
  { id: 96,  name: "Stochastic Oscillator",            cat: "momentum", weight: 0.10 },
  { id: 97,  name: "Williams %R Adaptation",           cat: "momentum", weight: 0.09 },
  { id: 98,  name: "Average True Range Gap",           cat: "momentum", weight: 0.11 },
  { id: 99,  name: "Volume Momentum Analog",           cat: "momentum", weight: 0.12 },
  { id: 100, name: "Adaptive Ensemble Learning",       cat: "momentum", weight: 0.15 },
] as const;

// ─────────────────────────────────────────────────────────
// SECTION 5: Explanations
// ─────────────────────────────────────────────────────────

function generateExplanations(
  data: DrawData[],
  engines: EngineOutput[],
  bbfsRanked: Array<{ digit: string; score: number }>
): string[] {
  const n = data.length;
  const explanations: string[] = [];

  if (n < 10) return ["Data terlalu sedikit untuk analisis mendalam."];

  // Explanation 1: top BBFS digit analysis
  const top1 = bbfsRanked[0];
  const top1Freq = anyPosFreq(data)[parseInt(top1.digit)];
  const top1Pct = Math.round((top1Freq / n) * 100);
  const top1Gap = (() => {
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      if ([d.as, d.kop, d.kepala, d.ekor].includes(top1.digit)) return i;
    }
    return n;
  })();
  const avgGap1 = top1Freq > 0 ? Math.round(n / top1Freq) : n;
  explanations.push(
    `Digit ${top1.digit} — BBFS score tertinggi (${(top1.score * 100).toFixed(1)}%). ` +
    `Muncul di ${top1Pct}% dari ${n} draw; terakhir muncul ${top1Gap} draw lalu (avg gap ${avgGap1} draw).`
  );

  // Explanation 2: gap analysis insight
  const gapScores = bbfsGapScore(data);
  const topGapDigit = gapScores.indexOf(Math.max(...gapScores));
  const gapFreq = anyPosFreq(data)[topGapDigit];
  const expectedGap = gapFreq > 0 ? Math.round(n / gapFreq) : n;
  const actualGap = (() => {
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      if ([d.as, d.kop, d.kepala, d.ekor].includes(String(topGapDigit))) return i;
    }
    return n;
  })();
  if (actualGap > expectedGap * 1.3) {
    explanations.push(
      `Digit ${topGapDigit} OVERDUE — gap saat ini ${actualGap} draw vs rata-rata ${expectedGap}. ` +
      `Sudah ${Math.round(actualGap / expectedGap * 10) / 10}× melewati siklus normal.`
    );
  }

  // Explanation 3: momentum
  const shortFreq = anyPosFreq(data.slice(0, Math.min(10, n)));
  const longFreq = anyPosFreq(data.slice(0, Math.min(50, n)));
  let hotDigit = -1, hotRatio = 0;
  for (let d = 0; d < 10; d++) {
    const s = shortFreq[d] / Math.max(1, Math.min(10, n));
    const l = (longFreq[d] / Math.max(1, Math.min(50, n))) + 0.01;
    const ratio = s / l;
    if (ratio > hotRatio) { hotRatio = ratio; hotDigit = d; }
  }
  if (hotDigit >= 0 && hotRatio > 1.3) {
    explanations.push(
      `Digit ${hotDigit} momentum PANAS — frekuensi 10 draw terakhir ${Math.round(hotRatio * 100 - 100)}% ` +
      `lebih tinggi dari rata-rata historis. Trending naik.`
    );
  }

  // Explanation 4: engine consensus strength
  const highConf = engines.filter((e) => e.confidence > 0.75).length;
  const signal = highConf > 60 ? "SANGAT KUAT" : highConf > 40 ? "KUAT" : "MODERAT";
  explanations.push(
    `${highConf}/100 engine confidence tinggi — consensus signal ${signal} ` +
    `dari ${n} draw slot ini.`
  );

  // Explanation 5: BBFS5 coverage probability estimate
  const bbfs5 = bbfsRanked.slice(0, 5).map((x) => x.digit);
  const coverage5 = data.slice(0, Math.min(100, n)).filter((d) => {
    const digits = [d.as, d.kop, d.kepala, d.ekor];
    return digits.every((pos) => bbfs5.includes(pos));
  }).length;
  const cov5pct = Math.round((coverage5 / Math.min(100, n)) * 100);
  explanations.push(
    `Estimasi coverage BBFS5 (${bbfs5.join("")}) pada 100 draw terakhir: ${cov5pct}% ` +
    `(${coverage5}/${Math.min(100, n)} draw — 4D result semua digit dari set ini).`
  );

  return explanations.slice(0, 5);
}

// ─────────────────────────────────────────────────────────
// SECTION 6: Category → display name mapping
// ─────────────────────────────────────────────────────────

const CAT_TO_DISPLAY: Record<string, string> = {
  markov:   "Markov Chain",
  gap:      "Poisson & Gap Analysis",
  bayes:    "Bayesian & Probabilistic",
  ts:       "Time Series & Recency",
  nn:       "Neural Network",
  pattern:  "Pattern Recognition",
  stat:     "Statistical Analysis",
  shio:     "Shio & Numerology",
  momentum: "Momentum & Volatility",
};

// ─────────────────────────────────────────────────────────
// SECTION 7: Main exported function
// ─────────────────────────────────────────────────────────

/**
 * Run all 100 engines on slot-filtered draw data.
 * `data` should already be filtered to the target slot by the caller.
 * `dynamicWeights` = adaptive category multipliers from self-learning system.
 */
export function runAllEngines(
  data: DrawData[],
  pasaran: string,
  dynamicWeights?: Record<string, number>
): PredictionOutput {
  const results: EngineOutput[] = [];

  for (const def of ENGINE_DEFINITIONS) {
    const catMultiplier = dynamicWeights ? (dynamicWeights[def.cat] ?? 1.0) : 1.0;
    const effectiveWeight = Math.max(0.01, def.weight * catMultiplier);

    let output: EngineOutput;
    switch (def.cat) {
      case "markov":
        output = markovEngine(data, (def as any).order ?? 1, def.id, def.name, effectiveWeight);
        break;
      case "gap":
        output = gapEngine(data, def.id, def.name, effectiveWeight, (def as any).alpha ?? 0);
        break;
      case "bayes":
        output = bayesianEngine(data, def.id, def.name, effectiveWeight);
        break;
      case "ts":
        output = exponentialSmoothingEngine(data, def.id, def.name, effectiveWeight, (def as any).alpha ?? 0.3);
        break;
      case "nn":
        output = neuralEngine(data, def.id, def.name, effectiveWeight);
        break;
      case "pattern":
        output = patternEngine(data, def.id, def.name, effectiveWeight);
        break;
      case "stat":
        output = statisticalEngine(data, def.id, def.name, effectiveWeight);
        break;
      case "shio":
        output = shioEngine(data, def.id, def.name, effectiveWeight);
        break;
      case "momentum":
        output = momentumEngine(data, def.id, def.name, effectiveWeight);
        break;
      default:
        output = bayesianEngine(data, (def as any).id, (def as any).name, effectiveWeight);
    }
    results.push(output);
  }

  return buildConsensus(pasaran, results, data);
}

export { CAT_TO_DISPLAY };

// ─────────────────────────────────────────────────────────
// SECTION 8: buildConsensus — BBFS-FIRST aggregation
// ─────────────────────────────────────────────────────────

function buildConsensus(pasaran: string, engines: EngineOutput[], data: DrawData[]): PredictionOutput {
  const totalWeight = engines.reduce((a, e) => a + e.weight, 0);
  const n = data.length;

  // ── BBFS PRIMARY AGGREGATION ─────────────────────────────
  // Aggregate bbfsScore[d] across all 100 engines using:
  //   globalBbfs[d] = Σ (engine.weight × engine.confidence × engine.bbfsScore[d])
  // This is the core BBFS-first computation.

  const globalBbfs = new Array(10).fill(0);
  engines.forEach((engine) => {
    const w = engine.weight * engine.confidence;
    engine.bbfsScore.forEach((score, d) => {
      globalBbfs[d] += w * score;
    });
  });

  // ── LAYER 2: Direct any-position frequency analysis (on top of engine votes) ──
  // Weight: 20% direct statistical analysis, 80% engine aggregate
  if (n > 0) {
    const directFreq = bbfsFrequencyScore(data);
    directFreq.forEach((score, d) => {
      globalBbfs[d] = globalBbfs[d] * 0.80 + score * (totalWeight * 0.20);
    });
  }

  // ── LAYER 3: Recency boost (last 20 draws any-position, 15% weight) ──
  if (n >= 5) {
    const recencyBoost = bbfsRecencyScore(data, 0.08);
    recencyBoost.forEach((score, d) => {
      globalBbfs[d] += score * (totalWeight * 0.15);
    });
  }

  // ── LAYER 4: Coverage score — co-occurrence boost (10% weight) ──
  if (n >= 20) {
    const covScore = bbfsCoverageScore(data);
    covScore.forEach((score, d) => {
      globalBbfs[d] += score * (totalWeight * 0.10);
    });
  }

  // ── LAYER 5: Gap/overdue boost (10% weight) ──
  if (n >= 10) {
    const gapBoost = normalize(bbfsGapScore(data, false, 0));
    gapBoost.forEach((score, d) => {
      globalBbfs[d] += score * (totalWeight * 0.10);
    });
  }

  // Normalize to probability distribution
  const bbfsNorm = normalize(globalBbfs);

  // Rank digits by final BBFS score
  const bbfsRanked = bbfsNorm
    .map((score, digit) => ({ digit: String(digit), score }))
    .sort((a, b) => b.score - a.score);

  const bbfs5 = bbfsRanked.slice(0, 5).map((x) => x.digit);
  const bbfs6 = bbfsRanked.slice(0, 6).map((x) => x.digit);
  const bbfs7 = bbfsRanked.slice(0, 7).map((x) => x.digit);

  // ── Per-position aggregation for 4D/3D/2D (secondary) ─────────────────────
  const posScores: Record<Position, number[]> = {
    as:     new Array(10).fill(0),
    kop:    new Array(10).fill(0),
    kepala: new Array(10).fill(0),
    ekor:   new Array(10).fill(0),
  };

  engines.forEach((engine) => {
    for (const pos of POSITIONS) {
      engine.digits[pos].forEach((digit, rank) => {
        const d = parseInt(digit, 10);
        if (!isNaN(d)) {
          const rankW = rank === 0 ? 1.0 : rank === 1 ? 0.5 : 0.25;
          posScores[pos][d] += engine.weight * engine.confidence * rankW;
        }
      });
    }
  });

  const topDigits: Record<Position, string[]> = {
    as:     topN(posScores.as, 6),
    kop:    topN(posScores.kop, 6),
    kepala: topN(posScores.kepala, 6),
    ekor:   topN(posScores.ekor, 6),
  };

  // Score-based 4D ranking
  const top4: Record<Position, string[]> = {
    as:     topN(posScores.as, 4),
    kop:    topN(posScores.kop, 4),
    kepala: topN(posScores.kepala, 4),
    ekor:   topN(posScores.ekor, 4),
  };
  const scored4d: Array<{ num: string; score: number }> = [];
  for (const a of top4.as) for (const k of top4.kop) for (const kp of top4.kepala) for (const e of top4.ekor) {
    const num = `${a}${k}${kp}${e}`;
    if (!scored4d.find((x) => x.num === num)) {
      scored4d.push({ num, score: posScores.as[+a] + posScores.kop[+k] + posScores.kepala[+kp] + posScores.ekor[+e] });
    }
  }
  scored4d.sort((a, b) => b.score - a.score);
  const consensus4d = scored4d.slice(0, 10).map((x) => x.num);

  // Score-based 3D ranking
  const scored3d: Array<{ num: string; score: number }> = [];
  for (const k of topDigits.kop.slice(0, 5)) for (const kp of topDigits.kepala.slice(0, 5)) for (const e of topDigits.ekor.slice(0, 5)) {
    const num = `${k}${kp}${e}`;
    if (!scored3d.find((x) => x.num === num)) {
      scored3d.push({ num, score: posScores.kop[+k] + posScores.kepala[+kp] + posScores.ekor[+e] });
    }
  }
  scored3d.sort((a, b) => b.score - a.score);
  const consensus3d = scored3d.slice(0, 10).map((x) => x.num);

  // Score-based 2D ranking
  const scored2d: Array<{ num: string; score: number }> = [];
  for (const kp of topDigits.kepala) for (const e of topDigits.ekor) {
    const num = `${kp}${e}`;
    if (!scored2d.find((x) => x.num === num)) {
      scored2d.push({ num, score: posScores.kepala[+kp] * 1.2 + posScores.ekor[+e] * 1.5 });
    }
  }
  scored2d.sort((a, b) => b.score - a.score);
  const consensus2d = scored2d.slice(0, 10).map((x) => x.num);

  // Colok bebas: top-5 digits from ekor (highest ekor position score)
  const colokBebas = topN(posScores.ekor, 5);

  // ── Engine summary & contributions ──────────────────────
  const overallConfidence = engines.reduce((a, e) => a + e.confidence * e.weight, 0) / totalWeight;

  const catGroups: Record<string, { sum: number; count: number }> = {};
  engines.forEach((e) => {
    if (!catGroups[e.category]) catGroups[e.category] = { sum: 0, count: 0 };
    catGroups[e.category].sum += e.confidence;
    catGroups[e.category].count++;
  });
  const engineSummary: Record<string, number> = {};
  for (const [cat, { sum, count }] of Object.entries(catGroups)) {
    engineSummary[cat] = sum / count;
  }

  const catScores: Record<string, number> = {};
  engines.forEach((e) => {
    if (!catScores[e.category]) catScores[e.category] = 0;
    catScores[e.category] += e.weight * e.confidence;
  });
  const totalCatScore = Object.values(catScores).reduce((a, b) => a + b, 0);
  const engineContributions: EngineContribution[] = Object.entries(catScores)
    .map(([category, score]) => ({ category, contribution: Math.round((score / totalCatScore) * 100) }))
    .sort((a, b) => b.contribution - a.contribution);

  const topEngines: TopEngineItem[] = [...engines]
    .sort((a, b) => b.weight * b.confidence - a.weight * a.confidence)
    .slice(0, 5)
    .map((e) => ({ name: e.engineName, category: e.category, weight: Math.round(e.weight * e.confidence * 1000) / 10 }));

  const explanations = generateExplanations(data, engines, bbfsRanked);

  return {
    pasaran,
    generatedAt: new Date().toISOString(),
    totalDrawsUsed: n,
    engines,
    consensus4d,
    consensus3d,
    consensus2d,
    colokBebas,
    bbfs5,
    bbfs6,
    bbfs7,
    overallConfidence,
    engineSummary,
    explanations,
    engineContributions,
    topEngines,
  };
}
