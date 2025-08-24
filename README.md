# IA Orçamentista – Backend (Render)

Servidor Node.js/Express para proteger sua OPENAI_API_KEY e atender o site estático (GitHub Pages).

## Endpoints
- `GET /` -> health check
- `POST /chat` -> recebe `{ "message": "..." }` e retorna `{ "reply": "..." }`

## Variáveis de Ambiente no Render
- `OPENAI_API_KEY` -> sua chave da OpenAI
- `ALLOWED_ORIGIN`  -> (opcional) domínio permitido do seu site. Ex.: `https://nomade-22.github.io`

## Deploy no Render
1. Crie um repositório Git com estes arquivos.
2. No Render: **New → Web Service** e conecte o repositório.
3. **Start Command**: `node server.js` (o Render faz `npm install` automaticamente).
4. Adicione a variável `OPENAI_API_KEY`.
5. Deploy. Guarde a URL final: `https://SEUAPP.onrender.com`.

## Testes
- Abra `https://SEUAPP.onrender.com/` -> deve retornar JSON `{ ok: true, app: "IA Orçamentista Backend", ... }`
- Poste no `/chat` com body `{ "message": "Teste de orçamento" }`.
