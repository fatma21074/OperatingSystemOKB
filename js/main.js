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

// ===== دوال مساعدة =====
const $ = id => document.getElementById(id);
function num(v) { return Number(v || 0).toLocaleString("en-US"); }
function money(v) { return Number(v || 0).toLocaleString("en-US"); }
function isAdmin() { return currentUser && String(currentUser.role || "").toLowerCase() === "admin"; }
function isManager() { return currentUser && String(currentUser.role || "").toLowerCase() === "manager"; }
function canViewAdminReports() { return isAdmin() || isManager(); }
function percent(p, t) { return t ? ((p / t) * 100).toFixed(1) + "%" : "0%"; }
function percentNum(p, t) { return t ? ((p / t) * 100) : 0; }
function isFakeDoctorOrder(o) { return o.fake_doctor === true || o.status === "Fake Doctor"; }
function isFakeDeliveryUpdateOrder(o) { return o.fake_delivery_update === true || o.status === "Fake Delivery Update"; }
function getFakeCount(list) { return list.filter(o => isFakeDoctorOrder(o) || isFakeDeliveryUpdateOrder(o)).length; }
function getFakeDoctorCount(list) { return list.filter(o => isFakeDoctorOrder(o)).length; }
function getFakeDeliveryUpdateCount(list) { return list.filter(o => isFakeDeliveryUpdateOrder(o)).length; }

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

// ===== دوال رفع وحذف الصور =====
async function uploadPaymentImage(file, orderId) {
  if (!file || !orderId) return null;
  
  const fileExt = file.name.split('.').pop();
  const fileName = `order_${orderId}_${Date.now()}.${fileExt}`;
  // ✅ المسار بدون اسم الـ bucket (الـ bucket بيتحدد في .from())
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
    .remove([path]); // ✅ المسار بدون اسم الـ bucket;
    
  if (error) console.error("Delete error:", error);
}

function previewPaymentImage(input) {
  const file = input.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const preview = document.getElementById("paymentImagePreview");
      const img = document.getElementById("paymentPreviewImg");
      if (preview && img) {
        img.src = e.target.result;
        preview.style.display = "block";
      }
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

// إضافة مستمع لحدث change على input file
document.getElementById("paymentImage")?.addEventListener("change", function() {
  previewPaymentImage(this);
});

// ===== دوال الثيم =====
function initTheme() {
  let savedTheme = 'light';
  try {
    savedTheme = sessionStorage.getItem('okb_theme') || 'light';
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
    role: u.role || (u.username === "admin" ? "admin" : "agent")
  };
  sessionStorage.setItem("okb_current_user", JSON.stringify(currentUser));

  loginPage.classList.add("hidden");
  app.classList.remove("hidden");

  setupUserView();
  await loadDoctors();
  await loadShippingSystems();
  await loadOrders();
  if (isAdmin()) await loadUsers();

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
    if (isAdmin()) await loadUsers();
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
  $("userRoleHere").textContent = currentUser.role;
  const inline1 = $("userNameInline"), inline2 = $("userRoleInline");
  if (inline1) inline1.textContent = currentUser.name;
  if (inline2) inline2.textContent = currentUser.role;
  const av = $("userAvatar");
  if (av) av.textContent = (currentUser.name || "U").trim().charAt(0).toUpperCase();

  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin()));
  document.querySelectorAll(".admin-manager-only").forEach(el => el.classList.toggle("hidden", !canViewAdminReports()));

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
  const { data, error } = await supabaseClient.from("orders").select("*").order("created_at", { ascending: false });
  if (error) { alert("مشكلة في تحميل البيانات: " + error.message); return; }
  orders = data || []; 
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
  ["ordersPage", "analyticsPage", "shippingRankPage", "doctorRankPage", "branchRankPage", "usersPage", "branchsPage"].forEach(id => {
    const el = $(id);
    if (el) el.classList.add("hidden");
  });
}

function showOrdersPage() { hideAllPages(); $("ordersPage").classList.remove("hidden"); setActiveMenu("ordersPage"); }
function showAnalyticsPage() { hideAllPages(); $("analyticsPage").classList.remove("hidden"); renderAnalytics(); setActiveMenu("analyticsPage"); }
function showShippingRankPage() { if (!canViewAdminReports()) return; hideAllPages(); $("shippingRankPage").classList.remove("hidden"); setActiveMenu("shippingRankPage"); setTimeout(() => { renderShippingRank(); renderShippingCharts(); }, 150); }
function showDoctorRankPage() { if (!canViewAdminReports()) return; hideAllPages(); $("doctorRankPage").classList.remove("hidden"); setActiveMenu("doctorRankPage"); setTimeout(() => { renderDoctorRank(); renderDoctorCharts(); }, 150); }
function showBranchRankPage() { hideAllPages(); $("branchRankPage").classList.remove("hidden"); setActiveMenu("branchRankPage"); if (!$("reportFromDate").value || !$("reportToDate").value) { setReportMode("daily"); } else { updateReportTabs(); renderReport(); } }
function showUsersPage() { if (!isAdmin()) return; hideAllPages(); $("usersPage").classList.remove("hidden"); setActiveMenu("usersPage"); loadUsers(); }
function showBranchsPage() { if (!isAdmin()) return; hideAllPages(); $("branchsPage").classList.remove("hidden"); setActiveMenu("branchsPage"); loadBranchs(); loadDoctors(); loadShippingSystems(); }

function resetForm() { 
  orderForm.reset(); editId = null; 
  submitBtn.textContent = "إضافة الأوردر"; 
  if (!isAdmin()) { employeeName.value = currentUser.name; employeeName.readOnly = true; }
 const depositField = document.getElementById("deposit");
  if (depositField) depositField.value = "0";
 }
function getVisibleOrders() { return orders; }

function renderEmployeeFilter() {
  const current = filterEmployee.value, base = getVisibleOrders();
  const employees = [...new Set(base.map(o => o.employee_name).filter(Boolean))];
  filterEmployee.innerHTML = `<option value="الكل">كل الموظفين</option>` + employees.map(e => `<option value="${e}">${e}</option>`).join("");
  filterEmployee.disabled = false;
  filterEmployee.value = employees.includes(current) ? current : "الكل";
}

function getFilteredOrders() {
  const search = searchInput.value.trim().toLowerCase(), statusFilter = filterStatus.value, employeeFilter = filterEmployee.value;
  return getVisibleOrders().filter(o => {
    const matchSearch = String(o.employee_name || "").toLowerCase().includes(search) || String(o.doctor_name || "").toLowerCase().includes(search) || String(o.customer_name || "").toLowerCase().includes(search) || String(o.phone || "").toLowerCase().includes(search);
    const matchStatus = statusFilter === "الكل" || o.status === statusFilter;
    const matchEmployee = !isAdmin() || employeeFilter === "الكل" || o.employee_name === employeeFilter;
    const matchDate = isInDateRange(o);
    return matchSearch && matchStatus && matchEmployee && matchDate;
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
  const filtered = getFilteredOrders();
  renderStats(filtered);
  
  if (!filtered.length) {
    ordersTableBody.innerHTML = `<tr><td colspan="15" class="empty">No data found</td></tr>`;
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
    else if (o.status === "Fake Doctor" || o.status === "Fake Delivery Update") statusClass = "chip-fake";
    
    const safeNotes = (o.notes || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
        <td>${o.customer_name || ""}</td>
        <td>${o.phone || ""}</td>
        <td>${o.shipping_company || ""}</td>
        <td>${o.area || ""}</td>
        <td>${money(price)}</td>
        <td>${deposit > 0 ? `<span class="deposit-badge">💰 ${money(deposit)}</span>` : "—"}</td>
        <td>${remaining > 0 ? money(remaining) : "—"}</td>
        <td>${paymentImage}</td>
        <td><span class="chip ${statusClass}">${o.status || ""}</span></td>
        <td class="notes-cell" title="${safeNotes}">${o.notes || ''}</td>
        <td>${formatDate(o.created_at)}</td>
        <td><div style="display:flex;gap:4px"><button class="edit" style="padding:4px 10px;font-size:11px" onclick="editOrder('${o.id}')">تعديل</button>${isAdmin() ? `<button class="danger" style="padding:4px 10px;font-size:11px" onclick="deleteOrder('${o.id}')">حذف</button>` : ''}</div></td>
      </tr>`;
  }
  
  ordersTableBody.innerHTML = html;
  renderPagination("ordersPagination", filtered.length, "orders");
  syncBulkSelectionUI(page.rows);
}
function syncBulkSelectionUI(currentPageRows = []) {
  const bar = $("bulkDeleteBar");
  const countEl = $("selectedOrdersCount");
  const selectPage = $("selectPageOrders");
  
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
  const statusEl = document.getElementById("status");
  const notesEl  = document.getElementById("orderNotes");
  
  const submitButton = document.getElementById("submitBtn");
  submitButton.disabled = true;
  submitButton.textContent = "جاري الحفظ...";

  const orderData = {
    employee_name:    isAdmin() ? empEl.value.trim() : currentUser.name,
    doctor_name:      docEl.value.trim(),
    customer_name:    custEl.value.trim(),
    phone:            phoneEl.value.trim(),
    shipping_company: shipEl.value,
    area:             areaEl.value.trim(),
    price:            Number(priceEl.value),
    deposit: Number($("deposit")?.value || 0),
    status:           statusEl.value,
    fake_doctor:      statusEl.value === "Fake Doctor",
    notes:            (notesEl.value || '').trim() || "لا توجد ملاحظات"
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
      // تعديل أوردر موجود
      result = await supabaseClient.from("orders").update(orderData).eq("id", editId).select();
      if (result.error) throw result.error;
    } else {
      // إضافة أوردر جديد - مهم جداً: use .select() عشان ترجع البيانات
      result = await supabaseClient.from("orders").insert([orderData]).select();
      if (result.error) throw result.error;
      
      // ✅ استخراج الـ ID من النتيجة
      if (result.data && result.data.length > 0) {
        orderId = result.data[0].id;
        console.log("✅ New order created with ID:", orderId);
      } else {
        throw new Error("لم يتم استرجاع ID الأوردر بعد الإضافة");
      }
    }
    
    // ✅ رفع الصورة إذا وجدت وتم الحصول على orderId
    const imageFile = document.getElementById("paymentImage")?.files[0];
    const existingImage = document.getElementById("existingPaymentImage")?.value;
    
    if (imageFile && orderId) {
      console.log("📸 Uploading image for order ID:", orderId);
      
      // حذف الصورة القديمة إذا وجدت (في حالة التعديل)
      if (existingImage) {
        await deletePaymentImage(existingImage);
      }
      
      const imageUrl = await uploadPaymentImage(imageFile, orderId);
      console.log("📸 Image URL after upload:", imageUrl);
      
      if (imageUrl) {
        // ✅ تحديث الأوردر برابط الصورة
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
    alert(editId ? "تم التعديل بنجاح" : "تم الإضافة بنجاح");
    
  } catch (error) {
    console.error("❌ Error in form submission:", error);
    alert("مشكلة في الحفظ: " + error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = editId ? "حفظ التعديل" : "إضافة الأوردر";
  }
});

window.editOrder = function (id) {
  const o = orders.find(x => String(x.id) === String(id));
  if (!o) return;
  if (!isAdmin() && o.employee_name !== currentUser.name) { alert("غير مسموح بتعديل أوردرات موظف آخر"); return; }
  editId = id;
  employeeName.value = o.employee_name || "";
  doctorName.value = o.doctor_name || "";
  customerName.value = o.customer_name || "";
  phone.value = o.phone || "";
  shippingCompany.value = o.shipping_company || "";
  area.value = o.area || "";
  price.value = o.price || "";
  if($("deposit")) $("deposit").value = o.deposit || 0;
  status.value = o.status || "";
  $('orderNotes').value = o.notes || '';
    // ✅ عرض الصورة الموجودة إن وجدت
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
  
  // تنظيف حقل رفع الملف
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
  
  // ✅ البحث عن الأوردر للحصول على رابط الصورة قبل الحذف
  const orderToDelete = orders.find(x => String(x.id) === String(id));
  
  const { error } = await supabaseClient.from("orders").delete().eq("id", id);
  if (error) { 
    alert("مشكلة في الحذف: " + error.message); 
    console.error(error); 
    return; 
  }
  
  // ✅ حذف الصورة من التخزين إذا وجدت
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
    
    return { 
      company, 
      total, 
      signed,
      transit,
      returned,
      fakeDelivery,
      fakeRate: percent(fakeDelivery, total), 
      returnRate: percent(returned, total),
      fakeRateNum: percentNum(fakeDelivery, total), 
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
        <td>${r.fakeRate}</td>
        <td>${r.returnRate}</td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty">No shipping data</td></tr>`;

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
        <td>${r.fakeRate}</td>
        <td>${r.returnRate}</td>
      </tr>`).join("")
    : `<tr><td colspan="9" class="empty">No doctors data</td></tr>`;

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
  if (!shippingCompanyCheckboxes) return;
  const companies = getShippingRankRows().map(r => r.company).filter(Boolean);
  shippingCompanyCheckboxes.innerHTML = companies.length
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
  const q = (shippingRankSearch?.value || "").trim().toLowerCase();
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

function renderShippingRank() {
  const rows = getFilteredShippingRankRows();
  const page = getPaginatedRows(rows, "shippingRank");

  $("shippingRankBody").innerHTML = page.rows.length
    ? page.rows.map((r, i) => `<tr>
        <td>${num(page.start + i + 1)}</td>
        <td>${r.company}</td>
        <td>${num(r.total)}</td>
        <td>${num(r.signed)}</td>
        <td>${num(r.returned)}</td>
        <td>${num(r.fakeDelivery)}</td>
        <td>${r.returnRate}</td>
        <td>${r.fakeRate}</td>
        <td>${r.score.toFixed(1)}</td>
      </tr>`).join("")
    : `<tr><td colspan="9" class="empty">No shipping rank data</td></tr>`;

  renderPagination("shippingRankPagination", rows.length, "shippingRank");

  const active = rows.filter(r => r.total > 0);
  $("bestShippingInsight").textContent = active[0] ? active[0].company : "No data";
  const worstReturn = [...active].sort((a, b) => b.returnRateNum - a.returnRateNum)[0];
  const worstFake = [...active].sort((a, b) => b.fakeRateNum - a.fakeRateNum)[0];
  $("worstReturnShippingInsight").textContent = worstReturn ? `${worstReturn.company} (${worstReturn.returnRate})` : "No data";
  $("worstFakeShippingInsight").textContent = worstFake ? `${worstFake.company} (${worstFake.fakeRate})` : "No data";
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
  if (!shippingDateFrom && !shippingDateTo) return orders;
  return orders.filter(o => {
    const raw = o.created_at; if (!raw) return true;
    const d = raw.split("T")[0];
    if (shippingDateFrom && shippingDateTo) return d >= shippingDateFrom && d <= shippingDateTo;
    if (shippingDateFrom) return d >= shippingDateFrom;
    return d <= shippingDateTo;
  });
}

function renderShippingCharts() {
  let rows = getShippingRankRows();
  if (selectedShippingCompanies.length) rows = rows.filter(r => selectedShippingCompanies.includes(r.company));
  rows = rows.filter(r => r.total > 0);
  rows.sort((a, b) => b.total - a.total);

  destroyChart("shippingBarChart");
  if (!rows.length) return;

  const wrap = document.getElementById("shippingBarChartWrap");
  const minH = Math.max(300, rows.length * 55 + 80);
  wrap.style.height = minH + "px";

  const ctx = $("shippingBarChart");
  if (!ctx) return;
  const labels = rows.map(r => r.company);

  charts["shippingBarChart"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Total Orders", data: rows.map(r => r.total), backgroundColor: "#3B82F6", borderRadius: 5, borderSkipped: false },
        { label: "Returned", data: rows.map(r => r.returned), backgroundColor: "#EF4444", borderRadius: 5, borderSkipped: false },
        { label: "Fake Delivery", data: rows.map(r => r.fakeDelivery), backgroundColor: "#F59E0B", borderRadius: 5, borderSkipped: false }
      ]
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x}` } } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(15,23,42,0.07)" }, ticks: { color: "#64748B", font: { size: 12 } }, border: { display: false } },
        y: { grid: { display: false }, ticks: { color: "#0F172A", font: { size: 13 } }, border: { display: false } }
      }
    }
  });
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

function exportData() { const f = getFilteredOrders(); if (!f.length) { alert("لا توجد بيانات للتصدير"); return; } downloadCSV("orders-data.csv", ["Employee", "Doctor", "Customer", "Phone", "Shipping Company", "Area", "Price", "Status", "Notes", "Created At"], f.map(o => [o.employee_name, o.doctor_name, o.customer_name, o.phone, o.shipping_company, o.area, o.price, o.status, o.notes || "", o.created_at])); }
function exportShippingAnalysis() { const rows = getShippingAnalysisRows(); downloadCSV("shipping-analysis.csv", ["Shipping Company", "Total Orders", "Signed", "Transit", "Returned", "Fake Delivery", "Fake Rate", "Return Rate"], rows.map(r => [r.company, r.total, r.signed, r.transit, r.returned, r.fakeDelivery, r.fakeRate, r.returnRate])); }
function exportDoctorsAnalysis() { const r = getDoctorsAnalysisRows(); if (!r.length) { alert("لا توجد بيانات دكاترة للتصدير"); return; } downloadCSV("doctors-analysis.csv", ["Doctor", "Total Orders", "Signed", "Transit", "Returned", "Fake Doctor", "Total Revenue", "Fake Rate", "Return Rate"], r.map(x => [x.doctor, x.total, x.signed, x.transit, x.returned, x.fakeDoctor, x.revenue, x.fakeRate, x.returnRate])); }
function exportShippingRank() { const rows = getShippingRankRows(); downloadCSV("shipping-rank.csv", ["Rank", "Shipping Company", "Total Orders", "Signed", "Returned", "Fake Delivery", "Return Rate", "Fake Rate", "Score"], rows.map((r, i) => [i + 1, r.company, r.total, r.signed, r.returned, r.fakeDelivery, r.returnRate, r.fakeRate, r.score.toFixed(1)])); }
function exportDoctorRank() { const r = getDoctorRankRows(); if (!r.length) { alert("لا توجد بيانات دكاترة للتصدير"); return; } downloadCSV("doctor-rank.csv", ["Rank", "Doctor", "Total Orders", "Signed", "Returned", "Fake", "Total Revenue", "Fake Rate", "Return Rate", "Score"], r.map((x, i) => [i + 1, x.doctor, x.total, x.signed, x.returned, x.fakeDoctor, x.revenue, x.fakeRate, x.returnRate, x.score.toFixed(1)])); }

// ===== دوال المستخدمين =====
userForm.addEventListener("submit", async (e) => {
  e.preventDefault(); if (!isAdmin()) { alert("غير مسموح"); return; }
  const userData = { name: newUserName.value.trim(), username: newUsername.value.trim(), password: newPassword.value.trim(), role: newRole.value, active: true };
  if (!userData.name || !userData.username || !userData.password || !userData.role) { alert("املى كل بيانات المستخدم"); return; }
  const { error } = await supabaseClient.from("user").insert([userData]);
  if (error) { alert("مشكلة في إضافة المستخدم: " + error.message); return; }
  userForm.reset(); await loadUsers(); alert("تم إضافة المستخدم بنجاح");
});

function renderUsers() {
  if (!users.length) {
    usersTableBody.innerHTML = `<tr><td colspan="5" class="empty">No users found</td></tr>`;
    return;
  }
  usersTableBody.innerHTML = users.map(u => `
    <tr>
      <td>${u.name || ""}</td>
      <td>${u.username || ""}</td>
      <td>${u.role || ""}</td>
      <td><span class="chip ${u.active === false ? 'chip-cancelled' : 'chip-confirmed'}">${u.active === false ? "false" : "true"}</span></td>
      <td><div style="display:flex;gap:6px;align-items:center">
        <button class="${u.active === false ? 'success' : 'yellow'}" style="padding:5px 10px;font-size:11px" onclick="toggleUserActive('${u.id}', ${u.active !== false})">${u.active === false ? 'تفعيل' : 'تعطيل'}</button>
        <button class="danger" style="padding:5px 10px;font-size:11px" onclick="deleteUser('${u.id}', '${(u.name || '').replace(/'/g, "\\'")}')">حذف</button>
      </div></td>
    </tr>
  `).join("");
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
  const names = getDoctorNames();
  doctorName.innerHTML = `<option value="">اختر اسم الدكتور</option>` + names.map(name => `<option value="${name}">${name}</option>`).join("");
  if (names.includes(current)) doctorName.value = current;
}

function renderDoctorsSettings() {
  const tbody = $("doctorsSettingsTableBody");
  if (!tbody) return;
  if (!doctorsList.length) { tbody.innerHTML = `<tr><td colspan="3" class="empty">لا يوجد دكاترة مضافة</td></tr>`; return; }
  tbody.innerHTML = doctorsList.map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${d.name || ""}</td>
      <td><button class="danger" style="padding:6px 10px;font-size:12px" onclick="deleteDoctor('${d.id}')">حذف</button></td>
    </tr>
  `).join("");
}

$("doctorSettingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin()) { alert("غير مسموح"); return; }
  const name = $("settingDoctorName").value.trim();
  if (!name) { alert("اكتب اسم الدكتور"); return; }
  const { error } = await supabaseClient.from("doctors").insert([{ name }]);
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
      // التحقق من أن الرابط يبدأ بـ http (رابط صحيح)
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
      notes: mapping["notes"] ? String(row[mapping["notes"]] || "").trim() : ""
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
exportBtn.addEventListener("click", exportData);
if (shippingRankSearch) shippingRankSearch.addEventListener("input", () => { pageState.shippingRank = 1; renderShippingRank(); renderShippingCharts(); });
if (doctorRankSearch) doctorRankSearch.addEventListener("input", () => { pageState.doctorRank = 1; renderDoctorRank(); });
if (doctorsAnalysisSearch) doctorsAnalysisSearch.addEventListener("input", () => { pageState.doctorsAnalysis = 1; renderAnalytics(); });

document.addEventListener("click", (e) => {
  if (!e.target.closest(".multi-filter")) {
    if (shippingCompanyFilterMenu) shippingCompanyFilterMenu.classList.remove("show");
  }
});

// ===== بدء التشغيل =====
initTheme();
checkLogin();