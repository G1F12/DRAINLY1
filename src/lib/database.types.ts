export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      admin_order_overview: {
        Row: {
          actual_platform_net_transaction_cents: number | null
          contractor_company_id: string | null
          contractor_name: string | null
          customer_total_cents: number | null
          failed_payment_operation: string | null
          id: string | null
          payment_status:
            | Database["domain"]["Enums"]["payment_generation_status"]
            | null
          platform_gross_retained_cents: number | null
          public_ref: string | null
          requested_service_date: string | null
          requires_admin_attention: boolean | null
          status: Database["domain"]["Enums"]["order_status"] | null
          stripe_processing_fee_cents: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      contractor_jobs: {
        Row: {
          access_type: Database["domain"]["Enums"]["access_type"] | null
          address_snapshot: Json | null
          assignment_id: string | null
          contractor_payout_cents: number | null
          order_id: string | null
          payment_status:
            | Database["domain"]["Enums"]["payment_generation_status"]
            | null
          public_ref: string | null
          requested_service_date: string | null
          service_window_start_at: string | null
          status: Database["domain"]["Enums"]["order_status"] | null
          tank_tier: Database["domain"]["Enums"]["tank_tier"] | null
        }
        Relationships: []
      }
      contractor_offers: {
        Row: {
          contractor_payout_cents: number | null
          county_name: string | null
          expires_at: string | null
          id: string | null
          order_id: string | null
          postal_code: string | null
          requested_service_date: string | null
          status: Database["domain"]["Enums"]["offer_status"] | null
          tank_tier: Database["domain"]["Enums"]["tank_tier"] | null
          timing_kind: Database["domain"]["Enums"]["timing_kind"] | null
        }
        Relationships: [
          {
            foreignKeyName: "order_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "contractor_jobs"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      current_admin_context: {
        Row: {
          active: boolean | null
          admin_id: string | null
          auth_user_id: string | null
        }
        Insert: {
          active?: boolean | null
          admin_id?: string | null
          auth_user_id?: string | null
        }
        Update: {
          active?: boolean | null
          admin_id?: string | null
          auth_user_id?: string | null
        }
        Relationships: []
      }
      current_contractor_context: {
        Row: {
          auth_user_id: string | null
          company_name: string | null
          company_status:
            | Database["domain"]["Enums"]["contractor_status"]
            | null
          contractor_company_id: string | null
          contractor_user_id: string | null
          user_active: boolean | null
        }
        Relationships: []
      }
      current_customer_context: {
        Row: {
          auth_user_id: string | null
          customer_id: string | null
          email: string | null
        }
        Insert: {
          auth_user_id?: string | null
          customer_id?: string | null
          email?: string | null
        }
        Update: {
          auth_user_id?: string | null
          customer_id?: string | null
          email?: string | null
        }
        Relationships: []
      }
      customer_orders: {
        Row: {
          access_type: Database["domain"]["Enums"]["access_type"] | null
          address_snapshot: Json | null
          created_at: string | null
          customer_total_cents: number | null
          id: string | null
          payment_status:
            | Database["domain"]["Enums"]["payment_generation_status"]
            | null
          public_ref: string | null
          requested_service_date: string | null
          status: Database["domain"]["Enums"]["order_status"] | null
          tank_tier: Database["domain"]["Enums"]["tank_tier"] | null
          timing_kind: Database["domain"]["Enums"]["timing_kind"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_order_offer: {
        Args: { p_idempotency_key: string; p_offer_id: string }
        Returns: Json
      }
      admin_override_authorization: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
        }
        Returns: undefined
      }
      admin_override_quote_economics: {
        Args: {
          p_idempotency_key: string
          p_minimum_contribution_margin_cents: number
          p_quote_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_set_contractor_status: {
        Args: {
          p_contractor_company_id: string
          p_idempotency_key: string
          p_reason: string
          p_status: Database["domain"]["Enums"]["contractor_status"]
        }
        Returns: undefined
      }
      cancel_order: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
        }
        Returns: Json
      }
      marketplace_match_preview: {
        Args: {
          p_region_key: string
          p_requested_service_date: string
          p_tank_tier: Database["domain"]["Enums"]["tank_tier"]
          p_timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Returns: Json
      }
      contractor_onboarding_get: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      contractor_onboarding_save: {
        Args: {
          p_availability: Json
          p_company: Json
          p_idempotency_key?: string
          p_insurance_reference?: string
          p_license_reference?: string
          p_prices: Json
          p_regions: Json
        }
        Returns: Json
      }
      create_booking: {
        Args: {
          p_idempotency_key: string
          p_payment_method_id: string
          p_quote_id: string
          p_setup_intent_id: string
          p_stripe_customer_id: string
        }
        Returns: Json
      }
      create_quote: {
        Args: {
          p_access_type: Database["domain"]["Enums"]["access_type"]
          p_address_snapshot: Json
          p_idempotency_key: string
          p_region_key: string
          p_requested_service_date: string
          p_service_notes?: string
          p_service_window_start_at: string
          p_tank_tier: Database["domain"]["Enums"]["tank_tier"]
          p_timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Returns: Json
      }
      decline_order_offer: {
        Args: { p_idempotency_key: string; p_offer_id: string }
        Returns: undefined
      }
      ensure_customer_profile: { Args: { p_phone?: string }; Returns: string }
      reassign_order: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
          p_replacement_contractor_company_id: string
        }
        Returns: Json
      }
      register_job_proof: {
        Args: {
          p_checksum_sha256: string
          p_idempotency_key: string
          p_mime_type: string
          p_order_id: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
      request_refund: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
        }
        Returns: Json
      }
      requeue_failed_outbox: {
        Args: {
          p_idempotency_key: string
          p_outbox_id: string
          p_reason: string
        }
        Returns: Json
      }
      retry_failed_payment_operation: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
          p_task_type: string
        }
        Returns: Json
      }
      transition_job: {
        Args: {
          p_action: string
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  domain: {
    Tables: {
      admin_notes: {
        Row: {
          admin_user_id: string
          contractor_company_id: string | null
          created_at: string
          id: string
          note: string
          order_id: string | null
        }
        Insert: {
          admin_user_id: string
          contractor_company_id?: string | null
          created_at?: string
          id?: string
          note: string
          order_id?: string | null
        }
        Update: {
          admin_user_id?: string
          contractor_company_id?: string | null
          created_at?: string
          id?: string
          note?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_notes_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_records: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          reason: string | null
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_type: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      contractor_availability: {
        Row: {
          contractor_company_id: string
          iso_weekday: number
          max_jobs: number
          urgent_enabled: boolean
        }
        Insert: {
          contractor_company_id: string
          iso_weekday: number
          max_jobs: number
          urgent_enabled?: boolean
        }
        Update: {
          contractor_company_id?: string
          iso_weekday?: number
          max_jobs?: number
          urgent_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contractor_availability_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_blackout_dates: {
        Row: {
          blackout_date: string
          contractor_company_id: string
          reason: string | null
        }
        Insert: {
          blackout_date: string
          contractor_company_id: string
          reason?: string | null
        }
        Update: {
          blackout_date?: string
          contractor_company_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_blackout_dates_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_companies: {
        Row: {
          created_at: string
          display_name: string
          email: string
          id: string
          internal_notes: string | null
          legal_name: string
          operating_address: string | null
          phone: string
          primary_contact_name: string
          priority: number
          status: Database["domain"]["Enums"]["contractor_status"]
          stripe_charges_enabled: boolean
          stripe_connected_account_id: string | null
          stripe_details_submitted: boolean
          stripe_payouts_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          id?: string
          internal_notes?: string | null
          legal_name: string
          operating_address?: string | null
          phone: string
          primary_contact_name: string
          priority?: number
          status?: Database["domain"]["Enums"]["contractor_status"]
          stripe_charges_enabled?: boolean
          stripe_connected_account_id?: string | null
          stripe_details_submitted?: boolean
          stripe_payouts_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          internal_notes?: string | null
          legal_name?: string
          operating_address?: string | null
          phone?: string
          primary_contact_name?: string
          priority?: number
          status?: Database["domain"]["Enums"]["contractor_status"]
          stripe_charges_enabled?: boolean
          stripe_connected_account_id?: string | null
          stripe_details_submitted?: boolean
          stripe_payouts_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      contractor_day_capacity: {
        Row: {
          contractor_company_id: string
          created_at: string
          max_jobs_snapshot: number
          service_date: string
        }
        Insert: {
          contractor_company_id: string
          created_at?: string
          max_jobs_snapshot: number
          service_date: string
        }
        Update: {
          contractor_company_id?: string
          created_at?: string
          max_jobs_snapshot?: number
          service_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_day_capacity_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_fee_configs: {
        Row: {
          contractor_company_id: string
          fee_bps: number | null
          fixed_fee_cents: number | null
          updated_at: string
        }
        Insert: {
          contractor_company_id: string
          fee_bps?: number | null
          fixed_fee_cents?: number | null
          updated_at?: string
        }
        Update: {
          contractor_company_id?: string
          fee_bps?: number | null
          fixed_fee_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_fee_configs_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: true
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_price_books: {
        Row: {
          active: boolean
          contractor_company_id: string
          created_at: string
          effective_at: string
          id: string
          version: number
        }
        Insert: {
          active?: boolean
          contractor_company_id: string
          created_at?: string
          effective_at?: string
          id?: string
          version: number
        }
        Update: {
          active?: boolean
          contractor_company_id?: string
          created_at?: string
          effective_at?: string
          id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contractor_price_books_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_price_rules: {
        Row: {
          contractor_gross_cents: number
          id: string
          price_book_id: string
          service_region_id: string | null
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Insert: {
          contractor_gross_cents: number
          id?: string
          price_book_id: string
          service_region_id?: string | null
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Update: {
          contractor_gross_cents?: number
          id?: string
          price_book_id?: string
          service_region_id?: string | null
          tank_tier?: Database["domain"]["Enums"]["tank_tier"]
          timing_kind?: Database["domain"]["Enums"]["timing_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "contractor_price_rules_price_book_id_fkey"
            columns: ["price_book_id"]
            isOneToOne: false
            referencedRelation: "contractor_price_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_price_rules_service_region_id_fkey"
            columns: ["service_region_id"]
            isOneToOne: false
            referencedRelation: "service_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_service_regions: {
        Row: {
          contractor_company_id: string
          service_region_id: string
        }
        Insert: {
          contractor_company_id: string
          service_region_id: string
        }
        Update: {
          contractor_company_id?: string
          service_region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_service_regions_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_service_regions_service_region_id_fkey"
            columns: ["service_region_id"]
            isOneToOne: false
            referencedRelation: "service_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_users: {
        Row: {
          active: boolean
          auth_user_id: string
          contractor_company_id: string
          created_at: string
          role: string
        }
        Insert: {
          active?: boolean
          auth_user_id: string
          contractor_company_id: string
          created_at?: string
          role?: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string
          contractor_company_id?: string
          created_at?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_users_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_verifications: {
        Row: {
          contractor_company_id: string
          created_at: string
          id: string
          notes: string | null
          reference: string | null
          status: string
          verification_type: string
          verified_at: string | null
        }
        Insert: {
          contractor_company_id: string
          created_at?: string
          id?: string
          notes?: string | null
          reference?: string | null
          status: string
          verification_type: string
          verified_at?: string | null
        }
        Update: {
          contractor_company_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          reference?: string | null
          status?: string
          verification_type?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_verifications_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      financial_ledger_entries: {
        Row: {
          amount_cents: number
          created_at: string
          entry_type: Database["domain"]["Enums"]["ledger_entry_type"]
          id: string
          occurred_at: string
          order_id: string
          payment_generation_id: string | null
          provider_event_id: string | null
          provider_reference: string | null
          refund_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          entry_type: Database["domain"]["Enums"]["ledger_entry_type"]
          id?: string
          occurred_at: string
          order_id: string
          payment_generation_id?: string | null
          provider_event_id?: string | null
          provider_reference?: string | null
          refund_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          entry_type?: Database["domain"]["Enums"]["ledger_entry_type"]
          id?: string
          occurred_at?: string
          order_id?: string
          payment_generation_id?: string | null
          provider_event_id?: string | null
          provider_reference?: string | null
          refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_ledger_entries_payment_generation_id_fkey"
            columns: ["payment_generation_id"]
            isOneToOne: false
            referencedRelation: "payment_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_ledger_entries_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      job_proofs: {
        Row: {
          assignment_id: string
          checksum_sha256: string
          created_at: string
          id: string
          idempotency_key: string
          mime_type: string
          order_id: string
          size_bytes: number
          status: Database["domain"]["Enums"]["proof_status"]
          storage_path: string
          uploaded_by: string
          verified_at: string | null
        }
        Insert: {
          assignment_id: string
          checksum_sha256: string
          created_at?: string
          id?: string
          idempotency_key?: string
          mime_type: string
          order_id: string
          size_bytes: number
          status?: Database["domain"]["Enums"]["proof_status"]
          storage_path: string
          uploaded_by: string
          verified_at?: string | null
        }
        Update: {
          assignment_id?: string
          checksum_sha256?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          mime_type?: string
          order_id?: string
          size_bytes?: number
          status?: Database["domain"]["Enums"]["proof_status"]
          storage_path?: string
          uploaded_by?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_proofs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "order_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_proofs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_settings: {
        Row: {
          active: boolean
          authorization_lead_time_minutes: number
          created_at: string
          default_contractor_fee_bps: number
          default_contractor_fixed_fee_cents: number
          estimated_processing_fixed_cents: number
          estimated_processing_rate_bps: number
          id: string
          minimum_contribution_margin_cents: number
          quote_ttl_minutes: number
          scheduled_offer_ttl_minutes: number
          urgent_offer_ttl_minutes: number
          version: number
        }
        Insert: {
          active?: boolean
          authorization_lead_time_minutes?: number
          created_at?: string
          default_contractor_fee_bps: number
          default_contractor_fixed_fee_cents?: number
          estimated_processing_fixed_cents: number
          estimated_processing_rate_bps: number
          id?: string
          minimum_contribution_margin_cents: number
          quote_ttl_minutes?: number
          scheduled_offer_ttl_minutes?: number
          urgent_offer_ttl_minutes?: number
          version: number
        }
        Update: {
          active?: boolean
          authorization_lead_time_minutes?: number
          created_at?: string
          default_contractor_fee_bps?: number
          default_contractor_fixed_fee_cents?: number
          estimated_processing_fixed_cents?: number
          estimated_processing_rate_bps?: number
          id?: string
          minimum_contribution_margin_cents?: number
          quote_ttl_minutes?: number
          scheduled_offer_ttl_minutes?: number
          urgent_offer_ttl_minutes?: number
          version?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          destination_hash: string
          id: string
          idempotency_key: string
          last_error: string | null
          order_id: string | null
          recipient_type: string
          sent_at: string | null
          status: Database["domain"]["Enums"]["notification_status"]
          template_key: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          destination_hash: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          order_id?: string | null
          recipient_type: string
          sent_at?: string | null
          status?: Database["domain"]["Enums"]["notification_status"]
          template_key: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          destination_hash?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          order_id?: string | null
          recipient_type?: string
          sent_at?: string | null
          status?: Database["domain"]["Enums"]["notification_status"]
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_assignments: {
        Row: {
          assigned_at: string
          contractor_company_id: string
          id: string
          offer_id: string | null
          order_id: string
          release_reason: string | null
          released_at: string | null
        }
        Insert: {
          assigned_at?: string
          contractor_company_id: string
          id?: string
          offer_id?: string | null
          order_id: string
          release_reason?: string | null
          released_at?: string | null
        }
        Update: {
          assigned_at?: string
          contractor_company_id?: string
          id?: string
          offer_id?: string | null
          order_id?: string
          release_reason?: string | null
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_assignments_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "order_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          metadata: Json
          order_id: string
          previous_status: Database["domain"]["Enums"]["order_status"] | null
          resulting_status: Database["domain"]["Enums"]["order_status"] | null
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          metadata?: Json
          order_id: string
          previous_status?: Database["domain"]["Enums"]["order_status"] | null
          resulting_status?: Database["domain"]["Enums"]["order_status"] | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          order_id?: string
          previous_status?: Database["domain"]["Enums"]["order_status"] | null
          resulting_status?: Database["domain"]["Enums"]["order_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_offers: {
        Row: {
          contractor_company_id: string
          contractor_gross_cents: number
          contractor_marketplace_fee_cents: number
          contractor_payout_cents: number
          contractor_price_book_version: number
          dispatch_round: number
          estimated_payment_processing_cost_cents: number
          estimated_processing_fixed_cents: number
          estimated_processing_rate_bps: number
          expected_platform_net_contribution_cents: number
          expires_at: string
          id: string
          marketplace_settings_version: number
          minimum_contribution_margin_cents_applied: number
          offered_at: string
          order_id: string
          platform_pricing_adjustment_cents: number
          responded_at: string | null
          status: Database["domain"]["Enums"]["offer_status"]
        }
        Insert: {
          contractor_company_id: string
          contractor_gross_cents: number
          contractor_marketplace_fee_cents: number
          contractor_payout_cents: number
          contractor_price_book_version: number
          dispatch_round?: number
          estimated_payment_processing_cost_cents: number
          estimated_processing_fixed_cents: number
          estimated_processing_rate_bps: number
          expected_platform_net_contribution_cents: number
          expires_at: string
          id?: string
          marketplace_settings_version: number
          minimum_contribution_margin_cents_applied: number
          offered_at?: string
          order_id: string
          platform_pricing_adjustment_cents: number
          responded_at?: string | null
          status?: Database["domain"]["Enums"]["offer_status"]
        }
        Update: {
          contractor_company_id?: string
          contractor_gross_cents?: number
          contractor_marketplace_fee_cents?: number
          contractor_payout_cents?: number
          contractor_price_book_version?: number
          dispatch_round?: number
          estimated_payment_processing_cost_cents?: number
          estimated_processing_fixed_cents?: number
          estimated_processing_rate_bps?: number
          expected_platform_net_contribution_cents?: number
          expires_at?: string
          id?: string
          marketplace_settings_version?: number
          minimum_contribution_margin_cents_applied?: number
          offered_at?: string
          order_id?: string
          platform_pricing_adjustment_cents?: number
          responded_at?: string | null
          status?: Database["domain"]["Enums"]["offer_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_offers_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          access_type: Database["domain"]["Enums"]["access_type"]
          address_snapshot: Json
          created_at: string
          customer_fee_cents: number
          customer_id: string
          customer_subtotal_cents: number
          customer_total_cents: number
          id: string
          marketplace_settings_version: number
          pending_contractor_company_id: string | null
          property_id: string
          public_ref: string
          quote_id: string
          regional_price_book_version: number
          requested_service_date: string
          service_notes: string | null
          service_window_start_at: string
          status: Database["domain"]["Enums"]["order_status"]
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_setup_intent_id: string | null
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
          updated_at: string
          version: number
        }
        Insert: {
          access_type: Database["domain"]["Enums"]["access_type"]
          address_snapshot: Json
          created_at?: string
          customer_fee_cents: number
          customer_id: string
          customer_subtotal_cents: number
          customer_total_cents: number
          id?: string
          marketplace_settings_version: number
          pending_contractor_company_id?: string | null
          property_id: string
          public_ref?: string
          quote_id: string
          regional_price_book_version: number
          requested_service_date: string
          service_notes?: string | null
          service_window_start_at: string
          status?: Database["domain"]["Enums"]["order_status"]
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_setup_intent_id?: string | null
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
          updated_at?: string
          version?: number
        }
        Update: {
          access_type?: Database["domain"]["Enums"]["access_type"]
          address_snapshot?: Json
          created_at?: string
          customer_fee_cents?: number
          customer_id?: string
          customer_subtotal_cents?: number
          customer_total_cents?: number
          id?: string
          marketplace_settings_version?: number
          pending_contractor_company_id?: string | null
          property_id?: string
          public_ref?: string
          quote_id?: string
          regional_price_book_version?: number
          requested_service_date?: string
          service_notes?: string | null
          service_window_start_at?: string
          status?: Database["domain"]["Enums"]["order_status"]
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_setup_intent_id?: string | null
          tank_tier?: Database["domain"]["Enums"]["tank_tier"]
          timing_kind?: Database["domain"]["Enums"]["timing_kind"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pending_contractor_company_id_fkey"
            columns: ["pending_contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_generations: {
        Row: {
          actual_platform_net_transaction_cents: number | null
          assignment_id: string
          authorization_override: boolean
          authorization_override_reason: string | null
          authorization_target_at: string
          capture_before: string | null
          connected_account_id: string
          contractor_gross_cents: number
          contractor_marketplace_fee_cents: number
          contractor_payout_cents: number
          contractor_price_book_version: number
          created_at: string
          customer_total_cents: number
          estimated_payment_processing_cost_cents: number
          estimated_processing_fixed_cents: number
          estimated_processing_rate_bps: number
          expected_platform_net_contribution_cents: number
          failure_code: string | null
          generation_number: number
          id: string
          is_current: boolean
          marketplace_settings_version: number
          minimum_contribution_margin_cents_applied: number
          order_id: string
          platform_gross_retained_cents: number
          platform_pricing_adjustment_cents: number
          predecessor_generation_id: string | null
          provider_payment_intent_id: string | null
          status: Database["domain"]["Enums"]["payment_generation_status"]
          stripe_processing_fee_cents: number | null
          stripe_transfer_amount_cents: number
          updated_at: string
        }
        Insert: {
          actual_platform_net_transaction_cents?: number | null
          assignment_id: string
          authorization_override?: boolean
          authorization_override_reason?: string | null
          authorization_target_at: string
          capture_before?: string | null
          connected_account_id: string
          contractor_gross_cents: number
          contractor_marketplace_fee_cents: number
          contractor_payout_cents: number
          contractor_price_book_version: number
          created_at?: string
          customer_total_cents: number
          estimated_payment_processing_cost_cents: number
          estimated_processing_fixed_cents: number
          estimated_processing_rate_bps: number
          expected_platform_net_contribution_cents: number
          failure_code?: string | null
          generation_number: number
          id?: string
          is_current?: boolean
          marketplace_settings_version: number
          minimum_contribution_margin_cents_applied: number
          order_id: string
          platform_gross_retained_cents: number
          platform_pricing_adjustment_cents: number
          predecessor_generation_id?: string | null
          provider_payment_intent_id?: string | null
          status: Database["domain"]["Enums"]["payment_generation_status"]
          stripe_processing_fee_cents?: number | null
          stripe_transfer_amount_cents: number
          updated_at?: string
        }
        Update: {
          actual_platform_net_transaction_cents?: number | null
          assignment_id?: string
          authorization_override?: boolean
          authorization_override_reason?: string | null
          authorization_target_at?: string
          capture_before?: string | null
          connected_account_id?: string
          contractor_gross_cents?: number
          contractor_marketplace_fee_cents?: number
          contractor_payout_cents?: number
          contractor_price_book_version?: number
          created_at?: string
          customer_total_cents?: number
          estimated_payment_processing_cost_cents?: number
          estimated_processing_fixed_cents?: number
          estimated_processing_rate_bps?: number
          expected_platform_net_contribution_cents?: number
          failure_code?: string | null
          generation_number?: number
          id?: string
          is_current?: boolean
          marketplace_settings_version?: number
          minimum_contribution_margin_cents_applied?: number
          order_id?: string
          platform_gross_retained_cents?: number
          platform_pricing_adjustment_cents?: number
          predecessor_generation_id?: string | null
          provider_payment_intent_id?: string | null
          status?: Database["domain"]["Enums"]["payment_generation_status"]
          stripe_processing_fee_cents?: number | null
          stripe_transfer_amount_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_generations_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "order_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_generations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_generations_predecessor_generation_id_fkey"
            columns: ["predecessor_generation_id"]
            isOneToOne: false
            referencedRelation: "payment_generations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_operation_exceptions: {
        Row: {
          assignment_id: string
          created_at: string
          failed_task_id: string
          id: string
          order_id: string
          payment_generation_id: string
          prior_order_status: Database["domain"]["Enums"]["order_status"]
          requeued_at: string | null
          requeued_task_id: string | null
          resolved_at: string | null
          safe_error: string
          status: string
          task_type: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          failed_task_id: string
          id?: string
          order_id: string
          payment_generation_id: string
          prior_order_status: Database["domain"]["Enums"]["order_status"]
          requeued_at?: string | null
          requeued_task_id?: string | null
          resolved_at?: string | null
          safe_error: string
          status?: string
          task_type: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          failed_task_id?: string
          id?: string
          order_id?: string
          payment_generation_id?: string
          prior_order_status?: Database["domain"]["Enums"]["order_status"]
          requeued_at?: string | null
          requeued_task_id?: string | null
          resolved_at?: string | null
          safe_error?: string
          status?: string
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_operation_exceptions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "order_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_operation_exceptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_operation_exceptions_payment_generation_id_fkey"
            columns: ["payment_generation_id"]
            isOneToOne: false
            referencedRelation: "payment_generations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          active: boolean
          auth_user_id: string
          created_at: string
          role: string
        }
        Insert: {
          active?: boolean
          auth_user_id: string
          created_at?: string
          role?: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string
          created_at?: string
          role?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address_line1: string
          address_line2: string | null
          city: string
          county_name: string
          created_at: string
          customer_id: string
          default_access_instructions: string | null
          id: string
          known_tank_tier: Database["domain"]["Enums"]["tank_tier"] | null
          last_pumped_on: string | null
          latitude: number
          longitude: number
          normalized_address: string
          postal_code: string
          septic_notes: string | null
          state_code: string
          updated_at: string
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          city: string
          county_name: string
          created_at?: string
          customer_id: string
          default_access_instructions?: string | null
          id?: string
          known_tank_tier?: Database["domain"]["Enums"]["tank_tier"] | null
          last_pumped_on?: string | null
          latitude: number
          longitude: number
          normalized_address: string
          postal_code: string
          septic_notes?: string | null
          state_code: string
          updated_at?: string
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          city?: string
          county_name?: string
          created_at?: string
          customer_id?: string
          default_access_instructions?: string | null
          id?: string
          known_tank_tier?: Database["domain"]["Enums"]["tank_tier"] | null
          last_pumped_on?: string | null
          latitude?: number
          longitude?: number
          normalized_address?: string
          postal_code?: string
          septic_notes?: string | null
          state_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_candidates: {
        Row: {
          contractor_company_id: string
          contractor_gross_cents: number
          contractor_marketplace_fee_cents: number
          contractor_payout_cents: number
          contractor_price_book_version: number
          created_at: string
          eligibility_snapshot: Json
          estimated_payment_processing_cost_cents: number
          expected_platform_net_contribution_cents: number
          id: string
          meets_guardrail: boolean
          platform_gross_retained_cents: number
          platform_pricing_adjustment_cents: number
          quote_id: string
          rank: number
          stripe_transfer_amount_cents: number
        }
        Insert: {
          contractor_company_id: string
          contractor_gross_cents: number
          contractor_marketplace_fee_cents: number
          contractor_payout_cents: number
          contractor_price_book_version: number
          created_at?: string
          eligibility_snapshot?: Json
          estimated_payment_processing_cost_cents: number
          expected_platform_net_contribution_cents: number
          id?: string
          meets_guardrail: boolean
          platform_gross_retained_cents: number
          platform_pricing_adjustment_cents: number
          quote_id: string
          rank: number
          stripe_transfer_amount_cents: number
        }
        Update: {
          contractor_company_id?: string
          contractor_gross_cents?: number
          contractor_marketplace_fee_cents?: number
          contractor_payout_cents?: number
          contractor_price_book_version?: number
          created_at?: string
          eligibility_snapshot?: Json
          estimated_payment_processing_cost_cents?: number
          expected_platform_net_contribution_cents?: number
          id?: string
          meets_guardrail?: boolean
          platform_gross_retained_cents?: number
          platform_pricing_adjustment_cents?: number
          quote_id?: string
          rank?: number
          stripe_transfer_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_candidates_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_candidates_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_economics_overrides: {
        Row: {
          admin_user_id: string
          created_at: string
          idempotency_key: string
          minimum_contribution_margin_cents: number
          quote_id: string
          reason: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          idempotency_key: string
          minimum_contribution_margin_cents: number
          quote_id: string
          reason: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          idempotency_key?: string
          minimum_contribution_margin_cents?: number
          quote_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_economics_overrides_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          access_type: Database["domain"]["Enums"]["access_type"]
          address_snapshot: Json
          converted_at: string | null
          created_at: string
          customer_fee_cents: number | null
          customer_id: string | null
          customer_subtotal_cents: number | null
          customer_total_cents: number | null
          estimated_payment_processing_cost_cents: number | null
          expires_at: string
          id: string
          idempotency_key: string
          marketplace_settings_version: number | null
          regional_price_book_version: number | null
          requested_service_date: string
          service_notes: string | null
          service_region_id: string | null
          service_window_start_at: string
          status: Database["domain"]["Enums"]["quote_status"]
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Insert: {
          access_type: Database["domain"]["Enums"]["access_type"]
          address_snapshot: Json
          converted_at?: string | null
          created_at?: string
          customer_fee_cents?: number | null
          customer_id?: string | null
          customer_subtotal_cents?: number | null
          customer_total_cents?: number | null
          estimated_payment_processing_cost_cents?: number | null
          expires_at: string
          id?: string
          idempotency_key?: string
          marketplace_settings_version?: number | null
          regional_price_book_version?: number | null
          requested_service_date: string
          service_notes?: string | null
          service_region_id?: string | null
          service_window_start_at: string
          status: Database["domain"]["Enums"]["quote_status"]
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Update: {
          access_type?: Database["domain"]["Enums"]["access_type"]
          address_snapshot?: Json
          converted_at?: string | null
          created_at?: string
          customer_fee_cents?: number | null
          customer_id?: string | null
          customer_subtotal_cents?: number | null
          customer_total_cents?: number | null
          estimated_payment_processing_cost_cents?: number | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          marketplace_settings_version?: number | null
          regional_price_book_version?: number | null
          requested_service_date?: string
          service_notes?: string | null
          service_region_id?: string | null
          service_window_start_at?: string
          status?: Database["domain"]["Enums"]["quote_status"]
          tank_tier?: Database["domain"]["Enums"]["tank_tier"]
          timing_kind?: Database["domain"]["Enums"]["timing_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_service_region_id_fkey"
            columns: ["service_region_id"]
            isOneToOne: false
            referencedRelation: "service_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          failure_message: string | null
          id: string
          idempotency_key: string
          order_id: string
          payment_generation_id: string
          provider_refund_id: string | null
          reason: string
          status: Database["domain"]["Enums"]["refund_status"]
          transfer_reversal_cents: number | null
          unrecovered_contractor_funds_cents: number | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          failure_message?: string | null
          id?: string
          idempotency_key: string
          order_id: string
          payment_generation_id: string
          provider_refund_id?: string | null
          reason: string
          status?: Database["domain"]["Enums"]["refund_status"]
          transfer_reversal_cents?: number | null
          unrecovered_contractor_funds_cents?: number | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          failure_message?: string | null
          id?: string
          idempotency_key?: string
          order_id?: string
          payment_generation_id?: string
          provider_refund_id?: string | null
          reason?: string
          status?: Database["domain"]["Enums"]["refund_status"]
          transfer_reversal_cents?: number | null
          unrecovered_contractor_funds_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_generation_id_fkey"
            columns: ["payment_generation_id"]
            isOneToOne: false
            referencedRelation: "payment_generations"
            referencedColumns: ["id"]
          },
        ]
      }
      regional_price_books: {
        Row: {
          active: boolean
          created_at: string
          effective_at: string
          id: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          effective_at?: string
          id?: string
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          effective_at?: string
          id?: string
          version?: number
        }
        Relationships: []
      }
      regional_price_rules: {
        Row: {
          customer_fee_cents: number
          customer_subtotal_cents: number
          id: string
          price_book_id: string
          service_region_id: string
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Insert: {
          customer_fee_cents?: number
          customer_subtotal_cents: number
          id?: string
          price_book_id: string
          service_region_id: string
          tank_tier: Database["domain"]["Enums"]["tank_tier"]
          timing_kind: Database["domain"]["Enums"]["timing_kind"]
        }
        Update: {
          customer_fee_cents?: number
          customer_subtotal_cents?: number
          id?: string
          price_book_id?: string
          service_region_id?: string
          tank_tier?: Database["domain"]["Enums"]["tank_tier"]
          timing_kind?: Database["domain"]["Enums"]["timing_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "regional_price_rules_price_book_id_fkey"
            columns: ["price_book_id"]
            isOneToOne: false
            referencedRelation: "regional_price_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regional_price_rules_service_region_id_fkey"
            columns: ["service_region_id"]
            isOneToOne: false
            referencedRelation: "service_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      service_regions: {
        Row: {
          active: boolean
          county_name: string | null
          id: string
          kind: Database["domain"]["Enums"]["region_kind"]
          normalized_key: string
          postal_code: string | null
          state_code: string
        }
        Insert: {
          active?: boolean
          county_name?: string | null
          id?: string
          kind: Database["domain"]["Enums"]["region_kind"]
          normalized_key: string
          postal_code?: string | null
          state_code: string
        }
        Update: {
          active?: boolean
          county_name?: string | null
          id?: string
          kind?: Database["domain"]["Enums"]["region_kind"]
          normalized_key?: string
          postal_code?: string | null
          state_code?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      access_type: "ATTENDED" | "UNATTENDED"
      contractor_status: "PENDING" | "APPROVED" | "DISABLED"
      ledger_entry_type:
        | "CAPTURE"
        | "CUSTOMER_REFUND"
        | "CONTRACTOR_TRANSFER"
        | "TRANSFER_REVERSAL"
        | "STRIPE_PROCESSING_FEE"
        | "DISPUTE_FEE"
        | "OTHER_PROVIDER_FEE"
      notification_status: "PENDING" | "SENDING" | "SENT" | "FAILED"
      offer_status: "OPEN" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN"
      order_status:
        | "SEARCHING_CONTRACTOR"
        | "SCHEDULED"
        | "EN_ROUTE"
        | "ARRIVED"
        | "SERVICE_COMPLETED"
        | "CLOSED"
        | "CANCELLED"
        | "FAILED_ACCESS"
        | "FAILED_SERVICE"
        | "REASSIGNMENT_PENDING"
        | "NEEDS_ADMIN_REVIEW"
      payment_generation_status:
        | "REQUESTED"
        | "AUTHORIZATION_SCHEDULED"
        | "AUTHORIZATION_PENDING"
        | "AUTHORIZED"
        | "CAPTURE_PENDING"
        | "CAPTURED"
        | "ACTION_REQUIRED"
        | "FAILED"
        | "CANCELLATION_PENDING"
        | "CANCELLED"
        | "SUPERSEDED"
      proof_status: "PENDING" | "VERIFIED" | "REJECTED"
      quote_status:
        | "PRICED"
        | "REVIEW_REQUIRED"
        | "UNAVAILABLE"
        | "UNSUPPORTED"
        | "EXPIRED"
        | "CONVERTED"
      refund_status: "REQUESTED" | "PENDING" | "SUCCEEDED" | "FAILED"
      region_kind: "COUNTY" | "ZIP"
      tank_tier: "GAL_750" | "GAL_1000" | "GAL_1250" | "GAL_1500" | "UNKNOWN"
      timing_kind: "SCHEDULED" | "EARLIEST" | "URGENT"
      work_status: "PENDING" | "LEASED" | "COMPLETED" | "FAILED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  api: {
    Enums: {},
  },
  domain: {
    Enums: {
      access_type: ["ATTENDED", "UNATTENDED"],
      contractor_status: ["PENDING", "APPROVED", "DISABLED"],
      ledger_entry_type: [
        "CAPTURE",
        "CUSTOMER_REFUND",
        "CONTRACTOR_TRANSFER",
        "TRANSFER_REVERSAL",
        "STRIPE_PROCESSING_FEE",
        "DISPUTE_FEE",
        "OTHER_PROVIDER_FEE",
      ],
      notification_status: ["PENDING", "SENDING", "SENT", "FAILED"],
      offer_status: ["OPEN", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"],
      order_status: [
        "SEARCHING_CONTRACTOR",
        "SCHEDULED",
        "EN_ROUTE",
        "ARRIVED",
        "SERVICE_COMPLETED",
        "CLOSED",
        "CANCELLED",
        "FAILED_ACCESS",
        "FAILED_SERVICE",
        "REASSIGNMENT_PENDING",
        "NEEDS_ADMIN_REVIEW",
      ],
      payment_generation_status: [
        "REQUESTED",
        "AUTHORIZATION_SCHEDULED",
        "AUTHORIZATION_PENDING",
        "AUTHORIZED",
        "CAPTURE_PENDING",
        "CAPTURED",
        "ACTION_REQUIRED",
        "FAILED",
        "CANCELLATION_PENDING",
        "CANCELLED",
        "SUPERSEDED",
      ],
      proof_status: ["PENDING", "VERIFIED", "REJECTED"],
      quote_status: [
        "PRICED",
        "REVIEW_REQUIRED",
        "UNAVAILABLE",
        "UNSUPPORTED",
        "EXPIRED",
        "CONVERTED",
      ],
      refund_status: ["REQUESTED", "PENDING", "SUCCEEDED", "FAILED"],
      region_kind: ["COUNTY", "ZIP"],
      tank_tier: ["GAL_750", "GAL_1000", "GAL_1250", "GAL_1500", "UNKNOWN"],
      timing_kind: ["SCHEDULED", "EARLIEST", "URGENT"],
      work_status: ["PENDING", "LEASED", "COMPLETED", "FAILED"],
    },
  },
} as const

