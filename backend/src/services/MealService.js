import { ApiError } from "../utils/ApiError.js";
import { sumMacros } from "./FoodResolver.js";

const allowedMealTypes = new Set(["breakfast", "lunch", "dinner", "snack", "unknown"]);

const normalizeMealType = (mealType = "unknown") => {
  const normalized = String(mealType || "unknown").toLowerCase();
  return allowedMealTypes.has(normalized) ? normalized : "unknown";
};

const asDate = (value) => {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(422, "logged_at_invalid", "loggedAt must be a valid date.");
  }
  return date;
};

const normalizeObjectId = (value) => String(value);

// Backend-side time filters make commands like "this morning" deterministic.
const inTimeOfDay = (meal, timeOfDay) => {
  if (!timeOfDay) return true;
  const hour = new Date(meal.loggedAt).getHours();
  if (timeOfDay === "morning") return hour >= 4 && hour < 12;
  if (timeOfDay === "afternoon") return hour >= 12 && hour < 17;
  if (timeOfDay === "evening") return hour >= 17 && hour < 21;
  if (timeOfDay === "night") return hour >= 21 || hour < 4;
  return true;
};

export class MealService {
  constructor({ repository, foodResolver, defaultUserId = "demo-user" }) {
    this.repository = repository;
    this.foodResolver = foodResolver;
    this.defaultUserId = defaultUserId;
  }

  userId(userId) {
    return userId || this.defaultUserId;
  }

  async listMeals(userId) {
    return this.repository.list(this.userId(userId));
  }

  async createMeal({ userId, mealType, items, rawUtterance, loggedAt }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(422, "items_required", "At least one meal item is required.");
    }

    // The backend, not the agent or UI, resolves foods and computes macros.
    const resolvedItems = items.map((item) => this.foodResolver.resolveItem(item));
    return this.repository.create({
      userId: this.userId(userId),
      mealType: normalizeMealType(mealType),
      loggedAt: asDate(loggedAt),
      rawUtterance: rawUtterance || "",
      items: resolvedItems,
      totals: sumMacros(resolvedItems),
      deletedAt: null
    });
  }

  async updateMeal({ id, userId, mealType, rawUtterance, loggedAt }) {
    const meal = await this.getActiveMeal(id, userId);
    if (mealType !== undefined) meal.mealType = normalizeMealType(mealType);
    if (rawUtterance !== undefined) meal.rawUtterance = rawUtterance;
    if (loggedAt !== undefined) meal.loggedAt = asDate(loggedAt);
    return this.repository.save(meal);
  }

  async updateItem({ mealId, itemId, userId, dish, quantity, unit }) {
    const meal = await this.getActiveMeal(mealId, userId);
    const itemIndex = meal.items.findIndex((item) => normalizeObjectId(item._id) === normalizeObjectId(itemId));
    if (itemIndex < 0) throw new ApiError(404, "item_not_found", "Meal item not found.");

    const current = meal.items[itemIndex];
    // Partial edits keep any fields the user did not change.
    const next = this.foodResolver.resolveItem({
      dish: dish || current.foodName,
      quantity: quantity ?? current.quantity,
      unit: unit || current.unit
    });

    meal.items[itemIndex] = { ...current, ...next };
    meal.totals = sumMacros(meal.items);
    return this.repository.save(meal);
  }

  async deleteMeal({ id, userId }) {
    const meal = await this.getActiveMeal(id, userId);
    meal.deletedAt = new Date();
    return this.repository.save(meal);
  }

  async deleteItem({ mealId, itemId, userId }) {
    const meal = await this.getActiveMeal(mealId, userId);
    const nextItems = meal.items.filter((item) => normalizeObjectId(item._id) !== normalizeObjectId(itemId));
    if (nextItems.length === meal.items.length) {
      throw new ApiError(404, "item_not_found", "Meal item not found.");
    }
    if (nextItems.length === 0) {
      // Deleting the final item hides the whole meal from active logs.
      meal.deletedAt = new Date();
    } else {
      meal.items = nextItems;
      meal.totals = sumMacros(nextItems);
    }
    return this.repository.save(meal);
  }

  async findRecent({ userId, dish, mealType, timeOfDay }) {
    const food = dish ? this.foodResolver.resolveFood(dish) : null;
    const meals = await this.repository.list(this.userId(userId));
    const matches = [];

    // Repositories return newest-first, so the first match means "the latest one".
    for (const meal of meals) {
      if (mealType && meal.mealType !== normalizeMealType(mealType)) continue;
      if (!inTimeOfDay(meal, timeOfDay)) continue;
      const item = food
        ? meal.items.find((candidate) => candidate.foodId === food.id)
        : meal.items[0];
      if (!item) continue;
      matches.push({ meal, item });
    }

    if (!matches.length) {
      throw new ApiError(404, "meal_match_not_found", "No matching meal entry was found.");
    }

    const match = matches[0];
    return {
      mealId: match.meal._id,
      itemId: match.item._id,
      mealType: match.meal.mealType,
      loggedAt: match.meal.loggedAt,
      item: match.item
    };
  }

  async getActiveMeal(id, userId) {
    const meal = await this.repository.getById(id, this.userId(userId));
    if (!meal) throw new ApiError(404, "meal_not_found", "Meal not found.");
    return meal;
  }
}
