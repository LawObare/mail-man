// ============================================================
// GMAIL OAUTH + CATEGORIZATION ENGINE
// ============================================================

// Lucide-style inline icons (stroke-based, currentColor)
const ICONS = {
  lock: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  inbox: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  x: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  calculator: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>',
  graduationCap: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>',
  briefcase: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>',
  wallet: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>',
  megaphone: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  tag: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>'
};

// Global state
let allEmails = [];
let categorizedEmails = [];
let currentFilter = 'All';
let centroids = [];
let vocab = {};
let idfWeights = [];
let svdMatrix = [];
let customCategories = [];
let isProcessing = false;
let demoMode = false;

// ============================================================
// 1. LOAD WEIGHTS FROM ASSETS
// ============================================================

async function loadWeights() {
  try {
    console.log('Loading weights...');

    const vocabResp = await fetch(chrome.runtime.getURL('assets/vocab.json'));
    vocab = await vocabResp.json();

    const idfResp = await fetch(chrome.runtime.getURL('assets/idf_weights.json'));
    idfWeights = await idfResp.json();

    const svdResp = await fetch(chrome.runtime.getURL('assets/svd_matrix.json'));
    svdMatrix = await svdResp.json();

    const centroidResp = await fetch(chrome.runtime.getURL('assets/centroids.json'));
    centroids = await centroidResp.json();

    console.log('Weights loaded:', {
      vocabSize: Object.keys(vocab).length,
      idfSize: idfWeights.length,
      svdShape: [svdMatrix.length, svdMatrix[0]?.length || 0],
      centroidCount: centroids.length
    });

    // Load custom categories from storage
    await loadCustomCategories();

    return true;
  } catch (error) {
    console.error('Failed to load weights:', error);
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Missing model weights. Run the training notebook first.';
    return false;
  }
}

// ============================================================
// 2. GMAIL OAUTH
// ============================================================

function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

function isClientIdConfigured() {
  try {
    const clientId = chrome.runtime.getManifest().oauth2?.client_id || '';
    return Boolean(clientId) && !clientId.includes('YOUR_GOOGLE_CLIENT_ID');
  } catch (e) {
    return false;
  }
}

function decodeBase64Url(data) {
  if (!data) return '';
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function extractBody(part) {
  if (!part) return '';

  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === 'text/plain') {
      return decoded;
    }
    if (part.mimeType === 'text/html') {
      return decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const body = extractBody(child);
      if (body) return body;
    }
  }

  return '';
}

async function fetchEmailDetails(token, messageIds) {
  const results = new Array(messageIds.length);
  const CONCURRENCY = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < messageIds.length) {
      const i = cursor++;
      try {
        const resp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageIds[i]}?format=full`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        if (!resp.ok) continue;

        const detail = await resp.json();
        const parsed = parseEmail(detail);
        if (parsed) {
          results[i] = parsed;
        }
      } catch (e) {
        console.warn('Failed to fetch email:', e);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, messageIds.length) }, worker));
  return results.filter(Boolean);
}

async function fetchEmails(token, maxResults = 50) {
  const listResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!listResp.ok) {
    throw new Error(`Gmail API error: ${listResp.status}`);
  }

  const listData = await listResp.json();
  const messages = listData.messages || [];

  console.log(`Found ${messages.length} emails`);
  return fetchEmailDetails(token, messages.map(m => m.id));
}

function parseEmail(detail) {
  try {
    // Extract headers
    const headers = detail.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name === 'From')?.value || 'Unknown';

    // Extract body (handles nested multipart parts)
    const body = extractBody(detail.payload).substring(0, 2000); // Limit for performance

    return {
      id: detail.id,
      subject: subject,
      from: from,
      body: body,
      fullText: subject + ' ' + body
    };
  } catch (error) {
    console.warn('Failed to parse email:', error);
    return null;
  }
}

// ============================================================
// 3. MATH ENGINE (JavaScript implementation of SVD + TF-IDF)
// ============================================================

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1);
}

function computeTFIDFVector(tokens, vocab, idfWeights) {
  // Count frequencies
  const freq = {};
  for (const token of tokens) {
    freq[token] = (freq[token] || 0) + 1;
  }

  // Build TF-IDF vector in sparse format
  const vector = {};
  for (const [word, count] of Object.entries(freq)) {
    const idx = vocab[word];
    if (idx !== undefined && idx < idfWeights.length) {
      const tf = Math.log(1 + count);
      const idf = idfWeights[idx];
      vector[idx] = tf * idf;
    }
  }

  return vector;
}

function projectToLatentSpace(sparseVector, svdMatrix) {
  // Project sparse TF-IDF vector to 50D using SVD matrix
  const projected = new Float64Array(50).fill(0);

  for (const [idx, value] of Object.entries(sparseVector)) {
    const col = parseInt(idx);
    if (col < svdMatrix[0]?.length) {
      for (let d = 0; d < 50; d++) {
        projected[d] += value * (svdMatrix[d]?.[col] || 0);
      }
    }
  }

  return projected;
}

function normalizeVector(vec) {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

function categorizeEmail(projectedVector, centroids, customCategories) {
  let bestCategory = 'Other';
  let bestScore = -1;

  // Combine default centroids with custom categories
  const allCentroids = [
    ...centroids,
    ...customCategories.map(c => c.vector)
  ];
  const allLabels = [
    'Education', 'Work', 'Finance', 'Promotions',
    ...customCategories.map(c => c.name)
  ];

  for (let i = 0; i < allCentroids.length; i++) {
    const score = cosineSimilarity(projectedVector, allCentroids[i]);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = allLabels[i];
    }
  }

  return {
    category: bestCategory,
    confidence: Math.max(0, Math.min(1, bestScore)),
    // Store all scores for the math visualizer
    allScores: allCentroids.map((c, i) => ({
      label: allLabels[i],
      score: Math.max(0, Math.min(1, cosineSimilarity(projectedVector, c)))
    }))
  };
}

// ============================================================
// 4. MAIN PROCESSING PIPELINE
// ============================================================

async function processEmails(emails) {
  isProcessing = true;
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = 'Processing emails...';

  const results = [];

  for (const email of emails) {
    // Tokenize
    const tokens = tokenize(email.fullText);

    // TF-IDF vector
    const tfidfVector = computeTFIDFVector(tokens, vocab, idfWeights);

    // Project to 50D
    const projected = projectToLatentSpace(tfidfVector, svdMatrix);
    const normalized = normalizeVector(projected);

    // Categorize
    const category = categorizeEmail(normalized, centroids, customCategories);

    results.push({
      ...email,
      vector: normalized,
      category: category.category,
      confidence: category.confidence,
      allScores: category.allScores
    });
  }

  categorizedEmails = results;
  isProcessing = false;

  updateUI();
}

// ============================================================
// 5. UI RENDERING
// ============================================================

function updateUI() {
  const filtered = currentFilter === 'All'
    ? categorizedEmails
    : categorizedEmails.filter(e => e.category === currentFilter);

  // Update counts
  document.querySelectorAll('.category-item').forEach(el => {
    const cat = el.dataset.category;
    if (!cat) return;
    const count = cat === 'All'
      ? categorizedEmails.length
      : categorizedEmails.filter(e => e.category === cat).length;
    const countEl = el.querySelector('.count');
    if (countEl) countEl.textContent = count;
  });

  // Update header count
  const emailCountEl = document.getElementById('emailCount');
  if (emailCountEl) {
    emailCountEl.textContent = `${filtered.length} email${filtered.length === 1 ? '' : 's'}`;
  }

  const panelTitleEl = document.getElementById('panelTitle');
  if (panelTitleEl) {
    panelTitleEl.textContent = currentFilter === 'All' ? 'All Emails' : currentFilter;
  }

  // Render email list
  const listEl = document.getElementById('emailList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No emails in this category</div>';
    return;
  }

  for (const email of filtered) {
    const item = document.createElement('div');
    item.className = 'email-item';

    const confidencePercent = Math.round(email.confidence * 100);

    item.innerHTML = `
      <div class="email-header">
        <span class="email-from">${escapeHtml(email.from)}</span>
        <span class="email-category-badge">${escapeHtml(email.category)}</span>
      </div>
      <div class="email-subject">${escapeHtml(email.subject)}</div>
      <div class="confidence-bar">
        <div class="confidence-fill" style="width: ${confidencePercent}%"></div>
      </div>
      <div class="confidence-label">${confidencePercent}% match</div>
    `;

    // Click handler to launch Math Visualizer!
    item.addEventListener('click', () => showMathVisualizer(email));

    listEl.appendChild(item);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// 6. CUSTOM CATEGORIES
// ============================================================

async function loadCustomCategories() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['customCategories'], (result) => {
        customCategories = result.customCategories || [];
        renderSidebarCustomCategories();
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function saveCustomCategories() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ customCategories: customCategories });
  }
}

function showAddCategoryUI() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Create Custom Category</h3>
      <input type="text" id="categoryName" placeholder="Category name (e.g., 'Gym')" />
      <input type="text" id="categoryKeywords" placeholder="Seed words (comma-separated, e.g., 'squat, cardio, bench')" />
      <div class="form-error"></div>
      <div class="modal-actions">
        <button id="cancelCategory">Cancel</button>
        <button id="saveCategory">Create</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#cancelCategory').onclick = () => {
    overlay.remove();
  };

  overlay.querySelector('#saveCategory').onclick = () => {
    const nameInput = document.getElementById('categoryName');
    const keywordsInput = document.getElementById('categoryKeywords');
    const name = nameInput ? nameInput.value.trim() : '';
    const keywords = keywordsInput ? keywordsInput.value.split(',').map(k => k.trim()).filter(k => k) : [];
    const errorEl = overlay.querySelector('.form-error');

    if (!name) {
      errorEl.textContent = 'Category name is required.';
      return;
    }
    if (keywords.length === 0) {
      errorEl.textContent = 'Add at least one seed keyword.';
      return;
    }

    const newCentroid = createCustomCentroid(keywords);
    customCategories.push({ name, vector: Array.from(newCentroid), keywords });
    saveCustomCategories();

    overlay.remove();
    renderSidebarCustomCategories();

    if (categorizedEmails.length > 0) {
      reprocessWithNewCategories();
    }
  };
}

function createCustomCentroid(keywords) {
  const centroid = new Float64Array(50).fill(0);
  let count = 0;

  for (const keyword of keywords) {
    const idx = vocab[keyword.toLowerCase()];
    if (idx !== undefined && idx < svdMatrix[0]?.length) {
      for (let d = 0; d < 50; d++) {
        centroid[d] += svdMatrix[d]?.[idx] || 0;
      }
      count++;
    }
  }

  if (count > 0) {
    for (let d = 0; d < 50; d++) {
      centroid[d] /= count;
    }
  }

  return normalizeVector(centroid);
}

function reprocessWithNewCategories() {
  const emails = categorizedEmails.map(e => ({
    id: e.id,
    subject: e.subject,
    from: e.from,
    body: e.body,
    fullText: e.fullText,
    vector: e.vector
  }));

  for (const email of emails) {
    const result = categorizeEmail(email.vector, centroids, customCategories);
    email.category = result.category;
    email.confidence = result.confidence;
    email.allScores = result.allScores;
  }

  categorizedEmails = emails;
  updateUI();
}

function renderSidebarCustomCategories() {
  const container = document.getElementById('customCategoryList');
  if (!container) return;

  container.innerHTML = customCategories.map(c => `
    <div class="category-item" data-category="${escapeHtml(c.name)}">
      <span class="cat-icon cat-custom">${ICONS.tag}</span>
      ${escapeHtml(c.name)}
      <span class="count">0</span>
    </div>
  `).join('');

  // Re-attach click listeners to new category items
  container.querySelectorAll('[data-category]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      currentFilter = el.dataset.category;
      updateUI();
    });
  });
}

// ============================================================
// 7. MATH VISUALIZER - Shows equations in real-time
// ============================================================

function showMathVisualizer(email) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const scores = email.allScores || [];
  const style = categoryStyle(email.category);
  const confidencePercent = Math.round(clamp01(email.confidence) * 100);

  const scoresHtml = scores.map(s => `
    <div class="score-row">
      <span class="score-label">${escapeHtml(s.label)}</span>
      <div class="score-bar-bg">
        <div class="score-bar-fill" style="width: ${Math.round(clamp01(s.score) * 100)}%; background: ${s.label === email.category ? style.color : '#e5e7eb'}"></div>
      </div>
      <span class="score-value">${(clamp01(s.score) * 100).toFixed(1)}%</span>
    </div>
  `).join('');

  overlay.innerHTML = `
    <div class="modal math-modal">
      <button class="close-btn" id="closeMath" aria-label="Close">${ICONS.x}</button>
      <h2><span class="head-icon">${ICONS.calculator}</span>Math Visualizer</h2>

      <div class="winner-card" style="border-left-color:${style.color}">
        <span class="winner-icon" style="color:${style.color}">${style.icon}</span>
        <div>
          <div class="winner-label">Assigned category</div>
          <div class="winner-name">${escapeHtml(email.category)}</div>
        </div>
        <div class="winner-conf">
          <span class="pct" style="color:${style.color}">${confidencePercent}% match</span>
          <div class="gauge">
            <div class="gauge-fill" style="width:${confidencePercent}%; background:${style.color}"></div>
          </div>
        </div>
      </div>

      <div class="math-section">
        <h4>How close is this email to each category?</h4>
        <div class="radar-wrap">
          <div class="radar-chart">${buildRadarChart(scores)}</div>
        </div>
        <div class="scores-container">${scoresHtml}</div>
      </div>

      <div class="math-section">
        <h4>What happened, in plain words</h4>
        <ol class="plain-steps">
          <li><span class="step-num">1</span> The email's words are read and the meaningful ones are kept.</li>
          <li><span class="step-num">2</span> The email is placed in the same space the model learned from sample emails.</li>
          <li><span class="step-num">3</span> Its distance to every category is measured and the closest one wins.</li>
        </ol>
        <details class="math-details">
          <summary>Show the math</summary>
          <div class="math-sub">
            <div class="math-equation">TF(t,d) = log(1 + count<sub>t,d</sub>)</div>
            <div class="math-equation">IDF(t) = log((N + 1) / (df<sub>t</sub> + 1)) + 1</div>
            <div class="math-equation">v<sub>email</sub> = Σ w<sub>i</sub> · SVD<sub>i</sub></div>
            <div class="math-equation">cos(θ) = (u · v) / (||u|| × ||v||)</div>
            <div class="math-result">Vocabulary size: ${Object.keys(vocab).length} unique terms</div>
            <div class="math-result">Vector L2 norm: ${email.vector ? (Math.sqrt(email.vector.reduce((s, v) => s + v*v, 0))).toFixed(4) : '1.0000'}</div>
          </div>
        </details>
      </div>

      <div class="math-section">
        <h4>Email source preview</h4>
        <div class="email-preview">
          <strong>From:</strong> ${escapeHtml(email.from)}<br>
          <strong>Subject:</strong> ${escapeHtml(email.subject)}<br>
          <strong>Body:</strong> ${escapeHtml((email.body || '').substring(0, 250))}${(email.body || '').length > 250 ? '...' : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#closeMath').onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}

// Plain-language helpers for the visualizer --------------------------------

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

const CATEGORY_STYLE = {
  Education: { color: '#8b5cf6', icon: ICONS.graduationCap },
  Work: { color: '#2563eb', icon: ICONS.briefcase },
  Finance: { color: '#059669', icon: ICONS.wallet },
  Promotions: { color: '#f59e0b', icon: ICONS.megaphone }
};

function categoryStyle(name) {
  return CATEGORY_STYLE[name] || { color: '#6b7280', icon: ICONS.tag };
}

function buildRadarChart(scores) {
  const width = 280, height = 236, cx = 140, cy = 116, maxR = 80;
  const n = scores.length;
  if (n < 2) return '';

  const angleFor = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => {
    const a = angleFor(i);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const best = Math.max(...scores.map(s => s.score));

  let rings = '';
  for (const g of [0.25, 0.5, 0.75, 1]) {
    const pts = scores.map((_, i) => {
      const [x, y] = pt(i, maxR * g);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    rings += `<polygon points="${pts}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
  }

  let axes = '';
  scores.forEach((_, i) => {
    const [x, y] = pt(i, maxR);
    axes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
  });

  const dataPts = scores.map((s, i) => {
    const [x, y] = pt(i, maxR * clamp01(s.score));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const dataPoly = `<polygon points="${dataPts}" fill="rgba(37,99,235,0.15)" stroke="#2563eb" stroke-width="2"/>`;

  let dots = '', labels = '';
  scores.forEach((s, i) => {
    const [x, y] = pt(i, maxR);
    const isBest = s.score === best;
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${isBest ? '#2563eb' : '#94a3b8'}"/>`;
    const [lx, ly] = pt(i, maxR + 18);
    labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="${isBest ? '600' : '400'}" fill="${isBest ? '#2563eb' : '#6b7280'}">${escapeHtml(s.label)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Category similarity chart">${rings}${axes}${dataPoly}${dots}${labels}</svg>`;
}

// ============================================================
// 8. SIGN-IN FLOW
// ============================================================

function setStatus(el, message) {
  if (el) el.textContent = message;
}

function showMainContent() {
  const mainEl = document.querySelector('.main-content');
  const authEl = document.querySelector('.auth-section');
  if (mainEl) mainEl.style.display = 'flex';
  if (authEl) authEl.style.display = 'none';
}

async function signIn() {
  const statusEl = document.getElementById('status');

  if (!isClientIdConfigured()) {
    setStatus(statusEl, 'Setup required: add your OAuth client ID to manifest.json (oauth2.client_id).');
    return;
  }

  setStatus(statusEl, 'Signing in...');

  try {
    const token = await getAuthToken();
    setStatus(statusEl, 'Fetching emails...');

    const emails = await fetchEmails(token);
    console.log(`Fetched ${emails.length} emails`);

    await processEmails(emails);
    setStatus(statusEl, `${categorizedEmails.length} emails categorized`);

    demoMode = false;
    updateDemoIndicator();
    showMainContent();
  } catch (error) {
    console.error('Sign in error:', error);
    setStatus(statusEl, `Error: ${error.message || 'Sign-in failed. Try again.'}`);

    // Clear cached token on error
    try {
      const token = await getAuthToken(false).catch(() => null);
      if (token) chrome.identity.removeCachedAuthToken({ token }, () => {});
    } catch (e) {}
  }
}

// ============================================================
// 8b. DEMO MODE - works without any Google OAuth setup
// ============================================================

async function loadDemoEmails() {
  const statusEl = document.getElementById('status');

  if (Object.keys(vocab).length === 0 || centroids.length === 0) {
    setStatus(statusEl, 'Missing model weights. Run the training notebook first.');
    return;
  }

  setStatus(statusEl, 'Loading sample emails...');

  try {
    const resp = await fetch(chrome.runtime.getURL('assets/sample_emails.json'));
    if (!resp.ok) throw new Error('Sample data missing');
    const sample = await resp.json();

    const emails = sample.map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from,
      body: e.body || '',
      fullText: e.subject + ' ' + (e.body || '')
    }));

    await processEmails(emails);
    demoMode = true;
    updateDemoIndicator();
    setStatus(statusEl, `${categorizedEmails.length} sample emails categorized`);
    showMainContent();
  } catch (error) {
    console.error('Demo mode error:', error);
    setStatus(statusEl, 'Could not load sample emails.');
  }
}

function updateDemoIndicator() {
  const badge = document.querySelector('.live-badge');
  if (badge) {
    badge.textContent = demoMode ? 'DEMO' : 'LIVE';
    badge.classList.toggle('demo', demoMode);
  }
}

// ============================================================
// 9. INITIALIZATION
// ============================================================

async function init() {
  console.log('Initializing Inbox Categorizer...');

  // Setup sign-in button
  const signInBtn = document.getElementById('signInBtn');
  if (signInBtn) signInBtn.addEventListener('click', signIn);

  // Setup demo mode button
  const demoBtn = document.getElementById('demoBtn');
  if (demoBtn) demoBtn.addEventListener('click', loadDemoEmails);

  // Setup category filters
  document.querySelectorAll('[data-category]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      currentFilter = el.dataset.category;
      updateUI();
    });
  });

  // Setup custom category button
  const addBtn = document.getElementById('addCategoryBtn');
  if (addBtn) {
    addBtn.addEventListener('click', showAddCategoryUI);
  }

  // Show auth section initially
  const authEl = document.querySelector('.auth-section');
  const mainEl = document.querySelector('.main-content');
  if (authEl) authEl.style.display = 'flex';
  if (mainEl) mainEl.style.display = 'none';

  // Load weights
  const weightsLoaded = await loadWeights();
  if (!weightsLoaded) return;

  // Check if already authenticated (silent check, no prompt)
  try {
    const token = await getAuthToken(false);
    if (token) {
      signIn();
    }
  } catch (e) {
    console.log('Not signed in, showing auth UI');
  }

  console.log('Initialization complete');
}

// ============================================================
// 10. START
// ============================================================

document.addEventListener('DOMContentLoaded', init);
