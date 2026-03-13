(function () {
  const OPAQUE_WALL_KEYS = new Set(['wall', 'wall_ammo', 'wall_ammo_mirrored', 'wall_tally', 'wall_tally_mirrored', 'ammo']);
  const CUTOUT_WALL_KEYS = new Set(['window', 'door', 'hole']);

  function spriteKeyForTile(tile, segment) {
    if (!tile || !segment) return tile?.spriteKey || 'wall';
    if (tile.spriteKey === 'ammo' || tile.spriteKey === 'wall_tally') {
      const interiorRight = { x: segment.inward.z, z: -segment.inward.x };
      const mirrored = (segment.tangent.x * interiorRight.x + segment.tangent.z * interiorRight.z) < 0;
      if (tile.spriteKey === 'ammo') return mirrored ? 'wall_ammo_mirrored' : 'wall_ammo';
      return mirrored ? 'wall_tally_mirrored' : 'wall_tally';
    }
    return tile.spriteKey;
  }

  class WorldRenderer3D {
    constructor(canvas, width, height) {
      this.canvas = canvas;
      this.width = width;
      this.height = height;
      this.THREE = window.THREE;
      this.ready = false;
      this.assets = null;
      this.state = null;
      this.wallMaterialCache = new Map();
      this.crateTileMaterialCache = new Map();
      this.treeTextureCache = new Map();
      this.treeHoleTextureCache = new Map(); // treeId -> { canvas, ctx, texture, lastVersion, lastSpriteIndex }
      this.zombieTextureCache = new Map();
      this.zombieHoleTextureCache = new Map(); // zombieSpawnIndex -> { canvas, ctx, texture, lastVersion, lastImgKey, w, h }
      this.playerTextureCache = new Map();
      this.dynamicMaterialCache = new Map();
      this.planeGeometryCache = new Map();
      this.boardTexture = null;
      this.slotColliderByIndex = new Map();
      this.raycastStatic = [];
      this.raycastDynamic = [];
      this._raycaster = null;
      this._rayNdc = null;

      if (!this.THREE || !canvas) {
        throw new Error('WebGL: THREE or canvas not available');
      }
      const THREE = this.THREE;
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
      } catch (e) {
        throw new Error('WebGL: context creation failed');
      }
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.autoClear = true;
      this.renderer.sortObjects = true;

      this.scene = new THREE.Scene();
      this.scene.background = null;
      this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 500);

      this.staticGroup = new THREE.Group();
      this.dynamicGroup = new THREE.Group();
      this.zombieGroup = new THREE.Group();
      this.scene.add(this.staticGroup);
      this.scene.add(this.dynamicGroup);
      this.scene.add(this.zombieGroup);
      this.zombieMeshes = [];
      this.treeSpriteMeshes = new Map(); // treeId -> Sprite
      this.ready = true;
    }

    isReady() {
      return !!this.ready;
    }

    setAssets(assets) {
      this.assets = assets;
      if (!this.boardTexture && assets?.board) this.boardTexture = this._makeTexture(assets.board);
    }

    setState(state) {
      this.state = state;
      if (!this.ready || !state) return;
      const THREE = this.THREE;
      this.scene.background = null;
      const fogColor = state.FOG_COLOR || 0x3a4555;
      const fogDensity = state.FOG_DENSITY ?? 0.028;
      if (!this.scene.fog) {
        this.scene.fog = new THREE.FogExp2(fogColor, fogDensity);
      } else {
        this.scene.fog.color.setHex(fogColor);
        this.scene.fog.density = fogDensity;
      }
    }

    resize(width, height) {
      if (!this.ready) return;
      this.width = width;
      this.height = height;
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    }

    _makeTexture(img) {
      if (!img) return null;
      const THREE = this.THREE;
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      tex.flipY = true;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      return tex;
    }

    _materialFromImage(img, { alphaTest = 0.3, doubleSide = true, transparent = false } = {}) {
      const THREE = this.THREE;
      const tex = this._makeTexture(img);
      return new THREE.MeshBasicMaterial({
        map: tex,
        transparent,
        alphaTest,
        side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        depthWrite: true,
      });
    }

    _getWallMaterial(spriteKey) {
      const key = String(spriteKey || 'wall');
      if (this.wallMaterialCache.has(key)) return this.wallMaterialCache.get(key);
      const { img } = this.state.getBunkerWallImageAndData(key);
      const isCutout = CUTOUT_WALL_KEYS.has(key);
      const mat = this._materialFromImage(img, {
        alphaTest: isCutout ? 0.35 : 0,
        transparent: false,
      });
      mat.depthWrite = true;
      mat.depthTest = true;
      this.wallMaterialCache.set(key, mat);
      return mat;
    }

    _getCrateTileMaterial(tileIndex) {
      const idx = Math.max(0, Math.min(19, Math.floor(tileIndex || 0)));
      if (this.crateTileMaterialCache.has(idx)) return this.crateTileMaterialCache.get(idx);
      const sheet = this.assets?.crateSpriteSheet;
      const THREE = this.THREE;
      if (!sheet?.naturalWidth || !sheet?.naturalHeight) {
        const fallback = new THREE.MeshBasicMaterial({ color: 0x6a4a30, depthWrite: true });
        this.crateTileMaterialCache.set(idx, fallback);
        return fallback;
      }
      const cols = 4;
      const rows = 5;
      const tw = Math.floor((sheet.naturalWidth || sheet.width) / cols);
      const th = Math.floor((sheet.naturalHeight || sheet.height) / rows);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const c = document.createElement('canvas');
      c.width = tw;
      c.height = th;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.drawImage(sheet, col * tw, row * th, tw, th, 0, 0, tw, th);
      const tex = this._makeTexture(c);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: false,
        depthWrite: true,
      });
      this.crateTileMaterialCache.set(idx, mat);
      return mat;
    }

    _clearGroup(group) {
      while (group.children.length > 0) {
        const c = group.children.pop();
        group.remove(c);
        if (c?.userData?.disposeOnClear) {
          try { c.geometry?.dispose?.(); } catch {}
          try {
            if (Array.isArray(c.material)) c.material.forEach((m) => m?.dispose?.());
            else c.material?.dispose?.();
          } catch {}
        }
      }
    }

    rebuildStaticWorld() {
      if (!this.ready || !this.state || !this.assets || !this.state.bunker) return;
      const THREE = this.THREE;
      this._clearGroup(this.staticGroup);
      this.raycastStatic = [];
      this.slotColliderByIndex.clear();
      this.treeSpriteMeshes.clear();
      this.wallMaterialCache.clear();
      this.crateTileMaterialCache.clear();

      const bunker = this.state.bunker;
      const isInsideBunker = this.state.isInsideBunker;
      const floorY = this.state.BUNKER_FLOOR_Y;
      const ceilY = this.state.BUNKER_WALL_HEIGHT;
      const panelSize = this.state.bunkerTileWorldWidth || 1;
      const floorboardsImg = this.assets?.floorboardsTiled;
      if (bunker && isInsideBunker && floorboardsImg?.naturalWidth) {
        const floorboardsTex = this._makeTexture(floorboardsImg);
        floorboardsTex.wrapS = floorboardsTex.wrapT = THREE.RepeatWrapping;
        floorboardsTex.repeat.set(1, 1);
        const panelMat = new THREE.MeshBasicMaterial({
          map: floorboardsTex,
          side: THREE.DoubleSide,
          depthWrite: true,
        });
        const panelGeom = new THREE.PlaneGeometry(panelSize, panelSize);
        for (let x = bunker.minX; x < bunker.maxX; x += panelSize) {
          for (let z = bunker.minZ; z < bunker.maxZ; z += panelSize) {
            const cx = x + panelSize * 0.5;
            const cz = z + panelSize * 0.5;
            if (!isInsideBunker(cx, cz)) continue;
            const floorMesh = new THREE.Mesh(panelGeom, panelMat);
            floorMesh.rotation.x = -Math.PI / 2;
            floorMesh.position.set(cx, floorY - 0.01, cz);
            this.staticGroup.add(floorMesh);
            const ceilMesh = new THREE.Mesh(panelGeom, panelMat);
            ceilMesh.rotation.x = Math.PI / 2;
            ceilMesh.position.set(cx, ceilY + 0.01, cz);
            this.staticGroup.add(ceilMesh);
          }
        }
      }

      for (const segment of this.state.bunkerWallSegments) {
        for (const tile of segment.tiles) {
          const key = spriteKeyForTile(tile, segment);
          const mat = this._getWallMaterial(key);
          const width = this.state.bunkerTileWorldWidth * Math.max(0.05, (tile.maxT - tile.minT) * segment.tiles.length);
          const geom = new THREE.PlaneGeometry(width, this.state.BUNKER_WALL_HEIGHT);
          const mesh = new THREE.Mesh(geom, mat);
          const tMid = (tile.minT + tile.maxT) * 0.5;
          const cx = segment.a.x + (segment.b.x - segment.a.x) * tMid;
          const cz = segment.a.z + (segment.b.z - segment.a.z) * tMid;
          mesh.position.set(cx, this.state.BUNKER_WALL_HEIGHT * 0.5, cz);
          const yaw = Math.atan2(segment.tangent.z, segment.tangent.x);
          mesh.rotation.y = -yaw;
          this.staticGroup.add(mesh);

          const collider = new THREE.Mesh(new THREE.PlaneGeometry(width, this.state.BUNKER_WALL_HEIGHT), new THREE.MeshBasicMaterial({ visible: false }));
          collider.position.copy(mesh.position);
          collider.rotation.copy(mesh.rotation);
          collider.userData = {
            kind: 'wallTile',
            spriteKey: key,
            opaque: OPAQUE_WALL_KEYS.has(key),
            segmentIndex: segment.index,
            tileIndex: tile.tileIndex,
          };
          this.staticGroup.add(collider);
          this.raycastStatic.push(collider);

          if (tile.tileIndex != null) {
            const slot = this.state.bunkerSlots.find((s) => s.segmentIndex === segment.index && s.tileIndex === tile.tileIndex);
            if (slot && (slot.type === 'window' || slot.type === 'crate')) {
              const si = this.state.bunkerSlots.indexOf(slot);
              if (!this.slotColliderByIndex.has(si)) {
                const slotGeom = new THREE.PlaneGeometry(this.state.bunkerTileWorldWidth * 0.85, this.state.BUNKER_WALL_HEIGHT * 0.9);
                const slotCollider = new THREE.Mesh(slotGeom, new THREE.MeshBasicMaterial({ visible: false }));
                const sx = (slot.wallX ?? slot.x) + (slot.normal?.x || 0) * 0.02;
                const sz = (slot.wallZ ?? slot.z) + (slot.normal?.z || 0) * 0.02;
                slotCollider.position.set(sx, this.state.BUNKER_WALL_HEIGHT * 0.5, sz);
                const syaw = Math.atan2(slot.tangent?.z ?? 0, slot.tangent?.x ?? 1);
                slotCollider.rotation.y = -syaw;
                slotCollider.userData = { kind: slot.type, slotIndex: si };
                this.staticGroup.add(slotCollider);
                this.raycastStatic.push(slotCollider);
                this.slotColliderByIndex.set(si, slotCollider);
              }
            }
          }
        }
      }

      const crate = this.state.getCrateAABB?.();
      if (crate) {
        const cw = Math.max(0.05, crate.maxX - crate.minX);
        const ch = Math.max(0.05, crate.maxY - crate.minY);
        const cd = Math.max(0.05, crate.maxZ - crate.minZ);
        const cgeom = new THREE.BoxGeometry(cw, ch, cd);
        const seedBase = ((Math.floor((crate.minX + crate.maxX) * 100) * 73856093) ^ (Math.floor((crate.minZ + crate.maxZ) * 100) * 19349663) ^ 0x9e3779b9) >>> 0;
        let s = seedBase || 1;
        const nextTile = () => {
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          return s % 20;
        };
        const mats = [
          this._getCrateTileMaterial(nextTile()), // right
          this._getCrateTileMaterial(nextTile()), // left
          this._getCrateTileMaterial(nextTile()), // top
          this._getCrateTileMaterial(nextTile()), // bottom
          this._getCrateTileMaterial(nextTile()), // front
          this._getCrateTileMaterial(nextTile()), // back
        ];
        const cmesh = new THREE.Mesh(cgeom, mats);
        cmesh.position.set((crate.minX + crate.maxX) * 0.5, (crate.minY + crate.maxY) * 0.5, (crate.minZ + crate.maxZ) * 0.5);
        this.staticGroup.add(cmesh);

        const cc = new THREE.Mesh(cgeom.clone(), new THREE.MeshBasicMaterial({ visible: false }));
        cc.position.copy(cmesh.position);
        cc.userData = { kind: 'crate' };
        this.staticGroup.add(cc);
        this.raycastStatic.push(cc);
      }

      // Trees are static world props: build once per static rebuild.
      const treeList = this.state.trees || [];
      for (let i = 0; i < treeList.length; i++) {
        const t = treeList[i];
        const treeId = Number.isFinite(t?.id) ? Math.floor(t.id) : i;
        const tex = this._getTreeTexture(t.spriteIndex);
        if (!tex) continue;
        const spriteMat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.3,
          depthWrite: true,
        });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(t.x, this.state.TREE_HEIGHT * 0.5, t.z);
        sprite.scale.set(this.state.TREE_HEIGHT, this.state.TREE_HEIGHT, 1);
        sprite.userData = { kind: 'tree', index: i, treeId };
        this.staticGroup.add(sprite);
        this.raycastStatic.push(sprite);
        this.treeSpriteMeshes.set(treeId, sprite);
      }
    }

    _lookAtCamera(mesh) {
      mesh.lookAt(this.camera.position.x, mesh.position.y, this.camera.position.z);
    }

    _getTreeTexture(spriteIndex) {
      const key = String(spriteIndex ?? 0);
      if (this.treeTextureCache.has(key)) return this.treeTextureCache.get(key);
      const sheet = this.assets?.retrotree;
      if (!sheet) return null;
      const c = document.createElement('canvas');
      c.width = this.state.TREE_SPRITE_SIZE;
      c.height = this.state.TREE_SPRITE_SIZE;
      const cx = c.getContext('2d');
      const cell = this.state.getTreeGridCell(spriteIndex);
      cx.imageSmoothingEnabled = false;
      cx.drawImage(sheet, cell.col * this.state.TREE_SPRITE_SIZE, cell.row * this.state.TREE_SPRITE_SIZE, this.state.TREE_SPRITE_SIZE, this.state.TREE_SPRITE_SIZE, 0, 0, this.state.TREE_SPRITE_SIZE, this.state.TREE_SPRITE_SIZE);
      const tex = this._makeTexture(c);
      this.treeTextureCache.set(key, tex);
      return tex;
    }

    _drawHolePath(ctx, hole) {
      if (!hole) return false;
      const hx = Number(hole.tx) || 0;
      const hy = Number(hole.ty) || 0;
      const radii = hole.jaggedRadii;
      ctx.beginPath();
      if (Array.isArray(radii) && radii.length > 2) {
        for (let i = 0; i < radii.length; i++) {
          const angle = (i / radii.length) * Math.PI * 2;
          const r = Number(radii[i]) || 0;
          const px = hx + Math.cos(angle) * r;
          const py = hy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        return true;
      }
      ctx.arc(hx, hy, 10, 0, Math.PI * 2);
      return true;
    }

    _getTreeTextureForTree(tree, fallbackIndex = 0) {
      const treeId = Number.isFinite(tree?.id) ? Math.floor(tree.id) : fallbackIndex;
      const holes = tree?.holes || [];
      if (!holes.length) return this._getTreeTexture(tree?.spriteIndex);
      const version = Number.isFinite(tree?.holeVersion) ? Math.floor(tree.holeVersion) : holes.length;
      let entry = this.treeHoleTextureCache.get(treeId);
      const cell = this.state.getTreeGridCell(tree?.spriteIndex);
      const sheet = this.assets?.retrotree;
      if (!sheet || !cell) return this._getTreeTexture(tree?.spriteIndex);
      if (!entry) {
        const c = document.createElement('canvas');
        c.width = this.state.TREE_SPRITE_SIZE;
        c.height = this.state.TREE_SPRITE_SIZE;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        const tex = this._makeTexture(c);
        entry = { canvas: c, ctx: cx, texture: tex, lastVersion: -1, lastSpriteIndex: null };
        this.treeHoleTextureCache.set(treeId, entry);
      }
      if (entry.lastVersion !== version || entry.lastSpriteIndex !== tree?.spriteIndex) {
        const cx = entry.ctx;
        cx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        cx.drawImage(
          sheet,
          cell.col * this.state.TREE_SPRITE_SIZE,
          cell.row * this.state.TREE_SPRITE_SIZE,
          this.state.TREE_SPRITE_SIZE,
          this.state.TREE_SPRITE_SIZE,
          0,
          0,
          this.state.TREE_SPRITE_SIZE,
          this.state.TREE_SPRITE_SIZE,
        );
        cx.save();
        cx.globalCompositeOperation = 'destination-out';
        cx.fillStyle = '#000';
        for (const hole of holes) {
          if (this._drawHolePath(cx, hole)) cx.fill();
        }
        cx.restore();
        entry.texture.needsUpdate = true;
        entry.lastVersion = version;
        entry.lastSpriteIndex = tree?.spriteIndex;
      }
      return entry.texture;
    }

    _getZombieTexture(img) {
      const key = img?.src || 'zombie';
      if (this.zombieTextureCache.has(key)) return this.zombieTextureCache.get(key);
      const tex = this._makeTexture(img);
      this.zombieTextureCache.set(key, tex);
      return tex;
    }

    _getZombieTextureForZombie(z, fallbackIndex = 0) {
      const holes = z?.holes || [];
      const img = z?.sprite || this.assets?.zombie;
      if (!holes.length) return this._getZombieTexture(img);
      const zombieId = Number.isFinite(z?.spawnIndex) ? Math.floor(z.spawnIndex) : fallbackIndex;
      const version = Number.isFinite(z?.holeVersion) ? Math.floor(z.holeVersion) : holes.length;
      const w = Math.max(1, Math.floor(z?.spriteW ?? this.state.ZOMBIE_SPRITE_W));
      const h = Math.max(1, Math.floor(z?.spriteH ?? this.state.ZOMBIE_SPRITE_H));
      const imgKey = `${img?.src || 'z'}:${w}x${h}`;
      let entry = this.zombieHoleTextureCache.get(zombieId);
      if (!entry || entry.w !== w || entry.h !== h) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        const tex = this._makeTexture(c);
        entry = { canvas: c, ctx: cx, texture: tex, lastVersion: -1, lastImgKey: '', w, h };
        this.zombieHoleTextureCache.set(zombieId, entry);
      }
      if (entry.lastVersion !== version || entry.lastImgKey !== imgKey) {
        const cx = entry.ctx;
        cx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        cx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
        cx.save();
        cx.globalCompositeOperation = 'destination-out';
        cx.fillStyle = '#000';
        for (const hole of holes) {
          if (this._drawHolePath(cx, hole)) cx.fill();
        }
        cx.restore();
        entry.texture.needsUpdate = true;
        entry.lastVersion = version;
        entry.lastImgKey = imgKey;
      }
      return entry.texture;
    }

    _syncTreeHoleSprites() {
      const treeList = this.state?.trees || [];
      const liveTreeIds = new Set();
      for (let i = 0; i < treeList.length; i++) {
        const t = treeList[i];
        const treeId = Number.isFinite(t?.id) ? Math.floor(t.id) : i;
        liveTreeIds.add(treeId);
        const sprite = this.treeSpriteMeshes.get(treeId);
        if (!sprite) continue;
        const tex = this._getTreeTextureForTree(t, i);
        if (sprite.material?.map !== tex) {
          sprite.material.map = tex;
          sprite.material.needsUpdate = true;
        }
        sprite.visible = true;
        sprite.position.set(t.x, this.state.TREE_HEIGHT * 0.5, t.z);
        sprite.userData.index = i;
      }
      for (const [treeId, sprite] of this.treeSpriteMeshes) {
        if (!liveTreeIds.has(treeId)) sprite.visible = false;
      }
      for (const [treeId, entry] of this.treeHoleTextureCache) {
        if (liveTreeIds.has(treeId)) continue;
        try { entry.texture?.dispose?.(); } catch {}
        this.treeHoleTextureCache.delete(treeId);
      }
    }

    _getPlayerTexture(img) {
      const key = img?.src || 'player';
      if (this.playerTextureCache.has(key)) return this.playerTextureCache.get(key);
      const tex = this._makeTexture(img);
      this.playerTextureCache.set(key, tex);
      return tex;
    }

    _addBillboard(width, height, x, y, z, texture, userData = null) {
      const THREE = this.THREE;
      if (!texture) return null;
      const matKey = `${texture.uuid}|bb`;
      let mat = this.dynamicMaterialCache.get(matKey);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.3,
          depthWrite: true,
          side: THREE.DoubleSide,
        });
        this.dynamicMaterialCache.set(matKey, mat);
      }
      const gKey = `${width.toFixed(4)}x${height.toFixed(4)}`;
      let geom = this.planeGeometryCache.get(gKey);
      if (!geom) {
        geom = new THREE.PlaneGeometry(width, height);
        this.planeGeometryCache.set(gKey, geom);
      }
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y, z);
      this._lookAtCamera(mesh);
      if (userData) mesh.userData = userData;
      this.dynamicGroup.add(mesh);
      return mesh;
    }

    _syncZombieMeshes() {
      if (!this.state) return [];
      const out = [];
      const zombieCount = this.state.zombies.length;
      const liveZombieIds = new Set();
      for (let i = 0; i < zombieCount; i++) {
        const z = this.state.zombies[i];
        const zombieId = Number.isFinite(z?.spawnIndex) ? Math.floor(z.spawnIndex) : i;
        liveZombieIds.add(zombieId);
        const bob = z.bob ?? 0;
        const tex = this._getZombieTextureForZombie(z, i);
        if (!tex) continue;
        const h = this.state.ZOMBIE_REF_HEIGHT;
        const w = h * ((z.spriteW ?? this.state.ZOMBIE_SPRITE_W) / Math.max(1, (z.spriteH ?? this.state.ZOMBIE_SPRITE_H)));
        const gKey = `${w.toFixed(4)}x${h.toFixed(4)}`;
        let geom = this.planeGeometryCache.get(gKey);
        if (!geom) {
          geom = new this.THREE.PlaneGeometry(w, h);
          this.planeGeometryCache.set(gKey, geom);
        }
        const matKey = `${tex.uuid}|bb`;
        let mat = this.dynamicMaterialCache.get(matKey);
        if (!mat) {
          mat = new this.THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.3,
            depthWrite: true,
            side: this.THREE.DoubleSide,
          });
          this.dynamicMaterialCache.set(matKey, mat);
        }
        let mesh = this.zombieMeshes[i];
        if (!mesh) {
          mesh = new this.THREE.Mesh(geom, mat);
          mesh.userData = { kind: 'zombie', index: i, gKey };
          this.zombieGroup.add(mesh);
          this.zombieMeshes.push(mesh);
        } else {
          if (mesh.userData?.gKey !== gKey) {
            mesh.geometry = geom;
            mesh.userData.gKey = gKey;
          }
          if (mesh.material !== mat) mesh.material = mat;
          mesh.userData.index = i;
        }
        mesh.visible = true;
        mesh.position.set(z.x, (z.y ?? 0) + bob + h * 0.5, z.z);
        this._lookAtCamera(mesh);
        out.push(mesh);
      }
      for (let i = zombieCount; i < this.zombieMeshes.length; i++) {
        this.zombieMeshes[i].visible = false;
      }
      for (const [zombieId, entry] of this.zombieHoleTextureCache) {
        if (liveZombieIds.has(zombieId)) continue;
        const matKey = `${entry.texture?.uuid}|bb`;
        const mat = this.dynamicMaterialCache.get(matKey);
        if (mat) {
          try { mat.dispose?.(); } catch {}
          this.dynamicMaterialCache.delete(matKey);
        }
        try { entry.texture?.dispose?.(); } catch {}
        this.zombieHoleTextureCache.delete(zombieId);
      }
      return out;
    }

    _syncDynamic() {
      this._clearGroup(this.dynamicGroup);
      this.raycastDynamic = [];
      if (!this.state) return;
      this._syncTreeHoleSprites();

      const zombieMeshes = this._syncZombieMeshes();
      for (const m of zombieMeshes) this.raycastDynamic.push(m);

      const remotePlayers = this.state.getRemotePlayers();
      for (const rp of remotePlayers) {
        const tex = this._getPlayerTexture(rp.img);
        const h = this.state.MP_SPRITE_HEIGHT;
        const m = this._addBillboard(h * (0.62), h, rp.x, rp.y + h * 0.5, rp.z, tex, { kind: 'mp', playerId: rp.playerId });
        if (m) this.raycastDynamic.push(m);
      }

      const boardImg = this.assets?.board;
      if (boardImg) {
        const tex = this.boardTexture || this._makeTexture(boardImg);
        this.boardTexture = tex;
        const THREE = this.THREE;
        const boardMatKey = `${tex.uuid}|board`;
        let boardMat = this.dynamicMaterialCache.get(boardMatKey);
        if (!boardMat) {
          boardMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.2, depthWrite: true, side: THREE.DoubleSide });
          this.dynamicMaterialCache.set(boardMatKey, boardMat);
        }
        for (const b of this.state.getBoardInstances()) {
          const gKey = `${b.w.toFixed(4)}x${b.h.toFixed(4)}`;
          let geom = this.planeGeometryCache.get(gKey);
          if (!geom) {
            geom = new THREE.PlaneGeometry(b.w, b.h);
            this.planeGeometryCache.set(gKey, geom);
          }
          if (b.type === 'wall') {
            const mesh = new THREE.Mesh(geom, boardMat);
            mesh.position.set(b.x, b.y, b.z);
            mesh.rotation.y = -(b.segmentYaw ?? -b.yaw - Math.PI / 2);
            mesh.rotation.z = b.rot || 0;
            this.dynamicGroup.add(mesh);
          } else if (b.type === 'floor') {
            const mesh = new THREE.Mesh(geom, boardMat);
            mesh.position.set(b.x, b.y, b.z);
            mesh.rotation.x = 0;
            mesh.rotation.y = -(b.slotYaw ?? 0);
            mesh.rotation.z = b.rot || 0;
            this.dynamicGroup.add(mesh);
          } else if (b.type === 'placing') {
            const t = b.t;
            const x = b.fromX + (b.toX - b.fromX) * t;
            const y = b.fromY + (b.toY - b.fromY) * t;
            const z = b.fromZ + (b.toZ - b.fromZ) * t;
            const mesh = new THREE.Mesh(geom, boardMat);
            mesh.position.set(x, y, z);
            mesh.rotation.x = 0;
            mesh.rotation.y = -(b.slotYaw ?? 0);
            mesh.rotation.z = (b.fromRot || 0) + ((b.toRot || 0) - (b.fromRot || 0)) * t;
            this.dynamicGroup.add(mesh);
          }
        }
      }

      const tracerItems = this.state.getTracerInstances?.() || [];
      if (tracerItems.length) {
        const THREE = this.THREE;
        for (const t of tracerItems) {
          const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(t.fromX, t.fromY, t.fromZ),
            new THREE.Vector3(t.toX, t.toY, t.toZ),
          ]);
          const m = new THREE.LineBasicMaterial({
            color: 0xfff4c8,
            transparent: true,
            opacity: Math.max(0, Math.min(1, t.alpha ?? 1)),
            depthTest: true,
            depthWrite: false,
          });
          const line = new THREE.Line(g, m);
          line.userData = { disposeOnClear: true };
          this.dynamicGroup.add(line);
        }
      }
    }

    _setCameraFromState() {
      const s = this.state;
      this.camera.fov = (s.getFOV() * 180) / Math.PI;
      this.camera.near = s.NEAR;
      this.camera.far = s.FAR;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(s.cameraX, s.CAMERA_Y, s.cameraZ);
      const dir = s.getViewForward();
      this.camera.lookAt(s.cameraX + dir.x, s.CAMERA_Y + dir.y, s.cameraZ + dir.z);
    }

    render() {
      if (!this.ready || !this.state) return;
      this._setCameraFromState();
      this._syncDynamic();
      this.renderer.render(this.scene, this.camera);
    }

    _raycast(px, py) {
      if (!this.ready) return [];
      if (this.state) this._setCameraFromState();
      const THREE = this.THREE;
      this._rayNdc = this._rayNdc || new THREE.Vector2();
      this._raycaster = this._raycaster || new THREE.Raycaster();
      this._rayNdc.set((px / this.width) * 2 - 1, -((py / this.height) * 2 - 1));
      this._raycaster.setFromCamera(this._rayNdc, this.camera);
      const objs = this.raycastStatic.concat(this.raycastDynamic);
      return this._raycaster.intersectObjects(objs, false);
    }

    pickFirst(px, py, kinds) {
      const allowed = new Set(kinds || []);
      const hits = this._raycast(px, py);
      for (const hit of hits) {
        const k = hit.object?.userData?.kind;
        if (k === 'wallTile' && hit.object.userData.opaque) return null;
        if (!k || (allowed.size && !allowed.has(k))) continue;
        return { kind: k, userData: hit.object.userData, point: hit.point, distance: hit.distance };
      }
      return null;
    }

    canShotLeaveWindow(px, py) {
      const hits = this._raycast(px, py);
      for (const hit of hits) {
        const k = hit.object?.userData?.kind;
        if (k !== 'wallTile') continue;
        return !hit.object.userData.opaque;
      }
      return true;
    }
  }

  window.WorldRenderer3D = WorldRenderer3D;
})();

