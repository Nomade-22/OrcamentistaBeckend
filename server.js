import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";

dotenv.config();

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

/** CORS: permita GitHub Pages + localhost (admin e chat) */
const ALLOW_LIST = new Set([
  "https://nomade-22.github.io",
  "http://localhost:3000"
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOW_LIST.has(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  }
}));
app.options("*", cors());

/** ====== PERSISTÊNCIA EM JSON (VOLÁTIL ENTRE REDEPLOYS) ====== */
const DATA_FILE = "./data.json";

/** defaults */
const DEFAULT_PLANS = {
  free:   { monthlyMessages: 500,   price: "R$0,00/mês" },
  basico: { monthlyMessages: 10000, price: "R$19,90/mês" },
  pro:    { monthlyMessages: 50000, price: "R$49,90/mês" }
};

const DEFAULT_USERS = {
  "joao-silva": "free",
  "ana-souza": "free",
  "maria-oliveira": "basico",
  "pedro-almeida": "basico",
  "carlos-santos": "pro"
};

let PLANS = { ...DEFAULT_PLANS };
let USER_PLAN = { ...DEFAULT_USERS };

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const json = JSON.parse(raw || "{}");
      if (json.plans && typeof json.plans === "object") PLANS = json.plans;
      if (json.users && typeof json.users === "object") USER_PLAN = json.users;
      console.log("[DATA] Carregado de", DATA_FILE);
    } else {
      saveData(); // cria com defaults
    }
  } catch (e) {
    console.error("[DATA] Falha ao carregar:", e.message);
  }
}
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ plans: PLANS, users: USER_PLAN }, null, 2));
    console.log("[DATA] Salvo em", DATA_FILE);
  } catch (e) {
    console.error("[DATA] Falha ao salvar:", e.message);
  }
}
loadData();

/** CONTADORES EM MEMÓRIA: { "YYYY-MM|token": used } */
const usageCounters = new Map();

function currentMonthKey() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}
function counterKey(token) {
  return `${currentMonthKey()}|${token}`;
}

/** ====== MIDDLEWARES ====== */
/** auth do cliente para o chat */
function authUser(req, res, next) {
  const token = (req.header("X-Client-Token") || "").trim();
  if (!token) return res.status(401).json({ error: "Faltou o header X-Client-Token." });

  const planName = USER_PLAN[token];
  if (!planName) return res.status(403).json({ error: "Token inválido/não cadastrado." });

  req.userToken = token;
  req.planName = planName;
  req.plan = PLANS[planName];
  if (!req.plan) return res.status(500).json({ error: "Plano inexistente para este usuário." });
  next();
}

/** cota por plano */
function checkQuota(req, res, next) {
  const key = counterKey(req.userToken);
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
function incUsage(token) {
  const key = counterKey(token);
  usageCounters.set(key, (usageCounters.get(key) || 0) + 1);
}

/** proteção admin por header */
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
function adminAuth(req, res, next) {
  const secret = req.header("X-Admin-Secret") || "";
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "Não autorizado (admin)." });
  }
  next();
}

/** ====== ROTAS PÚBLICAS ====== */
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    app: "IA Orçamentista Backend",
    now: new Date().toISOString(),
    hasKey: Boolean(process.env.OPENAI_API_KEY),
    plans: Object.keys(PLANS),
    corsAllow: Array.from(ALLOW_LIST)
  });
});

app.get("/me", authUser, (req, res) => {
  const key = counterKey(req.userToken);
  const used = usageCounters.get(key) || 0;
  res.json({
    user: req.userToken,
    plan: req.planName,
    price: req.plan.price,
    monthlyLimit: req.plan.monthlyMessages,
    used,
    remaining: Math.max(req.plan.monthlyMessages - used, 0),
    period: currentMonthKey()
  });
});

/** ====== CHAT (respostas curtas e objetivas) ====== */
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
        temperature: 0.3,       // respostas mais estáveis
        max_tokens: 220,        // rede de segurança para não “textão”
        messages: [
          {
            role: "system",
            content:
              "Você é o IA Orçamentista. Responda sempre de forma curta, clara e objetiva, " +
              "preferencialmente em até 3 frases. Quando houver valores, use R$ e mostre apenas " +
              "o essencial para o usuário decidir. Evite rodeios, listas longas e repetições."
          },
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

    incUsage(req.userToken);

    res.json({
      reply,
      usage: {
        user: req.userToken,
        plan: req.planName,
        price: req.plan.price,
        period: currentMonthKey(),
        used: usageCounters.get(counterKey(req.userToken)) || 0,
        limit: req.plan.monthlyMessages
      }
    });
  } catch (err) {
    console.error("ERRO /chat:", err);
    res.status(500).json({ error: "Erro no servidor", details: err.message });
  }
});

/** ====== ROTAS ADMIN (protegidas por X-Admin-Secret) ====== */
app.get("/admin/state", adminAuth, (_req, res) => {
  res.json({ plans: PLANS, users: USER_PLAN });
});

app.post("/admin/plan", adminAuth, (req, res) => {
  const { name, monthlyMessages, price } = req.body || {};
  if (!name || !monthlyMessages || !price) {
    return res.status(400).json({ error: "Campos necessários: name, monthlyMessages, price" });
  }
  PLANS[name] = { monthlyMessages: Number(monthlyMessages), price: String(price) };
  saveData();
  res.json({ ok: true, plans: PLANS });
});

app.delete("/admin/plan/:name", adminAuth, (req, res) => {
  const name = req.params.name;
  if (!PLANS[name]) return res.status(404).json({ error: "Plano não encontrado" });

  const usedBy = Object.entries(USER_PLAN).filter(([_, p]) => p === name).map(([u]) => u);
  if (usedBy.length) {
    return res.status(409).json({ error: "Plano em uso por usuários", users: usedBy });
  }

  delete PLANS[name];
  saveData();
  res.json({ ok: true, plans: PLANS });
});

app.post("/admin/user", adminAuth, (req, res) => {
  const { token, plan } = req.body || {};
  if (!token || !plan) return res.status(400).json({ error: "Campos necessários: token, plan" });
  if (!PLANS[plan]) return res.status(404).json({ error: "Plano inexistente" });

  USER_PLAN[token] = plan;
  saveData();
  res.json({ ok: true, users: USER_PLAN });
});

app.delete("/admin/user/:token", adminAuth, (req, res) => {
  const token = req.params.token;
  if (!USER_PLAN[token]) return res.status(404).json({ error: "Usuário não encontrado" });

  delete USER_PLAN[token];
  usageCounters.delete(counterKey(token));
  saveData();
  res.json({ ok: true, users: USER_PLAN });
});

app.post("/admin/user/rename", adminAuth, (req, res) => {
  const { oldToken, newToken } = req.body || {};
  if (!oldToken || !newToken) return res.status(400).json({ error: "Campos necessários: oldToken, newToken" });
  if (!USER_PLAN[oldToken]) return res.status(404).json({ error: "Usuário antigo não existe" });
  if (USER_PLAN[newToken]) return res.status(409).json({ error: "Novo token já existe" });

  const plan = USER_PLAN[oldToken];
  delete USER_PLAN[oldToken];
  USER_PLAN[newToken] = plan;

  const oldKey = counterKey(oldToken);
  const newKey = counterKey(newToken);
  const used = usageCounters.get(oldKey) || 0;
  usageCounters.delete(oldKey);
  usageCounters.set(newKey, used);

  saveData();
  res.json({ ok: true, users: USER_PLAN });
});

/** Porta */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 IA Orçamentista Backend na porta ${port}`));