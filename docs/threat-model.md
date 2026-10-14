# Modelo de ameaças — v0 (rascunho)

Escopo: o protocolo em [`protocol.md`](protocol.md), um nó da comunidade por
comunidade, clientes iOS/Android. Números de seção (§) referem-se a `protocol.md`.

## Ativos

| Ativo | Onde fica | Sensibilidade |
|---|---|---|
| Calendário pessoal | apenas no dispositivo | alta |
| Localização (GPS, pontos de referência) | apenas no dispositivo | alta |
| Quem é membro de qual comunidade | criptografado no log (plano de dados) | **alta** (organização política) |
| Quem participa de qual evento | criptografado no log | alta |
| Detalhes do evento (horário, local) | criptografado no log | média–alta |
| Tarefas e comentários (quem faz o quê, discussões da organização) | criptografado no log | alta |
| Anexos de tarefas (fotos, documentos) | blob no nó, cifrado com chave própria por arquivo; a chave fica no log | alta |
| Conjunto de admins (chaves públicas por comunidade) | nó, em texto claro | baixa–média |
| Nome/descrição da comunidade no diretório | público por escolha | baixa |
| Chaves privadas | armazenamento seguro do dispositivo | crítica |

## Adversários

| # | Adversário | Capacidades presumidas |
|---|---|---|
| A1 | Operador do nó curioso/comprometido | Leitura/escrita total do banco e do processo do nó; vê todos os metadados de tráfego |
| A2 | Ladrão do banco de dados | Cópia única de `community.sqlite` |
| A3 | Atacante de rede | Passivo e ativo no caminho; não consegue quebrar TLS sem comprometer uma CA |
| A4 | Membro removido | Tem todas as chaves até a época da sua remoção; conhece o protocolo |
| A5 | Membro malicioso | Membro atual, chaves válidas |
| A6 | Admin malicioso | Admin atual |
| A7 | Ladrão de dispositivo | Acesso físico a um celular, possivelmente desbloqueado |
| A8 | Provedor de push (Apple/Google), gateway de push | Vê tokens de push e horários |
| A9 | Spammer/assediador externo | Conhece o ID da comunidade e a URL do nó |

## Os 12 cenários da arquitetura

| # | Cenário | Resultado na v0 | Mecanismo |
|---|---|---|---|
| 1 | Nó comprometido (A1) | Não consegue ler conteúdo, forjar operações nem descobrir a lista de membros/papéis além dos admins. **Consegue** reter/atrasar operações, bifurcar o log por dispositivo, observar horários, IPs, tamanhos e atividade das caixas postais. | §3, §4, §13 |
| 2 | Admin malicioso (A6) | Pode adicionar/remover membros, ler tudo, escrever snapshots falsos, rotacionar chaves para excluir outros. **Não consegue** forjar operações de outros membros (por exemplo, falsificar uma aceitação). Quem tem a CRK pode removê-lo via `admin.set`. | §5, §9.2, §11.4 |
| 3 | Banco do nó roubado (A2) | Textos cifrados, chaves públicas, assinaturas, índice de `op_id`, metadados. Nenhuma chave. | §2, §29 arq. |
| 4 | Interceptação de rede (A3) | TLS; mesmo com o TLS quebrado, os payloads têm criptografia ponta a ponta e os tokens de autenticação são vinculados a escopo e ao nó. | §3.1, §4 |
| 5 | Dispositivo/conta de usuário comprometido (A5 via malware) | O atacante age como aquele membro até ser removido. Seu alcance é o papel daquele membro. Mitigado por remoção + rotação. | §7.2 |
| 6 | Celular roubado (A7) | Celular bloqueado: chaves protegidas pelo keystore. Celular desbloqueado: o atacante tem aquela participação. O app DEVERIA oferecer bloqueio por PIN/biometria e um "perdi meu celular" remoto, via outro membro que contate um admin. | §2.4 |
| 7 | Membro removido (A4) | Lê o histórico até a remoção (inevitável). Não consegue ler nada após o `rotate`. Operações atrasadas na janela de tolerância são rejeitadas pelo reducer. | §7.3–7.4 |
| 8 | Nó destruído | Reconstruir a partir do dispositivo de um admin. | §11.3 |
| 9 | Nó substituído / impostor | Os dispositivos fixam o `node_id` por comunidade; a nova URL do nó precisa vir de um `DirectoryEntry` assinado ou de uma operação assinada dentro do próprio canal. Um impostor não consegue produzir entradas que se encadeiem a partir do head do dispositivo. | §11, §13 |
| 10 | Operação reenviada (replay) | A assinatura interna vincula `op_id`, `cid`, `epoch`; nó e reducer eliminam duplicatas por `op_id`. | §4.3, §6.3 |
| 11 | Operação duplicada | Envio idempotente; o reducer ignora `op_id` duplicado. | §6.3 |
| 12 | Dispositivo offline por muito tempo | Replay do log ≤ 30 d, senão snapshot. Os envelopes de chave da época atual nunca expiram. | §7.3, §12.4 |

## Ameaças adicionais

| Ameaça | Situação |
|---|---|
| Spam / assédio via entrada (A9) | Limites de taxa; política só por convite; questão em aberto §17.7. |
| Análise de tráfego ligando uma pessoa entre comunidades | Mitigada por chaves por comunidade. Não mitigada: mesmo IP / mesmo token de push entre comunidades (A1 + A8). |
| Vazamento de conteúdo em notificações push | Apenas pushes sem conteúdo e com texto fixo; o texto com conteúdo ("Bia mencionou você") é montado no dispositivo. O aviso entre dispositivos (`ping`) é correspondência selada. O nó guarda o token de push em claro (A1 vê que uma caixa postal tem um aparelho registrado e quando ele é acordado; com o token, só consegue mandar o aviso fixo). §14 |
| Consultas de disponibilidade "Quem poderia vir?" revelando agendas | As respostas trazem um de três vereditos, seladas para o organizador que perguntou e assinadas pelo membro; sem horários, locais ou distâncias. O nó vê que N itens foram postados e aproximadamente quando as respostas voltaram (metadados). A resposta automática vem desligada por padrão. protocolo §10.4 |
| Link de dispositivo vazado (A7, ou quem lê a conversa/área de transferência onde ele passou) | O link copiado não traz o código de 10 caracteres, que fica só na tela da origem; sem ele, o pacote não abre, e cada tentativa custa um Argon2id. O QR traz o código: uma foto dele, nos 10 minutos de validade, dá a filiação inteira. O pacote é de uso único; se outra pessoa o pegar antes, o aparelho certo vê "já usado" e a origem mostra o nome do aparelho que entrou. protocolo §10.5.5 |
| Dispositivo ligado perdido ou roubado (A7) | Desligar de outro aparelho só para o encaminhamento e faz um app que ainda obedece esquecer a comunidade. Quem guardou as chaves continua lendo, inclusive as próximas épocas, até um admin remover o membro (§7.2) e a pessoa entrar de novo. Ligar um navegador amplia a exposição: a chave do dispositivo no web é mais fraca que no keystore do celular (`security.md`). protocolo §10.5.6 |
| Nó ligando os dispositivos de uma pessoa | As cópias encaminhadas são seladas de novo e as caixas dos dispositivos são por comunidade; o nó ainda pode correlacionar pelo horário (encaminhamento logo após a leitura da caixa do membro). Mesma classe dos metadados de IP, fora de escopo. protocolo §10.5.3 |
| Histórico de localização | Nunca coletado. Os lugares são escolhidos pela pessoa; "onde estou agora" é uma única leitura aproximada (≈ 1 km) mantida por um dia, apenas no dispositivo. A localização em segundo plano do iOS/Android é desativada no build. |
| Coerção (alguém obriga um membro a desbloquear o celular) | Fora do escopo da v0. Candidato **[LATER]**: "ocultar esta comunidade" por comunidade, com PIN separado. |
| Ataque de bifurcação pelo nó (A1) | Detectado apenas por comparação entre dispositivos; a detecção completa é **[LATER]**. §13 |
| Snapshot malicioso de um admin | Detectado por membros que têm o log; não por membros novos. §17.5 |
| Cadeia de suprimentos (atualização maliciosa do app) | Fora do escopo do protocolo. Builds reproduzíveis e distribuição via F-Droid são desejáveis. |
| Provedor de hospedagem mantém uma comunidade como refém (A1 como negócio) | A suspensão bloqueia apenas escritas; leituras, `GET /export` e `migrate` continuam funcionando, e os celulares dos admins podem reconstruir a comunidade em qualquer lugar sem o provedor. As cotas também nunca bloqueiam `migrate`. [`managed-hosting.md`](managed-hosting.md) |
| Redirecionamento "moved" forjado (A1, A3) | Os dispositivos só se movem com uma entrada `migrate` assinada por um admin, que eles mesmos verificam; um `409 moved` isolado apenas mantém suas alterações na fila. Testado em `tests/offline` ("a node claiming the community moved…"). protocolo §11.3 |
| `migrate` revela o endereço do novo nó | A lista de nós fica no cabeçalho de controle em texto claro (o nó antigo precisa aplicar o congelamento e responder com ela). O operador antigo, e membros removidos que ainda puxam dele, descobrem para onde a comunidade foi; nenhum dos dois ganha acesso lá (sem EAK atual). Aceito para a v0. |
| Exposição da API de operador | Listener separado, bearer token, nenhum endpoint de conteúdo ou de chaves; as métricas são por cliente (tenant), nunca por comunidade, então serviços de monitoramento não recebem uma lista de comunidades. |
| Anexos no nó (A1, A2) | O nó guarda bytes opacos nomeados pelo SHA-256 do texto cifrado e não tem a chave de nenhum arquivo. **Vê** tamanhos, horários de envio e de download e o total por comunidade; **consegue** reter ou apagar arquivos (o app diz "esse arquivo não está mais no servidor") e substituí-los por lixo, que falha na verificação de hash e de AEAD. Não sabe que arquivo pertence a que tarefa ou pessoa: os tokens de acesso são por comunidade, não por membro. protocolo §9.7, §15 |
| Membro removido com cópia dos anexos (A4) | Os blobs não são recifrados na rotação de época: quem já tinha o texto cifrado e a chave (ambos no log até a sua época) continua lendo o que já podia ler. Depois do `rotate`, não obtém token para baixar nada, novo ou antigo. Mesmo alcance do histórico do log (cenário 7). |
| Membro esgota a cota de arquivos (A5) | Cota por comunidade e limite por arquivo no nó; uploads órfãos (sem tarefa que os referencie) são recolhidos pelos aparelhos de admins e moderadores ao sincronizar. O nó não atribui uploads a membros, então um abusador só é identificado pelas tarefas que cria; admins podem removê-lo e rotacionar. Aceito para a v0. |
| Anexo malicioso (malware, arquivo armadilha) (A5) | O app nunca abre, executa nem renderiza anexos: entrega os bytes à folha de compartilhamento do sistema, que os passa ao app que a pessoa escolher. O nome e o tipo mostrados vêm da tarefa (cifrada e assinada por quem anexou), não do nó. Moderação apaga tarefas e arquivos; denúncias chegam à coordenação. |
| Rastreamento por links em Markdown (A5) | Descrições e comentários aceitam só links `http(s)`, abertos pelo navegador do sistema ao toque; nada é buscado automaticamente (sem pré-visualização, sem imagens remotas). |

## Não objetivos explícitos da v0

- Ocultar *que* um dispositivo se comunica com determinado nó (metadados no nível de IP).
- Ocultar tamanhos e horários das mensagens.
- Proteger um membro contra o próprio dispositivo desbloqueado e comprometido.
- Sigilo futuro (forward secrecy) dentro de uma época (o comprometimento de um dispositivo expõe toda a
  época atual). Épocas mais curtas, via rotação agendada, reduzem isso.
