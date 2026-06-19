/* ── Tabs ── */
const tabs = document.querySelectorAll('.auth-tab');
const forms = document.querySelectorAll('.auth-form');

function setTab(tab) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  forms.forEach(f => f.classList.toggle('active', f.id === 'form-' + tab));
}

tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

/* Abre signup direto se vier com #signup na URL */
if (window.location.hash === '#signup') setTab('signup');

/* ── Helpers ── */
function showMsg(id, type, text) {
  const el = document.getElementById(id);
  el.className = 'msg ' + type;
  el.textContent = text;
}
function clearMsg(id) {
  const el = document.getElementById(id);
  el.className = 'msg';
  el.textContent = '';
}

/* ── Login ── */
document.getElementById('btn-login').addEventListener('click', async () => {
  clearMsg('msg-login');
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showMsg('msg-login', 'error', 'Preencha e-mail e senha.');
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  /* TODO: integrar Supabase Auth aqui */
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Entrar';
    showMsg('msg-login', 'error', 'Autenticação ainda não configurada. Em breve!');
  }, 1000);
});

/* ── Signup ── */
document.getElementById('btn-signup').addEventListener('click', async () => {
  clearMsg('msg-signup');
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm  = document.getElementById('signup-confirm').value;

  if (!name || !email || !password || !confirm) {
    showMsg('msg-signup', 'error', 'Preencha todos os campos.');
    return;
  }
  if (password.length < 6) {
    showMsg('msg-signup', 'error', 'A senha deve ter pelo menos 6 caracteres.');
    return;
  }
  if (password !== confirm) {
    showMsg('msg-signup', 'error', 'As senhas não coincidem.');
    return;
  }

  const btn = document.getElementById('btn-signup');
  btn.disabled = true;
  btn.textContent = 'Criando conta...';

  /* TODO: integrar Supabase Auth aqui */
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Criar conta';
    showMsg('msg-signup', 'error', 'Autenticação ainda não configurada. Em breve!');
  }, 1000);
});

/* Enter para submeter */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const activeForm = document.querySelector('.auth-form.active').id;
  if (activeForm === 'form-login') document.getElementById('btn-login').click();
  if (activeForm === 'form-signup') document.getElementById('btn-signup').click();
});