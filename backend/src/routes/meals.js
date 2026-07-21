import express from "express";

export const createMealsRouter = ({ mealService }) => {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      const meals = await mealService.listMeals(req.query.userId);
      res.json({ meals });
    } catch (error) {
      next(error);
    }
  });

  router.get("/find", async (req, res, next) => {
    try {
      // Agent edit/delete commands use this lookup before mutating a concrete item.
      const match = await mealService.findRecent({
        userId: req.query.userId,
        dish: req.query.dish,
        mealType: req.query.mealType,
        timeOfDay: req.query.timeOfDay,
        clockTime: req.query.clockTime,
        allowAmbiguousLatest: req.query.allowAmbiguousLatest === "true"
      });
      res.json({ match });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      // Create accepts raw voice text plus structured items extracted by the agent.
      const meal = await mealService.createMeal(req.body);
      res.status(201).json({ meal });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const meal = await mealService.updateMeal({
        id: req.params.id,
        ...req.body
      });
      res.json({ meal });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:mealId/items/:itemId", async (req, res, next) => {
    try {
      // Tools resolve ambiguity first, then mutate a concrete meal item id.
      const meal = await mealService.updateItem({
        mealId: req.params.mealId,
        itemId: req.params.itemId,
        ...req.body
      });
      res.json({ meal });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:mealId/items", async (req, res, next) => {
    try {
      // Correction flows can add omitted foods to the same meal event instead
      // of creating a second breakfast/lunch card.
      const meal = await mealService.addItems({
        mealId: req.params.mealId,
        ...req.body
      });
      res.status(201).json({ meal });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const meal = await mealService.deleteMeal({ id: req.params.id, userId: req.query.userId });
      res.json({ meal });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:mealId/items/:itemId", async (req, res, next) => {
    try {
      // Item delete may soft-delete the whole meal when the last item is removed.
      const meal = await mealService.deleteItem({
        mealId: req.params.mealId,
        itemId: req.params.itemId,
        userId: req.query.userId
      });
      res.json({ meal });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
