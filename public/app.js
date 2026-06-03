'use strict';

const $ = (id) => document.getElementById(id);
const preview = $('preview');
let lastBlobUrl = null;

// Escape untrusted values (tweet author names, reply text, etc.) before they go
// into innerHTML — prevents HTML injection from attacker-controlled tweet data.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Backgrounds: presets + uploaded customs (with a manage gallery) ──
function applyBackgroundOptions(data) {
  const sel = $('background');
  const current = sel.value;
  sel.innerHTML = '<option value="">(default)</option>';
  (data.presets || []).forEach(p => {
    const o = document.createElement('option'); o.value = p; o.textContent = p; sel.appendChild(o);
  });
  if ((data.custom || []).length) {
    const og = document.createElement('optgroup'); og.label = 'Your uploads';
    data.custom.forEach(c => {
      const o = document.createElement('option'); o.value = 'custom:' + c.id; o.textContent = '★ ' + c.name; og.appendChild(o);
    });
    sel.appendChild(og);
  }
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  renderBgGallery(data.custom || []);
}

function renderBgGallery(custom) {
  const g = $('bgGallery');
  const selected = $('background').value;
  g.innerHTML = custom.map(c =>
    `<div class="bg-thumb${selected === 'custom:' + c.id ? ' sel' : ''}" title="${esc(c.name)}" data-val="custom:${esc(c.id)}" style="background-image:url('${esc(c.url)}')">
       <button class="bg-rm" data-id="${esc(c.id)}" title="Remove" type="button">×</button>
     </div>`
  ).join('');
  g.querySelectorAll('.bg-thumb').forEach(t => t.onclick = (e) => {
    if (e.target.classList.contains('bg-rm')) return;
    $('background').value = t.dataset.val;
    g.querySelectorAll('.bg-thumb').forEach(x => x.classList.remove('sel'));
    t.classList.add('sel');
    liveRender();
  });
  g.querySelectorAll('.bg-rm').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    await fetch('/api/v1/backgrounds/custom/' + b.dataset.id, { method: 'DELETE' });
    if ($('background').value === 'custom:' + b.dataset.id) { $('background').value = ''; liveRender(); }
    loadBackgrounds();
  });
}

function loadBackgrounds() {
  return fetch('/api/v1/backgrounds').then(r => r.json()).then(applyBackgroundOptions).catch(() => {});
}
loadBackgrounds();

$('bgUpload').onclick = () => $('bgFile').click();
$('bgFile').onchange = () => {
  const f = $('bgFile').files[0];
  if (!f) return;
  const btn = $('bgUpload'); const label = btn.textContent;
  btn.textContent = 'Uploading…'; btn.disabled = true;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const r = await fetch('/api/v1/backgrounds/custom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.replace(/\.[^.]+$/, ''), dataUri: reader.result }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await loadBackgrounds();
      $('background').value = 'custom:' + d.added.id;
      renderBgGallery((await (await fetch('/api/v1/backgrounds')).json()).custom || []);
      liveRender();
    } catch (err) { alert('Upload failed: ' + err.message); }
    finally { btn.textContent = label; btn.disabled = false; $('bgFile').value = ''; }
  };
  reader.readAsDataURL(f);
};

function approvedIncludeIds() {
  return [...document.querySelectorAll('.thread-inc:checked')].map(c => c.value);
}

// Replies the user pastes in to include — [{ id, label }].
let replyRefs = [];

// Parse a tweet URL or bare id into { id, label } (label = @handle or #…id).
function parseReplyRef(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^\d{1,25}$/.test(s)) return { id: s, label: '#' + s.slice(-6) };
  const m = s.match(/(?:x|twitter|vxtwitter|fxtwitter|fixupx)\.com\/([^/]+)\/status(?:es)?\/(\d{1,25})/i);
  return m ? { id: m[2], label: '@' + m[1] } : null;
}

function renderChips() {
  const box = document.getElementById('replyChips');
  box.innerHTML = replyRefs.map(r =>
    `<span class="chip">${esc(r.label)}<button type="button" data-id="${esc(r.id)}" aria-label="Remove">×</button></span>`
  ).join('');
  box.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => {
    replyRefs = replyRefs.filter(r => r.id !== b.dataset.id);
    renderChips(); liveRender();
  });
}

function addReply() {
  const ref = parseReplyRef(document.getElementById('replyInput').value);
  const inp = document.getElementById('replyInput');
  if (!ref) { inp.style.borderColor = 'var(--danger)'; return; }
  inp.style.borderColor = '';
  if (!replyRefs.some(r => r.id === ref.id)) replyRefs.push(ref);
  inp.value = '';
  renderChips(); liveRender();
}

// Current render options as a plain object (shared by preview + publish).
function renderParams() {
  const o = { theme: $('theme').value, format: $('format').value, scale: $('scale').value, borderRadius: $('borderRadius').value };
  if ($('background').value) o.background = $('background').value;
  if ($('aspectRatio').value !== 'auto') o.aspectRatio = $('aspectRatio').value;
  if (!$('shadow').checked) o.shadow = 'false';
  if (!$('showMeta').checked) o.showMeta = 'false';
  if ($('style').value === 'quote') {
    o.style = 'quote';
    if ($('quoteFont').checked) o.quoteFont = 'serif';
  }
  if ($('carousel').checked) o.carousel = 'true';
  if ($('thread').checked) {
    o.thread = 'true';
    if ($('threadStyle').value === 'carousel') o.threadStyle = 'carousel';
    // Combine checked detected replies + pasted reply chips.
    const inc = [...new Set([...approvedIncludeIds(), ...replyRefs.map(r => r.id)])];
    if (inc.length) o.include = inc.join(',');
  }
  return o;
}

// True when the API will return JSON slides (multi-image) rather than one image.
function isMultiImage() {
  return $('carousel').checked || ($('thread').checked && $('threadStyle').value === 'carousel');
}

// Build the screenshot API URL from the current control state.
function buildUrl() {
  const id = encodeURIComponent($('url').value.trim());
  if (!id) return null;
  return `/api/v1/screenshot/${id}?${new URLSearchParams(renderParams()).toString()}`;
}

function setStatus(msg, isErr) {
  preview.innerHTML = `<div class="status${isErr ? ' err' : ''}">${msg}</div>`;
}

let lastSlides = [];          // data-URIs / urls for the current multi-image render
let renderAbort = null;       // cancels an in-flight render when a newer one starts

async function render() {
  const url = buildUrl();
  if (!url) return setStatus('Enter a tweet URL or ID first.', true);
  $('apiUrl').textContent = location.origin + url;

  if (renderAbort) renderAbort.abort();
  renderAbort = new AbortController();
  const { signal } = renderAbort;
  setStatus('Rendering…');

  try {
    // Multi-image (carousel / thread-carousel) → JSON with slides.
    if (isMultiImage()) {
      const data = await (await fetch(url, { signal })).json();
      if (data.error) throw new Error(data.error);
      lastSlides = (data.slides || []).map(s => s.url || s.dataUri);
      lastBlobUrl = null;
      const cards = lastSlides.map((src, i) =>
        `<figure class="slide"><img src="${src}"/><a class="dl" href="${src}" download="slide-${i + 1}.png">⬇ ${i + 1}</a></figure>`
      ).join('');
      preview.innerHTML = `<div class="slides">${cards}</div>`;
      return;
    }
    // Single image — fetch as blob so errors surface as JSON.
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { msg = (await resp.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await resp.blob();
    lastSlides = [];
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    preview.innerHTML = `<div class="preview"><img class="fade" src="${lastBlobUrl}"/></div>`;
  } catch (e) {
    if (e.name === 'AbortError') return; // superseded by a newer render
    setStatus(e.message, true);
  }
}

// Debounced auto-render so the preview tracks control changes live.
let renderTimer = null;
function liveRender() {
  if (!$('url').value.trim()) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 250);
}

// Load the thread structure for approval when "Thread" is on.
async function loadThread() {
  const id = $('url').value.trim();
  if (!id || !$('thread').checked) return;
  const box = $('threadBox');
  box.innerHTML = '<div class="muted">Loading thread…</div>';
  try {
    const data = await (await fetch(`/api/v1/thread/${encodeURIComponent(id)}`)).json();
    if (data.error) throw new Error(data.error);
    box.innerHTML = (data.tweets || []).map(t => {
      const other = !t.isMainAuthor;
      const checked = t.isMainAuthor ? 'checked disabled' : '';
      const cls = other ? 'who other' : 'who';
      return `<label class="thread-row">
        <input type="checkbox" class="thread-inc" value="${esc(t.id)}" ${checked}/>
        <div><span class="${cls}">${esc(t.author.name)} @${esc(t.author.username)}</span>
        <div class="muted">${esc(t.textPreview || '')}</div></div>
      </label>`;
    }).join('') || '<div class="muted">No thread found.</div>';
  } catch (e) {
    box.innerHTML = `<div class="muted">Couldn't load thread: ${e.message}</div>`;
  }
}

$('render').onclick = render;
$('copy').onclick = () => {
  const u = buildUrl(); if (!u) return;
  navigator.clipboard.writeText(location.origin + u);
  $('copy').textContent = 'Copied!'; setTimeout(() => ($('copy').textContent = 'Copy URL'), 1200);
};
$('download').onclick = () => {
  const click = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
  if (lastSlides.length) {                       // carousel / thread → download every slide
    lastSlides.forEach((src, i) => setTimeout(() => click(src, `slide-${i + 1}.png`), i * 150));
  } else if (lastBlobUrl) {
    const ext = $('format').value === 'jpeg' ? 'jpg' : $('format').value;
    click(lastBlobUrl, `tweet.${ext}`);
  }
};

// ── Metricool publishing ──
function mcSay(msg, isErr) {
  const el = $('mcResult');
  el.textContent = msg;
  el.style.color = isErr ? '#f4576c' : 'var(--subtext)';
}

// Shared Metricool brand discovery — populates every brand picker so you choose
// a brand at runtime instead of hardcoding one. Nothing is tied to a brand.
function fillBrandSelect(sel, brands, targetInputId) {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— select a brand —</option>';
  brands.forEach((b) => {
    const o = document.createElement('option');
    o.value = b.id ?? b.blogId ?? '';
    o.textContent = `${b.label || b.title || b.brand || b.userName || b.id} (${o.value})`;
    sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  sel.onchange = () => { if (sel.value) $(targetInputId).value = sel.value; };
}

let brandsLoaded = false;
async function loadMetricoolBrands(force) {
  if (brandsLoaded && !force) return brandsLoaded;
  const data = await (await fetch('/api/v1/metricool/brands')).json();
  if (data.error) throw new Error(data.error);
  const brands = data.brands || [];
  fillBrandSelect($('mcBrand'), brands, 'mcBlogId');
  fillBrandSelect($('wBrand'), brands, 'wBlog');
  brandsLoaded = true;
  return brands.length;
}

$('mcLoad').onclick = async () => {
  mcSay('Loading brands…');
  try { mcSay(`Loaded ${await loadMetricoolBrands(true)} brand(s).`); }
  catch (e) { mcSay(e.message, true); }
};
// Auto-load brands when the panel opens (silent if Metricool isn't configured).
$('mcDetails').addEventListener('toggle', () => { if ($('mcDetails').open) loadMetricoolBrands().catch(() => {}); });

$('mcSchedule').onclick = async () => {
  const tweet = $('url').value.trim();
  if (!tweet) return mcSay('Enter a tweet URL first.', true);
  const blogId = $('mcBlogId').value.trim() || $('mcBrand').value;
  if (!blogId) return mcSay('Pick or enter a brand (blogId).', true);

  const payload = {
    url: tweet,
    blogId,
    text: $('mcText').value,
    networks: $('mcNetworks').value.split(',').map(s => s.trim()).filter(Boolean),
    draft: $('mcDraft').checked,
    render: renderParams(),
  };
  const when = $('mcWhen').value;
  if (when) {
    payload.dateTime = when.length === 16 ? when + ':00' : when;
    payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  mcSay('Scheduling…');
  try {
    const r = await fetch('/api/v1/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    const n = data.media ? data.media.length : 0;
    mcSay(`✓ ${data.draft ? 'Drafted' : 'Scheduled'} to blog ${data.blogId} — ${n} image${n > 1 ? 's' : ''}.`);
  } catch (e) { mcSay(e.message, true); }
};

// ── Watchers (auto-follow accounts) ──
function wSay(msg, isErr) { $('wResult').textContent = msg; $('wResult').style.color = isErr ? '#f4576c' : 'var(--subtext)'; }

async function loadWatches() {
  try {
    const d = await (await fetch('/api/v1/watches')).json();
    const box = $('wList');
    if (!d.watches || !d.watches.length) {
      box.innerHTML = '<div class="muted">No watched accounts.</div>';
    } else {
      box.innerHTML = d.watches.map(w =>
        `<div class="thread-row">
          <div><span class="who">@${esc(w.username)}</span>
            <span class="muted">→ blog ${esc(w.blogId)} (${esc((w.networks || []).join(', '))})</span>
            ${w.lastError ? `<div class="muted" style="color:#f4576c">${esc(w.lastError)}</div>` : ''}</div>
          <a href="#" class="rm" data-u="${esc(w.username)}" style="margin-left:auto;color:var(--accent)">remove</a>
        </div>`).join('');
      box.querySelectorAll('a.rm').forEach(a => a.onclick = async (e) => {
        e.preventDefault();
        await fetch('/api/v1/watches/' + encodeURIComponent(a.dataset.u), { method: 'DELETE' });
        loadWatches();
      });
    }
    if (!d.metricoolConfigured) wSay("Metricool not configured — watches won't draft until creds are set.", true);
  } catch {}
}

$('wAdd').onclick = async () => {
  const username = $('wUser').value.trim(), blogId = $('wBlog').value.trim();
  if (!username || !blogId) return wSay('Enter @username and a brand blogId.', true);
  wSay('Following…');
  try {
    const r = await fetch('/api/v1/watches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username, blogId,
        networks: $('wNetworks').value.split(',').map(s => s.trim()).filter(Boolean),
        render: renderParams(),
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    wSay(`✓ Following @${d.added.username}.`); $('wUser').value = ''; loadWatches();
  } catch (e) { wSay(e.message, true); }
};

$('wRun').onclick = async () => {
  wSay('Polling…');
  try {
    const d = await (await fetch('/api/v1/watch/run', { method: 'POST' })).json();
    wSay(d.skipped ? `Skipped: ${d.skipped}` : `Polled ${d.ran} account(s), drafted ${d.drafted}.`);
    loadWatches();
  } catch (e) { wSay(e.message, true); }
};

$('watchDetails').addEventListener('toggle', () => {
  if (!$('watchDetails').open) return;
  loadWatches();
  loadMetricoolBrands().catch(() => {}); // populate the brand picker too
});

$('thread').onchange = () => {
  $('threadPanel').style.display = $('thread').checked ? 'block' : 'none';
  if ($('thread').checked) loadThread();
  liveRender();
};
$('replyAdd').onclick = addReply;
$('replyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addReply(); } });
// "Quote poster" hides the tweet-chrome-only controls.
$('style').onchange = () => {
  const quote = $('style').value === 'quote';
  document.getElementById('quoteFontRow').style.display = quote ? 'flex' : 'none';
  liveRender();
};
$('url').onblur = () => { if ($('thread').checked) loadThread(); };
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') render(); });

// Live re-render as controls change (debounced).
['theme','background','format','aspectRatio','scale','borderRadius','shadow','showMeta','carousel','threadStyle','quoteFont']
  .forEach(id => { const el = $(id); if (el) el.addEventListener('change', liveRender); });
$('borderRadius').addEventListener('input', liveRender);
// Re-render when the user approves/!approves a thread reply.
$('threadBox').addEventListener('change', (e) => { if (e.target.classList.contains('thread-inc')) liveRender(); });
