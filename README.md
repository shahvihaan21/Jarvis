# Jarvis Command Center

Jarvis is a Django-based AI engineering workspace for conversations, memory, agent orchestration, and operational visibility.

## AI provider

The backend uses an OpenAI-compatible `/chat/completions` gateway with no vendor-specific SDK dependency.

Configure the provider before starting the server:

```powershell
$env:AI_API_KEY = "your-api-key"
$env:AI_BASE_URL = "https://api.openai.com/v1"
$env:AI_MODEL = "gpt-4o-mini"
```

Any compatible gateway can be used by changing `AI_BASE_URL` and `AI_MODEL`.

## Run

```powershell
python backend/manage.py migrate
python backend/manage.py runserver
```

The health probe is available at `GET /api/health/` and reports database, provider, model, and configuration status.

## Structure

- `frontend/templates` — command-center interface
- `frontend/static` — CSS and chat client
- `backend/todo` — conversations, AI gateway, and health API
- `backend/db.sqlite3` — development database
