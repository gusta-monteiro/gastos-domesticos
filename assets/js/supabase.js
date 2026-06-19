// Conexão com o Supabase
const SUPABASE_URL = "https://oncqnmbuqhnhbcbatwkh.supabase.co";
const SUPABASE_KEY = "sb_publishable_a5uTSYDhGhiyRuS60FspTA_DojIZORd";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
