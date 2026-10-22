// Adaptadores de Zonaprop y Argenprop vía Apify (actors de terceros, de pago por uso).
// Requiere APIFY_TOKEN. Ojo: es extracción de datos de terceros; revisá costos y términos de uso de cada portal.
import type { Aviso } from "../_shared/normalizar.ts";
import { entero, fotoUrl, monedaDe, num, primerTramo, zonaDe } from "../_shared/normalizar.ts";

// deno-lint-ignore no-explicit-any
type Fila = any;

async function correrActor(actor: string, input: unknown): Promise<Fila[]> {
  const token = Deno.env.get("APIFY_TOKEN");
  if (!token) throw new Error("Falta APIFY_TOKEN");
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?format=json&clean=true`,
    {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(Number(Deno.env.get("APIFY_TIMEOUT_MS") ?? 130000)),
    },
  );
  if (!r.ok) throw new Error(`Apify ${actor} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const datos = await r.json();
  return Array.isArray(datos) ? datos : [];
}

const MAX = () => Number(Deno.env.get("APIFY_MAX_RESULTS") ?? 100);

/* ---------- Zonaprop ---------- */
export function mapearZonaprop(f: Fila): Aviso | null {
  const path: string = String(f.location_path ?? "");
  if (path && !/rosario/i.test(path)) return null;
  const precio = num(f.price);
  if (!precio || !f.url) return null;

  const { zona, barrio } = zonaDe(primerTramo(f.location_name) ?? primerTramo(path));
  const destacados: string[] = [];
  if ((num(f.parking) ?? 0) > 0) destacados.push("Cochera");

  const primeraFoto = Array.isArray(f.images) ? f.images[0] : undefined;

  return {
    id: `zonaprop:${f.id ?? f.url}`,
    fuente: "zonaprop",
    url: f.url,
    titulo: f.propertyTitle ?? "Departamento en alquiler",
    zona,
    barrio,
    ambientes: entero(f.rooms),
    dormitorios: entero(f.bedrooms),
    banos: entero(f.bathrooms),
    m2: num(f.total_area) ?? num(f.covered_area),
    precio,
    moneda: monedaDe(f.currency),
    expensas: num(f.expenses),
    foto: fotoUrl(f.thumbnail) ?? fotoUrl(primeraFoto),
    destacados,
    lat: num(f.latitude),
    lng: num(f.longitude),
  };
}

export async function traerZonaprop(debug = false): Promise<{ avisos: Aviso[]; muestraCruda?: unknown }> {
  const actor = Deno.env.get("APIFY_ZONAPROP_ACTOR") ?? "sian.agency~zonaprop-property-scraper";
  const filas = await correrActor(actor, {
    scrapeMode: "overview",
    searchMode: "byPlace",
    operation: "rent",
    propertyType: "departamentos",
    place: "rosario",
    sort: "more_recent",
    maxResults: MAX(),
  });
  const avisos = filas.map(mapearZonaprop).filter((a): a is Aviso => a !== null);
  return { avisos, muestraCruda: debug ? filas.slice(0, 1) : undefined };
}

/* ---------- Argenprop ---------- */
export function mapearArgenprop(f: Fila): Aviso | null {
  const precio = num(f.price);
  if (!precio || !f.url) return null;

  const { zona, barrio } = zonaDe(primerTramo(f.neighbourhood));
  const foto = fotoUrl(f.thumbnail) ?? fotoUrl(f.imageUrl) ?? fotoUrl(Array.isArray(f.images) ? f.images[0] : undefined);
  // Las expensas se muestran siempre en pesos; si vienen en otra moneda se descartan.
  const expensas = !f.expensesCurrency || monedaDe(f.expensesCurrency) === "ARS" ? num(f.expenses) : null;

  return {
    id: `argenprop:${f.listingId ?? f.url}`,
    fuente: "argenprop",
    url: f.url,
    titulo: f.propertyHeading ?? "Departamento en alquiler",
    zona,
    barrio,
    ambientes: entero(f.rooms),
    dormitorios: entero(f.bedrooms),
    banos: entero(f.bathrooms),
    m2: num(f.coveredAreaM2),
    precio,
    moneda: monedaDe(f.currency),
    expensas,
    foto,
    destacados: [],
    lat: num(f.latitude),
    lng: num(f.longitude),
  };
}

export async function traerArgenprop(debug = false): Promise<{ avisos: Aviso[]; muestraCruda?: unknown }> {
  const actor = Deno.env.get("APIFY_ARGENPROP_ACTOR") ?? "sian.agency~argenprop-property-scraper";
  const filas = await correrActor(actor, {
    operation: "search",
    operationType: "alquiler",
    propertyType: "departamentos",
    locations: ["rosario"],
    sortBy: "masnuevos",
    maxResults: MAX(),
  });
  const avisos = filas.map(mapearArgenprop).filter((a): a is Aviso => a !== null);
  return { avisos, muestraCruda: debug ? filas.slice(0, 1) : undefined };
}
