(function () {
  function makeBunkerShape(THREE, corners) {
    const shape = new THREE.Shape();
    if (!corners?.length) return shape;
    shape.moveTo(corners[0].x, corners[0].z);
    for (let i = 1; i < corners.length; i++) shape.lineTo(corners[i].x, corners[i].z);
    shape.lineTo(corners[0].x, corners[0].z);
    return shape;
  }

  function makeFloorGeometry(THREE, corners, y) {
    const g = new THREE.ShapeGeometry(makeBunkerShape(THREE, corners));
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  }

  function makeCeilingGeometry(THREE, corners, y) {
    const g = new THREE.ShapeGeometry(makeBunkerShape(THREE, corners));
    g.rotateX(Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  }

  window.BunkerGeometry3D = {
    makeBunkerShape,
    makeFloorGeometry,
    makeCeilingGeometry,
  };
})();

