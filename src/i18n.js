/* ============================================================
 * i18n.js — English / Arabic localization.
 *
 * Flat key dictionaries + a tiny t(key, params) formatter with
 * {placeholder} substitution. Arabic switches the document to
 * RTL and an Arabic font stack (see styles.css `html[dir=rtl]`
 * rules). Dynamic strings (status line, toasts, objectives)
 * are emitted from game.js as KEYS and resolved here at render
 * time, so switching language re-translates everything live.
 * ============================================================ */
(function (RP) {
  'use strict';

  const DICTS = {
    /* ---------------------------- ENGLISH ---------------------------- */
    en: {
      'app.kicker': '// CONTAINMENT GRID — SECTOR L2',
      'app.subtitle': 'REACTOR PROTOCOL · LEVEL 2',
      'app.operator': 'OPERATOR',

      'setup.title': '// MISSION SETUP',
      'setup.name': 'Operator name',
      'setup.namePh': 'Enter your name…',
      'setup.size': 'Grid size',
      'setup.diff': 'Difficulty',
      'setup.lang': 'Language',
      'setup.start': 'START MISSION',
      'setup.mines': '{n} mines · {p} power · {c} corrupted',
      'diff.easy': 'Easy',
      'diff.medium': 'Medium',
      'diff.hard': 'Hard',

      'hud.heatmap': 'Heatmap',
      'hud.hint': 'Hint',
      'hud.sound': 'Sound',
      'hud.restart': 'Restart',
      'hud.newgame': 'New game',
      'hud.help': 'Help',
      'hud.minesTitle': 'Mines remaining (mines − flags)',
      'hud.timerTitle': 'Mission timer',
      'power.scanner': 'Scanner Pulse',
      'power.shield': 'Shield',
      'power.defuser': 'Defuser',
      'power.absent': '{p} (not on this board)',

      'status.ready': 'Click any tile to initialize the grid',
      'status.active': 'Reactor grid active',
      'status.scanner': 'SCANNER ARMED — click a revealed tile (Esc cancels)',
      'status.defuser': 'DEFUSER ARMED — click a hidden tile (Esc cancels)',
      'status.won': 'REACTOR STABILIZED',
      'status.cleared': 'Grid cleared — complete objectives to stabilize reactor',
      'status.lost': 'CONTAINMENT FAILURE',
      'status.jammed': 'Heatmap sensors jammed…',

      'objectives.head': '// STABILIZATION OBJECTIVES',
      'obj.scanner': 'Use Scanner Pulse at least once',
      'obj.corrupted3': 'Reveal 3 corrupted tiles',
      'obj.noWrongFlags': 'Finish with 0 wrong flags',
      'obj.under180': 'Finish under 180 seconds',
      'obj.end': 'checked at end',
      'obj.timeleft': '{s}s left',
      'obj.expired': 'expired',

      'toast.shield': 'Shield absorbed the blast — mine still buried!',
      'toast.got.scanner': 'Scanner Pulse acquired',
      'toast.got.shield': 'Shield acquired',
      'toast.got.defuser': 'Defuser acquired',
      'toast.shieldPassive': 'Shield is passive — it auto-blocks one mine hit',
      'toast.scanCenter': 'Pulse center must be a revealed tile',
      'toast.scanHit': 'Scanner pulse revealed {n} tile(s)',
      'toast.scanMiss': 'Scanner pulse found nothing new',
      'toast.defuserTarget': 'Defuser needs a hidden, unflagged tile',
      'toast.defused': 'Mine neutralized — numbers recalibrated',
      'toast.defuserMiss': 'No mine detected — defuser expended',
      'toast.corrGlitch': 'Corruption: grid signal glitched',
      'toast.corrTime': 'Corruption: +{s}s temporal drag',
      'toast.corrJam': 'Corruption: heatmap jammed for {s}s',
      'toast.hintSafe': 'Safe tile detected — marked on the grid',
      'toast.hintNone': 'No provably safe tile right now — flag more mines',
      'toast.soundOn': 'Sound on',
      'toast.soundOff': 'Sound muted',
      'toast.seed': 'Deterministic seed active: "{s}"',

      'result.title.won': 'REACTOR STABILIZED',
      'result.title.cleared': 'GRID CLEARED',
      'result.title.lost': 'CONTAINMENT FAILURE',
      'result.msg.won': 'Reactor stabilized — protocol complete',
      'result.msg.cleared': 'Grid cleared — complete objectives to stabilize reactor',
      'result.msg.lost': 'Reactor breach — containment failed',
      'result.time': 'time {t}',
      'result.wrongFlags': 'wrong flags: {n}',
      'result.safe': 'Safe reveals ×{n} (×10)',
      'result.corrupted': 'Corrupted reveals ×{n} (×25)',
      'result.combo': 'Combo bonus',
      'result.objectives': 'Objectives (×50)',
      'result.timeBonus': 'Time bonus',
      'result.total': 'TOTAL',
      'result.best': 'Best: {n}',
      'result.bestTime': 'Best time: {t}',
      'result.newBest': '★ NEW BEST',
      'result.again': 'RUN IT AGAIN',

      'help.title': '// OPERATOR BRIEFING',
      'help.engage': 'ENGAGE',
      'help.basics.h': 'Basics',
      'help.basics.p': 'Classic rules: reveal every safe tile — numbers show adjacent mines. Your first click is always safe. <b>Left-click / tap</b> reveals · <b>right-click / long-press</b> flags.',
      'help.powers.h': 'Power tiles <small>(reveal to collect)</small>',
      'help.scanner.p': '<b>Scanner Pulse</b> — pick a revealed tile; safely reveals the plus-shape around it (range 2). Mines are never revealed.',
      'help.shield.p': '<b>Shield</b> — passive. Absorbs one mine click; the mine stays buried and the run continues.',
      'help.defuser.p': '<b>Defuser</b> — probe one hidden tile. A mine is neutralized into a safe tile (numbers recalculate); a dud burns the charge.',
      'help.corrupt.h': 'Corrupted tiles <small>(never mines)</small>',
      'help.corrupt.p': 'Revealing one is safe but triggers a glitch: visual static, <b>+2s</b> on the clock, or a <b>5s heatmap jam</b>. Worth +25 score each.',
      'help.heatmap.h': 'Heatmap',
      'help.heatmap.p': 'Toggle with <b>H</b>. Tiles are tinted by <i>estimated</i> mine risk — hover (or long-press on mobile) for the percentage. It is a heuristic, not an oracle.',
      'help.pro.h': 'Pro moves',
      'help.pro.p': '<b>Chord:</b> click a revealed number whose flags match it to pop all its remaining neighbors at once. <b>Hint (2 per run):</b> marks a provably safe tile. <b>N</b> hint · <b>M</b> mute.',
      'help.win.h': 'Winning',
      'help.win.p': 'Clear the grid <b>and</b> complete both objectives. Score: +10 per safe tile, +25 per corrupted, +50 per objective, a time bonus, and combo chains for fast consecutive reveals.',

      'hints.click': '<b>Click</b> reveal',
      'hints.flag': '<b>Right-click / hold</b> flag',
      'hints.h': '<b>H</b> heatmap',
      'hints.n': '<b>N</b> hint',
      'hints.r': '<b>R</b> restart'
    },

    /* ---------------------------- ARABIC ---------------------------- */
    ar: {
      'app.kicker': '// شبكة الاحتواء — القطاع L2',
      'app.subtitle': 'بروتوكول المفاعل · المستوى 2',
      'app.operator': 'المشغّل',

      'setup.title': '// إعداد المهمة',
      'setup.name': 'اسم اللاعب',
      'setup.namePh': 'أدخل اسمك…',
      'setup.size': 'حجم الشبكة',
      'setup.diff': 'الصعوبة',
      'setup.lang': 'اللغة',
      'setup.start': 'ابدأ المهمة',
      'setup.mines': '{n} لغم · {p} قوة · {c} فاسدة',
      'diff.easy': 'سهل',
      'diff.medium': 'متوسط',
      'diff.hard': 'صعب',

      'hud.heatmap': 'الخريطة الحرارية',
      'hud.hint': 'تلميح',
      'hud.sound': 'الصوت',
      'hud.restart': 'إعادة',
      'hud.newgame': 'لعبة جديدة',
      'hud.help': 'مساعدة',
      'hud.minesTitle': 'الألغام المتبقية (الألغام − الأعلام)',
      'hud.timerTitle': 'مؤقت المهمة',
      'power.scanner': 'نبضة الماسح',
      'power.shield': 'الدرع',
      'power.defuser': 'المُبطِل',
      'power.absent': '{p} (غير متاح في هذه اللوحة)',

      'status.ready': 'انقر أي بلاطة لبدء الشبكة',
      'status.active': 'شبكة المفاعل نشطة',
      'status.scanner': 'الماسح جاهز — انقر بلاطة مكشوفة (Esc للإلغاء)',
      'status.defuser': 'المُبطِل جاهز — انقر بلاطة مخفية (Esc للإلغاء)',
      'status.won': 'تم تثبيت المفاعل',
      'status.cleared': 'تم تطهير الشبكة — أكمل الأهداف لتثبيت المفاعل',
      'status.lost': 'فشل الاحتواء',
      'status.jammed': 'حساسات الخريطة معطلة…',

      'objectives.head': '// أهداف التثبيت',
      'obj.scanner': 'استخدم نبضة الماسح مرة واحدة على الأقل',
      'obj.corrupted3': 'اكشف 3 بلاطات فاسدة',
      'obj.noWrongFlags': 'أنهِ بدون أي علم خاطئ',
      'obj.under180': 'أنهِ في أقل من 180 ثانية',
      'obj.end': 'يُحتسب عند النهاية',
      'obj.timeleft': 'متبقٍّ {s} ث',
      'obj.expired': 'انتهى الوقت',

      'toast.shield': 'امتص الدرع الانفجار — اللغم ما يزال مدفونًا!',
      'toast.got.scanner': 'حصلت على نبضة الماسح',
      'toast.got.shield': 'حصلت على الدرع',
      'toast.got.defuser': 'حصلت على المُبطِل',
      'toast.shieldPassive': 'الدرع تلقائي — يصد ضربة لغم واحدة',
      'toast.scanCenter': 'يجب أن يكون مركز النبضة بلاطة مكشوفة',
      'toast.scanHit': 'كشفت النبضة عن {n} بلاطة',
      'toast.scanMiss': 'لم تجد النبضة شيئًا جديدًا',
      'toast.defuserTarget': 'يحتاج المُبطِل بلاطة مخفية بلا علم',
      'toast.defused': 'تم إبطال اللغم — أُعيد حساب الأرقام',
      'toast.defuserMiss': 'لا يوجد لغم — استُهلك المُبطِل',
      'toast.corrGlitch': 'فساد: تشوّش في إشارة الشبكة',
      'toast.corrTime': 'فساد: +{s} ث على المؤقت',
      'toast.corrJam': 'فساد: تعطلت الخريطة الحرارية {s} ث',
      'toast.hintSafe': 'تم رصد بلاطة آمنة — معلَّمة على الشبكة',
      'toast.hintNone': 'لا توجد بلاطة آمنة مؤكدة حاليًا — ضع مزيدًا من الأعلام',
      'toast.soundOn': 'الصوت مفعّل',
      'toast.soundOff': 'الصوت مكتوم',
      'toast.seed': 'البذرة الثابتة مفعّلة: "{s}"',

      'result.title.won': 'تم تثبيت المفاعل',
      'result.title.cleared': 'تم تطهير الشبكة',
      'result.title.lost': 'فشل الاحتواء',
      'result.msg.won': 'تم تثبيت المفاعل — اكتمل البروتوكول',
      'result.msg.cleared': 'تم تطهير الشبكة — أكمل الأهداف لتثبيت المفاعل',
      'result.msg.lost': 'اختراق المفاعل — فشل الاحتواء',
      'result.time': 'الوقت {t}',
      'result.wrongFlags': 'أعلام خاطئة: {n}',
      'result.safe': 'كشف آمن ×{n} (×10)',
      'result.corrupted': 'كشف فاسد ×{n} (×25)',
      'result.combo': 'مكافأة التتابع',
      'result.objectives': 'الأهداف (×50)',
      'result.timeBonus': 'مكافأة الوقت',
      'result.total': 'المجموع',
      'result.best': 'الأفضل: {n}',
      'result.bestTime': 'أفضل وقت: {t}',
      'result.newBest': '★ رقم قياسي جديد',
      'result.again': 'العب مجددًا',

      'help.title': '// إحاطة المشغّل',
      'help.engage': 'انطلق',
      'help.basics.h': 'الأساسيات',
      'help.basics.p': 'القواعد الكلاسيكية: اكشف كل البلاطات الآمنة — الأرقام تُظهر عدد الألغام المجاورة. نقرتك الأولى آمنة دائمًا. <b>نقرة يسرى / لمسة</b> للكشف · <b>نقرة يمنى / ضغطة مطوّلة</b> للعلم.',
      'help.powers.h': 'بلاطات القوة <small>(اكشفها لتجمعها)</small>',
      'help.scanner.p': '<b>نبضة الماسح</b> — اختر بلاطة مكشوفة؛ تكشف بأمان الشكل المتقاطع حولها (مدى 2). لا تكشف الألغام أبدًا.',
      'help.shield.p': '<b>الدرع</b> — تلقائي. يمتص ضربة لغم واحدة؛ يبقى اللغم مدفونًا وتستمر الجولة.',
      'help.defuser.p': '<b>المُبطِل</b> — افحص بلاطة مخفية واحدة. إن كانت لغمًا تحوّل إلى بلاطة آمنة (ويُعاد حساب الأرقام)؛ وإلا تُستهلك الشحنة.',
      'help.corrupt.h': 'البلاطات الفاسدة <small>(ليست ألغامًا أبدًا)</small>',
      'help.corrupt.p': 'كشفها آمن لكنه يسبب خللًا: تشويش بصري، أو <b>+2 ث</b> على المؤقت، أو <b>تعطيل الخريطة الحرارية 5 ث</b>. كل واحدة تمنح +25 نقطة.',
      'help.heatmap.h': 'الخريطة الحرارية',
      'help.heatmap.p': 'بدّلها بمفتاح <b>H</b>. تُلوَّن البلاطات حسب الخطر <i>التقديري</i> — مرّر المؤشر (أو اضغط مطوّلًا على الجوال) لرؤية النسبة. إنها تقديرات وليست يقينًا.',
      'help.pro.h': 'حركات المحترفين',
      'help.pro.p': '<b>الكشف السريع:</b> انقر رقمًا مكشوفًا اكتملت أعلامه ليكشف بقية جيرانه دفعة واحدة. <b>التلميح (2 لكل جولة):</b> يحدد بلاطة آمنة مؤكدة. <b>N</b> تلميح · <b>M</b> كتم.',
      'help.win.h': 'الفوز',
      'help.win.p': 'طهّر الشبكة <b>وأكمل</b> الهدفين معًا. النقاط: +10 لكل بلاطة آمنة، +25 للفاسدة، +50 لكل هدف، مع مكافأة وقت ومكافآت تتابع للّعب السريع.',

      'hints.click': '<b>نقرة</b> كشف',
      'hints.flag': '<b>نقرة يمنى / ضغطة مطوّلة</b> علم',
      'hints.h': '<b>H</b> الخريطة',
      'hints.n': '<b>N</b> تلميح',
      'hints.r': '<b>R</b> إعادة'
    }
  };

  const i18n = {
    lang: 'en',

    /** Translate a key, substituting {placeholders} from params. */
    t(key, params) {
      const dict = DICTS[this.lang] || DICTS.en;
      let str = dict[key] !== undefined ? dict[key] : (DICTS.en[key] !== undefined ? DICTS.en[key] : key);
      if (params) {
        for (const name of Object.keys(params)) {
          str = str.split('{' + name + '}').join(String(params[name]));
        }
      }
      return str;
    },

    /** Switch language: updates <html lang/dir> and body class. */
    setLang(lang) {
      this.lang = DICTS[lang] ? lang : 'en';
      const rtl = this.lang === 'ar';
      document.documentElement.lang = this.lang;
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      document.body.classList.toggle('lang-ar', rtl);
      this.applyStatic();
    },

    /**
     * Re-translate all static DOM nodes:
     *   [data-i18n]      -> textContent
     *   [data-i18n-html] -> innerHTML (trusted dictionary strings only)
     *   [data-i18n-ph]   -> placeholder attribute
     */
    applyStatic() {
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = this.t(el.getAttribute('data-i18n'));
      });
      document.querySelectorAll('[data-i18n-html]').forEach((el) => {
        el.innerHTML = this.t(el.getAttribute('data-i18n-html'));
      });
      document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
        el.setAttribute('placeholder', this.t(el.getAttribute('data-i18n-ph')));
      });
    }
  };

  RP.i18n = i18n;
})(window.RP = window.RP || {});
