import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryMealRepository } from "../src/repositories/InMemoryMealRepository.js";
import { FoodResolver } from "../src/services/FoodResolver.js";

let app;

beforeEach(() => {
  app = createApp({
    repository: new InMemoryMealRepository(),
    foodResolver: new FoodResolver(path.resolve(process.cwd(), "../data/foods.json"))
  });
});

const createLunch = () =>
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
});
