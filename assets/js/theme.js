/* theme.js — modo escuro, compartilhado por todas as páginas do site.
 *
 * Prioridade: escolha manual do usuário (guardada no navegador) > preferência
 * do sistema operacional > claro, por padrão. As cores em si vivem nos
 * arquivos CSS (variáveis, com @media prefers-color-scheme + [data-theme]);
 * este arquivo só decide QUAL tema vale e mantém o botão/ícone em sincronia.
 *
 * Roda na <head>, antes do corpo da página, para aplicar o tema certo antes
 * da primeira pintura — evita o "flash" de tela clara e depois escura.
 */
(function () {
  const KEY = "fin_theme"; // "light" | "dark" | ausente = segue o sistema

  function escolhaSalva() {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  }

  function sistemaEscuro() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function temaAtual() {
    return escolhaSalva() || (sistemaEscuro() ? "dark" : "light");
  }

  function aplicar() {
    const salva = escolhaSalva();
    if (salva) document.documentElement.setAttribute("data-theme", salva);
    else document.documentElement.removeAttribute("data-theme");
  }

  aplicar(); // roda já, de cara — antes do DOMContentLoaded

  function atualizarBotoes() {
    const escuro = temaAtual() === "dark";
    document.querySelectorAll(".theme-toggle").forEach((btn) => {
      const icon = btn.querySelector("i");
      if (icon) icon.className = "ti " + (escuro ? "ti-sun" : "ti-moon");
      btn.setAttribute("aria-label", escuro ? "Mudar para tema claro" : "Mudar para tema escuro");
      btn.title = btn.getAttribute("aria-label");
    });
  }

  function alternar() {
    localStorage.setItem(KEY, temaAtual() === "dark" ? "light" : "dark");
    aplicar();
    atualizarBotoes();
    // avisa o resto da página (gráficos em <canvas> não repintam sozinhos
    // quando uma variável CSS muda — precisam ser refeitos manualmente).
    window.dispatchEvent(new CustomEvent("temamudou"));
  }

  // Se o usuário nunca escolheu manualmente, segue o sistema em tempo real.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!escolhaSalva()) {
      aplicar();
      atualizarBotoes();
      window.dispatchEvent(new CustomEvent("temamudou"));
    }
  });

  // Delegação de evento no document, registrada JÁ (este script roda antes
  // do <body> existir) — não depende de esperar o botão aparecer no DOM nem
  // do DOMContentLoaded, então não existe janela de tempo em que um clique
  // no botão seja perdido, seja lá quão cedo o usuário clicar.
  document.addEventListener("click", (e) => {
    if (e.target.closest(".theme-toggle")) alternar();
  });

  // Ícone/aria-label de cada botão só podem ser ajustados depois que ele
  // existir no DOM — tenta já (no-op se ainda não existir) e de novo assim
  // que o HTML terminar de carregar.
  atualizarBotoes();
  document.addEventListener("DOMContentLoaded", atualizarBotoes);

  window.temaEscuro = () => temaAtual() === "dark";
})();
