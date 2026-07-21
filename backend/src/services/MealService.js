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
const duplicateWindowMs = 10_000;

const itemFingerprint = (item) =>
  `${item.foodId}:${item.quantity}:${item.unit}:${item.grams}`;

const mealFingerprint = ({ mealType, rawUtterance = "", items }) =>
  JSON.stringify({
    mealType: normalizeMealType(mealType),
    rawUtterance: String(rawUtterance).trim().toLowerCase(),
    items: items.map(itemFingerprint).sort()
  });

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

const parseClockTime = (clockTime) => {
  if (!clockTime) return null;
  // Used after ambiguity prompts such as "the 1:45 one".
  const match = String(clockTime).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) {
    throw new ApiError(422, "clock_time_invalid", "clockTime must look like 1:45 PM or 13:45.");
  }

  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const period = match[3];

  if (minute < 0 || minute > 59) {
    throw new ApiError(422, "clock_time_invalid", "clockTime must look like 1:45 PM or 13:45.");
  }
  if (period) {
    if (hour < 1 || hour > 12) {
      throw new ApiError(422, "clock_time_invalid", "clockTime must look like 1:45 PM or 13:45.");
    }
    if (period === "pm" && hour !== 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    throw new ApiError(422, "clock_time_invalid", "clockTime must look like 1:45 PM or 13:45.");
  }

  return { hour, minute };
};

const atClockTime = (meal, parsedClockTime) => {
  if (!parsedClockTime) return true;
  const loggedAt = new Date(meal.loggedAt);
  // Exact minute matching is intentional because the candidate prompt shows
  // minute-level timestamps to the user.
  return loggedAt.getHours() === parsedClockTime.hour
    && loggedAt.getMinutes() === parsedClockTime.minute;
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
    const normalizedMealType = normalizeMealType(mealType);
    const loggedAtDate = asDate(loggedAt);
    const rawText = rawUtterance || "";
    const fingerprint = mealFingerprint({
      mealType: normalizedMealType,
      rawUtterance: rawText,
      items: resolvedItems
    });
    const recentMeals = rawText.trim() ? await this.repository.list(this.userId(userId)) : [];
    const duplicate = recentMeals.find((meal) => {
      const ageMs = Math.abs(loggedAtDate.getTime() - new Date(meal.loggedAt).getTime());
      return ageMs <= duplicateWindowMs && mealFingerprint(meal) === fingerprint;
    });
    if (duplicate) return duplicate;

    return this.repository.create({
      userId: this.userId(userId),
      mealType: normalizedMealType,
      loggedAt: loggedAtDate,
      rawUtterance: rawText,
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

  async findRecent({ userId, dish, mealType, timeOfDay, clockTime, allowAmbiguousLatest = true }) {
    const food = dish ? this.foodResolver.resolveFood(dish) : null;
    const meals = await this.repository.list(this.userId(userId));
    const parsedClockTime = parseClockTime(clockTime);
    const matches = [];

    // Repositories return newest-first, so the first match means "the latest one".
    for (const meal of meals) {
      if (mealType && meal.mealType !== normalizeMealType(mealType)) continue;
      if (!inTimeOfDay(meal, timeOfDay)) continue;
      if (!atClockTime(meal, parsedClockTime)) continue;
      const item = food
        ? meal.items.find((candidate) => candidate.foodId === food.id)
        : meal.items[0];
      if (!item) continue;
      matches.push({ meal, item });
    }

    if (!matches.length) {
      throw new ApiError(404, "meal_match_not_found", "No matching meal entry was found.");
    }
    if (!allowAmbiguousLatest && matches.length > 1) {
      // Send back human-distinguishable candidates instead of guessing which
      // same-day item the user meant.
      throw new ApiError(409, "meal_match_ambiguous", "Multiple matching meal entries were found.", {
        candidates: matches.slice(0, 3).map(({ meal, item }) => ({
          mealId: meal._id,
          itemId: item._id,
          mealType: meal.mealType,
          loggedAt: meal.loggedAt,
          item: {
            foodName: item.foodName,
            quantity: item.quantity,
            unit: item.unit
          }
        }))
      });
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
