# Hospedagem gerenciada

Fase 10 (architecture.md §41, §52). Um host gerenciado roda **o mesmo
binário `community-node`** que uma comunidade pode rodar num Raspberry Pi. Não
existe build gerenciado separado, nem SDK de fornecedor, nem recurso do protocolo que
só um host gerenciado tenha. O que a hospedagem gerenciada acrescenta é operacional:

- **clientes (tenants)**: clientes que provisionam comunidades com seu próprio token,
  cada um com limites opcionais;
- **uma API de operador** num listener separado e privado: uso, suspensão,
  exclusão, exportação e métricas Prometheus;
- **mover uma comunidade para dentro ou para fora**: um admin a move entre quaisquer dois
  nós pelo app, e cada membro acompanha por conta própria.

A regra que este design preserva: **o provedor é substituível**. Uma comunidade
sempre pode sair, mesmo suspensa ou acima da cota, e um nó nunca mantém
os dados de uma comunidade como refém.

## Independência de provedor

O protocolo do nó não depende de AWS, GCP, Azure, Cloudflare, Supabase
nem Firebase. `scripts/check-vendor-independence.mjs` garante isso no CI
(job `vendor-independence`): nenhum SDK de fornecedor de nuvem pode aparecer em `Cargo.lock`
ou `package-lock.json`, e nenhum host ou SDK de fornecedor pode ser referenciado no
nó, nos pacotes do protocolo nem em `deploy/`. Qualquer máquina que rode um binário
Linux ou um contêiner serve; o armazenamento é um único arquivo SQLite num disco local.

Os adaptadores opcionais de calendário do app móvel chamam as APIs de calendário do Google e da Microsoft
em nome da pessoa, no dispositivo. Trata-se de uma integração de calendário
escolhida pela pessoa, não de parte do protocolo do nó.

## Rodando um nó para muitas comunidades

Um único processo do nó guarda qualquer número de comunidades num só banco de dados; não há
nada por comunidade para iniciar ou parar. Uma configuração gerenciada típica:

```toml
# /etc/community-node/config.toml
listen = "127.0.0.1:8787"            # atrás de Caddy/nginx com TLS
data_dir = "/var/lib/community-node"
trust_forwarded_for = true

# A API de operador: nunca numa interface pública.
operator_listen = "127.0.0.1:9787"
# operator_token vem de VV_OPERATOR_TOKEN (pelo menos 16 caracteres).

# Seu próprio token de provisionamento, para comunidades que você hospeda sem plano
# (e para restaurações que você faz em nome de alguém). Opcional.
# provisioning_token = "..."

[[tenants]]
name = "coletivo-recife"
token_sha256 = "9f2c…"               # de `community-node tenant-token`
max_communities = 3
max_log_bytes = 268435456             # 256 MiB de log por comunidade
max_blob_bytes_total = 1073741824     # 1 GiB de anexos por comunidade

[[tenants]]
name = "free-tier"
token_sha256 = "41ab…"
max_communities = 1
max_log_bytes = 16777216
max_blob_bytes_total = 67108864       # 64 MiB de anexos por comunidade
```

`community-node tenant-token` imprime um novo token aleatório para o cliente
e a linha `token_sha256` para a configuração. O arquivo de configuração guarda apenas o
hash. Um cliente usa seu token como "código de configuração" ao criar uma
comunidade no app (ou ao trazer uma para cá).

Clientes também podem ser criados, ter o token trocado e ser revogados pela
[API de operador](#a-api-de-operador), sem editar a configuração nem reiniciar o
nó. Eles ficam no banco do nó (só o SHA-256 do token), ao lado dos do arquivo,
e os nomes não se repetem entre os dois. O [portal de pedidos](../apps/portal/README.md)
usa isso para aprovar pedidos de acesso e enviar o código por email.

Escale rodando mais nós, cada um com seu próprio disco, e dando a cada
cliente (ou comunidade) o endereço do nó que o hospeda. Os nós não
conversam entre si; uma comunidade vive em exatamente um nó por vez, e
movê-la é a operação do protocolo descrita abaixo.

### Limites

| Limite | Aplica-se a | Quando atingido |
|---|---|---|
| `max_communities` | criação e restauração com o token daquele cliente | `507 quota_exceeded`; o app mostra o erro |
| `max_log_bytes` | cada comunidade que o cliente provisionou | as operações são recusadas uma a uma com `quota_exceeded`; elas **ficam nas caixas de saída dos membros** e o app avisa que a comunidade ficou sem espaço |
| `max_blob_bytes_total` | cada comunidade que o cliente provisionou (sem valor no cliente, vale o `max_blob_bytes_total` do nó, 512 MiB por padrão) | o envio do anexo responde `507 quota_exceeded`; o app avisa e um admin ou moderador apaga anexos órfãos para liberar espaço |

O tamanho do log conta as entradas de log armazenadas. Um snapshot de um admin permite que o nó
compacte o log anterior a ele (após `compaction_grace_secs`), o que libera
cota; por esse motivo, uploads de snapshot são aceitos mesmo acima da cota.
Os anexos (arquivos cifrados, `max_blob_bytes` por arquivo) têm a sua própria
cota e só saem dela quando são apagados; eles não entram na exportação nem na
restauração, então depois de uma mudança de nó precisam ser anexados de novo
(a cópia automática pelo dispositivo de um admin é **[LATER]**, protocolo §9.7).
As caixas postais têm limites próprios (`max_mailbox_items`, TTLs) e não
contam. `migrate` é sempre aceito, então uma comunidade acima da cota pode sair.

## A API de operador

Servida apenas quando `operator_listen` está definido, somente nesse endereço, com
`Authorization: Bearer <operator_token>`. JSON, exceto a exportação (CBOR).

| Método e caminho | O que faz |
|---|---|
| `GET /operator/v1/communities` | Cada comunidade: id, cliente, created_at, head_seq, época, bytes e contagens de log/anexos/snapshot/caixa postal, pedidos de entrada pendentes, suspensa, moved_to, modo de entrada |
| `GET /operator/v1/tenants` | Por cliente: comunidades, bytes de log e de anexos, os limites configurados e de onde ele vem (`source`: `config` ou `operator`) |
| `POST /operator/v1/tenants` | Cria um cliente sem reiniciar o nó. Corpo JSON: `name` (1 a 64 caracteres) e, opcionais, `max_communities`, `max_log_bytes`, `max_blob_bytes_total`. Responde `201` com o `token`, a única vez que ele aparece (o nó guarda só o SHA-256); `409 exists` se o nome já existe |
| `POST /operator/v1/tenants/{name}/token` | Troca o token de um cliente criado pela API (perdido ou vazado) e desfaz uma revogação. O token antigo para de funcionar na hora |
| `PUT /operator/v1/tenants/{name}/limits` | Troca os limites de um cliente criado pela API, na hora. Corpo JSON com `max_communities`, `max_log_bytes`, `max_blob_bytes_total`; o que faltar ou vier `null` fica sem limite (anexos: o padrão do nó). O que já passou de um limite menor continua funcionando, só não cresce. `409 config_tenant` para clientes do arquivo de configuração |
| `DELETE /operator/v1/tenants/{name}` | Revoga o token de um cliente criado pela API: ele não cria nem restaura mais comunidades. As que já existem continuam funcionando, com os mesmos limites, e podem se mudar |
| `POST /operator/v1/communities/{id}/suspend` | Escritas são recusadas com `403 suspended`; leituras, exportação e `migrate` continuam funcionando |
| `POST /operator/v1/communities/{id}/resume` | Desfaz uma suspensão |
| `GET /operator/v1/communities/{id}/export` | O payload de restauração da comunidade (`application/cbor`), por exemplo para devolvê-lo ao encerrar uma conta |
| `DELETE /operator/v1/communities/{id}?confirm={id}` | Apaga todas as linhas da comunidade (log, snapshots, caixas postais, anexos) e encerra suas sessões. Irreversível |
| `GET /operator/v1/metrics` | Formato de texto do Prometheus |

```sh
export T=$VV_OPERATOR_TOKEN
curl -s -H "Authorization: Bearer $T" http://127.0.0.1:9787/operator/v1/communities | jq
curl -s -H "Authorization: Bearer $T" -X POST http://127.0.0.1:9787/operator/v1/communities/$ID/suspend
```

As métricas são agregadas **por cliente, nunca por comunidade**
(`vv_communities`, `vv_communities_suspended`, `vv_communities_moved`,
`vv_log_bytes`, `vv_blob_bytes`, `vv_snapshot_bytes`, `vv_mailbox_items`,
`vv_mailbox_bytes`, `vv_intake_items` com um rótulo `tenant`, além de
`vv_sessions` e `vv_schema_version`), de modo que enviá-las a um serviço de
monitoramento não publica uma lista de comunidades.

O que a API de operador consegue ver é exatamente o que o banco de dados já guarda
(threat-model.md, adversário A1): ids opacos, tamanhos, contagens, horários e
chaves públicas dos admins. Ela não tem nenhum endpoint que revele ou altere conteúdo,
membros, papéis ou chaves. Suspensão e exclusão são as únicas alavancas, e
nenhuma delas consegue obrigar uma comunidade a ficar: a exportação funciona durante a suspensão, e os
celulares dos admins podem reconstruir a comunidade em qualquer lugar, mesmo depois de uma exclusão.

## Mover uma comunidade para dentro ou para fora (protocol.md §11.3)

Pelo app: **Administração → Ajustes → Mudar de servidor**, informe o endereço do novo servidor
e, se ele pedir, seu código de configuração (o token de provisionamento do nó
ou um token de cliente). Por baixo dos panos, `Replica.migrateTo`:

1. verifica se o destino responde em `/.well-known/vamo-virar`;
2. envia uma operação de controle `migrate`, assinada pelo admin, indicando o novo
   nó. O nó antigo a aceita e, a partir daí, **recusa toda escrita**
   com `409 moved` e o novo endereço, para que nada caia ali que o
   novo nó não teria. Leituras continuam funcionando;
3. restaura a comunidade no destino a partir do log que este dispositivo
   verificou (`POST /v1/communities/restore`), levando junto o modo de entrada
   e os links de convite pendentes da exportação do nó antigo;
4. reentrega a chave atual na caixa postal de cada membro no novo nó
   (as caixas postais não são movidas) e passa a usá-lo.

Se a restauração falhar (sem código de configuração, cota, um erro de digitação), o app assina um segundo
`migrate` com uma lista vazia, o que cancela a mudança no nó antigo.

Os celulares dos membros acompanham na próxima sincronização:

- um celular que tenta escrever recebe `409 moved` e mantém a alteração na sua
  caixa de saída;
- ele puxa o log do nó antigo, encontra a entrada `migrate`, **verifica
  ele mesmo a assinatura do admin** e passa para o primeiro nó listado
  que já hospeda a comunidade;
- em seguida envia o que estava aguardando. Nada é perdido nem duplicado (os ids das operações
  são mantidos).

Um celular nunca segue um `409 moved` isolado vindo de um nó: só um `migrate`
assinado no log o move. Um nó ou rede desonesto pode, no máximo, impedir
um celular de escrever, o que já poderia fazer de qualquer forma.

Links de convite compartilhados antes da mudança continuam funcionando: um pedido de entrada enviado ao
nó antigo é respondido com o novo endereço e reenviado para lá (ele é
selado para a chave de entrada da comunidade, então seguir a indicação pode, no pior caso,
perdê-lo, nunca expô-lo).

### Mantenha as comunidades movidas legíveis por um tempo

Membros que estão offline durante a mudança descobrem o novo endereço pelo log do nó
antigo. Mantenha uma comunidade movida no nó antigo, somente leitura, por pelo menos
`compaction_grace_secs` (30 dias por padrão); a listagem do operador mostra
`moved_to`. Depois disso, apague-a com a API de operador. Um membro que
perdeu essa janela ainda pode ser apontado manualmente para o novo nó
(`Replica.moveTo`; no app, entrando de novo com um novo link do novo
nó).

### Quando o nó antigo não existe mais

`migrate` precisa do nó antigo. Se ele desapareceu, um admin reconstrói a
comunidade pelo celular com `Replica.restoreTo` (§11.3, §11.4), e os
membros recebem o novo endereço por outro canal (um novo link). Isso
já era possível antes da hospedagem gerenciada e continua sendo.

## Checklist para um provedor de hospedagem

- Rode o binário ou a imagem da release sem alterações; não modifique o nó.
- `operator_listen` apenas em loopback ou numa rede privada; um
  `VV_OPERATOR_TOKEN` longo e aleatório; TLS na frente de `listen` (a configuração do Caddy incluída).
- Faça backup de `node.sqlite` com `community-node backup` (deploy.md).
- Nunca suspenda sem aviso, e nunca apague uma comunidade à qual não
  foi oferecida sua exportação ou que não teve tempo de se mudar.
- Atualize substituindo o binário: mudanças de schema são aplicadas na inicialização
  (deploy.md, "Atualizações").
