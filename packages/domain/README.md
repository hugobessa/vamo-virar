# @vamo-virar/domain

A máquina de estados da comunidade: `state = fold(reduce, genesis, log)`
([`docs/protocol.md`](../../docs/protocol.md) §8, §9, §12).

TypeScript puro, sem rede, armazenamento ou criptografia. Recebe entradas do log
que a camada de criptografia (Fase 2) já decifrou e verificou, e devolve o
próximo estado mais um resultado (`applied`, `rejected(reason)`, `opaque`,
`duplicate`).

```ts
import { fold, applyInPlace, createSnapshot, restoreSnapshot } from "@vamo-virar/domain";

const { state, outcomes } = fold(entries);         // full replay from genesis
const snap = createSnapshot(state);                 // durable state at state.clock.seq
const restored = restoreSnapshot(snap);             // …later, on another device
for (const e of tail) applyInPlace(restored, e);    // same state as a full replay
```

Garantias, asseguradas pelos testes de propriedade em `test/properties.test.ts`:

- determinístico: mesmo log ⇒ mesmo estado, em todo dispositivo;
- snapshot + cauda ⇒ mesmo estado que o log completo, em qualquer ponto de corte;
- operações rejeitadas e `op_id`s duplicados não mudam nada além da contabilidade interna;
- ninguém é confirmado em um evento sem o seu próprio `accept` ou `volunteer`;
- uma nova confirmação nunca excede a capacidade;
- membros removidos não ocupam vaga aberta em um evento agendado.

Ainda não: CBOR determinístico (os hashes de estado usam JSON canônico até o
pacote de protocolo existir), verificação criptográfica, a camada de operações
pendentes usada pelo sync (Fase 4).

```sh
npm test            # a partir da raiz do repositório
npm run typecheck
```
