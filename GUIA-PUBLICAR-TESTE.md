# Operar e publicar o PULSE

O PULSE está preparado para publicação como aplicação web Node.js em container. A base de dados e os vídeos usam recursos geridos; não há dados de amostra no repositório.

## Verificações antes da publicação

```bash
npm ci
npm run check
```

O ambiente de execução precisa fornecer `DATABASE_URL`, `MANUS_API_URL`, `MANUS_API_KEY` e `PULSE_SESSION_SECRET` através da configuração protegida do projeto. Os dois primeiros recursos são configurados pelo Webdev; o último é um segredo privado da aplicação.

## Verificação após publicação

1. Abrir a URL HTTPS pública.
2. Confirmar `GET /api/health` com `ok: true` e `database: "ready"`.
3. Criar uma conta real com um endereço que possa ser usado no ambiente de produção.
4. Entrar novamente nessa conta.
5. Enviar um vídeo real que não contenha dados pessoais sensíveis.
6. Confirmar que o vídeo aparece após atualizar a página.
7. Confirmar curtidas e comentários com a conta criada.

Não utilizar senhas reutilizadas nem dados pessoais de terceiros durante a validação. A aplicação não cria utilizadores, vídeos ou comentários automaticamente.

## Android

Depois de obter a URL HTTPS pública, substituir `SERVER_URL` em `android/app/src/main/java/br/com/pulso/app/MainActivity.java` pela URL final. O APK só deve ser compilado depois de essa URL responder e de a validação da versão web estar concluída.

## Operação e manutenção

- O armazenamento de objetos mantém os vídeos fora do filesystem efémero do container.
- A base de dados mantém contas e interações entre reinícios e deployments.
- O limite atual por vídeo é 100 MB.
- Devem ser adicionados, antes de uma escala maior, moderação, denúncias, políticas de privacidade, recuperação de conta, métricas e backups operacionais.
