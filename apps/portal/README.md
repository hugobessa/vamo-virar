# Portal de pedidos de acesso

Um site pequeno para quem mantém um nó da comunidade e quer abrir espaço
para outras comunidades sem entregar o mesmo código para todo mundo:

1. a pessoa preenche o formulário (nome, email, comunidade, o que fazem) e
   confirma o email por um link;
2. você recebe um email com o pedido e aprova ou recusa em `/admin`;
3. ao aprovar, o portal pede ao nó um **código de criação só para aquele
   pedido** (um *tenant*, com limite de comunidades e de espaço) e manda por
   email o endereço do servidor, o código e o passo a passo no app.

O código não fica guardado no portal: o nó guarda só o SHA-256 dele, e o email
é o único lugar onde ele aparece. Se o email não sair, o portal revoga o código
na hora e o pedido volta para a fila. Depois de aprovar, dá para mandar um
código novo (o anterior para de funcionar) ou revogar o acesso. Revogar impede
criar comunidades novas; as que já existem continuam funcionando e podem
mudar de servidor pelo app.

O portal usa a [API de operador](../../docs/managed-hosting.md#a-api-de-operador)
do nó (`POST /operator/v1/tenants` e companhia), que nunca fica exposta na
internet.

## Montar em casa com o domínio `servidor.vamovirar.app`

A pasta [`deploy/`](deploy) tem tudo para um computador em casa: o nó, o
portal, um Caddy que divide o endereço entre os dois (`/v1/*` e
`/.well-known/vamo-virar` vão para o nó, o resto para o portal) e o Cloudflare
Tunnel, que publica tudo com HTTPS sem abrir portas no roteador e sem expor o
IP da sua casa.

```
celular / navegador ─https─▶ Cloudflare ─túnel─▶ cloudflared ─▶ caddy:80 ─┬─▶ node:8787   (/v1/*, /.well-known/vamo-virar)
                                                                          └─▶ portal:3000 (o resto)
                                                         portal ─▶ node:9787 (API de operador, só na rede interna)
```

### 1. O túnel

1. No painel da Cloudflare, abra **Zero Trust › Networks › Tunnels** e clique em
   **Create a tunnel**. Escolha **Cloudflared** e dê um nome (por exemplo,
   `casa`).
2. Na tela de instalação, copie o token que aparece no comando
   `docker run ... --token <TOKEN>` (só o token). Ele vai no `.env` abaixo.
3. Em **Public Hostname** (ou **Published application routes**), adicione:
   - Subdomain `servidor`, domain `vamovirar.app`;
   - Service **HTTP**, URL `caddy:80`.

A Cloudflare cria o registro DNS sozinha.

### 2. O email

O portal manda email por qualquer servidor SMTP. Um jeito simples é o
[Resend](https://resend.com) (o plano gratuito sobra para isso):

1. Crie a conta, adicione o domínio `vamovirar.app` e crie os registros DNS
   que ele pedir (SPF e DKIM) no painel da Cloudflare. Sem eles, os emails caem
   no spam.
2. Crie uma API key com permissão de envio.
3. No `.env`: `PORTAL_SMTP_URL=smtps://resend:SUA_API_KEY@smtp.resend.com:465`
   e `PORTAL_MAIL_FROM=Vamo Virar <servidor@vamovirar.app>`.

As respostas aos emails de aprovação vão para `PORTAL_ADMIN_EMAIL`. Se você
quer receber em `@vamovirar.app`, o Email Routing da Cloudflare encaminha de
graça para o seu email pessoal.

### 3. Subir

No computador de casa, com Docker instalado:

```sh
git clone https://github.com/hugobessa/vamo-virar.git
cd vamo-virar
cp apps/portal/deploy/.env.example apps/portal/deploy/.env
# edite apps/portal/deploy/.env (gere os segredos com: openssl rand -hex 32)
docker compose -f apps/portal/deploy/docker-compose.yml up -d --build
```

A primeira vez demora alguns minutos (o nó é compilado). Para conferir:

- `https://servidor.vamovirar.app/` mostra o formulário;
- `https://servidor.vamovirar.app/.well-known/vamo-virar` mostra um texto
  começando com `{"protocol"`;
- `https://servidor.vamovirar.app/admin` pede a senha do `.env`.

Faça um pedido você mesmo para testar o caminho inteiro. Para criar
comunidades suas sem passar pelo formulário, defina `VV_PROVISIONING_TOKEN`
no `.env`.

### Atualizar

```sh
git pull
docker compose -f apps/portal/deploy/docker-compose.yml up -d --build
```

Os dados ficam nos volumes `node-data` (as comunidades) e `portal-data` (os
pedidos).

### Backup

```sh
docker compose -f apps/portal/deploy/docker-compose.yml exec node /usr/local/bin/community-node backup --out /data/backup.sqlite
docker compose -f apps/portal/deploy/docker-compose.yml cp node:/data/backup.sqlite ./node-backup.sqlite
docker compose -f apps/portal/deploy/docker-compose.yml cp portal:/data/portal.sqlite ./portal-backup.sqlite
```

### Ver o uso

A API de operador só é acessível de dentro da rede do Compose:

```sh
docker compose -f apps/portal/deploy/docker-compose.yml exec portal \
  sh -c 'wget -qO- --header "Authorization: Bearer $VV_OPERATOR_TOKEN" http://node:9787/operator/v1/tenants'
```

Cada pedido aprovado aparece como `pedido-<número>`, com quantas comunidades
criou e quanto espaço usa. Suspender ou apagar uma comunidade segue o
[guia de hospedagem](../../docs/managed-hosting.md#a-api-de-operador).

### Proteção extra para o `/admin` (opcional)

O `/admin` já pede senha, com limite de tentativas. Para uma segunda camada,
crie no Cloudflare Zero Trust uma **Access application** para
`servidor.vamovirar.app/admin` que só deixa entrar o seu email.

## Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `PORTAL_PUBLIC_URL` | obrigatória | endereço público do portal, usado nos links dos emails |
| `PORTAL_NODE_URL` | o mesmo de `PORTAL_PUBLIC_URL` | endereço do servidor que vai no email de aprovação |
| `PORTAL_OPERATOR_URL` | `http://node:9787` | API de operador do nó |
| `VV_OPERATOR_TOKEN` | obrigatória | token da API de operador (o mesmo do nó) |
| `PORTAL_ADMIN_EMAIL` | obrigatória | recebe os pedidos novos e as respostas |
| `PORTAL_ADMIN_PASSWORD` | obrigatória | senha do `/admin`, 12 caracteres ou mais |
| `PORTAL_SESSION_SECRET` | aleatório a cada início | assina o cookie do `/admin` (32+ caracteres); sem ele, reiniciar desloga |
| `PORTAL_MAIL_FROM` | obrigatória | remetente dos emails |
| `PORTAL_SMTP_URL` | nenhum | `smtps://usuário:senha@host:465`; sem ele os emails vão para o log (só para desenvolvimento) |
| `PORTAL_DEFAULT_MAX_COMMUNITIES` | `1` | valor inicial do formulário de aprovação |
| `PORTAL_DEFAULT_MAX_LOG_MB` | `256` | espaço para as informações de cada comunidade |
| `PORTAL_DEFAULT_MAX_FILES_MB` | `512` | espaço para arquivos anexados de cada comunidade |
| `PORTAL_TRUST_PROXY` | `false` | pega o endereço do cliente do último `X-Forwarded-For` (o Caddy incluído o define) |
| `PORTAL_DATA_DIR` | `./data` | onde fica `portal.sqlite` |
| `PORTAL_HOST`, `PORTAL_PORT` | `0.0.0.0`, `3000` | onde o portal escuta |

## Desenvolvimento

```sh
cargo run -p community-node -- --listen 127.0.0.1:8787 --data-dir ./data-node &   # com VV_OPERATOR_LISTEN=127.0.0.1:9787 e VV_OPERATOR_TOKEN
npm run build -w @vamo-virar/portal
PORTAL_PUBLIC_URL=http://localhost:3000 PORTAL_OPERATOR_URL=http://127.0.0.1:9787 \
VV_OPERATOR_TOKEN=dev-operator-token PORTAL_ADMIN_EMAIL=voce@example.org \
PORTAL_ADMIN_PASSWORD=dev-password-123 PORTAL_MAIL_FROM=dev@example.org \
npm start -w @vamo-virar/portal   # os emails aparecem no terminal
npm test -w @vamo-virar/portal    # os testes contra o nó real precisam de cargo build -p community-node
```

O que o portal guarda: nome, email, nome e descrição da comunidade e cidade de
quem pede, e as decisões. Pedidos com email não confirmado são apagados depois
de 48 horas. Nada disso vai para o nó, que continua sem saber quem está por trás
de cada comunidade.
