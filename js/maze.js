/* =========================================================
   Azure Labyrinth — maze generation
   Pure procedural, no dependencies.
   ========================================================= */
(function () {
  'use strict';

  const NEIGHBORS = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 }
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(x, y, seed) {
    let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519) ^ (seed | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function shuffle(list, rand) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    return list;
  }

  class Maze {
    constructor(options = {}) {
      this.cols = options.cols || 13;
      this.rows = options.rows || this.cols;
      this.seed = (options.seed >>> 0) || ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      this.rand = mulberry32(this.seed);
      this.tileSize = options.tileSize || 4;
      this.width = this.cols * 2 + 1;
      this.height = this.rows * 2 + 1;
      this.grid = new Uint8Array(this.width * this.height).fill(1);
      this.exit = null;
      this.spawn = null;
      this.spawnYaw = 0;
      this.deadEnds = [];
      this.loops = 0;
      this.pathLength = 0;
      this.totalFloor = 0;
      this.build();
    }

    index(x, y) {
      return y * this.width + x;
    }

    isWallTile(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
      return this.grid[y * this.width + x] === 1;
    }

    isFloorTile(x, y) {
      return !this.isWallTile(x, y);
    }

    isWallWorld(x, z) {
      return this.isWallTile(Math.floor(x / this.tileSize), Math.floor(z / this.tileSize));
    }

    tileCenter(x, y) {
      return {
        x: (x + 0.5) * this.tileSize,
        z: (y + 0.5) * this.tileSize
      };
    }

    worldToTile(x, z) {
      return { x: Math.floor(x / this.tileSize), y: Math.floor(z / this.tileSize) };
    }

    carve(x, y) {
      if (x > 0 && y > 0 && x < this.width - 1 && y < this.height - 1) {
        this.grid[this.index(x, y)] = 0;
      }
    }

    build() {
      const rand = this.rand;
      const startCX = Math.floor(rand() * this.cols);
      const startCY = Math.floor(rand() * this.rows);
      const startTile = { x: startCX * 2 + 1, y: startCY * 2 + 1 };

      this.carve(startTile.x, startTile.y);

      const stack = [{ cx: startCX, cy: startCY, tx: startTile.x, ty: startTile.y }];
      const visited = new Set([startCX + ',' + startCY]);

      while (stack.length) {
        const cur = stack[stack.length - 1];
        const options = [];
        for (const n of NEIGHBORS) {
          const cx = cur.cx + n.dx;
          const cy = cur.cy + n.dy;
          if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
          if (visited.has(cx + ',' + cy)) continue;
          options.push({ cx, cy, dx: n.dx, dy: n.dy });
        }

        if (options.length === 0) {
          stack.pop();
          continue;
        }

        const pick = options[Math.floor(rand() * options.length)];
        const nx = pick.cx * 2 + 1;
        const ny = pick.cy * 2 + 1;
        this.carve(cur.tx + pick.dx, cur.ty + pick.dy);
        this.carve(nx, ny);
        visited.add(pick.cx + ',' + pick.cy);
        stack.push({ cx: pick.cx, cy: pick.cy, tx: nx, ty: ny });
      }

      // A few extra openings make the maze feel less like a single snaking
      // corridor while still leaving plenty of branches and dead ends.
      const loopChance = 0.075;
      for (let y = 1; y < this.height - 1; y++) {
        for (let x = 1; x < this.width - 1; x++) {
          if (this.grid[this.index(x, y)] !== 1) continue;
          const horiz = this.isFloorTile(x - 1, y) && this.isFloorTile(x + 1, y) &&
            this.isWallTile(x, y - 1) && this.isWallTile(x, y + 1);
          const vert = this.isFloorTile(x, y - 1) && this.isFloorTile(x, y + 1) &&
            this.isWallTile(x - 1, y) && this.isWallTile(x + 1, y);
          if ((horiz || vert) && rand() < loopChance) {
            this.carve(x, y);
            this.loops++;
          }
        }
      }

      this.countFloor();

      this.pickSpawn();
      const dist = this.bfs(this.spawn.tx, this.spawn.ty);
      this.pickExit(dist);
      this.findDeadEnds();
      this.pathLength = dist[this.index(this.exit.tx, this.exit.ty)];
      this.pickSpawnYaw();
    }

    countFloor() {
      let floors = 0;
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] === 0) floors++;
      }
      this.totalFloor = floors;
    }

    pickSpawn() {
      // Spawn at a random inner cell center, not directly against the border.
      const candidates = [];
      for (let cy = 1; cy < this.rows - 1; cy++) {
        for (let cx = 1; cx < this.cols - 1; cx++) {
          candidates.push({ tx: cx * 2 + 1, ty: cy * 2 + 1 });
        }
      }
      let tries = 0;
      let tile;
      do {
        tile = candidates[Math.floor(this.rand() * candidates.length)];
        tries++;
      } while (this.isWallTile(tile.tx, tile.ty) && tries < 200);
      if (!tile || this.isWallTile(tile.tx, tile.ty)) {
        tile = { tx: 1, ty: 1 };
        for (let y = 1; y < this.height; y += 2) {
          for (let x = 1; x < this.width; x += 2) {
            if (this.isFloorTile(x, y)) { tile = { tx: x, ty: y }; break; }
          }
        }
      }
      const c = this.tileCenter(tile.tx, tile.ty);
      this.spawn = {
        tx: tile.tx,
        ty: tile.ty,
        x: c.x,
        z: c.z
      };
    }

    pickExit(dist) {
      const minPath = Math.min(160, Math.max(60, Math.floor(this.totalFloor * 0.2)));
      const minEuclid = Math.max(14, this.cols * 0.55) * this.tileSize;
      const spawn = this.spawn;
      const candidates = [];

      for (let y = 1; y < this.height - 1; y++) {
        for (let x = 1; x < this.width - 1; x++) {
          if (this.isWallTile(x, y)) continue;
          const d = dist[this.index(x, y)];
          if (d < minPath) continue;
          const c = this.tileCenter(x, y);
          const euclid = Math.hypot(c.x - spawn.x, c.z - spawn.z);
          if (euclid < minEuclid) continue;
          const openNeighbors = NEIGHBORS.reduce((acc, n) => acc + (this.isFloorTile(x + n.dx, y + n.dy) ? 1 : 0), 0);
          candidates.push({
            x, y, dist: d, euclid,
            deadEnd: openNeighbors === 1,
            score: d + (openNeighbors === 1 ? 40 : 0) + euclid * 0.08,
            c
          });
        }
      }

      if (!candidates.length) {
        // Extremely defensive fallback: farthest reachable floor tile.
        let best = null;
        for (let i = 0; i < dist.length; i++) {
          if (dist[i] < 0) continue;
          if (!best || dist[i] > best.dist) {
            const x = i % this.width;
            const y = Math.floor(i / this.width);
            best = { x, y, dist: dist[i] };
          }
        }
        const c = this.tileCenter(best.x, best.y);
        this.exit = { tx: best.x, ty: best.y, x: c.x, z: c.z, isDeadEnd: true };
        return;
      }

      candidates.sort((a, b) => b.score - a.score);
      const pool = candidates.slice(0, Math.min(6, candidates.length));
      const pick = pool[Math.floor(this.rand() * pool.length)];
      this.exit = {
        tx: pick.x,
        ty: pick.y,
        x: pick.c.x,
        z: pick.c.z,
        isDeadEnd: pick.deadEnd,
        pathSteps: pick.dist,
        distanceFromSpawn: pick.euclid
      };
    }

    getDistanceFromSpawn(tx, ty) {
      const dist = this.bfs(this.spawn.tx, this.spawn.ty);
      return dist[this.index(tx, ty)];
    }

    bfs(sx, sy) {
      const dist = new Int32Array(this.width * this.height).fill(-1);
      if (this.isWallTile(sx, sy)) return dist;
      const q = new Int32Array(this.width * this.height);
      let head = 0, tail = 0;
      q[tail++] = this.index(sx, sy);
      dist[this.index(sx, sy)] = 0;
      while (head < tail) {
        const idx = q[head++];
        const x = idx % this.width;
        const y = (idx / this.width) | 0;
        const nd = dist[idx] + 1;
        for (const n of NEIGHBORS) {
          const nx = x + n.dx;
          const ny = y + n.dy;
          if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
          const ni = this.index(nx, ny);
          if (this.grid[ni] !== 0 || dist[ni] !== -1) continue;
          dist[ni] = nd;
          q[tail++] = ni;
        }
      }
      return dist;
    }

    findDeadEnds() {
      this.deadEnds = [];
      for (let y = 1; y < this.height - 1; y++) {
        for (let x = 1; x < this.width - 1; x++) {
          if (this.isWallTile(x, y)) continue;
          let open = 0;
          for (const n of NEIGHBORS) {
            if (this.isFloorTile(x + n.dx, y + n.dy)) open++;
          }
          if (open === 1) this.deadEnds.push({ x, y });
        }
      }
    }

    pickSpawnYaw() {
      const options = [];
      for (const n of NEIGHBORS) {
        if (!this.isFloorTile(this.spawn.tx + n.dx, this.spawn.ty + n.dy)) continue;
        const yaw = Math.atan2(n.dx, -n.dy);
        // Facing this way means the camera sits in the opposite direction.
        // Prefer a direction with a long, open run behind the player.
        let room = 0;
        for (let step = 1; step <= 7; step++) {
          const tx = this.spawn.tx - n.dx * step;
          const ty = this.spawn.ty - n.dy * step;
          if (!this.isFloorTile(tx, ty)) break;
          room++;
        }
        options.push({ yaw, room });
      }
      if (!options.length) {
        this.spawnYaw = 0;
        return;
      }
      options.sort((a, b) => b.room - a.room);
      const bestRoom = options[0].room;
      const best = options.filter((o) => o.room === bestRoom);
      this.spawnYaw = best[Math.floor(this.rand() * best.length)].yaw;
    }

    // Bresenham-ish line of sight between two world points, sampled on tiles.
    hasLineOfSight(x0, z0, x1, z1) {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const dist = Math.hypot(dx, dz);
      const steps = Math.ceil(dist / (this.tileSize * 0.18));
      if (steps <= 0) return true;
      const targetTileX = Math.floor(x1 / this.tileSize);
      const targetTileY = Math.floor(z1 / this.tileSize);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = x0 + dx * t;
        const z = z0 + dz * t;
        const tx = Math.floor(x / this.tileSize);
        const ty = Math.floor(z / this.tileSize);
        if (tx === targetTileX && ty === targetTileY) continue;
        if (this.isWallTile(tx, ty)) return false;
      }
      return true;
    }

    // Reveal tiles in a circular pool of light. Walls are revealed when their
    // adjacent floor is visible, so the map reads like a top-down floor plan.
    reveal(player, radiusTiles, revealed, onFloorRevealed) {
      const px = player.x;
      const pz = player.z;
      const radiusWorld = radiusTiles * this.tileSize;
      const minX = Math.max(0, Math.floor((px - radiusWorld) / this.tileSize));
      const maxX = Math.min(this.width - 1, Math.floor((px + radiusWorld) / this.tileSize));
      const minY = Math.max(0, Math.floor((pz - radiusWorld) / this.tileSize));
      const maxY = Math.min(this.height - 1, Math.floor((pz + radiusWorld) / this.tileSize));
      let changed = false;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.isWallTile(x, y)) continue;
          const c = this.tileCenter(x, y);
          const d = Math.hypot(c.x - px, c.z - pz);
          if (d > radiusWorld) continue;
          if (!this.hasLineOfSight(px, pz, c.x, c.z)) continue;

          const idx = this.index(x, y);
          if (!revealed[idx]) {
            revealed[idx] = 1;
            if (onFloorRevealed) onFloorRevealed(x, y, idx);
            changed = true;
          }

          for (const n of NEIGHBORS) {
            const wx = x + n.dx;
            const wy = y + n.dy;
            if (wx < 0 || wy < 0 || wx >= this.width || wy >= this.height) continue;
            if (this.isWallTile(wx, wy)) {
              const wi = this.index(wx, wy);
              if (!revealed[wi]) {
                const wc = this.tileCenter(wx, wy);
                if (Math.hypot(wc.x - px, wc.z - pz) <= radiusWorld + this.tileSize * 0.65) {
                  revealed[wi] = 1;
                  changed = true;
                }
              }
            }
          }
        }
      }

      return changed;
    }

    countRevealedFloor(revealed) {
      let count = 0;
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] === 0 && revealed[i]) count++;
      }
      return count;
    }

    // Convenient deterministic noise for renderer details.
    noise(x, y, salt = 0) {
      return hash2(x | 0, y | 0, (this.seed ^ (salt * 2654435761)) >>> 0);
    }
  }

  window.AzureMaze = { Maze, mulberry32, hash2 };
})();
