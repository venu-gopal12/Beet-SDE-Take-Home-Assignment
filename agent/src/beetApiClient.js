const missingValues = new Set(["", "none", "null", "undefined", "unknown", "n/a"]);

// Tool-facing error wrapper that preserves backend error codes for prompts.
export class BeetApiError extends Error {
  constructor(message, code = "api_error", details = {}) {
    super(message);
    this.name = "BeetApiError";
    this.code = code;
    this.details = details;
  }
}

export const cleanOptional = (value) => {
  // The LLM may send placeholder strings for optional filters; strip them so
  // they do not accidentally narrow backend searches.
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const stripped = value.trim();
    return missingValues.has(stripped.toLowerCase()) ? null : stripped;
  }
  return value;
};

export class BeetApiClient {
  constructor({ baseUrl = process.env.BEET_API_BASE_URL || "http://localhost:4000", userId = process.env.BEET_USER_ID || "venugopal" } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.userId = userId;
  }

  async request(method, path, { json, params, signal } = {}) {
    // Centralize fetch handling so every tool gets consistent error formatting.
    const url = new URL(path, `${this.baseUrl}/`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url, {
      method,
      signal,
      headers: json ? { "content-type": "application/json" } : undefined,
      body: json ? JSON.stringify(json) : undefined,
    });

    const payload = await response.json();
    if (!response.ok) {
      const error = payload.error || {};
      throw new BeetApiError(
        error.message || "Backend request failed.",
        error.code || "api_error",
        error.details || {},
      );
    }
    return payload;
  }

  async foods(options = {}) {
    const payload = await this.request("GET", "/api/foods", options);
    return payload.foods;
  }

  async logMeal({ mealType, items, rawUtterance = "" }, options = {}) {
    const payload = await this.request("POST", "/api/meals", {
      ...options,
      json: {
        userId: this.userId,
        mealType,
        items,
        rawUtterance,
      },
    });
    return payload.meal;
  }

  async findRecent({ dish, mealType, timeOfDay, clockTime, allowAmbiguousLatest = false }, options = {}) {
    const cleanMealType = cleanOptional(mealType);
    const cleanTimeOfDay = cleanOptional(timeOfDay);
    const cleanClockTime = cleanOptional(clockTime);
    const payload = await this.request("GET", "/api/meals/find", {
      ...options,
      params: {
        userId: this.userId,
        dish,
        mealType: cleanMealType,
        timeOfDay: cleanTimeOfDay,
        clockTime: cleanClockTime,
        allowAmbiguousLatest,
      },
    });
    return payload.match;
  }

  async editRecentItem({ dish, quantity, unit, mealType, timeOfDay, clockTime, allowAmbiguousLatest }, options = {}) {
    const match = await this.findRecent({ dish, mealType, timeOfDay, clockTime, allowAmbiguousLatest }, options);
    if (!match) {
      throw new BeetApiError(
        `I could not find a recent ${dish} entry to update.`,
        "meal_match_not_found",
      );
    }
    const cleanUnit = cleanOptional(unit);
    const body = { userId: this.userId };
    if (quantity !== null && quantity !== undefined) body.quantity = quantity;
    if (cleanUnit) body.unit = cleanUnit;

    const payload = await this.request("PATCH", `/api/meals/${match.mealId}/items/${match.itemId}`, {
      ...options,
      json: body,
    });
    return payload.meal;
  }

  async deleteRecentItem({ dish, mealType, timeOfDay, clockTime, allowAmbiguousLatest }, options = {}) {
    const match = await this.findRecent({ dish, mealType, timeOfDay, clockTime, allowAmbiguousLatest }, options);
    if (!match) {
      throw new BeetApiError(
        `I could not find a recent ${dish} entry to remove.`,
        "meal_match_not_found",
      );
    }
    const payload = await this.request("DELETE", `/api/meals/${match.mealId}/items/${match.itemId}`, {
      ...options,
      params: { userId: this.userId },
    });
    return payload.meal;
  }

  async deleteLatestMeal(options = {}) {
    // Undo works at the meal-event level, matching the event-log storage model.
    const listed = await this.request("GET", "/api/meals", {
      ...options,
      params: { userId: this.userId },
    });
    const meal = listed.meals?.[0];
    if (!meal) {
      throw new BeetApiError("There is no recent meal entry to undo.", "meal_match_not_found");
    }

    const payload = await this.request("DELETE", `/api/meals/${meal._id}`, {
      ...options,
      params: { userId: this.userId },
    });
    return payload.meal;
  }
}

export const summarizeMeal = (meal) => {
  const items = (meal.items || [])
    .map((item) => `${item.quantity} ${item.unit} ${item.foodName}`)
    .join(", ");
  const totals = meal.totals || {};
  return `${items}. Total: ${totals.calories || 0} calories, ${totals.protein || 0}g protein, ${totals.carbs || 0}g carbs, ${totals.fat || 0}g fat.`;
};

const formatLoggedAt = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return ` at ${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)}`;
};

export const formatApiError = (error) => {
  const suggestions = error.details?.suggestions || [];
  if (suggestions.length) {
    const names = suggestions.map((item) => item.name).join(", ");
    return `I could not log that because it is not in the food database. Closest options are: ${names}.`;
  }
  const candidates = error.details?.candidates || [];
  if (error.code === "meal_match_ambiguous" && candidates.length) {
    // Include timestamps because meal type alone cannot distinguish two lunch
    // roti entries on the same day.
    const labels = candidates
      .map((candidate) => `${candidate.item.quantity} ${candidate.item.unit} ${candidate.item.foodName} from ${candidate.mealType}${formatLoggedAt(candidate.loggedAt)}`)
      .join("; ");
    return `I found multiple matching entries: ${labels}. Please tell me which one to change or remove.`;
  }
  if (error.code === "meal_match_not_found") {
    return error.message;
  }
  return error.message;
};
