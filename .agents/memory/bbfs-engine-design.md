---
name: BBFS Engine Design
description: Architecture decisions for BBFS-first prediction engine in Smart AI Togel
---

# BBFS-First Engine Design (V4)

## Core principle
BBFS5/6/7 is the PRIMARY output. Every engine computes `bbfsScore[0..9]` — P(digit d appears in any of 4 positions in next draw). Secondary: per-position digits for 4D/3D/2D.

## EngineOutput interface
Added `bbfsScore: number[]` (array of 10 normalized scores, sums to 1.0).
The Zod/OpenAPI schema strips this field from API responses (intentional — clients only need BBFS5/6/7 result, not per-engine scores).

## BBFS score functions (in prediction-engine.ts)
- `anyPosFreq(data)` — count draws where digit appears in ANY position
- `bbfsFrequencyScore` — Laplace-smoothed historical frequency
- `bbfsRecencyScore(alpha)` — exponential decay weighting
- `bbfsGapScore` — overdue ratio: currentGap / avgGap
- `bbfsMarkovScore(order)` — Markov transition on digit sets
- `bbfsBayesScore` — Beta-Binomial posterior with Jeffreys prior
- `bbfsMomentumScore(short, long)` — short/long window ratio
- `bbfsPatternScore` — cyclical proximity analysis
- `bbfsStatScore` — chi-square underrepresented boost
- `bbfsShioScore` — shio-weighted any-position frequency
- `bbfsCoverageScore` — co-occurrence analysis from last draw

## buildConsensus 5-layer aggregation
1. 100 engine bbfsScore aggregate (weighted by engine.weight × engine.confidence)
2. Direct frequency (20% blend)
3. Recency boost last 20 draws (15%)
4. Co-occurrence coverage (10%)
5. Gap/overdue boost (10%)

**Why:** Multiple independent signals reduce noise. Direct frequency prevents pure Markov overfitting.

## Slot-aware mechanism
Route filters draws by slot suffix in periode field: "19:00" → periode ends in "-1900".
Engine receives ONLY that slot's draws (~518 draws per slot for Macau).
Fallback to all draws if slot has < 10 draws.

## Data flow
predict.ts → filter by slot → runAllEngines(slotData) → buildConsensus → bbfs5/6/7
scheduler.ts → all draws → runAllEngines → stores bbfs7 too (was missing, fixed)
