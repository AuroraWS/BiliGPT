import { Redis } from "@upstash/redis";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchSubtitle } from "~/lib/fetchSubtitle";
import { fetchOpenAIResult } from "~/lib/openai/fetchOpenAIResult";
import { getChunckedTranscripts, getSummaryPrompt } from "~/lib/openai/prompt";
import { selectApiKeyAndActivatedLicenseKey } from "~/lib/openai/selectApiKeyAndActivatedLicenseKey";
import { SummarizeParams } from "~/lib/types";
import { isDev } from "~/utils/env";

export const config = {
  runtime: process.env.OPENAI_HTTP_PROXY ? "nodejs" : "edge"
};

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing env var from OpenAI");
}

export default async function handler(
  req: NextRequest,
  // context: NextFetchEvent
  res: any,
) {
  const { videoConfig, userConfig } = (req.body || (await req.json())) as SummarizeParams;
  const { userKey, shouldShowTimestamp } = userConfig;
  const { videoId, service } = videoConfig;

  if (!videoId) {
    return new Response("No videoId in the request", { status: 500 });
  }
  const { title, subtitles } = await fetchSubtitle(
    videoId,
    service,
    shouldShowTimestamp
  );
  if (!subtitles) {
    console.error("No subtitle in the video: ", videoId);
    if(res) return res.status(501).json('No subtitle in the video');
    return new Response("No subtitle in the video", { status: 501 });
  }
  const text = getChunckedTranscripts(subtitles, subtitles);
  const prompt = getSummaryPrompt(title, text, { shouldShowTimestamp });

  try {
    userKey && console.log("========use user apiKey========");
    isDev && console.log("prompt", prompt);
    const payload = {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user" as const, content: prompt }],
      temperature: 0.5,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_tokens: Number.parseInt((process.env.MAX_TOKENS || (userKey ? "400" : "300")) as string),
      stream: false,
      n: 1,
    };

    // TODO: need refactor
    const openaiApiKey = await selectApiKeyAndActivatedLicenseKey(
      userKey,
      videoId
    );
    const result = await fetchOpenAIResult(payload, openaiApiKey);
    // TODO: add better logging when dev or prod
    console.log("result", result);
    const redis = Redis.fromEnv();
    const videoIdWithVersion = `${videoId}_${process.env.PROMPT_VERSION}`;
    const cacheId = shouldShowTimestamp ? `timestamp-${videoIdWithVersion}` : videoIdWithVersion;
    const data = await redis.set(cacheId, result);
    console.log(`video ${cacheId} cached:`, data);

    return  res ? res.status(200).json(result) : NextResponse.json(result);
  } catch (error: any) {
    console.log("API error", error, error.message);
    return (!res) ?NextResponse.json({
      errorMessage: error.message,
    }) : res.status(500).json({message: error.message});
  }
  res.status(500).json({message: 'what'});
}
