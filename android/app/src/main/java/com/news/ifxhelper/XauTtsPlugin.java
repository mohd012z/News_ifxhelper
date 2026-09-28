package com.news.ifxhelper;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.UUID;

/**
 * Native TTS for XAU//DESK (Android).
 *
 * WHY THIS EXISTS: Android WebView exposes window.speechSynthesis (so the web
 * app cannot feature-detect the gap) but its TTS implementation is a no-op on
 * essentially all devices: utterances are "queued" and never audibly spoken.
 * Result was the "Voice on/off" toggle that visibly worked but never produced
 * sound. This plugin speaks through the OS TextToSpeech service (the same
 * engine Android uses for accessibility), which reliably plays audio. The web
 * app routes speak() through here on native platforms and keeps the Web Speech
 * API for desktop/mobile browsers.
 *
 * Every failure path rejects or no-ops — it never reports a fake success.
 */
@CapacitorPlugin(name = "XauTts")
public class XauTtsPlugin extends Plugin implements TextToSpeech.OnInitListener {

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ready = false;
    private boolean initFailed = false;
    private volatile boolean initStarted = false;

    @Override
    public void load() {
        Context ctx = getContext();
        if (ctx == null) {
            initFailed = true;
            return;
        }
        // TextToSpeech must be constructed on the main thread (Android docs);
        // load() runs on the bridge's plugin thread, so hop.
        main.post(new Runnable() {
            @Override
            public void run() {
                if (initStarted) return;
                initStarted = true;
                try {
                    tts = new TextToSpeech(ctx.getApplicationContext(), XauTtsPlugin.this);
                } catch (Throwable t) {
                    initFailed = true;
                }
            }
        });
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            ready = true;
            // en-US when the device has it; otherwise the OS default voice.
            int lang = tts.setLanguage(Locale.US);
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.getDefault());
            }
        } else {
            initFailed = true;
        }
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject j = new JSObject();
        j.put("ready", ready && !initFailed);
        call.resolve(j);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("empty text");
            return;
        }
        if (initFailed || tts == null) {
            call.reject("tts unavailable");
            return;
        }
        if (!ready) {
            // Engine still loading: retry once on the main thread shortly, then
            // report honestly. Plugin calls arrive on the bridge thread.
            main.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (ready) speak(call);
                    else call.reject("tts not ready");
                }
            }, 250);
            return;
        }
        final String id = "xau-" + UUID.randomUUID().toString();
        int rc = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
        if (rc != TextToSpeech.SUCCESS) {
            call.reject("speak failed rc=" + rc);
            return;
        }
        JSObject j = new JSObject();
        j.put("id", id);
        call.resolve(j);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        if (tts != null) {
            tts.stop();
        }
        call.resolve();
    }

    @PluginMethod
    public void listVoices(PluginCall call) {
        JSArray arr = new JSArray();
        if (ready && tts != null) {
            for (Voice v : tts.getVoices()) {
                JSObject vo = new JSObject();
                vo.put("name", v.getName());
                Locale loc = v.getLocale();
                vo.put("lang", loc != null ? loc.getISO3Language() + "-" + loc.getISO3Country() : "unknown");
                arr.put(vo);
            }
        }
        JSObject j = new JSObject();
        j.put("voices", arr);
        call.resolve(j);
    }
}
