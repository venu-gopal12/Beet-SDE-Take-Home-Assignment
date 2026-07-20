import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FoodResolver } from "../src/services/FoodResolver.js";
import { InMemoryMealRepository } from "../src/repositories/InMemoryMealRepository.js";

describe("LiveKit browser session API", () => {
  it("returns a clear error when LiveKit credentials are not configured", async () => {
    const app = createApp({
      repository: new InMemoryMealRepository(),
      foodResolver: new FoodResolver("../data/foods.json"),
    });

    const response = await request(app)
      .post("/api/livekit/session")
      .send({ userId: "demo-user" })
      .expect(500);

    expect(response.body.error.code).toBe("livekit_config_missing");
  });
});
