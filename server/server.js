const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_SECRET = process.env.API_SECRET || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nashdom-crm';
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://nashdom559-eng.github.io/nashdom-crm-app/';
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || '';
const GOOGLE_CALENDAR_TIMEZONE = process.env.GOOGLE_CALENDAR_TIMEZONE || 'Asia/Yekaterinburg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

const S = { ACCEPTED:'Принято', WAITING:'Ожидает', DONE:'Выполнено', RESIDENT_NEW:'Новая от жителя', REJECTED:'Отклонено', ARCHIVED:'Архив', DELETED:'Удалено' };
const RESIDENT_HOUSES = { f2:'Фонтанная 2', f5:'Фонтанная 5', f8:'Фонтанная 8', karp81:'Карпинского 81', kron31:'Кронштадская 31', kam5:'Каменского 5', shk127:'Шоссе Космонавтов 127', rev38:'Революции 38', rev42:'Революции 42', rev50:'Революции 50', rev52:'Революции 52', ek98:'Екатерининская 98' };

function normalizePhone(phone=''){ let d=String(phone).replace(/\D/g,''); if(d.length===11&&d.startsWith('8'))d='7'+d.slice(1); else if(d.length===10)d='7'+d; return d; }
function storedPhone(phone=''){ const d=normalizePhone(phone); return d?('+'+d):''; }
function fmt(v){ if(!v)return ''; const d=new Date(v); if(Number.isNaN(d.getTime()))return String(v); return new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d).replace(',',''); }
function raw(v){ if(!v)return ''; const d=new Date(v); if(Number.isNaN(d.getTime()))return ''; const p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d); const o=Object.fromEntries(p.map(x=>[x.type,x.value])); return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`; }
function parsePayload(req){ const p=req.query.payload ?? req.body?.payload ?? req.body ?? {}; if(typeof p==='string'){ try{return JSON.parse(p)}catch{return {}} } return p||{}; }
function send(res,obj,callback=''){ if(callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(obj)});`); else res.json(obj); }
function auth(req){ return Boolean(API_SECRET) && String(req.query.token||req.body?.token||'')===API_SECRET; }
function safeFileName(name='photo.jpg'){ return String(name).replace(/[^a-zA-Zа-яА-Я0-9._-]+/g,'_'); }
function residentPhotoToken(requestId){ if(!API_SECRET)return ''; return crypto.createHmac('sha256',API_SECRET).update(`resident-photo:${String(requestId||'')}`).digest('hex'); }
function validResidentPhotoToken(requestId,token){ const expected=residentPhotoToken(requestId), actual=String(token||''); if(!expected||expected.length!==actual.length)return false; try{return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(actual));}catch{return false;} }
async function nextId(c){ const year=new Date().getFullYear(); const {rows}=await c.query('SELECT id FROM requests WHERE id LIKE $1',[`${year}-%`]); let max=0; for(const r of rows){ const m=r.id.match(/^\d{4}-(\d+)$/); if(m)max=Math.max(max,Number(m[1])); } return `${year}-${String(max+1).padStart(4,'0')}`; }
async function nextRowNumber(c){ const {rows}=await c.query('SELECT COALESCE(MAX(legacy_row_number),1)+1 AS n FROM requests'); return Number(rows[0].n||2); }
async function upsertContact(c,data){ const house=String(data.house||'').trim(), flat=String(data.flat||'').trim(), name=String(data.name||'').trim(), phone=storedPhone(data.phone||''); if(!house||!flat||(!name&&!phone))return; const n=normalizePhone(phone); const {rows}=await c.query("SELECT id FROM contacts WHERE (house=$1 AND flat=$2 AND lower(name)=lower($3) AND $3<>'') OR ($4<>'' AND regexp_replace(phone,'\\D','','g')=$4) LIMIT 1",[house,flat,name,n]); if(rows[0]) await c.query('UPDATE contacts SET house=$1,flat=$2,name=$3,phone=$4,updated_at=now() WHERE id=$5',[house,flat,name,phone,rows[0].id]); else await c.query("INSERT INTO contacts(house,flat,name,phone,note) VALUES($1,$2,$3,$4,'Добавлен из заявки')",[house,flat,name,phone]); }
async function addTimeline(c,requestId,stage,comment='',operationId='',executor=''){ await c.query('INSERT INTO timeline(id,request_id,stage,comment,executor,operation_id) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),requestId,stage,comment,executor,operationId]); }
async function findRequest(p,c=pool){ if(p.requestId||p.id) return (await c.query('SELECT * FROM requests WHERE id=$1',[String(p.requestId||p.id)])).rows[0]; if(p.rowNumber) return (await c.query('SELECT * FROM requests WHERE legacy_row_number=$1',[Number(p.rowNumber)])).rows[0]; return null; }
async function timelineMap(){ const {rows}=await pool.query('SELECT * FROM timeline ORDER BY created_at'); const m={}; for(const r of rows){ (m[r.request_id]??=[]).push({id:r.id,operationId:r.operation_id,date:fmt(r.created_at),rawDate:raw(r.created_at),stage:r.stage,comment:r.comment,executor:r.executor}); } return m; }
function mapReq(r,m){ return {rowNumber:Number(r.legacy_row_number||0),id:r.id,date:fmt(r.created_at),rawDate:raw(r.created_at),house:r.house,flat:r.flat,name:r.name,phone:r.phone,category:r.category,description:r.description,priority:r.priority,status:r.status,executor:r.executor,planDate:fmt(r.plan_date),rawPlanDate:raw(r.plan_date),doneDate:fmt(r.done_date),rawDoneDate:raw(r.done_date),control:r.control,comment:r.comment,calendarEventId:r.calendar_event_id,source:r.source,photosBefore:r.photos_before||[],photosAfter:r.photos_after||[],isEmergency:r.category==='Аварийная',emergencyTimeline:m[r.id]||[]}; }
async function getAppData(){ const m=await timelineMap(); const [rq,h,c]=await Promise.all([pool.query('SELECT * FROM requests ORDER BY created_at DESC'),pool.query('SELECT * FROM houses ORDER BY id'),pool.query('SELECT * FROM contacts ORDER BY id')]); const all=rq.rows.map(r=>mapReq(r,m)); const profiles={}; for(const x of h.rows)profiles[x.name]={entrances:x.entrances,itp:x.itp,extras:x.extras||[]}; return {version:'3.0.0',houses:h.rows.map(x=>x.name),houseProfiles:profiles,contacts:c.rows.map(x=>({house:x.house,flat:x.flat,name:x.name,phone:x.phone,role:x.role,note:x.note})),acceptedRequests:all.filter(x=>![S.DONE,S.RESIDENT_NEW,S.REJECTED,S.ARCHIVED,S.DELETED].includes(x.status)),residentRequests:all.filter(x=>x.status===S.RESIDENT_NEW),allRequests:all}; }

function base64Url(value){ return Buffer.from(value).toString('base64url'); }
async function getServiceAccountAccessToken(scope,cache){
  if(cache.token && Date.now() < cache.expiresAt - 300000)return cache.token;
  if(!FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY)throw new Error('Google service account не настроен');
  const now=Math.floor(Date.now()/1000);
  const header=base64Url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=base64Url(JSON.stringify({iss:FIREBASE_CLIENT_EMAIL,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned=`${header}.${claim}`;
  const signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),FIREBASE_PRIVATE_KEY).toString('base64url');
  const assertion=`${unsigned}.${signature}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)throw new Error(`Google OAuth ${response.status}: ${data.error_description||data.error||'не удалось получить токен'}`);
  cache.token=data.access_token; cache.expiresAt=Date.now()+Number(data.expires_in||3600)*1000; return cache.token;
}

const firebaseAccessTokenCache={token:'',expiresAt:0};
async function getFirebaseAccessToken(){ return getServiceAccountAccessToken('https://www.googleapis.com/auth/firebase.messaging',firebaseAccessTokenCache); }
async function sendPushNotifications(requestData){
  const {rows}=await pool.query('SELECT token FROM push_tokens WHERE active=true ORDER BY updated_at DESC');
  const tokens=rows.map(x=>String(x.token||'').trim()).filter(Boolean); if(!tokens.length)return;
  const accessToken=await getFirebaseAccessToken();
  const isEmergency=Boolean(requestData.isEmergency);
  const title=isEmergency?'🚨 АВАРИЙНАЯ ЗАЯВКА':'📨 Новая заявка';
  const body=[requestData.house||'',requestData.flat?`кв. ${requestData.flat}`:'',requestData.category||'',requestData.description||''].filter(Boolean).join(' · ').slice(0,240);
  const endpoint=`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/messages:send`;
  await Promise.all(tokens.map(async token=>{ try{ const payload={message:{token,notification:{title,body},data:{url:PUBLIC_APP_URL,requestId:String(requestData.requestId||''),emergency:isEmergency?'1':'0'},webpush:{notification:{icon:`${PUBLIC_APP_URL.replace(/\/$/,'')}/icon-192.png`,badge:`${PUBLIC_APP_URL.replace(/\/$/,'')}/icon-192.png`,tag:`resident-${String(requestData.requestId||Date.now())}`,requireInteraction:isEmergency},fcm_options:{link:PUBLIC_APP_URL}}}}; const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(response.ok)return; const text=await response.text(); if(response.status===404||response.status===410||/UNREGISTERED/i.test(text))await pool.query('UPDATE push_tokens SET active=false,updated_at=now() WHERE token=$1',[token]); console.error(`FCM error ${response.status}: ${text.slice(0,500)}`); }catch(e){console.error('FCM send error:',e.message||e);} }));
}

const calendarAccessTokenCache={token:'',expiresAt:0};
async function getCalendarAccessToken(){ return getServiceAccountAccessToken('https://www.googleapis.com/auth/calendar',calendarAccessTokenCache); }
function calendarDateTime(value){
  const s=String(value||'').trim();
  const m=s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/);
  if(m)return `${m[1]}:${m[2]||'00'}`;
  const d=new Date(value); if(Number.isNaN(d.getTime()))throw new Error('Некорректная дата календаря'); return d.toISOString();
}
function calendarEndDateTime(start){
  if(/[zZ]$|[+-]\d{2}:\d{2}$/.test(start))return new Date(new Date(start).getTime()+3600000).toISOString();
  return new Date(new Date(start+'Z').getTime()+3600000).toISOString().replace(/\.000Z$/,'');
}
function calendarBody(requestId,status,data,date){
  const start=calendarDateTime(date), end=calendarEndDateTime(start);
  return {summary:`НашДом: ${data.house||''} кв. ${data.flat||''}`,description:`Заявка № ${requestId}\nСтатус: ${status}\n\nФИО: ${data.name||''}\nТелефон: ${data.phone||''}\n\nОписание:\n${data.description||''}${data.comment?`\n\nКомментарий:\n${data.comment}`:''}`,start:{dateTime:start,timeZone:GOOGLE_CALENDAR_TIMEZONE},end:{dateTime:end,timeZone:GOOGLE_CALENDAR_TIMEZONE},reminders:{useDefault:false,overrides:[{method:'popup',minutes:60}]}};
}
async function calendarFetch(url,options={}){
  if(!GOOGLE_CALENDAR_ID)throw new Error('GOOGLE_CALENDAR_ID не настроен');
  const token=await getCalendarAccessToken();
  return fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}});
}
function calendarBase(){ return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}`; }
async function resolveCalendarEventId(eventId){
  const original=String(eventId||'').trim(); if(!original)return '';
  let r=await calendarFetch(`${calendarBase()}/events/${encodeURIComponent(original)}`);
  if(r.ok)return original;
  if(r.status!==404){ const t=await r.text(); throw new Error(`Calendar lookup ${r.status}: ${t.slice(0,300)}`); }
  r=await calendarFetch(`${calendarBase()}/events?iCalUID=${encodeURIComponent(original)}&maxResults=1&showDeleted=false`);
  if(!r.ok){ const t=await r.text(); throw new Error(`Calendar legacy lookup ${r.status}: ${t.slice(0,300)}`); }
  const data=await r.json(); return data.items&&data.items[0]?String(data.items[0].id||''):'';
}
async function createOrUpdateCalendarEvent(eventId,requestId,status,data,date){
  if(!date)return '';
  const body=calendarBody(requestId,status,data,date);
  const resolved=await resolveCalendarEventId(eventId);
  const url=resolved?`${calendarBase()}/events/${encodeURIComponent(resolved)}`:`${calendarBase()}/events`;
  const response=await calendarFetch(url,{method:resolved?'PATCH':'POST',body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`Calendar ${resolved?'update':'create'} ${response.status}: ${result.error?.message||'ошибка Google Calendar'}`);
  return String(result.id||resolved||'');
}
async function deleteCalendarEvent(eventId){
  if(!eventId)return;
  const resolved=await resolveCalendarEventId(eventId); if(!resolved)return;
  const response=await calendarFetch(`${calendarBase()}/events/${encodeURIComponent(resolved)}`,{method:'DELETE'});
  if(!response.ok&&response.status!==404&&response.status!==410){ const t=await response.text(); throw new Error(`Calendar delete ${response.status}: ${t.slice(0,300)}`); }
}
async function safeDeleteCalendarEvent(eventId){ if(!eventId)return; try{await deleteCalendarEvent(eventId);}catch(e){console.error('Calendar delete error:',e.message||e);} }

async function savePhoto(data,resident=false){ const r=await findRequest(data); if(!r)throw new Error('Заявка для фотографии не найдена'); if(resident){ const tokenOk=validResidentPhotoToken(r.id,data.residentPhotoToken); if(!tokenOk){ const house=RESIDENT_HOUSES[String(data.houseCode||'').trim().toLowerCase()]; if(!house||r.house!==house)throw new Error('Заявка не найдена'); } }
 const kind=data.kind==='after'?'after':'before'; const field=kind==='after'?'photos_after':'photos_before'; const list=Array.isArray(r[field])?r[field]:[]; if(list.length>=5)throw new Error('Можно прикрепить не больше 5 фотографий'); const match=String(data.dataUrl||'').match(/^data:([^;]+);base64,(.+)$/); if(!match)throw new Error('Некорректные данные фотографии'); const ext=(match[1]||'image/jpeg').includes('png')?'png':'jpg'; const id=crypto.randomUUID(); const fileName=`${r.id}_${kind}_${Date.now()}_${safeFileName(data.fileName||('photo.'+ext))}`; fs.writeFileSync(path.join(UPLOAD_DIR,fileName),Buffer.from(match[2],'base64')); const item={id,name:fileName,url:'/uploads/'+encodeURIComponent(fileName),thumb:'/uploads/'+encodeURIComponent(fileName),local:true}; list.push(item); await pool.query(`UPDATE requests SET ${field}=$1::jsonb WHERE id=$2`,[JSON.stringify(list),r.id]); return {ok:true,photo:item,rowNumber:r.legacy_row_number}; }
function photoResponse(res,payload){ const json=JSON.stringify(payload).replace(/</g,'\\u003c'); res.type('html').send(`<!doctype html><html><body><script>window.parent.postMessage({source:"nashdom-photo-upload",payload:${json}},"*");</script></body></html>`); }

async function action(name,p){
 if(name==='getAppData')return getAppData();
 if(name==='addRequest'){
  const c=await pool.connect(); let id,row,done,category;
  try{ await c.query('BEGIN'); id=await nextId(c); row=await nextRowNumber(c); const rt=String(p.recordType||''); done=rt==='inspection'||rt==='completed'; category=rt==='inspection'?'Осмотр дома':rt==='completed'?'Выполненная работа':p.isEmergency?'Аварийная':String(p.category||''); await c.query('INSERT INTO requests(id,legacy_row_number,house,flat,name,phone,category,description,priority,status,executor,plan_date,done_date,comment,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[id,row,p.house||'',p.flat||'',p.name||'',p.phone||'',category,p.description||'',p.priority||'',done?S.DONE:S.ACCEPTED,p.executor||'',done?null:(p.planDate||null),done?new Date():null,done?(p.description||''):'',p.source||'Вручную']); if(p.isEmergency&&!done)await addTimeline(c,id,'Заявка принята',p.description||''); await upsertContact(c,p); await c.query('COMMIT'); }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  if(!done&&p.planDate){ try{ const eventId=await createOrUpdateCalendarEvent('',id,S.ACCEPTED,p,p.planDate); await pool.query('UPDATE requests SET calendar_event_id=$1 WHERE id=$2',[eventId,id]); }catch(e){console.error('Calendar create error:',e.message||e);} }
  return {ok:true,id,rowNumber:row,message:done?`Запись сохранена № ${id}`:`Заявка принята № ${id}`};
 }
 if(name==='registerPushToken'){ const token=String(p.token||'').trim(); if(!token)throw new Error('Пустой push-токен'); await pool.query(`INSERT INTO push_tokens(token,device_info) VALUES($1,$2) ON CONFLICT(token) DO UPDATE SET device_info=EXCLUDED.device_info,updated_at=now(),active=true`,[token,String(p.deviceInfo||'').slice(0,500)]); return {ok:true,message:'Уведомления включены'}; }
 if(name==='deleteEmergencyEvent'){ const id=String(p.eventId||'').trim(); if(!id)throw new Error('Не указана запись для удаления'); const x=await pool.query('DELETE FROM timeline WHERE id=$1',[id]); if(!x.rowCount)throw new Error('Запись хронологии не найдена'); return {ok:true,message:'Запись хронологии удалена'}; }
 const r=await findRequest(p); if(!r)throw new Error('Заявка не найдена');
 if(name==='closeRequest'){ await safeDeleteCalendarEvent(r.calendar_event_id); await pool.query("UPDATE requests SET status=$1,done_date=now(),comment=$2,calendar_event_id='' WHERE id=$3",[S.DONE,p.comment||'',r.id]); return {ok:true,message:'Заявка выполнена'}; }
 if(name==='holdRequest'){
  const parts=[]; if(p.comment)parts.push('Причина: '+p.comment); if(p.action)parts.push('Следующее действие: '+p.action); const comment=parts.join('\n'); let eventId=String(r.calendar_event_id||'');
  if(p.reminder){ try{eventId=await createOrUpdateCalendarEvent(eventId,r.id,S.WAITING,{house:r.house,flat:r.flat,name:r.name,phone:r.phone,description:r.description,comment},p.reminder);}catch(e){console.error('Calendar hold error:',e.message||e);} } else {await safeDeleteCalendarEvent(eventId); eventId='';}
  await pool.query('UPDATE requests SET status=$1,plan_date=$2,comment=$3,calendar_event_id=$4 WHERE id=$5',[S.WAITING,p.reminder||null,comment,eventId,r.id]); return {ok:true,message:'Заявка переведена в ожидание'};
 }
 if(name==='updateRequestPlan'){
  let eventId=String(r.calendar_event_id||'');
  if(p.planDate){ try{eventId=await createOrUpdateCalendarEvent(eventId,r.id,r.status,{house:r.house,flat:r.flat,name:r.name,phone:r.phone,description:r.description,comment:r.comment},p.planDate);}catch(e){console.error('Calendar plan error:',e.message||e);} } else {await safeDeleteCalendarEvent(eventId); eventId='';}
  await pool.query('UPDATE requests SET plan_date=$1,calendar_event_id=$2 WHERE id=$3',[p.planDate||null,eventId,r.id]); return {ok:true,message:p.planDate?'Плановый визит назначен':'Плановый визит очищен'};
 }
 if(name==='updateRequest'){
  let eventId=String(r.calendar_event_id||'');
  if(p.planDate){ try{eventId=await createOrUpdateCalendarEvent(eventId,r.id,r.status,{house:p.house||'',flat:p.flat||'',name:p.name||'',phone:p.phone||'',description:p.description||'',comment:r.comment},p.planDate);}catch(e){console.error('Calendar update error:',e.message||e);} } else {await safeDeleteCalendarEvent(eventId); eventId='';}
  await pool.query('UPDATE requests SET house=$1,flat=$2,name=$3,phone=$4,category=$5,description=$6,plan_date=$7,calendar_event_id=$8 WHERE id=$9',[p.house||'',p.flat||'',p.name||'',p.phone||'',p.isEmergency?'Аварийная':'',p.description||'',p.planDate||null,eventId,r.id]); await addTimeline(pool,r.id,'Заявка отредактирована','Данные заявки изменены'); await upsertContact(pool,p); return {ok:true,message:'Заявка обновлена'};
 }
 if(name==='reopenRequest'){ if(r.status!==S.DONE)throw new Error('Заявка уже активна'); const parts=[]; if(r.comment)parts.push('Предыдущее выполнение: '+r.comment); if(p.comment)parts.push('Причина возобновления: '+p.comment); await pool.query("UPDATE requests SET status=$1,done_date=NULL,comment='' WHERE id=$2",[S.ACCEPTED,r.id]); await addTimeline(pool,r.id,'Заявка возобновлена',parts.join('\n')||'Возвращена в работу'); return {ok:true,message:'Заявка возобновлена'}; }
 if(name==='archiveRequest'){ await safeDeleteCalendarEvent(r.calendar_event_id); await pool.query("UPDATE requests SET status=$1,calendar_event_id='' WHERE id=$2",[S.ARCHIVED,r.id]); await addTimeline(pool,r.id,'Заявка архивирована'); return {ok:true,message:'Заявка перемещена в архив'}; }
 if(name==='moveRequestToTrash'){ await safeDeleteCalendarEvent(r.calendar_event_id); await pool.query("UPDATE requests SET status=$1,calendar_event_id='' WHERE id=$2",[S.DELETED,r.id]); await addTimeline(pool,r.id,'Заявка перемещена в корзину'); return {ok:true,message:'Заявка перемещена в корзину'}; }
 if(name==='restoreRequest'){ await pool.query('UPDATE requests SET status=$1 WHERE id=$2',[S.ACCEPTED,r.id]); await addTimeline(pool,r.id,'Заявка восстановлена'); return {ok:true,message:'Заявка восстановлена'}; }
 if(name==='deleteRequest'){ await safeDeleteCalendarEvent(r.calendar_event_id); const lists=[...(r.photos_before||[]),...(r.photos_after||[])]; for(const ph of lists){ if(ph&&ph.local&&ph.name){ try{fs.unlinkSync(path.join(UPLOAD_DIR,ph.name))}catch{}} } await pool.query('DELETE FROM requests WHERE id=$1',[r.id]); return {ok:true,message:'Заявка удалена'}; }
 if(name==='deleteRequestPhoto'){ const field=p.kind==='after'?'photos_after':'photos_before'; const list=Array.isArray(r[field])?r[field]:[]; const idx=list.findIndex(x=>String(x.id||'')===String(p.photoId||'')); if(idx<0)throw new Error('Фотография не найдена'); const [removed]=list.splice(idx,1); if(removed&&removed.local&&removed.name){ try{fs.unlinkSync(path.join(UPLOAD_DIR,removed.name))}catch{} } await pool.query(`UPDATE requests SET ${field}=$1::jsonb WHERE id=$2`,[JSON.stringify(list),r.id]); return {ok:true,message:'Фотография удалена'}; }
 if(name==='addEmergencyEvent'){
  if(r.category!=='Аварийная')throw new Error('Эта заявка не отмечена как аварийная'); if(p.operationId){ const ex=await pool.query('SELECT 1 FROM timeline WHERE operation_id=$1',[p.operationId]); if(ex.rowCount)return {ok:true,message:'Этап уже был сохранён',duplicate:true}; }
  const stages={ARRIVED:'Прибыл на место',SHUTOFF:'Стояк / система перекрыты',WAITING_ACCESS:'Ожидаем доступ',FOUND:'Причина найдена / работы выполнены',RESTORED:'Вода / система открыты',CLOSED:'Авария закрыта'}; const label=stages[p.stage]; if(!label)throw new Error('Неизвестный этап аварии');
  if(p.stage==='WAITING_ACCESS')await pool.query('UPDATE requests SET status=$1 WHERE id=$2',[S.WAITING,r.id]); else if(p.stage==='CLOSED'){await safeDeleteCalendarEvent(r.calendar_event_id); await pool.query("UPDATE requests SET status=$1,done_date=now(),comment=$2,calendar_event_id='' WHERE id=$3",[S.DONE,p.comment||'Авария закрыта',r.id]);} else await pool.query('UPDATE requests SET status=$1 WHERE id=$2',[S.ACCEPTED,r.id]); await addTimeline(pool,r.id,label,p.comment||'',p.operationId||''); return {ok:true,message:p.stage==='CLOSED'?'Авария закрыта':'Этап аварии записан'};
 }
 if(name==='acceptResidentRequest'){ if(r.status!==S.RESIDENT_NEW)throw new Error('Заявка уже обработана'); await pool.query("UPDATE requests SET status=$1,category=CASE WHEN $2 THEN 'Аварийная' ELSE category END WHERE id=$3",[S.ACCEPTED,!!p.makeEmergency,r.id]); if(p.makeEmergency)await addTimeline(pool,r.id,'Заявка принята',r.description||''); return {ok:true,message:p.makeEmergency?'Принято как аварийная':'Заявка принята'}; }
 if(name==='rejectResidentRequest'){ if(r.status!==S.RESIDENT_NEW)throw new Error('Заявка уже обработана'); await pool.query('UPDATE requests SET status=$1 WHERE id=$2',[S.REJECTED,r.id]); return {ok:true,message:'Заявка отклонена'}; }
 if(name==='dispatchRequest'){ if(!String(p.executor||'').trim())throw new Error('Укажите исполнителя'); await pool.query('UPDATE requests SET priority=$1,executor=$2 WHERE id=$3',[p.category||'',p.executor||'',r.id]); await addTimeline(pool,r.id,'Передано исполнителю',[p.category?('Категория: '+p.category):'', 'Исполнитель: '+p.executor].filter(Boolean).join('\n')); return {ok:true,message:'Заявка передана: '+p.executor}; }
 throw new Error('Неизвестное действие API: '+name);
}

app.get('/health',async(req,res)=>{ try{await pool.query('SELECT 1');res.json({ok:true})}catch(e){res.status(500).json({ok:false,error:e.message})} });
app.all('/api',async(req,res)=>{ const name=String(req.query.action||req.body?.action||''), callback=String(req.query.callback||req.body?.callback||''), p=parsePayload(req); try{
  if(name==='uploadPhoto'){ const resident=String(req.body?.resident||req.query.resident||'')==='1'; if(!resident && !auth(req))throw new Error('Доступ запрещён'); const data=Object.assign({},req.body||{},req.query||{}); const result=await savePhoto(data,resident); return photoResponse(res,{ok:true,uploadId:String(data.uploadId||''),result}); }
  if(name==='submitResidentRequest'){ const houseCode=String(p.houseCode||'').trim().toLowerCase(); const mappedHouse=RESIDENT_HOUSES[houseCode]; if(houseCode&&!mappedHouse)throw new Error('Ссылка для этого дома недействительна'); const typedHouse=String(p.houseAddress||'').trim().replace(/\s+/g,' ').slice(0,160); const house=mappedHouse||typedHouse; const flat=String(p.flat||'').trim(), name2=String(p.name||'').trim(), phone=storedPhone(p.phone), desc=String(p.description||'').trim(); if(!house)throw new Error('Укажите адрес дома'); if(!flat)throw new Error('Укажите квартиру'); if(!name2)throw new Error('Укажите, как к вам обращаться'); if(normalizePhone(phone).length!==11)throw new Error('Укажите корректный номер телефона'); if(!desc)throw new Error('Опишите проблему'); const c=await pool.connect(); try{ await c.query('BEGIN'); const id=await nextId(c), row=await nextRowNumber(c), source=mappedHouse?'Житель':'Житель / универсальная ссылка'; await c.query('INSERT INTO requests(id,legacy_row_number,house,flat,name,phone,category,description,priority,status,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,row,house,flat,name2,phone,p.isEmergency?'Аварийная':'',desc,String(p.category||''),S.RESIDENT_NEW,source]); if(mappedHouse)await upsertContact(c,{house,flat,name:name2,phone}); await c.query('COMMIT'); try{await sendPushNotifications({requestId:id,house,flat,category:String(p.category||''),description:desc,isEmergency:Boolean(p.isEmergency)});}catch(pushError){console.error('Push error:',pushError.message||pushError);} return send(res,{ok:true,result:{ok:true,requestId:id,rowNumber:row,house,residentPhotoToken:residentPhotoToken(id),message:'Заявка отправлена'}},callback); }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()} }
  if(!auth(req))throw new Error('Доступ запрещён'); const result=await action(name,p); return send(res,{ok:true,result},callback);
 }catch(e){ if(name==='uploadPhoto')return photoResponse(res,{ok:false,uploadId:String(req.body?.uploadId||''),error:e.message||String(e)}); return send(res,{ok:false,error:e.message||String(e)},callback); } });

app.listen(PORT,'0.0.0.0',()=>console.log(`NashDom API listening on 0.0.0.0:${PORT}`));