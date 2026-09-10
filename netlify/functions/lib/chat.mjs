// Общий журнал разговора: и A2A-вызовы, и реплики людей ложатся в одну ленту,
// поэтому страница показывает переписку агентов целиком, а не отдельный чат
// для людей рядом с невидимым обменом между агентами.
import { getStore } from "@netlify/blobs";

const KEY = "log";
const CAP = 500;               // лента обрезается, иначе blob растёт без предела

const store = () => getStore({ name: "a2a-chat", consistency: "strong" });

export async function listMessages(since = 0) {
  const all = (await store().get(KEY, { type: "json" })) ?? [];
  return { messages: all.filter((m) => m.seq > since), last: all.at(-1)?.seq ?? 0 };
}

export async function appendMessage({ author, role, text, data = null }) {
  const s = store();
  const all = (await s.get(KEY, { type: "json" })) ?? [];
  const msg = {
    seq: (all.at(-1)?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    author: String(author).slice(0, 40),
    role,                                  // agent | peer | human
    text: String(text).slice(0, 4000),
    data
  };
  all.push(msg);
  await s.setJSON(KEY, all.slice(-CAP));
  return msg;
}
