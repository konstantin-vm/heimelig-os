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
          customer_number: string
          customer_type?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          height_cm?: number | null
          id?: string
          is_active?: boolean
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
      current_app_role: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_office: { Args: never; Returns: boolean }
      is_technician: { Args: never; Returns: boolean }
      is_warehouse: { Args: never; Returns: boolean }
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
