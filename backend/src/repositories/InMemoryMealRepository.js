import crypto from "node:crypto";

const clone = (value) => JSON.parse(JSON.stringify(value));

export class InMemoryMealRepository {
  constructor() {
    this.meals = new Map();
  }

  async create(payload) {
    const now = new Date().toISOString();
    // Mirror Mongo's generated ids closely enough for full-route tests.
    const meal = {
      ...clone(payload),
      _id: crypto.randomUUID(),
      items: payload.items.map((item) => ({ ...clone(item), _id: crypto.randomUUID() })),
      createdAt: now,
      updatedAt: now
    };
    this.meals.set(meal._id, meal);
    return clone(meal);
  }

  async getById(id, userId) {
    const meal = this.meals.get(id);
    if (!meal || meal.userId !== userId || meal.deletedAt) return null;
    return clone(meal);
  }

  async list(userId, { includeDeleted = false } = {}) {
    return [...this.meals.values()]
      .filter((meal) => meal.userId === userId && (includeDeleted || !meal.deletedAt))
      .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime())
      .map(clone);
  }

  async save(meal) {
    const next = {
      ...clone(meal),
      updatedAt: new Date().toISOString()
    };
    this.meals.set(String(next._id), next);
    return clone(next);
  }
}
