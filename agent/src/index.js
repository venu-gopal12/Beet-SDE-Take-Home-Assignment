import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { ServerOptions, cli, defineAgent, inference, voice } from "@livekit/agents";
import { createAgent } from "./beetAgent.js";
import { stripGemmaThoughtChannels } from "./textTransforms.js";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

// LiveKit calls this entrypoint for each dispatched room/job.
export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();

    // STT/LLM/TTS are all LiveKit Inference descriptors, keeping deployment
    // credentials centralized in LiveKit rather than separate provider keys.
    const session = new voice.AgentSession({
      stt: new inference.STT({ model: "deepgram/nova-3", language: "en" }),
      llm: new inference.LLM({ model: "google/gemma-4-31b-it" }),
      tts: new inference.TTS({
        model: "cartesia/sonic-3",
        voice: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
      }),
      turnHandling: {
        // STT-based endpointing is enough for this short command-and-confirm UX.
        turnDetection: "stt",
      },
      // Prevent hidden model thought tags or markdown artifacts from reaching TTS.
      ttsTextTransforms: [stripGemmaThoughtChannels, "filter_markdown", "filter_emoji"],
    });

    await session.start({
      agent: createAgent(),
      room: ctx.room,
    });
    await session.generateReply({
      // Start with a short prompt so the user knows the voice session is ready.
      instructions: "Greet the user briefly and ask what meal they would like to log.",
    });
  },
});

// The same file supports local `npm run dev` and LiveKit Cloud deployment.
cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: "beet-meal-agent",
}));
