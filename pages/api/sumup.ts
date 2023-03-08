import { Redis } from "@upstash/redis";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchSubtitle } from "~/lib/fetchSubtitle";
import { ChatGPTAgent, fetchOpenAIResult } from "~/lib/openai/fetchOpenAIResult";
import { getSmallSizeTranscripts } from "~/lib/openai/getSmallSizeTranscripts";
import { getSystemPrompt, getUserSubtitlePrompt } from "~/lib/openai/prompt";
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
  const { title, subtitlesArray, descriptionText } = await fetchSubtitle(
    videoId,
    service,
    shouldShowTimestamp
  );
  // 不支持只有简介的
  if (!subtitlesArray) {
    console.error("No subtitle in the video: ", videoId);
    if(res) return res.status(501).json('No subtitle in the video');
    return new Response("No subtitle in the video", { status: 501 });
  }
  const inputText = subtitlesArray
    ? getSmallSizeTranscripts(subtitlesArray, subtitlesArray)
    : `这个视频没有字幕，只有简介：${descriptionText}`;
  const systemPrompt = getSystemPrompt({
    shouldShowTimestamp: subtitlesArray ? shouldShowTimestamp : false,
  });
  const userPrompt = getUserSubtitlePrompt(title, inputText);
  if (isDev) {
    console.log("final system prompt: ", systemPrompt);
    console.log("final user prompt: ", userPrompt);
  }

  try {
    const payload = {
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: ChatGPTAgent.system,
          content: systemPrompt,
        },
        // {"role": "user", "content": "谁赢得了2020年的世界职业棒球大赛?"},
        // {"role": "assistant", "content": "洛杉矶道奇队在2020年赢得了世界职业棒球大赛冠军。"},
        { role: ChatGPTAgent.user, content: userPrompt },
      ],
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
    console.log('result=', result);
    // TODO: add better logging when dev or prod
    const redis = Redis.fromEnv();
    const cacheId = `${shouldShowTimestamp ? "timestamp-" : ""}${videoId}_${process.env.PROMPT_VERSION}`;
    const data = await redis.set(cacheId, result);
    console.info(`video ${cacheId} cached:`, data);

    return  res ? res.status(200).json(result) : NextResponse.json(result);
  } catch (error: any) {
    console.error("API error", error, error.message);
    return (!res) ?NextResponse.json({
      errorMessage: error.message,
    }) : res.status(500).json({message: error.message});
  }
  res.status(500).json({message: 'what'});
}
