-- Tabla de avisos de alquiler (cache de las fuentes). La web la lee con la anon key.
create table if not exists public.avisos (
  id           text primary key,                -- "fuente:id_externo"
  fuente       text not null,                   -- mercadolibre | zonaprop | argenprop
  url          text not null,
  titulo       text not null,
  zona         text not null default 'otros',   -- slug del barrio
  barrio       text,
  ambientes    int,
  dormitorios  int,
  banos        int,
  m2           numeric,
  precio       numeric not null,
  moneda       text not null check (moneda in ('ARS', 'USD')),
  expensas     numeric,
  foto         text,
  destacados   text[] not null default '{}',
  lat          double precision,
  lng          double precision,
  activo       boolean not null default true,
  ultimo_visto timestamptz not null default now(),
  creado_en    timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists avisos_activo_zona_idx on public.avisos (activo, zona);
create index if not exists avisos_activo_precio_idx on public.avisos (activo, moneda, precio);
create index if not exists avisos_fuente_visto_idx on public.avisos (fuente, ultimo_visto);

-- Seguridad: lectura pública solo de avisos activos; escritura solo con service role (Edge Function).
alter table public.avisos enable row level security;

drop policy if exists "lectura publica de avisos activos" on public.avisos;
create policy "lectura publica de avisos activos"
  on public.avisos for select
  to anon, authenticated
  using (activo);

grant select on public.avisos to anon, authenticated;
