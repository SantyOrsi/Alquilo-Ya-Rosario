// Adaptador de Mercado Libre (API oficial).
// Requiere una app registrada en developers.mercadolibre.com.ar (ML_CLIENT_ID / ML_CLIENT_SECRET).
import type { Aviso } from "../_shared/normalizar.ts";
import { entero, fotoUrl, monedaDe, num, zonaDe } from "../_shared/normalizar.ts";

const API = "https://api.mercadolibre.com";
// Categoría Departamentos de MLA y valor del atributo OPERATION = Alquiler (según la documentación de Mercado Libre).
const CATEGORIA = Deno.env.get("ML_CATEGORY") ?? "MLA1472";
const OPERACION_ALQUILER = Deno.env.get("ML_OPERATION_ID") ?? "242073";

// deno-lint-ignore no-explicit-any
type Item = any;

async function obtenerToken(): Promise<string> {
  const id = Deno.env.get("ML_CLIENT_ID");
  const secret = Deno.env.get("ML_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Faltan ML_CLIENT_ID y/o ML_CLIENT_SECRET");
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!r.ok) throw new Error(`ML oauth ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.access_token as string;
}

function atributo(item: Item, id: string): Item | undefined {
  return (item.attributes ?? []).find((a: Item) => a.id === id);
}
function valorNum(item: Item, id: string): number | null {
  const a = atributo(item, id);
  if (!a) return null;
  return num(a.value_struct?.number ?? a.value_name);
}

export function mapear(it: Item): Aviso | null {
  const ciudad: string = it.location?.city?.name ?? "";
  if (ciudad && !/rosario/i.test(ciudad)) return null;

  const operacion: string = atributo(it, "OPERATION")?.value_name ?? "";
  if (/venta|temporal|temporario/i.test(operacion)) return null;

  const precio = num(it.price);
  if (!precio || !it.permalink) return null;

  const barrio: string | null = it.location?.neighborhood?.name ?? null;
  const { zona, barrio: barrioFinal } = zonaDe(barrio);

  const destacados: string[] = [];
  if ((valorNum(it, "PARKING_LOTS") ?? 0) > 0) destacados.push("Cochera");
  if (/s[ií]/i.test(atributo(it, "IS_SUITABLE_FOR_PETS")?.value_name ?? "")) destacados.push("Pet friendly");
  if (/s[ií]/i.test(atributo(it, "FURNISHED")?.value_name ?? "")) destacados.push("Amoblado");

  return {
    id: `mercadolibre:${it.id}`,
    fuente: "mercadolibre",
    url: it.permalink,
    titulo: it.title ?? "Departamento en alquiler",
    zona,
    barrio: barrioFinal,
    ambientes: entero(valorNum(it, "ROOMS")),
    dormitorios: entero(valorNum(it, "BEDROOMS")),
    banos: entero(valorNum(it, "FULL_BATHROOMS")),
    m2: valorNum(it, "COVERED_AREA") ?? valorNum(it, "TOTAL_AREA"),
    precio,
    moneda: monedaDe(it.currency_id),
    expensas: valorNum(it, "MAINTENANCE_FEE"),
    foto: fotoUrl(it.thumbnail),
    destacados,
    lat: num(it.location?.latitude),
    lng: num(it.location?.longitude),
  };
}

export async function traerMercadoLibre(debug = false): Promise<{ avisos: Aviso[]; muestraCruda?: unknown }> {
  const token = await obtenerToken();
  const max = Number(Deno.env.get("ML_MAX_RESULTS") ?? 300);
  const crudos: Item[] = [];

  for (let offset = 0; offset < max; offset += 50) {
    const p = new URLSearchParams({
      category: CATEGORIA,
      OPERATION: OPERACION_ALQUILER,
      limit: "50",
      offset: String(offset),
    });
    // Opcional y más preciso: IDs de provincia/ciudad (ver /classified_locations).
    const state = Deno.env.get("ML_STATE_ID");
    const city = Deno.env.get("ML_CITY_ID");
    if (state) p.set("state", state);
    if (city) p.set("city", city);
    if (!city) p.set("q", "rosario");

    const r = await fetch(`${API}/sites/MLA/search?${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`ML search ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const resultados: Item[] = j.results ?? [];
    crudos.push(...resultados);
    if (resultados.length < 50) break;
  }

  const avisos = crudos.map(mapear).filter((a): a is Aviso => a !== null);
  return { avisos, muestraCruda: debug ? crudos.slice(0, 1) : undefined };
}
