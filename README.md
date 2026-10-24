# ScreenPLAY

Transmita a tela do seu PC para os amigos — com ou sem o som do PC. **O microfone e a câmera nunca são usados.**

## Baixar

👉 **[Baixar a versão mais nova](../../releases/latest)** — clique em `ScreenPLAY-Setup-x.y.z.exe`.

Na primeira vez o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**. Depois disso o ScreenPLAY se atualiza sozinho ao abrir.

## Como usar

1. Abra o ScreenPLAY e crie sua conta (e-mail, senha e um nome de usuário).
2. Clique no **+** da barra da esquerda e crie um **grupo** — ele já vem com o canal de texto `#geral` e uma sala de transmissão.
3. Clique no nome do grupo → **Convidar pessoas** e mande o código para os amigos. Eles clicam em **Entrar com convite** e colam o código.
4. Converse nos canais de texto. Para transmitir, entre numa **sala de transmissão**, clique em **Transmitir minha tela**, escolha a tela inteira ou uma janela, e marque se quer **com som do PC**.

Só quem criou o grupo cria, renomeia e apaga canais e salas, e troca o nome e a foto do grupo.

Na direita fica a lista de membros do grupo (online e offline, e em que sala cada um está). Clicando em alguém dá pra mandar uma **mensagem privada** — as conversas privadas ficam no **Início** (o logo no topo da barra). No chat dá pra mandar links, imagens e arquivos de até 8 MB (botão **+**, colar ou arrastar). Na engrenagem → **Perfil** você troca sua foto e escolhe um efeito animado para o seu nome.

A imagem vai direto de um PC para o outro (WebRTC). Para os PCs se encontrarem é usado o servidor público gratuito do [PeerJS](https://peerjs.com/). As mensagens dos canais de texto ficam no Firebase.

## Para desenvolver

```bash
npm install
npx install-electron
npm run build:audio   # compila native/ScreenPLAYAudio.exe (som app por app, sem o Discord)
npm run build:auth    # empacota src/auth-entry.js (contas no Firebase) em auth-bundle.js
npm start             # roda o app
npm run dist          # gera o instalador em dist/ (já compila o ScreenPLAYAudio.exe)
```

Para lançar uma versão nova: aumente `version` no `package.json`, rode `npm run dist` e publique um release `vX.Y.Z` com `ScreenPLAY-Setup-X.Y.Z.exe`, o `.blockmap` e o `latest.yml` de `dist/`. Os apps instalados pegam a versão nova sozinhos.

Contas e grupos: login com e-mail e senha no Firebase (projeto `screenplay-77fc4`); grupos, canais e mensagens no Firestore. As regras de segurança ficam em `firestore.rules` — cole no console do Firebase (Firestore → Regras) sempre que mudarem.
