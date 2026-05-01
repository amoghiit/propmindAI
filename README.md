# PropMind AI

AI-powered property management assistant. Tenants submit maintenance requests; Llama (via Groq) classifies the issue, drafts a tenant reply, assigns a contractor from your knowledge base, and flags emergencies.

## Stack
- **Backend:** Node.js + Express
- **AI:** Groq (`llama-3.3-70b-versatile`, free tier)
- **DB:** Simple JSON file — `propmind.json` is auto-created
- **Frontend:** Single `public/index.html` with Tailwind (CDN)

## Setup
```bash
npm install
copy .env.example .env       # then edit .env and add your GROQ_API_KEY
# Get a free key at https://console.groq.com/keys
npm start
```
Open http://localhost:3000

## Features
- **Triage tab** — submit a tenant message, get AI category/urgency, contractor assignment, drafted reply, internal note, emergency alert
- **Requests tab** — dashboard with stats, status updates inline
- **Knowledge Base tab** — edit company name, contractors, properties, and rules; everything persists in SQLite

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/requests` | List all maintenance requests |
| PATCH | `/api/requests/:id` | Update status / fields |
| GET | `/api/knowledge` | Get company KB |
| POST | `/api/knowledge` | Replace company KB |
| POST | `/api/analyze` | Run AI triage on a tenant message |

## Files
- `server.js` — Express app + Anthropic call
- `db.js` — SQLite schema, seed data, CRUD helpers
- `public/index.html` — entire frontend (no build step)
- `propmind.db` — created at runtime (gitignore it)
