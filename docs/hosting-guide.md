# Como montar o servidor da sua comunidade

Este guia é para quem vai **criar** uma comunidade no Vamo Virar. Quem só vai
participar não precisa de nada disso: basta instalar o app e abrir o link de
convite.

> **Resumo:** em uns 20 minutos, você instala dois programas gratuitos (Docker
> e Tailscale), cola três comandos e ganha um endereço como
> `https://meu-pc.exemplo.ts.net`. No app, você toca em "Criar uma
> comunidade" e cola esse endereço e um código de criação. Num computador seu,
> não custa nada. Numa VPS paga, sai por uns US$ 4 a 6 por mês.

## O que é o servidor

Cada comunidade precisa de um servidor pequeno que guarda e repassa as
informações entre os celulares. Ele recebe tudo **já cifrado**: não consegue
ler nomes, eventos, quem vai a quê nem a agenda de ninguém. Se o computador
quebrar ou for perdido, a comunidade fica fora do ar até você montar outro
servidor, mas ninguém consegue ler os dados que estavam nele.

O servidor é leve: gasta poucos MB de memória e quase nada de processador.
Um único servidor aguenta várias comunidades.

## Escolha onde rodar

| Onde | Custo | Bom para | Cuidado |
|---|---|---|---|
| **Um computador seu** (notebook velho, PC de mesa, Mac) | Grátis | Começar já, sem cartão de crédito | Precisa ficar ligado e conectado à internet |
| **Raspberry Pi** (modelo 4 ou 5, sistema de 64 bits) | Grátis se você já tem; gasta pouca energia | Ficar ligado o tempo todo em casa | Use um bom cartão de memória ou SSD e faça backups |
| **VPS paga** (servidor alugado na nuvem) | Uns US$ 4 a 6 por mês | Ficar sempre no ar, sem depender da sua casa | Alguém precisa pagar a conta todo mês |
| **Nuvem com plano grátis** (por exemplo, o "Always Free" da Oracle Cloud) | Grátis | Quem tem paciência com cadastro | Pede cartão de crédito, o cadastro é mais complicado e às vezes falta vaga |

**Nossa sugestão:** comece num computador que você já tem. Se a comunidade
crescer e você quiser que ela não dependa da sua casa, mude para uma VPS: dá
para trocar de servidor depois pelo próprio app, sem perder nada (veja
[Mudar de servidor](#mudar-de-servidor)).

Em todos os casos o passo a passo é **o mesmo**: Docker para rodar o servidor
e Tailscale para dar a ele um endereço seguro (HTTPS) na internet, sem mexer no
roteador e sem comprar domínio.

## Passo 1: instale o Docker

O Docker roda o servidor do Vamo Virar sem você precisar instalar mais nada.

- **Windows ou Mac:** baixe e instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/).
  Abra o programa uma vez e, nas configurações, marque **"Start Docker Desktop
  when you sign in"** (abrir o Docker ao entrar no computador).
- **Linux, Raspberry Pi ou VPS:** abra o terminal e rode:

```sh
curl -fsSL https://get.docker.com | sudo sh
```

Para conferir, rode `docker --version`. Se aparecer um número de versão, deu
certo. (No Linux, se ele reclamar de permissão, coloque `sudo` antes de cada
comando `docker` deste guia.)

## Passo 2: crie o seu código de criação

O código de criação é uma senha que só você (e quem você escolher) usa para
criar comunidades no seu servidor. Sem ele, estranhos não conseguem usar o seu
servidor. Para gerar um código aleatório, rode no terminal (no Windows, use o
PowerShell):

```sh
docker run --rm alpine sh -c "tr -dc a-z0-9 < /dev/urandom | head -c 32; echo"
```

Vai aparecer algo como `k3v9x0q2m8...`. **Copie e guarde** esse código num lugar
seguro, como um gerenciador de senhas. Nos próximos passos, troque
`SEU_CODIGO` por ele.

## Passo 3: ligue o servidor

Rode este comando (é uma linha só; copie inteira):

```sh
docker run -d --name vamo-virar --restart unless-stopped -p 127.0.0.1:8787:8787 -e VV_PROVISIONING_TOKEN=SEU_CODIGO -e VV_TRUST_FORWARDED_FOR=1 -v vamo-virar-dados:/data ghcr.io/hugobessa/community-node:latest
```

O que ele faz:

- baixa o servidor do Vamo Virar e o deixa rodando em segundo plano;
- religa o servidor sozinho quando o computador reinicia (`--restart unless-stopped`);
- guarda os dados num volume chamado `vamo-virar-dados`, que sobrevive a
  atualizações;
- deixa o servidor acessível só dentro do próprio computador. Quem leva ele
  para a internet, com segurança, é o Tailscale no próximo passo.

Para conferir, rode `docker ps`. A linha `vamo-virar` deve aparecer com o
status `Up` (e, depois de alguns segundos, `healthy`).

## Passo 4: dê um endereço na internet com o Tailscale

O [Tailscale](https://tailscale.com/) tem um recurso chamado **Funnel** que
publica o servidor num endereço fixo com HTTPS, de graça, sem abrir portas no
roteador e sem comprar domínio. O plano pessoal gratuito é suficiente.

1. Crie uma conta gratuita em [tailscale.com](https://tailscale.com/) (dá para
   entrar com Google, Microsoft, GitHub ou Apple).
2. Instale o Tailscale **no mesmo computador do servidor**:
   - **Windows ou Mac:** baixe em [tailscale.com/download](https://tailscale.com/download),
     instale e entre com a sua conta. Deixe marcado para abrir ao entrar no
     computador.
   - **Linux, Raspberry Pi ou VPS:** rode os comandos abaixo. O `tailscale up`
     mostra um link: abra no navegador e entre com a sua conta.

     ```sh
     curl -fsSL https://tailscale.com/install.sh | sh
     sudo tailscale up
     ```

3. Ligue o Funnel para o servidor:

   ```sh
   tailscale funnel --bg 8787
   ```

   No Linux, use `sudo tailscale funnel --bg 8787`. No Mac, se o comando
   `tailscale` não for encontrado, use
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 8787`.

   **Na primeira vez**, o comando mostra um link para ativar o Funnel na sua
   conta. Abra o link, clique para ativar e rode o comando de novo.

4. O comando mostra o endereço do seu servidor, parecido com:

   ```
   https://meu-computador.tail1234.ts.net/
   |-- proxy http://127.0.0.1:8787
   ```

Esse `https://...ts.net` é o **endereço do servidor da comunidade**. Ele é fixo:
continua o mesmo depois de reiniciar o computador. Para ver de novo, rode
`tailscale funnel status`.

Para testar, abra `https://meu-computador.tail1234.ts.net/.well-known/vamo-virar`
(com o seu endereço) no navegador do celular, com o Wi-Fi desligado. Se
aparecer um texto começando com `{"protocol"`, o servidor está acessível pela
internet.

## Passo 5: crie a comunidade no app

1. Instale o Vamo Virar no celular e toque em **Criar uma comunidade**.
2. Preencha o nome da comunidade e o seu nome.
3. Em **Endereço do servidor da comunidade**, cole o endereço `https://...ts.net`.
4. Em **Código de criação**, cole o código do passo 2.
5. Toque em **Criar**. Pronto: agora é só convidar as pessoas pelo app.

As pessoas que você convidar **não precisam** do endereço nem do código: o
link de convite já leva tudo o que elas precisam.

## Se você escolheu uma VPS

Uma VPS é um computador alugado que fica ligado o tempo todo num data center.
Para o Vamo Virar, a configuração mais barata de qualquer empresa serve:

- **1 vCPU, 512 MB a 1 GB de memória, 10 GB de disco**;
- **sistema Ubuntu 24.04** (ou outro Linux recente);
- a região mais próxima da sua comunidade (São Paulo, se houver).

Empresas como Hetzner, Contabo, Vultr, DigitalOcean, Hostinger e Magalu Cloud
oferecem essa configuração por uns US$ 4 a 6 por mês (os preços mudam; confira
antes de contratar). Ao criar a VPS, escolha Ubuntu e anote o IP e a senha
(ou cadastre a sua chave SSH).

Depois, entre na VPS pelo terminal:

```sh
ssh root@IP_DA_SUA_VPS
```

No Windows, o PowerShell já tem o comando `ssh`. Uma vez dentro, siga os
passos 1 a 5 acima exatamente como no Linux. Não é preciso abrir nenhuma porta
no firewall da VPS: o Tailscale cuida da conexão.

> **Prefere um domínio próprio** (como `servidor.minhacomunidade.org`) em vez
> do endereço do Tailscale? Na VPS dá para usar o Caddy, que pega o certificado
> HTTPS sozinho. O passo a passo está em [deploy.md](deploy.md).

## Se você escolheu um Raspberry Pi

Use o **Raspberry Pi OS de 64 bits** (Raspberry Pi 4 ou 5). Siga os passos 1 a 5
como no Linux. Como ele vai ficar ligado o tempo todo, vale:

- usar uma fonte de energia oficial e um cartão de memória de boa qualidade
  (ou, melhor ainda, um SSD pela USB);
- fazer [backups](#backups) de vez em quando.

## Mantendo o servidor

### Deixe o computador ligado

O servidor só funciona enquanto o computador está ligado e com internet. Num
notebook ou PC:

- desative a suspensão automática (no Windows: Configurações › Sistema ›
  Energia; no Mac: Ajustes do Sistema › Bateria/Energia, "Impedir suspensão
  automática");
- num notebook, deixe na tomada.

Se o servidor ficar fora do ar por um tempo, nada se perde: os celulares
guardam o que foi feito e sincronizam quando ele voltar.

### Backups

O celular de quem organiza a comunidade consegue reconstruí-la em outro
servidor, então o backup é uma segurança a mais, não a única cópia. Para fazer
um backup:

```sh
docker exec vamo-virar /usr/local/bin/community-node backup --out /data/backup.sqlite
docker cp vamo-virar:/data/backup.sqlite ./vamo-virar-backup.sqlite
```

Guarde o arquivo `vamo-virar-backup.sqlite` em outro lugar (um pendrive, outro
computador). O backup é seguro de fazer com o servidor rodando.

### Atualizações

Faça um backup e rode:

```sh
docker pull ghcr.io/hugobessa/community-node:latest
docker rm -f vamo-virar
```

Depois rode de novo o comando do [passo 3](#passo-3-ligue-o-servidor), com o mesmo
código. Os dados continuam no volume `vamo-virar-dados`, e o endereço do
Tailscale continua o mesmo.

### Mudar de servidor

Quer sair do computador de casa e ir para uma VPS (ou o contrário)? Monte o
servidor novo seguindo este guia e, no app, vá na aba **Eu** › **Mudar de
servidor**, com o novo endereço e o código de criação
dele. Cada pessoa da comunidade passa para o servidor novo sozinha, na próxima
vez que abrir o app.

## Problemas comuns

| O que aconteceu | O que fazer |
|---|---|
| `docker: command not found` | O Docker não está instalado ou não está aberto. No Windows e no Mac, abra o Docker Desktop e espere ele terminar de iniciar. |
| `permission denied` ao rodar `docker` no Linux | Coloque `sudo` antes do comando. |
| `Conflict. The container name "/vamo-virar" is already in use` | O servidor já existe. Para recriá-lo, rode `docker rm -f vamo-virar` e o comando do passo 3 de novo (os dados ficam no volume). |
| O `tailscale funnel` diz que o Funnel não está ativado | Abra o link que ele mostra, ative o Funnel na sua conta e rode o comando de novo. |
| O app diz que o servidor não permite criar a comunidade | O código de criação está errado. Confira se não sobrou espaço no começo ou no fim. |
| O app não consegue falar com o servidor | Confira se o computador está ligado, se `docker ps` mostra `vamo-virar` como `Up` e se `tailscale funnel status` mostra o endereço. Faça o teste do fim do passo 4. |
| Esqueci o código de criação | Gere um novo (passo 2), rode `docker rm -f vamo-virar` e o comando do passo 3 com o código novo. As comunidades que já existem continuam funcionando. |

## O que o servidor vê (e o que não vê)

Quem cuida do servidor consegue ver que comunidades existem (identificadas só
por números aleatórios), quanto de dado cifrado cada uma guarda, quando os
celulares se conectam e de qual endereço IP. **Não** consegue ver nomes,
eventos, quem participa de quê, agendas, localizações nem o conteúdo de nada
que a comunidade compartilha. Os detalhes técnicos estão em
[deploy.md](deploy.md) e em [threat-model.md](threat-model.md).
