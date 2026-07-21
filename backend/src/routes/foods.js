import express from "express";

export const createFoodsRouter = ({ foodResolver }) => {
  const router = express.Router();

  router.get("/", (req, res) => {
    // Expose the closed food set so the agent can clarify supported dishes.
    res.json({ foods: foodResolver.listFoods() });
  });

  router.get("/search", (req, res, next) => {
    try {
      // Search uses the same resolver path as logging, so suggestions and
      // validation behave consistently.
      const food = foodResolver.resolveFood(req.query.q);
      res.json({ food });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
