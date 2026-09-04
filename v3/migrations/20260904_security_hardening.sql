-- AVH — Endurecimiento de permisos operativos.
-- Escrituras sensibles quedan detrás de RPCs con validación de rol y depósito.

revoke all privileges on table public.movements from anon;
revoke all privileges on table public.movement_lines from anon;
revoke all privileges on table public.inventory_batches from anon;
revoke all privileges on table public.batch_allocations from anon;
revoke all privileges on table public.purchases from anon;
revoke all privileges on table public.purchase_items from anon;
revoke all privileges on table public.purchase_receipts from anon;
revoke all privileges on table public.purchase_documents from anon;
revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.warehouse_opening_inventory from anon;
revoke all privileges on table public.supply_requests from anon;
revoke all privileges on table public.correction_requests from anon;

revoke insert, update, delete, truncate, references, trigger
on table public.movements,
         public.movement_lines,
         public.inventory_batches,
         public.batch_allocations,
         public.purchases,
         public.purchase_items,
         public.purchase_receipts,
         public.profiles,
         public.warehouse_opening_inventory,
         public.supply_requests,
         public.correction_requests
from authenticated;

grant select
on table public.movements,
         public.movement_lines,
         public.inventory_batches,
         public.batch_allocations,
         public.purchases,
         public.purchase_items,
         public.purchase_receipts,
         public.profiles,
         public.warehouse_opening_inventory,
         public.supply_requests,
         public.correction_requests
to authenticated;

-- Los presupuestos se adjuntan desde frontend; la RLS permite insertar solo al admin.
revoke update, delete, truncate, references, trigger
on table public.purchase_documents
from authenticated;
grant select, insert on table public.purchase_documents to authenticated;

alter table public.movements enable row level security;
alter table public.movement_lines enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.batch_allocations enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_documents enable row level security;
alter table public.profiles enable row level security;
alter table public.warehouse_opening_inventory enable row level security;
alter table public.supply_requests enable row level security;
alter table public.correction_requests enable row level security;
