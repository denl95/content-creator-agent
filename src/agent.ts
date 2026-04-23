import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import "dotenv/config";
import { z } from "zod";

const getWeather = tool(
  async ({ city }) => {
    return `The weather in ${city} is sunny and 72°F.`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a city.",
    schema: z.object({
      city: z.string().describe("The city name, e.g. 'San Francisco'"),
    }),
  },
);

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

export const graph = createReactAgent({
  llm: model,
  tools: [getWeather],
});

if (import.meta.main) {
  const result = await graph.invoke({
    messages: [{ role: "user", content: "What's the weather in Paris?" }],
  });
  const last = result.messages.at(-1);
  console.log(last?.content ?? "(no response)");
}
