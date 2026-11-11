package ru.nashdom.callerid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.Manifest;
import android.os.Build;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import android.telecom.TelecomManager;
import android.text.TextUtils;
import android.provider.Settings;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.os.Handler;
import android.os.Looper;

public class NashDomScreeningService extends CallScreeningService {
    private static final String CHANNEL_ID = "nashdom_incoming_test";

    @Override public void onScreenCall(Call.Details details) {
        // Never block, reject or silence a call.
        if (details.getCallDirection() == Call.Details.DIRECTION_INCOMING) {
            String number = details.getHandle() == null ? "" : details.getHandle().getSchemeSpecificPart();
            showTestNotification(number);
            showCallerOverlay(number);
        }
        CallResponse response = new CallResponse.Builder()
                .setDisallowCall(false)
                .setRejectCall(false)
                .setSilenceCall(false)
                .setSkipCallLog(false)
                .setSkipNotification(false)
                .build();
        respondToCall(details, response);
    }

    private void showCallerOverlay(String number) {
        if (!Settings.canDrawOverlays(this)) return;
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            try {
                WindowManager manager = (WindowManager) getSystemService(WINDOW_SERVICE);
                if (manager == null) return;
                LinearLayout panel = new LinearLayout(this);
                panel.setOrientation(LinearLayout.VERTICAL);
                panel.setPadding(36, 20, 36, 20);
                GradientDrawable background = new GradientDrawable();
                background.setColor(Color.rgb(20, 45, 85));
                background.setCornerRadius(24);
                panel.setBackground(background);
                TextView title = new TextView(this);
                title.setText("🏠 НашДом · определитель работает");
                title.setTextColor(Color.WHITE);
                title.setTextSize(17);
                panel.addView(title);
                TextView subtitle = new TextView(this);
                subtitle.setText((TextUtils.isEmpty(number) ? "Скрытый номер" : number) + " · база CRM пока не подключена");
                subtitle.setTextColor(Color.WHITE);
                subtitle.setTextSize(14);
                panel.addView(subtitle);
                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE |
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
                params.gravity = Gravity.TOP;
                params.y = 110;
                manager.addView(panel, params);
                main.postDelayed(() -> {
                    try { manager.removeView(panel); } catch (Exception ignored) { }
                }, 18000);
            } catch (Exception ignored) {
                // Samsung may restrict overlays during the call. Notification remains as fallback.
            }
        });
    }

    private void showTestNotification(String number) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Входящие звонки — тест", NotificationManager.IMPORTANCE_HIGH);
        manager.createNotificationChannel(channel);
        String safeNumber = TextUtils.isEmpty(number) ? "Номер скрыт или недоступен" : number;
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("НашДом: входящий звонок")
                .setContentText(safeNumber + " — тест определения номера")
                .setStyle(new Notification.BigTextStyle().bigText(safeNumber + " — номер получен Android. База CRM ещё не подключена."))
                .setAutoCancel(true)
                .build();
        manager.notify(1001, notification);
    }
}
