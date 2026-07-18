import pytest
import respx
from httpx import Response

from beet_tools import BeetApiClient, BeetApiError, summarize_meal


@pytest.mark.asyncio
@respx.mock
async def test_log_meal_calls_backend():
    route = respx.post("http://test/api/meals").mock(
        return_value=Response(
            201,
            json={
                "meal": {
                    "_id": "meal-1",
                    "items": [{"foodName": "Roti", "quantity": 2, "unit": "piece"}],
                    "totals": {"calories": 237.6, "protein": 7, "carbs": 37.1, "fat": 5.9},
                }
            },
        )
    )

    client = BeetApiClient(base_url="http://test", user_id="demo-user")
    meal = await client.log_meal("lunch", [{"dish": "roti", "quantity": 2}], "two rotis")

    assert route.called
    assert meal["_id"] == "meal-1"
    assert "Roti" in summarize_meal(meal)


@pytest.mark.asyncio
@respx.mock
async def test_edit_recent_item_finds_then_patches():
    respx.get("http://test/api/meals/find").mock(
        return_value=Response(200, json={"match": {"mealId": "m1", "itemId": "i1"}})
    )
    patch_route = respx.patch("http://test/api/meals/m1/items/i1").mock(
        return_value=Response(
            200,
            json={
                "meal": {
                    "_id": "m1",
                    "items": [{"foodName": "Roti", "quantity": 3, "unit": "piece"}],
                    "totals": {"calories": 356.4, "protein": 10.4, "carbs": 55.7, "fat": 8.9},
                }
            },
        )
    )

    client = BeetApiClient(base_url="http://test", user_id="demo-user")
    meal = await client.edit_recent_item("roti", quantity=3)

    assert patch_route.called
    assert meal["items"][0]["quantity"] == 3


@pytest.mark.asyncio
@respx.mock
async def test_edit_recent_item_ignores_placeholder_optional_values():
    find_route = respx.get("http://test/api/meals/find").mock(
        return_value=Response(200, json={"match": {"mealId": "m1", "itemId": "i1"}})
    )
    patch_route = respx.patch("http://test/api/meals/m1/items/i1").mock(
        return_value=Response(
            200,
            json={
                "meal": {
                    "_id": "m1",
                    "items": [{"foodName": "Roti", "quantity": 3, "unit": "piece"}],
                    "totals": {"calories": 356.4, "protein": 10.4, "carbs": 55.7, "fat": 8.9},
                }
            },
        )
    )

    client = BeetApiClient(base_url="http://test", user_id="demo-user")
    await client.edit_recent_item("roti", quantity=3, unit="null", meal_type="unknown", time_of_day="unknown")

    find_params = find_route.calls.last.request.url.params
    patch_body = patch_route.calls.last.request.read().decode()
    assert find_params["dish"] == "roti"
    assert "mealType" not in find_params
    assert "timeOfDay" not in find_params
    assert '"unit"' not in patch_body


@pytest.mark.asyncio
@respx.mock
async def test_unknown_dish_surfaces_suggestions():
    respx.post("http://test/api/meals").mock(
        return_value=Response(
            422,
            json={
                "error": {
                    "code": "dish_not_found",
                    "message": "Unsupported dish",
                    "details": {"suggestions": [{"id": "poha", "name": "Poha"}]},
                }
            },
        )
    )

    client = BeetApiClient(base_url="http://test", user_id="demo-user")
    with pytest.raises(BeetApiError) as exc:
        await client.log_meal("snack", [{"dish": "pizza", "quantity": 1}])

    assert exc.value.code == "dish_not_found"
    assert exc.value.details["suggestions"][0]["name"] == "Poha"
