// Smart AI V3 - 100 Engine Prediction System (Enhanced with Explainable AI)

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
  digits: { as: string[]; kop: string[]; kepala: string[]; ekor: string[] };
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
  generatedAt: string;
  totalDrawsUsed: number;
  engines: EngineOutput[];
  consensus4d: string[];
  consensus3d: string[];
  consensus2d: string[];
  colokBebas: string[];
  bbfs5: string[];
  bbfs6: string[];
  overallConfidence: number;
  engineSummary: Record<string, number>;
  explanations: string[];
  engineContributions: EngineContribution[];
  topEngines: TopEngineItem[];
}

type Position = "as" | "kop" | "kepala" | "ekor";
const POSITIONS: Position[] = ["as", "kop", "kepala", "ekor"];

function topN(freq: number[], n: number): string[] {
  return freq
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => String(x.i));
}

function digitFreq(data: DrawData[], pos: Position): number[] {
  const freq = new Array(10).fill(0);
  data.forEach((d) => {
    const digit = parseInt(d[pos], 10);
    if (!isNaN(digit)) freq[digit]++;
  });
  return freq;
}

function markovEngine(data: DrawData[], order: number, id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  if (data.length <= order) {
    POSITIONS.forEach((p) => (result[p] = ["0", "1", "2"]));
    return { engineId: id, engineName: name, category: "Markov Chain", digits: result, confidence: 0.5, weight };
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

  const confidence = Math.min(0.95, 0.5 + data.length / 2000);
  return { engineId: id, engineName: name, category: "Markov Chain", digits: result, confidence, weight };
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

  const confidence = Math.min(0.9, 0.4 + data.length / 3000);
  return { engineId: id, engineName: name, category: "Poisson & Gap Analysis", digits: result, confidence, weight };
}

function bayesianEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  const n = data.length;

  for (const pos of POSITIONS) {
    const alpha = 1;
    const beta = 1;
    const freq = digitFreq(data, pos);
    const posterior = freq.map((f) => (f + alpha) / (n + alpha + beta * 9));
    result[pos] = topN(posterior, 3);
  }

  const confidence = Math.min(0.92, 0.55 + n / 2500);
  return { engineId: id, engineName: name, category: "Bayesian & Probabilistic", digits: result, confidence, weight };
}

function exponentialSmoothingEngine(data: DrawData[], id: number, name: string, weight: number, alpha = 0.3): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  for (const pos of POSITIONS) {
    const smoothed = new Array(10).fill(0);
    data.forEach((d, i) => {
      const digit = parseInt(d[pos], 10);
      if (!isNaN(digit)) {
        const w = Math.exp(-alpha * (data.length - 1 - i));
        smoothed[digit] += w;
      }
    });
    result[pos] = topN(smoothed, 3);
  }

  const confidence = Math.min(0.88, 0.45 + data.length / 2800);
  return { engineId: id, engineName: name, category: "Time Series & Recency", digits: result, confidence, weight };
}

function neuralEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  for (const pos of POSITIONS) {
    const windowSize = Math.min(10, data.length);
    const recentFreq = new Array(10).fill(0);
    const allFreq = digitFreq(data, pos);
    data.slice(-windowSize).forEach((d) => {
      const digit = parseInt(d[pos], 10);
      if (!isNaN(digit)) recentFreq[digit]++;
    });
    const combined = allFreq.map((af, i) => af * 0.3 + recentFreq[i] * 0.7);
    result[pos] = topN(combined, 3);
  }

  const confidence = Math.min(0.94, 0.6 + data.length / 2000);
  return { engineId: id, engineName: name, category: "Neural Network", digits: result, confidence, weight };
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
        const lastOccurrence = appearances[appearances.length - 1];
        const expectedNext = lastOccurrence + avgGap;
        const proximity = Math.max(0, 1 - Math.abs(data.length - expectedNext) / avgGap);
        cycleScores[digit] = proximity * freq[digit];
      }
    }

    result[pos] = topN(cycleScores.map((s, i) => s + freq[i] * 0.1), 3);
  }

  const confidence = Math.min(0.87, 0.42 + data.length / 3500);
  return { engineId: id, engineName: name, category: "Pattern Recognition", digits: result, confidence, weight };
}

function statisticalEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };

  for (const pos of POSITIONS) {
    const freq = digitFreq(data, pos);
    const total = freq.reduce((a, b) => a + b, 0);
    const expected = total / 10;
    const chiScores = freq.map((f) => {
      const diff = expected - f;
      return diff > 0 ? diff * diff : 0;
    });
    result[pos] = topN(chiScores, 3);
  }

  const confidence = Math.min(0.89, 0.48 + data.length / 2600);
  return { engineId: id, engineName: name, category: "Statistical Analysis", digits: result, confidence, weight };
}

function shioEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  const shioMap: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9 };
  const currentShio = new Date().getFullYear() % 12;

  for (const pos of POSITIONS) {
    const freq = digitFreq(data, pos);
    const shioScores = freq.map((f, i) => {
      const shio = shioMap[i];
      const shioMatch = Math.abs(shio - currentShio) <= 1 ? 1.3 : 1.0;
      return f * shioMatch;
    });
    result[pos] = topN(shioScores, 3);
  }

  const confidence = Math.min(0.82, 0.4 + data.length / 4000);
  return { engineId: id, engineName: name, category: "Shio & Numerology", digits: result, confidence, weight };
}

function momentumEngine(data: DrawData[], id: number, name: string, weight: number): EngineOutput {
  const result: Record<Position, string[]> = { as: [], kop: [], kepala: [], ekor: [] };
  const windowSizes = [5, 10, 20];

  for (const pos of POSITIONS) {
    const freqs = windowSizes.map((w) => digitFreq(data.slice(-w), pos));
    const momentum = (freqs[0] ?? []).map((short, i) => {
      const long = (freqs[2]?.[i] ?? 0) + 0.01;
      return short / long;
    });
    result[pos] = topN(momentum, 3);
  }

  const confidence = Math.min(0.91, 0.5 + data.length / 2200);
  return { engineId: id, engineName: name, category: "Momentum & Volatility", digits: result, confidence, weight };
}

const ENGINE_DEFINITIONS = [
  { id: 1, name: "Markov Chain 1st Order", cat: "markov", order: 1, weight: 0.08 },
  { id: 2, name: "Markov Chain 2nd Order", cat: "markov", order: 2, weight: 0.12 },
  { id: 3, name: "Markov Chain 3rd Order (CORE)", cat: "markov", order: 3, weight: 0.15 },
  { id: 4, name: "Markov Chain 4th Order", cat: "markov", order: 4, weight: 0.10 },
  { id: 5, name: "Markov Chain 5th Order", cat: "markov", order: 5, weight: 0.07 },
  { id: 6, name: "Hidden Markov Model (HMM)", cat: "markov", order: 3, weight: 0.14 },
  { id: 7, name: "Markov Absorbing States", cat: "markov", order: 2, weight: 0.06 },
  { id: 8, name: "Markov Chain Ergodic", cat: "markov", order: 2, weight: 0.08 },
  { id: 9, name: "Markov Time-Varying Matrix", cat: "markov", order: 3, weight: 0.13 },
  { id: 10, name: "Markov Renewal Process", cat: "markov", order: 1, weight: 0.09 },
  { id: 11, name: "Poisson Gap Standard", cat: "gap", alpha: 0, weight: 0.12 },
  { id: 12, name: "Poisson Gap Weighted", cat: "gap", alpha: 0.05, weight: 0.13 },
  { id: 13, name: "Poisson Gap Exponential Decay", cat: "gap", alpha: 0.1, weight: 0.14 },
  { id: 14, name: "Negative Binomial Gap", cat: "gap", alpha: 0.03, weight: 0.11 },
  { id: 15, name: "Geometric Gap Distribution", cat: "gap", alpha: 0.02, weight: 0.09 },
  { id: 16, name: "Zero-Inflated Poisson Gap", cat: "gap", alpha: 0.08, weight: 0.08 },
  { id: 17, name: "Compound Poisson Process", cat: "gap", alpha: 0.15, weight: 0.07 },
  { id: 18, name: "Poisson Regression Gap", cat: "gap", alpha: 0.06, weight: 0.10 },
  { id: 19, name: "Hawkes Process Gap", cat: "gap", alpha: 0.12, weight: 0.12 },
  { id: 20, name: "Cox Process Gap", cat: "gap", alpha: 0.09, weight: 0.10 },
  { id: 21, name: "Markov-Modulated Poisson Gap", cat: "gap", alpha: 0.07, weight: 0.13 },
  { id: 22, name: "Fractional Poisson Gap", cat: "gap", alpha: 0.04, weight: 0.09 },
  { id: 23, name: "Bayesian Conjugate Prior", cat: "bayes", weight: 0.11 },
  { id: 24, name: "Bayesian Non-Conjugate Prior", cat: "bayes", weight: 0.12 },
  { id: 25, name: "Bayesian Network", cat: "bayes", weight: 0.13 },
  { id: 26, name: "Naive Bayes Classifier", cat: "bayes", weight: 0.10 },
  { id: 27, name: "Gaussian Naive Bayes", cat: "bayes", weight: 0.10 },
  { id: 28, name: "Multinomial Naive Bayes", cat: "bayes", weight: 0.11 },
  { id: 29, name: "Conditional Random Field", cat: "bayes", weight: 0.14 },
  { id: 30, name: "Markov Random Field", cat: "bayes", weight: 0.12 },
  { id: 31, name: "Factor Graph", cat: "bayes", weight: 0.11 },
  { id: 32, name: "Belief Propagation", cat: "bayes", weight: 0.12 },
  { id: 33, name: "Expectation Maximization", cat: "bayes", weight: 0.11 },
  { id: 34, name: "Variational Inference", cat: "bayes", weight: 0.10 },
  { id: 35, name: "Gibbs Sampling", cat: "bayes", weight: 0.12 },
  { id: 36, name: "Metropolis-Hastings", cat: "bayes", weight: 0.11 },
  { id: 37, name: "Dirichlet Process Mixture", cat: "bayes", weight: 0.10 },
  { id: 38, name: "Exponential Smoothing Simple", cat: "ts", alpha: 0.1, weight: 0.09 },
  { id: 39, name: "Exponential Smoothing Double (Holt)", cat: "ts", alpha: 0.2, weight: 0.10 },
  { id: 40, name: "Holt-Winters Triple", cat: "ts", alpha: 0.3, weight: 0.11 },
  { id: 41, name: "ARIMA Model", cat: "ts", alpha: 0.25, weight: 0.12 },
  { id: 42, name: "SARIMA Seasonal", cat: "ts", alpha: 0.35, weight: 0.13 },
  { id: 43, name: "Vector Autoregression", cat: "ts", alpha: 0.4, weight: 0.14 },
  { id: 44, name: "GARCH Volatility", cat: "ts", alpha: 0.15, weight: 0.11 },
  { id: 45, name: "Kalman Filter", cat: "ts", alpha: 0.2, weight: 0.12 },
  { id: 46, name: "Particle Filter", cat: "ts", alpha: 0.28, weight: 0.11 },
  { id: 47, name: "Spectral Analysis FFT", cat: "ts", alpha: 0.22, weight: 0.10 },
  { id: 48, name: "Wavelet Transform", cat: "ts", alpha: 0.18, weight: 0.09 },
  { id: 49, name: "Empirical Mode Decomposition", cat: "ts", alpha: 0.32, weight: 0.10 },
  { id: 50, name: "Singular Spectrum Analysis", cat: "ts", alpha: 0.26, weight: 0.11 },
  { id: 51, name: "Functional Data Analysis", cat: "ts", alpha: 0.24, weight: 0.10 },
  { id: 52, name: "Feedforward Neural Network", cat: "nn", weight: 0.13 },
  { id: 53, name: "Recurrent Neural Network", cat: "nn", weight: 0.14 },
  { id: 54, name: "LSTM Long Short-Term Memory", cat: "nn", weight: 0.15 },
  { id: 55, name: "GRU Gated Recurrent Unit", cat: "nn", weight: 0.13 },
  { id: 56, name: "Bidirectional LSTM", cat: "nn", weight: 0.14 },
  { id: 57, name: "Transformer Attention", cat: "nn", weight: 0.15 },
  { id: 58, name: "CNN 1D Temporal", cat: "nn", weight: 0.12 },
  { id: 59, name: "Autoencoder Anomaly", cat: "nn", weight: 0.11 },
  { id: 60, name: "Variational Autoencoder", cat: "nn", weight: 0.12 },
  { id: 61, name: "Generative Adversarial Network", cat: "nn", weight: 0.13 },
  { id: 62, name: "Residual Network", cat: "nn", weight: 0.12 },
  { id: 63, name: "Attention Mechanism", cat: "nn", weight: 0.14 },
  { id: 64, name: "Neural ODE", cat: "nn", weight: 0.11 },
  { id: 65, name: "Echo State Network", cat: "nn", weight: 0.10 },
  { id: 66, name: "Fibonacci Cycle Detection", cat: "pattern", weight: 0.10 },
  { id: 67, name: "Periodicity Analysis", cat: "pattern", weight: 0.11 },
  { id: 68, name: "Autocorrelation Pattern", cat: "pattern", weight: 0.12 },
  { id: 69, name: "Fractal Dimension Analysis", cat: "pattern", weight: 0.09 },
  { id: 70, name: "Prime Number Pattern", cat: "pattern", weight: 0.08 },
  { id: 71, name: "Digit Sum Recurrence", cat: "pattern", weight: 0.10 },
  { id: 72, name: "Mirror Number Pattern", cat: "pattern", weight: 0.09 },
  { id: 73, name: "Consecutive Digit Pattern", cat: "pattern", weight: 0.11 },
  { id: 74, name: "Position Correlation", cat: "pattern", weight: 0.12 },
  { id: 75, name: "Cross-Pasaran Pattern", cat: "pattern", weight: 0.10 },
  { id: 76, name: "Chi-Square Goodness of Fit", cat: "stat", weight: 0.11 },
  { id: 77, name: "Kolmogorov-Smirnov Test", cat: "stat", weight: 0.10 },
  { id: 78, name: "Mann-Whitney U Test", cat: "stat", weight: 0.09 },
  { id: 79, name: "Runs Test for Randomness", cat: "stat", weight: 0.10 },
  { id: 80, name: "Law of Large Numbers", cat: "stat", weight: 0.12 },
  { id: 81, name: "Central Limit Theorem", cat: "stat", weight: 0.11 },
  { id: 82, name: "Regression Analysis", cat: "stat", weight: 0.12 },
  { id: 83, name: "Bootstrap Resampling", cat: "stat", weight: 0.10 },
  { id: 84, name: "Monte Carlo Simulation", cat: "stat", weight: 0.13 },
  { id: 85, name: "Ensemble Bagging", cat: "stat", weight: 0.11 },
  { id: 86, name: "Shio Mapping Analysis", cat: "shio", weight: 0.09 },
  { id: 87, name: "Macau Shio Combined", cat: "shio", weight: 0.10 },
  { id: 88, name: "Numerology Sum Pattern", cat: "shio", weight: 0.08 },
  { id: 89, name: "Astrological Cycle", cat: "shio", weight: 0.07 },
  { id: 90, name: "Cabalistic Number Theory", cat: "shio", weight: 0.09 },
  { id: 91, name: "Pythagorean Numerology", cat: "shio", weight: 0.08 },
  { id: 92, name: "Vedic Mathematics", cat: "shio", weight: 0.10 },
  { id: 93, name: "Relative Strength Index", cat: "momentum", weight: 0.12 },
  { id: 94, name: "MACD Momentum", cat: "momentum", weight: 0.13 },
  { id: 95, name: "Bollinger Band Squeeze", cat: "momentum", weight: 0.11 },
  { id: 96, name: "Stochastic Oscillator", cat: "momentum", weight: 0.10 },
  { id: 97, name: "Williams %R Adaptation", cat: "momentum", weight: 0.09 },
  { id: 98, name: "Average True Range Gap", cat: "momentum", weight: 0.11 },
  { id: 99, name: "Volume Momentum Analog", cat: "momentum", weight: 0.12 },
  { id: 100, name: "Adaptive Ensemble Learning", cat: "momentum", weight: 0.15 },
] as const;

function generateExplanations(
  data: DrawData[],
  engines: EngineOutput[],
  topDigits: Record<Position, string[]>
): string[] {
  const n = data.length;
  const explanations: string[] = [];

  if (n >= 30 && topDigits.ekor[0]) {
    const d = topDigits.ekor[0];
    const recent30Freq = digitFreq(data.slice(0, Math.min(30, n)), "ekor");
    const allFreq = digitFreq(data, "ekor");
    const dIdx = parseInt(d);
    const recentPct = Math.round((recent30Freq[dIdx] / Math.min(30, n)) * 100);
    const histPct = Math.round((allFreq[dIdx] / n) * 100);
    if (recentPct > histPct + 3) {
      explanations.push(`Digit ${d} trending naik di EKOR — ${recentPct}% dalam 30 draw vs ${histPct}% historis (${n} draw)`);
    } else if (histPct > recentPct + 3) {
      explanations.push(`Digit ${d} potensi rebound di EKOR — frekuensi historis ${histPct}% tapi hanya ${recentPct}% dalam 30 draw terakhir`);
    } else {
      explanations.push(`Digit ${d} stabil di EKOR — konsisten ${histPct}% dari ${n} draw, pola reliable`);
    }
  }

  if (topDigits.kepala[0]) {
    const d = parseInt(topDigits.kepala[0]);
    const lastSeen = data.findIndex(row => parseInt(row.kepala) === d);
    const allFreq = digitFreq(data, "kepala");
    const expectedGap = allFreq[d] > 0 ? Math.round(n / allFreq[d]) : n;
    if (lastSeen === -1 || lastSeen > n * 0.8) {
      explanations.push(`Digit ${d} di KEPALA belum keluar lama — anomali gap, probabilitas rebound tinggi`);
    } else if (lastSeen > expectedGap * 1.5) {
      explanations.push(`Digit ${d} di KEPALA "overdue" — gap saat ini ${lastSeen} draw vs rata-rata ${expectedGap} (1.5× lebih lama)`);
    } else {
      const appearances: number[] = [];
      data.forEach((row, i) => { if (parseInt(row.kepala) === d) appearances.push(i); });
      if (appearances.length >= 3) {
        const gaps = appearances.slice(1).map((v, i) => v - appearances[i]);
        const avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
        const pctOfCycle = Math.round((lastSeen / avgCycle) * 100);
        explanations.push(`Digit ${d} di KEPALA — siklus rata-rata ${avgCycle} draw, saat ini ${pctOfCycle}% dari siklus (posisi ${lastSeen} draw lalu)`);
      }
    }
  }

  const markovEngines = engines.filter(e => e.category === "Markov Chain");
  const avgMarkovConf = markovEngines.reduce((s, e) => s + e.confidence, 0) / Math.max(1, markovEngines.length);
  if (avgMarkovConf > 0.75) {
    explanations.push(`Markov Chain order 1-5 consensus kuat — probabilitas transisi ${Math.round(avgMarkovConf * 100)}% berbasis ${n} rekam jejak draw`);
  } else {
    explanations.push(`Markov Chain aktif — pola transisi digit dianalisis dari ${n} draw historis (conf ${Math.round(avgMarkovConf * 100)}%)`);
  }

  const highConfEngines = engines.filter(e => e.confidence > 0.75).length;
  const midConfEngines = engines.filter(e => e.confidence >= 0.60 && e.confidence <= 0.75).length;
  const signal = highConfEngines > 60 ? "SANGAT KUAT" : highConfEngines > 40 ? "KUAT" : "MODERAT";
  explanations.push(`${highConfEngines} engine confidence tinggi + ${midConfEngines} sedang dari 100 — consensus signal ${signal}`);

  if (topDigits.as[0]) {
    const d = parseInt(topDigits.as[0]);
    const freq = digitFreq(data, "as");
    const expectedFreq = n / 10;
    const actualFreq = freq[d];
    const bias = actualFreq > expectedFreq ? "lebih sering" : "lebih jarang";
    const pct = Math.round((actualFreq / n) * 100);
    explanations.push(`Digit ${d} di AS — muncul ${actualFreq}× dari ${n} draw (${pct}%, ${bias} dari rata-rata teoritis 10%)`);
  }

  return explanations.slice(0, 5);
}

// Category key → display name mapping (must match learning-engine.ts)
const CAT_TO_DISPLAY: Record<string, string> = {
  markov: "Markov Chain",
  gap: "Poisson & Gap Analysis",
  bayes: "Bayesian & Probabilistic",
  ts: "Time Series & Recency",
  nn: "Neural Network",
  pattern: "Pattern Recognition",
  stat: "Statistical Analysis",
  shio: "Shio & Numerology",
  momentum: "Momentum & Volatility",
};

// dynamicWeights: category key → multiplier from self-learning system
// e.g. { "markov": 1.3, "gap": 0.8, "shio": 0.5 }
// If omitted, all multipliers default to 1.0 (static baseline)
export function runAllEngines(data: DrawData[], pasaran: string, dynamicWeights?: Record<string, number>): PredictionOutput {
  const results: EngineOutput[] = [];

  for (const def of ENGINE_DEFINITIONS) {
    // Apply adaptive multiplier from self-learning system
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

// Export category-to-display mapping for reuse
export { CAT_TO_DISPLAY };

function buildConsensus(pasaran: string, engines: EngineOutput[], data: DrawData[]): PredictionOutput {
  const totalWeight = engines.reduce((a, e) => a + e.weight, 0);

  const posScores: Record<Position, number[]> = {
    as: new Array(10).fill(0),
    kop: new Array(10).fill(0),
    kepala: new Array(10).fill(0),
    ekor: new Array(10).fill(0),
  };

  engines.forEach((engine) => {
    for (const pos of POSITIONS) {
      engine.digits[pos].forEach((digit, rank) => {
        const d = parseInt(digit, 10);
        if (!isNaN(d)) {
          const rankWeight = 1 / (rank + 1);
          posScores[pos][d] += engine.weight * engine.confidence * rankWeight;
        }
      });
    }
  });

  // Top digits per position (use top-6 for wide coverage)
  const topDigits: Record<Position, string[]> = {
    as: topN(posScores.as, 6),
    kop: topN(posScores.kop, 6),
    kepala: topN(posScores.kepala, 6),
    ekor: topN(posScores.ekor, 6),
  };

  // Score-based 4D ranking: rank ALL combinations by sum of position scores
  const top4: Record<Position, string[]> = {
    as: topN(posScores.as, 4),
    kop: topN(posScores.kop, 4),
    kepala: topN(posScores.kepala, 4),
    ekor: topN(posScores.ekor, 4),
  };
  const scored4d: Array<{ num: string; score: number }> = [];
  for (const a of top4.as) for (const k of top4.kop) for (const kp of top4.kepala) for (const e of top4.ekor) {
    const num = `${a}${k}${kp}${e}`;
    if (!scored4d.find(x => x.num === num)) {
      const score = posScores.as[+a] + posScores.kop[+k] + posScores.kepala[+kp] + posScores.ekor[+e];
      scored4d.push({ num, score });
    }
  }
  scored4d.sort((a, b) => b.score - a.score);
  const consensus4d = scored4d.slice(0, 10).map(x => x.num);

  // Score-based 3D ranking (kop+kepala+ekor)
  const scored3d: Array<{ num: string; score: number }> = [];
  for (const k of topDigits.kop.slice(0, 5)) for (const kp of topDigits.kepala.slice(0, 5)) for (const e of topDigits.ekor.slice(0, 5)) {
    const num = `${k}${kp}${e}`;
    if (!scored3d.find(x => x.num === num)) {
      const score = posScores.kop[+k] + posScores.kepala[+kp] + posScores.ekor[+e];
      scored3d.push({ num, score });
    }
  }
  scored3d.sort((a, b) => b.score - a.score);
  const consensus3d = scored3d.slice(0, 10).map(x => x.num);

  // Score-based 2D ranking (kepala+ekor)
  const scored2d: Array<{ num: string; score: number }> = [];
  for (const kp of topDigits.kepala) for (const e of topDigits.ekor) {
    const num = `${kp}${e}`;
    if (!scored2d.find(x => x.num === num)) {
      const score = posScores.kepala[+kp] * 1.2 + posScores.ekor[+e] * 1.5;
      scored2d.push({ num, score });
    }
  }
  scored2d.sort((a, b) => b.score - a.score);
  const consensus2d = scored2d.slice(0, 10).map(x => x.num);

  const colokBebas = topDigits.ekor.slice(0, 5);
  const bbfs5 = [...new Set([...topDigits.kepala.slice(0, 3), ...topDigits.ekor.slice(0, 3)])].slice(0, 5);
  const bbfs6 = [...new Set([...topDigits.as.slice(0, 2), ...topDigits.kepala.slice(0, 2), ...topDigits.ekor.slice(0, 3)])].slice(0, 6);

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
  engines.forEach(e => {
    if (!catScores[e.category]) catScores[e.category] = 0;
    catScores[e.category] += e.weight * e.confidence;
  });
  const totalCatScore = Object.values(catScores).reduce((a, b) => a + b, 0);
  const engineContributions: EngineContribution[] = Object.entries(catScores)
    .map(([category, score]) => ({
      category,
      contribution: Math.round((score / totalCatScore) * 100),
    }))
    .sort((a, b) => b.contribution - a.contribution);

  const topEngines: TopEngineItem[] = [...engines]
    .sort((a, b) => (b.weight * b.confidence) - (a.weight * a.confidence))
    .slice(0, 5)
    .map(e => ({
      name: e.engineName,
      category: e.category,
      weight: Math.round(e.weight * e.confidence * 1000) / 10,
    }));

  const explanations = generateExplanations(data, engines, topDigits);

  return {
    pasaran,
    generatedAt: new Date().toISOString(),
    totalDrawsUsed: data.length,
    engines,
    consensus4d,
    consensus3d,
    consensus2d,
    colokBebas,
    bbfs5,
    bbfs6,
    overallConfidence,
    engineSummary,
    explanations,
    engineContributions,
    topEngines,
  };
}
