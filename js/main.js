const supabaseClient = window.supabase.createClient(
  "https://nsynylbqrkdftnyqrgkn.supabase.co",
  "sb_publishable_6YG9WtNG4D_RFplEvv1h6A_aBizgtOv"
);

// ===== المتغيرات العامة =====
let orders = [];
let users = [];
let editId = null;
let currentUser = null;
let charts = {};
let selectedOrderIds = new Set();

let branchs = [];
let okbItems = [];
let doctorsList = [];
let shippingSystems = [];

let shippingCompanyFilterMenu = null; 

let doctorsSettingsPage = 1;
const DOCTORS_PAGE_SIZE = 10;
let itemsSettingsPage = 1;
const ITEMS_SETTINGS_PAGE_SIZE = 10;

const PAGE_SIZE = 20;
let pageState = {
  orders: 1, shippingAnalysis: 1, doctorsAnalysis: 1,
  shippingRank: 1, doctorRank: 1, branchRank: 1
};

let selectedShippingCompanies = [];
let activeDateFrom = null;
let activeDateTo = null;
let analyticsDateFrom = null;
let analyticsDateTo = null;
let shippingDateFrom = null;
let shippingDateTo = null;

// ===== KHAZNA PAGE - المتغيرات العامة =====
let khaznaOrders = [];
let khaznaShippingCost = 0;
let khaznaSelectedIds = new Set();
let khaznaLockInfo = null;
let branchDailyLocks = {};

// ===== دوال مساعدة =====
const $ = id => document.getElementById(id);
function num(v) { return Number(v || 0).toLocaleString("en-US"); }
function money(v) { return Number(v || 0).toLocaleString("en-US"); }
function enNumber(v) { return Number(v || 0).toLocaleString("en-US"); }
function enMoney(v) { return Number(v || 0).toLocaleString("en-US"); }
function isAdmin() { return currentUser && getRoleKey(currentUser.role) === "admin"; }

// ===== Activity Log System =====
let activityLogs = [];
let activityLogRealtimeChannel = null;
let activityLogPollingTimer = null;
let activityLogUnreadCount = 0;
let activityLogPageNumber = 1;
const ACTIVITY_LOG_PAGE_SIZE = 25;
let onlinePresenceChannel = null;
let onlinePresenceUsers = new Map();
const onlinePresenceSessionKey = (() => {
  const key = sessionStorage.getItem('okb_presence_session_key') || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem('okb_presence_session_key', key);
  return key;
})();
function renderOnlineUsersCount(){
  const countEl = document.getElementById('activityLogUsers');
  if (countEl) countEl.textContent = num(onlinePresenceUsers.size);
}
function syncOnlinePresenceUsers(channel = onlinePresenceChannel){
  if (!channel) { onlinePresenceUsers = new Map(); renderOnlineUsersCount(); return; }
  const users = new Map();
  const state = channel.presenceState?.() || {};
  Object.values(state).flat().forEach(presence => {
    const userKey = String(presence?.user_id || presence?.username || presence?.session_key || '');
    if (userKey && !users.has(userKey)) users.set(userKey, presence);
  });
  onlinePresenceUsers = users;
  renderOnlineUsersCount();
}
async function stopOnlinePresence(){
  const channel = onlinePresenceChannel;
  onlinePresenceChannel = null;
  if (channel) {
    try { await channel.untrack(); } catch(e) {}
    try { await supabaseClient.removeChannel(channel); } catch(e) {}
  }
  onlinePresenceUsers = new Map();
  renderOnlineUsersCount();
}
async function startOnlinePresence(){
  await stopOnlinePresence();
  if (!currentUser) return;
  const channel = supabaseClient.channel('okb-online-users-v1', {
    config: { presence: { key: onlinePresenceSessionKey } }
  });
  onlinePresenceChannel = channel;
  channel
    .on('presence', { event: 'sync' }, () => syncOnlinePresenceUsers(channel))
    .on('presence', { event: 'join' }, () => syncOnlinePresenceUsers(channel))
    .on('presence', { event: 'leave' }, () => syncOnlinePresenceUsers(channel))
    .subscribe(async status => {
      if (status !== 'SUBSCRIBED' || onlinePresenceChannel !== channel || !currentUser) return;
      await channel.track({
        session_key: onlinePresenceSessionKey,
        user_id: String(currentUser.id || currentUser.username || onlinePresenceSessionKey),
        username: String(currentUser.username || ''),
        user_name: String(currentUser.name || currentUser.username || 'User'),
        role: String(currentUser.role || ''),
        online_at: new Date().toISOString()
      });
    });
}
window.addEventListener('pagehide', () => {
  try { onlinePresenceChannel?.untrack(); } catch(e) {}
});
window.addEventListener('pageshow', event => {
  if (event.persisted && currentUser) startOnlinePresence();
});
function activityLogSeenStorageKey(){
  return `okb_activity_log_seen_${currentUser?.username || currentUser?.id || 'admin'}`;
}
function activityLogSeenIdStorageKey(){
  return `${activityLogSeenStorageKey()}_id`;
}
function updateActivityLogBadge(count = activityLogUnreadCount){
  activityLogUnreadCount = Math.max(0, Number(count) || 0);
  const badge = document.getElementById('activityLogNotification');
  if (!badge) return;
  badge.textContent = activityLogUnreadCount > 99 ? '99+' : String(activityLogUnreadCount);
  badge.classList.toggle('hidden', activityLogUnreadCount < 1 || !isAdmin());
}
async function refreshActivityLogUnreadCount(){
  if (!isAdmin()) { updateActivityLogBadge(0); return; }
  if (!document.getElementById('activityLogPage')?.classList.contains('hidden')) {
    await markActivityLogsReadFromServer();
    return;
  }
  const seenId = Number(localStorage.getItem(activityLogSeenIdStorageKey()) || 0);
  let query = supabaseClient
    .from('activity_logs')
    .select('id', { count: 'exact', head: true })
    .gt('id', seenId);
  if(currentUser?.username)query=query.neq('username',String(currentUser.username));
  const { count, error } = await query;
  if (!error) updateActivityLogBadge(count || 0);
}
async function markActivityLogsReadFromServer(){
  if(!isAdmin()) return;
  const {data,error}=await supabaseClient
    .from('activity_logs')
    .select('id,created_at')
    .order('id',{ascending:false})
    .limit(1);
  if(error)return;
  const latest=data?.[0]?.created_at;
  const latestId=Number(data?.[0]?.id||0);
  const seenAt=latest || new Date().toISOString();
  localStorage.setItem(activityLogSeenStorageKey(),seenAt);
  localStorage.setItem(activityLogSeenIdStorageKey(),String(latestId));
  updateActivityLogBadge(0);
}
function stopActivityLogNotifications(){
  if (activityLogRealtimeChannel) {
    supabaseClient.removeChannel(activityLogRealtimeChannel);
    activityLogRealtimeChannel = null;
  }
  if (activityLogPollingTimer) {
    clearInterval(activityLogPollingTimer);
    activityLogPollingTimer = null;
  }
  updateActivityLogBadge(0);
}
function startActivityLogNotifications(){
  stopActivityLogNotifications();
  if (!isAdmin()) return;
  refreshActivityLogUnreadCount();
  activityLogRealtimeChannel = supabaseClient
    .channel(`activity-log-admin-${currentUser?.id || 'current'}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, payload => {
      const createdAt = payload?.new?.created_at || new Date().toISOString();
      const activityId=Number(payload?.new?.id||0);
      const seenId=Number(localStorage.getItem(activityLogSeenIdStorageKey())||0);
      const isPageOpen=!document.getElementById('activityLogPage')?.classList.contains('hidden');
      const isCurrentUserActivity=String(payload?.new?.username||'')===String(currentUser?.username||'');
      if (!isPageOpen && !isCurrentUserActivity && activityId > seenId) {
        updateActivityLogBadge(activityLogUnreadCount + 1);
      }
      if (isPageOpen) loadActivityLogs().then(markActivityLogsReadFromServer);
    })
    .subscribe();
  // Polling is a safe fallback when Realtime is not enabled for activity_logs.
  activityLogPollingTimer = setInterval(refreshActivityLogUnreadCount, 5000);
}
function markActivityLogsRead(){
  markActivityLogsReadFromServer();
}
function getCairoDateISO(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}
function getActivityOrderInfo(order){
  if (!order) return {};
  return {
    order_id: order.id || null,
    ticket_id: (typeof getTicketId === 'function' ? getTicketId(order) : (order.ticket_id || null)),
    customer_name: order.customer_name || null,
    branch_name: order.branch || currentBranchName || null
  };
}
function activityBigIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  // activity_logs.user_id / order_id were created as BIGINT.
  // UUID/text IDs must not be sent to those columns or Supabase rejects the whole row.
  return /^\d+$/.test(text) ? Number(text) : null;
}
async function logActivity(actionType, actionTitle, actionDetails = '', extra = {}) {
  if (!currentUser) return false;

  const payload = {
    user_id: activityBigIntOrNull(currentUser.id),
    user_name: String(currentUser.name || currentUser.username || 'User'),
    username: currentUser.username ? String(currentUser.username) : null,
    user_role: currentUser.role ? String(currentUser.role) : null,
    action_type: String(actionType || 'activity'),
    action_title: String(actionTitle || 'Activity'),
    action_details: actionDetails ? String(actionDetails) : null,
    order_id: activityBigIntOrNull(extra.order_id),
    ticket_id: extra.ticket_id ? String(extra.ticket_id) : null,
    customer_name: extra.customer_name ? String(extra.customer_name) : null,
    branch_name: (extra.branch_name || currentBranchName) ? String(extra.branch_name || currentBranchName) : null,
    action_date: getCairoDateISO()
  };

  try {
    let { error } = await supabaseClient.from('activity_logs').insert([payload]);

    // If the table has no created_at default, fall back to the device UTC time.
    if (error) {
      console.error('Activity log insert failed (first attempt):', error);
      const retryPayload = { ...payload, created_at: new Date().toISOString() };
      const retry = await supabaseClient.from('activity_logs').insert([retryPayload]);
      error = retry.error;
    }

    // Defensive final retry: old schemas may reject optional BIGINT IDs.
    if (error) {
      console.error('Activity log insert failed (second attempt):', error);
      const retry = await supabaseClient.from('activity_logs').insert([{
        ...payload,
        created_at: new Date().toISOString(),
        user_id: null,
        order_id: null
      }]);
      error = retry.error;
    }

    if (error) {
      console.error('Activity log insert failed:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Activity log exception:', e);
    return false;
  }
}
function activityIcon(type){ const map={order_created:'➕',order_updated:'✏️',order_cancelled:'⛔',order_collected:'💰',order_deleted:'🗑️',daily_locked:'🔒',daily_unlocked:'🔓',password_changed:'🔐',user_management:'👤',login:'↪️',logout:'↩️',data_exported:'📤',stock_take_start:'📋',stock_take_count:'🔢',stock_take_scan:'▣',stock_take_reason:'📝',stock_take_draft:'💾',stock_take_close:'🔒',stock_take_refresh:'↻',order_discount:'🏷️',order_transfer:'🔄',payment_proof_attached:'📎'}; return map[type]||'⚡'; }
function activityTypeLabel(type){ const map={order_created:'إضافة أوردر',order_updated:'تعديل أوردر',order_cancelled:'إلغاء أوردر',order_collected:'تحصيل أوردر',order_deleted:'حذف أوردر',daily_locked:'قفل يومية',daily_unlocked:'فتح يومية',password_changed:'تغيير كلمة مرور',user_management:'إدارة مستخدم',login:'تسجيل دخول',logout:'تسجيل خروج',data_exported:'تصدير بيانات',stock_take_start:'بدء جرد',stock_take_count:'تعديل كمية جرد',stock_take_scan:'مسح باركود بالجرد',stock_take_reason:'سبب فرق الجرد',stock_take_draft:'حفظ جرد مؤقت',stock_take_close:'قفل الجرد',stock_take_refresh:'تحديث بيانات الجرد',order_discount:'خصم أوردر',order_transfer:'تحويل لشركة شحن',payment_proof_attached:'إرفاق إثبات دفع'}; return map[type]||type||'Activity'; }
function formatActivityTime(iso){
  const date=parsePreciseServerDate(iso);
  if(!date)return iso||'';
  const datePart=new Intl.DateTimeFormat('en-GB',{
    year:'numeric',month:'2-digit',day:'2-digit'
  }).format(date);
  const timePart=new Intl.DateTimeFormat('en-US',{
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true
  }).format(date).toUpperCase();
  return `${datePart}, ${timePart}`;
}
function getLocalDateISO(dateValue){
  const date=parsePreciseServerDate(dateValue)||new Date();
  const year=date.getFullYear();
  const month=String(date.getMonth()+1).padStart(2,'0');
  const day=String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}
async function showActivityLogPage(){
  if(!isAdmin()){ alert('صفحة Activity Log متاحة للأدمن فقط'); return; }
  hideAllPages();
  document.getElementById('activityLogPage')?.classList.remove('hidden');
  setActiveMenu('activityLogPage');
  activityLogPageNumber=1;
  const today=getLocalDateISO();
  if(!document.getElementById('activityLogFrom').value) document.getElementById('activityLogFrom').value=today;
  if(!document.getElementById('activityLogTo').value) document.getElementById('activityLogTo').value=today;
  await loadActivityLogs();
  await markActivityLogsReadFromServer();
}
async function loadActivityLogs(){
  if(!isAdmin()) return;
  const list=document.getElementById('activityLogList'); if(list) list.innerHTML='<div class="activity-log-loading">جاري تحميل سجل النشاط...</div>';
  const from=document.getElementById('activityLogFrom')?.value||null;
  const to=document.getElementById('activityLogTo')?.value||null;
  const q=String(document.getElementById('activityLogSearch')?.value||'').trim().toLowerCase();
  const type=document.getElementById('activityLogType')?.value||'all';
  let query=supabaseClient.from('activity_logs').select('*').order('id',{ascending:false}).limit(1000);
  if(type!=='all') query=query.eq('action_type',type);
  const {data,error}=await query;
  if(error){ if(list) list.innerHTML='<div class="activity-log-empty">تعذر تحميل السجل: '+escapeHTML(error.message)+'</div>'; return; }
  activityLogs=(data||[])
    .filter(x=>{
      const date=parsePreciseServerDate(x.created_at);
      if(!date)return false;
      const localDay=getLocalDateISO(date);
      return (!from||localDay>=from)&&(!to||localDay<=to);
    })
    .filter(x=>!q||[x.user_name,x.username,x.action_title,x.action_details,x.ticket_id,x.customer_name,x.branch_name].some(v=>String(v||'').toLowerCase().includes(q)))
    .sort((a,b)=>Number(b.id||0)-Number(a.id||0));
  const totalPages=Math.max(1,Math.ceil(activityLogs.length/ACTIVITY_LOG_PAGE_SIZE));
  if(activityLogPageNumber>totalPages)activityLogPageNumber=totalPages;
  renderActivityLogs();
}
async function refreshActivityLogPage(button){
  if(!isAdmin()) return;
  const oldText=button?.textContent;
  if(button){button.disabled=true;button.textContent='جاري التحديث...';}
  try{
    syncOnlinePresenceUsers();
    await loadActivityLogs();
    await markActivityLogsReadFromServer();
  }finally{
    if(button){button.disabled=false;button.textContent=oldText||'↻ Refresh';}
  }
}
function renderActivityLogs(){
  const list=document.getElementById('activityLogList'); if(!list) return;
  document.getElementById('activityLogTotal').textContent=num(activityLogs.length);
  renderOnlineUsersCount();
  document.getElementById('activityLogOrders').textContent=num(activityLogs.filter(x=>String(x.action_type||'').startsWith('order_')).length);
  document.getElementById('activityLogKhazna').textContent=num(activityLogs.filter(x=>['daily_locked','daily_unlocked','order_collected'].includes(x.action_type)).length);
  if(!activityLogs.length){list.innerHTML='<div class="activity-log-empty">لا توجد حركات مطابقة للفلاتر الحالية</div>';renderActivityLogPagination();return;}
  const start=(activityLogPageNumber-1)*ACTIVITY_LOG_PAGE_SIZE;
  const pageRows=activityLogs.slice(start,start+ACTIVITY_LOG_PAGE_SIZE);
  list.innerHTML=pageRows.map(x=>`<div class="activity-log-row"><div class="activity-log-action-icon">${activityIcon(x.action_type)}</div><div class="activity-log-user"><strong>${escapeHTML(x.user_name||'User')}</strong><small>${escapeHTML(x.username||'')} • ${escapeHTML(getRoleDisplayName(x.user_role)||x.user_role||'')}</small></div><div><span class="activity-log-tag">${escapeHTML(activityTypeLabel(x.action_type))}</span><div class="activity-log-meta" style="margin-top:5px">${escapeHTML(x.branch_name||'System')}</div></div><div class="activity-log-main"><strong>${escapeHTML(x.action_title||activityTypeLabel(x.action_type))}</strong><small>${escapeHTML(x.action_details||'—')}</small></div><div class="activity-log-meta-wrap"><div class="activity-log-meta">${x.ticket_id?'Ticket: '+escapeHTML(x.ticket_id):'بدون Ticket'}</div><div class="activity-log-meta">${escapeHTML(x.customer_name||'')}</div></div><div class="activity-log-meta-wrap"><div class="activity-log-meta activity-log-time">${formatActivityTime(x.created_at)}</div></div></div>`).join('');
  renderActivityLogPagination();
}
function renderActivityLogPagination(){
  const container=document.getElementById('activityLogPagination');if(!container)return;
  const totalPages=Math.max(1,Math.ceil(activityLogs.length/ACTIVITY_LOG_PAGE_SIZE));
  if(activityLogs.length<=ACTIVITY_LOG_PAGE_SIZE){container.innerHTML='';return;}
  const start=Math.max(1,activityLogPageNumber-2);
  const end=Math.min(totalPages,activityLogPageNumber+2);
  let html=`<button type="button" onclick="changeActivityLogPage(${activityLogPageNumber-1})" ${activityLogPageNumber===1?'disabled':''}>Prev</button>`;
  if(start>1)html+=`<button type="button" onclick="changeActivityLogPage(1)">1</button>${start>2?'<span>…</span>':''}`;
  for(let page=start;page<=end;page++)html+=`<button type="button" class="${page===activityLogPageNumber?'active':''}" onclick="changeActivityLogPage(${page})">${page}</button>`;
  if(end<totalPages)html+=`${end<totalPages-1?'<span>…</span>':''}<button type="button" onclick="changeActivityLogPage(${totalPages})">${totalPages}</button>`;
  html+=`<button type="button" onclick="changeActivityLogPage(${activityLogPageNumber+1})" ${activityLogPageNumber===totalPages?'disabled':''}>Next</button><span class="activity-log-page-info">Page ${activityLogPageNumber} of ${totalPages} — ${activityLogs.length} activities</span>`;
  container.innerHTML=html;
}
function changeActivityLogPage(page){
  const totalPages=Math.max(1,Math.ceil(activityLogs.length/ACTIVITY_LOG_PAGE_SIZE));
  activityLogPageNumber=Math.min(totalPages,Math.max(1,Number(page)||1));
  renderActivityLogs();
  document.getElementById('activityLogPage')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function resetActivityLogFilters(){ const today=getLocalDateISO(); activityLogPageNumber=1;document.getElementById('activityLogFrom').value=today;document.getElementById('activityLogTo').value=today;document.getElementById('activityLogSearch').value='';document.getElementById('activityLogType').value='all';loadActivityLogs(); }

// ===== Product Reports =====
function canViewProductReports(){ return isAdmin() || isCashier() || isStoreManager() || isAccountManager(); }
let productReportTab = 'top';
let productReportRows = { top: [], returned: [], cancel: [], dead: [] };
let productTicketModalRows = [];

function productItemCategory(item){ return String(item?.category || item?.item_category || item?.category_name || 'غير مصنف').trim() || 'غير مصنف'; }
function productStockQty(item){
  const keys=['stock_quantity','quantity_in_stock','stock_qty','available_quantity','stock'];
  for(const key of keys){ const n=Number(item?.[key]); if(Number.isFinite(n) && n>=0) return n; }
  return 1;
}
function normalizeProductName(name){ return String(name||'').trim().replace(/\s+/g,' ').toLowerCase(); }
function parseOrderProductsForReports(order){
  const text=String(order?.product_names||'').trim();
  const out=[];
  if(text){
    text.split(/\n+/).forEach(line=>{
      const clean=line.replace(/^\s*\d+[\)\.\-]\s*/,'').trim();
      const m=clean.match(/^(.*?)\s*\|\s*([\d.,]+)\s*[×xX*]\s*(\d+)(?:\s*=\s*([\d.,]+))?/);
      if(m){
        const name=m[1].trim(); const price=Number(String(m[2]).replace(/,/g,''))||0; const qty=Math.max(1,Number(m[3])||1);
        out.push({name,price,qty,total:Number(String(m[4]||'').replace(/,/g,''))||price*qty});
      } else if(clean){
        clean.split(/[,،]+/).map(x=>x.trim()).filter(Boolean).forEach(name=>out.push({name,price:0,qty:1,total:0}));
      }
    });
  }
  if(!out.length && Number(order?.price||0)>0) out.push({name:'منتج غير محدد',price:Number(order.price||0),qty:Number(order.quantity||1)||1,total:Number(order.price||0)});
  return out;
}
function normalizeProductReportBranch(value){
  const raw=String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  const aliases={
    'nasr city branch':'nasr-city','nasr city':'nasr-city','مدينة نصر':'nasr-city',
    'alexandria branch':'alexandria','alexandria':'alexandria','alex branch':'alexandria','اسكندرية':'alexandria','الإسكندرية':'alexandria',
    'mansoura branch':'mansoura','mansoura':'mansoura','المنصورة':'mansoura',
    'tanta branch':'tanta','tanta':'tanta','tan ta branch':'tanta','طنطا':'tanta'
  };
  return aliases[raw]||raw;
}
function getProductReportOrderBranch(order){
  const candidates=[order?.branch,order?.branch_name,order?.shipping_company,order?.shipping_system];
  const known=candidates.map(normalizeProductReportBranch).find(x=>['nasr-city','alexandria','mansoura','tanta'].includes(x));
  return known||normalizeProductReportBranch(candidates.find(Boolean));
}
function getProductReportDoctor(order){
  return String(order?.doctor_name||order?.doctor||order?.doctorName||'').trim();
}
function getProductReportFilters(){ return {from:$('productReportFrom')?.value||null,to:$('productReportTo')?.value||null,branch:$('productReportBranch')?.value||'all',doctor:$('productReportDoctor')?.value||'all',search:String($('productReportSearch')?.value||'').trim().toLowerCase()}; }
function productOrderMatchesFilters(order,filters){
  const d=String(order?.created_at||'').split('T')[0];
  if(filters.from && d<filters.from) return false; if(filters.to && d>filters.to) return false;
  const branch=getProductReportOrderBranch(order);
  const allowedBranches=['nasr-city','alexandria','mansoura','tanta'];
  // "All branches" means only the four OKB branches shown in the list,
  // not every order or shipping company stored in the database.
  if(!allowedBranches.includes(branch)) return false;
  if(filters.branch!=='all' && branch!==normalizeProductReportBranch(filters.branch)) return false;
  if(filters.doctor!=='all' && getProductReportDoctor(order)!==filters.doctor) return false;
  return true;
}
function populateProductReportFilters(){
  const branchEl=$('productReportBranch'),doctorEl=$('productReportDoctor');
  if(branchEl){ const cur=branchEl.value; const branches=['Nasr City Branch','Alexandria Branch','Mansoura Branch','TanTa Branch']; branchEl.innerHTML='<option value="all">كل الفروع</option>'+branches.map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join(''); branchEl.value=branches.includes(cur)?cur:'all'; }
  if(doctorEl){ const cur=doctorEl.value; const names=[...new Set(doctorsList.map(d=>String(d.name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')); doctorEl.innerHTML='<option value="all">كل الدكاترة</option>'+names.map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join(''); doctorEl.value=names.includes(cur)?cur:'all'; }
}
function productReason(order){ return (cleanVisibleOrderNotes(order?.notes||'').match(/سبب الإلغاء:\s*([^\n]+)/)||[])[1]||'غير محدد'; }
function productTicketRef(order,p){ return {ticketId:getTicketId(order),orderId:order.id,orderNumber:order.order_number||'',customer:order.customer_name||'',doctor:getProductReportDoctor(order),branch:order.branch||order.shipping_company||'',status:order.status||'',qty:Number(p.qty||1),date:order.created_at||'',reason:productReason(order)}; }
function buildProductReportData(){
  const filters=getProductReportFilters(); const map=new Map(); const lastMovement=new Map();
  const filteredOrders=orders.filter(o=>productOrderMatchesFilters(o,filters));
  filteredOrders.forEach(order=>{
    const status=String(order.status||'').trim();
    parseOrderProductsForReports(order).filter(p=>!filters.search||normalizeProductName(p.name).includes(filters.search)).forEach(p=>{
      const key=normalizeProductName(p.name);
      if(!map.has(key)) map.set(key,{name:p.name,qtySold:0,revenue:0,qtyReturned:0,lossValue:0,qtyCancelled:0,cancelValue:0,reasons:{},cancelReasons:{},soldTickets:[],returnedTickets:[],cancelTickets:[]});
      const r=map.get(key); const date=String(order.created_at||''); if(date && (!lastMovement.get(key)||date>lastMovement.get(key))) lastMovement.set(key,date);
      const ref=productTicketRef(order,p);
      if(status==='Returned') { r.qtyReturned+=p.qty; r.lossValue+=p.total; r.reasons[ref.reason]=(r.reasons[ref.reason]||0)+p.qty; r.returnedTickets.push(ref); }
      else if(status==='Cancel') { r.qtyCancelled+=p.qty; r.cancelValue+=p.total; r.cancelReasons[ref.reason]=(r.cancelReasons[ref.reason]||0)+p.qty; r.cancelTickets.push(ref); }
      else { r.qtySold+=p.qty; r.revenue+=p.total; r.soldTickets.push(ref); }
    });
  });
  const all=[...map.values()];
  const top=all.filter(r=>r.qtySold>0).sort((a,b)=>b.qtySold-a.qtySold||b.revenue-a.revenue).slice(0,10);
  const returned=all.map(r=>{ const moved=r.qtySold+r.qtyReturned+r.qtyCancelled; const reason=Object.entries(r.reasons).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—'; return {...r,returnReason:reason,returnRate:moved?r.qtyReturned/moved*100:0}; }).filter(r=>r.qtyReturned>0).sort((a,b)=>b.qtyReturned-a.qtyReturned||b.returnRate-a.returnRate).slice(0,10);
  const cancel=all.map(r=>{ const moved=r.qtySold+r.qtyReturned+r.qtyCancelled; const reason=Object.entries(r.cancelReasons).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—'; return {...r,cancelReason:reason,cancelRate:moved?r.qtyCancelled/moved*100:0}; }).filter(r=>r.qtyCancelled>0).sort((a,b)=>b.qtyCancelled-a.qtyCancelled||b.cancelRate-a.cancelRate).slice(0,10);
  const now=Date.now();
  const dead=okbItems.map(item=>{ const name=item.item_name||''; const key=normalizeProductName(name); const last=lastMovement.get(key); const days=last?Math.floor((now-new Date(last).getTime())/(24*60*60*1000)):9999; const qty=productStockQty(item); return {name,stockQty:qty,unitPrice:Number(item.price||0),lastMovement:last||null,daysInactive:days}; }).filter(r=>r.daysInactive>60&&(!filters.search||normalizeProductName(r.name).includes(filters.search))).sort((a,b)=>b.daysInactive-a.daysInactive).slice(0,10);
  productReportRows={top,returned,cancel,dead};
  productReportRows._filteredOrders=filteredOrders;
}
function ensureProductReportEnhancements(){
  const page=$('productReportsPage'); if(!page)return;
  if(!$('productReportsDynamicStyle')){ const st=document.createElement('style'); st.id='productReportsDynamicStyle'; st.textContent=`
  #productReportsPage .product-reports-layout,#productReportsPage .product-report-layout{display:block!important;grid-template-columns:1fr!important;width:100%!important}
  #productReportsPage .product-report-table-card,#productReportsPage .table-card,#productReportsPage .product-table-wrap{width:100%!important;max-width:none!important}
  #productReportTable{display:none!important}
  #productReportRowsList{width:100%!important;display:flex!important;flex-direction:column!important;gap:8px!important;margin-top:8px!important}
  .product-report-line{width:100%;display:grid;grid-template-columns:72px minmax(220px,2fr) 150px 120px 150px;gap:10px;align-items:center;padding:12px 14px;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-card);font-size:12px;line-height:1.45}
  .product-report-line.header{background:var(--bg-soft);font-weight:900;color:var(--text-muted);position:sticky;top:0;z-index:2}
  .product-report-line .cell{white-space:normal;overflow-wrap:anywhere;word-break:break-word}
  .product-report-line .product-name{font-weight:900}
  .product-report-line.returned,.product-report-line.cancel{grid-template-columns:72px minmax(220px,2fr) 150px 110px minmax(180px,1.5fr) 110px 140px}
  .product-report-line.dead{grid-template-columns:72px minmax(260px,2fr) 120px 120px 180px 120px}
  .product-ticket-btn{border:1px solid rgba(34,211,238,.38);background:linear-gradient(135deg,rgba(8,145,178,.28),rgba(14,116,144,.18));color:#e6fbff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap}
  .product-ticket-modal-row{display:grid;grid-template-columns:95px 1.2fr 1.1fr 1fr 90px 70px 110px;gap:8px;align-items:center;padding:9px;border-bottom:1px solid var(--border-color);font-size:12px}
  #productReportsPage .product-kpis{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))!important;gap:12px!important;align-items:stretch!important;width:100%!important}
  #productReportsPage .product-kpi{height:118px!important;min-height:118px!important;max-height:118px!important;padding:14px 16px!important;display:flex!important;flex-direction:column!important;justify-content:space-between!important;overflow:hidden!important}
  #productReportsPage .product-kpi .pk-name,#productReportsPage .product-kpi .pk-sub{white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
  .product-report-chart-bottom{width:100%!important;max-width:none!important;margin-top:18px!important;min-height:360px!important;grid-column:1 / -1!important;order:99!important}
  .cancel-chip{background:#dff8fb!important;color:#c62828!important;border:1px solid #9edfe7!important}
  @media(max-width:900px){#productReportsPage .product-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.product-ticket-modal-row{grid-template-columns:1fr 1fr}.product-report-line,.product-report-line.returned,.product-report-line.cancel,.product-report-line.dead{grid-template-columns:1fr 1fr!important}.product-report-line.header{display:none!important}}
  @media(max-width:620px){#productReportsPage .product-kpis{grid-template-columns:1fr!important}}
  `; document.head.appendChild(st); }
  const tabs=page.querySelector('.product-report-tabs');
  if(tabs && !$('productTabCancel')){ const b=document.createElement('button'); b.className='product-report-tab'; b.id='productTabCancel'; b.type='button'; b.textContent='Cancel Group'; b.onclick=()=>setProductReportTab('cancel'); tabs.insertBefore(b,$('productTabDead')); }
  const kpis=page.querySelector('.product-kpis');
  const oldExtra=$('productExtraKpis'); if(oldExtra)oldExtra.remove();
  if(kpis && !$('prCancelOrders')){ const x=document.createElement('div'); x.className='product-kpi'; x.id='productCancelKpi'; x.innerHTML=`<div class="pk-label">Cancel Group</div><div class="pk-name">إجمالي أوردرات Cancel</div><div class="pk-value" id="prCancelOrders">0</div><div class="pk-sub">مرتبط بالفيلتر الحالي</div>`; kpis.appendChild(x); }
  const head=page.querySelector('.product-reports-head');
  if(head && !$('productReportHeaderActions')){ const old=head.querySelector('button[onclick*="showOrdersPage"]'); if(old)old.remove(); const a=document.createElement('div'); a.id='productReportHeaderActions'; a.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-start;'; a.innerHTML=`<button class="soft" type="button" onclick="showOrdersPage()">← رجوع للـ Dashboard</button><button class="soft" type="button" onclick="refreshProductReports(event)">↻ Refresh</button><button class="soft" type="button" onclick="printProductReports()">🖨 Print</button><button class="soft" type="button" onclick="exportProductReportExcel()">⬇ Export Excel</button>`; head.appendChild(a); }
  const chartCanvas=$('productReportsChart');
  const reportTable=$('productReportTable');
  let tableCard=null;
  if(reportTable){
    tableCard=reportTable.closest('.product-report-table-card,.table-card,.card')||reportTable.parentElement;
    if(tableCard){
      tableCard.style.width='100%';
      tableCard.style.maxWidth='none';
      tableCard.style.gridColumn='1 / -1';
      tableCard.style.flex='1 1 100%';
    }
    if(!$('productReportRowsList')){
      const rowsList=document.createElement('div');
      rowsList.id='productReportRowsList';
      reportTable.insertAdjacentElement('afterend',rowsList);
    }
  }

  // إزالة كارت الشارت/Top 10 القديم بالكامل، وليس محتواه فقط.
  destroyChart('productReportsChart');
  const chartTitle=$('productChartTitle');
  const chartBox=(chartCanvas&&chartCanvas.closest('.chart-card,.product-chart-card,.product-report-chart,.card'))
    ||(chartTitle&&chartTitle.closest('.chart-card,.product-chart-card,.product-report-chart,.card'))
    ||(chartCanvas&&chartCanvas.parentElement)
    ||(chartTitle&&chartTitle.parentElement);
  if(chartBox&&chartBox!==tableCard) chartBox.remove();

  // لو الـ HTML القديم عامل Grid بعمودين، احذف أي كارت شقيق قديم خاص بالشارت
  // ثم اجعل كارت البيانات بعرض الصفحة بالكامل.
  if(tableCard&&tableCard.parentElement){
    const layout=tableCard.parentElement;
    Array.from(layout.children).forEach(child=>{
      if(child===tableCard) return;
      const text=String(child.textContent||'').trim().toLowerCase();
      const hasChart=child.querySelector?.('#productReportsChart,#productChartTitle,canvas');
      const isOldTopBox=text.includes('top 10 products')||text.includes('الأكثر مبيعاً')||text.includes('الاكثر مبيعاً');
      if(hasChart||isOldTopBox) child.remove();
    });
    layout.style.display='block';
    layout.style.gridTemplateColumns='1fr';
    layout.style.width='100%';
  }
  page.querySelectorAll('button[onclick*="refreshProductReports"],button[onclick*="printProductReports"],button[onclick*="exportProductReportExcel"]').forEach(btn=>{
    if(!btn.closest('#productReportHeaderActions')){
      const wrap=btn.parentElement;
      btn.remove();
      if(wrap && !wrap.children.length && !String(wrap.textContent||'').trim())wrap.remove();
    }
  });
}
function updateProductReportKPIs(){
  const top=productReportRows.top[0],ret=productReportRows.returned[0],dead=productReportRows.dead;
  if($('prTopProductName'))$('prTopProductName').textContent=top?.name||'—'; if($('prTopProductQty'))$('prTopProductQty').textContent=`${num(top?.qtySold||0)} قطعة`; if($('prTopProductRevenue'))$('prTopProductRevenue').textContent=`إجمالي المبيعات: ${money(top?.revenue||0)}`;
  if($('prReturnedProductName'))$('prReturnedProductName').textContent=ret?.name||'—'; if($('prReturnedProductRate'))$('prReturnedProductRate').textContent=`${num(ret?.qtyReturned||0)} قطعة`; if($('prReturnedProductQty'))$('prReturnedProductQty').textContent=`${Number(ret?.returnRate||0).toFixed(1)}% من حركة المنتج`;
  if($('prDeadStockValue'))$('prDeadStockValue').textContent=num(dead.length); if($('prDeadStockCount'))$('prDeadStockCount').textContent=`${num(dead.length)} منتج بدون حركة أكثر من 60 يوم`;
  const totalSold=(productReportRows._filteredOrders||[]).filter(o=>!['Returned','Cancel'].includes(String(o.status||''))).flatMap(parseOrderProductsForReports).reduce((s,p)=>s+Number(p.qty||0),0);
  const totalRevenue=(productReportRows._filteredOrders||[]).filter(o=>!['Returned','Cancel'].includes(String(o.status||''))).reduce((s,o)=>s+Number(o.price||0),0);
  if($('prTotalSold'))$('prTotalSold').textContent=num(totalSold); if($('prTotalRevenue'))$('prTotalRevenue').textContent=`إجمالي المبيعات: ${money(totalRevenue)}`;
  const filtered=productReportRows._filteredOrders||[]; const cancels=filtered.filter(o=>String(o.status||'')==='Cancel').length;
  if($('prCancelOrders'))$('prCancelOrders').textContent=num(cancels); if($('prAllTopName'))$('prAllTopName').textContent=top?.name||'—'; if($('prAllTopQty'))$('prAllTopQty').textContent=`${num(top?.qtySold||0)} قطعة`; if($('prAllReturnedName'))$('prAllReturnedName').textContent=ret?.name||'—'; if($('prAllReturnedQty'))$('prAllReturnedQty').textContent=`${num(ret?.qtyReturned||0)} قطعة`;
}
function ticketButton(row,type){ const tickets=type==='top'?row.soldTickets:type==='returned'?row.returnedTickets:row.cancelTickets; return `<button class="product-ticket-btn" type="button" onclick="openProductTicketModal('${encodeURIComponent(row.name)}','${type}')">Ticket ID (${num(tickets.length)})</button>`; }
function renderProductReportTable(){
  const list=$('productReportRowsList');
  if(!list)return;
  const rows=productReportRows[productReportTab]||[];
  const header=(cells,extra='')=>`<div class="product-report-line header ${extra}">${cells.map(x=>`<div class="cell">${x}</div>`).join('')}</div>`;
  const empty=text=>`<div class="product-report-empty" style="padding:24px;text-align:center">${text}</div>`;

  if(productReportTab==='top'){
    list.innerHTML=header(['Rank','Product Name','Ticket ID','Qty Sold','Revenue'])+
      (rows.length?rows.map((r,i)=>`<div class="product-report-line"><div class="cell">${i+1}</div><div class="cell product-name">${escapeHTML(r.name)}</div><div class="cell">${ticketButton(r,'top')}</div><div class="cell">${num(r.qtySold)}</div><div class="cell">${money(r.revenue)}</div></div>`).join(''):empty('لا توجد بيانات مبيعات مطابقة للفلاتر'));
  } else if(productReportTab==='returned'){
    list.innerHTML=header(['Rank','Product Name','Ticket ID','Qty Returned','Return Reason','Return Rate %','Loss Value'],'returned')+
      (rows.length?rows.map((r,i)=>`<div class="product-report-line returned"><div class="cell">${i+1}</div><div class="cell product-name">${escapeHTML(r.name)}</div><div class="cell">${ticketButton(r,'returned')}</div><div class="cell">${num(r.qtyReturned)}</div><div class="cell">${escapeHTML(r.returnReason)}</div><div class="cell">${r.returnRate.toFixed(1)}%</div><div class="cell">${money(r.lossValue)}</div></div>`).join(''):empty('لا توجد منتجات مرتجعة مطابقة للفلاتر'));
  } else if(productReportTab==='cancel'){
    list.innerHTML=header(['Rank','Product Name','Ticket ID','Qty Cancelled','Cancel Reason','Cancel Rate %','Cancel Value'],'cancel')+
      (rows.length?rows.map((r,i)=>`<div class="product-report-line cancel"><div class="cell">${i+1}</div><div class="cell product-name">${escapeHTML(r.name)}</div><div class="cell">${ticketButton(r,'cancel')}</div><div class="cell">${num(r.qtyCancelled)}</div><div class="cell">${escapeHTML(r.cancelReason)}</div><div class="cell">${r.cancelRate.toFixed(1)}%</div><div class="cell">${money(r.cancelValue)}</div></div>`).join(''):empty('لا توجد أوردرات Cancel مطابقة للفلاتر'));
  } else {
    list.innerHTML=header(['Rank','Product Name','Stock Qty','Unit Price','Last Movement','Inactive Days'],'dead')+
      (rows.length?rows.map((r,i)=>`<div class="product-report-line dead"><div class="cell">${i+1}</div><div class="cell product-name">${escapeHTML(r.name)}</div><div class="cell">${num(r.stockQty)}</div><div class="cell">${money(r.unitPrice)}</div><div class="cell">${r.lastMovement?formatDate(r.lastMovement):'لم يتحرك'}</div><div class="cell">${r.daysInactive===9999?'أكثر من 60':num(r.daysInactive)}</div></div>`).join(''):empty('لا توجد منتجات راكدة أكثر من 60 يوم'));
  }
}
function openProductTicketModal(encodedName,type){
  const name=decodeURIComponent(encodedName); const row=(productReportRows[type]||[]).find(r=>r.name===name); if(!row)return;
  productTicketModalRows=type==='top'?row.soldTickets:type==='returned'?row.returnedTickets:row.cancelTickets;
  let modal=$('productTicketModal'); if(!modal){ modal=document.createElement('div'); modal.id='productTicketModal'; modal.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.76);z-index:11000;align-items:center;justify-content:center;padding:18px;'; modal.innerHTML=`<div style="width:900px;max-width:98vw;max-height:88vh;overflow:auto;background:var(--bg-card);border:1px solid var(--border-color);border-radius:18px;padding:18px;direction:rtl"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px"><div><h3 id="productTicketModalTitle" style="margin:0"></h3><small id="productTicketModalSub"></small></div><button class="soft" onclick="closeProductTicketModal()">✕ إغلاق</button></div><div id="productTicketModalList"></div></div>`; document.body.appendChild(modal); }
  $('productTicketModalTitle').textContent=`Ticket IDs — ${name}`; $('productTicketModalSub').textContent=`إجمالي ${productTicketModalRows.length} أوردر مرتبط بالمنتج`;
  $('productTicketModalList').innerHTML=productTicketModalRows.length?`<div class="product-ticket-modal-row" style="font-weight:900;background:var(--bg-soft)"><span>Ticket ID</span><span>العميل</span><span>الدكتور</span><span>الفرع</span><span>الحالة</span><span>الكمية</span><span>التاريخ</span></div>`+productTicketModalRows.map(x=>`<div class="product-ticket-modal-row"><button class="product-ticket-btn" onclick="openProductReportOrder('${x.orderId}')">${escapeHTML(x.ticketId)}</button><span>${escapeHTML(x.customer)}</span><span>${escapeHTML(x.doctor||'—')}</span><span>${escapeHTML(x.branch)}</span><span>${escapeHTML(x.status)}</span><span>${num(x.qty)}</span><span>${x.date?formatDate(x.date):'—'}</span></div>`).join(''):'<div class="empty">لا توجد أوردرات</div>'; modal.style.display='flex';
}
function closeProductTicketModal(){ const m=$('productTicketModal'); if(m)m.style.display='none'; }
async function openProductReportOrder(orderId){ const o=orders.find(x=>String(x.id)===String(orderId)); if(!o)return; closeProductTicketModal(); const branch=o.branch||''; if(branch){ await openBranchPage(branch); setTimeout(()=>{const s=$('bSearchInput'); if(s){s.value=getTicketId(o);s.dispatchEvent(new Event('input',{bubbles:true}));s.focus();}},250); } else { showOrdersPage(); setTimeout(()=>{if(searchInput){searchInput.value=getTicketId(o);renderOrders();}},100); } }
function renderProductReportsChart(){
  destroyChart('productReportsChart');
  return;
  const canvas=$('productReportsChart'); if(!canvas||typeof Chart==='undefined')return; const isDark=(document.documentElement.getAttribute('data-theme')||'dark')==='dark'; const text=isDark?'#CBD5E1':'#334155'; const rows=(productReportRows[productReportTab]||[]).slice(0,10); let label='',data=[];
  if(productReportTab==='top'){label='Qty Sold';data=rows.map(x=>x.qtySold);if($('productChartTitle'))$('productChartTitle').textContent='Top 10 — الأكثر مبيعاً';}
  else if(productReportTab==='returned'){label='Qty Returned';data=rows.map(x=>x.qtyReturned);if($('productChartTitle'))$('productChartTitle').textContent='Top 10 — الأكثر مرتجع';}
  else if(productReportTab==='cancel'){label='Qty Cancelled';data=rows.map(x=>x.qtyCancelled);if($('productChartTitle'))$('productChartTitle').textContent='Top 10 — Cancel Group';}
  else{label='Inactive Days';data=rows.map(x=>x.daysInactive===9999?61:x.daysInactive);if($('productChartTitle'))$('productChartTitle').textContent='Top 10 — المنتجات الراكدة';}
  charts.productReportsChart=new Chart(canvas,{type:'bar',data:{labels:rows.map(x=>x.name),datasets:[{label,data,backgroundColor:'rgba(217,70,239,.55)',borderColor:'#ff4df3',borderWidth:1,borderRadius:7}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:text}}},scales:{x:{beginAtZero:true,ticks:{color:text},grid:{color:isDark?'rgba(148,163,184,.12)':'rgba(15,23,42,.08)'}},y:{ticks:{color:text},grid:{display:false}}}}});
}
function renderProductReports(){ ensureProductReportEnhancements(); buildProductReportData(); updateProductReportKPIs(); renderProductReportTable(); renderProductReportsChart(); }
async function showProductReportsPage(){ if(!canViewProductReports()){alert('Product Reports متاح للأدمن والكاشير ومدير الفرع ومدير الحسابات فقط');return;} hideAllPages(); $('productReportsPage')?.classList.remove('hidden'); setActiveMenu('productReportsPage'); ensureProductReportEnhancements(); populateProductReportFilters(); const today=getCairoDateISO(); if(!$('productReportTo').value)$('productReportTo').value=today; if(!$('productReportFrom').value){const d=new Date();d.setDate(d.getDate()-7);$('productReportFrom').value=d.toISOString().split('T')[0];} renderProductReports(); }
function applyProductReportFilters(){ renderProductReports(); }
function resetProductReportFilters(){ const d=new Date(); d.setDate(d.getDate()-7); $('productReportFrom').value=d.toISOString().split('T')[0]; $('productReportTo').value=getCairoDateISO(); if($('productReportBranch'))$('productReportBranch').value='all'; if($('productReportDoctor'))$('productReportDoctor').value='all'; if($('productReportSearch'))$('productReportSearch').value=''; renderProductReports(); }
function setProductReportTab(tab){ productReportTab=tab; ['top','returned','cancel','dead'].forEach(x=>$('productTab'+(x==='top'?'Top':x==='returned'?'Returned':x==='cancel'?'Cancel':'Dead'))?.classList.toggle('active',x===tab)); renderProductReportTable(); renderProductReportsChart(); }
async function refreshProductReports(ev){ const btn=ev?.currentTarget; const old=btn?.innerHTML; if(btn){btn.disabled=true;btn.innerHTML='جاري التحديث...';} await loadOrders(); await loadOKBItems(); populateProductReportFilters(); renderProductReports(); if(btn){btn.disabled=false;btn.innerHTML=old||'↻ Refresh';} }
function exportProductReportExcel(){
  const rows=productReportRows[productReportTab]||[]; if(!rows.length){alert('لا توجد بيانات للتصدير');return;} if(typeof XLSX==='undefined'){alert('مكتبة Excel غير متاحة');return;}
  const wb=XLSX.utils.book_new();
  const tabLabel=productReportTab==='top'?'Top Selling':productReportTab==='returned'?'Most Returned':productReportTab==='cancel'?'Cancel Group':'Dead Stock';
  const filters=getProductReportFilters();
  const usedSheetNames=new Set();
  const safeSheetName=(name,index)=>{
    let base=String(name||`Product ${index+1}`).replace(/[\\\/\?\*\[\]\:]/g,' ').replace(/\s+/g,' ').trim().slice(0,31)||`Product ${index+1}`;
    let out=base,n=2;
    while(usedSheetNames.has(out)){ const suffix=` ${n++}`; out=(base.slice(0,31-suffix.length)+suffix); }
    usedSheetNames.add(out); return out;
  };
  const setSheetWidths=(ws,widths)=>{ ws['!cols']=widths.map(w=>({wch:w})); ws['!autofilter']={ref:ws['!ref']}; };

  let summary=[];
  if(productReportTab==='top') summary=rows.map((r,i)=>({Rank:i+1,Product:r.name,'Qty Sold':r.qtySold,Revenue:r.revenue,'Orders Count':r.soldTickets.length}));
  else if(productReportTab==='returned') summary=rows.map((r,i)=>({Rank:i+1,Product:r.name,'Qty Returned':r.qtyReturned,'Return Reason':r.returnReason,'Return Rate %':Number(r.returnRate.toFixed(1)),'Loss Value':r.lossValue,'Orders Count':r.returnedTickets.length}));
  else if(productReportTab==='cancel') summary=rows.map((r,i)=>({Rank:i+1,Product:r.name,'Qty Cancelled':r.qtyCancelled,'Cancel Reason':r.cancelReason,'Cancel Rate %':Number(r.cancelRate.toFixed(1)),'Cancel Value':r.cancelValue,'Orders Count':r.cancelTickets.length}));
  else summary=rows.map((r,i)=>({Rank:i+1,Product:r.name,'Stock Qty':r.stockQty,'Unit Price':r.unitPrice,'Last Movement':r.lastMovement||'No movement','Inactive Days':r.daysInactive===9999?'60+':r.daysInactive}));

  const overviewData=[
    ['Product Report',tabLabel],
    ['Date From',filters.from||'All'],
    ['Date To',filters.to||'All'],
    ['Branch',filters.branch==='all'?'All 4 OKB Branches':filters.branch],
    ['Doctor',filters.doctor==='all'?'All Doctors':filters.doctor],
    ['Product Search',filters.search||'All'],
    [],
    Object.keys(summary[0]||{}),
    ...summary.map(row=>Object.values(row))
  ];
  const overview=XLSX.utils.aoa_to_sheet(overviewData);
  overview['!cols']=[{wch:14},{wch:34},{wch:16},{wch:16},{wch:18},{wch:18},{wch:15}];
  XLSX.utils.book_append_sheet(wb,overview,'Overview');
  usedSheetNames.add('Overview');

  if(productReportTab!=='dead'){
    rows.forEach((r,index)=>{
      const tickets=productReportTab==='top'?r.soldTickets:productReportTab==='returned'?r.returnedTickets:r.cancelTickets;
      const metricName=productReportTab==='top'?'Qty Sold':productReportTab==='returned'?'Qty Returned':'Qty Cancelled';
      const metricValue=productReportTab==='top'?r.qtySold:productReportTab==='returned'?r.qtyReturned:r.qtyCancelled;
      const valueName=productReportTab==='top'?'Revenue':productReportTab==='returned'?'Loss Value':'Cancel Value';
      const value=productReportTab==='top'?r.revenue:productReportTab==='returned'?r.lossValue:r.cancelValue;
      const reason=productReportTab==='returned'?r.returnReason:productReportTab==='cancel'?r.cancelReason:'';
      const detailRows=tickets.map((t,i)=>({
        '#':i+1,
        'Ticket ID':t.ticketId,
        'Order Number':t.orderNumber||'',
        'Customer':t.customer||'',
        'Doctor':t.doctor||'',
        'Branch':t.branch||'',
        'Status':t.status||'',
        'Quantity':Number(t.qty||0),
        'Date':t.date?formatDate(t.date):'',
        'Reason':t.reason||reason||''
      }));
      const sheetData=[
        ['Product Name',r.name],
        ['Report Type',tabLabel],
        [metricName,metricValue],
        [valueName,value],
        ['Orders Count',tickets.length],
        ...(reason?[['Main Reason',reason]]:[]),
        [],
        ['#','Ticket ID','Order Number','Customer','Doctor','Branch','Status','Quantity','Date','Reason'],
        ...detailRows.map(x=>Object.values(x))
      ];
      const ws=XLSX.utils.aoa_to_sheet(sheetData);
      setSheetWidths(ws,[6,14,16,28,24,20,14,10,16,36]);
      XLSX.utils.book_append_sheet(wb,ws,safeSheetName(r.name,index));
    });
  }
  XLSX.writeFile(wb,`product-reports-${productReportTab}-${getCairoDateISO()}.xlsx`);
  logActivity('data_exported','تصدير Product Report',`نوع التقرير: ${tabLabel} | عدد المنتجات: ${rows.length} | الصيغة: Excel`,{branch_name:'Product Reports'});
}
function printProductReports(){ window.print(); }

// ===== Branch Stock / Stock Take System =====
let currentStockTake = null;
let currentStockTakeRows = [];
const STOCK_TAKES_STORAGE_KEY = 'okb_branch_stock_takes_v1';

function canCreateStockTake(){ return isAdmin() || isAccountManager() || isStoreManager() || isCashier(); }
function canCloseStockTake(){ return isAdmin() || isAccountManager() || isStoreManager(); }
function stockItemCategory(item){ return String(item?.category || item?.item_category || item?.product_category || 'غير مصنف').trim() || 'غير مصنف'; }
function stockItemBarcode(item){ return String(item?.barcode || item?.item_barcode || item?.product_barcode || item?.code || item?.sku || item?.id || '').trim(); }
function stockItemSystemQty(item){ return Number(item?.stock_quantity ?? item?.stock_qty ?? item?.quantity ?? item?.current_stock ?? item?.balance ?? 0) || 0; }
function getSavedStockTakes(){ try{return JSON.parse(localStorage.getItem(STOCK_TAKES_STORAGE_KEY)||'[]')||[];}catch(e){return [];} }
function setSavedStockTakes(list){ localStorage.setItem(STOCK_TAKES_STORAGE_KEY,JSON.stringify(list)); }
function stockTakeStorageId(){ return `ST-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
function getAccessibleStockBranches(){
  const all=['مدينة نصر','اسكندرية','طنطا','المنصورة'];
  if(isStoreManager()||isCashier()||isAccountSupervisor()){ const m=getCurrentUserManagedBranches(); return m.length?m:[]; }
  return all;
}
function populateStockTakeFilters(){
  const b=$('stockTakeBranch'); if(b){ const cur=b.value; b.innerHTML=getAccessibleStockBranches().map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join(''); if([...b.options].some(o=>o.value===cur))b.value=cur; }
  const cats=[...new Set(okbItems.map(stockItemCategory))].sort((a,b)=>a.localeCompare(b,'ar'));
  const c=$('stockCategoryFilter'); if(c){const cur=c.value;c.innerHTML='<option value="all">كل التصنيفات</option>'+cats.map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join('');if(cats.includes(cur))c.value=cur;}
}
function buildStockTakeRows(){
  return okbItems.map((item,i)=>({item_id:item.id,product_name:item.item_name||`منتج ${i+1}`,barcode:stockItemBarcode(item),serial:String(item.serial||item.batch_no||item.lot_no||''),category:stockItemCategory(item),unit:String(item.unit||'قطعة'),location:String(item.location||item.shelf||''),expiry_date:String(item.expiry_date||''),system_qty:stockItemSystemQty(item),actual_qty:null,reason:'',price:Number(item.price||0),notes:'',manual:false}));
}
function getStockScanMode(){return document.querySelector('input[name="stockScanMode"]:checked')?.value||'increment';}
function clearManualStockProductForm(){['manualStockProductName','manualStockBarcode','manualStockSerial','manualStockCategory','manualStockLocation','manualStockExpiry','manualStockNotes'].forEach(id=>{if($(id))$(id).value='';});['manualStockSystemQty','manualStockActualQty','manualStockPrice'].forEach(id=>{if($(id))$(id).value='0';});if($('manualStockUnit'))$('manualStockUnit').value='قطعة';}
async function addManualStockProduct(){
  if(!currentStockTake){alert('ابدأ جرد جديد أولاً');return;} if(currentStockTake.status==='closed'){alert('الجرد مقفول ولا يمكن إضافة أصناف');return;}
  const name=String($('manualStockProductName')?.value||'').trim(),barcode=String($('manualStockBarcode')?.value||'').trim(),serial=String($('manualStockSerial')?.value||'').trim();
  if(!name){alert('اكتب اسم المنتج');$('manualStockProductName')?.focus();return;}
  if(barcode&&currentStockTakeRows.some(r=>String(r.barcode||'')===barcode)){alert('الباركود موجود بالفعل داخل الجرد');return;}
  const row={item_id:`manual-${Date.now()}`,product_name:name,barcode,serial,category:String($('manualStockCategory')?.value||'غير مصنف').trim()||'غير مصنف',unit:String($('manualStockUnit')?.value||'قطعة'),location:String($('manualStockLocation')?.value||'').trim(),expiry_date:String($('manualStockExpiry')?.value||''),system_qty:Math.max(0,Number($('manualStockSystemQty')?.value||0)),actual_qty:Math.max(0,Number($('manualStockActualQty')?.value||0)),reason:'',price:Math.max(0,Number($('manualStockPrice')?.value||0)),notes:String($('manualStockNotes')?.value||'').trim(),manual:true,added_by:currentUser?.name||'',added_at:new Date().toISOString()};
  currentStockTakeRows.push(row);persistCurrentStockTake();populateStockTakeFilters();renderStockTakeTable();updateStockTakeSummary();clearManualStockProductForm();
  await logActivity('stock_take_add_product','إضافة صنف يدوي للجرد',`${name}${barcode?` | Barcode: ${barcode}`:''}${serial?` | Serial: ${serial}`:''} | الفعلي: ${row.actual_qty}`,{branch_name:currentStockTake.branch});
}
function updateStockRowField(index,field,value){if(currentStockTake?.status==='closed')return;const r=currentStockTakeRows[index];if(!r)return;r[field]=value;persistCurrentStockTake();}
async function deleteStockTakeRow(index){if(currentStockTake?.status==='closed')return;const r=currentStockTakeRows[index];if(!r)return;if(!confirm(`حذف ${r.product_name} من الجرد؟`))return;currentStockTakeRows.splice(index,1);persistCurrentStockTake();renderStockTakeTable();updateStockTakeSummary();await logActivity('stock_take_remove_product','حذف صنف من الجرد',`${r.product_name}${r.barcode?` | Barcode: ${r.barcode}`:''}`,{branch_name:currentStockTake.branch});}

async function showBranchStockPage(){
  if (!(isAdmin() || isStoreManager() || isCashier() || isAccountManager())) {
    alert('صفحة Branch Stock متاحة للأدمن ومدير الفرع والكاشير ومدير الحسابات فقط');
    return;
  }
  hideAllPages(); $('branchStockPage')?.classList.remove('hidden'); setActiveMenu('branchStockPage');
  if(!okbItems.length) await loadOKBItems();
  populateStockTakeFilters(); if($('stockTakeDate'))$('stockTakeDate').value=getCairoDateISO();
  const saved=getSavedStockTakes().filter(x=>x.status==='draft' && getAccessibleStockBranches().includes(x.branch)).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  if(saved && confirm(`يوجد جرد محفوظ مؤقتاً باسم "${saved.name}" لفرع ${saved.branch}. هل تريد استكماله؟`)){ loadStockTake(saved); }
  else { currentStockTake=null; currentStockTakeRows=[]; $('stockTakeWorkspace')?.classList.add('hidden'); }
  const n=$('newStockTakeBtn'); if(n)n.style.display=canCreateStockTake()?'inline-flex':'none';
}
async function startNewStockTake(){
  if(!canCreateStockTake()){alert('غير مسموح لك ببدء جرد جديد');return;}
  const branch=$('stockTakeBranch')?.value||'',date=$('stockTakeDate')?.value||'',name=String($('stockTakeName')?.value||'').trim();
  if(!branch||!date||!name){alert('اختر الفرع والتاريخ واكتب اسم الجرد');return;}
  if(!okbItems.length){alert('لا توجد منتجات مضافة في Settings');return;}
  currentStockTake={id:stockTakeStorageId(),branch,date,name,status:'draft',created_by:currentUser?.name||'',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  currentStockTakeRows=buildStockTakeRows(); $('stockTakeWorkspace')?.classList.remove('hidden'); renderStockTakeTable(); updateStockTakeSummary(); updateStockTakePermissions();
  persistCurrentStockTake();
  await logActivity('stock_take_start','بدء جرد جديد',`${currentStockTake.name} — فرع ${currentStockTake.branch} — التاريخ: ${currentStockTake.date}`,{branch_name:currentStockTake.branch});
  $('stockBarcodeScanner')?.focus();
}
function loadStockTake(take){ currentStockTake={...take}; currentStockTakeRows=(take.rows||[]).map(x=>({...x})); $('stockTakeWorkspace')?.classList.remove('hidden'); if($('stockTakeBranch'))$('stockTakeBranch').value=take.branch;if($('stockTakeDate'))$('stockTakeDate').value=take.date;if($('stockTakeName'))$('stockTakeName').value=take.name;renderStockTakeTable();updateStockTakeSummary();updateStockTakePermissions(); }
function updateStockTakePermissions(){
  const closed=currentStockTake?.status==='closed'; const editable=!closed && canCreateStockTake();
  const s=$('saveStockDraftBtn'),c=$('closeStockTakeBtn'); if(s){s.disabled=!editable;s.style.display=closed?'none':'inline-flex';} if(c){c.disabled=closed||!canCloseStockTake();c.style.display=closed?'none':'inline-flex';}
  const txt=$('stockTakeStatusText'); if(txt)txt.textContent=closed?`تم قفل الجرد بواسطة ${currentStockTake.closed_by||'—'} في ${formatDate(currentStockTake.closed_at)}. لا يمكن التعديل.`:'الجرد مفتوح ويمكن الحفظ المؤقت والتعديل.';
}
function getFilteredStockRows(){
  const q=String($('stockProductSearch')?.value||'').trim().toLowerCase(),cat=$('stockCategoryFilter')?.value||'all';
  return currentStockTakeRows.map((r,index)=>({...r,_index:index})).filter(r=>(cat==='all'||r.category===cat)&&(!q||String(r.product_name).toLowerCase().includes(q)||String(r.barcode).toLowerCase().includes(q)));
}
function renderStockTakeTable(){
  const body=$('stockTakeTableBody'); if(!body)return; const rows=getFilteredStockRows(); const closed=currentStockTake?.status==='closed';
  body.innerHTML=rows.length?rows.map((r,i)=>{const actual=r.actual_qty===null||r.actual_qty===''?'':Number(r.actual_qty);const diff=actual===''?0:actual-Number(r.system_qty||0);const diffClass=diff>0?'stock-diff-positive':diff<0?'stock-diff-negative':'stock-diff-zero';const value=diff*Number(r.price||0);return `<tr id="stock-row-${r._index}">
  <td>${i+1}</td>
  <td><div class="stock-product-name">${escapeHTML(r.product_name)}</div><div class="stock-product-meta">${r.manual?'مضاف يدويًا':'من Settings'}</div></td>
  <td><input class="stock-table-input" style="min-width:125px" value="${escapeHTML(r.barcode||'')}" ${closed?'disabled':''} onchange="updateStockRowField(${r._index},'barcode',this.value)"></td>
  <td><input class="stock-table-input stock-serial-input" value="${escapeHTML(r.serial||'')}" ${closed?'disabled':''} placeholder="Serial / Batch" onchange="updateStockRowField(${r._index},'serial',this.value)"></td>
  <td><input class="stock-table-input" style="min-width:110px" value="${escapeHTML(r.category||'غير مصنف')}" ${closed?'disabled':''} onchange="updateStockRowField(${r._index},'category',this.value)"></td>
  <td><input class="stock-table-input stock-unit-input" value="${escapeHTML(r.unit||'قطعة')}" ${closed?'disabled':''} onchange="updateStockRowField(${r._index},'unit',this.value)"></td>
  <td><input class="stock-table-input stock-location-input" value="${escapeHTML(r.location||'')}" ${closed?'disabled':''} placeholder="رف/موقع" onchange="updateStockRowField(${r._index},'location',this.value)"></td>
  <td><input class="stock-table-input stock-expiry-input" type="date" value="${escapeHTML(r.expiry_date||'')}" ${closed?'disabled':''} onchange="updateStockRowField(${r._index},'expiry_date',this.value)"></td>
  <td>${num(r.system_qty)}</td>
  <td><input class="stock-table-input stock-actual-input" type="number" min="0" step="1" value="${actual}" ${closed?'disabled':''} oninput="updateStockActual(${r._index},this.value)" onchange="commitStockActual(${r._index})"></td>
  <td class="${diffClass}">${diff>0?'+':''}${num(diff)}</td>
  <td><input class="stock-table-input stock-reason-input" value="${escapeHTML(r.reason||'')}" ${closed?'disabled':''} placeholder="سبب الفرق..." oninput="updateStockReason(${r._index},this.value)" onchange="commitStockReason(${r._index})"></td>
  <td><input class="stock-table-input" style="width:90px" type="number" min="0" step="0.01" value="${Number(r.price||0)}" ${closed?'disabled':''} onchange="updateStockRowField(${r._index},'price',Number(this.value||0));updateStockTakeSummary();renderStockTakeTable()"></td>
  <td class="${diffClass}">${value>0?'+':''}${money(value)}</td>
  <td><input class="stock-table-input" style="min-width:150px" value="${escapeHTML(r.notes||'')}" ${closed?'disabled':''} placeholder="ملاحظات" onchange="updateStockRowField(${r._index},'notes',this.value)"></td>
  <td><div class="stock-row-actions"><button class="stock-row-btn danger" type="button" ${closed?'disabled':''} onclick="deleteStockTakeRow(${r._index})" title="حذف من الجرد">🗑</button></div></td>
  </tr>`}).join(''):'<tr><td colspan="16" class="empty">لا توجد منتجات مطابقة للفلتر</td></tr>';
}
function updateStockActual(index,value){ if(currentStockTake?.status==='closed')return; const r=currentStockTakeRows[index]; if(!r)return; r.actual_qty=value===''?null:Math.max(0,Number(value||0)); updateStockTakeSummary(); renderStockTakeTable(); }
function updateStockReason(index,value){ if(currentStockTake?.status==='closed')return; if(currentStockTakeRows[index])currentStockTakeRows[index].reason=String(value||''); }
async function commitStockActual(index){ if(!currentStockTake||currentStockTake.status==='closed')return; const r=currentStockTakeRows[index]; if(!r)return; persistCurrentStockTake(); const actual=Number(r.actual_qty||0),diff=actual-Number(r.system_qty||0); await logActivity('stock_take_count','تعديل الكمية الفعلية في الجرد',`${r.product_name}: رصيد السيستم ${r.system_qty} ← الفعلي ${actual} | الفرق ${diff>0?'+':''}${diff}`,{branch_name:currentStockTake.branch}); }
async function commitStockReason(index){ if(!currentStockTake||currentStockTake.status==='closed')return; const r=currentStockTakeRows[index]; if(!r||!String(r.reason||'').trim())return; persistCurrentStockTake(); await logActivity('stock_take_reason','إضافة سبب فرق في الجرد',`${r.product_name}: ${r.reason}`,{branch_name:currentStockTake.branch}); }
function handleStockBarcodeScan(ev){
  if(ev.key!=='Enter')return;ev.preventDefault();if(currentStockTake?.status==='closed')return;const code=String(ev.target.value||'').trim();if(!code)return;
  const idx=currentStockTakeRows.findIndex(r=>String(r.barcode)===code||String(r.serial||'')===code); if(idx<0){if(confirm('الباركود/السيريال غير موجود. هل تريد فتح نموذج إضافة صنف جديد بهذا الكود؟')){$('manualStockBarcode').value=code;$('manualStockProductName')?.focus();}return;}
  const r=currentStockTakeRows[idx],mode=getStockScanMode(); if(mode==='replace'){const q=prompt(`أدخل الكمية الفعلية للصنف: ${r.product_name}`,String(r.actual_qty??0));if(q===null)return;r.actual_qty=Math.max(0,Number(q||0));}else r.actual_qty=Number(r.actual_qty||0)+1;
  ev.target.value=''; persistCurrentStockTake(); logActivity('stock_take_scan','مسح باركود/سيريال في الجرد',`${r.product_name} | Code: ${code} | الكمية الفعلية أصبحت ${r.actual_qty}`,{branch_name:currentStockTake.branch}); updateStockTakeSummary(); renderStockTakeTable(); setTimeout(()=>document.getElementById(`stock-row-${idx}`)?.scrollIntoView({behavior:'smooth',block:'center'}),50);
}
function clearStockFilters(){ if($('stockProductSearch'))$('stockProductSearch').value='';if($('stockCategoryFilter'))$('stockCategoryFilter').value='all';renderStockTakeTable(); }
function updateStockTakeSummary(){
  if(!currentStockTake)return; const counted=currentStockTakeRows.filter(r=>r.actual_qty!==null&&r.actual_qty!=='').length; let qty=0,value=0,gain=0,loss=0;
  currentStockTakeRows.forEach(r=>{if(r.actual_qty===null||r.actual_qty==='')return;const d=Number(r.actual_qty)-Number(r.system_qty||0),v=d*Number(r.price||0);qty+=d;value+=v;if(v>0)gain+=v;if(v<0)loss+=Math.abs(v);});
  if($('stockTakeCurrentName'))$('stockTakeCurrentName').textContent=currentStockTake.name;if($('stockCountedProducts'))$('stockCountedProducts').textContent=`${num(counted)} / ${num(currentStockTakeRows.length)}`;if($('stockVarianceQty'))$('stockVarianceQty').textContent=(qty>0?'+':'')+num(qty);if($('stockVarianceValue'))$('stockVarianceValue').textContent=(value>0?'+':'')+money(value);if($('stockVarianceGain'))$('stockVarianceGain').textContent=money(gain);if($('stockVarianceLoss'))$('stockVarianceLoss').textContent=money(loss);if($('stockVarianceNet'))$('stockVarianceNet').textContent=(value>0?'+':'')+money(value);
}
function persistCurrentStockTake(){ if(!currentStockTake)return; currentStockTake.updated_at=new Date().toISOString(); const take={...currentStockTake,rows:currentStockTakeRows}; const list=getSavedStockTakes(); const idx=list.findIndex(x=>x.id===take.id); if(idx>=0)list[idx]=take;else list.push(take);setSavedStockTakes(list); }
async function saveStockTakeDraft(){ if(!currentStockTake||currentStockTake.status==='closed')return;persistCurrentStockTake();await logActivity('stock_take_draft','حفظ جرد مؤقت',`${currentStockTake.name} — فرع ${currentStockTake.branch}`,{branch_name:currentStockTake.branch});alert('تم حفظ الجرد مؤقتاً ويمكنك استكماله لاحقاً'); }
async function closeCurrentStockTake(){
  if(!canCloseStockTake()){alert('قفل الجرد متاح للأدمن وAccount Manager وStore Manager فقط');return;} if(!currentStockTake||currentStockTake.status==='closed')return;
  const uncounted=currentStockTakeRows.filter(r=>r.actual_qty===null||r.actual_qty==='').length; if(uncounted && !confirm(`يوجد ${uncounted} منتج لم يتم جرده. سيتم اعتبار الكمية الفعلية لهم مساوية لرصيد السيستم. هل تريد المتابعة؟`))return;
  currentStockTakeRows.forEach(r=>{if(r.actual_qty===null||r.actual_qty==='')r.actual_qty=Number(r.system_qty||0);});
  if(!confirm('سيتم قفل الجرد ومنع التعديل وتسوية رصيد المخزن على الكمية الفعلية. هل أنت متأكد؟'))return;
  // Auto adjustment: update any stock column that already exists in items table.
  for(const row of currentStockTakeRows){const item=okbItems.find(x=>String(x.id)===String(row.item_id));if(!item)continue;const col=['stock_quantity','stock_qty','quantity','current_stock','balance'].find(k=>Object.prototype.hasOwnProperty.call(item,k));if(col){const {error}=await supabaseClient.from('items').update({[col]:Number(row.actual_qty||0)}).eq('id',row.item_id);if(error)console.warn('Stock adjustment failed',row.product_name,error.message);else item[col]=Number(row.actual_qty||0);}}
  currentStockTake.status='closed';currentStockTake.closed_by=currentUser?.name||'';currentStockTake.closed_at=new Date().toISOString();persistCurrentStockTake();
  await logActivity('stock_take_close','قفل وتسوية جرد فرع',`${currentStockTake.name} — فرع ${currentStockTake.branch} — تمت التسوية على الكميات الفعلية`,{branch_name:currentStockTake.branch});
  renderStockTakeTable();updateStockTakeSummary();updateStockTakePermissions();alert('تم قفل الجرد وإصدار تقرير الفروقات وتنفيذ التسوية على أعمدة المخزون المتاحة');
}
function exportStockVarianceExcel(){
  if(!currentStockTake){alert('ابدأ أو افتح جرد أولاً');return;}if(typeof XLSX==='undefined'){alert('مكتبة Excel غير متاحة');return;}
  const data=currentStockTakeRows.map((r,i)=>{const actual=r.actual_qty===null?'':Number(r.actual_qty),diff=actual===''?'':actual-Number(r.system_qty||0);return {'#':i+1,'Product Name':r.product_name,'Barcode':r.barcode,'Serial / Batch':r.serial||'','Category':r.category||'','Unit':r.unit||'','Location':r.location||'','Expiry Date':r.expiry_date||'','System Qty':r.system_qty,'Actual Qty':actual,'Variance Qty':diff,'Reason':r.reason,'Price':r.price,'Variance Value':diff===''?'':diff*r.price,'Notes':r.notes||'','Manual Product':r.manual?'Yes':'No'};});
  const ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Variance Report');XLSX.writeFile(wb,`branch-stock-${currentStockTake.branch}-${currentStockTake.date}.xlsx`);
}
function printBranchStock(){window.print();}
async function refreshBranchStock(){await loadOKBItems();if(currentStockTake?.status!=='closed'){const map=new Map(currentStockTakeRows.map(r=>[String(r.item_id),r]));currentStockTakeRows=buildStockTakeRows().map(r=>{const old=map.get(String(r.item_id));return old?{...r,actual_qty:old.actual_qty,reason:old.reason}:r;});}populateStockTakeFilters();renderStockTakeTable();updateStockTakeSummary();if(currentStockTake)await logActivity('stock_take_refresh','تحديث بيانات الجرد',`${currentStockTake.name} — فرع ${currentStockTake.branch}`,{branch_name:currentStockTake.branch});}


function isManager() { return currentUser && getRoleKey(currentUser.role) === "manager"; }
function isExecutiveAssistant() { return currentUser && getRoleKey(currentUser.role) === "executive_assistant"; }
function getRoleKey(role) { return String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function isSecretary() { const r = getRoleKey(currentUser && currentUser.role); return r === 'secretary' || r === 'receptionist'; }
function isReceptionist() { return isSecretary(); }
function isCashier() { return currentUser && getRoleKey(currentUser.role) === 'cashier'; }
function isStoreManager() { return currentUser && getRoleKey(currentUser.role) === 'store_manager'; }
function isAccountSupervisor() { return currentUser && getRoleKey(currentUser.role) === 'account_supervisor'; }
function isAccountManager() {
  if (!currentUser) return false;
  const role = getRoleKey(currentUser.role);
  return role === 'account_manager' || role === 'account_supervisor';
}
function canManageDailyLock() { return isAdmin() || isAccountManager() || isCashier(); }
function canUnlockDailyLock() { return isAdmin() || isAccountManager(); }
function canManageKhaznaAndTransfer() { return isAdmin() || isAccountManager(); }
function canViewKhazna() { return isAdmin() || isAccountManager() || isCashier(); }
function canCollectOrders() { return isAdmin() || isAccountManager() || isCashier(); }
function isAgent() { return currentUser && getRoleKey(currentUser.role) === "agent"; }
function isOperationManager() { const r = getRoleKey(currentUser && currentUser.role); return r === "manager" || r === "operation_manager" || r === "delivery_manager"; }
function canViewAdminReports() { return isAdmin() || isOperationManager(); }
function canViewGlobalShippingDashboard() { return isAdmin() || isOperationManager() || isAgent() || isAccountManager(); }
function canViewShippingRank() { return canViewGlobalShippingDashboard() || isStoreManager(); }
function getCurrentUserManagedBranches() {
  if (!currentUser || !currentUser.managed_branches) return [];
  if (Array.isArray(currentUser.managed_branches)) return currentUser.managed_branches;
  try { return JSON.parse(currentUser.managed_branches) || []; } catch(e) { return []; }
}
function isOrderInManagedBranches(order, branches = getCurrentUserManagedBranches()) {
  if (!branches.length) return false;
  const shippingNames = branches.map(getBranchShippingCompanyName).filter(Boolean);
  return branches.includes(order?.branch) ||
    branches.includes(order?.shipping_company) ||
    shippingNames.includes(order?.shipping_company);
}
function canAccessBranch(branchName) {
  if (isAccountSupervisor()) return getCurrentUserManagedBranches().includes(branchName);
  if (isAdmin() || isManager() || isExecutiveAssistant() || isSecretary() || getRoleKey(currentUser?.role) === 'account_manager') return true;
  if (isStoreManager() || isCashier()) return getCurrentUserManagedBranches().includes(branchName);
  return true;
}
function percent(p, t) { return t ? ((p / t) * 100).toFixed(1) + "%" : "0%"; }
function percentNum(p, t) { return t ? ((p / t) * 100) : 0; }
function isFakeDeliveryUpdateOrder(o) { return String(o.status || "").toLowerCase().trim() === "fake delivery update"; }
function isFakeDoctorOrder(o) { return String(o.status || "").toLowerCase().trim() === "fake doctor"; }
function getFakeCount(list) { return list.filter(o => isFakeDoctorOrder(o) || isFakeDeliveryUpdateOrder(o)).length; }
function getFakeDoctorCount(list) { return list.filter(o => isFakeDoctorOrder(o)).length; }
function getFakeDeliveryUpdateCount(list) { return list.filter(o => isFakeDeliveryUpdateOrder(o)).length; }

// ===== Ticket ID / Barcode System =====
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatSequentialTicketId(value) {
  const n = Math.max(1, Number(value || 1));
  return String(n).padStart(5, '0');
}

function generateOrderBarcode(ticketId) {
  const cleanTicket = onlyDigits(ticketId).padStart(5, '0');
  // نفس صيغة الباركود المحفوظة والمعتمدة في Supabase
  return `11000000000${cleanTicket}`;
}

function fallbackTicketIdFromOrder(order) {
  const raw = onlyDigits(order?.id || order?.created_at || Date.now());
  if (raw.length) return formatSequentialTicketId(Number(raw.slice(-8)) || 1);
  return '00001';
}

function getTicketId(order) {
  const ticket = onlyDigits(order?.ticket_id);
  return ticket ? formatSequentialTicketId(Number(ticket)) : fallbackTicketIdFromOrder(order);
}

function getOrderBarcode(order) {
  // الأولوية للباركود المحفوظ بالفعل في Supabase
  const barcode = onlyDigits(order?.order_barcode);
  return barcode || generateOrderBarcode(getTicketId(order));
}

let ticketSequenceCache = null;

function isNewTicketSequenceOrder(row) {
  const meta = getOrderMeta(row);
  return meta && meta.ticket_seq_v2 === true;
}

async function getCurrentMaxTicketNumberFromDB() {
  let maxTicket = 0;
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseClient
      .from('orders')
      .select('ticket_id,notes')
      .range(from, to);

    if (error) {
      console.warn('Could not read existing ticket IDs:', error.message || error);
      break;
    }

    (data || []).forEach(row => {
      if (!isNewTicketSequenceOrder(row)) return;
      const n = Number(onlyDigits(row?.ticket_id));
      if (Number.isFinite(n) && n > maxTicket) maxTicket = n;
    });

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return maxTicket;
}

async function ticketExists(ids) {
  const { data, error } = await supabaseClient
    .from('orders')
    .select('id')
    .or(`ticket_id.eq.${ids.ticket_id},order_barcode.eq.${ids.order_barcode}`)
    .limit(1);

  if (error) {
    console.warn('Ticket existence check failed:', error.message || error);
    return false;
  }
  return !!(data && data.length);
}

async function reserveNextOrderIdentifiers() {
  const { data, error } = await supabaseClient.rpc('get_next_order_ticket');

  if (error) {
    console.error('Supabase ticket sequence error:', error);
    throw new Error('تعذر حجز Ticket ID من Supabase: ' + (error.message || 'خطأ غير معروف'));
  }

  let payload = data || {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = {}; }
  }

  const ticket_id = formatSequentialTicketId(payload.ticket_id || payload.ticket || payload.id);
  const order_barcode = onlyDigits(payload.order_barcode) || generateOrderBarcode(ticket_id);

  if (!ticket_id || !order_barcode) {
    throw new Error('Supabase لم يرجع Ticket ID أو Barcode بشكل صحيح');
  }

  return { ticket_id, order_barcode };
}

async function makeOrderIdentifiers() {
  return reserveNextOrderIdentifiers();
}

async function assignOrderIdentifiers(orderId, attempts = 6) {
  if (!orderId) return null;
  for (let i = 0; i < attempts; i++) {
    const ids = await reserveNextOrderIdentifiers();
    const { data, error } = await supabaseClient
      .from('orders')
      .update(ids)
      .eq('id', orderId)
      .select('ticket_id,order_barcode')
      .single();
    if (!error && data) return data;
    console.warn('Ticket/barcode retry:', error?.message || error);
  }
  return null;
}

async function ensureOrderIdentifiers(order) {
  if (!order?.id) return order;
  if (order.ticket_id && order.order_barcode) return order;
  const ids = await assignOrderIdentifiers(order.id);
  if (ids) {
    order.ticket_id = ids.ticket_id;
    order.order_barcode = ids.order_barcode;
  }
  return order;
}

function getDoctorCodeByName(name) {
  if (!name) return '';
  const doc = doctorsList.find(d => (d.name || '') === name);
  return doc ? (doc.code || '') : '';
}
function extractDoctorInfo(text) {
    const value = String(text || "").trim();

    const codeMatch = value.match(/\b([A-Za-z]{3})\b/);

    const doctorCode = codeMatch ? codeMatch[1].toUpperCase() : "";

    const doctorName = value
        .replace(/\b[A-Za-z]{3}\b/g, "")
        .replace(/[-–—]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return {
        doctorName,
        doctorCode
    };
}

function extractDoctorCodeFromText(...values) {
    for (const v of values) {
        const info = extractDoctorInfo(v);
        if (info.doctorCode) return info.doctorCode;
    }
    return "";
}

function matchesOrderSearch(order, search) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return true;
  const qDigits = onlyDigits(q);

  // ✅ نجيب كود الدكتور من قائمة الدكاترة تلقائياً
  const doctorCode = getDoctorCodeByName(order?.doctor_name);

  const fields = [
    order?.employee_name,
    order?.doctor_name,
    doctorCode,                  
    order?.doctor_code,         
    order?.customer_name,
    order?.phone,
    order?.ticket_id,
    order?.order_barcode,
    getTicketId(order),
    getOrderBarcode(order)
  ].map(v => String(v || '').toLowerCase());
  const textMatch = fields.some(v => v.includes(q));
  const digitMatch = qDigits && fields.some(v => onlyDigits(v).includes(qDigits));
  return textMatch || digitMatch;
}


// ===== Branch Fixed Shipping Company =====
function getBranchShippingCompanyName(branchName) {
  const map = {
    'مدينة نصر': 'Nasr City Branch',
    'اسكندرية': 'Alexandria Branch',
    'طنطا': 'TanTa Branch',
    'المنصورة': 'Mansoura Branch'
  };
  return map[branchName] || branchName || '';
}

function setBranchShippingSelectToCurrentBranch() {
  const bShip = document.getElementById('bShippingCompany');
  if (!bShip) return;
  const fixedName = getBranchShippingCompanyName(currentBranchName);
  bShip.innerHTML = fixedName ? `<option value="${fixedName}">${fixedName}</option>` : '<option value="">اختر شركة الشحن</option>';
  bShip.value = fixedName;
  bShip.disabled = true;
  bShip.style.opacity = '0.85';
  bShip.title = 'شركة الشحن مثبتة تلقائيًا حسب الفرع';
}

function setBranchStatusToDelivering() {
  const bStatus = document.getElementById('bStatus');
  if (!bStatus) return;
  bStatus.value = 'Delivering';
  bStatus.disabled = true;
  bStatus.style.opacity = '0.85';
  bStatus.title = 'حالة الأوردر مثبتة تلقائيًا على Delivering';
}

function canEditKhaznaShippingCost() {
  return isAdmin();
}

function renderKhaznaShippingCostPermissionUI() {
  const btn = document.getElementById('kShippingCostEditBtn');
  const editBox = document.getElementById('kShippingCostEdit');
  if (btn) btn.style.display = canEditKhaznaShippingCost() ? 'inline-flex' : 'none';
  if (editBox && !canEditKhaznaShippingCost()) editBox.style.display = 'none';
}

// ===== تحكم مرات التحصيل للموظفين =====
const COLLECT_META_PREFIX = "[COLLECT_META:";
const COLLECT_META_REGEX = /\n?\[COLLECT_META:([\s\S]*?)\]\s*$/;

const ORDER_META_PREFIX = "[ORDER_META:";
const ORDER_META_REGEX = /\n?\[ORDER_META:([\s\S]*?)\]\s*$/;

function getOrderMeta(order) {
  const notes = String(order?.notes || "");
  const match = notes.match(ORDER_META_REGEX);
  if (!match) return { discount: 0, ticket_seq_v2: false };
  try {
    const parsed = JSON.parse(match[1]) || {};
    return {
      ...parsed,
      discount: Number(parsed.discount || 0),
      ticket_seq_v2: parsed.ticket_seq_v2 === true
    };
  }
  catch(e) { return { discount: 0, ticket_seq_v2: false }; }
}

function stripOrderMeta(notes) {
  return String(notes || "").replace(ORDER_META_REGEX, "").trim();
}

function buildNotesWithOrderMeta(notes, meta) {
  const cleanNotes = stripOrderMeta(String(notes || "").replace(COLLECT_META_REGEX, "").trim());
  const safeMeta = { ...(meta || {}), discount: Number(meta?.discount || 0) };
  return `${cleanNotes || "لا توجد ملاحظات"}\n${ORDER_META_PREFIX}${JSON.stringify(safeMeta)}]`;
}

function getOrderByIdAny(orderId) {
  const pools = [branchOrders, khaznaOrders, orders];
  for (const arr of pools) {
    if (!Array.isArray(arr)) continue;
    const found = arr.find(o => String(o.id) === String(orderId));
    if (found) return found;
  }
  return null;
}

function getCollectMeta(order) {
  const notes = String(order?.notes || "");
  const match = notes.match(COLLECT_META_REGEX);
  if (!match) return { count: 0, history: [] };
  try {
    const parsed = JSON.parse(match[1]);
    return {
      count: Number(parsed.count || 0),
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch (e) {
    return { count: 0, history: [] };
  }
}

function stripCollectMeta(notes) {
  return stripOrderMeta(String(notes || "").replace(COLLECT_META_REGEX, "").trim());
}

function buildNotesWithCollectMeta(notes, meta) {
  const cleanNotes = stripCollectMeta(notes);
  const safeMeta = {
    count: Number(meta?.count || 0),
    history: Array.isArray(meta?.history) ? meta.history : []
  };
  return `${cleanNotes}${cleanNotes ? "\n" : ""}${COLLECT_META_PREFIX}${JSON.stringify(safeMeta)}]`;
}

function canCurrentUserCollect(order) {
  if (isAdmin()) return true;
  return getCollectMeta(order).count < 2;
}

function isFinalizedDeliveredOrder(order) {
  return String(order?.status || '').trim() === 'Signed' && Number(getCollectMeta(order).count || 0) >= 2;
}
function showDeliveredOrderLockedMessage() {
  alert('تم تسليم وتحصيل هذا الأوردر، لا يجوز التعديل على أوردر تم تسليمه.');
}

function getCollectButtonHtml(order, src) {
  if (!canCollectOrders()) return "";
  if (typeof isOrderLockedByDaily === 'function' && isOrderLockedByDaily(order)) {
    return disabledActionButton('$ تحصيل');
  }
  const meta = getCollectMeta(order);
  const count = Number(meta.count || 0);

  if (!isAdmin() && count >= 2) return "";

  const isSecondEmployeeTry = !isAdmin() && count === 1;
  const collectPrefix = count > 0 ? String(count) : '$';
  const label = `${collectPrefix} تحصيل`;
  const opacity = isSecondEmployeeTry ? "opacity:.5;" : "";
  const title = isSecondEmployeeTry
    ? "آخر مرة متاحة للموظف لتعديل التحصيل"
    : (isAdmin() && count >= 2 ? "تحصيل/تعديل متاح للأدمن فقط" : "تحصيل الأوردر");

  return `<button title="${title}" onclick="openCollectModal('${order.id}','${String(order.customer_name||'').replace(/'/g,"\\'")}',${Number(order.price||0)},${Number(order.deposit||0)},'${src}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.28);background:linear-gradient(135deg,rgba(100,210,240,0.28),rgba(80,190,230,0.20));backdrop-filter:blur(10px);color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;box-shadow:0 2px 8px rgba(100,210,240,0.18);text-shadow:0 1px 2px rgba(0,0,0,0.2);${opacity}">${label}</button>`;
}

function handleEnter(e) { if (e.key === "Enter") login(); }

function calcRevenueBreakdown(list) {
  const total = list.reduce((s, o) => s + Number(o.price || 0), 0);
  const totalDeposit = list.reduce((s, o) => s + Number(o.deposit || 0), 0);
  const sum = arr => arr.reduce((s, o) => s + Number(o.price || 0), 0);
  return {
    total,
    totalDeposit,
    confirmed: sum(list.filter(o => o.status === "تم التأكيد")),
    pickedUp: sum(list.filter(o => o.status === "Picked-up")),
    inTransit: sum(list.filter(o => o.status === "In transit")),
    delivering: sum(list.filter(o => o.status === "Delivering")),
    signed: sum(list.filter(o => o.status === "Signed")),
    returning: sum(list.filter(o => o.status === "Returning")),
    returned: sum(list.filter(o => o.status === "Returned")),
    transit: sum(list.filter(o => o.status === "Transit")),
    fakeDoctor: sum(list.filter(o => isFakeDoctorOrder(o))),
    fakeDelivery: sum(list.filter(o => isFakeDeliveryUpdateOrder(o)))
  };
}

function statHTML(count, amount, label, tone = "") {
  return `<span class="stat-count">${num(count)}</span><small class="stat-money ${tone}">${label}: ${money(amount)}</small>`;
}

function getPaginatedRows(list, scope) {
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (pageState[scope] > totalPages) pageState[scope] = totalPages;
  if (pageState[scope] < 1) pageState[scope] = 1;
  const start = (pageState[scope] - 1) * PAGE_SIZE;
  return { rows: list.slice(start, start + PAGE_SIZE), start, totalPages };
}

function renderPagination(containerId, total, scope) {
  const container = $(containerId);
  if (!container) return;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = pageState[scope];
  if (total <= PAGE_SIZE) { container.innerHTML = ""; return; }
  let html = "";
  html += `<button onclick="changePage('${scope}', ${current - 1})" ${current === 1 ? "disabled" : ""}>Prev</button>`;
  const startPage = Math.max(1, current - 2);
  const endPage = Math.min(totalPages, current + 2);
  if (startPage > 1) {
    html += `<button onclick="changePage('${scope}', 1)">1</button>`;
    if (startPage > 2) html += `<span class="pagination-info">...</span>`;
  }
  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="${p === current ? "active" : ""}" onclick="changePage('${scope}', ${p})">${p}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="pagination-info">...</span>`;
    html += `<button onclick="changePage('${scope}', ${totalPages})">${totalPages}</button>`;
  }
  html += `<button onclick="changePage('${scope}', ${current + 1})" ${current === totalPages ? "disabled" : ""}>Next</button>`;
  html += `<span class="pagination-info">Page ${current} of ${totalPages} | Total ${num(total)}</span>`;
  container.innerHTML = html;
}

function changePage(scope, page) {
  pageState[scope] = page;
  if (scope === "orders") renderOrders();
  if (scope === "shippingAnalysis" || scope === "doctorsAnalysis") renderAnalytics();
  if (scope === "shippingRank") renderShippingRank();
  if (scope === "doctorRank") renderDoctorRank();
  if (scope === "branchRank") renderBranchRank();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetAllPages() { Object.keys(pageState).forEach(k => pageState[k] = 1); }

// ===== دوال الحذف الجماعي =====
function toggleSelectCurrentPage(checkbox) {
  if (!isAdmin()) return;
  
  const filtered = getFilteredOrders();
  const page = getPaginatedRows(filtered, "orders");
  const pageIds = page.rows.map(o => String(o.id));
  
  if (checkbox.checked) {
    pageIds.forEach(id => selectedOrderIds.add(id));
  } else {
    pageIds.forEach(id => selectedOrderIds.delete(id));
  }
  
  renderOrders();
}

function toggleSelectOrder(checkbox, orderId) {
  if (!isAdmin()) return;
  
  if (checkbox.checked) {
    selectedOrderIds.add(String(orderId));
  } else {
    selectedOrderIds.delete(String(orderId));
  }
  
  const countEl = $("selectedOrdersCount");
  if (countEl) countEl.textContent = `${selectedOrderIds.size} عميل محدد`;
  
  const bar = $("bulkDeleteBar");
  if (bar) bar.classList.toggle("hidden", selectedOrderIds.size === 0);
  
  const selectPage = $("selectPageOrders");
  if (selectPage) {
    const filtered = getFilteredOrders();
    const page = getPaginatedRows(filtered, "orders");
    const pageIds = page.rows.map(o => String(o.id));
    const selectedInPage = pageIds.filter(id => selectedOrderIds.has(id)).length;
    selectPage.checked = pageIds.length > 0 && selectedInPage === pageIds.length;
    selectPage.indeterminate = selectedInPage > 0 && selectedInPage < pageIds.length;
  }
}

function clearSelectedOrders() {
  if (!isAdmin()) return;
  selectedOrderIds.clear();
  renderOrders();
}

async function deleteSelectedOrders() {
  if (!isAdmin()) {
    alert("غير مسموح بالحذف");
    return;
  }
  
  if (selectedOrderIds.size === 0) {
    alert("لا توجد أوردرات محددة للحذف");
    return;
  }
  
  const confirmDelete = confirm(`⚠️ تحذير: أنت على وشك حذف ${selectedOrderIds.size} أوردر بشكل دائم. هل أنت متأكد؟`);
  if (!confirmDelete) return;
  
  const idsToDelete = Array.from(selectedOrderIds);
  const BATCH_SIZE = 20;
  let deletedCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
    const batch = idsToDelete.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseClient
      .from("orders")
      .delete()
      .in("id", batch);
      
    if (error) {
      console.error("Batch delete error:", error);
      errorCount += batch.length;
    } else {
      deletedCount += batch.length;
    }
  }
  
  if (errorCount > 0) {
    alert(`⚠️ تم حذف ${deletedCount} أوردر بنجاح، ولكن فشل حذف ${errorCount} أوردر.`);
  } else {
    alert(`✅ تم حذف ${deletedCount} أوردر بنجاح.`);
  }
  
  await logActivity('order_deleted','حذف جماعي للأوردرات',`تم حذف ${deletedCount} أوردر${errorCount ? ` وفشل حذف ${errorCount}` : ''}`);
  selectedOrderIds.clear();
  await loadOrders();
}

// ===== دوال التحقق من الصورة والديبوزيت =====
function validateDepositWithImage(deposit, imageFile, existingImageUrl) {
  if (deposit > 0) {
    if (!imageFile && !existingImageUrl) {
      alert(`⚠️ يجب رفع صورة إثبات الدفع (إيصال أو صورة تحويل) لأن المبلغ المدفوع ${money(deposit)}`);
      return false;
    }
  }
  return true;
}

function validateImageFile(file) {
  if (!file) return true;
  
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const maxSize = 5 * 1024 * 1024;
  
  if (!allowedTypes.includes(file.type)) {
    alert("❌ صيغة الصورة غير مدعومة. يرجى رفع صورة بصيغة JPG, PNG, WEBP أو GIF");
    return false;
  }
  
  if (file.size > maxSize) {
    alert("❌ حجم الصورة كبير جداً. الحد الأقصى 5 ميجابايت");
    return false;
  }
  
  return true;
}

// ===== دوال رفع وحذف الصور =====
async function uploadPaymentImage(file, orderId) {
  if (!file || !orderId) return null;
  
  const fileExt = file.name.split('.').pop();
  const fileName = `order_${orderId}_${Date.now()}.${fileExt}`;
  const filePath = `${fileName}`;
  
  const { data, error } = await supabaseClient.storage
    .from('payment-proofs')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true
    });
    
  if (error) {
    console.error("Upload error:", error);
    alert("فشل رفع الصورة: " + error.message);
    return null;
  }
  
  const { data: urlData } = supabaseClient.storage
    .from('payment-proofs')
    .getPublicUrl(filePath);
    
  return urlData.publicUrl;
}

async function deletePaymentImage(imageUrl) {
  if (!imageUrl) return;
  
  const path = imageUrl.split('/payment-proofs/')[1];
  if (!path) return;
  
  const { error } = await supabaseClient.storage
    .from('payment-proofs')
    .remove([path]);
    
  if (error) console.error("Delete error:", error);
}

function previewPaymentImage(input) {
  const file = input.files[0];
  if (file) {
    if (!validateImageFile(file)) {
      input.value = "";
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const preview = document.getElementById("paymentImagePreview");
      const img = document.getElementById("paymentPreviewImg");
      if (preview && img) {
        img.src = e.target.result;
        preview.style.display = "block";
      }
      const warningEl = document.getElementById("depositImageWarning");
      if (warningEl) warningEl.style.display = "none";
    };
    reader.readAsDataURL(file);
  }
}

function clearPaymentImage() {
  const fileInput = document.getElementById("paymentImage");
  const previewDiv = document.getElementById("paymentImagePreview");
  const existingField = document.getElementById("existingPaymentImage");
  
  if (fileInput) fileInput.value = "";
  if (previewDiv) previewDiv.style.display = "none";
  if (existingField) existingField.value = "";
  
  checkDepositImageRequirement();
}

function viewPaymentImage(imageUrl) {
  if (!imageUrl) return;
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed; top:0; left:0; width:100%; height:100%; 
    background:rgba(0,0,0,0.9); z-index:10000; 
    display:flex; align-items:center; justify-content:center; 
    cursor:pointer; direction:ltr;
  `;
  
  const img = document.createElement('img');
  img.src = imageUrl;
  img.style.cssText = `
    max-width:90%; max-height:90%; 
    border-radius:12px; box-shadow:0 0 30px rgba(0,0,0,0.5);
  `;
  
  modal.appendChild(img);
  modal.onclick = () => modal.remove();
  document.body.appendChild(modal);
}

// ===== دوال الثيم =====
function initTheme() {
  let savedTheme = 'dark';
  try {
    savedTheme = sessionStorage.getItem('okb_theme') || 'dark';
  } catch (e) { savedTheme = 'light'; }
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateChartsTheme(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  try { sessionStorage.setItem('okb_theme', newTheme); } catch (e) { }
  updateChartsTheme(newTheme);
  
  if (typeof Chart !== 'undefined' && Chart.defaults) {
    if (charts) {
      Object.keys(charts).forEach(key => {
        if (charts[key]) charts[key].update();
      });
    }
    setTimeout(() => {
      if (!document.getElementById('shippingRankPage').classList.contains('hidden')) renderShippingCharts();
      if (!document.getElementById('doctorRankPage').classList.contains('hidden')) renderDoctorCharts();
    }, 100);
  }
}

function updateChartsTheme(theme) {
  if (typeof Chart === 'undefined') return;
  const isDark = theme === 'dark';
  Chart.defaults.color = isDark ? '#94A3B8' : '#64748B';
  Chart.defaults.borderColor = isDark ? 'rgba(241,245,249,0.1)' : 'rgba(15,23,42,0.05)';
}

// ===== دوال التاريخ =====
function getCairoOffset(d) {
  try {
    const cairoTime = new Date(d.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
    const offset = (cairoTime - d) / (1000 * 60 * 60);
    return offset;
  } catch (e) {
    return 2;
  }
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
      timeZone: 'Africa/Cairo'
    }).format(d);
  } catch (e) {
    return iso;
  }
}

function parsePreciseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  let raw = String(value).trim();
  if (!raw) return null;
  // Supabase timestamps without an explicit zone are UTC; make that explicit
  // so every device displays the same Cairo time.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) {
    raw = raw.replace(' ', 'T') + 'Z';
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatEnglishDateTime(value) {
  const date = parsePreciseServerDate(value);
  if (!date) return value ? String(value) : '—';
  return new Intl.DateTimeFormat('en-GB', {
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hour12:false, timeZone:'Africa/Cairo'
  }).format(date);
}

function isInDateRange(order) {
  if (!activeDateFrom && !activeDateTo) return true;
  const raw = order.created_at;
  if (!raw) return true;
  const orderDate = raw.split("T")[0];
  if (activeDateFrom && activeDateTo) return orderDate >= activeDateFrom && orderDate <= activeDateTo;
  if (activeDateFrom) return orderDate >= activeDateFrom;
  return orderDate <= activeDateTo;
}

function applyDateFilter() {
  const from = $("fromDate").value;
  const to = $("toDate").value;
  if (!from && !to) { alert("اختر تاريخ من أو إلى على الأقل"); return; }
  activeDateFrom = from || null;
  activeDateTo = to || null;
  const badge = $("activeDateBadge");
  let label = "📅 ";
  if (activeDateFrom && activeDateTo) label += `${activeDateFrom} → ${activeDateTo}`;
  else if (activeDateFrom) label += `من ${activeDateFrom}`;
  else label += `حتى ${activeDateTo}`;
  badge.textContent = label;
  badge.classList.add("visible");
  resetAllPages();
  renderOrders();
  renderAnalytics();
  renderRanks();
}

function resetDateFilter() {
  activeDateFrom = null; activeDateTo = null;
  $("fromDate").value = ""; $("toDate").value = "";
  $("activeDateBadge").classList.remove("visible");
  if (searchInput) searchInput.value = "";
  if (filterStatus) filterStatus.value = "الكل";
  if (filterEmployee) filterEmployee.value = "الكل";
  const shippingFilterEl = document.getElementById("filterShippingCompany");
  if (shippingFilterEl) shippingFilterEl.value = "الكل";
  resetAllPages();
  renderOrders(); renderAnalytics(); renderRanks();
}

// ===== دوال تسجيل الدخول =====
async function login() {
  const { data, error } = await supabaseClient
    .from("user")
    .select("*")
    .eq("username", loginUsername.value.trim())
    .eq("password", loginPassword.value.trim())
    .limit(1);

  if (error || !data || !data.length) { loginError.style.display = "block"; return; }
  const u = data[0];
  if (u.active === false) { loginError.style.display = "block"; return; }

  resetAppState();

  currentUser = {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role || (u.username === "admin" ? "admin" : "agent"),
    managed_branches: u.managed_branches || null
  };
  sessionStorage.setItem("okb_current_user", JSON.stringify(currentUser));
  await logActivity("login", "تسجيل دخول", "تم تسجيل الدخول إلى السيستم بنجاح");

  loginPage.classList.add("hidden");
  app.classList.remove("hidden");

  setupUserView();
  await loadDoctors();
  await loadShippingSystems();
  await loadOrders();
  if (isAdmin() || isExecutiveAssistant()) { await loadUsers(); applyUsersFormRoleLock(); }
  await loadOKBItems();

  hideAllPages();
  $("ordersPage").classList.remove("hidden");
  setActiveMenu("ordersPage");
}

async function logout() {
  await logActivity("logout", "تسجيل خروج", "قام المستخدم بتسجيل الخروج من السيستم");
  stopActivityLogNotifications();
  await stopOnlinePresence();
  sessionStorage.removeItem("okb_current_user");
  sessionStorage.clear();
  resetAppState();
  app.classList.add("hidden");
  loginPage.classList.remove("hidden");
  if (loginUsername) loginUsername.value = "";
  if (loginPassword) loginPassword.value = "";
  if (loginError) loginError.style.display = "none";
  window.location.replace(window.location.pathname + "?t=" + Date.now());
}

async function checkLogin() {
  const s = sessionStorage.getItem("okb_current_user");
  if (s) {
    currentUser = JSON.parse(s);
    await logActivity("login", "فتح السيستم", "تم فتح السيستم واستعادة جلسة المستخدم");
    loginPage.classList.add("hidden");
    app.classList.remove("hidden");
    setupUserView();
    await loadDoctors();
    await loadShippingSystems();
    await loadOrders();
    if (isAdmin() || isExecutiveAssistant()) { await loadUsers(); applyUsersFormRoleLock(); }
    await loadOKBItems();
    hideAllPages();
    $("ordersPage").classList.remove("hidden");
    setActiveMenu("ordersPage");
  } else {
    app.classList.add("hidden");
    loginPage.classList.remove("hidden");
  }
}

function togglePassword() {
  const p = document.getElementById("loginPassword");
  p.type = p.type === "password" ? "text" : "password";
}

function setupUserView() {
  $("userNameHere").textContent = currentUser.name;
  $("userRoleHere").textContent = getRoleDisplayName(currentUser.role);
  const inline1 = $("userNameInline"), inline2 = $("userRoleInline");
  if (inline1) inline1.textContent = currentUser.name;
  if (inline2) inline2.textContent = getRoleDisplayName(currentUser.role);
  const av = $("userAvatar");
  if (av) av.textContent = (currentUser.name || "U").trim().charAt(0).toUpperCase();
const selectPageTh = document.getElementById("selectPageOrders")?.closest("th");
if (selectPageTh) selectPageTh.style.display = isAdmin() ? "" : "none";
const productReportsBtn = document.getElementById('productReportsHeaderBtn');
if (productReportsBtn) productReportsBtn.style.display = canViewProductReports() ? 'inline-flex' : 'none';
const branchStockBtn = document.getElementById('branchStockHeaderBtn');
if (branchStockBtn) branchStockBtn.style.display = (isAdmin() || isStoreManager() || isCashier() || isAccountManager()) ? 'inline-flex' : 'none';
const pendingBtn = document.getElementById('pendingHeaderBtn');
if (pendingBtn) pendingBtn.style.display = (isAdmin() || isStoreManager() || isCashier() || isAccountSupervisor()) ? 'inline-flex' : 'none';
const shippingRankHeaderBtn = document.getElementById('shippingRankHeaderBtn');
if (shippingRankHeaderBtn) shippingRankHeaderBtn.style.display = canViewShippingRank() ? 'inline-flex' : 'none';
const settingsHeaderWrap = document.getElementById('headerSettingsWrap');
const canOpenSettings = isAdmin() || isExecutiveAssistant();
const canOpenUsers = isAdmin() || isExecutiveAssistant();
const canOpenDailyReport = isAdmin() || isOperationManager() || isAgent();
const canOpenDoctorRank = canViewAdminReports();
document.querySelectorAll('.settings-page-item').forEach(el => el.classList.toggle('hidden', !canOpenSettings));
document.querySelectorAll('.users-page-item').forEach(el => el.classList.toggle('hidden', !canOpenUsers));
document.querySelectorAll('.daily-report-page-item').forEach(el => el.classList.toggle('hidden', !canOpenDailyReport));
document.querySelectorAll('.doctor-rank-page-item').forEach(el => el.classList.toggle('hidden', !canOpenDoctorRank));
if (settingsHeaderWrap) settingsHeaderWrap.style.display = (canOpenSettings || canOpenUsers || canOpenDailyReport || canOpenDoctorRank) ? 'inline-flex' : 'none';
const cleanAllDoctorsBtn = document.getElementById('cleanAllDoctorsBtn');
if (cleanAllDoctorsBtn) cleanAllDoctorsBtn.style.display = isAdmin() ? '' : 'none';
const activityBtn = document.getElementById("activityLogHeaderBtn");
if (activityBtn) activityBtn.style.display = isAdmin() ? "inline-flex" : "none";
document.querySelectorAll('[data-page="usersPage"]').forEach(el => {
  el.style.display = (isAdmin() || isExecutiveAssistant()) ? "" : "none";
});
startActivityLogNotifications();
startOnlinePresence();

  document.querySelectorAll(".settings-menu-btn").forEach(el => el.classList.toggle("hidden", !(isAdmin() || isExecutiveAssistant())));
  document.querySelectorAll(".admin-manager-only").forEach(el => el.classList.toggle("hidden", !canViewAdminReports()));
  document.querySelectorAll(".accounting-only").forEach(el => el.classList.toggle("hidden", !canViewKhazna()));
  document.querySelectorAll(".branch-shipping-rank-only").forEach(el => el.classList.toggle("hidden", !(isAdmin() || isOperationManager())));

  const isRestrictedRole = isExecutiveAssistant() || isSecretary() || isCashier() || isStoreManager() || isAccountManager();
  document.querySelectorAll(".restricted-role-hide").forEach(el => {
    if (isRestrictedRole) el.classList.add("hidden");
  });

  document.querySelectorAll('[data-page="shippingRankPage"]').forEach(el => {
    el.classList.toggle("hidden", !canViewShippingRank());
  });

  document.querySelectorAll(".store-manager-hide").forEach(el => {
    el.classList.toggle("hidden", isStoreManager());
  });

  document.querySelectorAll(".executive-assistant-show").forEach(el => {
    if (isExecutiveAssistant()) el.classList.remove("hidden");
  });

  // إعدادات المنتجات متاحة للأدمن فقط
  document.querySelectorAll('[data-page="branchsPage"]').forEach(el => {
    el.classList.toggle("hidden", !isAdmin());
  });

  if (isStoreManager() || isCashier() || isAccountSupervisor()) {
    const managed = getCurrentUserManagedBranches();
    document.querySelectorAll(".okb-branch-btn").forEach(btn => {
      const branchName = btn.dataset.branch;
      btn.style.display = managed.includes(branchName) ? "" : "none";
    });
  } else {
    document.querySelectorAll(".okb-branch-btn").forEach(btn => { btn.style.display = ""; });
  }

  if (!isAdmin()) { employeeName.value = currentUser.name; employeeName.readOnly = true; } else employeeName.readOnly = false;
}

setTimeout(ensureCashierBranchReportButton, 100);

function resetAppState() {
  orders = [];
  users = [];
  branchs = [];
  okbItems = [];
  doctorsList = [];
  shippingSystems = [];
  editId = null;
  currentUser = null;
  selectedOrderIds = new Set();

  selectedShippingCompanies = [];
  activeDateFrom = null;
  activeDateTo = null;
  analyticsDateFrom = null;
  analyticsDateTo = null;
  shippingDateFrom = null;
  shippingDateTo = null;

  Object.keys(pageState).forEach(k => pageState[k] = 1);

  Object.keys(charts).forEach(k => {
    if (charts[k]) { charts[k].destroy(); charts[k] = null; }
  });

  document.querySelectorAll("tbody").forEach(tb => tb.innerHTML = "");
  document.querySelectorAll(".pagination").forEach(p => p.innerHTML = "");
  document.querySelectorAll(".active-filter-badge").forEach(b => b.classList.remove("visible"));

  ["userNameHere", "userRoleHere", "userNameInline", "userRoleInline"].forEach(id => {
    const el = $(id); if (el) el.textContent = "";
  });
  const av = $("userAvatar"); if (av) av.textContent = "U";

  ["orderForm", "userForm", "itemForm", "doctorSettingsForm", "shippingSettingsForm"].forEach(id => {
    const f = $(id); if (f) f.reset();
  });

  ["fromDate", "toDate", "analyticsFromDate", "analyticsToDate", "shippingFromDate", "shippingToDate", "reportFromDate", "reportToDate"].forEach(id => {
    const el = $(id); if (el) el.value = "";
  });

  hideAllPages();
  if ($("ordersPage")) $("ordersPage").classList.remove("hidden");
}

// ===== دوال تحميل البيانات =====
async function loadOrders() {
  let allOrders = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseClient
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) { 
      alert("مشكلة في تحميل البيانات: " + error.message); 
      return; 
    }

    allOrders = allOrders.concat(data || []);

    // لو الدفعة أقل من 1000، يبقى دي آخر دفعة
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  orders = isAccountSupervisor()
    ? allOrders.filter(order => isOrderInManagedBranches(order))
    : allOrders;
  renderDoctorOptions(); 
  renderShippingOptions(); 
  renderOrders(); 
  renderAnalytics(); 
  renderRanks();
}

async function loadUsers() {
  const { data, error } = await supabaseClient.from("user").select("*").order("name", { ascending: true });
  if (error) { alert("مشكلة في تحميل المستخدمين: " + error.message); return; }
  users = data || []; 
  renderUsers();
}

async function loadBranchs() {
  const { data, error } = await supabaseClient.from("branchs").select("*").order("created_at", { ascending: false });
  if (error) { console.warn("branchs table not found or error:", error.message); branchs = []; renderBranchs(); return; }
  branchs = data || []; 
  renderBranchs();
}

async function loadOKBItems() {
  const { data, error } = await supabaseClient
    .from("items")
    .select("*")
    .order("item_name", { ascending: true });

  if (error) {
    console.error("Items load error:", error);
    okbItems = [];
    renderOrderProductOptions();
    if (isAdmin()) renderOKBItems();
    alert("مشكلة في تحميل المنتجات: " + error.message);
    return;
  }

  okbItems = (data || []).filter(item => String(item.item_name || '').trim() && Number(item.price || 0) > 0);
  renderOrderProductOptions();
  if (isAdmin()) renderOKBItems();
}

async function loadDoctors() {
  const { data, error } = await supabaseClient.from("doctors").select("*").order("name", { ascending: true });
  if (error) { console.warn("doctors table not found or error:", error.message); doctorsList = []; renderDoctorsSettings(); renderDoctorOptions(); if ($('productReportDoctor')) populateProductReportFilters(); return; }
  doctorsList = data || [];
  renderDoctorsSettings();
  renderDoctorOptions();
  if ($('productReportDoctor')) populateProductReportFilters();
}

async function loadShippingSystems() {
  const { data, error } = await supabaseClient.from("shipping_system").select("*").order("company_name", { ascending: true });
  if (error) { console.warn("shipping_system table not found or error:", error.message); shippingSystems = []; renderShippingSettings(); renderShippingOptions(); return; }
  shippingSystems = data || [];
  renderShippingSettings();
  renderShippingOptions();
}

// ===== دوال العرض =====
function setActiveMenu(pageId) {
  document.querySelectorAll(".menu-item").forEach(el => {
    el.classList.toggle("active", el.dataset.page === pageId);
  });
}


// ===== Pending Orders — Branch Delivering only (3+ days without update) =====
let pendingOrders = [];
const PENDING_BRANCH_NAMES = ['مدينة نصر','اسكندرية','طنطا','المنصورة'];
function pendingReferenceDate(order) {
  const now = Date.now();
  const candidates = [order?.status_updated_at, order?.updated_at, order?.modified_at, order?.created_at]
    .map(parsePreciseServerDate)
    .filter(Boolean)
    .filter(date => date.getTime() <= now + 60 * 1000)
    .sort((a, b) => b.getTime() - a.getTime());
  return candidates[0]?.toISOString() || null;
}
function pendingReferenceTime(order) { return parsePreciseServerDate(pendingReferenceDate(order))?.getTime() || 0; }
function pendingDays(order) { const t=pendingReferenceTime(order); if(!t)return 0; return Math.max(0,Math.floor((Date.now()-t)/(24*60*60*1000))); }
function pendingOrderBranch(order){ const b=String(order?.branch||'').trim(); return PENDING_BRANCH_NAMES.includes(b)?b:''; }
function canSeePendingOrder(order){
  const branch=pendingOrderBranch(order); if(!branch)return false;
  if(isAdmin())return true;
  if(isStoreManager() || isCashier() || isAccountSupervisor())return getCurrentUserManagedBranches().includes(branch);
  return false;
}
function setupPendingBranchFilter(){
  const el=document.getElementById('pendingBranchFilter'); if(!el)return;
  if(isAdmin()){
    const cur=el.value||'all';
    el.innerHTML='<option value="all">كل الفروع</option>'+PENDING_BRANCH_NAMES.map(b=>`<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`).join('');
    el.value=PENDING_BRANCH_NAMES.includes(cur)?cur:'all'; el.classList.remove('hidden');
  } else { el.value='all'; el.classList.add('hidden'); }
}
async function showPendingPage(){
  if(!(isAdmin()||isStoreManager()||isCashier()||isAccountSupervisor())){alert('صفحة Pending متاحة للأدمن ومدير الفرع والكاشير وAccount Supervisor فقط');return;}
  hideAllPages(); document.getElementById('pendingPage')?.classList.remove('hidden'); setActiveMenu('pendingPage'); setupPendingBranchFilter(); await loadPendingOrders(false);
}
async function loadPendingOrders(showMessage){
  const list=document.getElementById('pendingOrdersList');if(list)list.innerHTML='<div class="pending-loading">جاري تحميل عملاء الفروع المتأخرين...</div>';
  try{
    const {data,error}=await supabaseClient.from('orders').select('*').eq('status','Delivering').order('created_at',{ascending:false}).limit(1500);
    if(error)throw error;
    pendingOrders=(data||[]).filter(o=>pendingOrderBranch(o)&&pendingDays(o)>=3&&canSeePendingOrder(o)).sort((a,b)=>pendingReferenceTime(a)-pendingReferenceTime(b));
    setupPendingBranchFilter(); renderPendingOrders();
    if(showMessage)alert(`تم تحديث القائمة — ${pendingOrders.length} عميل متأخر بحالة Delivering`);
  }catch(e){if(list)list.innerHTML=`<div class="pending-empty">تعذر تحميل البيانات: ${escapeHTML(e.message||String(e))}</div>`;}
}
function renderPendingBranchSummary(){
  const branchIds={
    'مدينة نصر':'pendingBranchNasrCount',
    'اسكندرية':'pendingBranchAlexCount',
    'طنطا':'pendingBranchTantaCount',
    'المنصورة':'pendingBranchMansouraCount'
  };
  const allowed=isAdmin()?PENDING_BRANCH_NAMES:getCurrentUserManagedBranches();
  document.querySelectorAll('.pending-branch-card').forEach(card=>{
    const branch=card.dataset.pendingBranch||'';
    card.style.display=allowed.includes(branch)?'flex':'none';
  });
  Object.entries(branchIds).forEach(([branch,id])=>{
    const el=document.getElementById(id);
    if(el)el.textContent=num(pendingOrders.filter(o=>pendingOrderBranch(o)===branch&&pendingDays(o)>=3).length);
  });
}
function renderPendingOrders(){
  const list=document.getElementById('pendingOrdersList');if(!list)return;
  renderPendingBranchSummary();
  const q=String(document.getElementById('pendingSearch')?.value||'').trim().toLowerCase();
  const branchFilter=isAdmin()?(document.getElementById('pendingBranchFilter')?.value||'all'):'all';
  const rows=pendingOrders.filter(o=>(branchFilter==='all'||pendingOrderBranch(o)===branchFilter)&&(!q||[o.customer_name,o.phone,o.phone2,o.order_number,o.ticket_id,o.employee_name,o.doctor_name,o.area,pendingOrderBranch(o)].some(v=>String(v||'').toLowerCase().includes(q))));
  document.getElementById('pendingTotalCount').textContent=num(rows.length);
  document.getElementById('pendingCriticalCount').textContent=num(rows.filter(o=>pendingDays(o)>=7).length);
  document.getElementById('pendingOldestDays').textContent=(rows.length?num(Math.max(...rows.map(pendingDays))):'0')+' يوم';
  if(!rows.length){list.innerHTML='<div class="pending-empty">لا توجد أوردرات فروع بحالة Delivering متأخرة 3 أيام أو أكثر</div>';return;}
  list.innerHTML=rows.map(o=>`<div class="pending-row"><div class="pending-days">${num(pendingDays(o))}<small>يوم</small></div><div class="pending-customer"><strong>${escapeHTML(o.customer_name||'—')}</strong><small>${escapeHTML(o.phone||'')} ${o.phone2?'• '+escapeHTML(o.phone2):''}</small></div><div><span class="pending-status">Delivering</span><span class="pending-meta">Last update: ${formatEnglishDateTime(pendingReferenceDate(o))}</span></div><div><span class="pending-meta">رقم الأوردر: ${escapeHTML(o.order_number||'—')}</span><span class="pending-meta">Ticket: ${escapeHTML(getTicketId(o))}</span></div><div><span class="pending-meta">${escapeHTML(o.employee_name||'—')}</span><span class="pending-meta">${escapeHTML(o.doctor_name||'')}</span></div><div><span class="pending-meta">${escapeHTML(pendingOrderBranch(o))}</span><span class="pending-meta">${escapeHTML(o.area||'')}</span></div><button class="pending-open-btn" type="button" onclick="openPendingOrder('${o.id}')">فتح الأوردر</button></div>`).join('');
}
async function openPendingOrder(orderId){const o=pendingOrders.find(x=>String(x.id)===String(orderId));if(!o)return;const branch=pendingOrderBranch(o);if(!branch)return;const ticketId=getTicketId(o);await openBranchPage(branch);setTimeout(()=>{const search=document.getElementById('bSearchInput');if(search){search.value=ticketId;search.dispatchEvent(new Event('input',{bubbles:true}));search.focus();}},250);}

function hideAllPages() {
  ["ordersPage", "activityLogPage", "productReportsPage", "branchStockPage", "pendingPage", "analyticsPage", "shippingRankPage", "doctorRankPage", "branchRankPage", "usersPage", "branchsPage", "branchPage", "khaznaPage", "activityLogPage"].forEach(id => {
    const el = $(id);
    if (el) el.classList.add("hidden");
  });
}

function showOrdersPage() { hideAllPages(); $("ordersPage").classList.remove("hidden"); setActiveMenu("ordersPage"); }
function showAnalyticsPage() { if (isStoreManager()) return; hideAllPages(); $("analyticsPage").classList.remove("hidden"); renderAnalytics(); setActiveMenu("analyticsPage"); }
function showShippingRankPage() { if (!canViewShippingRank()) return; branchShippingRankOverride = null; hideAllPages(); $("shippingRankPage").classList.remove("hidden"); setActiveMenu("shippingRankPage"); window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); const appContent = document.querySelector('.app-content'); if (appContent) appContent.scrollTo({ top: 0, left: 0, behavior: 'auto' }); setTimeout(() => { renderShippingRank(); renderShippingCharts(); window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); const appContent = document.querySelector('.app-content'); if (appContent) appContent.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }, 150); }
function showDoctorRankPage() { if (!canViewAdminReports()) return; hideAllPages(); $("doctorRankPage").classList.remove("hidden"); setActiveMenu("doctorRankPage"); setTimeout(() => { renderDoctorRank(); renderDoctorCharts(); }, 150); }
function showBranchRankPage() { hideAllPages(); $("branchRankPage").classList.remove("hidden"); setActiveMenu("branchRankPage"); if (!$("reportFromDate").value || !$("reportToDate").value) { setReportMode("daily"); } else { updateReportTabs(); renderReport(); } }
function showUsersPage() {
  if (!isAdmin() && !isExecutiveAssistant()) return;
  hideAllPages(); $("usersPage").classList.remove("hidden"); 
  setActiveMenu("usersPage"); loadUsers();
  applyUsersFormRoleLock();
}

function applyUsersFormRoleLock() {
  const roleSelect = $("newRole");
  if (!roleSelect) return;
  if (isExecutiveAssistant() && !isAdmin()) {
    Array.from(roleSelect.options).forEach(opt => {
      opt.disabled = (opt.value !== "secretary");
    });
    roleSelect.value = "secretary";
    roleSelect.disabled = true;
    $("newUserBranchesWrap").classList.add("hidden");
  } else {
    Array.from(roleSelect.options).forEach(opt => { opt.disabled = false; });
    roleSelect.disabled = false;
  }
}
function showBranchsPage() {
  if (!isAdmin() && !isExecutiveAssistant()) {
    alert("صفحة الإعدادات متاحة للأدمن وExecutive Assistant فقط");
    return;
  }
  hideAllPages();
  $("branchsPage").classList.remove("hidden");
  setActiveMenu("branchsPage");
  loadOKBItems();
  loadDoctors();
  loadShippingSystems();
}

async function refreshSettingsPage(button) {
  const oldText = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'جاري التحديث...'; }
  try {
    await Promise.all([loadOKBItems(), loadDoctors(), loadShippingSystems()]);
  } finally {
    if (button) { button.disabled = false; button.textContent = oldText || '↻ Refresh'; }
  }
}

function closeHeaderSettingsMenu() {
  document.getElementById('headerSettingsMenu')?.classList.remove('show');
  document.getElementById('settingsHeaderBtn')?.classList.remove('open');
}

function toggleHeaderSettingsMenu(event) {
  event?.stopPropagation();
  const menu = document.getElementById('headerSettingsMenu');
  const button = document.getElementById('settingsHeaderBtn');
  if (!menu || !button) return;
  const willOpen = !menu.classList.contains('show');
  closeHeaderSettingsMenu();
  if (willOpen) {
    menu.classList.add('show');
    button.classList.add('open');
  }
}

function openHeaderSettingsPage(page) {
  closeHeaderSettingsMenu();
  if (page === 'settings') return showBranchsPage();
  if (page === 'users') return showUsersPage();
  if (page === 'daily') {
    if (!(isAdmin() || isOperationManager() || isAgent())) return;
    return showBranchRankPage();
  }
  if (page === 'doctorRank') return showDoctorRankPage();
}

document.addEventListener('click', event => {
  if (!event.target.closest('#headerSettingsWrap')) closeHeaderSettingsMenu();
});

function resetForm() { 
  orderForm.reset(); 
  editId = null; 
  submitBtn.textContent = "إضافة الأوردر"; 
  if (!isAdmin()) { 
    employeeName.value = currentUser.name; 
    employeeName.readOnly = true; 
  }
   const orderNumberEl = document.getElementById('orderNumber');
   if (orderNumberEl) orderNumberEl.value = "";
  const depositField = document.getElementById("deposit");
  if (depositField) depositField.value = "0";
  const qtyEl = document.getElementById("quantity");
  if (qtyEl) qtyEl.value = "1";
  const delivFeeEl = document.getElementById("deliveryFee");
  if (delivFeeEl) delivFeeEl.value = "";
  const unitPriceEl = document.getElementById("unitPrice");
  const discountEl = document.getElementById("dashDiscountInput");
  if (unitPriceEl) unitPriceEl.value = "";
  if (discountEl) discountEl.value = "";
  const priceEl = document.getElementById("price");
  if (priceEl) priceEl.value = "";

  clearProductCart('dash');
  clearPaymentImage();
  const warningEl = document.getElementById("depositImageWarning");
  if (warningEl) warningEl.style.display = "none";
}

// ===== Smart Product Cart Logic =====
let dashProducts = [];
let branchProductsCart = [];

function getCartArray(scope) {
  return scope === 'branch' ? branchProductsCart : dashProducts;
}

function setCartArray(scope, arr) {
  if (scope === 'branch') branchProductsCart = arr;
  else dashProducts = arr;
}

function cartPrefix(scope) {
  return scope === 'branch' ? 'branch' : 'dash';
}

function renderOrderProductOptions() {
  ['dash', 'branch'].forEach(scope => {
    const prefix = cartPrefix(scope);
    const select = document.getElementById(prefix + 'ProductNameInput');
    const price = document.getElementById(prefix + 'ProductPriceInput');
    if (!select) return;

    const currentValue = select.value;
    if (!okbItems.length) {
      select.innerHTML = '<option value="">لا توجد منتجات — أضفها من Settings</option>';
      select.disabled = true;
      if (price) price.value = '';
      return;
    }

    select.disabled = false;
    select.innerHTML = '<option value="">اختر اسم المنتج</option>' + okbItems.map(item =>
      `<option value="${escapeHTML(item.id)}">${escapeHTML(item.item_name)} — ${money(item.price)}</option>`
    ).join('');

    if (okbItems.some(item => String(item.id) === String(currentValue))) {
      select.value = currentValue;
    } else {
      select.value = '';
      if (price) price.value = '';
    }
  });
}

function onProductSelectionChange(scope) {
  const prefix = cartPrefix(scope);
  const select = document.getElementById(prefix + 'ProductNameInput');
  const price = document.getElementById(prefix + 'ProductPriceInput');
  const item = okbItems.find(row => String(row.id) === String(select?.value || ''));
  if (price) price.value = item ? Number(item.price || 0) : '';
}

function productCartToText(items) {
  return (items || []).map((p, idx) => {
    const name = String(p.name || '').trim();
    const price = Number(p.price || 0);
    const qty = Number(p.qty || 1);
    const total = price * qty;
    return `${idx + 1}) ${name} | ${price} × ${qty} = ${total}`;
  }).join('\n');
}

function cartProductsTotal(scope) {
  return getCartArray(scope).reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.qty || 1)), 0);
}

function syncProductCartTotals(scope) {
  const prefix = cartPrefix(scope);
  const productsTotal = cartProductsTotal(scope);
  const delivery = Number(document.getElementById(prefix + 'DeliveryInput')?.value || 0);
  const discount = Math.max(0, Number(document.getElementById(prefix + 'DiscountInput')?.value || 0));
  const deposit = Number(document.getElementById(prefix + 'DepositInput')?.value || 0);
  const grand = Math.max(0, productsTotal + delivery - discount);
  const remaining = Math.max(0, grand - deposit);

  const grandEl = document.getElementById(prefix + 'GrandTotal');
  const remainingEl = document.getElementById(prefix + 'RemainingTotal');
  if (grandEl) {
    if ('value' in grandEl) grandEl.value = grand;
    else grandEl.textContent = money(grand);
  }
  if (remainingEl) remainingEl.textContent = money(remaining);
  renderAutomaticDiscountMessage(scope, discount, productsTotal + delivery, grand);

  if (scope === 'branch') {
    const bPrice = document.getElementById('bPrice');
    const bDeposit = document.getElementById('bDeposit');
    const bDelivery = document.getElementById('bDeliveryFee');
    const bQty = document.getElementById('bQuantity');
    const bUnit = document.getElementById('bUnitPrice');
    const bNames = document.getElementById('bProductNames');
    if (bPrice) bPrice.value = grand;
    if (bDeposit) bDeposit.value = deposit;
    if (bDelivery) bDelivery.value = delivery;
    if (bQty) bQty.value = getCartArray(scope).reduce((s,p)=>s+Number(p.qty||1),0) || 1;
    if (bUnit) bUnit.value = productsTotal;
    if (bNames) bNames.value = productCartToText(getCartArray(scope));
  } else {
    const price = document.getElementById('price');
    const depositEl = document.getElementById('deposit');
    const deliveryEl = document.getElementById('deliveryFee');
    const qtyEl = document.getElementById('quantity');
    const unitEl = document.getElementById('unitPrice');
    const namesEl = document.getElementById('productNames');
    if (price) price.value = grand;
    if (depositEl) depositEl.value = deposit;
    if (deliveryEl) deliveryEl.value = delivery;
    if (qtyEl) qtyEl.value = getCartArray(scope).reduce((s,p)=>s+Number(p.qty||1),0) || 1;
    if (unitEl) unitEl.value = productsTotal;
    if (namesEl) namesEl.value = productCartToText(getCartArray(scope));
  }
}

function renderAutomaticDiscountMessage(scope, discount, originalTotal, finalTotal) {
  const prefix = cartPrefix(scope);
  const message = document.getElementById(prefix + 'AutoDiscountMessage');
  if (!message) return;
  const value = Math.max(0, Number(discount || 0));
  message.classList.toggle('visible', value > 0);
  message.textContent = value > 0
    ? `🏷️ سيتم تسجيل خصم ${money(value)} على الأوردر — الإجمالي الأصلي ${money(originalTotal)} والإجمالي بعد الخصم ${money(finalTotal)}`
    : '';
}

function applyManualGrandTotal(scope) {
  const prefix = cartPrefix(scope);
  const totalInput = document.getElementById(prefix + 'GrandTotal');
  const discountInput = document.getElementById(prefix + 'DiscountInput');
  if (!totalInput || !discountInput) return;
  const originalTotal = cartProductsTotal(scope) + Number(document.getElementById(prefix + 'DeliveryInput')?.value || 0);
  let requestedTotal = Math.max(0, Number(totalInput.value || 0));
  if (requestedTotal > originalTotal) {
    requestedTotal = originalTotal;
    totalInput.value = originalTotal;
  }
  discountInput.value = Math.max(0, originalTotal - requestedTotal);
  syncProductCartTotals(scope);
}

function confirmDiscountBeforeOrderSave(scope) {
  const prefix = cartPrefix(scope);
  const discount = Math.max(0, Number(document.getElementById(prefix + 'DiscountInput')?.value || 0));
  if (!discount) return true;
  const originalTotal = cartProductsTotal(scope) + Number(document.getElementById(prefix + 'DeliveryInput')?.value || 0);
  const finalTotal = Math.max(0, originalTotal - discount);
  return confirm(`⚠️ سيتم تسجيل خصم ${money(discount)} على الأوردر.\nالإجمالي الأصلي: ${money(originalTotal)}\nالإجمالي بعد الخصم: ${money(finalTotal)}\nهل تريد حفظ الأوردر؟`);
}

function renderProductCart(scope) {
  const prefix = cartPrefix(scope);
  const listEl = document.getElementById(prefix + 'ProductCartList');
  if (!listEl) return;
  const items = getCartArray(scope);

  if (!items.length) {
    listEl.innerHTML = '<div class="smart-cart-empty">لسه مفيش منتجات في الكارت</div>';
    syncProductCartTotals(scope);
    return;
  }

  listEl.innerHTML = items.map((p, i) => {
    const price = Number(p.price || 0);
    const qty = Number(p.qty || 1);
    const total = price * qty;
    return `
      <div class="smart-cart-row">
        <div>
          <div class="smart-prod-name">${escapeHTML(p.name)}</div>
          <div class="smart-prod-meta">${money(price)} × ${qty}</div>
        </div>
        <div class="smart-qty-controls">
          <button type="button" onclick="changeProductQty('${scope}', ${i}, -1)">-</button>
          <span class="smart-qty-num">${qty}</span>
          <button type="button" onclick="changeProductQty('${scope}', ${i}, 1)">+</button>
        </div>
        <div class="smart-prod-total">${money(total)}</div>
        <button class="smart-del-btn" type="button" onclick="removeProductItem('${scope}', ${i})">×</button>
      </div>`;
  }).join('');

  syncProductCartTotals(scope);
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function addProductItem(scope) {
  const prefix = cartPrefix(scope);
  const nameEl = document.getElementById(prefix + 'ProductNameInput');
  const priceEl = document.getElementById(prefix + 'ProductPriceInput');
  const qtyEl = document.getElementById(prefix + 'ProductQtyInput');

  if (!okbItems.length) {
    alert('لا توجد منتجات متاحة. يجب على الأدمن إضافة المنتجات والأسعار من Settings أولاً.');
    return;
  }

  const selectedItem = okbItems.find(item => String(item.id) === String(nameEl?.value || ''));
  const qty = Math.max(1, Math.floor(Number(qtyEl?.value || 1)));

  if (!selectedItem) { alert('اختر اسم المنتج من القائمة'); nameEl?.focus(); return; }

  const name = String(selectedItem.item_name || '').trim();
  const price = Number(selectedItem.price || 0);
  if (!name || price <= 0) { alert('بيانات المنتج أو السعر غير صحيحة في Settings'); return; }

  const items = getCartArray(scope);
  const existing = items.find(p => String(p.item_id || '') === String(selectedItem.id));
  if (existing) existing.qty = Number(existing.qty || 1) + qty;
  else items.push({ item_id: selectedItem.id, name, price, qty });

  setCartArray(scope, items);
  if (nameEl) nameEl.value = '';
  if (priceEl) priceEl.value = '';
  if (qtyEl) qtyEl.value = '1';
  nameEl?.focus();
  renderProductCart(scope);
}

function changeProductQty(scope, index, delta) {
  const items = getCartArray(scope);
  if (!items[index]) return;
  items[index].qty = Math.max(1, Number(items[index].qty || 1) + delta);
  setCartArray(scope, items);
  renderProductCart(scope);
}

function removeProductItem(scope, index) {
  const items = getCartArray(scope);
  items.splice(index, 1);
  setCartArray(scope, items);
  renderProductCart(scope);
}

function clearProductCart(scope) {
  setCartArray(scope, []);
  const prefix = cartPrefix(scope);
  const delivery = document.getElementById(prefix + 'DeliveryInput');
  const discount = document.getElementById(prefix + 'DiscountInput');
  const deposit = document.getElementById(prefix + 'DepositInput');
  if (delivery) delivery.value = '';
  if (discount) discount.value = '';
  if (deposit) deposit.value = '';
  const productSelect = document.getElementById(prefix + 'ProductNameInput');
  const productPrice = document.getElementById(prefix + 'ProductPriceInput');
  const productQty = document.getElementById(prefix + 'ProductQtyInput');
  if (productSelect) productSelect.value = '';
  if (productPrice) productPrice.value = '';
  if (productQty) productQty.value = '1';
  renderProductCart(scope);
}

function setProductCartFromOrder(scope, order) {
  const text = String(order?.product_names || '').trim();
  const items = [];

  if (text) {
    text.split(/\n+/).forEach(line => {
      const clean = line.replace(/^\d+\)\s*/, '').trim();
      const m = clean.match(/^(.*?)\s*\|\s*([\d.]+)\s*[×x]\s*(\d+)/);
      if (m) items.push({ name: m[1].trim(), price: Number(m[2] || 0), qty: Number(m[3] || 1) });
    });
  }

  if (!items.length && Number(order?.price || 0) > 0) {
    const qty = Number(order?.quantity || 1);
    const delivery = Number(order?.delivery_fee || 0);
    const total = Number(order?.price || 0);
    const unit = qty ? Math.max(0, (total - delivery) / qty) : total;
    items.push({ name: order?.product_names || 'منتج', price: unit, qty });
  }

  setCartArray(scope, items);
  const prefix = cartPrefix(scope);
  const deliveryEl = document.getElementById(prefix + 'DeliveryInput');
  const discountEl = document.getElementById(prefix + 'DiscountInput');
  const depositEl = document.getElementById(prefix + 'DepositInput');
  const meta = getOrderMeta(order);
  if (deliveryEl) deliveryEl.value = Number(order?.delivery_fee || 0) || '';
  if (discountEl) discountEl.value = Number(meta.discount || 0) || '';
  if (depositEl) depositEl.value = Number(order?.deposit || 0) || '';
  renderProductCart(scope);
}

function hasProducts(scope) {
  return getCartArray(scope).length > 0;
}

function calcDashTotal() { syncProductCartTotals('dash'); }
function calcBranchTotal() { syncProductCartTotals('branch'); }



// ===== Cashier: Khazna report button beside Export (without opening Khazna) =====
function ensureCashierBranchReportButton() {
  const existingReport = document.getElementById('cashierBranchReportBtn');
  const existingSummary = document.getElementById('cashierSummaryReportBtn');
  const exportButton = document.querySelector('[onclick*="exportBranchOrders"]');
  if (!exportButton) return;
  // Summary Report belongs to Khazna only.
  if (existingSummary) existingSummary.remove();

  // زر طباعة التقرير التفصيلي يظل للكاشير فقط
  if (isCashier()) {
    let reportBtn = existingReport;
    if (!reportBtn) {
      reportBtn = document.createElement('button');
      reportBtn.id = 'cashierBranchReportBtn';
      reportBtn.type = 'button';
      reportBtn.innerHTML = '🖨️ طباعة التقرير';
      reportBtn.title = 'طباعة نفس تقرير الخزنة مباشرة من صفحة الفرع بدون فتح الخزنة';
      reportBtn.onclick = printBranchKhaznaReportForCashier;
      reportBtn.style.cssText = `
        display:inline-flex;align-items:center;justify-content:center;gap:6px;
        padding:9px 14px;border:none;border-radius:10px;cursor:pointer;
        background:linear-gradient(135deg,#0D9488,#14B8A6);color:#fff;
        font-size:12px;font-weight:800;white-space:nowrap;
        box-shadow:0 4px 12px rgba(13,148,136,.25);
      `;
      exportButton.insertAdjacentElement('afterend', reportBtn);
    } else {
      reportBtn.style.display = 'inline-flex';
    }
  } else if (existingReport) {
    existingReport.remove();
  }

}

async function printBranchKhaznaReportForCashier() {
  if (!isCashier()) {
    alert('طباعة التقرير من صفحة الفرع متاحة للكاشير فقط');
    return;
  }
  if (!currentBranchName) {
    alert('افتح صفحة الفرع أولاً');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const from = branchActiveDateFrom || document.getElementById('bFromDate')?.value || today;
  const to = branchActiveDateTo || document.getElementById('bToDate')?.value || today;

  const btn = document.getElementById('cashierBranchReportBtn');
  const oldText = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = 'جاري تجهيز التقرير...'; }

  try {
    let allData = [];
    const pageSize = 1000;
    let rangeFrom = 0;

    while (true) {
      const rangeTo = rangeFrom + pageSize - 1;
      const { data, error } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('branch', currentBranchName)
        .eq('status', 'Signed')
        .order('created_at', { ascending: false })
        .range(rangeFrom, rangeTo);

      if (error) throw error;
      allData = allData.concat(data || []);
      if (!data || data.length < pageSize) break;
      rangeFrom += pageSize;
    }

    const reportOrders = allData
      .filter(o => isOrderInAccountingDateRange(o, from || null, to || null))
      .sort((a, b) => String(getOrderAccountingDateISO(b)).localeCompare(String(getOrderAccountingDateISO(a))));

    if (!reportOrders.length) {
      alert(`لا توجد أوردرات Signed لفرع ${currentBranchName} في الفترة ${from} → ${to}`);
      return;
    }

    const totalSales = reportOrders.reduce((s, o) => s + Number(o.price || 0), 0);
    const shippingTotal = reportOrders.reduce((sum, order) => {
      const last = getLatestCollectEntry(order);
      return sum + Number(last?.shipping || 0);
    }, 0);
    const transfersTotal = reportOrders.reduce((sum, order) => {
      const last = getLatestCollectEntry(order);
      const method = String(last?.payment_method || '').toLowerCase();
      return (method === 'instapay' || method === 'wallet')
        ? sum + Number(last?.sales || order.price || 0)
        : sum;
    }, 0);
    const net = totalSales - shippingTotal - transfersTotal;
    const printDate = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});

    const orderRows = reportOrders.map((o,i) => `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:4px;">${i+1}</td>
        <td style="padding:4px;">${escapeHTML(o.customer_name || '')}</td>
        <td style="padding:4px;">${escapeHTML(o.phone || '')}</td>
        <td style="padding:4px;">${escapeHTML(o.doctor_name || '—')}</td>
        <td style="padding:4px;font-weight:700;direction:ltr;">${escapeHTML(getTicketId(o) || '—')}</td>
        <td style="padding:4px;font-size:10px;">${escapeHTML(o.product_names || '—')}</td>
        <td style="padding:4px;text-align:right;">${enMoney(o.price)}</td>
        <td style="padding:4px;text-align:right;">${Number(o.deposit||0) > 0 ? enMoney(o.deposit) : '—'}</td>
        <td style="padding:4px;text-align:center;"><span style="background:#e5e7eb;padding:2px 6px;border-radius:4px;font-size:10px;">${escapeHTML(o.status||'')}</span></td>
      </tr>`).join('');

    const downloadRows = reportOrders.map((o, i) => ({
      '#': i + 1,
      'العميل': o.customer_name || '',
      'الموبايل': o.phone || '',
      'الدكتور': o.doctor_name || '',
      'Ticket ID': getTicketId(o) || '',
      'المنتجات': o.product_names || '',
      'السعر': Number(o.price || 0),
      'المدفوع': Number(o.deposit || 0),
      'الحالة': o.status || ''
    }));
    const safeDownloadRowsJSON = JSON.stringify(downloadRows).replace(/</g, '\u003c');
    const reportFileBase = `khazna-report-${String(currentBranchName || 'branch').replace(/[^\w\u0600-\u06FF-]+/g, '-')}-${from}-to-${to}`;

    const reportHTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>تقرير الخزنة</title>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>
<style>
  body { font-family: Tahoma, Arial, sans-serif; padding: 20px; color: #000; font-size: 13px; font-weight:700; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .report-actions { display:flex; justify-content:flex-start; margin:0 0 16px; }
  .stats { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px 20px; text-align: center; min-width: 140px; }
  .stat-box .label { font-size: 11px; color: #777; }
  .stat-box .value { font-size: 20px; font-weight: bold; direction:ltr; }
  .download-wrap { position:relative; display:inline-flex; align-items:center; }
  .download-btn { border:none; border-radius:8px; padding:8px 12px; background:#0f766e; color:#fff; font-weight:800; cursor:pointer; font-size:12px; }
  .download-menu { display:none; position:absolute; top:calc(100% + 6px); left:0; min-width:165px; background:#fff; border:1px solid #ddd; border-radius:9px; box-shadow:0 10px 28px rgba(0,0,0,.16); overflow:hidden; z-index:9999; }
  .download-menu.show { display:block; }
  .download-menu button { width:100%; border:none; background:#fff; padding:10px 12px; text-align:left; cursor:pointer; font-weight:700; font-size:12px; }
  .download-menu button:hover { background:#f3f4f6; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f3f4f6; padding: 6px; font-size: 12px; text-align: right; }
  td { direction:ltr; }
  #reportPdfArea { background:#fff; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  @media print {
    @page { size: A4 landscape; margin: 10mm; }
    .report-actions { display:none !important; }
    body { padding:0; font-size:11px; }
    h1 { font-size:18px; }
    .stats { gap:8px; margin-bottom:12px; }
    .stat-box { min-width:115px; padding:8px 12px; }
    .stat-box .value { font-size:17px; }
    th, td { font-size:9px !important; padding:3px !important; }
  }
</style>
</head>
<body>
  <div class="report-actions">
    <div class="download-wrap">
      <button class="download-btn" type="button" onclick="toggleDownloadMenu(event)">⬇ Download</button>
      <div id="reportDownloadMenu" class="download-menu">
        <button type="button" onclick="downloadReportExcel()">Download Excel</button>
        <button type="button" onclick="downloadReportPDF()">Download PDF</button>
      </div>
    </div>
  </div>
  <div id="reportPdfArea">
    <h1>🏦 تقرير الخزنة — فرع ${escapeHTML(currentBranchName)}</h1>
    <div class="meta">الفترة: ${from} → ${to} | طُبع في: ${printDate}</div>
    <div class="stats">
      <div class="stat-box"><div class="label">إجمالي المبيعات</div><div class="value" style="color:#6366f1;">${enMoney(totalSales)}</div></div>
      <div class="stat-box"><div class="label">مصروفات الشحن</div><div class="value" style="color:#ef4444;">${enMoney(shippingTotal)}</div></div>
      <div class="stat-box"><div class="label">التحويلات</div><div class="value" style="color:#a855f7;">${enMoney(transfersTotal)}</div></div>
      <div class="stat-box"><div class="label">صافي اليومية</div><div class="value" style="color:#10b981;">${enMoney(net)}</div></div>
      <div class="stat-box"><div class="label">عدد الأوردرات</div><div class="value" style="color:#f59e0b;">${enNumber(reportOrders.length)}</div></div>
    </div>
  <table>
    <thead><tr><th>#</th><th>العميل</th><th>الموبايل</th><th>الدكتور</th><th>Ticket ID</th><th>المنتجات</th><th>السعر</th><th>المدفوع</th><th>الحالة</th></tr></thead>
    <tbody>${orderRows}</tbody>
  </table>
  <div style="margin-top:20px;border-top:2px solid #000;padding-top:10px;font-weight:bold;font-size:15px;direction:ltr;text-align:right;">
    Net = ${enMoney(totalSales)} - ${enMoney(shippingTotal)} - ${enMoney(transfersTotal)} = <span style="color:#10b981;">${enMoney(net)}</span>
  </div>
  </div>
<script>
  const reportRows = ${safeDownloadRowsJSON};
  const reportFileBase = ${JSON.stringify(reportFileBase)};
  function toggleDownloadMenu(ev) {
    if (ev) ev.stopPropagation();
    document.getElementById('reportDownloadMenu')?.classList.toggle('show');
  }
  document.addEventListener('click', function() {
    document.getElementById('reportDownloadMenu')?.classList.remove('show');
  });
  function downloadReportExcel() {
    if (typeof XLSX === 'undefined') { alert('تعذر تحميل أداة Excel. تأكد من اتصال الإنترنت وحاول مرة أخرى.'); return; }
    const ws = XLSX.utils.json_to_sheet(reportRows);
    ws['!cols'] = [
      {wch:6},{wch:24},{wch:16},{wch:22},{wch:14},{wch:70},{wch:12},{wch:12},{wch:12}
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, reportFileBase + '.xlsx');
    document.getElementById('reportDownloadMenu')?.classList.remove('show');
  }
  function downloadReportPDF() {
    if (typeof html2pdf === 'undefined') { alert('تعذر تحميل أداة PDF. تأكد من اتصال الإنترنت وحاول مرة أخرى.'); return; }
    document.getElementById('reportDownloadMenu')?.classList.remove('show');
    const element = document.getElementById('reportPdfArea');
    if (!element) return;

    // Fit to One Page Width: نفس عرض A4 Landscape مع ارتفاع تلقائي حسب كل البيانات
    const marginMm = 5;
    const pageWidthMm = 297;
    const contentWidthPx = Math.max(element.scrollWidth, element.offsetWidth, 1);
    const contentHeightPx = Math.max(element.scrollHeight, element.offsetHeight, 1);
    const usableWidthMm = pageWidthMm - (marginMm * 2);
    const fittedHeightMm = (contentHeightPx / contentWidthPx) * usableWidthMm;
    const pageHeightMm = Math.max(210, Math.ceil(fittedHeightMm + (marginMm * 2)));

    const options = {
      margin: [marginMm, marginMm, marginMm, marginMm],
      filename: reportFileBase + '.pdf',
      image: { type: 'jpeg', quality: 0.99 },
      html2canvas: {
        scale: 2.5,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: contentWidthPx
      },
      jsPDF: {
        unit: 'mm',
        format: [pageWidthMm, pageHeightMm],
        orientation: 'landscape',
        compress: true
      },
      pagebreak: { mode: ['avoid-all'] }
    };

    html2pdf().set(options).from(element).save();
  }
<\/script>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      alert('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.');
      return;
    }
    win.document.write(reportHTML);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  } catch (error) {
    console.error('Branch khazna report error:', error);
    alert('مشكلة في تجهيز التقرير: ' + (error.message || error));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = oldText || '🖨️ طباعة التقرير'; }
  }
}


async function printBranchSummaryReportForCashier() {
  if (!(isCashier() || isAdmin() || isAccountManager())) {
    alert('Summary Report متاح للكاشير والأدمن ومدير الحسابات فقط');
    return;
  }
  if (!currentBranchName) {
    alert('افتح صفحة الفرع أولاً');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const inKhazna = !document.getElementById('khaznaPage')?.classList.contains('hidden');
  const from = inKhazna
    ? (document.getElementById('khaznaFromDate')?.value || today)
    : (branchActiveDateFrom || document.getElementById('bFromDate')?.value || today);
  const to = inKhazna
    ? (document.getElementById('khaznaToDate')?.value || today)
    : (branchActiveDateTo || document.getElementById('bToDate')?.value || today);
  const btn = inKhazna
    ? document.getElementById('khaznaSummaryReportBtn')
    : document.getElementById('cashierSummaryReportBtn');
  const oldText = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = 'جاري تجهيز الملخص...'; }

  try {
    let allData = [];
    const pageSize = 1000;
    let rangeFrom = 0;

    while (true) {
      const rangeTo = rangeFrom + pageSize - 1;
      const { data, error } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('branch', currentBranchName)
        .in('status', ['Signed', 'Returned'])
        .order('created_at', { ascending: false })
        .range(rangeFrom, rangeTo);

      if (error) throw error;
      allData = allData.concat(data || []);
      if (!data || data.length < pageSize) break;
      rangeFrom += pageSize;
    }

    const reportOrders = allData.filter(o =>
      (o.status === 'Signed' || isReturnWithin14Days(o)) &&
      isOrderInAccountingDateRange(o, from || null, to || null)
    );
    if (!reportOrders.length) {
      alert(`لا توجد أوردرات Signed أو مرتجع خلال 14 يوم لفرع ${currentBranchName} في الفترة ${from} → ${to}`);
      return;
    }

    const signedReportOrders = reportOrders.filter(o => o.status === 'Signed');
    const return14Orders = reportOrders.filter(isReturnWithin14Days);
    const totalSales = signedReportOrders.reduce((sum, order) => sum + Number(order.price || 0), 0);
    const totalReturn14 = return14Orders.reduce((sum, order) => sum + Number(order.price || 0), 0);
    const totalExpenses = signedReportOrders.reduce((sum, order) => {
      const last = getLatestCollectEntry(order);
      return sum + Number(last?.shipping || 0);
    }, 0);
    const totalTransfers = signedReportOrders.reduce((sum, order) => {
      const last = getLatestCollectEntry(order);
      const method = String(last?.payment_method || '').toLowerCase();
      return (method === 'instapay' || method === 'wallet')
        ? sum + Number(last?.sales || order.price || 0)
        : sum;
    }, 0);
    const netDaily = totalSales - totalReturn14 - totalExpenses - totalTransfers;
    const printDate = new Date().toLocaleDateString('ar-EG') + ' ' + new Date().toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'});

    const reportHTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>Summary Report</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family:Tahoma, Arial, sans-serif;
    width:80mm;
    margin:0 auto;
    padding:8px;
    background:#fff;
    color:#000;
    font-size:14px;
    font-weight:700;
    line-height:1.45;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
    text-rendering:geometricPrecision;
  }
  .center { text-align:center; }
  .bold { font-weight:900; }
  .title { font-size:19px; font-weight:900; margin-bottom:3px; }
  .sub { font-size:12px; line-height:1.55; font-weight:700; }
  .divider { border-top:2px dashed #000; margin:8px 0; }
  .divider-solid { border-top:3px solid #000; margin:8px 0; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; font-size:14px; font-weight:800; }
  .row .value { direction:ltr; font-weight:900; white-space:nowrap; }
  .return-row { color:#dc2626; font-weight:900; }
  .net { border:3px solid #000; padding:9px 6px; margin:8px 0; font-size:16px; font-weight:900; }
  .formula { direction:ltr; text-align:center; font-size:12px; font-weight:800; line-height:1.55; margin:6px 0; }
  .footer { text-align:center; font-size:11px; font-weight:700; line-height:1.55; margin-top:8px; }
  @media print {
    body { width:80mm; }
    @page { size:80mm auto; margin:0; }
  }
</style>
</head>
<body>
  <div class="center title">صيدليات العقبي</div>
  <div class="center bold" style="font-size:15px;">SUMMARY REPORT</div>
  <div class="center sub">فرع ${escapeHTML(currentBranchName)}</div>

  <div class="divider-solid"></div>

  <div class="sub"><b>من:</b> ${from}</div>
  <div class="sub"><b>إلى:</b> ${to}</div>
  <div class="sub"><b>عدد الأوردرات:</b> ${enNumber(reportOrders.length)}</div>

  <div class="divider"></div>

  <div class="row"><span>إجمالي المبيعات</span><span class="value">${enMoney(totalSales)} EGP</span></div>
  <div class="row return-row"><span>مرتجع خلال 14 يوم</span><span class="value">- ${enMoney(totalReturn14)} EGP</span></div>
  <div class="row"><span>إجمالي المصروفات</span><span class="value">${enMoney(totalExpenses)} EGP</span></div>
  <div class="row"><span>إجمالي التحويلات</span><span class="value">${enMoney(totalTransfers)} EGP</span></div>

  <div class="divider-solid"></div>

  <div class="row net"><span>صافي اليومية</span><span class="value">${enMoney(netDaily)} EGP</span></div>
  <div class="formula">${enMoney(totalSales)} - ${enMoney(totalReturn14)} - ${enMoney(totalExpenses)} - ${enMoney(totalTransfers)} = ${enMoney(netDaily)}</div>

  <div class="divider"></div>
  <div class="footer">تاريخ الطباعة<br>${printDate}</div>
  <div class="footer bold">elokaby Pharmacy System</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=420,height=700');
    if (!win) {
      alert('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.');
      return;
    }
    win.document.write(reportHTML);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  } catch (error) {
    console.error('Branch summary report error:', error);
    alert('مشكلة في تجهيز Summary Report: ' + (error.message || error));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = oldText || '📊 Summary Report'; }
  }
}

// ===== Export صفحات الفروع =====
function exportBranchOrders() {
  if (!branchOrders || !branchOrders.length) { alert('لا توجد بيانات للتصدير'); return; }
  const filtered = getBranchFilteredOrders ? getBranchFilteredOrders() : branchOrders;
  if (!filtered.length) { alert('لا توجد بيانات مطابقة للفلتر الحالي'); return; }
  downloadCSV('branch-orders-' + currentBranchName + '.csv',
    ['#', 'الموظف', 'الدكتور', 'العميل', 'الموبايل', 'شركة الشحن', 'المنطقة', 'المنتجات', 'الكمية', 'سعر الوحدة', 'خدمة التوصيل', 'الخصم', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة', 'ملاحظات', 'التاريخ'],
    filtered.map((o, i) => {
      const qty      = Number(o.quantity || 1);
      const delivFee = Number(o.delivery_fee || 0);
      const price    = Number(o.price || 0);
      const deposit  = Number(o.deposit || 0);
      const unitP    = qty > 0 ? (price - delivFee) / qty : price;
      return [
        i + 1,
        o.employee_name || '',
        o.doctor_name || '',
        o.customer_name || '',
        o.phone || '',
        o.shipping_company || '',
        o.area || '',
        o.product_names || '',
        qty,
        unitP.toFixed(2),
        delivFee,
        getOrderMeta(o).discount || 0,
        price,
        deposit,
        Math.max(0, price - deposit),
        o.status || '',
        cleanVisibleOrderNotes(o.notes || ''),
        o.created_at || ''
      ];
    })
  );
}

function getVisibleOrders() {
  if (isCashier() || isStoreManager() || isAccountSupervisor()) {
    const managed = getCurrentUserManagedBranches();
    if (!managed.length) return [];
    return orders.filter(o => isOrderInManagedBranches(o, managed));
  }
  return orders;
}

function renderEmployeeFilter() {
  const current = filterEmployee.value, base = getVisibleOrders();
  const employees = [...new Set(base.map(o => o.employee_name).filter(Boolean))];
  filterEmployee.innerHTML = `<option value="الكل">كل الموظفين</option>` + employees.map(e => `<option value="${e}">${e}</option>`).join("");
  filterEmployee.disabled = false;
  filterEmployee.value = employees.includes(current) ? current : "الكل";
}

function renderDashboardShippingFilter() {
  const sel = document.getElementById("filterShippingCompany");
  if (!sel) return;
  const current = sel.value;
  const companies = getShippingCompanyNames();
  sel.innerHTML = `<option value="الكل">كل شركات الشحن</option>` + companies.map(c => `<option value="${c}">${c}</option>`).join("");
  sel.value = companies.includes(current) ? current : "الكل";
}

function getFilteredOrders() {
  const search = searchInput.value.trim().toLowerCase(), statusFilter = filterStatus.value, employeeFilter = filterEmployee.value;
  const shippingFilterEl = document.getElementById("filterShippingCompany");
  const shippingFilter = shippingFilterEl ? shippingFilterEl.value : "الكل";
  return getVisibleOrders().filter(o => {
    const matchSearch = matchesOrderSearch(o, search);
    const matchStatus = matchesOrderStatusFilter(o, statusFilter);
    const matchEmployee = !isAdmin() || employeeFilter === "الكل" || o.employee_name === employeeFilter;
    const matchShipping = shippingFilter === "الكل" || o.shipping_company === shippingFilter;
    const matchDate = isInDateRange(o);
    return matchSearch && matchStatus && matchEmployee && matchShipping && matchDate;
  });
}

function renderStats(filtered) {
  const revenue = calcRevenueBreakdown(filtered);
  const confirmedCount = filtered.filter(o => o.status === "تم التأكيد").length;
  const returnedCount = filtered.filter(o => o.status === "Returned").length;
  const fakeDoctorCount = filtered.filter(o => isFakeDoctorOrder(o)).length;
  const fakeDeliveryCount = filtered.filter(o => isFakeDeliveryUpdateOrder(o)).length;
  const signedCount = filtered.filter(o => o.status === "Signed").length;
  const pickedUpCount = filtered.filter(o => o.status === "Picked-up").length;
  const inTransitCount = filtered.filter(o => o.status === "Transit" || o.status === "In transit").length;
  const deliveringCount = filtered.filter(o => o.status === "Delivering").length;
  const returningCount = filtered.filter(o => o.status === "Returning").length;

  totalOrders.innerHTML = statHTML(filtered.length, revenue.total, "Total Value");
  confirmedOrders.innerHTML = statHTML(confirmedCount, revenue.confirmed, "Revenue", "good");
  returnedOrders.innerHTML = statHTML(returnedCount, revenue.returned, "Returned Value", "bad");
  fakeDoctorOrders.innerHTML = statHTML(fakeDoctorCount, revenue.fakeDoctor, "Fake Value", "warn");
  fakeDeliveryUpdateOrders.innerHTML = statHTML(fakeDeliveryCount, revenue.fakeDelivery, "Fake Delivery Value", "warn");
  totalSigned.innerHTML = statHTML(signedCount, revenue.signed, "Signed Value", "good");
  pickedUpOrders.innerHTML = statHTML(pickedUpCount, revenue.pickedUp, "Picked-up Value", "good");
  inTransitOrders.innerHTML = statHTML(inTransitCount, revenue.inTransit, "In Transit Value", "");
  deliveringOrders.innerHTML = statHTML(deliveringCount, revenue.delivering, "Delivering Value", "");
  returningOrders.innerHTML = statHTML(returningCount, revenue.returning, "Returning Value", "warn");
  totalRevenue.innerHTML = `<span class="stat-count">${money(revenue.total)}</span><small class="stat-money">All Statuses Value</small>`;
  
  if($("totalDeposit")) $("totalDeposit").innerHTML = `<span class="stat-count">${money(revenue.totalDeposit)}</span><small class="stat-money deposit">Total Deposits</small>`;
}

function renderOrders() {
  renderEmployeeFilter();
  renderDashboardShippingFilter();
  const filtered = getFilteredOrders();
  renderStats(filtered);
  
  if (!filtered.length) {
    ordersTableBody.innerHTML = `<tr><td colspan="18" class="empty">No data found</td></tr>`;
    syncBulkSelectionUI([]);
    renderPagination("ordersPagination", 0, "orders");
    return;
  }

  const page = getPaginatedRows(filtered, "orders");
  let html = "";
  
  for(let i = 0; i < page.rows.length; i++) {
    const o = page.rows[i];
    let statusClass = "chip-transit";
    if (o.status === "Returned") statusClass = "chip-returned";
    else if (o.status === "Transit") statusClass = "chip-transit";
    else if (o.status === "Signed") statusClass = "chip-signed";
    else if (isFakeDoctorOrder(o) || isFakeDeliveryUpdateOrder(o)) statusClass = "chip-fake";    
    const displayNotes = cleanVisibleOrderNotes(o.notes || '');
    const safeNotes = displayNotes.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const isChecked = selectedOrderIds.has(String(o.id));
    const deposit = Number(o.deposit || 0);
    const price = Number(o.price || 0);
    const remaining = price - deposit;
    const paymentImage = o.payment_image ? `<button class="view-payment-btn" onclick="viewPaymentImage('${o.payment_image}')" style="background:#0D9488;padding:4px 8px;border-radius:6px;font-size:11px">📷 عرض</button>` : '<span class="chip chip-cancelled" style="font-size:10px">لا يوجد</span>';
    const adminCheckbox = isAdmin() ? `<td><input type="checkbox" class="row-check" data-id="${o.id}" ${isChecked ? 'checked' : ''} onchange="toggleSelectOrder(this, '${o.id}')" /></td>` : '';
    
    html += `
      <tr>
        ${adminCheckbox}
        <td>${num(page.start + i + 1)}</td>
        <td>${o.employee_name || ""}</td>
        <td>${o.doctor_name || ""}</td>
        <td>${o.order_number || ""}</td>  
        <td>${o.customer_name || ""}</td>
        <td>${o.phone || ""}</td>
        <td>${o.phone2 || ""}</td> 
        <td>${o.shipping_company || ""}</td>
        <td class="region-cell">${o.area || ""}</td>
        <td>${money(price)}</td>
        <td>${deposit > 0 ? `<span class="deposit-badge">💰 ${money(deposit)}</span>` : "—"}</td>
        <td>${remaining > 0 ? money(remaining) : "—"}</td>
        <td>${paymentImage}</td>
        <td><span class="chip ${statusClass}">${getOrderDisplayStatus(o)}</span></td>
        <td class="notes-cell" title="${safeNotes}">${displayNotes || ''}</td>
        <td>${formatEnglishDateTime(o.created_at)}</td>
        <td><div style="display:flex;gap:4px"><button class="edit" style="padding:4px 10px;font-size:11px" onclick="editOrder('${o.id}')">تعديل</button>${isAdmin() ? `<button class="danger" style="padding:4px 10px;font-size:11px" onclick="deleteOrder('${o.id}')">حذف</button>` : ''}</div></td>
      </tr>`;
  }
  
  ordersTableBody.innerHTML = html;
  renderPagination("ordersPagination", filtered.length, "orders");
  syncBulkSelectionUI(page.rows);
}

function syncBulkSelectionUI(currentPageRows = []) {
  const bar = document.getElementById("bulkDeleteBar");
  const countEl = document.getElementById("selectedOrdersCount");
  const selectPage = document.getElementById("selectPageOrders");
  
  if (countEl) countEl.textContent = `${selectedOrderIds.size} عميل محدد`;
  if (bar) bar.classList.toggle("hidden", !isAdmin() || selectedOrderIds.size === 0);
  
  if (selectPage && currentPageRows && currentPageRows.length) {
    const pageIds = currentPageRows.map(o => String(o.id));
    const selectedInPage = pageIds.filter(id => selectedOrderIds.has(id)).length;
    selectPage.checked = pageIds.length > 0 && selectedInPage === pageIds.length;
    selectPage.indeterminate = selectedInPage > 0 && selectedInPage < pageIds.length;
  }
}

orderForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const empEl    = document.getElementById("employeeName");
  const docEl    = document.getElementById("doctorName");
  const custEl   = document.getElementById("customerName");
  const phoneEl  = document.getElementById("phone");
  const shipEl   = document.getElementById("shippingCompany");
  const areaEl   = document.getElementById("area");
  const priceEl  = document.getElementById("price");
  const depositEl = document.getElementById("deposit");
  const statusEl = document.getElementById("status");
  const notesEl  = document.getElementById("orderNotes");
  const paymentImageInput = document.getElementById("paymentImage");
  const existingPaymentImage = document.getElementById("existingPaymentImage")?.value || "";
  
  const submitButton = document.getElementById("submitBtn");
  
  const depositValue = depositEl ? Number(depositEl.value) || 0 : 0;
  const imageFile = paymentImageInput?.files[0];
  
  if (depositValue > 0 && !imageFile && !existingPaymentImage) {
    alert(`⚠️ يجب رفع صورة إثبات الدفع (إيصال أو صورة تحويل) لأن المبلغ المدفوع هو ${money(depositValue)}`);
    if (paymentImageInput) paymentImageInput.focus();
    return;
  }
  
  if (imageFile && !validateImageFile(imageFile)) {
    return;
  }
  
  submitButton.disabled = true;
  submitButton.textContent = "جاري الحفظ...";

  if (!hasProducts('dash')) {
    alert('أضف منتج واحد على الأقل في الأوردر');
    submitButton.disabled = false;
    submitButton.textContent = editId ? "حفظ التعديل" : "إضافة الأوردر";
    return;
  }
  syncProductCartTotals('dash');
  if (!confirmDiscountBeforeOrderSave('dash')) {
    submitButton.disabled = false;
    submitButton.textContent = editId ? "حفظ التعديل" : "إضافة الأوردر";
    return;
  }
  const qty        = Math.max(1, Number(document.getElementById("quantity")?.value || 1));
  const delivFee   = Number(document.getElementById("deliveryFee")?.value || 0);
  const totalPrice = Number(document.getElementById("price")?.value || 0);

  const orderData = {
    employee_name:    isAdmin() ? empEl.value.trim() : currentUser.name,
    doctor_name:      docEl.value.trim(),
    order_number:     document.getElementById('orderNumber')?.value?.trim() || '',
    customer_name:    custEl.value.trim(),
    phone:            phoneEl.value.trim(),
    phone2:           document.getElementById('phone2')?.value.trim() || '', 
    shipping_company: shipEl.value,
    area:             areaEl.value.trim(),
    price:            totalPrice,
    deposit:          depositValue,
    quantity:         qty,
    delivery_fee:     delivFee,
    status:           statusEl.value,
    fake_doctor:      statusEl.value === "Fake Doctor",
    notes:            buildNotesWithOrderMeta((notesEl.value || '').trim() || "لا توجد ملاحظات", { discount: Number(document.getElementById('dashDiscountInput')?.value || 0), ticket_seq_v2: !editId }),
    product_names:    document.getElementById("productNames")?.value.trim() || productCartToText(dashProducts)
  };

  if (!orderData.employee_name || !orderData.doctor_name || !orderData.customer_name 
      || !orderData.phone || !orderData.shipping_company || !orderData.area 
      || !orderData.price || !orderData.status) {
    alert("من فضلك املى كل البيانات");
    submitButton.disabled = false;
    submitButton.textContent = editId ? "حفظ التعديل" : "إضافة الأوردر";
    return;
  }

  try {
    const wasEditingOrder = Boolean(editId);
    let orderId = editId;
    let result;
    
    if (editId) {
      const existingOrder = orders.find(x => String(x.id) === String(editId));
      if (existingOrder && String(existingOrder.status || '').trim() === 'Signed' && !isAdmin()) {
        alert('لا يمكن تعديل أوردر Signed إلا من خلال الأدمن فقط');
        submitButton.disabled = false;
        submitButton.textContent = 'حفظ التعديل';
        return;
      }
      result = await supabaseClient.from("orders").update(orderData).eq("id", editId).select();
      if (result.error) throw result.error;
      orderId = editId;
    } else {
      Object.assign(orderData, await reserveNextOrderIdentifiers());
      result = await supabaseClient.from("orders").insert([orderData]).select();
      if (result.error) throw result.error;
      
      if (result.data && result.data.length > 0) {
        orderId = result.data[0].id;
        console.log("✅ New order created with ID:", orderId);
      } else {
        throw new Error("لم يتم استرجاع ID الأوردر بعد الإضافة");
      }
    }
    
    if (imageFile && orderId) {
      console.log("📸 Uploading image for order ID:", orderId);
      
      if (existingPaymentImage) {
        await deletePaymentImage(existingPaymentImage);
      }
      
      const imageUrl = await uploadPaymentImage(imageFile, orderId);
      console.log("📸 Image URL after upload:", imageUrl);
      
      if (imageUrl) {
        const { error: updateError } = await supabaseClient
          .from("orders")
          .update({ payment_image: imageUrl })
          .eq("id", orderId);
          
        if (updateError) {
          console.error("❌ Error updating payment_image:", updateError);
          alert("تم حفظ الأوردر ولكن فشل رفع الصورة: " + updateError.message);
        } else {
          console.log("✅ Payment image saved successfully!");
          const proofOrder = { id: orderId, ...orderData };
          await logActivity('payment_proof_attached','تم إرفاق إثبات دفع للأوردر',`العميل: ${orderData.customer_name} | تم رفع صورة إثبات الدفع`,getActivityOrderInfo(proofOrder));
        }
      }
    }
    
    const savedOrder = (result && result.data && result.data[0]) ? result.data[0] : { id: orderId, ...orderData };
    await logActivity(wasEditingOrder ? 'order_updated' : 'order_created', wasEditingOrder ? 'تم تعديل أوردر' : 'تم إضافة أوردر جديد', `العميل: ${orderData.customer_name} | الحالة: ${orderData.status} | الإجمالي: ${money(orderData.price)}`, getActivityOrderInfo(savedOrder));
    const appliedDiscount = Number(document.getElementById('dashDiscountInput')?.value || getOrderMeta(savedOrder).discount || 0);
    if(appliedDiscount>0) await logActivity('order_discount','تم تطبيق خصم على أوردر',`العميل: ${orderData.customer_name} | قيمة الخصم: ${money(appliedDiscount)} | الإجمالي بعد الخصم: ${money(orderData.price)}`,getActivityOrderInfo(savedOrder));
    resetForm();
    await loadOrders();
    alert(wasEditingOrder ? "تم تعديل الاوردر بنجاح" : "تم الإضافة بنجاح");
    
  } catch (error) {
    console.error("❌ Error in form submission:", error);
    alert("مشكلة في الحفظ: " + error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = editId ? "حفظ التعديل" : "إضافة الأوردر";
  }
});

function checkDepositImageRequirement() {
  const depositEl = document.getElementById("deposit");
  const paymentImageInput = document.getElementById("paymentImage");
  const existingPaymentImage = document.getElementById("existingPaymentImage")?.value || "";
  const depositValue = depositEl ? Number(depositEl.value) || 0 : 0;
  const warningEl = document.getElementById("depositImageWarning");
  
  if (!warningEl) return true;
  
  const hasFile = paymentImageInput && paymentImageInput.files && paymentImageInput.files.length > 0;
  const hasExisting = existingPaymentImage && existingPaymentImage.length > 0;
  
  if (depositValue > 0 && !hasFile && !hasExisting) {
    warningEl.style.display = "block";
    warningEl.innerHTML = `⚠️ يجب رفع صورة إثبات الدفع لأن المبلغ المدفوع هو ${money(depositValue)}`;
    return false;
  } else {
    warningEl.style.display = "none";
    return true;
  }
}

function checkBranchDepositImageRequirement() {
  const depositEl = document.getElementById("bDeposit");
  const paymentImageInput = document.getElementById("bPaymentImage");
  const depositValue = depositEl ? Number(depositEl.value) || 0 : 0;
  const warningEl = document.getElementById("bDepositImageWarning");

  if (!warningEl) return true;

  const hasFile = paymentImageInput && paymentImageInput.files && paymentImageInput.files.length > 0;
  const hasExisting = Boolean(branchEditExistingPaymentImage);

  if (depositValue > 0 && !hasFile && !hasExisting) {
    warningEl.style.display = "block";
    warningEl.innerHTML = `⚠️ يجب رفع صورة إثبات الدفع لأن المبلغ المدفوع هو ${money(depositValue)}`;
    return false;
  }

  warningEl.style.display = "none";
  return true;
}

window.editOrder = function (id) {
  const o = orders.find(x => String(x.id) === String(id));
  if (!o) return;
  if (isFinalizedDeliveredOrder(o) && !isAdmin()) { showDeliveredOrderLockedMessage(); return; }
  if (!isAdmin() && o.employee_name !== currentUser.name) { alert("غير مسموح بتعديل أوردرات موظف آخر"); return; }
  editId = id;
  employeeName.value = o.employee_name || "";
  doctorName.value = o.doctor_name || "";
  const orderNumberEl = document.getElementById('orderNumber');
  if (orderNumberEl) orderNumberEl.value = o.order_number || "";
  customerName.value = o.customer_name || "";
  phone.value = o.phone || "";
  document.getElementById('phone2').value = o.phone2 || ""; 
  shippingCompany.value = o.shipping_company || "";
  area.value = o.area || "";

  setProductCartFromOrder('dash', o);

  if($("deposit")) $("deposit").value = o.deposit || 0;
  status.value = o.status || "";
  $('orderNotes').value = cleanVisibleOrderNotes(o.notes || '');
  const existingImage = o.payment_image || "";
  const existingImageField = document.getElementById("existingPaymentImage");
  if (existingImageField) existingImageField.value = existingImage;
  
  const previewDiv = document.getElementById("paymentImagePreview");
  const previewImg = document.getElementById("paymentPreviewImg");
  
  if (existingImage && previewDiv && previewImg) {
    previewImg.src = existingImage;
    previewDiv.style.display = "block";
  } else if (previewDiv) {
    previewDiv.style.display = "none";
  }
  
  const fileInput = document.getElementById("paymentImage");
  if (fileInput) fileInput.value = "";

  submitBtn.textContent = "حفظ التعديل";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.deleteOrder = async function (id) {
  if (!isAdmin()) { 
    alert("غير مسموح بالحذف"); 
    return; 
  }
  
  const confirmDelete = confirm("هل أنت متأكد من حذف هذا الأوردر فقط؟");
  if (!confirmDelete) return;
  
  const orderToDelete = orders.find(x => String(x.id) === String(id));
  
  const { error } = await supabaseClient.from("orders").delete().eq("id", id);
  if (error) { 
    alert("مشكلة في الحذف: " + error.message); 
    console.error(error); 
    return; 
  }
  
  await logActivity('order_deleted','تم حذف أوردر',`العميل: ${orderToDelete?.customer_name || '—'} | الحالة: ${orderToDelete?.status || '—'}`,getActivityOrderInfo(orderToDelete));
  
  if (orderToDelete && orderToDelete.payment_image) {
    await deletePaymentImage(orderToDelete.payment_image);
  }
  
  alert("تم حذف الأوردر بنجاح");
  await loadOrders();
}

// ===== دوال التحليلات المُصححة =====
function countStatus(list, s) { return list.filter(o => o.status === s).length; }

function getShippingAnalysisRows(sourceOrders) {
  const src = sourceOrders || orders;
  const companies = getShippingCompanyNames();
  return companies.map(company => {
    const list = src.filter(o => o.shipping_company === company);
    const total = list.length;
    const signed = countStatus(list, "Signed");
    const transit = countStatus(list, "Transit");
    const returned = countStatus(list, "Returned");
    const fakeDelivery = getFakeDeliveryUpdateCount(list);
    const delivering = countStatus(list, "Delivering");
    
    return { 
      company, 
      total, 
      signed,
      transit,
      returned,
      fakeDelivery,
      delivering,
      conversionRate: percent(signed, total),
      fakeRate: percent(fakeDelivery, total),
      deliveringRate: percent(delivering, total),
      returnRate: percent(returned, total),
      fakeRateNum: percentNum(fakeDelivery, total),
      deliveringRateNum: percentNum(delivering, total),
      returnRateNum: percentNum(returned, total) 
    };
  });
}

function getDoctorsAnalysisRows(sourceOrders) {
  const src = sourceOrders || orders;
  const doctors = [...new Set(src.map(o => o.doctor_name).filter(Boolean))];
  return doctors.map(doc => {
    const list = src.filter(o => o.doctor_name === doc);
    const total = list.length;
    const signed = countStatus(list, "Signed");
    const transit = countStatus(list, "Transit");
    const returned = countStatus(list, "Returned");
    const fakeDoctor = getFakeDoctorCount(list);
    const revenue = list.reduce((s, o) => s + Number(o.price || 0), 0);
    
    return { 
      doctor: doc, 
      total, 
      signed,
      transit,
      returned,
      fakeDoctor,
      revenue, 
      conversionRate: percent(signed, total),
      fakeRate: percent(fakeDoctor, total), 
      returnRate: percent(returned, total),
      fakeRateNum: percentNum(fakeDoctor, total), 
      returnRateNum: percentNum(returned, total) 
    };
  });
}

function getFilteredDoctorsAnalysisRows(sourceOrders) {
  const q = (doctorsAnalysisSearch?.value || "").trim().toLowerCase();
  const rows = getDoctorsAnalysisRows(sourceOrders);
  if (!q) return rows;
  return rows.filter(r => String(r.doctor || "").toLowerCase().includes(q));
}

function applyAnalyticsFilter() {
  analyticsDateFrom = $("analyticsFromDate").value || null;
  analyticsDateTo = $("analyticsToDate").value || null;
  const badge = $("analyticsFilterBadge");
  if (analyticsDateFrom || analyticsDateTo) {
    let label = "📅 ";
    if (analyticsDateFrom && analyticsDateTo) label += `${analyticsDateFrom} → ${analyticsDateTo}`;
    else if (analyticsDateFrom) label += `من ${analyticsDateFrom}`;
    else label += `حتى ${analyticsDateTo}`;
    badge.textContent = label;
    badge.classList.add("visible");
  } else {
    badge.classList.remove("visible");
  }
  renderAnalytics();
}

function resetAnalyticsFilter() {
  analyticsDateFrom = null; analyticsDateTo = null;
  $("analyticsFromDate").value = ""; $("analyticsToDate").value = "";
  $("analyticsFilterBadge").classList.remove("visible");
  renderAnalytics();
}

function getAnalyticsOrders() {
  if (!analyticsDateFrom && !analyticsDateTo) return orders;
  return orders.filter(o => {
    const raw = o.created_at; if (!raw) return true;
    const d = raw.split("T")[0];
    if (analyticsDateFrom && analyticsDateTo) return d >= analyticsDateFrom && d <= analyticsDateTo;
    if (analyticsDateFrom) return d >= analyticsDateFrom;
    return d <= analyticsDateTo;
  });
}

function renderAnalytics() {
  const analyticsOrders = getAnalyticsOrders();
  const ship = getShippingAnalysisRows(analyticsOrders);
  const docs = getFilteredDoctorsAnalysisRows(analyticsOrders);
  
  const shipPage = getPaginatedRows(ship, "shippingAnalysis");
  const docsPage = getPaginatedRows(docs, "doctorsAnalysis");

  $("shippingAnalyticsBody").innerHTML = shipPage.rows.length
    ? shipPage.rows.map(r => `
      <tr>
        <td>${r.company}</td>
        <td>${num(r.total)}</td>
        <td>${num(r.signed)}</td>
        <td>${num(r.transit)}</td>
        <td>${num(r.returned)}</td>
        <td>${num(r.fakeDelivery)}</td>
        <td>${r.conversionRate}</td>
        <td>${r.fakeRate}</td>
        <td>${r.returnRate}</td>
      </tr>`).join("")
    : `<tr><td colspan="9" class="empty">No shipping data</td></tr>`;

  $("doctorsAnalyticsBody").innerHTML = docsPage.rows.length
    ? docsPage.rows.map(r => `
      <tr>
        <td>${r.doctor}</td>
        <td>${num(r.total)}</td>
        <td>${num(r.signed)}</td>
        <td>${num(r.transit)}</td>
        <td>${num(r.returned)}</td>
        <td>${num(r.fakeDoctor)}</td>
        <td>${money(r.revenue)}</td>
        <td>${r.conversionRate}</td>
        <td>${r.fakeRate}</td>
        <td>${r.returnRate}</td>
      </tr>`).join("")
    : `<tr><td colspan="10" class="empty">No doctors data</td></tr>`;

  renderPagination("shippingAnalysisPagination", ship.length, "shippingAnalysis");
  renderPagination("doctorsAnalysisPagination", docs.length, "doctorsAnalysis");
}

// ===== دوال الترتيب =====
function getShippingRankRows() {
  const src = getShippingFilteredOrders();
  return getShippingAnalysisRows(src)
    .filter(r => String(r.company || '').trim())
    .map(r => {
      const conversion = percentNum(r.signed, r.total);
      const returnRate = percentNum(r.returned, r.total);
      const fakeRate = percentNum((r.fakeDoctor || 0) + (r.fakeDelivery || 0), r.total);
      return { ...r, conversionRate: conversion.toFixed(1) + '%', conversionRateNum: conversion, returnRate: returnRate.toFixed(1) + '%', returnRateNum: returnRate, fakeRate: fakeRate.toFixed(1) + '%', fakeRateNum: fakeRate, score: conversion - (returnRate * 1.5) - fakeRate };
    })
    .sort((a, b) => b.score - a.score || b.signed - a.signed || b.total - a.total);
}

function getDoctorRankRows() { 
  return getDoctorsAnalysisRows().map(r => ({ 
    ...r, 
    score: r.revenue - ((r.fakeRateNum + r.returnRateNum) * 200)
  })).sort((a, b) => b.score - a.score); 
}

function renderShippingCompanyFilter() {
  // ✅ تأكد من تعريف المتغير
  shippingCompanyFilterMenu = document.getElementById('shippingCompanyFilterMenu');
  
  if (!shippingCompanyFilterMenu) {
    console.warn('⚠️ shippingCompanyFilterMenu element not found');
    return;
  }
  
  const companies = getShippingRankRows().map(r => r.company).filter(Boolean);
  const checkboxesContainer = shippingCompanyFilterMenu.querySelector('.multi-filter-items') || shippingCompanyFilterMenu;
  
  checkboxesContainer.innerHTML = companies.length
    ? companies.map(company => `
      <label class="multi-filter-item">
        <input type="checkbox" class="shipping-filter-check" value="${company}" ${selectedShippingCompanies.includes(company) ? "checked" : ""}>
        <span>${company}</span>
      </label>
    `).join("")
    : `<div class="empty">No companies found</div>`;
}

function toggleShippingCompanyFilter() {
  if (!shippingCompanyFilterMenu) return;
  renderShippingCompanyFilter();
  shippingCompanyFilterMenu.classList.toggle("show");
}

function applyShippingCompanyFilter() {
  selectedShippingCompanies = [...document.querySelectorAll(".shipping-filter-check:checked")].map(x => x.value);
  if (shippingCompanyFilterMenu) shippingCompanyFilterMenu.classList.remove("show");
  pageState.shippingRank = 1;
  renderShippingRank(); renderShippingCharts();
}

function resetShippingCompanyFilter() {
  selectedShippingCompanies = [];
  if (shippingCompanyFilterMenu) shippingCompanyFilterMenu.classList.remove("show");
  pageState.shippingRank = 1;
  renderShippingRank(); renderShippingCharts();
}

function getFilteredShippingRankRows() {
  const shippingRankSearchEl = document.getElementById("shippingRankSearch");
  const q = (shippingRankSearchEl?.value || "").trim().toLowerCase();
  let rows = getShippingRankRows();
  if (selectedShippingCompanies.length) rows = rows.filter(r => selectedShippingCompanies.includes(r.company));
  if (q) rows = rows.filter(r => String(r.company || "").toLowerCase().includes(q));
  return rows;
}

function getFilteredDoctorRankRows() {
  const q = (doctorRankSearch?.value || "").trim().toLowerCase();
  const rows = getDoctorRankRows();
  if (!q) return rows;
  return rows.filter(r => String(r.doctor || "").toLowerCase().includes(q));
}

function updateShippingMiniDashboard() {
  const DELIVERY_TARGET = 90;
  const RETURN_TARGET = 10;
  const src = getShippingFilteredOrders();
  const total = src.length;
  const signed = src.filter(o => o.status === "Signed").length;
  const delivering = src.filter(o => o.status === "Delivering").length;
  const returned = src.filter(o => o.status === "Returned").length;
  const conversionNum = percentNum(signed, total);
  const cancelNum = percentNum(returned, total);
  const remainingToTarget = Math.max(0, DELIVERY_TARGET - conversionNum);
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const setWidth = (id, value) => { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, value)) + "%"; };

  setText("shipMiniTotalOrders", num(total));
  setText("shipMiniSigned", num(signed));
  setText("shipMiniDelivering", num(delivering));
  setText("shipMiniTransit", num(delivering));
  setText("shipMiniReturned", num(returned));
  setText("shipMiniConversionRate", conversionNum.toFixed(1) + "%");
  setText("shipMiniCancelRate", cancelNum.toFixed(1) + "%");
  setText("shipMiniSignedSub", percent(signed, total) + " من الإجمالي");
  setText("shipMiniDeliveringSub", percent(delivering, total) + " من الإجمالي");
  setText("shipMiniReturnedSub", percent(returned, total) + " من الإجمالي");

  setText("shipTargetCurrentConversion", conversionNum.toFixed(1) + "%");
  setText("shipTargetCurrentConversionInline", conversionNum.toFixed(1) + "%");
  setText("shipTargetCurrentConversionBig", conversionNum.toFixed(1) + "%");
  setText("shipTargetRemaining", remainingToTarget.toFixed(1) + "%");
  setText("shipTargetRemainingBig", remainingToTarget.toFixed(1) + "%");
  setText("shipTargetCancelRate", cancelNum.toFixed(1) + "%");
  setText("shipTargetCancelRateInline", cancelNum.toFixed(1) + "%");
  setText("shipTargetCancelRateBig", cancelNum.toFixed(1) + "%");
  setWidth("shipDeliveryProgress", conversionNum);
  setWidth("shipRemainingProgress", (conversionNum / DELIVERY_TARGET) * 100);
  setWidth("shipReturnProgress", cancelNum);
  setWidth("shipPerformanceProgress", Math.min(100, (conversionNum / DELIVERY_TARGET) * 100));

  const returnIsDanger = cancelNum > RETURN_TARGET;
  const deliveryGood = conversionNum >= DELIVERY_TARGET;
  setText("shipReturnStatusText", returnIsDanger ? "خطر" : "آمن");
  setText("shipDeliveryStatusText", deliveryGood ? "محقق التارجت" : "تحتاج إلى تحسين");
  setText("shipPerformanceStatus", returnIsDanger ? "خطر" : (deliveryGood ? "ممتاز" : "جيد"));
  setText("shipPerformanceNote", returnIsDanger ? "المرتجعات تخطت الحد المسموح" : "مؤشراتك ضمن التارجت");

  const perfStatus = document.getElementById("shipPerformanceStatus");
  const cancelRate = document.getElementById("shipMiniCancelRate");
  if (perfStatus) perfStatus.style.color = returnIsDanger ? "#EF4444" : (deliveryGood ? "#57D85A" : "#F59E0B");
  if (cancelRate) cancelRate.style.color = returnIsDanger ? "#EF4444" : "#57D85A";

  const scope = document.getElementById("shippingDashboardScope");
  if (scope) {
    if (branchShippingRankOverride) {
      scope.textContent = `فرع ${branchShippingRankOverride}`;
    } else if (isStoreManager() || isAccountSupervisor()) {
      const branches = getCurrentUserManagedBranches();
      scope.textContent = branches.length ? branches.map(b => `فرع ${b}`).join(" / ") : "لا توجد فروع مُدارة";
    } else {
      scope.textContent = "جميع الفروع";
    }
  }
  const backBtn = document.getElementById('branchShippingBackBtn');
  if (backBtn) backBtn.classList.toggle('hidden', !branchShippingRankOverride);
}

function getBranchPerformanceRows() {
  const src = getShippingFilteredOrders();
  const branchesMap = [
    { branch: "مدينة نصر", company: "Nasr City Branch" },
    { branch: "اسكندرية", company: "Alexandria Branch" },
    { branch: "طنطا", company: "TanTa Branch" },
    { branch: "المنصورة", company: "Mansoura Branch" }
  ];

  return branchesMap.map(item => {
    const list = src.filter(o =>
      o.branch === item.branch ||
      o.shipping_company === item.company ||
      o.shipping_company === item.branch
    );
    const total = list.length;
    const signed = countStatus(list, "Signed");
    const delivering = countStatus(list, "Delivering");
    const returned = countStatus(list, "Returned");
    const cancelled = countStatus(list, "Cancel");
    const conversionNum = percentNum(signed, total);
    const returnNum = percentNum(returned, total);
    return {
      name: item.branch,
      total,
      signed,
      delivering,
      returned,
      cancelled,
      conversionRate: conversionNum.toFixed(1) + "%",
      returnRate: returnNum.toFixed(1) + "%",
      score: conversionNum - (returnNum * 1.5)
    };
  }).sort((a, b) => b.score - a.score);
}

function getShippingCompanyPerformanceRows() {
  const branchCompanyNames = new Set([
    "Mansoura Branch",
    "TanTa Branch",
    "Alexandria Branch",
    "Nasr City Branch",
    "مدينة نصر",
    "اسكندرية",
    "طنطا",
    "المنصورة"
  ]);
  return getShippingRankRows()
    .filter(r => !branchCompanyNames.has(String(r.company || '').trim()))
    .map(r => ({
      name: r.company,
      total: r.total,
      signed: r.signed,
      delivering: r.delivering || 0,
      returned: r.returned,
      conversionRate: r.conversionRate,
      returnRate: r.returnRate,
      score: (r.signed ? percentNum(r.signed, r.total) : 0) - (r.returnRateNum * 1.5)
    }))
    .sort((a, b) => b.score - a.score);
}

function renderPerformanceRows(tbodyId, rows, emptyText) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const activeRows = rows.filter(r => Number(r.total || 0) > 0);
  if (!activeRows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">${emptyText}</td></tr>`;
    return;
  }

  const showCancel = tbodyId === "branchPerformanceBody";
  tbody.innerHTML = activeRows.map((r, i) => {
    const returnValue = Number(String(r.returnRate || "0").replace("%", "")) || 0;
    const conversionValue = Number(String(r.conversionRate || "0").replace("%", "")) || 0;
    const returnColor = returnValue > 10 ? "#EF4444" : "#57D85A";
    const conversionColor = conversionValue >= 90 ? "#57D85A" : "#F59E0B";
    return `<tr>
      <td>${num(i + 1)}</td>
      <td>${r.name}</td>
      <td>${num(r.total)}</td>
      <td>${num(r.signed)}</td>
      <td>${num(r.delivering || 0)}</td>
      <td>${num(r.returned)}</td>
      <td style="color:${conversionColor};font-weight:900">${r.conversionRate}</td>
      <td style="color:${returnColor};font-weight:900">${r.returnRate}</td>
      <td>${showCancel ? num(r.cancelled || 0) : Number(r.score || 0).toFixed(1)}</td>
    </tr>`;
  }).join("");
}

function renderGlobalShippingSections() {
  const box = document.getElementById("globalShippingRankSections");
  if (box) box.classList.toggle("hidden", isStoreManager());

  if (isStoreManager()) return;

  renderPerformanceRows("branchPerformanceBody", getBranchPerformanceRows(), "No branch performance data");
  renderPerformanceRows("shippingCompanyPerformanceBody", getShippingCompanyPerformanceRows(), "No shipping company data");
}

function renderShippingRank() {
  updateShippingMiniDashboard();
  renderGlobalShippingSections();
  const pagination = document.getElementById("shippingRankPagination");
  if (pagination) pagination.innerHTML = "";
}

async function refreshShippingRankData(ev) {
  const btn=ev?.currentTarget||document.getElementById('refreshShippingRankBtn');
  const old=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.innerHTML='جاري التحديث...';}
  try {
    await loadOrders();
    renderShippingRank();
    renderShippingCharts();
  } finally {
    if(btn){btn.disabled=false;btn.innerHTML=old||'↻ Refresh';}
  }
}

function renderDoctorRank() {
  const allRows = getDoctorRankRows();
  const rows = getFilteredDoctorRankRows();
  const page = getPaginatedRows(rows, "doctorRank");

  $("doctorRankBody").innerHTML = page.rows.length
    ? page.rows.map((r, i) => `<tr>
        <td>${num(page.start + i + 1)}</td>
        <td>${r.doctor}</td>
        <td>${num(r.total)}</td>
        <td>${num(r.signed)}</td>
        <td>${num(r.returned)}</td>
        <td>${num(r.fakeDoctor)}</td>
        <td>${money(r.revenue)}</td>
        <td>${r.fakeRate}</td>
        <td>${r.returnRate}</td>
        <td>${money(r.score)}</td>
      </tr>`).join("")
    : `<tr><td colspan="10" class="empty">No doctors data</td></tr>`;

  renderPagination("doctorRankPagination", rows.length, "doctorRank");

  const best = allRows[0], topRev = [...allRows].sort((a, b) => b.revenue - a.revenue)[0], worstFake = [...allRows].sort((a, b) => b.fakeRateNum - a.fakeRateNum)[0], worstReturn = [...allRows].sort((a, b) => b.returnRateNum - a.returnRateNum)[0];
  $("bestDoctorInsight").textContent = best ? best.doctor : "No data";
  $("topRevenueDoctorInsight").textContent = topRev ? `${topRev.doctor} (${money(topRev.revenue)})` : "No data";
  $("worstFakeDoctorInsight").textContent = worstFake ? `${worstFake.doctor} (${worstFake.fakeRate})` : "No data";
  $("worstReturnDoctorInsight").textContent = worstReturn ? `${worstReturn.doctor} (${worstReturn.returnRate})` : "No data";
}

function renderRanks() { renderShippingRank(); renderDoctorRank(); }

// ===== دوال الشارت =====
function destroyChart(id) {
  try {
    if (charts && charts[id]) {
      charts[id].destroy();
      charts[id] = null;
    }
  } catch (e) {
    console.warn(`Error destroying chart ${id}:`, e);
  }
}

function makeChart(id, type, labels, datasets) {
  destroyChart(id);
  const ctx = $(id);
  charts[id] = new Chart(ctx, {
    type, data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#334155", padding: 16 } } },
      scales: {
        x: { ticks: { color: "#64748B" }, grid: { color: "rgba(15,23,42,0.05)" } },
        y: { ticks: { color: "#64748B" }, grid: { color: "rgba(15,23,42,0.05)" } }
      }
    }
  });
}

function applyShippingDateFilter() {
  onShippingFilterChange();
}

function onShippingFilterChange() {
  shippingDateFrom = $("shippingFromDate")?.value || null;
  shippingDateTo = $("shippingToDate")?.value || null;
  const badge = $("shippingDateBadge");
  if (shippingDateFrom || shippingDateTo) {
    let label = "📅 ";
    if (shippingDateFrom && shippingDateTo) label += `${shippingDateFrom} → ${shippingDateTo}`;
    else if (shippingDateFrom) label += `من ${shippingDateFrom}`;
    else label += `حتى ${shippingDateTo}`;
    badge.textContent = label;
    badge.classList.add("visible");
  } else {
    badge.classList.remove("visible");
  }
  renderShippingRank(); renderShippingCharts();
}

function resetShippingDateFilter() {
  shippingDateFrom = null; shippingDateTo = null;
  if ($("shippingFromDate")) $("shippingFromDate").value = "";
  if ($("shippingToDate")) $("shippingToDate").value = "";
  if ($("shippingDateBadge")) $("shippingDateBadge").classList.remove("visible");
  renderShippingRank(); renderShippingCharts();
}

function getShippingFilteredOrders() {
  if (!orders || !orders.length) return [];

  let src = orders;

  if (branchShippingRankOverride) {
    const branchName = branchShippingRankOverride;
    const branchShippingName = getBranchShippingCompanyName(branchName);
    src = src.filter(o => o.branch === branchName || o.shipping_company === branchName || o.shipping_company === branchShippingName);
  }
  else if (isStoreManager() || isAccountSupervisor()) {
    const managedBranches = getCurrentUserManagedBranches();
    const managedShippingNames = managedBranches.map(b => getBranchShippingCompanyName(b)).filter(Boolean);
    src = src.filter(o =>
      managedBranches.includes(o.branch) ||
      managedBranches.includes(o.shipping_company) ||
      managedShippingNames.includes(o.shipping_company)
    );
  }

  if (!shippingDateFrom && !shippingDateTo) return src;

  return src.filter(o => {
    const raw = o.created_at; if (!raw) return true;
    const d = raw.split("T")[0];
    if (shippingDateFrom && shippingDateTo) return d >= shippingDateFrom && d <= shippingDateTo;
    if (shippingDateFrom) return d >= shippingDateFrom;
    return d <= shippingDateTo;
  });
}

function renderShippingCharts() {
  const src = getShippingFilteredOrders();
  destroyChart("shippingBarChart");
  destroyChart("shippingConversionLineChart");
  destroyChart("shippingStatusDoughnutChart");
  destroyChart("shippingReturnLineChart");

  const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
  const gridColor = isDark ? 'rgba(148,163,184,0.13)' : 'rgba(15,23,42,0.08)';
  const textColor = isDark ? '#CBD5E1' : '#334155';
  const toDay = (iso) => {
    if (!iso) return '';
    const raw = String(iso).split('T')[0];
    const parts = raw.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : raw;
  };
  const byDate = {};
  src.forEach(o => {
    const d = toDay(o.created_at) || '—';
    if (!byDate[d]) byDate[d] = { total: 0, signed: 0, returned: 0, delivering: 0 };
    byDate[d].total += 1;
    if (o.status === 'Signed') byDate[d].signed += 1;
    if (o.status === 'Returned') byDate[d].returned += 1;
    if (o.status === 'Delivering') byDate[d].delivering += 1;
  });
  const labels = Object.keys(byDate).sort((a,b) => {
    const [da,ma] = a.split('/').map(Number);
    const [db,mb] = b.split('/').map(Number);
    return (ma*100+da) - (mb*100+db);
  });
  const conversionData = labels.map(d => Number(percentNum(byDate[d].signed, byDate[d].total).toFixed(1)));
  const returnData = labels.map(d => Number(percentNum(byDate[d].returned, byDate[d].total).toFixed(1)));
  const signed = src.filter(o => o.status === 'Signed').length;
  const delivering = src.filter(o => o.status === 'Delivering').length;
  const returned = src.filter(o => o.status === 'Returned').length;
  const others = Math.max(0, src.length - signed - delivering - returned);
  const baseLineOptions = (maxY = 100) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: textColor, padding: 16, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } } },
    scales: { x: { ticks: { color: textColor, font: { size: 12 } }, grid: { color: gridColor }, border: { display: false } }, y: { beginAtZero: true, max: maxY, ticks: { color: textColor, callback: v => v + '%' }, grid: { color: gridColor }, border: { display: false } } }
  });
  const convCtx = document.getElementById('shippingConversionLineChart');
  if (convCtx) charts['shippingConversionLineChart'] = new Chart(convCtx, { type: 'line', data: { labels, datasets: [ { label: 'معدل التسليم', data: conversionData, borderColor: '#57D85A', backgroundColor: 'rgba(87,216,90,.15)', fill: true, tension: .42, pointRadius: 4, pointHoverRadius: 6 }, { label: 'Target 90%', data: labels.map(() => 90), borderColor: '#E5E7EB', borderDash: [6,6], pointRadius: 0, fill: false, tension: 0 } ] }, options: baseLineOptions(100) });
  const doughnutCtx = document.getElementById('shippingStatusDoughnutChart');
  if (doughnutCtx) charts['shippingStatusDoughnutChart'] = new Chart(doughnutCtx, { type: 'doughnut', data: { labels: ['Signed','Delivering','Returned','Others'], datasets: [{ data: [signed, delivering, returned, others], backgroundColor: ['#57D85A','#F59E0B','#D946EF','#334155'], borderColor: isDark ? '#0B1220' : '#FFFFFF', borderWidth: 2, hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { color: textColor, padding: 18, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${percent(ctx.parsed, src.length)})` } } } } });
  const returnCtx = document.getElementById('shippingReturnLineChart');
  if (returnCtx) charts['shippingReturnLineChart'] = new Chart(returnCtx, { type: 'line', data: { labels, datasets: [ { label: 'معدل المرتجعات', data: returnData, borderColor: '#FF5555', backgroundColor: 'rgba(239,68,68,.12)', fill: true, tension: .42, pointRadius: 4, pointHoverRadius: 6 }, { label: 'Target 10%', data: labels.map(() => 10), borderColor: '#E5E7EB', borderDash: [6,6], pointRadius: 0, fill: false, tension: 0 } ] }, options: baseLineOptions(25) });
}

function renderDoctorCharts() {
  const rows = getDoctorRankRows().slice(0, 10), labels = rows.map(r => r.doctor);
  makeChart("doctorRevenueChart", "bar", labels, [{ label: "Revenue", data: rows.map(r => r.revenue), backgroundColor: "#0D9488" }]);
  makeChart("doctorRiskChart", "bar", labels, [
    { label: "Fake Rate %", data: rows.map(r => r.fakeRateNum.toFixed(1)), backgroundColor: "#F59E0B" },
    { label: "Return Rate %", data: rows.map(r => r.returnRateNum.toFixed(1)), backgroundColor: "#EF4444" }
  ]);
}

// ===== دوال التصدير =====
function downloadCSV(fileName, headers, rows) {
  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url);
  logActivity('data_exported','تصدير بيانات',`الملف: ${fileName} | عدد الصفوف: ${rows.length} | الصيغة: CSV`);
}

function exportData() {
  const f = getFilteredOrders();
  if (!f.length) { alert("لا توجد بيانات للتصدير"); return; }
  downloadCSV(
    "orders-data.csv",
    ["Employee", "Doctor", "Doctor Code", "Order Number", "Customer", "Phone", "Phone2", "Shipping Company", "Area", "Products", "Delivery Fee", "Discount", "Price", "Deposit", "Remaining", "Status", "Notes", "Created At"],
    f.map(o => [
      o.employee_name,
      o.doctor_name,
      getDoctorCodeByName(o.doctor_name) || o.doctor_code || "",
      o.order_number || "",
      o.customer_name,
      o.phone,
      o.phone2,
      o.shipping_company,
      o.area,
      o.product_names || "",
      o.delivery_fee || 0,
      getOrderMeta(o).discount || 0,
      o.price,
      o.deposit || 0,
      Math.max(0, Number(o.price || 0) - Number(o.deposit || 0)),
      o.status,
      stripCollectMeta(o.notes || ""),
      o.created_at
    ])
  );
}

function exportShippingAnalysis() { const rows = getShippingAnalysisRows(); downloadCSV("shipping-analysis.csv", ["Shipping Company", "Total Orders", "Signed", "Transit", "Returned", "Fake Delivery", "Conversion Rate", "Fake Rate", "Return Rate"], rows.map(r => [r.company, r.total, r.signed, r.transit, r.returned, r.fakeDelivery, r.conversionRate, r.fakeRate, r.returnRate])); }
function exportDoctorsAnalysis() { const r = getDoctorsAnalysisRows(); if (!r.length) { alert("لا توجد بيانات دكاترة للتصدير"); return; } downloadCSV("doctors-analysis.csv", ["Doctor", "Total Orders", "Signed", "Transit", "Returned", "Fake Doctor", "Total Revenue", "Conversion Rate", "Fake Rate", "Return Rate"], r.map(x => [x.doctor, x.total, x.signed, x.transit, x.returned, x.fakeDoctor, x.revenue, x.conversionRate, x.fakeRate, x.returnRate])); }
function exportShippingRank() { const rows = getShippingRankRows(); downloadCSV("shipping-dashboard.csv", ["Rank", "Shipping Company", "Total Order", "Signed", "Delivering", "Returned", "Conversion Rate", "Cancel Rate", "Score"], rows.map((r, i) => [i + 1, r.company, r.total, r.signed, r.delivering, r.returned, r.conversionRate, r.returnRate, r.score.toFixed(1)])); }
function exportDoctorRank() { const r = getDoctorRankRows(); if (!r.length) { alert("لا توجد بيانات دكاترة للتصدير"); return; } downloadCSV("doctor-rank.csv", ["Rank", "Doctor", "Total Orders", "Signed", "Returned", "Fake", "Total Revenue", "Fake Rate", "Return Rate", "Score"], r.map((x, i) => [i + 1, x.doctor, x.total, x.signed, x.returned, x.fakeDoctor, x.revenue, x.fakeRate, x.returnRate, x.score.toFixed(1)])); }

// ===== دوال المستخدمين =====
function onNewRoleChange() {
  const role = $("newRole").value;
  $("newUserBranchesWrap").classList.toggle("hidden", !["store_manager","cashier","account_supervisor"].includes(role));
}

function getSelectedNewUserBranches() {
  return Array.from(document.querySelectorAll(".new-user-branch-cb:checked")).map(cb => cb.value);
}

userForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin() && !isExecutiveAssistant()) { alert("غير مسموح"); return; }

  const execOnly = isExecutiveAssistant() && !isAdmin();

  let role = execOnly ? "secretary" : newRole.value;

  const userData = { name: newUserName.value.trim(), username: newUsername.value.trim(), password: newPassword.value.trim(), role: role, active: true };

  if (!execOnly && ["store_manager","cashier","account_supervisor"].includes(role)) {
    const branches = getSelectedNewUserBranches();
    if (!branches.length) { alert("اختر فرع واحد على الأقل لهذا الحساب"); return; }
    userData.managed_branches = JSON.stringify(branches);
  }

  if (!userData.name || !userData.username || !userData.password || !userData.role) { alert("املى كل بيانات المستخدم"); return; }
  const { error } = await supabaseClient.from("user").insert([userData]);
  if (error) { alert("مشكلة في إضافة المستخدم: " + error.message); return; }
  await logActivity('user_management','تم إضافة مستخدم جديد',`الاسم: ${userData.name} | الصلاحية: ${getRoleDisplayName(userData.role)}`);
  userForm.reset(); $("newUserBranchesWrap").classList.add("hidden"); applyUsersFormRoleLock(); await loadUsers(); alert("تم إضافة المستخدم بنجاح" + (execOnly ? " (Secretary)" : ""));
});

function getRoleDisplayName(role) {
  const map = { admin: "Admin", manager: "Operation Manager", operation_manager: "Operation Manager", delivery_manager: "Operation Manager", agent: "Agent", executive_assistant: "Executive Assistant", receptionist: "Secretary", secretary: "Secretary", cashier: "Cashier", store_manager: "Store Manager", account_manager: "Account Manager", account_supervisor: "Account Supervisor" };
  return map[String(role || "").toLowerCase()] || role || "";
}

function renderUsers() {
  if (!users.length) {
    usersTableBody.innerHTML = `<tr><td colspan="6" class="empty">No users found</td></tr>`;
    return;
  }
  usersTableBody.innerHTML = users.map(u => {
    let managedBranchesText = "—";
    if (["store_manager", "cashier", "account_supervisor"].includes(String(u.role || "").toLowerCase())) {
      try {
        const arr = Array.isArray(u.managed_branches) ? u.managed_branches : JSON.parse(u.managed_branches || "[]");
        managedBranchesText = arr.length ? arr.join(", ") : "—";
      } catch (e) { managedBranchesText = "—"; }
    }

    const canManageThisUser = isAdmin();

    const actions = `
        ${canManageThisUser ? `<button class="${u.active === false ? 'success' : 'yellow'}" style="padding:5px 10px;font-size:11px" onclick="toggleUserActive('${u.id}', ${u.active !== false})">${u.active === false ? 'تفعيل' : 'تعطيل'}</button>` : ''}
        ${canManageThisUser ? `<button class="danger" style="padding:5px 10px;font-size:11px" onclick="deleteUser('${u.id}', '${(u.name || '').replace(/'/g, "\\'")}')">حذف</button>` : ''}
        ${isAdmin() ? `<button class="edit" style="padding:5px 10px;font-size:11px" onclick="openEditRoleModal('${u.id}')">✏️ تعديل الصلاحية</button>` : ''}
        ${!canManageThisUser && !isAdmin() ? '<span style="font-size:11px;color:var(--text-muted);">—</span>' : ''}
      `;

    return `
    <tr>
      <td>${u.name || ""}</td>
      <td>${u.username || ""}</td>
      <td>${getRoleDisplayName(u.role)}</td>
      <td style="font-size:12px;">${managedBranchesText}</td>
      <td><span class="chip ${u.active === false ? 'chip-cancelled' : 'chip-confirmed'}">${u.active === false ? "false" : "true"}</span></td>
      <td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${actions}</div></td>
    </tr>
  `;
  }).join("");
}

window.deleteUser = async function (id, name) {
  if (!isAdmin()) { alert("غير مسموح بالحذف"); return; }
  if (currentUser && String(currentUser.id) === String(id)) { alert("لا يمكنك حذف حسابك الخاص!"); return; }
  if (!confirm(`هل أنت متأكد من حذف المستخدم: ${name} ؟\nلن يمكن التراجع عن هذا الإجراء.`)) return;
  const { error } = await supabaseClient.from("user").delete().eq("id", id);
  if (error) { alert("مشكلة في الحذف: " + error.message); return; }
  await logActivity('user_management','تم حذف مستخدم',`المستخدم: ${name}`);
  alert("تم حذف المستخدم بنجاح ✅");
  await loadUsers();
};

window.toggleUserActive = async function (id, currentActive) {
  if (!isAdmin()) { alert("غير مسموح"); return; }
  if (currentUser && String(currentUser.id) === String(id)) { alert("لا يمكنك تعطيل حسابك الخاص!"); return; }
  const newStatus = !currentActive;
  const action = newStatus ? "تفعيل" : "تعطيل";
  if (!confirm(`هل تريد ${action} هذا المستخدم؟`)) return;
  const { error } = await supabaseClient.from("user").update({ active: newStatus }).eq("id", id);
  if (error) { alert("مشكلة في التحديث: " + error.message); return; }
  await logActivity('user_management',`تم ${action} مستخدم`,`User ID: ${id}`);
  alert(`تم ${action} المستخدم بنجاح ✅`);
  await loadUsers();
};

// ===== تعديل صلاحية المستخدم (Admin Only) =====
function onEditRoleChange() {
  const role = $("editRoleSelect").value;
  $("editRoleBranchesWrap").classList.toggle("hidden", !["store_manager","cashier","account_supervisor"].includes(role));
}

window.openEditRoleModal = function (id) {
  if (!isAdmin()) { alert("غير مسموح — هذه الميزة للأدمن فقط"); return; }
  const u = users.find(x => String(x.id) === String(id));
  if (!u) return;

  $("editRoleUserId").value = u.id;
  $("editRoleUserName").textContent = `المستخدم: ${u.name} (${u.username})`;
  $("editRoleSelect").value = String(u.role || "agent").toLowerCase();

  document.querySelectorAll(".edit-role-branch-cb").forEach(cb => cb.checked = false);
  if (["store_manager", "cashier", "account_supervisor"].includes(String(u.role || "").toLowerCase())) {
    try {
      const arr = Array.isArray(u.managed_branches) ? u.managed_branches : JSON.parse(u.managed_branches || "[]");
      document.querySelectorAll(".edit-role-branch-cb").forEach(cb => { cb.checked = arr.includes(cb.value); });
    } catch (e) {}
  }
  onEditRoleChange();

  $("editRoleModal").style.display = "flex";
};

function closeEditRoleModal() {
  $("editRoleModal").style.display = "none";
}

async function saveEditedRole() {
  if (!isAdmin()) { alert("غير مسموح"); return; }
  const id = $("editRoleUserId").value;
  const newRoleVal = $("editRoleSelect").value;

  const updateData = { role: newRoleVal };
  if (["store_manager","cashier","account_supervisor"].includes(newRoleVal)) {
    const branches = Array.from(document.querySelectorAll(".edit-role-branch-cb:checked")).map(cb => cb.value);
    if (!branches.length) { alert("اختر فرع واحد على الأقل لهذا الحساب"); return; }
    updateData.managed_branches = JSON.stringify(branches);
  } else {
    updateData.managed_branches = null;
  }

  const { error } = await supabaseClient.from("user").update(updateData).eq("id", id);
  if (error) { alert("مشكلة في تحديث الصلاحية: " + error.message); return; }

  await logActivity('user_management','تم تعديل صلاحية مستخدم',`User ID: ${id} | الصلاحية الجديدة: ${getRoleDisplayName(newRoleVal)}`);
  closeEditRoleModal();
  alert("✅ تم تحديث صلاحية المستخدم بنجاح");
  await loadUsers();

  if (currentUser && String(currentUser.id) === String(id)) {
    currentUser.role = newRoleVal;
    currentUser.managed_branches = updateData.managed_branches || null;
    sessionStorage.setItem("okb_current_user", JSON.stringify(currentUser));
    setupUserView();
  }
}

// ===== إدارة منتجات OKB (Admin Only) =====
function renderOKBItems() {
  const tbody = $("itemsTableBody");
  if (!tbody) return;

  if (!isAdmin()) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">غير مسموح بعرض المنتجات</td></tr>`;
    return;
  }

  const query = String(document.getElementById('settingItemSearch')?.value || '').trim().toLowerCase();
  const visibleItems = okbItems.filter(item =>
    !query || String(item?.item_name || '').toLowerCase().includes(query)
  );

  if (!visibleItems.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${query ? 'لا توجد منتجات مطابقة للبحث' : 'لا توجد منتجات مضافة'}</td></tr>`;
    renderOKBItemsPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / ITEMS_SETTINGS_PAGE_SIZE));
  itemsSettingsPage = Math.min(Math.max(1, itemsSettingsPage), totalPages);
  const start = (itemsSettingsPage - 1) * ITEMS_SETTINGS_PAGE_SIZE;
  const pageRows = visibleItems.slice(start, start + ITEMS_SETTINGS_PAGE_SIZE);

  tbody.innerHTML = pageRows.map((item, index) => `
    <tr>
      <td>${start + index + 1}</td>
      <td>${escapeHTML(item.item_name || "")}</td>
      <td style="font-weight:800;direction:ltr;">${money(item.price || 0)}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <button class="edit" type="button" style="padding:5px 10px;font-size:11px"
            onclick="editOKBItem('${item.id}')">✏️ تعديل الصنف والسعر</button>
          <button class="danger" type="button" style="padding:5px 10px;font-size:11px"
            onclick="deleteOKBItem('${item.id}')">🗑 حذف</button>
        </div>
      </td>
    </tr>
  `).join("");
  renderOKBItemsPagination(visibleItems.length);
}

function filterOKBItemsSettings() {
  itemsSettingsPage = 1;
  renderOKBItems();
}

function changeOKBItemsSettingsPage(page) {
  itemsSettingsPage = page;
  renderOKBItems();
}

function renderOKBItemsPagination(total) {
  const container = document.getElementById('itemsSettingsPagination');
  if (!container) return;
  if (total <= ITEMS_SETTINGS_PAGE_SIZE) { container.innerHTML = ''; return; }
  const totalPages = Math.ceil(total / ITEMS_SETTINGS_PAGE_SIZE);
  const current = Math.min(Math.max(1, itemsSettingsPage), totalPages);
  let html = `<button onclick="changeOKBItemsSettingsPage(${current - 1})" ${current === 1 ? 'disabled' : ''}>السابق</button>`;
  const first = Math.max(1, current - 2);
  const last = Math.min(totalPages, current + 2);
  if (first > 1) html += `<button onclick="changeOKBItemsSettingsPage(1)">1</button>${first > 2 ? '<span class="pagination-info">...</span>' : ''}`;
  for (let page = first; page <= last; page++) html += `<button class="${page === current ? 'active' : ''}" onclick="changeOKBItemsSettingsPage(${page})">${page}</button>`;
  if (last < totalPages) html += `${last < totalPages - 1 ? '<span class="pagination-info">...</span>' : ''}<button onclick="changeOKBItemsSettingsPage(${totalPages})">${totalPages}</button>`;
  html += `<button onclick="changeOKBItemsSettingsPage(${current + 1})" ${current === totalPages ? 'disabled' : ''}>التالي</button>`;
  html += `<span class="pagination-info">صفحة ${current} من ${totalPages} | إجمالي ${total} منتج</span>`;
  container.innerHTML = html;
}

function resetItemForm() {
  const form = $("itemForm");
  if (form) form.reset();

  const editingId = $("editingItemId");
  const submitBtn = $("itemSubmitBtn");

  if (editingId) editingId.value = "";
  if (submitBtn) submitBtn.textContent = "➕ إضافة صنف";
}

function editOKBItem(id) {
  if (!isAdmin()) {
    alert("غير مسموح");
    return;
  }

  const item = okbItems.find(row => String(row.id) === String(id));
  if (!item) {
    alert("الصنف غير موجود");
    return;
  }

  $("editingItemId").value = item.id;
  $("itemName").value = item.item_name || "";
  $("itemPrice").value = Number(item.price || 0);
  $("itemSubmitBtn").textContent = "✅ حفظ تعديل الصنف والسعر";
  $("itemName").focus();
}

async function deleteOKBItem(id) {
  if (!isAdmin()) {
    alert("غير مسموح");
    return;
  }

  const item = okbItems.find(row => String(row.id) === String(id));
  const itemName = item?.item_name || "هذا الصنف";

  if (!confirm(`هل أنت متأكد من حذف "${itemName}"؟`)) return;

  const { error } = await supabaseClient
    .from("items")
    .delete()
    .eq("id", id);

  if (error) {
    alert("مشكلة في حذف الصنف: " + error.message);
    return;
  }

  resetItemForm();
  await loadOKBItems();
  alert("تم حذف الصنف بنجاح");
}

function exportOKBItems() {
  if (!isAdmin()) {
    alert("غير مسموح");
    return;
  }

  if (!okbItems.length) {
    alert("لا توجد منتجات للتصدير");
    return;
  }

  downloadCSV(
    "okb-items.csv",
    ["#", "اسم الصنف", "السعر", "تاريخ الإضافة", "آخر تحديث"],
    okbItems.map((item, index) => [
      index + 1,
      item.item_name || "",
      Number(item.price || 0),
      item.created_at || "",
      item.updated_at || ""
    ])
  );
}

const itemFormElement = $("itemForm");
if (itemFormElement) {
  itemFormElement.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isAdmin()) {
      alert("إضافة وتعديل المنتجات متاحان للأدمن فقط");
      return;
    }

    const itemName = String($("itemName")?.value || "").trim();
    const itemPrice = Number($("itemPrice")?.value || 0);
    const editingId = String($("editingItemId")?.value || "").trim();
    const submitBtn = $("itemSubmitBtn");

    if (!itemName) {
      alert("اكتب اسم الصنف");
      $("itemName")?.focus();
      return;
    }

    if (!Number.isFinite(itemPrice) || itemPrice < 0) {
      alert("اكتب سعر صحيح");
      $("itemPrice")?.focus();
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = editingId ? "جاري حفظ التعديل..." : "جاري إضافة الصنف...";
    }

    try {
      let result;

      if (editingId) {
        result = await supabaseClient
          .from("items")
          .update({
            item_name: itemName,
            price: itemPrice
          })
          .eq("id", editingId)
          .select();
      } else {
        result = await supabaseClient
          .from("items")
          .insert([{
            item_name: itemName,
            price: itemPrice
          }])
          .select();
      }

      if (result.error) {
        const message = String(result.error.message || "");
        if (message.toLowerCase().includes("duplicate") || message.includes("items_item_name_unique")) {
          alert("اسم الصنف موجود بالفعل. عدّل الصنف الحالي بدل إضافته مرة أخرى.");
        } else {
          alert("مشكلة في حفظ الصنف: " + message);
        }
        return;
      }

      const wasEditing = Boolean(editingId);
      resetItemForm();
      await loadOKBItems();
      alert(wasEditing ? "تم تعديل الصنف والسعر بنجاح" : "تم إضافة الصنف بنجاح");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        if (!$("editingItemId")?.value) submitBtn.textContent = "➕ إضافة صنف";
      }
    }
  });
}

// تُترك هذه الدالة لدعم أي أجزاء قديمة تعتمد على بيانات الفروع.
function renderBranchRank() {
  const tbody = $("branchRankBody");
  if (!tbody) return;
  if (!branchs.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">لا توجد فروع مضافة</td></tr>`;
    renderPagination("branchRankPagination", 0, "branchRank");
    return;
  }
  const page = getPaginatedRows(branchs, "branchRank");
  tbody.innerHTML = page.rows.map((b, i) => `
    <tr>
      <td>${page.start + i + 1}</td>
      <td>${b.name || ""}</td>
      <td>${b.city || ""}</td>
      <td>${b.manager || ""}</td>
      <td>${b.phone || ""}</td>
    </tr>
  `).join("");
  renderPagination("branchRankPagination", branchs.length, "branchRank");
}

// ===== دوال الدكاترة =====
function getDoctorNames() {
  const namesSet = new Set();
  doctorsList.forEach(d => { if (d?.name) namesSet.add(d.name); });
  orders.forEach(o => { if (o?.doctor_name) namesSet.add(o.doctor_name); });
  return Array.from(namesSet).sort((a, b) => a.localeCompare(b, 'ar'));
}

function renderDoctorOptions() {
  if (!doctorName) return;
  const current = doctorName.value;

  doctorName.innerHTML = `<option value="">اختر اسم الدكتور</option>` +
    doctorsList.map(d => {
      const label = d.code ? `${d.name} - ${d.code}` : d.name;
      return `<option value="${d.name}">${label}</option>`;
    }).join("");

  doctorName.value = current;
}

function renderDoctorsSettings() {
  const tbody = $("doctorsSettingsTableBody");
  if (!tbody) return;
  const query = String(document.getElementById('settingDoctorSearch')?.value || '').trim().toLowerCase();
  const visibleDoctors = doctorsList.filter(doctor =>
    !query || String(doctor?.name || '').toLowerCase().includes(query)
  );

  if (!visibleDoctors.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${query ? 'لا توجد نتائج مطابقة للبحث' : 'لا يوجد دكاترة مضافة'}</td></tr>`;
    renderDoctorsSettingsPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(visibleDoctors.length / DOCTORS_PAGE_SIZE));
  if (doctorsSettingsPage > totalPages) doctorsSettingsPage = totalPages;
  if (doctorsSettingsPage < 1) doctorsSettingsPage = 1;

  const start = (doctorsSettingsPage - 1) * DOCTORS_PAGE_SIZE;
  const pageRows = visibleDoctors.slice(start, start + DOCTORS_PAGE_SIZE);

  tbody.innerHTML = pageRows.map((d, i) => `
    <tr>
      <td>${start + i + 1}</td>
      <td>${d.name || ""}</td>
      <td>${d.code || ""}</td>
      <td>${isAdmin() ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><button class="edit" type="button" style="padding:6px 10px;font-size:12px" onclick="editDoctorSettings('${d.id}')">✏️ تعديل</button><button class="danger" type="button" style="padding:6px 10px;font-size:12px" onclick="deleteDoctor('${d.id}')">حذف</button></div>` : '<span style="color:var(--text-muted);font-size:11px">إضافة فقط</span>'}</td>
    </tr>
  `).join("");

  renderDoctorsSettingsPagination(visibleDoctors.length);
}

function filterDoctorsSettings() {
  doctorsSettingsPage = 1;
  renderDoctorsSettings();
}

function exportDoctorsSettings() {
  if (!doctorsList.length) {
    alert('لا توجد بيانات دكاترة للتصدير');
    return;
  }
  downloadCSV(
    'okb-doctors.csv',
    ['اسم الدكتور', 'الكود'],
    doctorsList.map(doctor => [doctor.name || '', doctor.code || ''])
  );
}

function renderDoctorsSettingsPagination(total) {
  let container = document.getElementById("doctorsSettingsPagination");

  // لو الـ container مش موجود، نعمله تلقائياً تحت الجدول
  if (!container) {
    const tbody = document.getElementById("doctorsSettingsTableBody");
    const table = tbody ? tbody.closest("table") : null;
    if (table) {
      container = document.createElement("div");
      container.id = "doctorsSettingsPagination";
      container.className = "pagination";
      container.style.cssText = "display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:14px 0;";
      table.parentNode.insertBefore(container, table.nextSibling);
    }
  }
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(total / DOCTORS_PAGE_SIZE));
  if (total <= DOCTORS_PAGE_SIZE) { container.innerHTML = ""; return; }

  const current = doctorsSettingsPage;
  let html = "";
  html += `<button onclick="changeDoctorsSettingsPage(${current - 1})" ${current === 1 ? "disabled" : ""}>السابق</button>`;

  const startPage = Math.max(1, current - 2);
  const endPage = Math.min(totalPages, current + 2);
  if (startPage > 1) {
    html += `<button onclick="changeDoctorsSettingsPage(1)">1</button>`;
    if (startPage > 2) html += `<span class="pagination-info">...</span>`;
  }
  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="${p === current ? "active" : ""}" onclick="changeDoctorsSettingsPage(${p})">${p}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="pagination-info">...</span>`;
    html += `<button onclick="changeDoctorsSettingsPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button onclick="changeDoctorsSettingsPage(${current + 1})" ${current === totalPages ? "disabled" : ""}>التالي</button>`;
  html += `<span class="pagination-info" style="align-self:center;font-size:12px;color:var(--text-muted);">صفحة ${current} من ${totalPages} | إجمالي ${total} دكتور</span>`;

  container.innerHTML = html;
}

function changeDoctorsSettingsPage(page) {
  doctorsSettingsPage = page;
  renderDoctorsSettings();
}

function resetDoctorSettingsForm() {
  document.getElementById('doctorSettingsForm')?.reset();
  const editingId = document.getElementById('editingDoctorId');
  const submitBtn = document.getElementById('doctorSettingsSubmitBtn');
  if (editingId) editingId.value = '';
  if (submitBtn) submitBtn.textContent = '➕ إضافة دكتور';
}

function editDoctorSettings(id) {
  if (!isAdmin()) { alert('تعديل بيانات الدكتور متاح للأدمن فقط'); return; }
  const doctor = doctorsList.find(row => String(row.id) === String(id));
  if (!doctor) { alert('بيانات الدكتور غير موجودة'); return; }
  document.getElementById('editingDoctorId').value = doctor.id;
  document.getElementById('settingDoctorName').value = doctor.name || '';
  document.getElementById('settingCodeDoctor').value = doctor.code || '';
  document.getElementById('doctorSettingsSubmitBtn').textContent = '✅ حفظ تعديل الدكتور';
  document.getElementById('settingDoctorName').focus();
}

$("doctorSettingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin() && !isExecutiveAssistant()) { alert("غير مسموح"); return; }
  const name = $("settingDoctorName").value.trim();
  const code = $("settingCodeDoctor").value.trim();
  const editingId = String(document.getElementById('editingDoctorId')?.value || '').trim();
  if (editingId && !isAdmin()) { alert('تعديل بيانات الدكتور متاح للأدمن فقط'); return; }
  if (!name) { alert("اكتب اسم الدكتور"); return; }

  const payload = { name, code: code || null };
  const result = editingId
    ? await supabaseClient.from("doctors").update(payload).eq('id', editingId).select().single()
    : await supabaseClient.from("doctors").insert([payload]).select().single();
  if (result.error) { alert((editingId ? "مشكلة في تعديل الدكتور: " : "مشكلة في إضافة الدكتور: ") + result.error.message); return; }

  await logActivity(
    'user_management',
    editingId ? 'تعديل بيانات دكتور' : 'إضافة دكتور جديد',
    `${editingId ? 'تم تعديل' : 'تمت إضافة'} الدكتور: ${name}${code ? ` | الكود: ${code}` : ''} | بواسطة: ${currentUser?.name || currentUser?.username || 'User'}`,
    { branch_name: 'Settings / Doctors' }
  );

  resetDoctorSettingsForm();
  await loadDoctors();
  alert(editingId ? "تم تعديل بيانات الدكتور بنجاح" : "تم إضافة الدكتور بنجاح");
});

window.deleteDoctor = async function (id) {
  if (!isAdmin()) { alert("غير مسموح"); return; }
  const doctor = doctorsList.find(row => String(row.id) === String(id));
  if (!confirm("هل أنت متأكد من حذف هذا الدكتور؟")) return;
  const { error } = await supabaseClient.from("doctors").delete().eq("id", id);
  if (error) { alert("مشكلة في الحذف: " + error.message); return; }
  await logActivity('user_management','حذف دكتور',`تم حذف الدكتور: ${doctor?.name || id}${doctor?.code ? ` | الكود: ${doctor.code}` : ''}`,{ branch_name:'Settings / Doctors' });
  if (String(document.getElementById('editingDoctorId')?.value || '') === String(id)) resetDoctorSettingsForm();
  await loadDoctors();
};

// ===== دوال شركات الشحن =====
function getShippingCompanyNames() {
  const fromSettings = shippingSystems.map(s => s.company_name).filter(Boolean);
  const fromOrders = orders.map(o => o.shipping_company).filter(Boolean);
  const fallback = ["J & T", "Y F S", "P D C"];
  return [...new Set([...fromSettings, ...fromOrders, ...fallback])].sort((a, b) => a.localeCompare(b, 'en'));
}

function renderShippingOptions() {
  if (!shippingCompany) return;
  const current = shippingCompany.value;
  const names = getShippingCompanyNames();
  shippingCompany.innerHTML = `<option value="">اختر شركة الشحن</option>` + names.map(name => `<option value="${name}">${name}</option>`).join("");
  if (names.includes(current)) shippingCompany.value = current;
}

function renderShippingSettings() {
  const tbody = $("shippingSettingsTableBody");
  if (!tbody) return;
  if (!shippingSystems.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty">لا توجد شركات شحن مضافة</td></tr>`; return; }
  tbody.innerHTML = shippingSystems.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${s.company_name || ""}</td>
      <td>${s.city || ""}</td>
      <td>${s.manager || ""}</td>
      <td>${s.phone || ""}</td>
      <td><button class="danger" style="padding:6px 10px;font-size:12px" onclick="deleteShippingSystem('${s.id}')">حذف</button></td>
    </tr>
  `).join("");
}

$("shippingSettingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin()) { alert("غير مسموح"); return; }
  const payload = { company_name: $("shippingCompanyName").value.trim(), city: $("shippingCity").value.trim(), manager: $("shippingManager").value.trim(), phone: $("shippingPhone").value.trim() };
  if (!payload.company_name || !payload.city || !payload.manager || !payload.phone) { alert("من فضلك املى كل البيانات"); return; }
  const { error } = await supabaseClient.from("shipping_system").insert([payload]);
  if (error) { alert("مشكلة في إضافة شركة الشحن: " + error.message); return; }
  $("shippingSettingsForm").reset();
  await loadShippingSystems();
});

window.deleteShippingSystem = async function (id) {
  if (!isAdmin()) { alert("غير مسموح"); return; }
  if (!confirm("هل أنت متأكد من حذف شركة الشحن؟")) return;
  const { error } = await supabaseClient.from("shipping_system").delete().eq("id", id);
  if (error) { alert("مشكلة في الحذف: " + error.message); return; }
  await loadShippingSystems();
};

// ===== دوال التقارير =====
let reportMode = "daily";

function dateToStr(d) { return d.toISOString().split("T")[0]; }

function setReportMode(mode) {
  reportMode = mode;
  const today = new Date();
  let from = new Date(today);
  let to = new Date(today);

  if (mode === "daily") { from = new Date(today); to = new Date(today); }
  if (mode === "weekly") { from = new Date(today); from.setDate(today.getDate() - 6); to = new Date(today); }
  if (mode === "monthly") { from = new Date(today.getFullYear(), today.getMonth(), 1); to = new Date(today); }

  $("reportFromDate").value = dateToStr(from);
  $("reportToDate").value = dateToStr(to);
  updateReportTabs();
  renderReport();
}

function updateReportTabs() {
  ["daily", "weekly", "monthly"].forEach(m => {
    const btn = $(`${m}ReportBtn`);
    if (btn) btn.classList.toggle("active", reportMode === m);
  });
}

function applyReportFilter() {
  const from = $("reportFromDate").value;
  const to = $("reportToDate").value;
  if (!from || !to) { alert("اختار تاريخ من وإلى"); return; }
  if (from > to) { alert("تاريخ من لازم يكون قبل أو يساوي تاريخ إلى"); return; }
  renderReport();
}

function resetReportFilter() { setReportMode(reportMode); }
async function refreshCurrentReport(ev) {
  const btn=ev?.currentTarget||document.getElementById('refreshCurrentReportBtn');
  const old=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.innerHTML='جاري التحديث...';}
  try {
    await loadOrders();
    renderReport();
  } finally {
    if(btn){btn.disabled=false;btn.innerHTML=old||'↻ Refresh';}
  }
}

function getReportOrders() {
  const from = $("reportFromDate").value;
  const to = $("reportToDate").value;
  if (!from || !to) return [];
  return orders.filter(o => {
    const raw = o.created_at;
    if (!raw) return false;
    const d = raw.split("T")[0];
    return d >= from && d <= to;
  });
}

function countByDoctor(list, statusType) {
  const map = {};
  list.forEach(o => {
    if (!o.doctor_name) return;
    let match = false;
    if (statusType === "returned") match = o.status === "Returned";
    if (statusType === "fakeDoctor") match = isFakeDoctorOrder(o);
    if (statusType === "fakeDelivery") match = isFakeDeliveryUpdateOrder(o);
    if (!match) return;
    map[o.doctor_name] = (map[o.doctor_name] || 0) + 1;
  });
  return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function getAllShippingRanked(list) {
  const map = {};
  list.forEach(o => {
    if (!o.shipping_company) return;
    if (!map[o.shipping_company]) map[o.shipping_company] = { total: 0, returned: 0, fakeDelivery: 0, problems: 0 };
    map[o.shipping_company].total++;
    if (o.status === "Returned") { map[o.shipping_company].returned++; map[o.shipping_company].problems++; }
    if (isFakeDeliveryUpdateOrder(o)) { map[o.shipping_company].fakeDelivery++; map[o.shipping_company].problems++; }
  });
  return Object.entries(map)
    .map(([name, d]) => ({ name, total: d.total, returned: d.returned, fakeDelivery: d.fakeDelivery, rate: d.total ? (d.problems / d.total) * 100 : 0 }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.rate - a.rate);
}

function getWorstShipping(list) {
  const map = {};
  list.forEach(o => {
    if (!o.shipping_company) return;
    if (!map[o.shipping_company]) { map[o.shipping_company] = { total: 0, returned: 0, fakeDelivery: 0, problems: 0 }; }
    map[o.shipping_company].total++;
    if (o.status === "Returned") { map[o.shipping_company].returned++; map[o.shipping_company].problems++; }
    if (isFakeDeliveryUpdateOrder(o)) { map[o.shipping_company].fakeDelivery++; map[o.shipping_company].problems++; }
  });
  return Object.entries(map)
    .map(([name, d]) => ({ name, total: d.total, returned: d.returned, fakeDelivery: d.fakeDelivery, problems: d.problems, rate: d.total ? (d.problems / d.total) * 100 : 0 }))
    .filter(x => x.total > 0)
    .sort((a, b) => b.rate - a.rate || b.problems - a.problems)[0];
}

function getWorstThreeShipping(list) {
  const allShipping = getAllShippingRanked(list);
  return allShipping.slice(0, 3);
}

function renderDoctorList(containerId, rows, limit) {
  const container = $(containerId);
  const sliced = rows.slice(0, limit);
  if (!sliced.length) {
    container.innerHTML = `<div class="empty" style="padding:12px">لا توجد بيانات</div>`;
    return;
  }
  container.innerHTML = sliced.map((r, i) => `
    <div class="report-item">
      <span class="report-name">${i + 1}. ${r.name}</span>
      <span class="report-value">${num(r.count)}</span>
    </div>
  `).join("");
}

function renderReport() {
  const from = $("reportFromDate").value;
  const to = $("reportToDate").value;
  if (!from || !to) { setReportMode("daily"); return; }

  const list = getReportOrders();
  const limit = reportMode === "daily" ? 1 : reportMode === "weekly" ? 5 : 10;
  const title = reportMode === "daily" ? "Daily Report" : reportMode === "weekly" ? "Weekly Report" : "Monthly Report";

  $("reportTitle").textContent = title;
  $("reportRangeText").textContent = `الفترة: ${from} → ${to}`;

  $("reportTotalOrders").textContent = num(list.length);
  $("reportReturned").textContent = num(list.filter(o => o.status === "Returned").length);
  $("reportFakeDoctor").textContent = num(list.filter(o => isFakeDoctorOrder(o)).length);
  $("reportFakeDelivery").textContent = num(list.filter(o => isFakeDeliveryUpdateOrder(o)).length);
  const branchCounts={ 'nasr-city':0,alexandria:0,mansoura:0,tanta:0 };
  list.forEach(order=>{
    const branch=getProductReportOrderBranch(order);
    if(Object.prototype.hasOwnProperty.call(branchCounts,branch)) branchCounts[branch]++;
  });
  $("reportNasrCity").textContent=num(branchCounts['nasr-city']);
  $("reportAlexandria").textContent=num(branchCounts.alexandria);
  $("reportMansoura").textContent=num(branchCounts.mansoura);
  $("reportTanta").textContent=num(branchCounts.tanta);

  const worstShipping = getWorstShipping(list);
  if (worstShipping) {
    $("reportWorstShipping").innerHTML = `
      <div class="report-item">
        <span class="report-name">${worstShipping.name}</span>
        <span class="report-value">${worstShipping.rate.toFixed(1)}%</span>
      </div>
      <div style="color:#64748B;font-size:13px;margin-top:8px">
        Returned: ${num(worstShipping.returned)} | Fake Delivery: ${num(worstShipping.fakeDelivery)} | Total: ${num(worstShipping.total)}
      </div>
    `;
  } else {
    $("reportWorstShipping").innerHTML = `<div class="empty" style="padding:12px">لا توجد بيانات</div>`;
  }

  const worst3Container = $("reportWorst3Shipping");
  if (reportMode === "monthly" && worst3Container) {
    worst3Container.style.display = "block";
    const worstThree = getWorstThreeShipping(list);
    $("reportWorst3ShippingList").innerHTML = worstThree.length
      ? worstThree.map((s, i) => `
          <div class="report-item" style="margin-bottom:10px;padding:10px;background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0">
            <span class="report-name" style="font-size:15px">${i + 1}. ${s.name}</span>
            <span class="report-value" style="color:${i === 0 ? '#EF4444' : i === 1 ? '#F97316' : '#F59E0B'}">${s.rate.toFixed(1)}%</span>
            <div style="color:#64748B;font-size:12px;margin-top:4px">
              Returned: ${num(s.returned)} | Fake: ${num(s.fakeDelivery)} | Total: ${num(s.total)}
            </div>
          </div>`).join("")
      : `<div style="color:#94A3B8;padding:12px;text-align:center">لا توجد بيانات كافية</div>`;
  } else if (worst3Container) {
    worst3Container.style.display = "none";
  }

  const returnedDoctors = countByDoctor(list, "returned");
  const fakeDoctors = countByDoctor(list, "fakeDoctor");

  $("returnedDoctorsTitle").textContent = reportMode === "daily" ? "أكتر دكتور راجع له أوردرات في اليوم" : reportMode === "weekly" ? "أكتر 5 دكاترة راجع لهم أوردرات في الأسبوع" : "أكتر 10 دكاترة راجع لهم أوردرات في الشهر";
  $("fakeDoctorsTitle").textContent = reportMode === "daily" ? "أكتر دكتور عامل Fake Doctor في اليوم" : reportMode === "weekly" ? "أكتر 5 دكاترة عاملين Fake Doctor في الأسبوع" : "أكتر 10 دكاترة عاملين Fake Doctor في الشهر";

  renderDoctorList("reportTopReturnedDoctors", returnedDoctors, limit);
  renderDoctorList("reportTopFakeDoctors", fakeDoctors, limit);

  const topReturned = returnedDoctors[0];
  const topFake = fakeDoctors[0];

  const shipFakeDeliveryMap = {};
  list.forEach(o => {
    if (!o.shipping_company || !isFakeDeliveryUpdateOrder(o)) return;
    shipFakeDeliveryMap[o.shipping_company] = (shipFakeDeliveryMap[o.shipping_company] || 0) + 1;
  });
  const topFakeDeliveryShip = Object.entries(shipFakeDeliveryMap).sort((a, b) => b[1] - a[1])[0];

  $("reportDecisionSummary").innerHTML = `
    <div class="report-item">
      <span class="report-name">أسوأ شركة شحن</span>
      <span class="report-value">${worstShipping ? worstShipping.name : "—"}</span>
    </div>
    <div class="report-item">
      <span class="report-name">أعلى Returned Doctor</span>
      <span class="report-value">${topReturned ? topReturned.name : "—"} (${topReturned ? num(topReturned.count) : "0"})</span>
    </div>
    <div class="report-item">
      <span class="report-name">أعلى Fake Doctor</span>
      <span class="report-value">${topFake ? topFake.name : "—"} (${topFake ? num(topFake.count) : "0"})</span>
    </div>
    <div class="report-item">
      <span class="report-name">أعلى Fake Delivery</span>
      <span class="report-value">${topFakeDeliveryShip ? `${topFakeDeliveryShip[0]} (${topFakeDeliveryShip[1]})` : "—"}</span>
    </div>
  `;
}

function exportCurrentReport() {
  const from = $("reportFromDate").value;
  const to = $("reportToDate").value;
  const list = getReportOrders();
  if (!list.length) { alert("لا توجد بيانات للتصدير"); return; }

  const limit = reportMode === "daily" ? 1 : reportMode === "weekly" ? 5 : 10;
  const title = reportMode === "daily" ? "daily" : reportMode === "weekly" ? "weekly" : "monthly";

  const worstShipping = getWorstShipping(list);
  const returnedDoctors = countByDoctor(list, "returned").slice(0, limit);
  const fakeDoctors = countByDoctor(list, "fakeDoctor").slice(0, limit);

  const rows = [
    ["Report Type", title],
    ["From", from], ["To", to],
    ["Total Orders", list.length],
    ["Total Returned", list.filter(o => o.status === "Returned").length],
    ["Total Fake Doctor", list.filter(o => isFakeDoctorOrder(o)).length],
    ["Total Fake Delivery Update", list.filter(o => isFakeDeliveryUpdateOrder(o)).length],
    ["Worst Shipping", worstShipping ? `${worstShipping.name} (${worstShipping.rate.toFixed(1)}%)` : "—"],
    ["", ""],
    ["Top Returned Doctors", ""],
    ...returnedDoctors.map((x, i) => [`${i + 1}. ${x.name}`, x.count]),
    ["", ""],
    ["Top Fake Doctor Doctors", ""],
    ...fakeDoctors.map((x, i) => [`${i + 1}. ${x.name}`, x.count])
  ];
  downloadCSV(`${title}-report-${from}-to-${to}.csv`, ["Metric", "Value"], rows);
}

// ===== دوال استيراد Excel =====
let excelDataRows = [];
let excelHeaderColumns = [];

const systemRequiredFields = [
  { id: "map_customerName", label: "اسم العميل 👤", dbField: "customer_name", allowStatic: false },
  { id: "map_phone", label: "رقم الموبايل 📱", dbField: "phone", allowStatic: false },
  { id: "map_area", label: "المنطقة / المحافظة 📍", dbField: "area", allowStatic: false },
  { id: "map_price", label: "السعر / المبلغ 💰", dbField: "price", allowStatic: false },
  { id: "map_deposit", label: "المدفوع مقدمًا 💵 (ديبوزيت)", dbField: "deposit", allowStatic: false, optional: true },
  { id: "map_paymentImage", label: "📎 رابط صورة إثبات الدفع (اختياري)", dbField: "payment_image", allowStatic: false, optional: true },
  { id: "map_doctorName", label: "اسم الدكتور 👨‍⚕️", dbField: "doctor_name", allowStatic: false },
  { id: "map_doctorCode", label: "كود الدكتور 🔤 (اختياري)", dbField: "doctor_code", allowStatic: false, optional: true },
  { id: "map_shippingCompany", label: "شركة الشحن 🚚", dbField: "shipping_company", allowStatic: true, type: "shipping" },
  { id: "map_employeeName", label: "اسم الموظف 💼", dbField: "employee_name", allowStatic: true, type: "employee" },
  { id: "map_status", label: "حالة الأوردر 📊", dbField: "status", allowStatic: false },
  { id: "map_orderNotes", label: "ملاحظات (اختياري) 📝", dbField: "notes", allowStatic: false }
];

function openImportModal() {
  document.getElementById("importModal").style.display = "flex";
  document.getElementById("importStep1").classList.remove("hidden");
  document.getElementById("importStep2").classList.add("hidden");
  document.getElementById("excelFileInput").value = "";
  excelDataRows = [];
  excelHeaderColumns = [];
  document.getElementById("importProgressText").textContent = "";
  document.getElementById("startImportBtn").disabled = false;
}

function closeImportModal() {
  document.getElementById("importModal").style.display = "none";
}

function processExcelFile() {
  const fileInput = document.getElementById("excelFileInput");
  if (!fileInput.files || fileInput.files.length === 0) {
    alert("برجاء اختيار ملف اكسيل أولاً!");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      if (jsonData.length === 0) {
        alert("ملف الاكسيل فارغ ولا يحتوي على بيانات!");
        return;
      }

      excelDataRows = jsonData;
      excelHeaderColumns = Object.keys(jsonData[0]);

      buildMappingInterface();

      document.getElementById("importStep1").classList.add("hidden");
      document.getElementById("importStep2").classList.remove("hidden");
      document.getElementById("importSummaryText").textContent = `تم قراءة الملف بنجاح! يحتوي الملف على (${excelDataRows.length}) صف جاهز للمطابقة.`;

    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء قراءة ملف الاكسيل، تأكد من سلامة صيغة الملف.");
    }
  };

  reader.readAsArrayBuffer(file);
}

function buildMappingInterface() {
  const container = document.getElementById("mappingFieldsContainer");
  container.innerHTML = "";

  const originalShippingSelect = document.getElementById("shippingCompany");
  let shippingOptions = [];
  if (originalShippingSelect) {
    for (let i = 0; i < originalShippingSelect.options.length; i++) {
      const val = originalShippingSelect.options[i].value;
      if (val) shippingOptions.push(val);
    }
  }

  let employeeOptions = [];
  if (typeof users !== "undefined" && users.length > 0) {
    employeeOptions = users.map(u => u.name).filter(Boolean);
  } else if (currentUser) {
    employeeOptions = [currentUser.name];
  }

  systemRequiredFields.forEach(field => {
    let excelColsHtml = `<option value="">-- اختر عمود من الملف --</option>`;
    let guessedValue = "";

    excelHeaderColumns.forEach(col => {
      const lowerCol = col.toLowerCase().trim();
      const cleanCol = col.trim();
      excelColsHtml += `<option value="${col}">${col}</option>`;

      if (field.dbField === "customer_name" && (lowerCol.includes("name") || cleanCol.includes("الاسم") || cleanCol.includes("عميل") || cleanCol.includes("المستلم"))) guessedValue = col;
      if (field.dbField === "phone" && (lowerCol.includes("phone") || lowerCol.includes("mobile") || lowerCol.includes("tel") || cleanCol.includes("هاتف") || cleanCol.includes("موبايل") || cleanCol.includes("تليفون"))) guessedValue = col;
      if (field.dbField === "area" && (lowerCol.includes("area") || lowerCol.includes("city") || lowerCol.includes("gov") || cleanCol.includes("منطقة") || cleanCol.includes("محافظة") || cleanCol.includes("عنوان") || cleanCol.includes("المدينة"))) guessedValue = col;
      if (field.dbField === "price" && (lowerCol.includes("price") || lowerCol.includes("amount") || lowerCol.includes("total") || cleanCol.includes("سعر") || cleanCol.includes("مبلغ") || cleanCol.includes("قيمة") || cleanCol.includes("إجمالي"))) guessedValue = col;
      if (field.dbField === "deposit" && (lowerCol.includes("deposit") || lowerCol.includes("paid") || lowerCol.includes("advance") || lowerCol.includes("مدفوع") || lowerCol.includes("ديبوزيت"))) guessedValue = col;
      if (field.dbField === "payment_image" && (lowerCol.includes("image") || lowerCol.includes("url") || lowerCol.includes("link") || lowerCol.includes("photo") || lowerCol.includes("صورة") || lowerCol.includes("رابط"))) guessedValue = col;
      if (field.dbField === "doctor_name" && (lowerCol.includes("doctor") || cleanCol.includes("دكتور") || cleanCol.includes("طبيب"))) guessedValue = col;
      if (field.dbField === "doctor_code" && (lowerCol.includes("code") || lowerCol.includes("ref") || cleanCol.includes("كود"))) guessedValue = col;
      if (field.dbField === "shipping_company" && (lowerCol.includes("shipping") || lowerCol.includes("company") || cleanCol.includes("شحن") || cleanCol.includes("شركة"))) guessedValue = col;
      if (field.dbField === "employee_name" && (lowerCol.includes("employee") || lowerCol.includes("agent") || lowerCol.includes("user") || cleanCol.includes("موظف") || cleanCol.includes("مدخل"))) guessedValue = col;
      if (field.dbField === "status" && (lowerCol.includes("status") || cleanCol.includes("حالة") || cleanCol.includes("الحالة"))) guessedValue = col;
      if (field.dbField === "notes" && (lowerCol.includes("note") || lowerCol.includes("comment") || cleanCol.includes("ملاحظات") || cleanCol.includes("تفاصيل"))) guessedValue = col;
    });

    let rowHtml = "";

    if (field.allowStatic) {
      let staticOptionsHtml = `<option value="">-- اختر قيمة ثابتة مانيوال من السيستم --</option>`;
      const targetOptions = field.type === "shipping" ? shippingOptions : employeeOptions;

      targetOptions.forEach(opt => {
        staticOptionsHtml += `<option value="${opt}">${opt}</option>`;
      });

      rowHtml = `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgb(0 0 0 / 8%); padding: 12px; border-radius:14px; margin-bottom:4px;">
          <label style="font-size:13px; font-weight:bold; color:#facc15; display:block; margin-bottom:8px;">${field.label}</label>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div>
              <span style="font-size:11px; color:#9fb0d6; display:block; margin-bottom:4px;">الخيار 1: اسحب من عمود الإكسيل</span>
              <select id="${field.id}" onchange="toggleImportFieldMode('${field.id}', 'excel')" style="padding:10px; font-size:13px; background:#003a6c; color:white; border-radius:10px; border:1px solid rgba(255,255,255,0.1); width:100%;">${excelColsHtml}</select>
            </div>
            <div>
              <span style="font-size:11px; color:#9fb0d6; display:block; margin-bottom:4px;">الخيار 2: قيمة ثابتة لكل الشيت مانيوال</span>
              <select id="${field.id}_static" onchange="toggleImportFieldMode('${field.id}', 'static')" style="padding:10px; font-size:13px; background:#003a6c; color:white; border-radius:10px; border:1px solid rgba(255,255,255,0.1); width:100%;">${staticOptionsHtml}</select>
            </div>
          </div>
        </div>
      `;
    } else {
      rowHtml = `
        <div style="display:grid; grid-template-columns: 200px 1fr; align-items:center; background: rgba(255,255,255,0.01); padding: 8px 12px; border-radius:10px; border: 1px solid rgb(6 0 0 / 5%);">
          <label style="font-size:13px; font-weight:bold; color:#0d9488;">${field.label}</label>
          <select id="${field.id}" style="padding:10px; font-size:13px; background:#003a6c; color:white; border-radius:10px; border:1px solid rgba(255,255,255,0.1); width:100%;">${excelColsHtml}</select>
        </div>
      `;
    }

    container.insertAdjacentHTML('beforeend', rowHtml);

    if (guessedValue) {
      document.getElementById(field.id).value = guessedValue;
    }
  });
}

function toggleImportFieldMode(fieldId, mode) {
  if (mode === 'excel') {
    const staticEl = document.getElementById(fieldId + "_static");
    if (staticEl) staticEl.value = "";
  } else if (mode === 'static') {
    const excelEl = document.getElementById(fieldId);
    if (excelEl) excelEl.value = "";
  }
}

async function executeBulkImport() {
  const mapping = {};
  const staticValues = {};
  let missingRequired = false;

  systemRequiredFields.forEach(field => {
    const excelVal = document.getElementById(field.id).value;
    const staticEl = document.getElementById(field.id + "_static");
    const staticVal = staticEl ? staticEl.value : "";

    if (field.allowStatic) {
      if (!excelVal && !staticVal) {
        missingRequired = true;
      }
      mapping[field.dbField] = excelVal; 
      staticValues[field.dbField] = staticVal; 
    } else {
if (!excelVal && !field.optional && field.dbField !== "notes" && field.dbField !== "payment_image") {
        missingRequired = true;
      }
      mapping[field.dbField] = excelVal;
    }
  });

  if (missingRequired) {
    alert("يرجى اختيار عمود الإكسيل أو تحديد القيمة الثابتة لكل حقل أساسي قبل الرفع!");
    return;
  }

  if (!confirm(`هل أنت متأكد من رغبتك في استيراد ${excelDataRows.length} أوردر إلى النظام الآن؟`)) {
    return;
  }

  document.getElementById("startImportBtn").disabled = true;
  const progressDiv = document.getElementById("importProgressText");
  progressDiv.textContent = "جاري تحضير البيانات ومعالجة الأوردرات...";

  const ordersToInsert = [];
  const doctorsMap = new Map();

  for (const row of excelDataRows) {
    let pVal = Number(String(row[mapping["price"]] || "").replace(/[^0-9.]/g, '')) || 0; 
    const depositVal = mapping["deposit"] ? (Number(String(row[mapping["deposit"]] || "").replace(/[^0-9.]/g, '')) || 0) : 0;
    
    let paymentImageUrl = "";
    if (mapping["payment_image"]) {
      paymentImageUrl = String(row[mapping["payment_image"]] || "").trim();
      if (paymentImageUrl && !paymentImageUrl.startsWith("http")) {
        paymentImageUrl = ""; 
      }
    }
    
    let rawStatus = String(row[mapping["status"]] || "").trim();
    let finalStatus = "Transit";
    
    const lowerStatus = rawStatus.toLowerCase();
    
    if (lowerStatus.includes("signed")) {
      finalStatus = "Signed";
    }
    else if (lowerStatus.includes("transit")) {
      finalStatus = "Transit";
    }
    else if (lowerStatus.includes("returned") || lowerStatus.includes("return")) {
      finalStatus = "Returned";
    }
    else if (lowerStatus.includes("fake doctor") || rawStatus.includes("فيك دكتور")) {
      finalStatus = "Fake Doctor";
    }
    else if (lowerStatus.includes("fake delivery") || rawStatus.includes("فيك شحن")) {
      finalStatus = "Fake Delivery Update";
    }
    else if (lowerStatus.includes("picked-up") || lowerStatus.includes("picked up")) {
      finalStatus = "Picked-up";
    }
    else if (lowerStatus.includes("delivering")) {
      finalStatus = "Delivering";
    }
    else if (lowerStatus.includes("returning")) {
      finalStatus = "Returning";
    }
    else if (rawStatus.includes("تأكيد") || rawStatus.includes("مؤكد") || lowerStatus.includes("confirm")) {
      finalStatus = "تم التأكيد";
    }
    else if (rawStatus.includes("ملغي") || lowerStatus.includes("cancel")) {
      finalStatus = "ملغي";
    }

    let finalEmployee = staticValues["employee_name"] ? staticValues["employee_name"] : String(row[mapping["employee_name"]] || "").trim();
    if (!finalEmployee) finalEmployee = (currentUser ? currentUser.name : "System Import");

    let finalShipping = staticValues["shipping_company"] ? staticValues["shipping_company"] : String(row[mapping["shipping_company"]] || "").trim();
    const doctorInfo = extractDoctorInfo(
    mapping["doctor_name"]
        ? row[mapping["doctor_name"]]
        : ""
      );

    const doctorCode =
    mapping["doctor_code"]
        ? extractDoctorCodeFromText(row[mapping["doctor_code"]])
        : doctorInfo.doctorCode;
    const orderObj = {
      employee_name: finalEmployee,
      doctor_name: doctorInfo.doctorName,
      doctor_code: doctorCode,
      customer_name: String(row[mapping["customer_name"]] || "").trim(),
      phone: String(row[mapping["phone"]] || "").trim(),
      shipping_company: finalShipping,
      area: String(row[mapping["area"]] || "").trim(),
      price: pVal,
      deposit: depositVal,
      payment_image: paymentImageUrl,
      status: finalStatus,
      fake_doctor: finalStatus === "Fake Doctor",
      notes: mapping["notes"] ? String(row[mapping["notes"]] || "").trim() : "",
      ...(await reserveNextOrderIdentifiers())
    };
    
    console.log("📦 Final Order Object:", orderObj);
    ordersToInsert.push(orderObj);
    if (doctorCode) {
    doctorsMap.set(doctorCode, {
        name: doctorInfo.doctorName,
        code: doctorCode,
        active: true
    });
}
  }
  const BATCH_SIZE = 50; 
  let successCount = 0;
  let hasError = false;

  for (let i = 0; i < ordersToInsert.length; i += BATCH_SIZE) {
    const chunk = ordersToInsert.slice(i, i + BATCH_SIZE);
    progressDiv.textContent = `جاري رفع الدفعة: من ${i} إلى ${Math.min(i + BATCH_SIZE, ordersToInsert.length)} من أصل ${ordersToInsert.length}...`;

    const { data, error } = await supabaseClient.from("orders").insert(chunk).select();
    
    if (error) {
      console.error("❌ Batch Import Error:", error);
      hasError = true;
      alert(`حدث خطأ أثناء رفع الدفعة: ${error.message}`);
      break;
    } else {
      console.log("✅ Inserted batch:", data);
      successCount += chunk.length;
    }
  }

  if (!hasError) {
    try {

    const { data: existingDoctors } = await supabaseClient
        .from("doctors")
        .select("code");

    const existingCodes = new Set(
        (existingDoctors || []).map(d => d.code)
    );

    const newDoctors = [];

    doctorsMap.forEach(doc => {

        if (!existingCodes.has(doc.code)) {
            newDoctors.push(doc);
        }

    });

    if (newDoctors.length > 0) {

        const { error } = await supabaseClient
            .from("doctors")
            .insert(newDoctors);

        if (error) {
            console.error("Doctors Import Error:", error);
        } else {
            console.log(`✅ Added ${newDoctors.length} new doctors`);
        }

    }

} catch (err) {

    console.error(err);

}
    progressDiv.innerHTML = `<span style="color:#86efac;">✅ تم استيراد وإدخال ${successCount} أوردر بنجاح!</span>`;
    alert(`رائع! تم إدخال عدد ${successCount} أوردر بنجاح تام إلى قاعدة البيانات.`);
    closeImportModal();
    
    if (typeof loadOrders === "function") {
      await loadOrders();
    }
  } else {
    document.getElementById("startImportBtn").disabled = false;
    progressDiv.textContent = "توقف الاستيراد بسبب خطأ، يرجى مراجعة البيانات.";
  }
}

// ===== مستمعي الأحداث =====
searchInput.addEventListener("input", () => { pageState.orders = 1; renderOrders(); });
searchInput.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  const scannedValue = String(searchInput.value || "").trim();
  if (scannedValue) openCollectionFromScan(scannedValue, "branch");
});
filterStatus.addEventListener("change", () => { pageState.orders = 1; renderOrders(); });
filterEmployee.addEventListener("change", () => { pageState.orders = 1; renderOrders(); });
const filterShippingCompanyEl = document.getElementById("filterShippingCompany");
if (filterShippingCompanyEl) filterShippingCompanyEl.addEventListener("change", () => { pageState.orders = 1; renderOrders(); });
exportBtn.addEventListener("click", exportData);
const shippingRankSearchEl = document.getElementById("shippingRankSearch");
if (shippingRankSearchEl) shippingRankSearchEl.addEventListener("input", () => { pageState.shippingRank = 1; renderShippingRank(); renderShippingCharts(); });
if (doctorRankSearch) doctorRankSearch.addEventListener("input", () => { pageState.doctorRank = 1; renderDoctorRank(); });
if (doctorsAnalysisSearch) doctorsAnalysisSearch.addEventListener("input", () => { pageState.doctorsAnalysis = 1; renderAnalytics(); });

document.addEventListener("click", function(e) {
  // التحقق من وجود المتغير والعنصر قبل استخدامه
  if (shippingCompanyFilterMenu) {
    // إذا كان النقر خارج عنصر .multi-filter
    if (!e.target.closest(".multi-filter")) {
      shippingCompanyFilterMenu.classList.remove("show");
    }
  }
});

document.addEventListener('DOMContentLoaded', function() {
  const depositInput = document.getElementById("deposit");
  const paymentImageInput = document.getElementById("paymentImage");
  
  if (depositInput) {
    depositInput.addEventListener('input', checkDepositImageRequirement);
  }
  
  if (paymentImageInput) {
    paymentImageInput.addEventListener('change', function() {
      previewPaymentImage(this);
      checkDepositImageRequirement();
    });
  }
});

document.addEventListener('DOMContentLoaded', () => setTimeout(ensureCashierBranchReportButton, 150));

// The old hamburger sidebar was retired; the button intentionally has no action.

// ===== OKB Stores — Branch Page Logic =====
let currentBranchName = '';
let branchShippingRankOverride = null;
let branchOrders = [];
let branchActiveDateFrom = null;
let branchActiveDateTo = null;
let branchPageNum = 1;
let branchSelectedOrderIds = new Set();
let branchEditId = null;
let branchEditExistingPaymentImage = '';

function toggleOKBStores(btn) {
  const menu = document.getElementById('okbBranchesMenu');
  const arrow = btn.querySelector('.okb-arrow');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none' && menu.style.display !== '';
  menu.style.display = isOpen ? 'none' : 'flex';
  if (arrow) arrow.classList.toggle('open', !isOpen);
}

async function openBranchPage(branchName) {
  if (!canAccessBranch(branchName)) { alert('غير مسموح لك بالدخول لهذا الفرع'); return; }
  const storesMenu=document.getElementById('okbBranchesMenu');
  if(storesMenu) storesMenu.style.display='none';
  document.querySelector('#okbStoresHeaderBtn .okb-arrow')?.classList.remove('open');
  currentBranchName = branchName;
  branchSelectedOrderIds.clear();
  branchEditId = null;
  branchEditExistingPaymentImage = '';
  branchPageNum = 1;
  branchActiveDateFrom = null;
  branchActiveDateTo = null;

  hideAllPages();

  const bp = document.getElementById('branchPage');
  if (bp) bp.classList.remove('hidden');

  const title = document.getElementById('branchPageTitle');
  if (title) title.textContent = '📦 Dashboard — فرع ' + branchName;

  const uName = document.getElementById('userNameHere');
  const uRole = document.getElementById('userRoleHere');
  if (uName) { const el = document.getElementById('branchUserNameInline'); if(el) el.textContent = uName.textContent; }
  if (uRole) { const el = document.getElementById('branchUserRoleInline'); if(el) el.textContent = uRole.textContent; }

  const bDoc = document.getElementById('bDoctorName');
  if (bDoc) {
    bDoc.innerHTML = '<option value="">اختر اسم الدكتور</option>' + doctorsList.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
  }
  if (!okbItems.length) await loadOKBItems();
  else renderOrderProductOptions();
  setBranchShippingSelectToCurrentBranch();
  setBranchStatusToDelivering();

  const bEmpEl = document.getElementById('bEmployeeName');
  if (bEmpEl && currentUser) {
    bEmpEl.value = currentUser.name;
    bEmpEl.readOnly = true;
  }

  clearProductCart('branch');
  await loadBranchOrders();
  setTimeout(ensureCashierBranchReportButton, 50);

  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
}

async function loadBranchOrders() {
  let allData = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('branch', currentBranchName)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) { alert('مشكلة في تحميل أوردرات الفرع: ' + error.message); return; }

    allData = allData.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  branchOrders = allData;
  const validIds=new Set(branchOrders.map(o=>String(o.id)));
  branchSelectedOrderIds=new Set([...branchSelectedOrderIds].filter(id=>validIds.has(id)));
  await loadBranchDailyLocks();
  renderBranchOrders();
}

function getBranchFilteredOrders() {
  const search = (document.getElementById('bSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('bFilterStatus')?.value || 'الكل';
  const empFilter = document.getElementById('bFilterEmployee')?.value || 'الكل';

  return branchOrders.filter(o => {
    const matchSearch = matchesOrderSearch(o, search);
    const matchStatus = matchesOrderStatusFilter(o, statusFilter);
    const matchEmp = empFilter === 'الكل' || o.employee_name === empFilter;
    const matchDate = (() => {
      if (!branchActiveDateFrom && !branchActiveDateTo) return true;
      const d = (o.created_at || '').split('T')[0];
      if (branchActiveDateFrom && branchActiveDateTo) return d >= branchActiveDateFrom && d <= branchActiveDateTo;
      if (branchActiveDateFrom) return d >= branchActiveDateFrom;
      return d <= branchActiveDateTo;
    })();
    return matchSearch && matchStatus && matchEmp && matchDate;
  });
}

function canChangeBranchOrderStatus() {
  const role = getRoleKey(currentUser && currentUser.role);
  return isAdmin() || isAccountManager() || isStoreManager() || isSecretary() || isExecutiveAssistant();
}

function cleanVisibleOrderNotes(notes) {
  return String(notes || '')
    .replace(ORDER_META_REGEX, '')
    .replace(COLLECT_META_REGEX, '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line && line !== 'لا توجد ملاحظات')
    .join('\n')
    .trim();
}

function appendVisibleOrderNote(notes, addition) {
  const original = String(notes || '');
  const orderMetaMatch = original.match(ORDER_META_REGEX);
  const collectMetaMatch = original.match(COLLECT_META_REGEX);
  let clean = cleanVisibleOrderNotes(original);
  clean = clean ? `${clean}\n${addition}` : addition;
  if (collectMetaMatch) clean += `\n${COLLECT_META_PREFIX}${collectMetaMatch[1]}]`;
  if (orderMetaMatch) clean += `\n${ORDER_META_PREFIX}${orderMetaMatch[1]}]`;
  return clean;
}

function isReturnWithin14Days(order) {
  return /نوع الإلغاء:\s*مرتجع خلال 14 يوم/i.test(String(order?.notes || ''));
}

function getReturnWithin14DaysDateISO(order) {
  const notes = String(order?.notes || '');
  const match = notes.match(/تاريخ مرتجع خلال 14 يوم:\s*([^\s]+)/i);
  return match?.[1] || order?.updated_at || order?.created_at || '';
}

function getOrderDisplayStatus(order) {
  return isReturnWithin14Days(order) ? 'مرتجع خلال 14 يوم' : String(order?.status || '');
}

function matchesOrderStatusFilter(order, filterValue) {
  if (!filterValue || filterValue === 'الكل') return true;
  if (filterValue === 'Returned14') return isReturnWithin14Days(order);
  if (filterValue === 'Returned') return order?.status === 'Returned' && !isReturnWithin14Days(order);
  return order?.status === filterValue;
}

function getBranchStatusButtonHtml(order) {
  if (!canChangeBranchOrderStatus()) return '';
  if (typeof isOrderLockedByDaily === 'function' && isOrderLockedByDaily(order)) return disabledActionButton('إلغاء', 'هذه اليومية مقفولة');
  if (order.status === 'Returned' || order.status === 'Cancel') return `<span class="branch-cancel-disabled" title="الأوردر ملغي بالفعل">ملغي</span>`;
  if (isFinalizedDeliveredOrder(order)) return `<span class="branch-cancel-disabled" title="تم تسليم وتحصيل الأوردر نهائياً">تم التسليم</span>`;
  return `<button onclick="openBranchCancelStatusModal('${order.id}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;border:none;background:linear-gradient(135deg,#EF4444,#B91C1C);color:#fff;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(239,68,68,.25);">إلغاء</button>`;
}
function openBranchCancelStatusModal(orderId) {
  const order = branchOrders.find(x => String(x.id) === String(orderId)); if (!order) return;
  if (!canChangeBranchOrderStatus()) { alert('غير مسموح لك بتعديل حالة الأوردر'); return; }
  if (typeof isOrderLockedByDaily === 'function' && isOrderLockedByDaily(order)) { alert('هذه اليومية مقفولة. لا يمكن تعديل حالة الأوردر.'); return; }
  if (isFinalizedDeliveredOrder(order)) { showDeliveredOrderLockedMessage(); return; }
  let modal=$('branchCancelStatusModal');
  if(!modal){ modal=document.createElement('div'); modal.id='branchCancelStatusModal'; modal.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10050;align-items:center;justify-content:center;padding:18px;'; modal.innerHTML=`<div style="width:470px;max-width:96vw;background:var(--bg-card);border:1px solid var(--border-color);border-radius:18px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.45);direction:rtl"><h3 style="margin:0 0 8px;font-size:17px;color:var(--text-primary)">إلغاء الأوردر</h3><p id="branchCancelModalCustomer" style="margin:0 0 14px;color:var(--text-muted);font-size:13px"></p><label for="branchCancelTypeSelect" style="display:block;margin-bottom:7px;color:var(--text-muted);font-size:12px;font-weight:900">نوع الإلغاء</label><select id="branchCancelTypeSelect" style="width:100%;margin-bottom:14px"><option value="Cancel">الغاء من الدكتور علي الجروب</option><option value="Returned">الغاء من العميل مع المندوب</option><option value="Returned14">مرتجع خلال 14 يوم</option></select><label style="display:block;margin-bottom:6px;color:var(--text-muted);font-size:12px;font-weight:800">سبب الإلغاء <span style="color:#EF4444">*</span></label><textarea id="branchCancelReasonInput" rows="4" placeholder="اكتب سبب الإلغاء..." style="width:100%;resize:vertical;margin-bottom:12px"></textarea><div style="display:flex;gap:10px;justify-content:flex-start"><button id="branchCancelConfirmBtn" onclick="confirmBranchCancelStatus()" style="background:#EF4444;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-weight:900">تأكيد الإلغاء</button><button onclick="closeBranchCancelStatusModal()" style="background:var(--bg-soft);color:var(--text-primary);border:1px solid var(--border-color);border-radius:10px;padding:10px 18px;font-weight:800">إغلاق</button></div></div>`; document.body.appendChild(modal); }
  modal.dataset.orderId=orderId; $('branchCancelModalCustomer').textContent=`العميل: ${order.customer_name||'—'} | الحالة الحالية: ${order.status||'—'}`; $('branchCancelReasonInput').value=''; if($('branchCancelTypeSelect'))$('branchCancelTypeSelect').value='Cancel'; modal.style.display='flex'; setTimeout(()=>$('branchCancelReasonInput')?.focus(),50);
}
function closeBranchCancelStatusModal(){ const modal=$('branchCancelStatusModal'); if(modal)modal.style.display='none'; }
async function confirmBranchCancelStatus(){
  const modal=$('branchCancelStatusModal'); const orderId=modal?.dataset?.orderId; const reasonEl=$('branchCancelReasonInput'); const reason=String(reasonEl?.value||'').trim(); const target=$('branchCancelTypeSelect')?.value||'Cancel';
  if(!orderId)return; if(!reason){alert('لازم تكتب سبب الإلغاء');reasonEl?.focus();return;}
  const order=branchOrders.find(x=>String(x.id)===String(orderId)); if(!order)return;
  const isReturn14=target==='Returned14';
  const dbStatus=isReturn14?'Returned':target;
  const typeLabel=target==='Cancel'?'الغاء من الدكتور في الجروب':isReturn14?'مرتجع خلال 14 يوم':'الغاء من العميل مع المندوب';
  const returnDateLine=isReturn14?`\nتاريخ مرتجع خلال 14 يوم: ${new Date().toISOString()}`:'';
  const noteLine=`نوع الإلغاء: ${typeLabel}\nسبب الإلغاء: ${reason}${returnDateLine}`;
  const newNotes=appendVisibleOrderNote(order.notes||'',noteLine); const btn=$('branchCancelConfirmBtn'); if(btn){btn.disabled=true;btn.textContent='جاري الحفظ...';}
  const {error}=await supabaseClient.from('orders').update({status:dbStatus,notes:newNotes}).eq('id',orderId); if(btn){btn.disabled=false;btn.textContent='تأكيد الإلغاء';} if(error){alert('مشكلة في تعديل الحالة: '+error.message);return;}
  await logActivity('order_cancelled',typeLabel,`العميل: ${order.customer_name||'—'} | الحالة: ${isReturn14?'مرتجع خلال 14 يوم':dbStatus} | السبب: ${reason}`,getActivityOrderInfo(order)); closeBranchCancelStatusModal(); await loadBranchOrders(); await loadOrders(); alert(isReturn14?'تم تسجيل الأوردر مرتجع خلال 14 يوم وإضافته إلى خزنة اليوم':dbStatus==='Cancel'?'تم تحويل حالة الأوردر إلى Cancel':'تم تحويل حالة الأوردر إلى Returned');
}

function openBranchShippingRankFromBranch() {
  if (!(isAdmin() || isOperationManager())) { alert('زر Shipping Rank من صفحة الفرع متاح للأدمن و Operation Manager فقط'); return; }
  if (!currentBranchName) { alert('افتح صفحة فرع أولاً'); return; }
  branchShippingRankOverride = currentBranchName;
  hideAllPages();
  const page = document.getElementById('shippingRankPage');
  if (page) page.classList.remove('hidden');
  const backBtn = document.getElementById('branchShippingBackBtn');
  if (backBtn) backBtn.classList.remove('hidden');
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  const appContent = document.querySelector('.app-content');
  if (appContent) appContent.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  setTimeout(() => {
    renderShippingRank();
    renderShippingCharts();
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const appContent = document.querySelector('.app-content');
    if (appContent) appContent.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, 120);
}

function closeBranchShippingRankToBranch() {
  const branchName = branchShippingRankOverride || currentBranchName;
  branchShippingRankOverride = null;
  const backBtn = document.getElementById('branchShippingBackBtn');
  if (backBtn) backBtn.classList.add('hidden');
  if (branchName) openBranchPage(branchName);
  else showOrdersPage();
}

function renderBranchOrders() {
  const statusSelect=document.getElementById('bFilterStatus');
  if(statusSelect && ![...statusSelect.options].some(o=>o.value==='Cancel')) statusSelect.insertAdjacentHTML('beforeend','<option value="Cancel">Cancel</option>');
  const filtered = getBranchFilteredOrders();

  const rev = filtered.reduce((s, o) => s + Number(o.price || 0), 0);
  const dep = filtered.reduce((s, o) => s + Number(o.deposit || 0), 0);
  const setEl = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  setEl('bTotalOrders', filtered.length);
  setEl('bReturnedOrders', filtered.filter(o => o.status === 'Returned').length);
  setEl('bFakeDoctorOrders', filtered.filter(o => isFakeDoctorOrder(o)).length);
  setEl('bFakeDeliveryUpdateOrders', filtered.filter(o => isFakeDeliveryUpdateOrder(o)).length);
  setEl('bTotalSigned', filtered.filter(o => o.status === 'Signed').length);
  setEl('bPickedUpOrders', filtered.filter(o => o.status === 'Picked-up').length);
  setEl('bInTransitOrders', filtered.filter(o => o.status === 'Transit' || o.status === 'In transit').length);
  setEl('bDeliveringOrders', filtered.filter(o => o.status === 'Delivering').length);
  setEl('bReturningOrders', filtered.filter(o => o.status === 'Returning').length);
  setEl('bCancelOrders', filtered.filter(o => o.status === 'Cancel').length);
  setEl('bTotalDeposit', money(dep));

  const empSel = document.getElementById('bFilterEmployee');
  if (empSel) {
    const curEmp = empSel.value;
    const employees = [...new Set(branchOrders.map(o => o.employee_name).filter(Boolean))];
    empSel.innerHTML = '<option value="الكل">كل الموظفين</option>' + employees.map(e => `<option value="${e}">${e}</option>`).join('');
    empSel.value = employees.includes(curEmp) ? curEmp : 'الكل';
  }

  const tbody = document.getElementById('branchOrdersTableBody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="18" class="empty">لا توجد أوردرات لهذا الفرع</td></tr>';
    syncBranchSelectionUI([]);
    return;
  }

  const PAGE = 20;
  const totalPages = Math.ceil(filtered.length / PAGE);
  if (branchPageNum > totalPages) branchPageNum = totalPages;
  const start = (branchPageNum - 1) * PAGE;
  const rows = filtered.slice(start, start + PAGE);

  let html = '';
  rows.forEach((o, i) => {
    const isSelected = branchSelectedOrderIds.has(String(o.id));
    let statusClass = 'chip-transit';
    if (o.status === 'Returned') statusClass = 'chip-returned';
    else if (o.status === 'Cancel') statusClass = 'cancel-chip';
    else if (o.status === 'Signed') statusClass = 'chip-signed';
    else if (isFakeDoctorOrder(o) || isFakeDeliveryUpdateOrder(o)) statusClass = 'chip-fake';
    const price = Number(o.price || 0);
    const deposit = Number(o.deposit || 0);
    const remaining = price - deposit;
    const paymentBtn = o.payment_image
      ? `<button onclick="viewPaymentImage('${o.payment_image}')" style="background:#0D9488;padding:4px 8px;border-radius:6px;font-size:11px;color:#fff;border:none;cursor:pointer;">📷 عرض</button>`
      : `<label style="cursor:pointer;background:#6366f1;padding:4px 8px;border-radius:6px;font-size:11px;color:#fff;border-radius:6px;">📎 إرفاق<input type="file" accept="image/*" style="display:none;" onchange="attachBranchPayment(this,'${o.id}')"/></label>`;
    html += `<tr>
      <td><input type="checkbox" class="row-check branch-row-check" data-id="${o.id}" ${isSelected?'checked':''} onchange="toggleBranchOrderSelection(this,'${o.id}')"/></td>
      <td>${num(start + i + 1)}</td>
      <td>${o.employee_name || ''}</td>
      <td>${o.doctor_name || ''}</td>
      <td>${o.order_number || ""}</td>
      <td>${o.customer_name || ''}</td>
      <td>${o.phone || ''}</td>
      <td>${o.phone2 || ""}</td>
      <td>${o.shipping_company || ''}</td>
      <td class="branch-area-cell">${o.area || ''}</td>
      <td>${money(price)}</td>
      <td>${deposit > 0 ? '<span class="deposit-badge">💰 ' + money(deposit) + '</span>' : '—'}</td>
      <td>${remaining > 0 ? money(remaining) : '—'}</td>
      <td>${paymentBtn}</td>
      <td><span class="chip ${statusClass}">${getOrderDisplayStatus(o)}</span></td>
      <td class="branch-notes-cell">${cleanVisibleOrderNotes(o.notes || '')}</td>
      <td>${formatEnglishDateTime(o.created_at)}</td>
      <td class="branch-actions-cell">
        <div style="display:flex;gap:5px;align-items:center;">
          ${getCollectButtonHtml(o, 'branch')}
          <button onclick="printBranchOrderReceipt('${o.id}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;border:none;background:linear-gradient(135deg,#0D9488,#14B8A6);color:#fff;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(13,148,136,.25);">🖨️ طباعة</button>
          ${getBranchStatusButtonHtml(o)}
        </div>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;
  syncBranchSelectionUI(rows);

  const pag = document.getElementById('branchOrdersPagination');
  if (pag) {
    if (filtered.length <= PAGE) { pag.innerHTML = ''; return; }
    let ph = `<button onclick="changeBranchPage(${branchPageNum - 1})" ${branchPageNum===1?'disabled':''}>Prev</button>`;
    for (let p = 1; p <= totalPages; p++) ph += `<button class="${p===branchPageNum?'active':''}" onclick="changeBranchPage(${p})">${p}</button>`;
    ph += `<button onclick="changeBranchPage(${branchPageNum + 1})" ${branchPageNum===totalPages?'disabled':''}>Next</button>`;
    ph += `<span class="pagination-info">Page ${branchPageNum} of ${totalPages} | Total ${num(filtered.length)}</span>`;
    pag.innerHTML = ph;
  }
}

function toggleBranchOrderSelection(checkbox,id){
  const key=String(id);
  if(checkbox.checked) branchSelectedOrderIds.add(key);
  else branchSelectedOrderIds.delete(key);
  syncBranchSelectionUI();
}

function getCurrentBranchPageRows(){
  const filtered=getBranchFilteredOrders();
  const pageSize=20;
  const start=(Math.max(1,branchPageNum)-1)*pageSize;
  return filtered.slice(start,start+pageSize);
}

function toggleSelectCurrentBranchPage(checkbox){
  getCurrentBranchPageRows().forEach(order=>{
    const key=String(order.id);
    if(checkbox.checked) branchSelectedOrderIds.add(key);
    else branchSelectedOrderIds.delete(key);
  });
  renderBranchOrders();
}

function clearBranchOrderSelection(){
  branchSelectedOrderIds.clear();
  document.querySelectorAll('.branch-row-check').forEach(cb=>{cb.checked=false;});
  syncBranchSelectionUI();
}

function syncBranchSelectionUI(currentPageRows=getCurrentBranchPageRows()){
  const count=branchSelectedOrderIds.size;
  const bar=document.getElementById('branchBulkActions');
  const countEl=document.getElementById('branchSelectedCount');
  const editBtn=document.getElementById('branchBulkEditBtn');
  const transferBtn=document.getElementById('branchBulkTransferBtn');
  const deleteBtn=document.getElementById('branchBulkDeleteBtn');
  const selectAll=document.getElementById('selectBranchPageOrders');
  if(bar) bar.classList.toggle('hidden',count===0);
  if(countEl) countEl.textContent=`${num(count)} عميل محدد`;
  if(editBtn) editBtn.classList.toggle('hidden',count!==1);
  if(transferBtn) transferBtn.classList.toggle('hidden',count===0||!canManageKhaznaAndTransfer());
  if(deleteBtn) deleteBtn.classList.toggle('hidden',count===0||!isAdmin());
  if(selectAll){
    const ids=currentPageRows.map(o=>String(o.id));
    const selected=ids.filter(id=>branchSelectedOrderIds.has(id)).length;
    selectAll.checked=ids.length>0&&selected===ids.length;
    selectAll.indeterminate=selected>0&&selected<ids.length;
  }
}

async function printSelectedBranchOrders(){
  if(!branchSelectedOrderIds.size){alert('اختر أوردر واحد على الأقل للطباعة');return;}
  const selected=branchOrders.filter(o=>branchSelectedOrderIds.has(String(o.id)));
  if(!selected.length){alert('الأوردرات المحددة غير موجودة في الفرع الحالي');clearBranchOrderSelection();return;}
  const win=window.open('','_blank','width=420,height=760');
  if(!win){alert('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.');return;}
  win.document.write('<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;padding:16px">جاري تجهيز الريسيتات...</body></html>');
  win.document.close();
  try{
    const ready=[];
    for(const order of selected) ready.push(await ensureOrderIdentifiers(order));
    let receiptHead='';
    const receiptBodies=ready.map((order,index)=>{
      const doc=new DOMParser().parseFromString(generateReceiptHTML(order,currentBranchName||order.branch||''),'text/html');
      if(index===0) receiptHead=doc.head.innerHTML;
      return `<section class="branch-multi-receipt">${doc.body.innerHTML}</section>`;
    }).join('');
    win.document.open();
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">${receiptHead}<style>.branch-multi-receipt{width:100%}.branch-multi-receipt:not(:last-child){page-break-after:always;break-after:page}@media print{.branch-multi-receipt:not(:last-child){page-break-after:always;break-after:page}}</style></head><body>${receiptBodies}</body></html>`);
    win.onload=()=>{win.focus();win.print();};
    win.document.close();
  }catch(error){
    win.close();
    alert('تعذر تجهيز الطباعة الجماعية: '+(error.message||error));
  }
}

async function deleteSelectedBranchOrders(){
  if(!isAdmin()){alert('حذف الأوردرات المحددة متاح للأدمن فقط');return;}
  if(!branchSelectedOrderIds.size){alert('اختر أوردر واحد على الأقل للحذف');return;}
  const selected=branchOrders.filter(o=>branchSelectedOrderIds.has(String(o.id)));
  if(!selected.length){alert('الأوردرات المحددة غير موجودة في الفرع الحالي');clearBranchOrderSelection();return;}
  const accepted=confirm(`⚠️ سيتم حذف ${selected.length} أوردر نهائيًا من فرع ${currentBranchName}. هل أنت متأكد؟`);
  if(!accepted)return;

  const ids=selected.map(o=>o.id);
  const batchSize=20;
  let deletedCount=0;
  let failedCount=0;
  for(let i=0;i<ids.length;i+=batchSize){
    const batch=ids.slice(i,i+batchSize);
    const {error}=await supabaseClient.from('orders').delete().in('id',batch);
    if(error){console.error('Branch bulk delete error:',error);failedCount+=batch.length;}
    else deletedCount+=batch.length;
  }
  await logActivity('order_deleted','حذف جماعي من صفحة الفرع',`الفرع: ${currentBranchName} | تم حذف: ${deletedCount}${failedCount?` | فشل: ${failedCount}`:''}`,{branch_name:currentBranchName});
  clearBranchOrderSelection();
  await loadBranchOrders();
  if(typeof loadOrders==='function')await loadOrders();
  alert(failedCount?`تم حذف ${deletedCount} أوردر وفشل حذف ${failedCount}`:`✅ تم حذف ${deletedCount} أوردر بنجاح`);
}

function editSelectedBranchOrder(){
  if(branchSelectedOrderIds.size!==1){return;}
  const id=[...branchSelectedOrderIds][0];
  editBranchOrder(id);
}

function changeBranchPage(p) {
  branchPageNum = p;
  renderBranchOrders();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyBranchDateFilter() {
  const from = document.getElementById('bFromDate')?.value;
  const to = document.getElementById('bToDate')?.value;
  if (!from && !to) { alert('اختر تاريخ من أو إلى على الأقل'); return; }
  branchActiveDateFrom = from || null;
  branchActiveDateTo = to || null;
  branchPageNum = 1;
  const badge = document.getElementById('bActiveDateBadge');
  if (badge) {
    let label = '📅 ';
    if (branchActiveDateFrom && branchActiveDateTo) label += branchActiveDateFrom + ' → ' + branchActiveDateTo;
    else if (branchActiveDateFrom) label += 'من ' + branchActiveDateFrom;
    else label += 'حتى ' + branchActiveDateTo;
    badge.textContent = label;
    badge.classList.add('visible');
  }
  renderBranchOrders();
}

function resetBranchDateFilter() {
  branchActiveDateFrom = null;
  branchActiveDateTo = null;
  const f = document.getElementById('bFromDate'); if (f) f.value = '';
  const t = document.getElementById('bToDate'); if (t) t.value = '';
  const search = document.getElementById('bSearchInput'); if (search) search.value = '';
  const status = document.getElementById('bFilterStatus'); if (status) status.value = 'الكل';
  const employee = document.getElementById('bFilterEmployee'); if (employee) employee.value = 'الكل';
  const badge = document.getElementById('bActiveDateBadge');
  if (badge) {
    badge.textContent = '📅 فيلتر تاريخ مفعّل';
    badge.classList.remove('visible');
  }
  branchPageNum = 1;
  renderBranchOrders();
}

function editBranchOrder(id) {
  const o = branchOrders.find(x => String(x.id) === String(id));
  if (!o) return;
  if (isOrderLockedByDaily(o)) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  if (isFinalizedDeliveredOrder(o) && !isAdmin()) { showDeliveredOrderLockedMessage(); return; }
  branchEditId=String(o.id);
  branchEditExistingPaymentImage=o.payment_image||'';
  const setValue=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value??'';};
  setValue('bEmployeeName',o.employee_name||'');
  setValue('bDoctorName',o.doctor_name||'');
  setValue('bOrderNumber',o.order_number||'');
  setValue('bCustomerName',o.customer_name||'');
  setValue('bPhone',o.phone||'');
  setValue('bPhone2',o.phone2||'');
  setValue('bShippingCompany',o.shipping_company||getBranchShippingCompanyName(currentBranchName));
  setValue('bArea',o.area||'');
  setValue('bStatus',o.status||'Delivering');
  setValue('bOrderNotes',cleanVisibleOrderNotes(o.notes||''));
  setProductCartFromOrder('branch',o);
  const fileInput=document.getElementById('bPaymentImage');
  if(fileInput)fileInput.value='';
  const preview=document.getElementById('bPaymentImagePreview');
  const previewImg=document.getElementById('bPaymentPreviewImg');
  if(branchEditExistingPaymentImage&&preview&&previewImg){
    previewImg.src=branchEditExistingPaymentImage;
    preview.style.display='flex';
  }else if(preview){
    preview.style.display='none';
  }
  const submitBtn=document.querySelector('#branchOrderForm button[type="submit"]');
  if(submitBtn)submitBtn.textContent='حفظ التعديل';
  clearBranchOrderSelection();
  document.getElementById('branchOrderForm')?.scrollIntoView({behavior:'smooth',block:'start'});
}

document.addEventListener('DOMContentLoaded', function() {
  const branchForm = document.getElementById('branchOrderForm');
  if (!branchForm) return;

  const bSearch = document.getElementById('bSearchInput');
  if (bSearch) {
    bSearch.addEventListener('input', () => { branchPageNum = 1; renderBranchOrders(); });
    bSearch.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        branchPageNum = 1;
        renderBranchOrders();
        const scannedValue = String(bSearch.value || '').trim();
        if (scannedValue) openCollectionFromScan(scannedValue, 'branch');
      }
    });
  }
  const bFStatus = document.getElementById('bFilterStatus');
  if (bFStatus) bFStatus.addEventListener('change', () => { branchPageNum = 1; renderBranchOrders(); });
  const bFEmp = document.getElementById('bFilterEmployee');
  if (bFEmp) bFEmp.addEventListener('change', () => { branchPageNum = 1; renderBranchOrders(); });

  const khaznaSearch = document.getElementById('khaznaBarcodeSearch');
  if (khaznaSearch) {
    khaznaSearch.addEventListener('input', () => { renderKhaznaStats(); renderKhaznaOrders(); });
    khaznaSearch.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const scannedValue = String(khaznaSearch.value || '').trim();
      if (scannedValue) openCollectionFromScan(scannedValue, 'khazna');
    });
  }
  const khaznaStatus = document.getElementById('khaznaFilterStatus');
  if (khaznaStatus) khaznaStatus.addEventListener('change', () => { renderKhaznaStats(); renderKhaznaOrders(); });
  const khaznaEmployee = document.getElementById('khaznaFilterEmployee');
  if (khaznaEmployee) khaznaEmployee.addEventListener('change', () => { renderKhaznaStats(); renderKhaznaOrders(); });

  branchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const empEl   = document.getElementById('bEmployeeName');
    const docEl   = document.getElementById('bDoctorName');
    const custEl  = document.getElementById('bCustomerName');
    const phoneEl = document.getElementById('bPhone');
    const shipEl  = document.getElementById('bShippingCompany');
    const areaEl  = document.getElementById('bArea');
    const priceEl = document.getElementById('bPrice');
    const depEl   = document.getElementById('bDeposit');
    const statEl  = document.getElementById('bStatus');
    const notesEl = document.getElementById('bOrderNotes');
    const submitBtn = branchForm.querySelector('button[type="submit"]');
    const editingOrder = branchEditId ? branchOrders.find(o=>String(o.id)===String(branchEditId)) : null;

    if (!hasProducts('branch')) {
      alert('أضف منتج واحد على الأقل في الأوردر');
      return;
    }
    syncProductCartTotals('branch');
    if (!confirmDiscountBeforeOrderSave('branch')) return;
    const bQty       = Math.max(1, Number(document.getElementById('bQuantity')?.value || 1));
    const bDelivFee  = Number(document.getElementById('bDeliveryFee')?.value || 0);
    const bTotalPrice = Number(document.getElementById('bPrice')?.value || 0);

    const orderData = {
      employee_name:    editingOrder?.employee_name || (currentUser ? currentUser.name : (empEl?.value.trim() || '')),
      doctor_name:      docEl?.value.trim() || '',
      order_number: document.getElementById('bOrderNumber')?.value?.trim() || '',
      customer_name:    custEl?.value.trim() || '',
      phone: document.getElementById('bPhone')?.value.trim() || '',
      phone2: document.getElementById('bPhone2')?.value.trim() || '',
      shipping_company: getBranchShippingCompanyName(currentBranchName) || shipEl?.value || '',
      area:             areaEl?.value.trim() || '',
      price:            bTotalPrice,
      deposit:          Number(depEl?.value || 0),
      quantity:         bQty,
      delivery_fee:     bDelivFee,
      status:           editingOrder?.status || 'Delivering',
      fake_doctor:      editingOrder ? Boolean(editingOrder.fake_doctor) : false,
      notes:            buildNotesWithOrderMeta((notesEl?.value || '').trim() || 'لا توجد ملاحظات', { discount: Number(document.getElementById('branchDiscountInput')?.value || 0), ticket_seq_v2: true }),
      product_names:    document.getElementById('bProductNames')?.value.trim() || '',
      branch:           currentBranchName,
      transferred:      editingOrder ? Boolean(editingOrder.transferred) : false
    };

    const branchPaymentInput = document.getElementById('bPaymentImage');
    const branchPaymentFile = branchPaymentInput?.files?.[0];
    if (Number(orderData.deposit || 0) > 0 && !branchPaymentFile && !branchEditExistingPaymentImage) {
      checkBranchDepositImageRequirement();
      alert(`⚠️ الأوردر مدفوع بمبلغ ${money(orderData.deposit)} — لازم ترفق سكرين شوت إثبات الدفع قبل حفظ الأوردر`);
      branchPaymentInput?.focus();
      return;
    }
    if (branchPaymentFile && !validateImageFile(branchPaymentFile)) {
      return;
    }

    if (!orderData.employee_name || !orderData.doctor_name || !orderData.customer_name
        || !orderData.phone || !orderData.shipping_company || !orderData.area
        || !orderData.price || !orderData.status) {
      alert('من فضلك املى كل البيانات');
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ...'; }

    try {
      const wasEditing=Boolean(editingOrder);
      let savedOrder;
      let error;
      if(wasEditing){
        const result=await supabaseClient.from('orders').update(orderData).eq('id',editingOrder.id).select().single();
        savedOrder=result.data;
        error=result.error;
      }else{
        Object.assign(orderData,await reserveNextOrderIdentifiers());
        const result=await supabaseClient.from('orders').insert([orderData]).select().single();
        savedOrder=result.data;
        error=result.error;
      }
      if (error) throw error;
      const payImgInput = document.getElementById('bPaymentImage');
      if (payImgInput?.files[0] && savedOrder?.id) {
        const imgUrl = await uploadPaymentImage(payImgInput.files[0], savedOrder.id);
        if (imgUrl) {
          if(branchEditExistingPaymentImage) await deletePaymentImage(branchEditExistingPaymentImage);
          await supabaseClient.from('orders').update({ payment_image: imgUrl }).eq('id', savedOrder.id);
          savedOrder.payment_image=imgUrl;
        }
      }
      await logActivity(wasEditing?'order_updated':'order_created',wasEditing?'تم تعديل أوردر من صفحة الفرع':'تم إضافة أوردر جديد من الفرع',`العميل: ${orderData.customer_name} | الفرع: ${currentBranchName} | الإجمالي: ${money(orderData.price)}`,getActivityOrderInfo(savedOrder || editingOrder || orderData));
      const branchDiscount = Number(document.getElementById('branchDiscountInput')?.value || 0);
      if(branchDiscount>0) await logActivity('order_discount','تم تطبيق خصم على أوردر',`العميل: ${orderData.customer_name} | قيمة الخصم: ${money(branchDiscount)} | الإجمالي بعد الخصم: ${money(orderData.price)}`,getActivityOrderInfo(savedOrder || editingOrder || orderData));
      if(payImgInput?.files[0]) await logActivity('payment_proof_attached','تم إرفاق إثبات دفع للأوردر',`العميل: ${orderData.customer_name} | تم رفع صورة إثبات الدفع أثناء ${wasEditing?'تعديل':'إضافة'} الأوردر`,getActivityOrderInfo(savedOrder || editingOrder || orderData));
      branchEditId=null;
      branchEditExistingPaymentImage='';
      branchForm.reset();
      clearProductCart('branch');
      clearBranchPaymentImage();
      setBranchShippingSelectToCurrentBranch();
      setBranchStatusToDelivering();
      clearBranchOrderSelection();
      alert(wasEditing?'✅ تم تعديل الأوردر بنجاح':'✅ تم إضافة الأوردر بنجاح');
      await loadBranchOrders();
    } catch (err) {
      alert('مشكلة في الحفظ: ' + err.message);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = branchEditId?'حفظ التعديل':'إضافة الأوردر'; }
    }
  });
});

async function attachBranchPayment(input, orderId) {
  const file = input.files[0];
  if (!file) return;
  if (!validateImageFile(file)) { input.value = ''; return; }
  const btn = input.parentElement;
  btn.textContent = 'جاري الرفع...';
  const url = await uploadPaymentImage(file, orderId);
  if (!url) { btn.innerHTML = '📎 إرفاق<input type="file" accept="image/*" style="display:none;" onchange="attachBranchPayment(this,\''+orderId+'\')"/>'; return; }
  const { error } = await supabaseClient.from('orders').update({ payment_image: url }).eq('id', orderId);
  if (error) { alert('خطأ في الحفظ: ' + error.message); return; }
  const proofOrder = branchOrders.find(x=>String(x.id)===String(orderId)) || {id:orderId,branch:currentBranchName};
  await logActivity('payment_proof_attached','تم إرفاق إثبات دفع للأوردر',`العميل: ${proofOrder.customer_name||'—'} | تم رفع صورة إثبات الدفع`,getActivityOrderInfo(proofOrder));
  await loadBranchOrders();
}

function previewBranchPaymentImage(input) {
  const file = input.files[0];
  if (!file) return;
  if (!validateImageFile(file)) { input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('bPaymentImagePreview');
    const img = document.getElementById('bPaymentPreviewImg');
    if (preview && img) {
      img.src = e.target.result;
      preview.style.display = 'flex';
    }
    const warning = document.getElementById('bDepositImageWarning');
    if (warning) warning.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function clearBranchPaymentImage() {
  const input = document.getElementById('bPaymentImage');
  const preview = document.getElementById('bPaymentImagePreview');
  const warning = document.getElementById('bDepositImageWarning');
  if (input) input.value = '';
  if (preview) preview.style.display = 'none';
  if (warning) warning.style.display = 'none';
}

let transferOrderId = null;
let transferOrderIds = [];

function getEligibleSelectedTransferOrders() {
  return branchOrders.filter(order => {
    if (!branchSelectedOrderIds.has(String(order.id))) return false;
    if (order.transferred) return false;
    if (isOrderLockedByDaily(order)) return false;
    if (isFinalizedDeliveredOrder(order) || order.status === 'Signed') return false;
    return true;
  });
}

function transferSelectedBranchOrders() {
  if (!canManageKhaznaAndTransfer()) {
    alert('زر التحويل متاح للأدمن و Account Manager فقط');
    return;
  }
  if (!branchSelectedOrderIds.size) {
    alert('اختر أوردر واحد على الأقل للتحويل');
    return;
  }

  const selected = branchOrders.filter(order => branchSelectedOrderIds.has(String(order.id)));
  const eligible = getEligibleSelectedTransferOrders();
  const skipped = selected.length - eligible.length;
  if (!eligible.length) {
    alert('لا توجد أوردرات صالحة للتحويل. الأوردر المحوّل أو المقفول أو Signed لا يمكن تحويله.');
    return;
  }

  transferOrderId = null;
  transferOrderIds = eligible.map(order => String(order.id));
  const sel = document.getElementById('transferShippingSelect');
  if (sel) {
    const names = getShippingCompanyNames();
    sel.innerHTML = '<option value="">اختر شركة الشحن...</option>' +
      names.map(name => `<option value="${name}">${name}</option>`).join('');
  }
  const modal = document.getElementById('transferModal');
  if (modal) modal.style.display = 'flex';
  if (skipped > 0) {
    alert(`سيتم تحويل ${eligible.length} أوردر. تم استبعاد ${skipped} أوردر محوّل أو مقفول أو Signed.`);
  }
}

function transferBranchOrder(orderId) {
  if (!canManageKhaznaAndTransfer()) { alert('زر التحويل متاح للأدمن و Account Manager فقط'); return; }
  const o = branchOrders.find(x => String(x.id) === String(orderId)) || khaznaOrders.find(x => String(x.id) === String(orderId));
  if (o && isOrderLockedByDaily(o)) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  if (o && isFinalizedDeliveredOrder(o)) { showDeliveredOrderLockedMessage(); return; }
  transferOrderId = orderId;
  transferOrderIds = [String(orderId)];
  const sel = document.getElementById('transferShippingSelect');
  if (sel) {
    const names = getShippingCompanyNames();
    sel.innerHTML = '<option value="">اختر شركة الشحن...</option>' +
      names.map(name => `<option value="${name}">${name}</option>`).join('');
  }
  const modal = document.getElementById('transferModal');
  if (modal) modal.style.display = 'flex';
}

function closeTransferModal() {
  transferOrderId = null;
  transferOrderIds = [];
  const modal = document.getElementById('transferModal');
  if (modal) modal.style.display = 'none';
}

async function confirmTransfer() {
  if (!canManageKhaznaAndTransfer()) { alert('زر التحويل متاح للأدمن و Account Manager فقط'); return; }
  const shipping = document.getElementById('transferShippingSelect')?.value;
  if (!shipping) { alert('اختر شركة الشحن أولاً'); return; }
  const ids = transferOrderIds.length
    ? [...new Set(transferOrderIds.map(String))]
    : (transferOrderId ? [String(transferOrderId)] : []);
  if (!ids.length) return;

  const allKnownOrders = [...branchOrders, ...khaznaOrders, ...orders];
  const transferOrders = ids.map(id => allKnownOrders.find(x => String(x.id) === id)).filter(Boolean);
  const confirmBtn = document.querySelector('#transferModal button:last-child');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'جاري التحويل...'; }

  const { error } = await supabaseClient.from('orders').update({
    transferred: true,
    transferred_to: shipping,
    shipping_company: shipping,
    branch: null
  }).in('id', ids);

  if (error) {
    alert('مشكلة في التحويل: ' + error.message);
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✅ تأكيد التحويل'; }
    return;
  }

  for (const transferOrder of transferOrders) {
    const previousShipping = transferOrder?.shipping_company || transferOrder?.branch || '—';
    await logActivity(
      'order_transfer',
      'تم تحويل أوردر إلى شركة شحن',
      `العميل: ${transferOrder?.customer_name||'—'} | من: ${previousShipping} | إلى: ${shipping}`,
      getActivityOrderInfo(transferOrder)
    );
  }
  closeTransferModal();
  clearBranchOrderSelection();
  alert(`✅ تم تحويل ${ids.length} أوردر إلى ${shipping} بنجاح`);
  await loadBranchOrders();
  if (typeof loadOrders === 'function') await loadOrders();
}

// ============================================================
// ===== KHAZNA PAGE - دوال تاريخ التحصيل =====
// ============================================================

function getOrderDateKey(order) {
  return getOrderAccountingDateKey(order);
}

function getOrderAccountingDateISO(order) {
  if (isReturnWithin14Days(order)) {
    return String(getReturnWithin14DaysDateISO(order));
  }
  const lastCollect = (typeof getLatestCollectEntry === 'function') ? getLatestCollectEntry(order) : null;
  if (order && String(order.status || '') === 'Signed' && lastCollect && lastCollect.at) {
    return String(lastCollect.at);
  }
  return String(order?.created_at || '');
}

function getOrderAccountingDateKey(order) {
  return String(getOrderAccountingDateISO(order) || '').split('T')[0] || '';
}

function isOrderInAccountingDateRange(order, from, to) {
  const d = getOrderAccountingDateKey(order);
  if (!d) return false;
  if (from && to) return d >= from && d <= to;
  if (from) return d >= from;
  if (to) return d <= to;
  return true;
}

function getKhaznaSelectedDate() {
  const from = document.getElementById('khaznaFromDate')?.value || '';
  const to = document.getElementById('khaznaToDate')?.value || '';
  if (from && to && from === to) return from;
  if (from && !to) return from;
  if (!from && to) return to;
  return '';
}

function dailyLockStorageKey(branchName, date) {
  return `okb_daily_lock_${encodeURIComponent(branchName || '')}_${date}`;
}

async function fetchDailyLock(branchName, date) {
  if (!branchName || !date) return null;
  
  try {
    const { data, error } = await supabaseClient
      .from('khazna_lock')
      .select('*')
      .eq('branch', branchName)
      .eq('lock_date', date)
      .maybeSingle();
    if (!error) return data || null;
    console.warn('khazna_lock fetch fallback:', error.message);
  } catch(e) {
    console.warn('khazna_lock fetch exception:', e.message);
  }
  
  try {
    const raw = localStorage.getItem(dailyLockStorageKey(branchName, date));
    return raw ? JSON.parse(raw) : null;
  } catch(e) { 
    return null; 
  }
}

async function loadBranchDailyLocks() {
  branchDailyLocks = {};
  if (!currentBranchName) return;
  
  try {
    const { data, error } = await supabaseClient
      .from('khazna_lock')
      .select('*')
      .eq('branch', currentBranchName);
    if (!error && Array.isArray(data)) {
      data.forEach(l => { 
        if (l.lock_date) branchDailyLocks[l.lock_date] = l; 
      });
      return;
    }
    console.warn('khazna_lock branch fallback:', error?.message || error);
  } catch(e) {
    console.warn('khazna_lock branch exception:', e.message);
  }
  
  try {
    Object.keys(localStorage).forEach(k => {
      const prefix = `okb_daily_lock_${encodeURIComponent(currentBranchName)}_`;
      if (!k.startsWith(prefix)) return;
      const item = JSON.parse(localStorage.getItem(k) || 'null');
      if (item?.lock_date) branchDailyLocks[item.lock_date] = item;
    });
  } catch(e) {}
}

function isOrderLockedByDaily(order) {
  if (String(order?.status || '').trim() !== 'Signed') return false;
  const d = getOrderDateKey(order);
  if (!d) return false;
  
  if (khaznaLockInfo && khaznaLockInfo.branch === currentBranchName && khaznaLockInfo.lock_date === d) {
    return true;
  }
  
  return !!branchDailyLocks[d];
}

function disabledActionButton(label, tooltip) {
  return `<button class="action-disabled" disabled title="${tooltip || 'هذه اليومية مقفولة'}" 
    style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;
    border:none;background:#64748b;color:#fff;font-size:11px;font-weight:700;white-space:nowrap;">
    ${label}
  </button>`;
}

// ============================================================
// ===== KHAZNA PAGE - واجهة المستخدم =====
// ============================================================

function renderKhaznaLockUI() {
  renderKhaznaShippingCostPermissionUI();
  const date = getKhaznaSelectedDate();
  const lockBtn = document.getElementById('lockDailyBtn');
  const unlockBtn = document.getElementById('unlockDailyBtn');
  const lockBadge = document.getElementById('khaznaLockBadge');
  const isSingleDate = !!date;
  const isLocked = !!khaznaLockInfo;

  if (lockBtn) {
    lockBtn.style.display = (isSingleDate && !isLocked && canManageDailyLock()) ? 'inline-flex' : 'none';
  }
  if (unlockBtn) {
    unlockBtn.style.display = (isSingleDate && isLocked && canUnlockDailyLock()) ? 'inline-flex' : 'none';
  }

  if (lockBadge) {
    if (isLocked) {
      const lockedAt = khaznaLockInfo.locked_at 
        ? formatDate(khaznaLockInfo.locked_at) 
        : (khaznaLockInfo.created_at ? formatDate(khaznaLockInfo.created_at) : '—');
      const by = khaznaLockInfo.locked_by || khaznaLockInfo.locked_by_name || 'User';
      lockBadge.textContent = `🔒 هذه اليومية مقفولة بتاريخ ${lockedAt} بواسطة ${by}`;
      lockBadge.classList.add('visible');
    } else {
      lockBadge.textContent = '';
      lockBadge.classList.remove('visible');
    }
  }
}

async function refreshKhaznaLockState() {
  const date = getKhaznaSelectedDate();
  khaznaLockInfo = date ? await fetchDailyLock(currentBranchName, date) : null;
  if (khaznaLockInfo && !khaznaLockInfo.branch) {
    khaznaLockInfo.branch = currentBranchName;
  }
  renderKhaznaLockUI();
}

async function lockKhaznaDay() {
  if (!canManageDailyLock()) { 
    alert('قفل اليومية متاح للأدمن و Account Manager والكاشير فقط'); 
    return; 
  }
  
  const date = getKhaznaSelectedDate();
  if (!date) { 
    alert('اختار يوم واحد فقط لقفل اليومية'); 
    return; 
  }
  
  const msg = `هل أنت متأكد من قفل يومية ${date} لفرع ${currentBranchName}؟\nسيتم قفل أوردرات Signed فقط في هذا اليوم، وأي حالة أخرى لن تتأثر.`;
  if (!confirm(msg)) return;

  const payload = {
    branch: currentBranchName,
    lock_date: date,
    locked_by: currentUser?.name || currentUser?.username || 'User',
    locked_at: new Date().toISOString()
  };

  let saved = false;
  try {
    const { error } = await supabaseClient.from('khazna_lock').insert([payload]);
    if (!error) {
      saved = true;
    } else if (!String(error.message || '').toLowerCase().includes('duplicate')) {
      console.warn('khazna_lock insert fallback:', error.message);
    }
  } catch(e) {
    console.warn('khazna_lock insert exception:', e.message);
  }

  if (!saved) {
    try { 
      localStorage.setItem(dailyLockStorageKey(currentBranchName, date), JSON.stringify(payload)); 
    } catch(e) {}
  }

  khaznaLockInfo = payload;
  branchDailyLocks[date] = payload;
  
  renderKhaznaLockUI();
  renderKhaznaOrders();
  if (typeof renderBranchOrders === 'function') renderBranchOrders();
  
  await logActivity('daily_locked','تم قفل اليومية',`الفرع: ${currentBranchName} | التاريخ: ${date}`,{branch_name:currentBranchName});
  alert('✅ تم قفل اليومية بنجاح');
}

async function unlockKhaznaDay() {
  if (!canUnlockDailyLock()) { 
    alert('فتح القفل متاح للأدمن و Account Manager فقط'); 
    return; 
  }
  
  const date = getKhaznaSelectedDate();
  if (!date) { 
    alert('اختار يوم واحد فقط'); 
    return; 
  }
  
  if (!confirm(`هل تريد فتح قفل يومية ${date} لفرع ${currentBranchName}؟`)) return;

  try {
    await supabaseClient.from('khazna_lock').delete().eq('branch', currentBranchName).eq('lock_date', date);
  } catch(e) { 
    console.warn('khazna_lock delete exception:', e.message); 
  }
  
  try { 
    localStorage.removeItem(dailyLockStorageKey(currentBranchName, date)); 
  } catch(e) {}

  khaznaLockInfo = null;
  delete branchDailyLocks[date];
  
  renderKhaznaLockUI();
  renderKhaznaOrders();
  if (typeof renderBranchOrders === 'function') renderBranchOrders();
  
  await logActivity('daily_unlocked','تم فتح قفل اليومية',`الفرع: ${currentBranchName} | التاريخ: ${date}`,{branch_name:currentBranchName});
  alert('✅ تم فتح القفل');
}

function openKhaznaPage() {
  if (!canViewKhazna()) { 
    alert('الخزنة متاحة للأدمن و Account Manager والكاشير فقط'); 
    return; 
  }
  
  renderKhaznaShippingCostPermissionUI();
  hideAllPages();
  document.getElementById('khaznaPage').classList.remove('hidden');
  document.getElementById('khaznaTitle').textContent = currentBranchName;
  
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('khaznaFromDate').value = today;
  document.getElementById('khaznaToDate').value = today;
  
  khaznaSelectedIds = new Set();
  khaznaShippingCost = 0;
  
  if (document.getElementById('khaznaBarcodeSearch')) {
    document.getElementById('khaznaBarcodeSearch').value = '';
  }
  if (document.getElementById('khaznaFilterStatus')) {
    document.getElementById('khaznaFilterStatus').value = 'الكل';
  }
  if (document.getElementById('khaznaFilterEmployee')) {
    document.getElementById('khaznaFilterEmployee').value = 'الكل';
  }
  
  loadKhaznaData();
}

function closeKhaznaPage() {
  hideAllPages();
  document.getElementById('branchPage').classList.remove('hidden');
  document.getElementById('khaznaTitle').textContent = currentBranchName;
}

async function refreshKhaznaPage(button) {
  const oldText = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'جاري التحديث...'; }
  try {
    await loadKhaznaData();
  } finally {
    if (button) { button.disabled = false; button.textContent = oldText || '↻ Refresh'; }
  }
}

async function loadKhaznaData() {
  const from = document.getElementById('khaznaFromDate').value;
  const to = document.getElementById('khaznaToDate').value;
  if (!from && !to) { 
    alert('اختر تاريخ أولاً'); 
    return; 
  }

  const badge = document.getElementById('khaznaBadge');
  badge.style.display = 'inline-block';
  badge.textContent = from === to ? '📅 ' + from : '📅 ' + (from || 'البداية') + ' → ' + (to || 'النهاية');

  // ✅ تحميل كل الأوردرات على دفعات
  let allData = [];
  const pageSize = 1000;
  let rangeFrom = 0;

  while (true) {
    const rangeTo = rangeFrom + pageSize - 1;
    const { data, error } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('branch', currentBranchName)
      .in('status', ['Signed', 'Returned'])
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo);

    if (error) { alert('خطأ: ' + error.message); return; }
    allData = allData.concat(data || []);
    if (!data || data.length < pageSize) break;
    rangeFrom += pageSize;
  }

  khaznaOrders = allData
    .filter(o => (o.status === 'Signed' || isReturnWithin14Days(o)) && isOrderInAccountingDateRange(o, from || null, to || null))
    .sort((a, b) => String(getOrderAccountingDateISO(b)).localeCompare(String(getOrderAccountingDateISO(a))));

  khaznaSelectedIds = new Set();
  
  await refreshKhaznaLockState();
  renderKhaznaEmployeeFilter();
  renderKhaznaStats();
  renderKhaznaOrders();
}

function resetKhaznaFilter() {
  document.getElementById('khaznaFromDate').value = '';
  document.getElementById('khaznaToDate').value = '';
  document.getElementById('khaznaBadge').style.display = 'none';
  
  khaznaOrders = [];
  khaznaShippingCost = 0;
  khaznaSelectedIds = new Set();
  khaznaLockInfo = null;
  
  renderKhaznaLockUI();
  renderKhaznaEmployeeFilter();
  renderKhaznaStats();
  renderKhaznaOrders();
}

function getLatestCollectEntry(order) {
  const meta = getCollectMeta(order);
  const history = Array.isArray(meta.history) ? meta.history : [];
  return history.length ? history[history.length - 1] : null;
}

function getKhaznaShippingTotal() {
  const autoShipping = khaznaOrders.reduce((sum, order) => {
    const last = getLatestCollectEntry(order);
    return sum + Number(last?.shipping || 0);
  }, 0);
  return autoShipping + Number(khaznaShippingCost || 0);
}

function getKhaznaTransfersTotal() {
  return khaznaOrders.reduce((sum, order) => {
    const last = getLatestCollectEntry(order);
    const method = last && last.payment_method ? String(last.payment_method).toLowerCase() : '';
    if (method === 'instapay' || method === 'wallet') {
      return sum + Number(last.sales || order.price || 0);
    }
    return sum;
  }, 0);
}



function renderKhaznaEmployeeFilter() {
  const empSel = document.getElementById('khaznaFilterEmployee');
  if (!empSel) return;
  
  const current = empSel.value;
  const employees = [...new Set(khaznaOrders.map(o => o.employee_name).filter(Boolean))];
  
  empSel.innerHTML = '<option value="الكل">كل الموظفين</option>' + 
    employees.map(e => `<option value="${e}">${e}</option>`).join('');
  empSel.value = employees.includes(current) ? current : 'الكل';
}

function renderKhaznaStats() {
  renderKhaznaEmployeeFilter();
  
  const visibleKhaznaOrders = getKhaznaFilteredOrders();
  const signedOrders = visibleKhaznaOrders.filter(o => o.status === 'Signed');
  const return14Total = visibleKhaznaOrders
    .filter(isReturnWithin14Days)
    .reduce((s, o) => s + Number(o.price || 0), 0);
  const totalSales = signedOrders.reduce((s, o) => s + Number(o.price || 0), 0);
  
  const originalKhaznaOrdersForCalc = khaznaOrders;
  khaznaOrders = visibleKhaznaOrders;
  const shippingTotal = getKhaznaShippingTotal();
  const transfersTotal = getKhaznaTransfersTotal();
  khaznaOrders = originalKhaznaOrdersForCalc;
  const net = totalSales - return14Total - shippingTotal - transfersTotal;

  const fmt = v => enMoney(v);
  const setEl = (id, v) => { 
    const el = document.getElementById(id); 
    if(el) el.textContent = v; 
  };

  setEl('kTotalSales', fmt(totalSales));
  setEl('kReturn14Total', fmt(return14Total));
  setEl('kShippingCost', fmt(shippingTotal));
  setEl('kTransfers', fmt(transfersTotal));
  setEl('kNetAmount', fmt(net));
  setEl('kOrderCount', visibleKhaznaOrders.length);
  setEl('kMatchSales', fmt(totalSales));
  setEl('kMatchShipping', fmt(shippingTotal));
  setEl('kMatchTransfers', fmt(transfersTotal));
  setEl('kMatchNet', fmt(net));

  const statusEl = document.getElementById('kMatchStatus');
  if (statusEl) {
    if (net > 0) {
      statusEl.textContent = '✅ الخزنة في رصيد';
      statusEl.style.background = 'rgba(16,185,129,0.2)';
      statusEl.style.color = '#10b981';
    } else if (net < 0) {
      statusEl.textContent = '⚠️ عجز في الخزنة';
      statusEl.style.background = 'rgba(239,68,68,0.2)';
      statusEl.style.color = '#ef4444';
    } else {
      statusEl.textContent = '= متطابق';
      statusEl.style.background = 'rgba(99,102,241,0.2)';
      statusEl.style.color = '#6366f1';
    }
  }
}

function editShippingCost() {
  if (!canEditKhaznaShippingCost()) { alert('تعديل إجمالي مصروفات الشحنات متاح للأدمن فقط'); return; }
  if (khaznaLockInfo) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  document.getElementById('kShippingCostEdit').style.display = 'block';
  document.getElementById('kShippingCostInput').value = khaznaShippingCost || '';
  document.getElementById('kShippingCostInput').focus();
}

function saveShippingCost() {
  if (!canEditKhaznaShippingCost()) { alert('تعديل إجمالي مصروفات الشحنات متاح للأدمن فقط'); return; }
  if (khaznaLockInfo) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  const val = Number(document.getElementById('kShippingCostInput').value || 0);
  khaznaShippingCost = val;
  document.getElementById('kShippingCostEdit').style.display = 'none';
  renderKhaznaStats();
}

function cancelShippingCost() {
  document.getElementById('kShippingCostEdit').style.display = 'none';
}

function renderKhaznaOrders() {
  const tbody = document.getElementById('khaznaOrdersBody');
  if (!tbody) return;
  
  renderKhaznaEmployeeFilter();
  const visibleKhaznaOrders = getKhaznaFilteredOrders();
  
  if (!visibleKhaznaOrders.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">لا توجد أوردرات في هذه الفترة</td></tr>';
    return;
  }
  
  let rows = '';
  visibleKhaznaOrders.forEach((o, i) => {
    const price = Number(o.price || 0);
    const deposit = Number(o.deposit || 0);
    const remaining = price - deposit;
    const latestCollect = getLatestCollectEntry(o);
    const shippingExpense = Number(latestCollect?.shipping || 0);
    
    let statusClass = 'chip-transit';
    if (o.status === 'Returned') statusClass = 'chip-returned';
    else if (o.status === 'Cancel') statusClass = 'cancel-chip';
    else if (o.status === 'Signed') statusClass = 'chip-signed';
    
    const lockedByDaily = isOrderLockedByDaily(o);
    
    rows += `<tr>
      <td>${i + 1}</td>
      <td>${escapeHTML(o.customer_name || '')}</td>
      <td>${escapeHTML(o.phone || '')}</td>
      <td>${escapeHTML(o.doctor_name || '—')}</td>
      <td>${enMoney(price)}</td>
      <td>${deposit > 0 ? enMoney(deposit) : '—'}</td>
      <td>${remaining > 0 ? enMoney(remaining) : '—'}</td>
      <td>${o.payment_image ? `<button class="view-payment-btn" onclick="viewPaymentImage('${o.payment_image}')" style="background:#0D9488;padding:4px 8px;border-radius:6px;font-size:11px;color:#fff;">📷 عرض</button>` : '<span class="chip chip-cancelled" style="font-size:10px">لا يوجد</span>'}</td>
      <td>${enMoney(shippingExpense)}</td>
      <td><span class="chip ${statusClass}" style="font-size:10px;">${getOrderDisplayStatus(o)}</span></td>
      <td style="font-size:11px;">${formatDate(getOrderAccountingDateISO(o))}</td>
      <td class="branch-actions-cell">
        <div style="display:flex;gap:5px;align-items:center;">
          ${getCollectButtonHtml(o, 'khazna')}
          ${lockedByDaily ? '<span class="chip" style="font-size:10px;background:#78350f;color:#fbbf24;">🔒 مقفول</span>' : ''}
          <button onclick="printSingleOrder('${o.id}')" 
            style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;
            border:none;background:linear-gradient(135deg,#0D9488,#14B8A6);color:#fff;font-size:11px;
            font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(13,148,136,.25);">
            🖨️ طباعة
          </button>
        </div>
      </td>
    </tr>`;
  });
  
  tbody.innerHTML = rows;
}

function toggleKhaznaOrder(checkbox, id) {
  if (checkbox.checked) {
    khaznaSelectedIds.add(String(id));
  } else {
    khaznaSelectedIds.delete(String(id));
  }
}

function toggleAllKhaznaOrders(masterCb) {
  document.querySelectorAll('.khazna-check').forEach(cb => {
    cb.checked = masterCb.checked;
    if (masterCb.checked) {
      khaznaSelectedIds.add(cb.dataset.id);
    } else {
      khaznaSelectedIds.delete(cb.dataset.id);
    }
  });
}

function selectAllKhaznaOrders() {
  document.querySelectorAll('.khazna-check').forEach(cb => {
    cb.checked = true;
    khaznaSelectedIds.add(cb.dataset.id);
  });
  document.getElementById('khaznaSelectAll').checked = true;
}

function parseReceiptProducts(text) {
  const lines = String(text || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  return lines.map(line => {
    const clean = line.replace(/^\d+\)\s*/, '').trim();
    const m = clean.match(/^(.*?)\s*\|\s*([\d.]+)\s*[×x]\s*(\d+)/);
    if (m) {
      return { name: m[1].trim(), price: Number(m[2] || 0), qty: Number(m[3] || 1) };
    }
    return { name: clean, price: 0, qty: 1 };
  });
}


async function printSingleOrder(orderId) {
  let order = khaznaOrders.find(o => String(o.id) === String(orderId));
  if (!order) return;
  order = await ensureOrderIdentifiers(order);
  const win = window.open('', '_blank', 'width=400,height=700');
  win.document.write(generateReceiptHTML(order, currentBranchName));
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

async function printSelectedOrders() {
  if (!khaznaSelectedIds.size) { alert('اختر أوردر واحد على الأقل للطباعة'); return; }
  const selected = [];
  for (const o of khaznaOrders.filter(o => khaznaSelectedIds.has(String(o.id)))) selected.push(await ensureOrderIdentifiers(o));
  const win = window.open('', '_blank', 'width=400,height=700');
  let combined = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
  <style>@media print { .page-break { page-break-after: always; } }</style></head><body>`;
  selected.forEach((o, idx) => {
    const doc = new DOMParser().parseFromString(generateReceiptHTML(o, currentBranchName), 'text/html');
    combined += '<div class="page-break">' + doc.body.innerHTML + '</div>';
  });
  combined += '</body></html>';
  win.document.write(combined);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

function printKhaznaReport() {
  if (!canViewKhazna()) {
    alert('تقرير الخزنة متاح للأدمن ومدير الحسابات فقط');
    return;
  }

  const from = document.getElementById('khaznaFromDate')?.value || '—';
  const to   = document.getElementById('khaznaToDate')?.value || '—';

  const reportOrders = getKhaznaFilteredOrders();
  if (!reportOrders.length) {
    alert('لا توجد أوردرات مطابقة للفلاتر الحالية');
    return;
  }

  const originalKhaznaOrdersForCalc = khaznaOrders;
  khaznaOrders = reportOrders;
  const totalSales = reportOrders
    .filter(o => o.status === 'Signed')
    .reduce((s, o) => s + Number(o.price || 0), 0);
  const return14Total = reportOrders
    .filter(isReturnWithin14Days)
    .reduce((s, o) => s + Number(o.price || 0), 0);
  const shippingTotal = getKhaznaShippingTotal();
  const transfersTotal = getKhaznaTransfersTotal();
  const net = totalSales - return14Total - shippingTotal - transfersTotal;
  khaznaOrders = originalKhaznaOrdersForCalc;

  const printDate = new Date().toLocaleDateString('en-GB') + ' ' +
    new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});

  const orderRows = reportOrders.map((o, i) => `
    <tr>
      <td class="num-cell">${i + 1}</td>
      <td class="arabic-cell customer-cell">${escapeHTML(o.customer_name || '')}</td>
      <td class="phone-cell">${escapeHTML(o.phone || '')}</td>
      <td class="arabic-cell doctor-cell">${escapeHTML(o.doctor_name || '—')}</td>
      <td class="ticket-cell">${escapeHTML(o.order_number || '—')}</td>
      <td class="arabic-cell products-cell">${escapeHTML(o.product_names || '—')}</td>
      <td class="money-cell">${enMoney(o.price)}</td>
      <td class="money-cell">${Number(o.deposit || 0) > 0 ? enMoney(o.deposit) : '—'}</td>
      <td class="status-cell"><span>${escapeHTML(getOrderDisplayStatus(o))}</span></td>
    </tr>`).join('');

  const downloadRows = reportOrders.map((o, i) => ({
    '#': i + 1,
    'العميل': o.customer_name || '',
    'الموبايل': o.phone || '',
    'الدكتور': o.doctor_name || '',
    'رقم الأوردر': o.order_number || '',
    'المنتجات': o.product_names || '',
    'السعر': Number(o.price || 0),
    'المدفوع': Number(o.deposit || 0),
    'الحالة': getOrderDisplayStatus(o)
  }));

  const safeDownloadRowsJSON = JSON.stringify(downloadRows).replace(/</g, '\\u003c');
  const reportFileBase = `khazna-report-${String(currentBranchName || 'branch').replace(/[^\w\u0600-\u06FF-]+/g, '-')}-${from}-to-${to}`;

  const reportHTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير الخزنة</title>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>
<style>
  * { box-sizing:border-box; }
  body {
    margin:0;
    padding:18px;
    color:#111827;
    background:#ffffff;
    font-family:Tahoma, Arial, sans-serif;
    font-size:12px;
    font-weight:700;
  }
  .report-actions {
    display:flex;
    justify-content:flex-start;
    margin-bottom:14px;
  }
  .download-wrap { position:relative; display:inline-flex; }
  .download-btn {
    border:none;
    border-radius:9px;
    padding:9px 14px;
    background:#0f766e;
    color:#fff;
    font-weight:800;
    cursor:pointer;
    font-size:12px;
  }
  .download-menu {
    display:none;
    position:absolute;
    top:calc(100% + 6px);
    left:0;
    min-width:170px;
    background:#fff;
    border:1px solid #d1d5db;
    border-radius:9px;
    box-shadow:0 10px 28px rgba(0,0,0,.16);
    overflow:hidden;
    z-index:9999;
  }
  .download-menu.show { display:block; }
  .download-menu button {
    width:100%;
    border:none;
    background:#fff;
    padding:10px 12px;
    text-align:left;
    cursor:pointer;
    font-weight:700;
    font-size:12px;
  }
  .download-menu button:hover { background:#f3f4f6; }

  #reportPdfArea { background:#fff; padding:2px; }
  h1 { font-size:20px; margin:0 0 5px; }
  .meta { color:#4b5563; margin-bottom:15px; }
  .stats {
    display:grid;
    grid-template-columns:repeat(5, minmax(125px, 1fr));
    gap:10px;
    margin-bottom:17px;
  }
  .stat-box {
    border:1px solid #d1d5db;
    border-radius:8px;
    padding:10px 12px;
    text-align:center;
    min-height:62px;
  }
  .stat-box .label { font-size:10px; color:#6b7280; margin-bottom:4px; }
  .stat-box .value {
    font-size:18px;
    font-weight:800;
    direction:ltr;
    unicode-bidi:isolate;
  }

  table {
    width:100%;
    border-collapse:collapse;
    table-layout:fixed;
    margin-top:8px;
  }
  thead { display:table-header-group; }
  th {
    background:#f3f4f6;
    border-bottom:1px solid #d1d5db;
    padding:6px 5px;
    font-size:10px;
    text-align:right;
    white-space:nowrap;
  }
  td {
    border-bottom:1px solid #e5e7eb;
    padding:5px;
    vertical-align:top;
    line-height:1.45;
    overflow-wrap:anywhere;
  }
  tr { page-break-inside:avoid; break-inside:avoid; }

  th:nth-child(1), td:nth-child(1) { width:4%; }
  th:nth-child(2), td:nth-child(2) { width:12%; }
  th:nth-child(3), td:nth-child(3) { width:11%; }
  th:nth-child(4), td:nth-child(4) { width:12%; }
  th:nth-child(5), td:nth-child(5) { width:8%; }
  th:nth-child(6), td:nth-child(6) { width:31%; }
  th:nth-child(7), td:nth-child(7) { width:8%; }
  th:nth-child(8), td:nth-child(8) { width:7%; }
  th:nth-child(9), td:nth-child(9) { width:7%; }

  .arabic-cell {
    direction:rtl;
    text-align:right;
    unicode-bidi:plaintext;
  }
  .customer-cell, .doctor-cell {
    font-weight:600;
    word-spacing:normal;
    letter-spacing:0;
  }
  .phone-cell, .ticket-cell, .money-cell, .num-cell {
    direction:ltr;
    text-align:center;
    unicode-bidi:isolate;
    white-space:nowrap;
    font-family:Arial, sans-serif;
  }
  .ticket-cell { font-weight:800; }
  .products-cell { font-size:9px; }
  .status-cell { text-align:center; }
  .status-cell span {
    display:inline-block;
    background:#e5e7eb;
    padding:2px 6px;
    border-radius:4px;
    font-size:9px;
    white-space:nowrap;
  }
  .net-line {
    margin-top:16px;
    border-top:2px solid #111;
    padding-top:8px;
    font-weight:800;
    font-size:14px;
    direction:ltr;
    text-align:right;
  }

  @media print {
    @page { size:A4 landscape; margin:8mm; }
    .report-actions { display:none !important; }
    body { padding:0; font-size:10px; }
    #reportPdfArea { padding:0; }
    h1 { font-size:17px; }
    .meta { font-size:9px; margin-bottom:10px; }
    .stats { gap:6px; margin-bottom:10px; }
    .stat-box { min-height:50px; padding:7px 8px; }
    .stat-box .value { font-size:15px; }
    th { font-size:8px; padding:4px 3px; }
    td { font-size:8px; padding:3px; line-height:1.35; }
    .products-cell, .status-cell span { font-size:7px; }
  }
</style>
</head>
<body>
  <div class="report-actions">
    <div class="download-wrap">
      <button class="download-btn" type="button" onclick="toggleDownloadMenu(event)">⬇ Download</button>
      <div id="reportDownloadMenu" class="download-menu">
        <button type="button" onclick="downloadReportExcel()">Download Excel</button>
        <button type="button" onclick="downloadReportPDF()">Download PDF</button>
      </div>
    </div>
  </div>

  <div id="reportPdfArea">
    <h1>🏦 تقرير الخزنة — فرع ${escapeHTML(currentBranchName)}</h1>
    <div class="meta">الفترة: ${from} → ${to} | طُبع في: ${printDate}</div>

    <div class="stats">
      <div class="stat-box"><div class="label">إجمالي المبيعات</div><div class="value" style="color:#6366f1;">${enMoney(totalSales)}</div></div>
      <div class="stat-box"><div class="label">مصروفات الشحن</div><div class="value" style="color:#ef4444;">${enMoney(shippingTotal)}</div></div>
      <div class="stat-box"><div class="label">التحويلات</div><div class="value" style="color:#a855f7;">${enMoney(transfersTotal)}</div></div>
      <div class="stat-box"><div class="label">صافي اليومية</div><div class="value" style="color:#10b981;">${enMoney(net)}</div></div>
      <div class="stat-box"><div class="label">عدد الأوردرات</div><div class="value" style="color:#f59e0b;">${enNumber(reportOrders.length)}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>العميل</th>
          <th>الموبايل</th>
          <th>الدكتور</th>
          <th>رقم الأوردر</th>
          <th>المنتجات</th>
          <th>السعر</th>
          <th>المدفوع</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody>${orderRows}</tbody>
    </table>

    <div class="net-line">
      Net = ${enMoney(totalSales)} - ${enMoney(shippingTotal)} - ${enMoney(transfersTotal)}
      = <span style="color:#10b981;">${enMoney(net)}</span>
    </div>
  </div>

<script>
  const reportRows = ${safeDownloadRowsJSON};
  const reportFileBase = ${JSON.stringify(reportFileBase)};

  function toggleDownloadMenu(ev) {
    if (ev) ev.stopPropagation();
    document.getElementById('reportDownloadMenu')?.classList.toggle('show');
  }

  document.addEventListener('click', function() {
    document.getElementById('reportDownloadMenu')?.classList.remove('show');
  });

  function downloadReportExcel() {
    if (typeof XLSX === 'undefined') {
      alert('تعذر تحميل أداة Excel. تأكد من اتصال الإنترنت وحاول مرة أخرى.');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(reportRows);
    ws['!cols'] = [
      {wch:6},{wch:24},{wch:16},{wch:22},{wch:14},{wch:70},{wch:12},{wch:12},{wch:12}
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, reportFileBase + '.xlsx');
    document.getElementById('reportDownloadMenu')?.classList.remove('show');
  }

  function downloadReportPDF() {
    if (typeof html2pdf === 'undefined') {
      alert('تعذر تحميل أداة PDF. تأكد من اتصال الإنترنت وحاول مرة أخرى.');
      return;
    }
    document.getElementById('reportDownloadMenu')?.classList.remove('show');

    const element = document.getElementById('reportPdfArea');
    if (!element) return;

    // Fit to One Page Width: التقرير كله في صفحة PDF واحدة طويلة بدون فصل الصفوف
    const marginMm = 5;
    const pageWidthMm = 297;
    const contentWidthPx = Math.max(element.scrollWidth, element.offsetWidth, 1);
    const contentHeightPx = Math.max(element.scrollHeight, element.offsetHeight, 1);
    const usableWidthMm = pageWidthMm - (marginMm * 2);
    const fittedHeightMm = (contentHeightPx / contentWidthPx) * usableWidthMm;
    const pageHeightMm = Math.max(210, Math.ceil(fittedHeightMm + (marginMm * 2)));

    const options = {
      margin:[marginMm,marginMm,marginMm,marginMm],
      filename:reportFileBase + '.pdf',
      image:{type:'jpeg', quality:0.99},
      html2canvas:{
        scale:2.6,
        useCORS:true,
        scrollX:0,
        scrollY:0,
        backgroundColor:'#ffffff',
        logging:false,
        windowWidth:contentWidthPx
      },
      jsPDF:{
        unit:'mm',
        format:[pageWidthMm,pageHeightMm],
        orientation:'landscape',
        compress:true
      },
      pagebreak:{mode:['avoid-all']}
    };

    html2pdf().set(options).from(element).save();
  }
<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1100,height=760');
  if (!win) {
    alert('المتصفح منع نافذة التقرير. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.');
    return;
  }
  win.document.write(reportHTML);
  win.document.close();
  win.onload = () => {
    win.focus();
    win.print();
  };
}

async function printBranchOrderReceipt(orderId) {
  let order = branchOrders.find(o => String(o.id) === String(orderId));
  if (!order) { alert('مش لاقي بيانات الأوردر دا للطباعة'); return; }
  order = await ensureOrderIdentifiers(order);
  const win = window.open('', '_blank', 'width=400,height=700');
  win.document.write(generateReceiptHTML(order, currentBranchName || order.branch || ''));
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ===== تحصيل الأوردر =====
let _collectOrderId   = null;
let _collectOrderSrc  = null;
let _collectPaymentMethod = 'COD';
let _collectExistingProof = '';

function selectCollectPaymentMethod(method) {
  _collectPaymentMethod = method || 'COD';
  ['COD','Instapay','Wallet'].forEach(m => {
    const el = document.getElementById('collectPay' + m);
    if (el) el.checked = (m === _collectPaymentMethod);
  });
  const proofWrap = document.getElementById('collectProofWrap');
  const proofHint = document.getElementById('collectProofHint');
  if (proofWrap) proofWrap.style.display = (_collectPaymentMethod === 'COD') ? 'none' : 'block';
  if (proofHint) {
    proofHint.textContent = _collectPaymentMethod === 'COD'
      ? ''
      : '⚠️ يجب إرفاق إثبات الدفع قبل تأكيد التحصيل.';
  }
}

function previewCollectProof(input) {
  const file = input.files[0];
  if (!file) return;
  if (!validateImageFile(file)) { input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('collectProofPreview');
    const img = document.getElementById('collectProofImg');
    if (preview && img) {
      img.src = e.target.result;
      preview.style.display = 'flex';
    }
    const hint = document.getElementById('collectProofHint');
    if (hint) hint.textContent = '✅ تم اختيار إثبات الدفع.';
  };
  reader.readAsDataURL(file);
}

function clearCollectProof() {
  const input = document.getElementById('collectProofInput');
  const preview = document.getElementById('collectProofPreview');
  if (input) input.value = '';
  if (preview) preview.style.display = 'none';
  const hint = document.getElementById('collectProofHint');
  if (hint && _collectPaymentMethod !== 'COD') hint.textContent = '⚠️ يجب إرفاق إثبات الدفع قبل تأكيد التحصيل.';
}

function getLatestCollectPaymentMethod(order) {
  const last = getLatestCollectEntry(order);
  return last && last.payment_method ? String(last.payment_method) : 'COD';
}

function openCollectModal(orderId, customerName, price, deposit, src) {
  if (!canCollectOrders()) { alert('زر التحصيل متاح للكاشير والأدمن ومدير الحسابات فقط'); return; }
  const lockedOrder = getOrderByIdAny(orderId);
  if (lockedOrder && isOrderLockedByDaily(lockedOrder)) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  const order = getOrderByIdAny(orderId);
  if (order && !canCurrentUserCollect(order)) {
    alert('تم استهلاك مرتين التحصيل المتاحة للموظف. أي تعديل جديد يتم من خلال الأدمن فقط.');
    return;
  }

  _collectOrderId  = orderId;
  _collectOrderSrc = src || 'branch';
  document.getElementById('collectOrderModal').style.display = 'flex';
  document.getElementById('collectCustomerLabel').textContent = customerName ? `العميل: ${customerName}` : 'تسوية المبلغ المحصّل من المندوب';

  const meta = order ? getCollectMeta(order) : { history: [] };
  const history = Array.isArray(meta.history) ? meta.history : [];
  const last = history.length ? history[history.length - 1] : null;

  // لو آخر تحصيل اتسجل بصفر، نرجّع في نافذة التعديل الحسبة الأصلية تلقائيًا
  // حتى يقدر الأدمن يصحح الأوردر بسهولة لو الصفر اتكتب بالغلط.
  const previousNormalSales = [...history].reverse().find(x => Number(x?.sales || 0) > 0);
  const savedOriginalPrice = Number(last?.original_price || previousNormalSales?.original_price || previousNormalSales?.sales || 0);
  const calculationPrice = savedOriginalPrice > 0 ? savedOriginalPrice : Number(price || 0);
  const normalRemaining = Math.max(calculationPrice - Number(deposit || 0), 0);
  const salesValue = last
    ? (Number(last.sales || 0) === 0 ? normalRemaining : Number(last.sales || 0))
    : (normalRemaining > 0 ? normalRemaining : (calculationPrice || ''));

  document.getElementById('collectSalesInput').value = salesValue;
  document.getElementById('collectShippingInput').value = last ? Number(last.shipping || 0) : '';

  _collectExistingProof = order && order.payment_image ? String(order.payment_image) : '';
  const proofInput = document.getElementById('collectProofInput');
  if (proofInput) proofInput.value = '';
  const proofPreview = document.getElementById('collectProofPreview');
  const proofImg = document.getElementById('collectProofImg');
  if (_collectExistingProof && proofPreview && proofImg) {
    proofImg.src = _collectExistingProof;
    proofPreview.style.display = 'flex';
  } else if (proofPreview) {
    proofPreview.style.display = 'none';
  }
  selectCollectPaymentMethod(last && last.payment_method ? last.payment_method : 'COD');
  calcCollect();
}

function closeCollectModal() {
  document.getElementById('collectOrderModal').style.display = 'none';
  _collectOrderId  = null;
  _collectOrderSrc = null;
  _collectPaymentMethod = 'COD';
  _collectExistingProof = '';
  clearCollectProof();
}

function calcCollect() {
  const sales    = parseFloat(document.getElementById('collectSalesInput').value)    || 0;
  const shipping = parseFloat(document.getElementById('collectShippingInput').value) || 0;
  const net      = sales - shipping;

  const cSalesEl = document.getElementById('cSales');
  const cShippingEl = document.getElementById('cShipping');
  const cRatioEl = document.getElementById('cRatio');
  const cMarginEl = document.getElementById('cMargin');

  if (cSalesEl) cSalesEl.textContent = sales.toLocaleString('ar-EG', {minimumFractionDigits:2}) + ' ج.م';
  if (cShippingEl) cShippingEl.textContent = shipping.toLocaleString('ar-EG', {minimumFractionDigits:2}) + ' ج.م';
  document.getElementById('cNet').textContent = net.toLocaleString('ar-EG', {minimumFractionDigits:2}) + ' ج.م';

  const ratio  = sales > 0 ? ((shipping / sales) * 100).toFixed(1) : 0;
  const margin = sales > 0 ? ((net / sales) * 100).toFixed(1)      : 0;
  if (cRatioEl) cRatioEl.textContent = ratio + '%';
  if (cMarginEl) cMarginEl.textContent = margin + '%';

  const box    = document.getElementById('collectNetBox');
  const status = document.getElementById('cStatus');
  const netEl  = document.getElementById('cNet');

  if (net > 0) {
    box.style.borderColor  = 'rgba(16,185,129,0.4)';
    box.style.background   = 'rgba(16,185,129,0.06)';
    netEl.style.color      = '#10b981';
    status.textContent     = '✅ جاهز للتحصيل';
    status.style.background= 'rgba(16,185,129,0.15)';
    status.style.color     = '#10b981';
  } else if (net < 0) {
    box.style.borderColor  = 'rgba(239,68,68,0.4)';
    box.style.background   = 'rgba(239,68,68,0.06)';
    netEl.style.color      = '#ef4444';
    status.textContent     = '⚠️ عجز — راجع المصاريف';
    status.style.background= 'rgba(239,68,68,0.15)';
    status.style.color     = '#ef4444';
  } else {
    box.style.borderColor  = 'rgba(100,116,139,0.3)';
    box.style.background   = 'var(--bg-soft)';
    netEl.style.color      = 'var(--text-muted)';
    status.textContent     = 'أدخل البيانات';
    status.style.background= 'var(--bg-soft)';
    status.style.color     = 'var(--text-muted)';
  }
}

async function confirmCollectOrder() {
  if (!canCollectOrders()) { alert('زر التحصيل متاح للكاشير والأدمن ومدير الحسابات فقط'); return; }
  if (!_collectOrderId) return;

  const sales    = parseFloat(document.getElementById('collectSalesInput').value)    || 0;
  const shipping = parseFloat(document.getElementById('collectShippingInput').value) || 0;
  const net      = sales - shipping;
  const customerLabel = document.getElementById('collectCustomerLabel').textContent;
  const paymentMethod = _collectPaymentMethod || 'COD';
  const proofInput = document.getElementById('collectProofInput');
  const proofFile = proofInput && proofInput.files && proofInput.files.length ? proofInput.files[0] : null;

  if (paymentMethod !== 'COD' && !proofFile && !_collectExistingProof) {
    alert('⚠️ لازم ترفق إثبات الدفع الأول لو طريقة الدفع Instapay أو Wallet.');
    if (proofInput) proofInput.focus();
    return;
  }

  if (proofFile && !validateImageFile(proofFile)) return;

  const confirmBtn = document.querySelector('#collectOrderModal button[onclick="confirmCollectOrder()"]');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'جاري التحصيل...'; }

  try {
    const currentOrder = getOrderByIdAny(_collectOrderId);
    if (currentOrder && !canCurrentUserCollect(currentOrder)) {
      alert('تم استهلاك مرتين التحصيل المتاحة للموظف. أي تعديل جديد يتم من خلال الأدمن فقط.');
      return;
    }

    const oldNotes = currentOrder ? String(currentOrder.notes || '') : '';
    const meta = currentOrder ? getCollectMeta(currentOrder) : { count: 0, history: [] };
    const newCount = Number(meta.count || 0) + 1;
    const updatedMeta = {
      count: newCount,
      history: [
        ...(Array.isArray(meta.history) ? meta.history : []),
        {
          at: new Date().toISOString(),
          by: currentUser ? (currentUser.name || currentUser.username || 'User') : 'User',
          role: currentUser ? (currentUser.role || '') : '',
          sales,
          shipping,
          net,
          // نحفظ السعر الطبيعي قبل أي تحويل للصفر حتى يمكن استعادته عند إعادة التعديل.
          original_price: Number(
            currentOrder?.price ||
            [...(Array.isArray(meta.history) ? meta.history : [])].reverse().find(x => Number(x?.original_price || 0) > 0)?.original_price ||
            [...(Array.isArray(meta.history) ? meta.history : [])].reverse().find(x => Number(x?.sales || 0) > 0)?.sales ||
            0
          ),
          payment_method: paymentMethod,
          proof_url: _collectExistingProof || ''
        }
      ]
    };
    let proofUrl = _collectExistingProof;
    if (proofFile) {
      const uploadedUrl = await uploadPaymentImage(proofFile, _collectOrderId);
      if (!uploadedUrl) throw new Error('فشل رفع إثبات الدفع');
      proofUrl = uploadedUrl;
      const h = updatedMeta.history;
      if (h && h.length) h[h.length - 1].proof_url = proofUrl;
    }

    const updatedNotes = buildNotesWithCollectMeta(oldNotes, updatedMeta);

    const collectUpdateData = { status: 'Signed', notes: updatedNotes, payment_image: proofUrl || null };
    // للأدمن فقط: عمود السعر يأخذ نفس قيمة إجمالي مبيعات التوصيل.
    // الصفر يُحفظ كأوردر هدية، ولو أعيد فتح التحصيل تظهر الحسبة الأصلية للتصحيح.
    if (isAdmin()) collectUpdateData.price = sales;

    const { error } = await supabaseClient
      .from('orders')
      .update(collectUpdateData)
      .eq('id', _collectOrderId);

    if (error) throw error;

    [branchOrders, khaznaOrders, orders].forEach(arr => {
      if (!Array.isArray(arr)) return;
      const idx = arr.findIndex(o => String(o.id) === String(_collectOrderId));
      if (idx !== -1) {
        arr[idx].status = 'Signed';
        arr[idx].notes = updatedNotes;
        arr[idx].payment_image = proofUrl || arr[idx].payment_image || null;
        if (isAdmin()) arr[idx].price = sales;
      }
    });

    if (typeof renderBranchOrders === 'function') renderBranchOrders();
    if (typeof renderKhaznaOrders === 'function') renderKhaznaOrders();
    if (typeof renderKhaznaStats  === 'function') renderKhaznaStats();
    if (typeof renderOrders       === 'function') renderOrders();
    if (typeof renderAnalytics    === 'function') renderAnalytics();

    await logActivity('order_collected','تم تحصيل أوردر',`إجمالي المبيعات: ${money(sales)} | مصروف الشحن: ${money(shipping)} | الصافي: ${money(net)} | الطريقة: ${paymentMethod} | مرة التحصيل: ${newCount}`,getActivityOrderInfo(currentOrder));
    if (proofFile && proofUrl) {
      await logActivity('payment_proof_attached','تم إرفاق إثبات دفع أثناء التحصيل',`العميل: ${currentOrder?.customer_name || '—'} | طريقة الدفع: ${paymentMethod} | مرة التحصيل: ${newCount}`,getActivityOrderInfo(currentOrder));
    }

    const finalNotice = newCount >= 2 ? '\n\nتم تسليم وتحصيل هذا الأوردر، لا يجوز التعديل على أوردر تم تسليمه.' : '';
    alert(`✅ تم تحصيل الأوردر بنجاح\n${customerLabel}\n\nإجمالي المبيعات: ${sales.toLocaleString('ar-EG')} ج.م\nمصاريف الشحن: ${shipping.toLocaleString('ar-EG')} ج.م\nصافي المحصّل: ${net.toLocaleString('ar-EG')} ج.م\n\n📌 تم تحويل حالة الأوردر إلى Signed${finalNotice}`);
    closeCollectModal();

  } catch(err) {
    alert('حصلت مشكلة في تحديث الأوردر: ' + err.message);
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✅ تحصيل الأوردر'; }
  }
}

// ===== مطابقة اليومية =====
function openDailyReconciliationModal() {
  const modal = document.getElementById('dailyReconciliationModal');
  modal.style.display = 'flex';

  const salesEl  = document.getElementById('kTotalSales');
  const shipEl   = document.getElementById('kShippingCost');
  const countEl  = document.getElementById('kOrderCount');

  const salesVal  = parseFloat((salesEl  ? salesEl.textContent  : '0').replace(/[^\d.]/g,'')) || 0;
  const shipVal   = parseFloat((shipEl   ? shipEl.textContent   : '0').replace(/[^\d.]/g,'')) || 0;
  const countVal  = parseInt  ((countEl  ? countEl.textContent  : '0').replace(/[^\d]/g,''))  || 0;

  document.getElementById('reconcileSales').value    = salesVal  || '';
  document.getElementById('reconcileShipping').value = shipVal   || '';
  document.getElementById('rOrderCount').textContent = countVal;

  calcReconcile();
}

function closeDailyReconciliationModal() {
  document.getElementById('dailyReconciliationModal').style.display = 'none';
}

function calcReconcile() {
  const sales    = parseFloat(document.getElementById('reconcileSales').value)    || 0;
  const shipping = parseFloat(document.getElementById('reconcileShipping').value) || 0;
  const net      = sales - shipping;

  document.getElementById('rSales').textContent    = sales.toLocaleString('ar-EG', {minimumFractionDigits:2}) + ' ج.م';
  document.getElementById('rShipping').textContent = shipping.toLocaleString('ar-EG', {minimumFractionDigits:2}) + ' ج.م';
  document.getElementById('rNet').textContent      = net.toLocaleString('ar-EG', {minimumFractionDigits:2}) + ' ج.م';

  const ratio  = sales > 0 ? ((shipping / sales) * 100).toFixed(1) : 0;
  const margin = sales > 0 ? ((net / sales) * 100).toFixed(1)      : 0;
  document.getElementById('rExpenseRatio').textContent = ratio  + '%';
  document.getElementById('rMargin').textContent       = margin + '%';

  const box    = document.getElementById('reconcileResultBox');
  const status = document.getElementById('rStatus');
  const netEl  = document.getElementById('rNet');

  if (net > 0) {
    box.style.borderColor  = 'rgba(16,185,129,0.4)';
    box.style.background   = 'rgba(16,185,129,0.06)';
    netEl.style.color      = '#10b981';
    status.textContent     = '✅ مطابق — جاهز للتسليم';
    status.style.background= 'rgba(16,185,129,0.15)';
    status.style.color     = '#10b981';
  } else if (net < 0) {
    box.style.borderColor  = 'rgba(239,68,68,0.4)';
    box.style.background   = 'rgba(239,68,68,0.06)';
    netEl.style.color      = '#ef4444';
    status.textContent     = '⚠️ عجز في الخزنة';
    status.style.background= 'rgba(239,68,68,0.15)';
    status.style.color     = '#ef4444';
  } else {
    box.style.borderColor  = 'rgba(100,116,139,0.3)';
    box.style.background   = 'var(--bg-soft)';
    netEl.style.color      = 'var(--text-muted)';
    status.textContent     = 'أدخل البيانات للحساب';
    status.style.background= 'var(--bg-soft)';
    status.style.color     = 'var(--text-muted)';
  }
}

function printReconciliationReport() {
  const sales    = parseFloat(document.getElementById('reconcileSales').value)    || 0;
  const shipping = parseFloat(document.getElementById('reconcileShipping').value) || 0;
  const net      = sales - shipping;
  const orders   = document.getElementById('rOrderCount').textContent || '0';
  const ratio    = document.getElementById('rExpenseRatio').textContent || '0%';
  const margin   = document.getElementById('rMargin').textContent     || '0%';
  const branchName = typeof currentBranchName !== 'undefined' ? currentBranchName : '—';
  const printDate  = new Date().toLocaleDateString('ar-EG') + ' ' + new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});

  const fromVal = document.getElementById('khaznaFromDate') ? document.getElementById('khaznaFromDate').value || '—' : '—';
  const toVal   = document.getElementById('khaznaToDate')   ? document.getElementById('khaznaToDate').value   || '—' : '—';

  const statusText = net > 0 ? '✅ مطابق — جاهز للتسليم' : net < 0 ? '⚠️ عجز في الخزنة' : '—';
  const netColor   = net >= 0 ? '#10b981' : '#ef4444';

  const html = `<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>مطابقة اليومية</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;padding:30px;color:#000;font-size:14px;font-weight:700;max-width:700px;margin:0 auto;}
  h1{font-size:22px;margin-bottom:4px;color:#111;}
  .meta{font-size:12px;color:#666;margin-bottom:20px;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;}
  .box{border:1px solid #ddd;border-radius:10px;padding:16px;text-align:center;}
  .box .lbl{font-size:11px;color:#888;margin-bottom:6px;}
  .box .val{font-size:22px;font-weight:bold;}
  .net-box{border:2px solid ${netColor};border-radius:14px;padding:22px;text-align:center;margin-bottom:18px;background:#f9f9f9;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
  .info-box{border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center;background:#f9fafb;}
  .info-box .lbl{font-size:10px;color:#888;}
  .info-box .val{font-size:16px;font-weight:bold;margin-top:4px;}
  .formula{text-align:center;padding:10px;color:#555;font-size:13px;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;margin:14px 0;}
  @media print{@page{size:A5;margin:12mm;}body{padding:0;}}
</style></head>
<body>
  <h1>⚖️ مطابقة اليومية — ${branchName}</h1>
  <div class="meta">الفترة: ${fromVal} → ${toVal} &nbsp;|&nbsp; طُبع في: ${printDate}</div>
  <div class="grid">
    <div class="box"><div class="lbl">💰 إجمالي مبيعات التوصيل</div><div class="val" style="color:#6366f1;">${sales.toLocaleString('ar-EG',{minimumFractionDigits:2})} ج.م</div></div>
    <div class="box"><div class="lbl">🚚 إجمالي مصروفات الشحنات</div><div class="val" style="color:#ef4444;">${shipping.toLocaleString('ar-EG',{minimumFractionDigits:2})} ج.م</div></div>
  </div>
  <div class="formula">إجمالي المبيعات (${sales.toLocaleString('ar-EG')}) − مصاريف الشحن (${shipping.toLocaleString('ar-EG')}) = صافي الخزنة</div>
  <div class="net-box">
    <div style="font-size:12px;color:#555;margin-bottom:8px;">💵 صافي الخزنة (المبلغ المحصّل من المندوب)</div>
    <div style="font-size:36px;font-weight:bold;color:${netColor};">${net.toLocaleString('ar-EG',{minimumFractionDigits:2})} ج.م</div>
    <div style="margin-top:8px;font-size:13px;font-weight:bold;color:${netColor};">${statusText}</div>
  </div>
  <div class="info-grid">
    <div class="info-box"><div class="lbl">عدد الأوردرات</div><div class="val" style="color:#f59e0b;">${orders}</div></div>
    <div class="info-box"><div class="lbl">نسبة المصاريف</div><div class="val" style="color:#ef4444;">${ratio}</div></div>
    <div class="info-box"><div class="lbl">هامش الربح</div><div class="val" style="color:#10b981;">${margin}</div></div>
  </div>
  <div style="margin-top:24px;border-top:2px solid #000;padding-top:12px;font-size:13px;color:#555;text-align:center;">توقيع المحاسب: ________________ &nbsp;&nbsp;&nbsp; توقيع المندوب: ________________</div>
</body></html>`;

  const win = window.open('','_blank','width=750,height:700');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ============================================================
// ===== BARCODE SCANNER - GLOBAL =====
// ============================================================

// يسمح بالـ Scan حتى لو المؤشر مش واقف داخل خانة البحث.
let barcodeScanBuffer = '';
let barcodeScanTimer = null;

function isElementVisibleById(id) {
  const el = document.getElementById(id);
  return !!(el && !el.classList.contains('hidden'));
}

function getActiveBarcodeSearchInput() {
  if (isElementVisibleById('khaznaPage')) return document.getElementById('khaznaBarcodeSearch');
  if (isElementVisibleById('branchPage')) return document.getElementById('bSearchInput');
  if (isElementVisibleById('ordersPage')) return document.getElementById('searchInput');
  return null;
}

function findOrderByScannedValue(value) {
  const raw = String(value || '').trim();
  const digits = onlyDigits(raw);
  if (!raw) return null;

  const pools = [];
  if (Array.isArray(branchOrders)) pools.push(...branchOrders);
  if (Array.isArray(khaznaOrders)) pools.push(...khaznaOrders);
  if (Array.isArray(orders)) pools.push(...orders);

  const unique = [];
  const seen = new Set();
  pools.forEach(order => {
    if (!order || seen.has(String(order.id))) return;
    seen.add(String(order.id));
    unique.push(order);
  });

  // الكاشير يرى أوردرات الفروع المسندة له فقط.
  const allowed = unique.filter(order => {
    if (!isCashier() && !isStoreManager()) return true;
    const managed = getCurrentUserManagedBranches();
    const managedShipping = managed.map(getBranchShippingCompanyName);
    return managed.includes(order.branch) || managed.includes(order.shipping_company) || managedShipping.includes(order.shipping_company);
  });

  const exact = allowed.find(order => {
    const values = [order.order_barcode, getOrderBarcode(order), order.ticket_id, getTicketId(order), order.order_number];
    return values.some(v => {
      const text = String(v || '').trim();
      return text === raw || (digits && onlyDigits(text) === digits);
    });
  });
  if (exact) return exact;

  return allowed.find(order => matchesOrderSearch(order, raw)) || null;
}

function openCollectionFromScan(value, sourceHint) {
  if (!canCollectOrders()) return false;
  const order = findOrderByScannedValue(value);
  if (!order) {
    alert('❌ هذا الباركود غير موجود');
    return false;
  }

  const source = sourceHint || (isElementVisibleById('khaznaPage') ? 'khazna' : 'branch');
  openCollectModal(
    order.id,
    order.customer_name || '',
    Number(order.price || 0),
    Number(order.deposit || 0),
    source
  );
  return true;
}

function runBarcodeSearch(value) {
  const input = getActiveBarcodeSearchInput();
  const cleanValue = String(value || '').trim();
  if (!input || !cleanValue) return;
  input.value = cleanValue;
  input.focus();

  if (input.id === 'bSearchInput') {
    branchPageNum = 1;
    renderBranchOrders();
    openCollectionFromScan(cleanValue, 'branch');
  } else if (input.id === 'khaznaBarcodeSearch') {
    renderKhaznaStats();
    renderKhaznaOrders();
    openCollectionFromScan(cleanValue, 'khazna');
  } else if (input.id === 'searchInput') {
    pageState.orders = 1;
    renderOrders();
    openCollectionFromScan(cleanValue, 'branch');
  }
}

function initGlobalBarcodeScanner() {
  document.addEventListener('keydown', function(ev) {
    const active = document.activeElement;
    const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
    const isTypingField = tag === 'input' || tag === 'textarea' || tag === 'select' || (active && active.isContentEditable);
    if (isTypingField) return;

    if (ev.key === 'Enter') {
      const scanned = barcodeScanBuffer.trim();
      barcodeScanBuffer = '';
      if (barcodeScanTimer) clearTimeout(barcodeScanTimer);
      if (scanned.length >= 4) {
        ev.preventDefault();
        runBarcodeSearch(scanned);
      }
      return;
    }

    if (ev.key && ev.key.length === 1) {
      barcodeScanBuffer += ev.key;
      if (barcodeScanTimer) clearTimeout(barcodeScanTimer);
      barcodeScanTimer = setTimeout(() => { barcodeScanBuffer = ''; }, 180);
    }
  });
  console.log('✅ Global Barcode Scanner initialized');
}

// ============================================================
// ===== GENERATE CODE128 BARCODE SVG =====
// ============================================================

function code128PatternTable() {
  return [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ];
}

function generateCode128BarcodeSVG(value) {
  const raw = String(value || '').trim();
  const data = raw.replace(/[^0-9A-Za-z\-\.\s]/g, '');
  if (!data) return '';

  const patterns = code128PatternTable();
  const codes = [104];
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i) - 32;
    if (code < 0 || code > 95) continue;
    codes.push(code);
  }

  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(106);

  const moduleW = 2.2;
  const barH = 58;
  const quiet = 18;
  let x = quiet;
  let rects = '';

  codes.forEach(code => {
    const pattern = patterns[code];
    if (!pattern) return;
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]) * moduleW;
      if (i % 2 === 0) rects += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${barH}"/>`;
      x += w;
    }
  });

  const width = x + quiet;
  return `<div class="barcode-svg-wrap"><svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" width="100%" height="${barH}" viewBox="0 0 ${width.toFixed(2)} ${barH}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><g fill="#000">${rects}</g></svg></div>`;
}

// ============================================================
// ===== تحديث دالة generateReceiptHTML =====
// ============================================================

// ✅ استبدل دالة generateReceiptHTML الموجودة بهذه النسخة المحدثة
// التي تستخدم SVG بدلاً من النص العادي للباركود

// 👇 دي النسخة المحدثة - استبدليها بالدالة القديمة
function generateReceiptHTML(order, branchName) {
  const qty       = Number(order.quantity || 1);
  const delivFee  = Number(order.delivery_fee || 0);
  const price     = Number(order.price || 0);
  const unitPrice = qty > 0 ? (price - delivFee) / qty : price;
  const deposit   = Number(order.deposit || 0);
  const remaining = price - deposit;
  const discount  = Number(getOrderMeta(order).discount || 0);
  const products  = parseReceiptProducts(order.product_names || '');
  const productsTotal = products.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.qty || 1)), 0) || Math.max(0, price - delivFee + discount);
  const ticketId  = getTicketId(order);
  const barcode1  = getOrderBarcode(order);
  
  // ✅ توليد باركود SVG
  const barcodeSvg = generateCode128BarcodeSVG(barcode1);
  
  const printDate = new Date().toLocaleDateString('ar-EG') + ' ' + new Date().toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'});
  const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString('ar-EG') + ' ' + new Date(order.created_at).toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'}) : '';

  const productRows = products.length > 0
    ? products.map(p => `
        <tr>
          <td style="padding:3px 0;font-size:11px;border-bottom:1px dashed #ccc;">${escapeHTML(p.name)}</td>
          <td style="padding:3px 0;font-size:11px;text-align:center;border-bottom:1px dashed #ccc;">${p.qty}</td>
          <td style="padding:3px 0;font-size:11px;text-align:center;border-bottom:1px dashed #ccc;">0</td>
          <td style="padding:3px 0;font-size:11px;text-align:right;border-bottom:1px dashed #ccc;">${enMoney(p.price * p.qty)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="padding:3px 0;font-size:11px;text-align:center;">—</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>إيصال — ${order.customer_name}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: Tahoma, Arial, sans-serif;
    width: 80mm;
    margin: 0 auto;
    padding: 8px;
    background: #fff;
    color: #000;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    text-rendering: geometricPrecision;
  }
  .center { text-align: center; }
  .bold { font-weight: 900; }
  .divider { border-top: 2px dashed #000; margin: 7px 0; }
  .divider-solid { border-top: 3px solid #000; margin: 7px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 12px; font-weight: 900; padding: 3px 0; }
  td { font-weight: 700; }
  .total-table td { padding: 4px 6px; font-size: 14px; }
  .total-table .label { font-weight: 900; }
  .total-table .value { text-align: left; font-weight: 900; }
  .barcode-text {
    font-family: Arial, sans-serif;
    font-size: 12px;
    letter-spacing: 1px;
    text-align: center;
    margin: 5px 0 2px;
    font-weight: 900;
  }
  .barcode-svg {
    display: flex;
    justify-content: center;
    margin: 4px auto;
    max-width: 100%;
  }
  .barcode-svg svg {
    max-width: 100%;
    height: auto;
  }
  .footer-note { font-size: 12px; font-weight: 700; text-align: center; line-height: 1.6; margin: 7px 0; }
  @media print {
    body { width: 80mm; }
    @page { size: 80mm auto; margin: 0; }
  }
</style>
</head>
<body>
  <!-- Header -->
  <div class="center bold" style="font-size:19px;font-weight:900;margin-bottom:3px;">صيدليات العقبي</div>
  <div class="center" style="font-size:13px;">0223051430 - 012 02 7777 04</div>
  <div class="center" style="font-size:12px;margin-bottom:2px;">مبيعات توصيل طلبات</div>
  <div class="center" style="font-size:12px;">فرع ${branchName}</div>

  <div class="divider-solid"></div>

  <!-- Order Info -->
  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
    <span>Ticket ID: <strong>${ticketId}</strong></span>
    <span>Time: ${orderDate}</span>
  </div>
  <div style="font-size:12px;margin-bottom:4px;">العميل: <strong>${order.customer_name || ''}</strong></div>
  <div style="font-size:12px;margin-bottom:4px;">الدكتور: <strong>${order.doctor_name || ''}</strong></div>
 <div style="font-size:12px;margin-bottom:4px;">رقم الأوردر: <strong>${order.order_number || '—'}</strong></div>
  <div style="font-size:12px;margin-bottom:4px;">الموبايل: <strong>${order.phone || ''}</strong></div>
  <div style="font-size:12px;margin-bottom:6px;">العنوان: <strong>${order.area || ''}</strong></div>

  <div class="divider"></div>

  <!-- Products Table -->
  <table>
    <thead>
      <tr>
        <th style="text-align:right;">المنتج</th>
        <th style="text-align:center;">كمية</th>
        <th style="text-align:center;">خصم</th>
        <th style="text-align:right;">سعر</th>
      </tr>
    </thead>
    <tbody>
      ${productRows}
    </tbody>
  </table>

  <div class="divider"></div>

  <!-- Totals -->
  <table class="total-table">
    <tr>
      <td class="label">سعر المنتجات</td>
      <td class="value">${enMoney(productsTotal)}.00</td>
    </tr>
    <tr>
      <td class="label">خصم</td>
      <td class="value">${discount}.00</td>
    </tr>
    <tr>
      <td class="label">خدمة التوصيل</td>
      <td class="value">${delivFee > 0 ? enMoney(delivFee) + '.00' : '0.00'}</td>
    </tr>
    <tr style="border-top:1px solid #000;">
      <td class="label bold" style="font-size:13px;">الإجمالي</td>
      <td class="value bold" style="font-size:13px;">${enMoney(price)}.00</td>
    </tr>
    <tr>
      <td class="label">المدفوع</td>
      <td class="value">${deposit > 0 ? enMoney(deposit) + '.00' : '0.00'}</td>
    </tr>
    <tr style="background:#f0f0f0;">
      <td class="label bold">الباقي</td>
      <td class="value bold">${remaining > 0 ? enMoney(remaining) + '.00' : '0.00'}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <!-- Footer -->
  <div class="footer-note">
    توصيل الطلبات للمنازل<br>
    الاستبدال والاسترجاع خلال 14 يوم<br>
    مع تمنياتنا بدوام الصحة والعافية
  </div>

  <div class="divider"></div>

  <!-- ✅ Barcode SVG -->
  <div class="barcode-svg">${barcodeSvg}</div>
  <div class="barcode-text">${barcode1}</div>

  <div style="text-align:center;font-size:12px;color:#555;margin-top:6px;">Printed: ${printDate}</div>
  <div style="margin-bottom:16px;"></div>
</body>
</html>`;
}

// ============================================================
// ===== تشغيل الماسك سكان عند تحميل الصفحة =====
// ============================================================

// استدعاء التهيئة عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
  // تهيئة الماسك سكان العام
  initGlobalBarcodeScanner();
  console.log('✅ Barcode scanner ready');
});

// ============================================================
// ===== تحديث دالة getKhaznaFilteredOrders =====
// ============================================================

// ✅ استبدل دالة getKhaznaFilteredOrders الموجودة بهذه النسخة
// التي تستخدم matchesOrderSearch بدلاً من البحث اليدوي

// 👇 دي النسخة المحدثة
function getKhaznaFilteredOrders() {
  const search = (document.getElementById('khaznaBarcodeSearch')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('khaznaFilterStatus')?.value || 'الكل';
  const empFilter = document.getElementById('khaznaFilterEmployee')?.value || 'الكل';

  return khaznaOrders.filter(o => {
    if (o.status !== 'Signed' && !isReturnWithin14Days(o)) return false;
    
    // ✅ استخدام matchesOrderSearch بدلاً من البحث اليدوي
    const matchSearch = !search || matchesOrderSearch(o, search);
    
    const matchStatus = matchesOrderStatusFilter(o, statusFilter);
    const matchEmp = empFilter === 'الكل' || o.employee_name === empFilter;
    
    return matchSearch && matchStatus && matchEmp;
  });
}

// ===== بدء التشغيل =====
initTheme();
checkLogin();

// ===== Fallback للزوم 75% =====
(function applyZoomFallback() {
  const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
  if (isFirefox) {
    document.documentElement.style.zoom = '';
    document.body.style.transformOrigin = 'top right';
    document.body.style.transform = 'scale(0.75)';
    document.body.style.width = '133.33%';
  }
})();

function filterKhaznaBarcode(){ renderKhaznaStats(); renderKhaznaOrders(); }

// ✅ Validate Egyptian Phone Number (Global)
function validatePhoneInput(input) {
  if (!input) return;

  // يشيل أي حاجة مش رقم
  input.value = input.value.replace(/\D/g, '');

  // يمنع أكثر من 11 رقم
  if (input.value.length > 11) {
    input.value = input.value.slice(0, 11);
  }

  // لو عايز تمنع أي رقم مش بيبدأ بـ 01
  if (input.value.length >= 2 && !input.value.startsWith("01")) {
    input.value = "01";
  }
}
async function importDoctorsFromExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const doctors = [];
    const seenCodes = new Set(); // ✅ لمنع التكرار داخل نفس الملف

    rows.forEach((row, i) => {
      if (i === 0) return;
      const name = String(row[0] || '').trim();
      const code = String(row[1] || '').trim().toUpperCase();
      if (name && code && !seenCodes.has(code)) {
        seenCodes.add(code);
        doctors.push({ name: name, code: code });
      }
    });

    if (!doctors.length) { alert('الملف فاضي أو مفيهوش بيانات صحيحة'); return; }

    if (!confirm(`هيتم استيراد/تحديث ${doctors.length} دكتور. تأكيد؟`)) return;

    // ✅ upsert بدل insert — ياخد الجديد ويحدّث القديم بدون تكرار
    const BATCH = 200;
    let done = 0;
    for (let i = 0; i < doctors.length; i += BATCH) {
      const chunk = doctors.slice(i, i + BATCH);
      const { error } = await supabaseClient
        .from('doctors')
        .upsert(chunk, { onConflict: 'code' });   // 👈 التعديل هنا
      if (error) { alert('مشكلة في الاستيراد: ' + error.message); return; }
      done += chunk.length;
    }

    alert(`تم استيراد/تحديث ${done} دكتور بنجاح ✅`);
    event.target.value = '';
    await loadDoctors();
  } catch (err) {
    alert('خطأ في قراءة الملف: ' + err.message);
    console.error(err);
  }
}

async function cleanAllDoctors() {
  if (!isAdmin()) { alert('مسح الدكاترة متاح للأدمن فقط'); return; }
  if (!confirm('⚠️ متأكدة؟ ده هيمسح كل الدكاترة الموجودين!')) return;

  const { error } = await supabaseClient
    .from('doctors')
    .delete()
    .not('id', 'is', null);   // ✅ بيطابق كل الصفوف

  if (error) { alert('مشكلة في المسح: ' + error.message); return; }

  alert('تم مسح كل الدكاترة ✅');
  await loadDoctors();
}

// ===== My Account / Change Password =====
function setMyAccountMessage(message, type) {
  const box = document.getElementById('myAccountMessage');
  if (!box) return;
  box.textContent = message || '';
  box.className = 'my-account-message' + (type ? ' ' + type : '');
  if (!message) box.style.display = 'none';
  else box.style.display = 'block';
}

function openMyAccountModal() {
  if (!currentUser || !currentUser.id) {
    alert('يجب تسجيل الدخول أولاً');
    return;
  }

  const modal = document.getElementById('myAccountModal');
  const form = document.getElementById('myAccountForm');
  if (!modal) return;

  if (form) form.reset();
  setMyAccountMessage('', '');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    document.getElementById('myCurrentPassword')?.focus();
  }, 80);
}

function closeMyAccountModal() {
  const modal = document.getElementById('myAccountModal');
  const form = document.getElementById('myAccountForm');
  if (modal) modal.style.display = 'none';
  if (form) form.reset();
  setMyAccountMessage('', '');
  document.body.style.overflow = '';
}

function toggleMyAccountPassword(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  if (button) button.textContent = show ? '🙈' : '👁';
}

async function changeMyAccountPassword(event) {
  if (event) event.preventDefault();

  if (!currentUser || !currentUser.id) {
    setMyAccountMessage('انتهت جلسة المستخدم. سجل الدخول مرة أخرى.', 'error');
    return;
  }

  const currentPassword = String(document.getElementById('myCurrentPassword')?.value || '');
  const newPassword = String(document.getElementById('myNewPassword')?.value || '');
  const confirmPassword = String(document.getElementById('myConfirmPassword')?.value || '');
  const saveBtn = document.getElementById('myAccountSaveBtn');

  setMyAccountMessage('', '');

  if (!currentPassword || !newPassword || !confirmPassword) {
    setMyAccountMessage('من فضلك املأ كل حقول كلمة المرور.', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    setMyAccountMessage('تأكيد كلمة المرور الجديدة غير مطابق.', 'error');
    return;
  }

  if (newPassword === currentPassword) {
    setMyAccountMessage('كلمة المرور الجديدة لازم تكون مختلفة عن الحالية.', 'error');
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'جاري الحفظ...';
  }

  try {
    // تحقق من كلمة المرور الحالية للمستخدم الحالي فقط
    const { data: matchedUsers, error: verifyError } = await supabaseClient
      .from('user')
      .select('id')
      .eq('id', currentUser.id)
      .eq('password', currentPassword)
      .limit(1);

    if (verifyError) throw verifyError;

    if (!matchedUsers || !matchedUsers.length) {
      setMyAccountMessage('كلمة المرور الحالية غير صحيحة.', 'error');
      return;
    }

    // تحديث كلمة مرور المستخدم الحالي فقط
    const { data: updatedUsers, error: updateError } = await supabaseClient
      .from('user')
      .update({ password: newPassword })
      .eq('id', currentUser.id)
      .eq('password', currentPassword)
      .select('id');

    if (updateError) throw updateError;

    if (!updatedUsers || !updatedUsers.length) {
      setMyAccountMessage('لم يتم تحديث كلمة المرور. حاول مرة أخرى.', 'error');
      return;
    }

    await logActivity('password_changed','تم تغيير كلمة المرور','قام المستخدم بتغيير كلمة مرور حسابه الحالي');
        setMyAccountMessage('✅ تم تغيير كلمة المرور بنجاح.', 'success');

    document.getElementById('myCurrentPassword').value = '';
    document.getElementById('myNewPassword').value = '';
    document.getElementById('myConfirmPassword').value = '';

    setTimeout(() => closeMyAccountModal(), 1400);
  } catch (error) {
    console.error('Change password error:', error);
    setMyAccountMessage('حدثت مشكلة أثناء تغيير كلمة المرور: ' + (error.message || error), 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'حفظ كلمة المرور';
    }
  }
}

document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    const modal = document.getElementById('myAccountModal');
    if (modal && modal.style.display === 'flex') closeMyAccountModal();
  }
});


// Activity Log live search
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('activityLogSearch')?.addEventListener('input',()=>{if(isAdmin()){activityLogPageNumber=1;loadActivityLogs();}});
  document.getElementById('activityLogType')?.addEventListener('change',()=>{if(isAdmin()){activityLogPageNumber=1;loadActivityLogs();}});
  document.getElementById('activityLogFrom')?.addEventListener('change',()=>{activityLogPageNumber=1;});
  document.getElementById('activityLogTo')?.addEventListener('change',()=>{activityLogPageNumber=1;});
});
