// Очередь входящих. Каждое сообщение — и от агента, и от человека — сначала
// становится записью со статусом, и только потом попадает к агенту.
//
// Честно про устройство: постоянного потребителя тут нет, разбор идёт в том же
// вызове, что и постановка. Очередь здесь нужна не ради асинхронности, а ради
// трёх других вещей: видно, что пришло и чем кончилось; есть ОДНА точка, где
// можно отказать; повторную доставку можно ограничить. Изображать воркер,
// которого нет, было бы хуже, чем сказать это прямо.
import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "a2a-queue", consistency: "strong" });
const KEY = "items";
const CAP = 300;

export async function enqueue({ caller, role, text, depth = 0, partition = "default" }) {
  const s = store();
  const all = (await s.get(KEY, { type: "json" })) ?? [];
  const item = {
    id: crypto.randomUUID(),
    seq: (all.at(-1)?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    caller, role, text: String(text).slice(0, 4000), depth, partition,
    status: "queued", deliveries: 0, result: null
  };
  all.push(item);
  await s.setJSON(KEY, all.slice(-CAP));
  return item;
}

export async function settle(id, status, result = null) {
  const s = store();
  const all = (await s.get(KEY, { type: "json" })) ?? [];
  const it = all.find((x) => x.id === id);
  if (it) { it.status = status; it.result = result; it.deliveries += 1; await s.setJSON(KEY, all); }
  return it;
}

export async function listQueue(limit = 50) {
  const all = (await store().get(KEY, { type: "json" })) ?? [];
  return all.slice(-limit).reverse();
}

export async function queueStats() {
  const all = (await store().get(KEY, { type: "json" })) ?? [];
  const by = {};
  for (const i of all) by[i.status] = (by[i.status] ?? 0) + 1;
  return { total: all.length, by };
}
