(function () {
  function makeNearestTexture(THREE, source) {
    const tex = new THREE.Texture(source);
    tex.needsUpdate = true;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  function makeCutoutMaterial(THREE, source, alphaTest = 0.3) {
    return new THREE.MeshBasicMaterial({
      map: makeNearestTexture(THREE, source),
      transparent: true,
      alphaTest,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
  }

  function makeOpaqueMaterial(THREE, color) {
    return new THREE.MeshBasicMaterial({ color, depthWrite: true });
  }

  window.RenderMaterials = {
    makeNearestTexture,
    makeCutoutMaterial,
    makeOpaqueMaterial,
  };
})();

