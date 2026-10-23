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
## Current skills

Jarvis supports time/date, greetings, jokes, web/Wikipedia/YouTube links, website shortcuts,
to-dos, notes, reminders, persistent memories, weather, and a news briefing. Use `help` in the
command console to see the local skills.

The JSON endpoints are `/api/health/`, `/api/productivity/`, and `/api/briefing/?location=New%20Delhi`.

## Adding a skill

For a small local command, add a focused matcher/handler in `backend/todo/views.py` and cover it
with a test in `backend/todo/tests.py`. For persistent data, add a model and migration, then expose
only the smallest required API endpoint. Keep secrets in environment variables; never commit keys.

## Voice and audio

Use Chrome or Edge on `127.0.0.1` and allow microphone access. `START VOICE` enables speech
recognition, `SPEAK REPLIES` enables speech synthesis, and the audio control remembers mute state.
The allowed startup theme is `frontend/static/audio/jarvis-theme.mp3` and plays once after user
interaction because browsers block autoplay.
