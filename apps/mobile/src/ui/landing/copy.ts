// Landing page text (pt-BR only, like the app). Plain language: no "node",
// "epoch" or "key" jargon in the main flow (see model/i18n.ts).
//
// The page is written for the runoff of 25 October 2026: a committee,
// collective or group of friends mobilising for Lula in the last two weeks.
// `hero()` counts the days and, after the runoff, switches to a thank-you so
// the page never lies about the date.

/** Runoff day, local time in Brazil. */
export const RUNOFF = { year: 2026, month: 10, day: 25 };

/** Whole days from `now` to the runoff: 0 on the day, negative after. */
export function daysToRunoff(now: number = Date.now()): number {
  const d = new Date(now);
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const target = Date.UTC(RUNOFF.year, RUNOFF.month - 1, RUNOFF.day);
  return Math.round((target - today) / 86_400_000);
}

/** The words the headline flips through after "Vamo virar". */
export const FLIP_WORDS = ["o jogo", "a eleição", "o bairro", "a página", "essa história"];

/** The kinds of action the marquee scrolls through. */
export const ACTIONS = ["Panfletagem", "Bandeiraço", "Caminhada", "Adesivaço", "Plenária", "Corpo a corpo", "Carreata", "Mutirão de ligações"];

export function hero(days: number) {
  if (days > 1) {
    return {
      tag: "Segundo turno · 25 de outubro",
      countdown: { n: days, label: "dias" },
      title: `Faltam ${days} dias.`,
      lead: "Vamo virar",
      body: "Organize a mobilização do seu comitê, coletivo ou grupo de amigos pelo Lula: marque panfletagens, bandeiraços e caminhadas e veja na hora quem pode ir, sem expor a agenda nem o telefone de ninguém.",
    };
  }
  if (days === 1) {
    return { tag: "Segundo turno · amanhã", countdown: { n: 1, label: "dia" }, title: "É amanhã.", lead: "Vamo virar", body: "Último dia de rua. Marque a ação, pergunte quem pode ir e combine o ponto de encontro." };
  }
  if (days === 0) {
    return { tag: "Segundo turno · hoje", countdown: null, title: "É hoje.", lead: "Vamo virar", body: "Dia de votar e de ajudar quem precisa chegar à urna. Marque a carona e a mesa de apoio." };
  }
  return {
    tag: "Depois do segundo turno",
    countdown: null,
    title: "Valeu por cada rua.",
    lead: "Seguimos",
    body: "O segundo turno passou. O app continua aqui para organizar o que vem depois: comitês, coletivos e comunidades, com a mesma privacidade.",
  };
}

export const copy = {
  nav: { how: "Como funciona", privacy: "Privacidade", faq: "Perguntas", create: "Baixar o app" },
  hero: {
    create: "Baixar o app",
    join: "Recebi um convite",
    trust: ["Sem cadastro com e-mail", "Cifrado de ponta a ponta", "Agenda só no seu celular", "Código aberto"],
  },
  /** The phone demo: an organizer asks who can come and the answers roll in. */
  story: {
    heading: "Próximas ações",
    event: { title: "Panfletagem na feira", when: "Sábado, 8h · Feira de Casa Amarela", spots: 8 },
    ask: "Perguntar quem pode ir",
    asked: "8 pessoas perguntadas",
    answers: [
      { name: "Bia", answer: "Posso", tone: "ok" },
      { name: "Caio", answer: "Talvez", tone: "warn" },
      { name: "Duda", answer: "Posso", tone: "ok" },
      { name: "Edu", answer: "Não posso", tone: "danger" },
      { name: "Fabi", answer: "Posso", tone: "ok" },
      { name: "Lia", answer: "Posso", tone: "ok" },
    ],
    result: (can: number, asked: number) => `${can} de ${asked} podem ir`,
    footnote: "Cada celular confere a própria agenda e responde só o veredito.",
    events: [{ title: "Caminhada da virada", when: "Domingo, 9h · Marco Zero", chip: "Você pode ir", tone: "ok" }],
  },
  problem: {
    eyebrow: "O problema",
    title: "Mobilização não cabe num grupo de WhatsApp",
    items: [
      { tone: "red", title: "\"Quem vai?\" vira 80 mensagens", body: "E no fim ninguém sabe quantas pessoas aparecem no sábado de manhã." },
      { tone: "yellow", title: "A lista de voluntários circula por aí", body: "Nome, telefone e bairro numa planilha que qualquer um encaminha." },
      { tone: "blue", title: "Quando a pessoa some, o grupo morre", body: "Admin viajou, celular quebrou, e a mobilização do bairro vai junto." },
    ],
  },
  pillars: {
    eyebrow: "Por que Vamo Virar",
    title: "Juntar gente sem expor ninguém",
    items: [
      { tone: "green", n: "01", title: "Veja quem pode ir sem perguntar um por um", body: "A organização pergunta uma vez. Cada celular confere a própria agenda e os próprios lugares e responde \"posso\", \"talvez\" ou \"não posso\"." },
      { tone: "yellow", n: "02", title: "Ninguém vira uma linha numa planilha", body: "Não tem cadastro com e-mail nem telefone. O que a comunidade compartilha é cifrado antes de sair do celular: nem o servidor lê." },
      { tone: "blue", n: "03", title: "O comitê é de vocês, não de uma plataforma", body: "Um servidor pequeno, de graça, que qualquer pessoa liga. Se ele cair, a comunidade muda para outro sem se perder." },
    ],
  },
  how: {
    eyebrow: "Como funciona",
    title: "Da ideia à rua em quatro passos",
    steps: [
      { title: "Crie o comitê", body: "Dê um nome, diga quem você é e pronto. Sem e-mail, sem senha." },
      { title: "Mande o link no grupo", body: "Quem clicar pede para entrar. Você aceita quem conhece." },
      { title: "Marque a ação", body: "Panfletagem, bandeiraço, caminhada: título, hora, lugar e vagas." },
      { title: "Pergunte quem pode ir", body: "As respostas chegam sozinhas. Você vê quantas pessoas vão, sem ver a agenda de ninguém." },
    ],
  },
  privacy: {
    eyebrow: "Privacidade",
    title: "Organizar não pode custar a sua segurança",
    items: [
      "Sua agenda é lida só no celular, e só os horários em que você está ocupada(o).",
      "Sua localização aproximada é usada uma vez, quando você pede, e fica no aparelho.",
      "O servidor só guarda e repassa dados cifrados. Quem o hospeda não lê nada.",
      "O código é aberto: qualquer pessoa pode conferir como tudo funciona.",
    ],
    diagram: { phone: "Seu celular", calendar: "Agenda", places: "Lugares", answer: "“Posso”", server: "Servidor da comunidade", locked: "cifrado" },
    cta: "Ler o código",
    policy: "Política de Privacidade completa",
  },
  faq: {
    eyebrow: "Perguntas",
    title: "Perguntas frequentes",
    items: [
      { q: "Preciso de um cadastro com e-mail e senha?", a: "Não. Você é identificada(o) por uma chave guardada no seu celular, não por um cadastro com e-mail e senha." },
      { q: "O servidor da comunidade lê as minhas informações?", a: "Não. O que a comunidade compartilha é cifrado de ponta a ponta: o servidor só guarda e repassa dados cifrados." },
      { q: "Quem organiza vê a minha agenda?", a: "Não. Quando a organização pergunta se você pode ir, seu celular confere a agenda e os lugares e envia só a resposta: posso, talvez ou não posso." },
      { q: "E se o servidor cair ou mudar de lugar?", a: "A comunidade é identificada por chaves, e não pelo servidor. Dá para trocar de servidor sem perder a comunidade." },
      { q: "E depois do dia 25?", a: "O app continua. Comitês viram coletivos, coletivos viram comunidades: a mesma ferramenta serve para o que vier depois." },
      {
        q: "Como o app protege crianças e adolescentes?",
        a: "O app é só para maiores de 18 anos e não tem envio de fotos nem conversas privadas. Abuso e exploração sexual infantil são proibidos: denuncie no app, escreva para a gente e procure as autoridades.",
        link: "childSafety",
        more: "Ler os Padrões de Segurança Infantil",
      },
    ],
  },
  organizers: {
    title: "Para quem coordena",
    body: "O servidor é um programa pequeno que você liga na nuvem com poucos cliques, ou de graça num computador sobrando ou num Raspberry Pi.",
    cta: "Como montar o servidor",
  },
  cta: {
    title: "Bora virar?",
    body: "Baixe, crie o comitê e mande o convite no grupo. Dá tempo.",
    appStore: "Baixar na App Store",
    playStore: "Baixar no Google Play",
  },
  footer: { open: "Código aberto, licença MIT.", source: "Código", docs: "Documentação", privacy: "Política de Privacidade", terms: "Termos de Uso", childSafety: "Segurança Infantil" },
} as const;
