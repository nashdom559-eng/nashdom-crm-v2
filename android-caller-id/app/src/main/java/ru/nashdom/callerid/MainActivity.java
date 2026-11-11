package ru.nashdom.callerid;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.telecom.TelecomManager;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

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
        description.setText("\nТест: определяем, передаёт ли Android входящий номер. Звонки не блокируются. База CRM пока не подключена.\n");
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

        TextView hint = new TextView(this);
        hint.setText("\nПосле разрешений попроси кого-нибудь позвонить с номера, которого нет в контактах. Приложение покажет уведомление «НашДом: входящий звонок». Если уведомления нет — открой приложение и проверь статус роли.");
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
