CREATE TYPE "public"."media_asset_kind" AS ENUM('image', 'video', 'document');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_trigger" AS ENUM('agent', 'keyword', 'command', 'stage');--> statement-breakpoint
CREATE TYPE "public"."pago_tipo" AS ENUM('completo', 'anticipo', 'liquidacion');--> statement-breakpoint
ALTER TYPE "public"."message_type" ADD VALUE 'system_note';--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "media_asset_kind" NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"trigger" "workflow_run_trigger" NOT NULL,
	"triggered_by_user_id" text,
	"payload" jsonb,
	"status" "workflow_run_status" DEFAULT 'queued' NOT NULL,
	"step_cursor" integer DEFAULT 0 NOT NULL,
	"message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"agent_description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"trigger_agent" boolean DEFAULT false NOT NULL,
	"trigger_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_command" text,
	"trigger_stage" "contact_stage",
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datos_cobro" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"banco" text DEFAULT '' NOT NULL,
	"beneficiario" text DEFAULT '' NOT NULL,
	"clabe" text DEFAULT '' NOT NULL,
	"cuenta" text DEFAULT '' NOT NULL,
	"concepto" text DEFAULT '' NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagos_confirmados" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text,
	"contact_id" text,
	"referencia" text NOT NULL,
	"monto_mxn" numeric(12, 2) NOT NULL,
	"tipo" "pago_tipo" NOT NULL,
	"banco" text,
	"fecha_comprobante" text,
	"confirmado_por" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datos_cobro" ADD CONSTRAINT "datos_cobro_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datos_cobro" ADD CONSTRAINT "datos_cobro_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos_confirmados" ADD CONSTRAINT "pagos_confirmados_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos_confirmados" ADD CONSTRAINT "pagos_confirmados_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos_confirmados" ADD CONSTRAINT "pagos_confirmados_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_org_idx" ON "media_assets" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_uidx" ON "media_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "workflow_runs_conv_workflow_idx" ON "workflow_runs" USING btree ("conversation_id","workflow_id","status");--> statement-breakpoint
CREATE INDEX "workflow_runs_org_created_idx" ON "workflow_runs" USING btree ("organization_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "workflow_steps_workflow_idx" ON "workflow_steps" USING btree ("workflow_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_org_slug_uidx" ON "workflows" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_org_command_uidx" ON "workflows" USING btree ("organization_id","trigger_command") WHERE "workflows"."trigger_command" is not null;--> statement-breakpoint
CREATE INDEX "workflows_org_position_idx" ON "workflows" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pagos_confirmados_org_ref_uidx" ON "pagos_confirmados" USING btree ("organization_id","referencia");--> statement-breakpoint
CREATE INDEX "pagos_confirmados_conv_idx" ON "pagos_confirmados" USING btree ("conversation_id");