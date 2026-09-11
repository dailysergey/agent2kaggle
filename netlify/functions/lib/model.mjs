// Вызов модели у провайдера, совместимого с OpenAI Responses API.
//
// Замерено перед тем, как строить: ответ в одно слово занимает 26 с у
// gpt-5.6-terra и 68 с у gpt-6-astra. Синхронная функция Netlify столько не
// живёт, поэтому вызов идёт ТОЛЬКО из фоновой функции. Если однажды кто-то
// позовёт это из обычной, лучше упасть по таймауту явно, чем вернуть обрезок.
const BASE  = process.env.MODEL_BASE_URL || "https://nodule-provider.store/v1";
const MODEL = process.env.MODEL_NAME     || "gpt-5.6-terra";

export const MODEL_INFO = { base: BASE, model: MODEL };

function textOf(d) {
  if (d?.output_text) return d.output_text;
  for (const it of d?.output ?? [])
    for (const c of it?.content ?? []) if (c?.text) return c.text;
  return null;
}

export async function ask({ system, question, maxTokens = 700, timeoutMs = 600_000 }) {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY не задан");

  const ctl = AbortSignal.timeout(timeoutMs);
  const r = await fetch(`${BASE}/responses`, {
    method: "POST",
    signal: ctl,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      instructions: system,
      input: question,
      max_output_tokens: maxTokens
    })
  });
  if (!r.ok) throw new Error(`модель ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const text = textOf(d);
  if (!text) throw new Error("модель вернула пустой ответ");
  const u = d.usage ?? {};
  return {
    text,
    usage: { input: u.input_tokens ?? null, output: u.output_tokens ?? null,
             total: u.total_tokens ?? null }
  };
}
