// ============================================================
// GMAIL OAUTH + CATEGORIZATION ENGINE
// ============================================================

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

// ============================================================
// 1. LOAD WEIGHTS FROM ASSETS
// ============================================================

async function loadWeights() {
  try {
    console.log('📦 Loading weights...');
    
    const vocabResp = await fetch(chrome.runtime.getURL('assets/vocab.json'));
    vocab = await vocabResp.json();
    
    const idfResp = await fetch(chrome.runtime.getURL('assets/idf_weights.json'));
    idfWeights = await idfResp.json();
    
    const svdResp = await fetch(chrome.runtime.getURL('assets/svd_matrix.json'));
    svdMatrix = await svdResp.json();
    
    const centroidResp = await fetch(chrome.runtime.getURL('assets/centroids.json'));
    centroids = await centroidResp.json();
    
    console.log('✅ Weights loaded:', {
      vocabSize: Object.keys(vocab).length,
      idfSize: idfWeights.length,
      svdShape: [svdMatrix.length, svdMatrix[0]?.length || 0],
      centroidCount: centroids.length
    });
    
    // Load custom categories from storage
    await loadCustomCategories();
    
    return true;
  } catch (error) {
    console.error('❌ Failed to load weights:', error);
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = '⚠️ Missing weights. Run notebook first.';
    return false;
  }
}

// ============================================================
// 2. GMAIL OAUTH
// ============================================================

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

function fetchEmails(token, maxResults = 50) {
  return new Promise(async (resolve, reject) => {
    try {
      // Get message list
      const listResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      
      if (!listResp.ok) {
        throw new Error(`Gmail API error: ${listResp.status}`);
      }
      
      const listData = await listResp.json();
      const messages = listData.messages || [];
      
      console.log(`📧 Found ${messages.length} emails`);
      
      // Fetch full details for each message
      const emails = [];
      for (let i = 0; i < messages.length; i++) {
        try {
          const detailResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messages[i].id}?format=full`,
            {
              headers: { 'Authorization': `Bearer ${token}` }
            }
          );
          
          if (!detailResp.ok) continue;
          
          const detail = await detailResp.json();
          const parsed = parseEmail(detail);
          if (parsed) {
            emails.push(parsed);
          }
        } catch (e) {
          console.warn('Failed to fetch email:', e);
          continue;
        }
      }
      
      resolve(emails);
    } catch (error) {
      reject(error);
    }
  });
}

function parseEmail(detail) {
  try {
    // Extract headers
    const headers = detail.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
    
    // Extract body
    let body = '';
    if (detail.payload?.parts) {
      // Multipart email
      for (const part of detail.payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
          break;
        }
      }
    } else if (detail.payload?.body?.data) {
      // Simple email
      body = atob(detail.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    
    // Clean body
    body = body.substring(0, 2000); // Limit for performance
    
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
  if (statusEl) statusEl.textContent = '🔄 Processing emails...';
  
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
  const categories = ['All', 'Education', 'Work', 'Finance', 'Promotions', ...customCategories.map(c => c.name)];
  for (const cat of categories) {
    const countEl = document.querySelector(`[data-category="${cat}"] .count`);
    if (countEl) {
      const count = cat === 'All' 
        ? categorizedEmails.length 
        : categorizedEmails.filter(e => e.category === cat).length;
      countEl.textContent = count;
    }
  }

  // Update header count
  const emailCountEl = document.getElementById('emailCount');
  if (emailCountEl) {
    emailCountEl.textContent = `${filtered.length} emails`;
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
    
    if (name && keywords.length > 0) {
      const newCentroid = createCustomCentroid(keywords);
      customCategories.push({ name, vector: Array.from(newCentroid), keywords });
      saveCustomCategories();
      
      if (categorizedEmails.length > 0) {
        reprocessWithNewCategories();
      }
      
      overlay.remove();
      renderSidebarCustomCategories();
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
      <span class="dot dot-all"></span>
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
  
  const scoresHtml = (email.allScores || []).map(s => `
    <div class="score-row">
      <span class="score-label">${escapeHtml(s.label)}</span>
      <div class="score-bar-bg">
        <div class="score-bar-fill" style="width: ${Math.round(s.score * 100)}%; background: ${s.label === email.category ? '#2563eb' : '#e5e7eb'}"></div>
      </div>
      <span class="score-value">${(s.score * 100).toFixed(1)}%</span>
    </div>
  `).join('');
  
  overlay.innerHTML = `
    <div class="modal math-modal">
      <button class="close-btn" id="closeMath">✕</button>
      <h2>📐 Math Visualizer</h2>
      
      <div class="math-section">
        <h4>Step 1: TF-IDF Vector</h4>
        <div class="math-equation">TF(t,d) = log(1 + count<sub>t,d</sub>)</div>
        <div class="math-equation">IDF(t) = log((N + 1) / (df<sub>t</sub> + 1)) + 1</div>
        <div class="math-result">Vocabulary size: ${Object.keys(vocab).length} unique terms</div>
      </div>
      
      <div class="math-section">
        <h4>Step 2: SVD Projection</h4>
        <div class="math-equation">v<sub>email</sub> = Σ w<sub>i</sub> · SVD<sub>i</sub></div>
        <div class="math-result">Projected to 50-dimensional latent SVD space</div>
        <div class="math-result">Vector L2 norm: ${email.vector ? (Math.sqrt(email.vector.reduce((s, v) => s + v*v, 0))).toFixed(4) : '1.0000'}</div>
      </div>
      
      <div class="math-section">
        <h4>Step 3: Cosine Similarity</h4>
        <div class="math-equation">cos(θ) = (u · v) / (||u|| × ||v||)</div>
        <div class="math-result">Similarity scores across category centroids:</div>
        <div class="scores-container">${scoresHtml}</div>
        <div class="math-result" style="font-weight:bold;color:#2563eb;margin-top:8px">
          ✅ Assigned Category: ${escapeHtml(email.category)} (${Math.round(email.confidence * 100)}% match)
        </div>
      </div>
      
      <div class="math-section">
        <h4>Email Source Preview</h4>
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

// ============================================================
// 8. SIGN-IN FLOW
// ============================================================

async function signIn() {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '🔐 Signing in...';
  
  try {
    const token = await getAuthToken();
    if (statusEl) statusEl.textContent = '📧 Fetching emails...';
    
    const emails = await fetchEmails(token);
    console.log(`✅ Fetched ${emails.length} emails`);
    
    if (emails.length === 0) {
      if (statusEl) statusEl.textContent = '📭 No emails found in inbox';
      return;
    }
    
    // Process the emails
    await processEmails(emails);
    if (statusEl) statusEl.textContent = `✅ ${categorizedEmails.length} emails categorized`;
    
    // Show the main content
    const mainEl = document.querySelector('.main-content');
    const authEl = document.querySelector('.auth-section');
    if (mainEl) mainEl.style.display = 'flex';
    if (authEl) authEl.style.display = 'none';
    
  } catch (error) {
    console.error('Sign in error:', error);
    if (statusEl) statusEl.textContent = `❌ Error: ${error.message || 'Sign-in failed. Try again.'}`;
    
    // Clear cached token on error
    try {
      const token = await getAuthToken().catch(() => null);
      if (token) chrome.identity.removeCachedAuthToken({ token }, () => {});
    } catch (e) {}
  }
}

// ============================================================
// 9. INITIALIZATION
// ============================================================

async function init() {
  console.log('🚀 Initializing Inbox Categorizer...');
  
  // Load weights
  const weightsLoaded = await loadWeights();
  if (!weightsLoaded) return;
  
  // Setup sign-in button
  const signInBtn = document.getElementById('signInBtn');
  if (signInBtn) signInBtn.addEventListener('click', signIn);
  
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
  
  // Check if already authenticated
  try {
    const token = await getAuthToken();
    if (token) {
      // Auto-sign-in
      signIn();
    }
  } catch (e) {
    console.log('Not signed in, showing auth UI');
  }
  
  console.log('✅ Initialization complete');
}

// ============================================================
// 10. START
// ============================================================

document.addEventListener('DOMContentLoaded', init);
