// Internal page history only: no order data, external URLs, or permission grants.
let appPageNavigation = { actor:'', current:null, entries:[], pending:null };

function resetAppPageHistory() {
  if (appPageNavigation.pending) appPageNavigation.pending.cancelled = true;
  appPageNavigation = { actor:'', current:null, entries:[], pending:null };
}

function syncAppPageHistoryActor() {
  const actor = currentUser ? String(currentUser.id || currentUser.username || '') : '';
  if (actor !== appPageNavigation.actor) {
    resetAppPageHistory();
    appPageNavigation.actor = actor;
  }
  return actor;
}

function getAppPageRoute(pageId) {
  const route = { pageId };
  if (pageId === 'branchPage' || pageId === 'khaznaPage') route.branch = currentBranchName || '';
  if (pageId === 'shippingRankPage') {
    route.mode = shippingRankMode === 'company' ? 'company' : 'branch';
    route.branch = branchShippingRankOverride || '';
  }
  if (pageId === 'financialAuditPage') {
    route.scope = financialAuditState.scope === 'branch' ? 'branch' : 'branches';
    if (route.scope === 'branch') route.branch = currentBranchName || '';
  }
  return route;
}

function appPageRouteKey(route) {
  return route ? JSON.stringify([route.pageId, route.branch || '', route.mode || '', route.scope || '']) : '';
}

function rememberAppPage(pageId) {
  if (!syncAppPageHistoryActor()) return;
  const route = getAppPageRoute(pageId), key = appPageRouteKey(route);
  if (appPageRouteKey(appPageNavigation.current) === key) return;
  const pending = appPageNavigation.pending;
  if (pending && pending.expected.has(key)) {
    appPageNavigation.current = route;
    return;
  }
  // A normal navigation during a slow Back load takes priority over that load.
  if (pending) { pending.cancelled = true; appPageNavigation.pending = null; }
  if (appPageNavigation.current) appPageNavigation.entries.push(appPageNavigation.current);
  appPageNavigation.entries = appPageNavigation.entries.slice(-40);
  appPageNavigation.current = route;
}

function canRestoreAppPage(route) {
  if (!currentUser || !route) return false;
  const branchAllowed = () => Boolean(route.branch && canOpenPermissionBranch(route.branch) && canAccessBranch(route.branch));
  const features = {
    ordersPage:'dashboard', activityLogPage:'activity_log', productReportsPage:'product_reports',
    branchStockPage:'branch_stock', pendingPage:'pending', okbStoresReportPage:'stores_report',
    branchesTreasuryPage:'branches_treasury', doctorRankPage:'doctor_rank_stores',
    branchRankPage:'daily_report', usersPage:'users', branchsPage:'settings_page',
    chatPage:'chat', secretaryAuditPage:'secretary_audit'
  };
  if (Object.prototype.hasOwnProperty.call(features, route.pageId)) return hasRoleFeature(features[route.pageId]);
  if (route.pageId === 'branchPage') return branchAllowed();
  if (route.pageId === 'khaznaPage') return branchAllowed() && canViewKhazna();
  if (route.pageId === 'permissionPage') return isAdmin();
  if (route.pageId === 'commissionPage') return hasRoleFeature('commission') && (isAdmin() || commissionAccessibleBranches().length > 0);
  if (route.pageId === 'financialAuditPage') return hasButtonPermission('btn_financial_audit') && (route.scope !== 'branch' || branchAllowed());
  if (route.pageId === 'shippingRankPage') {
    return canViewShippingRank() && (route.mode !== 'company' || hasRoleFeature('company_rank')) &&
      (!route.branch || (branchAllowed() && hasButtonPermission('btn_branch_shipping_rank')));
  }
  if (route.pageId === 'analyticsPage') return hasRoleFeature('dashboard') && !isStoreManager();
  return false;
}

function getAppPageFallback() {
  const candidates = [
    {pageId:'ordersPage'},
    ...Object.keys(ROLE_BRANCH_FEATURES).map(branch => ({pageId:'branchPage', branch})),
    ...['productReportsPage','pendingPage','branchRankPage','shippingRankPage','branchStockPage',
      'okbStoresReportPage','doctorRankPage','branchesTreasuryPage','commissionPage','activityLogPage',
      'branchsPage','usersPage','chatPage','secretaryAuditPage','financialAuditPage','permissionPage'].map(pageId =>
      pageId === 'shippingRankPage' ? {pageId, mode:'branch', branch:''} :
        pageId === 'financialAuditPage' ? {pageId, scope:'branches'} : {pageId})
  ];
  return candidates.find(canRestoreAppPage) || null;
}

async function openRememberedAppPage(route, pending) {
  if (!canRestoreAppPage(route)) return;
  const needsBranch = route.pageId === 'khaznaPage' || (route.pageId === 'financialAuditPage' && route.scope === 'branch') ||
    (route.pageId === 'shippingRankPage' && route.branch);
  if (needsBranch) {
    // Establish the actual branch UI as well as its data before restoring a child page.
    await openBranchPage(route.branch);
    if (pending.cancelled || appPageNavigation.pending !== pending || !canRestoreAppPage(route)) return;
  }
  switch (route.pageId) {
    case 'ordersPage': return showOrdersPage();
    case 'activityLogPage': return showActivityLogPage();
    case 'productReportsPage': return showProductReportsPage();
    case 'branchStockPage': return showBranchStockPage();
    case 'pendingPage': return showPendingPage();
    case 'okbStoresReportPage': return showOKBStoresReportPage();
    case 'branchesTreasuryPage': return showBranchesTreasuryPage();
    case 'commissionPage': return showCommissionPage();
    case 'analyticsPage': return showAnalyticsPage();
    case 'doctorRankPage': return showDoctorRankPage();
    case 'branchRankPage': return showBranchRankPage();
    case 'usersPage': return showUsersPage();
    case 'branchsPage': return showBranchsPage();
    case 'permissionPage': return showPermissionPage();
    case 'branchPage': return openBranchPage(route.branch);
    case 'khaznaPage': return openKhaznaPage();
    case 'chatPage': return showChatPage();
    case 'secretaryAuditPage': return openSecretaryAudit();
    case 'financialAuditPage': return openFinancialAudit(route.scope);
    case 'shippingRankPage':
      if (route.branch) {
        shippingRankMode = route.mode;
        return openBranchShippingRankFromBranch();
      }
      return showShippingRankPage(route.mode);
  }
}

async function goBackToPreviousPage() {
  if (!syncAppPageHistoryActor() || appPageNavigation.pending) return;
  const currentKey = appPageRouteKey(appPageNavigation.current);
  let route;
  while (appPageNavigation.entries.length) {
    const candidate = appPageNavigation.entries.pop();
    if (appPageRouteKey(candidate) !== currentKey && canRestoreAppPage(candidate)) { route = candidate; break; }
  }
  if (!route) route = getAppPageFallback();
  if (!route || appPageRouteKey(route) === currentKey) return;
  const pending = { expected:new Set([appPageRouteKey(route)]), cancelled:false };
  if (route.branch) pending.expected.add(appPageRouteKey({pageId:'branchPage', branch:route.branch}));
  appPageNavigation.pending = pending;
  const buttons = [...document.querySelectorAll('[data-app-back]')].map(button => [button, button.disabled]);
  buttons.forEach(([button]) => { button.disabled = true; button.setAttribute('aria-busy','true'); });
  try {
    closeHeaderSettingsMenu(); closeShippingRankMenu(); closeOKBStoresMenu();
    await openRememberedAppPage(route, pending);
  } catch (error) {
    console.warn('Back navigation failed:', error);
    if (!pending.cancelled) {
      if (appPageRouteKey(appPageNavigation.current) === currentKey && canRestoreAppPage(route)) appPageNavigation.entries.push(route);
      alert('تعذر الرجوع للصفحة السابقة. حاول مرة أخرى.');
    }
  } finally {
    if (appPageNavigation.pending === pending) appPageNavigation.pending = null;
    buttons.forEach(([button, disabled]) => { button.disabled = disabled; button.removeAttribute('aria-busy'); });
  }
}
