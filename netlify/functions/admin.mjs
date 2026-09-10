// Пульт: стоп-кран, счётчики, очередь. Отдельный пропуск ADMIN_TOKEN —
// останавливать агента должен не всякий, кто может его звать. Если ADMIN_TOKEN
// не задан, пульт закрыт целиком, а не открыт всем: забытая переменная не
// должна превращаться в открытую дверь.
import { CORS } from "./lib/auth.mjs";
import { counters, setPaused, LIMITS } from "./lib/guards.mjs";
import { listQueue, queueStats } from "./lib/queue.mjs";

const eq = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const want = process.env.ADMIN_TOKEN;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!want) return Response.json({ error: "ADMIN_TOKEN не задан — пульт закрыт" }, { status: 503, headers: CORS });
  if (!eq(want, got)) return Response.json({ error: "нужен админский токен" }, { status: 401, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "pause")  return Response.json({ paused: await setPaused(true)  }, { headers: CORS });
  if (action === "resume") return Response.json({ paused: await setPaused(false) }, { headers: CORS });
  if (action === "queue")  return Response.json({ items: await listQueue(50) }, { headers: CORS });

  return Response.json({
    limits: LIMITS,
    counters: await counters(),
    queue: await queueStats()
  }, { headers: CORS });
};

export const config = { path: "/api/admin", method: ["GET", "OPTIONS"] };
