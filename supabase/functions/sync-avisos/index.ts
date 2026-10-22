// Edge Function: sincroniza avisos de las fuentes hacia la tabla `avisos`.
// Se invoca por cron (o a mano) con el header x-sync-secret. Deploy: --no-verify-jwt.
//   POST /functions/v1/sync-avisos?source=mercadolibre,zonaprop,argenprop&debug=1
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Aviso } from "../_shared/normalizar.ts";
import { traerMercadoLibre } from "./mercadolibre.ts";
import { traerArgenprop, traerZonaprop } from "./apify.ts";

type Resultado = { avisos: Aviso[]; muestraCruda?: unknown };
const FUENTES: Record<string, (debug: boolean) => Promise<Resultado>> = {
  mercadolibre: traerMercadoLibre,
  zonaprop: traerZonaprop,
  argenprop: traerArgenprop,
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo, null, 2), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const secreto = Deno.env.get("SYNC_SECRET");
  if (!secreto || req.headers.get("x-sync-secret") !== secreto) {
    return json({ error: "No autorizado" }, 401);
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const pedidas = (url.searchParams.get("source") ?? Object.keys(FUENTES).join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const salida: Record<string, unknown> = {};

  for (const fuente of pedidas) {
    const traer = FUENTES[fuente];
    if (!traer) {
      salida[fuente] = { error: "Fuente desconocida" };
      continue;
    }
    try {
      const inicio = new Date().toISOString();
      const { avisos, muestraCruda } = await traer(debug);

      // Sin duplicados dentro de la misma corrida.
      const unicos = [...new Map(avisos.map((a) => [a.id, a])).values()];
      const filas = unicos.map((a) => ({ ...a, activo: true, ultimo_visto: inicio, actualizado_en: inicio }));

      for (let i = 0; i < filas.length; i += 200) {
        const { error } = await supabase.from("avisos").upsert(filas.slice(i, i + 200), { onConflict: "id" });
        if (error) throw new Error(`upsert: ${error.message}`);
      }

      // Si la fuente devolvió datos, los avisos que ya no aparecen se marcan inactivos.
      let desactivados = 0;
      if (filas.length > 0) {
        const { data, error } = await supabase
          .from("avisos")
          .update({ activo: false })
          .eq("fuente", fuente)
          .eq("activo", true)
          .lt("ultimo_visto", inicio)
          .select("id");
        if (error) throw new Error(`desactivar: ${error.message}`);
        desactivados = data?.length ?? 0;
      }

      salida[fuente] = {
        ok: true,
        recibidos: avisos.length,
        guardados: filas.length,
        desactivados,
        ...(debug ? { muestraCruda, muestraNormalizada: unicos.slice(0, 2) } : {}),
      };
    } catch (e) {
      salida[fuente] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return json(salida);
});
