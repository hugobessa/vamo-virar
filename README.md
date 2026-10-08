# vamo-virar

Uma plataforma local-first e que preserva a privacidade para organizar
eventos comunitários e coordenar as pessoas que participam deles.

- Seu celular guarda sua agenda, sua localização e sua disponibilidade. Nada
  disso sai do aparelho; ele só responde "consigo ir?".
- O estado compartilhado de uma comunidade é cifrado de ponta a ponta e
  sincronizado por um **nó da comunidade** pequeno e substituível: um binário
  Rust com SQLite que roda numa VPS, num Raspberry Pi ou num computador
  sobrando.
- Comunidades e membros são identificados por chaves, não por servidores,
  então um nó pode ser trocado sem perder a comunidade.

## Como compilar

### O que você precisa

| Ferramenta | Versão | Para quê |
|---|---|---|
| [Node.js](https://nodejs.org/) | 22 (mínimo 20) | pacotes TypeScript e o app |
| [Rust](https://rustup.rs/) | estável (`rustup default stable`) | o nó da comunidade e `vv-crypto` |
| Chromium ou Chrome | qualquer recente | só para o teste ponta a ponta da versão web |
| Android Studio (SDK + emulador) | atual | só para rodar o app no Android |
| macOS com Xcode | atual | só para rodar o app no iOS |
| Docker | qualquer recente | opcional, para a imagem do nó |

### Primeira compilação

```sh
git clone https://github.com/hugobessa/vamo-virar.git
cd vamo-virar
npm install        # instala todos os pacotes do monorepo (workspaces)
npm run build      # compila protocol, domain, crypto, sync e matching para dist/
cargo build        # compila vv-crypto e o community-node (target/debug/community-node)
```

Os pacotes TypeScript dependem uns dos outros pelo `dist/`. Depois de mudar
um pacote, rode `npm run build` de novo (ou `npm run build -w @vamo-virar/<pacote>`).

### Testes

```sh
npm run typecheck   # compila e checa os tipos de todos os pacotes
npm test            # compila e roda os testes de todos os pacotes TypeScript
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test          # testes Rust, incluindo os vetores compartilhados com o TypeScript
node scripts/check-vendor-independence.mjs   # o protocolo não depende de nenhum provedor de nuvem
```

Os testes de integração de `packages/sync` sobem o binário real do nó
(`target/debug/community-node`); rode `cargo build` antes. Sem o binário eles
são pulados, a menos que `VV_REQUIRE_NODE=1` esteja definido (como na CI).

Os cenários offline e de falha precisam de um nó com relógio ajustável, que
nunca deve ir para produção:

```sh
CARGO_TARGET_DIR=target/test-clock cargo build -p community-node --features test-clock
npm run build && npm test -w @vamo-virar/offline-tests
```

O teste ponta a ponta da versão web do app (Chromium headless contra um nó
real):

```sh
cargo build -p community-node
(cd apps/mobile && npx expo export --platform web --output-dir dist-web)
npm run e2e:web -w @vamo-virar/mobile   # CHROME_PATH=/caminho/do/chrome se não estiver em /opt/pw-browsers/chromium
```

### Rodar um nó local

```sh
VV_PROVISIONING_TOKEN=dev-token cargo run -p community-node -- --listen 0.0.0.0:8787 --data-dir ./data
```

`dev-token` é o "código de criação" que o app pede ao criar uma comunidade.
Para colocar um nó em produção (Docker, Compose com TLS automático, systemd),
veja [`docs/deploy.md`](docs/deploy.md). A imagem Docker:

```sh
docker build -f deploy/Dockerfile -t community-node .
```

### Rodar o app

O app usa [Expo](https://expo.dev/) (SDK 57). Com o nó rodando:

```sh
npm run build                 # o app usa os pacotes compilados
cd apps/mobile
npx expo start --web          # versão web, só para desenvolvimento: guarda os dados sem proteção
npx expo run:android          # development build no emulador ou num Android conectado por USB
npx expo run:ios              # development build no simulador ou num iPhone (só no macOS)
```

- Use um **development build** (`expo run:*`), não o Expo Go: o
  `expo-calendar`, usado para ler a agenda do celular, não vem no Expo Go.
- No celular, o endereço do servidor é o IP do seu computador na rede local
  (por exemplo `http://192.168.0.10:8787`), não `localhost`.
- Google Agenda e Outlook só aparecem quando há IDs de cliente OAuth
  configurados em `apps/mobile/app.json`; o passo a passo está em
  [`docs/calendars.md`](docs/calendars.md).
- Ainda não há configuração de EAS Build para gerar versões de loja.

### Versões publicadas

Uma tag `v*` dispara `.github/workflows/release.yml`, que publica binários do
nó (Linux x86-64/ARM64, macOS, Windows) num release em rascunho e imagens
multi-arquitetura no GHCR.

## Estado

- Fase 0 — especificação do protocolo: rascunho v0 em `docs/`.
- Fase 1 — motor de domínio local: [`packages/domain`](packages/domain)
  (máquina de estados, snapshots, retenção; testes unitários e de
  propriedades).
- Fase 2 — camada criptográfica: [`packages/protocol`](packages/protocol)
  (CBOR estrito), [`packages/crypto`](packages/crypto) (suíte VV1, envelopes,
  rotação, snapshots, pedidos de entrada) e
  [`crates/vv-crypto`](crates/vv-crypto) (Rust, com os mesmos vetores de
  teste).
- Fase 3 — nó da comunidade: [`apps/node`](apps/node) (Rust + SQLite,
  HTTP + WebSocket; sequenciamento, escopos de autenticação, caixas postais,
  pedidos de entrada, snapshots, compactação, restauração).
- Fase 4 — motor de sincronização: [`packages/sync`](packages/sync) (cliente
  do nó, réplica com fila de saída e visão otimista, caixa postal, início a
  partir de snapshot, fluxos de admin, migração de nó; testes de integração
  contra o nó real).
- Fase 5 — app mobile: [`apps/mobile`](apps/mobile) (Expo SDK 57; criar,
  entrar, convidar, aprovar, eventos, voluntariar/convidar/confirmar, pessoas,
  armazenamento cifrado; testes unitários e um teste ponta a ponta na versão
  web contra um nó real).
- Fase 6 — integração com agendas: [`packages/matching`](packages/matching) e
  as configurações de agenda do app (agendas do celular, livre/ocupado do
  Google, Outlook; disponibilidade calculada no celular; veja
  [`docs/calendars.md`](docs/calendars.md)).
- Fase 7 — localização e "quem pode vir?": lugares com raio e datas,
  localização aproximada pontual, tempo de deslocamento e respostas assinadas
  que só dizem o veredito (protocolo §10.4).
- Fase 8 — cenários offline e de falha: [`tests/offline`](tests/offline)
  contra o nó real com relógio ajustável e um proxy que injeta falhas (veja
  [`docs/offline-testing.md`](docs/offline-testing.md)); recuperação da
  coordenação com o código de recuperação de quem fundou a comunidade.
- Fase 9 — implantação do nó: imagem Docker (distroless, sem root, com
  verificação de saúde), Compose + Caddy com TLS automático, unidade systemd
  endurecida, subcomandos `health`/`backup` e release por tag com binários
  (Linux x86-64/ARM64, macOS, Windows) e imagens multi-arquitetura. Veja
  [`docs/deploy.md`](docs/deploy.md).
- Fase 10 — hospedagem gerenciada: o mesmo binário com clientes e cotas, uma
  API de operador privada (uso, suspensão, exportação, métricas), atualização
  do esquema do banco na inicialização e mudança de uma comunidade entre
  quaisquer dois nós com um `migrate` assinado que os membros seguem
  sozinhos. A CI verifica que o protocolo do nó continua sem dependências de
  provedores de nuvem. Veja [`docs/managed-hosting.md`](docs/managed-hosting.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Objetivos, princípios e o desenho geral |
| [`docs/protocol.md`](docs/protocol.md) | Protocolo normativo: formato, operações, sincronização, chaves (rascunho v0) |
| [`docs/threat-model.md`](docs/threat-model.md) | Adversários e o que o desenho protege e não protege |
| [`docs/security.md`](docs/security.md) | Regras de implementação para criptografia, chaves, nó e app |
| [`docs/calendars.md`](docs/calendars.md) | Agendas e localização no celular |
| [`docs/offline-testing.md`](docs/offline-testing.md) | Cenários offline e de falha |
| [`docs/deploy.md`](docs/deploy.md) | Como rodar um nó da comunidade |
| [`docs/managed-hosting.md`](docs/managed-hosting.md) | Hospedar muitas comunidades; mudar uma comunidade de nó |

## Estrutura

```
apps/mobile      app React Native (Expo) para iOS e Android
apps/node        nó da comunidade em Rust
packages/*       TypeScript: protocol, domain, crypto, sync, matching
crates/*         Rust: vv-crypto
deploy/          Dockerfile, Compose, Caddy, systemd
tests/offline    cenários offline e de falha
tests/vectors    vetores de teste compartilhados entre TypeScript e Rust
scripts/         verificações da CI
```

O plano de implementação está em `docs/architecture.md` §52.

## Licença

[MIT](LICENSE).
