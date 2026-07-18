import json

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, RunContext, function_tool
from livekit.plugins import silero

from beet_tools import BeetApiClient, BeetApiError, format_api_error, summarize_meal

load_dotenv()


INSTRUCTIONS = """
You are Beet's meal logging assistant.

The user can only log foods that exist in Beet's backend food database. Never invent
nutrition and never claim an unsupported dish was logged. Use the tools for every
log, edit, delete, and food lookup.

Supported tasks:
- Log a meal from natural speech.
- Edit the most recent matching food item, such as "make that three rotis".
- Delete the most recent matching food item, such as "remove the chai I logged this morning".

For quantities, pass numbers such as 2, 1.5, or 0.5. If the user gives no unit for a
countable dish such as roti, pass no unit and let the backend choose the default.
Meal type must be one of breakfast, lunch, dinner, snack, or unknown.

If a backend tool returns a dish-not-found or match-not-found message, explain it
briefly and ask the user to choose a supported food or clarify the entry.
"""


class BeetMealAgent(Agent):
    def __init__(self):
        super().__init__(instructions=INSTRUCTIONS)
        self.api = BeetApiClient()

    @function_tool()
    async def find_foods(self, context: RunContext, query: str = "") -> str:
        """Look up the allowed Beet foods and units. Use before logging an uncertain dish."""
        try:
            foods = await self.api.foods()
        except BeetApiError as error:
            return format_api_error(error)

        if query:
            normalized = query.lower()
            foods = [
                food
                for food in foods
                if normalized in food["name"].lower()
                or any(normalized in alias.lower() for alias in food.get("aliases", []))
            ]
        preview = [
            {
                "name": food["name"],
                "aliases": food.get("aliases", []),
                "units": [unit["name"] for unit in food.get("units", [])],
            }
            for food in foods[:12]
        ]
        return json.dumps(preview)

    @function_tool()
    async def log_meal(self, context: RunContext, meal_type: str, items_json: str, raw_utterance: str = "") -> str:
        """Log a meal. items_json must be a JSON array of {dish, quantity, unit?} objects."""
        try:
            items = json.loads(items_json)
            meal = await self.api.log_meal(meal_type=meal_type, items=items, raw_utterance=raw_utterance)
            return f"Logged {summarize_meal(meal)}"
        except (BeetApiError, json.JSONDecodeError) as error:
            return format_api_error(error) if isinstance(error, BeetApiError) else "I could not read those meal items."

    @function_tool()
    async def edit_meal_item(
        self,
        context: RunContext,
        dish: str,
        quantity: float | None = None,
        unit: str | None = None,
        meal_type: str | None = None,
        time_of_day: str | None = None,
    ) -> str:
        """Edit the most recent matching food item."""
        try:
            meal = await self.api.edit_recent_item(
                dish=dish,
                quantity=quantity,
                unit=unit,
                meal_type=meal_type,
                time_of_day=time_of_day,
            )
            return f"Updated it to {summarize_meal(meal)}"
        except BeetApiError as error:
            return format_api_error(error)

    @function_tool()
    async def delete_meal_item(
        self,
        context: RunContext,
        dish: str,
        meal_type: str | None = None,
        time_of_day: str | None = None,
    ) -> str:
        """Delete the most recent matching food item."""
        try:
            await self.api.delete_recent_item(dish=dish, meal_type=meal_type, time_of_day=time_of_day)
            return f"Removed the most recent {dish} entry."
        except BeetApiError as error:
            return format_api_error(error)


server = AgentServer()


@server.rtc_session(agent_name="beet-meal-agent")
async def entrypoint(ctx: agents.JobContext):
    # LiveKit handles the voice pipeline; durable meal changes happen in tools.
    session = AgentSession(
        stt="deepgram/nova-3:en",
        llm="google/gemma-4-31b-it",
        tts="cartesia/sonic-3",
        vad=silero.VAD.load(),
    )

    await session.start(agent=BeetMealAgent(), room=ctx.room)
    await session.generate_reply(
        instructions="Greet the user briefly and ask what meal they would like to log."
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
