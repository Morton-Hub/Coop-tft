package com.mortonhub.cooptft.screenreader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Environment;
import android.os.IBinder;
import android.provider.MediaStore;
import android.net.Uri;
import java.io.OutputStream;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.nio.ByteBuffer;

/** Service de premier plan : capture l'écran à intervalle régulier et y lit le texte. */
public class CaptureService extends Service {

    static final String EXTRA_CODE = "code";
    static final String EXTRA_DATA = "data";
    static final String EXTRA_INTERVAL = "interval";
    private static final String CHANNEL = "screen-reader";

    /** Demande d'enregistrer la prochaine image capturée dans la galerie (album CoopTFT). */
    static volatile boolean snapshotRequested;

    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread thread;
    private Handler handler;
    private TextRecognizer recognizer;
    private volatile boolean busy;
    private volatile boolean running;
    private int interval = 1500;
    private int width;
    private int height;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || running) return START_NOT_STICKY;
        startForegroundNow();
        try {
            startCapture(intent);
        } catch (Exception e) {
            notifyStopped("Capture impossible : " + e.getMessage());
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startForegroundNow() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Lecture de l'écran", NotificationManager.IMPORTANCE_LOW));
        }
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Coop TFT lit l'écran")
            .setContentText("Arrête la lecture depuis l'onglet Écran de l'app.")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0;
        ServiceCompat.startForeground(this, 1, notification, type);
    }

    @SuppressWarnings("deprecation")
    private void startCapture(Intent intent) {
        thread = new HandlerThread("screen-reader");
        thread.start();
        handler = new Handler(thread.getLooper());
        interval = Math.max(500, intent.getIntExtra(EXTRA_INTERVAL, 1500));
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        Intent data = intent.getParcelableExtra(EXTRA_DATA);
        projection = manager.getMediaProjection(intent.getIntExtra(EXTRA_CODE, 0), data);
        if (projection == null) throw new IllegalStateException("autorisation de capture invalide");
        // Obligatoire depuis Android 14 : un callback doit être enregistré avant de créer l'affichage virtuel.
        projection.registerCallback(
            new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    notifyStopped("Capture arrêtée par le système");
                    stopSelf();
                }
            },
            handler
        );

        DisplayMetrics metrics = new DisplayMetrics();
        ((WindowManager) getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(metrics);
        width = metrics.widthPixels;
        height = metrics.heightPixels;
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        display = projection.createVirtualDisplay(
            "coop-tft",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.getSurface(),
            null,
            handler
        );
        running = true;
        handler.postDelayed(this::tick, 400);
    }

    private void tick() {
        if (!running) return;
        try {
            Image image = reader.acquireLatestImage();
            if (image != null) {
                if (busy) {
                    image.close();
                } else {
                    Bitmap bitmap = toBitmap(image);
                    image.close();
                    if (snapshotRequested) {
                        snapshotRequested = false;
                        saveToGallery(bitmap);
                    }
                    busy = true;
                    recognizer
                        .process(InputImage.fromBitmap(bitmap, 0))
                        .addOnSuccessListener(this::publish)
                        .addOnCompleteListener(task -> {
                            busy = false;
                            bitmap.recycle();
                        });
                }
            }
        } catch (Exception ignored) {
            // Image indisponible : on réessaie au prochain passage.
        }
        handler.postDelayed(this::tick, interval);
    }

    private Bitmap toBitmap(Image image) {
        Image.Plane plane = image.getPlanes()[0];
        ByteBuffer buffer = plane.getBuffer();
        int rowWidth = plane.getRowStride() / plane.getPixelStride();
        Bitmap padded = Bitmap.createBitmap(rowWidth, image.getHeight(), Bitmap.Config.ARGB_8888);
        padded.copyPixelsFromBuffer(buffer);
        if (rowWidth == image.getWidth()) return padded;
        Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, image.getWidth(), image.getHeight());
        padded.recycle();
        return cropped;
    }

    /** Enregistre l'image telle que l'app la voit, pour pouvoir régler la lecture après coup. */
    private void saveToGallery(Bitmap bitmap) {
        boolean saved = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, "coop-tft-" + System.currentTimeMillis() + ".jpg");
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CoopTFT");
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out != null) saved = bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out);
                    }
                }
            } catch (Exception ignored) {
                // Enregistrement impossible : signalé à l'interface ci-dessous.
            }
        }
        ScreenReaderPlugin plugin = ScreenReaderPlugin.instance;
        if (plugin != null) plugin.emitSnapshot(saved);
    }

    private void publish(Text text) {
        ScreenReaderPlugin plugin = ScreenReaderPlugin.instance;
        if (plugin == null || !running) return;
        JSArray lines = new JSArray();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box == null) continue;
                JSObject item = new JSObject();
                item.put("text", line.getText());
                item.put("x", box.left);
                item.put("y", box.top);
                item.put("w", box.width());
                item.put("h", box.height());
                lines.put(item);
            }
        }
        JSObject data = new JSObject();
        data.put("width", width);
        data.put("height", height);
        data.put("lines", lines);
        plugin.emitText(data);
    }

    private void notifyStopped(String reason) {
        ScreenReaderPlugin plugin = ScreenReaderPlugin.instance;
        if (plugin != null) plugin.emitStopped(reason);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (display != null) display.release();
        if (reader != null) reader.close();
        if (projection != null) projection.stop();
        if (recognizer != null) recognizer.close();
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }
}
