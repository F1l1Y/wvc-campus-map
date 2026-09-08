/* West Valley Campus Map.
   Static, no backend, no keys, no analytics, nothing stored.
   Accuracy rule: nothing on this map is placed by eye. Every building comes from a surveyed
   OpenStreetMap footprint; every amenity comes from a pictogram printed on the official
   February 2024 campus map, transformed onto those footprints by a measured 16-point fit;
   every room comes from an official plan or the official schedule, and carries its source. */

const CAMPUS_CENTER = [37.2637, -122.0096];
const DATA = { buildings: [], rooms: [], plans: {}, amen: null, roomsDoc: null, routes: null, sportLayers: [], coverage: null, walk: null };
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
  if (p.kind === "sport") return { color: "#3f8f5e", weight: 1, fillColor: "#6fbf8a", fillOpacity: .3 };
  const named = !!p.name;
  const hasPlan = p.code && DATA.plans[p.code];
  if (hasPlan) return { color: "#31600a", weight: 3, fillColor: C.lime, fillOpacity: .42 };
  return { color: named ? C.limeD : C.slate, weight: named ? 1.5 : 1,
           fillColor: named ? C.navy : "#93a0b4", fillOpacity: named ? .5 : .22 };
}
const styleOn = { color: C.limeD, weight: 4, fillColor: C.lime, fillOpacity: .55 };
let selected = [];

function dataError(what) {
  if (document.querySelector(".loaderr")) return;
  const el = document.createElement("div");
  el.className = "loaderr"; el.setAttribute("role", "alert");
  el.innerHTML = `<b>Could not load ${what}.</b> Check your connection and reload.`;
  document.body.appendChild(el);
}
fetch("campus.geojson?v=37").then(r => r.json()).then(gj => {
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
      } else if (p.kind === "sport") {
        DATA.sportLayers.push(ly);
        ly.bindTooltip(p.name, { direction: "center", className: "lbl lbl-park" });
        ly.on("click", () => ly.bindPopup(`<b>${p.name}</b><br><small>Named from the official campus map, Feb 2024</small>`).openPopup());
      }
    },
  }).addTo(map);
  const built = L.featureGroup(DATA.buildings.map(b => b.layer).concat(DATA.sportLayers));
  map.invalidateSize();
  try { map.fitBounds(built.getBounds(), { padding: [24, 24], maxZoom: 17, animate: false }); }
  catch (e) { map.setView(CAMPUS_CENTER, 16); }
  addEventListener("resize", () => map.invalidateSize());
  addEventListener("orientationchange", () => setTimeout(() => map.invalidateSize(), 250));
  loadAmenities(); loadRoutes(); loadCoverage(); loadWalk();
  // deep links must wait for the room index and the plans, not a guessed delay
  loadRooms().then(applyDeepLink).catch(() => dataError("the room directory"));
}).catch(() => dataError("the campus outline"));

/* ------------------------------------------------------------- rooms */
function loadRooms() {
  return fetch("rooms.json?v=37").then(r => r.json()).then(j => {
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
    return Promise.all(["pe","lrc"].map(id => fetch(`plans/${id}.json?v=37`).then(r => r.json()).then(p => {
      DATA.plans[p.building] = p;
      p.rooms.forEach((r, idx) => {
        if (!r.code) {
          if (r.name) DATA.rooms.push({ code: "", label: r.name, name: r.name, bcode: p.building,
                                        bname: p.name, source: p.source, kind: "plan", planIdx: idx });
          return;
        }
        const hit = DATA.rooms.find(x => norm(x.code) === norm(r.code));
        if (hit) { hit.kind = "plan"; hit.name = hit.name || r.name; }
        else DATA.rooms.push({ code: r.code, name: r.name, bcode: p.building, bname: p.name,
                               source: p.source, kind: "plan" });
      });
    }).catch(() => {})));
  }).then(() => {
    Object.values(DATA.plans).forEach(buildIndoor);
    DATA.buildings.forEach(b => {
      if (b.code && DATA.plans[b.code]) {
        b.layer.setStyle(styleFor({ properties: { kind: "building", name: b.name, code: b.code } }));
        b.layer.setTooltipContent(`${b.code} · floor plan`);
      }
    });
    const codes = Object.keys(DATA.plans);
    const hint = document.getElementById("hint");
    if (hint && codes.length) {
      hint.innerHTML = `Floor plans so far: ` + codes.map(c =>
        `<button class="hintbtn" onclick="openPlan('${c}')">${c}</button>`).join(" ") +
        ` <span class="dim">tap a room on the plan, or search one</span>`;
      hint.hidden = false;
    }
  });
}
function loadWalk() {
  fetch("walkgraph.json?v=37").then(r => r.json()).then(j => {
    DATA.walk = j;
    j.adj = Array.from({ length: j.lat.length }, () => []);
    j.edges.forEach(([a, b]) => {
      const w = metres(j.lat[a], j.lon[a], j.lat[b], j.lon[b]);
      j.adj[a].push([b, w]); j.adj[b].push([a, w]);
    });
  }).catch(() => {});
}
function loadCoverage() {
  fetch("coverage.json?v=37").then(r => r.json()).then(j => { DATA.coverage = j; }).catch(() => {});
}
function loadRoutes() {
  fetch("evac_routes.json?v=37").then(r => r.json()).then(j => { DATA.routes = j; }).catch(() => {});
}
function loadAmenities() {
  fetch("amenities.json?v=37").then(r => r.json()).then(j => { DATA.amen = j; buildAmenityLayers(j); });
}
function buildingByCode(code) {
  const n = norm(code);
  return DATA.buildings.find(b => norm(b.code) === n)
      || DATA.buildings.find(b => norm(b.code).split(" ").includes(n));
}

/* ------------------------------- indoor layer: the plan placed on the map */
const indoor = {};        // building code -> {overlay, rooms:{code: layer}, group}
function buildIndoor(plan) {
  if (!plan.georef || !plan.image) return;
  const g = plan.georef.image_bounds;
  const bounds = L.latLngBounds([g.south, g.west], [g.north, g.east]);
  const overlay = L.imageOverlay(plan.image + "?v=37", bounds, {
    opacity: .92, interactive: false, alt: `Floor plan of ${plan.name}`, className: "planoverlay" });
  const rooms = {}, group = L.layerGroup();
  plan.rooms.forEach(r => {
    if (!r.geo || !r.code) return;
    const poly = L.polygon(r.geo, { color: "#2b6cb0", weight: 1, fillColor: "#2b6cb0",
                                    fillOpacity: .04, className: "iroom" });
    poly.bindTooltip(`${r.code}${r.name ? " · " + r.name : ""}`, { sticky: true });
    poly.on("click", () => {
      const rec = DATA.rooms.find(x => norm(x.code) === norm(r.code));
      if (rec) { q.value = r.code; clearBtn.hidden = false; showRoom(rec); }
    });
    rooms[r.code] = poly; poly.addTo(group);
  });
  indoor[plan.building] = { overlay, rooms, group, bounds, plan };
}
let indoorOn = null, indoorHi = null, focusTarget = null;
// Re-apply the framing after the page has settled. The opening fitBounds and the plan image
// decoding both change the view or the sheet height after showRoom has already run.
function refocus() {
  if (!focusTarget) return;
  try {
    if (focusTarget.poly) frameOn(focusTarget.poly.getBounds().pad(2.2), 21, false);
    else if (focusTarget.b) frameOn(L.featureGroup(
      DATA.buildings.filter(x => x.code === focusTarget.b.code).map(x => x.layer)).getBounds(), 18.5, false);
  } catch (e) {}
}
function showIndoor(bcode) {
  const ix = indoor[bcode]; if (!ix) return null;
  if (indoorOn && indoorOn !== ix) hideIndoor();
  if (indoorOn !== ix) { ix.overlay.addTo(map); ix.group.addTo(map); indoorOn = ix; }
  return ix;
}
function hideIndoor() {
  if (!indoorOn) return;
  indoorOn.overlay.remove(); indoorOn.group.remove(); indoorOn = null; indoorHi = null;
}
function highlightIndoorRoom(bcode, code) {
  const ix = showIndoor(bcode); if (!ix) return null;
  if (indoorHi) indoorHi.setStyle({ color: "#2b6cb0", weight: 1, fillColor: "#2b6cb0", fillOpacity: .04 });
  const poly = ix.rooms[code]; if (!poly) return ix;
  poly.setStyle({ color: "#31600a", weight: 4, fillColor: "#8fce2a", fillOpacity: .55 });
  poly.bringToFront(); indoorHi = poly;
  return ix;
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

const SYNONYM = { bathroom:"restroom", toilet:"restroom", washroom:"restroom", loo:"restroom",
  wc:"restroom", defibrillator:"aed", gym:"gymnasium", cafeteria:"cafe", coffee:"cafe",
  library:"library", weights:"weight training", pool:"swimming pool" };
const TOPIC = { restroom:"restroom_gender_neutral", aed:"aed", defibrillator:"aed",
  evacuation:"evacuation_site", parking:"parking", ev:"ev_charger", charger:"ev_charger" };

function find(text) {
  let n = norm(text);
  n = n.split(" ").map(w => SYNONYM[w] || w).join(" ");
  const sq = squash(n);
  if (!n) return [];
  const out = [];
  if (TOPIC[n]) out.push({ kind: "topic", topic: TOPIC[n], label: text.trim(), score: -1 });
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
    results.hidden = !typed; q.setAttribute("aria-expanded", String(!!typed)); return;
  }
  results.innerHTML = hits.map((h, i) => {
    if (h.kind === "building")
      return `<li role="option" data-i="${i}"><span class="code">${esc(h.b.code || "")}</span>
        <span class="sub">${esc(h.b.name)}</span><span class="tag">${h.partial ? "building only" : "building"}</span></li>`;
    if (h.kind === "topic")
      return `<li role="option" data-i="${i}"><span class="code">${esc(h.label)}</span>
        <span class="sub">everywhere on campus</span><span class="tag plan">map layer</span></li>`;
    const r = h.r, tag = r.kind === "plan" ? '<span class="tag plan">floor plan</span>'
                    : r.kind === "directory" ? '<span class="tag">listed</span>'
                    : '<span class="tag">in schedule</span>';
    return `<li role="option" data-i="${i}"><span class="code">${esc(r.code || r.label)}</span>
      <span class="sub">${esc(r.code ? (r.name || r.bname) : r.bcode + " · " + r.bname)}</span>${tag}</li>`;
  }).join("");
  results.hidden = false; q.setAttribute("aria-expanded", "true");
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
  results.hidden = true; q.setAttribute("aria-expanded", "false"); q.blur();
  if (h.kind === "topic") showTopic(h.topic);
  else if (h.kind === "building") showBuilding(h.b, h.partial);
  else showRoom(h.r);
}

function showTopic(type) {
  const g = type.startsWith("parking") ? "parking" : type;
  const chip = document.querySelector(`.chip[data-layer="${g}"]`);
  if (chip && chip.getAttribute("aria-pressed") !== "true") chip.click();
  const j = DATA.amen; if (!j) return;
  const items = j.items.filter(i => amenGroup(i.type) === g);
  const TITLE = { restroom_gender_neutral: "Restrooms", aed: "AEDs", evacuation_site: "Evacuation sites",
                  parking: "Parking", ev_charger: "EV charging" };
  let h = `<div class="pad"><div class="eyebrow">Map layer</div><h2>${TITLE[g] || g}</h2>
    <p class="sub">${items.length} shown on the map, from the official campus map of February 2024.</p>`;
  if (g === "restroom_gender_neutral") {
    const plan = [];
    for (const [bc, p] of Object.entries(DATA.plans))
      p.rooms.forEach(r => { if (/restroom/i.test(r.name || "")) plan.push(`${bc} · ${r.name}`); });
    h += `<div class="warn">The official map marks only <b>gender-neutral</b> restrooms, so those
      ${items.length} are what can be shown campus-wide. Every other restroom has to come off a
      building's floor plan.</div>`;
    if (plan.length) h += `<h3>Also on a captured floor plan</h3><ul class="roomlist">` +
      plan.map(t => `<li>${esc(t)}</li>`).join("") + `</ul>`;
    h += `<h3>Known but not yet transcribed</h3><p class="sub">The LRC wayfinding display marks its
      restrooms; they need a straight-on photo before they can go on the map.</p>`;
  }
  const near = {};
  items.forEach(i => { near[i.near_code || i.near] = (near[i.near_code || i.near] || 0) + 1; });
  h += `<h3>Where they are</h3><div class="chips">` +
    Object.entries(near).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="tagchip">${esc(k)}${v > 1 ? " ×" + v : ""}</span>`).join("") + `</div>`;
  h += `<div class="src"><b>Source:</b> ${esc(j.source)}. Placed by a ${esc(j.fit.method)},
    mean ${j.fit.mean_residual_m} m.</div></div>`;
  openPanel(h);
}

const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(37.2637 * Math.PI / 180);
function metres(la1, lo1, la2, lo2) {
  return Math.hypot((lo2 - lo1) * MPD_LON, (la2 - la1) * MPD_LAT);
}
function nearestNode(lat, lon) {
  const j = DATA.walk; if (!j) return null;
  let best = -1, bd = Infinity;
  for (let i = 0; i < j.lat.length; i++) {
    const d = metres(lat, lon, j.lat[i], j.lon[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return { node: best, dist: bd };
}
function shortestPath(from, toSet) {
  const j = DATA.walk; if (!j) return null;
  const targets = new Set(Array.isArray(toSet) ? toSet : [toSet]);
  const n = j.lat.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n); dist[from] = 0; let to = -1;
  // simple binary heap
  const heap = [[0, from]];
  const push = (v) => { heap.push(v); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0;
      for (;;) { const l = 2*i+1, r = l+1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (done[u]) continue; done[u] = 1;
    if (targets.has(u)) { to = u; break; }
    for (const [v, w] of j.adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); }
    }
  }
  if (to < 0 || !isFinite(dist[to])) return null;
  const path = []; let cur = to;
  while (cur !== -1) { path.push([j.lat[cur], j.lon[cur]]); cur = prev[cur]; }
  path.reverse();
  return { path, metres: dist[to] };
}

/* --------------------------------------------- walking directions to a room */
let walkLayer = null;
function clearWalk() { if (walkLayer) { walkLayer.remove(); walkLayer = null; } }
window.walkTo = function (bcode, roomCode) {
  const box = document.getElementById("walkInfo");
  const j = DATA.walk;
  if (!j) { if (box) box.textContent = "The walking network is still loading."; return; }
  const entry = j.entries[bcode];
  if (!entry || !entry.nodes || !entry.nodes.length) {
    if (box) box.textContent = "No walking route to this building yet."; return;
  }
  if (!navigator.geolocation) { if (box) box.textContent = "This browser cannot provide your location."; return; }
  if (box) box.textContent = "Finding you...";
  navigator.geolocation.getCurrentPosition(pos => {
    const me = [pos.coords.latitude, pos.coords.longitude];
    const start = nearestNode(me[0], me[1]);
    if (!start) return;
    const r = shortestPath(start.node, entry.nodes);
    if (!r) { if (box) box.textContent = "No path found from where you are."; return; }
    clearWalk(); clearRoute();
    const line = r.path;
    if (r.metres < 25 || line.length < 2) {
      if (box) box.innerHTML = `<b>You are already at ${esc(bcode)}.</b>` +
        (roomCode ? ` ${esc(roomCode)} is marked on the plan below.` : "");
      return;
    }
    const mins = Math.max(1, Math.round(r.metres / 78));   // ~1.3 m/s walking
    walkLayer = L.layerGroup([
      L.polyline(line, { color: "#ffffff", weight: 10, opacity: .95 }),
      L.polyline(line, { color: "#0e9fbd", weight: 5, opacity: 1, lineCap: "round" }),
      L.polyline([me, line[0]], { color: "#0e9fbd", weight: 3, opacity: .8, dashArray: "3 7" }),
      L.circleMarker(me, { radius: 8, color: "#fff", weight: 3, fillColor: "#0f172a", fillOpacity: 1 })
        .bindPopup("You are here"),
      L.circleMarker(line[line.length - 1], { radius: 9, color: "#fff", weight: 3, fillColor: "#8fce2a", fillOpacity: 1 })
        .bindPopup(`<b>${esc(bcode)}</b><br>${esc(entry.name)}`),
    ]).addTo(map);
    const sz = map.getSize();
    if (sz.x > 40 && sz.y > 40)
      frameOn(L.polyline(line.concat([me])).getBounds(), 19);
    if (box) box.innerHTML =
      `<b>${Math.round(r.metres)} m, about ${mins} min walk</b> to ${esc(bcode)}, on campus paths.` +
      (roomCode ? ` Then ${esc(roomCode)} is marked on the plan below.` : "") +
      `<br><small style="color:#8b97ad">Route ends at the path nearest the building
       (${entry.d} m from its wall). Door-level entrances are not captured yet.</small>`;
  }, () => { if (box) box.textContent = "Could not get your location. Check the browser's location permission."; },
     { enableHighAccuracy: true, timeout: 12000 });
};

/* -------------------------------------------------- evacuation route */
let routeLayer = null;
function showRoute(code, name) {
  const j = DATA.routes; if (!j) return;
  const r = j.routes.find(x => (code && x.code === code) || x.name === name);
  if (!r) {
    const box = document.getElementById("routeInfo");
    if (box) box.textContent = "No evacuation route for this building yet.";
    return;
  }
  if (routeLayer) routeLayer.remove();
  const line = r.path.map(p => [p[1], p[0]]);
  routeLayer = L.layerGroup([
    L.polyline(line, { color: "#ffffff", weight: 9, opacity: .9 }),
    L.polyline(line, { color: "#b1341f", weight: 5, opacity: 1, dashArray: "1 10", lineCap: "round" }),
    L.circleMarker(line[0], { radius: 7, color: "#fff", weight: 3, fillColor: "#0f172a", fillOpacity: 1 })
      .bindPopup(`<b>Route starts here</b><br>the path nearest ${esc(r.name)}<br><small>${r.start_snap_m} m from the building centre</small>`),
    L.circleMarker(line[line.length - 1], { radius: 9, color: "#fff", weight: 3, fillColor: "#b1341f", fillOpacity: 1 })
      .bindPopup(`<b>Evacuation assembly site</b><br>near ${esc(r.site.near)}`),
  ]).addTo(map);
  const sz = map.getSize();
  if (sz.x > 40 && sz.y > 40) map.fitBounds(L.polyline(line).getBounds(), { padding: [60, 60] });
  return r;
}
function clearRoute() { if (routeLayer) { routeLayer.remove(); routeLayer = null; } }
window.evacRoute = (code, name) => {
  const r = showRoute(code, name); if (!r) return;
  const box = document.getElementById("routeInfo");
  if (box) box.innerHTML = `<b>${r.walk_m} m</b> on foot to the assembly site near ${esc(r.site.near)},
    following surveyed campus paths.<br><small style="color:#8b97ad">Starts at the path nearest the
    building (${r.start_snap_m} m from its centre), not at a door: entrances are not captured yet.</small>`;
};

/* ------------------------------------------------------------- panel */
const panel = $("#panel"), panelBody = $("#panelBody");
$("#panelClose").addEventListener("click", closePanel);
function closePanel() { panel.hidden = true; clearRoute(); clearWalk(); hideIndoor(); }
function openPanel(html) {
  panelBody.innerHTML = html; panel.hidden = false; panel.scrollTop = 0;
  const h = panelBody.querySelector("h2");
  if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
}
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || panel.hidden) return;
  const t = e.target;
  if (t && typeof t.closest === "function" && t.closest(".search")) return;
  closePanel(); q.focus();
});
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function sheetHeight() {
  // height of the bottom sheet that covers the map on a phone (0 on desktop, where it is a sidebar)
  const sz = map.getSize();
  if (panel.hidden || window.innerWidth > 820) return 0;
  return Math.min(Math.round(panel.getBoundingClientRect().height), Math.max(0, sz.y - 170));
}
// Frame a set of bounds in the part of the map the sheet does not cover.
// Leaflet's own padding options collapse to minZoom once the padding approaches the map
// height, so the centre and zoom are computed here instead.
function frameOn(bounds, maxZoom, animate = true, tries = 0) {
  let sz = map.getSize();
  if (sz.x < 60 || sz.y < 60) {
    // container not measured yet (first paint, or an embedded viewport that reports 0)
    map.invalidateSize({ animate: false });
    sz = map.getSize();
  }
  if (sz.x < 60 || sz.y < 60) {
    if (tries < 8) setTimeout(() => frameOn(bounds, maxZoom, false, tries + 1), 250);
    return;
  }
  map.stop();   // Leaflet ignores setView while an earlier pan/zoom animation is still running

  const sheet = sheetHeight(), M = 34;
  let z = map.getBoundsZoom(bounds, false, L.point(M * 2, sheet + M * 2));
  z = Math.max(map.getMinZoom(), Math.min(z, maxZoom));
  const c = map.project(bounds.getCenter(), z);
  c.y += sheet / 2;                       // lift the target into the visible strip
  const target = map.unproject(c, z);
  // setView lands exactly; flyTo can be knocked off target by a fly still in flight.
  // Leaflet declines to animate a large zoom change and can then leave the view untouched,
  // so big jumps go un-animated and every call is verified a moment later.
  const jump = Math.abs(map.getZoom() - z) > 3;
  map.setView(target, z, { animate: animate && !jump, duration: .5 });
  setTimeout(() => {
    if (Math.abs(map.getZoom() - z) > 0.01) map.setView(target, z, { animate: false });
  }, animate && !jump ? 620 : 60);
}
function fitPad(base) { return { padding: [base, base] }; }
let reframeTimer = null;
function reframe(b, zoom) {
  clearTimeout(reframeTimer);
  // the sheet grows as the plan image decodes, so measure again once it has settled
  reframeTimer = setTimeout(() => {
    const grp = L.featureGroup((selected.length ? selected : [b]).map(x => x.layer));
    try { frameOn(grp.getBounds(), zoom, false); } catch (e) {}
  }, 420);
}
function flyTo(b, zoom = 18) {
  selected.forEach(x => x.layer.setStyle(styleFor({ properties: { kind: "building", name: x.name } })));
  // a building code can cover several footprints (PE and CHE each have more than one)
  selected = b.code ? DATA.buildings.filter(x => x.code === b.code) : [b];
  selected.forEach(x => x.layer.setStyle(styleOn));
  const grp = L.featureGroup(selected.map(x => x.layer));
  const sz = map.getSize();
  // a zero-sized container (some embedded/headless viewports) makes flyToBounds produce NaN
  if (sz.x > 40 && sz.y > 40) {
    try { frameOn(grp.getBounds(), zoom); reframe(b, zoom); return; }
    catch (e) { /* fall through to a plain setView */ }
  }
  map.setView(b.center, Math.min(zoom, 18));
}

function showBuilding(b, partial) {
  const dir = DATA.roomsDoc?.buildings?.[b.code];
  const inv = DATA.roomsDoc?.schedule_inventory?.buildings?.[b.code] || [];
  const plan = DATA.plans[b.code];
  let h = `<div class="pad"><div class="eyebrow">${esc(b.code || "Building")}</div><h2>${esc(b.name)}</h2>`;
  if (partial) h += `<div class="warn"><b>${esc(partial)}</b> is not in any source I have yet, but ${esc(b.code)} is this building, so this is where to head. The room list below is everything I can currently prove exists in it.</div>`;
  if (b.houses) h += `<p class="sub">${esc(b.houses)}</p>`;
  const hasRoute = DATA.routes && DATA.routes.routes.some(x => (b.code && x.code === b.code) || x.name === b.name);
  h += `<div class="btnrow">` +
       (plan ? `<button class="btn primary" onclick="openPlan('${b.code}')">Open floor plan</button>` : "") +
       (hasRoute ? `<button class="btn" onclick="evacRoute('${esc(b.code)}', '${esc(b.name).replace(/'/g, "\\'")}')">Evacuation route</button>` : "") +
       `<button class="btn" onclick="walkTo('${esc(b.code || b.name)}','')">Take me there</button>` +
       `<button class="btn" onclick="copyLink('b','${esc(b.code || b.name)}',this)">Copy link</button>` +
       `</div><div id="walkInfo" class="src" style="border-left-color:#0e9fbd"></div>` +
       `<div id="routeInfo" class="src" style="border-left-color:#b1341f"></div>`;
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
  if (indoor[b.code]) showIndoor(b.code); else hideIndoor();
  flyTo(b);
}

function showRoom(r) {
  if (!r.code && r.planIdx != null) { openPlanAt(r.bcode, r.planIdx, r.name); return; }
  const b = buildingByCode(r.bcode);
  const plan = DATA.plans[r.bcode];
  const inPlan = plan && plan.rooms.some(x => norm(x.code) === norm(r.code));
  let h = `<div class="pad"><div class="eyebrow">${esc(r.bcode)} · ${esc(r.bname)}</div>
    <h2>${esc(r.code)}</h2>`;
  if (r.name) h += `<p class="sub">${esc(r.name)}</p>`;
  if (r.capacity) h += `<p class="sub">Seats ${esc(r.capacity)}</p>`;
  if (r.zone) h += `<p class="sub">Where in the building: ${esc(r.zone)}</p>`;
  h += `<div class="btnrow">
      <button class="btn primary" onclick="walkTo('${esc(r.bcode)}','${esc(r.code)}')">Take me there</button>
      <button class="btn" onclick="copyLink('r','${esc(r.code)}',this)">Copy link</button></div>
    <div id="walkInfo" class="src" style="border-left-color:#0e9fbd"></div></div>`;
  if (plan) h += `<div class="planbar"><span>${inPlan ? "Highlighted on" : "This room is not outlined on"} the posted floor plan</span>
      <span style="margin-left:auto"><button class="zoombtn" onclick="planZoom(1.3)">+</button>
      <button class="zoombtn" onclick="planZoom(1/1.3)">−</button>
      <button class="zoombtn" onclick="planReset()">⤢</button></span></div>
      <div class="planwrap" id="planwrap">${planSVG(plan, r.code)}</div>`;
  h += `<div class="pad" style="padding-top:14px">`;
  if (!plan) h += `<div class="warn">This room is real and in ${esc(r.bcode)}, but ${esc(r.bcode)}'s floor plan has not been captured yet, so I can put you at the building, not at the door.</div>`;
  else if (!inPlan) h += `<div class="warn">This room is on the plan above but is not outlined yet, so it is not lit up.</div>`;
  if (plan && plan.georef && inPlan)
    h += `<div class="src"><b>On the map:</b> this room is drawn at its real position, to about
      &plusmn;${plan.georef.accuracy_m} m. ${esc(plan.georef.method)} ${esc(plan.georef.cross_check)}</div>`;
  h += `<div class="src"><b>Source:</b> ${esc(r.source)}</div></div>`;
  openPanel(h);
  const ix = inPlan ? highlightIndoorRoom(r.bcode, r.code) : null;
  focusTarget = (ix && ix.rooms[r.code]) ? { poly: ix.rooms[r.code] } : (b ? { b } : null);
  if (ix && ix.rooms[r.code]) {
    if (b) { selected.forEach(x => x.layer.setStyle(styleFor({ properties: { kind: "building", name: x.name, code: x.code } })));
             selected = DATA.buildings.filter(x => x.code === b.code); }
    const rb = ix.rooms[r.code].getBounds().pad(2.2);
    try { frameOn(rb, 21); } catch (e) { if (b) flyTo(b, 18.5); }
    setTimeout(() => { try { frameOn(ix.rooms[r.code].getBounds().pad(2.2), 21, false); } catch (e) {} }, 430);
  } else if (b) flyTo(b, 18.5);
  if (plan) { initPlanPan(); if (inPlan) setTimeout(() => focusRoom(r.code), 30); }
}

/* -------------------------------------------------------- floor plan */
let planState = { k: 1, x: 0, y: 0, plan: null };
function planSVG(plan, highlight) {
  planState.plan = plan;
  const raster = !!plan.image;
  const rooms = plan.rooms.map((r, i) => {
    const pts = r.poly.map(p => p.join(",")).join(" ");
    const on = highlight && norm(r.code) === norm(highlight);
    const cls = `pr ${raster ? "over" : (r.kind || "room")}${on ? " on" : ""}${r.code ? " hit" : ""}`;
    const cx = r.poly.reduce((s, p) => s + p[0], 0) / r.poly.length;
    const cy = r.poly.reduce((s, p) => s + p[1], 0) / r.poly.length;
    const w = Math.max(...r.poly.map(p => p[0])) - Math.min(...r.poly.map(p => p[0]));
    const hgt = Math.max(...r.poly.map(p => p[1])) - Math.min(...r.poly.map(p => p[1]));
    const short = (r.code || "").replace(/^[A-Z/]+ /, "");
    const showLabel = !raster && w > 34 && hgt > 22;
    const fs = Math.max(11, Math.min(26, w / Math.max(2, short.length) * 1.5));
    return `<polygon class="${cls}" points="${pts}" data-code="${esc(r.code)}"
             data-name="${esc(r.name || "")}" data-i="${i}"><title>${esc(r.code || r.name)}${r.name && r.code ? " · " + esc(r.name) : ""}</title></polygon>` +
      (showLabel && short ? `<text class="plabel" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" style="font-size:${fs}px">${esc(short)}</text>` : "");
  }).join("");
  const img = raster ? `<image href="${esc(plan.image)}?v=37" x="0" y="0" width="${plan.width}"
      height="${plan.height}" preserveAspectRatio="none"/>` : "";
  return `<svg viewBox="0 0 ${plan.width} ${plan.height}" preserveAspectRatio="xMidYMid meet" id="plansvg"
      role="img" aria-label="Floor plan of ${esc(plan.name)}, ${plan.rooms.length} spaces${highlight ? ", " + esc(highlight) + " highlighted" : ""}">
      <g id="plang">${img}${rooms}</g></svg>`;
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
function openPlanAt(bcode, idx, name) {
  const b = buildingByCode(bcode); if (b) flyTo(b);
  const p = DATA.plans[bcode]; if (!p) return;
  openPlan(bcode);
  setTimeout(() => {
    const poly = document.querySelector(`#planwrap polygon[data-i="${idx}"]`);
    if (poly) poly.classList.add("on");
    const r = p.rooms[idx];
    if (r) { planState.plan = p; focusPoly(r); }
  }, 40);
}
function focusPoly(r) {
  const p = planState.plan; if (!p || !r) return;
  const xs = r.poly.map(q => q[0]), ys = r.poly.map(q => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rw = Math.max(12, Math.max(...xs) - Math.min(...xs)), rh = Math.max(12, Math.max(...ys) - Math.min(...ys));
  const k = Math.max(1, Math.min(4.5, Math.min(p.width / rw, p.height / rh) / 3));
  planState.k = k; planState.x = p.width / 2 - cx * k; planState.y = p.height / 2 - cy * k;
  applyPlanTransform();
}
window.openPlan = openPlan; window.planZoom = planZoom; window.planReset = planReset;

/* ------------------------------------------------------- deep links */
function applyDeepLink() {
  const u = new URLSearchParams(location.search);
  if (u.get("demo")) {
    const step = parseInt(u.get("step") || "0", 10);
    const hold = u.get("hold") === "1";
    setTimeout(() => {
      if (step > 0) {
        demoIx = step - 2; demoTick();
        if (hold) { clearTimeout(demoTimer); demoTimer = null; }   // freeze on this step
      } else window.demoStart();
    }, 600);
    return;
  }
  const r = u.get("r"), b = u.get("b");
  if (r) {
    const hit = DATA.rooms.find(x => norm(x.code) === norm(r));
    if (hit) {
      q.value = hit.code; clearBtn.hidden = false; showRoom(hit);
      [300, 800, 1500].forEach(t => setTimeout(refocus, t));
      return;
    }
  }
  if (b) {
    const bb = buildingByCode(b) || DATA.buildings.find(x => norm(x.name) === norm(b));
    if (bb) {
      q.value = bb.code || bb.name; clearBtn.hidden = false; showBuilding(bb);
      [300, 800, 1500].forEach(t => setTimeout(refocus, t));
    }
  }
}
function shareUrl(kind, value) {
  return `${location.origin}${location.pathname}?${kind}=${encodeURIComponent(value)}`;
}
window.copyLink = function (kind, value, btn) {
  const url = shareUrl(kind, value);
  const done = () => { const t = btn.textContent; btn.textContent = "Link copied"; setTimeout(() => btn.textContent = t, 1600); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("Copy this link", url));
  else prompt("Copy this link", url);
};

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
window.__dbg = { get focusTarget() { return focusTarget; }, refocus, frameOn, indoor, sheetHeight,
                 demoJump: (i) => { demoStop(); demoIx = i - 1; demoTick(); } };

window.showCoverage = function () {
  const j = DATA.coverage; if (!j) return;
  const pct = Math.round(j.sections_with_plan / j.sections_total * 100);
  const BADGE = { done: ["Room-level", "#e6f4d6", "#3f6b06"],
                  rooms: ["Rooms listed", "#fdf0d8", "#8a5a10"],
                  none: ["Building only", "#eef1f6", "#4a5a78"] };
  let h = `<div class="pad"><div class="eyebrow">Coverage</div><h2>What this map still needs</h2>
    <p class="sub">A room search lands on the exact room only where a posted floor plan has been
    photographed. That is <b>${pct}%</b> of West Valley's in-person class sections so far
    (${j.sections_with_plan} of ${j.sections_total}). Everything else lands on the building.</p>
    <div class="warn">${esc(j.need)}</div>
    <h3>In the order that helps most students</h3><table class="cov">`;
  j.buildings.forEach(b => {
    const [label, bg, fg] = BADGE[b.state];
    h += `<tr><td class="cc">${esc(b.code)}</td><td>${esc(b.name)}
      <div class="sub" style="font-size:12px">${b.sections ? b.sections + " class sections · " : ""}${b.rooms} rooms known</div></td>
      <td><span class="tagchip" style="background:${bg};color:${fg}">${label}</span></td></tr>`;
  });
  h += `</table><div class="src">Class-section counts parsed from the official Fall 2026 Schedule of
    Classes, so this ordering reflects where students actually are.</div></div>`;
  openPanel(h);
};


/* ============================ LRC demo tour ================================
   A hands-free walkthrough for a demo table: no typing, and no geolocation
   prompt (the walk leg starts from a fixed point on campus, stated on screen).
   Start with the Demo button or ?demo=lrc. Esc or the Stop button ends it. */
const DEMO_START = [37.263195, -122.011152];   // Campus Center, a fixed origin
const DEMO_STEPS = [
  { ms: 4200, title: "West Valley College, mapped",
    note: "23 buildings, 199 searchable rooms, every one carrying the source it came from.",
    run: () => { closePanel(); hideIndoor(); clearWalk();
      const g = L.featureGroup(DATA.buildings.map(b => b.layer).concat(DATA.sportLayers));
      frameOn(g.getBounds(), 17, true); } },
  { ms: 4600, title: "Two buildings have their floor plan",
    note: "Physical Education and the Learning Resource Commons. The rest need one photo each.",
    run: () => { const g = L.featureGroup(DATA.buildings.filter(b => DATA.plans[b.code]).map(b => b.layer));
      frameOn(g.getBounds(), 17, true); } },
  { ms: 5200, title: "Search a room: LRC 141",
    note: "The map goes to the room itself, not just the building.",
    run: () => demoRoom("LRC 141") },
  { ms: 5200, title: "The plan sits on the real building",
    note: "Photographed off the LRC's own wayfinding screen, straightened, and placed to about 4 m.",
    run: () => demoRoom("LRC 143") },
  { ms: 4800, title: "Every room is clickable",
    note: "LRC 164, the Maker Space, in the north-east corner.",
    run: () => demoRoom("LRC 164") },
  { ms: 4800, title: "Including the big ones",
    note: "LRC 156 seats 90. Corridors, doors and exits are the building's own drawing.",
    run: () => demoRoom("LRC 156") },
  { ms: 6000, title: "And how to walk there",
    note: "Routed over 1,701 surveyed campus path nodes, in your browser. From the Campus Center here.",
    run: () => demoWalk("LRC") },
  { ms: 5200, title: "Built overnight by the AI Builders Club",
    note: "Nothing on this map is placed by eye. Tap What's missing to see the gaps.",
    run: () => { closePanel(); hideIndoor(); clearWalk();
      const g = L.featureGroup(DATA.buildings.map(b => b.layer).concat(DATA.sportLayers));
      frameOn(g.getBounds(), 17, true); } },
];
function demoRoom(code) {
  const r = DATA.rooms.find(x => norm(x.code) === norm(code));
  if (!r) return;
  q.value = r.code; clearBtn.hidden = false;
  showRoom(r);
  setTimeout(refocus, 420);
}
function demoWalk(bcode) {
  const j = DATA.walk, entry = j && j.entries[bcode];
  if (!entry) return;
  const start = nearestNode(DEMO_START[0], DEMO_START[1]);
  const res = start && shortestPath(start.node, entry.nodes);
  if (!res) return;
  clearWalk(); clearRoute();
  const line = res.path, mins = Math.max(1, Math.round(res.metres / 78));
  walkLayer = L.layerGroup([
    L.polyline(line, { color: "#ffffff", weight: 11, opacity: .95 }),
    L.polyline(line, { color: "#0e9fbd", weight: 5, opacity: 1, lineCap: "round" }),
    L.circleMarker(line[0], { radius: 8, color: "#fff", weight: 3, fillColor: "#0f172a", fillOpacity: 1 })
      .bindTooltip("Campus Center", { permanent: true, direction: "top" }),
    L.circleMarker(line[line.length - 1], { radius: 9, color: "#fff", weight: 3, fillColor: "#8fce2a", fillOpacity: 1 })
      .bindTooltip(`LRC · ${Math.round(res.metres)} m, ${mins} min`, { permanent: true, direction: "top" }),
  ]).addTo(map);
  frameOn(L.polyline(line).getBounds(), 19, true);
}
let demoTimer = null, demoIx = -1;
function demoStop() {
  clearTimeout(demoTimer); demoTimer = null; demoIx = -1;
  const bar = document.getElementById("demobar"); if (bar) bar.hidden = true;
  document.getElementById("demoBtn").setAttribute("aria-pressed", "false");
  clearWalk(); hideIndoor(); closePanel();
}
function demoTick() {
  results.hidden = true; q.blur();          // never leave the suggestion list open on screen
  demoIx = (demoIx + 1) % DEMO_STEPS.length;
  const st = DEMO_STEPS[demoIx], bar = document.getElementById("demobar");
  bar.hidden = false;
  bar.innerHTML =
    `<div class="dstep">${demoIx + 1}/${DEMO_STEPS.length}</div>
     <div class="dtext"><b>${esc(st.title)}</b><span>${esc(st.note)}</span></div>
     <button class="dstop" onclick="demoStop()">Stop</button>
     <div class="dbar"><i style="animation-duration:${st.ms}ms"></i></div>`;
  try { st.run(); } catch (e) {}
  demoTimer = setTimeout(demoTick, st.ms);
}
window.demoStop = demoStop;
window.demoStart = function () {
  if (demoTimer) { demoStop(); return; }
  document.getElementById("demoBtn").setAttribute("aria-pressed", "true");
  demoIx = -1; demoTick();
};
document.addEventListener("keydown", e => { if (e.key === "Escape" && demoTimer) demoStop(); });

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
    <p>Checked against data the fit never saw: 72% of parking symbols land inside a surveyed
       parking polygon, AEDs sit a median 10.6 m from a building outline (right for a unit on an
       exterior wall), restrooms 11.4 m.</p>
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
