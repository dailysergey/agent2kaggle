// A2A JSON-RPC endpoint for the aquarium's kaggle agent.
//
// Scope is deliberately narrow: both skills are single, fast Kaggle reads that
// finish well inside a function invocation, so every task completes
// synchronously and there is no task store to get stale. Anything that takes
// hours (kernel runs, scored reruns) or spends a budget (submissions) is NOT
// here -- it belongs in the aquarium, where a human approves it and the daily
// limit is visible. A serverless function is the wrong place to hold a
// multi-hour wait, and the wrong place to hold the authority to spend.

const KAGGLE = "https://www.kaggle.com/api/v1";

// A2A clients are often other agents running in a browser or on another host,
// so preflight must succeed or they never reach the POST at all.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400"
};

const err = (id, code, message) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } },
                { status: code === -32001 ? 401 : 200, headers: CORS });

// One shared secret cannot be revoked for one caller without locking out every
// caller, and it cannot say who called. So callers are named: A2A_TOKENS holds
// "name:token" pairs, and revoking one is deleting one pair. A2A_TOKEN stays
// supported as the single-caller case.
function identify(req) {
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

// Constant-time compare: a token check that returns early leaks its prefix.
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function kaggleAuth() {
  // Kaggle has two credential shapes and they are NOT interchangeable. The
  // newer one is a single access token (~37 chars, "KG..." prefix) living in
  // ~/.kaggle/access_token, and the API accepts it only as a Bearer header --
  // measured: Bearer -> 200, Basic with the same string -> 401. The classic
  // one is username+key from kaggle.json and wants Basic. Prefer the token,
  // fall back to the pair, and fail loudly rather than sending a header the
  // API will silently reject as anonymous.
  const t = process.env.KAGGLE_ACCESS_TOKEN;
  if (t) return "Bearer " + t;
  const u = process.env.KAGGLE_USERNAME, k = process.env.KAGGLE_KEY;
  if (u && k) return "Basic " + Buffer.from(`${u}:${k}`).toString("base64");
  throw new Error("нет учётных данных: задайте KAGGLE_ACCESS_TOKEN либо KAGGLE_USERNAME+KAGGLE_KEY");
}

async function kaggleGet(path, params = {}) {
  const url = new URL(KAGGLE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: kaggleAuth(), Accept: "application/json" } });
  if (!r.ok) throw new Error(`Kaggle ${r.status} на ${path}`);
  return r.json();
}

const textOf = (m) =>
  (m?.parts ?? []).filter((p) => p.kind === "text").map((p) => p.text).join(" ").trim();

// --- skills ---------------------------------------------------------------

async function submissions(arg) {
  const comp = arg || process.env.DEFAULT_COMPETITION;
  if (!comp) throw new Error("не указано соревнование и нет DEFAULT_COMPETITION");
  const rows = await kaggleGet(`/competitions/submissions/list/${comp}`);
  const top = (Array.isArray(rows) ? rows : []).slice(0, 10).map((s) => ({
    date: s.date, status: s.status,
    publicScore: s.publicScore ?? null, privateScore: s.privateScore ?? null,
    description: (s.description ?? "").slice(0, 120)
  }));
  const scored = top.filter((s) => s.publicScore != null);
  return {
    competition: comp,
    best_public: scored.length
      ? Math.max(...scored.map((s) => Number(s.publicScore))) : null,
    pending: top.filter((s) => String(s.status).toUpperCase().includes("PENDING")).length,
    submissions: top
  };
}

async function kernelStatus(arg) {
  const m = /([\w.-]+)\/([\w.-]+)/.exec(arg || "");
  if (!m) throw new Error("нужен слаг вида owner/kernel-name");
  const j = await kaggleGet("/kernels/status", { userName: m[1], kernelSlug: m[2] });
  return { kernel: `${m[1]}/${m[2]}`, status: j.status ?? null, failureMessage: j.failureMessage ?? null };
}

function route(text) {
  const t = (text || "").toLowerCase();
  const slug = /([\w.-]+)\/([\w.-]+)/.exec(text || "");
  if (/kernel|кернел|прогон|статус\s+\w+\//.test(t) && slug) return ["kernel-status", slug[0]];
  const comp = /([a-z0-9-]{6,})/.exec(t.replace(/[а-яё]/g, " "));
  return ["submissions", comp ? comp[1] : null];
}

// --- JSON-RPC -------------------------------------------------------------

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  let body;
  try { body = await req.json(); } catch { return err(null, -32700, "не JSON"); }
  const { id, method, params } = body ?? {};

  // Auth first: the card is public, the endpoint is not.
  if (!process.env.A2A_TOKENS && !process.env.A2A_TOKEN)
    return err(id, -32603, "на сервере не задан ни A2A_TOKENS, ни A2A_TOKEN");
  const caller = identify(req);
  if (!caller) return err(id, -32001, "нужен корректный Bearer-токен");
  console.log(`a2a: caller=${caller} method=${method}`);

  if (method === "tasks/get") {
    // Every task here completes inside message/send, so nothing is ever stored
    // to look up. Saying so is better than pretending a task store exists.
    return err(id, -32001, "задачи выполняются синхронно; используйте message/send");
  }
  if (method !== "message/send") return err(id, -32601, `метод ${method} не поддерживается`);

  const msg = params?.message;
  const text = textOf(msg);
  if (!text) return err(id, -32602, "пустое сообщение");

  const [skill, arg] = route(text);
  let data;
  try {
    data = skill === "kernel-status" ? await kernelStatus(arg) : await submissions(arg);
  } catch (e) {
    // Surface the failure as a failed Task, which is what an A2A client expects,
    // rather than a transport-level error it cannot attribute to the task.
    return Response.json({
      jsonrpc: "2.0", id,
      result: {
        id: crypto.randomUUID(), contextId: params?.message?.contextId ?? crypto.randomUUID(),
        kind: "task",
        status: { state: "failed", message: { role: "agent", kind: "message",
          messageId: crypto.randomUUID(),
          parts: [{ kind: "text", text: `не вышло: ${e.message}` }] } }
      }
    }, { headers: CORS });
  }

  const taskId = crypto.randomUUID();
  return Response.json({
    jsonrpc: "2.0", id,
    result: {
      id: taskId,
      contextId: msg?.contextId ?? crypto.randomUUID(),
      kind: "task",
      status: { state: "completed" },
      artifacts: [{
        artifactId: crypto.randomUUID(),
        name: skill,
        parts: [{ kind: "data", data }]
      }]
    }
  }, { headers: CORS });
};

export const config = { path: "/a2a", method: ["POST", "OPTIONS"] };
