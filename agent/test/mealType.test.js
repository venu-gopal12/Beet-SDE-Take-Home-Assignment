import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldAskForMealType } from "../src/mealType.js";

describe("shouldAskForMealType", () => {
  it("asks when a new log has no explicit meal type", () => {
    assert.equal(shouldAskForMealType({
      mealType: "unknown",
      rawUtterance: "I had two rotis",
    }), true);
  });

  it("does not ask when the meal type is known", () => {
    assert.equal(shouldAskForMealType({
      mealType: "lunch",
      rawUtterance: "I had two rotis for lunch",
    }), false);
  });

  it("allows unknown when the user explicitly declines to specify", () => {
    assert.equal(shouldAskForMealType({
      mealType: "unknown",
      rawUtterance: "I am not sure which meal this was",
    }), false);
  });
});
