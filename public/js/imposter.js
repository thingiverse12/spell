/* =====================================================================
   Inpostern – ett ord, en bluff och en hemlig roll.

   Alla utom inposterna får samma ord; inposterna får bara en bred ledtråd.
   Spelet spelas på egna skärmar: var och en går med i ett bord med en kod
   och skriver sin ledtråd själv. Servern delar ut rollerna och håller reda
   på vems tur det är, så ingen ser någon annans roll och ingen kan skriva
   två ledtrådar.

   En omgång: ledtrådar i tur och ordning → alla röstar → åker en inposter ut
   vinner laget, annars får inposterna gissa ordet.

   Vyn är tunn med flit – allt spel ligger i imposter-online.js.
   ===================================================================== */

import { registerView, sfx, navigate } from './core.js';
import { mountOnline, unmountOnline, joinCode } from './imposter-online.js';

const ui = { root: null };

function renderImposter(root, route) {
  ui.root = root;
  const code = (route && route.parts && route.parts[2]) || '';

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Inpostern</h1>
          <p>Ett ord, en bluff – alla skriver sin egen ledtråd på sin egen skärm</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="imp-home">← Spelhallen</button>
      </div>

      <div id="imp-stage"><div id="inpo-host"></div></div>

      <p class="tiny muted" style="margin:18px 0 30px">
        Inget av detta är riktiga pengar. Alla lägger samma insats i kassan och servern delar ut rollerna –
        vinner <b>laget</b> får varje lagmedlem dubbelt igen, vinner <b>inposterna</b> delar de hela kassan.
      </p>
    </div>`;

  root.querySelector('#imp-home').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino');
  });

  document.onkeydown = null;
  mountOnline(root.querySelector('#inpo-host'));
  if (code) joinCode(code);
}

/** Stänger pollningen när man lämnar vyn. */
export function stopImposter() {
  unmountOnline();
  ui.root = null;
}

registerView('imposter', renderImposter);
