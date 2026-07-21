import express from "express";
import { randomUUID } from "node:crypto";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { ApiError } from "../utils/ApiError.js";

const defaultAgentName = "beet-meal-agent";

const requiredLiveKitConfig = () => {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  const values = [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET];
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || values.some((value) => value.includes("your-"))) {
    throw new ApiError(
      500,
      "livekit_config_missing",
      "LiveKit credentials are not configured on the backend.",
      { missing: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] }
    );
  }
  return { url: LIVEKIT_URL, apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET };
};

export const createLiveKitRouter = ({ agentName = process.env.LIVEKIT_AGENT_NAME || defaultAgentName } = {}) => {
  const router = express.Router();

  router.post("/session", async (req, res, next) => {
    try {
      const { url, apiKey, apiSecret } = requiredLiveKitConfig();
      const roomName = `beet-${randomUUID()}`;
      const identity = `user-${randomUUID()}`;
      const userId = req.body?.userId || process.env.DEMO_USER_ID || "venugopal";

      const dispatchClient = new AgentDispatchClient(url, apiKey, apiSecret);
      await dispatchClient.createDispatch(roomName, agentName, {
        metadata: JSON.stringify({ userId }),
      });

      const token = new AccessToken(apiKey, apiSecret, {
        identity,
        name: "Beet user",
        ttl: "30m",
      });
      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      res.json({
        url,
        token: await token.toJwt(),
        roomName,
        identity,
        agentName,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
