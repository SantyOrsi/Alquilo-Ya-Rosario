// Tipos y utilidades comunes a todos los adaptadores.

export interface Aviso {
  id: string;
  fuente: "mercadolibre" | "zonaprop" | "argenprop";
  url: string;
  titulo: string;
  zona: string;
  barrio: string | null;
  ambientes: number | null;
  dormitorios: number | null;
  banos: number | null;
  m2: number | null;
  precio: number;
  moneda: "ARS" | "USD";
  expensas: number | null;
  foto: string | null;
  destacados: string[];
  lat: number | null;
  lng: number | null;
}

export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const limpio = String(v).replace(/[^0-9.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export function entero(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

export function monedaDe(v: unknown): "ARS" | "USD" {
  return /usd|u\$s|dolar|dólar/i.test(String(v ?? "")) ? "USD" : "ARS";
}

/** Primer tramo de "Centro, Rosario" o "Centro > Rosario > Santa Fe". */
export function primerTramo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.split(/[,>]/)[0]?.trim();
  return t ? t : null;
}

export function zonaDe(barrio: string | null): { zona: string; barrio: string | null } {
  if (!barrio) return { zona: "otros", barrio: null };
  const z = slug(barrio);
  if (!z || z === "rosario") return { zona: "otros", barrio: null };
  return { zona: z, barrio };
}

/** Acepta string o { url | src | href } y devuelve una URL https válida (o null). */
export function fotoUrl(v: unknown): string | null {
  let u: unknown = v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    u = o.url ?? o.src ?? o.href;
  }
  if (typeof u !== "string") return null;
  const https = u.replace(/^http:\/\//i, "https://");
  return /^https:\/\//i.test(https) ? https : null;
}
