const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'propmind.json');

const SPECIALTIES = ['Plumbing', 'Electrical', 'HVAC', 'Pest Control', 'General Repairs'];

const DEFAULT_DATA = {
  knowledge: {
    company: 'Sunrise Property Management',
    specialties: SPECIALTIES,
    contractors: [
      { id: 1, name: 'John Murphy', specialty: 'Plumbing', phone: '312-555-0101', notes: 'Available 24/7 for emergencies' },
      { id: 2, name: 'AquaFix Pros', specialty: 'Plumbing', phone: '312-555-0102', notes: 'Bulk-pricing partner' },
      { id: 3, name: 'Sara Electric Co.', specialty: 'Electrical', phone: '312-555-0182', notes: 'Call before 8pm' },
      { id: 4, name: 'Volt Masters', specialty: 'Electrical', phone: '312-555-0184', notes: 'Specializes in old wiring' },
      { id: 5, name: 'CoolAir HVAC', specialty: 'HVAC', phone: '312-555-0143', notes: 'Best for heating emergencies' },
      { id: 6, name: 'Climate Kings', specialty: 'HVAC', phone: '312-555-0146', notes: 'Same-day AC service' },
      { id: 7, name: 'BugBusters', specialty: 'Pest Control', phone: '312-555-0211', notes: 'Eco-friendly treatments' },
      { id: 8, name: 'Pest Patrol', specialty: 'Pest Control', phone: '312-555-0215', notes: 'Rodent specialists' },
      { id: 9, name: 'FixIt General', specialty: 'General Repairs', phone: '312-555-0167', notes: 'Good for small jobs' },
    ],
    rules: [
      'Emergency repairs must be responded to within 2 hours',
      'Non-emergency repairs must be scheduled within 5 business days',
      'Any repair over $500 requires owner approval before proceeding',
      'Always send tenant a confirmation within 1 hour of receiving request',
      'Document all repairs with photos before and after',
    ],
    properties: [
      {
        id: 1, name: 'Riverside Apartments', address: '204 Riverside Dr', units: 12,
        owner: 'Mr. James Wilson', ownerPhone: '312-555-0190',
        preferredContractors: {
          'Plumbing': 'John Murphy',
          'Electrical': 'Sara Electric Co.',
          'HVAC': 'CoolAir HVAC',
          'Pest Control': 'BugBusters',
          'General Repairs': 'FixIt General',
        },
      },
      {
        id: 2, name: 'Maple Street Complex', address: '87 Maple St', units: 8,
        owner: 'Mrs. Linda Chen', ownerPhone: '312-555-0155',
        preferredContractors: {
          'Plumbing': 'AquaFix Pros',
          'Electrical': 'Volt Masters',
          'HVAC': 'Climate Kings',
          'Pest Control': 'Pest Patrol',
          'General Repairs': 'FixIt General',
        },
      },
      {
        id: 3, name: 'Downtown Lofts', address: '15 W Monroe St', units: 6,
        owner: 'Downtown Props LLC', ownerPhone: '312-555-0133',
        preferredContractors: {
          'Plumbing': 'John Murphy',
          'Electrical': 'Volt Masters',
          'HVAC': 'Climate Kings',
          'Pest Control': 'BugBusters',
          'General Repairs': 'FixIt General',
        },
      },
    ],
  },
  requests: [
    { id: 1, tenant: 'Maria Garcia', property: 'Riverside Apartments', unit: '4B', issue: 'Kitchen sink leaking badly', category: 'Plumbing', urgency: 'High', status: 'In Progress', contractor: 'John Murphy', date: '2026-04-28', notes: 'Plumber scheduled for tomorrow 9am' },
    { id: 2, tenant: 'David Kim', property: 'Maple Street Complex', unit: '2A', issue: 'Heater not working', category: 'HVAC', urgency: 'Emergency', status: 'Resolved', contractor: 'Climate Kings', date: '2026-04-27', notes: 'Fixed same day' },
    { id: 3, tenant: 'Priya Patel', property: 'Downtown Lofts', unit: '1C', issue: 'Light flickering in bedroom', category: 'Electrical', urgency: 'Normal', status: 'Open', contractor: 'Unassigned', date: '2026-04-29', notes: '' },
  ],
  nextRequestId: 4,
};

function load() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    console.error('DB load error, resetting:', err.message);
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

let data = load();

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const getKnowledge = () => ({
  ...data.knowledge,
  specialties: data.knowledge.specialties || SPECIALTIES,
});

const getRequests = () => [...data.requests].sort((a, b) => b.id - a.id);

const insertRequest = (r) => {
  const newRow = { id: data.nextRequestId++, ...r };
  data.requests.push(newRow);
  save();
  return newRow;
};

const updateRequest = (id, patch) => {
  const idx = data.requests.findIndex(r => r.id === id);
  if (idx === -1) return null;
  data.requests[idx] = { ...data.requests[idx], ...patch, id };
  save();
  return data.requests[idx];
};

const updateKnowledge = (kb) => {
  if (typeof kb.company === 'string') data.knowledge.company = kb.company;
  if (Array.isArray(kb.contractors)) {
    data.knowledge.contractors = kb.contractors.map((c, i) => ({
      id: i + 1,
      name: c.name || '',
      specialty: c.specialty || 'General Repairs',
      phone: c.phone || '',
      notes: c.notes || '',
    }));
  }
  if (Array.isArray(kb.rules)) {
    data.knowledge.rules = kb.rules.map(t => (typeof t === 'string' ? t : t.text || ''));
  }
  if (Array.isArray(kb.properties)) {
    data.knowledge.properties = kb.properties.map((p, i) => ({
      id: i + 1,
      name: p.name || '',
      address: p.address || '',
      units: p.units || 0,
      owner: p.owner || '',
      ownerPhone: p.ownerPhone || '',
      preferredContractors: p.preferredContractors && typeof p.preferredContractors === 'object'
        ? { ...p.preferredContractors }
        : {},
    }));
  }
  data.knowledge.specialties = SPECIALTIES;
  save();
  return getKnowledge();
};

module.exports = { getKnowledge, getRequests, insertRequest, updateRequest, updateKnowledge, SPECIALTIES };
