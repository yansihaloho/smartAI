import type { DrawData, EngineOutput } from "./prediction-engine";
import { runAllEngines } from "./prediction-engine";

type Position = "as" | "kop" | "kepala" | "ekor";
const POSITIONS: Position[] = ["as", "kop", "kepala", "ekor"];

export interface ColokJituItem { digit: string; posisi: string; }
export interface RekomendItem { rank: number; number: string; score: number; label: string; color: string; }
export interface ScoreItem { number: string; score: number; }

export interface DigitGapItem {
  digit: string;
  gap: number;
  avgGap: number;
  freq: number;
  trend: string;
  score: number;
}

export interface PositionAnalysis {
  topDigits: string[];
  gaps: DigitGapItem[];
}

export interface DeepAnalysisResult {
  pasaran: string;
  timeSlot: string;
  lastResult: string;
  generatedAt: string;
  overallConfidence: number;
  totalDrawsUsed: number;
  bbfs3d: string[];
  bbfs5: string[];
  bbfs6: string[];
  prediksi4d: string[];
  prediksi3d: string[];
  pred2dEkor: string[];
  pred2dDepan: string[];
  pred2dTengah: string[];
  colokBebas: string[];
  colokBebas3d: string[];
  colokJitu: ColokJituItem[];
  dasar: string;
  tengahTepi: string;
  silangHomo: string;
  kembangKempis: string;
  shio: string[];
  bbni3d: string;
  topikon: string[];
  top5: RekomendItem[];
  scoreDistribution: ScoreItem[];
  ranking2d: RekomendItem[];
  reasons: string[];
  digitAnalysis: Record<string, PositionAnalysis>;
}

const SHIO_DIGIT_MAP: Record<number, string> = {
  0: "Tikus", 1: "Kerbau", 2: "Macan", 3: "Kelinci",
  4: "Naga", 5: "Ular", 6: "Kuda", 7: "Kambing",
  8: "Monyet", 9: "Ayam",
};

function scoreLabel(score: number, max: number): { label: string; color: string } {
  const pct = score / (max || 1);
  if (pct > 0.8) return { label: "SANGAT TINGGI", color: "green" };
  if (pct > 0.6) return { label: "TINGGI", color: "green" };
  if (pct > 0.4) return { label: "BAIK", color: "yellow" };
  if (pct > 0.2) return { label: "SEDANG", color: "orange" };
  return { label: "RENDAH", color: "red" };
}

function weightedDigitScores(data: DrawData[]): Record<Position, Record<string, number>> {
  const scores: Record<Position, Record<string, number>> = {
    as: {}, kop: {}, kepala: {}, ekor: {},
  };
  for (const pos of POSITIONS) {
    for (let d = 0; d <= 9; d++) scores[pos][String(d)] = 0;
  }
  data.forEach((draw, i) => {
    const weight = Math.exp(-0.015 * i);
    for (const pos of POSITIONS) {
      const d = draw[pos];
      if (d !== undefined && scores[pos][d] !== undefined) {
        scores[pos][d] += weight;
      }
    }
  });
  return scores;
}

function buildGapAnalysis(data: DrawData[], pos: Position): DigitGapItem[] {
  const n = data.length;
  const items: DigitGapItem[] = [];

  for (let d = 0; d <= 9; d++) {
    const digit = String(d);
    const appearances: number[] = [];
    data.forEach((row, i) => { if (row[pos] === digit) appearances.push(i); });

    const freq = appearances.length;
    const gap = appearances.length > 0 ? appearances[0] : n;
    const expectedGap = freq > 0 ? n / freq : n;

    let avgGap = expectedGap;
    if (appearances.length >= 2) {
      const gapsArr = appearances.slice(1).map((v, i) => v - appearances[i]);
      avgGap = gapsArr.reduce((a, b) => a + b, 0) / gapsArr.length;
    }

    const window30 = Math.min(30, n);
    const recent30Count = data.slice(0, window30).filter(r => r[pos] === digit).length;
    const expectedIn30 = (freq / n) * window30;
    const trend =
      recent30Count > expectedIn30 * 1.15 ? "Naik 📈"
      : recent30Count < expectedIn30 * 0.85 ? "Turun 📉"
      : "Stabil ─";

    const overdueRatio = avgGap > 0 ? gap / avgGap : 1;
    const gapUrgency = overdueRatio > 1.2 ? 1.0 + (overdueRatio - 1.0) * 0.6 : Math.max(0.2, 1 - (1 - overdueRatio) * 0.4);
    const freqReliability = freq / n;
    const trendBonus = trend.startsWith("Naik") ? 1.2 : trend.startsWith("Turun") ? 0.85 : 1.0;
    const score = freqReliability * gapUrgency * trendBonus * 100;

    items.push({
      digit,
      gap,
      avgGap: Math.round(avgGap * 10) / 10,
      freq,
      trend,
      score: Math.round(score * 1000) / 1000,
    });
  }

  return items.sort((a, b) => b.score - a.score);
}

function extractEnginePositionScores(engines: EngineOutput[]): Record<Position, number[]> {
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
          posScores[pos][d] += engine.weight * engine.confidence / (rank + 1);
        }
      });
    }
  });
  return posScores;
}

function normalizeArr(arr: number[]): number[] {
  const max = Math.max(...arr, 1e-9);
  return arr.map(v => v / max);
}

function normalizeObj(obj: Record<string, number>): Record<string, number> {
  const max = Math.max(...Object.values(obj), 1e-9);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v / max]));
}

function topNArr(arr: number[], n: number): string[] {
  return arr
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map(x => String(x.i));
}

function generateReasons(
  data: DrawData[],
  consensus: ReturnType<typeof runAllEngines>,
  all2dScores: ScoreItem[],
  posGaps: Record<Position, DigitGapItem[]>,
  timeSlot: string,
  pasaran: string,
  slotFiltered: boolean,
): string[] {
  const n = data.length;
  const reasons: string[] = [];

  const slotNote = slotFiltered && timeSlot !== "ALL"
    ? `slot ${timeSlot} spesifik`
    : "semua slot";
  reasons.push(
    `📊 Analisis menggunakan ${n} draw historis (${slotNote}, ${pasaran.toUpperCase()}) dengan 100 engine paralel (Markov, Bayesian, Neural Network, Gap/Poisson, Pattern, Momentum, Shio). Confidence keseluruhan: ${Math.round(consensus.overallConfidence * 100)}%.`
  );

  const top2d = all2dScores[0];
  if (top2d) {
    const k = top2d.number[0] ?? "0";
    const e = top2d.number[1] ?? "0";
    const kg = posGaps.kepala.find(g => g.digit === k);
    const eg = posGaps.ekor.find(g => g.digit === e);
    reasons.push(
      `🎯 Top 2D "${top2d.number}": ` +
      `KEPALA ${k} — muncul ${kg?.freq ?? 0}× (${Math.round((kg?.freq ?? 0) / n * 100)}%), terakhir ${kg?.gap ?? 0} draw lalu (rata-rata tiap ${kg?.avgGap ?? 0} draw), trend ${kg?.trend ?? "—"}. ` +
      `EKOR ${e} — muncul ${eg?.freq ?? 0}× (${Math.round((eg?.freq ?? 0) / n * 100)}%), terakhir ${eg?.gap ?? 0} draw lalu (rata-rata tiap ${eg?.avgGap ?? 0} draw), trend ${eg?.trend ?? "—"}.`
    );
  }

  if (consensus.explanations && consensus.explanations.length > 0) {
    reasons.push(...consensus.explanations.slice(0, 3));
  }

  for (const pos of (["kepala", "ekor"] as Position[])) {
    const topOverdue = posGaps[pos].filter(g => g.gap > g.avgGap * 1.3 && g.freq >= 3).slice(0, 2);
    for (const g of topOverdue) {
      reasons.push(
        `⚡ Digit ${g.digit} di ${pos.toUpperCase()} OVERDUE — terakhir ${g.gap} draw lalu (rata-rata ${g.avgGap}), frekuensi ${g.freq}×/${n}. Probabilitas rebound tinggi oleh engine Gap & Poisson.`
      );
    }
  }

  reasons.push(
    `🔢 BBFS ${consensus.bbfs6.join("-")} dipilih dari 6 digit dengan skor engine tertinggi per posisi. ` +
    `BBFS 5: ${consensus.bbfs5.join("-")} (posisi KEPALA+EKOR terkuat).`
  );

  if (consensus.colokBebas.length > 0) {
    const topCB = posGaps.ekor.find(g => g.digit === consensus.colokBebas[0]);
    reasons.push(
      `🎲 Colok Bebas utama: digit ${consensus.colokBebas.slice(0, 3).join(", ")} — ` +
      (topCB ? `digit ${topCB.digit} di EKOR muncul ${topCB.freq}× (${topCB.trend}).` : "berdasarkan skor EKOR tertinggi dari semua engine.")
    );
  }

  return reasons.slice(0, 10);
}

export function runDeepAnalysis(
  data: Array<DrawData & { tanggal?: string }>,
  pasaran: string,
  timeSlot: string,
  lastResult: string
): DeepAnalysisResult {
  if (data.length === 0) throw new Error("No data to analyze");

  const n = data.length;

  const consensus = runAllEngines(data, pasaran);

  const enginePosScores = extractEnginePositionScores(consensus.engines);
  const normEngine: Record<Position, number[]> = {
    as: normalizeArr(enginePosScores.as),
    kop: normalizeArr(enginePosScores.kop),
    kepala: normalizeArr(enginePosScores.kepala),
    ekor: normalizeArr(enginePosScores.ekor),
  };

  const histScores = weightedDigitScores(data);
  const normHist: Record<Position, Record<string, number>> = {
    as: normalizeObj(histScores.as),
    kop: normalizeObj(histScores.kop),
    kepala: normalizeObj(histScores.kepala),
    ekor: normalizeObj(histScores.ekor),
  };

  const posGaps: Record<Position, DigitGapItem[]> = {
    as: buildGapAnalysis(data, "as"),
    kop: buildGapAnalysis(data, "kop"),
    kepala: buildGapAnalysis(data, "kepala"),
    ekor: buildGapAnalysis(data, "ekor"),
  };

  const maxGapScore: Record<Position, number> = {
    as: Math.max(...posGaps.as.map(g => g.score), 1e-9),
    kop: Math.max(...posGaps.kop.map(g => g.score), 1e-9),
    kepala: Math.max(...posGaps.kepala.map(g => g.score), 1e-9),
    ekor: Math.max(...posGaps.ekor.map(g => g.score), 1e-9),
  };

  const all2dScores: ScoreItem[] = [];
  for (let i = 0; i <= 9; i++) {
    for (let j = 0; j <= 9; j++) {
      const num = `${i}${j}`;
      const engineScore = (normEngine.kepala[i] ?? 0) * 0.5 + (normEngine.ekor[j] ?? 0) * 0.5;
      const histScore = (normHist.kepala[String(i)] ?? 0) * 0.5 + (normHist.ekor[String(j)] ?? 0) * 0.5;
      const kepalaGapNorm = (posGaps.kepala.find(g => g.digit === String(i))?.score ?? 0) / maxGapScore.kepala;
      const ekorGapNorm = (posGaps.ekor.find(g => g.digit === String(j))?.score ?? 0) / maxGapScore.ekor;
      const gapScore = kepalaGapNorm * 0.5 + ekorGapNorm * 0.5;
      const score = engineScore * 0.50 + histScore * 0.30 + gapScore * 0.20;
      all2dScores.push({ number: num, score });
    }
  }
  all2dScores.sort((a, b) => b.score - a.score);

  const top4d = consensus.consensus4d.slice(0, 10);
  const top3d = consensus.consensus3d.slice(0, 10);

  const pred2dEkor = [...new Set(top4d.map((n) => n.slice(2)))].slice(0, 5);
  const pred2dDepan = [...new Set(top4d.map((n) => n.slice(0, 2)))].slice(0, 5);
  const pred2dTengah = [...new Set(top4d.map((n) => n.slice(1, 3)))].slice(0, 5);

  const bbfs3dSet = new Set<string>();
  topNArr(enginePosScores.kepala, 3).forEach(d => bbfs3dSet.add(d));
  topNArr(enginePosScores.ekor, 3).forEach(d => bbfs3dSet.add(d));
  posGaps.kepala.slice(0, 2).forEach(g => bbfs3dSet.add(g.digit));
  posGaps.ekor.slice(0, 2).forEach(g => bbfs3dSet.add(g.digit));
  const bbfs3d = [...bbfs3dSet].slice(0, 6);

  const posPositions = ["AS", "KOP", "KEPALA", "EKOR"] as const;
  const colokJitu: ColokJituItem[] = POSITIONS.map((p, idx) => {
    const combined = new Array(10).fill(0).map((_, d) => {
      const eng = (normEngine[p][d] ?? 0) * 0.7;
      const gap = ((posGaps[p].find(g => g.digit === String(d))?.score ?? 0) / maxGapScore[p]) * 0.3;
      return eng + gap;
    });
    const topD = combined.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)[0];
    return { digit: String(topD?.i ?? 0), posisi: posPositions[idx] };
  });

  // Colok Bebas: weighted combo dari semua 4 posisi (ekor bobot tertinggi)
  const colokBebasScores: Record<string, number> = {};
  for (let d = 0; d <= 9; d++) {
    const ds = String(d);
    const ekorScore = (posGaps.ekor.find(g => g.digit === ds)?.score ?? 0) / maxGapScore.ekor;
    const kepalaScore = (posGaps.kepala.find(g => g.digit === ds)?.score ?? 0) / maxGapScore.kepala;
    const kopScore = (posGaps.kop.find(g => g.digit === ds)?.score ?? 0) / maxGapScore.kop;
    const asScore = (posGaps.as.find(g => g.digit === ds)?.score ?? 0) / maxGapScore.as;
    // Engine score per digit (average over 4 positions)
    const engScore = ((normEngine.ekor[d] ?? 0) * 0.40 + (normEngine.kepala[d] ?? 0) * 0.30
      + (normEngine.kop[d] ?? 0) * 0.15 + (normEngine.as[d] ?? 0) * 0.15);
    // Gap score: ekor 40%, kepala 30%, kop 15%, as 15%
    const gapScore = ekorScore * 0.40 + kepalaScore * 0.30 + kopScore * 0.15 + asScore * 0.15;
    colokBebasScores[ds] = engScore * 0.60 + gapScore * 0.40;
  }
  const colokBebas = Object.entries(colokBebasScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d);
  const colokBebas3d = top3d.slice(0, 5);

  const last = lastResult || "0000";
  const lastDigits = last.split("").map(Number);
  const sum = lastDigits.reduce((a, b) => a + b, 0);
  const dasar = `${sum % 10 < 5 ? "Kecil" : "Besar"} & ${sum % 2 === 0 ? "Genap" : "Ganjil"}`;
  const tengahVals = lastDigits.slice(1, 3);
  const tengahTepi = tengahVals.every((d) => d >= 1 && d <= 8) ? "Tengah" : "Tepi";
  const kepalaD = lastDigits[2] ?? 0;
  const ekorD = lastDigits[3] ?? 0;
  const silangHomo = (kepalaD % 2) === (ekorD % 2) ? "Homo" : "Silang";
  const prevEkor = data.length > 1 ? data[1].ekor : "0";
  const currEkor = last[3] ?? "0";
  const kembangKempis = parseInt(currEkor) > parseInt(prevEkor) ? "Naik (Kembang)" : "Turun (Kempis)";

  const shio = posGaps.ekor.slice(0, 5).map(g => `${g.digit} → ${SHIO_DIGIT_MAP[parseInt(g.digit)] ?? "?"}`);

  const bbni3dNum = top3d[0] ?? "000";
  const bbni3dVal = parseInt(bbni3dNum);
  const bbni3d = isNaN(bbni3dVal)
    ? "Kode"
    : bbni3dVal % 2 === 0 ? "Kode (Genap)" : "Kode (Ganjil)";

  const topikon = all2dScores.slice(0, 10).map(s => s.number);

  const maxScore2d = all2dScores[0]?.score ?? 1;

  const top5: RekomendItem[] = all2dScores.slice(0, 5).map((item, i) => {
    const { label, color } = scoreLabel(item.score, maxScore2d);
    return { rank: i + 1, number: item.number, score: item.score, label, color };
  });

  const scoreDistribution: ScoreItem[] = all2dScores.slice(0, 12).map(s => ({
    number: s.number,
    score: Math.round(s.score * 10000) / 10000,
  }));

  const ranking2d: RekomendItem[] = all2dScores.slice(0, 100).map((item, i) => {
    const { label, color } = scoreLabel(item.score, maxScore2d);
    return { rank: i + 1, number: item.number, score: item.score, label, color };
  });

  const slotFiltered = timeSlot !== "ALL";

  const reasons = generateReasons(data, consensus, all2dScores, posGaps, timeSlot, pasaran, slotFiltered);

  const digitAnalysis: Record<string, PositionAnalysis> = {};
  for (const pos of POSITIONS) {
    const gaps = posGaps[pos];
    digitAnalysis[pos] = {
      topDigits: gaps.slice(0, 5).map(g => g.digit),
      gaps,
    };
  }

  return {
    pasaran,
    timeSlot: timeSlot || "ALL",
    lastResult: lastResult || "----",
    generatedAt: new Date().toISOString(),
    overallConfidence: consensus.overallConfidence,
    totalDrawsUsed: n,
    bbfs3d,
    bbfs5: consensus.bbfs5,
    bbfs6: consensus.bbfs6,
    prediksi4d: top4d,
    prediksi3d: top3d,
    pred2dEkor,
    pred2dDepan,
    pred2dTengah,
    colokBebas,
    colokBebas3d,
    colokJitu,
    dasar,
    tengahTepi,
    silangHomo,
    kembangKempis,
    shio,
    bbni3d,
    topikon,
    top5,
    scoreDistribution,
    ranking2d,
    reasons,
    digitAnalysis,
  };
}
