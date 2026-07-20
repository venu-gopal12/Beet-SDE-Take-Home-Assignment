import fs from "node:fs";
import path from "node:path";
import { ApiError } from "../utils/ApiError.js";

const round = (value) => Math.round(value * 10) / 10;
const maxReasonableQuantity = 50;

// Normalize voice-derived strings before comparing them to foods.json.
const normalize = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const bigrams = (value) => {
  const text = ` ${normalize(value)} `;
  const grams = new Set();
  for (let index = 0; index < text.length - 1; index += 1) {
    grams.add(text.slice(index, index + 2));
  }
  return grams;
};

// Small typo-tolerant matcher; low-confidence inputs still fail closed.
const diceCoefficient = (left, right) => {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const gram of a) {
    if (b.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (a.size + b.size);
};

export class FoodResolver {
  constructor(foodPath = path.resolve(process.cwd(), "../data/foods.json")) {
    this.foods = JSON.parse(fs.readFileSync(foodPath, "utf8"));
    // Build one search index from IDs, display names, and aliases at startup.
    this.searchEntries = this.foods.flatMap((food) => {
      const aliases = [food.id, food.name, ...(food.aliases ?? [])];
      return aliases.map((alias) => ({
        alias,
        normalizedAlias: normalize(alias),
        food
      }));
    });
  }

  listFoods() {
    return this.foods.map((food) => ({
      id: food.id,
      name: food.name,
      aliases: food.aliases,
      defaultUnit: food.defaultUnit,
      units: food.units.map((unit) => ({
        name: unit.name,
        aliases: unit.aliases,
        grams: unit.grams
      })),
      macrosPer100g: food.macrosPer100g
    }));
  }

  resolveFood(input) {
    const requested = normalize(input);
    if (!requested) {
      throw new ApiError(422, "dish_required", "Dish is required.");
    }

    const exact = this.searchEntries.find((entry) => entry.normalizedAlias === requested);
    if (exact) return exact.food;

    // Accept only high-confidence fuzzy matches; otherwise return suggestions.
    const ranked = this.searchEntries
      .map((entry) => ({ food: entry.food, alias: entry.alias, score: diceCoefficient(requested, entry.alias) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (best?.score >= 0.68) return best.food;

    const suggestions = [];
    const seen = new Set();
    for (const candidate of ranked) {
      if (candidate.score < 0.35 || seen.has(candidate.food.id)) continue;
      seen.add(candidate.food.id);
      suggestions.push({ id: candidate.food.id, name: candidate.food.name });
      if (suggestions.length === 3) break;
    }

    throw new ApiError(422, "dish_not_found", `"${input}" is not in the food database.`, {
      suggestions
    });
  }

  resolveUnit(food, input) {
    // Missing units are common in speech, so each food owns a default unit.
    const requested = normalize(input || food.defaultUnit);
    const unit = food.units.find((candidate) => {
      const names = [candidate.name, ...(candidate.aliases ?? [])].map(normalize);
      return names.includes(requested);
    });

    if (!unit) {
      throw new ApiError(422, "unit_not_allowed", `${food.name} cannot be logged in "${input}".`, {
        allowedUnits: food.units.map((candidate) => candidate.name)
      });
    }

    return unit;
  }

  resolveItem({ dish, quantity = 1, unit }) {
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      throw new ApiError(422, "quantity_invalid", "Quantity must be a positive number.");
    }
    if (numericQuantity > maxReasonableQuantity) {
      throw new ApiError(422, "quantity_too_large", `Quantity must be ${maxReasonableQuantity} or less.`);
    }

    const food = this.resolveFood(dish);
    const resolvedUnit = this.resolveUnit(food, unit);
    const grams = round(numericQuantity * resolvedUnit.grams);

    // Store a resolved snapshot so old logs do not change if foods.json changes.
    return {
      foodId: food.id,
      foodName: food.name,
      quantity: numericQuantity,
      unit: resolvedUnit.name,
      grams,
      macros: this.calculateMacros(food, grams)
    };
  }

  calculateMacros(food, grams) {
    const factor = grams / 100;
    return {
      calories: round(food.macrosPer100g.calories * factor),
      protein: round(food.macrosPer100g.protein * factor),
      carbs: round(food.macrosPer100g.carbs * factor),
      fat: round(food.macrosPer100g.fat * factor)
    };
  }
}

export const sumMacros = (items) =>
  items.reduce(
    (total, item) => ({
      calories: round(total.calories + item.macros.calories),
      protein: round(total.protein + item.macros.protein),
      carbs: round(total.carbs + item.macros.carbs),
      fat: round(total.fat + item.macros.fat)
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
