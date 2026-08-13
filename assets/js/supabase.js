// Conexão com o Supabase
const SUPABASE_URL = "https://oncqnmbuqhnhbcbatwkh.supabase.co";
const SUPABASE_KEY = "sb_publishable_a5uTSYDhGhiyRuS60FspTA_DojIZORd";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Traduz as mensagens de erro mais comuns do Supabase Auth (chegam cruas em
// inglês) — o que não está no mapa cai num texto genérico em vez de vazar
// inglês técnico pra tela. Compartilhado por auth.js/reset.js/app.js.
const ERROS_SUPABASE_PT = [
  [/user already registered/i, 'Já existe uma conta com este e-mail.'],
  [/password should be at least/i, 'A senha deve ter pelo menos 6 caracteres.'],
  [/unable to validate email address/i, 'E-mail em formato inválido.'],
  [/email rate limit exceeded/i, 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.'],
  [/new password should be different/i, 'A nova senha deve ser diferente da atual.'],
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Você ainda não confirmou seu e-mail. Confira sua caixa de entrada (e o spam).'],
  [/network|fetch failed|failed to fetch/i, 'Sem conexão com o servidor. Confira sua internet e tente de novo.'],
];
function traduzirErroSupabase(error) {
  const msg = error?.message || '';
  const achado = ERROS_SUPABASE_PT.find(([re]) => re.test(msg));
  return achado ? achado[1] : 'Não foi possível completar a ação agora. Tente de novo em instantes.';
}
