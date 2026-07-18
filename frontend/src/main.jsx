import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, RefreshCw, Utensils } from "lucide-react";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const formatTime = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));

const Macro = ({ label, value, unit = "g" }) => (
  <div className="macro">
    <span>{label}</span>
    <strong>{value}{unit}</strong>
  </div>
);

const MealCard = ({ meal }) => (
  <article className="meal-card">
    <header>
      <div>
        <p className="meal-type">{meal.mealType}</p>
        <h2>{formatTime(meal.loggedAt)}</h2>
      </div>
      <div className="calories">{meal.totals.calories} kcal</div>
    </header>

    <div className="items">
      {meal.items.map((item) => (
        <div className="item" key={item._id}>
          <div>
            <strong>{item.foodName}</strong>
            <span>{item.quantity} {item.unit} - {item.grams}g</span>
          </div>
          <span>{item.macros.calories} kcal</span>
        </div>
      ))}
    </div>

    <div className="macros">
      <Macro label="Protein" value={meal.totals.protein} />
      <Macro label="Carbs" value={meal.totals.carbs} />
      <Macro label="Fat" value={meal.totals.fat} />
    </div>

    {meal.rawUtterance ? <p className="utterance">Original log: "{meal.rawUtterance}"</p> : null}
  </article>
);

const App = () => {
  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const totals = useMemo(
    // Meal-level nutrition is already resolved by the API; this is just a page summary.
    () =>
      meals.reduce(
        (sum, meal) => ({
          calories: Math.round((sum.calories + meal.totals.calories) * 10) / 10,
          protein: Math.round((sum.protein + meal.totals.protein) * 10) / 10,
          carbs: Math.round((sum.carbs + meal.totals.carbs) * 10) / 10,
          fat: Math.round((sum.fat + meal.totals.fat) * 10) / 10
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [meals]
  );

  const loadMeals = async () => {
    try {
      setError("");
      const response = await fetch(`${apiBaseUrl}/api/meals`);
      if (!response.ok) throw new Error("Could not load meals");
      const data = await response.json();
      setMeals(data.meals);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Polling keeps the single-page UI in sync with voice actions without sockets.
    loadMeals();
    const interval = setInterval(loadMeals, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main>
      <nav className="nav">
        <div className="brand">
          <div className="brand-mark"><Utensils size={22} /></div>
          <strong>beet.health</strong>
        </div>

        <div className="nav-links" aria-label="Meal log sections">
          <span className="selected">Logs</span>
        </div>

        <button className="secondary-button" onClick={loadMeals} aria-label="Refresh meal logs">
          <RefreshCw size={18} />
          Refresh
        </button>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Voice meal logging</p>
          <h1>Meal Logs</h1>
          <p className="hero-copy">Meals captured by the LiveKit assistant, resolved against Beet's food database with nutrition attached.</p>
        </div>

        <button className="primary-button" onClick={loadMeals} aria-label="Refresh meal logs">
          Refresh logs
          <ArrowRight size={20} />
        </button>
      </section>

      <section className="status">
        <span>{loading ? "Loading meal logs..." : `${meals.length} active meal ${meals.length === 1 ? "entry" : "entries"}`}</span>
        {lastUpdated ? <span>Updated {lastUpdated.toLocaleTimeString()}</span> : null}
      </section>

      <section className="summary">
        <Macro label="Calories" value={totals.calories} unit=" kcal" />
        <Macro label="Protein" value={totals.protein} />
        <Macro label="Carbs" value={totals.carbs} />
        <Macro label="Fat" value={totals.fat} />
      </section>

      {error ? <div className="error">{error}</div> : null}

      <section className="meal-list">
        {meals.length ? (
          meals.map((meal) => <MealCard meal={meal} key={meal._id} />)
        ) : (
          <div className="empty">
            <h2>No meals logged yet</h2>
            <p>Start the LiveKit agent and say what you ate.</p>
          </div>
        )}
      </section>
    </main>
  );
};

createRoot(document.getElementById("root")).render(<App />);
