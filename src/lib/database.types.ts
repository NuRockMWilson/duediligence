export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          is_cfo: boolean
          is_pm: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          is_cfo?: boolean
          is_pm?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          is_cfo?: boolean
          is_pm?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cost_account_map: {
        Row: {
          account_description: string
          bank_draw_category: string | null
          cb_code: string | null
          created_at: string
          dca_reporting_category: string | null
          fhfc_dfcc_category: string | null
          fhfc_reporting_category: string | null
          gl_account: string
          is_eligible_basis: boolean | null
          is_interim_cost: boolean
          is_subject_to_contingency: boolean | null
          model_line_id: string | null
          notes: string | null
          standard_line_id: string | null
          texas_tdhca_category: string | null
          updated_at: string
        }
        Insert: {
          account_description: string
          bank_draw_category?: string | null
          cb_code?: string | null
          created_at?: string
          dca_reporting_category?: string | null
          fhfc_dfcc_category?: string | null
          fhfc_reporting_category?: string | null
          gl_account: string
          is_eligible_basis?: boolean | null
          is_interim_cost?: boolean
          is_subject_to_contingency?: boolean | null
          model_line_id?: string | null
          notes?: string | null
          standard_line_id?: string | null
          texas_tdhca_category?: string | null
          updated_at?: string
        }
        Update: {
          account_description?: string
          bank_draw_category?: string | null
          cb_code?: string | null
          created_at?: string
          dca_reporting_category?: string | null
          fhfc_dfcc_category?: string | null
          fhfc_reporting_category?: string | null
          gl_account?: string
          is_eligible_basis?: boolean | null
          is_interim_cost?: boolean
          is_subject_to_contingency?: boolean | null
          model_line_id?: string | null
          notes?: string | null
          standard_line_id?: string | null
          texas_tdhca_category?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_account_map_standard_line_id_fkey"
            columns: ["standard_line_id"]
            isOneToOne: false
            referencedRelation: "nurock_standard_schedule_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_versions: {
        Row: {
          created_at: string
          created_by: string
          deal_id: string
          id: string
          message: string | null
          model: Json
          name: string
          parent_version_id: string | null
          tag: string
          version_num: number
        }
        Insert: {
          created_at?: string
          created_by: string
          deal_id: string
          id?: string
          message?: string | null
          model: Json
          name: string
          parent_version_id?: string | null
          tag?: string
          version_num: number
        }
        Update: {
          created_at?: string
          created_by?: string
          deal_id?: string
          id?: string
          message?: string | null
          model?: Json
          name?: string
          parent_version_id?: string | null
          tag?: string
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_versions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_versions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "deal_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          created_at: string
          id: string
          is_custom_schedule: boolean
          model: Json
          name: string
          notes: string | null
          owner_id: string
          stage: string
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_custom_schedule?: boolean
          model: Json
          name: string
          notes?: string | null
          owner_id: string
          stage?: string
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_custom_schedule?: boolean
          model?: Json
          name?: string
          notes?: string | null
          owner_id?: string
          stage?: string
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      dm_affiliates: {
        Row: {
          created_at: string
          deal_id: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      dm_app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      dm_buildings: {
        Row: {
          address: string | null
          bin: string | null
          building_name: string | null
          building_number: number
          created_at: string
          deal_id: string
          id: string
          notes: string | null
          placed_in_service_date: string | null
          square_footage: number | null
          unit_count: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          bin?: string | null
          building_name?: string | null
          building_number: number
          created_at?: string
          deal_id: string
          id?: string
          notes?: string | null
          placed_in_service_date?: string | null
          square_footage?: number | null
          unit_count?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          bin?: string | null
          building_name?: string | null
          building_number?: number
          created_at?: string
          deal_id?: string
          id?: string
          notes?: string | null
          placed_in_service_date?: string | null
          square_footage?: number | null
          unit_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_buildings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_buildings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_change_order_lines: {
        Row: {
          change_order_id: string
          created_at: string
          delta_amount: number
          draw_schedule_line_id: string
          id: string
          notes: string | null
        }
        Insert: {
          change_order_id: string
          created_at?: string
          delta_amount: number
          draw_schedule_line_id: string
          id?: string
          notes?: string | null
        }
        Update: {
          change_order_id?: string
          created_at?: string
          delta_amount?: number
          draw_schedule_line_id?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_change_order_lines_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "dm_change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_change_order_lines_draw_schedule_line_id_fkey"
            columns: ["draw_schedule_line_id"]
            isOneToOne: false
            referencedRelation: "dm_draw_schedule_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_change_orders: {
        Row: {
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          co_number: number
          created_at: string
          deal_id: string
          description: string
          id: string
          metadata: Json
          notes: string | null
          reason: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          total_amount: number
          type: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          co_number: number
          created_at?: string
          deal_id: string
          description: string
          id?: string
          metadata?: Json
          notes?: string | null
          reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_amount?: number
          type?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          co_number?: number
          created_at?: string
          deal_id?: string
          description?: string
          id?: string
          metadata?: Json
          notes?: string | null
          reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_amount?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_change_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_change_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_cost_cert_allocations: {
        Row: {
          allocation_method: string
          created_at: string
          deal_id: string
          id: string
          manual_allocations: Json | null
          notes: string | null
          standard_schedule_line_id: string
          updated_at: string
        }
        Insert: {
          allocation_method?: string
          created_at?: string
          deal_id: string
          id?: string
          manual_allocations?: Json | null
          notes?: string | null
          standard_schedule_line_id: string
          updated_at?: string
        }
        Update: {
          allocation_method?: string
          created_at?: string
          deal_id?: string
          id?: string
          manual_allocations?: Json | null
          notes?: string | null
          standard_schedule_line_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_cost_cert_allocations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_cost_cert_allocations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_cost_cert_allocations_standard_schedule_line_id_fkey"
            columns: ["standard_schedule_line_id"]
            isOneToOne: false
            referencedRelation: "nurock_standard_schedule_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_deal_access: {
        Row: {
          added_at: string
          added_by: string
          deal_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          deal_id: string
          role: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          deal_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_deal_access_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_deal_access_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_deal_formats: {
        Row: {
          created_at: string
          deal_id: string
          format_id: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          format_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          format_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_deal_formats_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_deal_formats_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_deal_formats_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "nurock_schedule_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_draw_line_allocations: {
        Row: {
          amount: number
          created_at: string
          draw_line_id: string
          funding_source_id: string
          id: string
          is_manual_override: boolean
          metadata: Json
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          draw_line_id: string
          funding_source_id: string
          id?: string
          is_manual_override?: boolean
          metadata?: Json
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          draw_line_id?: string
          funding_source_id?: string
          id?: string
          is_manual_override?: boolean
          metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_draw_line_allocations_draw_line_id_fkey"
            columns: ["draw_line_id"]
            isOneToOne: false
            referencedRelation: "dm_draw_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_draw_line_allocations_funding_source_id_fkey"
            columns: ["funding_source_id"]
            isOneToOne: false
            referencedRelation: "dm_funding_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_draw_lines: {
        Row: {
          created_at: string
          description: string | null
          draw_id: string
          draw_schedule_line_id: string | null
          funding_source_id: string | null
          gl_account: string
          gross_amount: number
          id: string
          invoice_id: string | null
          metadata: Json
          net_amount: number | null
          retainage_amount: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          draw_id: string
          draw_schedule_line_id?: string | null
          funding_source_id?: string | null
          gl_account: string
          gross_amount: number
          id?: string
          invoice_id?: string | null
          metadata?: Json
          net_amount?: number | null
          retainage_amount?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          draw_id?: string
          draw_schedule_line_id?: string | null
          funding_source_id?: string | null
          gl_account?: string
          gross_amount?: number
          id?: string
          invoice_id?: string | null
          metadata?: Json
          net_amount?: number | null
          retainage_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "dm_draw_lines_draw_id_fkey"
            columns: ["draw_id"]
            isOneToOne: false
            referencedRelation: "dm_draws"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_draw_lines_draw_schedule_line_id_fkey"
            columns: ["draw_schedule_line_id"]
            isOneToOne: false
            referencedRelation: "dm_draw_schedule_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_draw_lines_funding_source_id_fkey"
            columns: ["funding_source_id"]
            isOneToOne: false
            referencedRelation: "dm_funding_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_draw_lines_gl_account_fkey"
            columns: ["gl_account"]
            isOneToOne: false
            referencedRelation: "cost_account_map"
            referencedColumns: ["gl_account"]
          },
          {
            foreignKeyName: "dm_draw_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "dm_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_draw_schedule_lines: {
        Row: {
          created_at: string
          deal_id: string
          description: string
          format_id: string
          id: string
          item_number: number
          metadata: Json
          original_budget: number
          revised_budget: number
          schedule_id: string
          section: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          description: string
          format_id?: string
          id?: string
          item_number: number
          metadata?: Json
          original_budget?: number
          revised_budget?: number
          schedule_id: string
          section: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          description?: string
          format_id?: string
          id?: string
          item_number?: number
          metadata?: Json
          original_budget?: number
          revised_budget?: number
          schedule_id?: string
          section?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_draw_schedule_lines_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "nurock_schedule_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_draw_schedule_lines_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "dm_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_draw_schedule_lines_pre_8_14: {
        Row: {
          created_at: string | null
          deal_id: string | null
          description: string | null
          id: string | null
          item_number: number | null
          metadata: Json | null
          original_budget: number | null
          revised_budget: number | null
          schedule_id: string | null
          section: string | null
          snapshot_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string | null
          item_number?: number | null
          metadata?: Json | null
          original_budget?: number | null
          revised_budget?: number | null
          schedule_id?: string | null
          section?: string | null
          snapshot_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string | null
          item_number?: number | null
          metadata?: Json | null
          original_budget?: number | null
          revised_budget?: number | null
          schedule_id?: string | null
          section?: string | null
          snapshot_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dm_draw_status_history: {
        Row: {
          actor: string
          draw_id: string
          from_status: string | null
          id: string
          notes: string | null
          to_status: string
          transitioned_at: string
        }
        Insert: {
          actor: string
          draw_id: string
          from_status?: string | null
          id?: string
          notes?: string | null
          to_status: string
          transitioned_at?: string
        }
        Update: {
          actor?: string
          draw_id?: string
          from_status?: string | null
          id?: string
          notes?: string | null
          to_status?: string
          transitioned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_draw_status_history_draw_id_fkey"
            columns: ["draw_id"]
            isOneToOne: false
            referencedRelation: "dm_draws"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_draws: {
        Row: {
          allocation_mode: string
          cfo_approved_at: string | null
          cfo_approved_by: string | null
          copilot_findings: Json
          copilot_score: number | null
          created_at: string
          deal_id: string
          draw_number: number
          funded_at: string | null
          funded_by: string | null
          id: string
          lender_approved_at: string | null
          lender_approved_by: string | null
          metadata: Json
          package_url: string | null
          period_end: string | null
          period_start: string | null
          pm_approved_at: string | null
          pm_approved_by: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          total_gross_amount: number
          total_net_amount: number | null
          total_retainage_amount: number
          updated_at: string
          uw_baseline_version_id: string | null
        }
        Insert: {
          allocation_mode?: string
          cfo_approved_at?: string | null
          cfo_approved_by?: string | null
          copilot_findings?: Json
          copilot_score?: number | null
          created_at?: string
          deal_id: string
          draw_number: number
          funded_at?: string | null
          funded_by?: string | null
          id?: string
          lender_approved_at?: string | null
          lender_approved_by?: string | null
          metadata?: Json
          package_url?: string | null
          period_end?: string | null
          period_start?: string | null
          pm_approved_at?: string | null
          pm_approved_by?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_gross_amount?: number
          total_net_amount?: number | null
          total_retainage_amount?: number
          updated_at?: string
          uw_baseline_version_id?: string | null
        }
        Update: {
          allocation_mode?: string
          cfo_approved_at?: string | null
          cfo_approved_by?: string | null
          copilot_findings?: Json
          copilot_score?: number | null
          created_at?: string
          deal_id?: string
          draw_number?: number
          funded_at?: string | null
          funded_by?: string | null
          id?: string
          lender_approved_at?: string | null
          lender_approved_by?: string | null
          metadata?: Json
          package_url?: string | null
          period_end?: string | null
          period_start?: string | null
          pm_approved_at?: string | null
          pm_approved_by?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_gross_amount?: number
          total_net_amount?: number | null
          total_retainage_amount?: number
          updated_at?: string
          uw_baseline_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_draws_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_draws_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_draws_uw_baseline_version_id_fkey"
            columns: ["uw_baseline_version_id"]
            isOneToOne: false
            referencedRelation: "deal_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_eligible_basis_overrides: {
        Row: {
          created_at: string
          deal_id: string
          eligible_pct: number
          id: string
          notes: string | null
          standard_schedule_line_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          eligible_pct?: number
          id?: string
          notes?: string | null
          standard_schedule_line_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          eligible_pct?: number
          id?: string
          notes?: string | null
          standard_schedule_line_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_eligible_basis_overrides_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_eligible_basis_overrides_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_eligible_basis_overrides_standard_schedule_line_id_fkey"
            columns: ["standard_schedule_line_id"]
            isOneToOne: false
            referencedRelation: "nurock_standard_schedule_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_funding_source_tranches: {
        Row: {
          actual_release_date: string | null
          amount: number
          created_at: string
          funding_source_id: string
          id: string
          label: string
          metadata: Json
          milestone: string | null
          notes: string | null
          position: number
          projected_release_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_release_date?: string | null
          amount: number
          created_at?: string
          funding_source_id: string
          id?: string
          label: string
          metadata?: Json
          milestone?: string | null
          notes?: string | null
          position?: number
          projected_release_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_release_date?: string | null
          amount?: number
          created_at?: string
          funding_source_id?: string
          id?: string
          label?: string
          metadata?: Json
          milestone?: string | null
          notes?: string | null
          position?: number
          projected_release_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_funding_source_tranches_funding_source_id_fkey"
            columns: ["funding_source_id"]
            isOneToOne: false
            referencedRelation: "dm_funding_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_funding_sources: {
        Row: {
          commitment_amount: number
          created_at: string
          deal_id: string
          drawn_amount: number
          id: string
          interest_rate_basis: string | null
          interest_rate_spread: number | null
          kind: string
          lender_name: string | null
          maturity_date: string | null
          metadata: Json
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          commitment_amount?: number
          created_at?: string
          deal_id: string
          drawn_amount?: number
          id?: string
          interest_rate_basis?: string | null
          interest_rate_spread?: number | null
          kind: string
          lender_name?: string | null
          maturity_date?: string | null
          metadata?: Json
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          commitment_amount?: number
          created_at?: string
          deal_id?: string
          drawn_amount?: number
          id?: string
          interest_rate_basis?: string | null
          interest_rate_spread?: number | null
          kind?: string
          lender_name?: string | null
          maturity_date?: string | null
          metadata?: Json
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_funding_sources_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_funding_sources_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_gl_mapping_overrides: {
        Row: {
          created_at: string
          deal_id: string
          gl_account: string
          id: string
          model_line_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          gl_account: string
          id?: string
          model_line_id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          gl_account?: string
          id?: string
          model_line_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_gl_mapping_overrides_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_gl_mapping_overrides_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_gl_mapping_overrides_gl_account_fkey"
            columns: ["gl_account"]
            isOneToOne: false
            referencedRelation: "cost_account_map"
            referencedColumns: ["gl_account"]
          },
        ]
      }
      dm_gl_to_schedule_map_backup: {
        Row: {
          created_at: string | null
          deal_id: string | null
          draw_schedule_line_id: string | null
          gl_account: string | null
          notes: string | null
          schedule_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          draw_schedule_line_id?: string | null
          gl_account?: string | null
          notes?: string | null
          schedule_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          draw_schedule_line_id?: string | null
          gl_account?: string | null
          notes?: string | null
          schedule_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dm_invoice_lines: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          eligible_amount: number | null
          funding_source_id: string | null
          gl_account: string
          id: string
          ineligible_amount: number | null
          interim_cost_type: string | null
          invoice_id: string
          metadata: Json
          retainage_amount: number
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          eligible_amount?: number | null
          funding_source_id?: string | null
          gl_account: string
          id?: string
          ineligible_amount?: number | null
          interim_cost_type?: string | null
          invoice_id: string
          metadata?: Json
          retainage_amount?: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          eligible_amount?: number | null
          funding_source_id?: string | null
          gl_account?: string
          id?: string
          ineligible_amount?: number | null
          interim_cost_type?: string | null
          invoice_id?: string
          metadata?: Json
          retainage_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "dm_invoice_lines_funding_source_id_fkey"
            columns: ["funding_source_id"]
            isOneToOne: false
            referencedRelation: "dm_funding_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_invoice_lines_gl_account_fkey"
            columns: ["gl_account"]
            isOneToOne: false
            referencedRelation: "cost_account_map"
            referencedColumns: ["gl_account"]
          },
          {
            foreignKeyName: "dm_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "dm_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_invoices: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attachment_path: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          deal_id: string
          draw_id: string | null
          due_date: string | null
          file_path: string | null
          gross_amount: number
          hold_reason: string | null
          id: string
          invoice_date: string
          invoice_number: string
          metadata: Json
          net_amount: number | null
          notes: string | null
          paid_by_affiliate_id: string | null
          payment_date: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: string
          period_end: string | null
          period_start: string | null
          reimbursement_date: string | null
          retainage_amount: number
          source_kind: string | null
          source_url: string | null
          status: string
          updated_at: string
          vendor_id: string | null
          vendor_name: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          deal_id: string
          draw_id?: string | null
          due_date?: string | null
          file_path?: string | null
          gross_amount: number
          hold_reason?: string | null
          id?: string
          invoice_date: string
          invoice_number: string
          metadata?: Json
          net_amount?: number | null
          notes?: string | null
          paid_by_affiliate_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string
          period_end?: string | null
          period_start?: string | null
          reimbursement_date?: string | null
          retainage_amount?: number
          source_kind?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string | null
          vendor_name: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string
          draw_id?: string | null
          due_date?: string | null
          file_path?: string | null
          gross_amount?: number
          hold_reason?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          metadata?: Json
          net_amount?: number | null
          notes?: string | null
          paid_by_affiliate_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string
          period_end?: string | null
          period_start?: string | null
          reimbursement_date?: string | null
          retainage_amount?: number
          source_kind?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string | null
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_invoices_draw_id_fkey"
            columns: ["draw_id"]
            isOneToOne: false
            referencedRelation: "dm_draws"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_invoices_paid_by_affiliate_id_fkey"
            columns: ["paid_by_affiliate_id"]
            isOneToOne: false
            referencedRelation: "dm_affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_lease_up_schedule: {
        Row: {
          created_at: string
          deal_id: string
          id: string
          month_year: string
          notes: string | null
          units_leased: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          id?: string
          month_year: string
          notes?: string | null
          units_leased?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          id?: string
          month_year?: string
          notes?: string | null
          units_leased?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_lease_up_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_lease_up_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_milestones: {
        Row: {
          actual_date: string | null
          created_at: string
          deal_id: string
          id: string
          kind: string
          label: string
          metadata: Json
          notes: string | null
          sort_order: number
          status: string
          target_date: string | null
          updated_at: string
        }
        Insert: {
          actual_date?: string | null
          created_at?: string
          deal_id: string
          id?: string
          kind: string
          label: string
          metadata?: Json
          notes?: string | null
          sort_order?: number
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          actual_date?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          kind?: string
          label?: string
          metadata?: Json
          notes?: string | null
          sort_order?: number
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_notifications: {
        Row: {
          body: string | null
          created_at: string
          deal_id: string | null
          href: string | null
          id: string
          kind: string
          metadata: Json
          read_at: string | null
          recipient_user_id: string
          subject: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          deal_id?: string | null
          href?: string | null
          id?: string
          kind: string
          metadata?: Json
          read_at?: string | null
          recipient_user_id: string
          subject: string
        }
        Update: {
          body?: string | null
          created_at?: string
          deal_id?: string | null
          href?: string | null
          id?: string
          kind?: string
          metadata?: Json
          read_at?: string | null
          recipient_user_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_realign_orphans: {
        Row: {
          deal_id: string
          id: string
          logged_at: string
          source_line_id: string
          uw_amount: number
          uw_category: string | null
          uw_description: string | null
        }
        Insert: {
          deal_id: string
          id?: string
          logged_at?: string
          source_line_id: string
          uw_amount?: number
          uw_category?: string | null
          uw_description?: string | null
        }
        Update: {
          deal_id?: string
          id?: string
          logged_at?: string
          source_line_id?: string
          uw_amount?: number
          uw_category?: string | null
          uw_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_realign_orphans_deal_fk"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_realign_orphans_deal_fk"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_report_schedule_lines: {
        Row: {
          created_at: string
          deal_id: string
          description: string
          format_id: string
          id: string
          item_number: number
          metadata: Json
          original_budget: number
          revised_budget: number
          section: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          description: string
          format_id: string
          id?: string
          item_number: number
          metadata?: Json
          original_budget?: number
          revised_budget?: number
          section: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          description?: string
          format_id?: string
          id?: string
          item_number?: number
          metadata?: Json
          original_budget?: number
          revised_budget?: number
          section?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_report_schedule_lines_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_report_schedule_lines_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_report_schedule_lines_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "nurock_schedule_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_schedule_line_to_standard: {
        Row: {
          created_at: string
          deal_id: string
          draw_schedule_line_id: string
          id: string
          standard_line_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          draw_schedule_line_id: string
          id?: string
          standard_line_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          draw_schedule_line_id?: string
          id?: string
          standard_line_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_schedule_line_to_standard_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_promote_status"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dm_schedule_line_to_standard_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_schedule_line_to_standard_draw_schedule_line_id_fkey"
            columns: ["draw_schedule_line_id"]
            isOneToOne: false
            referencedRelation: "dm_draw_schedule_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_schedule_line_to_standard_standard_line_id_fkey"
            columns: ["standard_line_id"]
            isOneToOne: false
            referencedRelation: "nurock_standard_schedule_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_schedules: {
        Row: {
          created_at: string
          deal_id: string
          description: string | null
          id: string
          is_primary: boolean
          kind: string
          metadata: Json
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          description?: string | null
          id?: string
          is_primary?: boolean
          kind: string
          metadata?: Json
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          description?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          metadata?: Json
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
      dm_underwriting_line_gl: {
        Row: {
          gl_account: string
          source_line_id: string
          updated_at: string | null
        }
        Insert: {
          gl_account: string
          source_line_id: string
          updated_at?: string | null
        }
        Update: {
          gl_account?: string
          source_line_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_underwriting_line_gl_gl_account_fkey"
            columns: ["gl_account"]
            isOneToOne: false
            referencedRelation: "cost_account_map"
            referencedColumns: ["gl_account"]
          },
        ]
      }
      dm_vendors: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          coi_expires_at: string | null
          coi_file_path: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          dba_name: string | null
          id: string
          is_1099_required: boolean
          metadata: Json
          name: string
          notes: string | null
          payment_terms_days: number
          sage_vendor_id: string | null
          state: string | null
          status: string
          tax_id: string | null
          updated_at: string
          vendor_kind: string | null
          w9_file_path: string | null
          w9_received_at: string | null
          zip: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          coi_expires_at?: string | null
          coi_file_path?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          dba_name?: string | null
          id?: string
          is_1099_required?: boolean
          metadata?: Json
          name: string
          notes?: string | null
          payment_terms_days?: number
          sage_vendor_id?: string | null
          state?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
          vendor_kind?: string | null
          w9_file_path?: string | null
          w9_received_at?: string | null
          zip?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          coi_expires_at?: string | null
          coi_file_path?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          dba_name?: string | null
          id?: string
          is_1099_required?: boolean
          metadata?: Json
          name?: string
          notes?: string | null
          payment_terms_days?: number
          sage_vendor_id?: string | null
          state?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
          vendor_kind?: string | null
          w9_file_path?: string | null
          w9_received_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      excel_aggregation_mapping: {
        Row: {
          created_at: string | null
          excel_description: string
          excel_item_number: number
          excel_section: string
          id: string
          notes: string | null
          split_fraction: number | null
          updated_at: string | null
          uw_descriptions: string[] | null
        }
        Insert: {
          created_at?: string | null
          excel_description: string
          excel_item_number: number
          excel_section: string
          id?: string
          notes?: string | null
          split_fraction?: number | null
          updated_at?: string | null
          uw_descriptions?: string[] | null
        }
        Update: {
          created_at?: string | null
          excel_description?: string
          excel_item_number?: number
          excel_section?: string
          id?: string
          notes?: string | null
          split_fraction?: number | null
          updated_at?: string | null
          uw_descriptions?: string[] | null
        }
        Relationships: []
      }
      gl_to_format_line: {
        Row: {
          created_at: string
          format_id: string
          gl_account: string
          id: string
          other_description: string | null
          schedule_line_id: string
          split_fraction: number
          split_group_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          format_id: string
          gl_account: string
          id?: string
          other_description?: string | null
          schedule_line_id: string
          split_fraction?: number
          split_group_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          format_id?: string
          gl_account?: string
          id?: string
          other_description?: string | null
          schedule_line_id?: string
          split_fraction?: number
          split_group_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_to_format_line_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "nurock_schedule_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_to_format_line_gl_account_fkey"
            columns: ["gl_account"]
            isOneToOne: false
            referencedRelation: "cost_account_map"
            referencedColumns: ["gl_account"]
          },
          {
            foreignKeyName: "gl_to_format_line_schedule_line_id_fkey"
            columns: ["schedule_line_id"]
            isOneToOne: false
            referencedRelation: "nurock_standard_schedule_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      nurock_schedule_formats: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      nurock_schedule_line_members: {
        Row: {
          created_at: string
          member_line_id: string
          parent_line_id: string
        }
        Insert: {
          created_at?: string
          member_line_id: string
          parent_line_id: string
        }
        Update: {
          created_at?: string
          member_line_id?: string
          parent_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurock_schedule_line_members_member_line_id_fkey"
            columns: ["member_line_id"]
            isOneToOne: false
            referencedRelation: "nurock_standard_schedule_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurock_schedule_line_members_parent_line_id_fkey"
            columns: ["parent_line_id"]
            isOneToOne: false
            referencedRelation: "nurock_standard_schedule_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      nurock_standard_schedule_lines: {
        Row: {
          created_at: string
          default_category: string | null
          description: string
          format_id: string
          id: string
          line_number: number
          line_type: string
          notes: string | null
          section: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_category?: string | null
          description: string
          format_id: string
          id?: string
          line_number: number
          line_type?: string
          notes?: string | null
          section: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_category?: string | null
          description?: string
          format_id?: string
          id?: string
          line_number?: number
          line_type?: string
          notes?: string | null
          section?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurock_standard_schedule_lines_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "nurock_schedule_formats"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      deal_promote_status: {
        Row: {
          deal_id: string | null
          dm_line_count: number | null
          dm_total: number | null
          is_custom_schedule: boolean | null
          orphan_count: number | null
          rows_with_variance: number | null
          status: string | null
          total_variance: number | null
          uw_total: number | null
        }
        Relationships: []
      }
      dm_gl_to_schedule_map: {
        Row: {
          deal_id: string | null
          draw_schedule_line_id: string | null
          gl_account: string | null
          notes: string | null
          schedule_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      dm_user_has_access: {
        Args: { p_deal_id: string; p_min_role?: string }
        Returns: boolean
      }
      next_version_num: { Args: { _deal_id: string }; Returns: number }
      realign_deal_to_excel_format: {
        Args: {
          p_deal_id: string
          p_dry_run?: boolean
          p_force?: boolean
          p_zero_unmapped?: boolean
        }
        Returns: {
          computed_amount: number
          description: string
          item_number: number
          section: string
          source_basis: string
        }[]
      }
      realign_deal_to_excel_format_v8_legacy: {
        Args: {
          p_deal_id: string
          p_dry_run?: boolean
          p_zero_unmapped?: boolean
        }
        Returns: {
          computed_amount: number
          description: string
          item_number: number
          section: string
          source_basis: string
        }[]
      }
      regenerate_report_schedule_lines: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      reset_deal_budget_to_uw: {
        Args: { p_deal_id: string }
        Returns: {
          manual_overrides_cleared: number
          rows_realigned: number
          status: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
