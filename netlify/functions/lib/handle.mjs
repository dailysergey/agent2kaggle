// Единственный путь от сообщения к ответу. И A2A, и чат зовут только его,
// поэтому ограничители нельзя обойти, зайдя с другой стороны.
import { admit, remember } from "./guards.mjs";
import { enqueue, settle } from "./queue.mjs";
import { appendMessage } from "./chat.mjs";
import { submissions, kernelStatus, route, summarise, SKILLS_HELP } from "../a2a.mjs";

export async function handleMessage({ caller, role, text, depth = 0, partition = "default" }) {
  const item = await enqueue({ caller, role, text, depth, partition });
  await appendMessage({ author: caller, role, text }).catch(() => {});

  const gate = await admit({ caller, text, depth });

  if (!gate.ok) {
    // Стоп-кран означает "люди отвечают сами", а не "агент отказывает вслух".
    // Реплика про остановку на каждое сообщение засоряла бы ленту, ради
    // которой стоп-кран и нажали. Сообщение в журнал ложится, ответа нет.
    if (gate.paused) {
      await settle(item.id, "paused", null);
      return { state: "rejected", text: "", silent: true, item };
    }
    await settle(item.id, "refused", gate.reason);
    await appendMessage({ author: "kaggle", role: "agent", text: `⛔ ${gate.reason}` }).catch(() => {});
    return { state: "rejected", text: gate.reason, item };
  }

  if (gate.cached) {
    await settle(item.id, "cached", gate.cached);
    await appendMessage({ author: "kaggle", role: "agent", text: gate.cached }).catch(() => {});
    return { state: "completed", text: gate.cached, cached: true, item };
  }

  const [skill, arg] = route(text);
  if (!skill) {
    // Раньше здесь был отказ со списком умений. Теперь незнакомый вопрос уходит
    // к модели — но ТОЛЬКО в фоновую функцию: замерено, что ответ занимает
    // 26-68 с, а синхронная функция столько не живёт. Вызывающему сразу
    // возвращается working, ответ появляется в ленте, когда придёт.
    if (process.env.MODEL_API_KEY) {
      const origin = process.env.URL || process.env.DEPLOY_PRIME_URL;
      try {
        await fetch(`${origin}/api/think`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ author: caller, text, itemId: item.id,
                                 competition: process.env.DEFAULT_COMPETITION })
        });
        await settle(item.id, "thinking", null);
        return { state: "working", text: "думаю…", item };
      } catch (e) {
        await settle(item.id, "failed", `не отправилось в фон: ${e.message}`);
      }
    }
    await settle(item.id, "out-of-scope", SKILLS_HELP);
    await appendMessage({ author: "kaggle", role: "agent", text: SKILLS_HELP }).catch(() => {});
    return { state: "rejected", text: SKILLS_HELP, item };
  }

  try {
    const data = skill === "kernel-status" ? await kernelStatus(arg) : await submissions(arg);
    const text2 = summarise(skill, data);
    await remember(gate.key, text2);
    await settle(item.id, "done", text2);
    await appendMessage({ author: "kaggle", role: "agent", text: text2, data }).catch(() => {});
    return { state: "completed", text: text2, data, skill, item };
  } catch (e) {
    const msg = `не вышло: ${e.message}`;
    await settle(item.id, "failed", msg);
    await appendMessage({ author: "kaggle", role: "agent", text: msg }).catch(() => {});
    return { state: "failed", text: msg, item };
  }
}
