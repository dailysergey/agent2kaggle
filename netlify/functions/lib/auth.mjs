// Одна проверка пропуска на все эндпоинты. Разъехавшиеся копии авторизации —
// классический способ получить дыру: правишь одну, забываешь вторую.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400"
};

// Постоянное по времени сравнение: проверка с ранним выходом выдаёт префикс
// пропуска по времени ответа.
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Пропуска именные: отзыв одного не должен блокировать остальных, а в логе
// должно быть видно, кто звал. A2A_TOKEN — случай единственного потребителя.
export function identify(req) {
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!got) return null;
  const pairs = (process.env.A2A_TOKENS || "")
    .split(",").map((x) => x.trim()).filter(Boolean)
    .map((x) => { const i = x.indexOf(":"); return [x.slice(0, i).trim(), x.slice(i + 1).trim()]; })
    .filter(([n, t]) => n && t);
  for (const [name, tok] of pairs) if (safeEq(tok, got)) return name;
  const solo = process.env.A2A_TOKEN;
  if (solo && safeEq(solo, got)) return "default";
  return null;
}
