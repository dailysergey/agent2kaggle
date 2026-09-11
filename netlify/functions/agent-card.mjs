// A2A discovery document. Public on purpose: a card says what an agent can do
// and how to authenticate, not what it knows. Every skill here is READ-ONLY --
// submitting and pushing kernels stay in the aquarium behind human approval,
// so a leaked URL cannot spend the daily submission budget.
const CARD = {
  protocolVersion: "1.0.1",
  name: "kaggle",
  description:
    "Состояние соревнования Kaggle: сабмиты, скоры, статус кернелов. Только чтение.",
  version: "0.1.0",
  capabilities: { streaming: false, stateTransitionHistory: true },
  // Навык reason асинхронный: message/send вернёт working, результат забирается
  // через tasks/get по id задачи. Синхронно уложиться нельзя — модель думает 30-70 с.
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain", "application/json"],
  skills: [
    {
      id: "submissions",
      name: "Сабмиты и скоры",
      description: "Последние сабмиты соревнования: время, статус, публичный скор.",
      tags: ["kaggle", "read"],
      examples: ["какие скоры у rsna-knee-abnormality-detection"]
    },
    {
      id: "reason",
      name: "Рассуждение по состоянию соревнования",
      description: "Свободный вопрос: агент отвечает по текущим сабмитам и ленте. "
                 + "Ответ приходит В ФОН за 30-70 с — задача возвращается в состоянии working.",
      tags: ["kaggle", "llm"],
      examples: ["какая следующая гипотеза", "стоит ли сабмитить форк"]
    },
    {
      id: "kernel-status",
      name: "Статус кернела",
      description: "Состояние прогона по слагу owner/kernel-name.",
      tags: ["kaggle", "read"],
      examples: ["статус dailysergey/rsna-knee-blend-rg"]
    }
  ],
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  security: [{ bearer: [] }]
};

export default async (req) => {
  const url = new URL(req.url);
  return Response.json({ ...CARD, url: `${url.origin}/a2a` });
};

export const config = { path: "/.well-known/agent-card.json", method: "GET" };
