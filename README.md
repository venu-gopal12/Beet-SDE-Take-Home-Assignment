# Beet Voice Meal Logging

A small end-to-end slice of Beet's voice meal logging flow: a React page starts a browser microphone session, a LiveKit voice agent logs, edits, and deletes meals through an Express API, and the page shows the persisted meal history.

## Architecture

- `backend/` - Express, MongoDB/Mongoose, food resolver, meal APIs, tests
- `frontend/` - Vite + React single page with a LiveKit browser microphone session and polling meal history
- `agent/` - LiveKit Agents Node.js worker using LiveKit Inference and backend-backed tools
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

Add your LiveKit Cloud credentials to `backend/.env` so the browser can request short-lived room tokens:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
LIVEKIT_AGENT_NAME=beet-meal-agent
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
cp .env.example .env
npm install
npm run dev
```

With the LiveKit CLI installed, you can also run the same agent in development mode with:

```bash
cd agent
lk agent dev
```

The backend expects MongoDB at `MONGO_URI` and LiveKit credentials for issuing browser session tokens. The agent also expects LiveKit Cloud credentials in `agent/.env`; speech-to-text, the LLM, and text-to-speech run through LiveKit Inference, so no separate OpenAI or Deepgram keys are required.

Open the frontend at:

```text
http://localhost:5173
```

Click "Start voice" on the page, allow microphone access, and speak to the assistant. The backend creates a LiveKit room token and explicitly dispatches `beet-meal-agent` into that room.

## API Shape

The agent uses these backend endpoints:

- `GET /api/foods` - list the closed food database
- `GET /api/meals` - list active meal logs
- `GET /api/meals/find?dish=chai&mealType=breakfast&timeOfDay=morning` - find the most recent matching item
- `POST /api/livekit/session` - create a browser LiveKit room token and dispatch the meal agent
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
cd agent && npm test
```

Backend tests use an in-memory repository, so they do not need a running MongoDB. They cover food/unit validation, macro calculation, create/list/edit/delete API flows, duplicate voice-retry protection, ambiguous match handling, missing entries, and malformed Mongo-style IDs.

Agent tool tests mock HTTP calls and do not need a LiveKit room. They cover backend request formatting, optional argument cleanup, unsupported-food errors, and ambiguous-match clarification text.

Manual voice flows tested against LiveKit:

1. Speak "I had two rotis and a katori of dal for lunch." The page should show one lunch log with both items and resolved macros.
2. Speak "Actually make that three rotis." The roti quantity should update instead of creating a new meal.
3. Speak "Remove the dal from lunch." The dal item should disappear and totals should recalculate.
4. Speak "I had pizza." The assistant should refuse it because it is outside `foods.json`.
5. Speak "Remove the chai I logged this morning." If there is no match, the assistant should say it could not find one.

For persistence, run the backend against MongoDB, log a meal, stop and restart the backend, then call `GET /api/meals` or refresh the frontend. The entry should still be present.

Known test scope cuts:

- The full browser microphone -> LiveKit -> agent -> backend -> frontend loop is validated manually rather than in CI, because it requires LiveKit Cloud credentials and real-time audio.
- Multi-intent utterances are intentionally narrow: the assistant handles one operation at a time and asks before continuing, rather than trying to silently execute several mutations from one sentence.
- This demo uses `DEMO_USER_ID=venugopal` and has no authentication. That is acceptable for the take-home demo, but a production version would add real users and authorization.
- The frontend polls every four seconds instead of using websockets/SSE, so updates are near-real-time rather than instant.

## Deployment

For a reviewer-usable deployment, run the three app surfaces separately:

1. Create a MongoDB Atlas cluster and use its connection string as `MONGO_URI`.
2. Deploy `backend/` to a Node host such as Render, Railway, or Fly.io.
3. Deploy `frontend/` to Vercel, Netlify, or another static host.
4. Deploy `agent/` as a LiveKit Node.js agent worker.

Backend environment:

```env
MONGO_URI=mongodb+srv://...
CORS_ORIGIN=https://your-frontend-url
DEMO_USER_ID=venugopal
NODE_ENV=production
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
LIVEKIT_AGENT_NAME=beet-meal-agent
```

Frontend environment:

```env
VITE_API_BASE_URL=https://your-backend-url
```

Agent environment for self-hosting:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
BEET_API_BASE_URL=https://your-backend-url
BEET_USER_ID=venugopal
```

Agent deployment to LiveKit Cloud:

```bash
cd agent
lk cloud auth
lk agent create --secrets BEET_API_BASE_URL=https://your-backend-url --secrets BEET_USER_ID=venugopal
```

When deploying the agent to LiveKit Cloud, LiveKit injects `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` automatically. Do not bake `.env` files into the agent Docker image.

## Design Notes

- `data/foods.json` is the source of truth for every supported dish, unit, gram conversion, and macro value.
- Meals are stored as resolved snapshots. If food data changes later, old logs do not silently change.
- Unsupported dishes fail closed with suggestions instead of being guessed.
- Edit/delete by speech asks for clarification when multiple matching entries exist, except for immediate correction/undo commands where the assistant intentionally targets the latest match.
- The frontend never receives the LiveKit API secret. It asks the backend for a short-lived participant token, then publishes microphone audio directly to LiveKit.
- The voice pipeline uses LiveKit Inference model descriptors for STT, LLM, and TTS to keep local setup limited to LiveKit Cloud credentials.
- The frontend polls every four seconds. For a production product, this would likely become a websocket or server-sent event stream.

## Assignment Coverage Checklist

- Voice assistant: implemented with LiveKit Agents for Node.js in `agent/src`.
- Log meal: `log_meal` tool calls `POST /api/meals`.
- Edit entry: `edit_meal_item` finds the latest matching item and patches it.
- Delete entry: `delete_meal_item` finds the latest matching item and deletes it.
- Real backend: Express API in `backend/src`.
- Persistence: MongoDB via Mongoose, with `docker-compose.yml` for local MongoDB.
- Frontend: single React page at `frontend/src/main.jsx`.
- Browser voice UI: frontend starts a LiveKit session and publishes microphone audio.
- Food database constraint: backend resolver only accepts dishes and units from `data/foods.json`.
- MERN stack: MongoDB, Express, React, Node.
- Testing: backend unit/integration tests plus mocked agent tool tests.
