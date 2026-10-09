-- Schema-only fixture from the audited AVH database (2026-10-08). No production records.
create role authenticated; create role anon; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;
create table public."admin_recovery_tokens" (
 "id" uuid default gen_random_uuid() not null,
 "username" text not null,
 "token_hash" text not null,
 "expires_at" timestamptz not null,
 "used_at" timestamptz,
 "created_at" timestamptz default now() not null
);
create table public."audit_events" (
 "id" uuid default gen_random_uuid() not null,
 "entity_type" text not null,
 "entity_id" uuid,
 "action" text not null,
 "actor_id" uuid,
 "warehouse_id" uuid,
 "movement_id" uuid,
 "detail" jsonb default '{}'::jsonb not null,
 "created_at" timestamptz default now() not null,
 "purchase_id" uuid
);
create table public."barges" (
 "id" uuid default gen_random_uuid() not null,
 "number" integer not null,
 "name" text generated always as ('Barcaza '||number::text) stored,
 "active" boolean default true not null
);
create table public."batch_allocations" (
 "id" uuid default gen_random_uuid() not null,
 "movement_line_id" uuid not null,
 "batch_id" uuid not null,
 "quantity" numeric(18,6) not null,
 "unit_cost" numeric(18,6),
 "currency" text,
 "exchange_rate" numeric(18,6),
 "created_at" timestamptz default now() not null
);
create table public."bi_purchase_facts" (
 "purchase_id" uuid,
 "ordered_date" date,
 "ordered_month" date,
 "company_id" uuid,
 "company_name" text,
 "supplier_id" uuid,
 "supplier_name" text,
 "warehouse_id" uuid,
 "warehouse_name" text,
 "barge_id" uuid,
 "barge_number" integer,
 "purchase_type" text,
 "status" text,
 "urgency" text,
 "destination_type" text,
 "destination_text" text,
 "currency" text,
 "exchange_rate" numeric(18,6),
 "payment_method" text,
 "payment_terms" text,
 "expected_date" date,
 "delivery_mode" text,
 "order_reference" text,
 "po_number" text,
 "invoice_number" text,
 "requester" text,
 "sector" text,
 "created_at" timestamptz,
 "updated_at" timestamptz,
 "item_count" integer,
 "completed_item_count" integer,
 "total_amount" numeric(18,6),
 "received_amount" numeric(18,6),
 "pending_amount" numeric(18,6),
 "value_received_pct" numeric(18,6),
 "first_received_at" timestamptz,
 "last_received_at" timestamptz,
 "receipt_count" integer,
 "is_complete_receipt" boolean,
 "is_pending_receipt" boolean,
 "days_to_first_receipt" integer,
 "days_to_complete" integer,
 "completed_on_time" boolean,
 "days_late_open" integer
);
create table public."bi_purchase_item_facts" (
 "purchase_item_id" uuid,
 "purchase_id" uuid,
 "ordered_date" date,
 "ordered_month" date,
 "company_id" uuid,
 "company_name" text,
 "supplier_id" uuid,
 "supplier_name" text,
 "warehouse_id" uuid,
 "warehouse_name" text,
 "purchase_type" text,
 "status" text,
 "urgency" text,
 "destination_type" text,
 "currency" text,
 "expected_date" date,
 "delivery_mode" text,
 "order_reference" text,
 "po_number" text,
 "product_id" uuid,
 "product_name" text,
 "base_unit" text,
 "description" text,
 "unit" text,
 "factor_to_base" numeric(18,6),
 "quantity" numeric(18,6),
 "received_qty" numeric(18,6),
 "pending_qty" numeric(18,6),
 "ordered_base_qty" numeric(18,6),
 "received_base_qty" numeric(18,6),
 "pending_base_qty" numeric(18,6),
 "unit_price" numeric(18,6),
 "unit_price_base" numeric(18,6),
 "line_total" numeric(18,6),
 "received_amount" numeric(18,6),
 "pending_amount" numeric(18,6),
 "affects_inventory" boolean,
 "created_at" timestamptz
);
create table public."bi_purchase_monthly" (
 "ordered_month" date,
 "currency" text,
 "purchase_count" integer,
 "urgent_purchase_count" integer,
 "pending_receipt_count" integer,
 "late_open_count" integer,
 "ordered_amount" numeric(18,6),
 "received_amount" numeric(18,6),
 "pending_amount" numeric(18,6)
);
create table public."bi_supplier_performance" (
 "supplier_id" uuid,
 "supplier_name" text,
 "purchase_count" integer,
 "warehouse_purchase_count" integer,
 "completed_purchase_count" integer,
 "completed_with_promise_count" integer,
 "on_time_completed_count" integer,
 "on_time_rate_pct" numeric(18,6),
 "avg_lead_time_days" numeric(18,6),
 "late_open_count" integer,
 "last_order_date" date,
 "ordered_amount_pyg" numeric(18,6),
 "ordered_amount_usd" numeric(18,6),
 "pending_amount_pyg" numeric(18,6),
 "pending_amount_usd" numeric(18,6)
);
create table public."contractors" (
 "id" uuid default gen_random_uuid() not null,
 "name" text not null,
 "active" boolean default true not null,
 "created_at" timestamptz default now() not null
);
create table public."correction_requests" (
 "id" uuid default gen_random_uuid() not null,
 "movement_id" uuid not null,
 "requested_by" uuid not null,
 "reason" text not null,
 "requested_change" jsonb,
 "status" text default 'pending'::text not null,
 "reviewed_by" uuid,
 "reviewed_at" timestamptz,
 "created_at" timestamptz default now() not null
);
create table public."documents" (
 "id" uuid default gen_random_uuid() not null,
 "supplier_id" uuid,
 "document_type" text,
 "document_number" text,
 "document_date" date,
 "currency" text,
 "exchange_rate" numeric(18,6),
 "file_path" text,
 "uploaded_by" uuid,
 "created_at" timestamptz default now() not null
);
create table public."frontend_assets" (
 "name" text not null,
 "data" text not null,
 "content_encoding" text default 'gzip-base64'::text not null,
 "updated_at" timestamptz default now() not null
);
create table public."inventory_batches" (
 "id" uuid default gen_random_uuid() not null,
 "warehouse_id" uuid not null,
 "product_id" uuid not null,
 "source_line_id" uuid not null,
 "quantity_received" numeric(18,6) not null,
 "quantity_remaining" numeric(18,6) not null,
 "unit_cost" numeric(18,6),
 "currency" text,
 "exchange_rate" numeric(18,6),
 "lot_reference" text,
 "received_at" timestamptz default now() not null,
 "created_at" timestamptz default now() not null
);
create table public."movement_lines" (
 "id" uuid default gen_random_uuid() not null,
 "movement_id" uuid not null,
 "product_id" uuid not null,
 "quantity" numeric(18,6) not null,
 "unit" text not null,
 "factor_to_base" numeric(18,6) default 1 not null,
 "base_quantity" numeric(18,6) generated always as (quantity*factor_to_base) stored,
 "entry_unit_cost" numeric(18,6),
 "entry_currency" text,
 "exchange_rate" numeric(18,6),
 "notes" text,
 "presentation_label" text
);
create table public."movements" (
 "id" uuid default gen_random_uuid() not null,
 "movement_no" bigint generated always as identity not null,
 "type" text not null,
 "status" text default 'confirmed'::text not null,
 "warehouse_from_id" uuid,
 "warehouse_to_id" uuid,
 "destination" text,
 "barge_id" uuid,
 "contractor_id" uuid,
 "person_receiving" text,
 "supplier_id" uuid,
 "document_id" uuid,
 "notes" text,
 "corrected_movement_id" uuid,
 "created_by" uuid not null,
 "created_at" timestamptz default now() not null,
 "received_by" uuid,
 "received_at" timestamptz,
 "destination_text" text,
 "opening_session_id" uuid,
 "client_request_id" uuid
);
create table public."notifications" (
 "id" uuid default gen_random_uuid() not null,
 "user_id" uuid not null,
 "kind" text default 'info'::text not null,
 "title" text not null,
 "body" text not null,
 "metadata" jsonb,
 "read_at" timestamptz,
 "created_at" timestamptz default now() not null,
 "dedupe_key" text
);
create table public."product_deletion_requests" (
 "id" uuid default gen_random_uuid() not null,
 "product_id" uuid,
 "product_name_snapshot" text not null,
 "requested_by" uuid not null,
 "reason" text,
 "status" text default 'pending'::text not null,
 "resolution" text,
 "reviewed_by" uuid,
 "reviewed_at" timestamptz,
 "created_at" timestamptz default now() not null
);
create table public."product_presentations" (
 "id" uuid default gen_random_uuid() not null,
 "product_id" uuid not null,
 "label" text not null,
 "unit" text not null,
 "factor_to_base" numeric(18,6) not null
);
create table public."product_requests" (
 "id" uuid default gen_random_uuid() not null,
 "requested_by" uuid not null,
 "warehouse_id" uuid not null,
 "proposed_name" text not null,
 "proposed_unit" text not null,
 "notes" text,
 "status" text default 'pending'::text not null,
 "reviewed_by" uuid,
 "reviewed_at" timestamptz,
 "created_at" timestamptz default now() not null
);
create table public."products" (
 "id" uuid default gen_random_uuid() not null,
 "sku" text,
 "name" text not null,
 "base_unit" text not null,
 "active" boolean default true not null,
 "created_by" uuid,
 "created_at" timestamptz default now() not null
);
create table public."profiles" (
 "id" uuid not null,
 "username" text not null,
 "full_name" text,
 "role" text not null,
 "warehouse_id" uuid,
 "active" boolean default true not null,
 "must_change_password" boolean default false not null,
 "password_changed_at" timestamptz,
 "created_at" timestamptz default now() not null
);
create table public."purchase_companies" (
 "id" uuid default gen_random_uuid() not null,
 "name" text not null,
 "active" boolean default true not null,
 "created_at" timestamptz default now() not null,
 "legal_name" text,
 "tax_id" text,
 "address" text,
 "phone" text,
 "email" text,
 "po_prefix" text default 'OC'::text
);
create table public."purchase_documents" (
 "id" uuid default gen_random_uuid() not null,
 "purchase_id" uuid not null,
 "kind" text default 'other'::text not null,
 "file_path" text not null,
 "file_name" text,
 "uploaded_by" uuid not null,
 "created_at" timestamptz default now() not null,
 "receipt_id" uuid,
 "document_number" text,
 "document_date" date,
 "source" text default 'upload'::text not null,
 "analysis_status" text,
 "analysis_data" jsonb,
 "analysis_model" text,
 "analysis_confidence" numeric(18,6),
 "analyzed_at" timestamptz,
 "analysis_error" text
);
create table public."purchase_items" (
 "id" uuid default gen_random_uuid() not null,
 "purchase_id" uuid not null,
 "product_id" uuid,
 "description" text not null,
 "quantity" numeric(18,6) not null,
 "unit" text not null,
 "factor_to_base" numeric(18,6) default 1 not null,
 "unit_price" numeric(18,6) default 0 not null,
 "affects_inventory" boolean default false not null,
 "received_qty" numeric(18,6) default 0 not null,
 "notes" text,
 "created_at" timestamptz default now() not null
);
create table public."purchase_receipt_items" (
 "id" uuid default gen_random_uuid() not null,
 "receipt_id" uuid not null,
 "purchase_item_id" uuid not null,
 "quantity" numeric(18,6) not null
);
create table public."purchase_receipts" (
 "id" uuid default gen_random_uuid() not null,
 "purchase_id" uuid not null,
 "warehouse_id" uuid not null,
 "received_by" uuid not null,
 "movement_id" uuid,
 "document_id" uuid,
 "notes" text,
 "received_at" timestamptz default now() not null,
 "client_request_id" uuid,
 "purchase_status_before" text,
 "voided_at" timestamptz,
 "voided_by" uuid,
 "void_reason" text
);
create table public."purchases" (
 "id" uuid default gen_random_uuid() not null,
 "company_id" uuid not null,
 "supplier_id" uuid,
 "purchase_type" text default 'stock'::text not null,
 "status" text default 'ordered'::text not null,
 "urgency" text default 'normal'::text not null,
 "destination_type" text default 'warehouse'::text not null,
 "warehouse_id" uuid,
 "barge_id" uuid,
 "contractor_id" uuid,
 "destination_text" text,
 "requester" text,
 "sector" text,
 "currency" text default 'PYG'::text not null,
 "exchange_rate" numeric(18,6),
 "payment_method" text,
 "payment_terms" text,
 "order_reference" text,
 "ordered_date" date default CURRENT_DATE not null,
 "expected_date" date,
 "invoice_number" text,
 "invoice_date" date,
 "notes" text,
 "created_by" uuid not null,
 "created_at" timestamptz default now() not null,
 "updated_at" timestamptz default now() not null,
 "po_number" text,
 "po_generated_at" timestamptz,
 "purchase_confirmed_at" timestamptz,
 "source_document_number" text,
 "source_document_date" date,
 "source_document_kind" text,
 "delivery_mode" text default 'single'::text not null
);
create table public."stock_minimums" (
 "warehouse_id" uuid not null,
 "product_id" uuid not null,
 "minimum_qty" numeric(18,6) default 0 not null,
 "updated_by" uuid,
 "updated_at" timestamptz default now() not null,
 "safety_stock_qty" numeric(18,6) default 0 not null,
 "target_coverage_days" numeric(18,6) default 14 not null,
 "lead_time_days" integer default 0 not null,
 "min_order_qty" numeric(18,6) default 0 not null,
 "order_multiple_qty" numeric(18,6),
 "preferred_supplier_id" uuid,
 "criticality" text default 'normal'::text not null,
 "policy_active" boolean default true not null,
 "policy_notes" text
);
create table public."suppliers" (
 "id" uuid default gen_random_uuid() not null,
 "name" text not null,
 "tax_id" text,
 "phone" text,
 "notes" text,
 "created_by" uuid,
 "created_at" timestamptz default now() not null
);
create table public."supply_requests" (
 "id" uuid default gen_random_uuid() not null,
 "requested_by" uuid not null,
 "warehouse_id" uuid not null,
 "product_id" uuid,
 "requested_name" text not null,
 "quantity" numeric(18,6) not null,
 "unit" text not null,
 "urgency" text default 'normal'::text not null,
 "reason" text,
 "notes" text,
 "status" text default 'pending'::text not null,
 "reviewed_by" uuid,
 "reviewed_at" timestamptz,
 "resolution_notes" text,
 "created_at" timestamptz default now() not null,
 "updated_at" timestamptz default now() not null
);
create table public."warehouse_opening_inventory" (
 "id" uuid default gen_random_uuid() not null,
 "warehouse_id" uuid not null,
 "status" text default 'open'::text not null,
 "notes" text,
 "opened_by" uuid,
 "opened_at" timestamptz default now() not null,
 "closed_by" uuid,
 "closed_at" timestamptz,
 "updated_at" timestamptz default now() not null
);
create table public."warehouses" (
 "id" uuid default gen_random_uuid() not null,
 "code" text not null,
 "name" text not null,
 "active" boolean default true not null,
 "created_at" timestamptz default now() not null
);
alter table public."purchase_receipts" add constraint "purchase_receipts_pkey" PRIMARY KEY (id);
alter table public."purchase_receipt_items" add constraint "purchase_receipt_items_pkey" PRIMARY KEY (id);
alter table public."purchase_receipt_items" add constraint "purchase_receipt_items_quantity_check" CHECK ((quantity > (0)::numeric));
alter table public."warehouse_opening_inventory" add constraint "warehouse_opening_inventory_pkey" PRIMARY KEY (id);
alter table public."warehouse_opening_inventory" add constraint "warehouse_opening_inventory_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public."warehouse_opening_inventory" add constraint "warehouse_opening_inventory_warehouse_id_key" UNIQUE (warehouse_id);
alter table public."profiles" add constraint "depositor_needs_warehouse" CHECK (((role <> 'depositor'::text) OR (warehouse_id IS NOT NULL)));
alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
alter table public."profiles" add constraint "profiles_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'depositor'::text])));
alter table public."profiles" add constraint "profiles_username_key" UNIQUE (username);
alter table public."supply_requests" add constraint "supply_requests_pkey" PRIMARY KEY (id);
alter table public."supply_requests" add constraint "supply_requests_quantity_check" CHECK ((quantity > (0)::numeric));
alter table public."supply_requests" add constraint "supply_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'fulfilled'::text, 'rejected'::text])));
alter table public."supply_requests" add constraint "supply_requests_urgency_check" CHECK ((urgency = ANY (ARRAY['normal'::text, 'urgent'::text, 'critical'::text])));
alter table public."correction_requests" add constraint "correction_requests_pkey" PRIMARY KEY (id);
alter table public."correction_requests" add constraint "correction_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public."purchase_companies" add constraint "purchase_companies_name_key" UNIQUE (name);
alter table public."purchase_companies" add constraint "purchase_companies_pkey" PRIMARY KEY (id);
alter table public."movements" add constraint "movement_has_location" CHECK (((warehouse_from_id IS NOT NULL) OR (warehouse_to_id IS NOT NULL)));
alter table public."movements" add constraint "movements_movement_no_key" UNIQUE (movement_no);
alter table public."movements" add constraint "movements_pkey" PRIMARY KEY (id);
alter table public."movements" add constraint "movements_status_check" CHECK ((status = ANY (ARRAY['confirmed'::text, 'in_transit'::text, 'received'::text, 'cancelled'::text])));
alter table public."movements" add constraint "movements_type_check" CHECK ((type = ANY (ARRAY['initial'::text, 'entry'::text, 'exit'::text, 'transfer'::text, 'return'::text, 'adjustment'::text, 'correction'::text])));
alter table public."movement_lines" add constraint "movement_lines_entry_currency_check" CHECK ((entry_currency = ANY (ARRAY['PYG'::text, 'USD'::text])));
alter table public."movement_lines" add constraint "movement_lines_factor_to_base_check" CHECK ((factor_to_base > (0)::numeric));
alter table public."movement_lines" add constraint "movement_lines_pkey" PRIMARY KEY (id);
alter table public."movement_lines" add constraint "movement_lines_quantity_check" CHECK ((quantity > (0)::numeric));
alter table public."inventory_batches" add constraint "inventory_batches_currency_check" CHECK ((currency = ANY (ARRAY['PYG'::text, 'USD'::text])));
alter table public."inventory_batches" add constraint "inventory_batches_pkey" PRIMARY KEY (id);
alter table public."inventory_batches" add constraint "inventory_batches_quantity_received_check" CHECK ((quantity_received > (0)::numeric));
alter table public."inventory_batches" add constraint "inventory_batches_quantity_remaining_check" CHECK ((quantity_remaining >= (0)::numeric));
alter table public."stock_minimums" add constraint "stock_minimums_criticality_check" CHECK ((criticality = ANY (ARRAY['normal'::text, 'important'::text, 'critical'::text])));
alter table public."stock_minimums" add constraint "stock_minimums_lead_time_days_check" CHECK ((lead_time_days >= 0));
alter table public."stock_minimums" add constraint "stock_minimums_min_order_qty_check" CHECK ((min_order_qty >= (0)::numeric));
alter table public."stock_minimums" add constraint "stock_minimums_minimum_qty_check" CHECK ((minimum_qty >= (0)::numeric));
alter table public."stock_minimums" add constraint "stock_minimums_order_multiple_qty_check" CHECK (((order_multiple_qty IS NULL) OR (order_multiple_qty > (0)::numeric)));
alter table public."stock_minimums" add constraint "stock_minimums_pkey" PRIMARY KEY (warehouse_id, product_id);
alter table public."stock_minimums" add constraint "stock_minimums_safety_stock_qty_check" CHECK ((safety_stock_qty >= (0)::numeric));
alter table public."stock_minimums" add constraint "stock_minimums_target_coverage_days_check" CHECK ((target_coverage_days >= (0)::numeric));
alter table public."purchase_documents" add constraint "purchase_documents_analysis_confidence_check" CHECK (((analysis_confidence IS NULL) OR ((analysis_confidence >= (0)::numeric) AND (analysis_confidence <= (1)::numeric))));
alter table public."purchase_documents" add constraint "purchase_documents_analysis_status_check" CHECK (((analysis_status IS NULL) OR (analysis_status = ANY (ARRAY['ok'::text, 'error'::text]))));
alter table public."purchase_documents" add constraint "purchase_documents_kind_check" CHECK ((kind = ANY (ARRAY['quotation'::text, 'order'::text, 'invoice'::text, 'remittance'::text, 'payment'::text, 'other'::text])));
alter table public."purchase_documents" add constraint "purchase_documents_pkey" PRIMARY KEY (id);
alter table public."batch_allocations" add constraint "batch_allocations_currency_check" CHECK ((currency = ANY (ARRAY['PYG'::text, 'USD'::text])));
alter table public."batch_allocations" add constraint "batch_allocations_pkey" PRIMARY KEY (id);
alter table public."batch_allocations" add constraint "batch_allocations_quantity_check" CHECK ((quantity > (0)::numeric));
alter table public."purchase_items" add constraint "purchase_inventory_product_required" CHECK (((NOT affects_inventory) OR (product_id IS NOT NULL)));
alter table public."purchase_items" add constraint "purchase_items_factor_to_base_check" CHECK ((factor_to_base > (0)::numeric));
alter table public."purchase_items" add constraint "purchase_items_pkey" PRIMARY KEY (id);
alter table public."purchase_items" add constraint "purchase_items_quantity_check" CHECK ((quantity > (0)::numeric));
alter table public."purchase_items" add constraint "purchase_items_received_qty_check" CHECK ((received_qty >= (0)::numeric));
alter table public."purchase_items" add constraint "purchase_items_unit_price_check" CHECK ((unit_price >= (0)::numeric));
alter table public."purchases" add constraint "purchase_destination_warehouse" CHECK (((destination_type <> 'warehouse'::text) OR (warehouse_id IS NOT NULL)));
alter table public."purchases" add constraint "purchases_currency_check" CHECK ((currency = ANY (ARRAY['PYG'::text, 'USD'::text])));
alter table public."purchases" add constraint "purchases_delivery_mode_check" CHECK ((delivery_mode = ANY (ARRAY['single'::text, 'partial'::text])));
alter table public."purchases" add constraint "purchases_destination_type_check" CHECK ((destination_type = ANY (ARRAY['warehouse'::text, 'barge'::text, 'direct'::text, 'service'::text, 'other'::text])));
alter table public."purchases" add constraint "purchases_pkey" PRIMARY KEY (id);
alter table public."purchases" add constraint "purchases_purchase_type_check" CHECK ((purchase_type = ANY (ARRAY['stock'::text, 'direct_consumption'::text, 'service'::text, 'spare_part'::text, 'rental'::text, 'freight'::text, 'urgent'::text, 'other'::text])));
alter table public."purchases" add constraint "purchases_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'requested'::text, 'quoted'::text, 'approved'::text, 'ordered'::text, 'in_transit'::text, 'partially_received'::text, 'received'::text, 'invoiced'::text, 'closed'::text, 'cancelled'::text])));
alter table public."purchases" add constraint "purchases_urgency_check" CHECK ((urgency = ANY (ARRAY['normal'::text, 'urgent'::text, 'critical'::text])));
alter table public."warehouses" add constraint "warehouses_code_key" UNIQUE (code);
alter table public."warehouses" add constraint "warehouses_name_key" UNIQUE (name);
alter table public."warehouses" add constraint "warehouses_pkey" PRIMARY KEY (id);
alter table public."suppliers" add constraint "suppliers_name_key" UNIQUE (name);
alter table public."suppliers" add constraint "suppliers_pkey" PRIMARY KEY (id);
alter table public."contractors" add constraint "contractors_name_key" UNIQUE (name);
alter table public."contractors" add constraint "contractors_pkey" PRIMARY KEY (id);
alter table public."barges" add constraint "barges_number_check" CHECK ((number > 0));
alter table public."barges" add constraint "barges_number_key" UNIQUE (number);
alter table public."barges" add constraint "barges_pkey" PRIMARY KEY (id);
alter table public."documents" add constraint "documents_currency_check" CHECK ((currency = ANY (ARRAY['PYG'::text, 'USD'::text])));
alter table public."documents" add constraint "documents_document_type_check" CHECK ((document_type = ANY (ARRAY['factura'::text, 'remito'::text, 'otro'::text])));
alter table public."documents" add constraint "documents_pkey" PRIMARY KEY (id);
alter table public."product_requests" add constraint "product_requests_pkey" PRIMARY KEY (id);
alter table public."product_requests" add constraint "product_requests_proposed_unit_check" CHECK ((proposed_unit = ANY (ARRAY['unidad'::text, 'kg'::text, 'rollo'::text, 'caja'::text, 'metro'::text, 'cilindro'::text, 'litro'::text])));
alter table public."product_requests" add constraint "product_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public."notifications" add constraint "notifications_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_base_unit_check" CHECK ((base_unit = ANY (ARRAY['unidad'::text, 'pieza'::text, 'kg'::text, 'tonelada'::text, 'rollo'::text, 'bobina'::text, 'caja'::text, 'paquete'::text, 'bolsa'::text, 'metro'::text, 'm²'::text, 'm³'::text, 'litro'::text, 'cilindro'::text, 'tambor'::text, 'pallet'::text, 'plancha'::text, 'barra'::text, 'tubo'::text, 'perfil'::text, 'bidón'::text, 'servicio'::text, 'viaje'::text, 'hora'::text, 'día'::text, 'otro'::text])));
alter table public."products" add constraint "products_name_key" UNIQUE (name);
alter table public."products" add constraint "products_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_sku_key" UNIQUE (sku);
alter table public."product_presentations" add constraint "product_presentations_factor_to_base_check" CHECK ((factor_to_base > (0)::numeric));
alter table public."product_presentations" add constraint "product_presentations_pkey" PRIMARY KEY (id);
alter table public."product_presentations" add constraint "product_presentations_product_id_label_key" UNIQUE (product_id, label);
alter table public."product_presentations" add constraint "product_presentations_unit_check" CHECK ((unit = ANY (ARRAY['unidad'::text, 'pieza'::text, 'kg'::text, 'tonelada'::text, 'rollo'::text, 'bobina'::text, 'caja'::text, 'paquete'::text, 'bolsa'::text, 'metro'::text, 'm²'::text, 'm³'::text, 'litro'::text, 'cilindro'::text, 'tambor'::text, 'pallet'::text, 'plancha'::text, 'barra'::text, 'tubo'::text, 'perfil'::text, 'bidón'::text, 'servicio'::text, 'viaje'::text, 'hora'::text, 'día'::text, 'otro'::text])));
alter table public."frontend_assets" add constraint "frontend_assets_pkey" PRIMARY KEY (name);
alter table public."admin_recovery_tokens" add constraint "admin_recovery_tokens_pkey" PRIMARY KEY (id);
alter table public."admin_recovery_tokens" add constraint "admin_recovery_tokens_token_hash_key" UNIQUE (token_hash);
alter table public."product_deletion_requests" add constraint "product_deletion_requests_pkey" PRIMARY KEY (id);
alter table public."product_deletion_requests" add constraint "product_deletion_requests_resolution_check" CHECK ((resolution = ANY (ARRAY['deleted'::text, 'deactivated'::text])));
alter table public."product_deletion_requests" add constraint "product_deletion_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public."audit_events" add constraint "audit_events_pkey" PRIMARY KEY (id);
alter table public."purchase_receipts" add constraint "purchase_receipts_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documents(id);
alter table public."purchase_receipts" add constraint "purchase_receipts_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES movements(id);
alter table public."purchase_receipts" add constraint "purchase_receipts_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES purchases(id);
alter table public."purchase_receipts" add constraint "purchase_receipts_received_by_fkey" FOREIGN KEY (received_by) REFERENCES profiles(id);
alter table public."purchase_receipts" add constraint "purchase_receipts_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
alter table public."purchase_receipt_items" add constraint "purchase_receipt_items_purchase_item_id_fkey" FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id);
alter table public."purchase_receipt_items" add constraint "purchase_receipt_items_receipt_id_fkey" FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE CASCADE;
alter table public."warehouse_opening_inventory" add constraint "warehouse_opening_inventory_closed_by_fkey" FOREIGN KEY (closed_by) REFERENCES profiles(id);
alter table public."warehouse_opening_inventory" add constraint "warehouse_opening_inventory_opened_by_fkey" FOREIGN KEY (opened_by) REFERENCES profiles(id);
alter table public."warehouse_opening_inventory" add constraint "warehouse_opening_inventory_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT;
alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."profiles" add constraint "profiles_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
alter table public."supply_requests" add constraint "supply_requests_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
alter table public."supply_requests" add constraint "supply_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES profiles(id);
alter table public."supply_requests" add constraint "supply_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES profiles(id);
alter table public."supply_requests" add constraint "supply_requests_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
alter table public."correction_requests" add constraint "correction_requests_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES movements(id);
alter table public."correction_requests" add constraint "correction_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES profiles(id);
alter table public."correction_requests" add constraint "correction_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES profiles(id);
alter table public."movements" add constraint "movements_barge_id_fkey" FOREIGN KEY (barge_id) REFERENCES barges(id);
alter table public."movements" add constraint "movements_contractor_id_fkey" FOREIGN KEY (contractor_id) REFERENCES contractors(id);
alter table public."movements" add constraint "movements_corrected_movement_id_fkey" FOREIGN KEY (corrected_movement_id) REFERENCES movements(id);
alter table public."movements" add constraint "movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public."movements" add constraint "movements_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documents(id);
alter table public."movements" add constraint "movements_opening_session_id_fkey" FOREIGN KEY (opening_session_id) REFERENCES warehouse_opening_inventory(id) ON DELETE RESTRICT;
alter table public."movements" add constraint "movements_received_by_fkey" FOREIGN KEY (received_by) REFERENCES profiles(id);
alter table public."movements" add constraint "movements_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table public."movements" add constraint "movements_warehouse_from_id_fkey" FOREIGN KEY (warehouse_from_id) REFERENCES warehouses(id);
alter table public."movements" add constraint "movements_warehouse_to_id_fkey" FOREIGN KEY (warehouse_to_id) REFERENCES warehouses(id);
alter table public."movement_lines" add constraint "movement_lines_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES movements(id) ON DELETE CASCADE;
alter table public."movement_lines" add constraint "movement_lines_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
alter table public."inventory_batches" add constraint "inventory_batches_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
alter table public."inventory_batches" add constraint "inventory_batches_source_line_id_fkey" FOREIGN KEY (source_line_id) REFERENCES movement_lines(id);
alter table public."inventory_batches" add constraint "inventory_batches_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
alter table public."stock_minimums" add constraint "stock_minimums_preferred_supplier_id_fkey" FOREIGN KEY (preferred_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
alter table public."stock_minimums" add constraint "stock_minimums_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."stock_minimums" add constraint "stock_minimums_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id);
alter table public."stock_minimums" add constraint "stock_minimums_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
alter table public."purchase_documents" add constraint "purchase_documents_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE;
alter table public."purchase_documents" add constraint "purchase_documents_receipt_id_fkey" FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE SET NULL;
alter table public."purchase_documents" add constraint "purchase_documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id);
alter table public."batch_allocations" add constraint "batch_allocations_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES inventory_batches(id);
alter table public."batch_allocations" add constraint "batch_allocations_movement_line_id_fkey" FOREIGN KEY (movement_line_id) REFERENCES movement_lines(id) ON DELETE CASCADE;
alter table public."purchase_items" add constraint "purchase_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
alter table public."purchase_items" add constraint "purchase_items_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE;
alter table public."purchases" add constraint "purchases_barge_id_fkey" FOREIGN KEY (barge_id) REFERENCES barges(id);
alter table public."purchases" add constraint "purchases_company_id_fkey" FOREIGN KEY (company_id) REFERENCES purchase_companies(id);
alter table public."purchases" add constraint "purchases_contractor_id_fkey" FOREIGN KEY (contractor_id) REFERENCES contractors(id);
alter table public."purchases" add constraint "purchases_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public."purchases" add constraint "purchases_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table public."purchases" add constraint "purchases_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
alter table public."suppliers" add constraint "suppliers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public."documents" add constraint "documents_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table public."documents" add constraint "documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id);
alter table public."product_requests" add constraint "product_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES profiles(id);
alter table public."product_requests" add constraint "product_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES profiles(id);
alter table public."product_requests" add constraint "product_requests_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
alter table public."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."products" add constraint "products_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public."product_presentations" add constraint "product_presentations_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_deletion_requests" add constraint "product_deletion_requests_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public."product_deletion_requests" add constraint "product_deletion_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public."product_deletion_requests" add constraint "product_deletion_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."audit_events" add constraint "audit_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES profiles(id);
alter table public."audit_events" add constraint "audit_events_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES movements(id);
alter table public."audit_events" add constraint "audit_events_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;
alter table public."audit_events" add constraint "audit_events_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
create unique index movements_request_id_fixture on public.movements(created_by,type,client_request_id) where client_request_id is not null;
CREATE OR REPLACE FUNCTION public.current_profile_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select role from public.profiles where id=auth.uid() and active=true $function$
;
CREATE OR REPLACE FUNCTION public.current_profile_warehouse()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select warehouse_id from public.profiles where id=auth.uid() and active=true $function$
;
CREATE OR REPLACE FUNCTION public.can_access_warehouse(p_warehouse uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true and (p.role='admin' or (p.role='depositor' and p.warehouse_id=p_warehouse))) $function$
;
CREATE OR REPLACE FUNCTION public.assert_can_access_warehouse(p_warehouse uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_warehouse is null or not exists(select 1 from public.warehouses w where w.id=p_warehouse and w.active=true) then
    raise exception 'El depósito no existe o está inactivo.';
  end if;
  if not public.can_access_warehouse(p_warehouse) then
    raise exception 'No autorizado para operar este depósito';
  end if;
end$function$
;
CREATE OR REPLACE FUNCTION public.record_entry(p_warehouse_id uuid, p_supplier_id uuid, p_document_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_base numeric;
  v_cost_present numeric;
  v_cost_base numeric;
  v_currency text;
  v_fx numeric;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Agregá al menos un producto';
  end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  insert into public.movements(type,status,warehouse_to_id,supplier_id,document_id,notes,created_by,client_request_id)
  values('entry','confirmed',p_warehouse_id,p_supplier_id,p_document_id,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='entry' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la entrada. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    if not exists(select 1 from public.products where id=v_product and active=true) then
      raise exception 'Producto inexistente o inactivo.';
    end if;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_base=v_qty*v_factor;
    v_cost_present=nullif(v_item->>'unit_cost','')::numeric;
    v_cost_base=case when v_cost_present is null then null else v_cost_present/v_factor end;
    v_currency=nullif(v_item->>'currency','');
    v_fx=nullif(v_item->>'exchange_rate','')::numeric;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida'; end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label,entry_unit_cost,entry_currency,exchange_rate)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),v_cost_present,v_currency,v_fx)
    returning id into v_line;
    insert into public.inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,unit_cost,currency,exchange_rate,lot_reference)
    values(p_warehouse_id,v_product,v_line,v_base,v_base,v_cost_base,v_currency,v_fx,nullif(v_item->>'lot_reference',''));
  end loop;
  return v_movement;
end
$function$
;
CREATE OR REPLACE FUNCTION public.record_exit(p_warehouse_id uuid, p_barge_id uuid, p_contractor_id uuid, p_person_receiving text, p_destination text, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Agregá al menos un producto';
  end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  perform 1
  from public.inventory_batches b
  where b.warehouse_id=p_warehouse_id
    and b.product_id in (
      select distinct (x->>'product_id')::uuid
      from jsonb_array_elements(p_items) x
    )
    and b.quantity_remaining>0
  order by b.product_id,b.received_at,b.created_at,b.id
  for update;

  insert into public.movements(type,status,warehouse_from_id,barge_id,contractor_id,person_receiving,destination,destination_text,notes,created_by,client_request_id)
  values('exit','confirmed',p_warehouse_id,p_barge_id,p_contractor_id,p_person_receiving,p_destination,p_destination,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='exit' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la salida. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_need=v_qty*v_factor;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida'; end if;
    if coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=p_warehouse_id and product_id=v_product),0)<v_need then
      raise exception 'Stock insuficiente';
    end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''))
    returning id into v_line;
    for v_batch in
      select *
      from public.inventory_batches
      where warehouse_id=p_warehouse_id and product_id=v_product and quantity_remaining>0
      order by received_at,created_at,id
      for update
    loop
      exit when v_need<=0;
      v_take=least(v_need,v_batch.quantity_remaining);
      update public.inventory_batches set quantity_remaining=quantity_remaining-v_take where id=v_batch.id;
      insert into public.batch_allocations(movement_line_id,batch_id,quantity,unit_cost,currency,exchange_rate)
      values(v_line,v_batch.id,v_take,v_batch.unit_cost,v_batch.currency,v_batch.exchange_rate);
      v_need=v_need-v_take;
    end loop;
    if v_need>0 then
      raise exception 'El stock cambió mientras confirmabas. Actualizá y volvé a intentar.';
    end if;
  end loop;
  return v_movement;
end
$function$
;
CREATE OR REPLACE FUNCTION public.record_transfer(p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_from_warehouse_id);
  if p_from_warehouse_id=p_to_warehouse_id then raise exception 'Origen y destino iguales'; end if;
  if not exists(select 1 from public.warehouses where id=p_to_warehouse_id and active=true) then raise exception 'El depósito de destino no existe o está inactivo.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Agregá al menos un producto'; end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  perform 1
  from public.inventory_batches b
  where b.warehouse_id=p_from_warehouse_id
    and b.product_id in (
      select distinct (x->>'product_id')::uuid
      from jsonb_array_elements(p_items) x
    )
    and b.quantity_remaining>0
  order by b.product_id,b.received_at,b.created_at,b.id
  for update;

  insert into public.movements(type,status,warehouse_from_id,warehouse_to_id,notes,created_by,client_request_id)
  values('transfer','in_transit',p_from_warehouse_id,p_to_warehouse_id,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='transfer' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la transferencia. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    if not exists(select 1 from public.products where id=v_product and active=true) then raise exception 'Producto inexistente o inactivo.'; end if;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_need=v_qty*v_factor;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida'; end if;
    if coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=p_from_warehouse_id and product_id=v_product),0)<v_need then
      raise exception 'Stock insuficiente para transferencia';
    end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''))
    returning id into v_line;
    for v_batch in
      select *
      from public.inventory_batches
      where warehouse_id=p_from_warehouse_id and product_id=v_product and quantity_remaining>0
      order by received_at,created_at,id
      for update
    loop
      exit when v_need<=0;
      v_take=least(v_need,v_batch.quantity_remaining);
      update public.inventory_batches set quantity_remaining=quantity_remaining-v_take where id=v_batch.id;
      insert into public.batch_allocations(movement_line_id,batch_id,quantity,unit_cost,currency,exchange_rate)
      values(v_line,v_batch.id,v_take,v_batch.unit_cost,v_batch.currency,v_batch.exchange_rate);
      v_need=v_need-v_take;
    end loop;
    if v_need>0 then
      raise exception 'El stock cambió mientras confirmabas. Actualizá y volvé a intentar.';
    end if;
  end loop;
  return v_movement;
end
$function$
;
CREATE OR REPLACE FUNCTION public.record_return(p_warehouse_id uuid, p_barge_id uuid, p_contractor_id uuid, p_person_returning text, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_base numeric;
  v_cost numeric;
  v_currency text;
  v_fx numeric;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Agregá al menos un producto'; end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  insert into public.movements(type,status,warehouse_to_id,barge_id,contractor_id,person_receiving,notes,created_by,client_request_id)
  values('return','confirmed',p_warehouse_id,p_barge_id,p_contractor_id,p_person_returning,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='return' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la devolución. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    if not exists(select 1 from public.products where id=v_product and active=true) then raise exception 'Producto inexistente o inactivo.'; end if;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_base=v_qty*v_factor;
    v_cost=case when nullif(v_item->>'unit_cost','') is null then null else (v_item->>'unit_cost')::numeric/v_factor end;
    v_currency=nullif(v_item->>'currency','');
    v_fx=nullif(v_item->>'exchange_rate','')::numeric;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad inválida'; end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label,entry_unit_cost,entry_currency,exchange_rate)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),nullif(v_item->>'unit_cost','')::numeric,v_currency,v_fx)
    returning id into v_line;
    insert into public.inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,unit_cost,currency,exchange_rate,lot_reference)
    values(p_warehouse_id,v_product,v_line,v_base,v_base,v_cost,v_currency,v_fx,'DEVOLUCION');
  end loop;
  return v_movement;
end
$function$
;
CREATE OR REPLACE FUNCTION public.receive_transfer(p_movement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_move public.movements%rowtype; v_alloc record;
begin
 select * into v_move from public.movements where id=p_movement_id for update; if not found or v_move.type<>'transfer' or v_move.status<>'in_transit' then raise exception 'Transferencia inválida'; end if; perform public.assert_can_access_warehouse(v_move.warehouse_to_id);
 for v_alloc in select ml.product_id,ba.quantity,ba.unit_cost,ba.currency,ba.exchange_rate,ml.id source_line_id from public.movement_lines ml join public.batch_allocations ba on ba.movement_line_id=ml.id where ml.movement_id=p_movement_id loop
  insert into public.inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,unit_cost,currency,exchange_rate,received_at) values(v_move.warehouse_to_id,v_alloc.product_id,v_alloc.source_line_id,v_alloc.quantity,v_alloc.quantity,v_alloc.unit_cost,v_alloc.currency,v_alloc.exchange_rate,now());
 end loop;
 update public.movements set status='received',received_by=auth.uid(),received_at=now() where id=p_movement_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.audit_movement_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid; v_action text;
begin
  if tg_op='INSERT' then
    v_actor:=coalesce(auth.uid(),new.created_by); v_action:='movement_created';
    insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,movement_id,detail)
    values('movement',new.id,v_action,v_actor,coalesce(new.warehouse_from_id,new.warehouse_to_id),new.id,jsonb_build_object('movement_no',new.movement_no,'type',new.type,'status',new.status,'notes',new.notes));
    return new;
  end if;
  if new.status is distinct from old.status or new.received_by is distinct from old.received_by or new.received_at is distinct from old.received_at then
    v_actor:=coalesce(auth.uid(),new.received_by,new.created_by);
    v_action:=case when new.status='cancelled' then 'movement_cancelled' when old.status='in_transit' and new.status='received' then 'transfer_received' else 'movement_status_changed' end;
    insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,movement_id,detail)
    values('movement',new.id,v_action,v_actor,coalesce(new.warehouse_from_id,new.warehouse_to_id),new.id,jsonb_build_object('movement_no',new.movement_no,'type',new.type,'old_status',old.status,'new_status',new.status,'notes',new.notes,'received_by',new.received_by,'received_at',new.received_at));
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.create_supply_request(p_product_id uuid, p_name text, p_quantity numeric, p_unit text, p_urgency text, p_reason text, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_profile public.profiles%rowtype; v_product public.products%rowtype; v_name text; v_unit text; v_id uuid; v_admin record;
begin
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if not found or v_profile.role<>'depositor' or v_profile.warehouse_id is null then raise exception 'Solo un depositario activo con depósito asignado puede enviar solicitudes'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if coalesce(p_urgency,'') not in ('normal','urgent','critical') then raise exception 'Urgencia inválida'; end if;
  if p_product_id is not null then
    select * into v_product from public.products where id=p_product_id and active=true;
    if not found then raise exception 'Producto inválido o inactivo'; end if;
    v_name:=v_product.name; v_unit:=coalesce(nullif(trim(p_unit),''),v_product.base_unit);
  else
    v_name:=nullif(trim(p_name),''); v_unit:=nullif(trim(p_unit),'');
    if v_name is null then raise exception 'Escribí qué material necesitás'; end if;
    if v_unit is null then raise exception 'Indicá la unidad'; end if;
  end if;
  insert into public.supply_requests(requested_by,warehouse_id,product_id,requested_name,quantity,unit,urgency,reason,notes)
  values(auth.uid(),v_profile.warehouse_id,p_product_id,v_name,p_quantity,v_unit,p_urgency,nullif(trim(p_reason),''),nullif(trim(p_notes),'')) returning id into v_id;
  for v_admin in select id from public.profiles where role='admin' and active=true loop
    insert into public.notifications(user_id,kind,title,body,metadata,dedupe_key)
    values(v_admin.id,case when p_urgency='critical' then 'critical' when p_urgency='urgent' then 'warning' else 'info' end,
      case when p_urgency='critical' then 'Solicitud CRÍTICA de abastecimiento' else 'Nueva solicitud de abastecimiento' end,
      v_profile.username||' solicita '||trim(to_char(p_quantity,'FM999999990.###'))||' '||v_unit||' de '||v_name,
      jsonb_build_object('supply_request_id',v_id,'warehouse_id',v_profile.warehouse_id,'requested_by',auth.uid()),'supply_request:'||v_id::text) on conflict do nothing;
  end loop;
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('supply_request',v_id,'supply_request_created',auth.uid(),v_profile.warehouse_id,jsonb_build_object('name',v_name,'quantity',p_quantity,'unit',v_unit,'urgency',p_urgency));
  return v_id;
end $function$
;
create trigger trg_audit_movement after insert or update on public.movements for each row execute function public.audit_movement_event();
alter table public.profiles enable row level security; grant select on public.profiles to authenticated;
create policy "profiles_read" on public.profiles for select to authenticated using (((id = ( SELECT auth.uid() AS uid)) OR (current_profile_role() = 'admin'::text)));
alter table public.warehouses enable row level security; grant select on public.warehouses to authenticated;
create policy "warehouses_read" on public.warehouses for select to authenticated using ((EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = ( SELECT auth.uid() AS uid)) AND (pr.active = true)))));
alter table public.products enable row level security; grant select on public.products to authenticated;
create policy "products_read" on public.products for select to authenticated using (((EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = ( SELECT auth.uid() AS uid)) AND (pr.active = true)))) AND ((active = true) OR (current_profile_role() = 'admin'::text))));
alter table public.movements enable row level security; grant select on public.movements to authenticated;
create policy "movements_read" on public.movements for select to authenticated using (((current_profile_role() = 'admin'::text) OR can_access_warehouse(warehouse_from_id) OR can_access_warehouse(warehouse_to_id)));
alter table public.movement_lines enable row level security; grant select on public.movement_lines to authenticated;
create policy "lines_read" on public.movement_lines for select to authenticated using ((EXISTS ( SELECT 1
   FROM movements m
  WHERE ((m.id = movement_lines.movement_id) AND ((current_profile_role() = 'admin'::text) OR can_access_warehouse(m.warehouse_from_id) OR can_access_warehouse(m.warehouse_to_id))))));
alter table public.inventory_batches enable row level security; grant select on public.inventory_batches to authenticated;
create policy "batches_read" on public.inventory_batches for select to authenticated using (can_access_warehouse(warehouse_id));
alter table public.batch_allocations enable row level security; grant select on public.batch_allocations to authenticated;
create policy "allocations_read" on public.batch_allocations for select to authenticated using ((EXISTS ( SELECT 1
   FROM (movement_lines ml
     JOIN movements m ON ((m.id = ml.movement_id)))
  WHERE ((ml.id = batch_allocations.movement_line_id) AND ((current_profile_role() = 'admin'::text) OR can_access_warehouse(m.warehouse_from_id) OR can_access_warehouse(m.warehouse_to_id))))));
alter table public.stock_minimums enable row level security; grant select on public.stock_minimums to authenticated;
create policy "stock_min_read" on public.stock_minimums for select to authenticated using (can_access_warehouse(warehouse_id));
alter table public.supply_requests enable row level security; grant select on public.supply_requests to authenticated;
create policy "supply_requests_read" on public.supply_requests for select to authenticated using (((requested_by = ( SELECT auth.uid() AS uid)) OR (current_profile_role() = 'admin'::text)));
create view public.v_stock_by_warehouse with (security_invoker=true) as  SELECT b.warehouse_id,
    w.name AS warehouse_name,
    b.product_id,
    p.name AS product_name,
    p.base_unit,
    sum(b.quantity_remaining)::numeric(18,6) AS stock_qty
   FROM inventory_batches b
     JOIN warehouses w ON w.id = b.warehouse_id
     JOIN products p ON p.id = b.product_id
  WHERE b.quantity_remaining > 0::numeric
  GROUP BY b.warehouse_id, w.name, b.product_id, p.name, p.base_unit; grant select on public.v_stock_by_warehouse to authenticated;
create view public.v_stock_status with (security_invoker=true) as  SELECT sm.warehouse_id,
    w.name AS warehouse_name,
    sm.product_id,
    p.name AS product_name,
    p.base_unit,
    sm.minimum_qty,
    COALESCE(sum(ib.quantity_remaining), 0::numeric)::numeric(18,6) AS stock_qty,
    COALESCE(sum(ib.quantity_remaining), 0::numeric) <= sm.minimum_qty AS is_critical
   FROM stock_minimums sm
     JOIN warehouses w ON w.id = sm.warehouse_id
     JOIN products p ON p.id = sm.product_id
     LEFT JOIN inventory_batches ib ON ib.warehouse_id = sm.warehouse_id AND ib.product_id = sm.product_id AND ib.quantity_remaining > 0::numeric
  GROUP BY sm.warehouse_id, w.name, sm.product_id, p.name, p.base_unit, sm.minimum_qty; grant select on public.v_stock_status to authenticated;
