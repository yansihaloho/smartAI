import { Router, type IRouter } from "express";
import { getLearningLog, getEnginePerformance, getWeightTable, evaluateAndLearn } from "../lib/learning-engine";
import {
  GetLearningLogQueryParams,
  GetLearningLogResponse,
  GetEnginePerformanceQueryParams,
  GetEnginePerformanceResponse,
  TriggerEvaluateBody,
  TriggerEvaluateResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /api/learning/log
router.get("/learning/log", async (req, res): Promise<void> => {
  const parsed = GetLearningLogQueryParams.safeParse(req.query);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  const limit = parsed.success ? Math.min(50, parsed.data.limit ?? 20) : 20;
  try {
    const log = await getLearningLog(pasaran, limit);
    res.json(GetLearningLogResponse.parse({ pasaran, log }));
  } catch (err) {
    req.log.error({ err }, "Learning log fetch failed");
    res.status(500).json({ error: "Failed to fetch learning log" });
  }
});

// GET /api/learning/performance
router.get("/learning/performance", async (req, res): Promise<void> => {
  const parsed = GetEnginePerformanceQueryParams.safeParse(req.query);
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  const limit = parsed.success ? Math.min(200, parsed.data.limit ?? 50) : 50;
  try {
    const [performance, weights] = await Promise.all([
      getEnginePerformance(pasaran, limit),
      getWeightTable(pasaran),
    ]);
    res.json(GetEnginePerformanceResponse.parse({ pasaran, performance, weights }));
  } catch (err) {
    req.log.error({ err }, "Engine performance fetch failed");
    res.status(500).json({ error: "Failed to fetch engine performance" });
  }
});

// POST /api/learning/evaluate
router.post("/learning/evaluate", async (req, res): Promise<void> => {
  const parsed = TriggerEvaluateBody.safeParse(req.body ?? {});
  const pasaran = parsed.success ? (parsed.data.pasaran ?? "macau") : "macau";
  try {
    const result = await evaluateAndLearn(pasaran);
    res.json(TriggerEvaluateResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Learning evaluate failed");
    res.status(500).json({ error: "Evaluation failed" });
  }
});

export default router;
