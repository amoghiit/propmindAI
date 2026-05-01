require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- Auth (simple cookie-based) ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'propmind123';
const COOKIE_NAME = 'pm_admin';

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const [k, ...rest] = p.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('='));
  });
  return out;
}
function isAdmin(req) {
  return parseCookies(req)[COOKIE_NAME] === ADMIN_PASSWORD;
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(ADMIN_PASSWORD)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ success: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ authenticated: isAdmin(req) });
});

// --- Admin route: serve login or admin.html ---
app.get('/admin', (req, res) => {
  if (isAdmin(req)) {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- Public read of knowledge (tenants need property list) ---
app.get('/api/knowledge', (req, res) => {
  const kb = db.getKnowledge();
  // Tenant view only needs company + properties (names). Strip sensitive details.
  if (!isAdmin(req)) {
    return res.json({
      company: kb.company,
      properties: kb.properties.map(p => ({ id: p.id, name: p.name })),
    });
  }
  res.json(kb);
});

// --- Admin-only endpoints ---
app.get('/api/requests', requireAdmin, (req, res) => res.json(db.getRequests()));

app.post('/api/knowledge', requireAdmin, (req, res) => {
  try {
    const updated = db.updateKnowledge(req.body || {});
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update knowledge base' });
  }
});

app.patch('/api/requests/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const updated = db.updateRequest(id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// Static files (after admin route so /admin doesn't try to match admin.html directly)
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', async (req, res) => {
  const { message, tenantName, property, unit } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured. Add it to your .env file.' });
  }

  const kb = db.getKnowledge();
  const contractorByName = Object.fromEntries(kb.contractors.map(c => [c.name, c]));
  const propertiesBlock = kb.properties.map(p => {
    const prefs = p.preferredContractors || {};
    const lines = Object.entries(prefs).map(([cat, name]) => {
      const c = contractorByName[name];
      return `    ${cat} -> ${name}${c ? ` (${c.phone})` : ''}`;
    }).join('\n');
    return `- ${p.name} at ${p.address} | Owner: ${p.owner} (${p.ownerPhone})\n  Preferred contractors for this property:\n${lines || '    (none configured)'}`;
  }).join('\n');

  const systemPrompt = `You are PropMind AI, the intelligent assistant for ${kb.company}.

CATEGORIES (pick exactly one): ${(kb.specialties || []).join(', ')}.

ALL CONTRACTORS (reference list):
${kb.contractors.map(c => `- ${c.name} | ${c.specialty} | ${c.phone} | Notes: ${c.notes}`).join('\n')}

COMPANY RULES:
${kb.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

PROPERTIES (each property has its OWN preferred contractor for each category):
${propertiesBlock}

CRITICAL ASSIGNMENT RULE:
When assigning a contractor, ALWAYS use the preferred contractor listed for the request's property AND category.
For example: a Pest Control issue at "Maple Street Complex" must be assigned to that property's Pest Control preferred contractor.
Only fall back to another contractor with the same specialty if the property has no preferred contractor for that category.

Return ONLY valid JSON, no markdown, exactly this structure:
{
  "category": "Plumbing",
  "urgency": "Emergency",
  "tenantReply": "Dear [tenant name], Thank you for contacting us...",
  "assignedContractor": "John Murphy - 312-555-0101",
  "notifyOwner": true,
  "internalNote": "Short note for the team",
  "teamAlert": "EMERGENCY: description",
  "isEmergency": true
}

If not emergency set teamAlert to "" and isEmergency to false.
urgency must be exactly one of: Emergency, High, Normal, Low`;

  const userMessage = `Tenant: ${tenantName || 'Unknown'}
Property: ${property || 'Unknown'} | Unit: ${unit || 'Unknown'}
Message: "${message}"`;

  try {
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.choices || !data.choices[0]?.message?.content) {
      console.error('Groq API error:', JSON.stringify(data));
      return res.status(502).json({
        error: data?.error?.message || 'AI service returned an error',
      });
    }

    const text = data.choices[0].message.content;
    const clean = text.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(502).json({ error: 'AI returned a non-JSON response' });
    }

    let result;
    try {
      result = JSON.parse(clean.slice(start, end + 1));
    } catch (e) {
      return res.status(502).json({ error: 'Failed to parse AI response as JSON' });
    }

    const newRequest = db.insertRequest({
      tenant: tenantName || 'Unknown',
      property: property || 'Unknown',
      unit: unit || 'Unknown',
      issue: message,
      category: result.category || 'General',
      urgency: result.urgency || 'Normal',
      status: 'Open',
      contractor: result.assignedContractor || 'Unassigned',
      date: new Date().toISOString().split('T')[0],
      notes: result.internalNote || '',
    });

    res.json({ ...result, requestId: newRequest.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI analysis failed: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`PropMind AI running at http://localhost:${PORT}`));
}

module.exports = app;
