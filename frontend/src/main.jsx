import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, Loader2, Mic, MicOff, PhoneOff, RefreshCw, Utensils } from "lucide-react";
import { Room, RoomEvent, Track } from "livekit-client";
import "./styles.css";

// The frontend is intentionally thin: it asks the backend for LiveKit tokens and
// meal data, while all food validation stays server-side.
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const demoUserId = import.meta.env.VITE_DEMO_USER_ID || "venugopal";

// Use Indian locale formatting because the demo foods and meal vocabulary are
// tuned around an Indian household context.
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

const VoiceSession = ({ onMealsChanged }) => {
  const [room, setRoom] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  const endSession = async () => {
    // Disconnecting the room also tears down remote audio tracks.
    if (room) {
      room.disconnect();
    }
    setRoom(null);
    setAgentSpeaking(false);
    setVoiceStatus("idle");
  };

  const startSession = async () => {
    setVoiceError("");
    setVoiceStatus("connecting");

    try {
      const response = await fetch(`${apiBaseUrl}/api/livekit/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: demoUserId })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error?.message || "Could not start a voice session");
      }

      const session = await response.json();
      // A new LiveKit room is created for each browser voice session.
      const nextRoom = new Room({ adaptiveStream: true, dynacast: true });

      nextRoom
        .on(RoomEvent.ParticipantConnected, (participant) => {
          // The remote participant is the dispatched meal agent.
          if (!participant.isLocal) {
            setVoiceStatus("connected");
          }
        })
        .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (track.kind !== Track.Kind.Audio || participant.isLocal) return;
          setVoiceStatus("connected");
          // Attach agent audio directly; LiveKit manages the underlying media.
          document.body.appendChild(track.attach());
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((element) => element.remove());
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setAgentSpeaking(speakers.some((speaker) => !speaker.isLocal));
        })
        .on(RoomEvent.Disconnected, () => {
          setRoom(null);
          setAgentSpeaking(false);
          setVoiceStatus("idle");
          // Refresh after a call in case the final tool result arrived just
          // before the room closed.
          onMealsChanged();
        });

      await nextRoom.connect(session.url, session.token);
      await nextRoom.localParticipant.setMicrophoneEnabled(true);
      setRoom(nextRoom);
      setVoiceStatus(nextRoom.remoteParticipants.size > 0 ? "connected" : "warming");
    } catch (err) {
      setVoiceError(err.message);
      setVoiceStatus("idle");
    }
  };

  useEffect(() => () => {
    if (room) room.disconnect();
  }, [room]);

  const isConnecting = voiceStatus === "connecting";
  const isWarming = voiceStatus === "warming";
  const isConnected = voiceStatus === "connected";
  const isActive = isWarming || isConnected;
  const statusText = isConnecting
    ? "Creating a secure LiveKit room..."
    : isWarming
      ? "Assistant is starting. Please wait for the greeting before speaking."
      : isConnected
        ? (agentSpeaking ? "Assistant is speaking" : "Listening in this browser")
        : "Start a LiveKit session and speak your meal changes.";

  return (
    <section className={`voice-panel ${isConnected ? "connected" : ""} ${isWarming ? "warming" : ""}`}>
      <div className="voice-copy">
        <span className="voice-icon">
          {isConnecting || isWarming ? <Loader2 className="spin" size={20} /> : isConnected ? <Mic size={20} /> : <MicOff size={20} />}
        </span>
        <div>
          <h2>Voice Assistant</h2>
          <p>{statusText}</p>
        </div>
      </div>

      {isActive ? (
        <button className="danger-button" onClick={endSession} type="button">
          <PhoneOff size={18} />
          End
        </button>
      ) : (
        <button className="voice-button" onClick={startSession} disabled={isConnecting} type="button">
          {isConnecting ? <Loader2 className="spin" size={18} /> : <Mic size={18} />}
          {isConnecting ? "Starting" : "Start voice"}
        </button>
      )}

      {voiceError ? <p className="voice-error">{voiceError}</p> : null}
    </section>
  );
};

const MealCard = ({ meal }) => (
  // Each card represents one logging event, not a merged daily meal bucket.
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

      <VoiceSession onMealsChanged={loadMeals} />

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
