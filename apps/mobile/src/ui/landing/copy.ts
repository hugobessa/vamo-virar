// Landing page text (pt-BR only, like the app). Plain language: no "node",
// "epoch" or "key" jargon in the main flow (see model/i18n.ts).

export const copy = {
  nav: { how: "Como funciona", privacy: "Privacidade", faq: "Perguntas", create: "Baixar o app" },
  hero: {
    tag: "Agenda, eventos e gente",
    title: "Organize a sua comunidade.",
    body: "Crie eventos, convide pessoas e veja quem pode ir. Sua agenda e sua localização ficam só no seu celular.",
    create: "Baixar o app",
    join: "Recebi um convite",
    trust: ["Código aberto", "Cifrado de ponta a ponta", "Agenda só no seu celular"],
  },
  mock: {
    heading: "Próximos eventos",
    events: [
      { title: "Mutirão da horta", when: "Sábado, 10h · Praça da Vila", chip: "Você pode ir", tone: "ok" },
      { title: "Assembleia do bairro", when: "Quinta, 19h30 · Salão paroquial", chip: "Conflita com sua agenda", tone: "warn" },
      { title: "Feira de trocas", when: "Domingo, 9h · Escola municipal", chip: "Você pode ir", tone: "ok" },
    ],
  },
  pillars: {
    eyebrow: "Por que Vamo Virar",
    title: "Juntar gente sem entregar a sua vida",
    items: [
      { tone: "green", n: "01", title: "Sua agenda não sai do celular", body: "O app só responde \"consigo ir?\". Horários ocupados, locais e localização ficam no seu aparelho." },
      { tone: "yellow", n: "02", title: "Cifrado de ponta a ponta", body: "O que a comunidade compartilha é cifrado antes de sair do celular. Nem o servidor consegue ler." },
      { tone: "blue", n: "03", title: "Servidor pequeno e trocável", body: "Um servidor leve cuida da sincronização. Se ele sair do ar, a comunidade muda para outro sem se perder." },
    ],
  },
  how: {
    eyebrow: "Como funciona",
    title: "Do convite ao evento em três passos",
    steps: [
      { title: "Crie ou entre", body: "Crie uma comunidade ou entre com um link de convite. Quem organiza aceita o seu pedido." },
      { title: "Marque um evento", body: "Defina título, data, local e vagas. Todo mundo da comunidade vê." },
      { title: "Veja quem pode ir", body: "Cada celular confere a própria agenda e diz se dá. Ninguém vê o que você tem marcado." },
    ],
  },
  privacy: {
    eyebrow: "Privacidade",
    title: "O que é seu fica com você",
    items: [
      "Sua agenda é lida só no celular, e só os horários em que você está ocupada(o).",
      "Sua localização é usada uma vez, quando você pede, e fica no aparelho.",
      "O código é aberto: qualquer pessoa pode conferir como tudo funciona.",
    ],
    cta: "Ler o código",
    policy: "Política de Privacidade completa",
  },
  organizers: {
    eyebrow: "Para quem cuida da comunidade",
    title: "Um servidor que cabe em qualquer canto",
    body: "É um programa pequeno que roda numa VPS, num Raspberry Pi ou num computador sobrando. Você cuida da infraestrutura, e as pessoas continuam donas dos próprios dados.",
    chips: ["VPS", "Raspberry Pi", "Computador sobrando"],
    cta: "Como montar o servidor",
  },
  faq: {
    eyebrow: "Perguntas",
    title: "Perguntas frequentes",
    items: [
      { q: "Preciso de um cadastro com e-mail e senha?", a: "Não. Você é identificada(o) por uma chave guardada no seu celular, não por um cadastro com e-mail e senha." },
      { q: "O servidor da comunidade lê as minhas informações?", a: "Não. O que a comunidade compartilha é cifrado de ponta a ponta: o servidor só guarda e repassa dados cifrados." },
      { q: "E se o servidor cair ou mudar de lugar?", a: "A comunidade é identificada por chaves, e não pelo servidor. Dá para trocar de servidor sem perder a comunidade." },
      { q: "Minha agenda vai para algum lugar?", a: "Não. O app lê só os horários em que você está ocupada(o), no próprio celular, para mostrar se você pode ir a um evento." },
      {
        q: "Como o app protege crianças e adolescentes?",
        a: "O app é só para maiores de 18 anos e não tem envio de fotos nem conversas privadas. Abuso e exploração sexual infantil são proibidos: denuncie no app, escreva para a gente e procure as autoridades.",
        link: "childSafety",
        more: "Ler os Padrões de Segurança Infantil",
      },
    ],
  },
  cta: {
    title: "Bora juntar a galera?",
    body: "Baixe o app e crie a sua comunidade em poucos minutos. Recebeu um link de convite? Instale o app e abra o link.",
    appStore: "Baixar na App Store",
    playStore: "Baixar no Google Play",
  },
  footer: { open: "Código aberto, licença MIT.", source: "Código", docs: "Documentação", privacy: "Política de Privacidade", terms: "Termos de Uso", childSafety: "Segurança Infantil" },
} as const;
