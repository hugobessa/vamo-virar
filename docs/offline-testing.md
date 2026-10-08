# Cenários offline e de falha (Fase 8)

`tests/offline` roda a pilha inteira (domínio, criptografia, sincronização e o
`community-node` real) pelas situações listadas em architecture.md §52. O
nó é compilado com a feature `test-clock`, que adiciona um único endpoint só de teste
para mover o relógio dele (assim dias passam em segundos); builds de release nunca
o incluem. Um proxy entre os dispositivos e o nó pode cair, descartar
respostas depois que o nó as processou, falhar aleatoriamente ou reescrever o que
o nó devolve.

```sh
CARGO_TARGET_DIR=target/test-clock cargo build -p community-node --features test-clock
npm run build && npm test -w @vamo-virar/offline-tests
```

| Cenário | O que mostra |
|---|---|
| Membro offline por 1 / 7 / 30 dias | Volta exatamente ao mesmo estado que todos os outros; as alterações enfileiradas são seladas de novo sob a nova chave e enviadas; uma alteração que não faz mais sentido (desistir de um evento já encerrado) é rejeitada e informada; após 30 dias o log anterior ao snapshot é compactado e o dispositivo restaura a partir do snapshot; eventos encerrados viraram resumos; o membro removido nesse meio-tempo descobre que foi removido |
| Nó fora do ar | Todos continuam trabalhando (alterações visíveis na hora); quando o nó volta, o resultado é determinístico (a primeira aceitação fica com a única vaga; a outra pessoa é avisada de que as vagas acabaram) |
| Nó destruído | Um admin o reconstrói numa nova máquina, no mesmo endereço, a partir do celular; nada se perde; todos seguem em frente |
| Nó adulterando o histórico | O dispositivo detecta a cadeia de hashes quebrada e não guarda nada daquela página; quando o nó volta a se comportar, a sincronização se completa |
| Admin offline | Eventos, voluntariado e confirmações continuam; pedidos de entrada esperam até que um admin volte |
| Todos os celulares de admins perdidos | O código de recuperação do fundador, digitado no celular de um membro, o torna admin; ele substitui a chave de entrada, remove o celular perdido (nova chave de época) e a comunidade volta a crescer; o celular perdido não consegue ler nada novo |
| Alterações concorrentes aleatórias (3 seeds) | Três dispositivos, 30 rodadas de participação e alterações de eventos aleatórias enquanto entram e saem: todos convergem; a capacidade nunca é excedida; ninguém é confirmado sem ter dito sim |
| Conexão que cai o tempo todo | 25% das requisições falham antes de chegar ao nó e 25% perdem a resposta depois de chegar: nada se perde, nada é aplicado duas vezes |

## Corrigido por causa desses cenários

- **Deadlock na recuperação de admin.** O poder de admin agora vem apenas do conjunto de admins
  do plano de controle (protocolo §9.2), então a CRK sempre pode restaurar um admin.
- **Avisos de remoção expiravam** após 30 dias, deixando membros removidos que estavam offline havia muito tempo
  presos em "aguardando acesso"; agora eles persistem até serem lidos.
- **Páginas aplicadas pela metade.** Uma página de entradas de log que falha na verificação
  no meio do caminho agora é revertida por inteiro.

## Limites conhecidos

- Um nó que adultera apenas a **última** entrada que serve só é percebido
  quando a próxima entrada chega (a cadeia deixa de encadear), não antes; o
  dispositivo então se recusa a continuar até que o nó seja corrigido ou substituído.
  Comparar os heads da cadeia entre dispositivos (protocolo §13) é trabalho futuro.
- Enquanto todos os admins estiverem offline, ninguém pode entrar nem ser removido. Isso é
  intencional (só os admins têm a chave de entrada e podem rotacionar chaves).
- A recuperação depende de o fundador guardar o código de recuperação em segurança e fora
  do celular. O app o mostra uma única vez, sob pedido, junto com esse conselho.
