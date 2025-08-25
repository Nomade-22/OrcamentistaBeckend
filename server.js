import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();

// Logs de diagnóstico no boot
console.log("[BOOT] Tem OPENAI_API_KEY?", !!process.env.OPENAI_API_KEY);
console.log("[BOOT] ALLOWED_ORIGIN:", process.env.ALLOWED_ORIGIN);

// Configuração CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*"
}));

app.use(bodyParser.json({ limit: "1mb" }));

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, app: "IA Orçamentista Backend", now: new Date().toISOString() });
});

// Chat
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
      return res.status(500).json({ error: "Falha ao chamar OpenAI", details: text });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ JSON inválido da OpenAI:", text);
      return res.status(500).json({ error: "Resposta inválida da OpenAI", raw: text });
    }

    const reply = data?.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta.";
    res.json({ reply });

  } catch (err) {
    console.error("❌ ERRO /chat:", err);
    res.status(500).json({ error: "Erro no servidor", details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 IA Orçamentista Backend rodando na porta ${port}`));