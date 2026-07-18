import dotenv from "dotenv";
import mongoose from "mongoose";
import { createApp } from "./app.js";

dotenv.config();

const port = process.env.PORT || 4000;
const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/beet_voice_logging";

// The server process uses MongoDB; tests inject an in-memory repository instead.
await mongoose.connect(mongoUri);

const app = createApp();
app.listen(port, () => {
  console.log(`Beet backend listening on http://localhost:${port}`);
});
