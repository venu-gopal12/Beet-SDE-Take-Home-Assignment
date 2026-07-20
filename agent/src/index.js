import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { ServerOptions, cli, defineAgent, inference, voice } from "@livekit/agents";
import { createAgent } from "./beetAgent.js";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();

    const session = new voice.AgentSession({
      stt: new inference.STT({ model: "deepgram/nova-3", language: "en" }),
      llm: new inference.LLM({ model: "google/gemma-4-31b-it" }),
      tts: new inference.TTS({
        model: "cartesia/sonic-3",
        voice: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
      }),
      turnHandling: {
        turnDetection: "stt",
      },
    });

    await session.start({
      agent: createAgent(),
      room: ctx.room,
    });
    await session.generateReply({
      instructions: "Greet the user briefly and ask what meal they would like to log.",
    });
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: "beet-meal-agent",
}));
