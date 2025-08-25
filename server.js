import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();

// LOGS DE BOOT
console.log("[BOOT] Tem OPENAI_API_KEY?", !!process.env.OPENAI_API_KEY);
console.log("[BOOT] ALLOWED_ORIGIN:", process.env.ALLOWED_ORIGIN);

// CORS: permite sem Origin (curl/reqbin) e permite seu GitHub Pages
const allowedOrigin = process.env.ALLOWED_ORIGIN; // ex.: https://nomade-22.github.io/CalcGPT
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // reqs sem origin (curl, reqbin)
    if (origin === allowedOrigin) return cb(null, true);
    return cb(new Error("Não autorizado pelo CORS: " + origin));
  }
}));

app.use(bodyParser.json({ limit: "1mb" }));

// HEALTH CHECK (sem vazar a chave)
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    app: "IA Orçamentista Backend",
    hasKey: Boolean(process.env.OPENAI_API_KEY),
    originAllowed: allowedOrigin || null,
    now: new Date().toISOString()
  });
});

// CHAT
app.post("/chat", async (req, res) => {
  try {
    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) return res.status(400).json({ error: "Mensagem vazia." });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("❌ OPENAI_API_KEY ausente no servidor!");
      return res.status(500).json({ error: "OPENAI_API_KEY ausente no servidor." });
    }

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

    const text = await r.text();
    if (!r.ok) {
      console.error("❌ OpenAI ERRO:", r.status, text);
      return res.status(500).json({ error: "Falha ao chamar OpenAI", details: text.slice(0, 500) });
    }

    let data;
    try { data = JSON.parse(text); }
    catch {
      console.error("❌ JSON inválido da OpenAI:", text);
      return res.status(500).json({ error: "Resposta inválida da OpenAI", raw: text.slice(0, 500) });
    }

    const reply = data?.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta.";
    res.json({ reply });

  } catch (err) {
    console.error("❌ ERRO /chat:", err);
    res.status(500).json({ error: "Erro no servidor", details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 IA Orçamentista Backend rodando na porta ${port}`);
});

// DEBUG: manter por enquanto
app.get("/debug-env", (_req, res) => {
  res.json({
    hasKey: !!process.env.OPENAI_API_KEY,
    keyPrefix: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 7) : null,
    allowedOrigin
  });
});