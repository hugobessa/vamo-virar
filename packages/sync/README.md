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
para um novo nó.
