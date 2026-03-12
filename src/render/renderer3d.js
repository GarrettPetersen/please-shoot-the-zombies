(function () {
  const OPAQUE_WALL_KEYS = new Set(['wall', 'wall_ammo', 'wall_ammo_mirrored', 'wall_tally', 'wall_tally_mirrored', 'ammo']);

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

  function makeShapeFromCorners(THREE, corners, holes) {
    const shape = new THREE.Shape();
    if (!corners?.length) return shape;
    shape.moveTo(corners[0].x, corners[0].z);
    for (let i = 1; i < corners.length; i++) shape.lineTo(corners[i].x, corners[i].z);
    shape.lineTo(corners[0].x, corners[0].z);
    if (holes?.length) {
      for (const hole of holes) {
        if (!hole?.length) continue;
        const holeShape = new THREE.Shape();
        holeShape.moveTo(hole[0].x, hole[0].z);
        for (let i = 1; i < hole.length; i++) holeShape.lineTo(hole[i].x, hole[i].z);
        holeShape.lineTo(hole[0].x, hole[0].z);
        shape.holes.push(holeShape);
      }
    }
    return shape;
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
      this.treeTextureCache = new Map();
      this.zombieTextureCache = new Map();
      this.playerTextureCache = new Map();
      this.boardTexture = null;
      this.slotColliderByIndex = new Map();
      this.raycastStatic = [];
      this.raycastDynamic = [];

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
      this.scene.add(this.staticGroup);
      this.scene.add(this.dynamicGroup);
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
      this.scene.fog = new THREE.FogExp2(state.FOG_COLOR || 0x3a4555, state.FOG_DENSITY ?? 0.028);
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

    _materialFromImage(img, { alphaTest = 0.3, doubleSide = true, transparent = true } = {}) {
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
      const mat = this._materialFromImage(img, { alphaTest: 0.2, transparent: true });
      this.wallMaterialCache.set(key, mat);
      return mat;
    }

    _clearGroup(group) {
      while (group.children.length > 0) {
        const c = group.children.pop();
        group.remove(c);
      }
    }

    rebuildStaticWorld() {
      if (!this.ready || !this.state || !this.assets || !this.state.bunker) return;
      const THREE = this.THREE;
      this._clearGroup(this.staticGroup);
      this.raycastStatic = [];
      this.slotColliderByIndex.clear();

      const bunker = this.state.bunker;
      const corners = bunker.corners || [];
      if (corners.length >= 3) {
        const holes = bunker.holes || [];
        let shape = makeShapeFromCorners(THREE, corners, holes);
        let floorGeom;
        try {
          floorGeom = new THREE.ShapeGeometry(shape);
          if (!floorGeom.attributes.position || floorGeom.attributes.position.count === 0) throw new Error('empty');
        } catch (e) {
          shape = makeShapeFromCorners(THREE, corners, []);
          floorGeom = new THREE.ShapeGeometry(shape);
        }
        floorGeom.rotateX(-Math.PI / 2);
        floorGeom.translate(0, this.state.BUNKER_FLOOR_Y, 0);
        const floorMat = new THREE.MeshBasicMaterial({ color: 0x201912, side: THREE.DoubleSide, depthWrite: true });
        this.staticGroup.add(new THREE.Mesh(floorGeom, floorMat));

        const ceilGeom = new THREE.ShapeGeometry(shape);
        ceilGeom.rotateX(Math.PI / 2);
        ceilGeom.translate(0, this.state.BUNKER_WALL_HEIGHT, 0);
        const ceilMat = new THREE.MeshBasicMaterial({ color: 0x110d0a, side: THREE.DoubleSide, depthWrite: true });
        this.staticGroup.add(new THREE.Mesh(ceilGeom, ceilMat));
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
        const cm = new THREE.MeshBasicMaterial({ color: 0x6a4a30 });
        const cmesh = new THREE.Mesh(cgeom, cm);
        cmesh.position.set((crate.minX + crate.maxX) * 0.5, (crate.minY + crate.maxY) * 0.5, (crate.minZ + crate.maxZ) * 0.5);
        this.staticGroup.add(cmesh);

        const cc = new THREE.Mesh(cgeom.clone(), new THREE.MeshBasicMaterial({ visible: false }));
        cc.position.copy(cmesh.position);
        cc.userData = { kind: 'crate' };
        this.staticGroup.add(cc);
        this.raycastStatic.push(cc);
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

    _getZombieTexture(img) {
      const key = img?.src || 'zombie';
      if (this.zombieTextureCache.has(key)) return this.zombieTextureCache.get(key);
      const tex = this._makeTexture(img);
      this.zombieTextureCache.set(key, tex);
      return tex;
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
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.3,
        depthWrite: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      mesh.position.set(x, y, z);
      this._lookAtCamera(mesh);
      if (userData) mesh.userData = userData;
      this.dynamicGroup.add(mesh);
      return mesh;
    }

    _syncDynamic() {
      this._clearGroup(this.dynamicGroup);
      this.raycastDynamic = [];
      if (!this.state) return;

      for (let i = 0; i < this.state.trees.length; i++) {
        const t = this.state.trees[i];
        const tex = this._getTreeTexture(t.spriteIndex);
        const m = this._addBillboard(this.state.TREE_HEIGHT, this.state.TREE_HEIGHT, t.x, this.state.TREE_HEIGHT * 0.5, t.z, tex, { kind: 'tree', index: i });
        if (m) this.raycastDynamic.push(m);
      }

      for (let i = 0; i < this.state.zombies.length; i++) {
        const z = this.state.zombies[i];
        const bob = z.bob ?? 0;
        const tex = this._getZombieTexture(z.sprite || this.assets?.zombie);
        const h = this.state.ZOMBIE_REF_HEIGHT;
        const m = this._addBillboard(h * ((z.spriteW ?? this.state.ZOMBIE_SPRITE_W) / Math.max(1, (z.spriteH ?? this.state.ZOMBIE_SPRITE_H))), h, z.x, (z.y ?? 0) + bob + h * 0.5, z.z, tex, { kind: 'zombie', index: i });
        if (m) this.raycastDynamic.push(m);
      }

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
        for (const b of this.state.getBoardInstances()) {
          if (b.type === 'wall') {
            const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.2, depthWrite: true, side: THREE.DoubleSide });
            const geom = new THREE.PlaneGeometry(b.w, b.h);
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(b.x, b.y, b.z);
            mesh.rotation.y = -b.yaw - Math.PI / 2;
            mesh.rotation.z = b.rot || 0;
            this.dynamicGroup.add(mesh);
          } else if (b.type === 'floor') {
            const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.2, depthWrite: true, side: THREE.DoubleSide });
            const geom = new THREE.PlaneGeometry(b.w, b.h);
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(b.x, b.y, b.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.y = (b.slotYaw ?? 0) + (b.rot || 0);
            this.dynamicGroup.add(mesh);
          } else if (b.type === 'placing') {
            const t = b.t;
            const x = b.fromX + (b.toX - b.fromX) * t;
            const y = b.fromY + (b.toY - b.fromY) * t;
            const z = b.fromZ + (b.toZ - b.fromZ) * t;
            const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.2, depthWrite: true, side: THREE.DoubleSide });
            const geom = new THREE.PlaneGeometry(b.w, b.h);
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(x, y, z);
            mesh.rotation.x = -Math.PI / 2 + t * (Math.PI / 2);
            mesh.rotation.y = (b.fromRot || 0) + t * (-b.slotYaw - Math.PI / 2 - (b.fromRot || 0));
            mesh.rotation.z = t * (b.toRot || 0);
            this.dynamicGroup.add(mesh);
          }
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
      const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -((py / this.height) * 2 - 1));
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, this.camera);
      const objs = this.raycastStatic.concat(this.raycastDynamic);
      return raycaster.intersectObjects(objs, false);
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

