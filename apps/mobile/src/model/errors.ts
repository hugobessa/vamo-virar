// Turns failures into sentences for people. The sync layer and the node
// speak English codes and messages; nothing of that reaches the screen.

import { NodeError } from "@vamo-virar/sync";

const BY_CODE: Record<string, string> = {
  unauthorized: "O servidor não reconheceu este celular para esta comunidade.",
  forbidden: "O servidor não permite isso. Se for criar ou mudar uma comunidade, confira o código de criação.",
  not_hosted: "Esta comunidade não está nesse servidor.",
  not_found: "Não encontrado.",
  rate_limited: "Muitos pedidos seguidos. Tente de novo daqui a pouco.",
  closed: "Esta comunidade não está aceitando pedidos de entrada agora.",
  moved: "A comunidade mudou de servidor. Tente de novo em instantes.",
  suspended: "A hospedagem desta comunidade está pausada.",
  quota_exceeded: "O servidor não tem mais espaço para isso.",
  disabled: "Esta comunidade está marcada para exclusão. Nada pode ser alterado.",
  too_large: "Grande demais para enviar.",
  already_exists: "Isso já existe no servidor.",
  epoch_conflict: "Outra pessoa da coordenação fez uma mudança ao mesmo tempo. Tente de novo.",
  epoch_stale: "Este celular ainda está atualizando. Tente de novo em instantes.",
};

const BY_MESSAGE: [RegExp, string][] = [
  [/^(not a vamo-virar invite link|invite link has )/, "Esse link de convite não parece certo. Peça um novo para quem convidou você."],
  [/^this recovery code is not for this community/, "Esse código de recuperação não é desta comunidade."],
  [/^the community is already on that node/, "A comunidade já está nesse servidor."],
  [/^only admins can do this/, "Só a coordenação pode fazer isso."],
  [/^only admins and moderators can do this/, "Só a coordenação e a moderação podem fazer isso."],
  [/^admins already have every moderator power/, "Quem está na coordenação já pode fazer tudo o que a moderação faz."],
  [/^not a moderator/, "Essa pessoa não está na moderação."],
  [/^only organizers can ask/, "Só quem organiza eventos pode perguntar."],
  [/^new admins must be active members/, "A nova coordenação precisa ser de pessoas ativas na comunidade."],
  [/^(not synced yet|no epoch key yet)/, "Este celular ainda está atualizando. Tente de novo em instantes."],
  [/^no such (member|active member)/, "Essa pessoa não está mais na comunidade."],
  [/^no such (question|upcoming event)/, "Isso não está mais disponível."],
  [/^the community is disabled/, "Esta comunidade está marcada para exclusão. Nada pode ser alterado."],
  [/^the community is not disabled/, "A comunidade já está ativa."],
  [/^another admin must re-enable/, "Outra pessoa da coordenação precisa reativar a comunidade."],
  [/^only members can report/, "Só quem faz parte da comunidade pode denunciar."],
  [/^you cannot report yourself/, "Você não pode denunciar a si mesma(o)."],
  [/^there is no admin to report to/, "Não há outra pessoa na coordenação ou na moderação para receber essa denúncia."],
  [/^report details are too long/, "O texto da denúncia está longo demais."],
  [/^member\.(block|unblock) /, "Não foi possível fazer isso. Talvez outra pessoa da coordenação já tenha feito."],
  [/^this device does not hold the intake key/, "Este celular não consegue ler os pedidos de entrada. Peça a outra pessoa da coordenação."],
];

/** A Portuguese sentence for any error; never the raw English text. */
export function errorText(e: unknown, fallback = "Algo deu errado."): string {
  if (e instanceof NodeError) {
    if (e.status === 0 || e.status >= 502) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
    return BY_CODE[e.code] ?? fallback;
  }
  if (e instanceof TypeError) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  const msg = e instanceof Error ? e.message : String(e);
  return BY_MESSAGE.find(([re]) => re.test(msg))?.[1] ?? fallback;
}
