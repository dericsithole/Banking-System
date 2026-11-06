const tabs = {
  login: document.getElementById('login-tab'),
  register: document.getElementById('register-tab')
};
const form = document.getElementById('auth-form');
const nameField = document.getElementById('name-field');
const nameInput = document.getElementById('name');
const passwordInput = document.getElementById('password');
const passwordToggle = document.getElementById('password-toggle');
const passwordHelp = document.getElementById('password-help');
const notice = document.getElementById('auth-notice');
let mode = 'login';

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === 'register';
  nameField.hidden = !registering;
  nameInput.required = registering;
  passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
  passwordInput.minLength = registering ? 12 : 1;
  setPasswordVisibility(false);
  passwordHelp.hidden = !registering;
  tabs.login.classList.toggle('active', !registering);
  tabs.register.classList.toggle('active', registering);
  tabs.login.setAttribute('aria-selected', String(!registering));
  tabs.register.setAttribute('aria-selected', String(registering));
  document.getElementById('form-title').textContent = registering ? 'Create your account' : 'Welcome back';
  document.getElementById('form-description').textContent = registering ? 'Start with your own private sandbox accounts.' : 'Sign in to your Mega Bank sandbox account.';
  document.getElementById('submit-button').textContent = registering ? 'Create account' : 'Sign in';
  notice.className = 'notice';
  notice.textContent = '';
}

function setPasswordVisibility(visible) {
  passwordInput.type = visible ? 'text' : 'password';
  passwordToggle.textContent = visible ? 'Hide' : 'Show';
  passwordToggle.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} password`);
  passwordToggle.setAttribute('aria-pressed', String(visible));
}

tabs.login.addEventListener('click', () => setMode('login'));
tabs.register.addEventListener('click', () => setMode('register'));
passwordToggle.addEventListener('click', () => setPasswordVisibility(passwordInput.type === 'password'));
form.addEventListener('submit', async event => {
  event.preventDefault();
  notice.className = 'notice';
  notice.textContent = '';
  const submitButton = document.getElementById('submit-button');
  submitButton.disabled = true;
  try {
    const response = await fetch(`/api/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ name: nameInput.value, email: document.getElementById('email').value, password: passwordInput.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to continue.');
    location.assign('/index.html');
  } catch (error) {
    notice.textContent = error.message;
    notice.className = 'notice error';
  } finally {
    submitButton.disabled = false;
  }
});
