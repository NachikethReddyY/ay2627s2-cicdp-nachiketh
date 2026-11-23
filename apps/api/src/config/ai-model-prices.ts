type PricePerMillionTokens = { prompt: number; completion: number };

const usdPerMillionTokens = new Map<string, PricePerMillionTokens>([
  ["openai/gpt-5-mini", { prompt: 0.25, completion: 2 }],
  ["openai/gpt-5.1", { prompt: 1.25, completion: 10 }],
  ["openai/nvidia/nemotron-3.5-super-vl-120b-a12b", { prompt: 0.15, completion: 0.5 }],
]);

export function estimateModelCostUsd(model: string, promptTokens: number, completionTokens: number) {
  const price = usdPerMillionTokens.get(model);
  return price ? ((promptTokens * price.prompt + completionTokens * price.completion) / 1_000_000).toFixed(12) : null;
}
