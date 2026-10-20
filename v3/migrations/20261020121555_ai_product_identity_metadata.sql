-- AI may propose a product; identity must also hold at the database boundary.
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists manufacturer_code text;

