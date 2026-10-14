# Política de Privacidade — Vamo Virar

**Última atualização:** 13 de outubro de 2026

Esta política explica quais dados o aplicativo **Vamo Virar** ("o app") trata,
onde eles ficam e quais são os seus direitos. O Vamo Virar foi desenhado para
que o mínimo possível de informação saia do seu celular.

## 1. Quem é o responsável

O app é desenvolvido por **Hugo Rafael Bessa de Andrade**
(CPF 090.885.294-00), contato: **[vamovirar@bessa.me](mailto:vamovirar@bessa.me)**.

O Vamo Virar funciona de forma descentralizada. Cada comunidade é sincronizada
por um **nó da comunidade**, um servidor pequeno operado por **você ou por alguém
da sua comunidade** (nó próprio), seguindo as instruções de instalação do
projeto. Não oferecemos hospedagem gerenciada.

Quem opera o nó da sua comunidade decide onde ele roda e por quanto tempo guarda
os dados dele. Nós, como desenvolvedores do app, **não temos acesso ao conteúdo
das comunidades** e não operamos nenhum servidor central de contas.

## 2. Resumo

- Sua **agenda**, sua **localização** e sua **disponibilidade** ficam **só no seu
  celular**. O app apenas responde "consigo ir?" a quem perguntou.
- O que é compartilhado com uma comunidade (membros, eventos, participações,
  tarefas, comentários e arquivos anexados) é **cifrado de ponta a ponta**
  antes de sair do aparelho. O nó guarda apenas texto cifrado.
- Não usamos **analytics, publicidade, rastreadores nem relatórios de falha**
  de terceiros que enviem dados para fora do seu aparelho.
- Não vendemos nem compartilhamos dados pessoais.
- Não há cadastro com e-mail, telefone ou senha. Você é identificado(a) por
  chaves criptográficas geradas no seu celular.

## 3. Dados tratados e para quê

### 3.1 Dados que ficam apenas no seu celular

| Dado | Origem | Finalidade | Observações |
|---|---|---|---|
| Horários ocupados do calendário (início, fim, dia inteiro, ocupado/provisório) | Calendário do celular, Google Agenda ou Outlook/Microsoft 365, se você conectar | Mostrar só para você se pode ir a um evento | Não lemos títulos, locais nem convidados. Janela de ontem até 90 dias à frente. Armazenados cifrados no aparelho. |
| Lugares que você cadastra (ex.: "Casa", "Trabalho"), com raio e datas | Você | Estimar a distância e o deslocamento até um evento | Ficam no aparelho. |
| Localização aproximada "onde estou agora" | Sensor de localização, só quando você pede | Marcar onde você está | Uma única leitura, arredondada para cerca de 1 km, guardada por um dia. **Não coletamos localização em segundo plano nem histórico de localização.** |
| Preferências (margem livre, tratamento de dia inteiro, respostas automáticas) | Você | Personalizar a sugestão de disponibilidade | — |
| Chaves criptográficas e tokens de acesso ao Google/Microsoft | Gerados no app / pelos provedores | Identificar você e acessar seu calendário | Guardados no Keychain (iOS) ou Keystore (Android). |

Esses dados **não são enviados** a nós, ao nó da comunidade nem a outros membros.

Se você ligar outro aparelho seu (por exemplo, o celular e o computador), o app
leva para ele as chaves das suas comunidades, cifradas com um segredo que só
passa pelo código QR ou pelo link e pelo código que você digita. O pacote fica
no nó da comunidade por no máximo 10 minutos e o nó não consegue abri-lo. A
lista dos seus aparelhos e os nomes que você dá a eles também ficam cifrados e
só os seus aparelhos leem. Agenda, lugares e preferências **não** passam de um
aparelho para outro.

### 3.2 Dados compartilhados com a comunidade (cifrados de ponta a ponta)

Quando você cria ou entra numa comunidade, o app envia ao nó, **já cifrados**:

- sua participação na comunidade e seu nome ou apelido de exibição, conforme você informar;
- eventos criados, convites, confirmações de presença e voluntariado;
- tarefas de organização: título, descrição, etiquetas, prazo, quem é
  responsável e quem ajuda, as mudanças de situação e os comentários;
- arquivos anexados a tarefas (fotos, documentos; até 10 MB cada). Cada
  arquivo é cifrado no seu celular com uma chave própria antes de ser
  enviado, e essa chave só viaja dentro do conteúdo cifrado da tarefa. O nó
  guarda o arquivo cifrado e conhece apenas o tamanho dele;
- respostas a perguntas de organizadores do tipo "quem poderia vir?", que contêm
  apenas **"posso", "talvez" ou "não posso"** (nunca horários, locais ou
  distâncias), seladas para quem perguntou. As respostas automáticas vêm
  **desligadas por padrão**.

Esse conteúdo só pode ser lido por membros da comunidade que tenham as chaves.
**Os outros membros da comunidade e os administradores veem o que você
decide compartilhar nela** (por exemplo, que você é membro e se vai a um
evento). O app mostra cada tarefa, com seus comentários e arquivos, a quem
está nela, a quem participa da ação a que ela pertence e à coordenação e à
moderação; tarefas à espera de voluntário aparecem para todos os membros.
Tecnicamente, porém, todo membro da comunidade tem as chaves para ler tudo o
que ela contém. Considere isso antes de entrar em comunidades que tratem de
assuntos sensíveis.

### 3.3 Dados que o nó consegue ver (metadados)

Mesmo sem ler o conteúdo, o nó e quem o opera conseguem observar:

- o **endereço IP** e o horário das conexões, o tamanho e a frequência das mensagens
  e a atividade das caixas postais;
- o tamanho de cada arquivo anexado, quando foi enviado e quando foi baixado,
  e o espaço total que a comunidade ocupa (sem saber a que tarefa ou pessoa
  cada arquivo pertence);
- o identificador da comunidade e as **chaves públicas dos administradores**
  (em texto claro);
- o nome e a descrição da comunidade, **apenas se** a comunidade optar por listá-los
  publicamente em um diretório.

O software do nó que desenvolvemos não registra corpos de requisição nem tokens
e, por padrão, não registra endereços IP. Quem opera o nó pode configurá-lo de
forma diferente (por exemplo, para tratar abuso) e pode ter registros no
servidor ou no provedor de hospedagem. Pergunte a quem opera o nó da sua
comunidade.

O app **não esconde o seu endereço IP** do nó. Se isso for importante para você,
use uma VPN.

### 3.4 Provedores de calendário (opcional)

Se você conectar o **Google Agenda** ou o **Outlook/Microsoft 365**, o app fala
**diretamente do seu celular** com o Google ou a Microsoft (OAuth 2 com PKCE),
sem passar por nossos servidores:

- Google: escopo `calendar.freebusy`, apenas horários ocupados.
- Microsoft: `Calendars.ReadBasic` e `offline_access`, apenas início, fim e
  status dos compromissos.

O tratamento de dados por esses provedores é regido pelas políticas deles.
Ao desconectar, o app apaga os tokens e os horários em cache e pede ao Google
que revogue a autorização. Você também pode revogar o acesso nas configurações
da sua conta Google ou Microsoft.

### 3.5 Lojas de aplicativos e infraestrutura de build

A Apple (App Store) e o Google (Google Play) tratam dados sobre a instalação e o
uso do app conforme as políticas deles. Não recebemos de você, por meio do app,
dados pessoais além do que as lojas nos informam em relatórios agregados.

## 4. Permissões do dispositivo

| Permissão | Para quê | Se você negar |
|---|---|---|
| Calendário (leitura) | Calcular a disponibilidade | O app funciona sem sugestão de agenda |
| Localização aproximada, apenas durante o uso | Botão "usar onde estou agora" | Você pode cadastrar lugares manualmente |
| Câmera, apenas durante o uso | Ler o código QR que liga este aparelho a outro seu | Você cola o link e digita o código |

O app **não** solicita localização precisa, nem em segundo plano, e não pede
acesso a contatos ou microfone. A câmera só abre quando você toca em
"Escanear o código"; nenhuma imagem é guardada ou enviada. Para anexar um arquivo a uma tarefa,
o app abre o seletor de arquivos do sistema e recebe apenas o arquivo que você
escolher; ele não tem acesso aos seus outros arquivos nem às suas fotos. Um
arquivo que você abre a partir de uma tarefa é decifrado no seu celular e
guardado na pasta de cache do app para ser aberto ou compartilhado; o sistema
pode apagá-lo a qualquer momento.

## 5. Bases legais (LGPD)

Tratamos dados com base em: **execução do serviço que você solicitou** (art. 7º,
V, da Lei nº 13.709/2018 — LGPD), **consentimento** para o acesso ao calendário
e à localização, que você pode revogar a qualquer momento (art. 7º, I), e
**legítimo interesse** para segurança e prevenção de abuso, quando aplicável
(art. 7º, IX).

Algumas informações que você compartilha numa comunidade (como filiação a
grupos) podem ser **dados sensíveis** conforme o contexto (art. 11 da LGPD).
Esse compartilhamento é feito por você, de forma consciente, com os membros da
comunidade que você escolher.

## 6. Retenção

- **No celular:** os dados ficam até você removê-los, desconectar a fonte,
  sair da comunidade ou desinstalar o app. A localização "onde estou agora" expira
  em um dia.
- **No nó:** o registro cifrado de cada comunidade é mantido enquanto a
  comunidade existir. Snapshots permitem que o nó compacte o registro anterior
  (por padrão, após 30 dias). Itens de caixas postais expiram automaticamente.
  Entradas de controle (administradores, mudanças de chaves) são mantidas, pois
  permitem reconstruir a comunidade.
- **Arquivos anexados, no nó:** ficam enquanto a tarefa existir. Quando a
  tarefa ou a ação dela é apagada, e quando uma tarefa feita ou cancelada
  passa do prazo de retenção definido pela comunidade (30 dias, por padrão),
  os aparelhos da coordenação e da moderação pedem ao nó que descarte os
  arquivos que nada mais referencia. Ao sair da comunidade, os arquivos que
  você anexou continuam nela.
- **Por limitações técnicas:** o conteúdo cifrado já replicado em
  dispositivos de outros membros ou em backups do nó, e arquivos que outros
  membros abriram ou baixaram, **não podem ser apagados por nós**.

## 7. Compartilhamento

Não vendemos dados. Dados só chegam a terceiros nas situações abaixo:

- **Membros e administradores** da comunidade, conforme a seção 3.2;
- **Operador do nó** e seu provedor de hospedagem, conforme a seção 3.3;
- **Google e Microsoft**, se você conectar essas contas, conforme a seção 3.4;
- **Autoridades**, se houver ordem legal válida. Como não temos acesso ao
  conteúdo cifrado das comunidades, só poderíamos fornecer o que de fato
  possuímos.

## 8. Segurança

- Criptografia de ponta a ponta do conteúdo das comunidades e assinaturas
  digitais das operações.
- Chaves privadas no armazenamento seguro do sistema (Keychain/Keystore);
  banco de dados local cifrado em repouso.
- TLS obrigatório na comunicação com o nó (exceto em `localhost`, para
  desenvolvimento).
- Limitação de taxa para reduzir abuso.

Nenhum sistema é totalmente seguro. Se você perder o aparelho, avise um
administrador da comunidade para que ele possa remover seu acesso e trocar as
chaves. **Perder as chaves do seu aparelho e não ter backup pode significar
perder o acesso às suas comunidades**, e nós não temos como recuperá-lo.

A versão **web** do app é apenas para desenvolvimento e guarda os dados sem a
mesma proteção do aplicativo móvel; não a use para dados reais.

## 9. Seus direitos

Nos termos da LGPD, você pode solicitar: confirmação do tratamento, acesso,
correção, anonimização, bloqueio ou eliminação de dados, portabilidade,
informação sobre compartilhamentos, e revogação do consentimento.

Como a maior parte dos seus dados está **no seu celular**, você mesmo(a)
exerce a maioria desses direitos no app: desconectando calendários, apagando
lugares, saindo de comunidades ou desinstalando o app. Para pedidos sobre dados
que estejam num nó, fale com quem o opera. Para qualquer outro pedido, escreva
para **[vamovirar@bessa.me](mailto:vamovirar@bessa.me)**. Explicaremos o que conseguimos e o que não
conseguimos atender, e por quê. Você também pode reclamar à
**Autoridade Nacional de Proteção de Dados (ANPD)**.

## 10. Crianças e adolescentes

O app não é direcionado a menores de **18** anos, e não coletamos
intencionalmente dados deles. Se você acredita que um menor usa o app, entre em
contato. Nossos [Padrões de Segurança Infantil](child-safety.md) explicam como
combatemos o abuso e a exploração sexual infantil e como denunciar.

## 11. Transferência internacional

Nós não operamos servidores centrais. O nó da sua comunidade, o Google e a
Microsoft podem estar fora do Brasil. Nesses casos, os dados transitam com as
proteções descritas nesta política (como a criptografia de ponta a ponta) e
conforme as políticas de cada provedor.

## 12. Mudanças nesta política

Podemos atualizar esta política. Alterações relevantes serão comunicadas no app
ou no repositório do projeto, e a data no topo será atualizada. Se uma mudança
ampliar o uso dos seus dados, pediremos seu consentimento novamente quando a lei
exigir.

## 13. Contato

**Hugo Rafael Bessa de Andrade** — **[vamovirar@bessa.me](mailto:vamovirar@bessa.me)**
