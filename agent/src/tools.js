import { llm } from "@livekit/agents";
import { z } from "zod";
import { BeetApiClient, BeetApiError, formatApiError, summarizeMeal } from "./beetApiClient.js";
import { shouldAskForMealType } from "./mealType.js";

const api = new BeetApiClient();
const mutationWords = /\b(actually|make that|change it|update that|no i meant|then now|instead|undo|remove|delete|clear|take out)\b/i;

export const beetTools = [
  llm.tool({
    name: "find_foods",
    description: "Look up the allowed Beet foods and units. Use before logging an uncertain dish.",
    parameters: z.object({
      query: z.string().default("").describe("Optional food name or alias to search for."),
    }),
    execute: async ({ query }, { abortSignal }) => {
      try {
        let foods = await api.foods({ signal: abortSignal });
        if (query) {
          const normalized = query.toLowerCase();
          foods = foods.filter((food) =>
            food.name.toLowerCase().includes(normalized)
            || (food.aliases || []).some((alias) => alias.toLowerCase().includes(normalized))
          );
        }

        const preview = foods.slice(0, 12).map((food) => ({
          name: food.name,
          aliases: food.aliases || [],
          units: (food.units || []).map((unit) => unit.name),
        }));
        return JSON.stringify(preview);
      } catch (error) {
        return error instanceof BeetApiError ? formatApiError(error) : "I could not reach the food database.";
      }
    },
  }),

  llm.tool({
    name: "log_meal",
    description: "Log a meal. items_json must be a JSON array of {dish, quantity, unit?} objects. Household measures such as katori, bowl, cup, glass, plate, and piece are units; use quantity 1 for phrases like a katori of dal.",
    parameters: z.object({
      meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "unknown"]),
      items_json: z.string().describe("JSON array of meal items, each with dish, quantity, and optional unit."),
      raw_utterance: z.string().default("").describe("The user's original spoken meal description."),
    }),
    execute: async ({ meal_type: mealType, items_json: itemsJson, raw_utterance: rawUtterance }, { abortSignal }) => {
      try {
        if (mutationWords.test(rawUtterance)) {
          return "That sounds like a correction or delete request, not a new meal. I will not create a new meal from that.";
        }
        if (shouldAskForMealType({ mealType, rawUtterance })) {
          return "Which meal was that - breakfast, lunch, dinner, or snack?";
        }
        const items = JSON.parse(itemsJson);
        const meal = await api.logMeal({ mealType, items, rawUtterance }, { signal: abortSignal });
        return `Logged ${summarizeMeal(meal)}`;
      } catch (error) {
        if (error instanceof BeetApiError) return formatApiError(error);
        return "I could not read those meal items.";
      }
    },
  }),

  llm.tool({
    name: "edit_meal_item",
    description: "Edit the most recent matching food item.",
    parameters: z.object({
      dish: z.string().describe("The food item to edit."),
      quantity: z.number().nullable().default(null).describe("The new quantity, if the user changed it."),
      unit: z.string().nullable().default(null).describe("The new unit, if the user changed it."),
      meal_type: z.string().nullable().default(null).describe("Optional meal type filter such as breakfast, lunch, dinner, or snack."),
      time_of_day: z.string().nullable().default(null).describe("Optional time-of-day filter such as morning, afternoon, evening, or night."),
      clock_time: z.string().nullable().default(null).describe("Optional exact clock-time filter from a user clarification, such as 1:45 PM or 13:45."),
      allow_latest_match: z.boolean().default(false).describe("Use true only for immediate corrections such as actually/make that/undo that; otherwise false so ambiguous entries trigger clarification."),
    }),
    execute: async ({ dish, quantity, unit, meal_type: mealType, time_of_day: timeOfDay, clock_time: clockTime, allow_latest_match: allowLatestMatch }, { abortSignal }) => {
      try {
        const meal = await api.editRecentItem({ dish, quantity, unit, mealType, timeOfDay, clockTime, allowAmbiguousLatest: allowLatestMatch }, { signal: abortSignal });
        return `Updated it to ${summarizeMeal(meal)}`;
      } catch (error) {
        return error instanceof BeetApiError ? formatApiError(error) : "I could not update that meal item.";
      }
    },
  }),

  llm.tool({
    name: "delete_meal_item",
    description: "Delete the most recent matching food item.",
    parameters: z.object({
      dish: z.string().describe("The food item to delete."),
      meal_type: z.string().nullable().default(null).describe("Optional meal type filter such as breakfast, lunch, dinner, or snack."),
      time_of_day: z.string().nullable().default(null).describe("Optional time-of-day filter such as morning, afternoon, evening, or night."),
      clock_time: z.string().nullable().default(null).describe("Optional exact clock-time filter from a user clarification, such as 1:45 PM or 13:45."),
      allow_latest_match: z.boolean().default(false).describe("Use true only for immediate undo/last-item commands; otherwise false so ambiguous entries trigger clarification."),
    }),
    execute: async ({ dish, meal_type: mealType, time_of_day: timeOfDay, clock_time: clockTime, allow_latest_match: allowLatestMatch }, { abortSignal }) => {
      try {
        await api.deleteRecentItem({ dish, mealType, timeOfDay, clockTime, allowAmbiguousLatest: allowLatestMatch }, { signal: abortSignal });
        return `Removed the most recent ${dish} entry.`;
      } catch (error) {
        return error instanceof BeetApiError ? formatApiError(error) : "I could not remove that meal item.";
      }
    },
  }),

  llm.tool({
    name: "undo_last_entry",
    description: "Undo the most recent meal entry. Use for phrases like undo that, remove the last thing, or delete my last entry.",
    parameters: z.object({}),
    execute: async (input, { abortSignal }) => {
      try {
        const meal = await api.deleteLatestMeal({ signal: abortSignal });
        return `Undid the most recent entry: ${summarizeMeal(meal)}`;
      } catch (error) {
        return error instanceof BeetApiError ? formatApiError(error) : "I could not undo the last entry.";
      }
    },
  }),
];
