package com.news.ifxhelper;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;

/** XAU//DESK host activity with BBMA notification/deep-link routing. */
public class MainActivity extends BridgeActivity {
    private Intent pendingDeepLink;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        pendingDeepLink = getIntent();
        routeWhenReady();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingDeepLink = intent;
        routeWhenReady();
    }

    private void routeWhenReady() {
        getWindow().getDecorView().postDelayed(() -> {
            Bridge bridge = getBridge();
            if (bridge == null || bridge.getWebView() == null || pendingDeepLink == null) return;
            Uri uri = pendingDeepLink.getData();
            if (uri == null) return;
            String open = uri.getQueryParameter("open");
            boolean bbma = "bbma".equalsIgnoreCase(uri.getHost()) || "bbma".equalsIgnoreCase(open);
            if (!bbma) return;
            String alertId = safe(uri.getQueryParameter("alertId"));
            String tf = safeTimeframe(uri.getQueryParameter("tf"));
            String js = "(function(){var d={alertId:'" + alertId + "',timeframe:'" + tf + "'};" +
                    "document.dispatchEvent(new CustomEvent('bbma-alert-open',{detail:d}));" +
                    "if(window.BBMADashboardUI)window.BBMADashboardUI.openAlert(d.alertId,d.timeframe);})();";
            bridge.getWebView().evaluateJavascript(js, null);
            pendingDeepLink = null;
        }, 700);
    }

    private static String safe(String value) {
        if (value == null) return "";
        return value.replaceAll("[^A-Za-z0-9_.:-]", "");
    }

    private static String safeTimeframe(String value) {
        if (value == null) return "H1";
        String tf = value.toUpperCase();
        switch (tf) {
            case "M5": case "M15": case "M30": case "H1":
            case "H4": case "D1": case "W1": case "MN1": return tf;
            default: return "H1";
        }
    }
}
