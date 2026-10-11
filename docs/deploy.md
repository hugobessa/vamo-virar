# Rodando um nó da comunidade

> Primeira vez? O [guia passo a passo](hosting-guide.md) (também em
> `/servidor/` na landing page) monta um servidor só com cliques no Railway, ou
> de graça num computador seu com Docker e Tailscale, sem domínio nem portas
> abertas. Esta página é a referência completa.

Um nó é **um binário e um arquivo SQLite**. Ele não precisa de servidor de banco de dados,
fila nem cache, e nunca guarda chaves capazes de ler o conteúdo da comunidade
(veja [threat-model.md](threat-model.md)): se a máquina for perdida ou apreendida,
a comunidade perde disponibilidade, não privacidade, e um admin pode reconstruí-la
em outro lugar a partir do celular.

Consumo típico: alguns MB de RAM por comunidade ativa, com o disco crescendo junto
com o log criptografado até que snapshots permitam compactá-lo. Um Raspberry Pi 4, uma
VPS pequena ou um computador sobrando é mais do que suficiente.

## Escolha como rodá-lo

### 1. Docker Compose com TLS automático (recomendado para uma VPS)

```sh
git clone <this repository> && cd vamo-virar/deploy
cat > .env <<'ENV'
DOMAIN=node.example.org
VV_PROVISIONING_TOKEN=$(openssl rand -hex 24)   # cole o valor gerado
ENV
docker compose up -d
```

Aponte primeiro o DNS do domínio para a máquina; o Caddy obtém e renova o
certificado. O nó só é acessível através do Caddy.

### 2. Só Docker

```sh
docker build -f deploy/Dockerfile -t vamo-virar/community-node .
docker run -d --name community-node -p 127.0.0.1:8787:8787 \
  -e VV_PROVISIONING_TOKEN=<long random string> \
  -v community-node-data:/data vamo-virar/community-node
```

A imagem tem ~50 MB (distroless, sem shell), roda como usuário não root, guarda
tudo em `/data` e tem health check embutido. Coloque seu próprio proxy
TLS na frente. Atrás de um proxy corporativo que intercepta TLS, passe o bundle de CA
dele no build: `--secret id=ca_bundle,src=ca.pem`.

As tags de release também publicam imagens multiarquitetura (amd64, arm64) em
`ghcr.io/<owner>/community-node`.

### 3. Um binário simples com systemd (Raspberry Pi, NAS, qualquer Linux)

Baixe `community-node-<version>-<target>.tar.gz` na página de releases
(Linux x86-64 e ARM64, macOS, Windows), ou rode `cargo build -p community-node --release`.

```sh
sudo install -m 0755 community-node /usr/local/bin/
sudo install -m 0644 deploy/community-node.service /etc/systemd/system/
echo 'VV_PROVISIONING_TOKEN=<long random string>' | sudo tee /etc/community-node.env
sudo chmod 600 /etc/community-node.env
sudo systemctl enable --now community-node
```

A unit roda com um usuário descartável e um sandbox reforçado, guarda os dados em
`/var/lib/community-node` e escuta em `127.0.0.1:8787`; coloque Caddy ou
nginx na frente para TLS e defina `VV_TRUST_FORWARDED_FOR=1` no arquivo de env.

## Configuração

Tudo tem um valor padrão. Precedência: ambiente > flags > arquivo de configuração.

| Opção | Env | Padrão | Observações |
|---|---|---|---|
| `listen` | `VV_LISTEN` | `127.0.0.1:8787` | |
| `data_dir` | `VV_DATA_DIR` | `./data` | contém `node.sqlite` |
| `provisioning_token` | `VV_PROVISIONING_TOKEN` | nenhum | necessário para criar ou restaurar uma comunidade aqui; entregue-o só a quem pode hospedar neste nó |
| `open_provisioning` | | `false` | permite que qualquer pessoa crie comunidades; só numa rede privada |
| `trust_forwarded_for` | `VV_TRUST_FORWARDED_FOR` | `false` | defina quando estiver atrás de um proxy reverso, para que os limites de taxa de pedidos de entrada se apliquem por cliente |
| `epoch_grace_secs` | | 600 | escritas com a chave antiga aceitas após uma troca de chave |
| `compaction_grace_secs` | | 30 dias | por quanto tempo as entradas de log anteriores a um snapshot são mantidas |
| `max_blob_bytes` | | 11 MiB | maior anexo (arquivo cifrado) aceito num envio; o app limita o arquivo a 10 MiB e o resto é a sobrecarga da cifragem. Aparece em `limits` do `.well-known` |
| `max_blob_bytes_total` | | 512 MiB | quantos bytes de anexos cada comunidade pode guardar; acima disso os envios respondem `507 quota_exceeded` até que um admin ou moderador apague anexos. Um `[[tenants]]` pode ter o seu próprio valor |
| `max_mailbox_ttl_secs` | | 30 dias | |
| `intake_per_ip_per_hour` / `intake_per_community_per_hour` | | 20 / 200 | limites de pedidos de entrada |
| `operator_listen` | `VV_OPERATOR_LISTEN` | desligado | hospedagem gerenciada: endereço privado para a API de operador |
| `operator_token` | `VV_OPERATOR_TOKEN` | nenhum | obrigatório com `operator_listen` (≥ 16 caracteres) |
| `[[tenants]]` | | nenhum | hospedagem gerenciada: clientes (tenants) com seu próprio token de provisionamento e limites |

Rodar um nó para comunidades de outras pessoas (clientes, cotas, a
API de operador, mover comunidades para dentro e para fora) está descrito em
[`managed-hosting.md`](managed-hosting.md).

Veja [`apps/node/config.example.toml`](../apps/node/config.example.toml).

## Backups e restauração

```sh
community-node backup --data-dir /var/lib/community-node --out /backups/node-$(date +%F).sqlite
# no Docker:
docker exec community-node /usr/local/bin/community-node backup --out /data/backup.sqlite
```

`backup` usa o backup online do SQLite e é seguro com o nó rodando. Para
restaurar, pare o nó, coloque o arquivo de volta como `node.sqlite` e inicie-o.

Backups são uma conveniência, não a única cópia: o celular de um admin pode reconstruir
a comunidade em qualquer nó (`Replica.restoreTo`, protocolo §11.3), então até um
nó sem backup pode ser substituído.

## Operação

- **Saúde:** `community-node health --url http://127.0.0.1:8787` sai com 0
  quando o nó responde (o health check do contêiner usa isso).
- **Logs:** `RUST_LOG=info`. O nó nunca registra corpos de requisição nem tokens;
  o Caddyfile incluído também descarta URIs de requisição e cabeçalhos de autenticação.
- **Atualizações:** faça um backup, pare, substitua o binário ou a imagem, inicie.
  Mudanças de schema são aplicadas na inicialização, em ordem, e registradas no
  `user_version` do SQLite; cada uma roda na sua própria transação. Um binário mais antigo se recusa
  a abrir um banco de dados que um mais novo já atualizou, então guarde o backup se você
  puder precisar voltar atrás.
- **Mudar para outra máquina:** copie `node.sqlite` (de um backup) e
  aponte o nome DNS para a nova máquina, ou deixe um admin reconstruir a partir do
  celular.
- **Mover uma comunidade para outro nó** (outro endereço, outro
  operador): o admin faz isso pelo app, e os membros acompanham por conta
  própria; veja [`managed-hosting.md`](managed-hosting.md#mover-uma-comunidade-para-dentro-ou-para-fora-protocolmd-113).

## O que você, como operador, pode e não pode ver

Você pode ver: que comunidades existem (ids opacos), quantas entradas de log,
anexos e itens de caixa postal elas têm e quando, as chaves públicas dos admins, os endereços IP dos
dispositivos que se conectam (em memória, apenas para limitação de taxa) e o tamanho e
o momento dos dados criptografados. Você não pode ver nomes, eventos, quem participa de quê,
calendários, localizações nem qualquer conteúdo de mensagem.
