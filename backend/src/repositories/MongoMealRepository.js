import { Meal } from "../models/Meal.js";

// Production repository. It hides Mongoose details behind the same interface
// used by the in-memory test repository.
export class MongoMealRepository {
  async create(payload) {
    const meal = await Meal.create(payload);
    return meal.toObject();
  }

  async getById(id, userId) {
    const meal = await Meal.findOne({ _id: id, userId, deletedAt: null });
    return meal?.toObject() ?? null;
  }

  async list(userId, { includeDeleted = false } = {}) {
    const query = { userId };
    if (!includeDeleted) query.deletedAt = null;
    // Newest-first ordering powers "make that three rotis" style edits.
    return Meal.find(query).sort({ loggedAt: -1, createdAt: -1 }).lean();
  }

  async save(meal) {
    // runValidators keeps edits honest even when they come through partial item
    // updates rather than direct model creation.
    const updated = await Meal.findOneAndUpdate(
      { _id: meal._id, userId: meal.userId },
      meal,
      { new: true, runValidators: true }
    ).lean();
    return updated;
  }
}
