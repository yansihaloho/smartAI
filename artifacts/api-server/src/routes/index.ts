import { Router, type IRouter } from "express";
import healthRouter from "./health";
import resultsRouter from "./results";
import predictRouter from "./predict";
import deepRouter from "./deep";
import smartAiRouter from "./smart-ai";
import laporanRouter from "./laporan";

const router: IRouter = Router();

router.use(healthRouter);
router.use(resultsRouter);
router.use(predictRouter);
router.use(deepRouter);
router.use(smartAiRouter);
router.use(laporanRouter);

export default router;
