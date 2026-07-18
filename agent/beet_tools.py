import os
from typing import Any

import httpx

MISSING_VALUES = {"", "none", "null", "undefined", "unknown", "n/a"}


def clean_optional(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return None if stripped.lower() in MISSING_VALUES else stripped
    return value


class BeetApiError(Exception):
    def __init__(self, message: str, code: str = "api_error", details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


class BeetApiClient:
    def __init__(self, base_url: str | None = None, user_id: str | None = None):
        self.base_url = (base_url or os.getenv("BEET_API_BASE_URL") or "http://localhost:4000").rstrip("/")
        self.user_id = user_id or os.getenv("BEET_USER_ID") or "demo-user"

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        # Keep HTTP details here so LiveKit tools can focus on voice intent.
        async with httpx.AsyncClient(base_url=self.base_url, timeout=10) as client:
            response = await client.request(method, path, **kwargs)
        if response.status_code >= 400:
            payload = response.json()
            error = payload.get("error", {})
            raise BeetApiError(
                error.get("message", "Backend request failed."),
                code=error.get("code", "api_error"),
                details=error.get("details", {}),
            )
        return response.json()

    async def foods(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/foods")
        return payload["foods"]

    async def log_meal(
        self,
        meal_type: str,
        items: list[dict[str, Any]],
        raw_utterance: str = "",
    ) -> dict[str, Any]:
        payload = await self._request(
            "POST",
            "/api/meals",
            json={
                "userId": self.user_id,
                "mealType": meal_type,
                "items": items,
                "rawUtterance": raw_utterance,
            },
        )
        return payload["meal"]

    async def find_recent(
        self,
        dish: str | None = None,
        meal_type: str | None = None,
        time_of_day: str | None = None,
    ) -> dict[str, Any]:
        params = {"userId": self.user_id}
        if dish:
            params["dish"] = dish
        clean_meal_type = clean_optional(meal_type)
        clean_time_of_day = clean_optional(time_of_day)
        if clean_meal_type:
            params["mealType"] = clean_meal_type
        if clean_time_of_day:
            params["timeOfDay"] = clean_time_of_day
        payload = await self._request("GET", "/api/meals/find", params=params)
        return payload["match"]

    async def edit_recent_item(
        self,
        dish: str,
        quantity: float | None = None,
        unit: str | None = None,
        meal_type: str | None = None,
        time_of_day: str | None = None,
    ) -> dict[str, Any]:
        # Natural edits identify an item by description before the precise PATCH.
        match = await self.find_recent(dish=dish, meal_type=meal_type, time_of_day=time_of_day)
        body: dict[str, Any] = {"userId": self.user_id}
        if quantity is not None:
            body["quantity"] = quantity
        clean_unit = clean_optional(unit)
        if clean_unit:
            body["unit"] = clean_unit
        payload = await self._request(
            "PATCH",
            f"/api/meals/{match['mealId']}/items/{match['itemId']}",
            json=body,
        )
        return payload["meal"]

    async def delete_recent_item(
        self,
        dish: str,
        meal_type: str | None = None,
        time_of_day: str | None = None,
    ) -> dict[str, Any]:
        # Deletes use the same newest matching item rule as edits.
        match = await self.find_recent(dish=dish, meal_type=meal_type, time_of_day=time_of_day)
        payload = await self._request(
            "DELETE",
            f"/api/meals/{match['mealId']}/items/{match['itemId']}",
            params={"userId": self.user_id},
        )
        return payload["meal"]


def summarize_meal(meal: dict[str, Any]) -> str:
    items = ", ".join(
        f"{item['quantity']} {item['unit']} {item['foodName']}" for item in meal.get("items", [])
    )
    totals = meal.get("totals", {})
    return (
        f"{items}. Total: {totals.get('calories', 0)} calories, "
        f"{totals.get('protein', 0)}g protein, {totals.get('carbs', 0)}g carbs, "
        f"{totals.get('fat', 0)}g fat."
    )


def format_api_error(error: BeetApiError) -> str:
    suggestions = error.details.get("suggestions") or []
    if suggestions:
        names = ", ".join(item["name"] for item in suggestions)
        return f"I could not log that because it is not in the food database. Closest options are: {names}."
    return str(error)
