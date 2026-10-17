# ScreenPLAY

Transmita a tela do seu PC para os amigos — com ou sem o som do PC. **O microfone e a câmera nunca são usados.**

## Baixar

👉 **[Baixar a versão mais nova](../../releases/latest)** — clique em `ScreenPLAY-Setup-x.y.z.exe`.

Na primeira vez o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**. Depois disso o ScreenPLAY se atualiza sozinho ao abrir.

## Como usar

1. Abra o ScreenPLAY, digite seu nome e clique em **Criar sala**.
2. Mande o código de 6 letras para os amigos — eles clicam em **Entrar**.
3. Clique em **Transmitir minha tela**, escolha a tela inteira ou uma janela, e marque se quer **com som do PC**.

A imagem vai direto de um PC para o outro (WebRTC). Para os PCs se encontrarem é usado o servidor público gratuito do [PeerJS](https://peerjs.com/).

## Para desenvolver

```bash
npm install
npx install-electron
npm start          # roda o app
npm run dist       # gera o instalador em dist/
```

Para lançar uma versão nova: aumente `version` no `package.json`, rode `npm run dist` e publique um release `vX.Y.Z` com `ScreenPLAY-Setup-X.Y.Z.exe`, o `.blockmap` e o `latest.yml` de `dist/`. Os apps instalados pegam a versão nova sozinhos.
