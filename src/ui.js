/* ============================================================
 * ui.js — DOM layer: HUD readouts, inventory buttons, the
 * objectives panel, toasts, the probability tooltip and the
 * How-to-Play / Results modals. No game rules live here.
 * ============================================================ */
(function (RP) {
  'use strict';

  const { formatTime } = RP.utils;

  function $(id) { return document.getElementById(id); }

  class UI {
    /** @param {object} handlers — {onRestart, onTogglePower(type), onToggleHeatmap} */
    constructor(handlers) {
      this.handlers = handlers;

      this.el = {
        timer: $('timer'),
        mines: $('mines-left'),
        status: $('status-line'),
        objectives: $('objectives'),
        toasts: $('toasts'),
        probTip: $('prob-tip'),
        heatmapBtn: $('btn-heatmap'),
        restartBtn: $('btn-restart'),
        helpBtn: $('btn-help'),
        helpModal: $('modal-help'),
        resultsModal: $('modal-results'),
        resultTitle: $('result-title'),
        resultMessage: $('result-message'),
        resultRows: $('result-rows'),
        resultTotal: $('result-total'),
        resultBest: $('result-best'),
        resultObjectives: $('result-objectives'),
        resultNewBest: $('result-newbest'),
        inv: {
          scanner: $('inv-scanner'),
          shield: $('inv-shield'),
          defuser: $('inv-defuser')
        }
      };

      this.el.restartBtn.addEventListener('click', () => handlers.onRestart());
      this.el.heatmapBtn.addEventListener('click', () => handlers.onToggleHeatmap());
      this.el.helpBtn.addEventListener('click', () => this.showHelp());
      for (const type of Object.keys(this.el.inv)) {
        this.el.inv[type].addEventListener('click', () => handlers.onTogglePower(type));
      }

      // generic modal close (backdrop click or [data-close] button)
      for (const modal of [this.el.helpModal, this.el.resultsModal]) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal || e.target.closest('[data-close]')) {
            modal.classList.remove('open');
          }
        });
      }
      $('btn-play-again').addEventListener('click', () => {
        this.el.resultsModal.classList.remove('open');
        handlers.onRestart();
      });
    }

    /* -------------------- HUD -------------------- */

    /** Cheap per-frame update (timer only). */
    updateTimer(game) {
      this.el.timer.textContent = formatTime(game.elapsed);
    }

    /** Full refresh — call on any game event. */
    updateHUD(game) {
      this.updateTimer(game);
      this.el.mines.textContent = String(game.minesRemaining());

      for (const type of Object.keys(this.el.inv)) {
        const btn = this.el.inv[type];
        const count = game.inventory[type];
        const spawned = game.powerTypes.includes(type);
        btn.querySelector('.count').textContent = String(count);
        btn.disabled = count === 0 || game.isOver;
        btn.classList.toggle('targeting', game.targeting === type);
        btn.classList.toggle('absent', !spawned);
        btn.title = spawned
          ? RP.PowerInfo[type].name
          : RP.PowerInfo[type].name + ' (not on this board)';
      }

      this.el.heatmapBtn.setAttribute('aria-pressed', String(game.heatmapOn));
      this.el.heatmapBtn.classList.toggle('jammed', game.heatmapJammed());

      this.renderObjectives(game);
      this.renderStatus(game);
    }

    renderStatus(game) {
      const el = this.el.status;
      el.classList.remove('warn', 'good', 'bad');
      if (game.state === 'ready') {
        el.textContent = 'Click any tile to initialize the grid';
      } else if (game.targeting === 'scanner') {
        el.textContent = 'SCANNER ARMED — click a revealed tile (Esc cancels)';
        el.classList.add('warn');
      } else if (game.targeting === 'defuser') {
        el.textContent = 'DEFUSER ARMED — click a hidden tile (Esc cancels)';
        el.classList.add('warn');
      } else if (game.state === 'won') {
        el.textContent = 'REACTOR STABILIZED';
        el.classList.add('good');
      } else if (game.state === 'cleared') {
        el.textContent = 'Grid cleared — complete objectives to stabilize reactor';
        el.classList.add('warn');
      } else if (game.state === 'lost') {
        el.textContent = 'CONTAINMENT FAILURE';
        el.classList.add('bad');
      } else if (game.heatmapJammed()) {
        el.textContent = 'Heatmap sensors jammed…';
        el.classList.add('bad');
      } else {
        el.textContent = 'Reactor grid active';
      }
    }

    renderObjectives(game) {
      const list = this.el.objectives;
      list.innerHTML = '';
      for (const obj of game.objectives) {
        const li = document.createElement('li');
        const progress = game.isOver
          ? (obj.done ? 'done' : 'failed')
          : obj.def.live(game);
        const isDone = progress === 'done';
        li.className = isDone ? 'done' : (progress === 'failed' ? 'failed' : '');
        li.innerHTML =
          '<span class="obj-check">' + (isDone ? '◉' : (progress === 'failed' ? '✕' : '○')) + '</span>' +
          '<span class="obj-label">' + obj.def.label + '</span>' +
          '<span class="obj-progress">' + (isDone ? '✓' : progress) + '</span>';
        list.appendChild(li);
      }
    }

    /* -------------------- toasts -------------------- */

    toast(message, tone) {
      const div = document.createElement('div');
      div.className = 'toast ' + (tone || 'info');
      div.textContent = message;
      this.el.toasts.appendChild(div);
      // keep the stack short
      while (this.el.toasts.children.length > 4) {
        this.el.toasts.removeChild(this.el.toasts.firstChild);
      }
      setTimeout(() => {
        div.classList.add('out');
        setTimeout(() => div.remove(), 350);
      }, 2600);
    }

    /* ---------------- probability tooltip ---------------- */

    /** x/y are CSS pixels relative to the board wrapper. */
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

    showResults(result) {
      const rows = [
        ['Safe reveals ×' + result.score.safeReveals + ' (×10)', result.score.safePts],
        ['Corrupted reveals ×' + result.score.corrupted + ' (×25)', result.score.corruptedPts],
        ['Combo bonus', result.score.comboPts],
        ['Objectives (×50)', result.score.objectivePts],
        ['Time bonus', result.score.timeBonus]
      ];
      this.el.resultRows.innerHTML = rows.map(([label, pts]) =>
        '<tr><td>' + label + '</td><td>' + pts + '</td></tr>').join('');

      this.el.resultTitle.textContent =
        result.state === 'won' ? 'REACTOR STABILIZED'
          : result.state === 'cleared' ? 'GRID CLEARED'
            : 'CONTAINMENT FAILURE';
      this.el.resultTitle.dataset.state = result.state;
      this.el.resultMessage.textContent = result.message +
        ' — time ' + formatTime(result.elapsed) +
        (result.stats.wrongFlags ? ' · wrong flags: ' + result.stats.wrongFlags : '');

      this.el.resultObjectives.innerHTML = result.objectives.map((o) =>
        '<li class="' + (o.done ? 'done' : 'failed') + '">' +
        (o.done ? '◉ ' : '✕ ') + o.label + '</li>').join('');

      this.el.resultTotal.textContent = String(result.total);
      this.el.resultBest.textContent = 'Best: ' + result.best;
      this.el.resultNewBest.style.display = result.isBest ? '' : 'none';

      this.el.resultsModal.classList.add('open');
    }
  }

  RP.UI = UI;
})(window.RP = window.RP || {});
