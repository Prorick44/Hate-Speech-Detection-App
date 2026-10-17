import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Supabase is optional for local use. When these environment variables are not
 * configured, the app keeps its history in the browser instead of failing at
 * startup.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export type Detection = {
  id: string;
  statement: string;
  is_hateful: boolean;
  confidence: number;
  categories: string[];
  severity: 'none' | 'low' | 'moderate' | 'high' | 'severe';
  explanation: string;
  flagged_terms: string[];
  created_at: string;
};
