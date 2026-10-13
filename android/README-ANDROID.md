# PULSE para Android — projeto de embalagem

Este é um projeto-fonte Android Studio (WebView). **Não é um APK compilado**.

## Por que não há APK final aqui?
O projeto já tem a URL HTTPS real do PULSE, mas esta Sandbox ARM64 não consegue executar o binário AAPT2 Linux x86-64 distribuído pelo Android SDK. Por isso, não vou entregar um APK que não foi compilado e verificado.

## Como finalizar
1. Abra esta pasta no Android Studio atualizado em um computador com SDK Android.
2. Aguarde a sincronização do Gradle.
3. A URL `https://pulso-tyernpt7.manus.space` já está configurada em `MainActivity.java`.
4. Use **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. O Android Studio mostrará o caminho do APK gerado.

## Avisos
- Não coloque uma URL inventada: ela precisa ser a URL real do servidor implantado.
- O backend está online com HTTPS, base de dados e armazenamento duráveis; moderação, denúncias, políticas de privacidade e backups operacionais ainda devem ser ampliados antes de uma escala maior.
- Não use HTTP público nem exponha um computador com Windows 7 diretamente à internet.
