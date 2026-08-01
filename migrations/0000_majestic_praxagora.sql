CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_event_type_not_empty_check" CHECK (length("audit_events"."event_type") > 0),
	CONSTRAINT "audit_events_before_state_object_check" CHECK (jsonb_typeof("audit_events"."before_state") = 'object'),
	CONSTRAINT "audit_events_after_state_object_check" CHECK (jsonb_typeof("audit_events"."after_state") = 'object'),
	CONSTRAINT "audit_events_reason_not_empty_check" CHECK (length("audit_events"."reason") > 0)
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "fulfillments_status_check" CHECK ("fulfillments"."status" in (
        'blocked_awaiting_payment',
        'ready_to_fulfill',
        'packing',
        'packed',
        'dispatched',
        'cancelled'
      )),
	CONSTRAINT "fulfillments_blocked_reason_check" CHECK ((
        "fulfillments"."status" = 'blocked_awaiting_payment'
        and "fulfillments"."blocked_reason" is not null
      ) or (
        "fulfillments"."status" <> 'blocked_awaiting_payment'
        and "fulfillments"."blocked_reason" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_key_not_empty_check" CHECK (length("idempotency_records"."idempotency_key") > 0),
	CONSTRAINT "idempotency_records_request_hash_not_empty_check" CHECK (length("idempotency_records"."request_hash") > 0),
	CONSTRAINT "idempotency_records_result_object_check" CHECK (jsonb_typeof("idempotency_records"."result_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"sku" text PRIMARY KEY NOT NULL,
	"on_hand" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_sku_not_empty_check" CHECK (length("inventory"."sku") > 0),
	CONSTRAINT "inventory_on_hand_nonnegative_check" CHECK ("inventory"."on_hand" >= 0),
	CONSTRAINT "inventory_reserved_nonnegative_check" CHECK ("inventory"."reserved" >= 0),
	CONSTRAINT "inventory_reserved_not_above_on_hand_check" CHECK ("inventory"."reserved" <= "inventory"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_order_item_id_unique" UNIQUE("order_item_id"),
	CONSTRAINT "inventory_reservations_quantity_positive_check" CHECK ("inventory_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive_check" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_nonnegative_check" CHECK ("order_items"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"local_payment_status" text DEFAULT 'pending' NOT NULL,
	"order_status" text DEFAULT 'awaiting_payment' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_local_payment_status_check" CHECK ("orders"."local_payment_status" in ('pending', 'paid')),
	CONSTRAINT "orders_order_status_check" CHECK ("orders"."order_status" in (
        'awaiting_payment',
        'ready_for_fulfillment',
        'cancelled'
      )),
	CONSTRAINT "orders_version_positive_check" CHECK ("orders"."version" > 0),
	CONSTRAINT "orders_order_number_not_empty_check" CHECK (length("orders"."order_number") > 0),
	CONSTRAINT "orders_workflow_state_check" CHECK ((
        "orders"."order_status" = 'awaiting_payment'
        and "orders"."local_payment_status" = 'pending'
      ) or (
        "orders"."order_status" = 'ready_for_fulfillment'
        and "orders"."local_payment_status" = 'paid'
      ) or (
        "orders"."order_status" = 'cancelled'
      ))
);
--> statement-breakpoint
CREATE TABLE "processor_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"processor_payment_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"captured_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processor_payments_processor_payment_id_unique" UNIQUE("processor_payment_id"),
	CONSTRAINT "processor_payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "processor_payments_processor_id_not_empty_check" CHECK (length("processor_payments"."processor_payment_id") > 0),
	CONSTRAINT "processor_payments_status_check" CHECK ("processor_payments"."status" in (
        'authorized',
        'captured',
        'voided',
        'refunded',
        'disputed',
        'failed'
      )),
	CONSTRAINT "processor_payments_captured_at_check" CHECK ("processor_payments"."status" not in ('captured', 'refunded', 'disputed')
        or "processor_payments"."captured_at" is not null),
	CONSTRAINT "processor_payments_amount_positive_check" CHECK ("processor_payments"."amount_minor" > 0),
	CONSTRAINT "processor_payments_currency_check" CHECK ("processor_payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "recovery_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"expected_order_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"planned_changes" jsonb NOT NULL,
	"invalidated_reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"applied_at" timestamp (3) with time zone,
	CONSTRAINT "recovery_plans_expected_version_positive_check" CHECK ("recovery_plans"."expected_order_version" > 0),
	CONSTRAINT "recovery_plans_status_check" CHECK ("recovery_plans"."status" in ('pending', 'applied', 'expired', 'invalidated')),
	CONSTRAINT "recovery_plans_invalidated_reason_check" CHECK ((
        "recovery_plans"."status" = 'invalidated'
        and "recovery_plans"."invalidated_reason" is not null
        and length("recovery_plans"."invalidated_reason") > 0
      ) or (
        "recovery_plans"."status" <> 'invalidated'
        and "recovery_plans"."invalidated_reason" is null
      )),
	CONSTRAINT "recovery_plans_planned_changes_object_check" CHECK (jsonb_typeof("recovery_plans"."planned_changes") = 'object'),
	CONSTRAINT "recovery_plans_expiry_after_creation_check" CHECK ("recovery_plans"."expires_at" > "recovery_plans"."created_at"),
	CONSTRAINT "recovery_plans_applied_at_check" CHECK ((
        "recovery_plans"."status" = 'applied' and "recovery_plans"."applied_at" is not null
      ) or (
        "recovery_plans"."status" <> 'applied' and "recovery_plans"."applied_at" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"delivery_status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"error_message" text,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp (3) with time zone,
	CONSTRAINT "webhook_events_event_type_not_empty_check" CHECK (length("webhook_events"."event_type") > 0),
	CONSTRAINT "webhook_events_delivery_status_check" CHECK ("webhook_events"."delivery_status" in ('pending', 'processed', 'failed')),
	CONSTRAINT "webhook_events_payload_object_check" CHECK (jsonb_typeof("webhook_events"."payload") = 'object'),
	CONSTRAINT "webhook_events_failure_error_check" CHECK ("webhook_events"."delivery_status" <> 'failed' or "webhook_events"."error_message" is not null)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_plan_id_recovery_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."recovery_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_plan_id_recovery_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."recovery_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sku_inventory_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."inventory"("sku") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processor_payments" ADD CONSTRAINT "processor_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_plans" ADD CONSTRAINT "recovery_plans_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_id_processor_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."processor_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_order_id_created_at_idx" ON "audit_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_plan_id_idx" ON "audit_events" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idempotency_records_plan_id_idx" ON "idempotency_records" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_sku_idx" ON "order_items" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_plans_one_pending_per_order_idx" ON "recovery_plans" USING btree ("order_id") WHERE "recovery_plans"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "recovery_plans_order_id_status_idx" ON "recovery_plans" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "webhook_events_payment_id_idx" ON "webhook_events" USING btree ("payment_id");