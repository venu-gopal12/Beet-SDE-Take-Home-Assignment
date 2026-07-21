import mongoose from "mongoose";

const macroSchema = new mongoose.Schema(
  {
    calories: { type: Number, required: true },
    protein: { type: Number, required: true },
    carbs: { type: Number, required: true },
    fat: { type: Number, required: true }
  },
  { _id: false }
);

const mealItemSchema = new mongoose.Schema(
  {
    // Items store resolved food snapshots; reads do not depend on foods.json.
    foodId: { type: String, required: true },
    foodName: { type: String, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
    grams: { type: Number, required: true },
    macros: { type: macroSchema, required: true }
  },
  { timestamps: false }
);

const mealSchema = new mongoose.Schema(
  {
    // Demo user id keeps the take-home focused on meal flow, not auth.
    userId: { type: String, required: true, index: true },
    mealType: {
      type: String,
      enum: ["breakfast", "lunch", "dinner", "snack", "unknown"],
      default: "unknown",
      index: true
    },
    loggedAt: { type: Date, default: Date.now, index: true },
    rawUtterance: { type: String, default: "" },
    // Resolved at log time from foods.json; reads do not re-compute history.
    items: { type: [mealItemSchema], required: true },
    totals: { type: macroSchema, required: true },
    // Soft delete preserves an audit trail and keeps deletes reversible later.
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

export const Meal = mongoose.model("Meal", mealSchema);
