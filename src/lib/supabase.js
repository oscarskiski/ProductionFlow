import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.')
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)

// Authentication methods
export const auth = {
  signUp: async (email, password) => {
    return supabase.auth.signUp({ email, password })
  },
  
  signIn: async (email, password) => {
    return supabase.auth.signInWithPassword({ email, password })
  },
  
  signOut: async () => {
    return supabase.auth.signOut()
  },
  
  getCurrentUser: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user || null
  }
}
