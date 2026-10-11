# community-node

O nó da comunidade do vamo-virar: um binário Rust mais um arquivo SQLite. Ele
sequencia o log de operações cifrado de cada comunidade, armazena snapshots e
mantém caixas postais para membros offline. Ele nunca guarda uma chave capaz de
ler o conteúdo da comunidade (veja [`docs/protocol.md`](../../docs/protocol.md) §3–§6,
§10–§12, §15 e [`docs/threat-model.md`](../../docs/threat-model.md)).

```sh
cargo run -p community-node -- --listen 127.0.0.1:8787 --data-dir ./data
# ou
cargo build -p community-node --release
./target/release/community-node --config apps/node/config.example.toml
```

Ao iniciar, ele imprime `community-node listening on <addr> node_id=<hex>`.
Os logs vão para o stderr; defina `RUST_LOG=info`. `community-node health` e
`community-node backup --out <file>` apoiam a operação; veja
[`docs/deploy.md`](../../docs/deploy.md) para Docker, Compose + Caddy e
systemd.

## O que ele verifica

Apenas o que consegue verificar sem chaves:

- **acesso**: todo envelope é assinado pela chave de acesso da época atual (ou
  pela anterior durante `epoch_grace_secs` após uma rotação);
- **plano de controle**: gênese assinada pela CRK cujo hash é o id da
  comunidade; `rotate` só por um admin e só para `epoch + 1`; `admin.set` por um
  admin ou pela CRK;
- **idempotência**: um `op_id` repetido com bytes idênticos devolve seu seq;
  bytes diferentes resultam em `op_conflict`;
- **cadeia de hashes**: cada entrada carrega o hash da entrada anterior e o
  horário de recebimento no nó `at`;
- **snapshots**: envio apenas por admin, `head` deve ser o hash da entrada em
  `seq`, assinado com a chave de acesso daquela época;
- **mudanças**: `migrate` só por um admin ou pela CRK; depois disso a
  comunidade fica somente leitura aqui e as escritas respondem `409 moved` com o
  novo endereço (protocolo §11.3);
- **anexos**: um blob (arquivo cifrado no dispositivo) é guardado sob o
  SHA-256 dos bytes recebidos, até `max_blob_bytes` por arquivo e
  `max_blob_bytes_total` por comunidade; admins e moderadores listam e apagam.

Regras de domínio (quem pode convidar quem, capacidade, …) são verificadas
pelos dispositivos.

## Autenticação

Desafio/resposta (`POST /v1/auth/challenge`, depois `/v1/auth/session`)
com três escopos: `community` (chave de acesso da época, compartilhada pelos
membros), `mailbox` (a chave própria de um membro; lê apenas a sua própria caixa
postal) e `control` (chaves de admin). Os tokens são verificados novamente a
cada requisição, então uma rotação ou mudança de admin revoga as credenciais
antigas na hora.

## Manutenção

A cada minuto: itens expirados das caixas postais e estado de autenticação são
descartados, e o log do plano de dados anterior a um snapshot mais antigo que
`compaction_grace_secs` é apagado. Entradas do plano de controle são mantidas
para sempre; são elas que um admin precisa para reconstruir a comunidade em
outro lugar (`POST /v1/communities/restore`).

## Hospedagem gerenciada

O mesmo binário hospeda comunidades para terceiros: `[[tenants]]` com seus
próprios tokens de provisionamento e limites, suspensão e uma API de operador em
um listener privado separado (`operator_listen`). `community-node
tenant-token` gera um token de cliente. Veja
[`docs/managed-hosting.md`](../../docs/managed-hosting.md).

## Testes

```sh
cargo test -p community-node
```

`tests/api.rs` cobre provisionamento, sequenciamento e deduplicação, a cadeia de
hashes, escopos de autenticação, rotação e a janela de tolerância, recuperação
via CRK, caixas postais, intake/convites/limites de taxa, snapshots e
compactação, e restauração em um novo nó. `tests/stream.rs` cobre notificações
via WebSocket. `tests/managed.rs` cobre a mudança de uma comunidade (congelar,
exportar, restaurar em outro lugar, cancelar), clientes e cotas, suspensão, a
API de operador e a atualização de um banco de dados v0 no próprio lugar.
`tests/blobs.rs` cobre os anexos: envio e download por hash, limites e cotas,
listagem e exclusão pelo escopo `moderate`, estados da comunidade, a exclusão
junto com uma comunidade desativada e a restauração em outro nó.
