ALTER TABLE "trading_position" ADD COLUMN "margin_mode" text DEFAULT 'CROSS' NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_position" ADD COLUMN "leverage" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_position" ADD COLUMN "isolated_margin" numeric(38, 18) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_position" ADD CONSTRAINT "trading_position_margin_mode_valid" CHECK ("trading_position"."margin_mode" in ('CROSS', 'ISOLATED'));--> statement-breakpoint
ALTER TABLE "trading_position" ADD CONSTRAINT "trading_position_leverage_bounds" CHECK ("trading_position"."leverage" >= 1 AND "trading_position"."leverage" <= 100);--> statement-breakpoint
ALTER TABLE "trading_position" ADD CONSTRAINT "trading_position_isolated_margin_non_negative" CHECK ("trading_position"."isolated_margin" >= 0);--> statement-breakpoint
ALTER TABLE "trading_position" ADD CONSTRAINT "trading_position_isolated_margin_by_mode" CHECK ((
        ("trading_position"."margin_mode" = 'CROSS' AND "trading_position"."isolated_margin" = 0)
        OR
        (
          "trading_position"."margin_mode" = 'ISOLATED'
          AND (
            ("trading_position"."quantity" = 0 AND "trading_position"."isolated_margin" = 0)
            OR
            ("trading_position"."quantity" <> 0 AND "trading_position"."isolated_margin" > 0)
          )
        )
      ));