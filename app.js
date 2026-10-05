// 초기 데이터는 data.json에서 읽어 window.APP_DATA로 전달됩니다 (index.html의 로더 참고)
const APP_DATA = window.APP_DATA || {};
const BASE_LEDGER = Array.isArray(APP_DATA.baseLedger) ? APP_DATA.baseLedger : [];
const SUGGESTIONS = (APP_DATA.suggestions && typeof APP_DATA.suggestions === 'object') ? APP_DATA.suggestions : {};
// ---------- 브라우저 로컬 스토리지 (이 기기에만 저장되는 편의 정보) ----------
const LS_PREFIX = 'hufs-labor:';
function lsGet(key){
  try{ const v = localStorage.getItem(LS_PREFIX+key); return v==null ? null : JSON.parse(v); }
  catch(e){ return null; }
}
function lsSet(key,value){
  try{ localStorage.setItem(LS_PREFIX+key, JSON.stringify(value)); return true; }
  catch(e){ return false; }   // 저장 공간 부족·사생활 보호 모드 등: 조용히 무시
}
let auth = null;
let db = null;
let currentUser = null;
let dataUnsubscribers = [];
let ledger = [];
let budget = {};
let accountBalance = null;
  let closedThrough = 0;   // N월까지 마감 (0 = 없음)
const closureKey = y => 'month-closure:' + y;
const monthNo = m => parseInt(m,10) || 0;
let staffNames = [];
let staffBankDetails = [];
let staffGroups = {};   // { 이름: '집행부' | '대의원' }
let staffSortMode = 'exec-first';   // exec-first | delegate-first | name
const transferState = {skip:new Set(), amounts:{}, group:'전체', recvMemo:'', myMemo:''};
let paymentReportEntryIds = [];
let paymentReportSourceStatus = '';
let paymentReportApproval = null;   // 승인 직후 {approval, managementNo} — PDF에 승인 도장을 넣기 위해 보관
let editingEntryId = '';
let accountCategories = createDefaultAccountCategories();
let charts = {};
let currentMonthReport = '전체';
let currentMonthEntry = '전체';
let currentStatusEntry = '전체';
let currentGubun = '지출';
let budgetMigrationMessage = '';
let categoriesNeedMigration = false;
let budgetNeedsMigration = false;
let statusMessageTimer = null;

const STATUS_LABEL = {
  'input-complete':'입력완료',
  submitted:'결의완료',
  approved:'<span class="approved-status">승인</span>',
  paid:'<span class="approved-status">승인</span>',
  confirmed:'<span class="approved-status">승인</span>',
  rejected:'반려됨'
};

const fmt = n => Math.round(n).toLocaleString('ko-KR') + '원';
const fmtShort = n => Math.round(n).toLocaleString('ko-KR');
const monthList = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];


function createDefaultAccountCategories(){
  const group = (name, accounts) => ({name, accounts});
  const account = (name, items) => ({name, items});
  return {
    income:[
      group('조합비_관',[account('조합비_항',['조합비(외대)','조합비(후생)','조합비(산단)','조합비(지출원)'])]),
      group('창립행사지원금_관',[account('창립행사지원금_항',['창립행사지원금(학교)'])]),
      group('전기이월금_관',[account('전기이월금_항',['전기이월금'])]),
      group('이자수입_관',[account('이자수입_항',['이자수입'])]),
      group('기금회계전입금_관',[account('기금회계전입금_항',['기금회계 전입금'])]),
      group('기타수입_기부금등_관',[account('기타수입_기부금등_항',['기타수입(기부금 등)'])])
    ],
    expense:[
      group('운영비_관',[
        account('사무실운영비_항',['사무실운영비']),
        account('신문도서비_항',['신문도서비']),
        account('통신비_SMS등_항',['통신비(SMS 등)'])
      ]),
      group('사업비_관',[
        account('조직사업비_항',['조직강화비','생일축하사업비','부서별간담회비','소모임지원비']),
        account('교육사업비_항',['대의원/중집수련회비','간부/교섭위원교육비']),
        account('홍보사업비_항',['홍보물/선전물제작비','홈페이지 관리비']),
        account('정책사업비_항',['정책개발비','법률자문비']),
        account('후생복지사업비_항',['경조비','퇴직조합원기념품구입비','포상비','문화사업지원비']),
        account('연대사업비_항',['교내외 연대사업비'])
      ]),
      group('회의비_관',[
        account('임원중집위회의비_항',['임원/중집/대의원회의비']),
        account('단체교섭회의비_항',['단체교섭회의비']),
        account('회계감사선관위회의비_항',['회계감사/선관위회의비'])
      ]),
      group('행사비_관',[
        account('조합원총회비_항',['조합원총회비']),
        account('창립기념행사비_항',['창립기념행사비']),
        account('야외행사비_항',['야외행사비']),
        account('퇴직조합원환송회비_항',['퇴직조합원 환송회비']),
        account('노동절행사비_항',['노동절행사비'])
      ]),
      group('활동비_관',[
        account('중앙집행위원활동비_항',['중앙집행위원활동비']),
        account('대의원활동비_항',['대의원활동비'])
      ]),
      group('예비비_관',[
        account('교통유류비_항',['교통유류비']),
        account('예비비_항',['예비비'])
      ]),
      group('조합비환불비_관',[account('조합비환불비_항',['조합비환불비'])]),
      group('차기이월금_관',[account('차기이월금_항',['차기이월금'])])
    ]
  };
}

// ---------- storage ----------
const YEARS_KEY = 'years:list';
const ledgerKey = y => 'ledger:' + y;
const budgetKey = y => 'budget:' + y;
const accountBalanceKey = y => 'account-balance:' + y;
const STAFF_NAMES_KEY = 'staff-names:list';
const STAFF_BANK_DETAILS_KEY = 'staff-bank-details:list';
const STAFF_GROUPS_KEY = 'staff-groups:map';
const STAFF_GROUP_OPTIONS = ['집행부','대의원'];
const SUBMISSION_SEQUENCE_KEY = 'management-sequence:submission';
const CATEGORY_SCHEMA_VERSION = 2;
const categoryKey = y => 'categories:' + y;
const fyStart = y => `${y}-01-01`;
const fyEnd = y => `${y}-12-31`;
let lastStorageError = '';

function hasSharedStorage(){
  return !!db && !!currentUser;
}

async function storageGet(key){
  if(!hasSharedStorage()) throw new Error('Firebase에 로그인한 뒤 다시 시도해주세요.');
  const snapshot = await db.collection('accountingData').doc(key).get();
  if(snapshot.exists) return {value:snapshot.data().value};
  const error = new Error(`Firestore 문서가 없습니다: ${key}`);
  error.code = 'accounting/not-found';
  throw error;
}

function stateChangedError(message){
  const error = new Error(message);
  error.code = 'accounting/state-changed';
  return error;
}

function writeMeta(){
  return {
    updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy:currentUser.uid,
    updatedByEmail:currentUser.email || ''
  };
}


async function storageSet(key, value){
  lastStorageError = '';
  if(!hasSharedStorage()) throw new Error('Firebase에 로그인한 뒤 다시 시도해주세요.');
  await db.collection('accountingData').doc(key).set({
    value,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy:currentUser.uid,
    updatedByEmail:currentUser.email || ''
  });
}

async function storageSetMany(entries){
  lastStorageError = '';
  if(!hasSharedStorage()) throw new Error('Firebase에 로그인한 뒤 다시 시도해주세요.');
  const batch = db.batch();
  entries.forEach(([key,value])=>{
    batch.set(db.collection('accountingData').doc(key),{
      value,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy:currentUser.uid,
      updatedByEmail:currentUser.email || ''
    });
  });
  await batch.commit();
}

function renderStorageNotice(){
  const notice = document.getElementById('storage-notice');
  if(!notice) return;
  notice.dataset.storageMode = 'shared';
  const warning = document.getElementById('entry-storage-warning');
  if(warning) warning.textContent = '';
}

function showAuthGate(title, message, email=''){
  stopQuotaCountdown();
    document.getElementById('gate-sign-in').classList.remove('hidden');   // ← 추가
  document.getElementById('auth-gate-title').textContent = title;
  document.getElementById('auth-gate-message').textContent = message;
  const userId = document.getElementById('auth-user-id');
  userId.classList.toggle('hidden', !email);
  userId.innerHTML = email ? `Google 계정 이메일: <code>${escapeHTML(email)}</code>` : '';
  document.getElementById('auth-gate').classList.remove('hidden');
  document.getElementById('app-controls').classList.add('hidden');
  document.getElementById('app-tabs').classList.add('hidden');
  document.getElementById('app-content').classList.add('hidden');
}

  // ---------- Firestore 일일 한도 초과 안내 ----------
let quotaTimer = null;

function isQuotaError(error){
  return error?.code === 'resource-exhausted'
      || /quota|resource.?exhausted/i.test(error?.message || '');
}
  
  
// 다음 초기화 시각 = 미국 태평양시 다음 자정 (서머타임 때문에 하루가 23/25시간일 수 있어 25시간 뒤 날짜의 자정을 구함)
function quotaResetTime(now=new Date()){
  const pacificMidnightOf = date=>{
    const parts = new Intl.DateTimeFormat('en-US',{
      timeZone:'America/Los_Angeles',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'
    }).formatToParts(date);
    const get = type=>Number(parts.find(p=>p.type===type).value);
    const elapsed = ((get('hour')%24)*3600 + get('minute')*60 + get('second'))*1000 + date.getMilliseconds();
    return new Date(date.getTime() - elapsed);
  };
  const todayStart = pacificMidnightOf(now);
  return pacificMidnightOf(new Date(todayStart.getTime() + 25*3600*1000));
}

function stopQuotaCountdown(){
  if(quotaTimer){ clearInterval(quotaTimer); quotaTimer = null; }
  const box = document.getElementById('quota-countdown');
  if(box){ box.classList.add('hidden'); box.innerHTML = ''; }
}

function showQuotaGate(){
  if(db) db.terminate().catch(()=>{});   // 불필요한 재시도 중단
  showAuthGate(
   '우리는 거지입니다. 오늘 사용량 한도를 모두 사용했습니다.',
   '로그인은 성공했지만 서버가 응답하지 않습니다. \n무료 일일 읽기 한도를 모두 사용했을 가능성이 가장 높습니다. \n한도가 초기화된 뒤 다시 접속해 주세요. \n(인터넷 연결이 불안정해도 같은 화면이 나올 수 있습니다.)'
   );
  document.getElementById('gate-sign-in').classList.add('hidden');
  
  const box = document.getElementById('quota-countdown');
  const reset = quotaResetTime();
  const resetLabel = reset.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const pad = n=>String(n).padStart(2,'0');
  const tick = ()=>{
    const left = reset.getTime() - Date.now();
    if(left <= 0){
      box.innerHTML = '한도가 초기화되었을 시간입니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요.';
      clearInterval(quotaTimer); quotaTimer = null;
      return;
    }
    const h = Math.floor(left/3600000);
    const m = Math.floor(left%3600000/60000);
    const s = Math.floor(left%60000/1000);
    box.innerHTML =
      `한도 초기화까지 남은 시간
       <span class="quota-time">${pad(h)}:${pad(m)}:${pad(s)}</span>
       <small>초기화 예정: ${resetLabel} (내 컴퓨터 시간 기준)</small>`;
  };
  box.classList.remove('hidden');
  tick();
  quotaTimer = setInterval(tick,1000);
}
  
function stopSharedDataWatchers(){
  dataUnsubscribers.forEach(unsubscribe=>unsubscribe());
  dataUnsubscribers = [];
}


// ---------- 자주 쓰는 지출 템플릿 ----------
// 사용·설정: 로그인한 모든 허가 담당자 (UID별 권한 없음). 저장 위치: Firestore(공유) + 이 브라우저의 로컬 스토리지(보관본)
const QUICK_TEMPLATES_KEY = 'quick-templates:list';
const MAX_QUICK_TEMPLATES = 20;
const DEFAULT_QUICK_TEMPLATES = [
  {id:'default-1', name:'중집 활동비', cls:null, desc:'중앙집행위원회 정기회의 활동비', payee:'중집위 대표', spender:'', amount:''},
  {id:'default-2', name:'생일 축하 사업', cls:null, desc:'조합원 정기 생일 축하 상품권 지급', payee:'조합원 일동', spender:'', amount:''},
  {id:'default-3', name:'업무용 유류비', cls:null, desc:'노조 업무 차량 유류비 지급', payee:'주유소', spender:'', amount:''}
];
let quickTemplates = (()=>{
  const local = lsGet('quick-templates');
  const list = Array.isArray(local) ? normalizeQuickTemplates(local) : [];
  return list.length ? list : DEFAULT_QUICK_TEMPLATES.map(t=>({...t}));
})();
let currentPermissions = {manageTemplates:false};
let templateDraft = [];

function normalizeQuickTemplates(list){
  if(!Array.isArray(list)) return [];
  const text = (v,max)=>String(v==null?'':v).trim().slice(0,max);
  return list.slice(0,MAX_QUICK_TEMPLATES).map((t,i)=>{
    if(!t || typeof t!=='object') return null;
    const name = text(t.name,20);
    if(!name) return null;
    const cls = t.cls && typeof t.cls==='object' && t.cls.mok
      ? {gwan:text(t.cls.gwan,80),hang:text(t.cls.hang,80),mok:text(t.cls.mok,80)}
      : null;
    return {
      id:text(t.id,40) || ('t'+i+Date.now().toString(36)),
      name, cls,
      desc:text(t.desc,100), payee:text(t.payee,60), spender:text(t.spender,30),
      amount:/^-?\d+$/.test(text(t.amount,15)) ? text(t.amount,15) : ''
    };
  }).filter(Boolean);
}

function renderQuickTemplates(){
  const holder = document.getElementById('quick-template-buttons');
  if(!holder) return;
  holder.replaceChildren();
  if(!quickTemplates.length){
    const empty = document.createElement('span');
    empty.className = 'qt-empty';
    empty.textContent = currentPermissions.manageTemplates ? '등록된 템플릿이 없습니다. ⚙ 템플릿 설정에서 추가하세요.' : '등록된 템플릿이 없습니다.';
    holder.appendChild(empty);
  }
  quickTemplates.forEach(t=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qt-btn';
    btn.dataset.templateId = t.id;
    btn.textContent = t.name;
    holder.appendChild(btn);
  });
  const manage = document.getElementById('btn-template-manage');
  if(manage) manage.classList.toggle('hidden', !currentPermissions.manageTemplates);
  if(!currentPermissions.manageTemplates){
    const editor = document.getElementById('template-editor');
    if(editor) editor.classList.add('hidden');
  }
}

function applyTemplate(id) {
  const tpl = quickTemplates.find(t=>t.id===id);
  if (!tpl) return;
  if (editingEntryId) {
    setStatus('내역을 수정하는 중에는 템플릿을 쓸 수 없습니다. 수정을 마치거나 취소한 뒤 사용해 주세요.', true);
    return;
  }
  setGubun('지출');   // 지출 템플릿 (세부 계정과목 목록도 지출 기준으로 갱신)
  let notice = '';
  if (tpl.cls) {
    const value = JSON.stringify({gwan:tpl.cls.gwan, hang:tpl.cls.hang, mok:tpl.cls.mok});
    const select = document.getElementById('f-mok');
    if (select && [...select.options].some(o=>o.value===value)) select.value = value;
    else notice = ' 저장된 세부 계정과목이 현재 목록에 없어 직접 선택해 주세요.';
  }
  document.getElementById('f-desc').value = tpl.desc || '';
  document.getElementById('f-payee').value = tpl.payee || '';
  if (tpl.spender) document.getElementById('f-spender').value = tpl.spender;
  document.getElementById('f-amount').value = tpl.amount || '';
  setStatus(`'${tpl.name}' 템플릿을 불러왔습니다.${notice}`, !!notice);
  // 금액이 이미 있으면 결제일로, 없으면 금액 입력칸으로 포커스
  const el = document.getElementById(tpl.amount ? 'f-date' : 'f-amount');
  if (el) el.focus();
}

function templateClassificationOptions(selectedValue){
  const opts = ['<option value="">(선택 안 함)</option>'];
  [...(accountCategories.expense||[])]
    .sort((x,y)=>x.name.replace(/_관$/,'').localeCompare(y.name.replace(/_관$/,''),'ko'))
    .forEach(gwan=>{
      const items = gwan.accounts.flatMap(hang=>hang.items.map(mok=>({hang,mok})))
        .filter(({mok})=>mok.trim()!=='대학노조회비')
        .sort((x,y)=>x.mok.localeCompare(y.mok,'ko'));
      if(!items.length) return;
      opts.push('<optgroup label="'+escapeHTML(gwan.name.replace(/_관$/,''))+'">');
      items.forEach(({hang,mok})=>{
        const value = JSON.stringify({gwan:gwan.name,hang:hang.name,mok});
        opts.push('<option value="'+escapeHTML(value)+'"'+(value===selectedValue?' selected':'')+'>'+escapeHTML(mok)+'</option>');
      });
      opts.push('</optgroup>');
    });
  return opts.join('');
}

function renderTemplateEditor(){
  const list = document.getElementById('template-editor-list');
  if(!list) return;
  if(!templateDraft.length){
    list.innerHTML = '<p class="qt-empty">템플릿이 없습니다. 아래에서 추가해 주세요.</p>';
    return;
  }
  list.innerHTML = templateDraft.map((t,i)=>{
    const clsValue = t.cls ? JSON.stringify({gwan:t.cls.gwan,hang:t.cls.hang,mok:t.cls.mok}) : '';
    return '<div class="qt-item" data-index="'+i+'"><div class="qt-grid">'+
      '<div><label>버튼 이름</label><input type="text" data-qt="name" maxlength="20" value="'+escapeHTML(t.name)+'" placeholder="예: 중집 활동비"></div>'+
      '<div><label>세부 계정과목</label><select data-qt="cls">'+templateClassificationOptions(clsValue)+'</select></div>'+
      '<div class="span2"><label>내용</label><input type="text" data-qt="desc" maxlength="100" value="'+escapeHTML(t.desc)+'"></div>'+
      '<div><label>지급처</label><input type="text" data-qt="payee" maxlength="60" value="'+escapeHTML(t.payee)+'"></div>'+
      '<div><label>담당자</label><input type="text" data-qt="spender" maxlength="30" list="staff-name-options" value="'+escapeHTML(t.spender)+'"></div>'+
      '<div><label>금액(원, 비워도 됨)</label><input type="text" data-qt="amount" inputmode="numeric" maxlength="15" value="'+escapeHTML(t.amount)+'"></div>'+
      '</div><div class="qt-item-foot"><button type="button" class="btn-text" data-qt-remove="'+i+'">이 템플릿 삭제</button></div></div>';
  }).join('');
}

// 편집 중 입력값을 draft에 반영
function collectTemplateDraft(){
  document.querySelectorAll('#template-editor-list .qt-item').forEach(item=>{
    const i = Number(item.dataset.index);
    const t = templateDraft[i];
    if(!t) return;
    const val = key => item.querySelector('[data-qt="'+key+'"]').value;
    t.name = val('name'); t.desc = val('desc'); t.payee = val('payee'); t.spender = val('spender');
    t.amount = val('amount').replace(/[,\s]/g,'');
    try{ const c = JSON.parse(val('cls')||'null'); t.cls = c && c.mok ? c : null; }catch(e){ t.cls = null; }
  });
}

function setTemplateStatus(msg,isError=false){
  const el = document.getElementById('template-status');
  if(!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--expense)' : '';
}

function openTemplateEditor(){
  if(!currentPermissions.manageTemplates) return;
  templateDraft = quickTemplates.map(t=>({...t, cls:t.cls?{...t.cls}:null}));
  renderTemplateEditor();
  setTemplateStatus('');
  document.getElementById('template-editor').classList.remove('hidden');
}

function newTemplateDraft(base){
  return Object.assign({id:'t'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), name:'', cls:null, desc:'', payee:'', spender:'', amount:''}, base||{});
}

async function saveTemplates(){
  if(!currentPermissions.manageTemplates){
    setTemplateStatus('로그인한 뒤 다시 시도해 주세요.', true);
    return;
  }
  collectTemplateDraft();
  const names = new Set();
  for(const t of templateDraft){
    const name = String(t.name||'').trim();
    if(!name){ setTemplateStatus('버튼 이름이 비어 있는 템플릿이 있습니다.', true); return; }
    if(names.has(name)){ setTemplateStatus(`버튼 이름이 겹칩니다: ${name}`, true); return; }
    names.add(name);
    if(t.amount && !/^-?\d+$/.test(t.amount)){ setTemplateStatus(`금액은 숫자만 입력해 주세요: ${name}`, true); return; }
  }
  const cleaned = normalizeQuickTemplates(templateDraft);
  try{
    await storageSet(QUICK_TEMPLATES_KEY, JSON.stringify(cleaned));
    quickTemplates = cleaned;
    lsSet('quick-templates', cleaned);
    renderQuickTemplates();
    setTemplateStatus(`템플릿 ${cleaned.length}개를 저장했습니다.`);
  }catch(e){
    // 서버 저장이 실패해도 이 브라우저에는 남겨 둡니다
    quickTemplates = cleaned;
    const kept = lsSet('quick-templates', cleaned);
    renderQuickTemplates();
    setTemplateStatus(`서버 저장 실패: ${e.message || String(e)}${kept ? ' (이 브라우저에는 저장했습니다.)' : ''}`, true);
  }
}

/**
 * 데이터를 CSV 파일로 변환하여 다운로드하는 공통 함수 (한글 깨짐 방지 UTF-8 BOM 적용)
 * @param {Array<Array<string>>} rows - 2차원 배열 데이터 (헤더 + 데이터 행)
 * @param {string} filename - 저장할 파일명 (예: "2026_예산대비실적.csv")
 */
function downloadCSV(rows, filename) {
  // UTF-8 BOM 추가 (\uFEFF)
  const csvContent = "\uFEFF" + rows.map(row => 
    row.map(cell => {
      // 큰따옴표, 줄바꿈, 쉼표 예외 처리
      const str = String(cell ?? '').replace(/"/g, '""');
      return `"${str}"`;
    }).join(",")
  ).join("\r\n");

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 1) 예산 대비 실적 표 CSV 내보내기
 * @param {Array<Object>} budgetData - 예산 대비 실적 데이터 객체 배열
 */
function exportBudgetReportToCSV(budgetData) {
  const headers = ["관", "항", "목", "예산액(원)", "집행액(원)", "잔액(원)", "집행률(%)"];
  
  const rows = [headers];
  
  budgetData.forEach(item => {
    const budget = Number(item.budget || 0);
    const spent = Number(item.spent || 0);
    const balance = budget - spent;
    const rate = budget > 0 ? ((spent / budget) * 100).toFixed(1) : "0.0";

    rows.push([
      item.gwan || '',
      item.hang || '',
      item.mok || '',
      budget,
      spent,
      balance,
      `${rate}%`
    ]);
  });

  const today = new Date().toISOString().slice(0, 10);
  downloadCSV(rows, `한국외대_노동조합_예산대비실적보고서_${today}.csv`);
}

/**
 * 2) 거래 내역 전체/검색결과 CSV 내보내기
 * @param {Array<Object>} transactions - 거래 내역 데이터 객체 배열
 */
function exportTransactionsToCSV(transactions) {
  const headers = ["날짜", "구분", "관", "항", "목", "적요/내용", "지급처", "담당자", "금액(원)"];
  
  const rows = [headers];

  transactions.forEach(t => {
    rows.push([
      t.date || '',
      t.type || '',
      t.gwan || '',
      t.hang || '',
      t.mok || '',
      t.desc || '',
      t.payee || '',
      t.staff || '',
      Number(t.amount || 0)
    ]);
  });

  const today = new Date().toISOString().slice(0, 10);
  downloadCSV(rows, `한국외대_노동조합_회계장부_거래내역_${today}.csv`);
}



  
function watchSharedData(){
  stopSharedDataWatchers();
  const watchedKeys = [YEARS_KEY,budgetKey(currentYear),accountBalanceKey(currentYear),STAFF_NAMES_KEY,STAFF_BANK_DETAILS_KEY,STAFF_GROUPS_KEY,QUICK_TEMPLATES_KEY,categoryKey(currentYear)];
  watchedKeys.forEach(key=>{
    const unsubscribe = db.collection('accountingData').doc(key).onSnapshot(snapshot=>{
      if(!snapshot.exists) return;
      const value = snapshot.data().value;
      if(typeof value !== 'string') return;
      try{
        const data = JSON.parse(value);
        if(key===YEARS_KEY){
          if(JSON.stringify(years)!==JSON.stringify(data)){
            years = data;
            renderYearSelect();
          }
        
        } else if(key===budgetKey(currentYear)){
          if(JSON.stringify(budget)!==JSON.stringify(data)){
            budget = data;
            renderHierarchyForm();
            renderReport();
          }
        } else if(key===accountBalanceKey(currentYear)){
          if(!Number.isSafeInteger(data) || data<0) throw new Error('저장된 활동비 계좌 잔액이 올바른 숫자가 아닙니다.');
          accountBalance = data;
          renderReport();
        } else if(key===STAFF_NAMES_KEY){
          if(!Array.isArray(data) || !data.every(name=>typeof name==='string')){
            throw new Error('저장된 담당자 이름 목록이 올바르지 않습니다.');
          }
          staffNames = normalizeStaffNames(data);
          renderStaffNames();
        } else if(key===STAFF_BANK_DETAILS_KEY){
          staffBankDetails = normalizeStaffBankDetails(data);
          renderStaffNames();
        } else if(key===STAFF_GROUPS_KEY){
          staffGroups = normalizeStaffGroups(data);
          renderStaffNames();
        } else if(key===QUICK_TEMPLATES_KEY){
          quickTemplates = normalizeQuickTemplates(data);
          lsSet('quick-templates', quickTemplates);
          renderQuickTemplates();
        } else if(key===categoryKey(currentYear)){
          if(JSON.stringify(accountCategories)!==JSON.stringify(data)){
            accountCategories = data;
            renderHierarchyForm();
          }
        }
      }catch(e){
        document.getElementById('auth-status').textContent = `공유 데이터 처리 실패: ${e.message}`;
      }
    },error=>{
      document.getElementById('auth-status').textContent = `Firestore 실시간 동기화 오류: ${error.message}`;
    });
    dataUnsubscribers.push(unsubscribe);
  });
}

async function initializeApplicationData(){
  activateTab(window.location.hash.slice(1) || lsGet('tab') || 'entry');
  renderStorageNotice();
  await loadYears();
  const savedYear = Number(lsGet('year'));
  if(years.includes(savedYear)) currentYear = savedYear;
  const savedSort = lsGet('staff-sort');
  if(['exec-first','delegate-first','name'].includes(savedSort)){
    staffSortMode = savedSort;
    const sortSelect = document.getElementById('staff-sort-select');
    if(sortSelect) sortSelect.value = savedSort;
  }
  await loadYearData();
  setupDatalists();
  setGubun('지출');
  appReady = true;
  renderAll();
  watchSharedData();
}

async function handleAuthState(user){
  stopSharedDataWatchers();
  stopLedgerWatcher();
  currentUser = user;
  currentPermissions = {manageTemplates:false};
  renderQuickTemplates();
  document.getElementById('btn-sign-in').classList.add('hidden');
  document.getElementById('btn-sign-out').classList.toggle('hidden', !user);
  if(!user){
    // 세션 복원 전·비로그인: 로그인 버튼 없이 안내만 (자동 로그인 대기)
    showAuthGate('자료를 불러오고 있습니다','잠시만 기다려 주세요.');
    document.getElementById('gate-sign-in').classList.add('hidden');
    document.getElementById('btn-sign-in').classList.add('hidden');
    document.getElementById('auth-status').textContent = '인증 확인 중…';
    // 짧은 대기 후에도 세션이 없으면 로그인 버튼 표시
    setTimeout(()=>{
      if(!currentUser){
        showAuthGate('로그인이 필요합니다','허가된 담당자 Google 계정으로 로그인해 주세요.');
        document.getElementById('gate-sign-in').classList.remove('hidden');
        document.getElementById('btn-sign-in').classList.remove('hidden');
        document.getElementById('auth-status').textContent = '로그인 필요';
      }
    }, 1500);
    return;
  }
  showAuthGate('자료를 불러오고 있습니다','장부와 예산 자료를 불러오는 중입니다. 잠시만 기다려 주세요.');
  document.getElementById('gate-sign-in').classList.add('hidden');
  document.getElementById('auth-status').textContent = `${user.email || 'Google 계정'} 확인 중…`;

  try{
const myEmail = String(user.email||'').toLowerCase();
const allowed = await Promise.race([
  // 허용 이메일 목록 문서(accessControl/allowedEmails)를 읽습니다.
  // 미등록 계정은 규칙상 읽기가 거부되므로 permission-denied = 미등록으로 처리합니다.
  db.collection('accessControl').doc('allowedEmails').get()
    .then(snap=>({denied:false, emails:snap.exists && Array.isArray(snap.data().emails) ? snap.data().emails : []}))
    .catch(err=>{
      if(err && err.code==='permission-denied') return {denied:true, emails:[]};
      throw err;
    }),
  new Promise((_,reject)=>setTimeout(
    ()=>reject(Object.assign(new Error('Firestore 응답 시간 초과 (한도 초과 가능성)'),{code:'resource-exhausted'})),
    2500))
]);

    if(!user.email || !user.emailVerified || allowed.denied || !allowed.emails.some(e=>String(e).trim().toLowerCase()===myEmail)){
      showAuthGate(
        '접근 권한이 없습니다',
        '이 이메일을 Firebase 담당자에게 전달해 허용 이메일 목록(accessControl/allowedEmails)에 등록해 달라고 요청하세요.\n(이미 등록했다면 firestore.rules가 게시되었는지도 확인해 주세요.)',
        user.email || ''
      );
      document.getElementById('gate-sign-in').classList.add('hidden');
      document.getElementById('auth-status').textContent = '허용되지 않은 계정';
      return;
    }
currentPermissions = {manageTemplates:true};   // 허가된 계정이면 누구나 템플릿 설정 가능
renderQuickTemplates();
document.getElementById('auth-status').textContent = `${user.email || 'Google 계정'} 데이터 불러오는 중…`;
document.getElementById('auth-gate-message').textContent = '장부와 예산 자료를 불러오는 중입니다. 잠시만 기다려 주세요.';
await initializeApplicationData();
document.getElementById('auth-gate').classList.add('hidden');
document.getElementById('app-controls').classList.remove('hidden');
document.getElementById('app-tabs').classList.remove('hidden');
document.getElementById('app-content').classList.remove('hidden');
document.getElementById('auth-status').textContent = user.email || '로그인됨';
     }catch(e){
    console.error('AUTH-GATE ERROR', e.code, e.message, e);
    stopSharedDataWatchers();
    stopLedgerWatcher();
    if(isQuotaError(e)){
      showQuotaGate();
      document.getElementById('auth-status').textContent = '일일 사용량 한도 초과';
      return;
    }
    if(e.code==='permission-denied'){
      showAuthGate(
        '접근 권한을 확인하지 못했습니다',
        'Firestore가 요청을 거부했습니다. firestore.rules가 최신 내용으로 게시되었는지, 장부 데이터 규칙(accountingData)이 맞는지 확인해 주세요.',
        user.email || ''
      );
      document.getElementById('gate-sign-in').classList.add('hidden');
      document.getElementById('auth-status').textContent = '권한 거부';
      return;
    }
    showAuthGate(
    '서버 응답이 없습니다 (일일 한도 초과 가능성)',
  '로그인은 성공했지만 Firestore가 응답하지 않습니다. 무료 일일 읽기 한도를 모두 사용했을 가능성이 가장 높습니다. 한도가 초기화된 뒤 다시 접속해 주세요. (인터넷 연결이 불안정해도 같은 화면이 나올 수 있습니다.)'
);
    document.getElementById('gate-sign-in').classList.add('hidden');
    document.getElementById('auth-status').textContent = '권한 확인 실패';
  }
}

function connectFirebase(){
  if(!window.firebase || !window.FIREBASE_CONFIG){
    showAuthGate('Firebase 연결 실패','Firebase SDK를 불러오지 못했습니다. 인터넷 연결과 Firebase 설정 파일을 확인해 주세요.');
    document.getElementById('auth-status').textContent = 'Firebase SDK 또는 설정을 사용할 수 없음';
    document.getElementById('btn-sign-in').disabled = true;
    return;
  }
  try{
    const app = firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = app.auth();
    db = app.firestore();

    // Handle redirect result (must be after auth is created)
    auth.getRedirectResult()
      .then(result => {
        // Optional: you can do something when redirect login succeeds
        // if (result.user) { ... }
      })
      .catch(error => {
        document.getElementById('auth-status').textContent = `Google 로그인 실패: ${error.message}`;
        document.getElementById('auth-gate-message').textContent = `Google 로그인을 완료하지 못했습니다. ${error.message}`;
      });

    auth.onAuthStateChanged(handleAuthState, error => {
      showAuthGate('로그인 상태 확인 실패', error.message);
      document.getElementById('auth-status').textContent = '인증 상태 확인 실패';
    });
  }catch(e){
    showAuthGate('Firebase 초기화 실패', e.message);
    document.getElementById('auth-status').textContent = 'Firebase 초기화 실패';
    document.getElementById('btn-sign-in').disabled = true;
  }
}

async function signInWithGoogle(){
  if(!auth) return;
  try{
    document.getElementById('auth-status').textContent = '로그인 창을 여는 중...';
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});   // 항상 계정 선택 화면 표시
    await auth.signInWithPopup(provider);
  }catch(e){
    document.getElementById('auth-status').textContent = `Google 로그인 실패: ${e.code || ''} ${e.message}`;
    document.getElementById('auth-gate-message').textContent = `Google 로그인을 완료하지 못했습니다. ${e.code || ''} ${e.message}`;
  }
}
async function signOut(){
  if(!auth) return;
  try{ await auth.signOut(); }
  catch(e){ document.getElementById('auth-status').textContent = `로그아웃 실패: ${e.message}`; }
}

// 원본 엑셀의 날짜 오타 보정 (이미 저장된 데이터에도 적용됨)
const DATE_FIXES = { 2026: { imp_1:'2026-01-01', imp_80:'2026-01-29' } };

let currentYear = new Date().getFullYear();
let years = [];

async function persistYears(){
  try{ await storageSet(YEARS_KEY, JSON.stringify(years)); return true; }
  catch(e){ lastStorageError = e.message || String(e); return false; }
}
async function loadYears(){
  try{
    const res = await storageGet(YEARS_KEY);
    years = JSON.parse(res.value);
  }catch(e){
    if(e.code !== 'accounting/not-found') throw e;
    years = [2025, 2026, 2027];
    await persistYears();
    if(lastStorageError) throw new Error(`회계연도 초기 저장 실패: ${lastStorageError}`);
  }
  if(!years.includes(currentYear)){
    years.push(currentYear); years.sort((a,b)=>a-b); await persistYears();
  }
}

function applyFixes(list){
  const fixes = DATE_FIXES[currentYear] || {};
  let changed = false;
  list.forEach(t=>{
    if(!t.status){ t.status = t.locked ? 'approved' : 'input-complete'; changed = true; }
    else if(t.status==='pending'){ t.status = 'input-complete'; changed = true; }
    else if(t.status==='paid' || t.status==='confirmed'){ t.status='approved'; changed=true; }
    if(fixes[t.id] && t.date !== fixes[t.id]){ t.date = fixes[t.id]; changed = true; }
  });
  return changed;
}

function setFooter(msg){
  const out = ledger.filter(t => !(t.date||'').startsWith(currentYear + '-')).length;
  document.getElementById('footer-sync').textContent =
`${currentYear}년 · ${msg} · 불러온 내역 ${ledger.length}건` + (out ? ` · ⚠ 회계연도 밖 날짜 ${out}건` : '');}

const entriesRef = year => db.collection('accountingData').doc(ledgerKey(year)).collection('entries');
const ledgerMetaRef = year => db.collection('accountingData').doc('ledger-meta:' + year);
const MIGRATION_LOCK_MS = 120000;
let ledgerUnsubscribe = null;
let ledgerRenderTimer = null;

  const ENTRY_PAGE_SIZE = 70;
let pendingUnsubscribe = null;
let ledgerSources = {recent:new Map(), pending:new Map(), older:new Map()};
// 방금 저장한 로컬 변경(승인 등). 실시간 스냅샷이 예전 상태로 덮어쓰지 못하게 한다.
let localOverrides = new Map();
let olderCursor = null, cursorSet = false, olderHasMore = false, olderLoading = false;
let reportSummary = null, reportMonthCache = {}, reportLoading = false, reportLoadToken = 0;
const SUMMARY_VERSION = 1;
const reportSummaryKey = y => 'report-summary:' + y;
const reportSummaryRef = year => db.collection('accountingData').doc(reportSummaryKey(year));
  let appReady = false;
const APPROVED_STATES = (typeof ShowMeDomain !== 'undefined' && ShowMeDomain.APPROVED_STATES)
  ? ShowMeDomain.APPROVED_STATES.slice()
  : ['approved','paid','confirmed'];

/**
 * 승인 건 변경 후 집계 캐시 무효화 — 한곳만 사용.
 * plan: ShowMeDomain.buildInvalidation / invalidationForEntryChange 결과
 * 또는 { clearSummary, clearAllMonthCaches, dirtyMonthly, months:['1월',...] }
 */
function invalidateReportAggregates(plan){
  const p = plan || { clearSummary:true, clearAllMonthCaches:true, dirtyMonthly:true, months:[] };
  if(p.clearSummary){
    reportSummary = null;
    reportLoadToken++;
  }
  if(p.clearAllMonthCaches){
    reportMonthCache = {};
  }else if(Array.isArray(p.months)){
    p.months.forEach(m=>{ delete reportMonthCache[m]; });
  }
  if(p.dirtyMonthly) monthlyReportDirty = true;
}

async function docMutate(key,def,mutator){
  const ref = db.collection('accountingData').doc(key);
  let out;
  await db.runTransaction(async tx=>{
    const snap = await tx.get(ref);
    const data = snap.exists ? JSON.parse(snap.data().value) : JSON.parse(JSON.stringify(def));
    mutator(data);
    tx.set(ref,{value:JSON.stringify(data),...writeMeta()});
    out = data;
  });
  return out;
}
const fv = id => document.getElementById(id).value.trim();

  // ---------- 기금 회계 ----------
const FUND_KEY = 'fund:data';
const FUND_DEFAULT = {accounts:[],events:[]};
const FUND_TYPES = {
  opening:{label:'기초 잔액',sign:1},
  deposit:{label:'예치(신규·추가)',sign:1},
  interest:{label:'이자',sign:1},
  withdraw:{label:'인출·해지',sign:-1},
  toActivity:{label:'활동비로 전출',sign:-1},
  fromActivity:{label:'활동비에서 입금',sign:1},
  move:{label:'계좌 간 이동',sign:0}
};
let fundData = JSON.parse(JSON.stringify(FUND_DEFAULT));
let fundEditingEventId = '';
let fundShowClosed = false;
  
async function loadFund(){
  try{
    const res = await storageGet(FUND_KEY);
    fundData = JSON.parse(res.value);
    fundData.accounts = fundData.accounts || [];
    fundData.events = fundData.events || [];
  }catch(e){
    if(e.code !== 'accounting/not-found') throw e;
    fundData = JSON.parse(JSON.stringify(FUND_DEFAULT));
  }
}

function fundBalances(upTo='9999-12-31'){
  const bal = {};
  fundData.accounts.forEach(a=>bal[a.id]=0);
  fundData.events.filter(e=>(e.date||'')<=upTo).forEach(e=>{
    const amount = Number(e.amount)||0;
    if(e.type==='move'){
      bal[e.accountId] = (bal[e.accountId]||0) - amount;
      bal[e.toAccountId] = (bal[e.toAccountId]||0) + amount;
    }else if(FUND_TYPES[e.type]){
      bal[e.accountId] = (bal[e.accountId]||0) + FUND_TYPES[e.type].sign*amount;
    }
  });
  return bal;
}

const fundAccountLabel = a => a ? `${a.bank||''} ${a.number||''}`.trim() : '(삭제된 계좌)';

function renderFund(){
  const summary = document.getElementById('fund-summary');
  if(!summary) return;
  const y = String(currentYear);
  const open = fundBalances(`${currentYear-1}-12-31`);
  const close = fundBalances(`${y}-12-31`);
  const sumOf = obj => Object.values(obj).reduce((s,v)=>s+v,0);
  const yearEvents = fundData.events.filter(e=>(e.date||'').startsWith(y+'-'))
    .sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
  const total = type => yearEvents.filter(e=>e.type===type).reduce((s,e)=>s+Number(e.amount||0),0);

  // 요약
  const lines = [
    ['전년도 말 잔액',sumOf(open)],
    ['기초 잔액 입력',total('opening')],
    ['+ 예치(신규·추가)',total('deposit')],
    ['+ 이자',total('interest')],
    ['+ 활동비에서 입금',total('fromActivity')],
    ['− 인출·해지',-total('withdraw')],
    ['− 활동비로 전출',-total('toActivity')]
  ];
  const ending = sumOf(close);
  summary.innerHTML = `<table style="max-width:480px;"><tbody>
    ${lines.map(([label,v])=>`<tr><td style="text-align:left;">${label}</td><td class="num">${fmtShort(v)}</td></tr>`).join('')}
    </tbody><tfoot><tr class="report-total-row"><th style="text-align:left;">${y}년 말 기금 합계</th><td class="num">${fmt(ending)}</td></tr></tfoot></table>
    <p class="count-note">계좌 간 이동은 합계에 영향을 주지 않아 표에 나타나지 않습니다.</p>`;

 // 계좌 표
  const accBox = document.getElementById('fund-accounts');
  const touched = new Set(yearEvents.flatMap(e=>[e.accountId,e.toAccountId]));
  const visible = fundData.accounts.filter(a=>
    fundShowClosed || !a.closed || (open[a.id]||0)!==0 || touched.has(a.id));
  const hiddenCount = fundData.accounts.length - visible.length;
  if(!fundData.accounts.length){
    accBox.innerHTML = '<p class="pending-empty">등록된 계좌가 없습니다. 아래에서 계좌를 추가해 주세요.</p>';
  }else{
    const used = new Set(fundData.events.flatMap(e=>[e.accountId,e.toAccountId]));
    accBox.innerHTML = `<div class="table-scroll"><table style="min-width:700px;">
      <thead><tr><th>계좌</th><th>종류</th><th>금리</th><th>만기</th><th class="num">${y} 기초</th><th class="num">${y} 기말</th><th>비고</th><th></th></tr></thead>
      <tbody>${visible.map(a=>`<tr style="${a.closed?'opacity:.5;':''}">
        <td>${escapeHTML(fundAccountLabel(a))}${a.closed?' (종료)':''}</td>
        <td>${escapeHTML(a.kind||'')}</td>
        <td>${a.rate?escapeHTML(a.rate)+'%':'-'}</td>
        <td>${escapeHTML(a.maturity||'-')}</td>
        <td class="num">${fmtShort(open[a.id]||0)}</td>
        <td class="num" style="${(close[a.id]||0)<0?'color:var(--expense);font-weight:700;':''}">${fmtShort(close[a.id]||0)}</td>
        <td>${escapeHTML(a.note||'')}</td>
        <td><div class="action-row">
          <button class="btn-revert" data-fund-act="toggle-account" data-id="${escapeHTML(a.id)}">${a.closed?'재개':'종료'}</button>
          ${used.has(a.id)?'':`<button class="del-btn" data-fund-act="delete-account" data-id="${escapeHTML(a.id)}">삭제</button>`}
        </div></td></tr>`).join('')}</tbody></table></div>
      ${(hiddenCount>0 || fundShowClosed) && fundData.accounts.some(a=>a.closed)
        ? `<button class="btn-text" id="btn-fund-toggle-closed" type="button" style="margin-top:8px;">${fundShowClosed?'종료된 계좌 숨기기':`종료된 계좌 ${hiddenCount}개 더 보기`}</button>`
        : ''}`;
    const toggleClosed = document.getElementById('btn-fund-toggle-closed');
    if(toggleClosed) toggleClosed.addEventListener('click',()=>{ fundShowClosed = !fundShowClosed; renderFund(); });
  }

  // 거래 입력용 선택 목록
  const typeSel = document.getElementById('fe-type');
  if(!typeSel.options.length){
    typeSel.innerHTML = Object.entries(FUND_TYPES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
    typeSel.value = 'deposit';
  }
  const opts = fundData.accounts.filter(a=>!a.closed)
    .map(a=>`<option value="${escapeHTML(a.id)}">${escapeHTML(fundAccountLabel(a))} (${escapeHTML(a.kind||'')})</option>`).join('');
  ['fe-account','fe-to'].forEach(id=>{
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = opts || '<option value="">계좌를 먼저 추가해 주세요</option>';
    if(prev) sel.value = prev;
  });
  updateFundTypeFields();

  // 거래 목록
  document.getElementById('fund-events').innerHTML = yearEvents.length
    ? yearEvents.map(e=>{
        const acc = fundData.accounts.find(a=>a.id===e.accountId);
        const to = e.type==='move' ? ` → ${escapeHTML(fundAccountLabel(fundData.accounts.find(a=>a.id===e.toAccountId)))}` : '';
        return `<tr>
          <td>${escapeHTML(formatEntryDate(e.date))}</td>
          <td>${escapeHTML(FUND_TYPES[e.type]?.label||e.type)}</td>
          <td>${escapeHTML(fundAccountLabel(acc))}${to}</td>
          <td class="num">${fmtShort(e.amount)}</td>
          <td>${escapeHTML(e.memo||'')}</td>
          <td><div class="action-row">
            <button class="btn-revert" data-fund-act="edit-event" data-id="${escapeHTML(e.id)}">수정</button>
            <button class="del-btn" data-fund-act="delete-event" data-id="${escapeHTML(e.id)}">삭제</button>
          </div></td></tr>`;
      }).join('')
    : '<tr><td colspan="6" class="pending-empty">이 연도의 기금 거래가 없습니다.</td></tr>';
}

function updateFundTypeFields(){
  const isMove = document.getElementById('fe-type').value==='move';
  document.getElementById('fe-to-field').classList.toggle('hidden',!isMove);
  document.getElementById('fe-account-label').textContent = isMove ? '보내는 계좌' : '계좌';
}

async function addFundAccount(){
  const msg = document.getElementById('fund-account-msg');
  const bank = fv('fa-bank'), number = fv('fa-number');
  if(!bank || !number){ msg.textContent = '은행과 계좌번호를 입력해 주세요.'; return; }
  const maturityRaw = fv('fa-maturity');
  const maturity = maturityRaw ? parseEntryDate(maturityRaw) : '';
  if(maturityRaw && !maturity){ msg.textContent = '만기일을 YYYY-MM-DD 형식으로 입력해 주세요.'; return; }
  const account = {
    id:'fa_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    bank, number, kind:document.getElementById('fa-kind').value,
    rate:fv('fa-rate'), maturity, note:fv('fa-note'), closed:false
  };
  try{
    fundData = await docMutate(FUND_KEY,FUND_DEFAULT,d=>{ d.accounts.push(account); });
    ['fa-bank','fa-number','fa-rate','fa-maturity','fa-note'].forEach(id=>document.getElementById(id).value='');
    msg.textContent = '계좌를 추가했습니다.';
    renderFund();
  }catch(e){ msg.textContent = `저장 실패: ${e.message||e}`; }
}

function resetFundEventForm(){
  fundEditingEventId = '';
  ['fe-date','fe-amount','fe-memo'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('btn-fund-save-event').textContent = '거래 추가';
  document.getElementById('btn-fund-cancel-edit').classList.add('hidden');
}

async function saveFundEvent(){
  const msg = document.getElementById('fund-event-msg');
  const date = parseEntryDate(fv('fe-date'));
  const type = fv('fe-type'), accountId = fv('fe-account'), toAccountId = fv('fe-to');
  const amount = Number(fv('fe-amount').replace(/,/g,''));
  if(!date){ msg.textContent = '날짜를 YYYY-MM-DD 형식으로 입력해 주세요.'; return; }
  if(!accountId){ msg.textContent = '계좌를 선택해 주세요.'; return; }
  if(!Number.isInteger(amount) || amount<=0){ msg.textContent = '금액은 0보다 큰 정수로 입력해 주세요.'; return; }
  if(type==='move' && (!toAccountId || toAccountId===accountId)){ msg.textContent = '보내는 계좌와 다른 받는 계좌를 선택해 주세요.'; return; }
  const id = fundEditingEventId || 'fe_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  const event = {id,date,type,accountId,amount,memo:fv('fe-memo'),...(type==='move'?{toAccountId}:{})};
  try{
    fundData = await docMutate(FUND_KEY,FUND_DEFAULT,d=>{
      const i = d.events.findIndex(e=>e.id===id);
      if(i>=0) d.events[i] = event; else d.events.push(event);
    });
    msg.textContent = fundEditingEventId ? '거래를 수정했습니다.' : '거래를 추가했습니다.';
    resetFundEventForm();
    renderFund();
  }catch(e){ msg.textContent = `저장 실패: ${e.message||e}`; }
}

async function handleFundAction(act,id){
  const msg = document.getElementById('fund-event-msg');
  try{
    if(act==='edit-event'){
      const e = fundData.events.find(x=>x.id===id); if(!e) return;
      fundEditingEventId = id;
      document.getElementById('fe-date').value = e.date;
      document.getElementById('fe-type').value = e.type;
      updateFundTypeFields();
      document.getElementById('fe-account').value = e.accountId;
      if(e.toAccountId) document.getElementById('fe-to').value = e.toAccountId;
      document.getElementById('fe-amount').value = e.amount;
      document.getElementById('fe-memo').value = e.memo||'';
      document.getElementById('btn-fund-save-event').textContent = '수정 저장';
      document.getElementById('btn-fund-cancel-edit').classList.remove('hidden');
      msg.textContent = '수정한 뒤 "수정 저장"을 눌러 주세요.';
      document.getElementById('fe-date').scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
    if(act==='delete-event'){
      if(!window.confirm('이 거래를 삭제할까요?')) return;
      fundData = await docMutate(FUND_KEY,FUND_DEFAULT,d=>{ d.events = d.events.filter(e=>e.id!==id); });
     }else if(act==='toggle-account'){
      const target = fundData.accounts.find(a=>a.id===id);
      const balance = fundBalances()[id] || 0;
      if(target && !target.closed && balance!==0 &&
        !window.confirm(`이 계좌에 아직 ${fmt(balance)}이 남아 있습니다. 그래도 종료할까요?\n(해지·갈아타기라면 먼저 "인출·해지" 또는 "계좌 간 이동"을 입력해 잔액을 0으로 만드세요.)`)) return;
      fundData = await docMutate(FUND_KEY,FUND_DEFAULT,d=>{ const a=d.accounts.find(x=>x.id===id); if(a) a.closed=!a.closed; });
    }else if(act==='delete-account'){
      if(!window.confirm('이 계좌를 삭제할까요?')) return;
      fundData = await docMutate(FUND_KEY,FUND_DEFAULT,d=>{
        if(d.events.some(e=>e.accountId===id||e.toAccountId===id)) throw new Error('거래가 있는 계좌는 삭제할 수 없습니다. "종료"를 사용해 주세요.');
        d.accounts = d.accounts.filter(a=>a.id!==id);
      });
    }
    renderFund();

    //만기 갈아타기 입력 순서
    //이자가 붙었으면 옛 계좌에 이자 입력 (예: 38,894원)
    //옛 계좌에서 새 계좌로 계좌 간 이동으로 원금+이자 전액 입력
    //새 계좌의 만기·금리를 계좌 추가에서 등록 (옛 계좌는 종료)
  }catch(e){ msg.textContent = `처리 실패: ${e.message||e}`; }
}

async function compareFundWithActivity(){
  const box = document.getElementById('fund-compare');
  box.textContent = '활동비 집계를 확인하는 중…';
  try{
    if(!reportSummary) await loadReportSummary();
    if(!reportSummary){ box.textContent = '활동비 집계를 불러오지 못했습니다. 보고서 탭을 한 번 열어 주세요.'; return; }
    const fundByMonth = {}, actByMonth = {};
    let fundTotal = 0, actTotal = 0;
    fundData.events.filter(e=>e.type==='toActivity' && (e.date||'').startsWith(currentYear+'-')).forEach(e=>{
      const m = parseInt(e.date.split('-')[1],10)+'월';
      fundByMonth[m] = (fundByMonth[m]||0) + Number(e.amount||0);
      fundTotal += Number(e.amount||0);
    });
    Object.entries(reportSummary.cells).forEach(([key,cell])=>{
      const [month,gubun,,,category] = JSON.parse(key);
      if(gubun==='수입' && category==='기금회계 전입금'){
        actByMonth[month] = (actByMonth[month]||0) + cell.a;
        actTotal += cell.a;
      }
    });
    const months = monthList.filter(m=>fundByMonth[m]||actByMonth[m]);
    const diff = fundTotal-actTotal;
    box.innerHTML = `<table style="max-width:560px;">
      <thead><tr><th>월</th><th class="num">기금 전출</th><th class="num">활동비 전입</th><th class="num">차이</th></tr></thead>
      <tbody>${months.map(m=>`<tr><td>${m}</td><td class="num">${fmtShort(fundByMonth[m]||0)}</td><td class="num">${fmtShort(actByMonth[m]||0)}</td><td class="num">${fmtShort((fundByMonth[m]||0)-(actByMonth[m]||0))}</td></tr>`).join('')||'<tr><td colspan="4">해당 연도에 전출·전입 내역이 없습니다.</td></tr>'}</tbody>
      <tfoot><tr class="report-total-row"><th>합계</th><td class="num">${fmtShort(fundTotal)}</td><td class="num">${fmtShort(actTotal)}</td><td class="num">${fmtShort(diff)}</td></tr></tfoot></table>
      <p class="workflow-summary ${diff===0?'':'warn'}">${diff===0
        ? '일치합니다. 기금 전출과 활동비 전입 합계가 같습니다.'
        : `불일치합니다. 기금 전출이 활동비 전입보다 ${fmt(Math.abs(diff))} ${diff>0?'많습니다 (활동비에 입력이 빠졌거나 아직 승인 전일 수 있습니다).':'적습니다 (기금 쪽 입력이 빠졌을 수 있습니다).'}`}</p>
      <p class="count-note">월별 차이는 활동비 쪽이 <b>승인한 달</b> 기준이라 달이 어긋날 수 있습니다. 연 합계를 기준으로 보세요.</p>`;
  }catch(e){ box.textContent = `대조 실패: ${e.message||e}`; }
}

document.getElementById('btn-fund-add-account').addEventListener('click',addFundAccount);
document.getElementById('btn-fund-save-event').addEventListener('click',saveFundEvent);
document.getElementById('btn-fund-cancel-edit').addEventListener('click',()=>{ resetFundEventForm(); document.getElementById('fund-event-msg').textContent=''; });
document.getElementById('btn-fund-compare').addEventListener('click',compareFundWithActivity);
document.getElementById('fe-type').addEventListener('change',updateFundTypeFields);
document.getElementById('view-fund').addEventListener('click',event=>{
  const button = event.target.closest('[data-fund-act]');
  if(button) handleFundAction(button.dataset.fundAct,button.dataset.id);
});

// ---------- 활동비 단기예치 ----------
const DEPOSITS_KEY = 'activity-deposits:list';
let deposits = [];

async function loadDeposits(){
  try{
    const res = await storageGet(DEPOSITS_KEY);
    deposits = JSON.parse(res.value);
    if(!Array.isArray(deposits)) deposits = [];
  }catch(e){
    if(e.code !== 'accounting/not-found') throw e;
    deposits = [];
  }
}

const activeDepositTotal = () =>
  deposits.filter(d=>d.status==='active').reduce((s,d)=>s+Number(d.amount||0),0);

function renderDeposits(){
  const box = document.getElementById('deposit-list');
  if(!box) return;
  if(!deposits.length){
    box.innerHTML = '<p class="pending-empty">등록된 단기예치가 없습니다.</p>';
    return;
  }
  const sorted = deposits.slice().sort((a,b)=>(a.status===b.status?0:a.status==='active'?-1:1)||(b.date||'').localeCompare(a.date||''));
  box.innerHTML = `<div class="table-scroll"><table style="min-width:620px;">
    <thead><tr><th>상태</th><th>예치일</th><th>만기 예정</th><th class="num">원금</th><th>메모</th><th></th></tr></thead>
    <tbody>${sorted.map(d=>`<tr style="${d.status==='returned'?'opacity:.55;':''}">
      <td>${d.status==='active'?'<b>예치 중</b>':'회수 '+escapeHTML(d.returnDate||'')}</td>
      <td>${escapeHTML(formatEntryDate(d.date))}</td>
      <td>${escapeHTML(d.maturity?formatEntryDate(d.maturity):'-')}</td>
      <td class="num">${fmtShort(d.amount)}</td>
      <td>${escapeHTML(d.memo||'')}</td>
      <td><div class="action-row">
        ${d.status==='active'?`<button class="btn-revert" data-deposit-act="return" data-id="${escapeHTML(d.id)}">회수 처리</button>`:`<button class="btn-revert" data-deposit-act="reopen" data-id="${escapeHTML(d.id)}">되돌리기</button>`}
        <button class="del-btn" data-deposit-act="delete" data-id="${escapeHTML(d.id)}">삭제</button>
      </div></td></tr>`).join('')}</tbody></table></div>`;
}

async function addDeposit(){
  const msg = document.getElementById('deposit-msg');
  const date = parseEntryDate(fv('dp-date'));
  const amount = Number(fv('dp-amount').replace(/,/g,''));
  const maturityRaw = fv('dp-maturity');
  const maturity = maturityRaw ? parseEntryDate(maturityRaw) : '';
  if(!date){ msg.textContent = '예치일을 YYYY-MM-DD 형식으로 입력해 주세요.'; return; }
  if(!Number.isInteger(amount) || amount<=0){ msg.textContent = '원금은 0보다 큰 정수로 입력해 주세요.'; return; }
  if(maturityRaw && !maturity){ msg.textContent = '만기 예정일 형식이 올바르지 않습니다.'; return; }
  const item = {id:'dp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),date,amount,maturity,memo:fv('dp-memo'),status:'active'};
  try{
    deposits = await docMutate(DEPOSITS_KEY,[],list=>{ list.push(item); });
    ['dp-date','dp-amount','dp-maturity','dp-memo'].forEach(id=>document.getElementById(id).value='');
    msg.textContent = '예치를 등록했습니다. 잔액 대조에 반영됩니다.';
    renderReport();
  }catch(e){ msg.textContent = `저장 실패: ${e.message||e}`; }
}

async function handleDepositAction(act,id){
  const msg = document.getElementById('deposit-msg');
  if(act==='delete' && !window.confirm('이 예치 기록을 삭제할까요?')) return;
  try{
    deposits = await docMutate(DEPOSITS_KEY,[],list=>{
      const i = list.findIndex(d=>d.id===id);
      if(i<0) return;
      if(act==='delete') list.splice(i,1);
      else if(act==='return'){ list[i].status='returned'; list[i].returnDate=new Date().toISOString().slice(0,10); }
      else if(act==='reopen'){ list[i].status='active'; delete list[i].returnDate; }
    });
    msg.textContent = act==='return' ? '회수 처리했습니다. 붙은 이자는 결산 관리에 이자수입으로 입력해 주세요.' : '';
    renderReport();
  }catch(e){ msg.textContent = `처리 실패: ${e.message||e}`; }
}

document.getElementById('btn-add-deposit').addEventListener('click',addDeposit);
document.getElementById('deposit-box').addEventListener('click',event=>{
  const button = event.target.closest('[data-deposit-act]');
  if(button) handleDepositAction(button.dataset.depositAct,button.dataset.id);
});


  
function stopLedgerWatcher(){
  if(ledgerUnsubscribe){ ledgerUnsubscribe(); ledgerUnsubscribe = null; }
  if(pendingUnsubscribe){ pendingUnsubscribe(); pendingUnsubscribe = null; }
}

function scheduleLedgerRender(){
  clearTimeout(ledgerRenderTimer);
  ledgerRenderTimer = setTimeout(()=>{ renderEntryView(); },150);   // 보고서는 실시간 갱신하지 않음
}

function rebuildLedger(){
  const map = new Map();
  [ledgerSources.older, ledgerSources.pending, ledgerSources.recent]
    .forEach(source=>source.forEach((entry,id)=>map.set(id,entry)));
  // 로컬에서 방금 확정한 변경이 스냅샷보다 우선한다 (승인 직후 결의완료로 되돌아가는 현상 방지)
  localOverrides.forEach((entry,id)=>map.set(id, entry));
  ledger = [...map.values()].sort(compareEntries);
}

function watchLedgerQuery(query, year, onData){
  let first = true, unsub = null;
  const ready = new Promise((resolve,reject)=>{
    unsub = query.onSnapshot(snapshot=>{
      if(year!==currentYear) return;
      onData(snapshot);
      if(first){ first = false; resolve(); return; }
      setFooter('실시간 동기화');
      scheduleLedgerRender();
    },error=>{
      if(first){ first = false; reject(error); return; }
      document.getElementById('auth-status').textContent = `장부 실시간 동기화 오류: ${error.message}`;
    });
  });
  return {unsub:()=>unsub(), ready};
}


// Firestore returns docs sorted by id ("imp_1","imp_10","imp_100"...), so restore the natural order.
function entryOrder(entry){
  const match = /^imp_(\d+)$/.exec(entry.id || '');
  if(match) return [0,Number(match[1]),''];
  return [1,Date.parse(entry.createdAt || '') || 0,entry.id || ''];
}
function compareEntries(a,b){
  const x = entryOrder(a), y = entryOrder(b);
  return x[0]-y[0] || x[1]-y[1] || String(x[2]).localeCompare(String(y[2]));
}

// ---------- one-time migration: legacy single document -> one document per entry ----------
async function claimMigration(year){
  const ref = ledgerMetaRef(year);
  return db.runTransaction(async transaction=>{
    const snapshot = await transaction.get(ref);
    if(snapshot.exists){
      let meta = {};
      try{ meta = JSON.parse(snapshot.data().value); }catch(e){}
      if(meta.status==='done') return 'done';
      if(meta.status==='migrating' && Date.now()-(meta.startedAtMs||0) < MIGRATION_LOCK_MS) return 'busy';
    }
    transaction.set(ref,{value:JSON.stringify({status:'migrating',startedAtMs:Date.now()}),...writeMeta()});
    return 'claimed';
  });
}

async function readLegacyLedger(year){
  const snapshot = await db.collection('accountingData').doc(ledgerKey(year)).get();
  if(snapshot.exists){
    const list = JSON.parse(snapshot.data().value);
    if(!Array.isArray(list)) throw new Error(`${year}년 기존 장부 형식이 올바르지 않습니다.`);
    return {list,source:'legacy'};
  }
  if(year===2026) return {list:BASE_LEDGER.map(entry=>({...entry})),source:'base'};
  return {list:[],source:'empty'};
}

async function ensureLedgerMigrated(year){
  for(let attempt=0; attempt<40; attempt++){
    const state = await claimMigration(year);
    if(state==='done') return;
    if(state==='claimed'){
      try{
        const {list,source} = await readLegacyLedger(year);
        const seen = new Set();
        list.forEach(entry=>{
          if(!entry || typeof entry.id!=='string' || !entry.id || entry.id.includes('/')){
            throw new Error('장부에 올바르지 않은 id가 있어 이전을 중단했습니다.');
          }
          if(seen.has(entry.id)) throw new Error(`장부에 중복된 id가 있어 이전을 중단했습니다: ${entry.id}`);
          seen.add(entry.id);
        });
        const col = entriesRef(year);
        for(let i=0;i<list.length;i+=400){            // batch limit is 500 writes
          const batch = db.batch();
          list.slice(i,i+400).forEach(entry=>batch.set(col.doc(entry.id),entry));
          await batch.commit();
        }
        const check = await col.get();
        if(check.size!==list.length){
          throw new Error(`이전 검증 실패: 원본 ${list.length}건, 이전된 문서 ${check.size}건`);
        }
        await ledgerMetaRef(year).set({
          value:JSON.stringify({status:'done',count:list.length,source,migratedAt:new Date().toISOString()}),
          ...writeMeta()
        });
        return;
      }catch(error){
        await ledgerMetaRef(year).set({
          value:JSON.stringify({status:'failed',message:error.message || String(error)}),...writeMeta()
        }).catch(()=>{});
        throw error;
      }
    }
    document.getElementById('auth-status').textContent = '다른 담당자가 장부를 이전하는 중입니다…';
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  throw new Error('장부 이전이 오래 걸리고 있습니다. 잠시 후 새로고침해 주세요.');
}

// 승인 시각 → 회계월. 한국 시간 기준 연/월
function acctPeriod(date=new Date()){
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(date);
  return {year:Number(p.find(x=>x.type==='year').value), month:Number(p.find(x=>x.type==='month').value)};
}
const entryAcctMonth = t => APPROVED_STATES.includes(t.status) ? (t.acctMonth ?? monthNo(t.month)) : null;
// 거래 결제일 기준 월 (마감 시 전체 내역·결의 대기 숨김에 사용)
const entryTxnMonth = t => {
  const fromMonth = monthNo(t.month);
  if(fromMonth) return fromMonth;
  const d = String(t.date || '');
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if(iso) return parseInt(iso[2], 10) || 0;
  const kor = /(\d{1,2})\s*월/.exec(d);
  if(kor) return parseInt(kor[1], 10) || 0;
  return 0;
};
// 마감된 달의 승인 건인지 — 결산(전체 내역)에서는 거래월(결제일) 우선
// (승인일이 10월이어도 1월 거래는 1월 마감 시 목록에서 숨김)
const isClosedApproved = t => {
  if(!APPROVED_STATES.includes(t.status) || !closedThrough) return false;
  const txn = entryTxnMonth(t);
  if(txn > 0) return txn <= closedThrough;
  const acct = entryAcctMonth(t) ?? 0;
  return acct > 0 && acct <= closedThrough;
};
// 마감된 달의 미승인(입력완료·결의완료) 건인지
const isClosedOpenItem = t => {
  if(APPROVED_STATES.includes(t.status) || !closedThrough) return false;
  const txn = entryTxnMonth(t);
  return txn > 0 && txn <= closedThrough;
};

// 번호 명칭: 마감된 내역은 '승인번호', 마감되기 전 내역은 '결의번호'
const mgmtNoLabel = t => isClosedApproved(t) ? '승인번호' : '결의번호';
const mgmtNoLabelForMonth = m => '승인번호';

async function loadBudget(){
  try{
    const res = await storageGet(budgetKey(currentYear));
    budget = JSON.parse(res.value);
  }catch(e){
    if(e.code !== 'accounting/not-found') throw e;
    budget = {};
  }
}

async function loadAccountBalance(){
  try{
    const res = await storageGet(accountBalanceKey(currentYear));
    const amount = JSON.parse(res.value);
    if(!Number.isSafeInteger(amount) || amount<0){
      throw new Error('저장된 활동비 계좌 잔액이 올바른 숫자가 아닙니다.');
    }
    accountBalance = amount;
  }catch(e){
    if(e.code !== 'accounting/not-found') throw e;
    accountBalance = null;
  }
}

async function loadClosure(){
  try{
    const res = await storageGet(closureKey(currentYear));
    const n = JSON.parse(res.value).closedThrough;
    closedThrough = Number.isInteger(n) && n>=0 && n<=12 ? n : 0;
  }catch(e){
    if(e.code !== 'accounting/not-found') throw e;
    closedThrough = 0;
  }
}

// 마감된 달 이후 날짜만 읽는 쿼리 (읽기 절감의 핵심)
function entryListQuery(year){
  return entriesRef(year).orderBy('date','desc');
}
  
function normalizeLedgerSuffixes(list=ledger){
  let changed = false;
  list.forEach(entry=>{
    const gwan = typeof entry.gwan==='string' ? normalizeCategoryName(entry.gwan,'_관') : entry.gwan;
    const hang = typeof entry.hang==='string' ? normalizeCategoryName(entry.hang,'_항') : entry.hang;
    if(gwan!==entry.gwan || hang!==entry.hang){ entry.gwan=gwan; entry.hang=hang; changed=true; }
  });
  return changed;
}

function normalizeStaffNames(names){
  return [...new Set(names.map(name=>name.trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'ko'));
}

function normalizeStaffBankDetails(details){
  if(!Array.isArray(details) || !details.every(detail=>
    detail && typeof detail.name==='string' &&
    typeof detail.bank==='string' &&
    typeof detail.accountNumber==='string'
  )){
    throw new Error('저장된 담당자 은행 정보가 올바르지 않습니다.');
  }
  const byName = new Map();
  details.forEach(detail=>{
    const name = detail.name.trim();
    if(name) byName.set(name,{
      name,
      bank:detail.bank.trim(),
      accountNumber:detail.accountNumber.trim()
    });
  });
  return [...byName.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
}

function normalizeStaffGroups(map){
  const result = {};
  if(map && typeof map==='object' && !Array.isArray(map)){
    Object.keys(map).forEach(name=>{
      const key = name.trim();
      if(key && STAFF_GROUP_OPTIONS.includes(map[name])) result[key] = map[name];
    });
  }
  return result;
}

/**
 * 1. 담당자 이름 만능 파서
 * JSON 형태든 일반 텍스트(띄어쓰기, 줄바꿈, 쉼표)든 구분하여 배열로 변환
 */
function parseStaffNames(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return [];
  const trimmed = rawValue.trim();
  if (!trimmed) return [];

  // JSON 배열 시도
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(n => String(n).trim()).filter(Boolean);
      }
    } catch (e) {
      // JSON 파싱 실패 시 아래 텍스트 분할로 진행
    }
  }

  // 쉼표, 줄바꿈, 공백(띄어쓰기) 기준으로 이름 추출
  return trimmed
    .split(/[\s,\n]+/)
    .map(name => name.trim())
    .filter(name => name.length > 0);
}

/**
 * 담당자 이름 목록 로드 (장부 데이터와 자동 합성 및 안전 예외 처리)
 */
async function loadStaffNames() {
  const fromLedger = [...BASE_LEDGER, ...ledger].map(entry => entry.spender || '');

  try {
    const res = await storageGet(STAFF_NAMES_KEY);
    const savedNames = parseStaffNames(res.value);

    // 저장된 이름 + 거래 내역에 있던 담당자 합쳐서 복원
    staffNames = normalizeStaffNames([...savedNames, ...fromLedger]);
  } catch (e) {
    // 키가 없거나 에러가 나더라도 앱이 멈추지 않고 장부 데이터 기반으로 복구
    if (e.code !== 'accounting/not-found') {
      console.warn('담당자 목록 불러오기 중 경고 (기본 장부 데이터로 대체):', e);
    }
    staffNames = normalizeStaffNames(fromLedger);
  }
}

/**
 * 2. 담당자 은행/계좌 정보 만능 파서 (은행명 자유 수정 가능)
 * - JSON 구조 지원
 * - 엑셀/메모장 복사 텍스트 지원 (탭, 쉼표, 공백 구분)
 * - 은행명 띄어쓰기(예: 카카오 뱅크, NH 농협) 및 자유로운 변경 가능
 */
function parseStaffBankDetails(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return [];
  const trimmed = rawValue.trim();
  if (!trimmed) return [];

  // 1. JSON 형식 시도
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeStaffBankDetails(parsed);
    } catch (e) {
      // JSON 해석 실패 시 아래 텍스트 파싱으로 자동 전환
    }
  }

  // 2. 텍스트/엑셀 데이터 파싱 (줄바꿈 기준)
  const lines = trimmed.split('\n');
  const details = [];

  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    let name = '', bank = '', accountNumber = '';

    // A. 쉼표(,)나 탭(\t) 구분이 명확한 경우
    if (cleanLine.includes(',') || cleanLine.includes('\t')) {
      const parts = cleanLine.split(/[\t,]+/).map(p => p.trim());
      name = parts[0] || '';
      bank = parts[1] || '';
      accountNumber = parts[2] || '';
    } 
    // B. 공백(띄어쓰기)으로 구분된 경우 (은행명 자유 수정 대응)
    else {
      const parts = cleanLine.split(/\s+/);
      if (parts.length >= 2) {
        name = parts[0];
        // 마지막 요소는 계좌번호(숫자/하이픈)일 확률이 높음
        accountNumber = parts[parts.length - 1];
        // 중간에 있는 모든 글자를 은행명으로 합침 (예: "NH 농협", "우리 은행")
        bank = parts.slice(1, parts.length - 1).join(' ') || '기타';
      } else {
        name = parts[0];
      }
    }

    if (name) {
      details.push({
        name: name,
        bank: bank || '미지정',
        accountNumber: accountNumber || ''
      });
    }
  }

  return normalizeStaffBankDetails(details);
}

/**
 * 담당자 계좌 정보 로드
 */
async function loadStaffBankDetails() {
  try {
    const res = await storageGet(STAFF_BANK_DETAILS_KEY);
    staffBankDetails = parseStaffBankDetails(res ? res.value : '');
 } catch (e) {
    console.warn("계좌 정보 로드 예외 처리됨:", e);
    staffBankDetails = [];
  }
}


  
/**
 * 담당자 구분(집행부/대의원) 로드
 * 저장된 구분 데이터가 아직 없으면 data.json의 staffRoster로 한 번만 초기 등록합니다.
 */
async function loadStaffGroups() {
  try {
    const res = await storageGet(STAFF_GROUPS_KEY);
    staffGroups = normalizeStaffGroups(JSON.parse(res.value));
  } catch (e) {
    if (e.code !== 'accounting/not-found') {
      console.warn('담당자 구분 불러오기 중 경고:', e);
      staffGroups = {};
      return;
    }
    staffGroups = {};
    const roster = APP_DATA.staffRoster || {};
    STAFF_GROUP_OPTIONS.forEach(group=>{
      (Array.isArray(roster[group]) ? roster[group] : []).forEach(name=>{
        const n = String(name).trim();
        if(n) staffGroups[n] = group;
      });
    });
    if(!Object.keys(staffGroups).length) return;
    const previousNames = staffNames;
    staffNames = normalizeStaffNames([...staffNames,...Object.keys(staffGroups)]);
    try {
      await storageSetMany([
        [STAFF_NAMES_KEY,JSON.stringify(staffNames)],
        [STAFF_GROUPS_KEY,JSON.stringify(staffGroups)]
      ]);
    } catch (err) {
      console.warn('담당자 구분 초기 저장 실패:', err);
      staffNames = previousNames;
    }
  }
}

function staffGroupRank(name){
  const i = STAFF_GROUP_OPTIONS.indexOf(staffGroups[name]);
  if(i < 0) return STAFF_GROUP_OPTIONS.length;      // 미지정은 항상 마지막
  return staffSortMode==='delegate-first' ? STAFF_GROUP_OPTIONS.length - 1 - i : i;
}

function sortedStaffNames(names){
  const byName = (x,y)=>x.localeCompare(y,'ko');
  if(staffSortMode==='name') return [...names].sort(byName);
  return [...names].sort((x,y)=>staffGroupRank(x)-staffGroupRank(y) || byName(x,y));
}

/* ===== 우리은행 다계좌이체 ===== */
function isWooriBank(bank){
  const b = String(bank||'').replace(/\s+/g,'').toLowerCase();
  return b.includes('우리') || b.includes('woori');
}

function parseTransferAmount(value){
  const digits = String(value||'').replace(/[,\s원]/g,'');
  if(!/^\d+$/.test(digits)) return 0;
  const n = parseInt(digits,10);
  return Number.isSafeInteger(n) ? n : 0;
}

function transferCandidates(){
  const rows = [];
  staffNames.forEach(name=>{
    const d = staffBankDetails.find(x=>x.name===name);
    if(d && isWooriBank(d.bank) && d.accountNumber) rows.push({name,account:d.accountNumber,group:staffGroups[name]||''});
  });
  return rows;
}

function visibleTransferRows(){
  const byName = new Map(transferCandidates().map(r=>[r.name,r]));
  return sortedStaffNames([...byName.keys()])
    .map(name=>byName.get(name))
    .filter(r=>transferState.group==='전체' || (r.group||'미지정')===transferState.group);
}

function updateTransferSummary(){
  const el = document.getElementById('transfer-summary');
  if(!el) return;
  const rows = visibleTransferRows().filter(r=>!transferState.skip.has(r.name));
  const total = rows.reduce((sum,r)=>sum + parseTransferAmount(transferState.amounts[r.name]),0);
  const excluded = staffNames.length - transferCandidates().length;
  el.textContent = `선택 ${rows.length}명 · 합계 ${fmt(total)}` + (excluded>0 ? ` (우리은행 계좌가 아니거나 계좌번호가 없는 ${excluded}명은 제외)` : '');
}

function renderTransferSection(){
  const list = document.getElementById('transfer-list');
  if(!list) return;
  const filter = document.getElementById('transfer-group-filter');
  if(filter && filter.value!==transferState.group) filter.value = transferState.group;
  const sel = document.getElementById('staff-sort-select');
  if(sel && sel.value!==staffSortMode) sel.value = staffSortMode;
  list.replaceChildren();
  const rows = visibleTransferRows();
  if(!rows.length){
    const empty = document.createElement('p');
    empty.className = 'pending-empty';
    empty.textContent = '표시할 우리은행 계좌 담당자가 없습니다. 위 목록에서 은행(우리은행)과 계좌번호를 저장해 주세요.';
    list.appendChild(empty);
    updateTransferSummary();
    return;
  }
  const table = document.createElement('table');
  table.className = 'staff-table transfer-table';
  table.innerHTML = `<thead><tr>
    <th style="width:10%">선택</th>
    <th style="width:16%">구분</th>
    <th style="width:20%">이름</th>
    <th style="width:30%">계좌번호</th>
    <th class="num" style="width:24%">금액(원)</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.dataset.transferRow = r.name;
    const amount = transferState.amounts[r.name] || '';
    tr.innerHTML = `
      <td><input type="checkbox" data-transfer-check="${escapeHTML(r.name)}"${transferState.skip.has(r.name)?'':' checked'} aria-label="${escapeHTML(r.name)} 선택"></td>
      <td>${escapeHTML(r.group || '미지정')}</td>
      <td class="staff-name-cell">${escapeHTML(r.name)}</td>
      <td>${escapeHTML(r.account)}</td>
      <td class="num"><input type="text" data-transfer-amount="${escapeHTML(r.name)}" value="${escapeHTML(amount)}" inputmode="numeric" placeholder="금액" autocomplete="off" aria-label="${escapeHTML(r.name)} 이체 금액"></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  list.appendChild(table);
  updateTransferSummary();
}

function downloadTransferFile(){
  const status = document.getElementById('transfer-status');
  if(typeof XLSX==='undefined'){
    status.textContent = '엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';
    return;
  }
  const rows = visibleTransferRows().filter(r=>!transferState.skip.has(r.name));
  if(!rows.length){ status.textContent = '이체할 담당자를 선택해 주세요.'; return; }
  const missing = rows.filter(r=>!parseTransferAmount(transferState.amounts[r.name]));
  if(missing.length){
    status.textContent = `금액이 없거나 올바르지 않은 담당자: ${missing.map(r=>r.name).join(', ')}`;
    return;
  }
  const recvMemo = transferState.recvMemo.trim();
  const myMemo = transferState.myMemo.trim();
  const ws = {};
  rows.forEach((r,i)=>{
    const values = ['우리은행', r.account, String(parseTransferAmount(transferState.amounts[r.name])), recvMemo, myMemo];
    values.forEach((v,j)=>{
      ws[XLSX.utils.encode_cell({r:i,c:j})] = {t:'s', v, z:j>=2?'@':'General'};
    });
  });
  ws['!ref'] = `A1:E${rows.length}`;
  ws['!cols'] = [{wch:12},{wch:22},{wch:12},{wch:16},{wch:16}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Sheet1');
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  try{
    XLSX.writeFile(wb,`다계좌이체_${stamp}.xls`,{bookType:'biff8'});
    const total = rows.reduce((sum,r)=>sum + parseTransferAmount(transferState.amounts[r.name]),0);
    status.textContent = `${rows.length}명, 합계 ${fmt(total)} 이체 파일을 만들었습니다.`;
  }catch(e){
    status.textContent = `파일 생성 실패: ${e.message || String(e)}`;
  }
}

function renderStaffNames(){
  const datalist = document.getElementById('staff-name-options');
  const list = document.getElementById('staff-name-list');
  if(!datalist || !list) return;
  renderRecentEntryOptions();
  renderTransferSection();
  list.replaceChildren();
  if(!staffNames.length){
    const empty = document.createElement('p');
    empty.className = 'pending-empty';
    empty.textContent = '등록된 담당자가 없습니다.';
    list.appendChild(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'staff-table';
  table.innerHTML = `<thead><tr>
    <th style="width:12%">구분</th>
    <th style="width:15%">이름</th>
    <th style="width:19%">은행</th>
    <th style="width:28%">계좌번호</th>
    <th style="width:13%">저장</th>
    <th style="width:13%">삭제</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  sortedStaffNames(staffNames).forEach((name,index)=>{
    const details = staffBankDetails.find(detail=>detail.name===name) || {bank:'',accountNumber:''};
    const tr = document.createElement('tr');
    tr.dataset.staffRow = name;
    const group = staffGroups[name] || '';
    const groupOptions = ['',...STAFF_GROUP_OPTIONS].map(g=>`<option value="${g}"${g===group?' selected':''}>${g||'미지정'}</option>`).join('');
    tr.innerHTML = `
      <td><select data-staff-field="group" aria-label="${escapeHTML(name)} 구분">${groupOptions}</select></td>
      <td class="staff-name-cell">${escapeHTML(name)}</td>
      <td><input type="text" data-staff-field="bank" value="${escapeHTML(details.bank)}" placeholder="은행명" autocomplete="off" aria-label="${escapeHTML(name)} 은행"></td>
      <td><input type="text" data-staff-field="accountNumber" value="${escapeHTML(details.accountNumber)}" placeholder="계좌번호" inputmode="numeric" autocomplete="off" aria-label="${escapeHTML(name)} 계좌번호"></td>
      <td class="staff-actions"><button type="button" class="btn-primary" data-save-staff-profile="${escapeHTML(name)}">저장</button></td>
      <td class="staff-actions"><button type="button" class="del-btn" data-staff-name="${escapeHTML(name)}">삭제</button></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  list.appendChild(table);
}

async function saveStaffNames(){
  await storageSet(STAFF_NAMES_KEY,JSON.stringify(staffNames));
}

async function addStaffName(){
  const input = document.getElementById('staff-name-input');
  const status = document.getElementById('staff-name-status');
  const name = input.value.trim();
  if(!name){
    status.textContent = '담당자 이름을 입력해 주세요.';
    return;
  }
  if(staffNames.includes(name)){
    status.textContent = '이미 등록된 이름입니다.';
    return;
  }
  const groupSelect = document.getElementById('staff-group-input');
  const group = groupSelect ? groupSelect.value : '';
  const previousNames = staffNames;
  const previousGroups = staffGroups;
  staffNames = normalizeStaffNames([...staffNames,name]);
  staffGroups = {...staffGroups};
  if(group) staffGroups[name] = group;
  try{
    await storageSetMany([
      [STAFF_NAMES_KEY,JSON.stringify(staffNames)],
      [STAFF_GROUPS_KEY,JSON.stringify(staffGroups)]
    ]);
    input.value = '';
    status.textContent = `${name} 담당자를 추가했습니다.${group ? ' (' + group + ')' : ''}`;
    renderStaffNames();
  }catch(e){
    staffNames = previousNames;
    staffGroups = previousGroups;
    renderStaffNames();
    status.textContent = `담당자 저장 실패: ${e.message || String(e)}`;
  }
}

async function removeStaffName(name){
  const status = document.getElementById('staff-name-status');
  const previousNames = staffNames;
  const previousBankDetails = staffBankDetails;
  const previousGroups = staffGroups;
  staffNames = staffNames.filter(item=>item!==name);
  staffBankDetails = staffBankDetails.filter(detail=>detail.name!==name);
  staffGroups = {...staffGroups};
  delete staffGroups[name];
  try{
    const entries = [
      [STAFF_NAMES_KEY,JSON.stringify(staffNames)],
      [STAFF_GROUPS_KEY,JSON.stringify(staffGroups)]
    ];
    if(previousBankDetails.length!==staffBankDetails.length){
      entries.push([STAFF_BANK_DETAILS_KEY,JSON.stringify(staffBankDetails)]);
    }
    await storageSetMany(entries);
    status.textContent = `${name} 담당자와 등록된 계좌 정보를 삭제했습니다. 기존 거래 내역은 변경되지 않습니다.`;
    renderStaffNames();
  }catch(e){
    staffNames = previousNames;
    staffBankDetails = previousBankDetails;
    staffGroups = previousGroups;
    renderStaffNames();
    status.textContent = `담당자 저장 실패: ${e.message || String(e)}`;
  }
}

async function saveStaffBankDetails(name){
  const status = document.getElementById('staff-name-status');
  const row = [...document.querySelectorAll('tr[data-staff-row]')].find(r=>r.dataset.staffRow===name);
  if(!row) return;
  const bank = row.querySelector('[data-staff-field="bank"]')?.value.trim() || '';
  const accountNumber = row.querySelector('[data-staff-field="accountNumber"]')?.value.trim() || '';
  const group = row.querySelector('[data-staff-field="group"]')?.value || '';
  const previousDetails = staffBankDetails;
  const previousGroups = staffGroups;
  staffBankDetails = staffBankDetails.filter(detail=>detail.name!==name);
  if(bank || accountNumber) staffBankDetails = normalizeStaffBankDetails([...staffBankDetails,{name,bank,accountNumber}]);
  staffGroups = {...staffGroups};
  if(group) staffGroups[name] = group; else delete staffGroups[name];
  try{
    await storageSetMany([
      [STAFF_BANK_DETAILS_KEY,JSON.stringify(staffBankDetails)],
      [STAFF_GROUPS_KEY,JSON.stringify(staffGroups)]
    ]);
    status.textContent = `${name} 담당자의 구분(${group || '미지정'})과 은행·계좌 정보를 저장했습니다.`;
    renderStaffNames();
  }catch(e){
    staffBankDetails = previousDetails;
    staffGroups = previousGroups;
    renderStaffNames();
    status.textContent = `계좌 정보 저장 실패: ${e.message || String(e)}`;
  }
}

function renderAccountBalanceCheck(calculatedBalance){
  renderDeposits();
  const input = document.getElementById('account-balance-input');
  const calculated = document.getElementById('account-balance-calculated');
  const difference = document.getElementById('account-balance-difference');
  const result = document.getElementById('account-balance-result');
  const parkedEl = document.getElementById('account-balance-parked');
  const parked = activeDepositTotal();
  if(document.activeElement!==input){
    input.value = accountBalance===null ? '' : formatBudgetAmount(accountBalance);
  }
  parkedEl.textContent = fmt(parked);
  calculated.textContent = fmt(calculatedBalance);
  result.classList.remove('match','mismatch','unset');
  if(accountBalance===null){
    difference.textContent = '-';
    result.classList.add('unset');
    result.textContent = '실제 입출금통장 잔액을 입력하고 저장해 주세요.';
    return;
  }
  const actual = accountBalance + parked;           // 통장 잔액 + 예치 중 원금
  const delta = actual - calculatedBalance;
  difference.textContent = `${delta>0?'+':''}${fmt(delta)}`;
  if(delta===0){
    result.classList.add('match');
    result.textContent = parked
      ? `일치합니다. 통장 잔액과 예치 중인 원금(${fmt(parked)})의 합이 계산된 잔액과 같습니다.`
      : '일치합니다. 실제 계좌 잔액과 계산된 잔액이 같습니다.';
  }else{
    result.classList.add('mismatch');
    result.textContent = `불일치합니다. 통장 잔액 + 예치 원금이 계산된 잔액보다 ${fmt(Math.abs(delta))} ${delta>0?'많습니다.':'적습니다.'}`;
  }
}

  
async function saveAccountBalance(){
  const input = document.getElementById('account-balance-input');
  const status = document.getElementById('account-balance-save-status');
  if(!input.value.trim()){
    status.textContent = '실제 활동비 계좌 잔액을 입력해 주세요.';
    return;
  }
  const amount = parseBudgetAmount(input.value);
  if(!Number.isSafeInteger(amount) || amount<0){
    status.textContent = '0 이상의 원 단위 정수로 입력해 주세요.';
    return;
  }
  try{
    await storageSet(accountBalanceKey(currentYear),JSON.stringify(amount));
    accountBalance = amount;
    renderReport();
    status.textContent = '활동비 계좌 잔액을 저장했습니다.';
  }catch(e){
    status.textContent = `잔액 저장 실패: ${e.message || String(e)}`;
  }
}

async function loadAccountCategories(){
  categoriesNeedMigration = false;
  budgetNeedsMigration = false;
  try{
    const res = await storageGet(categoryKey(currentYear));
    const saved = JSON.parse(res.value);
    if(saved.schemaVersion===CATEGORY_SCHEMA_VERSION &&
      Array.isArray(saved.income) && saved.income.every(group=>group && typeof group==='object' && Array.isArray(group.accounts))){
      accountCategories = {
        income: saved.income,
        expense: Array.isArray(saved.expense) ? saved.expense : []
      };
    } else {
      accountCategories = createDefaultAccountCategories();
      remapBudgetForCategoryReset();
      categoriesNeedMigration = true;
    }
  }catch(e){
    if(e.code !== 'accounting/not-found') throw e;
    accountCategories = createDefaultAccountCategories();
    remapBudgetForCategoryReset();
    categoriesNeedMigration = true;
  }
}

function remapBudgetForCategoryReset(){
  const before = JSON.stringify(budget);
  const targets = new Map();
  ['income','expense'].forEach(type=>{
    accountCategories[type].forEach(group=>{
      group.accounts.forEach(account=>{
        account.items.forEach(mok=>{
          const key = mokBudgetKey(type,normalizeCategoryName(group.name,'_관'),normalizeCategoryName(account.name,'_항'),mok);
          const lookup = `${type}\u0000${mok}`;
          if(!targets.has(lookup)) targets.set(lookup,[]);
          targets.get(lookup).push(key);
        });
      });
    });
  });
  const remapped = {};
  Object.entries(budget).forEach(([key,amount])=>{
    if(!key.startsWith('mok:')){
      remapped[key] = amount;
      return;
    }
    let parts;
    try{ parts=JSON.parse(key.slice(4)); }catch(error){ remapped[key]=amount; return; }
    if(parts.length!==4){ remapped[key]=amount; return; }
    const [type,oldGwan,oldHang,mok] = parts;
    if(mok==='대학노조회비') return;
    const targetKeys = targets.get(`${type}\u0000${mok}`) || [];
    if(!targetKeys.length){ remapped[key]=amount; return; }
    const exact = mokBudgetKey(type,normalizeCategoryName(oldGwan,'_관'),normalizeCategoryName(oldHang,'_항'),mok);
    const targetKey = targetKeys.includes(exact) ? exact : targetKeys.length===1 ? targetKeys[0] : null;
    if(!targetKey){ remapped[key]=amount; return; }
    remapped[targetKey] = (Number(remapped[targetKey])||0) + (Number(amount)||0);
  });
  budget = remapped;
  budgetNeedsMigration = before!==JSON.stringify(budget);
}

function reconcileLedgerClassifications(list=ledger){  
  let changed = false;
  list.forEach(entry=>{        
    const type = entry.gubun==='수입' ? 'income' : 'expense';
    const matches = accountCategories[type].flatMap(group=>
      group.accounts.flatMap(account=>account.items.map(mok=>({group,account,mok})))
    ).filter(candidate=>candidate.mok===entry.category);
    if(matches.length!==1) return;
    const [{group,account}] = matches;
    const gwan = normalizeCategoryName(group.name,'_관');
    const hang = normalizeCategoryName(account.name,'_항');
    if(entry.gwan!==gwan || entry.hang!==hang){
      entry.gwan=gwan;
      entry.hang=hang;
      changed=true;
    }
  });
  return changed;
}

function mokBudgetKey(type, gwan, hang, mok){
  return 'mok:' + JSON.stringify([type,gwan,hang,mok]);
}

function formatBudgetAmount(value){
  const amount = Number(value) || 0;
  return Math.trunc(amount).toLocaleString('en-US');
}

function parseBudgetAmount(value){
  const raw = String(value).replace(/,/g,'').trim();
  if(!raw) return 0;
  if(!/^\d+$/.test(raw)) return NaN;
  return Number(raw);
}

function formatBudgetInput(input){
  const cursor = input.selectionStart;
  const digitsBeforeCursor = input.value.slice(0,cursor).replace(/\D/g,'').length;
  const unformatted = input.value.replace(/,/g,'');
  if(unformatted && !/^\d+$/.test(unformatted)) return;
  const formatted = unformatted.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  input.value = formatted;
  let nextCursor = 0;
  let digitsSeen = 0;
  while(nextCursor<formatted.length && digitsSeen<digitsBeforeCursor){
    if(/\d/.test(formatted[nextCursor])) digitsSeen++;
    nextCursor++;
  }
  input.setSelectionRange(nextCursor,nextCursor);
}

function normalizeCategoryName(name, suffix){
  return String(name || '').trim().replace(new RegExp(`${suffix}$`),'').trim();
}

function normalizeHierarchySuffixes(){
  const categoriesBefore = JSON.stringify(accountCategories);
  const budgetBefore = JSON.stringify(budget);
  ['income','expense'].forEach(type=>{
    const normalizedGroups = new Map();
    accountCategories[type].forEach(gwan=>{
      const gwanName = normalizeCategoryName(gwan.name,'_관');
      let normalizedGwan = normalizedGroups.get(gwanName);
      if(!normalizedGwan){
        normalizedGwan = {name:gwanName,accounts:[]};
        normalizedGroups.set(gwanName,normalizedGwan);
      }
      gwan.accounts.forEach(hang=>{
        const hangName = normalizeCategoryName(hang.name,'_항');
        let normalizedHang = normalizedGwan.accounts.find(account=>account.name===hangName);
        if(!normalizedHang){
          normalizedHang = {name:hangName,items:[]};
          normalizedGwan.accounts.push(normalizedHang);
        }
        hang.items.forEach(item=>{
          if(!normalizedHang.items.includes(item)) normalizedHang.items.push(item);
        });
      });
    });
    accountCategories[type] = [...normalizedGroups.values()];
  });



  const normalizedBudget = {};
  Object.entries(budget).forEach(([key,amount])=>{
    if(!key.startsWith('mok:')){
      normalizedBudget[key] = amount;
      return;
    }
    const parts = JSON.parse(key.slice(4));
    if(parts.length !== 4){
      normalizedBudget[key] = amount;
      return;
    }
    const [type,gwan,hang,mok] = parts;
    const normalizedKey = mokBudgetKey(
      type,
      normalizeCategoryName(gwan,'_관'),
      normalizeCategoryName(hang,'_항'),
      mok
    );
    const numericAmount = Number(amount);
    if(!Number.isFinite(numericAmount) || numericAmount<0 || !Number.isInteger(numericAmount)){
      throw new Error(`예산 분류 정리 중 금액이 올바르지 않습니다: ${key}`);
    }
    normalizedBudget[normalizedKey] = (normalizedBudget[normalizedKey] || 0) + numericAmount;
  });
  budget = normalizedBudget;
  return {
    categoriesChanged:categoriesBefore!==JSON.stringify(accountCategories),
    budgetChanged:budgetBefore!==JSON.stringify(budget),
  };
}

function migrateBudgetToMok(){
  budgetMigrationMessage = '';
  const keys = Object.keys(budget);
  const hasLegacyAmounts = keys.some(key=>!key.startsWith('mok:'));
  const migrated = {};
  let needsMigration = false;
  Object.entries(budget).forEach(([key, amount])=>{
    if(!key.startsWith('mok:')){
      needsMigration = true;
      return;
    }
    const parts = JSON.parse(key.slice(4));
    if(parts.length === 3){
      needsMigration = true;
      migrated[mokBudgetKey('expense',...parts)] = amount;
    } else {
      migrated[key] = amount;
    }
  });
  if(!needsMigration) return false;
  const legacyGwan = {
    '교육사업비':'활동비_관',
    '교통유류비':'차기이월금_관',
    '단체교섭회의비':'차기이월금_관',
    '대의원활동비':'차기이월금_관',
    '사무실운영비':'운영비_관',
    '야외행사비':'차기이월금_관',
    '연대사업비':'차기이월금_관',
    '임원중집위회의비':'차기이월금_관',
    '정책사업비':'예비비_관',
    '조직사업비':'행사비_관',
    '중앙집행위원활동비':'차기이월금_관',
    '통신비_SMS등':'회의비_관',
    '퇴직조합원환송회비':'차기이월금_관',
    '후생복지사업비':'조합비환불비_관'
  };
  const legacyAmounts = {};
  Object.entries(budget).filter(([key])=>!key.startsWith('mok:')).forEach(([name, amount])=>{
    const gwan = legacyGwan[name] || name;
    legacyAmounts[gwan] = (legacyAmounts[gwan] || 0) + (Number(amount) || 0);
  });
  accountCategories.expense.forEach(gwan=>{
    const amount = legacyAmounts[gwan.name];
    if(amount === undefined) return;
    const leaves = gwan.accounts.flatMap(hang=>
      hang.items.map(mok=>mokBudgetKey('expense',gwan.name,hang.name,mok))
    );
    if(!leaves.length) return;
    const share = Math.floor(amount / leaves.length);
    let remainder = amount - share * leaves.length;
    leaves.forEach(key=>{
      const current = migrated[key] || 0;
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      migrated[key] = current + share + extra;
    });
  });
  budget = migrated;
  if(hasLegacyAmounts){
    budgetMigrationMessage = '기존 관별 예산을 소속 목에 균등 배분했습니다. 각 목의 금액을 검토하고 필요하면 수정한 뒤 저장하세요.';
  }
  return true;
}

async function persistBudget(){
  try{ await storageSet(budgetKey(currentYear), JSON.stringify(budget)); return true; }
  catch(e){ lastStorageError = e.message || String(e); return false; }
}

async function persistAccountCategories(){
  try{ await storageSet(categoryKey(currentYear), JSON.stringify({...accountCategories,schemaVersion:CATEGORY_SCHEMA_VERSION})); return true; }
  catch(e){ lastStorageError = e.message || String(e); return false; }
}

// ---------- 회계연도 선택 ----------
function renderYearSelect(){
  const sel = document.getElementById('year-select');
  sel.innerHTML = years.map(y => `<option value="${y}"${y===currentYear?' selected':''}>${y}년</option>`).join('')
    + '<option value="__add__">＋ 연도 추가…</option>';
  document.getElementById('title-year').textContent = currentYear + ' 회계연도';
  document.getElementById('budget-year-label').textContent = `${currentYear}년`;
  document.getElementById('budget-year-column').textContent = currentYear;
  const datePicker = document.getElementById('f-date-picker');
  datePicker.min = fyStart(currentYear - 1);
  datePicker.max = fyEnd(currentYear);
  document.getElementById('f-date').value = '';
  datePicker.value = '';
}

async function loadYearData(){
  await loadClosure();      // ← 추가
  await loadLedger();
  await loadBudget();
  await loadAccountBalance();
  await loadStaffNames();
  await loadStaffBankDetails();
  await loadStaffGroups();
  await loadAccountCategories();
    await loadFund();
  await loadDeposits();   // B 단계에서 만드는 함수
  if(migrateBudgetToMok() && !await persistBudget()){
    throw new Error(`목별 예산을 Firestore로 이전하지 못했습니다: ${lastStorageError}`);
  }
  const normalized = normalizeHierarchySuffixes();
  const ledgerSaved = repairLedger().then(()=>true,error=>{ lastStorageError = error.message || String(error); return false; });
  const saves = await Promise.all([
    categoriesNeedMigration || normalized.categoriesChanged ? persistAccountCategories() : true,
    budgetNeedsMigration || normalized.budgetChanged ? persistBudget() : true,
    ledgerSaved
  ]);
  if(saves.some(saved=>!saved)){
    throw new Error(`관·항 명칭 정리 저장 실패: ${lastStorageError}`);
  }
  categoriesNeedMigration = false;
  budgetNeedsMigration = false;
}

function renderAll(){
  renderYearSelect();
  renderReport();
  renderReportTabs();
  if (currentMonthlyReportMonth >= 1 && currentMonthlyReportMonth <= 12) {
    loadMonthlyBudgetReport(currentMonthlyReportMonth);
  }
  renderEntryView();
  renderHierarchyForm();
  renderStaffNames();
    renderFund();
}

let yearSwitching = false;

async function setYear(v){
  if(yearSwitching){ renderYearSelect(); return; }
  yearSwitching = true;
  const select = document.getElementById('year-select');
  select.disabled = true;
  const previousYear = currentYear;
  try{
    if(v === '__add__'){
      const y = parseInt(prompt('추가할 회계연도를 입력하세요 (예: 2028)'), 10);
      if(!(y >= 2000 && y <= 2100)){ renderYearSelect(); return; }
      if(!years.includes(y)){ years.push(y); years.sort((a,b)=>a-b); await persistYears(); }
      currentYear = y;
    }else{
      currentYear = parseInt(v, 10);
    }
    currentMonthReport = currentMonthEntry = currentStatusEntry = '전체';
    currentMonthlyReportMonth = 0;
    await loadYearData();
    renderAll();
    watchSharedData();
    lsSet('year', currentYear);
  }catch(error){
    document.getElementById('auth-status').textContent = `${currentYear}년 데이터를 불러오지 못했습니다: ${error.message || error}`;
    currentYear = previousYear;
    try{ await loadYearData(); renderAll(); watchSharedData(); }
    catch(restoreError){ document.getElementById('auth-status').textContent = `이전 연도 복원도 실패했습니다. 새로고침해 주세요: ${restoreError.message || restoreError}`; }
  }finally{
    select.disabled = false;
    yearSwitching = false;
  }
}
function findAccount(type, mokName){
  for(const gwan of accountCategories[type] || []){
    for(const hang of gwan.accounts || []){
      if((hang.items || []).includes(mokName)){
        return {gwan:gwan.name, hang:hang.name, mok:mokName};
      }
    }
  }
  return null;
}

function escapeHTML(value){
  return String(value ?? '').replace(/[&<>"']/g, char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}

function formatEntryDate(date){
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if(!match) return date || '-';
  const [,year,month,day] = match;
  const parsed = new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
  if(parsed.getUTCFullYear()!==Number(year) || parsed.getUTCMonth()!==Number(month)-1 || parsed.getUTCDate()!==Number(day)){
    return date;
  }
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

function classificationPath(entry){
  return [entry.gwan, entry.hang, entry.category].filter(Boolean).join(' > ') || '미분류';
}

function migrateLedgerClassifications(list=ledger){    
  let changed = false;
  const legacyMokAliases = {
    '기타수입_기부금등':'기타수입(기부금 등)',
    '통신비_SMS등':'통신비(SMS 등)'
  };
list.forEach(entry=>{
    if(entry.gwan) return;                              
    const type = entry.gubun === '수입' ? 'income' : 'expense';
    const mokName = legacyMokAliases[entry.category] || entry.category;
    const match = findAccount(type, mokName) ||
      (accountCategories[type] || []).flatMap(gwan=>
        (gwan.accounts || []).map(hang=>({gwan, hang}))
      ).find(({gwan, hang})=>entry.hang===hang.name || entry.hang===gwan.name);
    if(!match) return;
    entry.gwan = match.gwan?.name || match.gwan;
    entry.hang = match.hang?.name || match.hang;
    if(match.mok) entry.category = match.mok;
    else if(legacyMokAliases[entry.category]) entry.category = mokName;
    changed = true;
  });
  return changed;
}

async function loadLedger(){
  stopLedgerWatcher();
  const year = currentYear;
reportSummary = null; reportMonthCache = {}; reportLoading = false; reportLoadToken++;
  ledgerSources = {recent:new Map(), pending:new Map(), older:new Map()};
  localOverrides = new Map();
  olderCursor = null; cursorSet = false; olderHasMore = false; olderLoading = false;
  await ensureLedgerMigrated(year);
  const col = entriesRef(year);

      const recent = watchLedgerQuery(entryListQuery(year).limit(ENTRY_PAGE_SIZE), year, snapshot=>{
    ledgerSources.recent = new Map(snapshot.docs.map(doc=>[doc.id,doc.data()]));
    if(!cursorSet){
      cursorSet = true;
      olderCursor = snapshot.docs.length ? snapshot.docs[snapshot.docs.length-1] : null;
      olderHasMore = snapshot.size>=ENTRY_PAGE_SIZE;
    }
    rebuildLedger();
  });
  const pending = watchLedgerQuery(col.where('status','in',['input-complete','submitted','rejected']), year, snapshot=>{
    ledgerSources.pending = new Map(snapshot.docs.map(doc=>[doc.id,doc.data()]));
    rebuildLedger();
  });
  ledgerUnsubscribe = recent.unsub;
  pendingUnsubscribe = pending.unsub;
  await Promise.all([recent.ready, pending.ready]);
  setFooter('최근 내역만 불러옴');
}

// 현재 선택/붙여넣어진 영수증 파일 객체
let selectedReceiptFile = null;

// 1. 파일 선택 이벤트 처리
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) setReceiptFile(file);
}

// 2. 클립보드(Ctrl+V) 붙여넣기 이벤트 처리
document.addEventListener('paste', function (event) {
  const items = (event.clipboardData || event.originalEvent.clipboardData).items;
  
  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      const blob = item.getAsFile();
      // 파일 이름 임의 지정 (예: paste_20261004.png)
      const file = new File([blob], `receipt_paste_${Date.now()}.png`, { type: blob.type });
      setReceiptFile(file);
      break;
    }
  }
});

// 3. 영수증 파일 설정 및 미리보기 출력
const PDF_PLACEHOLDER_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="120"><rect width="96" height="120" fill="#f1f5f9" stroke="#94a3b8"/><text x="48" y="68" font-size="22" text-anchor="middle" fill="#475569" font-family="sans-serif">PDF</text></svg>');
let receiptRemoveOnSave = false;      // 수정 중 기존 영수증을 지우기로 한 경우
let receiptExistingShown = false;     // 수정 중 기존 영수증 미리보기를 보여주는 중
const receiptCache = new Map();

function setReceiptFile(file) {
  selectedReceiptFile = file;
  receiptRemoveOnSave = false;
  receiptExistingShown = false;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const img = document.getElementById('receipt-preview-img');
  document.getElementById('receipt-preview-container').style.display = 'block';
  if (isPdf) { img.src = PDF_PLACEHOLDER_SRC; return; }
  const reader = new FileReader();
  reader.onload = function (e) { img.src = e.target.result; };
  reader.readAsDataURL(file);
}

// 4. 첨부된 영수증 취소/삭제 (사용자가 '삭제' 버튼을 누른 경우)
function clearReceipt() {
  if (editingEntryId && receiptExistingShown) receiptRemoveOnSave = true;  // 저장 시 기존 영수증 삭제
  resetReceiptInput();
}

// 입력 상태만 초기화 (폼 비우기용; 저장된 영수증은 건드리지 않음)
function resetReceiptInput() {
  selectedReceiptFile = null;
  receiptExistingShown = false;
  document.getElementById('f-receipt-file').value = '';
  document.getElementById('receipt-preview-img').src = '';
  document.getElementById('receipt-preview-container').style.display = 'none';
}

// ---- 영수증 저장소: accountingData/ledger:{연도}/receipts/{내역ID} ----
const RECEIPT_MAX_CHARS = 900000;   // Firestore 문서 1MiB 제한 안쪽
const receiptsRef = year => db.collection('accountingData').doc(ledgerKey(year)).collection('receipts');

function readAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = ()=>reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없습니다. JPG/PNG 형식인지 확인해 주세요.')); };
    img.src = url;
  });
}

// 이미지는 JPEG로 줄여서(긴 변 최대 1280px, 품질 0.7부터) 한 문서에 들어가게 만든다
async function buildReceiptPayload(file){
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if(isPdf){
    const data = await readAsDataURL(file);
    if(data.length > RECEIPT_MAX_CHARS) throw new Error('PDF가 너무 큽니다(약 650KB 이하만 가능). 이미지로 캡처해 첨부해 주세요.');
    return {name:file.name||'receipt.pdf', type:'application/pdf', data, size:file.size};
  }
  if(!String(file.type).startsWith('image/')) throw new Error('이미지 또는 PDF 파일만 첨부할 수 있습니다.');
  const img = await loadImageFromFile(file);
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  let maxSide = 1280, quality = 0.7;
  for(let i=0;i<12;i++){
    const scale = Math.min(1, maxSide/Math.max(w0,h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(w0*scale));
    canvas.height = Math.max(1,Math.round(h0*scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const data = canvas.toDataURL('image/jpeg',quality);
    if(data.length <= RECEIPT_MAX_CHARS){
      return {name:file.name||'receipt.jpg', type:'image/jpeg', data, size:file.size};
    }
    if(quality>0.55) quality -= 0.1; else maxSide = Math.round(maxSide*0.8);
  }
  throw new Error('이미지를 저장 가능한 크기로 줄이지 못했습니다.');
}

async function saveReceipt(entryId,payload){
  if(!hasSharedStorage()) throw new Error('Firebase에 로그인한 뒤 다시 시도해주세요.');
  await receiptsRef(currentYear).doc(entryId).set({
    name:payload.name, type:payload.type, data:payload.data, size:payload.size||0,
    updatedAt:new Date().toISOString(), updatedBy:currentUser.uid
  });
  receiptCache.set(`${currentYear}:${entryId}`,payload);
}

async function fetchReceipt(entryId){
  const key = `${currentYear}:${entryId}`;
  if(receiptCache.has(key)) return receiptCache.get(key);
  const snapshot = await receiptsRef(currentYear).doc(entryId).get();
  const receipt = snapshot.exists ? snapshot.data() : null;
  if(receipt) receiptCache.set(key,receipt);
  return receipt;
}

function deleteReceiptsQuiet(year,ids){
  ids.forEach(id=>{
    receiptCache.delete(`${year}:${id}`);
    receiptsRef(year).doc(id).delete().catch(error=>console.warn('영수증 삭제 실패',id,error));
  });
}

function applyReceiptMeta(entry,payload,remove){
  if(payload){
    entry.hasReceipt = true;
    entry.receiptName = payload.name;
    entry.receiptType = payload.type;
  }else if(remove){
    delete entry.hasReceipt;
    delete entry.receiptName;
    delete entry.receiptType;
  }
  return entry;
}

// 수정 모드 진입 시 저장돼 있는 영수증을 미리보기로 보여준다
async function showExistingReceipt(entry){
  resetReceiptInput();
  receiptRemoveOnSave = false;
  if(!entry.hasReceipt) return;
  try{
    const receipt = await fetchReceipt(entry.id);
    if(!receipt || editingEntryId!==entry.id) return;
    document.getElementById('receipt-preview-img').src = receipt.type==='application/pdf' ? PDF_PLACEHOLDER_SRC : receipt.data;
    document.getElementById('receipt-preview-container').style.display = 'block';
    receiptExistingShown = true;
  }catch(error){
    setStatus(`저장된 영수증을 불러오지 못했습니다: ${error.message || String(error)}`,true);
  }
}

// 지출내역보고(결의 내역 선택 시 열리는 보고서)의 '영수증 첨부' 칸에 저장된 영수증을 채운다
async function fillReceiptBox(sheet,entries){
  const box = sheet.querySelector('.payment-report-receipt-box');
  if(!box) return;
  const targets = entries.filter(entry=>entry.hasReceipt)
    .sort((a,b)=>(a.date||'').localeCompare(b.date||'') || String(a.id).localeCompare(String(b.id)));
  if(!targets.length){ box.textContent = '첨부된 영수증이 없습니다.'; box.classList.add('is-empty'); return; }
  box.textContent = '영수증을 불러오는 중…';
  const results = await Promise.all(targets.map(async entry=>{
    try{ return {entry,receipt:await fetchReceipt(entry.id)}; }
    catch(error){ return {entry,receipt:null,error}; }
  }));
  box.replaceChildren();
  box.classList.remove('is-empty');
  for(const {entry,receipt} of results){
    const figure = document.createElement('figure');
    figure.className = 'payment-report-receipt-item';
    if(receipt && String(receipt.type).startsWith('image/')){
      const img = document.createElement('img');
      img.alt = `${entry.desc||'내역'} 영수증`;
      img.src = receipt.data;
      figure.appendChild(img);
    }else if(receipt){
      const note = document.createElement('div');
      note.className = 'payment-report-receipt-pdf';
      note.textContent = `PDF 첨부: ${receipt.name||'receipt.pdf'}`;
      try{
        const blob = await (await fetch(receipt.data)).blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = ' (열기)';
        note.appendChild(link);
      }catch(error){ /* 링크 없이 이름만 표시 */ }
      figure.appendChild(note);
    }else{
      const note = document.createElement('div');
      note.className = 'payment-report-receipt-pdf';
      note.textContent = '영수증을 불러오지 못했습니다.';
      figure.appendChild(note);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = `${entry.desc||''}${entry.amount!=null?' · '+fmtShort(entry.amount)+'원':''}`;
    figure.appendChild(caption);
    box.appendChild(figure);
  }
  await Promise.all([...box.querySelectorAll('img')].map(img=>img.decode ? img.decode().catch(()=>{}) : Promise.resolve()));
}

  
async function loadMoreEntries(){
  if(olderLoading || !olderHasMore || !olderCursor) return;
  const year = currentYear;
  olderLoading = true;
  updateLoadMoreButton();
  try{
    const snapshot = await entryListQuery(year).startAfter(olderCursor).limit(ENTRY_PAGE_SIZE).get();
        if(year!==currentYear) return;
    snapshot.docs.forEach(doc=>ledgerSources.older.set(doc.id,doc.data()));
    if(snapshot.docs.length) olderCursor = snapshot.docs[snapshot.docs.length-1];
    olderHasMore = snapshot.size>=ENTRY_PAGE_SIZE;
    rebuildLedger();
    setFooter('이전 내역 추가 로드');
  }catch(error){
    setStatus(`이전 내역을 불러오지 못했습니다: ${error.message || String(error)}`,true);
  }finally{
    if(year===currentYear){ olderLoading = false; renderEntryView(); }
  }
}

function updateLoadMoreButton(){
  const button = document.getElementById('btn-load-more-entries');
  button.classList.toggle('hidden',!olderHasMore);
  button.disabled = olderLoading;
  button.textContent = olderLoading ? '불러오는 중…' : `이전 내역 ${ENTRY_PAGE_SIZE}건 더 보기`;
}

function setReportNote(text){
  document.getElementById('report-data-text').textContent = text;
}

function parseSummary(raw){
  try{
    const data = JSON.parse(raw);
    if(data && data.version===SUMMARY_VERSION && data.cells && typeof data.cells==='object') return data;
  }catch(e){}
  return null;
}

function emptySummary(){ return {version:SUMMARY_VERSION, cells:{}}; }

// 집계 키: 거래 결제일 월 + 관·항·목 (승인월이 아님 — 월별 누적 보고서와 일치)
function entrySummaryMonth(entry){
  if(entry.month) return String(entry.month);
  const txn = entryTxnMonth(entry);
  if(txn) return txn + '월';
  const acct = entryAcctMonth(entry);
  if(acct) return acct + '월';
  return '';
}
function resolveEntryClassification(entry){
  let gwan = entry.gwan || '';
  let hang = entry.hang || '';
  let mok = entry.category || '';
  if((!gwan || !hang) && mok){
    const type = entry.gubun === '수입' ? 'income' : 'expense';
    const match = typeof findAccount === 'function' ? findAccount(type, mok) : null;
    if(match){
      gwan = match.gwan?.name || match.gwan || gwan;
      hang = match.hang?.name || match.hang || hang;
      if(match.mok) mok = match.mok;
    }
  }
  return {gwan: gwan || '', hang: hang || '', category: mok || ''};
}
function cellKey(entry){
  const {gwan, hang, category} = resolveEntryClassification(entry);
  return JSON.stringify([entrySummaryMonth(entry), entry.gubun, gwan, hang, category]);
}

function applyToSummary(summary, entry, sign){
  const key = cellKey(entry);
  const cell = summary.cells[key] || {a:0,n:0};
  cell.a += sign*Number(entry.amount||0);
  cell.n += sign;
  if(cell.n===0 && cell.a===0) delete summary.cells[key];
  else summary.cells[key] = cell;
}

// 집계 문서의 각 칸을 aggregates()·renderBudgetSection()이 읽을 수 있는 형태로 변환
function summaryToEntries(summary){
  return Object.entries(summary.cells).map(([key,cell])=>{
    const [month,gubun,gwan,hang,category] = JSON.parse(key);
    return {month,gubun,gwan,hang,category,amount:cell.a,_count:cell.n};
  });
}

async function rebuildReportSummary(year){
  const snapshot = await entriesRef(year).where('status','in',APPROVED_STATES).get();
  const summary = emptySummary();
  snapshot.docs.forEach(doc=>applyToSummary(summary,doc.data(),1));
  summary.rebuiltAt = new Date().toISOString();
  try{
    await reportSummaryRef(year).set({value:JSON.stringify(summary),...writeMeta()});
  }catch(error){
    summary.unsaved = true;          // 저장은 실패했지만 화면에는 표시
    console.error(error);
  }
  return summary;
}

async function loadReportSummary(force=false){
  if(reportLoading) return;
  reportLoading = true;
  const token = ++reportLoadToken;
  const year = currentYear;
  let rebuilt = false;
  try{
    let summary = null;
    if(!force){
      setReportNote('보고서 집계를 불러오는 중…');
      const snapshot = await reportSummaryRef(year).get();
      if(snapshot.exists) summary = parseSummary(snapshot.data().value);
    }
    if(!summary){
      setReportNote('집계 문서를 새로 만드는 중입니다. 승인된 내역 전체를 한 번 읽습니다…');
      summary = await rebuildReportSummary(year);
      rebuilt = true;
    }
    if(token!==reportLoadToken) return;
    reportSummary = summary;
    reportMonthCache = {};
    const total = Object.values(summary.cells).reduce((sum,cell)=>sum+cell.n,0);
    setReportNote(
      `승인된 ${total.toLocaleString('ko-KR')}건 기준 집계입니다.` +
      (rebuilt ? ' (집계를 새로 계산했습니다.)' : '') +
      (summary.unsaved ? ' ⚠ 집계 문서 저장에 실패해 다음에도 다시 계산합니다.' : '') +
      ' 다른 담당자의 승인은 새로고침 후 반영됩니다.'
    );
  }catch(error){
    if(token===reportLoadToken) setReportNote(`보고서 데이터를 불러오지 못했습니다: ${error.message || String(error)}`);
    return;
  }finally{
    if(token===reportLoadToken) reportLoading = false;
  }
  renderReport();
}

// ---------- 세부 거래 내역: 선택한 월만 읽기 (승인일·승인번호 기준 월) ----------
async function loadReportMonth(month){
  if(reportMonthCache[month]) return;
  const year = currentYear, n = monthNo(month);
  // 승인 건 전체를 읽어 **승인 월**로 필터 (예: 승인번호 20261005… → 10월)
  const snapshot = await entriesRef(year).where('status','in',APPROVED_STATES).get();
  if(year!==currentYear) return;
  const list = [];
  snapshot.docs.forEach(doc=>{
    const t = doc.data();
    t.id = doc.id;
    const m = entryApprovalMonth(t);
    if(m !== n) return;
    const ay = entryApprovalYear(t);
    if(ay && ay !== year) return;
    list.push(t);
  });
  reportMonthCache[month] = list;
}

function reportMonthsFromSummary(approved){
  // 세부 거래 내역 월 버튼: 오늘(또는 마감)까지 표시 — 승인월 기준으로 조회하므로 빈 월도 선택 가능
  const maxM = typeof maxReportMonthAvailable === 'function' ? maxReportMonthAvailable() : 12;
  return monthList.filter(m => monthNo(m) >= 1 && monthNo(m) <= Math.max(maxM, 1));
}
  
function renderReportMonthFilters(approved){
  const el = document.getElementById('month-filters-report');
  if(!el) return;
  el.innerHTML = '';
  let months = reportMonthsFromSummary(approved);
  if(!months.length) months = monthList.slice();
  if(!months.includes(currentMonthReport)) currentMonthReport = months[months.length-1] || '1월';
  months.forEach(m=>{
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (m===currentMonthReport ? ' active' : '');
    btn.textContent = m + (monthNo(m)<=closedThrough ? ' ✓' : '');
    btn.addEventListener('click',()=>{
      currentMonthReport = m;
      renderReportMonthFilters(approved);
      renderReportDetail();
    });
    el.appendChild(btn);
  });
}

/** 승인일 키 (정렬·표시). approvedAt 우선, 없으면 승인번호(YYYYMMDD…) 앞 8자리, 최후 결제일 */
function entryApprovalDateKey(t){
  if(t?.approvedAt){
    const s = String(t.approvedAt);
    if(s.length >= 10) return s.slice(0, 10);
  }
  const mgmt = String(t?.managementNo || '');
  if(/^\d{8}/.test(mgmt)){
    return `${mgmt.slice(0,4)}-${mgmt.slice(4,6)}-${mgmt.slice(6,8)}`;
  }
  return t?.date || '';
}
/** 승인 월(1~12). 세부 거래 내역 월 필터용 — 결제일과 무관 */
function entryApprovalMonth(t){
  if(t?.approvedAt){
    const iso = /^(\d{4})-(\d{2})/.exec(String(t.approvedAt));
    if(iso) return parseInt(iso[2], 10) || 0;
  }
  const mgmt = String(t?.managementNo || '');
  if(/^\d{8}/.test(mgmt)) return parseInt(mgmt.slice(4, 6), 10) || 0;
  return entryTxnMonth(t);
}
function entryApprovalYear(t){
  if(t?.approvedAt){
    const iso = /^(\d{4})/.exec(String(t.approvedAt));
    if(iso) return parseInt(iso[1], 10) || 0;
  }
  const mgmt = String(t?.managementNo || '');
  if(/^\d{8}/.test(mgmt)) return parseInt(mgmt.slice(0, 4), 10) || 0;
  const d = String(t?.date || '');
  return parseInt(d.slice(0, 4), 10) || 0;
}
function formatApprovalDate(t){
  const key = entryApprovalDateKey(t);
  return key ? formatEntryDate(key) : '-';
}
function compareByApprovalDateDesc(a,b){
  const ka = entryApprovalDateKey(a);
  const kb = entryApprovalDateKey(b);
  return (kb||'').localeCompare(ka||'') || (b.date||'').localeCompare(a.date||'') || String(b.id||'').localeCompare(String(a.id||''));
}

async function renderReportDetail(){
  if(!document.getElementById('view-report').classList.contains('active')) return;
  const body = document.getElementById('tx-body-report');
  const total = document.getElementById('tx-report-total');
  const note = document.getElementById('tx-count-report');
  if(!body || !total || !note) return;
  const month = currentMonthReport;
  const mgmtTh = document.getElementById('th-report-mgmt');
  if(mgmtTh) mgmtTh.textContent = mgmtNoLabelForMonth(month);
  if(!month){
    body.innerHTML = ''; total.innerHTML = '';
    note.textContent = '월을 선택해 주세요.';
    return;
  }
  if(!reportMonthCache[month]){
    note.textContent = `${month} 내역을 불러오는 중…`;
    try{ await loadReportMonth(month); }
    catch(error){ note.textContent = `${month} 내역을 불러오지 못했습니다: ${error.message || String(error)}`; return; }
    if(month!==currentMonthReport || !reportMonthCache[month]) return;
  }
  // 승인일(승인번호·approvedAt) 기준 정렬 — 최신 승인 먼저
  const list = reportMonthCache[month].slice().sort(compareByApprovalDateDesc);
  body.innerHTML = '';
  list.forEach(t=>{
    const tr = document.createElement('tr');
    tr.className = (t.gubun==='수입' ? 'income-row' : 'expense-row') + ' report-row-clickable';
    tr.title = t.managementNo ? '클릭하면 해당 승인 건 지출내역보고를 봅니다' : '';
    tr.dataset.entryId = t.id || '';
    if(t.managementNo) tr.dataset.managementNo = String(t.managementNo);
    tr.innerHTML = `
      <td>${escapeHTML(formatEntryDate(t.date))}</td>
      <td>${escapeHTML(formatApprovalDate(t))}</td>
      <td>${escapeHTML(t.desc||'')}</td>
      <td>${escapeHTML(t.category||'-')}</td>
      <td>${escapeHTML(t.payee||'-')}</td>
      <td>${escapeHTML(t.spender||'-')}</td>
      <td class="num" style="color:var(--income)">${t.gubun==='수입'?fmtShort(t.amount):''}</td>
      <td class="num" style="color:var(--expense)">${t.gubun==='지출'?fmtShort(t.amount):''}</td>
      <td>${t.managementNo?escapeHTML(String(t.managementNo)):''}</td>`;
    body.appendChild(tr);
  });
  const income = list.reduce((sum,t)=>sum+(t.gubun==='수입'?Number(t.amount||0):0),0);
  const expense = list.reduce((sum,t)=>sum+(t.gubun==='지출'?Number(t.amount||0):0),0);
  total.innerHTML = `<tr class="report-total-row"><th colspan="6">${month} 합계 · ${list.length}건</th><td class="num">${fmtShort(income)}</td><td class="num">${fmtShort(expense)}</td><td></td></tr>`;
  note.textContent = list.length
    ? `${month} 승인 거래 ${list.length.toLocaleString('ko-KR')}건 · 승인일(승인번호) 기준 · 행을 클릭하면 지출내역보고를 볼 수 있습니다`
    : `${month}에 승인된 거래가 없습니다.`;
  bindReportDetailClicks();
}
// ---------- per-entry transactions ----------
function applyLocalChanges(upserts,deletes){
  // recent/pending 스냅샷이 나중에 도착해도, 방금 저장한 상태가 유지되도록 localOverrides에 둔다.
  // 승인 건은 pending 쿼리에서 빠지므로 recent·older에 반드시 넣어 결의 내역에 남긴다.
  upserts.forEach((entry,id)=>{
    localOverrides.set(id, entry);
    ledgerSources.recent.set(id, entry);
    ledgerSources.older.set(id, entry);
    if(APPROVED_STATES.includes(entry.status)){
      ledgerSources.pending.delete(id);
    }else if(['input-complete','submitted','rejected'].includes(entry.status)){
      ledgerSources.pending.set(id, entry);
    }else if(ledgerSources.pending.has(id)){
      ledgerSources.pending.set(id, entry);
    }
  });
  deletes.forEach(id=>{
    localOverrides.delete(id);
    Object.values(ledgerSources).forEach(source=>source.delete(id));
  });
  rebuildLedger();
  setFooter('저장됨');
}
// Locks the given entry ids, hands the latest data to work(found, api).
// In work(): do any extra api.tx.get(...) reads FIRST, then api.set / api.remove.
async function entryTransaction(ids,work){
  if(!hasSharedStorage()) throw new Error('Firebase에 로그인한 뒤 다시 시도해주세요.');
  if(ids.length>450) throw new Error('한 번에 처리할 수 있는 내역은 450건까지입니다.');
  const year = currentYear;
  const col = entriesRef(year);
  const sumRef = reportSummaryRef(year);
  let upserts = new Map(), deletes = new Set();
  let committedSummary = null, touchedMonths = new Set();
  let receiptDeleteIds = new Set();
  await db.runTransaction(async tx=>{
    upserts = new Map(); deletes = new Set();            // reset if Firestore retries
    committedSummary = null; touchedMonths = new Set(); receiptDeleteIds = new Set();
    // 모든 읽기를 쓰기보다 먼저 수행
    const [snapshots,sumSnapshot] = await Promise.all([
      Promise.all(ids.map(id=>tx.get(col.doc(id)))),
      tx.get(sumRef)
    ]);
    const summary = sumSnapshot.exists ? parseSummary(sumSnapshot.data().value) : null;
    const found = new Map();
    snapshots.forEach((snapshot,index)=>{ if(snapshot.exists) found.set(ids[index],snapshot.data()); });
    await work(found,{
      tx,
      set:entry=>{ tx.set(col.doc(entry.id),entry); upserts.set(entry.id,entry); deletes.delete(entry.id); },
      remove:id=>{ tx.delete(col.doc(id)); deletes.add(id); upserts.delete(id); }
    });
    deletes.forEach(id=>{ if(found.get(id)?.hasReceipt) receiptDeleteIds.add(id); });
    // 승인 상태가 바뀐 내역만 집계 문서에 반영 (집계 문서가 있을 때만)
    if(!summary) return;
    let changed = false;
    const track = (before,after)=>{
      const was = before && APPROVED_STATES.includes(before.status);
      const will = after && APPROVED_STATES.includes(after.status);
      if(was){ applyToSummary(summary,before,-1); touchedMonths.add(String(entryAcctMonth(before) ?? monthNo(before.month))+'월'); changed = true; }
      if(will){ applyToSummary(summary,after,+1); touchedMonths.add(String(entryAcctMonth(after) ?? monthNo(after.month))+'월'); changed = true; }
    };
        upserts.forEach((entry,id)=>track(found.get(id),entry));
    deletes.forEach(id=>track(found.get(id),null));
    if(changed){
      tx.set(sumRef,{value:JSON.stringify(summary),...writeMeta()});
      committedSummary = summary;
    }
  });
  if(receiptDeleteIds.size) deleteReceiptsQuiet(year,[...receiptDeleteIds]);
  if(year===currentYear){
    applyLocalChanges(upserts,deletes);
    if(committedSummary){
      reportSummary = committedSummary;
      // 집계 무효화 규칙 단일 진입점 (월별 캐시·월별 누적 보고서 dirty)
      const months = [...touchedMonths];
      const plan = (typeof ShowMeDomain !== 'undefined' && ShowMeDomain.buildInvalidation)
        ? ShowMeDomain.buildInvalidation('months', months)
        : { clearSummary:false, clearAllMonthCaches:false, dirtyMonthly:true, months };
      invalidateReportAggregates(plan);
    }
  }
}

// ---------- load-time repair: writes only the fields that actually changed ----------
function diffPatch(before,after){
  const patch = {};
  Object.keys(after).forEach(key=>{
    if(JSON.stringify(after[key])!==JSON.stringify(before[key])) patch[key] = after[key];
  });
  Object.keys(before).forEach(key=>{
    if(!(key in after)) patch[key] = firebase.firestore.FieldValue.delete();
  });
  return patch;
}

async function repairLedger(){
  const year = currentYear;
  const originals = new Map(ledger.map(entry=>[entry.id,entry]));
  const draft = ledger.map(entry=>JSON.parse(JSON.stringify(entry)));
  applyFixes(draft);
  reconcileLedgerClassifications(draft);
  migrateLedgerClassifications(draft);
  normalizeLedgerSuffixes(draft);
  const patches = draft
    .map(entry=>({id:entry.id,patch:diffPatch(originals.get(entry.id),entry)}))
    .filter(item=>Object.keys(item.patch).length);
  if(!patches.length) return 0;
  const col = entriesRef(year);
  for(let i=0;i<patches.length;i+=400){
    const batch = db.batch();
    patches.slice(i,i+400).forEach(({id,patch})=>batch.update(col.doc(id),patch));
    await batch.commit();
  }
   if(patches.some(({id,patch})=>APPROVED_STATES.includes(originals.get(id).status) || APPROVED_STATES.includes(patch.status))){
    try{ await reportSummaryRef(year).set({value:JSON.stringify({version:0}),...writeMeta()}); }catch(e){ console.error(e); }
    if(year===currentYear){
      const plan = (typeof ShowMeDomain !== 'undefined' && ShowMeDomain.buildInvalidation)
        ? ShowMeDomain.buildInvalidation('full')
        : { clearSummary:true, clearAllMonthCaches:true, dirtyMonthly:true, months:[] };
      invalidateReportAggregates(plan);
    }
  }
  if(year===currentYear) ledger = draft.sort(compareEntries);
  return patches.length;
}

async function exportLedgerBackup(){
  if(!window.confirm('백업을 위해 이 회계연도의 모든 내역을 서버에서 읽습니다. 계속할까요?')) return;
  try{
    const snapshot = await entriesRef(currentYear).get();
    const all = snapshot.docs.map(doc=>doc.data()).sort(compareEntries);
    downloadBlob(new Blob([JSON.stringify(all,null,2)],{type:'application/json'}),
      `ledger-${currentYear}-${paymentDateKey(new Date())}.json`);
  }catch(error){
    setStatus(`백업 실패: ${error.message || String(error)}`,true);
  }
}

// ---------- derived aggregates ----------
function aggregates(list){
  const monthlyIncome = {}, monthlyExpense = {};
  monthList.forEach(m=>{monthlyIncome[m]=0; monthlyExpense[m]=0;});
  const byGwan = {}, byMokExp = {}, byMokInc = {};
  let totalIncome=0, totalExpense=0;

  list.forEach(t=>{
    const m = t.month || '기타';
    const classification = classificationPath(t);
    if(t.gubun === '수입'){
      totalIncome += t.amount;
      if(monthlyIncome[m] !== undefined) monthlyIncome[m]+=t.amount;
      byMokInc[classification] = (byMokInc[classification]||0) + t.amount;
    } else {
      totalExpense += t.amount;
      if(monthlyExpense[m] !== undefined) monthlyExpense[m]+=t.amount;
      const gwan = t.gwan || '미분류';
      byGwan[gwan] = (byGwan[gwan]||0) + t.amount;
      byMokExp[classification] = (byMokExp[classification]||0) + t.amount;
    }
  });

  const usedMonths = monthList.filter(m => monthlyIncome[m] || monthlyExpense[m]);

  return {
    totalIncome, totalExpense,
    months: usedMonths,
    monthlyIncome: usedMonths.map(m=>monthlyIncome[m]),
    monthlyExpense: usedMonths.map(m=>monthlyExpense[m]),
    gwanLabels: Object.keys(byGwan),
    gwanValues: Object.values(byGwan),
    topMok: Object.entries(byMokExp).sort((a,b)=>b[1]-a[1]).slice(0,12),
    incomeLabels: Object.keys(byMokInc),
    incomeValues: Object.values(byMokInc)
  };
}

// ---------- charts ----------
const CHART_FONT_SIZE = 14;   // 앱 본문 글자 크기와 동일
Chart.defaults.font.family = "'Pretendard', sans-serif";
Chart.defaults.font.size = CHART_FONT_SIZE;
// 차트 색은 style.css의 컬러 스킴(:root 변수)에서 읽어옵니다 → 스킴을 바꾸면 차트도 함께 바뀝니다
function cssVar(name,fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function chartPalette(){
  return {
    income: cssVar('--income','#5A7863'),
    expense: cssVar('--expense','#3B4953'),
    budget: cssVar('--gold','#90AB8B'),
    ink: cssVar('--ink','#3B4953'),
    grid: cssVar('--line','#CFDDC3'),
    surface: cssVar('--paper-2','#F7FAF2'),
    // 관별 도넛용: 스킴의 4색 + 같은 톤의 보조색
    slices: [cssVar('--navy','#3B4953'),cssVar('--navy-2','#5A7863'),cssVar('--gold','#90AB8B'),
             '#6F7F89','#B7CDB0','#A3B1B9','#2F3B33','#7F9C86']
  };
}
Chart.defaults.color = cssVar('--ink','#3B4953');

function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } delete chartBuilders[id]; }

// ---------- 차트 반응형(범례·툴팁·높이) ----------
const chartViewport = window.matchMedia('(max-width: 767px)');
const isMobileChart = () => chartViewport.matches;
const chartBuilders = {};   // id -> {kind, build(mobile)}  (화면 크기 변경 시 옵션 재계산용)

const truncateLabel = (text,max)=>{ const s=String(text??''); return s.length>max ? s.slice(0,max-1)+'…' : s; };
const wrapLabel = (text,width)=>{
  const s=String(text??''), lines=[];
  for(let i=0;i<s.length;i+=width) lines.push(s.slice(i,i+width));
  return lines.length ? lines : [''];
};
// 모바일 축 눈금: 12,345,678 → 1235만, 120,000,000 → 1.2억
const compactWon = v=>{
  const n=Number(v), a=Math.abs(n);
  if(a>=1e8) return Number((n/1e8).toFixed(1)).toLocaleString('ko-KR')+'억';
  if(a>=1e4) return Math.round(n/1e4).toLocaleString('ko-KR')+'만';
  return fmtShort(n);
};

function chartLegend(mobile,{position='top',align='end',usePointStyle=false,kind='bar',maxText=12}={}){
  const labels = {
    boxWidth: mobile ? 10 : 12,
    padding: mobile ? 8 : 12,
    font:{size:CHART_FONT_SIZE}
  };
  if(usePointStyle) labels.usePointStyle = true;
  // 모바일 도넛: 범례 이름이 길면 말줄임 (전체 이름은 툴팁에서 확인)
  if(mobile && kind==='doughnut'){
    labels.generateLabels = chart=>{
      const items = Chart.overrides.doughnut.plugins.legend.labels.generateLabels(chart);
      items.forEach(item=>{ item.text = truncateLabel(item.text,maxText); });
      return items;
    };
  }
  return {
    position: mobile ? (position==='right' ? 'bottom' : 'top') : position,
    align: mobile ? 'center' : align,
    labels
  };
}

function chartTooltip(mobile,callbacks,{wrapTitle=false}={}){
  const cb = {...callbacks};
  if(mobile && wrapTitle && !cb.title){
    cb.title = items=>wrapLabel(items[0]?.label ?? '',14);
  }
  const tooltip = {
    callbacks: cb,
    position:'nearest',
    padding: mobile ? 8 : 10,
    caretPadding: mobile ? 14 : 6,
    titleFont:{size:CHART_FONT_SIZE},
    bodyFont:{size:CHART_FONT_SIZE}
  };
  if(mobile) tooltip.yAlign = 'bottom';   // 터치한 손가락이 툴팁을 가리지 않도록 위쪽에 표시
  return tooltip;
}

// 모바일에서 항목 수에 맞춰 차트 박스 높이 조정 (범례·가로막대가 겹치거나 화면을 가리지 않도록)
function fitChartBox(chart,kind,mobile){
  const box = chart.canvas && chart.canvas.parentElement;
  if(!box) return;
  const n = (chart.data.labels||[]).length;
  let h = 0;
  if(mobile){
    if(kind==='doughnut') h = 240 + Math.ceil(n/2)*22;
    else if(kind==='barH') h = Math.max(240, n*(chart.data.datasets.length>1 ? 46 : 30) + 90);
  }
  box.style.height = h ? h+'px' : '';   // 빈 값이면 CSS 기본 높이로 복귀
}

function createResponsiveChart(id,canvasId,kind,build){
  destroy(id);
  const mobile = isMobileChart();
  charts[id] = new Chart(document.getElementById(canvasId), build(mobile));
  chartBuilders[id] = {kind, build};
  fitChartBox(charts[id],kind,mobile);
  return charts[id];
}

function refreshChartsForViewport(){
  const mobile = isMobileChart();
  Object.keys(chartBuilders).forEach(id=>{
    const chart = charts[id];
    if(!chart) return;
    const {kind,build} = chartBuilders[id];
    chart.options = build(mobile).options;
    fitChartBox(chart,kind,mobile);
    chart.update();
  });
}
if(chartViewport.addEventListener) chartViewport.addEventListener('change',refreshChartsForViewport);
else if(chartViewport.addListener) chartViewport.addListener(refreshChartsForViewport);


function renderReport(){
 if(reportSummary===null){
    if(appReady && document.getElementById('view-report').classList.contains('active')) loadReportSummary();
    return;
  }
  const approved = summaryToEntries(reportSummary);
  const approvedCount = approved.reduce((sum,t)=>sum+t._count,0);
  const ag = aggregates(approved);

  document.getElementById('r-income').textContent = fmt(ag.totalIncome);
  document.getElementById('r-expense').textContent = fmt(ag.totalExpense);
document.getElementById('r-count').textContent = `승인된 ${approvedCount.toLocaleString('ko-KR')}건 거래`;
  document.getElementById('r-balance').textContent = fmt(ag.totalIncome - ag.totalExpense);
  renderAccountBalanceCheck(ag.totalIncome - ag.totalExpense);

  createResponsiveChart('monthly','chartMonthly','bar',mobile=>{ const P = chartPalette(); return {
    type:'bar',
    data:{ labels: ag.months, datasets:[
      {label:'수입', data: ag.monthlyIncome, backgroundColor:P.income},
      {label:'지출', data: ag.monthlyExpense, backgroundColor:P.expense}
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      ...(mobile ? {interaction:{mode:'index', intersect:false}} : {}),
      plugins:{ legend:chartLegend(mobile,{position:'top',align:'end',usePointStyle:true}),
        tooltip:chartTooltip(mobile,{label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`})},
      scales:{ y:{ticks:{callback:v=>mobile?compactWon(v):fmtShort(v), font:{size:CHART_FONT_SIZE}}, grid:{color:P.grid}},
               x:{ticks:{font:{size:CHART_FONT_SIZE}}, grid:{display:false}} }
    }
  }; });

  createResponsiveChart('hang','chartExpenseHang','doughnut',mobile=>{ const P = chartPalette(); return {
    type:'doughnut',
    data:{ labels: ag.gwanLabels, datasets:[{data: ag.gwanValues.map(v=>Math.max(0,v)), backgroundColor: ag.gwanLabels.map((_,i)=>P.slices[i%P.slices.length]), borderColor:P.surface, borderWidth:2}]},
    options:{ responsive:true, maintainAspectRatio:false, cutout:'58%',
      plugins:{ legend:chartLegend(mobile,{position:'right',align:'center',kind:'doughnut'}),
        tooltip:chartTooltip(mobile,{label: ctx => mobile ? [...wrapLabel(ctx.label,14), fmt(ctx.parsed)] : `${ctx.label}: ${fmt(ctx.parsed)}`})}
    }
  }; });

  const tblTopMok = document.getElementById('tbl-top-mok');
  tblTopMok.innerHTML = '';
  const maxMok = Math.max(1, ...ag.topMok.map(m=>m[1]));
  ag.topMok.forEach(([name,val])=>{
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${escapeHTML(name)}<div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,val/maxMok*100).toFixed(1)}%"></div></div></td><td class="num">${fmtShort(val)}</td>`;
  tblTopMok.appendChild(tr);
});
  document.getElementById('tbl-top-mok-total').innerHTML =
    `<tr class="report-total-row"><th>표시 합계</th><td class="num">${fmtShort(ag.topMok.reduce((sum,[,amount])=>sum+amount,0))}</td></tr>`;

  createResponsiveChart('income','chartIncome','barH',mobile=>{ const P = chartPalette(); return {
    type:'bar',
    data:{ labels: ag.incomeLabels, datasets:[{data: ag.incomeValues, backgroundColor:P.income}]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:chartTooltip(mobile,{label: ctx => fmt(ctx.parsed.x)},{wrapTitle:true})},
      scales:{ x:{ticks:{callback:v=>mobile?compactWon(v):fmtShort(v), font:{size:CHART_FONT_SIZE}, maxTicksLimit:mobile?4:undefined}, grid:{color:P.grid}},
               y:{ticks:{font:{size:CHART_FONT_SIZE}, callback:function(v){ const l=this.getLabelForValue(v); return mobile?truncateLabel(l,9):l; }}, grid:{display:false}} }
    }
  }; });

   renderReportMonthFilters(approved);
  renderReportDetail();
  autoSelectMonthlyReportMonth(approved);   // 월 미선택이면 승인 내역이 있는 가장 최근 월을 자동 선택
  renderBudgetSection(approved);
}

// ---- 1) 보고서 탭을 열면 가장 최근 표시 가능 월을 자동 선택 ----
function autoSelectMonthlyReportMonth(approved){
  if(currentMonthlyReportMonth!==0) return;
  const maxMonth = maxReportMonthAvailable();
  if(maxMonth < 1) return;
  currentMonthlyReportMonth = maxMonth;   // 오늘 기준 최신 월 (미마감 포함)
  renderReportTabs();
  loadMonthlyBudgetReport(currentMonthlyReportMonth);
}

// 승인 내역 목록 → 목 단위 집행액 맵 (월별 누적 보고서 표와 같은 계산)
function spentByMokFromList(list){
  const spentByMok = {};
  list.forEach(t=>{
    if(t.gubun!=='수입' && t.gubun!=='지출') return;
    const type = t.gubun==='수입' ? 'income' : 'expense';
    const {gwan, hang, category} = resolveEntryClassification(t);
    const key = mokBudgetKey(type, gwan || '미분류', hang || '미분류', category || '미분류');
    spentByMok[key] = (spentByMok[key] || 0) + Number(t.amount || 0);
  });
  return spentByMok;
}

// 마지막 그래프: 지출 관별 예산 대비 집행. throughMonth(1~12)가 있으면 월별 누적 보고서 표와 같은 기간·같은 데이터,
// 0이면 연간 전체(집계 문서 기준)
function renderBudgetChart(spentByMok, throughMonth){
  const titleEl = document.getElementById('budget-chart-title');
  if(titleEl) titleEl.textContent = throughMonth
    ? `관별 예산 대비 집행 (1~${throughMonth}월 누적)`
    : '관별 예산 대비 집행 (연간 전체)';

  const budgetByGwan = {}, spentByGwan = {}, shownKeys = new Set();
  (accountCategories.expense || []).forEach(gwan=>{
    budgetByGwan[gwan.name] = 0; spentByGwan[gwan.name] = 0;
    gwan.accounts.forEach(hang=>hang.items.forEach(mok=>{
      const key = mokBudgetKey('expense',gwan.name,hang.name,mok);
      shownKeys.add(key);
      budgetByGwan[gwan.name] += Number(budget[key]) || 0;
      spentByGwan[gwan.name] += spentByMok[key] || 0;
    }));
  });
  // 표의 '미분류/삭제된 항목' 행과 같은 기준
  let orphanSpent = 0;
  Object.entries(spentByMok).forEach(([key,amount])=>{
    if(shownKeys.has(key)) return;
    if(JSON.parse(key.slice(4))[0]==='expense') orphanSpent += amount;
  });
  const labels = Object.keys(budgetByGwan).filter(g=>budgetByGwan[g]>0 || spentByGwan[g]>0);
  if(orphanSpent){
    const name = '미분류/삭제된 항목';
    labels.push(name); budgetByGwan[name] = 0; spentByGwan[name] = orphanSpent;
  }

  destroy('budget');
  const canvas = document.getElementById('chartBudget');
  if(!canvas) return;
  const box = canvas.parentElement;
  if(!labels.length){
    if(box) box.style.height = '';
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
    return;
  }
  createResponsiveChart('budget','chartBudget','barH',mobile=>{ const P = chartPalette(); return {
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'예산', data: labels.map(g=>budgetByGwan[g]||0), backgroundColor:P.budget},
        {label:'집행액', data: labels.map(g=>spentByGwan[g]||0), backgroundColor:P.expense}
      ]
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:chartLegend(mobile,{position:'top',align:'end',usePointStyle:true}),
        tooltip:chartTooltip(mobile,{label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.x)}`},{wrapTitle:true})},
      scales:{ x:{ticks:{callback:v=>mobile?compactWon(v):fmtShort(v), font:{size:CHART_FONT_SIZE}, maxTicksLimit:mobile?4:undefined}, grid:{color:P.grid}},
               y:{ticks:{font:{size:CHART_FONT_SIZE}, callback:function(v){ const l=this.getLabelForValue(v); return mobile?truncateLabel(l,9):l; }}, grid:{display:false}} }
    }
  }; });
}

function renderBudgetSection(approvedList){
  // 월별 누적 보고서에서 월이 선택된 동안에는 그 표가 차트를 갱신합니다 (표와 항상 같은 숫자)
  if(currentMonthlyReportMonth>=1 && currentMonthlyReportMonth<=12) return;
  renderBudgetChart(spentByMokFromList(approvedList), 0);
}

function createHierarchyInput(className, value, placeholder, ariaLabel){
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('aria-label',ariaLabel);
  return input;
}

function createHierarchyRow({type='expense',gwan='',hang='',mok='',amount=0,emptyKind=''}={}){
  const row = document.createElement('tr');
  row.className = `hierarchy-item-row ${type==='income'?'income-row':'expense-row'}`;
  if(emptyKind) row.dataset.emptyKind = emptyKind;
  const typeCell = document.createElement('td');
  const typeSelect = document.createElement('select');
  typeSelect.className = 'hierarchy-category-type';
  typeSelect.setAttribute('aria-label','구분');
  typeSelect.innerHTML = '<option value="income">수입</option><option value="expense">지출</option>';
  typeSelect.value = type;
  typeCell.appendChild(typeSelect);
  row.appendChild(typeCell);

  [
    ['hierarchy-gwan-name',gwan,'관 이름','관'],
    ['hierarchy-account-name',hang,'항 이름','항'],
    ['hierarchy-item-name',mok,'목 이름','목']
  ].forEach(([className,value,placeholder,label])=>{
    const cell = document.createElement('td');
    cell.appendChild(createHierarchyInput(className,value,placeholder,label));
    row.appendChild(cell);
  });

  const budgetCell = document.createElement('td');
  const budgetInput = document.createElement('input');
  budgetInput.type = 'text';
  budgetInput.inputMode = 'numeric';
  budgetInput.pattern = '[0-9,]*';
  budgetInput.className = 'hierarchy-item-budget';
  budgetInput.setAttribute('aria-label',`${currentYear}년 ${mok || '목'} 예산`);
  budgetInput.placeholder = '예산';
  budgetInput.value = formatBudgetAmount(amount);
  budgetCell.appendChild(budgetInput);
  row.appendChild(budgetCell);

  const actionCell = document.createElement('td');
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn-text hierarchy-row-delete';
  removeButton.textContent = '삭제';
  removeButton.setAttribute('aria-label',`${mok || '분류'} 행 삭제`);
  actionCell.appendChild(removeButton);
  row.appendChild(actionCell);
  return row;
}

function renderHierarchyForm(){
  const body = document.getElementById('hierarchy-form-body');
  body.innerHTML = '';
  ['income','expense'].forEach(type=>{
    accountCategories[type].forEach(gwan=>{
      if(!gwan.accounts.length){
        body.appendChild(createHierarchyRow({type,gwan:gwan.name,emptyKind:'gwan'}));
        return;
      }
      gwan.accounts.forEach(hang=>{
        if(!hang.items.length){
          body.appendChild(createHierarchyRow({type,gwan:gwan.name,hang:hang.name,emptyKind:'account'}));
          return;
        }
        hang.items.forEach(mok=>{
          body.appendChild(createHierarchyRow({
            type,
            gwan:gwan.name,
            hang:hang.name,
            mok,
            amount:budget[mokBudgetKey(type,gwan.name,hang.name,mok)] || 0
          }));
        });
      });
    });
    if(type==='income'){
      const totalRow = document.createElement('tr');
      totalRow.className = 'hierarchy-total-row';
      totalRow.innerHTML = '<td class="hierarchy-total-label" colspan="4">수입 예산 합계</td><td class="hierarchy-total-value" id="hierarchy-income-total">0원</td><td></td>';
      body.appendChild(totalRow);
    }
  });
  const migrationNotice = document.getElementById('budget-migration-notice');
  migrationNotice.textContent = budgetMigrationMessage;
  migrationNotice.classList.toggle('hidden',!budgetMigrationMessage);
  refreshMokOptions();
  updateHierarchyBudgetTotals();
}

function updateHierarchyBudgetTotals(){
  let income = 0;
  let expense = 0;
  document.querySelectorAll('#hierarchy-form-body .hierarchy-item-row').forEach(row=>{
    const amount = parseBudgetAmount(row.querySelector('.hierarchy-item-budget').value);
    if(!Number.isFinite(amount)) return;
    if(row.querySelector('.hierarchy-category-type').value==='income') income += amount;
    else expense += amount;
  });
  document.getElementById('hierarchy-income-total').textContent = fmt(income);
  document.getElementById('hierarchy-expense-total').textContent = fmt(expense);
  const difference = income-expense;
  const totalRow = document.getElementById('hierarchy-grand-total-row');
  const totalMessage = document.getElementById('hierarchy-total-message');
  const topDifference = document.getElementById('hierarchy-grand-total-top');
  document.getElementById('hierarchy-income-total-top').textContent = fmt(income);
  document.getElementById('hierarchy-expense-total-top').textContent = fmt(expense);
  document.getElementById('hierarchy-grand-total').textContent = fmt(difference);
  totalRow.classList.toggle('hierarchy-total-mismatch',difference!==0);
  totalMessage.textContent = difference===0 ? '수입·지출 예산 동일' : '예산 불일치';
  topDifference.textContent = `${fmt(difference)} · ${difference===0?'수입·지출 예산 동일':'예산 불일치'}`;
  topDifference.classList.toggle('mismatch',difference!==0);
}
function repositionHierarchyRows(){
  const body = document.getElementById('hierarchy-form-body');
  const incomeTotalRow = body.querySelector('#hierarchy-income-total').closest('tr');
  const incomeRows = [...body.querySelectorAll('.hierarchy-item-row')]
    .filter(row=>row.querySelector('.hierarchy-category-type').value==='income');
  const expenseRows = [...body.querySelectorAll('.hierarchy-item-row')]
    .filter(row=>row.querySelector('.hierarchy-category-type').value==='expense');
  [...incomeRows,incomeTotalRow,...expenseRows].forEach(row=>body.appendChild(row));
}
function captureHierarchyForm(){
  const tree = {income:[],expense:[]};
  const nextBudget = {};
  document.querySelectorAll('.hierarchy-item-row').forEach(row=>{
    const type = row.querySelector('.hierarchy-category-type').value;
    const name = normalizeCategoryName(row.querySelector('.hierarchy-gwan-name').value,'_관');
    const accountName = normalizeCategoryName(row.querySelector('.hierarchy-account-name').value,'_항');
    const mok = row.querySelector('.hierarchy-item-name').value.trim();
    let group = tree[type].find(item=>item.name===name);
    if(!group){
      group = {name,accounts:[]};
      tree[type].push(group);
    }
    if(row.dataset.emptyKind==='gwan') return;
    let account = group.accounts.find(item=>item.name===accountName);
    if(!account){
      account = {name:accountName,items:[]};
      group.accounts.push(account);
    }
    if(row.dataset.emptyKind==='account') return;
    account.items.push(mok);
    nextBudget[mokBudgetKey(type,name,accountName,mok)] =
      parseBudgetAmount(row.querySelector('.hierarchy-item-budget').value);
  });
  return {tree,budget:nextBudget};
}

function renderMonthFilters(containerId, sourceList, current, onClick){
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  const monthsUsed = ['전체', ...monthList.filter(m => sourceList.some(t=>t.month===m))];
  monthsUsed.forEach(m=>{
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (m===current ? ' active' : '');
    btn.textContent = m;
    btn.addEventListener('click', ()=>{ onClick(m); });
    el.appendChild(btn);
  });
}

// 결의번호: submissionSequence 우선, 없으면 결의완료 상태의 managementNo
function entryResolutionNo(t){
  if(t.submissionSequence != null && String(t.submissionSequence).trim() !== '') return String(t.submissionSequence);
  if(t.status === 'submitted' && t.managementNo) return String(t.managementNo);
  return '';
}
// 결의일: '결의' 버튼을 누른 날(submittedAt, 로컬 날짜) → 'YYYY-MM-DD'
function entrySubmittedDateKey(t){
  if(!t || !t.submittedAt) return '';
  const d = new Date(t.submittedAt);
  if(Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// 결의번호는 달마다 1번부터 시작하므로, 같은 번호를 구분하는 '결의월' 키 (YYYYMM)
function resolutionMonthKey(t){
  const key = entrySubmittedDateKey(t);
  return key ? key.slice(0,4)+key.slice(5,7) : '';
}
// 결의번호 순 정렬 (결의월 → 번호, 번호 없는 내역은 맨 뒤)
function compareByResolution(a,b){
  const na = entryResolutionNo(a), nb = entryResolutionNo(b);
  const sa = na!=='' && Number.isFinite(Number(na)) ? Number(na) : null;
  const sb = nb!=='' && Number.isFinite(Number(nb)) ? Number(nb) : null;
  if((sa===null)!==(sb===null)) return sa===null ? 1 : -1;
  if(sa===null) return (b.date||'').localeCompare(a.date||'') || String(a.id).localeCompare(String(b.id));
  return resolutionMonthKey(a).localeCompare(resolutionMonthKey(b)) || sa-sb
    || (a.date||'').localeCompare(b.date||'') || String(a.id).localeCompare(String(b.id));
}
// 승인번호: 승인(approved/paid/confirmed) 상태일 때 managementNo
function entryApprovalNo(t){
  if(APPROVED_STATES.includes(t.status) && t.managementNo) return String(t.managementNo);
  return '';
}

function renderTxTable(mode){
  const isReport = mode==='report';
  const bodyId = isReport ? 'tx-body-report' : 'tx-body-entry';
  const countId = isReport ? 'tx-count-report' : 'tx-count-entry';
  const monthSel = isReport ? currentMonthReport : currentMonthEntry;
  const body = document.getElementById(bodyId);
  body.innerHTML = '';

const source = ledger;
  const filtered = source
    .filter(t => monthSel==='전체' || t.month===monthSel)
    .filter(t => isReport || currentStatusEntry==='전체' || t.status===currentStatusEntry)
    // 결의 내역에는 입력완료(미결의) 건을 넣지 않음 — 입력 내역 상자에서만 관리
    .filter(t => isReport || t.status!=='input-complete')
    // 마감된 달의 승인 건은 결의 내역에서 숨기고 보고서에만 표시
    .filter(t => isReport || !isClosedApproved(t))
            .slice()
    .sort(isReport ? ((a,b) => (b.date||'').localeCompare(a.date||'')) : compareByResolution);

  const shown = filtered;

  shown.forEach(t=>{
    const tr = document.createElement('tr');
    tr.className = t.gubun==='수입' ? 'income-row' : 'expense-row';
    if(isReport){
      tr.innerHTML = `
        <td>${escapeHTML(formatEntryDate(t.date))}</td>
        <td>${escapeHTML(t.desc||'')}</td>
        <td>${escapeHTML(t.category||'-')}</td>
        <td>${escapeHTML(t.payee||t.spender||'-')}</td>
        <td class="num" style="color:var(--income)">${t.gubun==='수입'?fmtShort(t.amount):''}</td>
        <td class="num" style="color:var(--expense)">${t.gubun==='지출'?fmtShort(t.amount):''}</td>
        <td>${t.managementNo?escapeHTML(String(t.managementNo)):''}</td>
      `;
    } else {
      const resolutionNo = entryResolutionNo(t);
      const approvalNo = entryApprovalNo(t);
      tr.innerHTML = `
        <td>${resolutionNo ? escapeHTML(resolutionNo) : ''}</td>
        <td class="col-date">${escapeHTML(formatEntryDate(t.date))}</td>
        <td style="color:${t.gubun==='수입'?'var(--income)':'var(--expense)'}">${escapeHTML(t.gubun||'')}</td>
        <td>${escapeHTML(t.desc||'')}</td>
        <td>${escapeHTML(t.category||'-')}</td>
        <td>${escapeHTML(t.payee||'-')}</td>
        <td>${escapeHTML(t.spender||'-')}</td>
        <td class="num">${fmtShort(t.amount)}</td>
        <td><span class="status-badge status-${t.status}">${STATUS_LABEL[t.status]||t.status}</span></td>
        <td>${approvalNo ? escapeHTML(approvalNo) : ''}</td>
        <td class="col-actions-cell">${rowActions(t)}</td>
      `;
    }
    body.appendChild(tr);
  });
  if(isReport){
    const totalIncome = filtered.reduce((sum,entry)=>sum+(entry.gubun==='수입'?Number(entry.amount||0):0),0);
    const totalExpense = filtered.reduce((sum,entry)=>sum+(entry.gubun==='지출'?Number(entry.amount||0):0),0);
    document.getElementById('tx-report-total').innerHTML =
      `<tr class="report-total-row"><th colspan="4">합계 · ${filtered.length}건</th><td class="num">${fmtShort(totalIncome)}</td><td class="num">${fmtShort(totalExpense)}</td><td></td></tr>`;
  }

  let countText = `${monthSel} 거래 ${filtered.length.toLocaleString('ko-KR')}건`;
  if(!isReport && olderHasMore) countText += ' · 최근 내역만 불러온 상태입니다. 이전 내역은 아래 "더 보기"로 불러오세요.';
  document.getElementById(countId).textContent = countText;
  
  if(!isReport){
    bindRowActions(body);
  }
}

function rowActions(t){
  if(t.locked){
    return '<span class="locked-note">가져온 내역</span>';
  }
  const editButton = `<button class="btn-revert" data-act="edit" data-id="${escapeHTML(t.id)}">수정</button>`;
  if(['approved','paid','confirmed'].includes(t.status)){
    return `<div class="action-row">${editButton}<button class="btn-revert" data-act="unapprove" data-id="${escapeHTML(t.id)}">승인 취소</button></div>`;
  }
  const parts = [editButton];
  if(t.status==='submitted'){
    parts.push(`<button class="btn-reject" data-act="reject-submitted" data-id="${escapeHTML(t.id)}">반려</button>`);
  }
  if(t.status==='rejected') parts.push(`<button class="btn-revert" data-act="input-complete" data-id="${escapeHTML(t.id)}">입력 내역으로 복원</button>`);
  parts.push(`<button class="del-btn" data-act="delete" data-id="${escapeHTML(t.id)}">삭제</button>`);
  return `<div class="action-row">${parts.join('')}</div>`;
}
function bindRowActions(container){
  container.querySelectorAll('[data-act]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');
      if(act==='unapprove' && !(await confirmAction('승인을 취소하고 선택 내역을 결의완료 대기 목록으로 되돌리시겠습니까?',{title:'승인 취소',confirmLabel:'승인 취소',danger:true}))) return;
      if(act==='reject-submitted' && !(await confirmAction('이 내역을 반려하여 입력 내역으로 되돌리시겠습니까?',{title:'반려',confirmLabel:'반려',danger:true}))) return;
      if(act==='edit' && !(await confirmAction('이 내역을 입력 내역으로 되돌려 수정합니다.\n결의·승인 상태와 결의번호는 해제됩니다. 계속하시겠습니까?',{title:'수정',confirmLabel:'수정 진행'}))) return;
      if(act==='delete' && !(await confirmAction('이 내역을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',{title:'삭제',confirmLabel:'삭제',danger:true}))) return;
      const approvedStates = ['approved','paid','confirmed'];
      let editedEntry = null;
      try{
        await entryTransaction([id],(found,api)=>{
          const entry = found.get(id);
          if(!entry) throw stateChangedError('내역을 찾을 수 없습니다. 다른 담당자가 이미 삭제했을 수 있습니다.');
          if(entry.locked) throw stateChangedError('가져온 내역은 변경할 수 없습니다.');
          if(act==='delete'){
            if(approvedStates.includes(entry.status)) throw stateChangedError('승인된 내역은 삭제할 수 없습니다.');
            api.remove(id);
          }else if(act==='input-complete'){
            if(entry.status!=='rejected') throw stateChangedError('반려된 내역만 복원할 수 있습니다.');
            api.set({...entry,status:'input-complete'});
          }else if(act==='reject-submitted'){
            if(entry.status!=='submitted') throw stateChangedError('결의완료 내역만 반려할 수 있습니다.');
            const next = {...entry, status:'input-complete'};
            next.rejectedAt = new Date().toISOString();
            next.rejectedBy = currentUser?.email || currentUser?.displayName || '';
            ['managementNo','submissionSequence','submittedAt','submittedBy'].forEach(key=>delete next[key]);
            api.set(next);
          }else if(act==='edit'){
            if(entry.status==='input-complete') throw stateChangedError('이미 입력 내역에 있는 내역입니다.');
            if(typeof ShowMeDomain !== 'undefined'){
              const gate = ShowMeDomain.assertNotClosedForEdit({...entry, txnMonth: entry.acctMonth || monthNo(entry.month)}, closedThrough);
              if(!gate.ok) throw stateChangedError(gate.reason);
            }else if(approvedStates.includes(entry.status) && entry.acctMonth && monthNo(entry.acctMonth)<=closedThrough){
              throw stateChangedError(`${entry.acctMonth}월은 마감되어 수정할 수 없습니다. 마감을 취소한 뒤 시도해 주세요.`);
            }
            const next = {...entry, status:'input-complete', locked:false, editReopenedAt:new Date().toISOString(), editReopenedBy:currentUser?.email || currentUser?.displayName || ''};
            ['approvedAt','approvedBy','paidAt','paidBy','confirmedAt','confirmedBy','managementNo','submissionSequence','submittedAt','submittedBy','acctMonth','acctYear']
              .forEach(key=>delete next[key]);
            editedEntry = next;
            api.set(next);
          }else if(act==='unapprove'){
            if(!approvedStates.includes(entry.status)) throw stateChangedError('이미 승인 상태가 아닙니다.');
            if(typeof ShowMeDomain !== 'undefined'){
              const gate = ShowMeDomain.assertNotClosedForUnapprove(entry, closedThrough);
              if(!gate.ok) throw stateChangedError(gate.reason);
            }else if(entry.acctMonth && monthNo(entry.acctMonth)<=closedThrough){
              throw stateChangedError(`${entry.acctMonth}월은 마감되어 승인 취소할 수 없습니다. 마감을 취소한 뒤 시도해 주세요.`);
            }
            const next = {
              ...entry, status:'submitted', locked:false,
              approvalCancelledAt:new Date().toISOString(),
              approvalCancelledBy:currentUser?.email || currentUser?.displayName || ''
            };
            // 승인 취소 시 승인번호만 제거하고 결의번호(submissionSequence)는 유지
            ['approvedAt','approvedBy','paidAt','paidBy','confirmedAt','confirmedBy','acctMonth','acctYear']
              .forEach(key=>delete next[key]);
            if(next.submissionSequence != null && String(next.submissionSequence).trim() !== ''){
              next.managementNo = String(next.submissionSequence);
            } else {
              delete next.managementNo;
            }
            api.set(next);
          }
        });
        const msg = act==='unapprove' ? '승인을 취소해 결의완료 대기 목록으로 되돌렸습니다.'
          : act==='reject-submitted' ? '반려하여 입력 내역으로 되돌렸습니다.'
          : act==='edit' ? '입력 내역으로 옮겼습니다.'
          : '반영되어 공유 저장소에 저장됨';
        setStatus(msg);
      }catch(error){
        setStatus(`변경에 실패했습니다: ${error.message || String(error)}`,true);
      }
      renderReport();
      renderEntryView();
      // 입력 내역으로 옮긴 뒤 입력 폼에 불러와 바로 수정할 수 있게 함 (렌더 후 실행해야 폼 값이 유지됨)
      if(act==='edit' && editedEntry) beginEntryEdit(editedEntry);
    });
  });
}

function spenderPickerBar(entries){
  if(!entries.length) return '';
  const counts = new Map();
  entries.forEach(t=>{ const name=(t.spender||'').trim(); counts.set(name,(counts.get(name)||0)+1); });
  const names = [...counts.keys()].sort((x,y)=>(x===''?1:0)-(y===''?1:0) || x.localeCompare(y,'ko'));
  return `<div class="spender-picker" role="group" aria-label="담당자별 선택">
    <span class="spender-picker-label">담당자별 선택</span>
    ${names.map(name=>`<button type="button" class="spender-chip" data-spender-pick="${escapeHTML(name)}" aria-pressed="false">${escapeHTML(name||'미지정')} <small>${counts.get(name)}</small></button>`).join('')}
  </div>`;
}

function workflowTable(entries,status,checkedIds=new Set()){
  if(!entries.length) return '<p class="pending-empty">해당 상태의 내역이 없습니다.</p>';
  const clickable = status==='input-complete';
  const rows = entries.map((t,index)=>`
    <tr class="${t.gubun==='수입'?'income-row':'expense-row'}${clickable?' input-row-clickable':''}${clickable && t.id===editingEntryId?' input-row-editing':''}"${clickable?` data-entry-row="${escapeHTML(t.id)}" tabindex="0" title="클릭하면 위 입력 폼에서 수정할 수 있습니다"`:''}>
      <td class="workflow-select"><input type="checkbox" data-workflow-id="${escapeHTML(t.id)}" data-workflow-status="${status}" data-spender="${escapeHTML((t.spender||'').trim())}" aria-label="${escapeHTML(t.desc||t.id)} 선택"${checkedIds.has(t.id)?' checked':''}></td>
      <td class="workflow-index">${index+1}</td>
      <td>${escapeHTML(formatEntryDate(t.date))}</td>
      <td>${escapeHTML(t.gubun||'')}</td>
      <td>${escapeHTML(t.desc||'')}</td>
      <td>${escapeHTML(t.category||'-')}</td>
      <td>${escapeHTML(t.payee||'-')}</td>
      <td>${escapeHTML(t.spender||'미지정')}${t.managementNo?`<span class="management-number">${mgmtNoLabel(t)} ${escapeHTML(String(t.managementNo))}</span>`:''}</td>
      <td class="num">${fmtShort(t.amount)}</td>
    </tr>`).join('');
  return `<div class="table-scroll transaction-table-scroll">
    <table class="transaction-table pending-transaction-table">
      <thead><tr>
        <th class="workflow-select"><input type="checkbox" data-workflow-all="${status}" aria-label="전체 선택"></th>
        <th class="workflow-index">순번</th><th>결제일</th><th>구분</th><th>내용</th><th>목</th><th>지급처</th><th>담당자</th><th class="num">금액</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function groupSubmittedEntries(entries){
  const groups = new Map();
  entries.forEach(t=>{
    // 결의번호는 달마다 다시 시작하므로 '결의월:번호'로 묶는다
    const key = `${resolutionMonthKey(t)}:${entryResolutionNo(t) || t.managementNo || t.id}`;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return [...groups.entries()].map(([key, list])=>{
    list.sort((a,b)=>(a.date||'').localeCompare(b.date||'') || String(a.id).localeCompare(String(b.id)));
    const sum = list.reduce((s,e)=>s+Number(e.amount||0),0);
    const spender = (list[0].spender || '').trim() || '미지정';
    const submittedKey = entrySubmittedDateKey(list[0]);
    return {
      key, list, sum, spender, count:list.length,
      resolutionNo:entryResolutionNo(list[0]) || String(list[0].managementNo || ''),
      monthKey:resolutionMonthKey(list[0]),
      dateLabel:submittedKey ? formatEntryDate(submittedKey) : '-'
    };
  }).sort((a,b)=>{
    const na = Number(a.resolutionNo), nb = Number(b.resolutionNo);
    const fa = Number.isFinite(na) && a.resolutionNo!=='', fb = Number.isFinite(nb) && b.resolutionNo!=='';
    if(fa!==fb) return fa ? -1 : 1;
    return a.monthKey.localeCompare(b.monthKey) || (fa ? na-nb : 0) || (a.list[0]?.date||'').localeCompare(b.list[0]?.date||'');
  });
}

function submittedGroupsTable(groups, checkedIds=new Set()){
  if(!groups.length) return '<p class="pending-empty">해당 상태의 내역이 없습니다.</p>';
  const rows = groups.map(g=>{
    const ids = g.list.map(e=>e.id);
    const allChecked = ids.every(id=>checkedIds.has(id));
    const idsAttr = ids.map(id=>escapeHTML(id)).join(',');
    return `
    <tr class="submitted-group-row" data-group-key="${escapeHTML(g.key)}" style="cursor:pointer;">
      <td class="workflow-select"><input type="checkbox" data-workflow-group="${escapeHTML(g.key)}" data-workflow-ids="${idsAttr}" data-workflow-status="submitted" aria-label="${mgmtNoLabel(g.list[0])} ${escapeHTML(String(g.resolutionNo))} 선택"${allChecked?' checked':''}></td>
      <td class="workflow-index" data-label="결의번호"><strong>${escapeHTML(String(g.resolutionNo))}</strong></td>
      <td data-label="결의일">${escapeHTML(g.dateLabel)}</td>
      <td data-label="건수">${g.count}건</td>
      <td data-label="담당자">${escapeHTML(g.spender)}</td>
      <td class="num" data-label="합계">${fmtShort(g.sum)}</td>
    </tr>
    <tr class="submitted-group-detail hidden" data-group-detail="${escapeHTML(g.key)}">
      <td colspan="6" style="padding:0;background:var(--paper);">
        <div class="table-scroll" style="max-height:240px;">
          <table class="transaction-table pending-transaction-table" style="min-width:0;">
            <thead><tr><th>결제일</th><th>구분</th><th>내용</th><th>목</th><th>지급처</th><th class="num">금액</th></tr></thead>
            <tbody>
              ${g.list.map(t=>`
                <tr class="${t.gubun==='수입'?'income-row':'expense-row'}">
                  <td>${escapeHTML(formatEntryDate(t.date))}</td>
                  <td>${escapeHTML(t.gubun||'')}</td>
                  <td>${escapeHTML(t.desc||'')}</td>
                  <td>${escapeHTML(t.category||'-')}</td>
                  <td>${escapeHTML(t.payee||'-')}</td>
                  <td class="num">${fmtShort(t.amount)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </td>
    </tr>`;
  }).join('');
  return `<div class="table-scroll transaction-table-scroll">
    <table class="transaction-table pending-transaction-table">
      <thead><tr>
        <th class="workflow-select"><input type="checkbox" data-workflow-all="submitted" aria-label="전체 선택"></th>
        <th class="workflow-index">결의번호</th><th>결의일</th><th>건수</th><th>담당자</th><th class="num">합계 금액</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function updateSpenderButtons(){
  const boxes = [...document.querySelectorAll('[data-workflow-id][data-workflow-status="input-complete"]')];
  document.querySelectorAll('[data-spender-pick]').forEach(button=>{
    const name = button.dataset.spenderPick;
    const mine = boxes.filter(box=>(box.dataset.spender||'')===name);
    const active = mine.length>0 && boxes.every(box=>box.checked===((box.dataset.spender||'')===name));
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
}

function updateWorkflowSummary(status){
  if(status==='input-complete') updateSpenderButtons();
  const box = document.querySelector(`[data-workflow-summary="${status}"]`);
  if(!box) return;
  const boxes = [...document.querySelectorAll(`[data-workflow-id][data-workflow-status="${status}"], [data-workflow-group][data-workflow-status="${status}"]`)];
  const all = document.querySelector(`[data-workflow-all="${status}"]`);
  if(all) all.checked = boxes.length>0 && boxes.every(input=>input.checked);
  const entries = selectedWorkflowEntries(status);
  box.classList.remove('warn');
  if(!entries.length){ box.textContent = '선택한 내역이 없습니다.'; return; }
  const sum = list=>list.reduce((total,entry)=>total+Number(entry.amount||0),0);
  const expenses = entries.filter(entry=>entry.gubun==='지출');
  const incomes = entries.filter(entry=>entry.gubun==='수입');
  let text = `선택 ${entries.length}건 · 합계 ${fmt(sum(entries))}`;
  if(expenses.length && incomes.length) text += ` (지출 ${fmt(sum(expenses))} / 수입 ${fmt(sum(incomes))})`;
  const spenders = [...new Set(entries.map(entry=>(entry.spender||'').trim()))];
  if(spenders.length===1 && spenders[0]) text += ` · 담당자 ${spenders[0]}`;
  else{ text += ' · ⚠ 담당자가 한 사람이 아니어서 한 번에 처리할 수 없습니다'; box.classList.add('warn'); }
  box.textContent = text;
}

function bindWorkflowControls(root){
  if(!root) return;
  root.querySelectorAll('[data-workflow-action]').forEach(button=>{
    button.addEventListener('click',()=>{
      const action = button.dataset.workflowAction;
      if(action==='submit') updateSelectedWorkflow('input-complete','submitted');
      else if(action==='edit-input') editSelectedInputEntry();
      else if(action==='delete-input') deleteSelectedInputEntries();
      else if(action==='reject-submitted') updateSelectedWorkflow('submitted','input-complete');
      else if(action==='preview') openPaymentReport('submitted');
      else if(action==='payment') openPaymentReport('submitted');
    });
  });
  root.querySelectorAll('[data-workflow-id], [data-workflow-group]').forEach(input=>
    input.addEventListener('change',()=>updateWorkflowSummary(input.dataset.workflowStatus)));
  root.querySelectorAll('[data-workflow-all]').forEach(input=>
    input.addEventListener('change',()=>{
      const status = input.dataset.workflowAll;
      root.querySelectorAll(`[data-workflow-id][data-workflow-status="${status}"], [data-workflow-group][data-workflow-status="${status}"]`)
        .forEach(box=>box.checked = input.checked);
      updateWorkflowSummary(status);
    }));
  // 입력 내역: 체크박스가 아닌 행의 아무 곳이나 클릭하면 위 입력 폼에서 수정
  root.querySelectorAll('tr[data-entry-row]').forEach(row=>{
    const open = ()=>{
      const entry = ledger.find(item=>item.id===row.dataset.entryRow);
      if(!entry || entry.status!=='input-complete' || entry.locked) return;
      beginEntryEdit(entry);
    };
    row.addEventListener('click',event=>{
      if(event.target.closest('.workflow-select, input, button, a, select, textarea, label')) return;
      if(window.getSelection && String(window.getSelection())) return;   // 글자 드래그 선택 중이면 무시
      open();
    });
    row.addEventListener('keydown',event=>{
      if(event.key==='Enter' && event.target===row){ event.preventDefault(); open(); }
    });
  });
  // 담당자 버튼: 해당 담당자의 입력 내역만 체크
  root.querySelectorAll('[data-spender-pick]').forEach(button=>{
    button.addEventListener('click',()=>{
      const name = button.dataset.spenderPick;
      const boxes = [...root.querySelectorAll('[data-workflow-id][data-workflow-status="input-complete"]')];
      const mine = boxes.filter(box=>(box.dataset.spender||'')===name);
      const alreadyOnly = mine.length>0 && mine.every(box=>box.checked) && boxes.every(box=>box.checked===((box.dataset.spender||'')===name));
      boxes.forEach(box=>{ box.checked = alreadyOnly ? false : (box.dataset.spender||'')===name; });   // 한 번 더 누르면 선택 해제
      updateWorkflowSummary('input-complete');
    });
  });
  root.querySelectorAll('.submitted-group-row').forEach(row=>{
    row.addEventListener('click',event=>{
      if(event.target.closest('input[type="checkbox"]')) return;
      const key = row.dataset.groupKey;
      const detail = root.querySelector(`[data-group-detail="${key}"]`);
      if(detail) detail.classList.toggle('hidden');
    });
  });
}

function renderPendingBox(){
  const checkedIds = new Set([
    ...[...document.querySelectorAll('[data-workflow-id]:checked')].map(input=>input.dataset.workflowId),
    ...[...document.querySelectorAll('[data-workflow-group]:checked')].flatMap(input=>(input.dataset.workflowIds||'').split(',').filter(Boolean))
  ]);
  const byDate = (a,b)=>(b.date||'').localeCompare(a.date||'');
  // 마감 여부와 관계없이 입력·결의 대기 목록에 표시 (새 내역 입력은 항상 가능)
  const inputComplete = ledger.filter(t=>t.status==='input-complete' && !t.locked).sort(byDate);
  const submitted = ledger.filter(t=>t.status==='submitted' && !t.locked).sort(byDate);
  const submittedGroups = groupSubmittedEntries(submitted);
  document.getElementById('pending-count').textContent = inputComplete.length;
  const list = document.getElementById('pending-list');
  list.innerHTML = `
    <div class="workflow-stage">
      <h3>입력 내역 · 결의 대기 (${inputComplete.length}건)</h3>
      ${spenderPickerBar(inputComplete)}
      ${workflowTable(inputComplete,'input-complete',checkedIds)}
      <p class="workflow-summary" data-workflow-summary="input-complete" role="status"></p>
      <div class="workflow-actions">
        <button class="btn-primary" type="button" data-workflow-action="submit">결의</button>
        <button class="btn-revert" type="button" data-workflow-action="edit-input">수정</button>
        <button class="btn-reject" type="button" data-workflow-action="delete-input">삭제</button>
      </div>
    </div>
    <p class="count-note">한 번에 처리하는 선택 내역은 담당자가 모두 같아야 합니다.</p>`;
  bindRowActions(list);
  bindWorkflowControls(list);
  updateWorkflowSummary('input-complete');

  // 결의완료·지급 대기 상자는 전체 내역 아래 / 월 마감 위에 별도 렌더
  renderSubmittedBox(submittedGroups, submitted, checkedIds);
}

function renderSubmittedBox(submittedGroups, submitted, checkedIds){
  const box = document.getElementById('submitted-list');
  const countEl = document.getElementById('submitted-count');
  if(!box) return;
  if(countEl) countEl.textContent = submitted.length;
  box.innerHTML = `
    <div class="workflow-stage">
      <h3>지급 대기 (${submittedGroups.length}묶음 / ${submitted.length}건)</h3>
      ${submittedGroupsTable(submittedGroups, checkedIds)}
      <p class="workflow-summary" data-workflow-summary="submitted" role="status"></p>
      <div class="workflow-actions">
        <button class="btn-primary" type="button" data-workflow-action="payment">승인</button>
        <button class="btn-reject" type="button" data-workflow-action="reject-submitted">반려</button>
      </div>
    </div>
    <p class="count-note">한 번에 처리하는 선택 내역은 담당자가 모두 같아야 합니다. <span class="detail-hint">결의완료 묶음을 클릭하면 상세 내역을 확인할 수 있습니다.</span></p>`;
  bindRowActions(box);
  bindWorkflowControls(box);
  updateWorkflowSummary('submitted');
}

function selectedWorkflowEntries(status){
  const ids = new Set();
  document.querySelectorAll(`[data-workflow-id][data-workflow-status="${status}"]:checked`).forEach(input=>{
    ids.add(input.dataset.workflowId);
  });
  document.querySelectorAll(`[data-workflow-group][data-workflow-status="${status}"]:checked`).forEach(input=>{
    (input.dataset.workflowIds || '').split(',').filter(Boolean).forEach(id=>ids.add(id));
  });
  return [...ids].map(id=>ledger.find(entry=>entry.id===id)).filter(Boolean);
}

function editSelectedInputEntry(){
  const entries = selectedWorkflowEntries('input-complete');
  if(entries.length!==1){
    setStatus(entries.length ? '수정할 내역은 한 건만 선택해 주세요.' : '수정할 내역을 체크해 주세요.');
    return;
  }
  beginEntryEdit(entries[0]);
}

// 내역을 입력 폼에 불러와 수정 모드로 전환 (입력 내역 선택 수정 / 결의 내역 '수정' 버튼 공용)
function beginEntryEdit(entry){
  currentGubun = entry.gubun==='수입' ? '수입' : '지출';
  setGubun(currentGubun);
  const classification = JSON.stringify({gwan:entry.gwan||'',hang:entry.hang||'',mok:entry.category||''});
  const mokSelect = document.getElementById('f-mok');
  if(![...mokSelect.options].some(option=>option.value===classification)){
    setStatus('기존 세부 계정과목을 찾을 수 없어 수정 모드로 전환하지 못했습니다. 예산 관리에서 분류를 확인해 주세요.');
    return false;
  }
  editingEntryId = entry.id;
  document.getElementById('f-date').value = entry.date || '';
  document.getElementById('f-date-picker').value = entry.date || '';
  document.getElementById('f-desc').value = entry.desc || '';
  document.getElementById('f-payee').value = entry.payee || '';
  document.getElementById('f-spender').value = entry.spender || '';
  document.getElementById('f-amount').value = entry.amount ?? '';
  mokSelect.value = classification;
  document.getElementById('btn-add').textContent = '수정 저장';
  document.getElementById('btn-cancel-entry-edit').classList.remove('hidden');
  showExistingReceipt(entry);
  markEditingRow();
  setStatus('선택한 내역을 수정한 뒤 수정 저장을 눌러주세요.');
  document.querySelector('#view-entry .form-grid').scrollIntoView({behavior:'smooth',block:'center'});
  return true;
}

async function deleteSelectedInputEntries(){
  const entries = selectedWorkflowEntries('input-complete');
  if(!entries.length){ setStatus('삭제할 내역을 체크해 주세요.'); return; }
  if(!(await confirmAction(`입력완료 내역 ${entries.length}건을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,{title:'선택 삭제',confirmLabel:'삭제',danger:true}))) return;
    const ids = new Set(entries.map(entry=>entry.id));
  try{
    await entryTransaction([...ids],(found,api)=>{
      if(found.size!==ids.size || [...found.values()].some(entry=>entry.status!=='input-complete' || entry.locked)){
        throw stateChangedError('선택한 내역의 상태가 바뀌었습니다. 목록을 새로 확인해 주세요.');
      }
      ids.forEach(id=>api.remove(id));
    });
    setStatus(`${entries.length}건을 삭제했습니다.`);
  }catch(error){
    setStatus(`내역 삭제에 실패했습니다: ${error.message || String(error)}`,true);
  }
  renderReport();
  renderEntryView();
}

function requireSingleSpender(entries){
  const spenders = [...new Set(entries.map(entry=>(entry.spender||'').trim()))];
  if(spenders.length!==1 || !spenders[0]){
    const error = new Error('한 번에 처리할 선택 내역은 담당자가 한 사람으로 동일해야 합니다. 담당자를 입력한 뒤 다시 선택해 주세요.');
    error.code = 'accounting/spender-mismatch';
    throw error;
  }
  return spenders[0];
}

function highestSubmissionSequence(sourceLedger=ledger){
  return sourceLedger.reduce((max,entry)=>{
    const saved = Number(entry.submissionSequence);
const legacy = /^\d{1,8}$/.test(String(entry.managementNo||'')) ? Number(entry.managementNo) : 0;    return Math.max(max,Number.isSafeInteger(saved)?saved:0,Number.isSafeInteger(legacy)?legacy:0);
  },0);
}

// 결의월(YYYYMM)별 최고 결의번호 (월 카운터 문서가 아직 없을 때의 대비값)
function highestSubmissionSequenceForMonth(sourceLedger,monthKey){
  return sourceLedger.reduce((max,entry)=>{
    if(resolutionMonthKey(entry)!==monthKey) return max;
    const saved = Number(entry.submissionSequence);
    return Number.isSafeInteger(saved) ? Math.max(max,saved) : max;
  },0);
}

async function persistSubmissionBatch(entries,submittedAt,submittedBy){
  const ids = entries.map(entry=>entry.id);
  // 결의번호는 결의한 달마다 1번부터 다시 시작 (월별 카운터 문서)
  const submittedMonthKey = resolutionMonthKey({submittedAt});
  const sequenceRef = db.collection('accountingData').doc(`${SUBMISSION_SEQUENCE_KEY}:${submittedMonthKey}`);
  let assigned = 0;
  await entryTransaction(ids,async (found,api)=>{
    const targets = ids.map(id=>found.get(id)).filter(Boolean);
    if(targets.length!==ids.length || targets.some(entry=>entry.status!=='input-complete' || entry.locked)){
      throw stateChangedError('선택한 내역의 상태가 바뀌었거나 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해 주세요.');
    }
    requireSingleSpender(targets);
    const sequenceSnapshot = await api.tx.get(sequenceRef);
    const stored = sequenceSnapshot.exists ? Number(sequenceSnapshot.data().value) : highestSubmissionSequenceForMonth(ledger,submittedMonthKey);
    assigned = checkSequence(stored,'결의번호')+1;
    targets.forEach(entry=>api.set({
      ...entry, status:'submitted', submittedAt, submittedBy,
      submissionSequence:assigned, managementNo:String(assigned)
    }));
    api.tx.set(sequenceRef,{value:String(assigned),...writeMeta()});
  });
  return assigned;
}

function checkSequence(value,label){
  if(!Number.isSafeInteger(value) || value<0 || value>=Number.MAX_SAFE_INTEGER){
    throw new Error(`저장된 ${label} 일련번호가 올바르지 않습니다.`);
  }
  return value;
}
function paymentDateKey(date){
  return `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
}
function highestPaymentSequence(list,dateKey){
  const prefix = new RegExp(`^${dateKey}(\\d+)$`);
  return list.reduce((max,entry)=>{
    const match = prefix.exec(String(entry.managementNo||''));
    const sequence = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(sequence) ? Math.max(max,sequence) : max;
  },0);
}

async function peekPaymentNumber(date){
  const dateKey = paymentDateKey(date);
  const snapshot = await db.collection('accountingData').doc(`management-sequence:payment:${dateKey}`).get();
  const stored = snapshot.exists ? Number(snapshot.data().value) : highestPaymentSequence(ledger,dateKey);
  const sequence = checkSequence(stored,'지급 결의번호')+1;
  return {dateKey,sequence,managementNo:`${dateKey}${String(sequence).padStart(3,'0')}`};
}

async function commitPaymentApproval({ids,dateKey,sequence,approvalTime}){
  const sequenceRef = db.collection('accountingData').doc(`management-sequence:payment:${dateKey}`);
  const managementNo = `${dateKey}${String(sequence).padStart(3,'0')}`;
  const approvedBy = currentUser.email || currentUser.displayName || '';
  await entryTransaction(ids,async (found,api)=>{
    const sequenceSnapshot = await api.tx.get(sequenceRef);                       // read before any write
    const stored = checkSequence(
      sequenceSnapshot.exists ? Number(sequenceSnapshot.data().value) : highestPaymentSequence(ledger,dateKey),
      '지급 결의번호');
    if(stored+1!==sequence){
      const error = new Error('다른 담당자가 먼저 같은 결의번호를 사용했습니다.');
      error.code = 'accounting/sequence-conflict';
      throw error;
    }
    const targets = ids.map(id=>found.get(id)).filter(Boolean);
    if(targets.length!==ids.length || targets.some(entry=>entry.status!=='submitted')){
      throw stateChangedError('선택 내역의 상태가 바뀌었습니다. 보고서를 닫고 목록을 새로 확인해 주세요.');
    }
    requireSingleSpender(targets);
const ap = acctPeriod(approvalTime);
if(ap.year===currentYear && ap.month<=closedThrough){
  throw stateChangedError(`${ap.month}월은 이미 마감되어 승인할 수 없습니다. 마감을 취소하거나 열린 달에 승인해 주세요.`);
}
        
    const at = approvalTime.toISOString();
    targets.forEach(entry=>{
      const next = {
     ...entry, status:'approved', approvedAt:at, approvedBy,
  acctYear:acctPeriod(approvalTime).year,
  acctMonth:acctPeriod(approvalTime).month,
  managementNo
};
      if(entry.gubun==='수입'){ next.confirmedAt = at; next.confirmedBy = approvedBy; }
      else{ next.paidAt = at; next.paidBy = approvedBy; }
      api.set(next);
    });
    api.tx.set(sequenceRef,{value:String(sequence),...writeMeta()});
  });
  return managementNo;
}
const PDF_OPTIONS = {
  margin:8,
  image:{type:'jpeg',quality:0.98},
  html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},
  jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},
  pagebreak:{mode:['css','legacy']}
};

function safeFileName(text){ return String(text).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim(); }

async function buildReportPdfBlob(entries,spender,approval=null,managementNo=null){
  // 화면 안에 두되 맨 뒤로 보내고 가려서, 캡처는 되지만 사용자에게는 안 보이게 함
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:0;top:0;width:794px;z-index:-1;opacity:0;pointer-events:none;';
  const host = document.createElement('div');
  host.className = 'payment-report-sheet';
  host.style.cssText = 'width:794px;background:#fff;';
  wrapper.appendChild(host);
  document.body.appendChild(wrapper);
  try{
    renderPaymentReport(entries,spender,approval,managementNo,host);
    await host._receiptsReady;
    if(document.fonts?.ready) await document.fonts.ready;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));  // 렌더링 완료 대기
    window.scrollTo(0,0);
    return await window.html2pdf().set({
      ...PDF_OPTIONS,
      html2canvas:{...PDF_OPTIONS.html2canvas,scrollX:0,scrollY:0,windowWidth:794}
    }).from(host).outputPdf('blob');
  }finally{
    wrapper.remove();
  }
}

function downloadBlob(blob,fileName){
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

async function downloadReportPdf(ids,spender,prefix,approval=null,managementNo=null){
  if(typeof window.html2pdf!=='function'){
    throw new Error('PDF 생성 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.');
  }
  const entries = ids.map(id=>ledger.find(entry=>entry.id===id)).filter(Boolean);
  if(!entries.length) throw new Error('내역을 찾을 수 없습니다.');
  const total = entries.reduce((sum,entry)=>sum+Number(entry.amount||0),0);
  const fileName = `${prefix}_${paymentDateKey(new Date())}_${safeFileName(spender)}_${total}원.pdf`;
  downloadBlob(await buildReportPdfBlob(entries,spender,approval,managementNo),fileName);
  return fileName;
}

async function downloadReportFromDialog(){
  const status = document.getElementById('payment-report-status');
  try{
    const entries = paymentReportEntryIds.map(id=>ledger.find(entry=>entry.id===id)).filter(Boolean);
    const spender = requireSingleSpender(entries);
    status.textContent = 'PDF를 만드는 중입니다…';
    const approved = paymentReportApproval;
    const fileName = await downloadReportPdf(paymentReportEntryIds,spender,approved ? '승인보고서' : '보고서',approved?.approval||null,approved?.managementNo||null);
    status.textContent = `PDF를 저장했습니다: ${fileName}`;
  }catch(error){
    status.textContent = `PDF 생성 실패: ${error.message || String(error)}`;
  }
}
document.getElementById('btn-download-payment-report').addEventListener('click',downloadReportFromDialog);

async function updateSelectedWorkflow(fromStatus,toStatus){
  const entries = selectedWorkflowEntries(fromStatus);
  if(!entries.length){ setStatus('처리할 내역을 체크해 주세요.'); return; }
  const ids = entries.map(entry=>entry.id);
  const actor = currentUser?.email || currentUser?.displayName || '';
  const buttons = [...document.querySelectorAll('[data-workflow-action]')];
  try{
    const spender = requireSingleSpender(entries);
    buttons.forEach(button=>button.disabled = true);
    if(toStatus==='submitted'){
      const sequence = await persistSubmissionBatch(entries,new Date().toISOString(),actor);
      renderReport();
      renderEntryView();
      setStatus(`${spender} 담당자의 ${ids.length}건을 결의번호 ${sequence}로 결의했습니다.`);
      return;
    }
    const now = new Date().toISOString();
        await entryTransaction(ids,(found,api)=>{
      const targets = ids.map(id=>found.get(id)).filter(Boolean);
      if(targets.length!==ids.length || targets.some(entry=>entry.status!==fromStatus || entry.locked)){
        throw stateChangedError('선택한 내역의 상태가 바뀌었습니다. 목록을 새로 확인해 주세요.');
      }
      targets.forEach(entry=>{
        const next = {...entry,status:toStatus};
        if(toStatus==='input-complete' && fromStatus==='submitted'){
          // 반려: 결의완료 → 입력완료로 되돌림
          next.rejectedAt = now;
          next.rejectedBy = actor;
          ['managementNo','submissionSequence','submittedAt','submittedBy'].forEach(key=>delete next[key]);
        } else if(toStatus==='rejected'){
          next.rejectedAt = now;
          next.rejectedBy = actor;
          delete next.managementNo;
        }
        api.set(next);
      });
    });
    setStatus(`${spender} 담당자의 ${ids.length}건을 반려하여 입력완료로 되돌렸습니다.`);
    renderReport();
    renderEntryView();
  }catch(error){
    const message = error.code==='permission-denied'
      ? '공유 저장소 권한이 요청을 거부했습니다. 승인된 계정인지, Firestore 규칙이 허용하는지 확인해 주세요.'
      : error.message || String(error);
    setStatus(message,true);
  }finally{
    buttons.forEach(button=>button.disabled = false);
  }
}

// ---------- 월별 누적 보고서: 선택 월말 기준 관·항·목 예산 대비 실적 ----------
let currentMonthlyReportMonth = 0; // 1~12, 0 = 미선택
let monthlyReportDirty = false;     // 결산 내역이 바뀐 뒤 아직 월별 보고서에 반영 안 됨

/** 보고서 월 탭에 표시할 마지막 월 (오늘 날짜 기준 + 마감 월 반영) */
function maxReportMonthAvailable(){
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if(currentYear < y) return 12;
  if(currentYear > y) return Math.max(closedThrough, 0);
  // 당해 연도: 오늘 월까지. 마감이 더 앞서 있으면 그것도 포함
  return Math.max(m, closedThrough, 1);
}

function resetMonthlyReportView() {
  const titleEl = document.getElementById('report-title');
  const noteEl = document.getElementById('monthly-budget-note');
  const scrollBox = document.getElementById('monthly-budget-scroll');
  const mobileBox = document.getElementById('monthly-budget-mobile');
  if (titleEl) titleEl.textContent = '월을 선택하세요';
  if (scrollBox) scrollBox.style.display = 'none';
  if (mobileBox) mobileBox.classList.remove('is-ready');
  if (noteEl) noteEl.textContent = '상단 월 탭을 눌러 해당 월말 기준 누적 보고서를 조회하세요. 마감된 월은 「마감 완료」로 표시됩니다.';
}

// 월 버튼: 1월 ~ 오늘 해당 월까지 생성. 마감 월은 「마감 완료」 표시. 클릭 시 최신 승인 내역 기준 누적 조회
function renderReportTabs() {
  const container = document.getElementById('report-tabs-container');
  if (!container) return;

  const maxMonth = maxReportMonthAvailable();
  if (currentMonthlyReportMonth > maxMonth) {
    currentMonthlyReportMonth = 0;
    resetMonthlyReportView();
  }

  container.innerHTML = '';
  if (maxMonth < 1) {
    const empty = document.createElement('p');
    empty.className = 'report-tabs-empty';
    empty.textContent = '표시할 월이 없습니다.';
    container.appendChild(empty);
    return;
  }
  for (let m = 1; m <= maxMonth; m++) {
    const isClosed = m <= closedThrough;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'report-tab-btn'
      + (m === currentMonthlyReportMonth ? ' active' : '')
      + (isClosed ? ' is-closed' : '');
    btn.dataset.month = String(m);
    btn.innerHTML = isClosed
      ? `${m}월 <span class="badge-closed">마감 완료</span>`
      : `${m}월`;
    btn.title = isClosed
      ? `${m}월말 기준 누적 보고서 (마감 완료)`
      : `${m}월말 기준 누적 보고서 (최신 승인 내역 반영)`;
    btn.addEventListener('click', () => {
      currentMonthlyReportMonth = m;
      document.querySelectorAll('.report-tab-btn').forEach(b =>
        b.classList.toggle('active', Number(b.dataset.month) === m));
      loadMonthlyBudgetReport(m);
    });
    container.appendChild(btn);
  }
}

// 마감/마감 취소 뒤: 월 버튼을 다시 만들고, 선택이 비면 가장 최근 표시 가능 월을 선택
function syncMonthlyReportToClosure() {
  renderReportTabs();
  const maxMonth = maxReportMonthAvailable();
  if (currentMonthlyReportMonth === 0 && maxMonth > 0) {
    currentMonthlyReportMonth = maxMonth;
    renderReportTabs();
  }
  if (currentMonthlyReportMonth >= 1 && currentMonthlyReportMonth <= 12) {
    loadMonthlyBudgetReport(currentMonthlyReportMonth);
  }
}

/**
 * 선택 월(1~N)까지 승인된 실적을 누적해 연간 예산과 대비 표시.
 * 예산은 연간 예산(동일), 결산액만 1월~선택월 누적.
 */
async function loadMonthlyBudgetReport(throughMonth, {exact=false}={}) {
  const titleEl = document.getElementById('report-title');
  const noteEl = document.getElementById('monthly-budget-note');
  const scrollBox = document.getElementById('monthly-budget-scroll');
  const mobileBox = document.getElementById('monthly-budget-mobile');
  const tbody = document.getElementById('monthly-budget-body');
  const tfoot = document.getElementById('monthly-budget-total');
  if (!tbody) return;

  const year = currentYear;
  const n = Number(throughMonth);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    if (titleEl) titleEl.textContent = '월을 선택하세요';
    return;
  }

  monthlyReportDirty = false;
  if (titleEl) titleEl.textContent = year + '년 1월 ~ ' + n + '월 말 기준 · 관·항·목 예산 대비 실적';
  if (noteEl) noteEl.textContent = '승인 내역을 불러오는 중…';
  if (scrollBox) scrollBox.style.display = 'none';
  if (mobileBox) mobileBox.classList.remove('is-ready');
  tbody.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';

  try {
    // 기본: 이미 불러온 보고서 집계(읽기 비용 0). 집계가 없거나 '정밀 재조회'를 누르면 실제 승인 건을 읽음
    if (!exact && !reportSummary) await loadReportSummary();
    if (year !== currentYear) return;
    if (!exact && reportSummary) {
      const fromSummary = summaryToEntries(reportSummary).filter(c => {
        const m = monthNo(c.month);
        return m >= 1 && m <= n;
      });
      const count = fromSummary.reduce((s, c) => s + c._count, 0);
      renderMonthlyBudgetSection(fromSummary, n);
      if (scrollBox) scrollBox.style.display = '';
      if (mobileBox) mobileBox.classList.add('is-ready');
      if (noteEl) {
        noteEl.textContent =
          year + '년 1월~' + n + '월 승인 실적 누적 · ' + count.toLocaleString('ko-KR') + '건 (보고서 집계 기준)' +
          (n <= closedThrough ? ' · ' + n + '월까지 마감됨' : '') +
          ' · 예산은 연간 예산, 결산액은 해당 기간 거래일 기준 승인분 합계입니다.';
      }
      return;
    }

    // 정밀 조회: 집계 문서가 아닌 실제 승인 건을 거래 결제일 월 기준으로 합산
    const snapshot = await entriesRef(year).where('status', 'in', APPROVED_STATES).get();
    if (year !== currentYear) return;

    const cumulative = [];
    snapshot.docs.forEach(doc => {
      const t = doc.data();
      // 거래 결제일 기준 월 (승인월 아님)
      let m = entryTxnMonth(t);
      if (!m && t.month) m = monthNo(t.month);
      if (!m) return;
      if (m < 1 || m > n) return;
      // 날짜 연도가 있으면 회계연도와 일치하는 건만
      const dateYear = Number(String(t.date || '').slice(0, 4));
      if (dateYear && dateYear !== year) return;
      cumulative.push(t);
    });

    renderMonthlyBudgetSection(cumulative, n);
    if (scrollBox) scrollBox.style.display = '';
    if (mobileBox) mobileBox.classList.add('is-ready');
    if (noteEl) {
      noteEl.textContent =
        year + '년 1월~' + n + '월 승인 실적 누적 · ' + cumulative.length.toLocaleString('ko-KR') + '건 (전체 내역 직접 조회)' +
        (n <= closedThrough ? ' · ' + n + '월까지 마감됨' : '') +
        ' · 예산은 연간 예산, 결산액은 해당 기간 거래일 기준 승인분 합계입니다.';
    }
  } catch (err) {
    console.error('월별 예산 대비 실적 조회 오류:', err);
    if (noteEl) noteEl.textContent = '조회 실패: ' + (err.message || String(err));
  }
}

// ===MBR-START
// ---------- 월별 누적 보고서: 모바일 카드형 보기 (PC 표와 같은 데이터) ----------
let monthlyMobileRows = [];
let monthlyMobileThrough = 0;
let mbrVisibleKeys = [];
const mbrState = {onlyActive:true, onlyHigh:false, open:new Set()};

function mbrPct(b, s){ return b > 0 ? s / b * 100 : (s > 0 ? Infinity : 0); }
function mbrPctText(b, s){ return b > 0 ? (s / b * 100).toFixed(1) + '%' : (s > 0 ? '예산 없음' : '-'); }
function mbrLabel(name){ return String(name == null ? '' : name).replace(/_(관|항)$/, ''); }
function mbrLevel(type, b, s){
  if (type !== 'expense') return '';
  const pct = mbrPct(b, s);
  return pct >= 100 ? 'over' : (pct >= 80 ? 'warn' : '');
}
function mbrBar(type, b, s){
  const pct = mbrPct(b, s);
  const width = pct === Infinity ? 100 : Math.min(100, pct);
  return '<div class="mbr-bar"><i class="' + mbrLevel(type, b, s) + '" style="width:' + width.toFixed(1) + '%"></i></div>';
}
function mbrSum(rows){
  return rows.reduce((acc, r) => ({b: acc.b + r.b, s: acc.s + r.s}), {b: 0, s: 0});
}
function mbrRowVisible(r){
  if (mbrState.onlyActive && !r.s) return false;
  if (mbrState.onlyHigh){
    if (r.type !== 'expense') return false;
    if (!(mbrPct(r.b, r.s) >= 80)) return false;
  }
  return true;
}

function renderMonthlyMobile(){
  const box = document.getElementById('monthly-budget-mobile');
  if (!box) return;
  const list = box.querySelector('[data-mbr-list]');
  const rows = monthlyMobileRows;
  mbrVisibleKeys = [];
  let html = '';

  [['income', '수입'], ['expense', '지출']].forEach(([type, typeName]) => {
    const typeRows = rows.filter(r => r.type === type);
    if (!typeRows.length) return;
    const gwanOrder = [];
    const byGwan = new Map();
    typeRows.forEach(r => {
      if (!byGwan.has(r.gwan)) { byGwan.set(r.gwan, []); gwanOrder.push(r.gwan); }
      byGwan.get(r.gwan).push(r);
    });

    let section = '';
    gwanOrder.forEach(gwan => {
      const all = byGwan.get(gwan);
      const shown = all.filter(mbrRowVisible);
      if (!shown.length) return;
      const key = type + '|' + gwan;
      mbrVisibleKeys.push(key);
      const t = mbrSum(all);
      const mokCards = shown.map(r => {
        const level = mbrLevel(r.type, r.b, r.s);
        const remain = r.b - r.s;
        const detail = r.detail
          ? '<div class="mbr-detail">' + r.detail.split(/\\+n|\n/).filter(Boolean).map(escapeHTML).join('<br>') + '</div>'
          : '';
        return '<div class="mbr-mok">' +
          '<div class="mbr-mok-top"><span class="mbr-name">' + escapeHTML(mbrLabel(r.mok)) + '</span>' +
          '<span class="mbr-pct ' + level + '">' + mbrPctText(r.b, r.s) + '</span></div>' +
          '<div class="mbr-path">' + escapeHTML(mbrLabel(r.hang)) + '</div>' +
          mbrBar(r.type, r.b, r.s) +
          '<div class="mbr-nums3">' +
          '<span><em>예산</em>' + (r.b ? fmtShort(r.b) : '-') + '</span>' +
          '<span><em>결산</em>' + fmtShort(r.s) + '</span>' +
          '<span class="' + (remain < 0 ? 'neg' : '') + '"><em>잔여</em>' + (r.b ? fmtShort(remain) : '-') + '</span>' +
          '</div>' + detail + '</div>';
      }).join('');
      const gLevel = mbrLevel(type, t.b, t.s);
      section +=
        '<details class="mbr-gwan ' + type + '" data-mbr-key="' + escapeHTML(key) + '"' + (mbrState.open.has(key) ? ' open' : '') + '>' +
        '<summary>' +
        '<div class="mbr-mok-top"><span class="mbr-name">' + escapeHTML(mbrLabel(gwan)) + '</span>' +
        '<span class="mbr-pct ' + gLevel + '">' + mbrPctText(t.b, t.s) + '</span></div>' +
        mbrBar(type, t.b, t.s) +
        '<div class="mbr-nums2"><span>결산 <b>' + fmtShort(t.s) + '</b></span><span>예산 <b>' + (t.b ? fmtShort(t.b) : '-') + '</b></span>' +
        '<span class="mbr-count">' + shown.length + '개 목</span></div>' +
        '</summary><div class="mbr-body">' + mokCards + '</div></details>';
    });

    if (section) {
      const tt = mbrSum(typeRows);
      html += '<h4 class="mbr-type ' + type + '"><span>' + typeName + '</span>' +
        '<small>결산 ' + fmtShort(tt.s) + ' / 예산 ' + (tt.b ? fmtShort(tt.b) : '-') + ' · ' + mbrPctText(tt.b, tt.s) + '</small></h4>' + section;
    }
  });

  if (!rows.length) {
    html = '<p class="mbr-empty">등록된 예산 항목이 없습니다. 예산 탭에서 관·항·목을 등록해 주세요.</p>';
  } else if (!html) {
    html = '<p class="mbr-empty">조건에 맞는 항목이 없습니다. 위 필터를 꺼서 전체를 확인해 보세요.</p>';
  } else {
    const all = mbrSum(rows);
    html += '<div class="mbr-total"><span>전체 합계 (1~' + monthlyMobileThrough + '월 누적)</span>' +
      '<b>결산 ' + fmtShort(all.s) + ' / 예산 ' + fmtShort(all.b) + ' · ' + (all.b > 0 ? (all.s / all.b * 100).toFixed(1) + '%' : '-') + '</b></div>';
  }
  list.innerHTML = html;

  box.querySelectorAll('[data-mbr-filter]').forEach(btn => {
    const on = btn.dataset.mbrFilter === 'active' ? mbrState.onlyActive : mbrState.onlyHigh;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const expandBtn = box.querySelector('[data-mbr-expand]');
  if (expandBtn){
    const allOpen = mbrVisibleKeys.length > 0 && mbrVisibleKeys.every(k => mbrState.open.has(k));
    expandBtn.textContent = allOpen ? '모두 접기' : '모두 펴기';
    expandBtn.disabled = mbrVisibleKeys.length === 0;
  }
}
// ===MBR-END

function renderMonthlyBudgetSection(approvedList, throughMonth) {
  const spentByMok = {};
  approvedList.forEach(t => {
    if (t.gubun !== '수입' && t.gubun !== '지출') return;
    const type = t.gubun === '수입' ? 'income' : 'expense';
    const {gwan, hang, category} = resolveEntryClassification(t);
    const mokKey = mokBudgetKey(type, gwan || '미분류', hang || '미분류', category || '미분류');
    // 셀 금액은 이미 해당 관·항·목 합계 — 다른 목에 더하지 않음
    spentByMok[mokKey] = (spentByMok[mokKey] || 0) + Number(t.amount || 0);
  });

  const tbody = document.getElementById('monthly-budget-body');
  const tfoot = document.getElementById('monthly-budget-total');
  tbody.innerHTML = '';
  renderBudgetChart(spentByMok, throughMonth);   // 마지막 그래프도 같은 데이터로 갱신

  let totalBudget = 0, totalSettled = 0;
  let incomeBudget = 0, expenseBudget = 0, incomeSettled = 0, expenseSettled = 0;
  let rowCount = 0;
  const shownKeys = new Set();
  const mobileRows = [];

  const appendRow = (type, gwan, hang, mok, b, s, detail) => {
    mobileRows.push({type, gwan, hang, mok, b, s, detail: detail || ''});
    totalBudget += b;
    totalSettled += s;
    if (type === 'income') { incomeBudget += b; incomeSettled += s; }
    else { expenseBudget += b; expenseSettled += s; }
    const pct = b > 0 ? (s / b * 100) : (s > 0 ? Infinity : 0);
    const remain = b - s;
    const pctText = b > 0 ? pct.toFixed(1) + '%' : (s > 0 ? '예산 없음' : '-');
    const tr = document.createElement('tr');
    tr.className = 'budget-report-row ' + (type === 'income' ? 'income-row' : 'expense-row');
    if (detail) { tr.title = detail; tr.classList.add('budget-orphan-row'); }
    [type === 'income' ? '수입' : '지출', gwan, hang, mok].forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      tr.appendChild(cell);
    });
    const budgetCell = document.createElement('td');
    budgetCell.className = 'num';
    budgetCell.textContent = b ? fmtShort(b) : '-';
    tr.appendChild(budgetCell);
    const spentCell = document.createElement('td');
    spentCell.className = 'num';
    spentCell.textContent = fmtShort(s);
    tr.appendChild(spentCell);
    const pctCell = document.createElement('td');
    pctCell.className = 'num';
    pctCell.style.color = b > 0 && pct >= 100 ? 'var(--expense)' : 'inherit';
    pctCell.textContent = pctText;
    tr.appendChild(pctCell);
    const remainCell = document.createElement('td');
    remainCell.className = 'num';
    remainCell.style.color = remain < 0 ? 'var(--expense)' : 'var(--ink-soft)';
    remainCell.textContent = b ? fmtShort(remain) : '-';
    tr.appendChild(remainCell);
    tbody.appendChild(tr);
    rowCount++;
  };

  ['income', 'expense'].forEach(type => {
    (accountCategories[type] || []).forEach(gwan => {
      gwan.accounts.forEach(hang => {
        hang.items.forEach(mok => {
          const key = mokBudgetKey(type, gwan.name, hang.name, mok);
          shownKeys.add(key);
          appendRow(type, gwan.name, hang.name, mok, Number(budget[key]) || 0, spentByMok[key] || 0);
        });
      });
    });
  });

  const orphans = { income: { amount: 0, paths: [] }, expense: { amount: 0, paths: [] } };
  Object.entries(spentByMok).forEach(([key, amount]) => {
    if (shownKeys.has(key)) return;
    const parts = JSON.parse(key.slice(4));
    const type = parts[0], gwan = parts[1], hang = parts[2], mok = parts[3];
    orphans[type].amount += amount;
    orphans[type].paths.push(gwan + ' > ' + hang + ' > ' + mok + ': ' + fmtShort(amount));
  });
  ['income', 'expense'].forEach(type => {
    const o = orphans[type];
    if (!o.paths.length) return;
    appendRow(type, '미분류/삭제된 항목', '-', o.paths.length + '개 분류', 0, o.amount, o.paths.join('\\n'));
  });


  const totalRate = totalBudget > 0 ? ((totalSettled / totalBudget) * 100).toFixed(1) + '%' : '-';
  tfoot.innerHTML =
    '<tr class="report-total-row"><th colspan="4">전체 합계 (1~' + throughMonth + '월 누적)</th>' +
    '<td class="num">' + fmtShort(totalBudget) + '</td><td class="num">' + fmtShort(totalSettled) + '</td>' +
    '<td class="num">' + totalRate + '</td><td class="num">' + fmtShort(totalBudget - totalSettled) + '</td></tr>';

  if (!rowCount) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">등록된 예산 항목이 없습니다. 예산 탭에서 관·항·목을 등록해 주세요.</td></tr>';
  }

  monthlyMobileRows = mobileRows;
  monthlyMobileThrough = throughMonth;
  renderMonthlyMobile();
}

function openPaymentReport(status){
  const entries = selectedWorkflowEntries(status);
  if(!entries.length){
    setStatus('보고서로 처리할 내역을 체크해 주세요.');
    return;
  }
  openPaymentReportWithEntries(entries, status);
}

/** 보고서 탭 등에서 이미 모은 내역으로 지출내역보고 열기 (조회 전용 가능) */
function openPaymentReportWithEntries(entries, status='approved'){
  if(!entries?.length){
    setStatus('표시할 내역이 없습니다.', true);
    return;
  }
  try{
    const spender = requireSingleSpender(entries);
    paymentReportEntryIds = entries.map(entry=>entry.id);
    paymentReportSourceStatus = status;
    const approved = entries.every(e=>APPROVED_STATES.includes(e.status));
    let approval = null;
    if(approved){
      const at = entries.map(e=>e.approvedAt).filter(Boolean).sort().slice(-1)[0] || '';
      const by = entries.map(e=>e.approvedBy).filter(Boolean)[0] || '';
      const dateLabel = at ? formatEntryDate(String(at).slice(0,10)) : formatApprovalDate(entries[0]);
      approval = {
        label: '지급 승인 완료',
        date: dateLabel + (at && at.length > 10 ? ' ' + String(at).slice(11,16) : ''),
        approver: by
      };
      paymentReportApproval = {
        approval,
        managementNo: entries.find(e=>e.managementNo)?.managementNo || null
      };
    }else{
      paymentReportApproval = null;
    }
    const mgmtOverride = paymentReportApproval?.managementNo || null;
    renderPaymentReport(entries, spender, approval, mgmtOverride);
    const statusEl = document.getElementById('payment-report-status');
    const approveButton = document.getElementById('btn-approve-payment-report');
    if(status==='submitted'){
      approveButton?.classList.remove('hidden');
      if(statusEl) statusEl.textContent = '';
    }else{
      approveButton?.classList.add('hidden');
      if(statusEl) statusEl.textContent = approved
        ? '승인 완료된 지출내역보고입니다. PDF로 저장할 수 있습니다.'
        : '조회 모드입니다. 승인은 결의완료 목록에서 진행하세요.';
    }
    document.getElementById('payment-report-dialog').showModal();
  }catch(error){
    setStatus(error.message || String(error), error.code==='accounting/spender-mismatch');
  }
}

/** 세부 거래 내역 행 클릭 → 같은 승인번호 묶음 보고서 조회 */
function bindReportDetailClicks(){
  const body = document.getElementById('tx-body-report');
  if(!body || body.dataset.clickBound==='1') return;
  body.dataset.clickBound = '1';
  body.addEventListener('click', event=>{
    const tr = event.target.closest('tr[data-entry-id]');
    if(!tr) return;
    const month = currentMonthReport;
    const cache = reportMonthCache[month] || [];
    const mgmt = tr.dataset.managementNo;
    let group;
    if(mgmt){
      group = cache.filter(e=>String(e.managementNo||'')===mgmt);
    }else{
      const id = tr.dataset.entryId;
      group = cache.filter(e=>e.id===id);
    }
    if(!group.length){
      setStatus('해당 내역을 찾지 못했습니다. 보고서를 새로고침해 주세요.', true);
      return;
    }
    openPaymentReportWithEntries(group, 'approved');
  });
}

function renderPaymentReport(entries,spender,approval=null,managementNoOverride=null,target=document.getElementById('payment-report-sheet')){
  const ordered = entries.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||'') || String(a.id).localeCompare(String(b.id)));
  const total = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const requestDate = entries.map(entry=>entry.submittedAt).filter(Boolean).sort()[0]?.slice(0,10) || todayKey;
  const existingManagementNumbers = [...new Set(entries.map(entry=>entry.managementNo).filter(Boolean).map(String))];
  const managementNo = managementNoOverride || (existingManagementNumbers.length===1
    ? existingManagementNumbers[0]
    : existingManagementNumbers.length>1 ? `복수 (${existingManagementNumbers.length}개)` : '결의 후 부여');
  const mgmtLabel = entries.length && entries.every(entry=>isClosedApproved(entry)) ? '승인번호' : '결의번호';
  const bankDetails = staffBankDetails.find(detail=>detail.name===spender) || {bank:'',accountNumber:''};
  const sheet = target;                     
const rows = ordered.map((entry,index)=>`
    <tr class="report-row">      <td>${index+1}</td>
      <td>${escapeHTML(formatEntryDate(entry.date))}</td>
      <td colspan="2">${escapeHTML(entry.desc||'')}</td>
      <td colspan="2">${escapeHTML(entry.payee||'-')}</td>
      <td class="report-amount">${fmtShort(entry.amount)}</td>
      <td>${escapeHTML(entry.category||'-')}</td>
    </tr>`).join('');
  const approvalStamp = approval
    ? `<div class="payment-approval-stamp">${escapeHTML(approval.label||'지급 승인 완료')}<br><small>${escapeHTML(approval.date)}<br>${escapeHTML(approval.approver)}</small></div>`
    : '<span class="payment-report-note">승인 시 날인</span>';
  const paymentDate = approval ? escapeHTML(approval.date.split(' ')[0]) : '승인 후 기재';
  sheet.innerHTML = `
    <table class="payment-report-document">
      <colgroup>
        <col class="report-seq"><col class="report-date"><col style="width:15%"><col style="width:15%">
        <col style="width:10%"><col style="width:10%"><col class="report-amount"><col class="report-note">
      </colgroup>
      <tbody>
        <tr><td class="payment-report-management-cell" colspan="8"><div class="payment-report-management"><strong>${mgmtLabel}</strong><span>${escapeHTML(String(managementNo))}</span></div></td></tr>
        <tr><td class="payment-report-title-cell" colspan="8"><div class="payment-report-header">
          <h1>${entries.every(entry=>entry.gubun==='지출')?'지출내역보고 / 지급신청서':'거래내역 보고서'}</h1>
          <div class="payment-approval-grid" aria-label="결재란">
            <div class="payment-approval-cell"><span>검토</span><div class="payment-approval-signature"></div></div>
            <div class="payment-approval-cell"><span>지급 승인</span><div class="payment-approval-signature"></div>${approvalStamp}</div>
          </div>
        </div></td></tr>
        <tr><th>성명</th><td colspan="2">${escapeHTML(spender)}</td><th>은행명</th><td>${escapeHTML(bankDetails.bank||'미등록')}</td><th>예금주</th><td colspan="2">${escapeHTML(spender)}</td></tr>
        <tr><th>계좌번호</th><td colspan="3">${escapeHTML(bankDetails.accountNumber||'미등록')}</td><th>지급일</th><td colspan="3">${paymentDate}</td></tr>
        <tr><th>신청일</th><td>${escapeHTML(formatEntryDate(requestDate))}</td><th>신청자</th><td colspan="2">${escapeHTML(spender)}</td><th>서명</th><td colspan="2">________________</td></tr>
        <tr><td class="payment-report-section-title" colspan="8">지 출 목 록</td></tr>
        <tr><th class="report-seq">순번</th><th class="report-date">결제일</th><th colspan="2">내역</th><th colspan="2">지급처</th><th class="report-amount">금액</th><th class="report-note">비고</th></tr>
        ${rows}
      </tbody>
      <tfoot><tr><td class="report-total-label" colspan="6">합계 · ${entries.length}건</td><td class="report-total-amount">${fmt(total)}</td><td></td></tr></tfoot>
    </table>
    <div class="payment-report-receipts">
      <strong>영수증 첨부</strong>
      <div class="payment-report-receipt-box"></div>
    </div>
    ${approval
      ? `<p class="payment-report-note">승인자: ${escapeHTML(approval.approver)} · ${escapeHTML(approval.date)} · 지급 승인 도장이 포함된 보고서입니다.</p>`
      : '<p class="payment-report-note">승인하면 승인 도장이 포함된 보고서가 됩니다.</p>'}`;
  // 저장된 영수증을 비동기로 채움 (PDF 생성 시에는 이 promise를 기다린다)
  sheet._receiptsReady = fillReceiptBox(sheet,entries);
}

async function approvePaymentReport(){
  const button = document.getElementById('btn-approve-payment-report');
  const status = document.getElementById('payment-report-status');
  const ids = paymentReportEntryIds.slice();
  const entries = ids.map(id=>ledger.find(entry=>entry.id===id)).filter(Boolean);
  if(paymentReportSourceStatus!=='submitted'){
    status.textContent = '선택 내역 승인은 결의완료된 내역만 가능합니다.';
    return;
  }
  if(!entries.length || entries.length!==ids.length || entries.some(entry=>entry.status!=='submitted')){
    status.textContent = '선택 내역 상태가 바뀌었습니다. 보고서를 닫고 목록을 새로 확인해 주세요.';
    return;
  }
  let spender;
  try{ spender = requireSingleSpender(entries); }
  catch(error){ status.textContent = error.message; return; }

  button.disabled = true;
  status.textContent = '승인 처리 중…';
  try{
    const approvalTime = new Date();
    const approver = currentUser.displayName || currentUser.email || '로그인 사용자';
    const approvalDate = `${approvalTime.getFullYear()}-${String(approvalTime.getMonth()+1).padStart(2,'0')}-${String(approvalTime.getDate()).padStart(2,'0')}`;
    const approval = {
      date:`${formatEntryDate(approvalDate)} ${approvalTime.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`,
      approver, label:'승인 완료'
    };

    // 승인 상태를 Firestore에 반영
    let managementNo = '';
    let next = null;
    for(let attempt=1; attempt<=3; attempt++){
      next = await peekPaymentNumber(approvalTime);
      try{
        managementNo = await commitPaymentApproval({
          ids,
          dateKey:next.dateKey,
          sequence:next.sequence,
          approvalTime
        });
        break;
      }catch(error){
        if(error.code!=='accounting/sequence-conflict' || attempt>=3) throw error;
        status.textContent = '다른 담당자와 결의번호가 겹쳐 다시 시도 중…';
      }
    }

    // 화면 즉시 갱신: 지급 대기에서 사라지고 결의 내역에 승인으로 남음 (마감 전)
    paymentReportSourceStatus = 'approved';
    currentStatusEntry = '전체';
    currentMonthEntry = '전체';
    renderReport();
    renderEntryView();
    const approvedEntries = ids.map(id=>ledger.find(entry=>entry.id===id)).filter(Boolean);
    renderPaymentReport(approvedEntries,spender,approval,managementNo);
    paymentReportApproval = {approval, managementNo};   // PDF 다운로드 시 승인 도장 포함
    status.textContent = `승인 완료 (${mgmtNoLabel(approvedEntries[0] || {})} ${managementNo}). 결의 내역에 승인으로 표시됩니다. 도장이 찍힌 PDF는 ‘PDF 다운로드’ 버튼으로 저장할 수 있습니다.`;
    button.classList.add('hidden');
  }catch(error){
    status.textContent = `선택 내역 처리 실패: ${error.message || String(error)}`;
  }finally{
    button.disabled = false;
  }
}

function renderEntryView(){
    renderClosing();      // ← 추가
  renderPendingBox();
  renderStatusFilters();
  renderMonthFilters('month-filters-entry', ledger, currentMonthEntry, m=>{ currentMonthEntry=m; renderTxTable('entry'); });
  renderRecentEntryOptions();
  refreshMokOptions();
  renderTxTable('entry');
    updateLoadMoreButton();
}

function renderClosing(){
  const status = document.getElementById('closing-status');
  if(!status) return;
  const next = closedThrough+1;
  const unapproved = t=>!APPROVED_STATES.includes(t.status);
  const inNext = ledger.filter(t=>unapproved(t) && monthNo(t.month)===next && (t.date||'').startsWith(currentYear+'-')).length;
  const late = ledger.filter(t=>unapproved(t) && (t.date||'').startsWith(currentYear+'-') && monthNo(t.month)<=closedThrough).length;
  status.textContent = closedThrough ? `${currentYear}년 ${closedThrough}월까지 마감됨` : '마감된 달이 없습니다';
  let detail = next<=12 ? `${next}월 미승인 ${inNext}건 (마감해도 결산 관리에 그대로 남습니다)` : '12월까지 모두 마감되었습니다.';
  if(late) detail += ` · 마감된 달의 미승인 ${late}건이 남아 있습니다`;
  document.getElementById('closing-detail').textContent = detail;
  const closeBtn = document.getElementById('btn-close-month');
  closeBtn.textContent = `${next}월 마감하기`;
  closeBtn.classList.toggle('hidden', next>12);
  document.getElementById('btn-reopen-month').classList.toggle('hidden', closedThrough===0);
}

async function changeClosure(delta){
  const msg = document.getElementById('closing-msg');
  const expected = closedThrough, target = expected+delta;
  if(target<0 || target>12) return;
  const question = delta>0
    ? `${target}월을 마감합니다. ${target}월의 승인 내역은 결산 관리에서 숨겨지고 보고서에서만 보입니다. 계속할까요?`
    : `${expected}월 마감을 취소합니다. 계속할까요?`;
  if(!(await confirmAction(question,{
    title: delta>0 ? '월 마감' : '마감 취소',
    confirmLabel: delta>0 ? '마감하기' : '마감 취소',
    danger: delta>0
  }))) return;
  const ref = db.collection('accountingData').doc(closureKey(currentYear));
  try{
    await db.runTransaction(async tx=>{
      const snap = await tx.get(ref);
      const cur = snap.exists ? (JSON.parse(snap.data().value).closedThrough||0) : 0;
      if(cur!==expected) throw stateChangedError('다른 담당자가 마감 상태를 이미 바꿨습니다. 새로고침 후 다시 시도해 주세요.');
      tx.set(ref,{value:JSON.stringify({closedThrough:target,updatedAt:new Date().toISOString(),updatedBy:currentUser.email||''}),...writeMeta()});
    });
    closedThrough = target;
    await loadLedger();        // 새 기준으로 목록 다시 읽기
    renderReport();
    syncMonthlyReportToClosure();
    renderEntryView();
    msg.textContent = delta>0 ? `${target}월을 마감했습니다.` : `${expected}월 마감을 취소했습니다.`;
  }catch(error){
    msg.textContent = `처리 실패: ${error.message || String(error)}`;
  }
}

document.getElementById('btn-close-month').addEventListener('click',()=>changeClosure(+1));
document.getElementById('btn-reopen-month').addEventListener('click',()=>changeClosure(-1));
  
function renderStatusFilters(){
  const el = document.getElementById('status-filters-entry');
  el.innerHTML = '';
  const plainLabels = {
    submitted:'결의완료',
    approved:'승인',
    rejected:'반려됨'
  };
  const options = ['전체','submitted','approved','rejected'];
  options.forEach(s=>{
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (s===currentStatusEntry ? ' active' : '');
    btn.textContent = s==='전체' ? '전체' : (plainLabels[s] || s);
    btn.addEventListener('click', ()=>{ currentStatusEntry=s; renderEntryView(); });
    el.appendChild(btn);
  });
}

/**
 * 중요 액션 확인 (승인·마감·삭제 등). 모바일에서도 읽기 쉬운 모달.
 * window.confirm 대체. Promise<boolean>
 */
function confirmAction(message, options={}){
  const {
    title = '확인',
    confirmLabel = '확인',
    cancelLabel = '취소',
    danger = false
  } = options;
  const dialog = document.getElementById('app-confirm-dialog');
  if(!dialog || typeof dialog.showModal !== 'function'){
    return Promise.resolve(window.confirm(message));
  }
  const titleEl = document.getElementById('app-confirm-title');
  const msgEl = document.getElementById('app-confirm-message');
  const okBtn = document.getElementById('app-confirm-ok');
  const cancelBtn = document.getElementById('app-confirm-cancel');
  if(titleEl) titleEl.textContent = title;
  if(msgEl) msgEl.textContent = message;
  if(okBtn){
    okBtn.textContent = confirmLabel;
    okBtn.classList.toggle('btn-danger-confirm', !!danger);
  }
  if(cancelBtn) cancelBtn.textContent = cancelLabel;
  return new Promise(resolve=>{
    const done = (value)=>{
      okBtn?.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      if(dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = (e)=>{ e.preventDefault(); done(true); };
    const onCancel = (e)=>{ e.preventDefault(); done(false); };
    okBtn?.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}

function setStatus(msg,isError=false){
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.classList.toggle('status-error',isError);
  if(statusMessageTimer) clearTimeout(statusMessageTimer);
  statusMessageTimer = setTimeout(()=>{
    if(el.textContent===msg){
      el.textContent='';
      el.classList.remove('status-error');
    }
  },4000);
}

// ---------- form ----------
function setupDatalists(){
  renderRecentEntryOptions();
  refreshMokOptions();
}

function recentEntryDate(entry){
  const timestamp = Date.parse(entry.createdAt || entry.enteredAt || '');
  if(Number.isFinite(timestamp)) return timestamp;
  const date = /^(\d{4}-\d{2}-\d{2})$/.exec(entry.date||'');
  return date ? Date.parse(`${date[1]}T12:00:00`) : NaN;
}

function recentEntryValues(property){
  const now = Date.now();
  const cutoff = now - 30*24*60*60*1000;
  const seen = new Set();
  return ledger
    .map(entry=>({value:String(entry[property]||'').trim(),timestamp:recentEntryDate(entry)}))
    .filter(item=>item.value && Number.isFinite(item.timestamp) && item.timestamp>=cutoff && item.timestamp<=now)
    .sort((a,b)=>b.timestamp-a.timestamp)
    .filter(item=>{
      const normalized = item.value.toLocaleLowerCase('ko-KR');
      if(seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0,5)
    .map(item=>item.value);
}

function renderRecentEntryOptions(){
  const spenderList = document.getElementById('staff-name-options');
  const payeeList = document.getElementById('recent-payee-options');
  const descList = document.getElementById('dl-desc');
  const amountList = document.getElementById('dl-amount');
  if(descList){
    descList.replaceChildren();
    recentEntryValues('desc').forEach(v=>{
      const option=document.createElement('option');
      option.value=v;
      descList.appendChild(option);
    });
  }
  if(amountList){
    amountList.replaceChildren();
    recentEntryValues('amount').forEach(v=>{
      const option=document.createElement('option');
      option.value=v;
      amountList.appendChild(option);
    });
  }
  if(spenderList){
    spenderList.replaceChildren();
    [...recentEntryValues('spender'),...staffNames].filter((name,index,all)=>name && all.indexOf(name)===index)
      .forEach(name=>{
        const option=document.createElement('option');
        option.value=name;
        spenderList.appendChild(option);
      });
  }
  if(payeeList){
    payeeList.replaceChildren();
    recentEntryValues('payee').forEach(value=>{
      const option=document.createElement('option');
      option.value=value;
      payeeList.appendChild(option);
    });
  }
}

function parseEntryDate(value){
  const raw = String(value||'').trim();
  const normalized = /^\d{8}$/.test(raw)
    ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`
    : raw.replace(/[./]/g,'-');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if(!match) return '';
  const [,year,month,day] = match;
  const parsed = new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
  if(parsed.getUTCFullYear()!==Number(year) || parsed.getUTCMonth()!==Number(month)-1 || parsed.getUTCDate()!==Number(day)){
    return '';
  }
  return normalized;
}

function refreshMokOptions(){
  const select = document.getElementById('f-mok');
  if(!select) return;
  const type = currentGubun==='수입' ? 'income' : 'expense';
  const previousValue = select.value;
  select.innerHTML = '';
  let matchedPrevious = false;
  const recentClassificationKeys = new Set();
  const recentClassifications = ledger
    .filter(entry=>(entry.gubun==='수입'?'income':'expense')===type)
    .map(entry=>({entry,timestamp:recentEntryDate(entry)}))
    .filter(item=>Number.isFinite(item.timestamp) && item.timestamp>=Date.now()-30*24*60*60*1000 && item.timestamp<=Date.now())
    .sort((a,b)=>b.timestamp-a.timestamp)
    .map(({entry})=>{
      const group = accountCategories[type].find(item=>normalizeCategoryName(item.name,'_관')===normalizeCategoryName(entry.gwan,'_관'));
      const account = group?.accounts.find(item=>normalizeCategoryName(item.name,'_항')===normalizeCategoryName(entry.hang,'_항'));
      const mok = account?.items.find(item=>item===entry.category);
      return group && account && mok && mok!=='대학노조회비'
        ? {group,account,mok,value:JSON.stringify({gwan:group.name,hang:account.name,mok})}
        : null;
    })
    .filter(Boolean)
    .filter((item,index,all)=>all.findIndex(other=>other.value===item.value)===index)
    .slice(0,5);
  // 실제로 '최근' 그룹에 표시되는 항목만 아래 전체 목록에서 제외한다
  recentClassifications.forEach(item=>recentClassificationKeys.add(item.value));
  if(recentClassifications.length){
    const optgroup=document.createElement('optgroup');
    optgroup.label='최근 1개월 선택';
    recentClassifications.forEach(item=>{
      const option=document.createElement('option');
      option.value=item.value;
      option.textContent=`${item.mok} · ${normalizeCategoryName(item.group.name,'_관')} / ${normalizeCategoryName(item.account.name,'_항')}`;
      if(option.value===previousValue) matchedPrevious=true;
      optgroup.appendChild(option);
    });
    select.appendChild(optgroup);
  }
  [...accountCategories[type]]
    .sort((a,b)=>a.name.replace(/_관$/,'').localeCompare(b.name.replace(/_관$/,''),'ko'))
    .forEach(gwan=>{
      const items = gwan.accounts.flatMap(hang=>
        hang.items.map(mok=>({hang,mok}))
      ).filter(({mok})=>mok.trim()!=='대학노조회비')
        .sort((a,b)=>a.mok.localeCompare(b.mok,'ko') || a.hang.name.localeCompare(b.hang.name,'ko'));
      if(!items.length) return;
      const optgroup = document.createElement('optgroup');
      optgroup.label = gwan.name.replace(/_관$/,'');
      items.forEach(({hang,mok})=>{
        const option = document.createElement('option');
        option.value = JSON.stringify({gwan:gwan.name,hang:hang.name,mok});
        option.textContent = mok;
        if(recentClassificationKeys.has(option.value)) return;
        if(option.value===previousValue) matchedPrevious = true;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
  if(matchedPrevious) select.value = previousValue;
  if(!select.options.length){
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '예산 관리에서 목을 먼저 등록해주세요';
    select.appendChild(option);
  }
}

function hasAccount(type, classification){
  if(classification.mok==='대학노조회비') return false;
  return (accountCategories[type] || []).some(gwan=>
    gwan.name===classification.gwan && (gwan.accounts || []).some(hang=>
      hang.name===classification.hang && (hang.items || []).includes(classification.mok)
    )
  );
}

function setGubun(g){
  currentGubun = g;
  document.getElementById('btn-gubun-income').classList.toggle('selected', g==='수입');
  document.getElementById('btn-gubun-expense').classList.toggle('selected', g==='지출');
  refreshMokOptions();
}

async function addEntry(){
  const date = parseEntryDate(document.getElementById('f-date').value);
  const amountRaw = document.getElementById('f-amount').value;
  const desc = document.getElementById('f-desc').value.trim();
  const payee = document.getElementById('f-payee').value.trim();
  let classification;
  try{ classification = JSON.parse(document.getElementById('f-mok').value); }catch(e){ classification = null; }
  const spender = document.getElementById('f-spender').value.trim();

  if(!date){
    setStatus('결제일을 YYYY-MM-DD 또는 YYYYMMDD 형식으로 입력하거나 달력에서 선택해주세요.', true);
    return;
  }
  if(!amountRaw || !desc){
    setStatus('금액과 내용은 필수입니다.', true);
    return;
  }
  // 회계연도와 다른 연도(전년도 등) 날짜도 입력 가능하도록 허용
  if(date > fyEnd(currentYear)){
    setStatus(`${currentYear} 회계연도 이후 날짜는 입력할 수 없습니다.`, true);
    return;
  }
const amount = Number(amountRaw);
if(!Number.isFinite(amount) || !Number.isInteger(amount) || amount===0){
  setStatus('금액은 0이 아닌 정수로 입력해주세요. 환불·반환은 음수로 입력합니다.', true);
  return;
}
  if(!classification || !hasAccount(currentGubun==='수입' ? 'income' : 'expense',classification)){
    setStatus('예산 관리에서 등록된 목을 선택해주세요.', true);
    return;
  }
     const month = (parseInt(date.split('-')[1],10)) + '월';

  let receiptPayload = null;
  if(selectedReceiptFile){
    try{ receiptPayload = await buildReceiptPayload(selectedReceiptFile); }
    catch(error){ setStatus(`영수증을 처리하지 못했습니다: ${error.message || String(error)}`,true); return; }
  }
  const receiptRemove = !!editingEntryId && receiptRemoveOnSave && !receiptPayload;

  const values = {
    date, month, gubun:currentGubun, desc, payee, spender, amount,
    gwan:classification.gwan, hang:classification.hang, category:classification.mok
  };

  if(editingEntryId){
    const editId = editingEntryId;
    try{
      if(receiptPayload) await saveReceipt(editId,receiptPayload);
      await entryTransaction([editId],(found,api)=>{
        const entry = found.get(editId);
        if(!entry || entry.status!=='input-complete' || entry.locked){
          throw stateChangedError('선택한 내역은 더 이상 수정할 수 없습니다. 목록을 새로 확인해 주세요.');
        }
        api.set(applyReceiptMeta({...entry,...values},receiptPayload,receiptRemove));
      });
    }catch(error){
      if(error.code==='accounting/state-changed') cancelEntryEdit();
      setStatus(`수정한 내역을 저장하지 못했습니다: ${error.message || String(error)}`,true);
      renderEntryView();
      return;
    }
    if(receiptRemove) deleteReceiptsQuiet(currentYear,[editId]);
    cancelEntryEdit();
    setStatus('내역을 수정했습니다.');
  }else{
    const entry = {
      id:'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      ...values,
      createdAt:new Date().toISOString(),
      locked:false,
      status:'input-complete'
    };
    try{
      if(receiptPayload){
        await saveReceipt(entry.id,receiptPayload);
        applyReceiptMeta(entry,receiptPayload,false);
      }
      await entryTransaction([entry.id],(found,api)=>{
        if(found.has(entry.id)) throw stateChangedError('같은 id의 내역이 이미 있습니다. 다시 시도해 주세요.');
        api.set(entry);
      });
    }catch(error){
      setStatus(`내역 저장에 실패했습니다: ${error.message || String(error)}`,true);
      renderEntryView();
      return;
    }
    clearEntryForm();
    setStatus('내역이 입력 내역으로 등록되었습니다.');
  }
  renderReport();
  renderEntryView();
}

function clearEntryForm(){
  document.getElementById('f-date').value = '';
  document.getElementById('f-date-picker').value = '';
  document.getElementById('f-amount').value = '';
  document.getElementById('f-desc').value = '';
  document.getElementById('f-payee').value = '';
  document.getElementById('f-spender').value = '';
  receiptRemoveOnSave = false;
  resetReceiptInput();
}

function markEditingRow(){
  document.querySelectorAll('tr[data-entry-row]').forEach(row=>row.classList.toggle('input-row-editing',row.dataset.entryRow===editingEntryId));
}

function cancelEntryEdit(clearForm=true){
  editingEntryId = '';
  markEditingRow();
  if(clearForm) clearEntryForm();
  document.getElementById('btn-add').textContent = '내역 추가';
  document.getElementById('btn-cancel-entry-edit').classList.add('hidden');
}

// ---------- tabs ----------
function activateTab(view){
  const button = [...document.querySelectorAll('.tab-btn')].find(btn=>btn.dataset.view===view);
  const panel = document.getElementById('view-' + view);
  if(!button || !panel) return false;

  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b===button));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v===panel));
    if(view==='report' && appReady){
      renderReport();
      if(monthlyReportDirty && currentMonthlyReportMonth>=1 && currentMonthlyReportMonth<=12){
        loadMonthlyBudgetReport(currentMonthlyReportMonth);
      }
    }
  return true;
}

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(activateTab(btn.dataset.view)){
      window.history.replaceState(null, '', '#' + btn.dataset.view);
      lsSet('tab', btn.dataset.view);
    }
  });
});

document.getElementById('btn-export-ledger').addEventListener('click',exportLedgerBackup);
document.getElementById('btn-gubun-income').addEventListener('click', ()=>setGubun('수입'));
document.getElementById('btn-gubun-expense').addEventListener('click', ()=>setGubun('지출'));
document.getElementById('btn-add').addEventListener('click', addEntry);
document.getElementById('btn-cancel-entry-edit').addEventListener('click',()=>{
  cancelEntryEdit();
  setStatus('수정을 취소했습니다.');
});
document.getElementById('f-date-picker').addEventListener('change',event=>{
  document.getElementById('f-date').value=event.target.value;
});
document.getElementById('f-date').addEventListener('blur',event=>{
  const date=parseEntryDate(event.target.value);
  if(date){
    event.target.value=date;
    document.getElementById('f-date-picker').value=date;
  }
});
document.getElementById('btn-open-date-picker').addEventListener('click',()=>{
  const picker=document.getElementById('f-date-picker');
  try{
    if(typeof picker.showPicker==='function') picker.showPicker();
    else{ picker.focus(); picker.click(); }
  }catch(_e){
    picker.focus();
    picker.click();
  }
});
/* 달력 오버레이 직접 탭해도 동작 (모바일) */
document.getElementById('f-date-picker').addEventListener('click',event=>{
  try{
    if(typeof event.currentTarget.showPicker==='function') event.currentTarget.showPicker();
  }catch(_e){ /* ignore */ }
});
document.getElementById('year-select').addEventListener('change',event=>setYear(event.target.value));
document.getElementById('account-balance-input').addEventListener('input',event=>formatBudgetInput(event.target));
document.getElementById('btn-save-account-balance').addEventListener('click',saveAccountBalance);
document.getElementById('btn-add-staff-name').addEventListener('click',addStaffName);
document.getElementById('staff-sort-select').addEventListener('change',event=>{
  staffSortMode = event.target.value;
  lsSet('staff-sort', staffSortMode);
  renderStaffNames();
});
document.getElementById('transfer-group-filter').addEventListener('change',event=>{
  transferState.group = event.target.value;
  renderTransferSection();
});
document.getElementById('transfer-recv-memo').addEventListener('input',event=>{ transferState.recvMemo = event.target.value; });
document.getElementById('transfer-my-memo').addEventListener('input',event=>{ transferState.myMemo = event.target.value; });
document.getElementById('btn-transfer-bulk').addEventListener('click',()=>{
  const status = document.getElementById('transfer-status');
  const input = document.getElementById('transfer-bulk-amount');
  const amount = parseTransferAmount(input.value);
  if(!amount){ status.textContent = '일괄 적용할 금액을 숫자로 입력해 주세요.'; return; }
  const rows = visibleTransferRows();
  rows.forEach(r=>{ transferState.amounts[r.name] = String(amount); });
  renderTransferSection();
  status.textContent = `표시 중인 ${rows.length}명에게 ${fmt(amount)}을 적용했습니다.`;
});
document.getElementById('btn-transfer-download').addEventListener('click',downloadTransferFile);
(function(){
  const container = document.getElementById('quick-template-container');
  if(!container) return;
  container.addEventListener('click',event=>{
    const useBtn = event.target.closest('[data-template-id]');
    if(useBtn){ applyTemplate(useBtn.dataset.templateId); return; }
    const removeBtn = event.target.closest('[data-qt-remove]');
    if(removeBtn){
      collectTemplateDraft();
      templateDraft.splice(Number(removeBtn.dataset.qtRemove),1);
      renderTemplateEditor();
      return;
    }
    const id = event.target.closest('button')?.id;
    if(id==='btn-template-manage') openTemplateEditor();
    else if(id==='btn-template-close') document.getElementById('template-editor').classList.add('hidden');
    else if(id==='btn-template-save') saveTemplates();
    else if(id==='btn-template-add' || id==='btn-template-add-form'){
      collectTemplateDraft();
      if(templateDraft.length>=MAX_QUICK_TEMPLATES){ setTemplateStatus(`템플릿은 최대 ${MAX_QUICK_TEMPLATES}개까지 만들 수 있습니다.`, true); return; }
      let base = {};
      if(id==='btn-template-add-form'){
        let cls = null;
        try{ const c = JSON.parse(document.getElementById('f-mok').value||'null'); cls = c && c.mok && currentGubun==='지출' ? c : null; }catch(e){}
        base = {
          cls,
          desc:document.getElementById('f-desc').value.trim(),
          payee:document.getElementById('f-payee').value.trim(),
          spender:document.getElementById('f-spender').value.trim(),
          amount:/^-?\d+$/.test(document.getElementById('f-amount').value.replace(/[,\s]/g,'')) ? document.getElementById('f-amount').value.replace(/[,\s]/g,'') : ''
        };
      }
      templateDraft.push(newTemplateDraft(base));
      renderTemplateEditor();
      setTemplateStatus('');
      const items = document.querySelectorAll('#template-editor-list .qt-item');
      const last = items[items.length-1];
      if(last) last.querySelector('[data-qt="name"]').focus();
    }
  });
})();
(function(){
  const box = document.getElementById('monthly-budget-mobile');
  if(!box) return;
  box.addEventListener('click',event=>{
    const filter = event.target.closest('[data-mbr-filter]');
    if(filter){
      if(filter.dataset.mbrFilter==='active') mbrState.onlyActive = !mbrState.onlyActive;
      else mbrState.onlyHigh = !mbrState.onlyHigh;
      renderMonthlyMobile();
      return;
    }
    if(event.target.closest('[data-mbr-expand]')){
      const allOpen = mbrVisibleKeys.length>0 && mbrVisibleKeys.every(k=>mbrState.open.has(k));
      if(allOpen) mbrVisibleKeys.forEach(k=>mbrState.open.delete(k));
      else mbrVisibleKeys.forEach(k=>mbrState.open.add(k));
      renderMonthlyMobile();
    }
  });
  // details의 열림/닫힘 상태를 기억 (필터를 바꿔도 유지)
  box.addEventListener('toggle',event=>{
    const d = event.target;
    if(!d || !d.matches || !d.matches('details[data-mbr-key]')) return;
    if(d.open) mbrState.open.add(d.dataset.mbrKey); else mbrState.open.delete(d.dataset.mbrKey);
    const expandBtn = box.querySelector('[data-mbr-expand]');
    if(expandBtn){
      const allOpen = mbrVisibleKeys.length>0 && mbrVisibleKeys.every(k=>mbrState.open.has(k));
      expandBtn.textContent = allOpen ? '모두 접기' : '모두 펴기';
    }
  },true);
})();
document.getElementById('transfer-list').addEventListener('input',event=>{
  const input = event.target.closest('[data-transfer-amount]');
  if(!input) return;
  transferState.amounts[input.dataset.transferAmount] = input.value;
  updateTransferSummary();
});
document.getElementById('transfer-list').addEventListener('change',event=>{
  const check = event.target.closest('[data-transfer-check]');
  if(!check) return;
  if(check.checked) transferState.skip.delete(check.dataset.transferCheck);
  else transferState.skip.add(check.dataset.transferCheck);
  updateTransferSummary();
});
document.getElementById('staff-name-list').addEventListener('click',event=>{
  const saveButton = event.target.closest('[data-save-staff-profile]');
  if(saveButton){
    saveStaffBankDetails(saveButton.dataset.saveStaffProfile);
    return;
  }
  // 삭제 버튼만 처리 (input의 data-staff-name과 혼동되지 않도록)
  const removeButton = event.target.closest('button.del-btn[data-staff-name]');
  if(removeButton) removeStaffName(removeButton.dataset.staffName);
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Enter' || event.isComposing) return;
  const input = event.target;
  if(!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;

  let actionButton = null;
  if(input.id==='account-balance-input'){
    actionButton = document.getElementById('btn-save-account-balance');
  } else if(input.id==='staff-name-input'){
    actionButton = document.getElementById('btn-add-staff-name');
  } else if(input.matches('[data-staff-field]')){
    actionButton = input.closest('tr[data-staff-row]')?.querySelector('[data-save-staff-profile]');
  } else if(input.matches('#f-date, #f-amount, #f-spender, #f-desc, #f-payee')){
    actionButton = document.getElementById('btn-add');
  } else if(input.closest('.hierarchy-item-row')){
    actionButton = document.getElementById('btn-save-hierarchy');
  }

  if(actionButton){
    event.preventDefault();
    actionButton.click();
  }
});
document.getElementById('btn-sign-in').addEventListener('click', signInWithGoogle);
document.getElementById('gate-sign-in').addEventListener('click', signInWithGoogle);
document.getElementById('btn-sign-out').addEventListener('click', signOut);
document.getElementById('btn-approve-payment-report').addEventListener('click',approvePaymentReport);
document.querySelectorAll('[data-close-payment-report]').forEach(button=>
  button.addEventListener('click',()=>document.getElementById('payment-report-dialog').close())
);

document.getElementById('btn-add-hierarchy-row').addEventListener('click', ()=>{
  const row = createHierarchyRow();
  document.getElementById('hierarchy-form-body').appendChild(row);
  updateHierarchyBudgetTotals();
  row.querySelector('.hierarchy-gwan-name').focus();
});

document.getElementById('hierarchy-form-body').addEventListener('click', event=>{
  const removeButton = event.target.closest('.hierarchy-row-delete');
  if(removeButton){
    removeButton.closest('.hierarchy-item-row').remove();
    updateHierarchyBudgetTotals();
  }
});
document.getElementById('hierarchy-form-body').addEventListener('change', event=>{
  const typeSelect = event.target.closest('.hierarchy-category-type');
  if(!typeSelect) return;
  typeSelect.closest('.hierarchy-item-row').classList.toggle('income-row',typeSelect.value==='income');
  typeSelect.closest('.hierarchy-item-row').classList.toggle('expense-row',typeSelect.value==='expense');
  repositionHierarchyRows();
  updateHierarchyBudgetTotals();
});
document.getElementById('hierarchy-form-body').addEventListener('input', event=>{
  if(event.target.matches('.hierarchy-item-budget')){
    formatBudgetInput(event.target);
    updateHierarchyBudgetTotals();
  }
});

document.getElementById('btn-save-hierarchy').addEventListener('click', async ()=>{
  const status = document.getElementById('budget-save-status');
  const draft = captureHierarchyForm();
  for(const type of ['income','expense']){
    const groupNames = new Set();
    const itemNames = new Set();
    for(const group of draft.tree[type]){
      group.name = group.name.trim();
      if(!group.name){
        status.textContent = '관 이름을 입력해주세요.';
        return;
      }
      if(groupNames.has(group.name)){
        status.textContent = `중복된 ${type==='income'?'수입':'지출'} 관 이름이 있습니다.`;
        return;
      }
      groupNames.add(group.name);
      const accountNames = new Set();
      for(const account of group.accounts){
        account.name = account.name.trim();
        if(!account.name){
          status.textContent = '항 이름을 입력해주세요.';
          return;
        }
        if(accountNames.has(account.name)){
          status.textContent = `${group.name} 안에 중복된 항 이름이 있습니다.`;
          return;
        }
        accountNames.add(account.name);
        account.items = account.items.map(item=>item.trim());
        if(account.items.some(item=>!item)){
          status.textContent = '목 이름을 입력해주세요.';
          return;
        }
        if(account.items.some(item=>{
          if(itemNames.has(item)) return true;
          itemNames.add(item);
          return false;
        })){
          status.textContent = '같은 구분 안에서 목 이름이 중복되었습니다.';
          return;
        }
      }
    }
  }

  for(const row of document.querySelectorAll('.hierarchy-item-budget')){
    const amount = parseBudgetAmount(row.value);
    if(!Number.isFinite(amount) || amount<0 || !Number.isInteger(amount)){
      status.textContent = '목별 예산은 0 이상의 정수로 입력해주세요.';
      return;
    }
  }

  accountCategories = draft.tree;
  budget = draft.budget;
  const [budgetSaved, categoriesSaved] = await Promise.all([
    persistBudget(),
    persistAccountCategories()
  ]);
  if(budgetSaved && categoriesSaved){
    status.textContent = '관·항·목 분류와 예산이 Firestore에 저장되었습니다.';
  } else {
    status.textContent = `저장에 실패했습니다. 예산 ${budgetSaved ? '성공' : '실패'}, 분류 ${categoriesSaved ? '성공' : '실패'}${lastStorageError ? `: ${lastStorageError}` : '.'}`;
  }
  setTimeout(()=>{ if(status.textContent) status.textContent=''; }, 5000);
  renderHierarchyForm();
  renderReport();
});

document.getElementById('btn-import-previous-budget').addEventListener('click', async event=>{
  const button = event.currentTarget;
  const status = document.getElementById('budget-save-status');
  const previousYear = currentYear - 1;
  button.disabled = true;
  status.textContent = '';
  try{
    const result = await storageGet(budgetKey(previousYear));
    const previousBudget = JSON.parse(result.value);
    if(!previousBudget || typeof previousBudget !== 'object' || Array.isArray(previousBudget)){
      throw new Error(`${previousYear}년 예산 자료 형식이 올바르지 않습니다.`);
    }

    const importedAmounts = [];
    document.querySelectorAll('.hierarchy-item-row').forEach(row=>{
      if(row.dataset.emptyKind) return;
      const type = row.querySelector('.hierarchy-category-type').value;
      const gwanName = normalizeCategoryName(row.querySelector('.hierarchy-gwan-name').value,'_관');
      const hangName = normalizeCategoryName(row.querySelector('.hierarchy-account-name').value,'_항');
      const mokName = row.querySelector('.hierarchy-item-name').value.trim();
      const input = row.querySelector('.hierarchy-item-budget');
      const currentKey = mokBudgetKey(type,gwanName,hangName,mokName);
      const legacyExpenseKey = `mok:${JSON.stringify([gwanName,hangName,mokName])}`;
      const key = Object.prototype.hasOwnProperty.call(previousBudget,currentKey)
        ? currentKey
        : (type==='expense' && Object.prototype.hasOwnProperty.call(previousBudget,legacyExpenseKey)
          ? legacyExpenseKey
          : null);
      if(!key) return;
      const rawAmount = previousBudget[key];
      const amount = Number(rawAmount);
      if(rawAmount===null || (typeof rawAmount==='string' && !rawAmount.trim())){
        throw new Error(`${previousYear}년 ${mokName} 예산 값이 0 이상의 정수가 아닙니다.`);
      }
      if(!Number.isFinite(amount) || amount<0 || !Number.isInteger(amount)){
        throw new Error(`${previousYear}년 ${mokName} 예산 값이 0 이상의 정수가 아닙니다.`);
      }
      importedAmounts.push({input,amount});
    });
    importedAmounts.forEach(({input,amount})=>{ input.value = formatBudgetAmount(amount); });
    updateHierarchyBudgetTotals();
    const imported = importedAmounts.length;
    status.textContent = imported
      ? `${previousYear}년 예산 ${imported}개 목을 입력란에 불러왔습니다. 확인·수정한 뒤 '분류 및 예산 저장'을 눌러 저장하세요.`
      : `${previousYear}년 예산 자료에서 현재 분류와 일치하는 목을 찾지 못했습니다.`;
  }catch(error){
    status.textContent = error.code==='accounting/not-found'
      ? `${previousYear}년 예산 자료가 없습니다.`
      : `전년도 예산을 불러오지 못했습니다: ${error.message || String(error)}`;
  }finally{
    button.disabled = false;
  }
});
document.getElementById('btn-load-more-entries').addEventListener('click',loadMoreEntries);
document.getElementById('btn-monthly-exact').addEventListener('click',()=>{
  if(currentMonthlyReportMonth>=1 && currentMonthlyReportMonth<=12) loadMonthlyBudgetReport(currentMonthlyReportMonth,{exact:true});
});
document.getElementById('btn-reload-report').addEventListener('click',()=>{
  invalidateReportAggregates(
    (typeof ShowMeDomain !== 'undefined' && ShowMeDomain.buildInvalidation)
      ? ShowMeDomain.buildInvalidation('full')
      : { clearSummary:true, clearAllMonthCaches:true, dirtyMonthly:true, months:[] }
  );
  renderReport();
});
document.getElementById('btn-rebuild-report').addEventListener('click',async ()=>{
  if(!(await confirmAction('승인된 내역 전체를 읽어 집계를 다시 계산합니다. 읽기가 승인 건수만큼 발생합니다. 계속할까요?',{title:'집계 다시 계산',confirmLabel:'다시 계산'}))) return;
  invalidateReportAggregates(
    (typeof ShowMeDomain !== 'undefined' && ShowMeDomain.buildInvalidation)
      ? ShowMeDomain.buildInvalidation('full')
      : { clearSummary:true, clearAllMonthCaches:true, dirtyMonthly:true, months:[] }
  );
  await loadReportSummary(true);
});
  // ---------- init ----------
  // ---------- Firestore 읽기 사용량 (Cloud Monitoring) ----------
//const FREE_READ_LIMIT = 50000;
//let monitoringToken = null, monitoringTokenExp = 0;

async function getMonitoringToken(){
  if(monitoringToken && Date.now() < monitoringTokenExp) return monitoringToken;
  if(!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/monitoring.read');
  if(auth.currentUser.email) provider.setCustomParameters({login_hint:auth.currentUser.email});
  const result = await auth.currentUser.reauthenticateWithPopup(provider);
  const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result) || result.credential;
  if(!credential?.accessToken) throw new Error('모니터링 읽기 권한 동의가 필요합니다.');
  monitoringToken = credential.accessToken;
  monitoringTokenExp = Date.now() + 50*60*1000;   // 약 50분간 재사용
  return monitoringToken;
}

// 미국 태평양시 기준 "오늘 0시" (무료 할당량이 초기화되는 시각)
function pacificDayStart(now=new Date()){
  const parts = new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Los_Angeles',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'
  }).formatToParts(now);
  const get = type => Number(parts.find(p=>p.type===type).value);
  const elapsed = ((get('hour')%24)*3600 + get('minute')*60 + get('second'))*1000;
  return new Date(now.getTime() - elapsed);
}

async function fetchTodayReads(){
  const token = await getMonitoringToken();
  const projectId = window.FIREBASE_CONFIG.projectId;
  const end = new Date();
  const start = pacificDayStart(end);
  const period = Math.max(60, Math.ceil((end-start)/1000));
  const params = new URLSearchParams({
    filter:'metric.type="firestore.googleapis.com/document/read_count"',
    'interval.startTime':start.toISOString(),
    'interval.endTime':end.toISOString(),
    'aggregation.alignmentPeriod':`${period}s`,
    'aggregation.perSeriesAligner':'ALIGN_SUM',
    'aggregation.crossSeriesReducer':'REDUCE_SUM'
  });
  const res = await fetch(
    `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params}`,
    {headers:{Authorization:`Bearer ${token}`}}
  );
  const data = await res.json();
  if(!res.ok){
    monitoringToken = null;
    throw new Error(data.error?.message || `조회 실패 (${res.status})`);
  }
  let total = 0;
  (data.timeSeries||[]).forEach(ts=>(ts.points||[]).forEach(p=>{
    total += Number(p.value?.int64Value || 0);
  }));
  return {total,start};
}

function renderUsage(total,start){
  const pct = Math.min(100,total/FREE_READ_LIMIT*100);
  const fill = document.getElementById('usage-fill');
  fill.style.width = pct + '%';
  fill.classList.toggle('warn',pct>=70 && pct<90);
  fill.classList.toggle('danger',pct>=90);
  document.getElementById('usage-numbers').textContent =
    `${total.toLocaleString('ko-KR')} / ${FREE_READ_LIMIT.toLocaleString('ko-KR')}건 (${pct.toFixed(1)}%)`;
  const reset = new Date(start.getTime() + 24*3600*1000);
  const fmtTime = d => d.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  document.getElementById('usage-note').textContent =
    `초기화 ${fmtTime(reset)} · 조회 ${fmtTime(new Date())}`;
}

document.getElementById('some-button')?.addEventListener('click', async function(event) {
  const button = event.currentTarget;
  const note = document.getElementById('usage-note');
  
  if (button) button.disabled = true;
  if (note) note.textContent = '조회 중…';

  try {
    const { total, start } = await fetchTodayReads();
    renderUsage(total, start);
  } catch (error) {
    if (note) {
      note.textContent = /permission|403|PERMISSION/i.test(error.message)
        ? '권한이 없습니다. 프로젝트 소유자/뷰어 계정이거나 Monitoring API가 켜져 있는지 확인하세요.'
        : `사용량 조회 실패: ${error.message}`;
    }
  } finally {
    if (button) button.disabled = false;
  }
});

// 탭 영역 오른쪽 KST 시계 (시:분:초)
function startAppClock(){
  const el = document.getElementById('app-clock');
  if(!el) return;
  const pad = n => String(n).padStart(2,'0');
  const tick = ()=>{
    try{
      const parts = new Intl.DateTimeFormat('en-GB',{
        timeZone:'Asia/Seoul',
        hour:'2-digit', minute:'2-digit', second:'2-digit',
        hour12:false
      }).formatToParts(new Date());
      const get = type => parts.find(p=>p.type===type)?.value || '00';
      const h = get('hour'), m = get('minute'), s = get('second');
      const text = `${h}:${m}:${s}`;
      el.textContent = text;
      const dParts = new Intl.DateTimeFormat('en-CA',{
        timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
      }).format(new Date());
      el.setAttribute('datetime', `${dParts}T${text}+09:00`);
    }catch(e){
      const now = new Date();
      const kst = new Date(now.getTime() + (9*60 - now.getTimezoneOffset())*60000);
      el.textContent = `${pad(kst.getHours())}:${pad(kst.getMinutes())}:${pad(kst.getSeconds())}`;
    }
  };
  tick();
  setInterval(tick, 1000);
}
startAppClock();
connectFirebase();