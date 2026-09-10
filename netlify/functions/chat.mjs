// HTTP-API ленты для страницы. Тот же пропуск, что и у A2A: кто может звать
// агента, тот может читать и писать в общий чат. Отдельной роли для людей нет
// намеренно — иначе пропусков стало бы два, а отзывать пришлось бы оба.
import { listMessages } from "./lib/chat.mjs";
import { handleMessage } from "./lib/handle.mjs";
import { identify, CORS } from "./lib/auth.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const caller = identify(req);
  if (!caller) return Response.json({ error: "нужен корректный Bearer-токен" },
                                    { status: 401, headers: CORS });

  if (req.method === "GET") {
    const since = Number(new URL(req.url).searchParams.get("since") || 0);
    return Response.json(await listMessages(since), { headers: CORS });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "не JSON" }, { status: 400, headers: CORS }); }
  const text = (body?.text ?? "").trim();
  const author = (body?.author ?? "").trim();
  if (!text) return Response.json({ error: "пустое сообщение" }, { status: 400, headers: CORS });
  if (!author) return Response.json({ error: "укажите имя" }, { status: 400, headers: CORS });

  // Глубина 0: человек начинает цепочку, а не продолжает чужую.
  const r = await handleMessage({ caller: author, role: "human", text, depth: 0, partition: "chat" });
  return Response.json({ ok: true, state: r.state, reply: r.text, cached: !!r.cached },
                       { headers: CORS });
};

export const config = { path: "/api/chat", method: ["GET", "POST", "OPTIONS"] };
