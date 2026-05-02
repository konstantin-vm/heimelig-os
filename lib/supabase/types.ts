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
      articles: {
        Row: {
          article_number: string
          bexio_article_id: number | null
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          height_cm: number | null
          id: string
          is_active: boolean
          is_serialized: boolean
          length_cm: number | null
          manufacturer: string | null
          manufacturer_ref: string | null
          min_stock: number | null
          name: string
          notes: string | null
          purchase_price: number | null
          type: string
          unit: string
          updated_at: string
          updated_by: string | null
          variant_label: string | null
          variant_of_id: string | null
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          article_number: string
          bexio_article_id?: number | null
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          height_cm?: number | null
          id?: string
          is_active?: boolean
          is_serialized: boolean
          length_cm?: number | null
          manufacturer?: string | null
          manufacturer_ref?: string | null
          min_stock?: number | null
          name: string
          notes?: string | null
          purchase_price?: number | null
          type: string
          unit: string
          updated_at?: string
          updated_by?: string | null
          variant_label?: string | null
          variant_of_id?: string | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          article_number?: string
          bexio_article_id?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          height_cm?: number | null
          id?: string
          is_active?: boolean
          is_serialized?: boolean
          length_cm?: number | null
          manufacturer?: string | null
          manufacturer_ref?: string | null
          min_stock?: number | null
          name?: string
          notes?: string | null
          purchase_price?: number | null
          type?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
          variant_label?: string | null
          variant_of_id?: string | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_variant_of_id_fkey"
            columns: ["variant_of_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_system: string | null
          actor_user_id: string | null
          after_values: Json | null
          before_values: Json | null
          created_at: string
          details: Json | null
          entity: string
          entity_id: string
          id: string
          ip_address: unknown
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_system?: string | null
          actor_user_id?: string | null
          after_values?: Json | null
          before_values?: Json | null
          created_at?: string
          details?: Json | null
          entity: string
          entity_id: string
          id?: string
          ip_address?: unknown
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_system?: string | null
          actor_user_id?: string | null
          after_values?: Json | null
          before_values?: Json | null
          created_at?: string
          details?: Json | null
          entity?: string
          entity_id?: string
          id?: string
          ip_address?: unknown
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      bexio_credentials: {
        Row: {
          access_token_encrypted: string
          bexio_company_id: string | null
          created_at: string
          created_by: string | null
          environment: string
          expires_at: string
          id: string
          is_active: boolean
          last_refreshed_at: string | null
          notes: string | null
          refresh_count: number
          refresh_token_encrypted: string
          scope: string | null
          token_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_token_encrypted: string
          bexio_company_id?: string | null
          created_at?: string
          created_by?: string | null
          environment?: string
          expires_at: string
          id?: string
          is_active?: boolean
          last_refreshed_at?: string | null
          notes?: string | null
          refresh_count?: number
          refresh_token_encrypted: string
          scope?: string | null
          token_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_token_encrypted?: string
          bexio_company_id?: string | null
          created_at?: string
          created_by?: string | null
          environment?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          last_refreshed_at?: string | null
          notes?: string | null
          refresh_count?: number
          refresh_token_encrypted?: string
          scope?: string | null
          token_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bexio_credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bexio_credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bexio_credentials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bexio_credentials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      bexio_oauth_states: {
        Row: {
          created_at: string
          created_by: string | null
          environment: string
          expires_at: string
          state: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment: string
          expires_at?: string
          state: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment?: string
          expires_at?: string
          state?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bexio_oauth_states_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bexio_oauth_states_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_persons: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          email: string | null
          first_name: string
          id: string
          is_active: boolean
          is_primary_contact: boolean
          last_name: string
          notes: string | null
          organization: string | null
          phone: string | null
          role: string
          salutation: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          email?: string | null
          first_name: string
          id?: string
          is_active?: boolean
          is_primary_contact?: boolean
          last_name: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role: string
          salutation?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          email?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          is_primary_contact?: boolean
          last_name?: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role?: string
          salutation?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_persons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_persons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_persons_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_persons_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_persons_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          access_notes: string | null
          address_type: string
          city: string
          country: string
          created_at: string
          created_by: string | null
          customer_id: string
          floor: string | null
          geocoded_at: string | null
          has_elevator: string | null
          id: string
          is_active: boolean
          is_default_for_type: boolean
          lat: number | null
          lng: number | null
          recipient_name: string | null
          street: string
          street_number: string | null
          updated_at: string
          updated_by: string | null
          zip: string
        }
        Insert: {
          access_notes?: string | null
          address_type: string
          city: string
          country?: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          floor?: string | null
          geocoded_at?: string | null
          has_elevator?: string | null
          id?: string
          is_active?: boolean
          is_default_for_type?: boolean
          lat?: number | null
          lng?: number | null
          recipient_name?: string | null
          street: string
          street_number?: string | null
          updated_at?: string
          updated_by?: string | null
          zip: string
        }
        Update: {
          access_notes?: string | null
          address_type?: string
          city?: string
          country?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          floor?: string | null
          geocoded_at?: string | null
          has_elevator?: string | null
          id?: string
          is_active?: boolean
          is_default_for_type?: boolean
          lat?: number | null
          lng?: number | null
          recipient_name?: string | null
          street?: string
          street_number?: string | null
          updated_at?: string
          updated_by?: string | null
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_insurance: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          insurance_number: string | null
          insurance_type: string
          insurer_name_freetext: string | null
          is_active: boolean
          is_primary: boolean
          partner_insurer_id: string | null
          updated_at: string
          updated_by: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          insurance_number?: string | null
          insurance_type?: string
          insurer_name_freetext?: string | null
          is_active?: boolean
          is_primary?: boolean
          partner_insurer_id?: string | null
          updated_at?: string
          updated_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          insurance_number?: string | null
          insurance_type?: string
          insurer_name_freetext?: string | null
          is_active?: boolean
          is_primary?: boolean
          partner_insurer_id?: string | null
          updated_at?: string
          updated_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_insurance_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_insurance_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_insurance_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_insurance_partner_insurer_id_fkey"
            columns: ["partner_insurer_id"]
            isOneToOne: false
            referencedRelation: "partner_insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_insurance_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_insurance_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          acquisition_channel: string | null
          addressee_line: string | null
          bexio_contact_id: number | null
          bexio_sync_status: string
          bexio_synced_at: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          customer_number: string
          customer_type: string
          date_of_birth: string | null
          email: string | null
          first_name: string | null
          height_cm: number | null
          id: string
          is_active: boolean
          iv_dossier_number: string | null
          iv_marker: boolean
          language: string
          last_name: string | null
          marketing_consent: boolean
          mobile: string | null
          notes: string | null
          phone: string | null
          salutation: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
          weight_kg: number | null
        }
        Insert: {
          acquisition_channel?: string | null
          addressee_line?: string | null
          bexio_contact_id?: number | null
          bexio_sync_status?: string
          bexio_synced_at?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_number?: string
          customer_type?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          height_cm?: number | null
          id?: string
          is_active?: boolean
          iv_dossier_number?: string | null
          iv_marker?: boolean
          language?: string
          last_name?: string | null
          marketing_consent?: boolean
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          salutation?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Update: {
          acquisition_channel?: string | null
          addressee_line?: string | null
          bexio_contact_id?: number | null
          bexio_sync_status?: string
          bexio_synced_at?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_number?: string
          customer_type?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          height_cm?: number | null
          id?: string
          is_active?: boolean
          iv_dossier_number?: string | null
          iv_marker?: boolean
          language?: string
          last_name?: string | null
          marketing_consent?: boolean
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          salutation?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          acquired_at: string | null
          acquisition_price: number | null
          article_id: string
          condition: string
          created_at: string
          created_by: string | null
          current_contract_id: string | null
          current_warehouse_id: string | null
          id: string
          inbound_date: string | null
          notes: string | null
          outbound_date: string | null
          qr_code: string | null
          reserved_at: string | null
          reserved_for_customer_id: string | null
          retired_at: string | null
          serial_number: string
          status: string
          supplier_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acquired_at?: string | null
          acquisition_price?: number | null
          article_id: string
          condition?: string
          created_at?: string
          created_by?: string | null
          current_contract_id?: string | null
          current_warehouse_id?: string | null
          id?: string
          inbound_date?: string | null
          notes?: string | null
          outbound_date?: string | null
          qr_code?: string | null
          reserved_at?: string | null
          reserved_for_customer_id?: string | null
          retired_at?: string | null
          serial_number: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acquired_at?: string | null
          acquisition_price?: number | null
          article_id?: string
          condition?: string
          created_at?: string
          created_by?: string | null
          current_contract_id?: string | null
          current_warehouse_id?: string | null
          id?: string
          inbound_date?: string | null
          notes?: string | null
          outbound_date?: string | null
          qr_code?: string | null
          reserved_at?: string | null
          reserved_for_customer_id?: string | null
          retired_at?: string | null
          serial_number?: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_current_warehouse_id_fkey"
            columns: ["current_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_reserved_for_customer_id_fkey"
            columns: ["reserved_for_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      error_log: {
        Row: {
          created_at: string
          details: Json | null
          entity: string | null
          entity_id: string | null
          error_type: string
          id: string
          message: string
          request_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          error_type: string
          id?: string
          message: string
          request_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          error_type?: string
          id?: string
          message?: string
          request_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_log_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_log_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_insurers: {
        Row: {
          bexio_contact_id: number | null
          billing_city: string | null
          billing_street: string | null
          billing_street_number: string | null
          billing_zip: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          max_monthly_reimbursement: number
          name: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bexio_contact_id?: number | null
          billing_city?: string | null
          billing_street?: string | null
          billing_street_number?: string | null
          billing_zip?: string | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_monthly_reimbursement?: number
          name: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bexio_contact_id?: number | null
          billing_city?: string | null
          billing_street?: string | null
          billing_street_number?: string | null
          billing_zip?: string | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_monthly_reimbursement?: number
          name?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_insurers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_insurers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_insurers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_insurers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          amount: number
          article_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          list_name: string
          notes: string | null
          updated_at: string
          updated_by: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          amount: number
          article_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          list_name: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          amount?: number
          article_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          list_name?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          bexio_supplier_id: number | null
          city: string | null
          contact_person: string | null
          country: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          street: string | null
          street_number: string | null
          supplier_number: string | null
          updated_at: string
          updated_by: string | null
          website: string | null
          zip: string | null
        }
        Insert: {
          bexio_supplier_id?: number | null
          city?: string | null
          contact_person?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          street?: string | null
          street_number?: string | null
          supplier_number?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
          zip?: string | null
        }
        Update: {
          bexio_supplier_id?: number | null
          city?: string | null
          contact_person?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          street?: string | null
          street_number?: string | null
          supplier_number?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          app_role: string
          color_hex: string | null
          created_at: string
          created_by: string | null
          display_name: string | null
          email: string
          employee_id: string | null
          first_name: string | null
          id: string
          initials: string | null
          is_active: boolean
          last_name: string | null
          mobile: string | null
          notes: string | null
          phone: string | null
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_role: string
          color_hex?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email: string
          employee_id?: string | null
          first_name?: string | null
          id: string
          initials?: string | null
          is_active?: boolean
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_role?: string
          color_hex?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email?: string
          employee_id?: string | null
          first_name?: string | null
          id?: string
          initials?: string | null
          is_active?: boolean
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          city: string | null
          code: string
          country: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_default_inbound: boolean
          is_default_outbound: boolean
          lat: number | null
          lng: number | null
          name: string
          notes: string | null
          street: string | null
          street_number: string | null
          updated_at: string
          updated_by: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          code: string
          country?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default_inbound?: boolean
          is_default_outbound?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          notes?: string | null
          street?: string | null
          street_number?: string | null
          updated_at?: string
          updated_by?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          code?: string
          country?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default_inbound?: boolean
          is_default_outbound?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          notes?: string | null
          street?: string | null
          street_number?: string | null
          updated_at?: string
          updated_by?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bexio_credentials_status: {
        Row: {
          bexio_company_id: string | null
          created_at: string | null
          created_by: string | null
          environment: string | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          last_refreshed_at: string | null
          notes: string | null
          refresh_count: number | null
          scope: string | null
          status_label: string | null
          token_type: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          bexio_company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          environment?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          last_refreshed_at?: string | null
          notes?: string | null
          refresh_count?: number | null
          scope?: string | null
          status_label?: never
          token_type?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          bexio_company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          environment?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          last_refreshed_at?: string | null
          notes?: string | null
          refresh_count?: number | null
          scope?: string | null
          status_label?: never
          token_type?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bexio_credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bexio_credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bexio_credentials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bexio_credentials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles_self"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles_self: {
        Row: {
          color_hex: string | null
          display_name: string | null
          id: string | null
          mobile: string | null
          phone: string | null
          settings: Json | null
        }
        Insert: {
          color_hex?: string | null
          display_name?: string | null
          id?: string | null
          mobile?: string | null
          phone?: string | null
          settings?: Json | null
        }
        Update: {
          color_hex?: string | null
          display_name?: string | null
          id?: string | null
          mobile?: string | null
          phone?: string | null
          settings?: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      bexio_complete_oauth: {
        Args: {
          p_access_token_encrypted: string
          p_bexio_company_id?: string
          p_environment: string
          p_expires_at: string
          p_initiated_by?: string
          p_refresh_token_encrypted: string
          p_scope: string
          p_state: string
          p_token_type: string
        }
        Returns: string
      }
      bexio_credentials_status_for_admin: {
        Args: never
        Returns: {
          bexio_company_id: string
          created_at: string
          created_by: string
          environment: string
          expires_at: string
          id: string
          is_active: boolean
          last_refreshed_at: string
          notes: string
          refresh_count: number
          scope: string
          status_label: string
          token_type: string
          updated_at: string
          updated_by: string
        }[]
      }
      bexio_credentials_status_label: {
        Args: { p_expires_at: string; p_is_active: boolean }
        Returns: string
      }
      bexio_decrypt_token: { Args: { p_ciphertext: string }; Returns: string }
      bexio_encrypt_token: { Args: { p_plaintext: string }; Returns: string }
      bexio_get_active_credential_decrypted: {
        Args: never
        Returns: {
          access_token: string
          bexio_company_id: string
          created_at: string
          environment: string
          expires_at: string
          id: string
          last_refreshed_at: string
          refresh_count: number
          refresh_token: string
          scope: string
          token_type: string
        }[]
      }
      bexio_record_token_refresh: {
        Args: {
          p_access_token_encrypted: string
          p_credential_id: string
          p_expires_at: string
          p_refresh_token_encrypted: string
          p_scope?: string
        }
        Returns: undefined
      }
      bexio_set_credentials_revoked: {
        Args: { p_credential_id: string; p_reason?: string }
        Returns: undefined
      }
      create_customer_with_primary_address: {
        Args: { p_address: Json; p_customer: Json }
        Returns: string
      }
      current_app_role: { Args: never; Returns: string }
      gen_next_customer_number: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_office: { Args: never; Returns: boolean }
      is_technician: { Args: never; Returns: boolean }
      is_warehouse: { Args: never; Returns: boolean }
      log_activity: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_details?: Json
          p_entity: string
          p_entity_id: string
        }
        Returns: string
      }
      log_error: {
        Args: {
          p_details?: Json
          p_entity?: string
          p_entity_id?: string
          p_error_type: string
          p_message: string
          p_request_id?: string
          p_severity: string
          p_source: string
        }
        Returns: string
      }
      purge_resolved_error_log: { Args: never; Returns: number }
      set_default_customer_address: {
        Args: { p_address_id: string }
        Returns: undefined
      }
      set_primary_contact_person: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      set_primary_customer_insurance: {
        Args: { p_insurance_id: string }
        Returns: undefined
      }
      storage_first_segment_is_uuid: {
        Args: { p_name: string }
        Returns: boolean
      }
      update_customer_with_primary_address: {
        Args: { p_address: Json; p_customer: Json; p_id: string }
        Returns: string
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
