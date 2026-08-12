/* reset.js — página de redefinição de senha (destino do link enviado por e-mail)
 *
 * O Supabase devolve a sessão de recuperação de duas formas, dependendo do
 * fluxo configurado no projeto:
 *   - implícito: tokens no hash (#access_token=…&type=recovery), que o
 *     supabase-js já consome sozinho ao carregar (detectSessionInUrl);
 *   - PKCE: um ?code=… na query, que precisa ser trocado por sessão.
 * Tratamos os dois, além do caso de link expirado (#error=…).
 */

function showView(id) {
  document.querySelectorAll(".auth-form").forEach((f) => {
    f.classList.toggle("active", f.id === id);
  });
}

function showMsg(type, text) {
  const el = document.getElementById("msg-reset");
  el.className = "msg " + type;
  el.textContent = text;
}

function clearMsg() {
  const el = document.getElementById("msg-reset");
  el.className = "msg";
  el.textContent = "";
}

async function boot() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  // Link expirado / já usado: o Supabase redireciona com o erro na URL.
  // A descrição vem em inglês, então mantemos o texto em português da página.
  if (hash.get("error") || query.get("error")) {
    showView("form-invalid");
    return;
  }

  const code = query.get("code");
  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) {
      showView("form-invalid");
      return;
    }
  }

  const {
    data: { session },
  } = await db.auth.getSession();

  if (!session) {
    showView("form-invalid");
    return;
  }

  // Limpa os tokens da barra de endereços para não ficarem no histórico.
  history.replaceState(null, "", window.location.pathname);
  showView("form-reset");
  document.getElementById("reset-password").focus();
}

document.getElementById("btn-reset").addEventListener("click", async () => {
  clearMsg();
  const senha = document.getElementById("reset-password").value;
  const confirma = document.getElementById("reset-confirm").value;

  if (!senha || !confirma) {
    showMsg("error", "Preencha os dois campos.");
    return;
  }
  if (senha.length < 6) {
    showMsg("error", "A senha deve ter pelo menos 6 caracteres.");
    return;
  }
  if (senha !== confirma) {
    showMsg("error", "As senhas não coincidem.");
    return;
  }

  const btn = document.getElementById("btn-reset");
  btn.disabled = true;
  btn.textContent = "Salvando...";

  const { error } = await db.auth.updateUser({ password: senha });

  if (error) {
    btn.disabled = false;
    btn.textContent = "Salvar nova senha";
    showMsg("error", "Não foi possível salvar: " + error.message);
    return;
  }

  btn.textContent = "Senha alterada!";
  showMsg("success", "Senha alterada com sucesso. Redirecionando…");
  setTimeout(() => {
    window.location.href = "app.html";
  }, 1800);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Só quando o foco está num campo do formulário (ver auth.js).
  if (!e.target.matches("#form-reset input")) return;
  if (document.getElementById("form-reset").classList.contains("active")) {
    document.getElementById("btn-reset").click();
  }
});

boot();
