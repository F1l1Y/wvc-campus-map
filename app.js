/* West Valley Campus Map.
   Static, no backend, no keys, no analytics, nothing stored.
   Accuracy rule: nothing on this map is placed by eye. Every building comes from a surveyed
   OpenStreetMap footprint; every amenity comes from a pictogram printed on the official
   February 2024 campus map, transformed onto those footprints by a measured 16-point fit;
   every room comes from an official plan or the official schedule, and carries its source. */

const CAMPUS_CENTER = [37.2637, -122.0096];
const DATA = { buildings: [], rooms: [], plans: {}, amen: null, roomsDoc: null };
const $ = (s) => document.querySelector(s);

/* ---------------------------------------------------------------- map */
const map = L.map("map", { zoomControl: true, attributionControl: true }).setView(CAMPUS_CENTER, 17);
L.control.scale({ imperial: true, metric: true }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20, maxNativeZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const C = { navy:"#0f172a", lime:"#8fce2a", limeD:"#4d7a0c", cyan:"#0e9fbd", slate:"#7b8aa3" };
function styleFor(f) {
  const p = f.properties;
  if (p.kind === "parking") return { color: C.cyan, weight: 1, fillColor: C.cyan, fillOpacity: .1 };
  const named = !!p.name;
  return { color: named ? C.limeD : C.slate, weight: named ? 1.5 : 1,
           fillColor: named ? C.navy : "#93a0b4", fillOpacity: named ? .5 : .22 };
}
const styleOn = { color: C.limeD, weight: 4, fillColor: C.lime, fillOpacity: .55 };
let selected = [];

fetch("campus.geojson?v=10").then(r => r.json()).then(gj => {
  const layer = L.geoJSON(gj, {
    style: styleFor,
    onEachFeature: (f, ly) => {
      const p = f.properties;
      const label = p.code ? `${p.code}` : (p.name || "");
      if (p.name) {
        ly.bindTooltip(label, { permanent: p.kind === "building", direction: "center",
                                className: p.kind === "parking" ? "lbl lbl-park" : "lbl" });
      }
      if (p.kind === "building" && p.name) {
        const b = { name: p.name, code: p.code || "", houses: p.houses || "", note: p.code_note || "",
                    codeSrc: p.code_source || "", layer: ly, center: ly.getBounds().getCenter() };
        DATA.buildings.push(b);
        ly.on("click", () => showBuilding(b));
      } else if (p.kind === "parking") {
        ly.on("click", () => ly.bindPopup("<b>Parking</b>").openPopup());
      }
    },
  }).addTo(map);
  const built = L.featureGroup(DATA.buildings.map(b => b.layer));
  map.invalidateSize();
  try { map.fitBounds(built.getBounds(), { padding: [24, 24], maxZoom: 17 }); }
  catch (e) { map.setView(CAMPUS_CENTER, 16); }
  addEventListener("resize", () => map.invalidateSize());
  addEventListener("orientationchange", () => setTimeout(() => map.invalidateSize(), 250));
  loadRooms(); loadAmenities();
});

/* ------------------------------------------------------------- rooms */
function loadRooms() {
  fetch("rooms.json?v=10").then(r => r.json()).then(j => {
    DATA.roomsDoc = j;
    for (const [bcode, b] of Object.entries(j.buildings || {}))
      for (const r of b.rooms)
        DATA.rooms.push({ code: r.code, name: r.name || "", bcode, bname: b.name,
                          capacity: r.capacity, zone: r.zone, source: b.source, kind: "directory" });
    const inv = j.schedule_inventory || {};
    for (const [bcode, list] of Object.entries(inv.buildings || {}))
      for (const rm of list) {
        const code = `${bcode} ${rm}`;
        if (DATA.rooms.some(x => norm(x.code) === norm(code))) continue;
        DATA.rooms.push({ code, name: "", bcode, bname: (buildingByCode(bcode) || {}).name || bcode,
                          source: inv.source, kind: "schedule" });
      }
    // plans
    ["pe"].forEach(id => fetch(`plans/${id}.json?v=10`).then(r => r.json()).then(p => {
      DATA.plans[p.building] = p;
      p.rooms.forEach(r => {
        if (!r.code) return;
        const hit = DATA.rooms.find(x => norm(x.code) === norm(r.code));
        if (hit) { hit.kind = "plan"; hit.name = hit.name || r.name; }
        else DATA.rooms.push({ code: r.code, name: r.name, bcode: p.building, bname: p.name,
                               source: p.source, kind: "plan" });
      });
    }).catch(() => {}));
  });
}
function loadAmenities() {
  fetch("amenities.json?v=10").then(r => r.json()).then(j => { DATA.amen = j; buildAmenityLayers(j); });
}
function buildingByCode(code) {
  const n = norm(code);
  return DATA.buildings.find(b => norm(b.code) === n)
      || DATA.buildings.find(b => norm(b.code).split(" ").includes(n));
}

/* --------------------------------------------------------- amenities */
const amenLayers = {};
const AMEN_GLYPH = { aed:"✚", evacuation_site:"⇱", restroom_gender_neutral:"WC",
                     ev_charger:"⚡", parking:"P" };
function amenGroup(t) { return t.startsWith("parking") ? "parking" : t; }
function buildAmenityLayers(j) {
  const groups = {};
  j.items.forEach(it => { (groups[amenGroup(it.type)] ||= []).push(it); });
  for (const [g, items] of Object.entries(groups)) {
    const lg = L.layerGroup();
    items.forEach(it => {
      const icon = L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11],
        html: `<div class="amen ${g}">${AMEN_GLYPH[g] || "•"}</div>` });
      L.marker([it.lat, it.lon], { icon })
        .bindPopup(`<b>${it.title}</b><br><span style="color:#63708a">near ${it.near_code ? it.near_code + " · " : ""}${it.near}</span>` +
                   `<br><small style="color:#8b97ad">Official campus map, Feb 2024 · placed to ±${j.fit.max_residual_m} m</small>`)
        .addTo(lg);
    });
    amenLayers[g] = lg;
  }
}
document.querySelectorAll(".chip").forEach(btn => {
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => {
    const g = btn.dataset.layer, on = btn.getAttribute("aria-pressed") === "true";
    const ly = amenLayers[g]; if (!ly) return;
    if (on) { map.removeLayer(ly); btn.setAttribute("aria-pressed", "false"); }
    else { ly.addTo(map); btn.setAttribute("aria-pressed", "true"); }
  });
});

/* ------------------------------------------------------------ search */
const q = $("#q"), results = $("#results"), clearBtn = $("#clearBtn");
function norm(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function squash(s) { return norm(s).replace(/ /g, ""); }

function find(text) {
  const n = norm(text), sq = squash(text);
  if (!n) return [];
  const out = [];
  for (const r of DATA.rooms) {
    const c = norm(r.code), cs = squash(r.code);
    let score = null;
    if (c === n || cs === sq) score = 0;
    else if (cs.startsWith(sq)) score = 1;
    else if (cs.includes(sq)) score = 2;
    else if (r.name && norm(r.name).includes(n)) score = 4;
    if (score !== null) out.push({ kind: "room", r, score: score - (r.kind === "plan" ? .5 : 0) });
  }
  for (const b of DATA.buildings) {
    const c = norm(b.code), nm = norm(b.name);
    let score = null;
    if (c === n) score = 0; else if (nm === n) score = .5;
    else if (nm.startsWith(n)) score = 1.5; else if (nm.includes(n)) score = 3;
    else if (c && squash(b.code).startsWith(sq)) score = 2.5;
    else if (b.houses && norm(b.houses).includes(n)) score = 4.5;
    if (score !== null) out.push({ kind: "building", b, score });
  }
  // "SM 4F" style: an unknown room number in a building we do know. Still answer with the building.
  if (!out.length) {
    const lead = n.split(" ")[0];
    const b = DATA.buildings.find(x => norm(x.code) === lead || squash(x.code) === lead);
    if (b) out.push({ kind: "building", b, score: 9, partial: text.trim() });
  }
  out.sort((a, b) => a.score - b.score || String(a.r?.code || a.b?.code).localeCompare(String(b.r?.code || b.b?.code)));
  return out.slice(0, 12);
}
let hits = [], cursor = -1;
function renderResults() {
  if (!hits.length) {
    const typed = q.value.trim();
    results.innerHTML = typed
      ? `<li class="empty">No match for <b>${esc(typed)}</b>. Room codes look like <b>PE 10</b>, <b>LASS 30</b>, <b>LRC 141</b>. If it is a real room that is missing, the plan for that building has not been captured yet.</li>`
      : "";
    results.hidden = !typed; return;
  }
  results.innerHTML = hits.map((h, i) => {
    if (h.kind === "building")
      return `<li role="option" data-i="${i}"><span class="code">${esc(h.b.code || "")}</span>
        <span class="sub">${esc(h.b.name)}</span><span class="tag">${h.partial ? "building only" : "building"}</span></li>`;
    const r = h.r, tag = r.kind === "plan" ? '<span class="tag plan">floor plan</span>'
                    : r.kind === "directory" ? '<span class="tag">listed</span>'
                    : '<span class="tag">in schedule</span>';
    return `<li role="option" data-i="${i}"><span class="code">${esc(r.code)}</span>
      <span class="sub">${esc(r.name || r.bname)}</span>${tag}</li>`;
  }).join("");
  results.hidden = false;
  results.querySelectorAll("li[data-i]").forEach(li =>
    li.addEventListener("click", () => choose(hits[+li.dataset.i])));
}
q.addEventListener("input", () => {
  clearBtn.hidden = !q.value; hits = find(q.value); cursor = -1; renderResults();
});
q.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); if (!hits.length) return;
    cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    results.querySelectorAll("li[data-i]").forEach((li, i) =>
      li.setAttribute("aria-selected", i === cursor));
  } else if (e.key === "Enter") {
    if (hits.length) { e.preventDefault(); choose(hits[cursor >= 0 ? cursor : 0]); }
  } else if (e.key === "Escape") { results.hidden = true; q.blur(); }
});
$("#searchForm").addEventListener("submit", e => {
  e.preventDefault(); if (hits.length) choose(hits[cursor >= 0 ? cursor : 0]);
});
clearBtn.addEventListener("click", () => { q.value = ""; clearBtn.hidden = true; hits = []; renderResults(); q.focus(); });
document.addEventListener("click", e => { if (!e.target.closest(".search")) results.hidden = true; });

function choose(h) {
  results.hidden = true; q.blur();
  if (h.kind === "building") showBuilding(h.b, h.partial); else showRoom(h.r);
}

/* ------------------------------------------------------------- panel */
const panel = $("#panel"), panelBody = $("#panelBody");
$("#panelClose").addEventListener("click", closePanel);
function closePanel() { panel.hidden = true; }
function openPanel(html) { panelBody.innerHTML = html; panel.hidden = false; panel.scrollTop = 0; }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function flyTo(b, zoom = 18) {
  selected.forEach(x => x.layer.setStyle(styleFor({ properties: { kind: "building", name: x.name } })));
  // a building code can cover several footprints (PE and CHE each have more than one)
  selected = b.code ? DATA.buildings.filter(x => x.code === b.code) : [b];
  selected.forEach(x => x.layer.setStyle(styleOn));
  const grp = L.featureGroup(selected.map(x => x.layer));
  const sz = map.getSize();
  // a zero-sized container (some embedded/headless viewports) makes flyToBounds produce NaN
  if (sz.x > 40 && sz.y > 40) {
    try { map.flyToBounds(grp.getBounds(), { padding: [70, 70], maxZoom: zoom, duration: .6 }); return; }
    catch (e) { /* fall through to a plain setView */ }
  }
  map.setView(b.center, Math.min(zoom, 18));
}

function showBuilding(b, partial) {
  flyTo(b);
  const dir = DATA.roomsDoc?.buildings?.[b.code];
  const inv = DATA.roomsDoc?.schedule_inventory?.buildings?.[b.code] || [];
  const plan = DATA.plans[b.code];
  let h = `<div class="pad"><div class="eyebrow">${esc(b.code || "Building")}</div><h2>${esc(b.name)}</h2>`;
  if (partial) h += `<div class="warn"><b>${esc(partial)}</b> is not in any source I have yet, but ${esc(b.code)} is this building, so this is where to head. The room list below is everything I can currently prove exists in it.</div>`;
  if (b.houses) h += `<p class="sub">${esc(b.houses)}</p>`;
  if (plan) h += `<div class="btnrow"><button class="btn primary" onclick="openPlan('${b.code}')">Open floor plan</button></div>`;
  if (dir) {
    h += `<h3>Rooms on the posted plan</h3><ul class="roomlist">` +
      dir.rooms.map(r => `<li><b>${esc(r.code)}</b> ${esc(r.name || "")}${r.capacity ? ` <span class="sub">· ${r.capacity}</span>` : ""}</li>`).join("") + `</ul>`;
    if (dir.spaces_without_numbers)
      h += `<h3>Also in this building</h3><div class="chips">` +
        dir.spaces_without_numbers.map(s => `<span class="tagchip">${esc(s)}</span>`).join("") + `</div>`;
    h += `<div class="src"><b>Source:</b> ${esc(dir.source)}</div>`;
    (dir.notes || []).forEach(n => h += `<div class="src">${esc(n)}</div>`);
  }
  if (inv.length) {
    h += `<h3>Rooms with Fall 2026 classes</h3><ul class="roomlist">` +
      inv.map(r => `<li><b>${esc(b.code)} ${esc(r)}</b></li>`).join("") + `</ul>` +
      `<div class="src"><b>Source:</b> ${esc(DATA.roomsDoc.schedule_inventory.source)}</div>`;
  }
  if (!plan) h += `<div class="warn">No floor plan captured for this building yet, so the map can show you the building but not the room inside it. A straight-on photo of the posted plan is all it takes.</div>`;
  if (b.note) h += `<div class="src">${esc(b.note)}</div>`;
  if (b.codeSrc) h += `<div class="src"><b>Building code:</b> ${esc(b.codeSrc)}</div>`;
  openPanel(h + `</div>`);
}

function showRoom(r) {
  const b = buildingByCode(r.bcode);
  if (b) flyTo(b, 18.5);
  const plan = DATA.plans[r.bcode];
  const inPlan = plan && plan.rooms.some(x => norm(x.code) === norm(r.code));
  let h = `<div class="pad"><div class="eyebrow">${esc(r.bcode)} · ${esc(r.bname)}</div>
    <h2>${esc(r.code)}</h2>`;
  if (r.name) h += `<p class="sub">${esc(r.name)}</p>`;
  if (r.capacity) h += `<p class="sub">Seats ${esc(r.capacity)}</p>`;
  if (r.zone) h += `<p class="sub">Where in the building: ${esc(r.zone)}</p>`;
  h += `</div>`;
  if (inPlan) h += `<div class="planbar"><span>Highlighted on the posted floor plan</span>
      <span style="margin-left:auto"><button class="zoombtn" onclick="planZoom(1.3)">+</button>
      <button class="zoombtn" onclick="planZoom(1/1.3)">−</button>
      <button class="zoombtn" onclick="planReset()">⤢</button></span></div>
      <div class="planwrap" id="planwrap">${planSVG(plan, r.code)}</div>`;
  h += `<div class="pad" style="padding-top:14px">`;
  if (!inPlan) h += `<div class="warn">This room is real and in ${esc(r.bcode)}, but ${esc(r.bcode)}'s floor plan has not been captured yet, so I can put you at the building, not at the door.</div>`;
  h += `<div class="src"><b>Source:</b> ${esc(r.source)}</div></div>`;
  openPanel(h);
  if (inPlan) { initPlanPan(); setTimeout(() => focusRoom(r.code), 30); }
}

/* -------------------------------------------------------- floor plan */
let planState = { k: 1, x: 0, y: 0, plan: null };
function planSVG(plan, highlight) {
  planState.plan = plan;
  const rooms = plan.rooms.map((r, i) => {
    const pts = r.poly.map(p => p.join(",")).join(" ");
    const on = highlight && norm(r.code) === norm(highlight);
    const cls = `pr ${r.kind || "room"}${on ? " on" : ""}${r.code ? " hit" : ""}`;
    const cx = r.poly.reduce((s, p) => s + p[0], 0) / r.poly.length;
    const cy = r.poly.reduce((s, p) => s + p[1], 0) / r.poly.length;
    const w = Math.max(...r.poly.map(p => p[0])) - Math.min(...r.poly.map(p => p[0]));
    const hgt = Math.max(...r.poly.map(p => p[1])) - Math.min(...r.poly.map(p => p[1]));
    const short = (r.code || "").replace(/^[A-Z/]+ /, "");
    const showLabel = w > 34 && hgt > 22;
    const fs = Math.max(11, Math.min(26, w / Math.max(2, short.length) * 1.5));
    return `<polygon class="${cls}" points="${pts}" data-code="${esc(r.code)}"
             data-name="${esc(r.name || "")}" data-i="${i}"><title>${esc(r.code || r.name)}${r.name && r.code ? " · " + esc(r.name) : ""}</title></polygon>` +
      (showLabel && short ? `<text class="plabel" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" style="font-size:${fs}px">${esc(short)}</text>` : "");
  }).join("");
  return `<svg viewBox="0 0 ${plan.width} ${plan.height}" preserveAspectRatio="xMidYMid meet" id="plansvg">
      <g id="plang">${rooms}</g></svg>`;
}
function applyPlanTransform() {
  const g = document.getElementById("plang");
  if (g) g.setAttribute("transform", `translate(${planState.x} ${planState.y}) scale(${planState.k})`);
}
function planZoom(f) {
  const p = planState.plan; if (!p) return;
  const cx = p.width / 2, cy = p.height / 2;
  planState.x = cx - (cx - planState.x) * f; planState.y = cy - (cy - planState.y) * f;
  planState.k *= f; applyPlanTransform();
}
function planReset() { planState.k = 1; planState.x = 0; planState.y = 0; applyPlanTransform(); }
function focusRoom(code) {
  const p = planState.plan; if (!p) return;
  const r = p.rooms.find(x => norm(x.code) === norm(code)); if (!r) return;
  const xs = r.poly.map(q => q[0]), ys = r.poly.map(q => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rw = Math.max(12, Math.max(...xs) - Math.min(...xs)), rh = Math.max(12, Math.max(...ys) - Math.min(...ys));
  // aim for the room filling about a third of the frame, so its corridor and neighbours stay visible
  const k = Math.max(1, Math.min(4.5, Math.min(p.width / rw, p.height / rh) / 3));
  planState.k = k; planState.x = p.width / 2 - cx * k; planState.y = p.height / 2 - cy * k;
  applyPlanTransform();
}
function initPlanPan() {
  const wrap = document.getElementById("planwrap"); if (!wrap) return;
  let down = false, sx = 0, sy = 0, ox = 0, oy = 0, pinch = 0;
  const pt = e => e.touches ? e.touches[0] : e;
  wrap.addEventListener("pointerdown", e => {
    down = true; wrap.classList.add("drag"); sx = e.clientX; sy = e.clientY;
    ox = planState.x; oy = planState.y; wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", e => {
    if (!down) return;
    const sc = planState.plan.width / wrap.clientWidth;
    planState.x = ox + (e.clientX - sx) * sc; planState.y = oy + (e.clientY - sy) * sc;
    applyPlanTransform();
  });
  const up = e => { down = false; wrap.classList.remove("drag"); };
  wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up);
  wrap.addEventListener("wheel", e => { e.preventDefault(); planZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  wrap.addEventListener("click", e => {
    const poly = e.target.closest("polygon"); if (!poly || !poly.dataset.code) return;
    wrap.querySelectorAll(".pr.on").forEach(n => n.classList.remove("on"));
    poly.classList.add("on");
    const code = poly.dataset.code;
    const rec = DATA.rooms.find(x => norm(x.code) === norm(code));
    if (rec) { q.value = code; clearBtn.hidden = false; showRoom(rec); }
  });
}
function openPlan(bcode) {
  const p = DATA.plans[bcode]; if (!p) return;
  let h = `<div class="pad"><div class="eyebrow">${esc(bcode)} floor plan</div><h2>${esc(p.name)}</h2>
    <p class="sub">${esc(p.floor || "")}</p></div>
    <div class="planbar"><span>Tap any room</span><span style="margin-left:auto">
      <button class="zoombtn" onclick="planZoom(1.3)">+</button>
      <button class="zoombtn" onclick="planZoom(1/1.3)">−</button>
      <button class="zoombtn" onclick="planReset()">⤢</button></span></div>
    <div class="planwrap" id="planwrap">${planSVG(p, null)}</div>
    <div class="pad" style="padding-top:14px">`;
  if (p.caution) h += `<div class="warn">${esc(p.caution)}</div>`;
  h += `<div class="src"><b>Source:</b> ${esc(p.source)}</div></div>`;
  openPanel(h); initPlanPan();
}
window.openPlan = openPlan; window.planZoom = planZoom; window.planReset = planReset;

/* --------------------------------------------------------- locate me */
let me = null;
$("#locate").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Location is not available in this browser.");
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (me) me.remove();
    me = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: C.cyan, fillOpacity: 1 })
          .addTo(map).bindPopup("You are here").openPopup();
    map.flyTo(ll, 18);
  }, () => alert("Could not get your location. Check the browser's location permission."),
     { enableHighAccuracy: true, timeout: 10000 });
});

window.__map = map; window.__DATA = DATA;   // debug handles, no behaviour attached

/* ------------------------------------------------------------- about */
$("#aboutBtn").addEventListener("click", () => {
  const a = DATA.amen;
  openPanel(`<div class="pad"><div class="eyebrow">Provenance</div><h2>Where the data comes from</h2>
    <p class="sub">Nothing on this map is placed by eye. Every layer below names its source and its date.</p>
    <h3>Buildings and parking</h3>
    <p>Surveyed footprints from OpenStreetMap contributors (ODbL). ${DATA.buildings.length} named buildings.</p>
    <h3>Building codes</h3>
    <p>The legend printed on the official West Valley College campus map, February 2024. 22 codes.</p>
    <h3>Amenities</h3>
    <p>${a ? a.items.length : "—"} points digitised from the pictograms printed on that same official map,
       then transformed onto the surveyed footprints by a ${a ? a.fit.method : ""}.
       Measured accuracy: <b>mean ${a ? a.fit.mean_residual_m : "—"} m, worst ${a ? a.fit.max_residual_m : "—"} m</b>.</p>
    <h3>Rooms</h3>
    <p>Physical Education: the posted plan, sheet 23-2A Rev. 9/90, redrawn as real geometry.<br>
       Campus Center: the posted plan dated August 2026.<br>
       Learning Resource Commons: the wayfinding display, 2 September 2026.<br>
       Every other building: the official Fall 2026 Schedule of Classes, which proves a room
       exists and which building it is in, but not where inside.</p>
    <h3>What is deliberately missing</h3>
    <p>Drinking fountains, and floor plans for every building except PE. No official source
       publishes them. They need a photo of the posted plan in each building.</p>
    <h3>Privacy</h3>
    <p>"Where am I" runs in your browser only. Nothing is stored, nothing is sent anywhere,
       there is no analytics on this page.</p></div>`);
});
