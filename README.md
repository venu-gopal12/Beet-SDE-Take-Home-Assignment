# Beet Voice Meal Logging

A small end-to-end slice of Beet's voice meal logging flow: a LiveKit voice agent logs, edits, and deletes meals through an Express API, while a React page shows the persisted meal history.

## Architecture

- `backend/` - Express, MongoDB/Mongoose, food resolver, meal APIs, tests
- `frontend/` - Vite + React single page that polls the API
- `agent/` - LiveKit Agents Python worker using LiveKit Inference and backend-backed tools
- `data/foods.json` - closed food database used for all nutrition data

The agent does not calculate nutrition. It extracts intent from speech and calls API tools. The backend validates dishes and units against `foods.json`, computes grams and macros, and persists resolved snapshots in MongoDB.

## Run Locally

Start MongoDB first. If you do not already have MongoDB running locally:

```bash
docker compose up -d
```

Backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Agent:

```bash
cd agent
python -m venv .venv
pip install -r requirements.txt
cp .env.example .env
python agent.py dev
```

With the LiveKit CLI installed, you can also run the same agent in development mode with:

```bash
lk agent dev
```

The backend expects MongoDB at `MONGO_URI`. The agent expects LiveKit Cloud credentials in `agent/.env`; speech-to-text, the LLM, and text-to-speech run through LiveKit Inference, so no separate OpenAI or Deepgram keys are required.

Open the frontend at:

```text
http://localhost:5173
```

Talk to the agent from a LiveKit room or the LiveKit Agents Playground using the same LiveKit project credentials.

## API Shape

The agent uses these backend endpoints:

- `GET /api/foods` - list the closed food database
- `GET /api/meals` - list active meal logs
- `GET /api/meals/find?dish=chai&mealType=breakfast&timeOfDay=morning` - find the most recent matching item
- `POST /api/meals` - log a new meal
- `PATCH /api/meals/:mealId/items/:itemId` - edit a logged item
- `DELETE /api/meals/:mealId/items/:itemId` - delete one item, or soft-delete the meal if it was the last item
- `DELETE /api/meals/:mealId` - soft-delete a whole meal

Example log request:

```json
{
  "mealType": "lunch",
  "rawUtterance": "I had two rotis and a katori of dal for lunch.",
  "items": [
    { "dish": "roti", "quantity": 2 },
    { "dish": "dal", "quantity": 1, "unit": "katori" }
  ]
}
```

## Manual Voice Test Script

Use these utterances in a LiveKit session and watch the React page update:

1. "I had two rotis and a katori of dal for lunch."
2. "Actually make that three rotis."
3. "Remove the dal from lunch."
4. "I had pizza." The assistant should reject it because pizza is not in `foods.json`.
5. "Remove the chai I logged this morning." If there is no matching chai entry, the assistant should say it could not find one.

## Test

```bash
cd backend && npm test
cd agent && pytest
```

Backend tests use an in-memory repository, so they do not need a running MongoDB. Agent tool tests mock HTTP calls and do not need a LiveKit room.

## Design Notes

- `data/foods.json` is the source of truth for every supported dish, unit, gram conversion, and macro value.
- Meals are stored as resolved snapshots. If food data changes later, old logs do not silently change.
- Unsupported dishes fail closed with suggestions instead of being guessed.
- Edit/delete by speech is resolved as "most recent matching active item", optionally narrowed by meal type or time of day.
- The voice pipeline uses LiveKit Inference model descriptors for STT, LLM, and TTS to keep local setup limited to LiveKit Cloud credentials.
- The frontend polls every four seconds. For a production product, this would likely become a websocket or server-sent event stream.

## Assignment Coverage Checklist

- Voice assistant: implemented with LiveKit Agents in `agent/agent.py`.
- Log meal: `log_meal` tool calls `POST /api/meals`.
- Edit entry: `edit_meal_item` finds the latest matching item and patches it.
- Delete entry: `delete_meal_item` finds the latest matching item and deletes it.
- Real backend: Express API in `backend/src`.
- Persistence: MongoDB via Mongoose, with `docker-compose.yml` for local MongoDB.
- Frontend: single React page at `frontend/src/main.jsx`.
- Food database constraint: backend resolver only accepts dishes and units from `data/foods.json`.
- MERN stack: MongoDB, Express, React, Node.
- Testing: backend unit/integration tests plus mocked agent tool tests.
