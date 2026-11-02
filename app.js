
/* ============================================================
   ⭐ STEP 1 : วางค่า firebaseConfig ของคุณตรงนี้
   ------------------------------------------------------------
   ไปที่ Firebase Console > Project settings > General
   > Your apps > SDK setup and configuration > Config
   แล้วคัดลอกค่ามาวางแทนที่ด้านล่างนี้ทั้งก้อน
   ============================================================ */

/* ============================================================ */

/* ============================================================
   ⭐ STEP 2 (ทางเลือก) : ตั้งค่าแจ้งเตือน Telegram
   ------------------------------------------------------------
   วาง Bot Token และ Chat ID ที่ได้จาก Telegram ตรงนี้
   ถ้ายังไม่ตั้งค่า ระบบจะข้ามการแจ้งเตือนไปเงียบๆ ไม่ error
   ============================================================ */
const TELEGRAM_BOT_TOKEN = "";
const TELEGRAM_CHAT_ID = "";
/* ============================================================ */

function telegramConfigured(){
  return TELEGRAM_BOT_TOKEN && !TELEGRAM_BOT_TOKEN.includes('ใส่')
      && TELEGRAM_CHAT_ID && !TELEGRAM_CHAT_ID.includes('ใส่');
}
async function sendTelegramNotify(text){
  if(!telegramConfigured()) return; // ยังไม่ได้ตั้งค่า Telegram -> ข้ามเงียบๆ
  try{
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  }catch(err){
    console.error('Telegram notify error:', err);
  }
}

/* =============== Roles & permissions =============== */
/* =============== ฐานข้อมูลพนักงาน (สำหรับ auto-fill ตอนสร้างใบรายการ) =============== */
const EMPLOYEES = [];
function lookupEmployee(empId){
  return EMPLOYEES.find(e=>e.id===empId);
}

const ROLE_META = {
  admin : {roleLabel:'ผู้ดูแลระบบ',  icon:'👑'},
  center: {roleLabel:'ศูนย์นนทบุรี', icon:'🏢'},
  unit  : {roleLabel:'หน่วยงาน',    icon:'🔧'},
};
const PERMS = {
  admin : {create:true, edit:true, approve:true, del:true,  close:true, viewLog:true, members:true},
  center: {create:true, edit:true, approve:true, del:false, close:false, viewLog:false, members:false},
  unit  : {create:true, edit:false,approve:false,del:false, close:true, viewLog:false, members:false},
};

const STATUS = {
  1:{label:'หน่วยงานสร้างใบรายการ', cls:'st-1'},
  2:{label:'ศูนย์นนทบุรีอนุมัติ',   cls:'st-2'},
  3:{label:'ทำงานเสร็จ ปิดงานแล้ว', cls:'st-3'},
};

/* =============== State =============== */
let db = null;
let currentUser = null;   // {username,name,role,roleLabel,icon}
let tickets = [];
let unsubTickets = null;

/* =============== Helpers =============== */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
function nowParts(){
  const d = new Date();
  const beYear = d.getFullYear() + 543;
  return {
    dateThai: `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${beYear}`,
    dateCode: `${pad(d.getDate())}${pad(d.getMonth()+1)}${beYear}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}
function fmtTS(d){
  const beYear = d.getFullYear()+543;
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${beYear} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtLocalDT(v){
  if(!v) return '-';
  const d = new Date(v);
  if(isNaN(d)) return v;
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()+543} ${pad(d.getHours())}:${pad(d.getMinutes())} น.`;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
/* ตัดคำนำหน้า "นาย" ที่อยู่หน้าสุดของชื่อ-นามสกุลออกก่อนบันทึก */
function stripNayPrefix(name){
  return String(name??'').trim().replace(/^นาย\s*/, '').trim();
}
function toast(msg){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2600);
}
function busy(on){ $('loadingBar').classList.toggle('show',on); }
function closeModal(id){ $(id).classList.remove('open'); }

/* เข้ารหัสรหัสผ่านแบบย้อนกลับได้ (ไม่ใช่ SHA-256) เพื่อให้ admin เรียกดูรหัสผ่านจริงได้
   หมายเหตุ: เพื่อความปลอดภัยสูงสุดควรใช้ hashing แบบทางเดียว แต่ระบบนี้ต้องการให้ admin
   ดูรหัสผ่านสมาชิกได้ตามคำขอ จึงใช้การเข้ารหัสแบบย้อนกลับได้แทน */
function encodePw(str){ return btoa(unescape(encodeURIComponent(str))); }
function decodePw(enc){ try{ return decodeURIComponent(escape(atob(enc))); }catch(e){ return ''; } }

/* =============== Firebase init =============== */
async function initFirebase(){
  const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('ใส่ค่า');
  if(!configured){
    $('configWarn').style.display='block';
    $('fbDot').classList.add('off');
    $('fbStatusText').textContent='ยังไม่ได้ตั้งค่า firebaseConfig';
    $('loginBtn').disabled = true;
    return;
  }
  try{
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    busy(true);
    await db.collection('tickets').limit(1).get();
    busy(false);
    $('fbDot').classList.add('on');
    $('fbStatusText').textContent='เชื่อมต่อ Firebase สำเร็จ ✓';
  }catch(err){
    busy(false);
    console.error(err);
    $('fbDot').classList.add('off');
    $('fbStatusText').textContent='เชื่อมต่อไม่สำเร็จ: '+err.message;
    $('loginBtn').disabled = true;
  }
}

/* =============== Log =============== */
function addLog(action, detail){
  if(!db) return;
  db.collection('logs').add({
    tsMs: Date.now(),
    tsText: fmtTS(new Date()),
    user: currentUser ? currentUser.name : '-',
    role: currentUser ? currentUser.roleLabel : '-',
    action, detail,
  }).catch(e=>console.error('log error',e));
}

/* =============== Login / Logout =============== */
async function doLogin(){
  const u = $('loginUser').value.trim();
  const p = $('loginPass').value;
  if(!db){ toast('⚠️ ยังไม่ได้เชื่อมต่อ Firebase'); return; }
  if(!u || !p){ $('loginErr').style.display='block'; return; }
  busy(true); $('loginBtn').disabled = true;
  try{
    const doc = await db.collection('users').doc(u).get();
    if(!doc.exists || decodePw(doc.data().pw) !== p){
      $('loginErr').style.display='block';
      return;
    }
    $('loginErr').style.display='none';
    const d = doc.data();
    currentUser = {username:d.username, name:d.name, role:d.role, roleLabel:ROLE_META[d.role].roleLabel, icon:ROLE_META[d.role].icon};
    addLog('เข้าสู่ระบบ', `ผู้ใช้ ${d.username} เข้าสู่ระบบสำเร็จ`);
    $('loginPage').style.display='none';
    $('appPage').style.display='block';
    $('uName').textContent = currentUser.name;
    $('uRole').textContent = 'ประเภท: ' + currentUser.roleLabel;
    $('uAvatar').textContent = currentUser.icon;
    $('logTab').style.display    = PERMS[currentUser.role].viewLog ? 'inline-flex' : 'none';
    $('memberTab').style.display = PERMS[currentUser.role].members ? 'inline-flex' : 'none';
    switchTab('dash');
    subscribeTickets();
    toast(`ยินดีต้อนรับ ${currentUser.name} ${currentUser.icon}`);
  }catch(err){
    console.error(err);
    toast('❌ เกิดข้อผิดพลาด: '+err.message);
  }finally{
    busy(false); $('loginBtn').disabled = false;
  }
}
function doLogout(){
  addLog('ออกจากระบบ', `ผู้ใช้ ${currentUser.username} ออกจากระบบ`);
  if(unsubTickets){ unsubTickets(); unsubTickets=null; }
  currentUser = null;
  $('appPage').style.display='none';
  $('loginPage').style.display='flex';
  $('loginUser').value=''; $('loginPass').value='';
}
$('loginPass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });

/* =============== Tabs =============== */
function switchTab(v){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===v));
  $('viewDash').style.display    = v==='dash'    ? 'block':'none';
  $('viewMembers').style.display = v==='members' ? 'block':'none';
  $('viewLog').style.display     = v==='log'     ? 'block':'none';
  if(v==='log') renderLog();
  if(v==='members') renderMembers();
}

/* =============== Tickets (real-time) =============== */
function subscribeTickets(){
  if(unsubTickets) unsubTickets();
  unsubTickets = db.collection('tickets').orderBy('createdMs','desc').onSnapshot(snap=>{
    tickets = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderTable();
  }, err=>{
    console.error(err);
    toast('❌ อ่านข้อมูลไม่สำเร็จ: '+err.message);
  });
}
function renderTable(){
  if(!currentUser) return;
  const q = ($('searchBox').value||'').toLowerCase();
  const tb = $('tbody'); tb.innerHTML='';
  const list = tickets.filter(t =>
    !q || [t.name,t.sub,t.fullname,t.emp,t.off].join(' ').toLowerCase().includes(q)
  );
  $('countPill').textContent = `${list.length} รายการ`;
  $('emptyState').style.display = list.length ? 'none':'block';
  const perm = PERMS[currentUser.role];
  list.forEach(t=>{
    const tr = document.createElement('tr');
    tr.className = STATUS[t.status].cls;
    let actions = `<button class="icon-btn" onclick="openDetail('${t.id}')">👁 ดู</button>`;
    if(perm.edit && t.status<3) actions += `<button class="icon-btn" onclick="openEdit('${t.id}')">✏️ แก้ไข</button>`;
    if(perm.approve && t.status===1) actions += `<button class="icon-btn approve" onclick="openApprove('${t.id}')">✔ อนุมัติ</button>`;
    if(perm.close && t.status===2) actions += `<button class="icon-btn close-job" onclick="openClose('${t.id}')">✅ ปิดงาน</button>`;
    if(perm.del) actions += `<button class="icon-btn danger" onclick="deleteTicket('${t.id}')">🗑 ลบ</button>`;
    tr.innerHTML = `
      <td><span class="ticket-name" onclick="openDetail('${t.id}')">${esc(t.name)}</span></td>
      <td>${esc(t.createdDate)}<br><span style="color:var(--ink-soft);font-size:12px">${esc(t.createdTime)} น.</span></td>
      <td>${esc(t.fullname)}<br><span style="color:var(--ink-soft);font-size:12px">รหัส ${esc(t.emp)}</span></td>
      <td>${esc(t.sub)}</td>
      <td>${esc(t.off)}</td>
      <td><span class="badge ${STATUS[t.status].cls}">${STATUS[t.status].label}</span></td>
      <td><div class="row-actions">${actions}</div></td>`;
    tb.appendChild(tr);
  });
}

/* =============== Create / Edit =============== */
let editingId = null;
/* =============== ETA radio-group helpers =============== */
const ETA_OPTIONS = {
  unknown: 'ไม่สามารถบอกเวลาได้',
  '1h': '1 ชั่วโมง',
  '2h': '2 ชั่วโมง',
  '3h': '3 ชั่วโมง',
};
function etaLabel(value){
  return ETA_OPTIONS[value] || (value ? String(value) : '-');
}
/* ตั้งชื่อใบรายการ: วันที่เดือนปีพศ_เวลาที่สร้างใบ_สฟ.ที่ทำงาน_เลขประจำตัวผู้ขอทำงาน */
function buildTicketName(dateCode, timeStr, sub, emp){
  const timeCode = String(timeStr||'').replaceAll(':','');
  return `${dateCode}_${timeCode}_${sub}_${emp}`;
}
function setEtaRadio(value){
  document.querySelectorAll('input[name="f_eta_radio"]').forEach(r=>{
    r.checked = (r.value === value);
    r.closest('.eta-radio').classList.toggle('checked', r.checked);
  });
}
function getEtaValue(){
  const checked = document.querySelector('input[name="f_eta_radio"]:checked');
  return checked ? checked.value : '';
}
function etaSelected(){
  return !!getEtaValue();
}

/* ล้าง/รีเซ็ตข้อมูลทุกช่องในฟอร์มสร้าง/แก้ไขใบรายการ (ไม่กระทบข้อมูลที่บันทึกไปแล้วใน Firestore) */
function clearForm(){
  if(!confirm('ยืนยันล้างข้อมูลทั้งหมดในฟอร์มนี้?')) return;
  ['f_emp','f_name','f_phone','f_dept','f_div','f_sect','f_sub','f_off','f_detail','f_reason'].forEach(id=>{
    $(id).value = '';
    $(id).closest('.field').classList.remove('invalid');
  });
  setEtaRadio(null);
  $('etaRadioGroup').closest('.field').classList.remove('invalid');
  if($('approvalSection').style.display !== 'none'){
    $('f_approver').value = '';
    $('f_operator').value = '';
    $('f_approver').closest('.field').classList.remove('invalid');
    $('f_operator').closest('.field').classList.remove('invalid');
    checkApprovalReady();
  }
  toast('🧹 ล้างข้อมูลในฟอร์มแล้ว');
}
function openCreate(){
  editingId = null;
  ['f_emp','f_name','f_phone','f_dept','f_div','f_sect','f_sub','f_off','f_detail','f_reason'].forEach(id=>{$(id).value='';$(id).closest('.field').classList.remove('invalid');});
  setEtaRadio(null);
  $('etaRadioGroup').closest('.field').classList.remove('invalid');
  const n = nowParts();
  $('f_created').value = `${n.dateThai} เวลา ${n.time} น.`;
  $('f_created').dataset.date = n.dateThai;
  $('f_created').dataset.time = n.time;
  $('f_created').dataset.code = n.dateCode;
  $('formTitle').textContent = 'สร้างใบรายการขอทำงาน';
  $('formMeta').textContent = 'กรอกข้อมูลให้ครบทุกช่อง';
  $('approvalSection').style.display = 'none';
  $('formApproveBtn').style.display = 'none';
  $('formSaveBtn').style.display = 'inline-flex';
  $('formOverlay').classList.add('open');
}
function openEdit(id){
  const t = tickets.find(x=>x.id===id); if(!t) return;
  editingId = id;
  $('f_emp').value=t.emp; $('f_name').value=t.fullname; $('f_phone').value=t.phone;
  $('f_dept').value=t.dept; $('f_div').value=t.div; $('f_sect').value=t.sect;
  $('f_sub').value=t.sub; $('f_off').value=t.off; $('f_detail').value=t.detail;
  $('f_reason').value = t.reason || '';
  setEtaRadio(t.eta);
  $('f_created').value = `${t.createdDate} เวลา ${t.createdTime} น.`;
  document.querySelectorAll('#formOverlay .field').forEach(f=>f.classList.remove('invalid'));
  $('formTitle').textContent = 'แก้ไขใบรายการ';
  $('formMeta').textContent = `กำลังแก้ไข: ${t.name}`;
  $('formSaveBtn').style.display = 'inline-flex';

  /* แสดงช่องผู้อนุมัติ/Operator + ปุ่มอนุมัติ เฉพาะ role ที่มีสิทธิ์อนุมัติ และใบรายการยังไม่ผ่านอนุมัติ */
  const showApproval = PERMS[currentUser.role].approve && t.status === 1;
  $('approvalSection').style.display = showApproval ? 'block' : 'none';
  $('formApproveBtn').style.display = showApproval ? 'inline-flex' : 'none';
  if(showApproval){
    $('f_approver').value = t.approverName || '';
    $('f_operator').value = t.operatorName || '';
    $('f_approver').closest('.field').classList.remove('invalid');
    $('f_operator').closest('.field').classList.remove('invalid');
    checkApprovalReady();
  }
  $('formOverlay').classList.add('open');
}
/* เปิดหน้าใบรายการเฉพาะสำหรับ "อนุมัติ" — แสดงเฉพาะปุ่ม ยกเลิก / อนุมัติ ไม่มีปุ่มบันทึกใบรายการ */
function openApprove(id){
  const t = tickets.find(x=>x.id===id); if(!t || t.status!==1) return;
  if(!PERMS[currentUser.role].approve){ toast('⚠️ คุณไม่มีสิทธิ์อนุมัติใบรายการ'); return; }
  openEdit(id);
  $('formTitle').textContent = 'อนุมัติใบรายการ';
  $('formMeta').textContent = `กำลังอนุมัติ: ${t.name}`;
  $('formSaveBtn').style.display = 'none';
}
/* เปิดใช้งานปุ่ม "อนุมัติ" เฉพาะเมื่อกรอกผู้อนุมัติ + Operator ครบทั้งคู่ */
function checkApprovalReady(){
  const ready = $('f_approver').value.trim().length>0 && $('f_operator').value.trim().length>0;
  $('formApproveBtn').disabled = !ready;
}
function validate(){
  let ok = true;
  const rules = [
    ['f_emp',   v=>/^\d{6}$/.test(v)],
    ['f_name',  v=>v.trim().length>0],
    ['f_phone', v=>/^\d{10}$/.test(v)],
    ['f_dept',  v=>v.trim().length>0],
    ['f_div',   v=>v.trim().length>0],
    ['f_sect',  v=>v.trim().length>0],
    ['f_sub',   v=>v.trim().length>0],
  ];
  rules.forEach(([id,fn])=>{
    const el = $(id), good = fn(el.value);
    el.closest('.field').classList.toggle('invalid', !good);
    if(!good) ok = false;
  });
  const etaGood = etaSelected();
  $('etaRadioGroup').closest('.field').classList.toggle('invalid', !etaGood);
  if(!etaGood) ok = false;
  return ok;
}
async function saveForm(){
  if(!validate()){ toast('⚠️ กรุณากรอกข้อมูลให้ครบและถูกต้อง'); return; }
  const val = id=>$(id).value.trim();
  busy(true); $('formSaveBtn').disabled = true;
  try{
    if(editingId===null){
      const code = $('f_created').dataset.code;
      const name = buildTicketName(code, $('f_created').dataset.time, val('f_sub'), val('f_emp'));
      await db.collection('tickets').add({
        name,
        emp:val('f_emp'), fullname:stripNayPrefix(val('f_name')), phone:val('f_phone'),
        dept:val('f_dept'), div:val('f_div'), sect:val('f_sect'),
        sub:val('f_sub'), off:val('f_off'), detail:val('f_detail'), eta:getEtaValue(),
        reason: val('f_reason'),
        createdDate:$('f_created').dataset.date, createdTime:$('f_created').dataset.time,
        createdMs: Date.now(), createdBy: currentUser.username,
        status:1, approvedBy:null, approvedAt:null, approverName:null, operatorName:null,
        closeResult:null, closeFinish:null, closedAt:null,
        history:[{ts:fmtTS(new Date()), text:`สร้างใบรายการ โดย ${currentUser.name}`, color:'#FFB3B3'}],
      });
      addLog('สร้างใบรายการ', `สร้าง "${name}"`);
      toast('🌸 สร้างใบรายการเรียบร้อย');
      sendTelegramNotify(
        `🆕 <b>สร้างใบรายการขอทำงานใหม่</b>\n`+
        `ใบรายการ: ${name}\n`+
        `ผู้ขอทำงาน: ${stripNayPrefix(val('f_name'))} (รหัส ${val('f_emp')})\n`+
        `สฟ.ที่ทำงาน: ${val('f_sub')}\n`+
        `อุปกรณ์ที่ต้อง OFF: ${val('f_off')}`
      );
    }else{
      const t = tickets.find(x=>x.id===editingId);
      const code = t.createdDate.replaceAll('/','');
      const name = buildTicketName(code, t.createdTime, val('f_sub'), val('f_emp'));
      await db.collection('tickets').doc(editingId).update({
        name,
        emp:val('f_emp'), fullname:stripNayPrefix(val('f_name')), phone:val('f_phone'),
        dept:val('f_dept'), div:val('f_div'), sect:val('f_sect'),
        sub:val('f_sub'), off:val('f_off'), detail:val('f_detail'), eta:getEtaValue(),
        reason: val('f_reason'),
        history: firebase.firestore.FieldValue.arrayUnion({ts:fmtTS(new Date()), text:`แก้ไขข้อมูล โดย ${currentUser.name}`, color:'#9D8CFF'}),
      });
      addLog('แก้ไขใบรายการ', `แก้ไข "${name}"`);
      toast('✏️ บันทึกการแก้ไขแล้ว');
    }
    closeModal('formOverlay');
  }catch(err){
    console.error(err); toast('❌ บันทึกไม่สำเร็จ: '+err.message);
  }finally{
    busy(false); $('formSaveBtn').disabled = false;
  }
}
/* อนุมัติจากในหน้าต่างแก้ไข พร้อมบันทึกชื่อผู้อนุมัติ/Operator (เฉพาะศูนย์นนทบุรี) */
async function approveFromForm(){
  if(editingId===null) return;
  if(!validate()){ toast('⚠️ กรุณากรอกข้อมูลใบรายการให้ครบและถูกต้อง'); return; }
  const approver = $('f_approver').value.trim();
  const operator = $('f_operator').value.trim();
  let ok = true;
  $('f_approver').closest('.field').classList.toggle('invalid', !approver); if(!approver) ok=false;
  $('f_operator').closest('.field').classList.toggle('invalid', !operator); if(!operator) ok=false;
  if(!ok){ toast('⚠️ กรุณากรอกผู้อนุมัติและชื่อ Operator'); return; }
  const t = tickets.find(x=>x.id===editingId); if(!t) return;
  const val = id=>$(id).value.trim();
  busy(true); $('formApproveBtn').disabled = true;
  try{
    const code = t.createdDate.replaceAll('/','');
    const name = buildTicketName(code, t.createdTime, val('f_sub'), val('f_emp'));
    const ts = fmtTS(new Date());
    await db.collection('tickets').doc(editingId).update({
      name,
      emp:val('f_emp'), fullname:stripNayPrefix(val('f_name')), phone:val('f_phone'),
      dept:val('f_dept'), div:val('f_div'), sect:val('f_sect'),
      sub:val('f_sub'), off:val('f_off'), detail:val('f_detail'), eta:getEtaValue(),
      reason: val('f_reason'),
      status:2, approvedBy: currentUser.name, approvedAt: ts, approverName: approver, operatorName: operator,
      history: firebase.firestore.FieldValue.arrayUnion({ts, text:`อนุมัติ โดย ${approver} (Operator: ${operator})`, color:'#EF9A3F'}),
    });
    addLog('อนุมัติใบรายการ', `อนุมัติ "${name}" — ผู้อนุมัติ: ${approver}, Operator: ${operator}`);
    toast('🧡 อนุมัติใบรายการแล้ว');
    sendTelegramNotify(
      `🧡 <b>อนุมัติใบรายการ</b>\n`+
      `ใบรายการ: ${name}\n`+
      `ผู้อนุมัติ: ${approver}\n`+
      `ชื่อ Operator: ${operator}`
    );
    closeModal('formOverlay');
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); $('formApproveBtn').disabled = false; }
}

/* =============== Delete =============== */
async function deleteTicket(id){
  const t = tickets.find(x=>x.id===id); if(!t) return;
  if(!confirm(`ยืนยันลบใบรายการ\n${t.name} ?\n(ลบแล้วไม่สามารถกู้คืนได้)`)) return;
  busy(true);
  try{
    await db.collection('tickets').doc(id).delete();
    addLog('ลบใบรายการ', `ลบ "${t.name}"`);
    toast('🗑 ลบใบรายการแล้ว');
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); }
}

/* =============== Close job =============== */
let closingId = null;
function openClose(id){
  const t = tickets.find(x=>x.id===id); if(!t||t.status!==2) return;
  closingId = id;
  $('c_result').value=''; $('c_finish').value='';
  document.querySelectorAll('#closeOverlay .field').forEach(f=>f.classList.remove('invalid'));
  $('closeMeta').textContent = `ใบรายการ: ${t.name}`;
  $('closeOverlay').classList.add('open');
}
async function saveClose(){
  const t = tickets.find(x=>x.id===closingId); if(!t) return;
  if(t.status !== 2){
    toast('⚠️ ใบรายการนี้ยังไม่ผ่านการอนุมัติ ไม่สามารถปิดงานได้');
    closeModal('closeOverlay');
    return;
  }
  let ok = true;
  [['c_result',v=>v.trim().length>0],['c_finish',v=>v.trim().length>0]].forEach(([id,fn])=>{
    const el=$(id), good=fn(el.value);
    el.closest('.field').classList.toggle('invalid',!good);
    if(!good) ok=false;
  });
  if(!ok){ toast('⚠️ กรุณากรอกข้อมูลปิดงานให้ครบ'); return; }
  busy(true);
  try{
    const ts = fmtTS(new Date());
    await db.collection('tickets').doc(closingId).update({
      status:3, closeResult:$('c_result').value.trim(), closeFinish:$('c_finish').value, closedAt:ts,
      history: firebase.firestore.FieldValue.arrayUnion({ts, text:`ปิดงาน โดย ${currentUser.name}`, color:'#3FA96B'}),
    });
    addLog('ปิดงาน', `ปิดงาน "${t.name}"`);
    toast('💚 ปิดงานเรียบร้อย');
    sendTelegramNotify(
      `✅ <b>ปิดงานเรียบร้อย</b>\n`+
      `ใบรายการ: ${t.name}\n`+
      `ผลการทำงาน: ${$('c_result').value.trim()}`
    );
    closeModal('closeOverlay');
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); }
}

/* =============== Detail =============== */
function openDetail(id){
  const t = tickets.find(x=>x.id===id); if(!t) return;
  $('dTitle').textContent = t.name;
  $('dBadgeLine').innerHTML = `<span class="badge ${STATUS[t.status].cls}">${STATUS[t.status].label}</span>`;
  const items = [
    ['รหัสพนักงาน', t.emp], ['ชื่อ-นามสกุล', t.fullname],
    ['เบอร์มือถือ', t.phone], ['แผนก', t.dept],
    ['กอง', t.div], ['ฝ่าย', t.sect],
    ['สฟ.ที่ทำงาน', t.sub], ['อุปกรณ์ที่ต้อง OFF', t.off],
    ['วันที่สร้างใบรายการ', t.createdDate], ['เวลาสร้างใบรายการ', t.createdTime + ' น.'],
    ['คาดการณ์เวลาทำงานเสร็จ', etaLabel(t.eta)], ['รายละเอียดการทำงาน', t.detail],
    ['สาเหตุการทำงาน', t.reason || '-'],
  ];
  $('dGrid').innerHTML = items.map(([k,v])=>`<div class="detail-item"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('');
  if(t.approverName || t.operatorName){
    $('dGrid').innerHTML += `
      <div class="detail-item"><div class="k">ผู้อนุมัติ</div><div class="v">${esc(t.approverName||'-')}</div></div>
      <div class="detail-item"><div class="k">ชื่อ Operator</div><div class="v">${esc(t.operatorName||'-')}</div></div>
      <div class="detail-item"><div class="k">วันที่/เวลาอนุมัติ</div><div class="v">${esc(t.approvedAt||'-')}</div></div>`;
  }
  if(t.status===3){
    $('dCloseBox').style.display='block';
    $('dCloseBox').innerHTML = `<div class="k">📗 ข้อมูลปิดงาน</div>
      ผลการทำงาน: ${esc(t.closeResult)}<br>ทำงานเสร็จจริง: ${esc(fmtLocalDT(t.closeFinish))}`;
  }else $('dCloseBox').style.display='none';
  $('dTimeline').innerHTML = '<div style="font-weight:700;font-size:13px;color:var(--ink-soft);margin-bottom:10px">ประวัติใบรายการ</div>' +
    (t.history||[]).map(h=>`<div class="tl-item"><span class="tl-dot" style="background:${h.color}"></span><div><b>${esc(h.text)}</b><br><span style="color:var(--ink-soft);font-size:12px">${esc(h.ts)}</span></div></div>`).join('');
  $('detailOverlay').classList.add('open');
}

/* =============== Members (admin) =============== */
let editingUsername = null; // null = adding new member, else = editing this username

async function renderMembers(){
  busy(true);
  try{
    const snap = await db.collection('users').orderBy('createdMs','asc').get();
    const tb = $('memberBody'); tb.innerHTML='';
    $('memberCount').textContent = `${snap.size} บัญชี`;
    snap.forEach(doc=>{
      const u = doc.data();
      const meta = ROLE_META[u.role] || {roleLabel:u.role, icon:'👤'};
      const isSelf = currentUser && u.username===currentUser.username;
      const realPw = esc(decodePw(u.pw||''));
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700">${esc(u.username)} ${isSelf?'<span style="font-size:11px;color:var(--ink-soft)">(คุณ)</span>':''}</td>
        <td>${esc(u.name)}</td>
        <td>
          <div class="pw-cell">
            <span class="pw-val" data-pw="${realPw}" data-shown="0">••••••</span>
            <button class="pw-eye" onclick="togglePw(this)">👁 ดู</button>
          </div>
        </td>
        <td><span class="badge role-${esc(u.role)}">${meta.icon} ${meta.roleLabel}</span></td>
        <td style="font-size:12px;color:var(--ink-soft)">${esc(u.createdText||'-')}</td>
        <td><div class="row-actions">
          <button class="icon-btn" onclick="openEditMember('${esc(u.username)}')">✏️ แก้ไข</button>
          ${isSelf?'':`<button class="icon-btn danger" onclick="deleteMember('${esc(u.username)}')">🗑 ลบ</button>`}
        </div></td>`;
      tb.appendChild(tr);
    });
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); }
}
function togglePw(btn){
  const span = btn.previousElementSibling;
  const shown = span.dataset.shown === '1';
  if(shown){
    span.textContent = '••••••';
    span.dataset.shown = '0';
    btn.textContent = '👁 ดู';
  }else{
    span.textContent = span.dataset.pw || '(ว่าง)';
    span.dataset.shown = '1';
    btn.textContent = '🙈 ซ่อน';
  }
}
function openAddMember(){
  editingUsername = null;
  ['m_user','m_pass','m_name'].forEach(id=>{$(id).value='';$(id).closest('.field').classList.remove('invalid');});
  $('m_role').value='unit';
  $('m_user').disabled = false;
  $('memberTitle').textContent = 'เพิ่มสมาชิกใหม่';
  $('memberSub').textContent = 'ข้อมูลจะถูกบันทึกในฐานข้อมูล Firebase';
  $('memberOverlay').classList.add('open');
}
async function openEditMember(username){
  busy(true);
  try{
    const doc = await db.collection('users').doc(username).get();
    if(!doc.exists){ toast('❌ ไม่พบสมาชิกนี้'); return; }
    const u = doc.data();
    editingUsername = username;
    document.querySelectorAll('#memberOverlay .field').forEach(f=>f.classList.remove('invalid'));
    $('m_user').value = u.username;
    $('m_user').disabled = false; // อนุญาตให้แก้ไข username ได้
    $('m_pass').value = decodePw(u.pw||'');
    $('m_name').value = u.name;
    $('m_role').value = u.role;
    $('memberTitle').textContent = `แก้ไขสมาชิก: ${u.username}`;
    $('memberSub').textContent = 'แก้ไข Username ได้ — ระบบจะย้ายข้อมูลไปยัง Username ใหม่ให้อัตโนมัติ';
    $('memberOverlay').classList.add('open');
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); }
}
async function saveMember(){
  const u = $('m_user').value.trim().toLowerCase();
  const p = $('m_pass').value;
  const n = $('m_name').value.trim();
  const r = $('m_role').value;
  let ok = true;
  $('m_user').closest('.field').classList.toggle('invalid', !/^[a-z0-9_.-]{3,}$/.test(u)); if(!/^[a-z0-9_.-]{3,}$/.test(u)) ok=false;
  $('m_pass').closest('.field').classList.toggle('invalid', p.length<6); if(p.length<6) ok=false;
  $('m_name').closest('.field').classList.toggle('invalid', !n); if(!n) ok=false;
  if(!ok){ toast('⚠️ กรุณากรอกข้อมูลสมาชิกให้ถูกต้อง'); return; }
  busy(true);
  try{
    if(editingUsername === null){
      /* ------- เพิ่มสมาชิกใหม่ ------- */
      const exists = await db.collection('users').doc(u).get();
      if(exists.exists){
        $('m_user').closest('.field').classList.add('invalid');
        toast('⚠️ Username นี้มีอยู่แล้ว'); return;
      }
      await db.collection('users').doc(u).set({
        username:u, pw: encodePw(p), name:n, role:r,
        createdMs: Date.now(), createdText: fmtTS(new Date()),
      });
      addLog('จัดการสมาชิก', `เพิ่มสมาชิก "${u}" (${ROLE_META[r].roleLabel})`);
      toast('👥 เพิ่มสมาชิกเรียบร้อย');
    }else if(editingUsername === u){
      /* ------- แก้ไขข้อมูล (username เดิม) ------- */
      await db.collection('users').doc(u).update({ pw: encodePw(p), name:n, role:r });
      addLog('จัดการสมาชิก', `แก้ไขข้อมูลสมาชิก "${u}"`);
      toast('✏️ บันทึกการแก้ไขแล้ว');
    }else{
      /* ------- แก้ไขพร้อมเปลี่ยน username: ย้าย document ------- */
      const newDoc = await db.collection('users').doc(u).get();
      if(newDoc.exists){
        $('m_user').closest('.field').classList.add('invalid');
        toast('⚠️ Username ใหม่นี้มีอยู่แล้ว'); return;
      }
      const oldDoc = await db.collection('users').doc(editingUsername).get();
      const createdMs = oldDoc.exists ? oldDoc.data().createdMs : Date.now();
      const createdText = oldDoc.exists ? oldDoc.data().createdText : fmtTS(new Date());
      await db.collection('users').doc(u).set({
        username:u, pw: encodePw(p), name:n, role:r, createdMs, createdText,
      });
      await db.collection('users').doc(editingUsername).delete();
      addLog('จัดการสมาชิก', `เปลี่ยน Username จาก "${editingUsername}" เป็น "${u}"`);
      toast('✏️ เปลี่ยน Username เรียบร้อย');
      if(currentUser && currentUser.username === editingUsername){
        currentUser.username = u; // sync ผู้ใช้ปัจจุบันถ้าแก้ไขบัญชีตัวเอง
        $('uName').textContent = n;
      }
    }
    closeModal('memberOverlay');
    editingUsername = null;
    renderMembers();
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); }
}
async function deleteMember(username){
  if(!confirm(`ยืนยันลบสมาชิก "${username}" ?`)) return;
  busy(true);
  try{
    await db.collection('users').doc(username).delete();
    addLog('จัดการสมาชิก', `ลบสมาชิก "${username}"`);
    toast('🗑 ลบสมาชิกแล้ว');
    renderMembers();
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); }
}

/* =============== Log view =============== */
async function renderLog(){
  busy(true);
  try{
    const snap = await db.collection('logs').orderBy('tsMs','desc').limit(300).get();
    const tb = $('logBody'); tb.innerHTML='';
    $('logCount').textContent = `${snap.size} รายการ (ล่าสุด 300)`;
    $('logEmpty').style.display = snap.size ? 'none':'block';
    const cls = a=>({'สร้างใบรายการ':'a-create','แก้ไขใบรายการ':'a-edit','อนุมัติใบรายการ':'a-approve','ปิดงาน':'a-close','ลบใบรายการ':'a-delete','เข้าสู่ระบบ':'a-login','ออกจากระบบ':'a-logout','จัดการสมาชิก':'a-member'}[a]||'');
    snap.forEach(doc=>{
      const l = doc.data();
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(l.tsText)}</td><td>${esc(l.user)}</td><td>${esc(l.role)}</td>
        <td class="log-action ${cls(l.action)}">${esc(l.action)}</td><td>${esc(l.detail)}</td>`;
      tb.appendChild(tr);
    });
  }catch(err){ console.error(err); toast('❌ '+err.message); }
  finally{ busy(false); }
}

/* close overlays when clicking backdrop */
/* บังคับ สฟ.ที่ทำงาน ให้เป็นตัวพิมพ์ใหญ่ภาษาอังกฤษอัตโนมัติ */
$('f_sub').addEventListener('input', e=>{
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toUpperCase();
  e.target.setSelectionRange(pos, pos);
});
/* เปิดปุ่ม "อนุมัติ" ก็ต่อเมื่อกรอกผู้อนุมัติ + Operator ครบทั้งคู่ */
$('f_approver').addEventListener('input', checkApprovalReady);
$('f_operator').addEventListener('input', checkApprovalReady);

/* toggle การไฮไลต์ปุ่ม Radio คาดการณ์เวลาทำงานเสร็จที่เลือกอยู่ */
document.querySelectorAll('input[name="f_eta_radio"]').forEach(r=>{
  r.addEventListener('change', ()=>{
    document.querySelectorAll('.eta-radio').forEach(l=>l.classList.remove('checked'));
    r.closest('.eta-radio').classList.add('checked');
    $('etaRadioGroup').closest('.field').classList.remove('invalid');
  });
});

/* Auto-fill ข้อมูลพนักงานทันทีที่พิมพ์ แม้ยังไม่ครบ 6 หลัก โดยจับคู่แบบ prefix
   ถ้ามีพนักงานที่รหัสขึ้นต้นตรงกันเพียงคนเดียว จะเติมข้อมูลให้ทันที */
function tryAutofillEmployee(){
  const id = $('f_emp').value.trim();
  if(!id || !/^\d+$/.test(id)) return;
  const matches = EMPLOYEES.filter(e=>e.id.startsWith(id));
  if(matches.length !== 1) return; // ยังไม่พบ หรือพบมากกว่า 1 คน รอพิมพ์เพิ่ม
  const emp = matches[0];
  if(emp.name) $('f_name').value = emp.name;
  if(emp.section) $('f_dept').value = emp.section;
  if(emp.department) $('f_div').value = emp.department;
  if(emp.division) $('f_sect').value = emp.division;
  toast(`👤 พบข้อมูล: ${emp.name}`);
}
$('f_emp').addEventListener('input', tryAutofillEmployee);
$('f_emp').addEventListener('blur', tryAutofillEmployee);

document.querySelectorAll('.overlay').forEach(ov=>{
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.classList.remove('open'); });
});

initFirebase();

