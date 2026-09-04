-- AVH — Control documental Presupuesto -> OC -> Factura -> Recibido.
-- Guarda solo resultados estructurados de análisis. No modifica stock ni FIFO.

alter table public.purchase_documents
  add column if not exists analysis_status text,
  add column if not exists analysis_data jsonb,
  add column if not exists analysis_model text,
  add column if not exists analysis_confidence numeric,
  add column if not exists analyzed_at timestamptz,
  add column if not exists analysis_error text;

alter table public.purchase_documents drop constraint if exists purchase_documents_analysis_status_check;
alter table public.purchase_documents
  add constraint purchase_documents_analysis_status_check
  check (analysis_status is null or analysis_status in ('ok','error'));

alter table public.purchase_documents drop constraint if exists purchase_documents_analysis_confidence_check;
alter table public.purchase_documents
  add constraint purchase_documents_analysis_confidence_check
  check (analysis_confidence is null or (analysis_confidence>=0 and analysis_confidence<=1));

create index if not exists purchase_documents_analysis_idx
  on public.purchase_documents(purchase_id,kind,analyzed_at desc)
  where analysis_status is not null;
