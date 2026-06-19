/* ── Tabs ── */
const tabs = document.querySelectorAll(".auth-tab");
const forms = document.querySelectorAll(".auth-form");

function setTab(tab) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  forms.forEach((f) => f.classList.toggle("active", f.id === "form-" + tab));
}

tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

if (window.location.hash === "#signup") setTab("signup");

/* ── Se já estiver logado, vai direto para a calculadora ── */
db.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = "index.html";
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

  window.location.href = "index.html";
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

/* ── Enter para submeter ── */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const activeForm = document.querySelector(".auth-form.active").id;
  if (activeForm === "form-login") document.getElementById("btn-login").click();
  if (activeForm === "form-signup")
    document.getElementById("btn-signup").click();
});
