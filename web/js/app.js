/* Alquilo Ya-Rosario */

const ZONAS = [
  { slug: "centro", nombre: "Centro" },
  { slug: "pichincha", nombre: "Pichincha" },
  { slug: "echesortu", nombre: "Echesortu" },
  { slug: "alberdi", nombre: "Alberdi" },
  { slug: "abasto", nombre: "Abasto" },
  { slug: "fisherton", nombre: "Fisherton" },
  { slug: "arroyito", nombre: "Arroyito" },
  { slug: "martin", nombre: "Martin" },
  { slug: "luis-agote", nombre: "Luis Agote" },
  { slug: "parque-espana", nombre: "Parque España" },
  { slug: "refineria", nombre: "Refinería" },
  { slug: "general-paz", nombre: "General Paz" },
  { slug: "la-florida", nombre: "La Florida" },
  { slug: "barrio-sur", nombre: "Barrio Sur" },
  { slug: "tablada", nombre: "Tablada" }
];

/* NOTA: los patrones de URL pueden cambiar. Si un enlace deja de filtrar bien, ajustar solo ese builder. */
const PORTALES = [
  {
    id: "zonaprop", nombre: "Zonaprop", sigla: "Z", color: "#e8410a",
    descripcion: "Uno de los portales más grandes del país.",
    build({ zona, ambientes, moneda, min, max }) {
      let slug = "departamentos-alquiler";
      if (zona) slug += `-${zona.slug}`;
      slug += "-rosario";
      if (ambientes) slug += ambientes === "1" ? "-monoambiente" : `-${ambientes}-ambientes`;
      const unidad = moneda === "USD" ? "dolar" : "pesos";
      if (min && max) slug += `-desde-${min}-hasta-${max}-${unidad}`;
      else if (min) slug += `-mas-${min}-${unidad}`;
      else if (max) slug += `-menos-${max}-${unidad}`;
      return `https://www.zonaprop.com.ar/${slug}.html`;
    }
  },
  {
    id: "argenprop", nombre: "Argenprop", sigla: "A", color: "#1f8a4c",
    descripcion: "Muchas inmobiliarias matriculadas de Rosario.",
    build({ zona, ambientes, moneda, min, max }) {
      const partes = ["departamento", "alquiler"];
      partes.push(zona ? `barrio-${zona.slug}` : "rosario");
      if (zona) partes.push("rosario");
      if (ambientes) partes.push(ambientes === "1" ? "1-ambiente" : `${ambientes}-ambientes`);
      const url = new URL(`https://www.argenprop.com/${partes.join("/")}`);
      if (min || max) {
        const m = moneda === "USD" ? "dolares" : "pesos";
        url.searchParams.set("desde-" + m, min || "");
        url.searchParams.set("hasta-" + m, max || "");
      }
      return url.toString();
    }
  },
  {
    id: "mercadolibre", nombre: "Mercado Libre", sigla: "ML", color: "#e0a800",
    descripcion: "Propietarios directos e inmobiliarias.",
    build({ zona, ambientes, moneda, min, max }) {
      const partes = ["departamentos", "alquiler", "santa-fe", "rosario"];
      if (zona) partes.push(zona.slug);
      if (ambientes) partes.push(ambientes === "1" ? "monoambiente" : `${ambientes}-ambientes`);
      let url = `https://inmuebles.mercadolibre.com.ar/${partes.join("/")}/`;
      if (min || max) {
        const s = moneda === "USD" ? "USD" : "ARS";
        url += `_PriceRange_${min || 0}${s}-${max || "*"}${s}`;
      }
      return url;
    }
  }
];

/* ---------- Capa de datos ----------
 * Lee los avisos reales desde Supabase (config.js). Si no hay configuración
 * o falla la conexión, usa los avisos de ejemplo de avisos.js.
 */
async function obtenerAvisos() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.AY_CONFIG || {};
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/avisos?select=*&activo=eq.true&order=actualizado_en.desc&limit=1000`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const datos = await r.json();
      window.AVISOS_DEMO = false;
      return Array.isArray(datos) ? datos : [];
    } catch (e) {
      console.warn("No se pudo leer Supabase, uso datos de ejemplo:", e);
    }
  }
  window.AVISOS_DEMO = true;
  return Array.isArray(window.AVISOS) ? window.AVISOS : [];
}

/* ---------- Estado y helpers ---------- */
const $ = (s) => document.querySelector(s);
const form = $("#filtros");
const grilla = $("#grilla");
const vacio = $("#vacio");
const resumen = $("#resumen");
const errorBox = $("#error");

let avisos = [];
let soloFavs = false;
let favs = new Set();

const ICONO_CASA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>';

function esFav(a) {
  return (a.ids || [a.id]).some((id) => favs.has(id));
}

function leerFavs() {
  try { return new Set(JSON.parse(localStorage.getItem("ay_favs") || "[]")); }
  catch { return new Set(); }
}
function guardarFavs() {
  try { localStorage.setItem("ay_favs", JSON.stringify([...favs])); } catch { /* sin storage */ }
}

function nombreZona(slug) {
  const z = ZONAS.find((x) => x.slug === slug);
  return z ? z.nombre : slug;
}

const NOMBRES_FUENTE = { zonaprop: "Zonaprop", argenprop: "Argenprop", mercadolibre: "Mercado Libre" };

function nombreFuente(f) {
  return NOMBRES_FUENTE[f] || f;
}

/* Color de tarjeta estable por aviso cuando no trae "tono" (datos reales). */
function tonoDe(a) {
  if (Number.isInteger(a.tono)) return a.tono % 6;
  let h = 0;
  for (const c of String(a.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}

/* ---------- Deduplicación entre portales ----------
 * Dos avisos de fuentes distintas se consideran el mismo departamento si coinciden
 * moneda, precio y ambientes, y además no se contradicen en zona, dormitorios ni m².
 * Un dato faltante nunca contradice. Dentro de una misma fuente no se fusiona nada.
 */
function mismoDepto(a, b) {
  if (a.fuente === b.fuente) return false;
  if (a.moneda !== b.moneda || a.precio !== b.precio) return false;
  if (!a.ambientes || !b.ambientes || a.ambientes !== b.ambientes) return false;
  if (a.zona && b.zona && a.zona !== "otros" && b.zona !== "otros" && a.zona !== b.zona) return false;
  if (a.dormitorios != null && b.dormitorios != null && a.dormitorios !== b.dormitorios) return false;
  if (a.m2 && b.m2 && Math.abs(a.m2 - b.m2) > 2) return false;
  return true;
}

function puntajeAviso(a) {
  return (a.foto ? 4 : 0) + (a.m2 ? 1 : 0) + (a.dormitorios != null ? 1 : 0) + (a.banos ? 1 : 0)
    + (a.expensas ? 1 : 0) + (a.lat != null ? 1 : 0) + ((a.destacados || []).length ? 1 : 0)
    + (a.zona && a.zona !== "otros" ? 1 : 0);
}

function deduplicar(lista) {
  const buckets = new Map();
  lista.forEach((a) => {
    const k = `${a.moneda}|${a.precio}|${a.ambientes || 0}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(a);
  });

  const posicion = new Map(lista.map((a, i) => [a.id, i]));
  const resultado = [];
  const vistos = new Set();
  // Se arranca por los avisos más completos: así los que tienen datos faltantes
  // se unen al grupo correcto y no a uno que solo les resulta "compatible" por no contradecirlos.
  const semillas = [...lista].sort((x, y) => puntajeAviso(y) - puntajeAviso(x));
  semillas.forEach((a) => {
    if (vistos.has(a.id)) return;
    const grupo = [a];
    vistos.add(a.id);
    // Un aviso entra al grupo solo si es compatible con TODOS sus miembros (sin encadenar).
    const candidatos = buckets.get(`${a.moneda}|${a.precio}|${a.ambientes || 0}`) || [];
    candidatos.forEach((c) => {
      if (!vistos.has(c.id) && grupo.every((g) => mismoDepto(g, c))) {
        grupo.push(c);
        vistos.add(c.id);
      }
    });
    const pos = Math.min(...grupo.map((g) => posicion.get(g.id)));
    if (grupo.length === 1) {
      resultado.push({ ...a, ids: [a.id], tambien: [], _pos: pos });
      return;
    }
    const orden = [...grupo].sort((x, y) => puntajeAviso(y) - puntajeAviso(x));
    const mejor = orden[0];
    const completo = { ...mejor };
    // Completa datos que le falten a la mejor versión con los de las otras.
    ["m2", "dormitorios", "banos", "expensas", "foto", "lat", "lng"].forEach((campo) => {
      if (completo[campo] == null || completo[campo] === "") {
        const donante = orden.find((o) => o[campo] != null && o[campo] !== "");
        if (donante) completo[campo] = donante[campo];
      }
    });
    if (completo.zona === "otros") {
      const conZona = orden.find((o) => o.zona && o.zona !== "otros");
      if (conZona) { completo.zona = conZona.zona; completo.barrio = conZona.barrio; }
    }
    completo.destacados = [...new Set(orden.flatMap((o) => o.destacados || []))].slice(0, 5);
    completo.ids = grupo.map((g) => g.id);
    completo.tambien = orden.slice(1).map((o) => ({ fuente: o.fuente, url: o.url }));
    completo._pos = pos;
    resultado.push(completo);
  });
  // Se respeta el orden original de la lista (más recientes primero).
  return resultado.sort((x, y) => x._pos - y._pos);
}

/* Zonas que vienen en los datos y no están en la lista base. */
function registrarZonasExtra(lista) {
  lista.forEach((a) => {
    if (a.zona && !ZONAS.some((z) => z.slug === a.zona)) {
      const nombre = a.barrio || a.zona.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
      ZONAS.push({ slug: a.zona, nombre });
    }
  });
}

function formatoPrecio(valor, moneda) {
  return (moneda === "USD" ? "USD " : "$") + Number(valor).toLocaleString("es-AR");
}

function leerFiltros() {
  const d = new FormData(form);
  return {
    zona: ZONAS.find((z) => z.slug === d.get("zona")) || null,
    ambientes: d.get("ambientes") || "",
    moneda: d.get("moneda") || "ARS",
    min: d.get("min") ? Number(d.get("min")) : null,
    max: d.get("max") ? Number(d.get("max")) : null
  };
}

function validar({ min, max }) {
  if (min !== null && min < 0) return "El precio mínimo no puede ser negativo.";
  if (max !== null && max < 0) return "El precio máximo no puede ser negativo.";
  if (min !== null && max !== null && min > max) return "El precio mínimo no puede ser mayor al máximo.";
  return "";
}

function filtrar(lista, f) {
  return lista.filter((a) => {
    if (f.zona && a.zona !== f.zona.slug) return false;
    if (f.ambientes) {
      if (f.ambientes === "5" ? a.ambientes < 5 : a.ambientes !== Number(f.ambientes)) return false;
    }
    if (a.moneda !== f.moneda) return false;
    if (f.min !== null && a.precio < f.min) return false;
    if (f.max !== null && a.precio > f.max) return false;
    if (soloFavs && !esFav(a)) return false;
    return true;
  });
}

function ordenar(lista, criterio) {
  const copia = [...lista];
  if (criterio === "precio-asc") copia.sort((x, y) => x.precio - y.precio);
  else if (criterio === "precio-desc") copia.sort((x, y) => y.precio - x.precio);
  else if (criterio === "m2-desc") copia.sort((x, y) => (y.m2 || 0) - (x.m2 || 0));
  return copia;
}

/* ---------- Render ---------- */
function crearTarjeta(a, i) {
  const card = document.createElement("article");
  card.className = "card";
  card.style.animationDelay = `${Math.min(i, 12) * 40}ms`;

  const media = document.createElement("div");
  media.className = `card__media tono-${tonoDe(a)}`;
  if (a.foto && /^https:\/\//i.test(a.foto)) {
    media.classList.add("card__media--foto");
    media.style.backgroundImage = `url("${encodeURI(a.foto)}")`;
  } else {
    media.innerHTML = ICONO_CASA;
  }

  const badge = document.createElement("span");
  badge.className = "card__badge";
  badge.textContent = nombreFuente(a.fuente);

  const fav = document.createElement("button");
  fav.type = "button";
  fav.className = "fav";
  fav.textContent = "♥";
  fav.setAttribute("aria-label", "Guardar en favoritos");
  fav.setAttribute("aria-pressed", esFav(a) ? "true" : "false");
  fav.addEventListener("click", () => {
    if (esFav(a)) (a.ids || [a.id]).forEach((id) => favs.delete(id)); else favs.add(a.id);
    guardarFavs();
    actualizarContadorFavs();
    if (soloFavs) render(); else fav.setAttribute("aria-pressed", esFav(a) ? "true" : "false");
  });

  media.append(badge, fav);

  const body = document.createElement("div");
  body.className = "card__body";

  const price = document.createElement("div");
  price.className = "card__price";
  const strong = document.createElement("strong");
  strong.textContent = formatoPrecio(a.precio, a.moneda);
  price.appendChild(strong);
  if (a.expensas) {
    const small = document.createElement("small");
    small.textContent = `+ ${formatoPrecio(a.expensas, "ARS")} expensas`;
    price.appendChild(small);
  }

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = a.titulo;

  const zona = document.createElement("p");
  zona.className = "card__zona";
  zona.textContent = `${nombreZona(a.zona)}, Rosario`;

  const specs = document.createElement("ul");
  specs.className = "specs";
  const datos = [
    a.ambientes ? (a.ambientes === 1 ? "Monoambiente" : `${a.ambientes} amb.`) : null,
    a.m2 ? `${Math.round(a.m2)} m²` : null,
    a.dormitorios ? `${a.dormitorios} dorm.` : null,
    a.banos ? `${a.banos} ${a.banos === 1 ? "baño" : "baños"}` : null
  ].filter(Boolean);
  datos.forEach((t) => { const li = document.createElement("li"); li.textContent = t; specs.appendChild(li); });

  const tags = document.createElement("div");
  tags.className = "tags";
  (a.destacados || []).forEach((t) => { const s = document.createElement("span"); s.className = "tag"; s.textContent = t; tags.appendChild(s); });

  const cta = document.createElement("a");
  cta.className = "card__cta";
  cta.href = a.url;
  cta.target = "_blank";
  cta.rel = "noopener noreferrer";
  cta.textContent = `Ver en ${nombreFuente(a.fuente)}`;

  body.append(price, title, zona, specs, tags);

  if (a.tambien && a.tambien.length) {
    const tb = document.createElement("p");
    tb.className = "tambien";
    tb.append("También en: ");
    a.tambien.forEach((t, i) => {
      if (i) tb.append(" · ");
      const l = document.createElement("a");
      l.href = t.url;
      l.target = "_blank";
      l.rel = "noopener noreferrer";
      l.textContent = nombreFuente(t.fuente);
      tb.appendChild(l);
    });
    body.appendChild(tb);
  }

  body.appendChild(cta);
  card.append(media, body);
  return card;
}

function describir(f, total) {
  const partes = [f.zona ? f.zona.nombre : "Toda Rosario"];
  if (f.ambientes) partes.push(f.ambientes === "1" ? "Monoambiente" : f.ambientes === "5" ? "5 o más ambientes" : `${f.ambientes} ambientes`);
  if (f.min !== null && f.max !== null) partes.push(`${formatoPrecio(f.min, f.moneda)} a ${formatoPrecio(f.max, f.moneda)}`);
  else if (f.min !== null) partes.push(`desde ${formatoPrecio(f.min, f.moneda)}`);
  else if (f.max !== null) partes.push(`hasta ${formatoPrecio(f.max, f.moneda)}`);
  if (soloFavs) partes.push("solo favoritos");
  return `${total} ${total === 1 ? "resultado" : "resultados"} · ${partes.join(" · ")}`;
}

function renderPortales(f) {
  const cont = $("#portalesGrid");
  cont.replaceChildren(...PORTALES.map((p) => {
    const a = document.createElement("a");
    a.className = "portal";
    a.href = p.build(f);
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const logo = document.createElement("span");
    logo.className = "portal__logo";
    logo.style.background = p.color;
    logo.textContent = p.sigla;
    logo.setAttribute("aria-hidden", "true");

    const txt = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = p.nombre;
    const d = document.createElement("p");
    d.textContent = p.descripcion;
    txt.append(h, d);

    const arrow = document.createElement("span");
    arrow.className = "portal__arrow";
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");

    a.append(logo, txt, arrow);
    return a;
  }));
}

function render() {
  const f = leerFiltros();
  const msg = validar(f);
  if (msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    return;
  }
  errorBox.hidden = true;

  const lista = ordenar(filtrar(avisos, f), $("#orden").value);
  grilla.replaceChildren(...lista.map(crearTarjeta));
  vacio.hidden = lista.length > 0;
  resumen.textContent = describir(f, lista.length);
  renderPortales(f);
}

function actualizarContadorFavs() {
  $("#cantFavs").textContent = favs.size;
}

/* ---------- Init ---------- */
function cargarZonas() {
  const sel = $("#zona");
  [...ZONAS].sort((x, y) => x.nombre.localeCompare(y.nombre, "es")).forEach((z) => {
    const o = document.createElement("option");
    o.value = z.slug;
    o.textContent = z.nombre;
    sel.appendChild(o);
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  render();
  $("#avisos").scrollIntoView({ behavior: "smooth" });
});
["zona", "ambientes", "moneda"].forEach((id) => $("#" + id).addEventListener("change", render));
["min", "max"].forEach((id) => $("#" + id).addEventListener("input", render));
$("#orden").addEventListener("change", render);

$("#limpiar").addEventListener("click", () => {
  form.reset();
  soloFavs = false;
  $("#verFavs").setAttribute("aria-pressed", "false");
  render();
});

$("#verFavs").addEventListener("click", (e) => {
  soloFavs = !soloFavs;
  e.currentTarget.setAttribute("aria-pressed", String(soloFavs));
  render();
  $("#avisos").scrollIntoView({ behavior: "smooth" });
});

(async function init() {
  $("#anio").textContent = new Date().getFullYear();
  favs = leerFavs();
  actualizarContadorFavs();
  avisos = deduplicar(await obtenerAvisos());
  registrarZonasExtra(avisos);
  cargarZonas();
  $("#demoBanner").hidden = !window.AVISOS_DEMO;
  render();
})();
