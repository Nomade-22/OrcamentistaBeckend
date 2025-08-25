import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

/** CORS: permite GitHub Pages + localhost */
const ALLOW_LIST = new Set([
  "https://nomade-22.github.io",
  "http://localhost:3000"
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl/reqbin
    if (ALLOW_LIST.has(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  }
}));
app.options("*", cors());

/** ====== PLANOS ====== */
const PLANS = {
  free:   { monthlyMessages: 500,   price: "R$0,00/mês" },
  basico: { monthlyMessages: 10000, price: "R$19,90/mês" },
  pro:    { monthlyMessages: 50000, price: "R$49,90/mês" },
};

/** Usuários de exemplo (token -> plano) */
const USER_PLAN = {
  "tok-free-001": "free",
  "tok-basico-001": "basico",
  "tok-pro-001": "pro",
};

/** Contadores em memória: { "2025-08|tok-xxx": 42 } */
const usageCounters = new Map();

/** Helpers de período mensal */
function currentMonthKey() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}
function getCounterKey(userToken) {
  return `${currentMonthKey()}|${userToken}`;
}

/** Middleware: autenticação via header */
function authUser(req, res, next) {
  const token = (req.header("X-Client-Token") || "").trim();
  if (!token) return res.status(401).json({ error: "Faltou o header X-Client-Token." });

  const planName = USER_PLAN[token];
  if (!planName) return res.status(403).json({ error: "Token inválido/não cadastrado." });

  req.userToken = token;
  req.planName = planName;
  req.plan = PLANS[planName];
  next();
}

/** Middleware: checa cota mensal */
function checkQuota(req, res, next) {
  const key = getCounterKey(req.userToken);
  const used = usageCounters.get(key) || 0;
  const limit = req.plan.monthlyMessages;

  if (used >= limit) {
    return res.status(429).json({
      error: "Limite do plano atingido",
      plan: req.planName,
      used,
      limit,
      price: req.plan.price,
      period: currentMonthKey(),
      message: "⚠️ Você atingiu o limite do seu plano. Faça upgrade para continuar."
    });
  }
  next();
}

/** Incrementa uso */
function incrementUsage(userToken) {
  const key = getCounterKey(userToken);
  const used = usageCounters.get(key) || 0;
  usageCounters.set(key, used + 1);
}

/** Health */
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    app: "IA Orçamentista Backend",
    now: new Date().toISOString(),
    plans: PLANS,
    hasKey: Boolean(process.env.OPENAI_API_KEY)
  });
});

/** Consulta de uso */
app.get("/me", authUser, (req, res) => {
  const key = getCounterKey(req.userToken);
  const used = usageCounters.get(key) || 0;
  res.json({
    plan: req.planName,
    price: req.plan.price,
    monthlyLimit: req.plan.monthlyMessages,
    used,
    remaining: Math.max(req.plan.monthlyMessages - used, 0),
    period: currentMonthKey()
  });
});

/** Rota de chat */
app.post("/chat", authUser, checkQuota, async (req, res) => {
  try {
    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) return res.status(400).json({ error: "Mensagem vazia." });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY ausente no servidor." });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é o IA Orçamentista. Responda com clareza, em R$ quando houver valores." },
          { role: "user", content: userMessage }
        ]
      })
    });

    const raw = await r.text();
    if (!r.ok) {
      console.error("❌ OpenAI ERRO:", r.status, raw);
      return res.status(500).json({ error: "Falha ao chamar OpenAI", details: raw.slice(0, 500) });
    }

    let data;
    try { data = JSON.parse(raw); } 
    catch {
      return res.status(500).json({ error: "Resposta inválida da OpenAI", raw: raw.slice(0, 500) });
    }

    const reply = data?.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta.";

    incrementUsage(req.userToken);

    res.json({
      reply,
      usage: {
        plan: req.planName,
        price: req.plan.price,
        period: currentMonthKey(),
        used: usageCounters.get(getCounterKey(req.userToken)) || 0,
        limit: req.plan.monthlyMessages
      }
    });
  } catch (err) {
    console.error("ERRO /chat:", err);
    res.status(500).json({ error: "Erro no servidor", details: err.message });
  }
});

/** Porta */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 IA Orçamentista Backend na porta ${port}`));