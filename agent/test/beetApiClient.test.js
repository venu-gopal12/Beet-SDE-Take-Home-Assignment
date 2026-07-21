import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { BeetApiClient, BeetApiError, cleanOptional, formatApiError, summarizeMeal } from "../src/beetApiClient.js";

// These tests mock fetch so agent tool behavior can be verified without a live
// backend or LiveKit session.
describe("BeetApiClient", () => {
  it("logs meals through the backend", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      meal: {
        _id: "meal-1",
        items: [{ foodName: "Roti", quantity: 2, unit: "piece" }],
        totals: { calories: 237.6, protein: 7, carbs: 37.1, fat: 5.9 },
      },
    }), { status: 201, headers: { "content-type": "application/json" } }));

    const client = new BeetApiClient({ baseUrl: "http://test", userId: "demo-user" });
    const meal = await client.logMeal({
      mealType: "lunch",
      items: [{ dish: "roti", quantity: 2 }],
      rawUtterance: "two rotis",
    });

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(meal._id, "meal-1");
    assert.match(summarizeMeal(meal), /Roti/);
    fetchMock.mock.restore();
  });

  it("ignores placeholder optional values while editing", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/meals/find") {
        assert.equal(parsed.searchParams.get("dish"), "roti");
        assert.equal(parsed.searchParams.has("mealType"), false);
        assert.equal(parsed.searchParams.has("timeOfDay"), false);
        assert.equal(parsed.searchParams.has("clockTime"), false);
        return new Response(JSON.stringify({ match: { mealId: "m1", itemId: "i1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      assert.equal(parsed.pathname, "/api/meals/m1/items/i1");
      assert.equal(JSON.parse(init.body).unit, undefined);
      return new Response(JSON.stringify({
        meal: {
          _id: "m1",
          items: [{ foodName: "Roti", quantity: 3, unit: "piece" }],
          totals: { calories: 356.4, protein: 10.4, carbs: 55.7, fat: 8.9 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const client = new BeetApiClient({ baseUrl: "http://test", userId: "demo-user" });
    const meal = await client.editRecentItem({
      dish: "roti",
      quantity: 3,
      unit: "null",
      mealType: "unknown",
      timeOfDay: "unknown",
    });

    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(meal.items[0].quantity, 3);
    fetchMock.mock.restore();
  });

  it("passes exact clock time while editing", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/meals/find") {
        assert.equal(parsed.searchParams.get("dish"), "roti");
        assert.equal(parsed.searchParams.get("mealType"), "lunch");
        assert.equal(parsed.searchParams.get("clockTime"), "13:45");
        return new Response(JSON.stringify({ match: { mealId: "m1", itemId: "i1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      assert.equal(parsed.pathname, "/api/meals/m1/items/i1");
      assert.equal(JSON.parse(init.body).quantity, 3);
      return new Response(JSON.stringify({
        meal: {
          _id: "m1",
          items: [{ foodName: "Roti", quantity: 3, unit: "piece" }],
          totals: { calories: 356.4, protein: 10.4, carbs: 55.7, fat: 8.9 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const client = new BeetApiClient({ baseUrl: "http://test", userId: "demo-user" });
    const meal = await client.editRecentItem({
      dish: "roti",
      quantity: 3,
      mealType: "lunch",
      clockTime: "13:45",
    });

    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(meal.items[0].quantity, 3);
    fetchMock.mock.restore();
  });

  it("surfaces backend suggestions", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      error: {
        code: "dish_not_found",
        message: "Unsupported dish",
        details: { suggestions: [{ id: "poha", name: "Poha" }] },
      },
    }), { status: 422, headers: { "content-type": "application/json" } }));

    const client = new BeetApiClient({ baseUrl: "http://test", userId: "demo-user" });
    await assert.rejects(
      () => client.logMeal({ mealType: "snack", items: [{ dish: "pizza", quantity: 1 }] }),
      (error) => error instanceof BeetApiError && error.code === "dish_not_found",
    );
    fetchMock.mock.restore();
  });

  it("formats ambiguous meal matches as clarification prompts", () => {
    const error = new BeetApiError("Multiple matching meal entries were found.", "meal_match_ambiguous", {
      candidates: [
        { mealType: "lunch", loggedAt: "2026-07-19T10:00:00.000Z", item: { foodName: "Roti", quantity: 1, unit: "piece" } },
        { mealType: "dinner", loggedAt: "2026-07-19T12:00:00.000Z", item: { foodName: "Roti", quantity: 2, unit: "piece" } },
      ],
    });

    const message = formatApiError(error);
    assert.match(message, /multiple matching entries/i);
    assert.match(message, /lunch/);
    assert.match(message, /dinner/);
    assert.match(message, /at .*2026/i);
  });

  it("deletes the latest meal entry for undo", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/meals" && parsed.searchParams.get("userId") === "demo-user") {
        return new Response(JSON.stringify({
          meals: [{ _id: "latest-meal", items: [{ foodName: "Roti", quantity: 3, unit: "piece" }], totals: {} }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      assert.equal(parsed.pathname, "/api/meals/latest-meal");
      return new Response(JSON.stringify({
        meal: { _id: "latest-meal", items: [{ foodName: "Roti", quantity: 3, unit: "piece" }], totals: {} },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const client = new BeetApiClient({ baseUrl: "http://test", userId: "demo-user" });
    const meal = await client.deleteLatestMeal();

    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(meal._id, "latest-meal");
    fetchMock.mock.restore();
  });

  it("turns null edit matches into a safe BeetApiError", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      match: null,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const client = new BeetApiClient({ baseUrl: "http://test", userId: "demo-user" });

    await assert.rejects(
      () => client.editRecentItem({ dish: "dal", quantity: 2 }),
      (error) =>
        error instanceof BeetApiError
        && error.code === "meal_match_not_found"
        && /dal entry to update/.test(error.message),
    );

    fetchMock.mock.restore();
  });

  it("turns null delete matches into a safe BeetApiError", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      match: null,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const client = new BeetApiClient({ baseUrl: "http://test", userId: "demo-user" });

    await assert.rejects(
      () => client.deleteRecentItem({ dish: "chai" }),
      (error) =>
        error instanceof BeetApiError
        && error.code === "meal_match_not_found"
        && /chai entry to remove/.test(error.message),
    );

    fetchMock.mock.restore();
  });
});

describe("cleanOptional", () => {
  it("removes common placeholder strings", () => {
    assert.equal(cleanOptional("unknown"), null);
    assert.equal(cleanOptional("null"), null);
    assert.equal(cleanOptional(" lunch "), "lunch");
  });
});
