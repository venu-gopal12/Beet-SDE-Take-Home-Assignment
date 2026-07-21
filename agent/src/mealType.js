const mealTypeDeclineWords = /\b(not sure|unsure|don't know|do not know|no idea|unknown|skip|doesn't matter|does not matter)\b/i;

export const shouldAskForMealType = ({ mealType, rawUtterance = "" }) =>
  mealType === "unknown" && !mealTypeDeclineWords.test(rawUtterance);
