// Стражи перед агентом. Порядок проверок — от самой дешёвой к самой дорогой:
// нет смысла считать бюджет, если уже нажат стоп-кран.
//
// Что именно жжёт лимиты, если не остановить:
//   1. два агента, отвечающие друг другу — бесконечный пинг-понг;
//   2. один агент в цикле повторяет тот же вопрос;
//   3. всплеск от одного вызывающего;
//   4. медленная утечка за сутки, которую никто не замечает.
// На каждый случай нужен свой предел: общего «лимита запросов» не хватает,
// потому что пинг-понг и медленная утечка выглядят по-разному.
import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "a2a-guards", consistency: "strong" });
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const LIMITS = {
  maxDepth:      num(process.env.AQ_MAX_DEPTH, 4),        // глубина цепочки агент->агент
  perCallerHour: num(process.env.AQ_RATE_PER_HOUR, 60),   // всплеск от одного пропуска
  dayTotal:      num(process.env.AQ_DAY_TOTAL, 500),      // суточный потолок на всех
  repeatCoolSec: num(process.env.AQ_REPEAT_COOLDOWN, 60)  // тот же вопрос от того же
};

const today = () => new Date().toISOString().slice(0, 10);

async function state() {
  return (await store().get("state", { type: "json" })) ?? { day: today(), total: 0, callers: {}, recent: {}, paused: false };
}
async function save(s) { await store().setJSON("state", s); }

export async function isPaused() { return (await state()).paused === true; }

export async function setPaused(v) {
  const s = await state(); s.paused = !!v; await save(s); return s.paused;
}

export async function counters() {
  const s = await state();
  return { day: s.day, total: s.total, limit: LIMITS.dayTotal, paused: s.paused,
           callers: Object.fromEntries(Object.entries(s.callers).map(([k, v]) => [k, v.length])) };
}

/**
 * Пропустить или отказать. Возвращает {ok} либо {ok:false, reason, retryAfter}.
 * cached — если это дословный повтор в пределах остывания, ответ берём из
 * журнала, а не из внешнего API: повтор не должен стоить денег.
 */
export async function admit({ caller, text, depth = 0 }) {
  const s = await state();
  const now = Date.now();

  if (s.day !== today()) { s.day = today(); s.total = 0; s.callers = {}; }   // суточный сброс

  if (s.paused) return { ok: false, paused: true, reason: "агент остановлен вручную (стоп-кран)" };

  if (depth >= LIMITS.maxDepth)
    return { ok: false, reason: `предел глубины цепочки ${LIMITS.maxDepth}: похоже на пинг-понг агентов` };

  if (s.total >= LIMITS.dayTotal)
    return { ok: false, reason: `исчерпан суточный потолок ${LIMITS.dayTotal} обращений; сбросится в полночь UTC` };

  const win = s.callers[caller] ?? [];
  const recent = win.filter((t) => now - t < 3600_000);
  if (recent.length >= LIMITS.perCallerHour)
    return { ok: false, reason: `${caller}: больше ${LIMITS.perCallerHour} обращений в час`, retryAfter: 3600 };

  const key = `${caller}:${text.trim().toLowerCase().slice(0, 200)}`;
  const prev = s.recent[key];
  if (prev && now - prev.at < LIMITS.repeatCoolSec * 1000)
    return { ok: true, cached: prev.answer, reason: "дословный повтор — отвечаю из журнала" };

  recent.push(now);
  s.callers[caller] = recent.slice(-LIMITS.perCallerHour);
  s.total += 1;
  await save(s);
  return { ok: true, key };
}

/** Запомнить ответ, чтобы дословный повтор не стоил ещё одного вызова. */
export async function remember(key, answer) {
  if (!key) return;
  const s = await state();
  s.recent[key] = { at: Date.now(), answer };
  const keys = Object.keys(s.recent);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete s.recent[k];
  await save(s);
}
