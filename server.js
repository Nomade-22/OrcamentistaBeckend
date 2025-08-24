import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();

// ===== CORS (ajuste o domínio do seu site aqui ou via env) =====
const ORIGIN = process.env.ALLOWED_ORIGIN || "https://nomade-22.github.io";
app.use(cors({ origin: ORIGIN }));

app.use(bodyParser.json({ limit: "1mb" }));

// ===== Health check =====
app.get("/", (req, res) => {
  res.json({ ok: true, app: "IA Orçamentista Backend", originAllowed: ORIGIN });
});

// ===== Endpoint do chat =====
app.post("/chat", async (req, res) => {
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
          { role: "system", content: "Você é o IA Orçamentista, especialista em cálculos e orçamentos de obras e serviços. Responda de forma clara, profissional e objetiva. Formate valores em reais (R$ 0.000,00). Se houver etapas, detalhe resumidamente." },
          { role: "user", content: userMessage }
        ]
      })
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: "Falha ao chamar OpenAI", details: text });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta.";
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: "Erro no servidor", details: err.message });
  }
});

// ===== Porta =====
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`IA Orçamentista Backend rodando na porta ${port}`));
