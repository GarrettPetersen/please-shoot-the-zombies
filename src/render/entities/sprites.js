(function () {
  function makeBillboard(THREE, width, height, material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.frustumCulled = true;
    return mesh;
  }

  function faceCameraY(mesh, camera) {
    mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
  }

  window.SpriteEntities3D = {
    makeBillboard,
    faceCameraY,
  };
})();

