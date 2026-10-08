# @vamo-virar/matching

Decide, no dispositivo, se uma pessoa pode ir a um evento. Fase 6:
disponibilidade de agenda (`availability`, `BusyCache`) e adaptadores somente
leitura, com privilégio mínimo, para free/busy do Google, Microsoft Graph e
agendas do dispositivo. Fase 7: lugares com raio e datas (`locationFit`), tempo
de deslocamento e a `eligibility()` combinada, usada nas sugestões de eventos e
nas respostas a sondagens. Veja [`docs/calendars.md`](../../docs/calendars.md).

Nada neste pacote conversa com um nó da comunidade.
