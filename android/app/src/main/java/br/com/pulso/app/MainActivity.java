package br.com.pulso.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Toast;

public class MainActivity extends Activity {
    // Configure para a URL HTTPS do servidor PULSO quando ele estiver hospedado.
    // Não use localhost aqui: no celular, localhost é o próprio celular.
    private static final String SERVER_URL = "https://COLOQUE-AQUI-A-URL-DO-PULSO";

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        setContentView(web);
        if (SERVER_URL.contains("COLOQUE-AQUI")) {
            web.loadDataWithBaseURL(null,
                "<html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='background:#101116;color:white;font-family:sans-serif;padding:28px'><h1 style='color:#ff4e83'>PULSO</h1><h2>Aplicativo Android em preparação</h2><p>O app precisa da URL HTTPS do servidor para mostrar o feed compartilhado e permitir cadastro e publicação.</p><p>O servidor ainda precisa ser hospedado antes de gerar a versão final para instalação.</p></body></html>",
                "text/html", "UTF-8", null);
        } else {
            web.loadUrl(SERVER_URL);
        }
    }
    @Override public void onBackPressed() {
        Toast.makeText(this, "Use a navegação do PULSO para voltar.", Toast.LENGTH_SHORT).show();
    }
}
