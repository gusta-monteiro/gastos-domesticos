/* ── Tabs ── */
const tabs = document.querySelectorAll(".auth-tab");
const forms = document.querySelectorAll(".auth-form");

function setTab(tab) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  forms.forEach((f) => f.classList.toggle("active", f.id === "form-" + tab));
  document.querySelector(".auth-box").classList.toggle("recovery", tab === "forgot");
}

tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

if (window.location.hash === "#signup") setTab("signup");
if (window.location.hash === "#recuperar") setTab("forgot");

/* ── Navegação para a tela de recuperação ── */
document.getElementById("link-forgot").addEventListener("click", (e) => {
  e.preventDefault();
  window.location.hash = "recuperar";
  document.getElementById("forgot-email").value =
    document.getElementById("login-email").value.trim();
  setTab("forgot");
});
document.getElementById("link-back-login").addEventListener("click", (e) => {
  e.preventDefault();
  window.location.hash = "";
  setTab("login");
});

/* ── Se já estiver logado, vai direto para a calculadora ── */
db.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = "app.html";
});

/* ── Helpers ── */
function showMsg(id, type, text) {
  const el = document.getElementById(id);
  el.className = "msg " + type;
  el.textContent = text;
}
function clearMsg(id) {
  const el = document.getElementById(id);
  el.className = "msg";
  el.textContent = "";
}

/* ── Login ── */
document.getElementById("btn-login").addEventListener("click", async () => {
  clearMsg("msg-login");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  if (!email || !password) {
    showMsg("msg-login", "error", "Preencha e-mail e senha.");
    return;
  }

  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.textContent = "Entrando...";

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    btn.disabled = false;
    btn.textContent = "Entrar";
    showMsg("msg-login", "error", "E-mail ou senha incorretos.");
    return;
  }

  window.location.href = "app.html";
});

/* ── Cadastro ── */
document.getElementById("btn-signup").addEventListener("click", async () => {
  clearMsg("msg-signup");
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirm = document.getElementById("signup-confirm").value;

  if (!name || !email || !password || !confirm) {
    showMsg("msg-signup", "error", "Preencha todos os campos.");
    return;
  }
  if (password.length < 6) {
    showMsg("msg-signup", "error", "A senha deve ter pelo menos 6 caracteres.");
    return;
  }
  if (password !== confirm) {
    showMsg("msg-signup", "error", "As senhas não coincidem.");
    return;
  }

  const btn = document.getElementById("btn-signup");
  btn.disabled = true;
  btn.textContent = "Criando conta...";

  const { error } = await db.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });

  if (error) {
    btn.disabled = false;
    btn.textContent = "Criar conta";
    showMsg("msg-signup", "error", "Erro ao criar conta: " + error.message);
    return;
  }

  showMsg(
    "msg-signup",
    "success",
    "Conta criada! Verifique seu e-mail para confirmar o cadastro.",
  );
  btn.disabled = false;
  btn.textContent = "Criar conta";
});

/* ── Recuperação de senha ── */
document.getElementById("btn-forgot").addEventListener("click", async () => {
  clearMsg("msg-forgot");
  const email = document.getElementById("forgot-email").value.trim();

  if (!email) {
    showMsg("msg-forgot", "error", "Informe seu e-mail.");
    return;
  }

  const btn = document.getElementById("btn-forgot");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const redirectTo = new URL("redefinir-senha.html", window.location.href).href;
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });

  btn.disabled = false;
  btn.textContent = "Enviar link de recuperação";

  if (error) {
    showMsg(
      "msg-forgot",
      "error",
      "Não foi possível enviar agora. Aguarde alguns minutos e tente de novo.",
    );
    return;
  }

  /* Mensagem propositalmente genérica: não revela se o e-mail tem conta. */
  showMsg(
    "msg-forgot",
    "success",
    "Se houver uma conta com esse e-mail, o link de recuperação foi enviado. Confira também a caixa de spam.",
  );
});

/* ── Enter para submeter ── */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const activeForm = document.querySelector(".auth-form.active").id;
  if (activeForm === "form-login") document.getElementById("btn-login").click();
  if (activeForm === "form-signup")
    document.getElementById("btn-signup").click();
  if (activeForm === "form-forgot")
    document.getElementById("btn-forgot").click();
});
