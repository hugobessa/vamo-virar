# Correspondência de calendário e localização

Implementa architecture.md §18–§19: o app consulta o calendário de uma pessoa **no
celular dela** para mostrar se ela pode ir a um evento. Nada do
calendário é enviado à comunidade, ao nó nem a mais ninguém.

## O que é lido, por fonte

| Fonte | Como | Permissão / escopo | O que guardamos |
|---|---|---|---|
| Calendários do celular (iOS EventKit, Android CalendarContract) | `expo-calendar` `listEvents` | iOS acesso total ao calendário (leitura); Android `READ_CALENDAR` | início, fim, dia inteiro, ocupado/provisório |
| Google Agenda | `freeBusy.query`, calendário principal | `https://www.googleapis.com/auth/calendar.freebusy` (apenas horários ocupados: o Google nunca nos devolve títulos, locais ou convidados) | início, fim |
| Outlook / Microsoft 365 | Graph `GET /me/calendarView` com `$select=start,end,showAs,isAllDay,isCancelled` | `Calendars.ReadBasic` (menor privilégio para calendarView) + `offline_access` | início, fim, dia inteiro, ocupado/provisório |

- Só é buscada a janela de ontem até 90 dias à frente; atualizada no
  máximo a cada 15 minutos enquanto o app está aberto.
- Os intervalos ocupados são armazenados selados (XChaCha20-Poly1305 sob a chave do dispositivo,
  como os dados da comunidade). Os tokens OAuth ficam no Keychain/Keystore.
- Google e Microsoft são chamados diretamente do celular com OAuth 2
  authorization code + PKCE. Não há client secret no app.
- Desconectar apaga os tokens e os intervalos em cache (e pede ao Google
  que revogue a autorização).

## Como a disponibilidade é decidida

`@vamo-virar/matching` (`availability()`), por janela de horário do evento:

- sobrepõe uma entrada ocupada → "Você tem algo nesse horário";
- sobrepõe uma entrada provisória, uma entrada de dia inteiro (a menos que a pessoa diga que
  entradas de dia inteiro a deixam ocupada), ou fica dentro da margem livre escolhida
  pela pessoa (padrão de 30 min) em relação a outro compromisso → "Talvez";
- caso contrário → "Você está livre nesse horário";
- nenhum calendário conectado cobre esse horário → nada é mostrado (desconhecido
  nunca é apresentado como livre).

O veredito é mostrado apenas à pessoa. É uma sugestão: ela ainda pode
se voluntariar ou aceitar.

## Configurando os clientes OAuth (mantenedores)

Os provedores só aparecem no app quando um client ID está configurado em
`apps/mobile/app.json` → `expo.extra`:

```json
"extra": {
  "googleClientIdIos": "…apps.googleusercontent.com",
  "googleClientIdAndroid": "…apps.googleusercontent.com",
  "googleClientIdWeb": "",
  "microsoftClientId": "00000000-0000-0000-0000-000000000000"
}
```

- **Google Cloud Console**: crie client IDs OAuth do tipo iOS e Android
  para o bundle/pacote `org.vamovirar.app`; ative a Google Calendar API;
  adicione apenas o escopo `calendar.freebusy` à tela de consentimento.
- **Microsoft Entra ID**: registre um app de cliente público (mobile), permita
  contas pessoais e corporativas (`common`), adicione o redirect URI
  `vamovirar://oauth` e as permissões delegadas
  `Calendars.ReadBasic` e `offline_access`.

Calendários do dispositivo exigem um development build (`npx expo run:ios|android` ou
EAS): `expo-calendar` não está incluído no Expo Go.

## Lugares (Fase 7)

As pessoas adicionam lugares de onde costumam sair ("Casa", "Trabalho"), cada um com um
raio, opcionalmente limitado a datas ("São Paulo, 10–17 nov"). Enquanto um lugar com data
está ativo, ele tem precedência: indica onde a pessoa vai estar.
"Usar onde estou agora" faz uma única leitura aproximada (arredondada para ~1 km), armazenada como
um lugar que expira depois de um dia. Não há localização em segundo plano nem
histórico; as permissões de localização precisa e em segundo plano do Android são bloqueadas no
build.

Para cada evento, o app calcula a distância até o lugar ativo mais próximo
(em relação ao seu raio): perto, um pouco longe (até 1.5 × raio) ou longe, além de
um tempo estimado de deslocamento (padrão de 25 km/h + 10 min), que é somado à
margem livre do calendário em torno do evento.

## "Quem poderia vir?"

Organizadores podem perguntar à comunidade sobre um evento (protocol.md §10.4). Cada
celular responde apenas com "posso / talvez / não posso", selado e assinado para o
organizador que perguntou. Respostas automáticas vêm desligadas por padrão e nunca são enviadas
quando o celular não tem nem calendário nem lugar para avaliar.
