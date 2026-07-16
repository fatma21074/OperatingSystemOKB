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
let doctorsList = [];
let shippingSystems = [];

let shippingCompanyFilterMenu = null; 

let doctorsSettingsPage = 1;
const DOCTORS_PAGE_SIZE = 10;

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
function isManager() { return currentUser && getRoleKey(currentUser.role) === "manager"; }
function isExecutiveAssistant() { return currentUser && getRoleKey(currentUser.role) === "executive_assistant"; }
function getRoleKey(role) { return String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function isSecretary() { const r = getRoleKey(currentUser && currentUser.role); return r === 'secretary' || r === 'receptionist'; }
function isReceptionist() { return isSecretary(); }
function isCashier() { return currentUser && getRoleKey(currentUser.role) === 'cashier'; }
function isStoreManager() { return currentUser && getRoleKey(currentUser.role) === 'store_manager'; }
function isAccountManager() { return currentUser && getRoleKey(currentUser.role) === 'account_manager'; }
function canManageDailyLock() { return isAdmin() || isAccountManager(); }
function canManageKhaznaAndTransfer() { return isAdmin() || isAccountManager(); }
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
function canAccessBranch(branchName) {
  if (isAdmin() || isManager() || isExecutiveAssistant() || isSecretary() || isAccountManager()) return true;
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
  let barcode = onlyDigits(order?.order_barcode) || generateOrderBarcode(getTicketId(order));
  barcode = String(barcode).replace(/\D/g, '');
  if (barcode.length > 14) {
    barcode = barcode.slice(0, 14);      
  } else if (barcode.length < 14) {
    barcode = barcode.padStart(14, '0');   
  }

  return barcode;
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
  return isAdmin() || isAccountManager();
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

  loginPage.classList.add("hidden");
  app.classList.remove("hidden");

  setupUserView();
  await loadDoctors();
  await loadShippingSystems();
  await loadOrders();
  if (isAdmin() || isExecutiveAssistant()) { await loadUsers(); applyUsersFormRoleLock(); }

  hideAllPages();
  $("ordersPage").classList.remove("hidden");
  setActiveMenu("ordersPage");
}

function logout() {
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
    loginPage.classList.add("hidden");
    app.classList.remove("hidden");
    setupUserView();
    await loadDoctors();
    await loadShippingSystems();
    await loadOrders();
    if (isAdmin() || isExecutiveAssistant()) { await loadUsers(); applyUsersFormRoleLock(); }
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

  document.querySelectorAll(".settings-menu-btn").forEach(el => el.classList.toggle("hidden", !(isAdmin() || isExecutiveAssistant())));
  document.querySelectorAll(".admin-manager-only").forEach(el => el.classList.toggle("hidden", !canViewAdminReports()));
  document.querySelectorAll(".accounting-only").forEach(el => el.classList.toggle("hidden", !canManageKhaznaAndTransfer()));
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

  if (isStoreManager() || isCashier()) {
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

function resetAppState() {
  orders = [];
  users = [];
  branchs = [];
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

  ["orderForm", "userForm", "branchForm", "doctorSettingsForm", "shippingSettingsForm"].forEach(id => {
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

  orders = allOrders;
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

async function loadDoctors() {
  const { data, error } = await supabaseClient.from("doctors").select("*").order("name", { ascending: true });
  if (error) { console.warn("doctors table not found or error:", error.message); doctorsList = []; renderDoctorsSettings(); renderDoctorOptions(); return; }
  doctorsList = data || [];
  renderDoctorsSettings();
  renderDoctorOptions();
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

function hideAllPages() {
  ["ordersPage", "analyticsPage", "shippingRankPage", "doctorRankPage", "branchRankPage", "usersPage", "branchsPage", "branchPage", "khaznaPage"].forEach(id => {
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
  if (!isAdmin() && !isExecutiveAssistant()) return;  
  hideAllPages(); 
  $("branchsPage").classList.remove("hidden"); 
  setActiveMenu("branchsPage"); 
  loadBranchs(); 
  loadDoctors(); 
  loadShippingSystems(); 
}

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
  if (grandEl) grandEl.textContent = money(grand);
  if (remainingEl) remainingEl.textContent = money(remaining);

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

  const name = String(nameEl?.value || '').trim();
  const price = Number(priceEl?.value || 0);
  const qty = Math.max(1, Number(qtyEl?.value || 1));

  if (!name) { alert('اكتب اسم المنتج'); nameEl?.focus(); return; }
  if (!price || price <= 0) { alert('اكتب سعر القطعة'); priceEl?.focus(); return; }

  const items = getCartArray(scope);
  const existing = items.find(p => String(p.name || '').trim().toLowerCase() === name.toLowerCase() && Number(p.price || 0) === price);
  if (existing) existing.qty = Number(existing.qty || 1) + qty;
  else items.push({ name, price, qty });

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
  if (isCashier() || isStoreManager()) {
    const managed = getCurrentUserManagedBranches();
    if (!managed.length) return [];
    const managedShippingCompanies = managed.map(getBranchShippingCompanyName);
    return orders.filter(o => managed.includes(o.branch) || managedShippingCompanies.includes(o.shipping_company));
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
    const matchStatus = statusFilter === "الكل" || o.status === statusFilter;
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
        <td><span class="chip ${statusClass}">${o.status || ""}</span></td>
        <td class="notes-cell" title="${safeNotes}">${displayNotes || ''}</td>
        <td>${formatDate(o.created_at)}</td>
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
        }
      }
    }
    
    resetForm();
    await loadOrders();
    alert(editId ? "تم تعديل الاوردر بنجاح" : "تم الإضافة بنجاح");
    
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

  if (depositValue > 0 && !hasFile) {
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
  if (String(o.status || '').trim() === 'Signed' && !isAdmin()) { alert('لا يمكن تعديل أوردر Signed إلا من خلال الأدمن فقط'); return; }
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
  return getShippingAnalysisRows(src).map(r => ({ 
    ...r, 
    score: (r.returnRateNum * 2) + (r.fakeRateNum * 1.5)
  })).sort((a, b) => a.score - b.score); 
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
    } else if (isStoreManager()) {
      const branches = getCurrentUserManagedBranches();
      scope.textContent = branches.length ? branches.map(b => `فرع ${b}`).join(" / ") : "فروع المدير";
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
    const list = src.filter(o => o.shipping_company === item.company || o.shipping_company === item.branch);
    const total = list.length;
    const signed = countStatus(list, "Signed");
    const delivering = countStatus(list, "Delivering");
    const returned = countStatus(list, "Returned");
    const conversionNum = percentNum(signed, total);
    const returnNum = percentNum(returned, total);
    return {
      name: item.branch,
      total,
      signed,
      delivering,
      returned,
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
      <td>${Number(r.score || 0).toFixed(1)}</td>
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
  else if (isStoreManager()) {
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
}

function exportData() { const f = getFilteredOrders(); if (!f.length) { alert("لا توجد بيانات للتصدير"); return; } downloadCSV("orders-data.csv", ["Employee", "Doctor","Order Number", "Customer", "Phone","Phone2", "Shipping Company", "Area", "Products", "Delivery Fee", "Discount", "Price", "Deposit", "Remaining", "Status", "Notes", "Created At"], f.map(o => [o.employee_name, o.doctor_name,o.order_number || "", o.customer_name, o.phone,o.phone2, o.shipping_company, o.area, o.product_names || "", o.delivery_fee || 0, getOrderMeta(o).discount || 0, o.price, o.deposit || 0, Math.max(0, Number(o.price || 0) - Number(o.deposit || 0)), o.status, stripCollectMeta(o.notes || ""), o.created_at])); }
function exportShippingAnalysis() { const rows = getShippingAnalysisRows(); downloadCSV("shipping-analysis.csv", ["Shipping Company", "Total Orders", "Signed", "Transit", "Returned", "Fake Delivery", "Conversion Rate", "Fake Rate", "Return Rate"], rows.map(r => [r.company, r.total, r.signed, r.transit, r.returned, r.fakeDelivery, r.conversionRate, r.fakeRate, r.returnRate])); }
function exportDoctorsAnalysis() { const r = getDoctorsAnalysisRows(); if (!r.length) { alert("لا توجد بيانات دكاترة للتصدير"); return; } downloadCSV("doctors-analysis.csv", ["Doctor", "Total Orders", "Signed", "Transit", "Returned", "Fake Doctor", "Total Revenue", "Conversion Rate", "Fake Rate", "Return Rate"], r.map(x => [x.doctor, x.total, x.signed, x.transit, x.returned, x.fakeDoctor, x.revenue, x.conversionRate, x.fakeRate, x.returnRate])); }
function exportShippingRank() { const rows = getShippingRankRows(); downloadCSV("shipping-dashboard.csv", ["Rank", "Shipping Company", "Total Order", "Signed", "Delivering", "Returned", "Conversion Rate", "Cancel Rate", "Score"], rows.map((r, i) => [i + 1, r.company, r.total, r.signed, r.delivering, r.returned, r.conversionRate, r.returnRate, r.score.toFixed(1)])); }
function exportDoctorRank() { const r = getDoctorRankRows(); if (!r.length) { alert("لا توجد بيانات دكاترة للتصدير"); return; } downloadCSV("doctor-rank.csv", ["Rank", "Doctor", "Total Orders", "Signed", "Returned", "Fake", "Total Revenue", "Fake Rate", "Return Rate", "Score"], r.map((x, i) => [i + 1, x.doctor, x.total, x.signed, x.returned, x.fakeDoctor, x.revenue, x.fakeRate, x.returnRate, x.score.toFixed(1)])); }

// ===== دوال المستخدمين =====
function onNewRoleChange() {
  const role = $("newRole").value;
  $("newUserBranchesWrap").classList.toggle("hidden", !(role === "store_manager" || role === "cashier"));
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

  if (!execOnly && (role === "store_manager" || role === "cashier")) {
    const branches = getSelectedNewUserBranches();
    if (!branches.length) { alert("اختر فرع واحد على الأقل لـ Store Manager / Cashier"); return; }
    userData.managed_branches = JSON.stringify(branches);
  }

  if (!userData.name || !userData.username || !userData.password || !userData.role) { alert("املى كل بيانات المستخدم"); return; }
  const { error } = await supabaseClient.from("user").insert([userData]);
  if (error) { alert("مشكلة في إضافة المستخدم: " + error.message); return; }
  userForm.reset(); $("newUserBranchesWrap").classList.add("hidden"); applyUsersFormRoleLock(); await loadUsers(); alert("تم إضافة المستخدم بنجاح" + (execOnly ? " (Secretary)" : ""));
});

function getRoleDisplayName(role) {
  const map = { admin: "Admin", manager: "Operation Manager", operation_manager: "Operation Manager", delivery_manager: "Operation Manager", agent: "Agent", executive_assistant: "Executive Assistant", receptionist: "Secretary", secretary: "Secretary", cashier: "Cashier", store_manager: "Store Manager", account_manager: "Account Manager" };
  return map[String(role || "").toLowerCase()] || role || "";
}

function renderUsers() {
  if (!users.length) {
    usersTableBody.innerHTML = `<tr><td colspan="6" class="empty">No users found</td></tr>`;
    return;
  }
  usersTableBody.innerHTML = users.map(u => {
    let managedBranchesText = "—";
    if (["store_manager", "cashier"].includes(String(u.role || "").toLowerCase())) {
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
  alert(`تم ${action} المستخدم بنجاح ✅`);
  await loadUsers();
};

// ===== تعديل صلاحية المستخدم (Admin Only) =====
function onEditRoleChange() {
  const role = $("editRoleSelect").value;
  $("editRoleBranchesWrap").classList.toggle("hidden", !(role === "store_manager" || role === "cashier"));
}

window.openEditRoleModal = function (id) {
  if (!isAdmin()) { alert("غير مسموح — هذه الميزة للأدمن فقط"); return; }
  const u = users.find(x => String(x.id) === String(id));
  if (!u) return;

  $("editRoleUserId").value = u.id;
  $("editRoleUserName").textContent = `المستخدم: ${u.name} (${u.username})`;
  $("editRoleSelect").value = String(u.role || "agent").toLowerCase();

  document.querySelectorAll(".edit-role-branch-cb").forEach(cb => cb.checked = false);
  if (["store_manager", "cashier"].includes(String(u.role || "").toLowerCase())) {
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
  if (newRoleVal === "store_manager" || newRoleVal === "cashier") {
    const branches = Array.from(document.querySelectorAll(".edit-role-branch-cb:checked")).map(cb => cb.value);
    if (!branches.length) { alert("اختر فرع واحد على الأقل لـ Store Manager / Cashier"); return; }
    updateData.managed_branches = JSON.stringify(branches);
  } else {
    updateData.managed_branches = null;
  }

  const { error } = await supabaseClient.from("user").update(updateData).eq("id", id);
  if (error) { alert("مشكلة في تحديث الصلاحية: " + error.message); return; }

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

// ===== دوال الفروع =====
function renderBranchs() {
  const tbody = $("branchsTableBody");
  if (!branchs.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty">لا توجد فروع مضافة</td></tr>`; return; }
  tbody.innerHTML = branchs.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${b.name || ""}</td>
      <td>${b.city || ""}</td>
      <td>${b.manager || ""}</td>
      <td>${b.phone || ""}</td>
      <td><button class="danger" style="padding:4px 8px;font-size:11px" onclick="deleteBranch('${b.id}')">حذف</button></td>
    </tr>
  `).join("");
}

function renderBranchRank() {
  const tbody = $("branchRankBody");
  if (!tbody) return;
  if (!branchs.length) {
    tbody.innerHTML = `<td><td colspan="5" class="empty">لا توجد فروع مضافة</td></tr>`;
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

$("branchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin()) { alert("غير مسموح"); return; }
  const payload = { name: $("branchName").value.trim(), city: $("branchCity").value.trim(), manager: $("branchManager").value.trim(), phone: $("branchPhone").value.trim() };
  if (!payload.name || !payload.city || !payload.manager || !payload.phone) { alert("من فضلك املى كل البيانات"); return; }
  const { error } = await supabaseClient.from("branchs").insert([payload]);
  if (error) { alert("مشكلة في الإضافة: " + error.message); return; }
  $("branchForm").reset();
  await loadBranchs();
});

window.deleteBranch = async function (id) {
  if (!isAdmin()) { alert("غير مسموح"); return; }
  if (!confirm("هل أنت متأكد من حذف هذا الفرع؟")) return;
  const { error } = await supabaseClient.from("branchs").delete().eq("id", id);
  if (error) { alert("مشكلة في الحذف: " + error.message); return; }
  await loadBranchs();
};

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

  if (!doctorsList.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">لا يوجد دكاترة مضافة</td></tr>`;
    renderDoctorsSettingsPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(doctorsList.length / DOCTORS_PAGE_SIZE));
  if (doctorsSettingsPage > totalPages) doctorsSettingsPage = totalPages;
  if (doctorsSettingsPage < 1) doctorsSettingsPage = 1;

  const start = (doctorsSettingsPage - 1) * DOCTORS_PAGE_SIZE;
  const pageRows = doctorsList.slice(start, start + DOCTORS_PAGE_SIZE);

  tbody.innerHTML = pageRows.map((d, i) => `
    <tr>
      <td>${start + i + 1}</td>
      <td>${d.name || ""}</td>
      <td>${d.code || ""}</td>
      <td><button class="danger" style="padding:6px 10px;font-size:12px" onclick="deleteDoctor('${d.id}')">حذف</button></td>
    </tr>
  `).join("");

  renderDoctorsSettingsPagination(doctorsList.length);
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

$("doctorSettingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin()) { alert("غير مسموح"); return; }
  const name = $("settingDoctorName").value.trim();
  const code = $("settingCodeDoctor").value.trim();
  if (!name) { alert("اكتب اسم الدكتور"); return; }

  const payload = { name };
  if (code) payload.code = code;   // نضيف الكود بس لو اتكتب

  const { error } = await supabaseClient.from("doctors").insert([payload]);
  if (error) { alert("مشكلة في إضافة الدكتور: " + error.message); return; }
  $("doctorSettingsForm").reset();
  await loadDoctors();
});

window.deleteDoctor = async function (id) {
  if (!isAdmin()) { alert("غير مسموح"); return; }
  if (!confirm("هل أنت متأكد من حذف هذا الدكتور؟")) return;
  const { error } = await supabaseClient.from("doctors").delete().eq("id", id);
  if (error) { alert("مشكلة في الحذف: " + error.message); return; }
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
      if (!excelVal && field.dbField !== "notes" && field.dbField !== "payment_image") {
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

    const orderObj = {
      employee_name: finalEmployee,
      doctor_name: String(row[mapping["doctor_name"]] || "").trim(),
      customer_name: String(row[mapping["customer_name"]] || "").trim(),
      phone: String(row[mapping["phone"]] || "").trim(),
      shipping_company: finalShipping,
      area: String(row[mapping["area"]] || "").trim(),
      price: pVal,
      deposit: depositVal,
      payment_image: paymentImageUrl,
      status: finalStatus,
      fake_doctor: finalStatus === "Fake Doctor",
      fake_delivery_update: finalStatus === "Fake Delivery Update",
      notes: mapping["notes"] ? String(row[mapping["notes"]] || "").trim() : "",
      ...(await reserveNextOrderIdentifiers())
    };
    
    console.log("📦 Final Order Object:", orderObj);
    ordersToInsert.push(orderObj);
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

// ===== Toggle Sidebar =====
(function() {
  function initSidebarToggle() {
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    
    if (!toggleBtn || !sidebar) {
      setTimeout(initSidebarToggle, 200);
      return;
    }

    try {
      const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      if (isCollapsed) {
        sidebar.classList.add('collapsed');
        toggleBtn.classList.add('active');
      }
    } catch(e) {}

    toggleBtn.addEventListener('click', function() {
      sidebar.classList.toggle('collapsed');
      toggleBtn.classList.toggle('active');
      
      try {
        const collapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebarCollapsed', collapsed);
      } catch(e) {}
    });

    function collapseSidebarAfterMenuClick() {
      sidebar.classList.add('collapsed');
      toggleBtn.classList.add('active');
      try { localStorage.setItem('sidebarCollapsed', true); } catch(e) {}
    }

    sidebar.addEventListener('click', function(e) {
      const targetBtn = e.target.closest('button');
      if (!targetBtn) return;
      if (targetBtn.classList.contains('okb-stores-btn')) return;
      if (targetBtn.classList.contains('menu-item') || targetBtn.classList.contains('okb-branch-btn')) {
        setTimeout(collapseSidebarAfterMenuClick, 120);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebarToggle);
  } else {
    initSidebarToggle();
  }
})();

// ===== OKB Stores — Branch Page Logic =====
let currentBranchName = '';
let branchShippingRankOverride = null;
let branchOrders = [];
let branchActiveDateFrom = null;
let branchActiveDateTo = null;
let branchPageNum = 1;

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
  currentBranchName = branchName;
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
  setBranchShippingSelectToCurrentBranch();
  setBranchStatusToDelivering();

  const bEmpEl = document.getElementById('bEmployeeName');
  if (bEmpEl && currentUser) {
    bEmpEl.value = currentUser.name;
    bEmpEl.readOnly = true;
  }

  clearProductCart('branch');
  await loadBranchOrders();

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
  await loadBranchDailyLocks();
  renderBranchOrders();
}

function getBranchFilteredOrders() {
  const search = (document.getElementById('bSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('bFilterStatus')?.value || 'الكل';
  const empFilter = document.getElementById('bFilterEmployee')?.value || 'الكل';

  return branchOrders.filter(o => {
    const matchSearch = matchesOrderSearch(o, search);
    const matchStatus = statusFilter === 'الكل' || o.status === statusFilter;
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

function getBranchStatusButtonHtml(order) {
  if (!canChangeBranchOrderStatus()) return '';
  if (typeof isOrderLockedByDaily === 'function' && isOrderLockedByDaily(order)) {
    return disabledActionButton('إلغاء', 'هذه اليومية مقفولة');
  }
  if (order.status === 'Returned') {
    return `<span class="branch-cancel-disabled" title="الأوردر ملغي بالفعل">ملغي</span>`;
  }
if (order.status === 'Signed' && !isAdmin() && !isExecutiveAssistant() && !isSecretary() && !isAccountManager()) {
    return `<span class="branch-cancel-disabled" title="لا يمكن إلغاء أوردر Signed إلا للأدمن فقط">Signed</span>`;
  }
  return `<button onclick="openBranchCancelStatusModal('${order.id}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;border:none;background:linear-gradient(135deg,#EF4444,#B91C1C);color:#fff;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(239,68,68,.25);">إلغاء</button>`;
}

function openBranchCancelStatusModal(orderId) {
  const order = branchOrders.find(x => String(x.id) === String(orderId));
  if (!order) return;
  if (!canChangeBranchOrderStatus()) { alert('غير مسموح لك بتعديل حالة الأوردر'); return; }
  if (typeof isOrderLockedByDaily === 'function' && isOrderLockedByDaily(order)) { alert('هذه اليومية مقفولة. لا يمكن تعديل حالة الأوردر.'); return; }
  if (order.status === 'Signed' && !isAdmin() && !isExecutiveAssistant() && !isSecretary() && !isAccountManager()) { alert('لا يمكن إلغاء أوردر Signed إلا للأدمن فقط'); return; }

  let modal = document.getElementById('branchCancelStatusModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'branchCancelStatusModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10050;align-items:center;justify-content:center;padding:18px;';
    modal.innerHTML = `
      <div style="width:420px;max-width:96vw;background:var(--bg-card);border:1px solid var(--border-color);border-radius:18px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.45);direction:rtl;">
        <h3 style="margin:0 0 8px;font-size:17px;color:var(--text-primary);">إلغاء الأوردر</h3>
        <p id="branchCancelModalCustomer" style="margin:0 0 14px;color:var(--text-muted);font-size:13px;"></p>
        <label style="display:block;margin-bottom:6px;color:var(--text-muted);font-size:12px;font-weight:800;">سبب الإلغاء <span style="color:#EF4444">*</span></label>
        <textarea id="branchCancelReasonInput" rows="4" placeholder="اكتب سبب الإلغاء..." style="width:100%;resize:vertical;margin-bottom:12px;"></textarea>
        <div style="display:flex;gap:10px;justify-content:flex-start;">
          <button id="branchCancelConfirmBtn" onclick="confirmBranchCancelStatus()" style="background:#EF4444;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-weight:900;">إلغاء أوردر العميل</button>
          <button onclick="closeBranchCancelStatusModal()" style="background:var(--bg-soft);color:var(--text-primary);border:1px solid var(--border-color);border-radius:10px;padding:10px 18px;font-weight:800;">إغلاق</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.dataset.orderId = orderId;
  const customer = document.getElementById('branchCancelModalCustomer');
  if (customer) customer.textContent = `العميل: ${order.customer_name || '—'} | الحالة الحالية: ${order.status || '—'}`;
  const reason = document.getElementById('branchCancelReasonInput');
  if (reason) reason.value = '';
  modal.style.display = 'flex';
  setTimeout(() => reason && reason.focus(), 50);
}

function closeBranchCancelStatusModal() {
  const modal = document.getElementById('branchCancelStatusModal');
  if (modal) modal.style.display = 'none';
}

async function confirmBranchCancelStatus() {
  const modal = document.getElementById('branchCancelStatusModal');
  const orderId = modal?.dataset?.orderId;
  const reasonEl = document.getElementById('branchCancelReasonInput');
  const reason = String(reasonEl?.value || '').trim();
  if (!orderId) return;
  if (!reason) { alert('لازم تكتب سبب الإلغاء قبل تحويل الأوردر Returned'); reasonEl?.focus(); return; }

  const order = branchOrders.find(x => String(x.id) === String(orderId));
  if (!order) return;
  if (!canChangeBranchOrderStatus()) { alert('غير مسموح لك بتعديل حالة الأوردر'); return; }
  if (typeof isOrderLockedByDaily === 'function' && isOrderLockedByDaily(order)) { alert('هذه اليومية مقفولة. لا يمكن تعديل حالة الأوردر.'); return; }
  if (order.status === 'Signed' && !isAdmin() && !isExecutiveAssistant() && !isSecretary() && !isAccountManager()) { alert('لا يمكن إلغاء أوردر Signed إلا للأدمن فقط'); return; }

  const noteLine = `سبب الإلغاء: ${reason}`;
  const newNotes = appendVisibleOrderNote(order.notes || '', noteLine);
  const btn = document.getElementById('branchCancelConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'جاري الحفظ...'; }

  const { error } = await supabaseClient
    .from('orders')
    .update({ status: 'Returned', notes: newNotes })
    .eq('id', orderId);

  if (btn) { btn.disabled = false; btn.textContent = 'إلغاء أوردر العميل'; }
  if (error) { alert('مشكلة في تعديل الحالة: ' + error.message); return; }

  closeBranchCancelStatusModal();
  await loadBranchOrders();
  await loadOrders();
  alert('تم تحويل الأوردر إلى Returned وإضافة سبب الإلغاء في الملاحظات');
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
  setEl('bTotalRevenue', money(rev));
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
    tbody.innerHTML = '<tr><td colspan="15" class="empty">لا توجد أوردرات لهذا الفرع</td></tr>';
    return;
  }

  const PAGE = 20;
  const totalPages = Math.ceil(filtered.length / PAGE);
  if (branchPageNum > totalPages) branchPageNum = totalPages;
  const start = (branchPageNum - 1) * PAGE;
  const rows = filtered.slice(start, start + PAGE);

  let html = '';
  rows.forEach((o, i) => {
    let statusClass = 'chip-transit';
    if (o.status === 'Returned') statusClass = 'chip-returned';
    else if (o.status === 'Signed') statusClass = 'chip-signed';
    else if (isFakeDoctorOrder(o) || isFakeDeliveryUpdateOrder(o)) statusClass = 'chip-fake';
    const price = Number(o.price || 0);
    const deposit = Number(o.deposit || 0);
    const remaining = price - deposit;
    const paymentBtn = o.payment_image
      ? `<button onclick="viewPaymentImage('${o.payment_image}')" style="background:#0D9488;padding:4px 8px;border-radius:6px;font-size:11px;color:#fff;border:none;cursor:pointer;">📷 عرض</button>`
      : `<label style="cursor:pointer;background:#6366f1;padding:4px 8px;border-radius:6px;font-size:11px;color:#fff;border-radius:6px;">📎 إرفاق<input type="file" accept="image/*" style="display:none;" onchange="attachBranchPayment(this,'${o.id}')"/></label>`;
    const lockedByDaily = isOrderLockedByDaily(o);
    const isSignedOrder = o.status === 'Signed';
    const transferBtn = !canManageKhaznaAndTransfer()
      ? ''
      : (o.transferred
        ? `<span class="chip" style="font-size:10px;background:#374151;color:#9ca3af;">✓ محوّل</span>`
        : (lockedByDaily
          ? disabledActionButton('🔄 تحويل', 'هذه اليومية مقفولة')
          : (isSignedOrder
            ? disabledActionButton('🔄 تحويل', 'لا يمكن تحويل أوردر تم تسليمه (Signed)')
            : `<button onclick="transferBranchOrder('${o.id}')" style="background:#f59e0b;padding:4px 8px;border-radius:6px;font-size:11px;color:#fff;border:none;cursor:pointer;white-space:nowrap;">🔄 تحويل</button>`)));
    html += `<tr>
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
      <td><span class="chip ${statusClass}">${o.status || ''}</span></td>
      <td class="branch-notes-cell">${cleanVisibleOrderNotes(o.notes || '')}</td>
      <td>${formatDate(o.created_at)}</td>
      <td class="branch-actions-cell">
        <div style="display:flex;gap:5px;align-items:center;">
          ${getCollectButtonHtml(o, 'branch')}
          ${transferBtn}
          <button onclick="printBranchOrderReceipt('${o.id}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;border:none;background:linear-gradient(135deg,#0D9488,#14B8A6);color:#fff;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(13,148,136,.25);">🧾 إيصال</button>
          ${getBranchStatusButtonHtml(o)}
        </div>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;

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
  const f = document.getElementById('bFromDate'); if(f) f.value = '';
  const t = document.getElementById('bToDate'); if(t) t.value = '';
  const badge = document.getElementById('bActiveDateBadge');
  if (badge) badge.classList.remove('visible');
  branchPageNum = 1;
  renderBranchOrders();
}

function editBranchOrder(id) {
  const o = branchOrders.find(x => String(x.id) === String(id));
  if (!o) return;
  if (isOrderLockedByDaily(o)) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  alert('تعديل الأوردر يتم من الـ Dashboard الرئيسي');
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
      }
    });
  }
  const bFStatus = document.getElementById('bFilterStatus');
  if (bFStatus) bFStatus.addEventListener('change', () => { branchPageNum = 1; renderBranchOrders(); });
  const bFEmp = document.getElementById('bFilterEmployee');
  if (bFEmp) bFEmp.addEventListener('change', () => { branchPageNum = 1; renderBranchOrders(); });

  const khaznaSearch = document.getElementById('khaznaBarcodeSearch');
  if (khaznaSearch) khaznaSearch.addEventListener('input', () => { renderKhaznaStats(); renderKhaznaOrders(); });
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

    if (!hasProducts('branch')) {
      alert('أضف منتج واحد على الأقل في الأوردر');
      return;
    }
    syncProductCartTotals('branch');
    const bQty       = Math.max(1, Number(document.getElementById('bQuantity')?.value || 1));
    const bDelivFee  = Number(document.getElementById('bDeliveryFee')?.value || 0);
    const bTotalPrice = Number(document.getElementById('bPrice')?.value || 0);

    const orderData = {
      employee_name:    (currentUser ? currentUser.name : (empEl?.value.trim() || '')),
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
      status:           'Delivering',
      fake_doctor:      false,
      notes:            buildNotesWithOrderMeta((notesEl?.value || '').trim() || 'لا توجد ملاحظات', { discount: Number(document.getElementById('branchDiscountInput')?.value || 0), ticket_seq_v2: true }),
      product_names:    document.getElementById('bProductNames')?.value.trim() || '',
      branch:           currentBranchName,
      transferred:      false
    };

    const branchPaymentInput = document.getElementById('bPaymentImage');
    const branchPaymentFile = branchPaymentInput?.files?.[0];
    if (Number(orderData.deposit || 0) > 0 && !branchPaymentFile) {
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
      Object.assign(orderData, await reserveNextOrderIdentifiers());
      const { data: inserted, error } = await supabaseClient.from('orders').insert([orderData]).select().single();
      if (error) throw error;
      const payImgInput = document.getElementById('bPaymentImage');
      if (payImgInput?.files[0] && inserted?.id) {
        const imgUrl = await uploadPaymentImage(payImgInput.files[0], inserted.id);
        if (imgUrl) {
          await supabaseClient.from('orders').update({ payment_image: imgUrl }).eq('id', inserted.id);
        }
      }
      branchForm.reset();
      clearProductCart('branch');
      clearBranchPaymentImage();
      setBranchShippingSelectToCurrentBranch();
      setBranchStatusToDelivering();
      alert('✅ تم إضافة الأوردر بنجاح');
      await loadBranchOrders();
    } catch (err) {
      alert('مشكلة في الحفظ: ' + err.message);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'إضافة الأوردر'; }
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

function transferBranchOrder(orderId) {
  if (!canManageKhaznaAndTransfer()) { alert('زر التحويل متاح للأدمن و Account Manager فقط'); return; }
  const o = branchOrders.find(x => String(x.id) === String(orderId)) || khaznaOrders.find(x => String(x.id) === String(orderId));
  if (o && isOrderLockedByDaily(o)) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  if (o && o.status === 'Signed') { alert('لا يمكن تحويل أوردر تم تسليمه بالفعل (Signed) لشركة شحن أخرى.'); return; }
  transferOrderId = orderId;
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
  const modal = document.getElementById('transferModal');
  if (modal) modal.style.display = 'none';
}

async function confirmTransfer() {
  if (!canManageKhaznaAndTransfer()) { alert('زر التحويل متاح للأدمن و Account Manager فقط'); return; }
  const shipping = document.getElementById('transferShippingSelect')?.value;
  if (!shipping) { alert('اختر شركة الشحن أولاً'); return; }
  if (!transferOrderId) return;

  const confirmBtn = document.querySelector('#transferModal button:last-child');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'جاري التحويل...'; }

  const { error } = await supabaseClient.from('orders').update({
    transferred: true,
    transferred_to: shipping,
    shipping_company: shipping,
    branch: null
  }).eq('id', transferOrderId);

  if (error) {
    alert('مشكلة في التحويل: ' + error.message);
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✅ تأكيد التحويل'; }
    return;
  }

  closeTransferModal();
  alert('✅ تم تحويل الأوردر لـ ' + shipping + ' بنجاح');
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
    unlockBtn.style.display = (isSingleDate && isLocked && canManageDailyLock()) ? 'inline-flex' : 'none';
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
    alert('قفل اليومية متاح للأدمن و Account Manager فقط'); 
    return; 
  }
  
  const date = getKhaznaSelectedDate();
  if (!date) { 
    alert('اختار يوم واحد فقط لقفل اليومية'); 
    return; 
  }
  
  const msg = `هل أنت متأكد من قفل يومية ${date} لفرع ${currentBranchName}؟\nلن يمكن تعديل أو حذف أي أوردر بتاريخ هذا اليوم بعد القفل.`;
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
  
  alert('✅ تم قفل اليومية بنجاح');
}

async function unlockKhaznaDay() {
  if (!canManageDailyLock()) { 
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
  
  alert('✅ تم فتح القفل');
}

function openKhaznaPage() {
  if (!canManageKhaznaAndTransfer()) { 
    alert('الخزنة متاحة للأدمن و Account Manager فقط'); 
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
    document.getElementById('khaznaFilterStatus').value = 'Signed';
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
      .eq('status', 'Signed')
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo);

    if (error) { alert('خطأ: ' + error.message); return; }
    allData = allData.concat(data || []);
    if (!data || data.length < pageSize) break;
    rangeFrom += pageSize;
  }

  khaznaOrders = allData
    .filter(o => isOrderInAccountingDateRange(o, from || null, to || null))
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
  const totalSales = visibleKhaznaOrders.reduce((s, o) => s + Number(o.price || 0), 0);
  
  const originalKhaznaOrdersForCalc = khaznaOrders;
  khaznaOrders = visibleKhaznaOrders;
  const shippingTotal = getKhaznaShippingTotal();
  const transfersTotal = getKhaznaTransfersTotal();
  khaznaOrders = originalKhaznaOrdersForCalc;
  const net = totalSales - shippingTotal - transfersTotal;

  const fmt = v => enMoney(v);
  const setEl = (id, v) => { 
    const el = document.getElementById(id); 
    if(el) el.textContent = v; 
  };

  setEl('kTotalSales', fmt(totalSales));
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
  if (!canEditKhaznaShippingCost()) { alert('تعديل إجمالي مصروفات الشحنات متاح للأدمن و Account Manager فقط'); return; }
  if (khaznaLockInfo) { alert('هذه اليومية مقفولة. يجب فتح القفل أولاً من الأدمن أو Account Manager.'); return; }
  document.getElementById('kShippingCostEdit').style.display = 'block';
  document.getElementById('kShippingCostInput').value = khaznaShippingCost || '';
  document.getElementById('kShippingCostInput').focus();
}

function saveShippingCost() {
  if (!canEditKhaznaShippingCost()) { alert('تعديل إجمالي مصروفات الشحنات متاح للأدمن و Account Manager فقط'); return; }
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
    tbody.innerHTML = '<tr><td colspan="9" class="empty">لا توجد أوردرات في هذه الفترة</td></tr>';
    return;
  }
  
  let rows = '';
  visibleKhaznaOrders.forEach((o, i) => {
    const price = Number(o.price || 0);
    const deposit = Number(o.deposit || 0);
    const remaining = price - deposit;
    
    let statusClass = 'chip-transit';
    if (o.status === 'Returned') statusClass = 'chip-returned';
    else if (o.status === 'Signed') statusClass = 'chip-signed';
    
    const lockedByDaily = isOrderLockedByDaily(o);
    
    rows += `<tr>
      <td>${i + 1}</td>
      <td>${o.customer_name || ''}</td>
      <td>${o.phone || ''}</td>
      <td>${enMoney(price)}</td>
      <td>${deposit > 0 ? enMoney(deposit) : '—'}</td>
      <td>${remaining > 0 ? enMoney(remaining) : '—'}</td>
      <td><span class="chip ${statusClass}" style="font-size:10px;">${o.status || ''}</span></td>
      <td style="font-size:11px;">${formatDate(getOrderAccountingDateISO(o))}</td>
      <td class="branch-actions-cell">
        <div style="display:flex;gap:5px;align-items:center;">
          ${getCollectButtonHtml(o, 'khazna')}
          ${lockedByDaily ? '<span class="chip" style="font-size:10px;background:#78350f;color:#fbbf24;">🔒 مقفول</span>' : ''}
          <button onclick="printSingleOrder('${o.id}')" 
            style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;
            border:none;background:linear-gradient(135deg,#0D9488,#14B8A6);color:#fff;font-size:11px;
            font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(13,148,136,.25);">
            🧾 إيصال
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
  win.onload = () => { win.focus(); };
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
  const from = document.getElementById('khaznaFromDate').value || '—';
  const to   = document.getElementById('khaznaToDate').value   || '—';

  const reportOrders = getKhaznaFilteredOrders();
  const originalKhaznaOrdersForCalc = khaznaOrders;
  khaznaOrders = reportOrders;
  const totalSales = reportOrders.reduce((s, o) => s + Number(o.price || 0), 0);
  const shippingTotal = getKhaznaShippingTotal();
  const transfersTotal = getKhaznaTransfersTotal();
  const net = totalSales - shippingTotal - transfersTotal;
  khaznaOrders = originalKhaznaOrdersForCalc;

  const printDate = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});

  const orderRows = reportOrders.map((o,i) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:4px;">${i+1}</td>
      <td style="padding:4px;">${o.customer_name || ''}</td>
      <td style="padding:4px;">${o.phone || ''}</td>
      <td style="padding:4px;font-size:10px;">${o.product_names || '—'}</td>
      <td style="padding:4px;text-align:right;">${enMoney(o.price)}</td>
      <td style="padding:4px;text-align:right;">${Number(o.deposit||0) > 0 ? enMoney(o.deposit) : '—'}</td>
      <td style="padding:4px;text-align:center;"><span style="background:#e5e7eb;padding:2px 6px;border-radius:4px;font-size:10px;">${o.status||''}</span></td>
    </tr>`).join('');

  const reportHTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>تقرير الخزنة</title>
<style>
  body { font-family: Arial, sans-serif; padding: 20px; color: #000; font-size: 13px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .stats { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px 20px; text-align: center; min-width: 140px; }
  .stat-box .label { font-size: 11px; color: #777; }
  .stat-box .value { font-size: 20px; font-weight: bold; direction:ltr; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f3f4f6; padding: 6px; font-size: 12px; text-align: right; }
  td { direction:ltr; }
  @media print { @page { size: A4; margin: 15mm; } }
</style>
</head>
<body>
  <h1>🏦 تقرير الخزنة — فرع ${currentBranchName}</h1>
  <div class="meta">الفترة: ${from} → ${to} | طُبع في: ${printDate}</div>
  <div class="stats">
    <div class="stat-box"><div class="label">إجمالي المبيعات</div><div class="value" style="color:#6366f1;">${enMoney(totalSales)}</div></div>
    <div class="stat-box"><div class="label">مصروفات الشحن</div><div class="value" style="color:#ef4444;">${enMoney(shippingTotal)}</div></div>
    <div class="stat-box"><div class="label">التحويلات</div><div class="value" style="color:#a855f7;">${enMoney(transfersTotal)}</div></div>
    <div class="stat-box"><div class="label">صافي اليومية</div><div class="value" style="color:#10b981;">${enMoney(net)}</div></div>
    <div class="stat-box"><div class="label">عدد الأوردرات</div><div class="value" style="color:#f59e0b;">${enNumber(reportOrders.length)}</div></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>العميل</th><th>الموبايل</th><th>المنتجات</th><th>السعر</th><th>المدفوع</th><th>الحالة</th></tr></thead>
    <tbody>${orderRows}</tbody>
  </table>
  <div style="margin-top:20px;border-top:2px solid #000;padding-top:10px;font-weight:bold;font-size:15px;direction:ltr;text-align:right;">
    Net = ${enMoney(totalSales)} - ${enMoney(shippingTotal)} - ${enMoney(transfersTotal)} = <span style="color:#10b981;">${enMoney(net)}</span>
  </div>
</body></html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(reportHTML);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

async function printBranchOrderReceipt(orderId) {
  let order = branchOrders.find(o => String(o.id) === String(orderId));
  if (!order) { alert('مش لاقي بيانات الأوردر دا للطباعة'); return; }
  order = await ensureOrderIdentifiers(order);
  const win = window.open('', '_blank', 'width=400,height=700');
  win.document.write(generateReceiptHTML(order, currentBranchName || order.branch || ''));
  win.document.close();
  win.onload = () => { win.focus(); };
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

  const remaining = Math.max(Number(price || 0) - Number(deposit || 0), 0);
  const meta = order ? getCollectMeta(order) : { history: [] };
  const last = meta.history && meta.history.length ? meta.history[meta.history.length - 1] : null;
  document.getElementById('collectSalesInput').value    = last ? Number(last.sales || 0) : (remaining > 0 ? remaining : (Number(price||0) || ''));
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

    const { error } = await supabaseClient
      .from('orders')
      .update({ status: 'Signed', notes: updatedNotes, payment_image: proofUrl || null })
      .eq('id', _collectOrderId);

    if (error) throw error;

    [branchOrders, khaznaOrders, orders].forEach(arr => {
      if (!Array.isArray(arr)) return;
      const idx = arr.findIndex(o => String(o.id) === String(_collectOrderId));
      if (idx !== -1) {
        arr[idx].status = 'Signed';
        arr[idx].notes = updatedNotes;
        arr[idx].payment_image = proofUrl || arr[idx].payment_image || null;
      }
    });

    if (typeof renderBranchOrders === 'function') renderBranchOrders();
    if (typeof renderKhaznaOrders === 'function') renderKhaznaOrders();
    if (typeof renderKhaznaStats  === 'function') renderKhaznaStats();
    if (typeof renderOrders       === 'function') renderOrders();
    if (typeof renderAnalytics    === 'function') renderAnalytics();

    alert(`✅ تم تحصيل الأوردر بنجاح\n${customerLabel}\n\nإجمالي المبيعات: ${sales.toLocaleString('ar-EG')} ج.م\nمصاريف الشحن: ${shipping.toLocaleString('ar-EG')} ج.م\nصافي المحصّل: ${net.toLocaleString('ar-EG')} ج.م\n\n📌 تم تحويل حالة الأوردر إلى Signed`);
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
  body{font-family:Arial,sans-serif;padding:30px;color:#111;font-size:14px;max-width:700px;margin:0 auto;}
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

// المتغيرات العامة للـ Scanner
let barcodeBuffer = '';
let barcodeTimeout = null;
let barcodeScannerActive = true;

/**
 * تهيئة الماسك سكان للباركود على مستوى الصفحة
 * يشتغل حتى لو المؤشر مش جوه خانة البحث
 */
function initGlobalBarcodeScanner() {
  // إزالة المستمع القديم لو موجود
  document.removeEventListener('keydown', handleBarcodeKeydown);
  document.removeEventListener('keyup', handleBarcodeKeyup);
  
  // إضافة المستمع الجديد
  document.addEventListener('keydown', handleBarcodeKeydown);
  document.addEventListener('keyup', handleBarcodeKeyup);
  
  console.log('✅ Global Barcode Scanner initialized');
}

/**
 * معالجة الضغط على المفاتيح للكشف عن الباركود
 */
function handleBarcodeKeydown(e) {
  // تجاهل لو المؤشر في حقل إدخال نصي (حتى نمنع التداخل)
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return;
  }
  
  // تجاهل المفاتيح الخاصة
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
    return;
  }
  
  // بدء المؤقت
  if (barcodeTimeout) {
    clearTimeout(barcodeTimeout);
  }
  
  // تجميع الأحرف
  barcodeBuffer += e.key;
  
  // إعادة تعيين المؤقت بعد 100ms من آخر حرف
  barcodeTimeout = setTimeout(() => {
    if (barcodeBuffer.length > 3) {
      // تم اكتشاف باركود
      const barcode = barcodeBuffer.trim();
      console.log('📸 Barcode scanned:', barcode);
      handleScannedBarcode(barcode);
    }
    barcodeBuffer = '';
    barcodeTimeout = null;
  }, 100);
}

function handleBarcodeKeyup(e) {
  // مستمع إضافي للتأكد من اكتمال الباركود
}

/**
 * معالجة الباركود بعد مسحه
 */
function handleScannedBarcode(barcode) {
  // 1. البحث في الخزنة (Khazna)
  const khaznaSearch = document.getElementById('khaznaBarcodeSearch');
  const khaznaPage = document.getElementById('khaznaPage');
  if (khaznaSearch && khaznaPage && !khaznaPage.classList.contains('hidden')) {
    khaznaSearch.value = barcode;
    if (typeof renderKhaznaStats === 'function') renderKhaznaStats();
    if (typeof renderKhaznaOrders === 'function') renderKhaznaOrders();
    return;
  }
  
  // 2. البحث في صفحة الفرع (Branch)
  const branchSearch = document.getElementById('bSearchInput');
  const branchPage = document.getElementById('branchPage');
  if (branchSearch && branchPage && !branchPage.classList.contains('hidden')) {
    branchSearch.value = barcode;
    if (typeof renderBranchOrders === 'function') renderBranchOrders();
    return;
  }
  
  // 3. البحث في صفحة الأوردرات الرئيسية (Dashboard)
  const mainSearch = document.getElementById('searchInput');
  if (mainSearch) {
    mainSearch.value = barcode;
    if (typeof renderOrders === 'function') renderOrders();
    return;
  }
}

// ============================================================
// ===== GENERATE CODE128 BARCODE SVG =====
// ============================================================

/**
 * توليد باركود Code128 على شكل SVG
 */
function generateCode128BarcodeSVG(text) {
  if (!text) return '';
  
  // تنظيف النص
  const cleanText = String(text || '').trim();
  if (!cleanText) return '';
  
  // دالة مساعدة لتحويل النص إلى Code128
  function encodeCode128(data) {
    // جدول ترميز Code128
    const code128Chars = {
      ' ': 0, '!': 1, '"': 2, '#': 3, '$': 4, '%': 5, '&': 6, "'": 7, '(': 8, ')': 9,
      '*': 10, '+': 11, ',': 12, '-': 13, '.': 14, '/': 15, '0': 16, '1': 17, '2': 18,
      '3': 19, '4': 20, '5': 21, '6': 22, '7': 23, '8': 24, '9': 25, ':': 26, ';': 27,
      '<': 28, '=': 29, '>': 30, '?': 31, '@': 32, 'A': 33, 'B': 34, 'C': 35, 'D': 36,
      'E': 37, 'F': 38, 'G': 39, 'H': 40, 'I': 41, 'J': 42, 'K': 43, 'L': 44, 'M': 45,
      'N': 46, 'O': 47, 'P': 48, 'Q': 49, 'R': 50, 'S': 51, 'T': 52, 'U': 53, 'V': 54,
      'W': 55, 'X': 56, 'Y': 57, 'Z': 58, '[': 59, '\\': 60, ']': 61, '^': 62, '_': 63,
      '`': 64, 'a': 65, 'b': 66, 'c': 67, 'd': 68, 'e': 69, 'f': 70, 'g': 71, 'h': 72,
      'i': 73, 'j': 74, 'k': 75, 'l': 76, 'm': 77, 'n': 78, 'o': 79, 'p': 80, 'q': 81,
      'r': 82, 's': 83, 't': 84, 'u': 85, 'v': 86, 'w': 87, 'x': 88, 'y': 89, 'z': 90,
      '{': 91, '|': 92, '}': 93, '~': 94
    };
    
    // اختيار وضع الترميز (B هو الأكثر شيوعاً)
    let startCode = 104; // Code B
    let checksum = startCode;
    let encoded = [];
    
    // ترميز كل حرف
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const code = code128Chars[char];
      if (code === undefined) continue;
      encoded.push(code);
      checksum += (i + 1) * code;
    }
    
    // حساب المجموع الاختباري
    checksum = checksum % 103;
    encoded.push(checksum);
    encoded.push(106); // Stop code
    
    // تحويل إلى نمط الباركود (نظام 11 وحدة لكل حرف)
    const patterns = [
      // 0-9
      "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
      "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
      // 10-19
      "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
      "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
      // 20-29
      "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
      "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
      // 30-39
      "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
      "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
      // 40-49
      "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
      "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
      // 50-59
      "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
      "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
      // 60-69
      "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
      "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
      // 70-79
      "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
      "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
      // 80-89
      "11010100000", "11010010000", "11010001000", "11010000100", "11000101000",
      "11000100100", "11000100010", "10110110000", "10110001100", "10001101100",
      // 90-99
      "10110101000", "10110010100", "10110010010", "10001010110", "10101011000",
      "10101000110", "10001011010", "10101101000", "10101100010", "10100011010",
      // 100-106
      "10100001010", "11001011000", "11001000110", "11010110010", "11010100110",
      "10110100110", "10100110110"
    ];
    
    let result = '';
    // Start code
    result += patterns[startCode] || "11011001100";
    // Data codes
    for (let i = 0; i < encoded.length; i++) {
      const idx = encoded[i];
      if (idx < patterns.length) {
        result += patterns[idx];
      }
    }
    
    return result;
  }
  
  // توليد الباركود
  const encodedPattern = encodeCode128(cleanText);
  if (!encodedPattern) return '';
  
  // عرض كل وحدة بـ 2px
  const moduleWidth = 2;
  const totalWidth = encodedPattern.length * moduleWidth;
  const height = 50;
  
  // بناء SVG
  let bars = '';
  let x = 0;
  for (let i = 0; i < encodedPattern.length; i++) {
    const bit = encodedPattern[i];
    if (bit === '1') {
      // شريط أسود
      bars += `<rect x="${x}" y="0" width="${moduleWidth}" height="${height}" fill="#000000"/>`;
    }
    x += moduleWidth;
  }
  
  return `<svg viewBox="0 0 ${totalWidth} ${height + 4}" width="${totalWidth}" height="${height + 4}" xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:100%;height:auto;">
    ${bars}
  </svg>`;
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
    font-family: 'Courier New', monospace;
    width: 80mm;
    margin: 0 auto;
    padding: 8px;
    background: #fff;
    color: #000;
    font-size: 12px;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .divider-solid { border-top: 2px solid #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 11px; font-weight: bold; padding: 2px 0; }
  .total-table td { padding: 3px 6px; font-size: 12px; }
  .total-table .label { font-weight: bold; }
  .total-table .value { text-align: left; font-weight: bold; }
  .barcode-text {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    letter-spacing: 1px;
    text-align: center;
    margin: 4px 0 2px;
    font-weight: bold;
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
  .footer-note { font-size: 11px; text-align: center; line-height: 1.6; margin: 6px 0; }
  @media print {
    body { width: 80mm; }
    @page { size: 80mm auto; margin: 0; }
  }
</style>
</head>
<body>
  <!-- Header -->
  <div class="center bold" style="font-size:16px;margin-bottom:2px;">صيدليات العقبي</div>
  <div class="center" style="font-size:11px;">0223051430 - 012 02 7777 04</div>
  <div class="center" style="font-size:10px;margin-bottom:2px;">مبيعات توصيل طلبات</div>
  <div class="center" style="font-size:10px;">فرع ${branchName}</div>

  <div class="divider-solid"></div>

  <!-- Order Info -->
  <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:4px;">
    <span>Ticket ID: <strong>${ticketId}</strong></span>
    <span>Time: ${orderDate}</span>
  </div>
  <div style="font-size:10px;margin-bottom:4px;">العميل: <strong>${order.customer_name || ''}</strong></div>
  <div style="font-size:10px;margin-bottom:4px;">الدكتور: <strong>${order.doctor_name || ''}</strong></div>
 <div style="font-size:10px;margin-bottom:4px;">رقم الأوردر: <strong>${order.order_number || '—'}</strong></div>
  <div style="font-size:10px;margin-bottom:4px;">الموبايل: <strong>${order.phone || ''}</strong></div>
  <div style="font-size:10px;margin-bottom:6px;">العنوان: <strong>${order.area || ''}</strong></div>

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

  <div style="text-align:center;font-size:10px;color:#555;margin-top:6px;">Printed: ${printDate}</div>
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
    if (o.status !== 'Signed') return false;
    
    // ✅ استخدام matchesOrderSearch بدلاً من البحث اليدوي
    const matchSearch = !search || matchesOrderSearch(o, search);
    
    const matchStatus = statusFilter === 'الكل' || o.status === statusFilter;
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
  if (!confirm('⚠️ متأكدة؟ ده هيمسح كل الدكاترة الموجودين!')) return;

  const { error } = await supabaseClient
    .from('doctors')
    .delete()
    .not('id', 'is', null);   // ✅ بيطابق كل الصفوف

  if (error) { alert('مشكلة في المسح: ' + error.message); return; }

  alert('تم مسح كل الدكاترة ✅');
  await loadDoctors();
}