# PropMind AI

AI-powered property management assistant. Tenants submit maintenance requests in plain English; Llama 3.3 (via Groq) classifies the issue, judges urgency, drafts a tenant reply, and assigns the right contractor based on **per-property** preferences stored in a knowledge base.

## 🌐 Live Demo

| Audience | URL |
|---|---|
| **Tenant view** (submit a request) | https://propmind-ai.vercel.app/ |
| **Admin panel** (dashboard + KB editor) | https://propmind-ai.vercel.app/admin |

> ℹ️ Admin access is password-protected. Default password is set via the `ADMIN_PASSWORD` environment variable.
>
> ⚠️ **Cold-start note:** the app sleeps when idle (Vercel serverless). The first request after a few minutes may take 2–3 seconds to wake up. Submitted requests + Knowledge Base edits reset on cold start; the **seeded contractors and properties always reload from `db.js`** so the demo baseline is consistent.

## 🧠 What makes it smart

- **Per-property contractor routing** — same category (e.g. Pest Control) routes to *different* contractors depending on which building the request came from. The AI reads each property's preferred-contractor map from the knowledge base.
- **In-context learning, not fine-tuning** — the entire knowledge base is injected into every prompt. Add a contractor in the admin UI → AI knows about them on the next request. Zero retraining cost.
- **Forced JSON output** — Groq's `response_format: json_object` guarantees parseable structured replies (category, urgency, tenantReply, assignedContractor, notifyOwner, internalNote, teamAlert, isEmergency).

## 🏗️ Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 24 |
| Server | Express 4 |
| AI | Groq Cloud — `llama-3.3-70b-versatile` (free tier) |
| Database | JSON file (`propmind.json`) abstracted behind a 5-function API |
| Frontend | Vanilla JS + Tailwind CSS (CDN, no build step) |
| Auth | HttpOnly cookie session, password from env var |
| Hosting | Vercel (serverless) |

## ⚡ Local Setup

```bash
git clone https://github.com/amoghiit/propmindAI.git
cd propmindAI
npm install
copy .env.example .env       # then edit .env and add your GROQ_API_KEY
# Get a free Groq key at https://console.groq.com/keys
npm start
```

Open http://localhost:3000

### Required environment variables

```env
GROQ_API_KEY=gsk_...                    # https://console.groq.com/keys
GROQ_MODEL=llama-3.3-70b-versatile      # default; any Groq model works
ADMIN_PASSWORD=propmind123              # admin panel password
PORT=3000                               # not used on Vercel
```

## 🎯 Features

### Tenant view (`/`)
- Clean, mobile-friendly maintenance request form
- AI-drafted reply shown immediately upon submission
- Urgency + category badges, emergency banner when applicable

### Admin panel (`/admin`)
- **Triage tab** — manually run a tenant message through the AI
- **Requests tab** — full dashboard with stats (Open / In Progress / Emergencies / Resolved); inline status updates
- **Knowledge Base tab** — edit company name, contractors (with specialty dropdowns), properties (each with per-specialty preferred-contractor dropdowns), and operational rules

## 🔌 API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | public | Tenant submit form |
| `GET` | `/admin` | redirects to login if no cookie | Admin panel |
| `POST` | `/api/admin/login` | public | Set auth cookie |
| `POST` | `/api/admin/logout` | public | Clear auth cookie |
| `POST` | `/api/analyze` | public | Run AI triage on a tenant message |
| `GET` | `/api/knowledge` | public (returns redacted) / admin (full) | Get company KB |
| `POST` | `/api/knowledge` | **admin** | Replace company KB |
| `GET` | `/api/requests` | **admin** | List all maintenance requests |
| `PATCH` | `/api/requests/:id` | **admin** | Update status / fields |

Public `/api/knowledge` returns only company name + property names. Contractor phones, owner contacts, and rules require admin auth.

## 📁 Project Structure

```
propmindAI/
├── server.js              # Express app + auth + Groq integration
├── db.js                  # JSON file database (5-function API)
├── vercel.json            # Vercel serverless routing
├── package.json           # Dependencies
├── .env.example           # Env var template
├── public/
│   ├── index.html         # Tenant submit form
│   ├── admin.html         # Admin panel (Triage / Requests / KB)
│   └── login.html         # Admin login screen
└── propmind.json          # Auto-generated DB (gitignored, on Vercel writes to /tmp)
```

## 🚀 Deploy your own

Click below or fork and import to Vercel manually. Set the three env vars listed above.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/amoghiit/propmindAI)

## 📜 License

MIT
