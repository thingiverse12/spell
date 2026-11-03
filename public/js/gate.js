/* =====================================================================
   Kontoporten – alla måste ha ett eget konto (namn + PIN) för att komma
   in i Plugghörnan. Gästkontot som skapas vid första besöket duger bara
   till att skapa kontot med, så saldo och framsteg aldrig blir kvar hos
   en namnlös gäst.
   ===================================================================== */

import { state, api, sfx, toast, esc, updateBalanceUI, renderRoute } from './core.js';

let gate = null;

/* Behöver spelaren skapa ett konto? Adminpanelen ska alltid gå att nå. */
function accountNeeded() {
  if (state.adminToken) return false;
  const player = state.player;
  if (!player) return false;
  return !player.hasPin;
}

function showError(text) {
  const box = gate && gate.querySelector('#gate-error');
  if (!box) return;
  box.innerHTML = text ? `<p class="quiz__feedback quiz__feedback--no">${esc(text)}</p>` : '';
}

function suggestedName() {
  const name = (state.player && state.player.name) || '';
  return /^Gäst/i.test(name) ? '' : name;
}

function build() {
  gate = document.createElement('div');
  gate.className = 'gate';
  gate.id = 'account-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.innerHTML = `
    <div class="gate__card">
      <div class="gate__mark">♠</div>
      <h1 class="gate__title">Skapa ditt konto</h1>
      <p class="gate__sub">
        Alla som använder Plugghörnan behöver ett eget konto med namn och PIN-kod.
        Då sparas mynt, vinster och framsteg – även om du byter mobil eller dator.
      </p>

      <label class="field"><span>Namn</span>
        <input class="input" id="gate-name" maxlength="24" autocomplete="nickname"
               placeholder="Ditt namn" value="${esc(suggestedName())}" />
      </label>
      <label class="field"><span>PIN-kod (4 siffror)</span>
        <input class="input" id="gate-pin" inputmode="numeric" maxlength="4"
               autocomplete="off" placeholder="••••" />
      </label>
      <label class="field"><span>PIN-kod igen</span>
        <input class="input" id="gate-pin2" inputmode="numeric" maxlength="4"
               autocomplete="off" placeholder="••••" />
      </label>
      <div id="gate-error"></div>
      <button class="btn btn--primary btn--block" id="gate-create">Skapa konto och börja</button>

      <p class="gate__foot">
        Har du redan ett konto?
        <button class="gate__link" id="gate-show-login" type="button">Logga in i stället</button>
      </p>

      <div class="gate__login hide" id="gate-login">
        <label class="field"><span>Namn</span>
          <input class="input" id="gate-login-name" maxlength="24" autocomplete="username" placeholder="Ditt namn" />
        </label>
        <label class="field"><span>PIN-kod</span>
          <input class="input" id="gate-login-pin" inputmode="numeric" maxlength="4"
                 autocomplete="current-password" placeholder="••••" />
        </label>
        <button class="btn btn--ghost btn--block" id="gate-login-btn">Logga in</button>
      </div>
    </div>`;
  document.body.appendChild(gate);
  document.body.classList.add('is-gated');
  bind();
  setTimeout(() => {
    const first = gate && gate.querySelector('#gate-name');
    if (first) first.focus();
  }, 80);
}

function close() {
  if (gate) gate.remove();
  gate = null;
  document.body.classList.remove('is-gated');
}

async function createAccount(btn) {
  const name = gate.querySelector('#gate-name').value.trim();
  const pin = gate.querySelector('#gate-pin').value.trim();
  const again = gate.querySelector('#gate-pin2').value.trim();
  if (name.length < 2) return showError('Namnet måste vara minst två tecken.');
  if (!/^\d{4}$/.test(pin)) return showError('PIN-koden måste vara fyra siffror.');
  if (again !== pin) return showError('PIN-koderna är inte lika – skriv samma två gånger.');
  showError('');
  btn.disabled = true;
  try {
    await api.register(name, pin);
    sfx.correct();
    toast(`Välkommen ${name}! Ditt konto är klart.`, 'ok', 3200);
    updateBalanceUI();
    close();
    renderRoute();
  } catch (err) {
    sfx.wrong();
    showError(err.message || 'Kunde inte skapa kontot – försök igen.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function login(btn) {
  const name = gate.querySelector('#gate-login-name').value.trim();
  const pin = gate.querySelector('#gate-login-pin').value.trim();
  if (!name || !/^\d{4}$/.test(pin)) {
    toast('Fyll i namn och fyrsiffrig PIN', 'bad');
    return;
  }
  btn.disabled = true;
  try {
    await api.login(name, pin);
    sfx.correct();
    toast('Inloggad – välkommen tillbaka!', 'ok');
    updateBalanceUI();
    close();
    syncAccountGate();
    renderRoute();
  } catch (err) {
    sfx.wrong();
    toast(err.message || 'Kunde inte logga in', 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function bind() {
  const createBtn = gate.querySelector('#gate-create');
  createBtn.addEventListener('click', () => createAccount(createBtn));

  const loginBtn = gate.querySelector('#gate-login-btn');
  loginBtn.addEventListener('click', () => login(loginBtn));

  gate.querySelector('#gate-show-login').addEventListener('click', () => {
    const box = gate.querySelector('#gate-login');
    box.classList.toggle('hide');
    if (!box.classList.contains('hide')) {
      const field = gate.querySelector('#gate-login-name');
      if (field) field.focus();
    }
  });

  // Enter ska räcka – skapa kontot från vilket fält som helst i formuläret.
  gate.querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const inLogin = !!input.closest('#gate-login');
      if (inLogin) login(loginBtn);
      else createAccount(createBtn);
    });
  });
}

/* Visar eller tar bort porten beroende på om spelaren har ett konto. */
export function syncAccountGate() {
  if (!accountNeeded()) {
    close();
    return;
  }
  if (!gate) build();
}
