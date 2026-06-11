/* ============================================================
 * ui.js — DOM layer: HUD readouts, inventory buttons, the
 * objectives panel, toasts, the probability tooltip, the
 * mission-setup / help / results modals. All user-facing text
 * is resolved through RP.i18n at render time so a language
 * switch re-paints everything live. No game rules live here.
 * ============================================================ */
(function (RP) {
  'use strict';

  const { formatTime } = RP.utils;

  function $(id) { return document.getElementById(id); }
  const t = (key, params) => RP.i18n.t(key, params);

  class UI {
    /**
     * @param {object} handlers — {onRestart, onTogglePower(type),
     *   onToggleHeatmap, onHint, onToggleSound, onOpenSetup,
     *   onStartMission(config), onLangChange(lang), onUiClick}
     */
    constructor(handlers) {
      this.handlers = handlers;

      this.el = {
        timer: $('timer'),
        timerBox: $('timer-box'),
        mines: $('mines-left'),
        minesBox: $('mines-box'),
        operator: $('operator-line'),
        status: $('status-line'),
        objectives: $('objectives'),
        toasts: $('toasts'),
        probTip: $('prob-tip'),
        heatmapBtn: $('btn-heatmap'),
        hintBtn: $('btn-hint'),
        hintCount: $('hint-count'),
        soundBtn: $('btn-sound'),
        restartBtn: $('btn-restart'),
        setupBtn: $('btn-setup'),
        helpBtn: $('btn-help'),
        helpModal: $('modal-help'),
        resultsModal: $('modal-results'),
        setupModal: $('modal-setup'),
        setupName: $('setup-name'),
        setupMines: $('setup-mines'),
        startBtn: $('btn-start'),
        resultTitle: $('result-title'),
        resultMessage: $('result-message'),
        resultRows: $('result-rows'),
        resultTotalLabel: $('result-total-label'),
        resultTotal: $('result-total'),
        resultBest: $('result-best'),
        resultBestTime: $('result-best-time'),
        resultObjectives: $('result-objectives'),
        resultNewBest: $('result-newbest'),
        inv: {
          scanner: $('inv-scanner'),
          shield: $('inv-shield'),
          defuser: $('inv-defuser')
        }
      };

      const click = (el, fn) => el.addEventListener('click', (e) => {
        handlers.onUiClick && handlers.onUiClick();
        fn(e);
      });

      click(this.el.restartBtn, () => handlers.onRestart());
      click(this.el.heatmapBtn, () => handlers.onToggleHeatmap());
      click(this.el.hintBtn, () => handlers.onHint());
      click(this.el.soundBtn, () => handlers.onToggleSound());
      click(this.el.setupBtn, () => this.showSetup());
      click(this.el.helpBtn, () => this.showHelp());
      for (const type of Object.keys(this.el.inv)) {
        click(this.el.inv[type], () => handlers.onTogglePower(type));
      }

      /* ---------------- setup modal wiring ---------------- */
      // segmented pickers: size / difficulty / language
      this.setupChoice = Object.assign({ name: '' }, RP.storage.getSettings());

      this.el.setupModal.querySelectorAll('[data-size]').forEach((btn) => {
        click(btn, () => { this.setupChoice.sizeId = btn.dataset.size; this.refreshSetup(); });
      });
      this.el.setupModal.querySelectorAll('[data-diff]').forEach((btn) => {
        click(btn, () => { this.setupChoice.diffId = btn.dataset.diff; this.refreshSetup(); });
      });
      this.el.setupModal.querySelectorAll('[data-lang]').forEach((btn) => {
        click(btn, () => handlers.onLangChange(btn.dataset.lang));
      });

      this.el.setupName.addEventListener('input', () => this.refreshSetup());
      this.el.setupName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !this.el.startBtn.disabled) this.el.startBtn.click();
      });

      click(this.el.startBtn, () => {
        const name = this.el.setupName.value.trim();
        if (!name) return;
        this.el.setupModal.classList.remove('open');
        handlers.onStartMission({
          name,
          sizeId: this.setupChoice.sizeId,
          diffId: this.setupChoice.diffId
        });
      });

      // generic modal close (backdrop click or [data-close] button);
      // the setup modal is sticky — it only closes via START.
      for (const modal of [this.el.helpModal, this.el.resultsModal]) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal || e.target.closest('[data-close]')) {
            handlers.onUiClick && handlers.onUiClick();
            modal.classList.remove('open');
          }
        });
      }
      click($('btn-play-again'), () => {
        this.el.resultsModal.classList.remove('open');
        handlers.onRestart();
      });
    }

    /* -------------------- HUD -------------------- */

    updateTimer(game) {
      this.el.timer.textContent = formatTime(game.elapsed);
    }

    /** Full refresh — call on any game event or language switch. */
    updateHUD(game) {
      this.updateTimer(game);
      this.el.mines.textContent = String(game.minesRemaining());
      this.el.timerBox.title = t('hud.timerTitle');
      this.el.minesBox.title = t('hud.minesTitle');

      // operator line: NAME · 12×12 · MEDIUM
      const diffName = t('diff.' + game.settings.diffId);
      this.el.operator.textContent =
        t('app.operator') + ': ' + (game.playerName || '—') +
        ' · ' + game.mode.cols + '×' + game.mode.rows + ' · ' + diffName;

      for (const type of Object.keys(this.el.inv)) {
        const btn = this.el.inv[type];
        const count = game.inventory[type];
        const spawned = game.powerTypes.includes(type);
        btn.querySelector('.count').textContent = String(count);
        btn.disabled = count === 0 || game.isOver;
        btn.classList.toggle('targeting', game.targeting === type);
        btn.classList.toggle('absent', !spawned);
        btn.title = spawned
          ? t('power.' + type)
          : t('power.absent', { p: t('power.' + type) });
      }

      this.el.heatmapBtn.setAttribute('aria-pressed', String(game.heatmapOn));
      this.el.heatmapBtn.classList.toggle('jammed', game.heatmapJammed());
      this.el.heatmapBtn.title = t('hud.heatmap') + ' (H)';

      this.el.hintCount.textContent = String(game.hintsLeft);
      this.el.hintBtn.disabled = game.hintsLeft <= 0 || game.state !== 'playing';
      this.el.hintBtn.title = t('hud.hint') + ' (N)';
      this.el.restartBtn.title = t('hud.restart') + ' (R)';
      this.el.setupBtn.title = t('hud.newgame');
      this.el.helpBtn.title = t('hud.help');

      this.renderObjectives(game);
      this.renderStatus(game);
    }

    setSoundButton(on) {
      this.el.soundBtn.setAttribute('aria-pressed', String(on));
      this.el.soundBtn.title = t('hud.sound') + ' (M)';
      this.el.soundBtn.querySelector('.snd-on').style.display = on ? '' : 'none';
      this.el.soundBtn.querySelector('.snd-off').style.display = on ? 'none' : '';
    }

    renderStatus(game) {
      const el = this.el.status;
      el.classList.remove('warn', 'good', 'bad');
      let key = 'status.active';
      let tone = null;
      if (game.state === 'ready') key = 'status.ready';
      else if (game.targeting === 'scanner') { key = 'status.scanner'; tone = 'warn'; }
      else if (game.targeting === 'defuser') { key = 'status.defuser'; tone = 'warn'; }
      else if (game.state === 'won') { key = 'status.won'; tone = 'good'; }
      else if (game.state === 'cleared') { key = 'status.cleared'; tone = 'warn'; }
      else if (game.state === 'lost') { key = 'status.lost'; tone = 'bad'; }
      else if (game.heatmapJammed()) { key = 'status.jammed'; tone = 'bad'; }
      el.textContent = t(key);
      if (tone) el.classList.add(tone);
    }

    /** Translate a `live()` progress token from an objective def. */
    formatProgress(token) {
      switch (token[0]) {
        case 'done': return '✓';
        case 'frac': return token[1] + '/' + token[2];
        case 'end': return t('obj.end');
        case 'timeleft': return t('obj.timeleft', { s: token[1] });
        case 'expired': return t('obj.expired');
        default: return '';
      }
    }

    renderObjectives(game) {
      const list = this.el.objectives;
      list.innerHTML = '';
      for (const obj of game.objectives) {
        const li = document.createElement('li');
        const token = game.isOver
          ? (obj.done ? ['done'] : ['expired'])
          : obj.def.live(game);
        const isDone = token[0] === 'done';
        const isFailed = game.isOver && !obj.done;
        li.className = isDone ? 'done' : (isFailed ? 'failed' : '');

        const check = document.createElement('span');
        check.className = 'obj-check';
        check.textContent = isDone ? '◉' : (isFailed ? '✕' : '○');
        const label = document.createElement('span');
        label.className = 'obj-label';
        label.textContent = t(obj.def.labelKey);
        const progress = document.createElement('span');
        progress.className = 'obj-progress';
        progress.textContent = isFailed ? '✕' : this.formatProgress(token);

        li.append(check, label, progress);
        list.appendChild(li);
      }
    }

    /* -------------------- toasts -------------------- */

    toast(key, tone, params) {
      const div = document.createElement('div');
      div.className = 'toast ' + (tone || 'info');
      div.textContent = t(key, params);
      this.el.toasts.appendChild(div);
      while (this.el.toasts.children.length > 4) {
        this.el.toasts.removeChild(this.el.toasts.firstChild);
      }
      setTimeout(() => {
        div.classList.add('out');
        setTimeout(() => div.remove(), 350);
      }, 2600);
    }

    /* ---------------- probability tooltip ---------------- */

    showProbTip(x, y, percent) {
      const tip = this.el.probTip;
      tip.textContent = percent + '%';
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      tip.classList.add('show');
    }

    hideProbTip() {
      this.el.probTip.classList.remove('show');
    }

    /* -------------------- modals -------------------- */

    showHelp() { this.el.helpModal.classList.add('open'); }

    /** Open mission setup, prefilled from the saved profile. */
    showSetup() {
      this.el.setupName.value = RP.storage.getPlayerName();
      const saved = RP.storage.getSettings();
      this.setupChoice.sizeId = saved.sizeId;
      this.setupChoice.diffId = saved.diffId;
      this.refreshSetup();
      this.el.setupModal.classList.add('open');
      if (!this.el.setupName.value) {
        setTimeout(() => this.el.setupName.focus(), 250);
      }
    }

    /** Repaint segmented pickers + the mines preview line. */
    refreshSetup() {
      this.el.setupModal.querySelectorAll('[data-size]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.size === this.setupChoice.sizeId);
      });
      this.el.setupModal.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.diff === this.setupChoice.diffId);
      });
      this.el.setupModal.querySelectorAll('[data-lang]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.lang === RP.i18n.lang);
      });
      const mode = RP.GameModes.computeMode(this.setupChoice.sizeId, this.setupChoice.diffId);
      this.el.setupMines.textContent = t('setup.mines', {
        n: mode.mines, p: mode.powerCount, c: mode.corruptedCount
      });
      this.el.startBtn.disabled = this.el.setupName.value.trim().length === 0;
    }

    showResults(result) {
      const rows = [
        [t('result.safe', { n: result.score.safeReveals }), result.score.safePts],
        [t('result.corrupted', { n: result.score.corrupted }), result.score.corruptedPts],
        [t('result.combo'), result.score.comboPts],
        [t('result.objectives'), result.score.objectivePts],
        [t('result.timeBonus'), result.score.timeBonus]
      ];
      this.el.resultRows.innerHTML = '';
      for (const [label, pts] of rows) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        td1.textContent = label;
        const td2 = document.createElement('td');
        td2.textContent = String(pts);
        tr.append(td1, td2);
        this.el.resultRows.appendChild(tr);
      }

      this.el.resultTitle.textContent = t('result.title.' + result.state);
      this.el.resultTitle.dataset.state = result.state;
      let msg = t(result.messageKey) + ' — ' +
        t('result.time', { t: formatTime(result.elapsed) });
      if (result.stats.wrongFlags) {
        msg += ' · ' + t('result.wrongFlags', { n: result.stats.wrongFlags });
      }
      this.el.resultMessage.textContent = msg;

      this.el.resultObjectives.innerHTML = '';
      for (const o of result.objectives) {
        const li = document.createElement('li');
        li.className = o.done ? 'done' : 'failed';
        li.textContent = (o.done ? '◉ ' : '✕ ') + t(o.labelKey);
        this.el.resultObjectives.appendChild(li);
      }

      this.el.resultTotalLabel.textContent = t('result.total');
      this.el.resultTotal.textContent = String(result.total);
      this.el.resultBest.textContent = t('result.best', { n: result.best.score });
      this.el.resultBestTime.textContent = result.best.time !== null
        ? t('result.bestTime', { t: formatTime(result.best.time) }) : '';
      this.el.resultNewBest.style.display =
        (result.records.newScore || result.records.newTime) ? '' : 'none';

      this.el.resultsModal.classList.add('open');
    }
  }

  RP.UI = UI;
})(window.RP = window.RP || {});
