-- Minimal type fixtures only: no production rows, constraints, triggers or RLS.
CREATE TABLE public."admin_recovery_tokens" (
  "id" uuid,
  "username" text,
  "token_hash" text,
  "expires_at" timestamp with time zone,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone
);
CREATE TABLE public."audit_events" (
  "id" uuid,
  "entity_type" text,
  "entity_id" uuid,
  "action" text,
  "actor_id" uuid,
  "warehouse_id" uuid,
  "movement_id" uuid,
  "detail" jsonb,
  "created_at" timestamp with time zone,
  "purchase_id" uuid
);
CREATE TABLE public."barges" (
  "id" uuid,
  "number" integer,
  "name" text,
  "active" boolean
);
CREATE TABLE public."batch_allocations" (
  "id" uuid,
  "movement_line_id" uuid,
  "batch_id" uuid,
  "quantity" numeric(18,6),
  "unit_cost" numeric(18,6),
  "currency" text,
  "exchange_rate" numeric(18,6),
  "created_at" timestamp with time zone
);
CREATE TABLE public."contractors" (
  "id" uuid,
  "name" text,
  "active" boolean,
  "created_at" timestamp with time zone
);
CREATE TABLE public."correction_requests" (
  "id" uuid,
  "movement_id" uuid,
  "requested_by" uuid,
  "reason" text,
  "requested_change" jsonb,
  "status" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone
);
CREATE TABLE public."documents" (
  "id" uuid,
  "supplier_id" uuid,
  "document_type" text,
  "document_number" text,
  "document_date" date,
  "currency" text,
  "exchange_rate" numeric(18,6),
  "file_path" text,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone
);
CREATE TABLE public."frontend_assets" (
  "name" text,
  "data" text,
  "content_encoding" text,
  "updated_at" timestamp with time zone
);
CREATE TABLE public."inventory_batches" (
  "id" uuid,
  "warehouse_id" uuid,
  "product_id" uuid,
  "source_line_id" uuid,
  "quantity_received" numeric(18,6),
  "quantity_remaining" numeric(18,6),
  "unit_cost" numeric(18,6),
  "currency" text,
  "exchange_rate" numeric(18,6),
  "lot_reference" text,
  "received_at" timestamp with time zone,
  "created_at" timestamp with time zone
);
CREATE TABLE public."movement_lines" (
  "id" uuid,
  "movement_id" uuid,
  "product_id" uuid,
  "quantity" numeric(18,6),
  "unit" text,
  "factor_to_base" numeric(18,6),
  "base_quantity" numeric(18,6),
  "entry_unit_cost" numeric(18,6),
  "entry_currency" text,
  "exchange_rate" numeric(18,6),
  "notes" text,
  "presentation_label" text
);
CREATE TABLE public."movements" (
  "id" uuid,
  "movement_no" bigint,
  "type" text,
  "status" text,
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
  "created_by" uuid,
  "created_at" timestamp with time zone,
  "received_by" uuid,
  "received_at" timestamp with time zone,
  "destination_text" text,
  "opening_session_id" uuid,
  "client_request_id" uuid
);
CREATE TABLE public."notifications" (
  "id" uuid,
  "user_id" uuid,
  "kind" text,
  "title" text,
  "body" text,
  "metadata" jsonb,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone,
  "dedupe_key" text
);
CREATE TABLE public."product_deletion_requests" (
  "id" uuid,
  "product_id" uuid,
  "product_name_snapshot" text,
  "requested_by" uuid,
  "reason" text,
  "status" text,
  "resolution" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone
);
CREATE TABLE public."product_presentations" (
  "id" uuid,
  "product_id" uuid,
  "label" text,
  "unit" text,
  "factor_to_base" numeric(18,6)
);
CREATE TABLE public."product_requests" (
  "id" uuid,
  "requested_by" uuid,
  "warehouse_id" uuid,
  "proposed_name" text,
  "proposed_unit" text,
  "notes" text,
  "status" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone
);
CREATE TABLE public."products" (
  "id" uuid,
  "sku" text,
  "name" text,
  "base_unit" text,
  "active" boolean,
  "created_by" uuid,
  "created_at" timestamp with time zone
);
CREATE TABLE public."profiles" (
  "id" uuid,
  "username" text,
  "full_name" text,
  "role" text,
  "warehouse_id" uuid,
  "active" boolean,
  "must_change_password" boolean,
  "password_changed_at" timestamp with time zone,
  "created_at" timestamp with time zone
);
CREATE TABLE public."purchase_companies" (
  "id" uuid,
  "name" text,
  "active" boolean,
  "created_at" timestamp with time zone,
  "legal_name" text,
  "tax_id" text,
  "address" text,
  "phone" text,
  "email" text,
  "po_prefix" text
);
CREATE TABLE public."purchase_documents" (
  "id" uuid,
  "purchase_id" uuid,
  "kind" text,
  "file_path" text,
  "file_name" text,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone,
  "receipt_id" uuid,
  "document_number" text,
  "document_date" date,
  "source" text,
  "analysis_status" text,
  "analysis_data" jsonb,
  "analysis_model" text,
  "analysis_confidence" numeric,
  "analyzed_at" timestamp with time zone,
  "analysis_error" text
);
CREATE TABLE public."purchase_items" (
  "id" uuid,
  "purchase_id" uuid,
  "product_id" uuid,
  "description" text,
  "quantity" numeric,
  "unit" text,
  "factor_to_base" numeric,
  "unit_price" numeric,
  "affects_inventory" boolean,
  "received_qty" numeric,
  "notes" text,
  "created_at" timestamp with time zone
);
CREATE TABLE public."purchase_receipt_items" (
  "id" uuid,
  "receipt_id" uuid,
  "purchase_item_id" uuid,
  "quantity" numeric
);
CREATE TABLE public."purchase_receipts" (
  "id" uuid,
  "purchase_id" uuid,
  "warehouse_id" uuid,
  "received_by" uuid,
  "movement_id" uuid,
  "document_id" uuid,
  "notes" text,
  "received_at" timestamp with time zone,
  "client_request_id" uuid
);
CREATE TABLE public."purchases" (
  "id" uuid,
  "company_id" uuid,
  "supplier_id" uuid,
  "purchase_type" text,
  "status" text,
  "urgency" text,
  "destination_type" text,
  "warehouse_id" uuid,
  "barge_id" uuid,
  "contractor_id" uuid,
  "destination_text" text,
  "requester" text,
  "sector" text,
  "currency" text,
  "exchange_rate" numeric,
  "payment_method" text,
  "payment_terms" text,
  "order_reference" text,
  "ordered_date" date,
  "expected_date" date,
  "invoice_number" text,
  "invoice_date" date,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "po_number" text,
  "po_generated_at" timestamp with time zone,
  "purchase_confirmed_at" timestamp with time zone,
  "source_document_number" text,
  "source_document_date" date,
  "source_document_kind" text,
  "delivery_mode" text
);
CREATE TABLE public."stock_minimums" (
  "warehouse_id" uuid,
  "product_id" uuid,
  "minimum_qty" numeric(18,6),
  "updated_by" uuid,
  "updated_at" timestamp with time zone,
  "safety_stock_qty" numeric,
  "target_coverage_days" numeric,
  "lead_time_days" integer,
  "min_order_qty" numeric,
  "order_multiple_qty" numeric,
  "preferred_supplier_id" uuid,
  "criticality" text,
  "policy_active" boolean,
  "policy_notes" text
);
CREATE TABLE public."suppliers" (
  "id" uuid,
  "name" text,
  "tax_id" text,
  "phone" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone
);
CREATE TABLE public."supply_requests" (
  "id" uuid,
  "requested_by" uuid,
  "warehouse_id" uuid,
  "product_id" uuid,
  "requested_name" text,
  "quantity" numeric,
  "unit" text,
  "urgency" text,
  "reason" text,
  "notes" text,
  "status" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "resolution_notes" text,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);
CREATE TABLE public."warehouse_opening_inventory" (
  "id" uuid,
  "warehouse_id" uuid,
  "status" text,
  "notes" text,
  "opened_by" uuid,
  "opened_at" timestamp with time zone,
  "closed_by" uuid,
  "closed_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);
CREATE TABLE public."warehouses" (
  "id" uuid,
  "code" text,
  "name" text,
  "active" boolean,
  "created_at" timestamp with time zone
);
