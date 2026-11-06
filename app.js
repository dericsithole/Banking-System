const root = document.getElementById('app');
const page = document.body.dataset.page;
let data;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const dateText = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));

function requestRows(requests) {
  if (!requests.length) return '<div class="empty">No requests have been submitted.</div>';
  return requests.map(item => `<div class="activity-row"><div><strong>${escapeHtml(item.type)} request${item.product ? ` - ${escapeHtml(item.product)}` : ''}</strong><small>${escapeHtml(item.status)}</small></div><div class="activity-date">${dateText(item.createdAt)}</div><div class="money activity-kind">${item.amountCents ? money(item.amountCents) : ''}</div></div>`).join('');
}

function renderShell(content) {
  const links = [['overview', '/index.html', 'Overview'], ['accounts', '/accounts.html', 'Accounts'], ['payments', '/payments.html', 'Requests'], ['cards', '/cards.html', 'Cards']];
  const active = links.find(item => item[0] === page)?.[2] || 'Overview';
  const initials = data.user.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  root.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="/index.html"><span class="brand-mark">M</span> Mega Bank</a><div class="nav-label">YOUR BANK</div><nav class="nav" aria-label="Main navigation">${links.map(([key, href, label]) => `<a class="${key === page ? 'active' : ''}" href="${href}">${label}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="profile"><div class="avatar">${escapeHtml(initials)}</div><div><strong>${escapeHtml(data.user.name)}</strong><small>${escapeHtml(data.user.email)}</small></div></div><button class="button-secondary sidebar-signout" data-action="logout">Sign out</button></div></aside><main class="main"><header class="topbar"><div class="mobile-brand"><span class="brand-mark">M</span> Mega Bank</div><div class="crumb">Personal banking / ${active}</div><button class="button-secondary" data-action="logout">Sign out</button></header><div class="page-heading"><div><div class="eyebrow">Personal banking</div><h1>${active}</h1><p>Welcome, ${escapeHtml(data.user.name)}.</p></div><span class="help-text">${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span></div><div class="notice-banner">Banking data is not connected yet. Submitted requests are saved to this local installation and are not processed.</div><div id="page-notice" class="notice" role="status"></div>${content}<p class="help-text">Mega Bank is a local prototype. Do not enter real financial credentials or use it for real transactions.</p></main><nav class="mobile-nav" aria-label="Mobile navigation">${links.map(([key, href, label]) => `<a class="${key === page ? 'active' : ''}" href="${href}"><span>${label.slice(0, 1)}</span>${label}</a>`).join('')}</nav></div>`;
  bindActions();
}

function renderPage() {
  if (page === 'accounts') return `<div class="grid"><section class="panel"><h2>Account information</h2><p class="help-text">Account balances and details will appear here after a verified banking data connection is configured.</p><div class="empty">No account data is connected.</div></section><section class="panel"><h2>Request an account</h2><p class="help-text">Save a request for the Mega Bank team to review.</p><form data-request-form><input type="hidden" name="type" value="account"><div class="field"><label for="account-product">Account type</label><select id="account-product" name="product" required><option value="checking">Checking</option><option value="savings">Savings</option></select></div><button class="button" type="submit">Save account request</button></form></section></div><section class="panel"><h2>Your saved requests</h2>${requestRows(data.requests.filter(item => item.type === 'account'))}</section>`;
  if (page === 'payments') return `<div class="grid"><section class="panel"><h2>Request a transfer</h2><p class="help-text">The request is saved for review only. No account is charged and no money moves.</p><form data-request-form><input type="hidden" name="type" value="transfer"><div class="field"><label for="recipient-email">Registered customer's email</label><input id="recipient-email" name="recipientEmail" type="email" autocomplete="off" required></div><div class="field"><label for="transfer-amount">Requested amount</label><input id="transfer-amount" name="amount" type="number" min="0.01" max="1000000" step="0.01" required></div><div class="field"><label for="transfer-memo">Reference (optional)</label><input id="transfer-memo" name="memo" maxlength="80"></div><button class="button" type="submit">Save transfer request</button></form></section><aside class="panel"><h2>Transfer requests</h2><p class="help-text">Requests can be submitted only for another registered customer.</p>${requestRows(data.requests.filter(item => item.type === 'transfer'))}</aside></div>`;
  if (page === 'cards') return `<div class="grid"><section class="panel"><h2>Card information</h2><p class="help-text">Card details and controls will appear here after a verified banking data connection is configured.</p><div class="empty">No card data is connected.</div></section><section class="panel"><h2>Request a card</h2><p class="help-text">Save a card request for review. No card is issued by this prototype.</p><form data-request-form><input type="hidden" name="type" value="card"><div class="field"><label for="card-product">Card type</label><select id="card-product" name="product" required><option value="debit">Debit card</option><option value="credit">Credit card</option></select></div><button class="button" type="submit">Save card request</button></form></section></div><section class="panel"><h2>Your saved requests</h2>${requestRows(data.requests.filter(item => item.type === 'card'))}</section>`;
  return `<section class="balance-card"><small>Customer profile</small><strong>${escapeHtml(data.user.name)}</strong><p>${escapeHtml(data.user.email)}</p><div class="button-row"><a class="button" href="/accounts.html">Request an account</a><a class="button-secondary" href="/payments.html">Request a transfer</a></div></section><div class="grid"><section class="panel"><h2>Account status</h2><p class="help-text">No account balances are shown because no banking data source is connected.</p><a class="text-link" href="/accounts.html">View account options</a></section><section class="panel"><h2>Recent requests</h2>${requestRows(data.requests.slice(0, 5))}</section></div>`;
}

function notice(message, error = false) {
  const element = document.getElementById('page-notice');
  if (!element) return;
  element.textContent = message;
  element.className = `notice ${error ? 'error' : 'success'}`;
}

async function api(path, { method = 'GET', body, mutate = false } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (mutate) headers['X-CSRF-Token'] = data.csrf;
  const response = await fetch(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (response.status === 401) { location.assign('/auth.html'); throw new Error('Please sign in again.'); }
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

async function refresh(message = '') {
  data = await api('/api/data');
  renderShell(renderPage());
  if (message) notice(message);
}

function bindActions() {
  document.querySelectorAll('[data-action="logout"]').forEach(button => button.addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST', mutate: true, body: {} }); location.assign('/auth.html'); }
    catch (error) { notice(error.message, true); }
  }));
  document.querySelectorAll('[data-request-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const requestBody = Object.fromEntries(new FormData(form).entries());
    try { await api('/api/requests', { method: 'POST', mutate: true, body: requestBody }); await refresh('Your request was saved. It has not been processed.'); }
    catch (error) { notice(error.message, true); }
  }));
}

refresh().catch(error => { if (error.message !== 'Please sign in again.') { root.textContent = error.message; root.className = 'loading'; } });
