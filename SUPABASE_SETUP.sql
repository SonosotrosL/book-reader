-- ============================================================================
-- CONFIGURAÇÃO SEGURA DO SUPABASE — ESTANTE PRIVADA COM MEMBROS
-- Cole no "SQL Editor" do seu projeto Supabase e clique em "Run".
-- Pode ser executado de novo sem problemas (idempotente).
--
-- O que este script garante:
--   * O bucket "books" é PRIVADO: ninguém sem login lista ou baixa seus livros.
--   * Só e-mails cadastrados em public.library_members acessam a estante.
--   * Papéis:
--       owner        → tudo (subir, apagar, gerenciar membros)
--       member       → subir e apagar livros
--       contributor  → ler + sugerir livros na fila _inbox/ (dono aprova)
--       viewer       → somente ler e salvar o PRÓPRIO progresso
--   * Cada pessoa só grava o próprio progresso (_users/<email>_sync_state.json
--     e a linha <estante>__u__<email> em reader_profiles).
--
-- Convidados agora precisam ENTRAR com o e-mail que você cadastrou como membro.
-- ============================================================================

-- 1. Bucket privado ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('books', 'books', false)
on conflict (id) do update set public = false;

-- 2. Tabela de membros -----------------------------------------------------------
create table if not exists public.library_members (
  email text primary key,
  role text not null default 'viewer',
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.library_members add column if not exists status text not null default 'active';
alter table public.library_members add column if not exists created_at timestamptz not null default now();
alter table public.library_members drop constraint if exists library_members_role_check;
alter table public.library_members add constraint library_members_role_check
  check (role in ('owner', 'member', 'contributor', 'viewer'));
alter table public.library_members enable row level security;

-- Funções auxiliares (security definer evita recursão nas políticas)
create or replace function public.library_role()
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.library_members m
  where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(m.status, 'active') = 'active'
  limit 1
$$;

create or replace function public.library_user_slug()
returns text language sql stable as $$
  select regexp_replace(lower(coalesce(auth.jwt() ->> 'email', '')), '[^a-z0-9._-]', '_', 'g')
$$;

-- Você (owner). Troque/adicione e-mails aqui ou pelo painel "Gerenciar Membros" do app.
insert into public.library_members (email, role) values
  ('seu_email_dono@exemplo.com', 'owner')
on conflict (email) do update set role = excluded.role;

drop policy if exists "Ler membros autenticados" on public.library_members;
drop policy if exists "Dono adiciona membros" on public.library_members;
drop policy if exists "Dono atualiza membros" on public.library_members;
drop policy if exists "Dono remove membros" on public.library_members;
drop policy if exists "Membros: ver o proprio papel ou todos se dono" on public.library_members;
drop policy if exists "Membros: dono gerencia" on public.library_members;

create policy "Membros: ver o proprio papel ou todos se dono" on public.library_members
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.library_role() = 'owner');

create policy "Membros: dono gerencia" on public.library_members
  for all to authenticated
  using (public.library_role() = 'owner')
  with check (public.library_role() = 'owner');

-- 3. Políticas do Storage ----------------------------------------------------------
-- Remove todas as políticas antigas (inclusive as abertas "Plug & Play")
drop policy if exists "Permitir leitura de livros na estante" on storage.objects;
drop policy if exists "Permitir upload de livros e progresso" on storage.objects;
drop policy if exists "Permitir atualizacao de progresso e livros" on storage.objects;
drop policy if exists "Permitir exclusao de livros da estante" on storage.objects;
drop policy if exists "Leitura de livros na estante" on storage.objects;
drop policy if exists "Upload dono/membro ou progresso proprio" on storage.objects;
drop policy if exists "Atualizacao dono/membro ou progresso proprio" on storage.objects;
drop policy if exists "Exclusao dono ou membro completo" on storage.objects;
drop policy if exists "Books: membros leem" on storage.objects;
drop policy if exists "Books: upload por papel" on storage.objects;
drop policy if exists "Books: atualizacao por papel" on storage.objects;
drop policy if exists "Books: exclusao dono ou membro" on storage.objects;

create policy "Books: membros leem" on storage.objects
  for select to authenticated
  using (bucket_id = 'books' and public.library_role() is not null);

create policy "Books: upload por papel" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'books' and (
      public.library_role() in ('owner', 'member')
      or (public.library_role() is not null
          and split_part(name, '/_users/', 2) = public.library_user_slug() || '_sync_state.json')
      or (public.library_role() is not null
          and split_part(name, '/', 2) in ('_shared_profiles.json', '_shared_activity.json', '_shared_chat.json'))
      or (public.library_role() = 'contributor' and name like '%/\_inbox/%')
    )
  );

create policy "Books: atualizacao por papel" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'books' and (
      public.library_role() in ('owner', 'member')
      or (public.library_role() is not null
          and split_part(name, '/_users/', 2) = public.library_user_slug() || '_sync_state.json')
      or (public.library_role() is not null
          and split_part(name, '/', 2) in ('_shared_profiles.json', '_shared_activity.json', '_shared_chat.json'))
    )
  );

create policy "Books: exclusao dono ou membro" on storage.objects
  for delete to authenticated
  using (bucket_id = 'books' and public.library_role() in ('owner', 'member'));

-- 4. Progresso, notas, Anki e metas (Postgres) ---------------------------------------
create table if not exists public.reader_profiles (
  sync_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.reader_profiles enable row level security;

drop policy if exists "Permitir leitura publica reader_profiles" on public.reader_profiles;
drop policy if exists "Permitir escrita publica reader_profiles" on public.reader_profiles;
drop policy if exists "Permitir atualizacao publica reader_profiles" on public.reader_profiles;
drop policy if exists "Perfis: proprio usuario ou dono/membro" on public.reader_profiles;

-- Cada um lê/grava só a própria linha (<estante>__u__<email>); dono e membros
-- também acessam a linha compartilhada da estante.
create policy "Perfis: proprio usuario ou dono/membro" on public.reader_profiles
  for all to authenticated
  using (
    split_part(sync_key, '__u__', 2) = public.library_user_slug()
    or public.library_role() in ('owner', 'member')
  )
  with check (
    split_part(sync_key, '__u__', 2) = public.library_user_slug()
    or public.library_role() in ('owner', 'member')
  );
