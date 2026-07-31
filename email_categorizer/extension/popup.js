// Live Gmail Categorizer Chrome Extension Logic
document.addEventListener('DOMContentLoaded', async () => {
  let vocab = null;
  let idfWeights = null;
  let svdMatrix = null;
  let centroids = null;
  let emails = [];
  let currentCategory = 'All';
  let searchQuery = '';
  let authToken = null;

  // DOM Elements
  const emailListEl = document.getElementById('email-list');
  const viewTitleEl = document.getElementById('view-title');
  const viewStatsEl = document.getElementById('view-stats');
  const searchInputEl = document.getElementById('search-input');
  const authBtnEl = document.getElementById('auth-btn');
  const navItems = document.querySelectorAll('.nav-item');

  // Stop words list for JS tokenizer
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'it', 'in', 'on', 'of', 'for', 'to', 'and', 
    'or', 'with', 'this', 'that', 'by', 'from', 'at', 'be', 'are', 'was', 
    'were', 'your', 'our', 'my', 'have', 'has', 'had', 'you', 'we', 'will', 
    'can', 'should', 'all', 'more', 'new', 'get', 'not', 'if', 'so', 'as', 
    'but', 'they', 'their', 'them', 'who', 'which', 'what', 'when', 'where'
  ]);

  // Utility: Base64URL decoder for Gmail payload bodies
  function decodeBase64Url(str) {
    if (!str) return '';
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    try {
      return decodeURIComponent(escape(atob(base64)));
    } catch (e) {
      try {
        return atob(base64);
      } catch (err) {
        return '';
      }
    }
  }

  // Utility: Extract plain text body from Gmail message payload parts
  function extractBody(payload) {
    if (!payload) return '';
    if (payload.body && payload.body.data) {
      return decodeBase64Url(payload.body.data);
    }
    if (payload.parts && payload.parts.length > 0) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          return decodeBase64Url(part.body.data);
        }
      }
      for (const part of payload.parts) {
        if (part.body && part.body.data) {
          return decodeBase64Url(part.body.data);
        }
        if (part.parts) {
          const nested = extractBody(part);
          if (nested) return nested;
        }
      }
    }
    return '';
  }

  // Step 1: Load SVD Model Weights from assets/
  async function loadModelWeights() {
    try {
      updateStatus('Loading SVD model weights...');
      const [vRes, iRes, sRes, cRes] = await Promise.all([
        fetch(chrome.runtime.getURL('assets/vocab.json')),
        fetch(chrome.runtime.getURL('assets/idf_weights.json')),
        fetch(chrome.runtime.getURL('assets/svd_matrix.json')),
        fetch(chrome.runtime.getURL('assets/centroids.json'))
      ]);

      if (!vRes.ok || !iRes.ok || !sRes.ok || !cRes.ok) {
        throw new Error('Weight files not found. Run train_engine.ipynb notebook first.');
      }

      vocab = await vRes.json();
      idfWeights = await iRes.json();
      svdMatrix = await sRes.json();
      centroids = await cRes.json();

      console.log('Model weights successfully loaded into JS engine.');
      return true;
    } catch (err) {
      console.error('Failed to load weights:', err);
      showErrorState(`Model assets missing. Run train_engine.ipynb to generate weights.`);
      return false;
    }
  }

  // Step 2: Gmail OAuth Authentication
  function getAuthToken(interactive = false) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.identity) {
        console.warn('Chrome identity API unavailable.');
        resolve(null);
        return;
      }

      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          console.log('OAuth prompt required or canceled:', chrome.runtime.lastError);
          resolve(null);
        } else {
          authToken = token;
          resolve(token);
        }
      });
    });
  }

  // Step 3: Fetch Live Emails via Gmail API
  async function fetchLiveEmails(token) {
    updateStatus('Fetching 50 live messages from Gmail API...');
    try {
      const listResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!listResp.ok) {
        if (listResp.status === 401) {
          // Token expired
          chrome.identity.removeCachedAuthToken({ token }, () => {});
          showAuthRequiredState();
          return;
        }
        throw new Error(`Gmail API error: ${listResp.status}`);
      }

      const listData = await listResp.json();
      const messageSummaries = listData.messages || [];

      if (messageSummaries.length === 0) {
        showEmptyInboxState();
        return;
      }

      updateStatus(`Parsing & vectorizing ${messageSummaries.length} emails...`);

      // Fetch message details concurrently in batches of 10
      const fetchedEmails = [];
      const batchSize = 10;
      for (let i = 0; i < messageSummaries.length; i += batchSize) {
        const batch = messageSummaries.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(msg => fetchSingleMessage(token, msg.id)));
        fetchedEmails.push(...batchResults.filter(Boolean));
      }

      // Step 4: Perform Handwritten SVD Vector Inference on Each Email
      emails = fetchedEmails.map(email => classifyEmailWithSVD(email));

      updateCategoryCounts();
      renderList();
    } catch (err) {
      console.error('Error fetching emails:', err);
      showErrorState(`Gmail API request failed: ${err.message}`);
    }
  }

  async function fetchSingleMessage(token, messageId) {
    try {
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();

      const headers = data.payload.headers || [];
      const getHeader = (name) => {
        const h = headers.find(item => item.name.toLowerCase() === name.toLowerCase());
        return h ? h.value : '';
      };

      const subject = getHeader('Subject') || '(No Subject)';
      const sender = getHeader('From') || 'Unknown Sender';
      const snippet = data.snippet || '';
      const body = extractBody(data.payload) || snippet;

      return {
        id: data.id,
        sender,
        subject,
        snippet,
        body
      };
    } catch (e) {
      return null;
    }
  }

  // Step 4: Pure JS TF-IDF & 50-D SVD Inference Engine
  function classifyEmailWithSVD(email) {
    const combinedText = `${email.subject} ${email.body}`;
    const rawTokens = combinedText.toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || [];
    const tokens = rawTokens.filter(t => !stopWords.has(t));

    // Word counts
    const counts = {};
    tokens.forEach(t => {
      counts[t] = (counts[t] || 0) + 1;
    });

    // 50-Dimensional SVD Projection Vector
    const k = 50;
    const projected = new Array(k).fill(0.0);

    for (const [word, count] of Object.entries(counts)) {
      if (vocab && vocab[word] !== undefined) {
        const idx = vocab[word];
        const tf = Math.log(1 + count);
        const idf = idfWeights[idx];
        const weight = tf * idf;
        const wordSvdRow = svdMatrix[idx]; // 50-D row for this word

        for (let d = 0; d < k; d++) {
          projected[d] += weight * wordSvdRow[d];
        }
      }
    }

    // L2 Normalize the projected document vector
    let norm = Math.sqrt(projected.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let d = 0; d < k; d++) {
        projected[d] /= norm;
      }
    }

    // Cosine similarity against 4 seed centroids
    const catScores = {};
    let bestCat = 'Education';
    let maxSim = -1.0;

    for (const [cat, centroidVec] of Object.entries(centroids)) {
      let dotProduct = 0.0;
      for (let d = 0; d < k; d++) {
        dotProduct += projected[d] * centroidVec[d];
      }
      // Bound similarity between 0 and 1
      const boundedSim = Math.max(0.0, Math.min(1.0, dotProduct));
      catScores[cat] = boundedSim;
      if (boundedSim > maxSim) {
        maxSim = boundedSim;
        bestCat = cat;
      }
    }

    return {
      ...email,
      assigned_category: bestCat,
      confidence: maxSim,
      scores: catScores
    };
  }

  // UI State Handlers
  function updateStatus(message) {
    emailListEl.innerHTML = `
      <div class="status-state">
        <div class="spinner"></div>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  function showAuthRequiredState() {
    viewTitleEl.textContent = 'Gmail Access Required';
    viewStatsEl.textContent = 'Authentication required';
    emailListEl.innerHTML = `
      <div class="status-state">
        <p>Sign in to your Google Account to categorize live inbox emails with SVD.</p>
        <button id="main-login-btn">Connect Gmail Account</button>
      </div>
    `;
    document.getElementById('main-login-btn')?.addEventListener('click', handleAuthTrigger);
  }

  function showErrorState(msg) {
    emailListEl.innerHTML = `
      <div class="status-state">
        <p style="color: #ef4444;">${escapeHtml(msg)}</p>
        <button id="retry-btn">Retry</button>
      </div>
    `;
    document.getElementById('retry-btn')?.addEventListener('click', initApp);
  }

  function showEmptyInboxState() {
    emailListEl.innerHTML = `<div class="status-state"><p>No messages found in your Gmail inbox.</p></div>`;
  }

  async function handleAuthTrigger() {
    updateStatus('Opening Google Sign-In prompt...');
    const token = await getAuthToken(true);
    if (token) {
      authBtnEl.textContent = 'Connected';
      authBtnEl.disabled = true;
      fetchLiveEmails(token);
    } else {
      showAuthRequiredState();
    }
  }

  // Update Sidebar Category Counts
  function updateCategoryCounts() {
    const counts = { All: emails.length, Education: 0, Work: 0, Finance: 0, Promotions: 0 };
    emails.forEach(e => {
      if (counts[e.assigned_category] !== undefined) counts[e.assigned_category]++;
    });

    document.getElementById('count-all').textContent = counts.All;
    document.getElementById('count-edu').textContent = counts.Education;
    document.getElementById('count-work').textContent = counts.Work;
    document.getElementById('count-finance').textContent = counts.Finance;
    document.getElementById('count-promo').textContent = counts.Promotions;
  }

  // Step 5: Render Email List
  function renderList() {
    let filtered = emails;

    if (currentCategory !== 'All') {
      filtered = filtered.filter(e => e.assigned_category === currentCategory);
    }

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(e => 
        e.subject.toLowerCase().includes(q) || 
        e.snippet.toLowerCase().includes(q) || 
        e.sender.toLowerCase().includes(q)
      );
    }

    viewTitleEl.textContent = currentCategory === 'All' ? 'Live Gmail Inbox' : currentCategory;
    viewStatsEl.textContent = `Showing ${filtered.length} of ${emails.length} emails`;

    if (filtered.length === 0) {
      emailListEl.innerHTML = `<div class="status-state"><p>No emails match the selected filter.</p></div>`;
      return;
    }

    emailListEl.innerHTML = filtered.map(email => {
      const confPct = Math.round((email.confidence || 0.85) * 100);
      const tagClass = `tag-${email.assigned_category.toLowerCase()}`;
      
      return `
        <div class="email-item" data-id="${email.id}">
          <div class="email-header">
            <span class="email-sender">${escapeHtml(email.sender)}</span>
            <div class="email-meta">
              <span class="category-tag ${tagClass}">${email.assigned_category}</span>
            </div>
          </div>
          <div class="email-subject">${escapeHtml(email.subject)}</div>
          <div class="email-snippet">${escapeHtml(email.snippet || email.body)}</div>
          <div class="confidence-bar-container" title="SVD Cosine Similarity: ${confPct}%">
            <div class="confidence-bar">
              <div class="fill" style="width: ${confPct}%;"></div>
            </div>
            <span class="confidence-score">${confPct}%</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Navigation Event Handlers
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      currentCategory = item.dataset.category;
      renderList();
    });
  });

  searchInputEl.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderList();
  });

  authBtnEl.addEventListener('click', handleAuthTrigger);

  // App Initialization
  async function initApp() {
    const weightsLoaded = await loadModelWeights();
    if (!weightsLoaded) return;

    const token = await getAuthToken(false);
    if (token) {
      authBtnEl.textContent = 'Connected';
      authBtnEl.disabled = true;
      fetchLiveEmails(token);
    } else {
      showAuthRequiredState();
    }
  }

  initApp();
});
