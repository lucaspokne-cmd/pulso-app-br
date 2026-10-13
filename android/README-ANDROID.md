# PULSE para Android — projeto de embalagem

Este é um projeto-fonte Android Studio (WebView). **Não é um APK compilado**.

## Por que não há APK final aqui?
A sessão de construção disponível não tem Android SDK/Gradle instalado, então não consigo compilar e verificar honestamente um APK neste ambiente. Além disso, o servidor do PULSE ainda não está hospedado com uma URL HTTPS pública. Sem isso, o app instalado não consegue acessar um feed compartilhado pela internet.

## Como finalizar
1. Hospede o backend PULSE em uma infraestrutura compatível e configure HTTPS.
2. Em `app/src/main/java/br/com/pulso/app/MainActivity.java`, substitua `https://pulso-tyernpt7.manus.space` pela URL HTTPS real.
3. Abra esta pasta no Android Studio atualizado.
4. Aguarde a sincronização do Gradle.
5. Use **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
6. O Android Studio mostrará o caminho do APK gerado.

## Avisos
- Não coloque uma URL inventada: ela precisa ser a URL real do servidor implantado.
- O backend atual é um protótipo e ainda precisa de HTTPS, moderação, backups, armazenamento de vídeo apropriado e revisão de segurança antes de uso público.
- Não use HTTP público nem exponha um computador com Windows 7 diretamente à internet.
