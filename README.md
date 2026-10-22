# Alquilo Ya-Rosario

Buscador de alquileres en Rosario. Frontend estático (HTML/CSS/JS) + backend en Supabase que
sincroniza avisos de Mercado Libre, Zonaprop y Argenprop.

```
alquilo-ya-rosario/
  README.md
  web/                                      lo que se publica (sitio estático)
    index.html
    css/styles.css
    js/app.js                               lógica: filtros, deduplicación, render
    js/config.js                            URL y anon key de Supabase (completar)
    js/avisos.js                            datos de ejemplo, solo fallback
  supabase/                                 backend (el CLI lo necesita en la raíz del proyecto)
  migrations/20261021000000_avisos.sql      tabla + RLS (lectura pública solo de avisos activos)
  functions/_shared/normalizar.ts           tipos y utilidades
  functions/sync-avisos/index.ts            función de sincronización (upsert + baja de avisos viejos)
  functions/sync-avisos/mercadolibre.ts     adaptador API oficial de Mercado Libre
  functions/sync-avisos/apify.ts            adaptadores Zonaprop y Argenprop (vía Apify)
```

## Cómo funciona

1. Un cron llama a la función `sync-avisos`, que trae avisos de cada fuente, los normaliza y los guarda en la tabla `avisos`.
2. Los avisos que dejan de aparecer en una fuente se marcan `activo = false`.
3. La web lee la tabla con la clave pública (anon) y filtra en el navegador. Sin login.

## Puesta en marcha

### 1. Proyecto y base de datos
```bash
npm i -g supabase            # o usar npx supabase
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push             # crea la tabla avisos
```

### 2. Credenciales de las fuentes (secrets)
```bash
supabase secrets set SYNC_SECRET="una-clave-larga-y-aleatoria"

# Mercado Libre: crear una app en https://developers.mercadolibre.com.ar/
supabase secrets set ML_CLIENT_ID="..." ML_CLIENT_SECRET="..."

# Apify (Zonaprop y Argenprop): token en https://console.apify.com/settings/integrations
supabase secrets set APIFY_TOKEN="..."
```

Opcionales: `ML_MAX_RESULTS` (300), `ML_STATE_ID` / `ML_CITY_ID` (IDs de /classified_locations,
más preciso que la búsqueda por texto), `APIFY_MAX_RESULTS` (100), `APIFY_TIMEOUT_MS` (130000),
`ML_CATEGORY` (MLA1472), `ML_OPERATION_ID` (242073 = alquiler).

### 3. Desplegar la función
```bash
supabase functions deploy sync-avisos --no-verify-jwt
```
`--no-verify-jwt` porque la protege el header `x-sync-secret`.

### 4. Probar cada fuente por separado (con `debug=1` devuelve una muestra cruda y otra normalizada)
```bash
curl -X POST "https://TU_PROJECT_REF.supabase.co/functions/v1/sync-avisos?source=mercadolibre&debug=1" \
  -H "x-sync-secret: una-clave-larga-y-aleatoria"
# repetir con source=zonaprop y source=argenprop
```
**Hacelo antes de programar el cron**: sirve para verificar que los campos mapean bien
(ver "Puntos a verificar").

### 5. Programar la sincronización (SQL Editor de Supabase)
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Una tarea por fuente (cada una tiene su propio límite de tiempo). Cada 6 horas, a distintos minutos.
select cron.schedule('sync-ml',  '0 */6 * * *',  $$ select net.http_post(
  url := 'https://TU_PROJECT_REF.supabase.co/functions/v1/sync-avisos?source=mercadolibre',
  headers := '{"x-sync-secret": "una-clave-larga-y-aleatoria"}'::jsonb) $$);
select cron.schedule('sync-zp',  '10 */6 * * *', $$ select net.http_post(
  url := 'https://TU_PROJECT_REF.supabase.co/functions/v1/sync-avisos?source=zonaprop',
  headers := '{"x-sync-secret": "una-clave-larga-y-aleatoria"}'::jsonb) $$);
select cron.schedule('sync-ap',  '20 */6 * * *', $$ select net.http_post(
  url := 'https://TU_PROJECT_REF.supabase.co/functions/v1/sync-avisos?source=argenprop',
  headers := '{"x-sync-secret": "una-clave-larga-y-aleatoria"}'::jsonb) $$);
```

### 6. Conectar el frontend
Completá `web/js/config.js` con la URL del proyecto y la clave anon (Project Settings → API) y publicá
la carpeta `web/` (Netlify, Vercel, Cloudflare Pages, GitHub Pages…). Los comandos de `supabase` se
corren desde la raíz `alquilo-ya-rosario/`, no desde `web/`.
Mientras `config.js` esté vacío, la web muestra los datos de ejemplo.

## Puntos a verificar (no pude probarlos contra los servicios reales)

- **Mercado Libre:** que tu app tenga permiso de búsqueda en `/sites/MLA/search`, que la categoría
  `MLA1472` y el valor `OPERATION=242073` sean los vigentes, y que los atributos (`ROOMS`,
  `BEDROOMS`, `FULL_BATHROOMS`, `COVERED_AREA`, `MAINTENANCE_FEE`) vengan en los resultados de búsqueda.
  Si faltan, hay que pedir cada ítem por `/items/{id}` (más llamadas).
- **Apify:** los nombres de campos salen de la documentación de cada actor. Revisá la muestra de
  `debug=1`. Argenprop no documenta baños ni foto en la fila de búsqueda; si no aparecen, la tarjeta
  simplemente no los muestra.
- **Límite de tiempo:** la llamada a Apify es sincrónica; con `APIFY_MAX_RESULTS` alto puede superar
  el límite de la Edge Function. Si pasa, bajá el número o dividí por zona.
- **Duplicados:** la web unifica en una sola tarjeta los avisos de portales distintos que coinciden en
  moneda, precio y ambientes, y no se contradicen en zona, dormitorios ni m² (diferencia de hasta 2 m²).
  La tarjeta muestra la versión más completa y "También en: …" con links a los otros portales. Es una
  heurística: si el mismo depto se publica con precios distintos en cada portal no lo detecta, y dos
  deptos distintos con mismo precio, ambientes y zona y datos faltantes podrían unirse por error.
  Dentro de un mismo portal nunca se fusiona nada. La lógica está en `deduplicar()` de `app.js`.

## Costos y términos

- Mercado Libre: API oficial, sin costo por uso (sujeto a sus límites).
- Apify: se paga por resultado (del orden de unos pocos dólares cada mil avisos). El plan gratuito
  de cada actor limita a 25 avisos por corrida.
- Zonaprop y Argenprop no ofrecen API pública; esas fuentes dependen de extracción de terceros, que
  puede ir contra los términos de uso de los portales y romperse si cambian su sitio. Evaluá ese riesgo
  antes de lanzar públicamente, y mostrá siempre el enlace al aviso original (la web ya lo hace).
