package com.mortonhub.cooptft.screenreader;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lecture expérimentale de l'écran : demande l'autorisation de capture à l'utilisateur,
 * puis un service lit le texte affiché et le renvoie à l'interface (événement « screenText »).
 */
@CapacitorPlugin(name = "ScreenReader")
public class ScreenReaderPlugin extends Plugin {

    static ScreenReaderPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void start(PluginCall call) {
        MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, manager.createScreenCaptureIntent(), "onProjectionResult");
    }

    @ActivityCallback
    private void onProjectionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Capture d'écran refusée");
            return;
        }
        Intent service = new Intent(getContext(), CaptureService.class);
        service.putExtra(CaptureService.EXTRA_CODE, result.getResultCode());
        service.putExtra(CaptureService.EXTRA_DATA, result.getData());
        service.putExtra(CaptureService.EXTRA_INTERVAL, call.getInt("intervalMs", 1500));
        ContextCompat.startForegroundService(getContext(), service);
        // Notre propre fenêtre est masquée dans la capture : sinon on relirait nos propres noms de champions.
        setSecure(true);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CaptureService.class));
        setSecure(false);
        call.resolve();
    }

    /** Enregistre la prochaine image capturée dans la galerie. */
    @PluginMethod
    public void snapshot(PluginCall call) {
        CaptureService.snapshotRequested = true;
        call.resolve();
    }

    void emitSnapshot(boolean saved) {
        JSObject data = new JSObject();
        data.put("saved", saved);
        notifyListeners("snapshot", data);
    }

    private void setSecure(boolean secure) {
        Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            if (secure) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
    }

    void emitText(JSObject data) {
        notifyListeners("screenText", data);
    }

    void emitStopped(String reason) {
        setSecure(false);
        JSObject data = new JSObject();
        data.put("reason", reason);
        notifyListeners("stopped", data);
    }
}
