import path from "node:path";
import { describe, expect, it } from "vitest";
import { FoodResolver } from "../src/services/FoodResolver.js";

const resolver = new FoodResolver(path.resolve(process.cwd(), "../data/foods.json"));

describe("FoodResolver", () => {
  it("resolves aliases and default units", () => {
    const item = resolver.resolveItem({ dish: "chapati", quantity: 2 });
    expect(item.foodId).toBe("roti");
    expect(item.unit).toBe("piece");
    expect(item.grams).toBe(80);
    expect(item.macros.calories).toBe(237.6);
  });

  it("resolves household units", () => {
    const item = resolver.resolveItem({ dish: "dal", quantity: 1, unit: "katori" });
    expect(item.foodId).toBe("dal_tadka");
    expect(item.grams).toBe(180);
    expect(item.macros.protein).toBe(10.8);
  });

  it("rejects unsupported dishes with suggestions", () => {
    expect(() => resolver.resolveItem({ dish: "pizza", quantity: 1 })).toThrow(/not in the food database/);
  });

  it("rejects unsupported units for a valid dish", () => {
    expect(() => resolver.resolveItem({ dish: "roti", quantity: 1, unit: "glass" })).toThrow(/cannot be logged/);
  });

  it("rejects zero, negative, and absurd quantities", () => {
    expect(() => resolver.resolveItem({ dish: "roti", quantity: 0 })).toThrow(/positive/);
    expect(() => resolver.resolveItem({ dish: "roti", quantity: -2 })).toThrow(/positive/);
    expect(() => resolver.resolveItem({ dish: "roti", quantity: 500 })).toThrow(/50 or less/);
  });
});
