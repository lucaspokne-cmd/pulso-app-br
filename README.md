# PULSE — vídeos em movimento

Aplicação web de comunidade de vídeos com feed, contas, upload, curtidas e comentários.

## Arquitetura de produção

- **Servidor:** Node.js 22 com HTTP nativo.
- **Base de dados:** MySQL gerido pelo Webdev (`DATABASE_URL`), com tabelas criadas de forma idempotente no arranque.
- **Ficheiros de vídeo:** armazenamento de objetos durável do Webdev, através de URLs pré-assinadas. O browser envia o vídeo diretamente para o storage; o container não guarda uploads no disco local.
- **Sessões:** tokens HMAC assinados por `PULSE_SESSION_SECRET`, guardado como segredo protegido.
- **Limite de vídeo:** 100 MB; formatos MP4, WebM e MOV.
- **Endpoint de saúde:** `GET /api/health`.

A aplicação não contém contas, vídeos, comentários ou seeds de demonstração. Os dados criados pelos utilizadores são persistidos nos serviços geridos configurados para o projeto.

## Desenvolvimento

```bash
npm ci
npm run check
npm start
```

O servidor requer `DATABASE_URL`, `MANUS_API_URL`, `MANUS_API_KEY` e `PULSE_SESSION_SECRET` no ambiente. Nunca coloque esses valores no Git ou no frontend.

## Publicação

O projeto usa `Dockerfile` e o contrato de deploy do Webdev. O container escuta em `0.0.0.0:3000`; a configuração de publicação usa `/api/health` como health check. O manifesto de rotas encontra-se em `public/manus-routes.json`.

## Android

A pasta `android/` contém um WebView para a versão online. Depois de a publicação HTTPS estar concluída, a constante `SERVER_URL` em `MainActivity.java` deve apontar para a URL pública final antes da compilação do APK.

## Destaques iniciais

Para o visitante não encontrar um feed vazio, o PULSE mostra dois trailers editoriais licenciados da Blender Foundation desde a primeira abertura: **Big Buck Bunny** e **Sintel**, sob CC BY 3.0. As fontes oficiais são `https://peach.blender.org/download/` e `https://durian.blender.org/`; a atribuição aparece na interface. Vídeos virais de terceiros só devem ser adicionados com autorização dos titulares.
