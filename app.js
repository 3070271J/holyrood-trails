// ─────────────────────────────────────────────────────────────
// Map init + base controls
// ─────────────────────────────────────────────────────────────

// Mapbox token (prototype: embedded; for production, load from config/env)
mapboxgl.accessToken = 'pk.eyJ1IjoiMzA3MDI3MWoiLCJhIjoiY201d2RuY3VxMDluMjJscXp5ZW42MG1zeCJ9.c7fETI_inRzWjln-_ePd-w';

const map = new mapboxgl.Map({
  container: 'map',
  // Custom style hosted on Mapbox; token passed to keep CodePen working
  style: 'https://api.mapbox.com/styles/v1/3070271j/cmdfff40l01sh01sb4hudfvqg?fresh=true&access_token=' + mapboxgl.accessToken,
  center: [-3.165, 55.947], // Holyrood Park area
  zoom: 14,
  minZoom: 9 // avoid zooming too far out (keeps interaction local)
});

// Scale bar (metric, bottom-left)
map.addControl(new mapboxgl.ScaleControl({
  maxWidth: 200,
  unit: 'metric'
}), 'bottom-left');

// Compass + zoom (zoom buttons hidden via CSS; compass kept for orientation)
map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');


// ─────────────────────────────────────────────────────────────
// Map load: add contours and manage draw order
// ─────────────────────────────────────────────────────────────
map.on('load', () => {
  // Contours hosted as GeoJSON (lightweight, no tile server dependency)
  map.addSource('contours', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/contours_10m.geojson'
  });

  // Contour styling: index (every 50 m) vs regular, with subtle dash for regular
  map.addLayer({
    id: 'contours-line',
    type: 'line',
    source: 'contours',
    paint: {
      'line-color': [
        'case',
        // Index contours (every 50 m) → muted grey-brown
        ['==', ['%', ['floor', ['to-number', ['get', 'ELEV']]], 50], 0], '#8b6f52',
        // Regular contours → softer lighter brown
        '#a78d75'
      ],
      'line-width': [
        'case',
        ['==', ['%', ['floor', ['to-number', ['get', 'ELEV']]], 50], 0], 0.8,
        0.8
      ],
      'line-dasharray': [
        'case',
        // Solid line for index contours
        ['==', ['%', ['floor', ['to-number', ['get', 'ELEV']]], 50], 0], ['literal', [1, 0]],
        // Subtle dashed line for regular contours
        ['literal', [2, 2]]
      ]
    }
  });

  // Keep contours under trails if the trail layer exists
  if (map.getLayer('trails-line')) {
    map.moveLayer('contours-line', 'trails-line'); 
  }
});

// ─────────────────────────────────────────────────────────────
// Difficulty state + helpers
// ─────────────────────────────────────────────────────────────

// Live set of enabled difficulties from the UI checkboxes
let allowedDifficulties = new Set(["easy","moderate","challenging","extreme"]);

/**
 * Read allowed difficulty categories from the toolbox.
 * Returns a Set like: {"easy","moderate",...}
 */
function getAllowedDifficultiesFromUI() {
  return new Set(
    Array.from(document.querySelectorAll('#toolbox input[type="checkbox"][value]:checked'))
      .map(i => i.value)
  );
}

/**
 * Map numeric total_score (1–10) to UI difficulty buckets.
 * Matches the classification used throughout the app.
 */
function difficultyFromScore(score) {
  if (score <= 3) return "easy";
  if (score <= 5) return "moderate";
  if (score <= 7) return "challenging";
  return "extreme"; // 8–10
}

// Constrain panning to study area bounds (prevents getting lost off-site)
map.setMaxBounds([[-3.22, 55.92], [-3.11, 55.965]]);

// ─────────────────────────────────────────────────────────────
// Colour palettes (default + colourblind-friendly)
// These are read by UI + layer styling + buttons/markers
// ─────────────────────────────────────────────────────────────
const palettes = {
  normal: {
    trail:   { easy:'#29a366', moderate:'#e6a700', challenging:'#cc3300', extreme:'#000000' },
    pastel:  { easy:'#dff5e1', moderate:'#fff6d6', challenging:'#ffe5e5', extreme:'#e6dede' },
    // Button colours (start/clear) and marker colours
    startBtnBg:'#dff5e1', startBtnBorder:'#9ed6aa', startBtnHover:'#c8ebcd',
    clearBtnBg:'#ffe5e5', clearBtnBorder:'#e0aaaa', clearBtnHover:'#f7cccc',
    markerStart:'#2e7d32', markerEnd:'#c62828'
  },
  cb: {
    // Adapted Paul Tol colour-blind friendly scheme
    trail:   { easy:'#478EDE', moderate:'#DDAA33', challenging:'#AA4499', extreme:'#000000' },
    // Matching pastels (manually picked to keep contrast)
    pastel:  { easy:'#D7E6F9', moderate:'#F9EFD7', challenging:'#F1DCEC', extreme:'#e6dede' },
    // Buttons/markers remapped away from red/green
    startBtnBg:'#d7e7f6', startBtnBorder:'#a9c7e3', startBtnHover:'#d1e5f0', // blueish
    clearBtnBg:'#fde9cc', clearBtnBorder:'#f0c993', clearBtnHover:'#fddbc7', // orangeish
    markerStart:'#0072B2', markerEnd:'#D55E00'
  }
};

// ─────────────────────────────────────────────────────────────
// Colour mode (standard vs colourblind) + legend/trail updates
// Persisted in localStorage so the choice survives reloads
// ─────────────────────────────────────────────────────────────

// Read persisted colourblind mode (string '1' means enabled)
let cbMode = (localStorage.getItem('cbMode') === '1');

/** Return the current trail colour palette (by difficulty). */
function getTrailPalette() {
  return cbMode ? palettes.cb.trail : palettes.normal.trail;
}

/** Update legend swatch colours to match the active palette. */
function refreshLegendColours() {
  const pal = cbMode ? palettes.cb.trail : palettes.normal.trail;
  // Each legend row has a custom 'difficulty' attribute (easy/moderate/...)
  document.querySelectorAll('#legend div[difficulty]').forEach(row => {
    const key = row.getAttribute('difficulty');
    const span = row.querySelector('span');
    if (span) span.style.backgroundColor = pal[key] || '#ccc';
  });
}

/**
 * Toggle/apply colour mode across UI:
 * - body class for CSS-var button themes
 * - trail layer paint
 * - legend swatches
 * - persist mode in localStorage
 */
function applyColourMode(){
  document.body.classList.toggle('cb-mode', cbMode); // CSS vars for buttons
  refreshTrailLayerColours();  // trails
  refreshLegendColours();      // legend swatches
  localStorage.setItem('cbMode', cbMode ? '1' : '0');
}

// Initialise colour state once map styles are ready
map.on('load', () => {
  // (Contours + layers are added in a different load handler above)
  refreshTrailLayerColours();
  refreshLegendColours();
  applyColourMode(); // pick up persisted mode on first load
});

// Bind colourblind toggle once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggle-colourblind');
  if (!btn) return;
  btn.addEventListener('click', () => {
    cbMode = !cbMode;
    applyColourMode();
    applyFilter(); // re-run filters so inactive/active greying remains consistent
    // Reflect state in button label
    btn.textContent = cbMode ? 'Standard colours' : 'Colourblind mode';
  });
  // Initial label
  btn.textContent = cbMode ? 'Standard colours' : 'Colourblind mode';
});

/** Repaint trail layer line colours to the active palette (Mapbox 'match'). */
function refreshTrailLayerColours(){
  const pal = cbMode ? palettes.cb.trail : palettes.normal.trail;
  if (map.getLayer('trails-active')){
    map.setPaintProperty('trails-active','line-color', [
      'match', ['get','difficulty'],
      'easy', pal.easy,
      'moderate', pal.moderate,
      'challenging', pal.challenging,
      'extreme', pal.extreme,
      '#999999' // fallback (unknown difficulty)
    ]);
  }
}

// Tracks if user is in routing selection mode (start/end clicks)
let routingActive = false;

// ─────────────────────────────────────────────────────────────
// Tutorial welcome popup (attach outside map load)
// ─────────────────────────────────────────────────────────────
document.getElementById('start-tutorial')?.addEventListener('click', () => {
  document.getElementById('welcome-popup').style.display = 'none';
  startMapTour();
});
document.getElementById("skip-tutorial").addEventListener("click", () => {
  document.getElementById("welcome-popup").style.display = "none";
});

// ─────────────────────────────────────────────────────────────
// Filtering logic: difficulty + preference bans → active/inactive layers
// Uses Mapbox GL expression filters for performance
// ─────────────────────────────────────────────────────────────
function applyFilter() {
  // Enabled difficulty categories from the toolbox
  const checked = Array.from(
    document.querySelectorAll('#toolbox input[type="checkbox"][value]:checked')
  ).map(i => i.value);

  // Preference toggles (true = allow/show those conditions)
  const showVertigoRisk = document.getElementById('pref-vertigo').checked;
  const showSteepSlopes = document.getElementById('pref-steep').checked;
  const showUnevenGround = document.getElementById('pref-uneven').checked;
  const showOvergrowth   = document.getElementById('pref-overgrowth').checked;

  // Active layer: show only what is allowed by difficulty + preferences
  if (map.getLayer('trails-active')) {
    map.setFilter('trails-active', [
      'all',
      // Difficulty must be in the checked list
      ['in', ['get', 'difficulty'], ['literal', checked]],
      // Preference bans: if user DISallows an attribute, exclude those features
      showVertigoRisk ? true : ['!=', ['get', 'vertigo'], 'yes'],
      showSteepSlopes ? true : ['<', ['get', 'slope_class'], 5],        // class >=5 are “steep”
      showUnevenGround ? true : ['!=', ['get', 'surface_score'], 4],    // 4 is max (rough/rocky)
      showOvergrowth ? true : ['!=', ['coalesce', ['get', 'natural'], ''], 'scrub'] // scrub = overgrowth proxy
    ]);
  }

  // Inactive layer: everything excluded by difficulty or preferences (for greying out)
  if (map.getLayer('trails-inactive')) {
    map.setFilter('trails-inactive', [
      'any',
      // Not in the allowed difficulty set
      ['!', ['in', ['get', 'difficulty'], ['literal', checked]]],
      // Or excluded by a preference ban
      showVertigoRisk ? false : ['==', ['get', 'vertigo'], 'yes'],
      showSteepSlopes ? false : ['>=', ['get', 'slope_class'], 5],
      showUnevenGround ? false : ['==', ['get', 'surface_score'], 4],
      showOvergrowth ? false : ['==', ['coalesce', ['get', 'natural'], ''], 'scrub']
    ]);
  }


  // legend sync (runs at the end of applyFilter to visually dim/restore items)
  document.querySelectorAll('#legend div[difficulty]').forEach(legendRow => {
    const key = legendRow.getAttribute('difficulty');
    const isActive = checked.includes(key); // checked difficulties from UI
    legendRow.style.color = isActive ? '#000' : '#888';
    const span = legendRow.querySelector('span');
    const pal = cbMode ? palettes.cb.trail : palettes.normal.trail;
    // If active, use palette colour; if not, grey the swatch
    if (span) span.style.backgroundColor = isActive ? (pal[key] || '#ccc') : '#ccc';
  });
} // ← end of applyFilter (as defined in previous chunk)
window.applyFilter = applyFilter; // expose for external calls/debug

// ─────────────────────────────────────────────────────────────
// Hierarchical difficulty checkboxes (harder implies easier)
// e.g., unchecking "moderate" also unchecks "challenging" & "extreme"
// ─────────────────────────────────────────────────────────────
const difficultyOrder = ["easy", "moderate", "challenging", "extreme"];
document.querySelectorAll('#toolbox input[type="checkbox"][value]').forEach(cb => {
  cb.addEventListener('change', (e) => {
    const changedValue = e.target.value;
    const isChecked = e.target.checked;
    const idx = difficultyOrder.indexOf(changedValue);

    if (!isChecked) {
      // Turning off a level turns off all harder levels
      difficultyOrder.slice(idx + 1).forEach(level => {
        const box = document.querySelector(`#toolbox input[value="${level}"]`);
        if (box && box.checked) box.checked = false;
      });
    } else {
      // Turning on a level turns on all easier levels
      difficultyOrder.slice(0, idx).forEach(level => {
        const box = document.querySelector(`#toolbox input[value="${level}"]`);
        if (box && !box.checked) box.checked = true;
      });
    }
    applyFilter(); // reapply filters after any change
  });
});

// ─────────────────────────────────────────────────────────────
// Preference checkboxes: re-filter when toggled
// (true = user accepts that condition; false = exclude)
// ─────────────────────────────────────────────────────────────
document.getElementById('pref-vertigo')
  .addEventListener('change', applyFilter);

document.getElementById('pref-steep')
  .addEventListener('change', applyFilter);

document.getElementById('pref-uneven')
  .addEventListener('change', applyFilter);

document.getElementById('pref-overgrowth')
  .addEventListener('change', applyFilter);

// ─────────────────────────────────────────────────────────────
// Helpers for mapping UI → difficulty and scores → labels
// ─────────────────────────────────────────────────────────────

/** Current allowed difficulties from the UI. */
function getCheckedDifficulties() {
  return Array.from(
    document.querySelectorAll('#toolbox input[type="checkbox"][value]:checked')
  ).map(i => i.value);
}

/** Convert numeric total_score to a difficulty bucket. */
function scoreToDifficulty(score) {
  if (score <= 3) return 'easy';
  if (score <= 5) return 'moderate';
  if (score <= 7) return 'challenging';
  return 'extreme';
}

// ─────────────────────────────────────────────────────────────
// Photo helpers: map landcover/surface tags → example images
// Used in info panel popups to set expectations visually
// ─────────────────────────────────────────────────────────────
const LANDCOVER_IMAGES = {
  wood: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/wood.jpg',
  grassland: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/grassland.jpg',
  scrub: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/scrub.jpg'
};

function landcoverPhotoUrl(lc) {
  const key = String(lc || '').toLowerCase();
  return LANDCOVER_IMAGES[key] || '';
}

const SURFACE_IMAGES = {
  grass: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/grass.jpg',
  dirt: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/dirt.jpg',
  gravel: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/gravel.jpg',
  asphalt: 'https://raw.githubusercontent.com/3070271J/holyrood-trails/main/asphalt.jpg'
};

function surfacePhotoUrl(sf) {
  const key = String(sf || '').toLowerCase();
  return SURFACE_IMAGES[key] || '';
}

// ─────────────────────────────────────────────────────────────
// Map load: add trail source + base inactive layer
// 'trails' GeoJSON includes 'difficulty' used for styling/filtering
// ─────────────────────────────────────────────────────────────
map.on("load", () => {
  // Source for display (HAS 'difficulty')
  map.addSource("trails", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/3070271J/holyrood-trails/refs/heads/main/trails_webmap_v6.geojson"
  });

  // Layer for display (inactive below, grey + non-interactive)
  map.addLayer({
    id: "trails-inactive",
    type: "line",
    source: "trails",
    paint: {
      "line-color": "#999999",
      "line-width": 3,
      "line-opacity": 0.6
    },
    // start with nothing shown here; filters will control visibility later
    filter: ["==", ["get", "difficulty"], "__none__"]
  });

// ─────────────────────────────────────────────────────────────
// Trails (active) layer: coloured + interactive
// 1) Add layer with a temporary colour; palette is applied right after
// ─────────────────────────────────────────────────────────────
map.addLayer({
  id: "trails-active",
  type: "line",
  source: "trails",
  paint: {
    "line-color": "#999999",   // temp; real colors set right after
    "line-width": 3
  },
  // show everything for now; step 2 will make this dynamic
  filter: ["in", ["get", "difficulty"], ["literal", ["easy","moderate","challenging","extreme"]]]
});

// 2) Immediately after the layer is added, apply the palette-driven colors
refreshTrailLayerColours();

// ─────────────────────────────────────────────────────────────
// Pointer feedback + popup trigger (disabled during routing selection)
// ─────────────────────────────────────────────────────────────
map.on('mouseenter', 'trails-active', () => map.getCanvas().style.cursor = 'pointer');
map.on('mouseleave', 'trails-active', () => map.getCanvas().style.cursor = '');

map.on('click', 'trails-active', (e) => {
  if (routingActive) return; // suppress popups during selection
  const p = e.features[0].properties;

  // --- Difficulty mapping for header badge (short label + emoji) ---
  const diffKey = String(p.difficulty || '').toLowerCase();
  const diffShort =
    diffKey === 'easy'        ? 'Gentle' :
    diffKey === 'moderate'    ? 'Moderate' :
    diffKey === 'challenging' ? 'Challenging' :
    diffKey === 'extreme'     ? 'Not recommended' : (p.difficulty || '—');

  const diffEmoji =
    diffKey === 'easy'        ? '🙂' :
    diffKey === 'moderate'    ? '😐' :
    diffKey === 'challenging' ? '⚠️' :
    diffKey === 'extreme'     ? '🚧' : '';

  // --- Difficulty sentence (body, first sentence) ---
  let diffSentence = '';
  switch (diffKey) {
    case 'easy':
      diffSentence = 'This part of the trail is gentle and straightforward.';
      break;
    case 'moderate':
      diffSentence = 'This part of the trail has some steep or uneven sections.';
      break;
    case 'challenging':
      diffSentence = 'This part of the trail requires <b>significant effort</b>. Plan and prepare accordingly.';
      break;
    case 'extreme':
      diffSentence = 'This part of the trail is <b>not recommended</b> for most users.';
      break;
  }

  // --- Build paragraph: difficulty + merged surface/landcover ---
  let paragraph = diffSentence;

  const haveSurface  = p.surface && p.surface.trim() !== '';
  const haveLC       = p.landcover && p.landcover.trim() !== '';

  // Normalise values for readability in UI text
  let sLCraw = haveSurface ? p.surface.toLowerCase().replace(/_/g, ' ') : '';
  let lcRaw  = haveLC ? p.landcover.toLowerCase().replace(/_/g, ' ') : '';

  // Special-case: tweak phrasing for clarity
  if (sLCraw === 'rock') sLCraw = 'rocky';
  if (sLCraw === 'grass') sLCraw = 'grassy';
  if (sLCraw === 'ground') sLCraw = 'natural';
  if (lcRaw === 'wood') lcRaw = 'woodland';
  
  // Compare without "bare " prefix so "bare rock" vs "rocky" doesn't duplicate
  const sLCnorm = sLCraw.replace(/^bare\s+/, '').trim();
  const lcNorm  = lcRaw.replace(/^bare\s+/, '').trim();

  if (haveSurface && haveLC && sLCnorm !== lcNorm) {
    const article = /^[aeiou]/.test(sLCraw) ? 'an' : 'a';
    paragraph += ` It has ${article} ${sLCraw} surface and passes through ${lcRaw}.`;
  } else if (haveSurface) {
    const article = /^[aeiou]/.test(sLCraw) ? 'an' : 'a';
    paragraph += ` It has ${article} ${sLCraw} surface.`;
  } else if (haveLC) {
    paragraph += ` It passes through ${lcRaw}.`;
  }

  // --- Header block (segment id + difficulty badge) ---
  const headerHtml = `
    <div class="popup-header" style="text-align:center;">
      <div style="font-weight:700; font-size:20px; margin-bottom:10px;">
        Trail Section ${p.seg_id ?? '—'}
      </div>
      <div style="line-height:1;">
        <div style="font-size:18px;">${diffEmoji}</div>
        <div style="font-size:12px; margin-top:2px;">${diffShort}</div>
      </div>
    </div>
  `;

  // --- Body block (paragraph + warnings populated below) ---
  let bodyHtml = `
    <div class="popup-body" style="margin-top:8px;">
      <p style="margin:0 0 6px 0;">${paragraph}</p>
  `;

// ─────────────────────────────────────────────────────────────
// Utility: reusable warning card builder
// ─────────────────────────────────────────────────────────────
function warningCard(label, text) {
  return `
    <div role="alert" style="
      display:flex; gap:8px; align-items:flex-start;
      margin-top:6px; padding:8px 10px; border-radius:6px;
      background:#fff; border:1px solid #ffcc00; border-left:5px solid #ffcc00;
    ">
      <div style="font-size:16px; line-height:1;">⚠️</div>
      <div style="font-size:13px;">
        <strong>${label}.</strong> ${text}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────
// Append warning cards based on feature attributes
// ─────────────────────────────────────────────────────────────
if (String(p.vertigo || '').toLowerCase() === 'yes') {
  bodyHtml += warningCard('Vertigo risk', 'This section feels exposed and high.');
}
if (Number(p.slope_class) >= 5) {
  bodyHtml += warningCard('Steep slope', 'Inclines may be difficult for some users.');
}
if (Number(p.surface_score) === 4) {
  bodyHtml += warningCard('Uneven ground', 'Expect rough or bumpy surfaces.');
}
if (Number(p.has_steps) === 1) {
  bodyHtml += warningCard('Steps', 'This section includes steps that may be difficult for some users.');
}
if (String(p.natural || '').toLowerCase() === 'scrub') {
  bodyHtml += warningCard('Overgrowth', 'Nettles or thorns may be present.');
}
bodyHtml += `</div>`; // close .popup-body

// ─────────────────────────────────────────────────────────────
// Images block: build optional examples of surface/landcover
// ─────────────────────────────────────────────────────────────
let images = []; // collect <figure> snippets

// Surface example photo (if mapping exists)
const sfUrl = surfacePhotoUrl(p.surface);
if (sfUrl) {
  const sfLabel = (p.surface || '').trim().toLowerCase();
  images.push(`
    <figure style="margin:0;">
      <img src="${sfUrl}" alt="Example surface: ${sfLabel}" style="max-width:100%;border-radius:6px;">
      <figcaption style="font-size:12px;margin-top:4px;">Example surface: ${sfLabel}</figcaption>
    </figure>
  `);
}

// Landcover example photo (if mapping exists)
const lcUrl = landcoverPhotoUrl(p.landcover);
if (lcUrl) {
  const lcLabel = (p.landcover || '').trim().toLowerCase();
  images.push(`
    <figure style="margin:0;">
      <img src="${lcUrl}" alt="Example landcover: ${lcLabel}" style="max-width:100%;border-radius:6px;">
      <figcaption style="font-size:12px;margin-top:4px;">Example landcover: ${lcLabel}</figcaption>
    </figure>
  `);
}

// Build imagesHtml only if we have something
let imagesHtml = '';
if (images.length) {
  if (images.length === 2) {
    // Two images → side-by-side grid
    imagesHtml = `
      <div class="popup-images" style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${images
          .map(fig => fig.replace('<figcaption', '<figcaption style="text-align:center;"'))
          .join('')}
      </div>
    `;
  } else {
    // One image → center at half width
    const centeredHalf = images[0]
      .replace(
        'style="width:100%;height:auto;border-radius:6px;"',
        'style="width:100%;height:auto;border-radius:6px;"'
      )
      .replace('<figcaption', '<figcaption style="text-align:center;"');

    imagesHtml = `
      <div class="popup-images" style="margin-top:10px;display:flex;justify-content:center;">
        <div style="width:50%;">
          ${centeredHalf}
        </div>
      </div>
    `;
  }
}

// ─────────────────────────────────────────────────────────────
// Popup pastel background (depends on difficulty + palette)
// ─────────────────────────────────────────────────────────────
function popupBgFor(diff){
  const pal = cbMode ? palettes.cb.pastel : palettes.normal.pastel;
  const k = String(diff || '').toLowerCase();
  return pal[k] || '#ffffff';
}
  
  // Pastel background based on difficulty + current palette
  const bgColor = popupBgFor(p.difficulty);

  // Wrap popup content so we can set background + add a close button
  const wrapperStart = `<div class="popup-wrapper" style="background:${bgColor};">`;
  const wrapperEnd = `</div>`;

  // Close button (placed first so it's top-right visually via float)
  const closeButtonHtml = `<button class="info-panel-close" aria-label="Close panel" style="float:right; background:none; border:none; font-size:16px; cursor:pointer;">✖</button>`;

  // Final HTML assembled: close button + header + body + optional images
  const html = `${wrapperStart}${closeButtonHtml}${headerHtml}${bodyHtml}${imagesHtml}${wrapperEnd}`;

  // Render into the side info panel
  const panel = document.getElementById('info-panel');
  panel.classList.add('tour-dimmable'); // allow tutorial to dim this panel
  panel.innerHTML = html;
  panel.hidden = false;

  // Hook up close button (hide panel on click)
  panel.querySelector('.info-panel-close').addEventListener('click', () => {
    panel.hidden = true;
  });

  // Initial filter state after layer is ready (ensures active/inactive layers sync)
  applyFilter();
  
}); // ← closes the 'click' handler or previous map.on('load') depending on context

// ─────────────────────────────────────────────────────────────
// Routing graph: fetch pre-split routing GeoJSON and build graphlib graph
// Cost = distance * (score^2), with user bans applied later
// ─────────────────────────────────────────────────────────────
const ROUTING_URL = "https://raw.githubusercontent.com/3070271J/holyrood-trails/refs/heads/main/routing_full_v3.geojson";

fetch(ROUTING_URL, { cache: 'no-store' })
  .then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then((routingFC) => {
    // ===== Build graph (undirected) =====
    const g = new graphlib.Graph({ directed: false });
    const nodeKeyToCoord = new Map(); // node id → [lng,lat]
    const key = (c) => c.map(v => +v.toFixed(7)).join(','); // stable key from coords

    // Extreme threshold (change if score scale changes)
    const EXTREME_MIN = 8;

    // Convert each feature’s coordinates to nodes/edges
    routingFC.features.forEach(f => {
      let coords = f.geometry.coordinates;
      if (f.geometry.type === 'MultiLineString') coords = coords.flat();
      // Normalize coordinate precision (stabilizes node keys)
      coords = coords.map(c => [ +c[0].toFixed(7), +c[1].toFixed(7) ]);
      const score = Number(f.properties?.total_score) || 1;

      for (let i = 0; i < coords.length - 1; i++) {
        const aC = coords[i], bC = coords[i+1];
        const a = key(aC),     b = key(bC);
        nodeKeyToCoord.set(a, aC); nodeKeyToCoord.set(b, bC);
        g.setNode(a); g.setNode(b);
                
        // Edge attributes used for routing decisions
        const score        = Number(f.properties?.total_score) || 1;
        const slopeClass   = Number(f.properties?.slope_class);            // may be NaN
        const vertigoFlag  = (f.properties?.vertigo || '').toLowerCase();  // 'yes'/'no' or ''
        const surfaceScore = Number(f.properties?.surface_score);          // may be NaN
        const natural = f.properties?.natural ?? ''; // 'scrub' or ''

        // Length in meters between consecutive vertices
        const meters = turf.distance(aC, bC, { units: 'meters' });
        // Accessibility-weighted cost (quadratic penalty discourages short steep shortcuts)
        const cost = meters * Math.pow(score, 2);

        // Store all flags used by routing as edge label
        const label  = { cost, score, slope_class: slopeClass, vertigo: vertigoFlag, surface_score: surfaceScore, natural };

        // If duplicate edge exists, keep the cheaper one (handle MultiLine or overlaps)
        const existing = g.edge({ v:a, w:b });
        if (!existing || cost < existing.cost) g.setEdge(a, b, label);
      }
    }); // <-- closes features.forEach

    // Identify connected components (used to fail fast on disconnected starts/ends)
    const comps = graphlib.alg.components(g);
    const compIdx = (k) => { for (let i=0;i<comps.length;i++) if (comps[i].includes(k)) return i; return -1; };

    // ── Routing helpers ──────────────────────────────────────
    function nearestNodeTo(lng, lat){
      let best=null, bestD=Infinity;
      for (const k of g.nodes()){
        const c = nodeKeyToCoord.get(k); if (!c) continue;
        const d = turf.distance(c, [lng, lat], { units:'meters' });
        if (d < bestD){ bestD=d; best=k; }
      }
      return best;
    }

    // Reconstruct path from Dijkstra predecessors
    function backtrack(prev, startKey, endKey){
      const path=[]; let cur=endKey;
      while (cur && cur !== startKey){ path.push(cur); cur = prev[cur]?.predecessor; }
      if (cur === startKey) path.push(startKey);
      return path.reverse();
    }

    // Draw route on map as a LineString; reuse source if it exists
    function drawPath(nodeKeys){
      const coords = nodeKeys.map(k => nodeKeyToCoord.get(k)).filter(Boolean);
      const fc = { type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'LineString', coordinates: coords }, properties:{} }]};
      if (map.getSource('shortest-path')) map.getSource('shortest-path').setData(fc);
      else {
        map.addSource('shortest-path', { type:'geojson', data: fc });
        map.addLayer({ id:'shortest-path-layer', type:'line', source:'shortest-path',
          paint:{ 'line-color':'#1e90ff', 'line-width':5 } });
      }
    }
  
     // ===== Map routing graphics helpers =====
    // Remove any existing route + markers (used when clearing/resetting)
    function clearRouteGraphics(){
      ['shortest-path','start','end'].forEach(base=>{
        if (map.getLayer(`${base}-layer`)) map.removeLayer(`${base}-layer`);
        if (map.getSource(base)) map.removeSource(base);
      });
    }

    // Add start/end markers (styled as circles with outline)
    function addMarker(id, coord, color){
      const fc = { type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'Point', coordinates: coord } }]};
      if (map.getSource(id)) map.getSource(id).setData(fc);
      else {
        map.addSource(id, { type:'geojson', data: fc });
        map.addLayer({ id:`${id}-layer`, type:'circle', source:id,
          paint:{ 'circle-radius':6, 'circle-color':color, 'circle-stroke-width':2, 'circle-stroke-color':'#fff' } });
      }
    }
  
  // ===== Route hint banner (appears at top during routing) =====
  const hintEl = document.getElementById('route-hint');

  function showRouteHint(msg) {
    if (!hintEl) return;
    hintEl.textContent = msg;
    hintEl.hidden = false;
    // Use RAF so "show" class applies after layout
    requestAnimationFrame(() => hintEl.classList.add('show'));
  }

  function hideRouteHint() {
    if (!hintEl) return;
    hintEl.classList.remove('show');
    // Wait until fade-out transition before clearing
    setTimeout(() => { hintEl.hidden = true; hintEl.textContent = ''; }, 180);
  }
  
  // Hide side info panel (used when starting routing)
  function hideInfoPanel() {
    const panel = document.getElementById('info-panel');
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = '';
  }
  
  // ===== Utility: route length calculations =====
  // Sum distance across node sequence
  function pathLengthMeters(nodeKeys, nodeKeyToCoord) {
    let m = 0;
    for (let i = 0; i < nodeKeys.length - 1; i++) {
      const a = nodeKeyToCoord.get(nodeKeys[i]);
      const b = nodeKeyToCoord.get(nodeKeys[i+1]);
      if (a && b) m += turf.distance(a, b, { units: 'meters' });
    }
    return m;
  }

  // Format distance nicely (m or km)
  function formatDistance(meters) {
    return (meters >= 1000)
      ? `${(meters / 1000).toFixed(2)} km`
      : `${Math.round(meters)} m`;
  }
  
  // Advisory threshold: above this, show "consider break" warning
  const ROUTE_WARN_M = 2000; // tweakable
  
  // ===== Tutorial (tour) utilities =====
  // Get element rectangle in page coords (used for spotlight box)
  function _rectFor(sel) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  // Position spotlight + instruction card relative to target
  function _positionStep(step) {
    const t = document.getElementById('tour');
    const spot = t.querySelector('.tour-spot');
    const card = t.querySelector('.tour-card');
    const text = t.querySelector('#tour-text');

    text.innerHTML = step.html;

    // Target rectangle (fallback to center if none provided)
    let R = step.target ? _rectFor(step.target) : null;
    if (!R) {
      R = { x: window.innerWidth/2 - 150, y: window.innerHeight/2 - 60, w: 300, h: 120 };
    }

    // Spotlight box aligned to target
    spot.style.left = `${R.x}px`; spot.style.top = `${R.y}px`;
    spot.style.width = `${R.w}px`; spot.style.height = `${R.h}px`;

    // Place card just below (or above if too close to bottom)
    const gap = 10;
    let cx = R.x, cy = R.y + R.h + gap;
    if (cy + 140 > window.scrollY + window.innerHeight) cy = Math.max(8 + window.scrollY, R.y - card.offsetHeight - gap);
    // Keep card within horizontal bounds
    cx = Math.min(Math.max(8 + window.scrollX, cx), window.scrollX + window.innerWidth - card.offsetWidth - 8);
    card.style.left = `${cx}px`; card.style.top = `${cy}px`;
  }

  // ===== Tour object: simple state machine for step-through tutorial =====
  const Tour = {
    steps: [],
    i: 0,
    start(steps) {
      this.steps = steps; this.i = 0;
      document.getElementById('tour').hidden = false;
      this.show();
    },
    end() {
      document.getElementById('tour').hidden = true;
      this.steps = []; this.i = 0;
    },
    show() {
      const s = this.steps[this.i]; if (!s) return this.end();
      // Optional per-step callback
      if (typeof s.run === 'function') s.run();
      _positionStep(s);
    },
    next() { if (this.i < this.steps.length - 1) { this.i++; this.show(); } else { this.end(); } },
    prev() { if (this.i > 0) { this.i--; this.show(); } }
  }; 
  
  
  // ─────────────────────────────────────────────────────────────
// Tutorial buttons + responsive repositioning
// ─────────────────────────────────────────────────────────────
(() => {
  const t = document.getElementById('tour');
  t.querySelector('#tour-next').addEventListener('click', () => Tour.next());
  t.querySelector('#tour-prev').addEventListener('click', () => Tour.prev());
  t.querySelector('#tour-skip').addEventListener('click', () => Tour.end());
  // Reposition spotlight/card on resize
  window.addEventListener('resize', () => Tour.show(), { passive:true });
})();

// ─────────────────────────────────────────────────────────────
/* Routing UI: start/clear buttons (first pair)
   - Start: enter selection mode, clear graphics, hide info panel, show hint
   - Clear: exit selection mode, clear graphics, hide hint
*/
// ─────────────────────────────────────────────────────────────
document.getElementById('start-routing').addEventListener('click', () => {
  routingActive = true;
  startNode = endNode = null;
  clearRouteGraphics();
  hideInfoPanel();  // <-- auto-close details panel so map is in focus
  showRouteHint('Click a start point, then an end point.');
});

document.getElementById('clear-routing').addEventListener('click', () => {
  routingActive = false;
  startNode = endNode = null;
  clearRouteGraphics();
  hideRouteHint();
  // hideInfoPanel();
});

// ─────────────────────────────────────────────────────────────
// Routing state + second pair of handlers (duplicated on purpose)
// (Keeps behaviour explicit; both pairs do the same thing.)
// ─────────────────────────────────────────────────────────────
routingActive = false;
let startNode = null, endNode = null;
// const statusEl = document.getElementById('route-status'); // optional helper for inline status

document.getElementById('start-routing').addEventListener('click', () => {
  routingActive = true;
  startNode = endNode = null;
  clearRouteGraphics();
  showRouteHint('Click a start point, then an end point.');
});

document.getElementById('clear-routing').addEventListener('click', () => {
  routingActive = false;
  startNode = endNode = null;
  clearRouteGraphics();
  hideRouteHint();
});

// ─────────────────────────────────────────────────────────────
// Edge label helper
// Returns a safe label if the edge is missing (treated as impassable)
// ─────────────────────────────────────────────────────────────
const labelOf = (e) => g.edge(e) || { cost: Infinity, score: 99, slope_class: 99, vertigo: 'no', surface_score: 99, natural: '' };

// ─────────────────────────────────────────────────────────────
/* Weight function factory:
   - Reads current UI prefs
   - Enforces bans (difficulty, extreme on pass 1, steep, vertigo, uneven, overgrowth)
   - Returns edge cost or Infinity (to remove edge from consideration)
*/
// ─────────────────────────────────────────────────────────────
function makeWeightFn(avoidExtreme) {
  const allowed = new Set(getCheckedDifficulties());
  const showSteepSlopes = document.getElementById('pref-steep').checked;
  const showVertigoRisk = document.getElementById('pref-vertigo').checked;
  const showUnevenGround = document.getElementById('pref-uneven').checked;
  const showOvergrowth   = document.getElementById('pref-overgrowth').checked;

  return (e) => {
    const lab = labelOf(e); // { cost, score, slope_class, vertigo, surface_score, natural }
    const diff = scoreToDifficulty(lab.score);

    // Difficulty filter (must be allowed)
    if (!allowed.has(diff)) return Infinity;

    // Pass 1: avoid extreme segments completely
    if (avoidExtreme && diff === 'extreme') return Infinity;

    // Preference bans
    if (!showSteepSlopes && Number(lab.slope_class) >= 5) return Infinity;
    if (!showVertigoRisk && lab.vertigo === 'yes') return Infinity;
    if (!showUnevenGround && Number(lab.surface_score) === 4) return Infinity;
    if (!showOvergrowth && lab.natural === 'scrub') return Infinity;

    // Otherwise use the accessibility-weighted cost
    return lab.cost;
  };
}

// ─────────────────────────────────────────────────────────────
// Inspect path edges to see if any are "extreme" (score >= EXTREME_MIN)
// Used to decide which advisory message to show
// ─────────────────────────────────────────────────────────────
function hasExtremeOnPath(nodeKeys){
  for (let i = 0; i < nodeKeys.length - 1; i++){
    const v = nodeKeys[i], w = nodeKeys[i+1];
    const lab = g.edge({ v, w }) || g.edge({ v: w, w: v });
    if (lab && lab.score >= EXTREME_MIN) return true;
  }
  return false;
}
  
  
  
  
  
  
  
  
// ─────────────────────────────────────────────────────────────
// Map click handler for routing (start → end → restart cycle)
// ─────────────────────────────────────────────────────────────
map.on('click', (e) => {
  if (!routingActive) return; // only active when user pressed "Start Routing"

  const node = nearestNodeTo(e.lngLat.lng, e.lngLat.lat);
  if (!node) return;

  const markerPal = cbMode ? palettes.cb : palettes.normal;

  // First click → START node
  if (!startNode) {
    startNode = node;
    clearRouteGraphics(); // wipe any old routes
    addMarker('start', nodeKeyToCoord.get(startNode), markerPal.markerStart);
    showRouteHint('Now click an end point.');
    return;
  }

  // Second click → END node, then solve
  if (!endNode) {
    endNode = node;
    addMarker('end', nodeKeyToCoord.get(endNode), markerPal.markerEnd);

    // Check connectivity (skip if nodes are in different components)
    if (compIdx(startNode) !== compIdx(endNode)) {
      showRouteHint('No path: start/end are disconnected.');
      return;
    }

    // PASS 1: avoid extreme segments
    let res = graphlib.alg.dijkstra(
      g, startNode, makeWeightFn(true), v => g.nodeEdges(v)
    );
    let endInfo = res[endNode];

    if (!endInfo || !isFinite(endInfo.distance)) {
      // Only attempt PASS 2 if "extreme" difficulty is allowed
      const allowed = new Set(getCheckedDifficulties());
      const extremeAllowed = allowed.has('extreme');

      if (!extremeAllowed) {
        showRouteHint('No route with current preferences.');
        return;
      }

      // PASS 2: allow extreme sections, but still respect other bans
      res = graphlib.alg.dijkstra(
        g, startNode, makeWeightFn(false), v => g.nodeEdges(v)
      );
      endInfo = res[endNode];

      if (!endInfo || !isFinite(endInfo.distance)) {
        showRouteHint('No path found.');
        return;
      }

      const path2 = backtrack(res, startNode, endNode);
      drawPath(path2);

      // Length + message (warn about extreme or long distance)
      const lenM2 = pathLengthMeters(path2, nodeKeyToCoord);
      const usedExtreme = hasExtremeOnPath(path2);
      let msg2 = `Route length: ${formatDistance(lenM2)}`;
      msg2 += usedExtreme 
        ? ` — includes sections that are difficult for most users. `
        : `. `;
      if (lenM2 > ROUTE_WARN_M) msg2 += 'Consider rest or a shorter option.';
      showRouteHint(msg2);

      return; // END of PASS 2
    }

    // PASS 1 succeeded (no extreme used)
    const path1 = backtrack(res, startNode, endNode);
    drawPath(path1);

    const lenM1 = pathLengthMeters(path1, nodeKeyToCoord);
    let msg1 = `Route length: ${formatDistance(lenM1)}. `;
    if (lenM1 > ROUTE_WARN_M) msg1 += 'Consider a break or a shorter option.';
    showRouteHint(msg1);

    return; // END of PASS 1
  }

  // Third click → restart with a new start node
  startNode = node;
  endNode = null;
  clearRouteGraphics();
  addMarker('start', nodeKeyToCoord.get(startNode), markerPal.markerStart);
  showRouteHint('Now click an end point.');
});

// ─────────────────────────────────────────────────────────────
// Routing fetch error handler
// ─────────────────────────────────────────────────────────────
})
.catch(err => {
  console.error('Failed to load routing data:', err && (err.name + ': ' + err.message));
});
});



// ─────────────────────────────────────────────
// Interactive tutorial ("map tour")
// Walks the user through key UI elements step by step
// ─────────────────────────────────────────────
function startMapTour() {
  // Define tutorial steps (text + target element + behaviour flags)
  const TOUR_STEPS = [
    { text: 'This is the map. You can click on segments to see details.', target: '#map', dim: false, hideUI: true },
    { text: 'This is the legend. It explains trail difficulty colours.', target: '#legend', dim: true, hideUI: false },
    { text: 'This is the toolbox — use it to filter trails and find routes.', target: '#toolbox', dim: true, hideUI: false }
  ];

  const tour = document.getElementById('tour');
  const tourText = document.getElementById('tour-text');
  const spot = document.querySelector('#tour .tour-spot');
  const backdrop = document.querySelector('#tour .tour-backdrop');

  // Elements to temporarily hide (map step only)
  const UI_TO_HIDE = ['#legend', '#toolbox', '#info-panel'];

  // Hide or show UI panels depending on the step
  function hideUI(flag) {
    UI_TO_HIDE.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      if (flag) el.classList.add('tour-hidden'); 
      else el.classList.remove('tour-hidden');
    });
  }

  // Elevate one element above backdrop (highlight effect)
  function elevateTarget(selector, flag) {
    document.querySelectorAll('.tour-elevate')
      .forEach(el => el.classList.remove('tour-elevate'));
    if (!flag) return;
    const el = selector ? document.querySelector(selector) : null;
    if (el) el.classList.add('tour-elevate');
  }

  // Position the white outline ("spotlight") around the target
  function positionSpot(selector){
    if (!spot) return;
    const el = selector ? document.querySelector(selector) : null;
    if (!el) { spot.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    spot.style.display = 'block';
    spot.style.left   = `${r.left}px`;
    spot.style.top    = `${r.top}px`;
    spot.style.width  = `${r.width}px`;
    spot.style.height = `${r.height}px`;
  }

  // Toggle dark backdrop
  function setBackdrop(visible){
    if (!backdrop) return;
    backdrop.style.display = visible ? 'block' : 'none';
    if (!visible && spot) spot.style.display = 'none';
  }

  // End the tour → reset everything
  function endTour(){
    tour.hidden = true;
    setBackdrop(false);
    hideUI(false);
    elevateTarget(null, false);
    if (spot) spot.style.display = 'none';
  }

  // Step index tracker
  let current = 0;

  // Display one step of the tour
  function showStep(i){
    const step = TOUR_STEPS[i];
    if (!step) return endTour();

    tour.hidden = false;
    tourText.textContent = step.text;

    // Map step = hide UI, no dim. Legend/toolbox = show UI, dim.
    hideUI(!!step.hideUI);
    setBackdrop(!!step.dim);

    // Highlight the target (above backdrop)
    elevateTarget(step.target, !!step.dim);

    // Draw the spotlight only if dimming
    if (step.dim) positionSpot(step.target);
  }

  // Wire up tour buttons
  document.getElementById('tour-next').onclick = () => {
    if (current < TOUR_STEPS.length - 1) { current++; showStep(current); }
    else { endTour(); }
  };
  document.getElementById('tour-prev').onclick = () => {
    if (current > 0) { current--; showStep(current); }
  };
  document.getElementById('tour-skip').onclick = endTour;

  // Recalculate spotlight position if window resizes/scrolls
  (function setSpotListeners(){
    let raf = null;
    function scheduleReposition() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const step = TOUR_STEPS[current];
        if (step?.dim) positionSpot(step.target);
      });
    }

    window.addEventListener('resize', scheduleReposition, { passive: true });
    window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });

    // ResizeObserver to reposition if target element itself changes size
    let ro = null;
    function observeTarget(selector){
      if (ro) { ro.disconnect(); ro = null; }
      const el = selector ? document.querySelector(selector) : null;
      if (!el) return;
      ro = new ResizeObserver(scheduleReposition);
      ro.observe(el);
    }

    // Patch showStep to also attach observer
    const _showStep = showStep;
    showStep = function(i){
      _showStep(i);
      const step = TOUR_STEPS[i];
      if (step?.dim) observeTarget(step.target);
    };
  })();

  // Start with first step
  showStep(current);
}

// Expose globally (called from welcome popup)
window.startMapTour = startMapTour;
