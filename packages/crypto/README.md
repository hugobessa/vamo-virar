# @vamo-virar/crypto

A suíte VV1 e todos os envelopes do protocolo ([`docs/protocol.md`](../../docs/protocol.md)
§1.3, §2–§7, §10, §12), em TypeScript puro sobre `@noble/*` (sem WebCrypto,
então roda no Hermes do React Native).

| Módulo | O quê |
|---|---|
| `primitives` | Ed25519 (verificação estrita), X25519, HKDF-SHA256, XChaCha20-Poly1305, enquadramento de contexto |
| `hpke` | RFC 9180 modo base, single-shot, DHKEM(X25519)/HKDF-SHA256/ChaCha20Poly1305 |
| `keys` | chaves de membro por comunidade, `community_id` / `member_id` / `mailbox_id`, derivação da chave de época, `Keyring` |
| `envelope` | selar/abrir operações, cabeçalhos de controle, entradas do log e a cadeia de hashes, `LogVerifier` (§8.2 no dispositivo → `Entry` do domínio) |
| `keyenv` | envelopes de chave (K_epoch selada para um membro) |
| `rotation` | `rotateEpoch`: nova chave de época, operação de controle `rotate`, envelopes de chave para os membros restantes |
| `snapshot` | snapshots cifrados e assinados por admin |
| `intake` | pedidos de entrada selados para a chave de entrada, assinaturas de autenticação no nó, hashes de convite |

Testes (`npm test`):

- **interoperabilidade**: HPKE contra hpke-js nas duas direções; vetores contra
  o crate Rust `crates/vv-crypto`;
- **ataques**: adulteração de qualquer campo de envelope, um membro levando a
  operação assinada de outra pessoa para um novo envelope, personificação,
  cabeçalhos de controle forjados, envelopes de chave e pedidos de entrada
  abertos pela parte errada, assinaturas maleadas e de ordem pequena;
- **ponta a ponta** (`test/e2e.test.ts`, com um nó simulado que implementa
  apenas as verificações do lado do nó): entrada via intake, eventos, remoção e
  rotação, o membro removido sem acesso, um novo membro inicializando a partir
  de um snapshot, 200 operações de atualização, um nó reescrevendo o histórico e
  um banco de dados de nó roubado vasculhado em busca de nomes, textos de
  eventos e chaves.

`tests/vectors/vv1.json` é gerado por `test/vectors.test.ts`; gere novamente
apenas para uma mudança intencional no formato de transmissão:

```sh
VV_WRITE_VECTORS=1 npm run vectors -w @vamo-virar/crypto
```
