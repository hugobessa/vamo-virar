# @vamo-virar/sync

O lado cliente do protocolo: tudo o que um dispositivo faz para participar de
uma comunidade. Une `@vamo-virar/domain` (estado), `@vamo-virar/crypto`
(envelopes) e um nó da comunidade via HTTP + WebSocket. Usa apenas `fetch`
e `WebSocket`, então o mesmo código roda no React Native e no Node.

```ts
import { NodeClient, Replica, parseInvite } from "@vamo-virar/sync";

// Founder
const ana = await Replica.found(new NodeClient(url, { provisioningToken }), { name: "Coletivo", displayName: "Ana" });
const link = await ana.createInvite({ maxUses: 1 });

// Applicant
const bia = await Replica.join(new NodeClient(url), parseInvite(link), { displayName: "Bia" });

// Admin
for (const req of await ana.joinRequests()) await ana.approve(req);

// Everyone
await bia.sync();                         // mailbox → push → pull
bia.submit("participation.volunteer", { event_id });   // shows in bia.view at once
const stop = await bia.watch();           // sync when the node announces changes
const bytes = bia.save();                 // persist; Replica.load(client, bytes) later
```

`Replica` cuida de: chaves por comunidade, a cauda verificada do log, a fila de
saída (selada novamente sob a época mais recente a cada envio, idempotente por
`op_id`), estado otimista `view` vs `canonical`, envelopes de chave e outras
mensagens seladas, inicialização a partir de um snapshot (e de novo após um
`410 Gone`), espera por uma chave de época ausente em vez de processar entradas
opacas, e fluxos de admin: pedidos de entrada, aprovar/rejeitar, remover membro
(com rotação, aviso de remoção e uma nova chave de entrada se um admin sair),
tornar admin, snapshots, convites, modo de entrada e reconstrução da comunidade
em outro nó (`restoreTo`, depois `moveTo` nos outros dispositivos).

Dispositivos ligados (protocolo §10.5): a mesma filiação em mais de um
aparelho. O principal confirma a caixa postal do membro depois de encaminhar
cada item aos outros; os secundários leem sem confirmar.

```ts
// Aparelho de origem: um pacote com todas as filiações ativas, por 10 minutos
const offer = await offerDeviceLink([ana], "Celular");
offer.qr;    // para o QR (leva o código)
offer.copy;  // para copiar (sem o código), junto com offer.code

// Aparelho novo
const l = parseDeviceLink(offer.copy);
const bundle = await receiveDeviceLink(l, "K7QM-2XRA-9P");
const web = Replica.fromLink(new NodeClient(bundle.communities[0].node), bundle.communities[0], "Navegador");
await web.sync();                         // baixa a comunidade e entra no conjunto de aparelhos

ana.linkedDevices;                        // quem são, qual é o principal
await web.makeMainDevice();
await ana.unlinkDevice(id);               // não é revogação: ver protocolo §10.5.6
```

Avisos (protocolo §14): `submit` de uma menção, de uma atribuição ou de um
convite enfileira um `ping` selado para cada pessoa visada, enviado logo
depois das operações na próxima sincronização; `registerPush(token)` diz ao
nó onde acordar este dispositivo. `noticeMarks` / `markNoticesSeen` guardam,
só neste dispositivo, até onde a pessoa viu suas notificações.

## Testes

`test/integration.test.ts` roda contra o binário real `community-node`
(`cargo build -p community-node`, ou defina `VV_NODE_BIN`); sem ele, esses
testes são pulados localmente e obrigatórios na CI. Cenários: fundação e
entrada (aberta e só por convite), rejeição, atualização de 700 operações com
paginação, remoção e rotação com um membro offline, uma fila de saída
aguardando uma chave atrasada, uma resposta perdida reenviada sem duplicação,
persistência, notificações ao vivo, compactação com inicialização por snapshot
tanto para membros atrasados quanto para novos, e mudança de uma comunidade
para um novo nó. `test/devices.test.ts`, no mesmo binário: ligar por QR e por
link copiado (código errado, uso único, cancelamento), uma rotação que chega ao
secundário com o principal offline, troca de principal no meio do
encaminhamento, consulta respondida em outro aparelho, desligar, várias
comunidades em nós diferentes num só link, e um aparelho novo que perde um
desempate e se acrescenta de novo.
