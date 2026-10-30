/* =========================================================
   Azure Labyrinth — custom 2.5D renderer
   No external libraries. Perspective-projected quads on 2D canvas.
   ========================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const NEAR = 0.28;
  const WALL_H = 2.125;
  const WALL_TOP = WALL_H;
  const FOV = 53 * Math.PI / 180;
  const CAM_BACK = 5.8;
  const CAM_HEIGHT = 8.0;
  const CAM_LOOK_AHEAD = 1.2;
  const CAM_TARGET_Y = 1.0;
  const RENDER_REACH_TILES = 32;
const CULL_MARGIN = 96;
  const BG = [3, 7, 13];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgba(r, g, b, a) {
    return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + (a == null ? 1 : a) + ')';
  }
  function mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  class AzureRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.W = 1;
      this.H = 1;
      this.dpr = 1;
      this.maze = null;
      this.sprite = null;
      this.spriteFrames = 10;
      this.spriteCellW = 300;
      this.spriteCellH = 352;
      this.dashSprite = null;
      this.dashFrames = 9;
      this.dashCellW = 360;
      this.dashCellH = 352;
      this.directionSprites = Object.create(null);
      this.directionSheets = Object.create(null);
      this.bossSprites = Object.create(null);
      this.focusBoss = false;
      this.overlayCanvas = null;
      this.overlayCtx = null;
      this.overlayDirty = true;
      this.overlaySize = { w: 0, h: 0, dpr: 0 };
      this.playerWorldHeight = 1.82;
      this.time = 0;
      this.camYaw = 0;
      this.camPos = { x: 0, y: 5, z: 0 };
      this.camTarget = { x: 0, y: 1, z: 0 };
      this.camForward = { x: 0, y: 0, z: -1 };
      this.camRight = { x: 1, y: 0, z: 0 };
      this.camUp = { x: 0, y: 1, z: 0 };
      this.focal = 900;
      this.playerScreen = { x: 0, y: 0 };
      this.motes = [];
      this.dust = [];
      this.stars = [];
      this.lastWalkDistance = 0;
      this.stepAccumulator = 0;
      this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
      this.initParticles();
    }

    setMaze(maze) {
      this.maze = maze;
      this.motes = [];
      this.dust = [];
      this.initParticles();
    }

    setSprite(image) {
      this.sprite = image;
      const width = image && (image.naturalWidth || image.width);
      if (width) {
        this.spriteFrames = Math.max(1, Math.round(width / this.spriteCellW));
      }
    }

    setDashSprite(image) {
      this.dashSprite = image;
      const width = image && (image.naturalWidth || image.width);
      if (width) {
        this.dashFrames = Math.max(1, Math.round(width / this.dashCellW));
      }
    }

    setDirectionSprite(key, image) {
      if (image && (image.naturalWidth || image.width)) {
        this.directionSprites[key] = image;
      }
    }

    setDirectionSheet(key, image, frames = 8) {
      const width = image && (image.naturalWidth || image.width);
      const height = image && (image.naturalHeight || image.height);
      if (!width || !height || frames < 1) return;
      this.directionSheets[key] = {
        image,
        frameW: width / frames,
        frameH: height,
        frames
      };
    }

    setBossSprite(key, image) {
      if (image && (image.naturalWidth || image.width)) {
        this.bossSprites[key] = image;
      }
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.W = Math.max(1, Math.round(rect.width));
      this.H = Math.max(1, Math.round(rect.height));
      // Large canvases are fill-rate limited; capping the backing store a
      // little keeps the fixed 60fps loop smooth without visibly softening
      // the hand-drawn art on desktop.
      const dprCap = this.W * this.H > 3000000 ? 1 : (this.W * this.H > 1100000 ? 1.25 : 1.5);
      this.dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      this.canvas.width = Math.round(this.W * this.dpr);
      this.canvas.height = Math.round(this.H * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.overlayDirty = true;
      this.focal = (this.H * 0.5) / Math.tan(FOV * 0.5);
      this.initStars();
    }

    initStars() {
      this.stars = [];
      const count = Math.floor(this.W * this.H / 26000);
      for (let i = 0; i < count; i++) {
        this.stars.push({
          x: Math.random(),
          y: Math.random() * 0.48,
          r: Math.random() * 1.2 + 0.25,
          a: Math.random() * 0.55 + 0.1,
          p: Math.random() * TAU
        });
      }
    }

    initParticles() {
      if (!this.maze) return;
      this.motes = [];
      for (let i = 0; i < 72; i++) {
        this.motes.push(this.makeMote(true));
      }
    }

    makeMote(initial) {
      const p = this.maze ? this.maze.spawn : { x: 0, z: 0 };
      const a = Math.random() * TAU;
      const r = Math.random() * 15 + (initial ? 0 : 4);
      return {
        x: p.x + Math.cos(a) * r,
        z: p.z + Math.sin(a) * r,
        y: Math.random() * 3.4 + 0.15,
        phase: Math.random() * TAU,
        speed: Math.random() * 0.45 + 0.12,
        size: Math.random() * 1.7 + 0.55,
        warm: Math.random() < 0.22,
        alpha: Math.random() * 0.5 + 0.2
      };
    }

    worldToCam(p) {
      const dx = p.x - this.camPos.x;
      const dy = p.y - this.camPos.y;
      const dz = p.z - this.camPos.z;
      return {
        x: dx * this.camRight.x + dy * this.camRight.y + dz * this.camRight.z,
        y: dx * this.camUp.x + dy * this.camUp.y + dz * this.camUp.z,
        z: dx * this.camForward.x + dy * this.camForward.y + dz * this.camForward.z
      };
    }

    projectCam(c) {
      const scale = this.focal / c.z;
      return {
        x: this.W * 0.5 + c.x * scale,
        y: this.H * 0.5 - c.y * scale
      };
    }

    project(p) {
      const c = this.worldToCam(p);
      if (c.z <= NEAR) return null;
      return this.projectCam(c);
    }

    clipAndProject(points) {
      const camPts = points.map((p) => this.worldToCam(p));
      const out = [];
      for (let i = 0; i < camPts.length; i++) {
        const cur = camPts[i];
        const prev = camPts[(i + camPts.length - 1) % camPts.length];
        const curIn = cur.z >= NEAR;
        const prevIn = prev.z >= NEAR;
        if (curIn && prevIn) {
          out.push(cur);
        } else if (curIn && !prevIn) {
          const t = (NEAR - prev.z) / (cur.z - prev.z);
          out.push({ x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t), z: NEAR });
          out.push(cur);
        } else if (!curIn && prevIn) {
          const t = (NEAR - prev.z) / (cur.z - prev.z);
          out.push({ x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t), z: NEAR });
        }
      }
      if (out.length < 3) return null;
      return out.map((c) => this.projectCam(c));
    }

    focusPoint(game) {
      return this.focusBoss && game.boss && game.boss.active ? game.boss : game.player;
    }

    updateCamera(game, dt) {
      // Fixed Undertale-like viewpoint: north is always up, the camera never
      // turns, and it follows the player at a constant offset. Test mode can
      // temporarily move the same fixed camera to the boss.
      const p = this.focusPoint(game);
      this.camYaw = 0;
      this.camPos.x = p.x;
      this.camPos.y = CAM_HEIGHT;
      this.camPos.z = p.z + CAM_BACK;
      this.camTarget.x = p.x;
      this.camTarget.y = CAM_TARGET_Y;
      this.camTarget.z = p.z - CAM_LOOK_AHEAD;

      const fx = this.camTarget.x - this.camPos.x;
      const fy = this.camTarget.y - this.camPos.y;
      const fz = this.camTarget.z - this.camPos.z;
      const fl = Math.hypot(fx, fy, fz) || 1;
      this.camForward.x = fx / fl;
      this.camForward.y = fy / fl;
      this.camForward.z = fz / fl;

      // right = forward × worldUp
      this.camRight.x = -this.camForward.z;
      this.camRight.y = 0;
      this.camRight.z = this.camForward.x;
      const rl = Math.hypot(this.camRight.x, this.camRight.z) || 1;
      this.camRight.x /= rl;
      this.camRight.z /= rl;

      // up = right × forward
      this.camUp.x = this.camRight.y * this.camForward.z - this.camRight.z * this.camForward.y;
      this.camUp.y = this.camRight.z * this.camForward.x - this.camRight.x * this.camForward.z;
      this.camUp.z = this.camRight.x * this.camForward.y - this.camRight.y * this.camForward.x;
      const ul = Math.hypot(this.camUp.x, this.camUp.y, this.camUp.z) || 1;
      this.camUp.x /= ul;
      this.camUp.y /= ul;
      this.camUp.z /= ul;

      this.cameraDistance = Math.hypot(CAM_BACK, CAM_HEIGHT - CAM_TARGET_Y);
      this.cameraClose = 0;
    }


    lightAt(x, z) {
      const p = (this.focusBoss && this.gameRef.boss && this.gameRef.boss.active)
        ? this.gameRef.boss
        : this.gameRef.player;
      const d = Math.hypot(x - p.x, z - p.z);
      const base = 0.08 + 0.92 * Math.pow(1 - clamp(d / 48, 0, 1), 1.9);
      const flicker = 0.955 + 0.045 * Math.sin(this.time * 8.7) * Math.sin(this.time * 3.13 + 1.2);
      const warm = Math.exp(-d / 10) * 0.95;
      return { light: base * flicker, warm, dist: d };
    }

    drawBackground(game) {
      const ctx = this.ctx;
      const w = this.W, h = this.H;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#071021');
      grad.addColorStop(0.46, '#050b16');
      grad.addColorStop(1, '#02050a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Cold distant haze
      const haze = ctx.createRadialGradient(w * 0.52, h * 0.15, 0, w * 0.52, h * 0.15, Math.max(w, h) * 0.72);
      haze.addColorStop(0, 'rgba(45,86,150,0.18)');
      haze.addColorStop(0.55, 'rgba(12,29,54,0.08)');
      haze.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, w, h);

      if (this.stars.length) {
        ctx.save();
        for (const s of this.stars) {
          const tw = 0.65 + Math.sin(this.time * 0.7 + s.p) * 0.35;
          ctx.globalAlpha = s.a * tw;
          ctx.fillStyle = '#bcdcff';
          ctx.beginPath();
          ctx.arc(s.x * w, s.y * h, s.r, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    drawFloor(game) {
      const ctx = this.ctx;
      const maze = this.maze;
      if (!maze) return;
      const p = this.focusPoint(game);
      const reach = RENDER_REACH_TILES * maze.tileSize;
      const minX = Math.max(0, Math.floor((p.x - reach) / maze.tileSize));
      const maxX = Math.min(maze.width - 1, Math.floor((p.x + reach) / maze.tileSize));
      const minY = Math.max(0, Math.floor((p.z - reach) / maze.tileSize));
      const maxY = Math.min(maze.height - 1, Math.floor((p.z + reach) / maze.tileSize));
      const TS = maze.tileSize;

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (maze.isWallTile(tx, ty)) continue;
          const x0 = tx * TS;
          const z0 = ty * TS;
          const cx = x0 + TS * 0.5;
          const cz = z0 + TS * 0.5;
          const lit = this.lightAt(cx, cz);
          if (lit.light < 0.012) continue;
          const poly = this.clipAndProject([
            { x: x0 + 0.015, y: 0.006, z: z0 + 0.015 },
            { x: x0 + TS - 0.015, y: 0.006, z: z0 + 0.015 },
            { x: x0 + TS - 0.015, y: 0.006, z: z0 + TS - 0.015 },
            { x: x0 + 0.015, y: 0.006, z: z0 + TS - 0.015 }
          ]);
          if (!poly) continue;
          let sx = 0, sy = 0, minSX = 1e9, maxSX = -1e9, minSY = 1e9, maxSY = -1e9;
          for (const pt of poly) {
            sx += pt.x; sy += pt.y;
            minSX = Math.min(minSX, pt.x); maxSX = Math.max(maxSX, pt.x);
            minSY = Math.min(minSY, pt.y); maxSY = Math.max(maxSY, pt.y);
          }
          if (maxSX < -CULL_MARGIN || minSX > this.W + CULL_MARGIN ||
              maxSY < -CULL_MARGIN || minSY > this.H + CULL_MARGIN) continue;
          sx /= poly.length; sy /= poly.length;

          const hash = maze.noise(tx, ty, 11);
          const checker = ((tx + ty) & 1) === 0;
          let base = checker ? [38, 54, 71] : [32, 47, 62];
          base = [
            base[0] + (hash - 0.5) * 9,
            base[1] + (hash - 0.5) * 10,
            base[2] + (hash - 0.5) * 11
          ];
          const light = lit.light;
          const warm = lit.warm * 0.9;
          const r = BG[0] + (base[0] - BG[0]) * light + 34 * warm * light;
          const g = BG[1] + (base[1] - BG[1]) * light + 20 * warm * light;
          const b = BG[2] + (base[2] - BG[2]) * light + 8 * warm * light;

          ctx.beginPath();
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
          ctx.closePath();
          ctx.fillStyle = rgba(r, g, b, 1);
          ctx.fill();

          if (lit.dist < 19) {
            ctx.strokeStyle = rgba(142, 190, 237, 0.055 + light * 0.075);
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }

          if (maze.exit && tx === maze.exit.tx && ty === maze.exit.ty) {
            this.drawExitRune(maze.exit, lit);
          }
        }
      }
      this.playerScreen = this.project({ x: p.x, y: 0.05, z: p.z }) || this.playerScreen;
    }

    drawGroundEffects(game) {
      const ctx = this.ctx;
      const fields = game.slowFields || [];
      const traps = game.traps || [];
      if (!fields.length && !traps.length) return;
      for (const field of fields) {
        const half = this.maze.tileSize * 0.5;
        const corners = [
          { x: field.x - half, z: field.z - half },
          { x: field.x + half, z: field.z - half },
          { x: field.x + half, z: field.z + half },
          { x: field.x - half, z: field.z + half }
        ].map((p) => this.project({ x: p.x, y: 0.011, z: p.z })).filter(Boolean);
        if (corners.length !== 4) continue;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const level = field.level || 1;
        ctx.fillStyle = level >= 2 ? 'rgba(55, 255, 135, 0.20)' : 'rgba(55, 230, 125, 0.10)';
        ctx.strokeStyle = level >= 2 ? 'rgba(122, 255, 178, 0.85)' : 'rgba(92, 255, 158, 0.5)';
        ctx.lineWidth = level >= 2 ? 1.8 : 1.2;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (level >= 2) {
          const inner = corners.map((pt) => ({
            x: pt.x + (this.W * 0.5 - pt.x) * 0.06,
            y: pt.y + (this.H * 0.5 - pt.y) * 0.06
          }));
          ctx.beginPath();
          ctx.moveTo(inner[0].x, inner[0].y);
          for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const trap of traps) {
        const pt = this.project({ x: trap.x, y: 0.03, z: trap.z });
        if (!pt) continue;
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = 'rgba(255, 145, 88, 0.8)';
        ctx.fillStyle = 'rgba(255, 92, 55, 0.13)';
        ctx.lineWidth = 1.2;
        const s = 7;
        ctx.beginPath();
        ctx.rect(-s, -s, s * 2, s * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    drawColliderRing(entity, isBoss) {
      const ctx = this.ctx;
      const rx = this.gameRef.colliderRx;
      const rz = this.gameRef.colliderRz;
      const points = [];
      const segments = 40;
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * TAU;
        const pt = this.project({
          x: entity.x + Math.cos(a) * rx,
          y: isBoss ? this.gameRef.bossColliderY : this.gameRef.playerColliderY,
          z: entity.z + Math.sin(a) * rz
        });
        if (pt) points.push(pt);
      }
      if (points.length < segments * 0.75) return;
      ctx.save();
      ctx.strokeStyle = isBoss ? 'rgba(255,104,96,0.86)' : 'rgba(120,220,255,0.68)';
      ctx.fillStyle = isBoss ? 'rgba(190,38,44,0.08)' : 'rgba(60,160,215,0.055)';
      ctx.lineWidth = isBoss ? 1.5 : 1.1;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    drawExitRune(exit, lit) {
      const ctx = this.ctx;
      const base = this.project({ x: exit.x, y: 0.03, z: exit.z });
      if (!base) return;
      const angle = this.time * 0.4;
      const radius = 1.7;
      const pts = [];
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU + angle;
        const pt = this.project({ x: exit.x + Math.cos(a) * radius, y: 0.035, z: exit.z + Math.sin(a) * radius });
        if (pt) pts.push(pt);
      }
      if (pts.length < 6) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      const grad = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, 95);
      grad.addColorStop(0, 'rgba(92,190,255,0.28)');
      grad.addColorStop(0.6, 'rgba(46,119,220,0.10)');
      grad.addColorStop(1, 'rgba(20,60,140,0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(138,225,255,' + (0.28 + lit.light * 0.35) + ')';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    buildFaces(game) {
      const maze = this.maze;
      const p = this.focusPoint(game);
      const reach = RENDER_REACH_TILES * maze.tileSize;
      const minX = Math.max(0, Math.floor((p.x - reach) / maze.tileSize));
      const maxX = Math.min(maze.width - 1, Math.floor((p.x + reach) / maze.tileSize));
      const minY = Math.max(0, Math.floor((p.z - reach) / maze.tileSize));
      const maxY = Math.min(maze.height - 1, Math.floor((p.z + reach) / maze.tileSize));
      const TS = maze.tileSize;
      const faces = [];
      const cam = this.camPos;

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (!maze.isWallTile(tx, ty)) continue;
          const x0 = tx * TS;
          const z0 = ty * TS;
          const cx = x0 + TS * 0.5;
          const cz = z0 + TS * 0.5;
          const lit = this.lightAt(cx, cz);
          if (lit.light < 0.008 && lit.dist > 16) continue;

          // Exact tile-screen pre-cull: only skip when every projected corner
          // and edge of this wall block is fully outside the canvas. A face
          // whose center is off-screen must still be drawn if a sliver of it
          // remains visible.
          let preMinX = Infinity, preMaxX = -Infinity;
          let preMinY = Infinity, preMaxY = -Infinity;
          let preHasPoint = false;
          let preAllProjected = true;
          for (const y of [0.02, WALL_TOP]) {
            for (const dx of [0, 1]) {
              for (const dz of [0, 1]) {
                const pt = this.project({ x: (tx + dx) * TS, y, z: (ty + dz) * TS });
                if (!pt) { preAllProjected = false; continue; }
                preHasPoint = true;
                preMinX = Math.min(preMinX, pt.x);
                preMaxX = Math.max(preMaxX, pt.x);
                preMinY = Math.min(preMinY, pt.y);
                preMaxY = Math.max(preMaxY, pt.y);
              }
            }
          }
          if (!preHasPoint) continue;
          if (preAllProjected &&
              (preMaxX < -CULL_MARGIN || preMinX > this.W + CULL_MARGIN ||
               preMaxY < -CULL_MARGIN || preMinY > this.H + CULL_MARGIN)) {
            continue;
          }

          // top face
          const groundDepth = this.worldToCam({ x: cx, y: 0.02, z: cz }).z;
          if (cam.y > WALL_TOP) {
            const top = [
              { x: x0, y: WALL_TOP, z: z0 },
              { x: x0 + TS, y: WALL_TOP, z: z0 },
              { x: x0 + TS, y: WALL_TOP, z: z0 + TS },
              { x: x0, y: WALL_TOP, z: z0 + TS }
            ];
            const c = this.worldToCam({ x: cx, y: WALL_TOP, z: cz });
            faces.push({
              type: 'top', tx, ty, points: top, depth: Math.max(NEAR, c.z),
              groundDepth: Math.max(NEAR, groundDepth), lit, hash: maze.noise(tx, ty, 21)
            });
          }

          const sides = [
            { n: [0, 0, -1], pts: [{ x: x0, y: 0, z: z0 }, { x: x0 + TS, y: 0, z: z0 }, { x: x0 + TS, y: WALL_TOP, z: z0 }, { x: x0, y: WALL_TOP, z: z0 }], nx: 0, nz: -1 },
            { n: [0, 0, 1], pts: [{ x: x0 + TS, y: 0, z: z0 + TS }, { x: x0, y: 0, z: z0 + TS }, { x: x0, y: WALL_TOP, z: z0 + TS }, { x: x0 + TS, y: WALL_TOP, z: z0 + TS }], nx: 0, nz: 1 },
            { n: [-1, 0, 0], pts: [{ x: x0, y: 0, z: z0 + TS }, { x: x0, y: 0, z: z0 }, { x: x0, y: WALL_TOP, z: z0 }, { x: x0, y: WALL_TOP, z: z0 + TS }], nx: -1, nz: 0 },
            { n: [1, 0, 0], pts: [{ x: x0 + TS, y: 0, z: z0 }, { x: x0 + TS, y: 0, z: z0 + TS }, { x: x0 + TS, y: WALL_TOP, z: z0 + TS }, { x: x0 + TS, y: WALL_TOP, z: z0 }], nx: 1, nz: 0 }
          ];

          for (let si = 0; si < 4; si++) {
            const side = sides[si];
            const nbrX = tx + side.nx;
            const nbrY = ty + side.nz;
            if (!maze.isFloorTile(nbrX, nbrY)) continue;
            const center = { x: cx + side.nx * TS * 0.5, y: WALL_TOP * 0.5, z: cz + side.nz * TS * 0.5 };
            const toCamX = cam.x - center.x;
            const toCamZ = cam.z - center.z;
            if (toCamX * side.nx + toCamZ * side.nz <= 0.01) continue;
            const c = this.worldToCam(center);
            faces.push({
              type: 'side', tx, ty, side: si, points: side.pts,
              depth: Math.max(NEAR, c.z), groundDepth: Math.max(NEAR, groundDepth),
              lit, hash: maze.noise(tx, ty, 30 + si)
            });
          }
        }
      }

      faces.sort((a, b) => b.depth - a.depth);
      return faces;
    }

    drawWalls(faces) {
      for (const f of faces) {
        if (f.type === 'top') this.drawTopFace(f);
        else this.drawSideFace(f);
      }
    }

    drawTopFace(f) {
      const ctx = this.ctx;
      const poly = this.clipAndProject(f.points);
      if (!poly) return;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let sx = 0, sy = 0;
      for (const pt of poly) {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
        sx += pt.x; sy += pt.y;
      }
      // Only cull when the whole projected top face is outside the viewport.
      if (maxX < -CULL_MARGIN || minX > this.W + CULL_MARGIN ||
          maxY < -CULL_MARGIN || minY > this.H + CULL_MARGIN) return;
      sx /= poly.length; sy /= poly.length;
      const light = f.lit.light;
      const warm = f.lit.warm;
      const base = [74, 97, 124];
      const r = BG[0] + (base[0] - BG[0]) * light + 28 * warm * light;
      const g = BG[1] + (base[1] - BG[1]) * light + 16 * warm * light;
      const b = BG[2] + (base[2] - BG[2]) * light + 6 * warm * light;

      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = rgba(r, g, b, 1);
      ctx.fill();
      ctx.strokeStyle = rgba(166, 207, 246, 0.10 + light * 0.06);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    drawSideFace(f) {
      const ctx = this.ctx;
      const poly = this.clipAndProject(f.points);
      if (!poly) return;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const pt of poly) {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
      }
      if (maxX < -CULL_MARGIN || minX > this.W + CULL_MARGIN ||
          maxY < -CULL_MARGIN || minY > this.H + CULL_MARGIN) return;

      const light = f.lit.light;
      const warm = f.lit.warm;
      const shade = 0.86 + (f.side % 2) * 0.05 + (f.hash - 0.5) * 0.06;
      const topBase = [86, 110, 139];
      const bottomBase = [42, 57, 77];
      const cTop = [
        BG[0] + (topBase[0] * shade - BG[0]) * light + 40 * warm * light,
        BG[1] + (topBase[1] * shade - BG[1]) * light + 23 * warm * light,
        BG[2] + (topBase[2] * shade - BG[2]) * light + 8 * warm * light
      ];
      const cBottom = [
        BG[0] + (bottomBase[0] * shade - BG[0]) * light + 23 * warm * light,
        BG[1] + (bottomBase[1] * shade - BG[1]) * light + 13 * warm * light,
        BG[2] + (bottomBase[2] * shade - BG[2]) * light + 4 * warm * light
      ];

      const grad = f.lit.dist < 10 ? ctx.createLinearGradient(0, minY, 0, Math.max(minY + 1, maxY)) : null;
      if (grad) {
        grad.addColorStop(0, rgba(cTop[0], cTop[1], cTop[2], 1));
        grad.addColorStop(1, rgba(cBottom[0], cBottom[1], cBottom[2], 1));
      }

      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      // Cheap solid fill for distant walls; gradients are reserved for the
      // handful of faces close enough for the shading to be visible.
      ctx.fillStyle = grad || rgba(
        (cTop[0] + cBottom[0]) * 0.5,
        (cTop[1] + cBottom[1]) * 0.5,
        (cTop[2] + cBottom[2]) * 0.5,
        1
      );
      ctx.fill();
      ctx.strokeStyle = rgba(153, 199, 243, 0.08 + light * 0.085);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    drawPortal(game) {
      const maze = this.maze;
      if (!maze || !maze.exit) return;
      const p = this.focusPoint(game);
      const e = maze.exit;
      const dist = Math.hypot(e.x - p.x, e.z - p.z);
      if (dist > 34) return;
      if (!maze.hasLineOfSight(p.x, p.z, e.x, e.z)) return;
      const lit = clamp(1 - dist / 32, 0, 1);
      if (lit <= 0.01) return;

      const ctx = this.ctx;
      const base = this.project({ x: e.x, y: 0.03, z: e.z });
      const mid = this.project({ x: e.x, y: 1.7, z: e.z });
      const top = this.project({ x: e.x, y: 3.4, z: e.z });
      if (!base || !top) return;
      const height = Math.max(12, base.y - top.y);
      const width = height * 0.38;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.82 + 0.18 * Math.sin(this.time * 2.4);
      const beam = ctx.createLinearGradient(0, top.y, 0, base.y);
      beam.addColorStop(0, 'rgba(85,205,255,0)');
      beam.addColorStop(0.35, 'rgba(85,205,255,' + (0.08 * lit * pulse) + ')');
      beam.addColorStop(0.76, 'rgba(84,191,255,' + (0.2 * lit * pulse) + ')');
      beam.addColorStop(1, 'rgba(216,248,255,' + (0.44 * lit * pulse) + ')');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.ellipse(base.x, base.y - height * 0.42, width * 0.7, height * 0.56, 0, 0, TAU);
      ctx.fill();

      const floorGlow = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, width * 2.2);
      floorGlow.addColorStop(0, 'rgba(154,239,255,' + (0.25 * lit) + ')');
      floorGlow.addColorStop(0.5, 'rgba(41,143,255,' + (0.1 * lit) + ')');
      floorGlow.addColorStop(1, 'rgba(20,70,140,0)');
      ctx.fillStyle = floorGlow;
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, width * 2.2, width * 0.7, 0, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = 'rgba(160,241,255,' + (0.25 * lit + 0.1) + ')';
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 3; i++) {
        const a = this.time * (0.35 + i * 0.12) + i * 2.1;
        ctx.beginPath();
        ctx.ellipse(base.x, base.y - height * 0.36, width * (0.35 + i * 0.18), height * (0.22 + i * 0.13), a, 0, TAU);
        ctx.stroke();
      }

      for (let i = 0; i < 14; i++) {
        const a = this.time * (0.5 + i * 0.015) + i * 1.7;
        const rr = width * (0.35 + ((i * 0.137) % 1) * 0.7);
        const px = base.x + Math.cos(a) * rr;
        const py = base.y - height * 0.35 + Math.sin(a) * rr * 1.5;
        ctx.fillStyle = 'rgba(183,246,255,' + (0.2 + lit * 0.4) + ')';
        ctx.beginPath();
        ctx.arc(px, py, 0.8 + (i % 3) * 0.5, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    updateParticles(dt, game) {
      const p = game.player;
      this.stepAccumulator += Math.abs(p.walkDistance - this.lastWalkDistance);
      this.lastWalkDistance = p.walkDistance;
      if (this.stepAccumulator > 0.65) {
        this.stepAccumulator = 0;
        if (p.moving) {
          const a = Math.random() * TAU;
          this.dust.push({
            x: p.x + Math.cos(a) * 0.32,
            z: p.z + Math.sin(a) * 0.32,
            y: 0.02,
            vx: Math.cos(a) * 0.12,
            vz: Math.sin(a) * 0.12,
            life: 0,
            max: 0.9 + Math.random() * 0.5,
            size: 0.4 + Math.random() * 0.5
          });
        }
      }
      for (let i = this.dust.length - 1; i >= 0; i--) {
        const d = this.dust[i];
        d.life += dt;
        d.x += d.vx * dt;
        d.z += d.vz * dt;
        d.y += dt * 0.14;
        if (d.life > d.max) this.dust.splice(i, 1);
      }

      for (const m of this.motes) {
        m.phase += dt * m.speed;
        m.y += Math.sin(m.phase) * dt * 0.06;
        m.x += Math.cos(m.phase * 0.7) * dt * 0.04;
        m.z += Math.sin(m.phase * 0.55) * dt * 0.04;
        if (Math.hypot(m.x - p.x, m.z - p.z) > 13) {
          const a = Math.random() * TAU;
          const r = 2 + Math.random() * 9;
          m.x = p.x + Math.cos(a) * r;
          m.z = p.z + Math.sin(a) * r;
          m.y = Math.random() * 3.2 + 0.2;
        }
      }
    }

    drawMotes(game) {
      const ctx = this.ctx;
      const p = this.focusPoint(game);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const m of this.motes) {
        const dist = Math.hypot(m.x - p.x, m.z - p.z);
        if (dist > 12) continue;
        const pt = this.project({ x: m.x, y: m.y, z: m.z });
        if (!pt) continue;
        const lit = this.lightAt(m.x, m.z);
        const a = m.alpha * lit.light * (0.6 + Math.sin(this.time * 1.4 + m.phase) * 0.4);
        if (a < 0.02) continue;
        ctx.fillStyle = m.warm
          ? 'rgba(255,196,118,' + a + ')'
          : 'rgba(156,214,255,' + a + ')';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, m.size * (0.7 + lit.light * 0.5), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    drawDust() {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (const d of this.dust) {
        const t = d.life / d.max;
        const pt = this.project({ x: d.x, y: d.y, z: d.z });
        if (!pt) continue;
        const rad = 4 + t * 20;
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, rad);
        g.addColorStop(0, 'rgba(157,205,255,' + (0.11 * (1 - t)) + ')');
        g.addColorStop(1, 'rgba(80,120,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, rad, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    drawBoss(game) {
      const b = game.boss;
      if (!b || !b.active) return;
      const ctx = this.ctx;
      const foot = this.project({ x: b.x, y: 0.02, z: b.z });
      if (!foot) return;
      const bob = b.moving ? Math.abs(Math.sin(this.time * 5.4)) * 0.025 : Math.sin(this.time * 1.7) * 0.012;
      const top = this.project({ x: b.x, y: 0.02 + this.playerWorldHeight + bob, z: b.z });
      if (!top) return;
      const spriteH = Math.max(10, foot.y - top.y);
      const sprite = this.bossSprites[b.facingKey] || this.bossSprites.down;
      const aspect = sprite ? (sprite.naturalWidth / sprite.naturalHeight) : 0.55;
      const drawW = spriteH * aspect;

      // Red floor shadow and alert halo.
      const shadow = ctx.createRadialGradient(foot.x, foot.y, 0, foot.x, foot.y, Math.max(18, drawW * 0.58));
      shadow.addColorStop(0, 'rgba(54, 0, 8, 0.48)');
      shadow.addColorStop(0.55, 'rgba(26, 0, 5, 0.24)');
      shadow.addColorStop(1, 'rgba(20, 0, 4, 0)');
      ctx.save();
      ctx.translate(foot.x, foot.y);
      ctx.scale(1, 0.34);
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(18, drawW * 0.58), 0, TAU);
      ctx.fill();
      ctx.restore();

      const haloY = foot.y - spriteH * 0.5;
      const halo = ctx.createRadialGradient(foot.x, haloY, 0, foot.x, haloY, drawW * 1.1);
      halo.addColorStop(0, 'rgba(176, 38, 42, 0.24)');
      halo.addColorStop(0.45, 'rgba(105, 18, 33, 0.1)');
      halo.addColorStop(1, 'rgba(60, 0, 12, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(foot.x, haloY, drawW * 1.1, 0, TAU);
      ctx.fill();
      ctx.restore();

      if (sprite) {
        ctx.save();
        ctx.translate(foot.x, foot.y);
        ctx.scale(b.facingMirror ? -1 : 1, 1);
        const tilt = Math.sin(this.time * 2.1) * 0.008 + (b.moving ? Math.sin(this.time * 5.4) * 0.01 : 0);
        ctx.rotate(tilt);
        ctx.shadowColor = 'rgba(220, 54, 62, 0.62)';
        ctx.shadowBlur = 28;
        ctx.drawImage(sprite, -drawW * 0.5, -spriteH, drawW, spriteH);
        ctx.restore();
      } else {
        // Never let a missing boss sprite make the hunter invisible.
        ctx.save();
        ctx.translate(foot.x, foot.y);
        ctx.fillStyle = 'rgba(118, 22, 30, 0.95)';
        ctx.shadowColor = 'rgba(238, 55, 60, 0.7)';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.moveTo(0, -spriteH);
        ctx.quadraticCurveTo(drawW * 0.58, -spriteH * 0.6, drawW * 0.4, 0);
        ctx.lineTo(-drawW * 0.4, 0);
        ctx.quadraticCurveTo(-drawW * 0.58, -spriteH * 0.6, 0, -spriteH);
        ctx.fill();
        ctx.restore();
      }

      if (b.boundTimer > 0 || b.stunTimer > 0) {
        const label = b.boundTimer > 0
          ? '禁锢 ' + Math.ceil(b.boundTimer * 10) / 10 + 's'
          : '眩晕 ' + Math.ceil(b.stunTimer * 10) / 10 + 's';
        ctx.save();
        ctx.font = '600 12px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = b.boundTimer > 0 ? '#b9f1ff' : '#ffd18e';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 5;
        ctx.fillText(label, top.x, top.y - 12);
        ctx.restore();
      }
    }

    drawPlayer(game) {
      const ctx = this.ctx;
      const p = game.player;
      const base = this.project({ x: p.x, y: 0.02, z: p.z });
      if (!base) return;
      const foot = this.project({ x: p.x, y: 0.02, z: p.z });
      if (!foot) return;
      const bob = p.moving
        ? Math.abs(Math.sin(p.walkPhase * Math.PI * 2)) * 0.035
        : Math.sin(this.time * 1.6) * 0.016;
      const topPos = this.project({ x: p.x, y: 0.02 + this.playerWorldHeight + bob, z: p.z });
      if (!topPos) return;
      const spriteH = Math.max(10, foot.y - topPos.y);
      const dashActive = !!(p.moving && p.sprinting);
      const directionWalk = this.directionSheets[p.facingDir];
      const directionSheet = this.directionSprites[p.facingDir];
      let sheet = null;
      let sx = 0, sy = 0, sw = 0, sh = 0;
      let drawW = spriteH * 0.42;
      let flip = 1;

      if (directionWalk) {
        const frame = p.moving
          ? Math.floor((p.walkPhase % 1) * directionWalk.frames) % directionWalk.frames
          : 0;
        sheet = directionWalk.image;
        sw = directionWalk.frameW;
        sh = directionWalk.frameH;
        sx = frame * sw;
        drawW = spriteH * (sw / sh);
        flip = p.facingMirror ? -1 : 1;
      } else if (directionSheet) {
        sheet = directionSheet;
        sw = directionSheet.naturalWidth || directionSheet.width;
        sh = directionSheet.naturalHeight || directionSheet.height;
        drawW = spriteH * (sw / sh);
        flip = p.facingMirror ? -1 : 1;
      } else if (this.sprite) {
        const useDashSheet = dashActive && this.dashSprite;
        sheet = useDashSheet ? this.dashSprite : this.sprite;
        const cellW = useDashSheet ? this.dashCellW : this.spriteCellW;
        const cellH = useDashSheet ? this.dashCellH : this.spriteCellH;
        const frameCount = useDashSheet ? this.dashFrames : this.spriteFrames;
        const frame = p.moving ? Math.floor((p.walkPhase % 1) * frameCount) % frameCount : 0;
        sx = frame * cellW;
        sw = cellW;
        sh = cellH;
        drawW = spriteH * (cellW / cellH);
        flip = (p.facingX || 1) < 0 ? -1 : 1;
      }
      const spriteW = drawW;

      // contact shadow
      const shadow = this.project({ x: p.x, y: 0.025, z: p.z });
      if (shadow) {
        const g = ctx.createRadialGradient(shadow.x, shadow.y, 0, shadow.x, shadow.y, spriteW * 0.55);
        g.addColorStop(0, 'rgba(0,0,0,0.42)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.19)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.translate(shadow.x, shadow.y);
        ctx.scale(1, 0.34);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, spriteW * 0.55, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // warm halo behind the traveller
      const haloY = foot.y - spriteH * 0.42;
      const halo = ctx.createRadialGradient(base.x, haloY, 0, base.x, haloY, spriteW * 1.35);
      halo.addColorStop(0, 'rgba(255,191,102,0.20)');
      halo.addColorStop(0.4, 'rgba(127,177,255,0.08)');
      halo.addColorStop(1, 'rgba(40,100,200,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(base.x, haloY, spriteW * 1.35, 0, TAU);
      ctx.fill();
      ctx.restore();

      if (sheet) {
        const gait = p.moving ? Math.sin(p.walkPhase * TAU) : 0;
        const gaitDouble = p.moving ? Math.sin(p.walkPhase * TAU * 2) : 0;
        const sway = gait * spriteW * (dashActive ? 0.028 : 0.015);
        const squash = 1 + gaitDouble * (dashActive ? 0.012 : 0.006);
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.translate(foot.x + sway, foot.y);
        ctx.scale(flip, squash);
        const turnTilt = (game.turnInput || 0) * (dashActive ? 0.05 : 0.024);
        const gaitTilt = gait * (dashActive ? 0.04 : 0.018);
        const tilt = turnTilt + gaitTilt + Math.sin(this.time * 1.3) * 0.006;
        ctx.rotate(tilt);
        ctx.shadowColor = dashActive ? 'rgba(107,206,255,0.62)' : 'rgba(128,196,255,0.48)';
        ctx.shadowBlur = dashActive ? 30 : 24;
        ctx.drawImage(
          sheet,
          sx, sy, sw, sh,
          -drawW * 0.5, -spriteH, drawW, spriteH
        );
        ctx.restore();
      } else {
        // A readable in-world fallback, so the traveller is never invisible
        // if a browser blocks the local PNG.
        const h = Math.max(96, spriteH);
        const w = h * 0.42;
        ctx.save();
        ctx.translate(foot.x, foot.y);
        ctx.globalAlpha = 0.96;
        ctx.shadowColor = 'rgba(128,205,255,0.65)';
        ctx.shadowBlur = 20;
        const cloak = ctx.createLinearGradient(0, -h, 0, 0);
        cloak.addColorStop(0, 'rgba(138,196,246,0.95)');
        cloak.addColorStop(0.55, 'rgba(54,104,185,0.96)');
        cloak.addColorStop(1, 'rgba(22,43,92,0.96)');
        ctx.fillStyle = cloak;
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.88);
        ctx.quadraticCurveTo(w * 0.44, -h * 0.66, w * 0.42, -h * 0.02);
        ctx.lineTo(-w * 0.42, -h * 0.02);
        ctx.quadraticCurveTo(-w * 0.4, -h * 0.64, 0, -h * 0.88);
        ctx.fill();
        ctx.fillStyle = 'rgba(235,246,255,0.94)';
        ctx.beginPath();
        ctx.arc(0, -h * 0.86, h * 0.12, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,213,139,0.95)';
        ctx.beginPath();
        ctx.arc(w * 0.34, -h * 0.5, h * 0.055, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // tiny lantern spark at the traveller's hand height
      const spark = this.project({ x: p.x, y: 1.22, z: p.z });
      if (spark) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const sg = ctx.createRadialGradient(spark.x, spark.y, 0, spark.x, spark.y, 17);
        sg.addColorStop(0, 'rgba(255,224,167,0.65)');
        sg.addColorStop(0.4, 'rgba(255,183,92,0.2)');
        sg.addColorStop(1, 'rgba(255,160,60,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, 17, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    drawLightOverlay(game) {
      const ctx = this.ctx;
      if (!this.overlayCanvas) {
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCtx = this.overlayCanvas.getContext('2d');
      }
      if (this.overlaySize.w !== this.W || this.overlaySize.h !== this.H || this.overlaySize.dpr !== this.dpr) {
        this.overlaySize = { w: this.W, h: this.H, dpr: this.dpr };
        this.overlayCanvas.width = Math.round(this.W * this.dpr);
        this.overlayCanvas.height = Math.round(this.H * this.dpr);
        this.overlayDirty = true;
      }
      const octx = this.overlayCtx;
      if (this.overlayDirty) {
        octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        octx.clearRect(0, 0, this.W, this.H);

        const p = this.focusPoint(game);
        const foot = this.project({ x: p.x, y: 0.1, z: p.z });
        if (foot) {
          const radius = Math.min(this.W, this.H) * 0.52;
          const g = octx.createRadialGradient(foot.x, foot.y - this.H * 0.08, 0, foot.x, foot.y - this.H * 0.08, radius);
          g.addColorStop(0, 'rgba(255,190,112,0.16)');
          g.addColorStop(0.24, 'rgba(126,178,240,0.065)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          octx.fillStyle = g;
          octx.fillRect(0, 0, this.W, this.H);
        }

        const cx = this.W * 0.5;
        const cy = this.H * 0.56;
        const vr = Math.hypot(this.W, this.H) * 0.62;
        const vg = octx.createRadialGradient(cx, cy, Math.min(this.W, this.H) * 0.22, cx, cy, vr);
        vg.addColorStop(0, 'rgba(0,2,6,0)');
        vg.addColorStop(0.64, 'rgba(0,3,8,0.18)');
        vg.addColorStop(1, 'rgba(0,2,7,0.68)');
        octx.fillStyle = vg;
        octx.fillRect(0, 0, this.W, this.H);

        const topGrad = octx.createLinearGradient(0, 0, 0, this.H * 0.18);
        topGrad.addColorStop(0, 'rgba(0,3,8,0.36)');
        topGrad.addColorStop(1, 'rgba(0,3,8,0)');
        octx.fillStyle = topGrad;
        octx.fillRect(0, 0, this.W, this.H * 0.18);
        this.overlayDirty = false;
      }
      ctx.drawImage(this.overlayCanvas, 0, 0, this.W, this.H);
    }

    render(game, dt) {
      this.gameRef = game;
      this.time += dt;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.clearRect(0, 0, this.W, this.H);
      this.updateCamera(game, dt);
      this.drawBackground(game);
      if (!this.maze) return;
      this.drawFloor(game);
      this.drawGroundEffects(game);
      if (game.boss && game.boss.active) {
        this.drawColliderRing(game.player, false);
        this.drawColliderRing(game.boss, true);
      }
      const faces = this.buildFaces(game);
      const playerDepth = this.worldToCam({
        x: game.player.x,
        y: 0.02,
        z: game.player.z
      }).z;
      const renderItems = faces.map((face) => ({
        type: 'wall',
        depth: face.groundDepth != null ? face.groundDepth : face.depth,
        tie: face.depth,
        face
      }));
      renderItems.push({ type: 'player', depth: playerDepth, tie: 0 });
      if (game.boss && game.boss.active) {
        const bossDepth = this.worldToCam({
          x: game.boss.x,
          y: 0.02,
          z: game.boss.z
        }).z;
        renderItems.push({ type: 'boss', depth: bossDepth, tie: 0 });
      }
      renderItems.sort((a, b) => (b.depth - a.depth) || (b.tie - a.tie));

      this.drawPortal(game);
      this.updateParticles(dt, game);
      this.drawMotes(game);
      for (const item of renderItems) {
        if (item.type === 'wall') {
          if (item.face.type === 'top') this.drawTopFace(item.face);
          else this.drawSideFace(item.face);
        } else if (item.type === 'player') {
          this.drawPlayer(game);
        } else if (item.type === 'boss') {
          this.drawBoss(game);
        }
      }
      this.drawLightOverlay(game);
    }
  }

  window.AzureRenderer = AzureRenderer;
})();
