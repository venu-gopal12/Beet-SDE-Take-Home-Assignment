# Beet Voice Meal Logging

An end-to-end voice meal logging assignment built with the MERN stack and LiveKit Agents. A reviewer can open the React frontend, start a browser voice session, speak meal changes, and see persisted meal logs update from the backend.

The assistant logs, edits, removes, and undoes meal entries by calling backend tools. Nutrition is never invented by the agent; every food, unit, gram conversion, and macro value comes from `data/foods.json`.

## Reviewer Links

- Frontend: `https://beet-sde-take-home-assignment.vercel.app/`
- Backend: `https://beet-backend.onrender.com`
- Backend health check: `https://beet-backend.onrender.com/health`
- Backend foods API: `https://beet-backend.onrender.com/api/foods`
- LiveKit Cloud agent: `beet-meal-agent`
- LiveKit project subdomain: `beethealth-xyxg7jwd`
- LiveKit agent id: `CA_ctHWwhUdrUe3`

## Architecture

- `frontend/` - Vite + React app. It starts a LiveKit browser microphone session and polls the meal API.
- `backend/` - Express API with MongoDB/Mongoose persistence, food validation, macro calculation, and LiveKit token creation.
- `agent/` - LiveKit Agents Node.js worker. It listens to the user, extracts intent, and calls backend-backed tools.
- `data/foods.json` - closed food database with 30 supported foods.

Runtime flow:

1. The user opens the frontend and clicks `Start voice`.
2. The frontend calls `POST /api/livekit/session`.
3. The backend creates a short-lived LiveKit room token and dispatches `beet-meal-agent`.
4. The agent hears the user's meal request and calls a backend tool.
5. The backend validates the food against `foods.json`, computes macros, and persists the meal in MongoDB.
6. The frontend polls `GET /api/meals` and shows the latest active entries.

## Deployment

The project is deployed as three separate surfaces:

- Frontend: static React build, hosted separately from the API.
- Backend: Node/Express service connected to MongoDB Atlas or another MongoDB instance.
- Agent: LiveKit Cloud Node.js agent worker. LiveKit Cloud builds this worker from `agent/Dockerfile` during agent deploy.

Docker is not required for the Vercel frontend or Render backend deployment in this project. The root `docker-compose.yml` is only a local-development convenience for starting MongoDB, while `agent/Dockerfile` is kept because LiveKit Cloud agent deployment expects a Dockerfile-backed build.

Frontend environment:

```env
VITE_API_BASE_URL=https://beet-backend.onrender.com
VITE_DEMO_USER_ID=venugopal
```

Backend environment:

```env
MONGO_URI=mongodb+srv://...
CORS_ORIGIN=https://beet-sde-take-home-assignment.vercel.app
DEMO_USER_ID=venugopal
NODE_ENV=production
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=beet-meal-agent
```

Agent environment:

```env
BEET_API_BASE_URL=https://beet-backend.onrender.com
BEET_USER_ID=venugopal
```

LiveKit Cloud injects its own LiveKit credentials for the deployed agent. The agent deployment config is in `agent/livekit.toml`.

Deploy agent:

```bash
cd agent
lk agent deploy .
```

## CI/CD

GitHub Actions workflows are included in `.github/workflows`.

`ci.yml` runs on every pull request and every push to `main`:

- Backend: installs dependencies and runs `npm test`.
- Agent: installs dependencies and runs `npm test`.
- Frontend: installs dependencies and runs `npm run build`.

`deploy.yml` runs after CI succeeds on `main`, and can also be started manually from the GitHub Actions tab:

- Frontend deploy: builds `frontend/` and deploys to Vercel when Vercel secrets are present.
- Backend deploy: triggers a hosting-provider deploy hook, such as Render/Railway/Fly, when `BACKEND_DEPLOY_HOOK_URL` is present.
- Agent deploy: deploys `agent/` to LiveKit Cloud using the official `livekit/deploy-action@v2.12.1`.

Required GitHub secrets for deployment:

```text
VITE_API_BASE_URL=https://beet-backend.onrender.com
VERCEL_TOKEN=...
VERCEL_ORG_ID=...
VERCEL_PROJECT_ID=...
BACKEND_DEPLOY_HOOK_URL=https://your-backend-provider-deploy-hook
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_SECRET_LIST=BEET_API_BASE_URL=https://beet-backend.onrender.com,BEET_USER_ID=venugopal
```

If a deploy secret is missing, that deploy job prints a skip message instead of failing. This lets CI run cleanly before all production credentials are connected.

## How Logging Works

For a new meal, the user says something like:

```text
I had two rotis and one katori of dal for lunch.
```

The agent calls `log_meal` with structured items:

```json
{
  "mealType": "lunch",
  "rawUtterance": "I had two rotis and one katori of dal for lunch.",
  "items": [
    { "dish": "roti", "quantity": 2 },
    { "dish": "dal", "quantity": 1, "unit": "katori" }
  ]
}
```

The backend resolves `roti` and `dal` against the closed food database, applies default units when needed, calculates grams and macros, and stores a resolved snapshot.

Meal type is mandatory in the conversation. If the user says:

```text
I had dal.
```

The agent asks:

```text
Which meal was that - breakfast, lunch, dinner, or snack?
```

The agent does not infer meal type from the current time. `unknown` is used only if the user explicitly says they are not sure or declines to specify.

## Logging Design

Meals are stored as an event log: one document per logging event, not one merged document per meal type per day.

Example:

```text
1:15 PM - one roti for lunch
1:45 PM - two rotis for lunch
```

These stay as two lunch entries. This is intentional because real users often remember food in pieces: they log part of lunch, then add another item or second serving later.

Why this design:

- It preserves what the user actually said and when they said it.
- It avoids complex merge rules like "is this a new roti or an edit to the old roti?"
- It keeps undo simple because the latest logging event can be removed.
- It makes audit/history behavior clearer.
- It still supports precise edit/delete through meal type, time of day, and clock-time clarification.

The backend also deduplicates identical voice retry creates inside a short 10-second window, so accidental repeated tool calls do not create duplicate logs.

## How Edit Works

Immediate corrections target the latest matching item:

```text
I had two rotis for lunch.
Actually make that three rotis.
```

The agent calls `edit_meal_item` with `allow_latest_match=true`, so the most recent roti is updated instead of creating a new meal.

Generic edits ask for clarification if there are multiple matches:

```text
I had one roti for lunch.
I had two rotis for dinner.
Change roti to three.
```

The backend returns multiple candidates, and the agent asks which one to edit using meal type and timestamp:

```text
I found multiple matching entries: 1 piece Roti from lunch at 19 Jul 2026, 1:15 PM; 2 piece Roti from dinner at 19 Jul 2026, 8:20 PM. Please tell me which one to change or remove.
```

If there are multiple lunch rotis on the same day, the timestamp is the tie-breaker:

```text
Change roti to three.
The 1:45 one.
```

The agent calls the edit tool again with `clock_time`, and the backend edits the matching timestamped entry.

## How Remove Works

Immediate remove/undo commands use the latest entry:

```text
I had one katori dal for lunch.
Remove the dal I just added.
```

Generic remove commands ask for clarification when needed:

```text
I had chai for breakfast.
I had chai as snack.
Remove chai.
```

The agent asks whether to remove the breakfast chai or snack chai. If the user replies with the meal type or timestamp, the agent passes those filters to `delete_meal_item`.

If deleting the item leaves a meal with no items, the backend soft-deletes the whole meal. Soft delete keeps an audit trail while hiding the entry from active logs.

## Supported Foods

The closed food database contains these 30 foods:

1. Roti
2. Dal Tadka
3. Cooked Rice
4. Paneer Bhurji
5. Rajma
6. Chole
7. Idli
8. Dosa
9. Poha
10. Upma
11. Chai
12. Curd
13. Banana
14. Apple
15. Boiled Egg
16. Omelette
17. Chicken Curry
18. Fish Curry
19. Sambar
20. Paratha
21. Aloo Sabzi
22. Mixed Veg
23. Khichdi
24. Sprouts
25. Salad
26. Lassi
27. Milk
28. Oats
29. Biryani
30. Pulao

Unsupported foods fail closed with suggestions. For example, "I had pizza for dinner" is rejected because pizza is not in `foods.json`.

## API Shape

- `GET /health` - backend health check
- `GET /api/foods` - list supported foods
- `GET /api/meals` - list active meal logs
- `GET /api/meals/find?dish=roti&mealType=lunch&clockTime=13:45` - find a matching item for edit/delete
- `POST /api/livekit/session` - create a LiveKit room token and dispatch the agent
- `POST /api/meals` - create a meal log
- `POST /api/meals/:mealId/items` - add omitted correction items to an existing meal log
- `PATCH /api/meals/:mealId/items/:itemId` - edit a logged item
- `DELETE /api/meals/:mealId/items/:itemId` - delete a logged item
- `DELETE /api/meals/:mealId` - soft-delete a whole meal

## Manual Test Scenarios

Use these in a LiveKit voice session:

1. "I had two rotis for lunch." Expected: logs lunch.
2. "I had dal." Expected: asks which meal type.
3. "I had one katori of dal and two rotis for dinner." Expected: logs both items.
4. "Actually make that three rotis." Expected: edits the latest roti.
5. "I had one roti for lunch." Then "I had two rotis for lunch." Then "Change roti to three." Expected: asks which lunch roti by timestamp.
6. Reply "the 1:45 one." Expected: edits the timestamped entry.
7. "Remove chai." after multiple chai entries. Expected: asks which one.
8. "Remove the dal I just added." Expected: removes the latest dal.
9. "I had pizza for dinner." Expected: rejects unsupported food.
10. "I had one cup of rice for breakfast." Then "Actually two cups of rice and dal." Expected: updates rice to two cups and adds dal to the same breakfast entry, not a second entry.

## Run Locally

Prerequisites for an empty machine:

- Node.js 24 and npm.
- MongoDB, either from Docker Compose, a local MongoDB install, or MongoDB Atlas.
- LiveKit Cloud project credentials if you want to test the browser voice flow locally.

Start MongoDB:

```bash
docker compose up -d
```

If you use MongoDB Atlas instead of Docker, put that connection string in `backend/.env` as `MONGO_URI`.

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
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Tests

```bash
cd backend
npm test

cd agent
npm test
```

Backend tests cover food/unit validation, macro calculation, create/list/edit/delete API flows, duplicate voice-retry protection, ambiguous match handling, exact clock-time disambiguation, missing entries, and malformed Mongo-style IDs.

Agent tests cover backend request formatting, optional argument cleanup, mandatory meal-type prompting, unsupported-food errors, timestamped ambiguity messages, and text cleanup for LiveKit TTS.

## Assignment Coverage

- Voice assistant with LiveKit Agents for Node.js.
- Browser microphone flow using LiveKit.
- Real Express backend with MongoDB persistence.
- React frontend that shows persisted meal history.
- Closed food database with 30 supported items.
- Backend-owned nutrition calculation.
- Logging, editing, removing, and undo behavior.
- Ambiguity handling for multiple same-day meal entries.
- Tests for backend and agent behavior.

## Incomplete or Future Improvements

The core assignment flow is complete: the deployed app supports voice logging, editing, deleting, persistent storage, and frontend reflection. The main things I would improve with more time are:

- Add real authentication and user accounts instead of the fixed demo user id.
- Add frontend controls for date filtering and manual review of older logs.
- Add browser-level end-to-end tests around the LiveKit session UI. The current automated tests focus on backend behavior and agent tool behavior.
- Improve the edit/delete confirmation UX for very old entries, for example by showing the candidate choices directly in the frontend.
- Expand the food database and add nutritionist-owned food-plan constraints. This submission intentionally keeps nutrition closed to the provided 30-item `foods.json`.
