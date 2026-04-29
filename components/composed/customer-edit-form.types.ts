import type {
  acquisitionChannelValues,
  customerTypeValues,
  elevatorValues,
  floorValues,
  salutationValues,
} from "@/lib/validations/customer";
import type { countryValues, languageValues } from "@/lib/validations/common";

export type CustomerFormValues = {
  // customer
  customer_type: (typeof customerTypeValues)[number];
  salutation: (typeof salutationValues)[number] | null;
  title: string;
  first_name: string;
  last_name: string;
  company_name: string;
  addressee_line: string;
  email: string;
  phone: string;
  mobile: string;
  date_of_birth: string;
  height_cm: string; // RHF stores as string for numeric inputs
  weight_kg: string;
  language: (typeof languageValues)[number];
  marketing_consent: boolean;
  acquisition_channel: (typeof acquisitionChannelValues)[number] | "";
  notes: string;

  // Story 2.1.1 — IV (Invalidenversicherung) fields.
  iv_marker: boolean;
  iv_dossier_number: string;

  // primary address
  street: string;
  street_number: string;
  zip: string;
  city: string;
  country: (typeof countryValues)[number];
  floor: (typeof floorValues)[number] | null;
  has_elevator: (typeof elevatorValues)[number] | null;
  access_notes: string;
  lat: number | null;
  lng: number | null;
  geocoded_at: string | null;
  bypass_geocoding: boolean;
};

export type CustomerFormMode = "create" | "edit";
