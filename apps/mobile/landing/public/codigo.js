// "Gerar um código" on /servidor/: makes a setup code (VV_PROVISIONING_TOKEN)
// in the browser so non-technical admins don't need a terminal. Nothing is sent
// anywhere. Without JavaScript the box stays hidden and the page explains how to
// make one by hand.

(() => {
  const box = document.querySelector("[data-codegen]");
  if (!box || !window.crypto?.getRandomValues) return;
  const make = box.querySelector("[data-codegen-make]");
  const row = box.querySelector("[data-codegen-row]");
  const out = box.querySelector("[data-codegen-out]");
  const copy = box.querySelector("[data-codegen-copy]");
  const status = box.querySelector("[data-codegen-status]");

  // 32 characters from a-z0-9: ~165 bits. Rejection sampling keeps it uniform.
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const generate = () => {
    let code = "";
    while (code.length < 32) {
      for (const b of crypto.getRandomValues(new Uint8Array(48))) {
        if (b < 252 && code.length < 32) code += alphabet[b % 36];
      }
    }
    return code;
  };

  make.addEventListener("click", () => {
    out.textContent = generate();
    status.textContent = "";
    row.hidden = false;
    make.textContent = "Gerar outro";
  });

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(out.textContent);
      status.textContent = "Copiado!";
    } catch {
      getSelection()?.selectAllChildren(out);
      status.textContent = "Selecionado: copie com Ctrl+C (ou ⌘C).";
    }
  });

  box.hidden = false;
})();
