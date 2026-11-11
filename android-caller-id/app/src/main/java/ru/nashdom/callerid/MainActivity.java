package ru.nashdom.callerid;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.net.Uri;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.EditText;
import android.content.SharedPreferences;

public class MainActivity extends Activity {
    private static final int REQUEST_ROLE = 101;
    private static final int REQUEST_NOTIFICATIONS = 102;
    private TextView status;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(48, 64, 48, 32);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView title = new TextView(this);
        title.setText("НашДом — Определитель номера");
        title.setTextSize(23);
        layout.addView(title);

        TextView description = new TextView(this);
        description.setText("\nТест: определяем, передаёт ли Android входящий номер. Звонки не блокируются. Для поиска по базе CRM потребуется ключ устройства.\n");
        description.setTextSize(16);
        layout.addView(description);

        status = new TextView(this);
        status.setTextSize(17);
        layout.addView(status);

        Button roleButton = new Button(this);
        roleButton.setText("Разрешить определение номеров");
        roleButton.setOnClickListener(v -> requestScreeningRole());
        layout.addView(roleButton);

        Button notificationButton = new Button(this);
        notificationButton.setText("Разрешить уведомления");
        notificationButton.setOnClickListener(v -> requestNotifications());
        layout.addView(notificationButton);

        Button overlayButton = new Button(this);
        overlayButton.setText("Разрешить показ поверх звонка");
        overlayButton.setOnClickListener(v -> {
            if (!Settings.canDrawOverlays(this)) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } else updateStatus();
        });
        layout.addView(overlayButton);

        EditText tokenInput = new EditText(this);
        tokenInput.setSingleLine(true);
        tokenInput.setTextSize(14);
        tokenInput.setHint("Ключ устройства CRM (64 символа)");
        tokenInput.setInputType(129);
        tokenInput.setText(getSharedPreferences("caller_id",MODE_PRIVATE).getString("device_token",""));
        layout.addView(tokenInput);
        Button saveToken = new Button(this);
        saveToken.setText("Сохранить ключ CRM");
        saveToken.setOnClickListener(v -> {
            String token = tokenInput.getText().toString().trim();
            if (!token.matches("[a-fA-F0-9]{64}")) {
                status.setText("Ключ должен содержать 64 шестнадцатеричных символа");
                return;
            }
            getSharedPreferences("caller_id",MODE_PRIVATE).edit().putString("device_token",token).apply();
            updateStatus();
        });
        layout.addView(saveToken);

        TextView hint = new TextView(this);
        hint.setText("\nПосле разрешений попроси кого-нибудь позвонить с номера, которого нет в контактах. Приложение покажет плашку с результатом поиска. Без ключа работает тестовое определение номера. Если уведомления нет — открой приложение и проверь статус роли.");
        layout.addView(hint);

        setContentView(layout);
        updateStatus();
    }

    private void requestScreeningRole() {
        RoleManager roles = (RoleManager) getSystemService(ROLE_SERVICE);
        if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            if (!roles.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
                startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), REQUEST_ROLE);
            } else {
                updateStatus();
            }
        } else {
            status.setText("Android не предоставляет роль определения номеров.");
        }
    }

    private void requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        } else {
            updateStatus();
        }
    }

    private void updateStatus() {
        RoleManager roles = (RoleManager) getSystemService(ROLE_SERVICE);
        boolean held = roles != null && roles.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
        boolean notifications = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        status.setText("Определитель: " + (held ? "разрешён ✓" : "не назначен") + "\nУведомления: " + (notifications ? "разрешены ✓" : "не разрешены") + "\n");
    }

    @Override protected void onResume() {
        super.onResume();
        if (status != null) updateStatus();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        updateStatus();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        updateStatus();
    }
}
