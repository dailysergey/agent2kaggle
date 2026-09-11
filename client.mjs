#!/usr/bin/env node
// Минимальный A2A-клиент. Ровно то, что должен уметь вызывающий агент:
// найти карточку по well-known, взять из неё адрес и вызвать message/send.
//
//   node client.mjs https://<host> "rsna-knee-abnormality-detection"
//   A2A_TOKEN=... node client.mjs https://<host> "статус dailysergey/rsna-knee-blend-rg"

const [, , base, ...rest] = process.argv;
const text = rest.join(" ").trim();
if (!base || !text) {
  console.error("нужно: node client.mjs <адрес> <текст запроса>");
  process.exit(2);
}
const token = process.env.A2A_TOKEN;
if (!token) { console.error("нет A2A_TOKEN в окружении"); process.exit(2); }

// 1. Discovery. Адрес эндпоинта берём из карточки, а не зашиваем: карточка и
//    есть контракт, и она может переехать вместе с агентом.
const cardUrl = new URL("/.well-known/agent-card.json", base).toString();
const card = await (await fetch(cardUrl)).json();
console.error(`агент: ${card.name} — ${card.description}`);
console.error(`навыки: ${card.skills.map((s) => s.id).join(", ")}`);

// 2. Вызов.
const res = await fetch(card.url, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "message/send",
    params: {
      message: {
        role: "user",
        kind: "message",
        messageId: crypto.randomUUID(),
        parts: [{ kind: "text", text }]
      }
    }
  })
});

const body = await res.json();
if (body.error) { console.error("ошибка:", body.error); process.exit(1); }

// 3. Разбор задачи. Состояние может быть completed или failed; артефакт несёт данные.
let task = body.result;
console.error(`задача ${task.id}: ${task.status.state}`);

// Навык reason асинхронный: агент думает 30-70 с и сразу возвращает working.
// Ответ забирается через tasks/get — синхронно уложиться нельзя, и клиент,
// который прочитает только первый ответ, решит, что агент промолчал.
const t0 = Date.now();
while (task.status.state === "working" && Date.now() - t0 < 300_000) {
  await new Promise((r) => setTimeout(r, 5000));
  const p = await fetch(card.url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(),
                           method: "tasks/get", params: { id: task.id } })
  });
  const pb = await p.json();
  if (pb.error) { console.error("опрос:", pb.error); break; }
  task = pb.result;
  process.stderr.write(`\r  ${task.status.state} ${Math.round((Date.now() - t0) / 1000)}с   `);
}
process.stderr.write("\n");

if (task.status.state !== "completed") {
  const msg = task.status.message?.parts?.map((p) => p.text).join(" ");
  console.error(msg || JSON.stringify(task.status));
  process.exit(1);
}
for (const a of task.artifacts ?? [])
  for (const p of a.parts ?? [])
    console.log(p.kind === "data" ? JSON.stringify(p.data, null, 2) : p.text);
