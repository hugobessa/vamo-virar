# Regras de engenharia de segurança

Regras de implementação para o código TypeScript (`packages/crypto`) e Rust
(`crates/crypto`). O *quê* está em [`protocol.md`](protocol.md) §1.3 e
§2; o *porquê* está em [`threat-model.md`](threat-model.md).

## Criptografia

- Use apenas as primitivas da suíte `VV1`. Não adicione algoritmos sem uma
  mudança no protocolo.
- Bibliotecas: TypeScript `@noble/curves`, `@noble/hashes`, `@noble/ciphers`,
  e uma implementação de HPKE RFC 9180 construída sobre elas; Rust `ed25519-dalek`
  (com `verify_strict`), `x25519-dalek`, `hpke`, `chacha20poly1305`, `sha2`,
  `hkdf`. Fixe versões exatas; revise os diffs ao atualizar.
- Nada de primitivas próprias. Composição apenas conforme especificado. A única construção
  composta que implementamos nós mesmos, HPKE (RFC 9180) sobre as primitivas
  noble (para que o React Native não precise de WebCrypto), é testada quanto à
  interoperabilidade com o hpke-js nos dois sentidos e com o crate Rust
  `hpke` através dos vetores compartilhados.
- Os decodificadores são estritos: CBOR fora da forma determinística, campos
  desconhecidos ou comprimentos errados são rejeitados em vez de tolerados.
- Todo uso de assinatura, KDF e AEAD tem uma string de contexto do protocolo §15.
- Valores aleatórios vêm apenas do CSPRNG da plataforma
  (`crypto.getRandomValues` via `react-native-get-random-values`; `OsRng` em
  Rust).
- Compare segredos e MACs em tempo constante.
- As duas implementações precisam passar nos mesmos vetores de teste
  (`tests/vectors/vv1.json`) antes que qualquer uma seja mesclada. Regenere com
  `VV_WRITE_VECTORS=1 npm run vectors -w @vamo-virar/crypto` apenas para uma
  mudança intencional no formato de fio, e revise o diff.

## Chaves nos dispositivos

- Chaves privadas e chaves de época ficam no Keychain do iOS / Keystore do Android
  (encapsuladas), nunca em SQLite em texto claro, logs, relatórios de falha ou analytics.
- O banco SQLite local é criptografado em repouso (SQLCipher) com uma chave guardada
  no keystore.
- Apague buffers de texto claro descriptografado quando for viável; nunca faça cache de texto claro
  fora do banco criptografado.

## Nó

- O nó nunca recebe chaves privadas, chaves de época nem texto claro. A revisão de código
  deve rejeitar qualquer endpoint que aceite algum deles.
- Logs: sem corpos de requisição, sem tokens, sem endereços IP por padrão
  (configurável para tratamento de abuso, desligado por padrão, retenção curta).
- Limitação de taxa em `intake`, `auth/challenge` e postagens em caixas postais.
- TLS obrigatório, exceto em `localhost`; o nó pode obter certificados via
  ACME ou ficar atrás de um proxy reverso.

## App

- Nada de SDKs de analytics ou de relatório de falhas de terceiros que enviem dados para fora do dispositivo por
  padrão. Relatórios de falha, se houver, são opt-in e higienizados.
- Notificações push não têm conteúdo (protocolo §14).
- Não peça a permissão de localização "sempre"; apenas "durante o uso" ou
  pontos de referência manuais.
- O acesso ao calendário é somente leitura e usado apenas para a correspondência local.

## Relatando vulnerabilidades

Até que exista um endereço dedicado, relate em privado ao dono do repositório
em vez de abrir uma issue pública.
