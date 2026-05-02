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

// --- Email helper (Resend) ---
async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) return { skipped: true, reason: 'no_api_key' };
  if (!to || !/.+@.+\..+/.test(to)) return { skipped: true, reason: 'no_recipient' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'PropMind AI <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
        text,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('Resend error:', data);
      return { sent: false, error: data.message || 'send failed' };
    }
    return { sent: true, id: data.id, to };
  } catch (err) {
    console.error('Resend exception:', err.message);
    return { sent: false, error: err.message };
  }
}

const urgencyColor = {
  Emergency: '#dc2626',
  High: '#ea580c',
  Normal: '#2563eb',
  Low: '#64748b',
};

function emailShell(title, contentHtml, accent = '#6366f1') {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:linear-gradient(135deg,${accent},#8b5cf6);padding:24px 28px;color:#ffffff">
<div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.85">PropMind AI</div>
<div style="font-size:22px;font-weight:700;margin-top:4px">${title}</div>
</td></tr>
<tr><td style="padding:28px;color:#0f172a;font-size:15px;line-height:1.6">${contentHtml}</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">Sent automatically by PropMind AI \u2014 the intelligent property management assistant.</td></tr>
</table></td></tr></table></body></html>`;
}

app.post('/api/analyze', async (req, res) => {
  const { message, tenantName, tenantEmail, property, unit } = req.body || {};
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

LANGUAGE RULE (very important):
- Detect the language the tenant wrote their message in (English, Spanish, Hindi, French, Arabic, Mandarin, etc.).
- "tenantReply" MUST be written in the SAME language as the tenant's message, naturally and warmly.
- "internalNote" and "teamAlert" MUST always be in English (they are for the property manager).
- "category" MUST be in English (it is a fixed enum).
- Add a "detectedLanguage" field to your response with the language name in English (e.g. "Spanish", "Hindi", "English").

Return ONLY valid JSON, no markdown, exactly this structure:
{
  "category": "Plumbing",
  "urgency": "Emergency",
  "detectedLanguage": "English",
  "tenantReply": "Dear [tenant name], Thank you for contacting us...",
  "assignedContractor": "John Murphy - 312-555-0101",
  "notifyOwner": true,
  "internalNote": "Short note for the team (always English)",
  "teamAlert": "EMERGENCY: description (always English)",
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

    // Resolve recipients from KB
    const propertyObj = kb.properties.find(p => p.name === property) || {};
    const contractorName = (result.assignedContractor || '').split(' - ')[0].trim();
    const contractorObj = kb.contractors.find(c => c.name === contractorName) || {};
    const accent = urgencyColor[result.urgency] || '#6366f1';

    // Build notification payloads
    const tenantHtml = emailShell(
      `Request received \u2014 #PLACEHOLDER_ID`,
      `<p>${result.tenantReply || 'Thank you for your request. Our team will be in touch shortly.'}</p>
       <table cellpadding="0" cellspacing="0" style="margin-top:18px;width:100%;background:#f8fafc;border-radius:8px;overflow:hidden">
         <tr><td style="padding:12px 16px;font-size:13px;color:#475569"><b>Property:</b> ${property || 'Unknown'} \u2014 Unit ${unit || 'Unknown'}</td></tr>
         <tr><td style="padding:12px 16px;font-size:13px;color:#475569;border-top:1px solid #e2e8f0"><b>Category:</b> ${result.category} \u00b7 <b>Priority:</b> <span style="color:${accent}">${result.urgency}</span></td></tr>
       </table>
       ${result.isEmergency ? `<div style="margin-top:16px;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:13px"><b>Marked as emergency.</b> Our on-call team has been alerted.</div>` : ''}`,
      accent
    );

    const contractorHtml = emailShell(
      `New ${result.urgency} job \u2014 ${result.category}`,
      `<p>You have been dispatched to handle a ${result.category.toLowerCase()} issue.</p>
       <table cellpadding="0" cellspacing="0" style="margin-top:14px;width:100%;background:#f8fafc;border-radius:8px;overflow:hidden;font-size:14px">
         <tr><td style="padding:12px 16px;color:#475569"><b>Property:</b> ${property} \u2014 Unit ${unit}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Address:</b> ${propertyObj.address || 'See property records'}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Tenant:</b> ${tenantName || 'Unknown'}${tenantEmail ? ` (${tenantEmail})` : ''}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Issue (verbatim):</b> ${message.replace(/</g, '&lt;')}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Internal note:</b> ${result.internalNote || '\u2014'}</td></tr>
       </table>
       <p style="margin-top:18px;color:#64748b;font-size:13px">Please reply to confirm ETA. If this is an emergency, dispatch immediately.</p>`,
      accent
    );

    const ownerHtml = emailShell(
      `${result.urgency} issue at ${property}`,
      `<p>${result.notifyOwner ? 'Your attention is requested for the following maintenance issue:' : 'For your awareness:'}</p>
       <table cellpadding="0" cellspacing="0" style="margin-top:14px;width:100%;background:#f8fafc;border-radius:8px;overflow:hidden;font-size:14px">
         <tr><td style="padding:12px 16px;color:#475569"><b>Property:</b> ${property} \u2014 Unit ${unit}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Category:</b> ${result.category} \u00b7 <b>Priority:</b> ${result.urgency}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Tenant:</b> ${tenantName}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Assigned contractor:</b> ${result.assignedContractor || 'TBD'}</td></tr>
         <tr><td style="padding:12px 16px;color:#475569;border-top:1px solid #e2e8f0"><b>Issue:</b> ${message.replace(/</g, '&lt;')}</td></tr>
       </table>`,
      accent
    );

    // Insert request first to get the ID
    const newRequest = db.insertRequest({
      tenant: tenantName || 'Unknown',
      tenantEmail: tenantEmail || '',
      property: property || 'Unknown',
      unit: unit || 'Unknown',
      issue: message,
      category: result.category || 'General',
      urgency: result.urgency || 'Normal',
      status: 'Open',
      contractor: result.assignedContractor || 'Unassigned',
      date: new Date().toISOString().split('T')[0],
      notes: result.internalNote || '',
      detectedLanguage: result.detectedLanguage || 'English',
    });

    // Send emails in parallel
    const [tenantRes, contractorRes, ownerRes] = await Promise.all([
      sendEmail({
        to: tenantEmail,
        subject: `Request #${newRequest.id} received \u2014 ${kb.company}`,
        html: tenantHtml.replace('#PLACEHOLDER_ID', `#${newRequest.id}`),
        text: result.tenantReply || 'Your maintenance request has been received.',
      }),
      sendEmail({
        to: contractorObj.email,
        subject: `${result.urgency === 'Emergency' ? '\ud83d\udea8 EMERGENCY: ' : ''}${result.category} dispatch \u2014 ${property} ${unit}`,
        html: contractorHtml,
        text: `New ${result.category} job at ${property} ${unit}. Tenant: ${tenantName}. Issue: ${message}`,
      }),
      result.notifyOwner ? sendEmail({
        to: propertyObj.ownerEmail,
        subject: `${result.urgency} issue at ${property}`,
        html: ownerHtml,
        text: `${result.urgency} ${result.category} issue at ${property} ${unit}. Tenant: ${tenantName}. Assigned: ${result.assignedContractor}.`,
      }) : Promise.resolve({ skipped: true, reason: 'notifyOwner_false' }),
    ]);

    const notifications = {
      tenant: tenantRes,
      contractor: contractorRes,
      owner: ownerRes,
    };
    db.updateRequest(newRequest.id, { notifications });

    res.json({ ...result, requestId: newRequest.id, notifications });
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
