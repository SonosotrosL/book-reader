-- ============================================================================
-- CONFIGURAÇÃO COMPLETA DO SUPABASE PARA A ESTANTE E BANCO DE DADOS NA NUVEM
-- Cole no "SQL Editor" do seu projeto Supabase e clique em "Run".
-- ============================================================================

-- 1. Criar o bucket "books" público para salvar seus livros (.epub, .mobi, .pdf, etc.)
insert into storage.buckets (id, name, public)
values ('books', 'books', true)
on conflict (id) do update set public = true;

-- 2. Políticas padrão abertas (Plug & Play sem exigir login)
drop policy if exists "Permitir leitura de livros na estante" on storage.objects;
create policy "Permitir leitura de livros na estante"
on storage.objects for select
using ( bucket_id = 'books' );

drop policy if exists "Permitir upload de livros e progresso" on storage.objects;
create policy "Permitir upload de livros e progresso"
on storage.objects for insert
with check ( bucket_id = 'books' );

drop policy if exists "Permitir atualizacao de progresso e livros" on storage.objects;
create policy "Permitir atualizacao de progresso e livros"
on storage.objects for update
using ( bucket_id = 'books' );

drop policy if exists "Permitir exclusao de livros da estante" on storage.objects;
create policy "Permitir exclusao de livros da estante"
on storage.objects for delete
using ( bucket_id = 'books' );

-- 3. Tabela Postgres para guardar progresso, notas, resenhas, Anki e metas
create table if not exists public.reader_profiles (
  sync_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.reader_profiles enable row level security;

drop policy if exists "Permitir leitura publica reader_profiles" on public.reader_profiles;
create policy "Permitir leitura publica reader_profiles"
on public.reader_profiles for select
using (true);

drop policy if exists "Permitir escrita publica reader_profiles" on public.reader_profiles;
create policy "Permitir escrita publica reader_profiles"
on public.reader_profiles for insert
with check (true);

drop policy if exists "Permitir atualizacao publica reader_profiles" on public.reader_profiles;
create policy "Permitir atualizacao publica reader_profiles"
on public.reader_profiles for update
using (true);

-- ============================================================================
-- 4. OPCIONAL: MODO PROTEGIDO COM MEMBROS COMPLETOS (AUTONOMIA PARA CONVIDADOS)
-- Para ativar: descomente o bloco abaixo, coloque seu e-mail em 'owner' e os
-- e-mails de confiança em 'member' (eles terão autonomia total de subir e
-- gerenciar livros; outros usuários continuam lendo tudo e salvando só o
-- próprio progresso em _users/... ou sugerindo para _inbox/).
-- ============================================================================
/*
create table if not exists public.library_members (
  email text primary key,
  role text not null default 'member' check (role in ('owner', 'member'))
);
alter table public.library_members enable row level security;
drop policy if exists "Ler membros autenticados" on public.library_members;
create policy "Ler membros autenticados" on public.library_members for select using (auth.role() = 'authenticated');
drop policy if exists "Dono adiciona membros" on public.library_members;
create policy "Dono adiciona membros" on public.library_members for insert with check (
  exists (select 1 from public.library_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and m.role = 'owner')
);
drop policy if exists "Dono atualiza membros" on public.library_members;
create policy "Dono atualiza membros" on public.library_members for update using (
  exists (select 1 from public.library_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and m.role = 'owner')
);
drop policy if exists "Dono remove membros" on public.library_members;
create policy "Dono remove membros" on public.library_members for delete using (
  exists (select 1 from public.library_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and m.role = 'owner')
);

-- Adicione você (owner) e seus membros completos de confiança:
insert into public.library_members (email, role) values
  ('seu_email_dono@exemplo.com', 'owner')
  -- , ('amigo_membro@exemplo.com', 'member')
on conflict (email) do update set role = excluded.role;

drop policy if exists "Permitir leitura de livros na estante" on storage.objects;
drop policy if exists "Permitir upload de livros e progresso" on storage.objects;
drop policy if exists "Permitir atualizacao de progresso e livros" on storage.objects;
drop policy if exists "Permitir exclusao de livros da estante" on storage.objects;
drop policy if exists "Leitura de livros na estante" on storage.objects;
drop policy if exists "Upload dono/membro ou progresso proprio" on storage.objects;
drop policy if exists "Atualizacao dono/membro ou progresso proprio" on storage.objects;
drop policy if exists "Exclusao dono ou membro completo" on storage.objects;

create policy "Leitura de livros na estante" on storage.objects for select using ( bucket_id = 'books' );

create policy "Upload dono/membro ou progresso proprio" on storage.objects for insert with check (
  bucket_id = 'books' and auth.role() = 'authenticated' and (
    exists (select 1 from public.library_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    or name like '%/_users/' || regexp_replace(lower(coalesce(auth.jwt() ->> 'email', '')), '[^a-z0-9._-]', '_', 'g') || '_sync_state.json'
    or name like '%/_inbox/%'
  )
);

create policy "Atualizacao dono/membro ou progresso proprio" on storage.objects for update using (
  bucket_id = 'books' and auth.role() = 'authenticated' and (
    exists (select 1 from public.library_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    or name like '%/_users/' || regexp_replace(lower(coalesce(auth.jwt() ->> 'email', '')), '[^a-z0-9._-]', '_', 'g') || '_sync_state.json'
  )
);

create policy "Exclusao dono ou membro completo" on storage.objects for delete using (
  bucket_id = 'books' and auth.role() = 'authenticated'
  and exists (select 1 from public.library_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
);
*/
