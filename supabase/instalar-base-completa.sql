-- ════════════════════════════════════════════════════════════
-- CONTRIX — INSTALACIÓN COMPLETA DE LA BASE DE DATOS
-- Úsalo cuando las tablas existentes no coinciden con Contrix
-- (por ejemplo: "column empresas.activo does not exist").
--
-- ⚠ BORRA y vuelve a crear las tablas de Contrix (empresas, CFDIs,
--   pólizas, catálogo, etc.). NO borra los usuarios de
--   Authentication: sus perfiles se vuelven a crear al final.
--   Los archivos guardados en Storage no se tocan.
--
-- Supabase → SQL Editor → New query → pega TODO → Run.
-- ════════════════════════════════════════════════════════════

-- 0. Limpieza de tablas y funciones anteriores
drop table if exists public.cfdi_pagos_doctos cascade;
drop table if exists public.actividad_log cascade;
drop table if exists public.noticias cascade;
drop table if exists public.uploads cascade;
drop table if exists public.indicadores_economicos cascade;
drop table if exists public.efos_blacklist cascade;
drop table if exists public.declaraciones cascade;
drop table if exists public.recibos_nomina cascade;
drop table if exists public.periodos_nomina cascade;
drop table if exists public.empleados cascade;
drop table if exists public.asientos cascade;
drop table if exists public.polizas cascade;
drop table if exists public.cfdi_conceptos cascade;
drop table if exists public.cfdis cascade;
drop table if exists public.contactos cascade;
drop table if exists public.catalogo_cuentas cascade;
drop table if exists public.miembros_empresa cascade;
drop table if exists public.empresas cascade;
drop table if exists public.profiles cascade;
drop function if exists public.user_has_access_to_empresa(uuid) cascade;
drop function if exists public.es_admin() cascade;
drop function if exists public.invitar_miembro(uuid, text, text) cascade;
drop function if exists public.miembros_de_empresa(uuid) cascade;
drop function if exists public.validar_limite_empresas() cascade;
drop function if exists public.proteger_campos_facturacion() cascade;

-- Habilitar extensiones necesarias
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════
-- 1. PROFILES (extiende auth.users)
-- ════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  nombre text,
  telefono text,
  rfc_personal text,
  avatar_url text,
  plan text default 'pymes' check (plan in ('pymes','empresarial','corporativo')),
  trial_ends_at timestamptz default (now() + interval '30 days'),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Trigger para crear profile automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ════════════════════════════════════════════════════════════
-- 2. EMPRESAS (multi-tenancy: una cuenta puede tener varias)
-- ════════════════════════════════════════════════════════════
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  rfc text not null,
  razon_social text not null,
  nombre_comercial text,
  regimen_fiscal text,           -- ej. 601 (General Ley Personas Morales)
  codigo_postal text,
  pais text default 'México',
  estado text,
  municipio text,
  colonia text,
  calle text,
  numero_ext text,
  numero_int text,
  email_contacto text,
  telefono text,
  curp text,
  fiel_certificado_url text,     -- ruta en Storage del .cer
  fiel_llave_url text,           -- ruta en Storage del .key (cifrado)
  csd_certificado_url text,
  csd_llave_url text,
  logo_url text,
  activo boolean default true,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(owner_id, rfc)
);

create index if not exists idx_empresas_owner on public.empresas(owner_id);
create index if not exists idx_empresas_rfc on public.empresas(rfc);

-- ════════════════════════════════════════════════════════════
-- 3. MIEMBROS DE EMPRESA (colaboración multi-usuario)
-- ════════════════════════════════════════════════════════════
create table if not exists public.miembros_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rol text not null default 'colaborador' check (rol in ('admin','contador','colaborador','solo_lectura')),
  invitado_por uuid references public.profiles(id),
  created_at timestamptz default now() not null,
  unique(empresa_id, user_id)
);

create index if not exists idx_miembros_empresa on public.miembros_empresa(empresa_id);
create index if not exists idx_miembros_user on public.miembros_empresa(user_id);

-- ════════════════════════════════════════════════════════════
-- 4. CATÁLOGO DE CUENTAS (SAT)
-- ════════════════════════════════════════════════════════════
create table if not exists public.catalogo_cuentas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo_sat text,                  -- código agrupador SAT
  numero text not null,             -- número interno
  descripcion text not null,
  nivel int default 1,
  naturaleza text check (naturaleza in ('D','A')), -- Deudora / Acreedora
  tipo text,                        -- Activo / Pasivo / Capital / Ingreso / Gasto
  cuenta_padre uuid references public.catalogo_cuentas(id),
  saldo_actual numeric(18,2) default 0,
  activa boolean default true,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(empresa_id, numero)
);

create index if not exists idx_cuentas_empresa on public.catalogo_cuentas(empresa_id);

-- ════════════════════════════════════════════════════════════
-- 5. CLIENTES y PROVEEDORES
-- ════════════════════════════════════════════════════════════
create table if not exists public.contactos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cliente','proveedor','ambos')),
  rfc text not null,
  razon_social text not null,
  email text,
  telefono text,
  domicilio text,
  regimen_fiscal text,
  uso_cfdi_default text,
  forma_pago_default text,
  metodo_pago_default text,
  dias_credito int default 0,
  limite_credito numeric(18,2) default 0,
  saldo_actual numeric(18,2) default 0,
  activo boolean default true,
  notas text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_contactos_empresa on public.contactos(empresa_id);
create index if not exists idx_contactos_rfc on public.contactos(rfc);
create index if not exists idx_contactos_tipo on public.contactos(tipo);

-- ════════════════════════════════════════════════════════════
-- 6. CFDIs (Comprobantes Fiscales Digitales)
-- ════════════════════════════════════════════════════════════
create table if not exists public.cfdis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  uuid_sat text not null,            -- UUID del SAT (folio fiscal)
  serie text,
  folio text,
  tipo text not null check (tipo in ('I','E','T','N','P')), -- Ingreso/Egreso/Traslado/Nómina/Pago
  fecha_emision timestamptz not null,
  fecha_timbrado timestamptz,
  emisor_rfc text not null,
  emisor_nombre text,
  emisor_regimen text,
  receptor_rfc text not null,
  receptor_nombre text,
  receptor_uso_cfdi text,
  receptor_cp text,
  subtotal numeric(18,2) default 0,
  descuento numeric(18,2) default 0,
  iva_trasladado numeric(18,2) default 0,
  iva_retenido numeric(18,2) default 0,
  isr_retenido numeric(18,2) default 0,
  total numeric(18,2) default 0,
  moneda text default 'MXN',
  tipo_cambio numeric(10,4) default 1,
  forma_pago text,
  metodo_pago text,
  condiciones_pago text,
  lugar_expedicion text,
  estado text default 'vigente' check (estado in ('vigente','cancelado','en_proceso_cancelacion')),
  fecha_cancelacion timestamptz,
  motivo_cancelacion text,
  pac text,                          -- PAC que timbró
  xml_url text,                      -- ruta en Storage del XML
  pdf_url text,                      -- ruta en Storage del PDF
  origen text default 'recibido' check (origen in ('emitido','recibido','sat_descarga','manual')),
  conciliado boolean default false,
  poliza_id uuid,                    -- FK a polizas (se llena al conciliar)
  notas text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(empresa_id, uuid_sat)
);

create index if not exists idx_cfdis_empresa on public.cfdis(empresa_id);
create index if not exists idx_cfdis_uuid on public.cfdis(uuid_sat);
create index if not exists idx_cfdis_fecha on public.cfdis(fecha_emision);
create index if not exists idx_cfdis_tipo on public.cfdis(tipo);
create index if not exists idx_cfdis_estado on public.cfdis(estado);
create index if not exists idx_cfdis_emisor on public.cfdis(emisor_rfc);
create index if not exists idx_cfdis_receptor on public.cfdis(receptor_rfc);

-- ════════════════════════════════════════════════════════════
-- 7. CONCEPTOS DE CFDI
-- ════════════════════════════════════════════════════════════
create table if not exists public.cfdi_conceptos (
  id uuid primary key default gen_random_uuid(),
  cfdi_id uuid not null references public.cfdis(id) on delete cascade,
  clave_prod_serv text,
  no_identificacion text,
  cantidad numeric(18,4) default 1,
  clave_unidad text,
  unidad text,
  descripcion text not null,
  valor_unitario numeric(18,4) default 0,
  importe numeric(18,2) default 0,
  descuento numeric(18,2) default 0,
  objeto_imp text,
  cuenta_predial text,
  orden int default 0,
  created_at timestamptz default now() not null
);

create index if not exists idx_conceptos_cfdi on public.cfdi_conceptos(cfdi_id);

-- ════════════════════════════════════════════════════════════
-- 8. PÓLIZAS CONTABLES
-- ════════════════════════════════════════════════════════════
create table if not exists public.polizas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero text not null,                 -- ej. POL-2026-00045
  tipo text not null check (tipo in ('I','E','D','T')),  -- Ingreso/Egreso/Diario/Traslado
  fecha date not null,
  concepto text not null,
  total_cargos numeric(18,2) default 0,
  total_abonos numeric(18,2) default 0,
  estado text default 'pendiente' check (estado in ('pendiente','sincronizado','error','exitoso','parcial','cancelada')),
  origen text default 'manual' check (origen in ('manual','cfdi','automatica','importada')),
  cfdi_id uuid references public.cfdis(id),
  creada_por uuid references public.profiles(id),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(empresa_id, numero)
);

create index if not exists idx_polizas_empresa on public.polizas(empresa_id);
create index if not exists idx_polizas_fecha on public.polizas(fecha);
create index if not exists idx_polizas_tipo on public.polizas(tipo);
create index if not exists idx_polizas_estado on public.polizas(estado);

-- Link CFDIs -> Polizas (FK que requiere polizas existir)
alter table public.cfdis drop constraint if exists cfdis_poliza_id_fkey;
alter table public.cfdis add constraint cfdis_poliza_id_fkey
  foreign key (poliza_id) references public.polizas(id) on delete set null;

-- ════════════════════════════════════════════════════════════
-- 9. ASIENTOS CONTABLES (líneas de una póliza)
-- ════════════════════════════════════════════════════════════
create table if not exists public.asientos (
  id uuid primary key default gen_random_uuid(),
  poliza_id uuid not null references public.polizas(id) on delete cascade,
  cuenta_id uuid not null references public.catalogo_cuentas(id),
  cargo numeric(18,2) default 0,
  abono numeric(18,2) default 0,
  concepto text,
  referencia text,
  orden int default 0,
  created_at timestamptz default now() not null,
  check (cargo >= 0 and abono >= 0 and (cargo > 0 or abono > 0))
);

create index if not exists idx_asientos_poliza on public.asientos(poliza_id);
create index if not exists idx_asientos_cuenta on public.asientos(cuenta_id);

-- ════════════════════════════════════════════════════════════
-- 10. EMPLEADOS (Nómina)
-- ════════════════════════════════════════════════════════════
create table if not exists public.empleados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero_empleado text,
  rfc text not null,
  curp text,
  nss text,                          -- Número Seguridad Social
  nombre text not null,
  apellido_paterno text,
  apellido_materno text,
  fecha_nacimiento date,
  fecha_ingreso date not null,
  fecha_baja date,
  puesto text,
  departamento text,
  tipo_contrato text default 'indeterminado',
  tipo_jornada text default 'diurna',
  tipo_regimen text,                 -- 02 Sueldos y Salarios
  salario_diario numeric(18,2) default 0,
  salario_diario_integrado numeric(18,2) default 0,
  forma_pago text default 'transferencia',
  banco text,
  cuenta_bancaria text,
  clabe_interbancaria text,
  email text,
  telefono text,
  activo boolean default true,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(empresa_id, rfc)
);

create index if not exists idx_empleados_empresa on public.empleados(empresa_id);
create index if not exists idx_empleados_activo on public.empleados(activo);

-- ════════════════════════════════════════════════════════════
-- 11. PERIODOS DE NÓMINA
-- ════════════════════════════════════════════════════════════
create table if not exists public.periodos_nomina (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero text not null,              -- ej. 2026-Q21
  tipo text not null check (tipo in ('semanal','quincenal','mensual','catorcenal','decenal')),
  fecha_inicio date not null,
  fecha_fin date not null,
  fecha_pago date not null,
  total_empleados int default 0,
  total_percepciones numeric(18,2) default 0,
  total_deducciones numeric(18,2) default 0,
  total_neto numeric(18,2) default 0,
  estado text default 'borrador' check (estado in ('borrador','calculado','timbrado','pagado','cancelado')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(empresa_id, numero)
);

create index if not exists idx_periodos_empresa on public.periodos_nomina(empresa_id);

-- ════════════════════════════════════════════════════════════
-- 12. RECIBOS DE NÓMINA (uno por empleado por periodo)
-- ════════════════════════════════════════════════════════════
create table if not exists public.recibos_nomina (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.periodos_nomina(id) on delete cascade,
  empleado_id uuid not null references public.empleados(id),
  dias_pagados numeric(5,2) default 0,
  percepciones jsonb default '[]'::jsonb,
  deducciones jsonb default '[]'::jsonb,
  total_percepciones numeric(18,2) default 0,
  total_deducciones numeric(18,2) default 0,
  total_neto numeric(18,2) default 0,
  cfdi_id uuid references public.cfdis(id),
  estado text default 'pendiente',
  created_at timestamptz default now() not null,
  unique(periodo_id, empleado_id)
);

create index if not exists idx_recibos_periodo on public.recibos_nomina(periodo_id);
create index if not exists idx_recibos_empleado on public.recibos_nomina(empleado_id);

-- ════════════════════════════════════════════════════════════
-- 13. DECLARACIONES FISCALES
-- ════════════════════════════════════════════════════════════
create table if not exists public.declaraciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null,             -- IVA, ISR, DIOT, ANUAL, NOMINA
  periodicidad text not null,     -- mensual, bimestral, anual
  anio int not null,
  mes int,                        -- null si es anual
  fecha_presentacion timestamptz,
  fecha_limite date,
  estado text default 'pendiente' check (estado in ('pendiente','presentada','pagada','vencida','en_revision')),
  monto_a_pagar numeric(18,2) default 0,
  monto_pagado numeric(18,2) default 0,
  acuse_url text,
  notas text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_declaraciones_empresa on public.declaraciones(empresa_id);
create index if not exists idx_declaraciones_fecha on public.declaraciones(fecha_limite);

-- ════════════════════════════════════════════════════════════
-- 14. EFOS / EDOS (lista 69-B del SAT)
-- ════════════════════════════════════════════════════════════
create table if not exists public.efos_blacklist (
  id uuid primary key default gen_random_uuid(),
  rfc text not null unique,
  razon_social text,
  situacion text not null check (situacion in ('definitivo','presunto','desvirtuado','sentencia_favorable')),
  fecha_publicacion date,
  fecha_oficio_global date,
  numero_oficio text,
  publicacion_dof text,
  url_fuente text,
  updated_at timestamptz default now() not null
);

create index if not exists idx_efos_rfc on public.efos_blacklist(rfc);
create index if not exists idx_efos_situacion on public.efos_blacklist(situacion);

-- ════════════════════════════════════════════════════════════
-- 15. INDICADORES ECONÓMICOS (USD, INPC, UDI, TIIE)
-- ════════════════════════════════════════════════════════════
create table if not exists public.indicadores_economicos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  tipo_cambio_usd numeric(10,4),
  inpc numeric(10,4),
  udi numeric(10,6),
  tiie_28 numeric(8,4),
  tiie_91 numeric(8,4),
  cetes_28 numeric(8,4),
  fuente text default 'banxico',
  created_at timestamptz default now() not null,
  unique(fecha)
);

create index if not exists idx_indicadores_fecha on public.indicadores_economicos(fecha desc);

-- ════════════════════════════════════════════════════════════
-- 16. UPLOADS METADATA (archivos subidos por el usuario)
-- ════════════════════════════════════════════════════════════
create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  storage_path text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  categoria text,                 -- cfdi_xml, pdf_factura, soporte_materialidad, identificacion, etc.
  cfdi_id uuid references public.cfdis(id) on delete set null,
  poliza_id uuid references public.polizas(id) on delete set null,
  notas text,
  created_at timestamptz default now() not null
);

create index if not exists idx_uploads_empresa on public.uploads(empresa_id);
create index if not exists idx_uploads_categoria on public.uploads(categoria);

-- ════════════════════════════════════════════════════════════
-- 17. NOTICIAS FISCALES (cacheadas)
-- ════════════════════════════════════════════════════════════
create table if not exists public.noticias (
  id uuid primary key default gen_random_uuid(),
  fecha_publicacion date not null,
  fuente text not null,            -- SAT, Banxico, DOF, IMSS, etc.
  categoria text,                  -- fiscal, monetario, laboral, legal
  titulo text not null,
  resumen text,
  url_oficial text,
  emoji text,
  visible boolean default true,
  created_at timestamptz default now() not null
);

create index if not exists idx_noticias_fecha on public.noticias(fecha_publicacion desc);

-- ════════════════════════════════════════════════════════════
-- 18. LOGS DE ACTIVIDAD (auditoría)
-- ════════════════════════════════════════════════════════════
create table if not exists public.actividad_log (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete cascade,
  user_id uuid references public.profiles(id),
  accion text not null,             -- ej: cfdi.crear, poliza.eliminar
  entidad text,                     -- tabla afectada
  entidad_id uuid,                  -- id del registro afectado
  detalles jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz default now() not null
);

create index if not exists idx_actividad_empresa on public.actividad_log(empresa_id);
create index if not exists idx_actividad_fecha on public.actividad_log(created_at desc);

-- ════════════════════════════════════════════════════════════
-- ⏰ TRIGGER: updated_at automático en todas las tablas
-- ════════════════════════════════════════════════════════════
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema='public' and column_name='updated_at'
  loop
    execute format(
      'drop trigger if exists trg_updated_at on public.%I;
       create trigger trg_updated_at before update on public.%I
       for each row execute function public.set_updated_at();',
       t, t);
  end loop;
end$$;

-- ════════════════════════════════════════════════════════════
-- 🛡 ROW LEVEL SECURITY (multi-tenant)
-- Helper: ¿el usuario actual pertenece a esta empresa?
-- ════════════════════════════════════════════════════════════
create or replace function public.user_has_access_to_empresa(p_empresa_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.empresas e where e.id = p_empresa_id and e.owner_id = auth.uid()
    union
    select 1 from public.miembros_empresa m where m.empresa_id = p_empresa_id and m.user_id = auth.uid()
  );
$$;

-- Activar RLS en todas las tablas
alter table public.profiles enable row level security;
alter table public.empresas enable row level security;
alter table public.miembros_empresa enable row level security;
alter table public.catalogo_cuentas enable row level security;
alter table public.contactos enable row level security;
alter table public.cfdis enable row level security;
alter table public.cfdi_conceptos enable row level security;
alter table public.polizas enable row level security;
alter table public.asientos enable row level security;
alter table public.empleados enable row level security;
alter table public.periodos_nomina enable row level security;
alter table public.recibos_nomina enable row level security;
alter table public.declaraciones enable row level security;
alter table public.uploads enable row level security;
alter table public.actividad_log enable row level security;
alter table public.efos_blacklist enable row level security;
alter table public.indicadores_economicos enable row level security;
alter table public.noticias enable row level security;

-- PROFILES: solo el propio usuario
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- EMPRESAS: owner o miembro
drop policy if exists empresas_access on public.empresas;
create policy empresas_access on public.empresas
  for all using (
    owner_id = auth.uid() or
    exists (select 1 from public.miembros_empresa m where m.empresa_id = id and m.user_id = auth.uid())
  ) with check (owner_id = auth.uid());

-- MIEMBROS: solo si tienes acceso a la empresa
drop policy if exists miembros_access on public.miembros_empresa;
create policy miembros_access on public.miembros_empresa
  for all using (public.user_has_access_to_empresa(empresa_id));

-- Policy genérica para todas las tablas con empresa_id
do $$
declare t text;
begin
  for t in values
    ('catalogo_cuentas'),('contactos'),('cfdis'),('polizas'),
    ('empleados'),('periodos_nomina'),('declaraciones'),
    ('uploads'),('actividad_log')
  loop
    execute format(
      'drop policy if exists %I_access on public.%I;
       create policy %I_access on public.%I
       for all using (public.user_has_access_to_empresa(empresa_id))
       with check (public.user_has_access_to_empresa(empresa_id));',
       t, t, t, t);
  end loop;
end$$;

-- Tablas hijas (verifican empresa vía padre)
drop policy if exists conceptos_access on public.cfdi_conceptos;
create policy conceptos_access on public.cfdi_conceptos
  for all using (exists (select 1 from public.cfdis c where c.id = cfdi_id and public.user_has_access_to_empresa(c.empresa_id)));

drop policy if exists asientos_access on public.asientos;
create policy asientos_access on public.asientos
  for all using (exists (select 1 from public.polizas p where p.id = poliza_id and public.user_has_access_to_empresa(p.empresa_id)));

drop policy if exists recibos_access on public.recibos_nomina;
create policy recibos_access on public.recibos_nomina
  for all using (exists (select 1 from public.periodos_nomina pn where pn.id = periodo_id and public.user_has_access_to_empresa(pn.empresa_id)));

-- TABLAS PÚBLICAS (lectura para todo usuario autenticado)
drop policy if exists efos_read on public.efos_blacklist;
create policy efos_read on public.efos_blacklist
  for select using (auth.role() = 'authenticated');

drop policy if exists indicadores_read on public.indicadores_economicos;
create policy indicadores_read on public.indicadores_economicos
  for select using (auth.role() = 'authenticated');

drop policy if exists noticias_read on public.noticias;
create policy noticias_read on public.noticias
  for select using (visible = true);

-- ════════════════════════════════════════════════════════════
-- 📦 STORAGE BUCKETS (crear desde el dashboard también: Storage > New bucket)
-- ════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- RLS para Storage: usuario solo accede a archivos dentro de carpetas {empresa_id}/...
drop policy if exists "uploads_read" on storage.objects;
create policy "uploads_read" on storage.objects for select
  using (
    bucket_id = 'uploads' and
    public.user_has_access_to_empresa((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "uploads_insert" on storage.objects;
create policy "uploads_insert" on storage.objects for insert
  with check (
    bucket_id = 'uploads' and
    public.user_has_access_to_empresa((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "uploads_update" on storage.objects;
create policy "uploads_update" on storage.objects for update
  using (
    bucket_id = 'uploads' and
    public.user_has_access_to_empresa((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "uploads_delete" on storage.objects;
create policy "uploads_delete" on storage.objects for delete
  using (
    bucket_id = 'uploads' and
    public.user_has_access_to_empresa((storage.foldername(name))[1]::uuid)
  );

-- Avatares y logos: lectura pública, escritura del propio usuario
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select
  using (bucket_id in ('avatars','logos'));

drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects for insert
  with check (bucket_id in ('avatars','logos') and (storage.foldername(name))[1] = auth.uid()::text);

-- ✅ FIN DEL ESQUEMA BASE
-- Ejecuta este archivo en Supabase SQL Editor. Verifica en Table Editor
-- que todas las tablas se crearon. Luego en Authentication > Providers
-- confirma que "Email" está habilitado.
-- ════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- AJUSTES DE CONTRIX WEB FINAL
-- ════════════════════════════════════════════════════════════
-- ────────────────────────────────────────────────────────────
-- 1. Quitar datos de muestra que NO son reales
--    (XAXX010101AAA es el RFC genérico "público en general";
--     marcarlo como EFOS marcaría como riesgo cualquier factura
--     a público en general).
-- ────────────────────────────────────────────────────────────
delete from public.efos_blacklist
 where rfc in ('XAXX010101AAA','XEXX010101BBB')
   and razon_social like 'EJEMPLO EFOS%';

delete from public.indicadores_economicos
 where tipo_cambio_usd in (17.24,17.28,17.31)
   and inpc in (132.60,132.58,132.55);

-- ────────────────────────────────────────────────────────────
-- 2. Corrección de la política de EMPRESAS
--    En el esquema original "m.empresa_id = id" comparaba contra
--    miembros_empresa.id, por lo que los miembros invitados
--    nunca veían la empresa.
-- ────────────────────────────────────────────────────────────
drop policy if exists empresas_access on public.empresas;
create policy empresas_access on public.empresas
  for all using (
    owner_id = auth.uid() or
    exists (select 1 from public.miembros_empresa m
             where m.empresa_id = empresas.id and m.user_id = auth.uid())
  ) with check (owner_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 3. Suscripción (Stripe) y rol de administrador en PROFILES
-- ────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists subscription_status text default 'trialing';
alter table public.profiles add column if not exists current_period_end timestamptz;

-- Un usuario NO puede cambiarse a sí mismo el plan, el estado de pago
-- ni hacerse admin. Solo el webhook de Stripe (service_role) o tú
-- desde el SQL Editor pueden hacerlo.
create or replace function public.proteger_campos_facturacion()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.plan                   := old.plan;
    new.is_admin               := old.is_admin;
    new.stripe_customer_id     := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.subscription_status    := old.subscription_status;
    new.current_period_end     := old.current_period_end;
    new.trial_ends_at          := old.trial_ends_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_facturacion on public.profiles;
create trigger trg_proteger_facturacion before update on public.profiles
  for each row execute function public.proteger_campos_facturacion();

-- ────────────────────────────────────────────────────────────
-- 4. Límite de empresas por plan (según ARQUITECTURA.md)
--    PYMES: 1 · Empresarial: 3 · Corporativo: ilimitadas
-- ────────────────────────────────────────────────────────────
create or replace function public.validar_limite_empresas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plan text; v_total int; v_max int;
begin
  select plan into v_plan from public.profiles where id = new.owner_id;
  select count(*) into v_total from public.empresas where owner_id = new.owner_id;
  v_max := case v_plan when 'pymes' then 1 when 'empresarial' then 3 else null end;
  if v_max is not null and v_total >= v_max then
    raise exception 'Tu plan % permite % empresa(s). Cambia de plan para agregar más.', v_plan, v_max;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limite_empresas on public.empresas;
create trigger trg_limite_empresas before insert on public.empresas
  for each row execute function public.validar_limite_empresas();

-- ────────────────────────────────────────────────────────────
-- 5. CFDIs: borradores, versión y resultado de validación
-- ────────────────────────────────────────────────────────────
alter table public.cfdis drop constraint if exists cfdis_estado_check;
alter table public.cfdis add constraint cfdis_estado_check
  check (estado in ('vigente','cancelado','en_proceso_cancelacion','borrador'));

alter table public.cfdis add column if not exists version text;
alter table public.cfdis add column if not exists errores jsonb default '[]'::jsonb;
alter table public.cfdis add column if not exists exportacion text;
alter table public.cfdis add column if not exists sello_ultimos8 text;  -- para la liga de verificación del SAT

-- ────────────────────────────────────────────────────────────
-- 6. Documentos relacionados de complementos de pago (Pagos 2.0)
--    Permite saber qué facturas PPD siguen sin complemento.
-- ────────────────────────────────────────────────────────────
create table if not exists public.cfdi_pagos_doctos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cfdi_pago_id uuid not null references public.cfdis(id) on delete cascade,
  uuid_relacionado text not null,
  fecha_pago timestamptz,
  num_parcialidad int,
  imp_saldo_ant numeric(18,2),
  imp_pagado numeric(18,2),
  imp_saldo_insoluto numeric(18,2),
  moneda text,
  created_at timestamptz default now() not null
);
create index if not exists idx_pagos_doctos_empresa on public.cfdi_pagos_doctos(empresa_id);
create index if not exists idx_pagos_doctos_uuid on public.cfdi_pagos_doctos(uuid_relacionado);

alter table public.cfdi_pagos_doctos enable row level security;
drop policy if exists pagos_doctos_access on public.cfdi_pagos_doctos;
create policy pagos_doctos_access on public.cfdi_pagos_doctos
  for all using (public.user_has_access_to_empresa(empresa_id))
  with check (public.user_has_access_to_empresa(empresa_id));

-- ────────────────────────────────────────────────────────────
-- 7. Escritura de tablas globales solo para administradores
--    (lista 69-B del SAT, indicadores y noticias)
-- ────────────────────────────────────────────────────────────
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists efos_admin_write on public.efos_blacklist;
create policy efos_admin_write on public.efos_blacklist
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists indicadores_admin_write on public.indicadores_economicos;
create policy indicadores_admin_write on public.indicadores_economicos
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists noticias_admin_write on public.noticias;
create policy noticias_admin_write on public.noticias
  for all using (public.es_admin()) with check (public.es_admin());

-- ────────────────────────────────────────────────────────────
-- 8. Invitar colaboradores a una empresa (Portal Contador)
--    El invitado debe tener cuenta en Contrix.
--    Límite de usuarios por plan: PYMES 2 · Empresarial 10 · Corporativo ilimitados
-- ────────────────────────────────────────────────────────────
create or replace function public.invitar_miembro(p_empresa uuid, p_email text, p_rol text default 'colaborador')
returns text language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_plan text; v_user uuid; v_total int; v_max int;
begin
  select owner_id into v_owner from public.empresas where id = p_empresa;
  if v_owner is null then raise exception 'Empresa no encontrada'; end if;
  if v_owner <> auth.uid() and not exists (
       select 1 from public.miembros_empresa
        where empresa_id = p_empresa and user_id = auth.uid() and rol = 'admin') then
    raise exception 'Solo el dueño o un admin de la empresa puede invitar';
  end if;
  if p_rol not in ('admin','contador','colaborador','solo_lectura') then
    raise exception 'Rol no válido';
  end if;
  select plan into v_plan from public.profiles where id = v_owner;
  select count(*) + 1 into v_total from public.miembros_empresa where empresa_id = p_empresa;
  v_max := case v_plan when 'pymes' then 2 when 'empresarial' then 10 else null end;
  if v_max is not null and v_total >= v_max then
    raise exception 'Tu plan % permite % usuario(s) por empresa', v_plan, v_max;
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No existe una cuenta Contrix con ese correo. Pídele que se registre primero.';
  end if;
  insert into public.miembros_empresa (empresa_id, user_id, rol, invitado_por)
  values (p_empresa, v_user, p_rol, auth.uid())
  on conflict (empresa_id, user_id) do update set rol = excluded.rol;
  return 'ok';
end;
$$;

grant execute on function public.invitar_miembro(uuid, text, text) to authenticated;

-- Lista de colaboradores de una empresa con su correo
-- (profiles solo deja ver tu propio perfil, por eso se expone así)
create or replace function public.miembros_de_empresa(p_empresa uuid)
returns table(user_id uuid, email text, nombre text, rol text, es_dueno boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.user_has_access_to_empresa(p_empresa) then
    raise exception 'Sin acceso a esta empresa';
  end if;
  return query
    select p.id, p.email, p.nombre, coalesce(m.rol, 'admin'), (e.owner_id = p.id)
      from public.empresas e
      join public.profiles p on p.id = e.owner_id or p.id in (select mm.user_id from public.miembros_empresa mm where mm.empresa_id = e.id)
      left join public.miembros_empresa m on m.empresa_id = e.id and m.user_id = p.id
     where e.id = p_empresa;
end;
$$;

grant execute on function public.miembros_de_empresa(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 9. Hazte administrador (cambia el correo por el tuyo y ejecuta
--    esta línea por separado después de registrarte en la web):
-- update public.profiles set is_admin = true where email = 'TU_CORREO@ejemplo.com';
-- ────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════
-- 10. Perfiles para los usuarios que ya existían en Authentication
-- ════════════════════════════════════════════════════════════
insert into public.profiles (id, email, nombre)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'nombre', split_part(u.email, '@', 1))
  from auth.users u
 where u.email is not null
on conflict (id) do nothing;

-- Recarga el caché de la API para que vea las columnas nuevas
notify pgrst, 'reload schema';

-- ✅ Listo. Vuelve a Contrix y recarga la página (Ctrl + F5).
