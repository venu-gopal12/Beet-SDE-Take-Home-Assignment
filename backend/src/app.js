import cors from "cors";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorHandler } from "./middleware/errorHandler.js";
import { MongoMealRepository } from "./repositories/MongoMealRepository.js";
import { FoodResolver } from "./services/FoodResolver.js";
import { MealService } from "./services/MealService.js";
import { createFoodsRouter } from "./routes/foods.js";
import { createLiveKitRouter } from "./routes/livekit.js";
import { createMealsRouter } from "./routes/meals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultFoodPath = path.resolve(__dirname, "../../data/foods.json");

export const createApp = ({
  repository = new MongoMealRepository(),
  foodResolver = new FoodResolver(defaultFoodPath),
  defaultUserId = process.env.DEMO_USER_ID || "venugopal"
} = {}) => {
  const app = express();
  const mealService = new MealService({ repository, foodResolver, defaultUserId });

  // Injected dependencies let tests hit the real routes without a live MongoDB.
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
  app.use(express.json());
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    app.use(morgan("dev"));
  }

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/foods", createFoodsRouter({ foodResolver }));
  app.use("/api/livekit", createLiveKitRouter());
  app.use("/api/meals", createMealsRouter({ mealService }));
  app.use(errorHandler);

  return app;
};
