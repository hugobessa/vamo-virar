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

## Montar no Railway

Dois serviços no mesmo projeto, cada um com o próprio domínio e a imagem
publicada a cada versão (`v*`) no GHCR:

| Serviço | Imagem | Domínio | Para quê |
|---|---|---|---|
| `node` | `ghcr.io/hugobessa/community-node:latest` | `servidor.vamovirar.app` | o servidor das comunidades (é o endereço que vai no app) |
| `portal` | `ghcr.io/hugobessa/vamo-virar-portal:latest` | `acesso.vamovirar.app` | o formulário de pedidos e o `/admin` |

O portal fala com a API de operador do nó pela rede privada do Railway
(o endereço `*.railway.internal` do serviço `node`), que não fica exposta na
internet.

Antes de começar, gere três segredos (no terminal, `openssl rand -hex 32`; ou
o botão de gerar do [guia do servidor](https://vamovirar.app/servidor/)):
um para `VV_OPERATOR_TOKEN`, um para `PORTAL_SESSION_SECRET` e uma senha
para o `/admin`.

### 1. O serviço `node`

1. No Railway, **New Project › Docker Image** e cole
   `ghcr.io/hugobessa/community-node:latest`.
2. Clique no serviço criado, abra **Settings** e mude o nome para `node`
   (exatamente assim: é o nome que o portal usa na rede privada).
3. Em **Variables › Raw Editor**, cole e clique em **Update**:

   ```
   RAILWAY_RUN_UID=0
   VV_TRUST_FORWARDED_FOR=1
   VV_OPERATOR_LISTEN=[::]:9787
   VV_OPERATOR_TOKEN=O_PRIMEIRO_SEGREDO
   ```

   Para criar comunidades suas sem passar pelo formulário, acrescente
   `VV_PROVISIONING_TOKEN=` com mais um segredo.
4. Clique com o botão direito no serviço, **Attach Volume**, mount path `/data`.
   Sem volume, cada deploy começa com o disco vazio; por isso o nó e o portal
   se recusam a iniciar no Railway sem um volume em `/data` (o log do deploy
   diz o motivo).
5. **Settings › Networking › Custom Domain**: `servidor.vamovirar.app`,
   porta `8787`. O Railway mostra os registros DNS para criar (passo 3).

### 2. O serviço `portal`

1. No mesmo projeto, **+ New › Docker Image** e cole
   `ghcr.io/hugobessa/vamo-virar-portal:latest`. Mude o nome do serviço
   para `portal`.
2. Em **Variables › Raw Editor**:

   ```
   RAILWAY_RUN_UID=0
   PORTAL_PUBLIC_URL=https://acesso.vamovirar.app
   PORTAL_NODE_URL=https://servidor.vamovirar.app
   PORTAL_OPERATOR_URL=http://${{node.RAILWAY_PRIVATE_DOMAIN}}:9787
   VV_OPERATOR_TOKEN=${{node.VV_OPERATOR_TOKEN}}
   PORTAL_TRUST_PROXY=1
   PORTAL_ADMIN_EMAIL=seu@email
   PORTAL_ADMIN_PASSWORD=A_SENHA_DO_ADMIN
   PORTAL_SESSION_SECRET=O_SEGUNDO_SEGREDO
   PORTAL_MAIL_FROM=Vamo Virar <servidor@mg.vamovirar.app>
   PORTAL_MAILGUN_API_KEY=SUA_API_KEY_DO_MAILGUN
   PORTAL_MAILGUN_DOMAIN=mg.vamovirar.app
   ```

   (`${{node.…}}` é preenchido pelo próprio Railway com valores do serviço
   `node`: o token e o endereço na rede privada. O endereço é escolhido quando
   o serviço é criado e não muda se você renomear o serviço depois; por isso
   use a referência em vez de escrever `node.railway.internal`.)

   O email sai pela API HTTP do Mailgun, porque o Railway pode bloquear SMTP
   para fora (a conexão fica parada até dar erro). O `PORTAL_MAIL_FROM` tem que
   ser do domínio verificado no Mailgun (aqui, `@mg.vamovirar.app`). Se o
   domínio estiver na região EU do Mailgun, acrescente
   `PORTAL_MAILGUN_API_URL=https://api.eu.mailgun.net`.
3. **Attach Volume** com mount path `/data`. É aqui que ficam os pedidos;
   sem volume, o portal não inicia.
4. **Settings › Networking › Custom Domain**: `acesso.vamovirar.app`, porta `3000`.

### 3. O DNS na Cloudflare

Para cada domínio, crie no painel da Cloudflare (**DNS › Records**) os
registros que o Railway mostrou (um `CNAME` e, às vezes, um `TXT` de
verificação). Deixe o `CNAME` como **DNS only** (nuvem cinza): o Railway cuida
do certificado HTTPS. Com o proxy da Cloudflare ligado (nuvem laranja), o nó e o
portal enxergam o endereço da Cloudflare em vez do de quem acessa, e os limites
por endereço (pedidos de acesso, tentativas de login, pedidos de entrada nas
comunidades) passam a valer para todo mundo junto. Em alguns minutos o Railway marca o domínio como
verificado.

### 4. Conferir

- `https://servidor.vamovirar.app/.well-known/vamo-virar` mostra um texto
  começando com `{"protocol"`;
- `https://acesso.vamovirar.app/` mostra o formulário;
- faça um pedido você mesmo, aprove em `https://acesso.vamovirar.app/admin` e
  crie uma comunidade no app com o código do email.

Se o portal disser que não consegue falar com o nó, o fim da mensagem diz
por quê:

- `ENOTFOUND`: o endereço está errado. Use a referência
  `${{node.RAILWAY_PRIVATE_DOMAIN}}` (com o nome do serviço como aparece no
  painel) ou confira o endereço em **Settings › Networking › Private
  Networking** do serviço `node`;
- `ECONNREFUSED`: o nó não está ouvindo na porta 9787. Confira
  `VV_OPERATOR_LISTEN` e `VV_OPERATOR_TOKEN` no `node` e se o log do deploy
  mostra `operator API listening on`; se não ajudar, troque para
  `VV_OPERATOR_LISTEN=0.0.0.0:9787`;
- `401 unauthorized`: o `VV_OPERATOR_TOKEN` é diferente nos dois serviços.

### Atualizar no Railway

**Automático, a cada versão.** Com o segredo `RAILWAY_TOKEN` no GitHub, uma
tag `node-v*` publica a imagem do nó e uma tag `portal-v*` a do portal; em
seguida, o job `deploy-railway` do `release.yml` aponta o serviço daquela tag
(`node` ou `portal`) para a imagem da versão (por exemplo,
`community-node:v0.6.0`) e espera o deploy ficar no ar. O job falha, e o
GitHub avisa, se o deploy terminar em erro. Versões com hífen
(`node-v0.6.0-rc.1`) não vão para o Railway. Para configurar, uma vez:

1. No Railway, abra o projeto, **Settings › Tokens**, e crie um token de
   projeto para o ambiente `production`. Ele só dá acesso a esse projeto.
2. No GitHub, em **Settings › Secrets and variables › Actions**, crie o
   segredo `RAILWAY_TOKEN` com esse token.
3. Se os serviços tiverem outros nomes, crie as variáveis (aba
   **Variables**) `RAILWAY_NODE_SERVICE` e `RAILWAY_PORTAL_SERVICE`.

**À mão.** Em cada serviço, **Settings › Source**, troque a imagem pela da
versão nova (por exemplo, `ghcr.io/hugobessa/community-node:v0.3.1`). O
**Redeploy** de um deploy antigo reaproveita a imagem que ele já tinha
baixado, então não serve para atualizar. Os dados ficam nos volumes `/data` e
não se perdem.

Prefere compilar direto do repositório? Crie os serviços com **GitHub Repo**
em vez de **Docker Image** e acrescente `RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile`
(no `node`) ou `RAILWAY_DOCKERFILE_PATH=apps/portal/Dockerfile` (no `portal`).

**Backup:** os dados ficam nos volumes do Railway. O celular de quem fundou
cada comunidade consegue reconstruí-la em outro servidor, então um backup do
nó (`community-node backup`, veja [deploy.md](../../docs/deploy.md)) é uma
segurança a mais, não a única cópia.

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
| `PORTAL_MAILGUN_API_KEY`, `PORTAL_MAILGUN_DOMAIN` | nenhum | envia pela API HTTP do Mailgun (porta 443), para quem bloqueia SMTP; tem prioridade sobre o SMTP |
| `PORTAL_MAILGUN_API_URL` | `https://api.mailgun.net` | `https://api.eu.mailgun.net` para domínios na região EU |
| `PORTAL_SMTP_URL` | nenhum | `smtps://usuário:senha@host:465` (caracteres especiais codificados, `@` vira `%40`); sem ele nem Mailgun, os emails vão para o log (só para desenvolvimento) |
| `PORTAL_DEFAULT_MAX_COMMUNITIES` | sem limite | valor inicial do formulário de aprovação; vazio deixa o campo em branco (sem limite). Dá para mudar depois na página do pedido |
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
