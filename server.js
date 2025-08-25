// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv"; // opcional no Render; não atrapalha
dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// ===== Variáveis de ambiente =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // << tem que existir no Render
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN; // ex.: https://nomade-22.github.io/CalcGPT

// Log diagnóstico (seguro)
console.log("[BOOT] Tem OPENAI_API_KEY?", !!OPENAI_API_KEY);
console.log("[BOOT] ALLOWED_ORIGIN:", ALLOWED_ORIGIN);

// ===== CORS =====
app.use(
  cors({
    origin: (origin, cb) => {
      // permite sem origin (health checks) e o seu front
      if (!origin || origin === ALLOWED_ORIGIN) return cb(null, true);
      return cb(new Error("Origin não permitido: " + origin));
    },
  })
);

// ===== Health check =====
app.get("/", (_req, res) => {
  res.json({ ok: true, app: "IA Orçamentista Backend", now: new Date().toISOString() });
});

// ===== Rota de chat =====
app.post("/chat", async (req, res) => {
  try {
    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) return res.status(400).json({ error: "Mensagem vazia." });

    if (!OPENAI_API_KEY) {
      // se cair aqui, a env não está disponível na instância
      return res.status(500).json({ error: "OPENAI_API_KEY ausente no servidor." });
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é o IA Orçamentista. Responda com clareza, em R$ quando houver valores." },
          { role: "user", content: userMessage },
        ],
      }),
    });

    const raw = await r.text();
    if (!r.ok) {
      console.error("OpenAI ERRO:", r.status, raw);
      return res.status(502).json({ error: "Falha ao chamar OpenAI", details: raw });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "Resposta inválida da OpenAI", raw });
    }

    const reply = data?.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta.";
    res.json({ reply });
  } catch (err) {
    console.error("ERRO /chat:", err);
    res.status(500).json({ error: "Erro no servidor", details: err.message });
  }
});

// ===== Porta =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`IA Orçamentista Backend na porta ${PORT}`));