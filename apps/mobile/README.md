# Vamo Virar — app mobile

App Expo (SDK 57) + React Native construído sobre `@vamo-virar/sync`,
`@vamo-virar/crypto` e `@vamo-virar/domain`. A interface é só em português,
sem jargão de protocolo.

## Executar

```sh
npm install && npm run build          # a partir da raiz do repositório: compila os pacotes compartilhados
cargo run -p community-node -- --data-dir ./data   # um nó com que conversar (defina VV_PROVISIONING_TOKEN)
cd apps/mobile && npx expo run:android # ou run:ios (macOS); veja o README da raiz
```

Use um development build (`npx expo run:android` / `run:ios`), não o Expo
Go: o `expo-calendar` não vem no Expo Go. Celular e nó precisam se alcançar:
use o endereço do computador na rede local como endereço do servidor.

Para compilar na nuvem (sem Android Studio nem Xcode), veja "Compilar na
nuvem com EAS" no README da raiz; os perfis estão em `eas.json`.

## Estrutura

```
index.ts           polyfills (crypto.getRandomValues via expo-crypto), depois expo-router
src/app/           telas (expo-router): início, criar, entrar (também o deep link vamovirar://join),
                   comunidade (eventos / pessoas / eu), detalhe do evento, novo evento
src/model/         lógica independente de plataforma, com testes unitários: quais ações oferecer,
                   listas, entrada de datas, lugares, status de sincronização, textos (pt), mensagens de erro
src/lib/           AppStore (réplicas, sync em segundo plano, atualizações ao vivo), SealedStore
                   (persistência cifrada), contexto React
src/ui/            kit de UI (áreas de toque de 48 pt, claro/escuro), componentes das abas
```

## Armazenamento

A réplica de cada comunidade é selada com XChaCha20-Poly1305 sob uma chave do
dispositivo guardada no iOS Keychain / Android Keystore (`expo-secure-store`,
after-first-unlock, somente neste dispositivo) e gravada no diretório de
documentos do app. A versão web existe apenas para desenvolvimento e testes
automatizados de interface; ela armazena os dados sem criptografia e avisa isso
na tela.

## Testes

```sh
npm test -w @vamo-virar/mobile        # testes unitários do model, incl. "a interface oferece exatamente o que o reducer aceita"
npm run typecheck -w @vamo-virar/mobile
# Ponta a ponta no Chromium headless contra um nó real (versão web):
cargo build -p community-node
(cd apps/mobile && npx expo export --platform web --output-dir dist-web)
npm run e2e:web -w @vamo-virar/mobile  # CHROME_PATH=/path/to/chrome se não estiver em /opt/pw-browsers/chromium
```

O script de ponta a ponta simula duas pessoas em perfis de navegador separados:
criar comunidade → link de convite → pedido de entrada → aceitar → novo evento →
voluntariar-se → confirmar, salvando uma captura de tela de cada etapa.
