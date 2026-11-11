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

public class NashDomScreeningService extends CallScreeningService {
    private static final String CHANNEL_ID = "nashdom_incoming_test";

    @Override public void onScreenCall(Call.Details details) {
        // Never block, reject or silence a call.
        if (details.getCallDirection() == Call.Details.DIRECTION_INCOMING) {
            String number = details.getHandle() == null ? "" : details.getHandle().getSchemeSpecificPart();
            showTestNotification(number);
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
