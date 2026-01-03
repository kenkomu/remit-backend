import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://mock.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'mock-key';

// Initialize Supabase client (connection only, no queries yet)
export const supabase = createClient(supabaseUrl, supabaseKey);

export function testSupabaseConnection() {
  console.log('Supabase client initialized:', {
    url: supabaseUrl,
    hasKey: !!supabaseKey
  });
}