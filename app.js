/* West Valley Campus Map, MVP. Static, no backend, no keys, no analytics.
   Data: campus.geojson (OpenStreetMap, ODbL). Edit that file, not this one, to fix names/codes. */

// The one highlighted place. Shown ONLY once its coordinates are verified on site
// (verified: true). Nothing on this map is estimated.
const ABC_LAB = {
  name: "AI Builders Club lab · NWP 02",
  detail: "North Walk Portable 02 (the former Success Center)",
  lat: 37.26519, lon: -122.00972,
  verified: false,
  discord: "https://discord.gg/h99K887zd4",
};

const CAMPUS_CENTER = [37.2637, -122.0096];   // center of the trimmed campus footprint
const COLORS = { navy: "#0f172a", lime: "#a3e635", cyan: "#22d3ee", white: "#f8fafc" };

const map = L.map("map", { zoomControl: true, attributionControl: true }).setView(CAMPUS_CENTER, 17);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap contributors",
}).addTo(map);

const buildings = [];           // {name, code, layer, center}
let selected = null;

function styleFor(f) {
  const k = f.properties.kind;
  if (k === "parking") return { color: COLORS.cyan, weight: 1, fillColor: COLORS.cyan, fillOpacity: 0.12 };
  const named = !!f.properties.name;
  return { color: named ? COLORS.lime : "#64748b", weight: named ? 2 : 1,
           fillColor: named ? COLORS.navy : "#334155", fillOpacity: named ? 0.55 : 0.25 };
}

function label(f) {
  const p = f.properties;
  if (!p.name && !p.code) return null;
  return p.code ? `${p.code} · ${p.name}` : p.name;
}

fetch("campus.geojson?v=3").then(r => r.json()).then(gj => {
  const layer = L.geoJSON(gj, {
    style: styleFor,
    onEachFeature: (f, layer) => {
      const t = label(f);
      if (t) {
        layer.bindTooltip(t, { permanent: f.properties.kind === "building", direction: "center",
                               className: f.properties.kind === "parking" ? "lbl lbl-park" : "lbl" });
        layer.bindPopup(`<b>${t}</b>${f.properties.kind === "parking" ? "<br>Parking" : ""}`);
      }
      if (f.properties.kind === "building" && f.properties.name) {
        buildings.push({ name: f.properties.name, code: f.properties.code || "", layer,
                         center: layer.getBounds().getCenter() });
      }
    },
  }).addTo(map);
  map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 17 });
  if (ABC_LAB.verified) addLab(); else document.getElementById("lab").hidden = true;
  loadRooms();
});

function addLab() {
  const icon = L.divIcon({ className: "lab-pin", html: "<span>🧠</span>", iconSize: [34, 34], iconAnchor: [17, 34] });
  const m = L.marker([ABC_LAB.lat, ABC_LAB.lon], { icon, zIndexOffset: 1000 }).addTo(map);
  m.bindPopup(`<b>${ABC_LAB.name}</b><br>${ABC_LAB.detail}<br><a href="${ABC_LAB.discord}" target="_blank" rel="noopener">Join on Discord</a>`);
  document.getElementById("lab").addEventListener("click", () => { map.flyTo([ABC_LAB.lat, ABC_LAB.lon], 19); m.openPopup(); });
}

// ---- room directory (official posted plans only, each with its source) ----
const rooms = [];   // {code, name, bcode, bname, source}
function loadRooms() {
  fetch("rooms.json?v=4").then(r => r.json()).then(j => {
    for (const [bcode, b] of Object.entries(j.buildings || {}))
      for (const r of b.rooms) rooms.push({ code: r.code, name: r.name, bcode, bname: b.name, source: b.source });
  }).catch(() => {});
}
function buildingByCode(code) { return buildings.find(b => b.code === code); }
function selectRoom(r) {
  const b = buildingByCode(r.bcode);
  results.hidden = true; q.blur();
  if (!b) return;
  select(b, `<b>${r.code} · ${r.name}</b><br>${r.bname}<br><small>Source: ${r.source}</small>`);
}

// ---- search ----
const q = document.getElementById("q"), results = document.getElementById("results");
function norm(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function find(text) {
  const n = norm(text); if (!n) return [];
  const bs = buildings.filter(b => norm(b.name).includes(n) || norm(b.code) === n).map(b => ({ kind: "b", b }));
  const rs = rooms.filter(r => norm(r.code).includes(n) || norm(r.name).includes(n)).map(r => ({ kind: "r", r }));
  return [...bs, ...rs].slice(0, 10);
}
function select(b, html) {
  if (selected) selected.layer.setStyle(styleFor({ properties: { kind: "building", name: selected.name } }));
  selected = b;
  b.layer.setStyle({ color: COLORS.lime, weight: 4, fillColor: COLORS.lime, fillOpacity: 0.35 });
  map.flyTo(b.center, 18);
  if (html) b.layer.bindPopup(html).openPopup(); else b.layer.openPopup();
  results.hidden = true; q.blur();
}
q.addEventListener("input", () => {
  const hits = find(q.value);
  results.innerHTML = hits.map((h, i) => h.kind === "b"
    ? `<li data-i="${i}">${h.b.code ? h.b.code + " · " : ""}${h.b.name}</li>`
    : `<li data-i="${i}"><b>${h.r.code}</b> · ${h.r.name} <span class="dim">· ${h.r.bname}</span></li>`).join("");
  results.hidden = hits.length === 0;
  results.querySelectorAll("li").forEach(li => li.addEventListener("click", () => {
    const h = hits[+li.dataset.i]; h.kind === "b" ? select(h.b) : selectRoom(h.r);
  }));
});
document.getElementById("searchForm").addEventListener("submit", e => {
  e.preventDefault(); const hits = find(q.value);
  if (hits.length) hits[0].kind === "b" ? select(hits[0].b) : selectRoom(hits[0].r);
});

// ---- you are here (opt-in, nothing stored) ----
let me = null;
document.getElementById("locate").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Location is not available in this browser.");
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (me) me.remove();
    me = L.circleMarker(ll, { radius: 9, color: COLORS.white, weight: 3, fillColor: COLORS.cyan, fillOpacity: 1 }).addTo(map)
          .bindPopup("You are here").openPopup();
    map.flyTo(ll, 18);
  }, () => alert("Could not get your location. Check the browser's location permission."), { enableHighAccuracy: true, timeout: 10000 });
});
