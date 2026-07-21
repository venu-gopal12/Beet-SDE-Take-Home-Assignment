import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripGemmaThoughtChannels } from "../src/textTransforms.js";

// Helpers model the streaming chunks that LiveKit TTS transforms receive.
const streamText = (chunks) =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

const readText = async (stream) => {
  let text = "";
  for await (const chunk of stream) {
    text += chunk;
  }
  return text;
};

describe("stripGemmaThoughtChannels", () => {
  // Gemma-style thought tags should never be spoken by the assistant.
  it("removes complete thought channels from TTS text", async () => {
    const output = await readText(stripGemmaThoughtChannels(streamText([
      "Sure. <|channel>thought I should not say this <channel|>Logged your meal.",
    ])));

    assert.equal(output, "Sure. Logged your meal.");
  });

  it("removes thought channels split across chunks", async () => {
    const output = await readText(stripGemmaThoughtChannels(streamText([
      "Sure. <|channel>",
      "thought hidden",
      " text <channel|>Done.",
    ])));

    assert.equal(output, "Sure. Done.");
  });
});
