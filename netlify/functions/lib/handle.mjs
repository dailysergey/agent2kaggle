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
