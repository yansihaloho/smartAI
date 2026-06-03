import { pgTable, serial, text, timestamp, boolean, integer, doublePrecision, real } from "drizzle-orm/pg-core";

export const lotteryResultsTable = pgTable("lottery_results", {
  id: serial("id").primaryKey(),
  pasaran: text("pasaran").notNull(),
  tanggal: text("tanggal").notNull(),
  periode: text("periode").notNull().unique(),
  result4d: text("result4d").notNull(),
  as: text("as").notNull(),
  kop: text("kop").notNull(),
  kepala: text("kepala").notNull(),
  ekor: text("ekor").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  pasaran: text("pasaran").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  dataCutoffPeriode: text("data_cutoff_periode"),
  consensus4d: text("consensus4d").array().notNull(),
  consensus3d: text("consensus3d").array().notNull(),
  consensus2d: text("consensus2d").array().notNull(),
  colokBebas: text("colok_bebas").array().notNull(),
  bbfs5: text("bbfs5").array().notNull(),
  bbfs6: text("bbfs6").array().notNull(),
  overallConfidence: doublePrecision("overall_confidence").notNull().default(0),
  enginesJson: text("engines_json").notNull().default("[]"),
  explanationsJson: text("explanations_json").notNull().default("[]"),
  contributionsJson: text("contributions_json").notNull().default("[]"),
});

export const predictionAccuracyTable = pgTable("prediction_accuracy", {
  id: serial("id").primaryKey(),
  pasaran: text("pasaran").notNull(),
  predictionId: integer("prediction_id"),
  predicted4d: text("predicted_4d").array().notNull(),
  predicted2d: text("predicted_2d").array().notNull(),
  predictedBbfs6: text("predicted_bbfs6").array().notNull(),
  predictedColokBebas: text("predicted_colok_bebas").array().notNull(),
  actualResult: text("actual_result"),
  hit4d: boolean("hit_4d"),
  hit3d: boolean("hit_3d"),
  hit2d: boolean("hit_2d"),
  hitBbfs6: boolean("hit_bbfs6"),
  hitColokBebas: boolean("hit_colok_bebas"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  checkedAt: timestamp("checked_at"),
});

export const engineWeightsTable = pgTable("engine_weights", {
  id: serial("id").primaryKey(),
  pasaran: text("pasaran").notNull().unique(),
  weightsJson: text("weights_json").notNull().default("{}"),
  sampleSize: integer("sample_size").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const smartAiWeightsTable = pgTable("smart_ai_weights", {
  id: serial("id").primaryKey(),
  pasaran: text("pasaran").notNull().unique(),
  weightsJson: text("weights_json").notNull().default("{}"),
  hitRatesJson: text("hit_rates_json").notNull().default("{}"),
  evalCountsJson: text("eval_counts_json").notNull().default("{}"),
  lastUpdated: timestamp("last_updated"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const missAnalysisTable = pgTable("miss_analysis", {
  id: serial("id").primaryKey(),
  pasaran: text("pasaran").notNull(),
  predictionId: integer("prediction_id"),
  actualResult: text("actual_result").notNull(),
  predicted4dTop5: text("predicted_4d_top5").array().notNull().default([]),
  predicted2dTop5: text("predicted_2d_top5").array().notNull().default([]),
  asHit: boolean("as_hit").notNull().default(false),
  kopHit: boolean("kop_hit").notNull().default(false),
  kepalaHit: boolean("kepala_hit").notNull().default(false),
  ekorHit: boolean("ekor_hit").notNull().default(false),
  hit2d: boolean("hit_2d").notNull().default(false),
  hit3d: boolean("hit_3d").notNull().default(false),
  hit4d: boolean("hit_4d").notNull().default(false),
  hitBbfs6: boolean("hit_bbfs6").notNull().default(false),
  hitColokBebas: boolean("hit_colok_bebas").notNull().default(false),
  bestCategory: text("best_category"),
  bestCategoryScore: real("best_category_score"),
  worstCategory: text("worst_category"),
  worstCategoryScore: real("worst_category_score"),
  learningNote: text("learning_note").notNull().default(""),
  categoryScoresJson: text("category_scores_json").notNull().default("{}"),
  weightAdjustmentsJson: text("weight_adjustments_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LotteryResult = typeof lotteryResultsTable.$inferSelect;
export type InsertLotteryResult = typeof lotteryResultsTable.$inferInsert;
export type Prediction = typeof predictionsTable.$inferSelect;
export type InsertPrediction = typeof predictionsTable.$inferInsert;
export type PredictionAccuracy = typeof predictionAccuracyTable.$inferSelect;
export type InsertPredictionAccuracy = typeof predictionAccuracyTable.$inferInsert;
export type EngineWeights = typeof engineWeightsTable.$inferSelect;
export type InsertEngineWeights = typeof engineWeightsTable.$inferInsert;
export type MissAnalysis = typeof missAnalysisTable.$inferSelect;
export type InsertMissAnalysis = typeof missAnalysisTable.$inferInsert;
export type SmartAiWeights = typeof smartAiWeightsTable.$inferSelect;
export type InsertSmartAiWeights = typeof smartAiWeightsTable.$inferInsert;
