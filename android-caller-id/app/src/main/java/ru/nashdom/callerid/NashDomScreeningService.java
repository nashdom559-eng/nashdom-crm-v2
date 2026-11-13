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
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.OutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class NashDomScreeningService extends CallScreeningService {
    private static final String CHANNEL_ID = "nashdom_incoming_test";

    @Override public void onScreenCall(Call.Details details) {
        // Never block, reject or silence a call.
        if (details.getCallDirection() == Call.Details.DIRECTION_INCOMING) {
            String number = details.getHandle() == null ? "" : details.getHandle().getSchemeSpecificPart();
            String token=getSharedPreferences("caller_id",MODE_PRIVATE).getString("device_token","");
            if(token.matches("[a-fA-F0-9]{64}")){
                new Thread(()->{
                    String info=lookupCRM(number,token);
                    showTestNotification(number,info);
                    showCallerOverlay(number,info);
                }).start();
            } else {
                showTestNotification(number,"Тест определения номера · ключ CRM не задан");
                showCallerOverlay(number,"Тест определения номера · ключ CRM не задан");
            }
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

    public static String lookupCRM(String number,String token){
        HttpURLConnection connection=null;
        try{
            URL url=new URL("https://135-106-211-116.sslip.io/api/caller-id/lookup");
            connection=(HttpURLConnection)url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            connection.setRequestProperty("Authorization","Bearer "+token);
            byte[] body=new JSONObject().put("number",number).toString().getBytes(StandardCharsets.UTF_8);
            try(OutputStream out=connection.getOutputStream()){out.write(body);}
            int status=connection.getResponseCode();
            if(status==401)return "Ключ CRM не принят";
            if(status!=200)return "CRM: HTTP "+status;
            try(InputStream in=connection.getInputStream()){
                java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
                byte[] buf=new byte[1024];int n;
                while((n=in.read(buf))!=-1 && bytes.size()<16384)bytes.write(buf,0,n);
                JSONObject data=new JSONObject(bytes.toString("UTF-8"));
                if(!data.optBoolean("ok"))return "CRM временно недоступна";
                JSONArray matches=data.optJSONArray("matches");
                if(matches==null||matches.length()==0)return "В базе НашДом не найден";
                JSONObject first=matches.getJSONObject(0);
                String location=first.optString("house")+" · кв. "+first.optString("flat");
                String name=first.optString("name");
                String extra=matches.length()>1?" · ещё совпадений: "+(matches.length()-1):"";
                return location+(name.isEmpty()?"":" · "+name)+extra;
            }
        }catch(Exception e){return "Ошибка соединения: "+e.getClass().getSimpleName()+(e.getMessage()==null?"":(" — "+e.getMessage()));}
        finally{if(connection!=null)connection.disconnect();}
    }

    private void showCallerOverlay(String number,String info) {
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
                title.setText("🏠 НашДом · входящий звонок");
                title.setTextColor(Color.WHITE);
                title.setTextSize(17);
                panel.addView(title);
                TextView subtitle = new TextView(this);
                subtitle.setText((TextUtils.isEmpty(number) ? "Скрытый номер" : number) + " · " + info);
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

    private void showTestNotification(String number,String info) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Входящие звонки — тест", NotificationManager.IMPORTANCE_HIGH);
        manager.createNotificationChannel(channel);
        String safeNumber = TextUtils.isEmpty(number) ? "Номер скрыт или недоступен" : number;
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("НашДом: входящий звонок")
                .setContentText(safeNumber + " — " + info)
                .setStyle(new Notification.BigTextStyle().bigText(safeNumber + " — " + info))
                .setAutoCancel(true)
                .build();
        manager.notify(1001, notification);
    }
}
