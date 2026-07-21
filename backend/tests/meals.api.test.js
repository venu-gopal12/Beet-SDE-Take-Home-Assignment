import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryMealRepository } from "../src/repositories/InMemoryMealRepository.js";
import { FoodResolver } from "../src/services/FoodResolver.js";

let app;

beforeEach(() => {
  // Each test gets a fresh in-memory app so meal history never leaks between
  // scenarios.
  app = createApp({
    repository: new InMemoryMealRepository(),
    foodResolver: new FoodResolver(path.resolve(process.cwd(), "../data/foods.json"))
  });
});

const createLunch = () =>
  // Shared fixture for the core "log lunch with multiple items" happy path.
  request(app)
    .post("/api/meals")
    .send({
      mealType: "lunch",
      rawUtterance: "I had two rotis and a katori of dal for lunch",
      items: [
        { dish: "roti", quantity: 2 },
        { dish: "dal", quantity: 1, unit: "katori" }
      ]
    });

describe("meal API", () => {
  it("creates and lists a resolved meal", async () => {
    const created = await createLunch().expect(201);
    expect(created.body.meal.items).toHaveLength(2);
    expect(created.body.meal.totals.calories).toBeGreaterThan(400);

    const listed = await request(app).get("/api/meals").expect(200);
    expect(listed.body.meals).toHaveLength(1);
    expect(listed.body.meals[0].mealType).toBe("lunch");
  });

  it("edits an item quantity", async () => {
    const created = await createLunch();
    const meal = created.body.meal;
    const roti = meal.items.find((item) => item.foodId === "roti");

    const updated = await request(app)
      .patch(`/api/meals/${meal._id}/items/${roti._id}`)
      .send({ quantity: 3 })
      .expect(200);

    const updatedRoti = updated.body.meal.items.find((item) => item.foodId === "roti");
    expect(updatedRoti.quantity).toBe(3);
    expect(updatedRoti.grams).toBe(120);
  });

  it("finds and deletes the most recent matching item", async () => {
    await createLunch();
    const match = await request(app).get("/api/meals/find?dish=dal&mealType=lunch").expect(200);

    await request(app)
      .delete(`/api/meals/${match.body.match.mealId}/items/${match.body.match.itemId}`)
      .expect(200);

    const listed = await request(app).get("/api/meals").expect(200);
    expect(listed.body.meals[0].items.map((item) => item.foodId)).toEqual(["roti"]);
  });

  it("soft deletes a whole meal", async () => {
    const created = await createLunch();
    await request(app).delete(`/api/meals/${created.body.meal._id}`).expect(200);
    const listed = await request(app).get("/api/meals").expect(200);
    expect(listed.body.meals).toHaveLength(0);
  });

  it("rejects unknown foods", async () => {
    const response = await request(app)
      .post("/api/meals")
      .send({ items: [{ dish: "pizza", quantity: 1 }] })
      .expect(422);

    expect(response.body.error.code).toBe("dish_not_found");
  });

  it("rejects invalid units and invalid quantities", async () => {
    const invalidUnit = await request(app)
      .post("/api/meals")
      .send({ items: [{ dish: "roti", quantity: 3, unit: "glass" }] })
      .expect(422);
    expect(invalidUnit.body.error.code).toBe("unit_not_allowed");

    const invalidQuantity = await request(app)
      .post("/api/meals")
      .send({ items: [{ dish: "roti", quantity: 0 }] })
      .expect(422);
    expect(invalidQuantity.body.error.code).toBe("quantity_invalid");

    const tooLarge = await request(app)
      .post("/api/meals")
      .send({ items: [{ dish: "roti", quantity: 500 }] })
      .expect(422);
    expect(tooLarge.body.error.code).toBe("quantity_too_large");
  });

  it("rejects missing required meal items", async () => {
    const response = await request(app).post("/api/meals").send({ mealType: "lunch" }).expect(422);
    expect(response.body.error.code).toBe("items_required");
  });

  it("returns 404 for editing or deleting a missing entry", async () => {
    await request(app)
      .patch("/api/meals/missing-meal/items/missing-item")
      .send({ quantity: 2 })
      .expect(404);

    await request(app)
      .delete("/api/meals/missing-meal/items/missing-item")
      .expect(404);
  });

  it("deduplicates identical voice retry creates in a short window", async () => {
    await createLunch().expect(201);
    await createLunch().expect(201);

    const listed = await request(app).get("/api/meals").expect(200);
    expect(listed.body.meals).toHaveLength(1);
  });

  it("asks callers to clarify ambiguous matching entries", async () => {
    await request(app)
      .post("/api/meals")
      .send({
        mealType: "lunch",
        rawUtterance: "one roti for lunch",
        loggedAt: "2026-07-19T10:00:00.000Z",
        items: [{ dish: "roti", quantity: 1 }]
      })
      .expect(201);

    await request(app)
      .post("/api/meals")
      .send({
        mealType: "dinner",
        rawUtterance: "two rotis for dinner",
        loggedAt: "2026-07-19T12:00:00.000Z",
        items: [{ dish: "roti", quantity: 2 }]
      })
      .expect(201);

    const ambiguous = await request(app).get("/api/meals/find?dish=roti").expect(409);
    expect(ambiguous.body.error.code).toBe("meal_match_ambiguous");
    expect(ambiguous.body.error.details.candidates).toHaveLength(2);

    await request(app).get("/api/meals/find?dish=roti&allowAmbiguousLatest=true").expect(200);
  });

  it("uses exact clock time to disambiguate same-meal entries", async () => {
    const earlyLunchAt = new Date(2026, 6, 19, 13, 15).toISOString();
    const laterLunchAt = new Date(2026, 6, 19, 13, 45).toISOString();

    await request(app)
      .post("/api/meals")
      .send({
        mealType: "lunch",
        rawUtterance: "one roti for lunch",
        loggedAt: earlyLunchAt,
        items: [{ dish: "roti", quantity: 1 }]
      })
      .expect(201);

    await request(app)
      .post("/api/meals")
      .send({
        mealType: "lunch",
        rawUtterance: "two rotis for lunch",
        loggedAt: laterLunchAt,
        items: [{ dish: "roti", quantity: 2 }]
      })
      .expect(201);

    await request(app)
      .get("/api/meals/find")
      .query({ dish: "roti", mealType: "lunch" })
      .expect(409);

    const match = await request(app)
      .get("/api/meals/find")
      .query({ dish: "roti", mealType: "lunch", clockTime: "13:45" })
      .expect(200);

    expect(match.body.match.item.quantity).toBe(2);
  });

  it("maps malformed Mongo ids to a clear 400 response", async () => {
    const castErrorRepository = {
      getById: async () => {
        const error = new Error("Cast to ObjectId failed");
        error.name = "CastError";
        throw error;
      },
      list: async () => [],
      create: async () => null,
      save: async () => null
    };
    const castErrorApp = createApp({
      repository: castErrorRepository,
      foodResolver: new FoodResolver(path.resolve(process.cwd(), "../data/foods.json"))
    });

    const response = await request(castErrorApp)
      .patch("/api/meals/not-a-mongo-id/items/not-an-item-id")
      .send({ quantity: 2 })
      .expect(400);

    expect(response.body.error.code).toBe("malformed_id");
  });
});
