(()=>{
const CFG=window.KEYHAN_CONFIG||{},$=id=>document.getElementById(id);
const D='https://www.googleapis.com/drive/v3/',U='https://www.googleapis.com/upload/drive/v3/',SC='https://www.googleapis.com/auth/drive';
let db,known=new Map(),tombs=[],meta={},timer=0,busy=false,token='',tokExp=0,log=[],err='';
const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const get=(s,k)=>req(db.transaction(s).objectStore(s).get(k));
const put=(s,k,v)=>req(db.transaction(s,'readwrite').objectStore(s).put(v,k));
const all=s=>req(db.transaction(s).objectStore(s).getAll());
const hashOf=r=>{const{updatedAt,...x}=r;return JSON.stringify(x)};
const saveMeta=()=>put('kv','meta',meta);
const sig=l=>l.map(x=>x.id+':'+(x.updatedAt||0)).sort().join('|');
const fa=n=>Number(n).toLocaleString('fa-IR');

window.KeyhanDB={
 migrated:0,
 async open(){db=await new Promise((ok,no)=>{const o=indexedDB.open('keyhan',1);o.onupgradeneeded=()=>['accounts','receipts','kv','img'].forEach(s=>o.result.createObjectStore(s));o.onsuccess=()=>ok(o.result);o.onerror=()=>no(o.error)})},
 async load(){
  let a=await all('accounts'),r=await all('receipts');
  meta=(await get('kv','meta'))||{};tombs=(await get('kv','tombs'))||[];
  if(!a.length&&!r.length){
   try{a=JSON.parse(localStorage.getItem('accounts_v1')||'[]');r=JSON.parse(localStorage.getItem('accounts_receipts_v1')||'null');if(!Array.isArray(a))a=[];
    if(!Array.isArray(r)){r=[];a.forEach(x=>{const n=parseFloat(x.paid)||0;if(n>0)r.push({id:'legacy-'+x.id,accountId:x.id,date:x.date||'',payer:x.payer||'',amount:n,ref:'',image:'',note:'مانده واریزی ثبت‌شده در نسخه قبلی',legacy:true})})}}catch(e){a=[];r=[]}
   this.migrated=a.length+r.length;
  }else{a.forEach(x=>known.set('a'+x.id,hashOf(x)));r.forEach(x=>known.set('r'+x.id,hashOf(x)))}
  return{rows:a,receipts:r};
 },
 save(A,R,remote){
  const ops=[],seen=new Set(),now=Date.now();let n=0;
  [['a','accounts',A],['r','receipts',R]].forEach(([t,s,L])=>L.forEach(x=>{const k=t+x.id,h=hashOf(x);seen.add(k);
   if(known.get(k)!==h){if(!remote||!x.updatedAt)x.updatedAt=now;known.set(k,h);ops.push([s,String(x.id),x]);n++}}));
  [...known.keys()].forEach(k=>{if(!seen.has(k)){known.delete(k);const t=k[0],id=k.slice(1);ops.push([t==='a'?'accounts':'receipts',id,null]);if(!remote){tombs.push({t,id,at:now});n++}}});
  if(!ops.length&&remote!==2)return;
  const tx=db.transaction(['accounts','receipts','kv'],'readwrite');
  ops.forEach(([s,k,v])=>v?tx.objectStore(s).put(v,k):tx.objectStore(s).delete(k));
  tx.objectStore('kv').put(tombs,'tombs');
  if(!remote&&n){meta.dirty=(meta.dirty||0)+n;tx.objectStore('kv').put(meta,'meta');status();schedule()}
 }
};

const ready=()=>!!(CFG.CLIENT_ID&&meta.folder);
function status(){
 const s=$('cloudStatus');if(!s)return;$('cloudRetry').style.display='none';
 s.classList.toggle('cloud-error',!!err);
 s.textContent=!ready()?'محلی':err?err:!navigator.onLine?'آفلاین'+(meta.dirty?' · '+fa(meta.dirty)+' تغییر در انتظار':''):busy?'در حال همگام‌سازی…':meta.dirty?fa(meta.dirty)+' تغییر در انتظار':'همگام ✓';
 const p=$('syncInfo');if(p)p.innerHTML=`وضعیت: <b>${s.textContent}</b><br>تغییرات در انتظار: ${fa(meta.dirty||0)}<br>آخرین همگام‌سازی: ${meta.last?new Date(meta.last).toLocaleString('fa-IR'):'—'}<br>`+log.slice(-6).reverse().join('<br>');
}
function schedule(){clearTimeout(timer);if(ready())timer=setTimeout(()=>sync(),3000)}

const auth=()=>token&&Date.now()<tokExp?Promise.resolve():new Promise((ok,no)=>{
 if(!window.google||!google.accounts)return no(Error('Google Sign-In بارگذاری نشد (اینترنت لازم است)'));
 google.accounts.oauth2.initTokenClient({client_id:CFG.CLIENT_ID,scope:SC,
  callback:r=>{if(r.error)return no(Error(r.error));token=r.access_token;tokExp=Date.now()+(r.expires_in-60)*1000;meta.connected=1;saveMeta();ok()},
  error_callback:e=>no(Error('نیاز به ورود مجدد به Google'))}).requestAccessToken({prompt:meta.connected?'':'consent'})});
const api=async(u,o={})=>{await auth();const r=await fetch(u,{...o,headers:{Authorization:'Bearer '+token,...(o.headers||{})}});if(!r.ok)throw Error('Drive '+r.status);return r};
const mp=(m,b,type)=>{const B='kh'+Date.now();return{headers:{'Content-Type':'multipart/related; boundary='+B},body:new Blob([`--${B}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(m)}\r\n--${B}\r\nContent-Type: ${type}\r\n\r\n`,b,`\r\n--${B}--`])}};
const findData=async()=>{const q=encodeURIComponent(`'${meta.folder}' in parents and name='keyhan-data.json' and trashed=false`);
 return((await(await api(D+`files?q=${q}&fields=files(id,version)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json()).files||[])[0]};
const readData=async f=>(await api(D+'files/'+f.id+'?alt=media&supportsAllDrives=true')).json();
const toUrl=b=>new Promise(ok=>{const f=new FileReader();f.onload=()=>ok(f.result);f.readAsDataURL(b)});
async function upImg(x){
 const m=x.image.match(/^data:([^;]+);base64,/),ext=(m[1].split('/')[1]||'bin').replace(/\W/g,''),blob=await(await fetch(x.image)).blob();
 const p=mp({name:`receipt-${String(x.id).replace(/[^\w-]/g,'')}.${ext}`,parents:[meta.folder]},blob,m[1]);
 const r=await(await api(U+'files?uploadType=multipart&supportsAllDrives=true&fields=id',{method:'POST',...p})).json();
 put('img','drive:'+r.id,x.image);return'drive:'+r.id}
const mt=(t,a,b,T)=>{const m=new Map();[...a,...b].forEach(x=>{const o=m.get(String(x.id));if(!o||(x.updatedAt||0)>(o.updatedAt||0))m.set(String(x.id),x)});
 return[...m.values()].filter(x=>{const d=T.get(t+x.id);return!d||(x.updatedAt||0)>d.at})};

async function sync(){
 if(busy||!ready()||!navigator.onLine)return;busy=true;err='';status();
 try{
  await auth();
  let d=__keyhan.get(),up=0;
  for(const x of d.receipts)if(String(x.image||'').startsWith('data:')){x.image=await upImg(x);x.updatedAt=Date.now();up++}
  if(up)KeyhanDB.save(d.rows,d.receipts,1);
  for(let n=0;n<3;n++){
   const f=await findData();
   if(f&&f.version===meta.rv&&!meta.dirty)break;
   const rem=f?await readData(f):{accounts:[],receipts:[],tombs:[]};
   const cur=__keyhan.get(),T=new Map(),cutoff=Date.now()-90*864e5;
   [...tombs,...(rem.tombs||[])].forEach(t=>{const k=t.t+t.id,o=T.get(k);if(t.at>cutoff&&(!o||t.at>o.at))T.set(k,t)});
   const A=mt('a',cur.rows,rem.accounts||[],T),R=mt('r',cur.receipts,rem.receipts||[],T),mt_=[...T.values()];
   const pulled=sig(A)!==sig(cur.rows)||sig(R)!==sig(cur.receipts);
   tombs=mt_;
   if(pulled){__keyhan.set(A,R);log.push(new Date().toLocaleTimeString('fa-IR')+' · دریافت تغییرات دیگران')}else KeyhanDB.save(A,R,2);
   let ver=f&&f.version;
   if(!f||sig(A)!==sig(rem.accounts||[])||sig(R)!==sig(rem.receipts||[])||mt_.length!==(rem.tombs||[]).length){
    const f2=f?await findData():null;if(f&&f2&&f2.version!==f.version)continue;
    const body=new Blob([JSON.stringify({v:2,accounts:A,receipts:R,tombs:mt_,at:Date.now()})],{type:'application/json'});
    const r=f?await api(U+'files/'+f.id+'?uploadType=media&supportsAllDrives=true&fields=version',{method:'PATCH',headers:{'Content-Type':'application/json'},body})
      :await api(U+'files?uploadType=multipart&supportsAllDrives=true&fields=version',{method:'POST',...mp({name:'keyhan-data.json',parents:[meta.folder]},body,'application/json')});
    ver=(await r.json()).version;log.push(new Date().toLocaleTimeString('fa-IR')+' · ارسال '+fa(A.length)+' حساب و '+fa(R.length)+' فیش');
   }
   meta.rv=ver;meta.dirty=0;meta.last=Date.now();saveMeta();break;
  }
 }catch(e){err='خطای همگام‌سازی: '+(e.message||e)}
 busy=false;status();
}
async function forcePull(){
 if(!ready())return;try{await auth();const f=await findData();if(!f)throw Error('فایل داده در پوشه پیدا نشد');const r=await readData(f);
  tombs=r.tombs||[];__keyhan.set(r.accounts||[],r.receipts||[]);meta.rv=f.version;meta.dirty=0;meta.last=Date.now();saveMeta();err=''}catch(e){err='خطا: '+(e.message||e)}status()}

function ui(){
 const b=document.createElement('button');b.className='btn g sm';b.textContent='🔄 همگام‌سازی';$('theme').after(b);
 const d=document.createElement('dialog');d.id='syncDlg';
 d.innerHTML=`<h3>همگام‌سازی با Google Drive</h3>
 ${CFG.CLIENT_ID?'':'<p class="mu" style="color:var(--er)">Client ID در فایل config.js وارد نشده است؛ برنامه فعلاً فقط محلی کار می‌کند (راهنما در README).</p>'}
 <label>لینک یا شناسهٔ پوشهٔ مشترک Drive</label><input id="syncFolder" dir="ltr" placeholder="https://drive.google.com/drive/folders/…">
 <div class="bar" style="margin:10px 0"><button class="btn sm" id="syncSave">ذخیره و اتصال</button><button class="btn g sm" id="syncNow">همگام‌سازی اکنون</button><button class="btn g sm" id="syncPull">دریافت اجباری از Drive</button><button class="btn g sm" id="syncOff">قطع اتصال</button><span class="sp"></span><button class="btn g sm" id="syncClose">بستن</button></div>
 <div id="syncInfo" class="mu" style="line-height:1.9"></div>`;
 document.body.append(d);
 b.onclick=()=>{$('syncFolder').value=meta.folder||'';status();d.showModal()};
 $('syncClose').onclick=()=>d.close();
 $('syncSave').onclick=()=>{const m=$('syncFolder').value.match(/folders\/([-\w]+)|^([-\w]{15,})$/);if(!m){alert('لینک پوشه معتبر نیست');return}
  meta.folder=m[1]||m[2];meta.rv='';meta.dirty=Math.max(meta.dirty||0,1);saveMeta();sync()};
 $('syncNow').onclick=()=>{meta.rv='';sync()};
 $('syncPull').onclick=()=>{if(confirm('داده‌های این دستگاه با داده‌های Drive جایگزین شود؟'))forcePull()};
 $('syncOff').onclick=()=>{if(confirm('اتصال قطع شود؟ داده‌های محلی باقی می‌مانند.')){meta.folder='';meta.connected=0;token='';saveMeta();status()}};
}
window.KeyhanSync={
 init(){
  if(!meta.folder&&CFG.FOLDER_ID)meta.folder=CFG.FOLDER_ID;
  ui();status();
  if(CFG.CLIENT_ID&&navigator.onLine){const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=()=>{if(meta.connected)schedule()};document.head.append(s)}
  addEventListener('online',()=>{status();schedule()});addEventListener('offline',status);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});
  setInterval(()=>{if(!document.hidden&&meta.connected)sync()},60000);
 },
 async getImage(ref){const c=await get('img',ref);if(c)return c;const r=await api(D+'files/'+ref.slice(6)+'?alt=media&supportsAllDrives=true');const u=await toUrl(await r.blob());put('img',ref,u);return u}
};
})();
