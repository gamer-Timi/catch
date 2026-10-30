/* =========================================================
   Azure Labyrinth — game flow, input, map and UI
   ========================================================= */
(function () {
  'use strict';

  // Base map-light brightness. Walls use floor((value - 1) / 2); floors use
  // value - 1. Only cardinal neighbours are considered. Values <= 0 do not
  // clear darkness on the map. Light upgrades add to this base.
  const LIGHT_LEVEL = 2;
  const LIGHT_WALL_DIVISOR = 2;
  const PLAYER_RADIUS = 0.48;
  // The supplied side / diagonal artwork faces right by default. Flip any of
  // these flags individually if a source image is redrawn facing left.
  const ART_FACING = {
    side: true,
    diagFront: true,
    diagBack: false
  };
  const DIRECTION_SECTORS = [
    { key: 'side', mirror: false },      // right
    { key: 'diagFront', mirror: false }, // front-right
    { key: 'front', mirror: false },     // front / down
    { key: 'diagFront', mirror: true },  // front-left
    { key: 'side', mirror: true },       // left
    { key: 'diagBack', mirror: true },   // back-left
    { key: 'back', mirror: false },      // back / up
    { key: 'diagBack', mirror: false }   // back-right
  ];
  const MOVE_SPEED = 6.0;
  const SPRINT_SPEED = 9.0;
  const WALK_CYCLE = 1.35;
  const SPRINT_CYCLE = 1.85;
  const STAMINA_MAX = 100;
  const STAMINA_REGEN_WALK = 10;
  const STAMINA_REGEN_IDLE = 1 / 0.09;
  const STAMINA_SPRINT_MIN = 20;
  const BASE_PERCEPTION = 5;
  const PROFILE_KEY = 'azure-profile-v1';
  const PROFILE_VERSION = 2;
  const UPGRADE_CAPS = {
    speed: 10,
    sprint: 10,
    light: 10,
    stamina: 10,
    drain: 2,
    perception: 10,
    alertness: 12
  };
  const UPGRADE_DEFS = [    { key: 'speed', label: '基础速度', desc: '每点 +5（100 → 最多 150）' },
    { key: 'sprint', label: '冲刺速度', desc: '每点 +6（150 → 最多 210）' },
    { key: 'light', label: '光照', desc: '每点亮度 +1（2 → 最多 12）' },
    { key: 'stamina', label: '体力上限', desc: '每点 +10（100 → 最多 200）' },
    { key: 'drain', label: '体力消耗', desc: '每点每扣 1 点 +0.01s（最多 +2 点）' },
    { key: 'perception', label: '感知力', desc: '每点 +1 格（5 → 最多 15 格）' },
    { key: 'alertness', label: '警觉度', desc: '每点 +1 格（8 → 最多 20 格，仅追逐模式）' }
  ];
  const CONSUMABLES = {
    stamina: { name: '体力药', full: '体力恢复药水', desc: '立刻回满体力；10 秒内冲刺不消耗体力。' },
    speed: { name: '速度药', full: '速度药水', desc: '10 秒内速度 +20%；结束后 1 秒内平滑消退。' },
    firework: { name: '烟花', full: '烟花', desc: '照亮自身周围曼哈顿距离 16 格的地图，并清除这些格子的黑暗。' },
    whale: { name: '免死鲸牌', full: '免死鲸牌', desc: '无法主动使用。被追逐类 BOSS 抓住时可选择消耗，复活并禁锢 BOSS 10 秒。' },
    slow: { name: '缓慢药水', full: '缓慢药水', desc: '在脚下生成 8 秒绿色领域，BOSS 速度 -60%；同一格再用一次可强化为 16 秒、-80%。' },
    trap: { name: '陷阱', full: '陷阱', desc: '在脚下布置一个持续有效的陷阱；BOSS 经过时会被拉到格心并眩晕 4.8 秒。' }
  };
  const HOTBAR_SIZE = 9;
  const DEFAULT_HOTBAR = ['stamina', 'speed', null, null, null, null, null, null, null];
  const CHARACTERS = ['lamp', 'grok'];
  const CHARACTER_INFO = {
    lamp: {
      name: '提灯者',
      desc: '在灯火中寻找月之门的旅人。',
      portrait: 'assets/player-portrait.png',
      skill: ''
    },
    grok: {
      name: '格挡者',
      desc: '来自另一条时间线的守门人，擅长以架势化解追猎。',
      portrait: 'assets/grok-portrait.png',
      skill: '<b>格挡 · Q</b><br>100 秒储存一层，最多两层。按 Q 进入 1 秒格挡，期间无法移动。<br><br>格挡期间被追上：把 BOSS 击退 100m 并眩晕 0.5 秒；撞墙则眩晕 2.5 秒并震碎墙面。<br><br>按下 Q 后 0.1 秒内被追上：触发防反，短暂特写并击退 200m，眩晕 7.5 秒，同时使本次充能时间减少 20%。'
    }
  };
  const BLOCK_RECHARGE_SECONDS = 100;
  const BLOCK_MAX_CHARGES = 2;
  const BLOCK_DURATION = 1;
  const PARRY_WINDOW = 0.1;
  const TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function damp(a, b, rate, dt) { return a + (b - a) * (1 - Math.exp(-rate * dt)); }
  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function randomSeed() {
    return ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0);
  }

  class AzureGame {
    constructor() {
      this.canvas = document.getElementById('scene');
      this.renderer = new window.AzureRenderer(this.canvas);
      this.audio = new window.AzureAudio();
      try {
        this.audio.muted = localStorage.getItem('azure-muted') === '1';
      } catch (err) {
        this.audio.muted = false;
      }
      this.state = 'title';
      this.mapOpen = false;
      this.time = 0;
      this.mapTime = 0;
      this.elapsed = 0;
      this.revealTimer = 0;
      this.hintTimer = 0;
      this.keys = Object.create(null);
      this.turnInput = 0;
      this.forwardInput = 0;
      this.moveVelocity = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
      this.lastFrame = 0;
      this.spriteReady = false;
      this.dashReady = false;
      this.spriteNote = '';
      this.sprinting = false;
      this.stamina = STAMINA_MAX;
      this.sprintLocked = false;
      this.lastStepDistance = 0;
      this.seedFromURL = this.parseSeed();
      this.mapCanvas = document.getElementById('map-canvas');
      this.mapCtx = this.mapCanvas.getContext('2d');
      this.mapSize = { w: 0, h: 0, dpr: 1 };
      this.toastTimeout = 0;
      this.swipe = null;
      this.mapJustOpened = false;
      this.mapZoomLevels = [1, 1.5, 2, 3];
      this.mapZoomIndex = 0;
      this.mapZoom = 1;
      this.mapCenter = { x: 0, y: 0 };
      this.mapLayer = null;
      this.mapLayerCtx = null;
      this.mapLayerDirty = true;
      this.mapLayerSize = { w: 0, h: 0, dpr: 0 };
      this.mapViewCell = 1;
      this.lightLevel = LIGHT_LEVEL;
      this.lightField = null;
      this.mapDrag = null;
      this.profile = this.loadProfile();
      this.homeOpen = false;
      this.noDrainTimer = 0;
      this.speedPotionTimer = 0;
      this.speedPotionFade = 0;
      this.staminaMax = STAMINA_MAX;
      this.staminaSprintMin = STAMINA_SPRINT_MIN;
      this.perception = BASE_PERCEPTION;
      this.alertness = 8;
      this.colliderRx = 0.52;
      this.colliderRz = 0.36;
      this.playerColliderY = 0.02 + 1.82 * 0.0625;
      this.bossColliderY = 0.02 + 1.82 * 0.125;
      this.mode = 'explore';
      this.boss = null;
      this.bossWeights = null;
      this.bossPerception = 10;
      this.slowFields = [];
      this.traps = [];
      this.wallBreaks = [];
      this.blockCharges = BLOCK_MAX_CHARGES;
      this.blockRecharge = 0;
      this.blocking = false;
      this.blockElapsed = 0;
      this.blockTriggered = false;
      this.skillAnimTimer = 0;
      this.skillAnimTotal = 0;
      this.parryFreeze = 0;
      this.parryPending = null;
      this.parryFlash = 0;
      this.backpackOpen = false;
      this.applyProfile();
      this.stamina = this.staminaMax;

      this.dom = {
        startScreen: document.getElementById('start-screen'),
        startBtn: document.getElementById('start-btn'),
        hud: document.getElementById('hud'),
        timer: document.getElementById('timer'),
        pct: document.getElementById('explore-pct'),
        objective: document.getElementById('objective-text'),
        staminaCard: document.getElementById('stamina-card'),
        staminaValue: document.getElementById('stamina-value'),
        staminaFill: document.getElementById('stamina-fill'),
        staminaState: document.getElementById('stamina-state'),
        compassReadout: document.getElementById('compass-readout'),
        buffRow: document.getElementById('buff-row'),
        skillHud: document.getElementById('skill-hud'),
        skillState: document.getElementById('skill-state'),
        skillCharges: document.getElementById('skill-charges'),
        characterCard: document.getElementById('character-card'),
        characterPreviewWrap: document.getElementById('character-preview-wrap'),
        characterPreview: document.getElementById('character-preview'),
        characterName: document.getElementById('character-name'),
        characterDesc: document.getElementById('character-desc'),
        characterPrev: document.getElementById('character-prev'),
        characterNext: document.getElementById('character-next'),
        characterSkillToggle: document.getElementById('character-skill-toggle'),
        characterSkillInfo: document.getElementById('character-skill-info'),
        hotbar: document.getElementById('hotbar'),
        testView: document.getElementById('test-view'),
        viewPlayer: document.getElementById('view-player'),
        viewBoss: document.getElementById('view-boss'),
        toast: document.getElementById('toast'),
        mapScreen: document.getElementById('map-screen'),
        mapBtn: document.getElementById('map-btn'),
        mapClose: document.getElementById('map-close'),
        mapCloseX: document.getElementById('map-close-x'),
        mapCanvas: document.getElementById('map-canvas'),
        mapZoomIn: document.getElementById('map-zoom-in'),
        mapZoomOut: document.getElementById('map-zoom-out'),
        mapZoomLabel: document.getElementById('map-zoom-label'),
        mapPct: document.getElementById('map-progress'),
        mapSeed: document.getElementById('map-seed'),
        mapFound: document.getElementById('map-found'),
        mapPerception: document.getElementById('map-perception'),
        mapAlertness: document.getElementById('map-alertness'),
        mapBoss: document.getElementById('map-boss'),
        bossAlert: document.getElementById('boss-alert'),
        bossArrow: document.getElementById('boss-arrow'),
        modeTag: document.getElementById('mode-tag'),
        homeMenuBtn: document.getElementById('home-menu-btn'),
        homePanel: document.getElementById('home-panel'),
        homeClose: document.getElementById('home-close'),
        homeCloseBottom: document.getElementById('home-close-bottom'),
        modeSwitch: document.getElementById('mode-switch'),
        bossSettings: document.getElementById('boss-settings'),
        upgradeList: document.getElementById('upgrade-list'),
        homeEquipment: document.getElementById('home-equipment'),
        homeConsumables: document.getElementById('home-consumables'),
        homeSlots: document.getElementById('home-slots'),
        openBackpack: document.getElementById('open-backpack'),
        backpackPanel: document.getElementById('backpack-panel'),
        backpackClose: document.getElementById('backpack-close'),
        backpackItems: document.getElementById('backpack-items'),
        backpackSlots: document.getElementById('backpack-slots'),
        whalePrompt: document.getElementById('whale-prompt'),
        whaleUse: document.getElementById('whale-use'),
        whaleDecline: document.getElementById('whale-decline'),
        whaleCount: document.getElementById('whale-count'),
        pauseScreen: document.getElementById('pause-screen'),
        pauseResume: document.getElementById('pause-resume'),
        pauseHome: document.getElementById('pause-home'),
        victoryScreen: document.getElementById('victory-screen'),
        victoryTime: document.getElementById('victory-time'),
        victoryPct: document.getElementById('victory-pct'),
        victorySeed: document.getElementById('victory-seed'),
        againBtn: document.getElementById('again-btn'),
        defeatScreen: document.getElementById('defeat-screen'),
        defeatTime: document.getElementById('defeat-time'),
        defeatPct: document.getElementById('defeat-pct'),
        defeatSeed: document.getElementById('defeat-seed'),
        defeatRetry: document.getElementById('defeat-retry'),
        defeatHome: document.getElementById('defeat-home'),
        audioBtn: document.getElementById('audio-btn'),
        touchMap: document.getElementById('touch-map'),
        loading: document.getElementById('loading'),
        seedTag: document.getElementById('seed-tag')
      };

      this.loadSprite();
      this.loadDashSprite();
      this.loadDirectionSprites();
      this.loadDirectionSheets();
      this.loadGrokSprites();
      this.loadBossSprites();
      this.buildHomeUI();
      this.buildHotbar();
      this.updateHomeUI();
      this.buildBackpackUI();
      this.updateHotbar();
      this.cameraFocus = 'player';
      this.bind();
      this.resize();
      this.updateMapButtonState();
      this.dom.audioBtn.classList.toggle('is-muted', this.audio.muted);

      if (this.seedFromURL != null) {
        this.dom.seedTag.textContent = 'SEED ' + this.seedFromURL;
      }

      requestAnimationFrame((t) => this.frame(t));
    }

    parseSeed() {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('seed');
      if (raw == null) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? (n >>> 0) : null;
    }

    defaultProfile() {
      return {
        version: PROFILE_VERSION,
        upgrades: { speed: 0, sprint: 0, light: 0, stamina: 0, drain: 0, perception: 0, alertness: 0 },
        items: { stamina: 0, speed: 0, firework: 0, whale: 0, slow: 0, trap: 0 },
        hotbar: DEFAULT_HOTBAR.slice(),
        compass: false,
        xray: false,
        character: 'lamp',
        mode: 'explore',
        boss: { sensitivity: 0, speed: 0, inertia: 0 }
      };
    }

    loadProfile() {
      const base = this.defaultProfile();
      try {
        const raw = localStorage.getItem(PROFILE_KEY);
        if (!raw) return base;
        const saved = JSON.parse(raw);
        for (const key of Object.keys(base.upgrades)) {
          const v = Number(saved.upgrades && saved.upgrades[key]);
          if (Number.isFinite(v)) base.upgrades[key] = clamp(Math.floor(v), 0, UPGRADE_CAPS[key]);
        }
        for (const key of Object.keys(base.items)) {
          const v = Number(saved.items && saved.items[key]);
          if (Number.isFinite(v)) base.items[key] = Math.max(0, Math.floor(v));
        }
        if (Array.isArray(saved.hotbar)) {
          const used = new Set();
          base.hotbar = Array.from({ length: HOTBAR_SIZE }, (_, i) => {
            const key = saved.hotbar[i];
            if (!key || !(key in CONSUMABLES) || used.has(key)) return null;
            used.add(key);
            return key;
          });
        }
        base.compass = !!(saved && saved.compass);
        base.xray = !!(saved && saved.xray);
        base.character = saved && CHARACTERS.includes(saved.character) ? saved.character : 'lamp';
        base.mode = saved && ['explore', 'chase', 'test'].includes(saved.mode) ? saved.mode : 'explore';
        // Older profiles stored derived/old default boss values. The current
        // schema starts every boss stat at zero; don't migrate those values.
        if (saved && saved.version === PROFILE_VERSION && saved.boss) {
          const sens = Number(saved.boss.sensitivity);
          const spd = Number(saved.boss.speed);
          const inertia = Number(saved.boss.inertia);
          if (Number.isFinite(sens)) base.boss.sensitivity = clamp(Math.floor(sens), 0, 40);
          if (Number.isFinite(spd)) base.boss.speed = clamp(Math.floor(spd), 0, 50);
          if (Number.isFinite(inertia)) {
            base.boss.inertia = clamp(Math.round(inertia * 10) / 10, 0, 2);
          }
        }
      } catch (err) { /* file:// / privacy mode */ }
      return base;
    }

    saveProfile() {
      try {
        this.profile.version = PROFILE_VERSION;
        localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
      } catch (err) { /* ignore */ }
    }

    applyProfile() {
      const u = this.profile.upgrades;
      this.moveSpeed = MOVE_SPEED + u.speed * 0.3;
      this.sprintSpeed = SPRINT_SPEED + u.sprint * 0.36;
      this.lightLevel = LIGHT_LEVEL + u.light;
      this.perception = BASE_PERCEPTION + u.perception;
      this.alertness = 8 + u.alertness;
      this.staminaMax = STAMINA_MAX + u.stamina * 10;
      this.staminaSprintMin = this.staminaMax * 0.2;
      this.drainInterval = 0.04 + u.drain * 0.01;
      this.staminaDrain = 1 / this.drainInterval;
      this.stamina = clamp(this.stamina, 0, this.staminaMax);
    }

    loadSprite() {
      const tryWalkSprite = (retry) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (!img.naturalWidth) return;
          this.renderer.setSprite(img);
          this.spriteReady = true;
          this.spriteNote = '';
          this.dom.loading.classList.remove('visible');
        };
        img.onerror = () => {
          if (!retry) {
            setTimeout(() => tryWalkSprite(true), 450);
            return;
          }
          this.loadPortraitFallback();
        };
        img.src = 'assets/player-walk.png?v=5';
      };
      tryWalkSprite(false);
    }

    loadPortraitFallback() {
      // If the extracted walking strip is missing, use the single portrait as a
      // still frame so the player is never invisible on screen.
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const cell = document.createElement('canvas');
        cell.width = 300;
        cell.height = 352;
        const ctx = cell.getContext('2d');
        const scale = Math.min(300 / img.naturalWidth, 344 / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (300 - w) / 2, 350 - h, w, h);
        this.renderer.setSprite(cell);
        this.spriteReady = true;
        this.spriteNote = '行走图缺失，已使用静态角色立绘';
        this.dom.loading.classList.remove('visible');
        if (this.state === 'playing') this.showToast(this.spriteNote, 'info', 5200);
      };
      img.onerror = () => {
        this.spriteNote = '角色素材载入失败，请检查 assets 文件夹';
        this.dom.loading.textContent = '角色素材载入失败 · 将使用备用剪影';
        this.dom.loading.classList.add('visible');
        setTimeout(() => this.dom.loading.classList.remove('visible'), 4200);
        if (this.state === 'playing') this.showToast(this.spriteNote, 'info', 5200);
      };
      img.src = 'assets/player-portrait.png?v=6';
    }

    loadDashSprite() {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!img.naturalWidth) return;
        this.renderer.setDashSprite(img);
        this.dashReady = true;
      };
      img.onerror = () => {
        this.dashReady = false;
      };
      img.src = 'assets/player-dash.png?v=5';
    }

    loadDirectionSprites() {
      const files = {
        front: 'player-front.png',
        back: 'player-back.png',
        side: 'player-side.png',
        diagFront: 'player-diag-front.png',
        diagBack: 'player-diag-back.png'
      };
      for (const [key, file] of Object.entries(files)) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (img.naturalWidth) this.renderer.setDirectionSprite(key, img);
        };
        img.onerror = () => {};
        img.src = 'assets/' + file + '?v=1';
      }
    }

    loadDirectionSheets() {
      const files = {
        front: 'player-front-walk.png',
        back: 'player-back-walk.png',
        side: 'player-side-walk.png',
        diagFront: 'player-diag-front-walk.png',
        diagBack: 'player-diag-back-walk.png'
      };
      for (const [key, file] of Object.entries(files)) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (!img.naturalWidth) return;
          // Every generated cell is 512px wide, so newly-added frames are
          // picked up automatically without editing the loader.
          const frames = Math.max(1, Math.round(img.naturalWidth / 512));
          this.renderer.setDirectionSheet(key, img, frames);
        };
        img.onerror = () => {};
        img.src = 'assets/' + file + '?v=5';
      }
    }

    loadGrokSprites() {
      const files = {
        front: 'grok-down-walk.png',
        back: 'grok-up-walk.png',
        side: 'grok-side-walk.png',
        diagFront: 'grok-diag-front-walk.png',
        diagBack: 'grok-diag-back-walk.png'
      };
      for (const [key, file] of Object.entries(files)) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (!img.naturalWidth) return;
          this.renderer.setGrokSheet(key, img, Math.max(1, Math.round(img.naturalWidth / 512)));
        };
        img.onerror = () => {};
        img.src = 'assets/' + file + '?v=1';
      }
      const skill = new Image();
      skill.decoding = 'async';
      skill.onload = () => {
        if (skill.naturalWidth) this.renderer.setSkillSheet(skill, Math.max(1, Math.round(skill.naturalWidth / 512)));
      };
      skill.onerror = () => {};
      skill.src = 'assets/grok-skill.png?v=1';
    }

    loadBossSprites() {      const files = {
        up: 'boss-up.png',
        down: 'boss-down.png',
        left: 'boss-left.png',
        upleft: 'boss-upleft.png',
        downleft: 'boss-downleft.png'
      };
      for (const [key, file] of Object.entries(files)) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (img.naturalWidth) this.renderer.setBossSprite(key, img);
        };
        img.onerror = () => {};
        img.src = 'assets/' + file + '?v=2';
      }
    }

    buildHomeUI() {
      this.dom.upgradeList.innerHTML = UPGRADE_DEFS.map((def) => `
        <div class="upgrade-row">
          <div class="upgrade-copy"><b>${def.label}</b><small>${def.desc}</small></div>
          <div class="upgrade-readout">
            <b data-upgrade-value="${def.key}">—</b>
            <span data-upgrade-points="${def.key}">0 / ${UPGRADE_CAPS[def.key]}</span>
          </div>
          <div class="stepper">
            <button type="button" data-upgrade="${def.key}" data-delta="-1" aria-label="减少${def.label}">−</button>
            <button type="button" data-upgrade="${def.key}" data-delta="1" aria-label="增加${def.label}">+</button>
          </div>
        </div>
      `).join('');

      this.dom.homeEquipment.innerHTML = `
        <div class="equip-row">
          <div class="equip-copy">
            <b>指南针</b>
            <small>装备后实时显示到月之门的直线距离，不占消耗品格。</small>
            <span class="equip-status" data-compass-state>未装备</span>
          </div>
          <button type="button" class="mini-btn" data-compass-toggle>装备</button>
        </div>
        <div class="equip-row">
          <div class="equip-copy">
            <b>透视</b>
            <small>装备后地图实时显示 BOSS 位置，不受警觉范围和点亮状态限制。</small>
            <span class="equip-status" data-xray-state>未装备</span>
          </div>
          <button type="button" class="mini-btn" data-xray-toggle>装备</button>
        </div>
      `;

      this.dom.homeConsumables.innerHTML = Object.entries(CONSUMABLES).map(([key, item]) => `
        <div class="shop-row">
          <div class="shop-copy"><b>${item.full}</b><small>${item.desc}</small></div>
          <div class="stepper">
            <button type="button" data-item="${key}" data-item-delta="-1" aria-label="减少${item.full}">−</button>
            <b data-item-qty="${key}">0</b>
            <button type="button" data-item="${key}" data-item-delta="1" aria-label="增加${item.full}">+</button>
          </div>
        </div>
      `).join('');

      this.dom.homeSlots.innerHTML = Array.from({ length: 9 }, (_, i) => `
        <div class="home-slot" data-home-slot="${i + 1}">
          <kbd>${i + 1}</kbd>
          <b class="home-slot-name">—</b>
          <small class="home-slot-qty"></small>
        </div>
      `).join('');

      this.dom.bossSettings.innerHTML = `
        <div class="upgrade-row">
          <div class="upgrade-copy"><b>BOSS 灵敏度</b><small>感知距离 = 10 + 灵敏度；进入范围则会被感知到</small></div>
          <div class="upgrade-readout">
            <b data-boss-value="sensitivity">0</b>
            <span data-boss-points="sensitivity">0 / 40</span>
          </div>
          <div class="stepper">
            <button type="button" data-boss-setting="sensitivity" data-delta="-1" aria-label="降低BOSS灵敏度">−</button>
            <button type="button" data-boss-setting="sensitivity" data-delta="1" aria-label="提高BOSS灵敏度">+</button>
          </div>
        </div>
        <div class="upgrade-row">
          <div class="upgrade-copy"><b>BOSS 速度</b><small>漫游 75 + 速度；追逐 95 + 1.25 × 速度</small></div>
          <div class="upgrade-readout">
            <b data-boss-value="speed">0</b>
            <span data-boss-points="speed">0 / 50</span>
          </div>
          <div class="stepper">
            <button type="button" data-boss-setting="speed" data-delta="-1" aria-label="降低BOSS速度">−</button>
            <button type="button" data-boss-setting="speed" data-delta="1" aria-label="提高BOSS速度">+</button>
          </div>
        </div>
        <div class="upgrade-row">
          <div class="upgrade-copy"><b>BOSS 惯性</b><small>决定了你是否能很好溜BOSS</small></div>
          <div class="upgrade-readout">
            <b data-boss-value="inertia">0.0s</b>
            <span data-boss-points="inertia">0.0 / 2.0</span>
          </div>
          <div class="stepper">
            <button type="button" data-boss-setting="inertia" data-delta="-0.1" aria-label="降低BOSS惯性">−</button>
            <button type="button" data-boss-setting="inertia" data-delta="0.1" aria-label="提高BOSS惯性">+</button>
          </div>
        </div>
      `;
    }

    buildHotbar() {
      this.dom.hotbar.innerHTML = Array.from({ length: 9 }, (_, i) => `
        <button class="hotbar-slot" type="button" data-slot="${i + 1}" aria-label="使用第 ${i + 1} 格道具">
          <kbd>${i + 1}</kbd>
          <span class="hotbar-name">—</span>
          <b class="hotbar-qty"></b>
        </button>
      `).join('');
    }

    updateHomeUI() {
      const u = this.profile.upgrades;
      const values = {
        speed: String(100 + u.speed * 5),
        sprint: String(150 + u.sprint * 6),
        light: `${2 + u.light} / 12`,
        stamina: String(100 + u.stamina * 10),
        drain: (0.04 + u.drain * 0.01).toFixed(3) + 's',
        perception: `${BASE_PERCEPTION + u.perception} 格`,
        alertness: `${8 + u.alertness} 格`
      };
      for (const def of UPGRADE_DEFS) {
        const valueEl = this.dom.upgradeList.querySelector(`[data-upgrade-value="${def.key}"]`);
        const pointsEl = this.dom.upgradeList.querySelector(`[data-upgrade-points="${def.key}"]`);
        if (valueEl) valueEl.textContent = values[def.key];
        if (pointsEl) pointsEl.textContent = `${u[def.key]} / ${UPGRADE_CAPS[def.key]}`;
        const minus = this.dom.upgradeList.querySelector(`[data-upgrade="${def.key}"][data-delta="-1"]`);
        const plus = this.dom.upgradeList.querySelector(`[data-upgrade="${def.key}"][data-delta="1"]`);
        if (minus) minus.disabled = u[def.key] <= 0;
        if (plus) plus.disabled = u[def.key] >= UPGRADE_CAPS[def.key];
      }

      const compassState = this.dom.homeEquipment.querySelector('[data-compass-state]');
      const compassBtn = this.dom.homeEquipment.querySelector('[data-compass-toggle]');
      if (compassState) compassState.textContent = this.profile.compass ? '已装备 · 实时生效' : '未装备';
      if (compassBtn) {
        compassBtn.textContent = this.profile.compass ? '卸下' : '装备';
        compassBtn.classList.toggle('equipped', this.profile.compass);
      }
      const xrayState = this.dom.homeEquipment.querySelector('[data-xray-state]');
      const xrayBtn = this.dom.homeEquipment.querySelector('[data-xray-toggle]');
      if (xrayState) xrayState.textContent = this.profile.xray ? '已装备 · 地图实时显示' : '未装备';
      if (xrayBtn) {
        xrayBtn.textContent = this.profile.xray ? '卸下' : '装备';
        xrayBtn.classList.toggle('equipped', this.profile.xray);
      }

      for (const key of Object.keys(CONSUMABLES)) {
        const qty = this.profile.items[key] || 0;
        const el = this.dom.homeConsumables.querySelector(`[data-item-qty="${key}"]`);
        if (el) el.textContent = String(qty);
        const minus = this.dom.homeConsumables.querySelector(`[data-item="${key}"][data-item-delta="-1"]`);
        if (minus) minus.disabled = qty <= 0;
      }

      for (const btn of this.dom.modeSwitch.querySelectorAll('[data-mode]')) {
        btn.classList.toggle('active', btn.dataset.mode === this.profile.mode);
      }
      const bossValues = this.dom.bossSettings.querySelectorAll('[data-boss-value]');
      for (const el of bossValues) {
        if (el.dataset.bossValue === 'inertia') el.textContent = this.profile.boss.inertia.toFixed(1) + 's';
        else el.textContent = String(this.profile.boss[el.dataset.bossValue]);
      }
      for (const key of ['sensitivity', 'speed', 'inertia']) {
        const pts = this.dom.bossSettings.querySelector(`[data-boss-points="${key}"]`);
        if (pts) {
          pts.textContent = key === 'inertia'
            ? `${this.profile.boss.inertia.toFixed(1)} / 2.0`
            : `${this.profile.boss[key]} / ${key === 'sensitivity' ? 40 : 50}`;
        }
        const step = key === 'inertia' ? '0.1' : '1';
        const negative = key === 'inertia' ? '-0.1' : '-1';
        const minus = this.dom.bossSettings.querySelector(`[data-boss-setting="${key}"][data-delta="${negative}"]`);
        const plus = this.dom.bossSettings.querySelector(`[data-boss-setting="${key}"][data-delta="${step}"]`);
        if (minus) minus.disabled = this.profile.boss[key] <= 0;
        if (plus) plus.disabled = this.profile.boss[key] >= (key === 'inertia' ? 2 : (key === 'sensitivity' ? 40 : 50));
      }

      this.updateHotbar();
      if (this.dom.mapPerception) this.dom.mapPerception.textContent = `${this.perception} 格`;
      this.updateCompassHUD();
      this.updateBuffHUD();
      this.updateCharacterUI(false);
      this.buildBackpackUI();
    }

    updateHotbar() {
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        const itemKey = this.profile.hotbar[i];
        const item = itemKey ? CONSUMABLES[itemKey] : null;
        const qty = itemKey ? (this.profile.items[itemKey] || 0) : 0;
        const home = this.dom.homeSlots.querySelector(`[data-home-slot="${i + 1}"]`);
        const hot = this.dom.hotbar.querySelector(`[data-slot="${i + 1}"]`);
        if (home) {
          home.classList.toggle('empty', !item || qty <= 0);
          home.querySelector('.home-slot-name').textContent = item ? item.name : '—';
          home.querySelector('.home-slot-qty').textContent = item ? ('×' + qty) : '';
        }
        if (hot) {
          hot.classList.toggle('empty', !item || qty <= 0);
          hot.querySelector('.hotbar-name').textContent = item ? item.name : '—';
          hot.querySelector('.hotbar-qty').textContent = item && qty > 0 ? ('×' + qty) : '';
        }
      }
    }

    adjustUpgrade(key, delta) {
      if (!(key in this.profile.upgrades)) return;
      this.profile.upgrades[key] = clamp(this.profile.upgrades[key] + delta, 0, UPGRADE_CAPS[key]);
      this.saveProfile();
      this.applyProfile();
      this.updateHomeUI();
    }

    adjustItem(key, delta) {
      if (!(key in this.profile.items)) return;
      this.profile.items[key] = Math.max(0, (this.profile.items[key] || 0) + delta);
      this.saveProfile();
      this.updateHomeUI();
      this.buildBackpackUI();
    }

    setMode(mode) {
      if (!['explore', 'chase', 'test'].includes(mode)) return;
      this.profile.mode = mode;
      this.saveProfile();
      this.updateHomeUI();
    }

    adjustBoss(key, delta) {
      if (!['sensitivity', 'speed', 'inertia'].includes(key)) return;
      if (key === 'inertia') {
        const step = delta > 0 ? 0.1 : -0.1;
        this.profile.boss.inertia = clamp(
          Math.round((this.profile.boss.inertia + step) * 10) / 10,
          0,
          2
        );
      } else {
        const cap = key === 'sensitivity' ? 40 : 50;
        this.profile.boss[key] = clamp((this.profile.boss[key] || 0) + delta, 0, cap);
      }
      this.saveProfile();
      this.updateHomeUI();
    }

    toggleCompass() {
      this.profile.compass = !this.profile.compass;
      this.saveProfile();
      this.updateHomeUI();
      if (this.profile.compass) this.showToast('指南针已装备 · 会实时显示月之门距离', 'info', 3000);
    }

    toggleXray() {
      this.profile.xray = !this.profile.xray;
      this.saveProfile();
      this.updateHomeUI();
      if (this.profile.xray) this.showToast('透视已装备 · 地图会实时显示 BOSS 位置', 'info', 3000);
    }

    openBackpack() {
      if (!this.dom.homePanel.classList.contains('open')) return;
      this.buildBackpackUI();
      this.backpackOpen = true;
      this.dom.backpackPanel.classList.add('open');
      this.dom.backpackPanel.setAttribute('aria-hidden', 'false');
      this.dom.backpackClose.focus({ preventScroll: true });
    }

    closeBackpack() {
      this.backpackOpen = false;
      this.dom.backpackPanel.classList.remove('open');
      this.dom.backpackPanel.setAttribute('aria-hidden', 'true');
      if (this.dom.openBackpack) this.dom.openBackpack.focus({ preventScroll: true });
    }

    setHotbarSlot(slot, key) {
      if (slot < 0 || slot >= HOTBAR_SIZE) return;
      if (key && !(key in CONSUMABLES)) return;
      if (key) {
        const existing = this.profile.hotbar.indexOf(key);
        if (existing >= 0 && existing !== slot) this.profile.hotbar[existing] = null;
      }
      this.profile.hotbar[slot] = key || null;
      this.saveProfile();
      this.updateHomeUI();
      this.updateHotbar();
      this.buildBackpackUI();
    }

    swapHotbarSlots(a, b) {
      if (a === b || a < 0 || b < 0 || a >= HOTBAR_SIZE || b >= HOTBAR_SIZE) return;
      const tmp = this.profile.hotbar[a];
      this.profile.hotbar[a] = this.profile.hotbar[b];
      this.profile.hotbar[b] = tmp;
      this.saveProfile();
      this.updateHomeUI();
      this.updateHotbar();
      this.buildBackpackUI();
    }

    buildBackpackUI() {
      if (!this.dom.backpackItems || !this.dom.backpackSlots) return;
      const items = Object.entries(CONSUMABLES).map(([key, item]) => {
        const qty = this.profile.items[key] || 0;
        return `
          <div class="backpack-item${qty > 0 ? '' : ' empty'}" draggable="true" data-backpack-item="${key}">
            <div class="backpack-item-copy"><b>${item.full}</b><small>${item.desc}</small></div>
            <div class="backpack-item-qty">
              <button type="button" data-item="${key}" data-item-delta="-1" aria-label="减少${item.full}">−</button>
              <b data-backpack-qty="${key}">${qty}</b>
              <button type="button" data-item="${key}" data-item-delta="1" aria-label="增加${item.full}">+</button>
            </div>
          </div>
        `;
      }).join('');
      this.dom.backpackItems.innerHTML = items;
      this.dom.backpackSlots.innerHTML = Array.from({ length: HOTBAR_SIZE }, (_, i) => {
        const key = this.profile.hotbar[i];
        const item = key ? CONSUMABLES[key] : null;
        const qty = key ? (this.profile.items[key] || 0) : 0;
        return `
          <div class="backpack-slot${item ? ' filled' : ''}" data-backpack-slot="${i}" draggable="${item ? 'true' : 'false'}">
            <kbd>${i + 1}</kbd>
            <b>${item ? item.name : '空'}</b>
            <small>${item ? '×' + qty : '拖入道具'}</small>
            ${item ? `<button type="button" data-clear-slot="${i}" aria-label="清空第${i + 1}格">×</button>` : ''}
          </div>
        `;
      }).join('');
    }

    autoEquipItem(key) {
      if (!(key in CONSUMABLES)) return;
      const existing = this.profile.hotbar.indexOf(key);
      if (existing >= 0) return;
      const empty = this.profile.hotbar.indexOf(null);
      if (empty < 0) {
        this.showToast('携带格已满，最多携带 9 种消耗品', 'info', 2500);
        return;
      }
      this.setHotbarSlot(empty, key);
    }

    updateCharacterUI(collapseSkill = true) {
      if (!this.dom.characterPreview) return;
      const info = CHARACTER_INFO[this.profile.character] || CHARACTER_INFO.lamp;
      this.dom.characterPreview.src = info.portrait + '?v=1';
      this.dom.characterName.textContent = info.name;
      this.dom.characterDesc.textContent = info.desc;
      this.dom.characterSkillInfo.innerHTML = info.skill || '<b>暂无主动技能</b><br>这个角色没有格挡能力。';
      if (collapseSkill) {
        this.dom.characterSkillInfo.hidden = true;
        this.dom.characterSkillToggle.setAttribute('aria-expanded', 'false');
      }
    }

    cycleCharacter(direction) {
      const idx = CHARACTERS.indexOf(this.profile.character);
      const next = CHARACTERS[(idx + (direction < 0 ? -1 : 1) + CHARACTERS.length) % CHARACTERS.length];
      this.profile.character = next;
      this.saveProfile();
      const wrap = this.dom.characterPreviewWrap;
      wrap.classList.remove('box-swap');
      void wrap.offsetWidth;
      wrap.classList.add('box-swap');
      setTimeout(() => this.updateCharacterUI(true), 190);
      setTimeout(() => wrap.classList.remove('box-swap'), 500);
    }

    toggleCharacterSkillInfo() {
      const info = this.dom.characterSkillInfo;
      const open = info.hidden;
      info.hidden = !open;
      this.dom.characterSkillToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    useBlockSkill() {
      if (this.profile.character !== 'grok' || this.state !== 'playing') return;
      if (this.blocking || this.blockCharges <= 0) return;
      const wasFull = this.blockCharges >= BLOCK_MAX_CHARGES;
      this.blockCharges--;
      if (wasFull || this.blockRecharge <= 0) this.blockRecharge = BLOCK_RECHARGE_SECONDS;
      this.blocking = true;
      this.blockElapsed = 0;
      this.blockTriggered = false;
      this.skillAnimTimer = 0;
      this.skillAnimTotal = 0;
      this.player.moving = false;
      this.updateSkillHUD();
      this.showToast('格挡架势 · 1 秒内无法移动', 'info', 1600);
    }

    updateSkillState(dt) {
      if (this.blockCharges < BLOCK_MAX_CHARGES && this.blockRecharge > 0) {
        this.blockRecharge = Math.max(0, this.blockRecharge - dt);
        while (this.blockRecharge <= 0 && this.blockCharges < BLOCK_MAX_CHARGES) {
          this.blockCharges++;
          this.blockRecharge = this.blockCharges < BLOCK_MAX_CHARGES ? BLOCK_RECHARGE_SECONDS : 0;
        }
      } else if (this.blockCharges >= BLOCK_MAX_CHARGES) {
        this.blockRecharge = 0;
      }
      if (this.blocking) {
        this.blockElapsed += dt;
        if (this.blockElapsed >= BLOCK_DURATION) this.blocking = false;
      }
      if (this.skillAnimTimer > 0) {
        this.skillAnimTimer = Math.max(0, this.skillAnimTimer - dt);
      }
      this.updateSkillHUD();
    }

    updateSkillHUD() {
      if (!this.dom.skillHud) return;
      const visible = this.profile.character === 'grok' &&
        (this.state === 'playing' || this.state === 'paused' || this.state === 'whale');
      this.dom.skillHud.hidden = !visible;
      if (!visible) return;
      while (this.dom.skillCharges.children.length < BLOCK_MAX_CHARGES) {
        this.dom.skillCharges.appendChild(document.createElement('i'));
      }
      const pips = this.dom.skillCharges.children;
      for (let i = 0; i < pips.length; i++) {
        pips[i].classList.toggle('full', i < this.blockCharges);
      }
      this.dom.skillHud.classList.toggle('blocking', this.blocking);
      this.dom.skillHud.classList.toggle('parry', this.parryFreeze > 0);
      if (this.parryFreeze > 0) {
        this.dom.skillState.textContent = '防反！';
      } else if (this.blocking) {
        this.dom.skillState.textContent = '格挡中';
      } else if (this.blockCharges > 0) {
        this.dom.skillState.textContent = '就绪 · Q';
      } else {
        this.dom.skillState.textContent = `充能 ${Math.ceil(this.blockRecharge)}s`;
      }
    }

    startParry() {
      this.parryFreeze = 0.55;
      this.parryFlash = 1;
      this.parryPending = { special: true };
      this.renderer.cinematicZoom = 1.75;
      this.skillAnimTimer = 0;
      this.skillAnimTotal = 0;
      this.updateSkillHUD();
    }

    finishParry() {
      this.parryFreeze = 0;
      this.parryFlash = 0;
      this.renderer.cinematicZoom = 1;
      const pending = this.parryPending;
      this.parryPending = null;
      if (pending) {
        this.applyBlockKnockback(true);
        this.blockRecharge = Math.max(0, this.blockRecharge * 0.8);
      }
    }

    applyBlockKnockback(special) {
      const b = this.boss;
      if (!b) return;
      let dx = b.x - this.player.x;
      let dz = b.z - this.player.z;
      let len = Math.hypot(dx, dz);
      if (len < 0.001) {
        dx = -(b.chaseDirX || this.player.facingX || 1);
        dz = -(b.chaseDirZ || 0);
        len = Math.hypot(dx, dz) || 1;
      }
      const ux = dx / len;
      const uz = dz / len;
      const distance = (special ? 200 : 100) * 0.06;
      const stepSize = 0.15;
      let traveled = 0;
      let wallHit = false;
      let wallTile = null;
      while (traveled < distance) {
        const nx = b.x + ux * stepSize;
        const nz = b.z + uz * stepSize;
        if (this.collides(nx, nz)) {
          wallHit = true;
          // Find the wall immediately in front of the knockback, not any
          // wall tile behind or beside the boss.
          const probes = [0.35, 0.65, 0.95, 1.25, 1.6];
          for (const probe of probes) {
            const wtx = Math.floor((b.x + ux * probe) / this.maze.tileSize);
            const wty = Math.floor((b.z + uz * probe) / this.maze.tileSize);
            if (this.maze.isWallTile(wtx, wty)) {
              wallTile = { tx: wtx, ty: wty };
              break;
            }
          }
          if (!wallTile) {
            const wtx = Math.floor(nx / this.maze.tileSize);
            const wty = Math.floor(nz / this.maze.tileSize);
            let bestDot = -2;
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                if (!this.maze.isWallTile(wtx + ox, wty + oy)) continue;
                const center = this.maze.tileCenter(wtx + ox, wty + oy);
                const dot = ((center.x - b.x) * ux + (center.z - b.z) * uz) /
                  Math.max(0.001, Math.hypot(center.x - b.x, center.z - b.z));
                if (dot > bestDot) {
                  bestDot = dot;
                  wallTile = { tx: wtx + ox, ty: wty + oy };
                }
              }
            }
          }
          break;
        }
        b.x = nx;
        b.z = nz;
        traveled += stepSize;
      }
      b.tx = Math.max(0, Math.min(this.maze.width - 1, Math.floor(b.x / this.maze.tileSize)));
      b.ty = Math.max(0, Math.min(this.maze.height - 1, Math.floor(b.z / this.maze.tileSize)));
      b.state = 'chase';
      b.alerted = true;
      b.chasePath = null;
      b.chaseTurnTimer = 0;
      b.chaseDirX = 0;
      b.chaseDirZ = 0;
      b.hasTarget = false;
      b.trapPullTimer = 0;
      b.boundTimer = 0;
      b.stunTimer = special ? 7.5 : (wallHit ? 2.5 : 0.5);
      b.moving = false;
      this.skillAnimTimer = 0.65;
      this.skillAnimTotal = 0.65;
      if (wallHit && wallTile) this.addWallBreak(wallTile.tx, wallTile.ty);
      this.setBossFacing(this.player.x - b.x, this.player.z - b.z);
      this.pushBossTrail(true);
      this.updateBossHud();
      const msg = special
        ? '完美防反 · BOSS 被击退 200m，眩晕 7.5 秒'
        : (wallHit ? '格挡成功 · BOSS 撞墙，眩晕 2.5 秒' : '格挡成功 · BOSS 眩晕 0.5 秒');
      this.showToast(msg, 'moon', 3200);
      this.audio.dash();
    }

    addWallBreak(tx, ty) {
      const existing = this.wallBreaks.find((w) => w.tx === tx && w.ty === ty);
      if (existing) {
        existing.age = 0;
        return;
      }
      this.wallBreaks.push({ tx, ty, age: 0 });
    }

    updateWallBreaks(dt) {
      if (!this.wallBreaks.length) return;
      for (const w of this.wallBreaks) w.age += dt;
      this.wallBreaks = this.wallBreaks.filter((w) => w.age < 10.5);
    }

    useSlot(index) {
      if (this.state !== 'playing') return;
      const itemKey = this.profile.hotbar[index];
      if (!itemKey) return;
      if (itemKey === 'whale') {
        this.showToast('免死鲸牌不能主动使用，只会在被小难梁抓住时询问', 'info', 2800);
        return;
      }
      if (itemKey === 'slow') {
        const existing = this.getSlowFieldAtPlayer();
        if (existing && existing.level >= 2) {
          this.showToast('这个格子的缓慢领域已经达到最大强化', 'info', 2400);
          return;
        }
      }
      if (!this.profile.items[itemKey]) {
        this.showToast('快捷栏 ' + (index + 1) + ' 没有可用的' + CONSUMABLES[itemKey].name, 'info', 1800);
        return;
      }
      this.profile.items[itemKey]--;
      this.saveProfile();
      this.updateHotbar();
      if (itemKey === 'stamina') {
        this.stamina = this.staminaMax;
        this.sprintLocked = false;
        this.noDrainTimer = 10;
        this.sprinting = false;
        this.player.sprinting = false;
        this.updateStaminaHUD();
        this.showToast('体力恢复药水 · 体力回满，10 秒内冲刺不耗体力', 'info', 3600);
        this.audio.dash();
      } else if (itemKey === 'speed') {
        this.speedPotionTimer = 10;
        this.speedPotionFade = 0;
        this.showToast('速度药水 · 10 秒内速度 +20%', 'info', 3000);
        this.audio.dash();
      } else if (itemKey === 'firework') {
        this.useFirework();
      } else if (itemKey === 'slow') {
        this.placeSlowField();
      } else if (itemKey === 'trap') {
        this.placeTrap();
      }
      this.updateBuffHUD();
      this.buildBackpackUI();
    }

    useFirework() {
      if (!this.maze) return;
      const maze = this.maze;
      const ptx = Math.floor(this.player.x / maze.tileSize);
      const pty = Math.floor(this.player.z / maze.tileSize);
      const radius = 16;
      let revealedFloors = 0;
      for (let ty = Math.max(0, pty - radius); ty <= Math.min(maze.height - 1, pty + radius); ty++) {
        for (let tx = Math.max(0, ptx - radius); tx <= Math.min(maze.width - 1, ptx + radius); tx++) {
          if (Math.abs(tx - ptx) + Math.abs(ty - pty) > radius) continue;
          const idx = maze.index(tx, ty);
          if (this.revealed[idx]) continue;
          this.revealed[idx] = 1;
          if (maze.isFloorTile(tx, ty)) revealedFloors++;
        }
      }
      this.revealedFloor += revealedFloors;
      this.exploredPct = this.totalFloor
        ? Math.min(100, this.revealedFloor / this.totalFloor * 100)
        : 0;
      this.mapLayerDirty = true;
      this.updateHUD();
      this.showToast('烟花 · 周围 16 格地图黑暗已清除', 'moon', 3200);
    }

    getSlowFieldAtPlayer() {
      if (!this.maze) return null;
      const tx = Math.floor(this.player.x / this.maze.tileSize);
      const ty = Math.floor(this.player.z / this.maze.tileSize);
      return this.slowFields.find((field) =>
        field.time > 0 && field.tx === tx && field.ty === ty
      ) || null;
    }

    placeSlowField() {
      if (!this.maze) return;
      const tx = Math.floor(this.player.x / this.maze.tileSize);
      const ty = Math.floor(this.player.z / this.maze.tileSize);
      const center = this.maze.tileCenter(tx, ty);
      const existing = this.getSlowFieldAtPlayer();
      if (existing) {
        if (existing.level >= 2) return;
        existing.level = 2;
        existing.time = 16;
        existing.maxTime = 16;
        this.showToast('缓慢药水 · 领域强化：16 秒内 BOSS 速度 -80%', 'moon', 3200);
        return;
      }
      this.slowFields.push({
        tx,
        ty,
        x: center.x,
        z: center.z,
        time: 8,
        maxTime: 8,
        level: 1
      });
      this.showToast('缓慢药水 · 脚下生成 8 秒绿色领域', 'info', 2800);
    }

    placeTrap() {
      if (!this.maze) return;
      const tx = Math.floor(this.player.x / this.maze.tileSize);
      const ty = Math.floor(this.player.z / this.maze.tileSize);
      const center = this.maze.tileCenter(tx, ty);
      this.traps.push({ tx, ty, x: center.x, z: center.z, active: true });
      this.showToast('陷阱已布置 · 等待小难梁经过', 'info', 2800);
    }

    updateCompassHUD() {
      if (!this.dom || !this.dom.compassReadout) return;
      if (!this.profile.compass || !this.maze || !this.player) {
        this.dom.compassReadout.hidden = true;
        this.dom.compassReadout.textContent = '';
        return;
      }
      const dist = Math.hypot(this.maze.exit.x - this.player.x, this.maze.exit.z - this.player.z) / this.maze.tileSize;
      this.dom.compassReadout.hidden = false;
      this.dom.compassReadout.textContent = '指南针 · 月之门直线距离 ' + dist.toFixed(1) + ' 格';
    }

    updateBuffHUD() {
      if (!this.dom || !this.dom.buffRow) return;
      const chips = [];
      if (this.noDrainTimer > 0) {
        chips.push('<span class="buff-chip gold"><i></i>体力涌动 ' + this.noDrainTimer.toFixed(1) + 's</span>');
      }
      if (this.speedPotionTimer > 0) {
        chips.push('<span class="buff-chip gold"><i></i>疾行 ' + this.speedPotionTimer.toFixed(1) + 's</span>');
      } else if (this.speedPotionFade > 0) {
        chips.push('<span class="buff-chip"><i></i>疾行消退 ' + this.speedPotionFade.toFixed(1) + 's</span>');
      }
      this.dom.buffRow.innerHTML = chips.join('');
    }

    bind() {
      const down = (e) => this.onKeyDown(e);
      const up = (e) => this.onKeyUp(e);
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);

      this.dom.startBtn.addEventListener('click', () => this.startGame());
      this.dom.homeMenuBtn.addEventListener('click', () => this.openHome());
      this.dom.homeClose.addEventListener('click', () => this.closeHome());
      this.dom.homeCloseBottom.addEventListener('click', () => this.closeHome());
      this.dom.openBackpack.addEventListener('click', () => this.openBackpack());
      this.dom.backpackClose.addEventListener('click', () => this.closeBackpack());
      this.dom.characterPrev.addEventListener('click', () => this.cycleCharacter(-1));
      this.dom.characterNext.addEventListener('click', () => this.cycleCharacter(1));
      this.dom.characterSkillToggle.addEventListener('click', () => this.toggleCharacterSkillInfo());
      this.dom.whaleUse.addEventListener('click', () => this.useWhaleCard());
      this.dom.whaleDecline.addEventListener('click', () => this.declineWhaleCard());
      this.dom.backpackPanel.addEventListener('click', (e) => {
        if (e.target === this.dom.backpackPanel) {
          this.closeBackpack();
          return;
        }
        const itemBtn = e.target.closest('[data-item][data-item-delta]');
        if (itemBtn) {
          this.adjustItem(itemBtn.dataset.item, Number(itemBtn.dataset.itemDelta) || 0);
          return;
        }
        const clear = e.target.closest('[data-clear-slot]');
        if (clear) {
          this.setHotbarSlot(Number(clear.dataset.clearSlot), null);
          return;
        }
        const itemCard = e.target.closest('[data-backpack-item]');
        if (itemCard && !e.target.closest('button')) {
          this.autoEquipItem(itemCard.dataset.backpackItem);
        }
      });
      this.dom.backpackPanel.addEventListener('dragstart', (e) => {
        if (e.target.closest('button')) {
          e.preventDefault();
          return;
        }
        const item = e.target.closest('[data-backpack-item]');
        const slot = e.target.closest('[data-backpack-slot]');
        if (item) {
          e.dataTransfer.setData('text/plain', 'item:' + item.dataset.backpackItem);
          e.dataTransfer.effectAllowed = 'move';
        } else if (slot && this.profile.hotbar[Number(slot.dataset.backpackSlot)]) {
          e.dataTransfer.setData('text/plain', 'slot:' + slot.dataset.backpackSlot);
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      this.dom.backpackPanel.addEventListener('dragover', (e) => {
        if (e.target.closest('[data-backpack-slot]')) e.preventDefault();
      });
      this.dom.backpackPanel.addEventListener('drop', (e) => {
        const slotEl = e.target.closest('[data-backpack-slot]');
        if (!slotEl) return;
        e.preventDefault();
        const target = Number(slotEl.dataset.backpackSlot);
        const raw = e.dataTransfer.getData('text/plain') || '';
        if (raw.startsWith('item:')) {
          this.setHotbarSlot(target, raw.slice(5));
        } else if (raw.startsWith('slot:')) {
          this.swapHotbarSlots(Number(raw.slice(5)), target);
        }
      });
      this.dom.homePanel.addEventListener('click', (e) => {
        if (e.target === this.dom.homePanel) {
          this.closeHome();
          return;
        }
        const upgradeBtn = e.target.closest('[data-upgrade]');
        if (upgradeBtn) {
          this.adjustUpgrade(upgradeBtn.dataset.upgrade, Number(upgradeBtn.dataset.delta) || 0);
          return;
        }
        const itemBtn = e.target.closest('[data-item][data-item-delta]');
        if (itemBtn) {
          this.adjustItem(itemBtn.dataset.item, Number(itemBtn.dataset.itemDelta) || 0);
          return;
        }
        const modeBtn = e.target.closest('[data-mode]');
        if (modeBtn) {
          this.setMode(modeBtn.dataset.mode);
          return;
        }
        const bossBtn = e.target.closest('[data-boss-setting][data-delta]');
        if (bossBtn) {
          this.adjustBoss(bossBtn.dataset.bossSetting, Number(bossBtn.dataset.delta) || 0);
          return;
        }
        if (e.target.closest('[data-compass-toggle]')) this.toggleCompass();
        if (e.target.closest('[data-xray-toggle]')) this.toggleXray();
      });
      this.dom.hotbar.addEventListener('click', (e) => {
        const slot = e.target.closest('[data-slot]');
        if (slot) this.useSlot(Number(slot.dataset.slot) - 1);
      });
      this.dom.pauseResume.addEventListener('click', () => this.resumeGame());
      this.dom.pauseHome.addEventListener('click', () => this.returnHome());
      this.dom.viewPlayer.addEventListener('click', () => this.setCameraFocus('player'));
      this.dom.viewBoss.addEventListener('click', () => this.setCameraFocus('boss'));
      this.dom.mapBtn.addEventListener('click', () => this.toggleMap());
      this.dom.touchMap.addEventListener('click', () => this.toggleMap());
      this.dom.mapClose.addEventListener('click', () => this.closeMap());
      this.dom.mapCloseX.addEventListener('click', () => this.closeMap());
      this.dom.mapZoomIn.addEventListener('click', () => this.changeMapZoom(1));
      this.dom.mapZoomOut.addEventListener('click', () => this.changeMapZoom(-1));
      this.dom.mapCanvas.addEventListener('wheel', (e) => {
        if (this.state !== 'map') return;
        e.preventDefault();
        this.changeMapZoom(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      this.dom.mapCanvas.addEventListener('pointerdown', (e) => this.beginMapDrag(e));
      window.addEventListener('pointermove', (e) => this.moveMapDrag(e));
      window.addEventListener('pointerup', (e) => this.endMapDrag(e));
      window.addEventListener('pointercancel', (e) => this.endMapDrag(e));
      this.dom.againBtn.addEventListener('click', () => this.startNewGame());
      this.dom.defeatRetry.addEventListener('click', () => this.startNewGame());
      this.dom.defeatHome.addEventListener('click', () => this.returnHome());
      this.dom.audioBtn.addEventListener('click', () => this.toggleAudio());
      this.dom.mapScreen.addEventListener('click', (e) => {
        if (e.target === this.dom.mapScreen) this.closeMap();
      });

      window.addEventListener('resize', () => {
        this.resize();
        if (this.mapOpen) this.drawMap(0);
      });

      window.addEventListener('blur', () => {
        this.keys = Object.create(null);
        this.clearVirtualKeys();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.keys = Object.create(null);
          this.clearVirtualKeys();
        }
      });

      this.bindTouchButton('touch-forward', 'forward');
      this.bindTouchButton('touch-back', 'back');
      this.bindTouchButton('touch-left', 'left');
      this.bindTouchButton('touch-right', 'right');
      this.bindTouchButton('touch-sprint', 'sprint');

      window.addEventListener('pointerdown', (e) => {
        if (this.state !== 'playing' || this.mapOpen) return;
        if (e.pointerType !== 'touch') return;
        this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }, { passive: true });
      window.addEventListener('pointerup', (e) => {
        if (!this.swipe || e.pointerId !== this.swipe.id) return;
        const dx = e.clientX - this.swipe.x;
        const dy = e.clientY - this.swipe.y;
        if (Math.hypot(dx, dy) > 50) {
          if (Math.abs(dx) > Math.abs(dy)) {
            this.tapVirtual(dx > 0 ? 'right' : 'left');
          } else {
            this.tapVirtual(dy < 0 ? 'forward' : 'back');
          }
        }
        this.swipe = null;
      }, { passive: true });
      window.addEventListener('pointercancel', () => { this.swipe = null; });
    }

    bindTouchButton(id, action) {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => {
        e.preventDefault();
        if (this.state !== 'playing') return;
        this.keys['virtual-' + action] = true;
        el.classList.add('pressed');
      };
      const end = (e) => {
        e.preventDefault();
        this.keys['virtual-' + action] = false;
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerdown', start, { passive: false });
      el.addEventListener('pointerup', end, { passive: false });
      el.addEventListener('pointerleave', end, { passive: false });
      el.addEventListener('pointercancel', end, { passive: false });
    }

    tapVirtual(action) {
      this.keys['virtual-' + action] = true;
      setTimeout(() => { this.keys['virtual-' + action] = false; }, 160);
    }

    clearVirtualKeys() {
      for (const key of Object.keys(this.keys)) {
        if (key.startsWith('virtual-')) this.keys[key] = false;
      }
    }

    onKeyDown(e) {
      const code = e.code;
      if (this.backpackOpen) {
        if (code === 'Escape') {
          e.preventDefault();
          if (!e.repeat) this.closeBackpack();
        }
        return;
      }
      if (this.state === 'whale') {
        if (code === 'Enter') {
          e.preventDefault();
          if (!e.repeat) this.useWhaleCard();
        } else if (code === 'Escape') {
          e.preventDefault();
          if (!e.repeat) this.declineWhaleCard();
        }
        return;
      }
      if (this.homeOpen) {
        if (code === 'Escape') {
          e.preventDefault();
          if (!e.repeat) this.closeHome();
        }
        return;
      }
      const gameKeys = ['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyM', 'KeyV', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9'];
      if (gameKeys.includes(code)) e.preventDefault();

      if (code === 'Space') {
        if (e.repeat) return;
        if (this.state === 'playing') { this.pauseGame(); return; }
        if (this.state === 'paused') { this.resumeGame(); return; }
        if (this.state === 'title') { this.startGame(); return; }
        if (this.state === 'victory' || this.state === 'defeat') { this.startNewGame(); return; }
        return;
      }

      if (code === 'Enter') {
        if (e.repeat) return;
        if (this.state === 'title') { this.startGame(); return; }
        if (this.state === 'victory' || this.state === 'defeat') { this.startNewGame(); return; }
        if (this.state === 'paused') { this.resumeGame(); return; }
        return;
      }

      if (code === 'Escape') {
        if (this.state === 'map') this.closeMap();
        else if (this.state === 'paused') this.resumeGame();
        else if (this.state === 'defeat') this.returnHome();
        return;
      }
      if (this.state === 'map' && (code === 'Equal' || code === 'NumpadAdd' || code === 'Minus' || code === 'NumpadSubtract')) {
        e.preventDefault();
        this.changeMapZoom(code === 'Equal' || code === 'NumpadAdd' ? 1 : -1);
        return;
      }
      if (code === 'KeyM') {
        if (this.state === 'playing') this.openMap();
        else if (this.state === 'map') this.closeMap();
        return;
      }
      if (code === 'KeyV') {
        if (this.state === 'playing' && this.mode === 'test') this.toggleCameraFocus();
        return;
      }
      if (code === 'KeyQ') {
        if (this.state === 'playing' && this.profile.character === 'grok') {
          if (!e.repeat) this.useBlockSkill();
        }
        return;
      }

      if (code.startsWith('Digit') && this.state === 'playing') {
        const slot = Number(code.slice(5));
        if (slot >= 1 && slot <= 9) {
          this.useSlot(slot - 1);
          return;
        }
      }
      if (code.startsWith('Numpad') && this.state === 'playing') {
        const slot = Number(code.slice(6));
        if (slot >= 1 && slot <= 9) {
          this.useSlot(slot - 1);
          return;
        }
      }

      if (this.state !== 'playing' || this.mapOpen) return;

      switch (code) {
        case 'KeyW': case 'ArrowUp': this.keys.forward = true; break;
        case 'KeyS': case 'ArrowDown': this.keys.back = true; break;
        case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
        case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = true; break;
        default: break;
      }
    }

    onKeyUp(e) {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.keys.forward = false; break;
        case 'KeyS': case 'ArrowDown': this.keys.back = false; break;
        case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
        case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = false; break;
        default: break;
      }
    }

    resize() {
      this.renderer.resize();
    }

    openHome() {
      if (this.state !== 'title' || this.homeOpen) return;
      this.homeOpen = true;
      this.updateHomeUI();
      this.dom.homePanel.classList.add('open');
      this.dom.homePanel.setAttribute('aria-hidden', 'false');
      this.audio.init();
    }

    closeHome() {
      if (!this.homeOpen) return;
      this.closeBackpack();
      this.homeOpen = false;
      this.dom.homePanel.classList.remove('open');
      this.dom.homePanel.setAttribute('aria-hidden', 'true');
      this.dom.homeMenuBtn.focus({ preventScroll: true });
    }

    pauseGame() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.keys = Object.create(null);
      this.clearVirtualKeys();
      this.player.moving = false;
      this.player.sprinting = false;
      this.sprinting = false;
      this.velocityX = 0;
      this.velocityZ = 0;
      this.dom.pauseScreen.classList.add('open');
      this.dom.pauseScreen.setAttribute('aria-hidden', 'false');
      document.body.dataset.state = 'paused';
      this.updateBuffHUD();
      this.dom.pauseResume.focus({ preventScroll: true });
    }

    resumeGame() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.dom.pauseScreen.classList.remove('open');
      this.dom.pauseScreen.setAttribute('aria-hidden', 'true');
      document.body.dataset.state = 'playing';
      this.dom.hud.classList.add('visible');
      this.dom.mapBtn.focus({ preventScroll: true });
    }

    togglePause() {
      if (this.state === 'playing') this.pauseGame();
      else if (this.state === 'paused') this.resumeGame();
    }

    returnHome() {
      this.state = 'title';
      this.mapOpen = false;
      this.won = false;
      this.keys = Object.create(null);
      this.clearVirtualKeys();
      this.player && (this.player.moving = false);
      this.noDrainTimer = 0;
      this.speedPotionTimer = 0;
      this.speedPotionFade = 0;
      this.dom.pauseScreen.classList.remove('open');
      this.dom.mapScreen.classList.remove('open');
      this.dom.victoryScreen.classList.remove('open');
      this.dom.defeatScreen.classList.remove('open');
      this.dom.pauseScreen.setAttribute('aria-hidden', 'true');
      this.dom.mapScreen.setAttribute('aria-hidden', 'true');
      this.dom.victoryScreen.setAttribute('aria-hidden', 'true');
      this.dom.defeatScreen.setAttribute('aria-hidden', 'true');
      this.dom.bossAlert.hidden = true;
      this.dom.bossArrow.hidden = true;
      this.dom.skillHud.hidden = true;
      if (this.boss) this.boss.active = false;
      this.dom.whalePrompt.classList.remove('open');
      this.dom.whalePrompt.setAttribute('aria-hidden', 'true');
      this.dom.backpackPanel.classList.remove('open');
      this.dom.backpackPanel.setAttribute('aria-hidden', 'true');
      this.backpackOpen = false;
      this.dom.testView.hidden = true;
      this.cameraFocus = 'player';
      this.renderer.focusBoss = false;
      this.renderer.cinematicZoom = 1;
      this.dom.hud.classList.remove('visible');
      this.dom.startScreen.classList.remove('hidden', 'leaving');
      this.dom.startScreen.classList.add('open');
      document.body.dataset.state = 'title';
      this.homeOpen = false;
      this.dom.homePanel.classList.remove('open');
      this.dom.homePanel.setAttribute('aria-hidden', 'true');
      this.applyProfile();
      this.updateHomeUI();
      this.dom.startBtn.focus({ preventScroll: true });
    }

    startGame() {
      if (this.state !== 'title') return;
      this.closeHome();
      this.dom.pauseScreen.classList.remove('open');
      this.dom.pauseScreen.setAttribute('aria-hidden', 'true');
      this.audio.init();
      this.audio.setMuted(this.audio.muted);
      this.dom.startScreen.classList.add('leaving');
      document.body.dataset.state = 'starting';
      setTimeout(() => {
        this.dom.startScreen.classList.remove('leaving');
        this.dom.startScreen.classList.add('hidden');
      }, 700);
      this.startNewGame(this.seedFromURL);
      this.dom.hud.classList.add('visible');
      document.body.dataset.state = 'playing';
      setTimeout(() => {
        if (this.spriteNote) {
          this.showToast(this.spriteNote, 'info', 5200);
        } else {
          this.showToast('循着灯火，找到传说中的月之门', 'moon', 4200);
        }
      }, 500);
    }

    startNewGame(seedOverride) {
      const seed = seedOverride != null ? seedOverride >>> 0 : (this.seedFromURL != null && !this._hasStarted ? this.seedFromURL : randomSeed());
      this._hasStarted = true;
      this.seedFromURL = null;
      this.seed = seed;

      let maze = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const s = (seed + attempt * 7919) >>> 0;
        const candidate = new window.AzureMaze.Maze({ cols: 40, rows: 40, seed: s, tileSize: 4 });
        const dx = candidate.exit.x - candidate.spawn.x;
        const dz = candidate.exit.z - candidate.spawn.z;
        if (Math.hypot(dx, dz) > 12 * candidate.tileSize) {
          maze = candidate;
          break;
        }
        maze = candidate;
      }

      this.maze = maze;
      this.seed = maze.seed;
      this.won = false;
      this.mode = ['explore', 'chase', 'test'].includes(this.profile.mode) ? this.profile.mode : 'explore';
      this.boss = null;
      this.bossWeights = null;
      this.bossPerception = 10 + this.profile.boss.sensitivity;
      this.slowFields = [];
      this.traps = [];
      this.wallBreaks = [];
      this.blockCharges = BLOCK_MAX_CHARGES;
      this.blockRecharge = 0;
      this.blocking = false;
      this.blockElapsed = 0;
      this.blockTriggered = false;
      this.skillAnimTimer = 0;
      this.skillAnimTotal = 0;
      this.parryFreeze = 0;
      this.parryPending = null;
      this.parryFlash = 0;
      this.renderer.cinematicZoom = 1;
      this.backpackOpen = false;
      this.dom.backpackPanel.classList.remove('open');
      this.dom.backpackPanel.setAttribute('aria-hidden', 'true');
      this.dom.whalePrompt.classList.remove('open');
      this.dom.whalePrompt.setAttribute('aria-hidden', 'true');
      this.applyProfile();
      this.noDrainTimer = 0;
      this.speedPotionTimer = 0;
      this.speedPotionFade = 0;
      this.revealed = new Uint8Array(maze.width * maze.height);
      this.lightField = new Uint8Array(maze.width * maze.height);
      this.revealedFloor = 0;
      this.exitFound = false;
      this.totalFloor = maze.totalFloor;
      this.exploredPct = 0;
      if (this.mode === 'test') {
        this.revealed.fill(1);
        this.revealedFloor = this.totalFloor;
        this.exploredPct = 100;
      }
      this.elapsed = 0;
      this.time = 0;
      this.mapTime = 0;
      this.revealTimer = 0;
      this.lastStepDistance = 0;
      this.stepDistanceAcc = 0;
      this.mapZoomIndex = 0;
      this.mapZoom = 1;
      this.mapCenter = { x: maze.width / 2, y: maze.height / 2 };
      this.mapLayerDirty = true;
      this.updateMapZoomLabel();
      this.keys = Object.create(null);
      this.turnInput = 0;
      this.forwardInput = 0;
      this.moveVelocity = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
      this.sprinting = false;
      this.stamina = this.staminaMax;
      this.sprintLocked = false;
      this.updateStaminaHUD();
      this.player = {
        x: maze.spawn.x,
        z: maze.spawn.z,
        yaw: maze.spawnYaw,
        facingX: 1,
        facingDir: 'front',
        facingMirror: false,
        moving: false,
        sprinting: false,
        walkDistance: 0,
        walkPhase: 0,
        walkFrame: 0,
        speed: 0
      };
      this.renderer.setMaze(maze);
      this.renderer.setCharacter(this.profile.character);
      this.dom.skillHud.hidden = this.profile.character !== 'grok';
      this.renderer.camYaw = 0;
      this.renderer.lastWalkDistance = 0;
      this.renderer.time = 0;

      this.updateHUD();
      this.dom.mapFound.textContent = '尚未发现';
      this.dom.mapFound.classList.remove('found');
      this.dom.mapBtn.classList.remove('found');
      this.dom.objective.textContent = '在迷宫中寻找月之门';
      this.dom.mapScreen.classList.remove('open');
      this.dom.victoryScreen.classList.remove('open');
      this.dom.defeatScreen.classList.remove('open');
      this.dom.mapScreen.setAttribute('aria-hidden', 'true');
      this.dom.victoryScreen.setAttribute('aria-hidden', 'true');
      this.dom.defeatScreen.setAttribute('aria-hidden', 'true');
      this.dom.bossAlert.hidden = true;
      this.dom.bossArrow.hidden = true;
      this.dom.modeTag.textContent = this.mode === 'test' ? '测试模式' : (this.mode === 'chase' ? '追逐模式' : '探索模式');
      this.dom.modeTag.classList.toggle('chase', this.mode === 'chase' || this.mode === 'test');
      this.dom.testView.hidden = this.mode !== 'test';
      this.cameraFocus = 'player';
      this.renderer.focusBoss = false;
      this.updateViewButtons();
      this.dom.mapBoss.textContent = this.mode === 'explore' ? '无' : '漫游';
      this.mapOpen = false;
      this.state = 'playing';
      document.body.dataset.state = 'playing';
      this.dom.hud.classList.add('visible');
      this.dom.pauseScreen.classList.remove('open');
      this.dom.pauseScreen.setAttribute('aria-hidden', 'true');
      this.dom.mapBtn.dataset.hint = 'true';
      this.dom.timer.textContent = '00:00';
      this.dom.pct.textContent = '0%';
      this.dom.mapSeed.textContent = 'SEED ' + this.seed;
      this.dom.seedTag.textContent = 'SEED ' + this.seed;
      if (this.dom.mapPerception) this.dom.mapPerception.textContent = `${this.perception} 格`;
      this.updateCompassHUD();
      this.updateHotbar();
      this.updateBuffHUD();
      this.updateMapButtonState();
      this.resize();
      this.renderer.render(this, 0);
      this.revealAroundPlayer(true);
      if (this.mode === 'chase' || this.mode === 'test') this.spawnBoss();
      this.updateSkillHUD();
    }

    revealAroundPlayer(initial = false) {
      if (!this.maze || !this.revealed || !this.lightField) return;
      this.computeLightField();
      let changed = false;
      for (let idx = 0; idx < this.lightField.length; idx++) {
        if (this.lightField[idx] <= 0 || this.revealed[idx]) continue;
        const tx = idx % this.maze.width;
        const ty = Math.floor(idx / this.maze.width);
        this.revealed[idx] = 1;
        changed = true;
        if (this.maze.isFloorTile(tx, ty)) this.revealedFloor++;
      }
      if (changed || initial) {
        this.exploredPct = this.totalFloor ? Math.min(100, this.revealedFloor / this.totalFloor * 100) : 0;
        this.updateHUD();
      }
      this.checkExitInLightField();
      this.checkExitByPerception();
    }

    computeLightField() {
      if (!this.maze || !this.lightField) return;
      const maze = this.maze;
      // Test mode map: every tile is fixed at light level 5 so the whole
      // chart can be inspected independently of the player's lamp.
      if (this.mode === 'test') {
        this.lightField.fill(5);
        return;
      }
      const TS = maze.tileSize;
      this.lightField.fill(0);
      const startX = Math.max(0, Math.min(maze.width - 1, Math.floor(this.player.x / TS)));
      const startY = Math.max(0, Math.min(maze.height - 1, Math.floor(this.player.z / TS)));
      const startIdx = maze.index(startX, startY);
      this.lightField[startIdx] = this.lightLevel;
      const queue = [[startX, startY, this.lightLevel]];
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let head = 0; head < queue.length; head++) {
        const [tx, ty, value] = queue[head];
        for (const [dx, dy] of dirs) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= maze.width || ny >= maze.height) continue;
          const next = maze.isWallTile(nx, ny)
            ? Math.floor((value - 1) / LIGHT_WALL_DIVISOR)
            : value - 1;
          if (next <= 0) continue;
          const idx = maze.index(nx, ny);
          if (next <= this.lightField[idx]) continue;
          this.lightField[idx] = next;
          queue.push([nx, ny, next]);
        }
      }
    }

    checkExitInLightField() {
      if (!this.exitFound && this.maze && this.maze.exit && this.lightField) {
        const exitIndex = this.maze.index(this.maze.exit.tx, this.maze.exit.ty);
        if (this.lightField[exitIndex] > 0) this.discoverExit();
      }
    }

    checkExitByPerception() {
      if (this.exitFound || !this.maze || !this.maze.exit || !this.player) return;
      const TS = this.maze.tileSize;
      const ptx = Math.floor(this.player.x / TS);
      const pty = Math.floor(this.player.z / TS);
      const distance = Math.abs(this.maze.exit.tx - ptx) + Math.abs(this.maze.exit.ty - pty);
      if (distance <= this.perception) this.discoverExit();
    }

    bossSpeedValues() {
      const s = this.profile.boss.speed;
      return {
        roam: (75 + s) * 0.06,
        chase: (95 + 1.25 * s) * 0.06
      };
    }

    spawnBoss() {
      const maze = this.maze;
      if (!maze) return;
      const TS = maze.tileSize;
      const ptx = Math.floor(this.player.x / TS);
      const pty = Math.floor(this.player.z / TS);
      const range = 10 + this.profile.boss.sensitivity;
      const candidates = [];
      let farthest = null;
      let farthestD = -1;
      for (let ty = 1; ty < maze.height - 1; ty++) {
        for (let tx = 1; tx < maze.width - 1; tx++) {
          if (!maze.isFloorTile(tx, ty)) continue;
          if (tx === maze.exit.tx && ty === maze.exit.ty) continue;
          const d = Math.abs(tx - ptx) + Math.abs(ty - pty);
          if (d > farthestD) { farthestD = d; farthest = { tx, ty }; }
          if (d > range) candidates.push({ tx, ty });
        }
      }
      const pick = candidates.length
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : farthest;
      if (!pick) return;
      const speeds = this.bossSpeedValues();
      this.bossPerception = range;
      this.bossWeights = new Float32Array(maze.width * maze.height).fill(1);
      const center = maze.tileCenter(pick.tx, pick.ty);
      this.boss = {
        x: center.x,
        z: center.z,
        tx: pick.tx,
        ty: pick.ty,
        targetX: center.x,
        targetZ: center.z,
        targetTx: pick.tx,
        targetTy: pick.ty,
        hasTarget: false,
        chasePath: null,
        chaseTurnTimer: 0,
        chaseDirX: 0,
        chaseDirZ: 0,
        roamTurnTimer: 0,
        dirX: 0,
        dirZ: 0,
        inertia: Number.isFinite(Number(this.profile.boss.inertia))
          ? clamp(Number(this.profile.boss.inertia), 0, 2)
          : 0,
        alerted: false,
        alertTimer: 0,
        boundTimer: 0,
        stunTimer: 0,
        trapPullTimer: 0,
        trapX: 0,
        trapZ: 0,
        trapStartX: 0,
        trapStartZ: 0,
        slowFactor: 1,
        slowBaseFactor: 1,
        slowRecover: 0,
        slowRecoverMax: 6,
        state: 'roam',
        moving: false,
        roamSpeed: speeds.roam,
        chaseSpeed: speeds.chase,
        facingKey: 'down',
        facingMirror: false,
        active: true,
        trail: [{ tx: pick.tx, ty: pick.ty, x: center.x, z: center.z }]
      };
      this.bossWeights[maze.index(pick.tx, pick.ty)] = 0.5;
      this.chooseBossTarget();
      this.updateBossHud();
    }

    chooseBossTarget() {
      const b = this.boss;
      if (!b || !this.maze || b.state !== 'roam') return;
      const maze = this.maze;
      const TS = maze.tileSize;
      const tx = Math.floor(b.x / TS);
      const ty = Math.floor(b.z / TS);
      const next = this.bossRandomStep(tx, ty);
      if (!next) {
        b.hasTarget = false;
        return;
      }
      const center = maze.tileCenter(next.tx, next.ty);
      b.targetX = center.x;
      b.targetZ = center.z;
      b.targetTx = next.tx;
      b.targetTy = next.ty;
      b.hasTarget = true;
      b.dirX = center.x - b.x;
      b.dirZ = center.z - b.z;
      b.roamTurnTimer = b.inertia;
      this.setBossFacing(center.x - b.x, center.z - b.z);
    }

    bossNeighbors8(tx, ty) {
      const out = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (!this.maze.isFloorTile(nx, ny)) continue;
          // Do not cut through a wall corner with the boss body.
          if (dx !== 0 && dy !== 0 &&
              (!this.maze.isFloorTile(tx + dx, ty) || !this.maze.isFloorTile(tx, ty + dy))) {
            continue;
          }
          out.push({ tx: nx, ty: ny });
        }
      }
      return out;
    }

    bossRandomStep(tx, ty) {
      const neighbors = this.bossNeighbors8(tx, ty);
      if (!neighbors.length) return null;
      let total = 0;
      const weights = neighbors.map((n) => {
        const w = Math.max(0.0001, this.bossWeights[this.maze.index(n.tx, n.ty)]);
        total += w;
        return w;
      });
      let roll = Math.random() * total;
      for (let i = 0; i < neighbors.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return neighbors[i];
      }
      return neighbors[neighbors.length - 1];
    }

    bossNextStep(tx, ty, targetTx, targetTy) {
      const maze = this.maze;
      if (tx === targetTx && ty === targetTy) return null;
      const start = maze.index(tx, ty);
      const target = maze.index(targetTx, targetTy);
      const parent = new Int32Array(maze.width * maze.height).fill(-1);
      const queue = [start];
      parent[start] = start;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        if (idx === target) break;
        const cx = idx % maze.width;
        const cy = Math.floor(idx / maze.width);
        const neighbors = this.bossNeighbors8(cx, cy);
        for (const n of neighbors) {
          const ni = maze.index(n.tx, n.ty);
          if (parent[ni] !== -1) continue;
          parent[ni] = idx;
          queue.push(ni);
        }
      }
      if (parent[target] === -1) return null;
      let node = target;
      while (parent[node] !== start && node !== start) node = parent[node];
      if (node === start) return null;
      return { tx: node % maze.width, ty: Math.floor(node / maze.width) };
    }

    bossPathTo(tx, ty, targetTx, targetTy) {
      const maze = this.maze;
      if (tx === targetTx && ty === targetTy) return [];
      const start = maze.index(tx, ty);
      const target = maze.index(targetTx, targetTy);
      const parent = new Int32Array(maze.width * maze.height).fill(-1);
      const queue = [start];
      parent[start] = start;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        if (idx === target) break;
        const cx = idx % maze.width;
        const cy = Math.floor(idx / maze.width);
        for (const n of this.bossNeighbors8(cx, cy)) {
          const ni = maze.index(n.tx, n.ty);
          if (parent[ni] !== -1) continue;
          parent[ni] = idx;
          queue.push(ni);
        }
      }
      if (parent[target] === -1) return null;
      const path = [];
      let node = target;
      while (node !== start) {
        path.push({ tx: node % maze.width, ty: Math.floor(node / maze.width) });
        node = parent[node];
      }
      path.reverse();
      return path;
    }

    pushBossTrail(force = false) {
      const b = this.boss;
      if (!b) return;
      const tx = Math.max(0, Math.min(this.maze.width - 1, Math.floor(b.x / this.maze.tileSize)));
      const ty = Math.max(0, Math.min(this.maze.height - 1, Math.floor(b.z / this.maze.tileSize)));
      const last = b.trail[b.trail.length - 1];
      if (!force && last && last.tx === tx && last.ty === ty &&
          Math.hypot(b.x - last.x, b.z - last.z) < 1.2) {
        return;
      }
      b.trail.push({ tx, ty, x: b.x, z: b.z });
      if (b.trail.length > 220) b.trail.splice(0, b.trail.length - 220);
    }

    setBossFacing(dx, dz) {
      if (!this.boss || (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001)) return;
      const angle = Math.atan2(dz, dx);
      let sector = Math.round(angle / (Math.PI / 4));
      sector = ((sector % 8) + 8) % 8;
      const map = [
        { key: 'left', mirror: true },
        { key: 'downleft', mirror: true },
        { key: 'down', mirror: false },
        { key: 'downleft', mirror: false },
        { key: 'left', mirror: false },
        { key: 'upleft', mirror: false },
        { key: 'up', mirror: false },
        { key: 'upleft', mirror: true }
      ];
      const info = map[sector];
      this.boss.facingKey = info.key;
      this.boss.facingMirror = info.mirror;
    }

    updateBossRoam(dt) {
      const b = this.boss;
      const maze = this.maze;
      const TS = maze.tileSize;
      b.roamTurnTimer = Math.max(0, (b.roamTurnTimer || 0) - dt);
      if (!b.hasTarget) this.chooseBossTarget();
      if (!b.hasTarget) {
        b.moving = false;
        return;
      }
      const dx = b.targetX - b.x;
      const dz = b.targetZ - b.z;
      const dist = Math.hypot(dx, dz);
      const step = b.roamSpeed * (b.slowFactor || 1) * dt;
      b.moving = b.roamSpeed > 0.01;
      if (dist <= step || dist < 0.001) {
        b.x = b.targetX;
        b.z = b.targetZ;
        b.tx = b.targetTx;
        b.ty = b.targetTy;
        const idx = maze.index(b.tx, b.ty);
        this.bossWeights[idx] *= 0.5;
        this.pushBossTrail(true);

        // While the inertia timer is still running, keep walking in the same
        // direction through the next cell instead of re-rolling weights.
        if (b.roamTurnTimer > 0) {
          const sx = Math.abs(b.dirX) > 0.25 ? Math.sign(b.dirX) : 0;
          const sz = Math.abs(b.dirZ) > 0.25 ? Math.sign(b.dirZ) : 0;
          const nx = b.tx + sx;
          const ny = b.ty + sz;
          const cornerOk = !sx || !sz ||
            (maze.isFloorTile(b.tx + sx, b.ty) && maze.isFloorTile(b.tx, b.ty + sz));
          if (cornerOk && maze.isFloorTile(nx, ny)) {
            const center = maze.tileCenter(nx, ny);
            b.targetX = center.x;
            b.targetZ = center.z;
            b.targetTx = nx;
            b.targetTy = ny;
            b.hasTarget = true;
            this.setBossFacing(center.x - b.x, center.z - b.z);
            return;
          }
        }
        b.hasTarget = false;
        this.chooseBossTarget();
        return;
      }
      const nx = b.x + (dx / dist) * step;
      const nz = b.z + (dz / dist) * step;
      if (!this.collides(nx, nz)) {
        b.x = nx;
        b.z = nz;
      } else {
        // Roaming is a cell-to-cell weighted walk; if a corner blocks the
        // body, recenter and choose another weighted neighbour.
        b.x = (Math.floor(b.x / TS) + 0.5) * TS;
        b.z = (Math.floor(b.z / TS) + 0.5) * TS;
        b.hasTarget = false;
        this.chooseBossTarget();
      }
    }

    updateBossChase(dt) {
      const b = this.boss;
      const maze = this.maze;
      const TS = maze.tileSize;
      const ptx = Math.floor(this.player.x / TS);
      const pty = Math.floor(this.player.z / TS);
      const btx = Math.max(0, Math.min(maze.width - 1, Math.floor(b.x / TS)));
      const bty = Math.max(0, Math.min(maze.height - 1, Math.floor(b.z / TS)));

      b.chaseTurnTimer = (b.chaseTurnTimer || 0) - dt;
      if (b.chaseTurnTimer <= 0) {
        // Commit to one direction for the configured inertia. The target is
        // the player's exact position; the grid path only steers around walls.
        b.chasePath = this.bossPathTo(btx, bty, ptx, pty) || [];
        let targetX = this.player.x;
        let targetZ = this.player.z;
        const hasSight = maze.hasLineOfSight(b.x, b.z, this.player.x, this.player.z);
        if (!hasSight && b.chasePath.length) {
          let waypoint = null;
          const lookAhead = Math.min(3, b.chasePath.length);
          for (let i = lookAhead - 1; i >= 0; i--) {
            const cell = b.chasePath[i];
            const center = maze.tileCenter(cell.tx, cell.ty);
            if (maze.hasLineOfSight(b.x, b.z, center.x, center.z)) {
              waypoint = center;
              break;
            }
          }
          if (!waypoint) {
            const first = b.chasePath[0];
            waypoint = maze.tileCenter(first.tx, first.ty);
          }
          if (b.chasePath.length === 1) {
            waypoint = { x: this.player.x, z: this.player.z };
          }
          targetX = waypoint.x;
          targetZ = waypoint.z;
        }
        const dx = targetX - b.x;
        const dz = targetZ - b.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.001) {
          b.chaseDirX = dx / dist;
          b.chaseDirZ = dz / dist;
        } else {
          b.chaseDirX = 0;
          b.chaseDirZ = 0;
        }
        b.chaseTurnTimer = b.inertia;
      }

      const step = b.chaseSpeed * (b.slowFactor || 1) * dt;
      b.moving = step > 0.001 && (b.chaseDirX !== 0 || b.chaseDirZ !== 0);
      if (b.moving) {
        const nx = b.x + b.chaseDirX * step;
        const nz = b.z + b.chaseDirZ * step;
        let moved = false;
        if (!this.collides(nx, nz)) {
          b.x = nx;
          b.z = nz;
          moved = true;
        } else {
          // Slide along a wall, but if both axes are blocked force a new
          // direction decision on the next frame.
          if (!this.collides(nx, b.z)) {
            b.x = nx;
            moved = true;
          }
          if (!this.collides(b.x, nz)) {
            b.z = nz;
            moved = true;
          }
        }
        if (!moved) b.chaseTurnTimer = 0;
      }
      b.tx = Math.max(0, Math.min(maze.width - 1, Math.floor(b.x / TS)));
      b.ty = Math.max(0, Math.min(maze.height - 1, Math.floor(b.z / TS)));
      this.setBossFacing(this.player.x - b.x, this.player.z - b.z);
      this.pushBossTrail();
    }

    updateBossSlow(dt, btx, bty) {
      const b = this.boss;
      if (!b) return;
      const activeField = this.slowFields.find((field) =>
        field.time > 0 && field.tx === btx && field.ty === bty
      );
      if (activeField) {
        b.slowBaseFactor = activeField.level >= 2 ? 0.2 : 0.4;
        b.slowRecoverMax = activeField.level >= 2 ? 8 : 6;
        b.slowFactor = b.slowBaseFactor;
        b.slowRecover = b.slowRecoverMax;
      } else if (b.slowRecover > 0) {
        const base = b.slowBaseFactor != null ? b.slowBaseFactor : 0.4;
        const max = b.slowRecoverMax || 6;
        b.slowRecover = Math.max(0, b.slowRecover - dt);
        b.slowFactor = base + (1 - base) * (1 - b.slowRecover / max);
        if (b.slowRecover <= 0) b.slowFactor = 1;
      } else {
        b.slowFactor = 1;
      }
    }

    checkBossTraps() {
      const b = this.boss;
      if (!b || !this.traps.length) return false;
      const tx = Math.max(0, Math.min(this.maze.width - 1, Math.floor(b.x / this.maze.tileSize)));
      const ty = Math.max(0, Math.min(this.maze.height - 1, Math.floor(b.z / this.maze.tileSize)));
      for (let i = 0; i < this.traps.length; i++) {
        const trap = this.traps[i];
        if (!trap.active || trap.tx !== tx || trap.ty !== ty) continue;
        this.traps.splice(i, 1);
        const center = this.maze.tileCenter(trap.tx, trap.ty);
        b.trapPullTimer = 0.2;
        b.trapX = center.x;
        b.trapZ = center.z;
        b.trapStartX = b.x;
        b.trapStartZ = b.z;
        b.stunTimer = 4.8;
        b.moving = false;
        this.showToast('陷阱触发 · 小难梁被拉入格心并眩晕 4.8 秒', 'info', 3000);
        return true;
      }
      return false;
    }

    updateBoss(dt) {
      const b = this.boss;
      if (!b || !b.active || this.state !== 'playing') return;
      const maze = this.maze;
      const TS = maze.tileSize;
      const ptx = Math.floor(this.player.x / TS);
      const pty = Math.floor(this.player.z / TS);
      const btx = Math.max(0, Math.min(maze.width - 1, Math.floor(b.x / TS)));
      const bty = Math.max(0, Math.min(maze.height - 1, Math.floor(b.z / TS)));
      const distance = Math.abs(btx - ptx) + Math.abs(bty - pty);

      if (b.boundTimer > 0) {
        b.boundTimer = Math.max(0, b.boundTimer - dt);
        b.moving = false;
        this.updateBossHud();
        return;
      }
      if (b.trapPullTimer > 0) {
        b.trapPullTimer = Math.max(0, b.trapPullTimer - dt);
        const t = 1 - b.trapPullTimer / 0.2;
        b.x = b.trapStartX + (b.trapX - b.trapStartX) * t;
        b.z = b.trapStartZ + (b.trapZ - b.trapStartZ) * t;
        if (b.trapPullTimer <= 0) {
          b.x = b.trapX;
          b.z = b.trapZ;
        }
        b.moving = false;
        this.updateBossHud();
        return;
      }
      if (b.stunTimer > 0) {
        b.stunTimer = Math.max(0, b.stunTimer - dt);
        b.moving = false;
        this.updateBossHud();
        return;
      }

      if (!b.alerted && distance <= this.bossPerception) {
        b.alerted = true;
        b.state = 'chase';
        b.hasTarget = false;
        b.chasePath = null;
        b.chaseTurnTimer = 0;
        b.chaseDirX = 0;
        b.chaseDirZ = 0;
        b.alertTimer = 4;
        this.updateBossHud();
      }

      this.updateBossSlow(dt, btx, bty);
      if (b.state === 'chase') {
        b.alertTimer = Math.max(0, (b.alertTimer || 0) - dt);
        this.updateBossChase(dt);
      } else {
        this.updateBossRoam(dt);
      }

      if (this.checkBossTraps()) {
        this.updateBossHud();
        return;
      }

      if (this.mode !== 'test' && this.bossCollidesPlayer()) {
        if (this.blocking) {
          if (!this.blockTriggered) {
            this.blockTriggered = true;
            if (this.blockElapsed <= PARRY_WINDOW) {
              this.startParry();
            } else {
              this.applyBlockKnockback(false);
            }
          }
          return;
        }
        if (this.hasWhaleCard()) {
          this.triggerWhalePrompt();
        } else {
          this.loseGame();
        }
        return;
      }
      this.updateBossHud();
    }

    updateBossHud() {
      if (!this.dom || !this.dom.bossArrow) return;
      const b = this.boss;
      const chaseActive = (this.mode === 'chase' || this.mode === 'test') && b && b.active && (this.state === 'playing' || this.state === 'paused');
      if (!chaseActive) {
        this.dom.bossAlert.hidden = true;
        this.dom.bossArrow.hidden = true;
        if (this.dom.mapBoss) this.dom.mapBoss.textContent = '无';
        return;
      }
      const dx = b.x - this.player.x;
      const dz = b.z - this.player.z;
      const btx = Math.max(0, Math.min(this.maze.width - 1, Math.floor(b.x / this.maze.tileSize)));
      const bty = Math.max(0, Math.min(this.maze.height - 1, Math.floor(b.z / this.maze.tileSize)));
      const ptx = Math.floor(this.player.x / this.maze.tileSize);
      const pty = Math.floor(this.player.z / this.maze.tileSize);
      const alertDistance = Math.abs(btx - ptx) + Math.abs(bty - pty);
      const inAlert = alertDistance <= this.alertness;
      this.dom.bossArrow.hidden = !inAlert;
      if (inAlert) {
        const angle = Math.atan2(dx, -dz);
        const needle = this.dom.bossArrow.querySelector('.boss-arrow-needle');
        if (needle) needle.style.transform = 'rotate(' + angle + 'rad)';
      }
      this.dom.bossAlert.hidden = !(b.alertTimer > 0);
      if (this.dom.mapBoss) this.dom.mapBoss.textContent = b.state === 'chase' ? '追猎中' : '漫游';
    }

    setCameraFocus(target) {
      if (this.mode !== 'test') return;
      this.cameraFocus = target === 'boss' ? 'boss' : 'player';
      this.renderer.focusBoss = this.cameraFocus === 'boss';
      this.updateViewButtons();
    }

    toggleCameraFocus() {
      if (this.mode !== 'test' || this.state !== 'playing') return;
      this.setCameraFocus(this.cameraFocus === 'boss' ? 'player' : 'boss');
    }

    updateViewButtons() {
      if (!this.dom || !this.dom.viewPlayer) return;
      this.dom.viewPlayer.classList.toggle('active', this.cameraFocus !== 'boss');
      this.dom.viewBoss.classList.toggle('active', this.cameraFocus === 'boss');
    }

    bossCollidesPlayer() {
      if (!this.boss || !this.player) return false;
      const dx = this.boss.x - this.player.x;
      const dz = this.boss.z - this.player.z;
      const rx = this.colliderRx * 2;
      const rz = this.colliderRz * 2;
      return (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz) <= 1;
    }

    hasWhaleCard() {
      return this.profile.hotbar.includes('whale') && (this.profile.items.whale || 0) > 0;
    }

    triggerWhalePrompt() {
      if (this.state !== 'playing' || !this.hasWhaleCard()) return;
      this.state = 'whale';
      this.keys = Object.create(null);
      this.player.moving = false;
      if (this.boss) this.boss.moving = false;
      this.dom.whaleCount.textContent = '剩余 ' + (this.profile.items.whale || 0) + ' 张';
      this.dom.whalePrompt.classList.add('open');
      this.dom.whalePrompt.setAttribute('aria-hidden', 'false');
      document.body.dataset.state = 'whale';
      setTimeout(() => this.dom.whaleUse.focus({ preventScroll: true }), 120);
    }

    useWhaleCard() {
      if (this.state !== 'whale' || !this.hasWhaleCard()) return;
      this.profile.items.whale--;
      this.saveProfile();
      this.dom.whalePrompt.classList.remove('open');
      this.dom.whalePrompt.setAttribute('aria-hidden', 'true');
      this.state = 'playing';
      document.body.dataset.state = 'playing';
      this.stamina = this.staminaMax;
      this.sprintLocked = false;
      this.player.sprinting = false;
      if (this.boss) {
        this.boss.boundTimer = 10;
        this.boss.stunTimer = 0;
        this.boss.trapPullTimer = 0;
        this.boss.state = 'chase';
        this.boss.alerted = true;
        this.boss.moving = false;
        this.boss.chaseTurnTimer = 0;
        this.boss.chaseDirX = 0;
        this.boss.chaseDirZ = 0;
      }
      this.updateHotbar();
      this.buildBackpackUI();
      this.updateBossHud();
      this.showToast('免死鲸牌 · 已复活，小难梁被禁锢 10 秒', 'moon', 4200);
    }

    declineWhaleCard() {
      if (this.state !== 'whale') return;
      this.dom.whalePrompt.classList.remove('open');
      this.dom.whalePrompt.setAttribute('aria-hidden', 'true');
      this.state = 'playing';
      this.loseGame();
    }

    loseGame() {
      if (this.state !== 'playing') return;
      this.state = 'defeat';
      this.won = false;
      this.player.moving = false;
      this.player.sprinting = false;
      this.sprinting = false;
      this.dom.bossAlert.hidden = true;
      this.dom.bossArrow.hidden = true;
      this.dom.skillHud.hidden = true;
      this.dom.whalePrompt.classList.remove('open');
      this.dom.whalePrompt.setAttribute('aria-hidden', 'true');
      this.dom.defeatTime.textContent = formatTime(this.elapsed);
      this.dom.defeatPct.textContent = Math.round(this.exploredPct) + '%';
      this.dom.defeatSeed.textContent = String(this.seed);
      this.dom.defeatScreen.classList.add('open');
      this.dom.defeatScreen.setAttribute('aria-hidden', 'false');
      document.body.dataset.state = 'defeat';
      this.audio.exhausted();
      setTimeout(() => this.dom.defeatRetry.focus({ preventScroll: true }), 400);
    }

    discoverExit() {
      if (this.exitFound) return;
      this.exitFound = true;
      this.dom.objective.textContent = '月之门已标记——打开地图查看方位';
      this.dom.mapFound.textContent = '已发现';
      this.dom.mapFound.classList.add('found');
      this.dom.mapBtn.classList.add('found');
      this.updateMapButtonState();
      this.showToast('发现月之门 · 地图上已留下它的光', 'moon', 5000);
      this.audio.discover();
      document.body.classList.add('exit-found');
      setTimeout(() => document.body.classList.remove('exit-found'), 2000);
    }

    updateMapButtonState() {
      if (this.dom.mapBtn) {
        this.dom.mapBtn.dataset.found = this.exitFound ? '1' : '0';
      }
    }

    updateHUD() {
      if (!this.dom) return;
      this.dom.pct.textContent = Math.round(this.exploredPct) + '%';
      this.dom.timer.textContent = formatTime(this.elapsed);
    }

    updateStaminaHUD() {
      if (!this.dom || !this.dom.staminaCard) return;
      const max = this.staminaMax || STAMINA_MAX;
      const value = Math.max(0, Math.min(max, this.stamina));
      const rounded = Math.ceil(value);
      const threshold = this.staminaSprintMin || max * 0.2;
      this.dom.staminaFill.style.width = (value / max * 100) + '%';
      this.dom.staminaValue.textContent = String(rounded);
      this.dom.staminaCard.classList.toggle('low', value <= threshold);
      this.dom.staminaCard.classList.toggle('sprinting', this.sprinting);
      this.dom.staminaCard.classList.toggle('locked', this.sprintLocked);
      this.dom.staminaCard.setAttribute('aria-valuemax', String(Math.round(max)));
      this.dom.staminaCard.setAttribute('aria-valuenow', String(rounded));
      let state = '冲刺就绪';
      if (this.sprinting) state = '冲刺中';
      else if (this.sprintLocked) state = '力竭 · 松开冲刺键';
      else if (value <= threshold) state = '体力不足 · 需超过 ' + Math.ceil(threshold);
      else if (value < max) state = this.player && this.player.moving ? '步行恢复' : '静止恢复';
      this.dom.staminaState.textContent = state;
    }

    frame(t) {
      const raw = this.lastFrame ? (t - this.lastFrame) / 1000 : 0.016;
      this.lastFrame = t;
      const dt = clamp(raw, 0, 0.05);

      if (this.state === 'playing') {
        this.time += dt;
        this.update(dt);
        this.drawMapTimeIfNeeded(dt);
      } else if (this.state === 'victory') {
        this.time += dt;
        this.mapTime += dt;
      } else if (this.state === 'map') {
        this.mapTime += dt;
        this.drawMap(dt);
      }

      if (this.state !== 'map' && this.state !== 'paused') {
        if (this.state !== 'title' || this.maze) {
          this.renderer.render(this, dt);
        }
      }

      if (this.state === 'playing') this.dom.timer.textContent = formatTime(this.elapsed);
      requestAnimationFrame((time) => this.frame(time));
    }

    drawMapTimeIfNeeded(dt) {
      if (this.mapOpen) this.drawMap(dt);
    }

    updateTimedEffects(dt) {
      if (this.slowFields.length) {
        for (const field of this.slowFields) field.time -= dt;
        this.slowFields = this.slowFields.filter((field) => field.time > 0);
      }
      this.updateWallBreaks(dt);
    }

    update(dt) {
      if (this.mapOpen) return;
      if (this.parryFreeze > 0) {
        this.parryFreeze = Math.max(0, this.parryFreeze - dt);
        this.parryFlash = this.parryFreeze > 0 ? this.parryFreeze / 0.55 : 0;
        this.renderer.cinematicZoom = 1 + 0.75 * (this.parryFreeze / 0.55);
        if (this.parryFreeze <= 0) this.finishParry();
        this.updateSkillHUD();
        return;
      }
      const p = this.player;
      this.elapsed += dt;
      this.updateTimedEffects(dt);
      this.updateSkillState(dt);
      if (this.noDrainTimer > 0) this.noDrainTimer = Math.max(0, this.noDrainTimer - dt);
      if (this.speedPotionTimer > 0) {
        this.speedPotionTimer = Math.max(0, this.speedPotionTimer - dt);
        if (this.speedPotionTimer <= 0) this.speedPotionFade = 1;
      } else if (this.speedPotionFade > 0) {
        this.speedPotionFade = Math.max(0, this.speedPotionFade - dt);
      }
      const potionSpeedMultiplier = 1 + 0.2 * (this.speedPotionTimer > 0 ? 1 : this.speedPotionFade);
      this.revealTimer -= dt;
      if (this.revealTimer <= 0) {
        this.revealTimer = 0.11;
        this.revealAroundPlayer();
      }

      const left = this.keys.left || this.keys['virtual-left'];
      const right = this.keys.right || this.keys['virtual-right'];
      const forward = this.keys.forward || this.keys['virtual-forward'];
      const back = this.keys.back || this.keys['virtual-back'];

      let inputX = (right ? 1 : 0) - (left ? 1 : 0);
      let inputZ = (back ? 1 : 0) - (forward ? 1 : 0);
      if (this.blocking) {
        inputX = 0;
        inputZ = 0;
        p.moving = false;
      }
      const inputLength = Math.hypot(inputX, inputZ);
      if (inputLength > 0) {
        inputX /= inputLength;
        inputZ /= inputLength;
      }
      const sprintKey = this.keys.sprint || this.keys['virtual-sprint'];
      if (!sprintKey) this.sprintLocked = false;
      const wantsSprint = !!sprintKey && inputLength > 0;
      const canStartSprint = this.stamina > (this.staminaSprintMin || 20);
      const sprintIntent = wantsSprint && !this.sprintLocked &&
        (this.sprinting ? this.stamina > 0 : canStartSprint);
      const wasSprinting = this.sprinting;
      this.turnInput = inputX;
      this.forwardInput = inputZ;
      const baseMoveSpeed = sprintIntent ? this.sprintSpeed : this.moveSpeed;
      const moveSpeed = baseMoveSpeed * potionSpeedMultiplier;
      const targetVX = inputX * moveSpeed;
      const targetVZ = inputZ * moveSpeed;
      const accel = inputLength > 0 ? (sprintIntent ? 10 : 13) : 17;
      this.velocityX = damp(this.velocityX, targetVX, accel, dt);
      this.velocityZ = damp(this.velocityZ, targetVZ, accel, dt);
      if (Math.abs(this.velocityX) < 0.02) this.velocityX = 0;
      if (Math.abs(this.velocityZ) < 0.02) this.velocityZ = 0;

      let moved = false;
      const dx = this.velocityX * dt;
      const dz = this.velocityZ * dt;
      if (Math.abs(dx) > 0.0001 || Math.abs(dz) > 0.0001) {
        const beforeX = p.x;
        const beforeZ = p.z;
        const res = this.tryMove(p.x, p.z, dx, dz);
        if (res.x !== p.x || res.z !== p.z) {
          const actualDx = res.x - p.x;
          const actualDz = res.z - p.z;
          const dist = Math.hypot(actualDx, actualDz);
          p.x = res.x;
          p.z = res.z;
          p.walkDistance += dist;
          p.walkPhase = (p.walkPhase + dt * (sprintIntent ? SPRINT_CYCLE : WALK_CYCLE)) % 1;
          p.walkFrame = Math.floor(p.walkPhase * 10) % 10;
          // The source art faces left by default; mirror when moving right.
          if (Math.abs(actualDx) > 0.001) p.facingX = actualDx < 0 ? 1 : -1;
          const moveAngle = Math.atan2(actualDz, actualDx);
          let sector = Math.round(moveAngle / (Math.PI / 4));
          sector = ((sector % 8) + 8) % 8;
          const direction = DIRECTION_SECTORS[sector];
          p.facingDir = direction.key;
          p.facingMirror = direction.mirror;
          if (direction.key !== 'front' && direction.key !== 'back' &&
              !ART_FACING[direction.key]) {
            p.facingMirror = !p.facingMirror;
          }
          // Grok's diagonal source art is left-facing (aw/as), opposite to
          // the lamp character's diagonal sheets.
          if (this.profile.character === 'grok' &&
              (direction.key === 'diagFront' || direction.key === 'diagBack')) {
            p.facingMirror = !p.facingMirror;
          }
          p.yaw = Math.atan2(actualDx, -actualDz);
          this.stepDistanceAcc += dist;
          if (this.stepDistanceAcc > 1.15) {
            this.stepDistanceAcc = 0;
            const speed = Math.hypot(this.velocityX, this.velocityZ);
            this.audio.step(Math.min(1, speed / Math.max(0.1, this.moveSpeed)));
          }
          moved = true;
        }
        if (res.x === beforeX && Math.abs(dx) > 0.0001) this.velocityX = 0;
        if (res.z === beforeZ && Math.abs(dz) > 0.0001) this.velocityZ = 0;
      }

      this.moveVelocity = Math.hypot(this.velocityX, this.velocityZ);
      p.speed = this.moveVelocity;
      p.moving = moved;

      if (moved && sprintIntent) {
        if (this.noDrainTimer > 0) {
          this.sprinting = true;
          p.sprinting = true;
          if (!wasSprinting) this.audio.dash();
        } else {
          this.stamina = Math.max(0, this.stamina - this.staminaDrain * dt);
          if (this.stamina <= 0) {
            this.stamina = 0;
            this.sprintLocked = true;
            this.sprinting = false;
            p.sprinting = false;
            this.audio.exhausted();
            this.showToast('体力耗尽 · 松开冲刺键，等体力恢复到 ' + Math.ceil(this.staminaSprintMin) + ' 以上', 'info', 3600);
          } else {
            this.sprinting = true;
            p.sprinting = true;
            if (!wasSprinting) this.audio.dash();
          }
        }
      } else {
        this.sprinting = false;
        p.sprinting = false;
        if (moved) {
          this.stamina = Math.min(this.staminaMax, this.stamina + STAMINA_REGEN_WALK * dt);
        } else {
          this.stamina = Math.min(this.staminaMax, this.stamina + STAMINA_REGEN_IDLE * dt);
        }
      }

      if (!moved) {
        p.walkFrame = 0;
        p.walkPhase = 0;
      }

      this.updateStaminaHUD();
      this.updateCompassHUD();
      this.updateBuffHUD();

      if (this.mode === 'chase' || this.mode === 'test') {
        this.updateBoss(dt);
        if (this.state !== 'playing') return;
      }

      const ex = this.maze.exit;
      if (!this.won && Math.hypot(p.x - ex.x, p.z - ex.z) < 1.35) {
        this.win();
      }

      if (this.elapsed > 1) this.updateHUD();
    }

    tryMove(x, z, dx, dz) {
      let nx = x + dx;
      let nz = z;
      if (!this.collides(nx, nz)) {
        x = nx;
      }
      nz = z + dz;
      if (!this.collides(x, nz)) {
        z = nz;
      }
      return { x, z };
    }

    collides(x, z) {
      const r = PLAYER_RADIUS;
      const T = this.maze.tileSize;
      const minX = Math.floor((x - r) / T);
      const maxX = Math.floor((x + r) / T);
      const minY = Math.floor((z - r) / T);
      const maxY = Math.floor((z + r) / T);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (!this.maze.isWallTile(tx, ty)) continue;
          const cx = clamp(x, tx * T, (tx + 1) * T);
          const cz = clamp(z, ty * T, (ty + 1) * T);
          const ddx = x - cx;
          const ddz = z - cz;
          if (ddx * ddx + ddz * ddz < r * r) return true;
        }
      }
      return false;
    }

    openMap() {
      if (this.state !== 'playing' || this.mapOpen) return;
      if (!this.maze) return;
      this.mapOpen = true;
      this.state = 'map';
      this.keys = Object.create(null);
      this.player.moving = false;
      this.revealAroundPlayer();
      this.mapJustOpened = true;
      if (this.mapZoom > 1) this.centerMapOnPlayer();
      else this.mapCenter = { x: this.maze.width / 2, y: this.maze.height / 2 };
      this.mapLayerDirty = true;
      this.updateMapZoomLabel();
      this.dom.mapScreen.classList.add('open');
      this.dom.mapScreen.setAttribute('aria-hidden', 'false');
      this.dom.mapScreen.scrollTop = 0;
      this.dom.mapPct.textContent = Math.round(this.exploredPct) + '%';
      this.dom.mapFound.textContent = this.exitFound ? '已发现' : '尚未发现';
      this.dom.mapFound.classList.toggle('found', this.exitFound);
      if (this.dom.mapPerception) this.dom.mapPerception.textContent = `${this.perception} 格`;
      if (this.dom.mapAlertness) {
        this.dom.mapAlertness.textContent = (this.mode === 'chase' || this.mode === 'test') ? `${this.alertness} 格` : '—';
      }
      if (this.dom.mapBoss) {
        this.dom.mapBoss.textContent = (this.mode === 'chase' || this.mode === 'test') && this.boss
          ? (this.boss.state === 'chase' ? '追猎中' : '漫游')
          : '无';
      }
      this.dom.mapSeed.textContent = 'SEED ' + this.seed;
      document.body.dataset.state = 'map';
      this.audio.mapOpen();
      this.updateMapButtonState();
      requestAnimationFrame(() => {
        this.drawMap(0);
        this.dom.mapCloseX.focus({ preventScroll: true });
      });
    }

    closeMap() {
      if (this.state !== 'map') return;
      this.mapOpen = false;
      this.state = 'playing';
      this.dom.mapScreen.classList.remove('open');
      this.dom.mapScreen.setAttribute('aria-hidden', 'true');
      document.body.dataset.state = 'playing';
      this.dom.mapBtn.focus({ preventScroll: true });
      this.audio.mapClose();
    }

    toggleMap() {
      if (this.state === 'playing') this.openMap();
      else if (this.state === 'map') this.closeMap();
    }

    centerMapOnPlayer() {
      if (!this.maze) return;
      this.mapCenter = {
        x: this.player.x / this.maze.tileSize,
        y: this.player.z / this.maze.tileSize
      };
    }

    updateMapZoomLabel() {
      if (!this.dom.mapZoomLabel) return;
      const label = this.mapZoom % 1 === 0 ? String(this.mapZoom) : this.mapZoom.toFixed(1);
      this.dom.mapZoomLabel.textContent = '×' + label;
    }

    changeMapZoom(direction) {
      if (!this.maze || this.state !== 'map') return;
      const previous = this.mapZoom;
      this.mapZoomIndex = clamp(this.mapZoomIndex + direction, 0, this.mapZoomLevels.length - 1);
      this.mapZoom = this.mapZoomLevels[this.mapZoomIndex];
      if (this.mapZoom === 1) {
        this.mapCenter = { x: this.maze.width / 2, y: this.maze.height / 2 };
      } else if (previous === 1) {
        this.centerMapOnPlayer();
      }
      this.mapLayerDirty = true;
      this.updateMapZoomLabel();
      this.drawMap(0);
    }

    beginMapDrag(e) {
      if (this.state !== 'map' || this.mapZoom <= 1 || e.button !== 0) return;
      e.preventDefault();
      this.mapDrag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        cx: this.mapCenter.x,
        cy: this.mapCenter.y
      };
      this.mapCanvas.classList.add('dragging');
      if (this.mapCanvas.setPointerCapture) {
        try { this.mapCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    }

    moveMapDrag(e) {
      if (!this.mapDrag || e.pointerId !== this.mapDrag.id) return;
      const cell = Math.max(0.001, this.mapViewCell);
      this.mapCenter.x = this.mapDrag.cx - (e.clientX - this.mapDrag.x) / cell;
      this.mapCenter.y = this.mapDrag.cy - (e.clientY - this.mapDrag.y) / cell;
      this.mapLayerDirty = true;
      this.drawMap(0);
    }

    endMapDrag(e) {
      if (!this.mapDrag || (e.pointerId != null && e.pointerId !== this.mapDrag.id)) return;
      this.mapDrag = null;
      this.mapCanvas.classList.remove('dragging');
      if (this.mapCanvas.releasePointerCapture) {
        try { this.mapCanvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    }

    win() {
      if (this.won) return;
      this.won = true;
      this.state = 'victory';
      this.player.moving = false;
      if (this.boss) this.boss.active = false;
      this.dom.bossAlert.hidden = true;
      this.dom.bossArrow.hidden = true;
      this.dom.skillHud.hidden = true;
      this.renderer.cinematicZoom = 1;
      this.dom.victoryTime.textContent = formatTime(this.elapsed);
      this.dom.victoryPct.textContent = Math.round(this.exploredPct) + '%';
      this.dom.victorySeed.textContent = String(this.seed);
      this.dom.victoryScreen.classList.add('open');
      this.dom.victoryScreen.setAttribute('aria-hidden', 'false');
      document.body.dataset.state = 'victory';
      document.body.classList.add('victory-flash');
      setTimeout(() => document.body.classList.remove('victory-flash'), 1600);
      this.audio.victory();
      setTimeout(() => {
        this.dom.againBtn.focus({ preventScroll: true });
      }, 500);
    }

    toggleAudio() {
      this.audio.muted = !this.audio.muted;
      try {
        localStorage.setItem('azure-muted', this.audio.muted ? '1' : '0');
      } catch (err) { /* file:// or privacy modes may block storage */ }
      this.audio.setMuted(this.audio.muted);
      this.dom.audioBtn.classList.toggle('is-muted', this.audio.muted);
      this.dom.audioBtn.setAttribute('aria-label', this.audio.muted ? '打开声音' : '静音');
      this.dom.audioBtn.title = this.audio.muted ? '打开声音' : '静音';
    }

    showToast(text, type, duration) {
      const el = this.dom.toast;
      el.innerHTML = '<span class="toast-glyph"></span><span>' + text + '</span>';
      el.dataset.type = type || 'info';
      el.classList.add('show');
      clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => el.classList.remove('show'), duration || 3600);
    }

    // ---------------------------------------------------------
    // Top-down map
    // ---------------------------------------------------------
    syncMapCanvas() {
      const rect = this.mapCanvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, w * h > 3000000 ? 1 : (w * h > 900000 ? 1.25 : 1.5));
      if (this.mapSize.w !== w || this.mapSize.h !== h || this.mapSize.dpr !== dpr) {
        this.mapSize = { w, h, dpr };
        this.mapCanvas.width = Math.round(w * dpr);
        this.mapCanvas.height = Math.round(h * dpr);
        this.mapLayerDirty = true;
      }
      this.mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h, dpr, ctx: this.mapCtx };
    }

    ensureMapLayer(w, h, dpr) {
      if (!this.mapLayer) {
        this.mapLayer = document.createElement('canvas');
        this.mapLayerCtx = this.mapLayer.getContext('2d');
      }
      if (this.mapLayerSize.w !== w || this.mapLayerSize.h !== h || this.mapLayerSize.dpr !== dpr) {
        this.mapLayerSize = { w, h, dpr };
        this.mapLayer.width = Math.round(w * dpr);
        this.mapLayer.height = Math.round(h * dpr);
        this.mapLayerDirty = true;
      }
      this.mapLayerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    getMapWarmSprite() {
      if (this.mapWarmSprite) return this.mapWarmSprite;
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext('2d');
      const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,224,170,1)');
      g.addColorStop(0.35, 'rgba(255,196,120,0.62)');
      g.addColorStop(0.7, 'rgba(222,126,48,0.18)');
      g.addColorStop(1, 'rgba(150,70,10,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, size, size);
      this.mapWarmSprite = canvas;
      return canvas;
    }

    drawMapBaseLayer(ctx, maze, cell, ox, oy, w, h) {
      // Revealed floor and walls
      for (let ty = 0; ty < maze.height; ty++) {
        for (let tx = 0; tx < maze.width; tx++) {
          const idx = maze.index(tx, ty);
          if (!this.revealed[idx]) continue;
          const x = ox + tx * cell;
          const y = oy + ty * cell;
          if (maze.isWallTile(tx, ty)) {
            ctx.fillStyle = 'rgba(3,9,16,0.96)';
            ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
          } else {
            const noise = maze.noise(tx, ty, 77);
            const lightValue = this.lightField ? this.lightField[idx] : 0;
            const tileMaxLight = this.mode === 'test' ? 5 : Math.max(1, this.lightLevel);
            const litRatio = clamp(lightValue / tileMaxLight, 0, 1);
            ctx.fillStyle = 'rgba(' +
              Math.round(32 + litRatio * 22) + ',' +
              Math.round(76 + litRatio * 30) + ',' +
              Math.round(102 + litRatio * 18) + ',' +
              (0.58 + noise * 0.14 + litRatio * 0.12) + ')';
            ctx.fillRect(x + 0.35, y + 0.35, cell - 0.7, cell - 0.7);
            if (cell > 12) {
              ctx.fillStyle = 'rgba(125,199,229,' + (0.05 + noise * 0.09 + litRatio * 0.12) + ')';
              ctx.fillRect(x + cell * 0.5 - 0.6, y + cell * 0.5 - 0.6, 1.2, 1.2);
            }
          }
        }
      }

      // Corridor-edge linework makes the plan legible and a little arcane.
      ctx.save();
      ctx.beginPath();
      for (let ty = 0; ty < maze.height; ty++) {
        for (let tx = 0; tx < maze.width; tx++) {
          if (!this.revealed[maze.index(tx, ty)] || maze.isWallTile(tx, ty)) continue;
          const x = ox + tx * cell;
          const y = oy + ty * cell;
          if (!maze.isFloorTile(tx, ty - 1)) {
            ctx.moveTo(x, y); ctx.lineTo(x + cell, y);
          }
          if (!maze.isFloorTile(tx, ty + 1)) {
            ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y + cell);
          }
          if (!maze.isFloorTile(tx - 1, ty)) {
            ctx.moveTo(x, y); ctx.lineTo(x, y + cell);
          }
          if (!maze.isFloorTile(tx + 1, ty)) {
            ctx.moveTo(x + cell, y); ctx.lineTo(x + cell, y + cell);
          }
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(90,198,242,0.16)';
      ctx.lineWidth = Math.max(2.2, cell * 0.15);
      ctx.shadowColor = 'rgba(79,190,255,0.5)';
      ctx.shadowBlur = Math.min(12, cell * 0.6);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(161,234,255,0.82)';
      ctx.lineWidth = Math.max(0.85, cell * 0.065);
      ctx.stroke();
      ctx.restore();

      // Soft warm light, weighted by the current light value of each tile.
      // A cached glow sprite keeps every tile individually lit without
      // creating thousands of gradients.
      if (this.lightField) {
        const maxLight = this.mode === 'test' ? 5 : Math.max(1, this.lightLevel);
        const sprite = this.getMapWarmSprite();
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let ty = 0; ty < maze.height; ty++) {
          for (let tx = 0; tx < maze.width; tx++) {
            const value = this.lightField[maze.index(tx, ty)];
            if (value <= 0) continue;
            const x = ox + (tx + 0.5) * cell;
            const y = oy + (ty + 0.5) * cell;
            const ratio = clamp(value / maxLight, 0, 1);
            const radius = cell * (1.7 + ratio * 0.9);
            const alpha = 0.075 + ratio * 0.22;
            ctx.globalAlpha = alpha;
            ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
          }
        }
        ctx.restore();
      }

    }

    drawMap() {
      if (!this.maze) return;
      const { w, h, dpr, ctx } = this.syncMapCanvas();
      const maze = this.maze;
      const pad = Math.max(22, Math.min(w, h) * 0.055);
      const baseCell = Math.min((w - pad * 2) / maze.width, (h - pad * 2) / maze.height);
      const cell = baseCell * this.mapZoom;
      const mapW = cell * maze.width;
      const mapH = cell * maze.height;
      let ox;
      let oy;

      if (this.mapZoom <= 1.001) {
        this.mapCenter = { x: maze.width / 2, y: maze.height / 2 };
        ox = (w - mapW) / 2;
        oy = (h - mapH) / 2;
      } else {
        const halfViewX = w / (2 * cell);
        const halfViewY = h / (2 * cell);
        if (mapW > w) {
          this.mapCenter.x = clamp(this.mapCenter.x, halfViewX, maze.width - halfViewX);
        } else {
          this.mapCenter.x = maze.width / 2;
        }
        if (mapH > h) {
          this.mapCenter.y = clamp(this.mapCenter.y, halfViewY, maze.height - halfViewY);
        } else {
          this.mapCenter.y = maze.height / 2;
        }
        ox = w / 2 - this.mapCenter.x * cell;
        oy = h / 2 - this.mapCenter.y * cell;
      }
      this.mapViewCell = cell;
      const px = ox + (this.player.x / maze.tileSize) * cell;
      const py = oy + (this.player.z / maze.tileSize) * cell;
      const time = this.mapTime;

      ctx.clearRect(0, 0, w, h);

      // Deep chart background
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, Math.max(w, h) * 0.7);
      bg.addColorStop(0, '#0a1a2b');
      bg.addColorStop(0.6, '#050e19');
      bg.addColorStop(1, '#010307');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // faint chart grid
      ctx.save();
      ctx.strokeStyle = 'rgba(90,147,194,0.045)';
      ctx.lineWidth = 1;
      const gridStep = cell * 2;
      for (let x = ox % gridStep; x < w; x += gridStep) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = oy % gridStep; y < h; y += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.restore();

      // frame corners
      const corner = Math.min(28, Math.max(15, cell * 1.4));
      ctx.strokeStyle = 'rgba(117,185,229,0.22)';
      ctx.lineWidth = 1.2;
      const fx0 = ox - pad * 0.35;
      const fy0 = oy - pad * 0.35;
      const fx1 = ox + mapW + pad * 0.35;
      const fy1 = oy + mapH + pad * 0.35;
      [[fx0, fy0, 1, 1], [fx1, fy0, -1, 1], [fx0, fy1, 1, -1], [fx1, fy1, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * corner, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * corner);
        ctx.stroke();
      });

      // Compass
      const compassX = 38;
      const compassY = 42;
      ctx.save();
      ctx.translate(compassX, compassY);
      ctx.strokeStyle = 'rgba(151,211,242,0.42)';
      ctx.fillStyle = 'rgba(151,211,242,0.68)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(3.5, 3); ctx.lineTo(0, 0.5); ctx.lineTo(-3.5, 3);
      ctx.closePath(); ctx.fill();
      ctx.font = '9px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('N', 0, -17);
      ctx.restore();

      this.ensureMapLayer(w, h, dpr);
      if (this.mapLayerDirty) {
        this.mapLayerCtx.clearRect(0, 0, w, h);
        this.drawMapBaseLayer(this.mapLayerCtx, maze, cell, ox, oy, w, h);
        this.mapLayerDirty = false;
      }
      ctx.drawImage(this.mapLayer, 0, 0, w, h);

      if (this.slowFields && this.slowFields.length) {
        ctx.save();
        ctx.fillStyle = 'rgba(68, 235, 135, 0.16)';
        ctx.strokeStyle = 'rgba(100, 255, 164, 0.72)';
        ctx.lineWidth = 1.2;
        for (const field of this.slowFields) {
          const x = ox + field.tx * cell;
          const y = oy + field.ty * cell;
          const level = field.level || 1;
          ctx.fillStyle = level >= 2 ? 'rgba(68, 255, 145, 0.25)' : 'rgba(68, 235, 135, 0.16)';
          ctx.strokeStyle = level >= 2 ? 'rgba(132, 255, 184, 0.95)' : 'rgba(100, 255, 164, 0.72)';
          ctx.lineWidth = level >= 2 ? 1.8 : 1.2;
          ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
          ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        }
        ctx.restore();
      }
      if (this.traps && this.traps.length) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 150, 92, 0.9)';
        ctx.fillStyle = 'rgba(255, 92, 55, 0.18)';
        ctx.lineWidth = 1.1;
        for (const trap of this.traps) {
          const x = ox + (trap.tx + 0.5) * cell;
          const y = oy + (trap.ty + 0.5) * cell;
          const s = Math.max(2.5, cell * 0.25);
          ctx.beginPath();
          ctx.moveTo(x, y - s);
          ctx.lineTo(x + s, y);
          ctx.lineTo(x, y + s);
          ctx.lineTo(x - s, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Perception range: Manhattan-distance diamond.
      const perceptionR = this.perception * cell;
      if (perceptionR > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(240,201,137,0.25)';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([cell * 0.32, cell * 0.26]);
        ctx.beginPath();
        ctx.moveTo(px, py - perceptionR);
        ctx.lineTo(px + perceptionR, py);
        ctx.lineTo(px, py + perceptionR);
        ctx.lineTo(px - perceptionR, py);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Chase mode: alertness range and a revealed boss position.
      if ((this.mode === 'chase' || this.mode === 'test') && this.boss && this.boss.active) {
        const alertR = this.alertness * cell;
        ctx.save();
        ctx.strokeStyle = 'rgba(230,75,78,0.3)';
        ctx.lineWidth = 1.15;
        ctx.setLineDash([cell * 0.3, cell * 0.22]);
        ctx.beginPath();
        ctx.moveTo(px, py - alertR);
        ctx.lineTo(px + alertR, py);
        ctx.lineTo(px, py + alertR);
        ctx.lineTo(px - alertR, py);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        if (this.mode === 'test' && this.boss.trail && this.boss.trail.length > 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,151,80,0.48)';
          ctx.lineWidth = Math.max(1, cell * 0.12);
          ctx.beginPath();
          const first = this.boss.trail[0];
          ctx.moveTo(ox + (first.x / maze.tileSize) * cell, oy + (first.z / maze.tileSize) * cell);
          for (let i = 1; i < this.boss.trail.length; i++) {
            const pt = this.boss.trail[i];
            ctx.lineTo(ox + (pt.x / maze.tileSize) * cell, oy + (pt.z / maze.tileSize) * cell);
          }
          ctx.stroke();
          ctx.restore();
        }

        const btx = Math.max(0, Math.min(maze.width - 1, Math.floor(this.boss.x / maze.tileSize)));
        const bty = Math.max(0, Math.min(maze.height - 1, Math.floor(this.boss.z / maze.tileSize)));
        const bossDistance = Math.abs(btx - Math.floor(this.player.x / maze.tileSize)) +
          Math.abs(bty - Math.floor(this.player.z / maze.tileSize));
        const bossRevealed = this.revealed[maze.index(btx, bty)];
        if (this.mode === 'test' || this.profile.xray || (bossDistance <= this.alertness && bossRevealed)) {
          const bx = ox + (this.boss.x / maze.tileSize) * cell;
          const by = oy + (this.boss.z / maze.tileSize) * cell;
          const pulse = 0.7 + 0.3 * Math.sin(time * 4.2);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const glow = ctx.createRadialGradient(bx, by, 0, bx, by, cell * 1.8);
          glow.addColorStop(0, 'rgba(255,102,91,' + (0.36 * pulse) + ')');
          glow.addColorStop(0.5, 'rgba(158,28,36,0.16)');
          glow.addColorStop(1, 'rgba(80,0,8,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(bx, by, cell * 1.8, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,150,142,' + (0.55 + pulse * 0.3) + ')';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(bx, by, cell * 0.72, 0, TAU);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(bx - cell * 0.29, by - cell * 0.29);
          ctx.lineTo(bx + cell * 0.29, by + cell * 0.29);
          ctx.moveTo(bx + cell * 0.29, by - cell * 0.29);
          ctx.lineTo(bx - cell * 0.29, by + cell * 0.29);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Spawn marker
      const sx = ox + (maze.spawn.x / maze.tileSize) * cell;
      const sy = oy + (maze.spawn.z / maze.tileSize) * cell;
      ctx.strokeStyle = 'rgba(194,225,249,0.45)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2.5, cell * 0.2), 0, TAU);
      ctx.stroke();

      // Exit marker, only after discovery
      if (this.exitFound && maze.exit) {
        const ex = ox + (maze.exit.x / maze.tileSize) * cell;
        const ey = oy + (maze.exit.z / maze.tileSize) * cell;
        const pulse = 0.7 + 0.3 * Math.sin(time * 2.6);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, cell * 2.6);
        eg.addColorStop(0, 'rgba(169,247,255,' + (0.35 * pulse) + ')');
        eg.addColorStop(0.4, 'rgba(67,181,255,0.16)');
        eg.addColorStop(1, 'rgba(30,90,210,0)');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(ex, ey, cell * 2.6, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(197,248,255,' + (0.45 + pulse * 0.35) + ')';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(ex, ey, cell * (0.55 + pulse * 0.12), 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex - cell * 0.28, ey);
        ctx.quadraticCurveTo(ex, ey - cell * 0.5, ex + cell * 0.28, ey);
        ctx.quadraticCurveTo(ex, ey - cell * 0.1, ex - cell * 0.28, ey);
        ctx.fillStyle = 'rgba(201,247,255,0.95)';
        ctx.fill();
        ctx.restore();
      }

      // Player arrow
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(this.player.yaw);
      ctx.shadowColor = 'rgba(136,222,255,0.9)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#e6fbff';
      const s = Math.max(5, cell * 0.34);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.68, s * 0.72);
      ctx.lineTo(0, s * 0.36);
      ctx.lineTo(-s * 0.68, s * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // current position ping
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(139,224,255,' + (0.4 + Math.sin(time * 3) * 0.12) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(6, cell * 0.7), 0, TAU);
      ctx.stroke();
      ctx.restore();

      // Fog vignette around chart
      const fog = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
      fog.addColorStop(0, 'rgba(0,2,7,0)');
      fog.addColorStop(0.72, 'rgba(0,2,7,0.22)');
      fog.addColorStop(1, 'rgba(0,1,4,0.82)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, w, h);

      this.dom.mapPct.textContent = Math.round(this.exploredPct) + '%';
      this.dom.mapFound.textContent = this.exitFound ? '已发现' : '尚未发现';
      this.dom.mapFound.classList.toggle('found', this.exitFound);
      if (this.dom.mapPerception) this.dom.mapPerception.textContent = `${this.perception} 格`;
      if (this.dom.mapAlertness) {
        this.dom.mapAlertness.textContent = (this.mode === 'chase' || this.mode === 'test') ? `${this.alertness} 格` : '—';
      }
      if (this.dom.mapBoss) {
        this.dom.mapBoss.textContent = (this.mode === 'chase' || this.mode === 'test') && this.boss
          ? (this.boss.state === 'chase' ? '追猎中' : '漫游')
          : '无';
      }
      const bar = this.dom.mapScreen.querySelector('.map-stat-line i');
      if (bar) bar.style.width = Math.max(2, Math.min(100, this.exploredPct)) + '%';
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.__AZURE__ = new AzureGame();
  });
})();

