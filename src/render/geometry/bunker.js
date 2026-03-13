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
    const reversed = Array.isArray(corners) ? [...corners].reverse() : [];
    const g = new THREE.ShapeGeometry(makeBunkerShape(THREE, reversed));
    g.rotateX(Math.PI / 2);
    g.translate(0, y, 0);
    const index = g.index;
    if (index) {
      const arr = index.array;
      for (let i = 0; i < arr.length; i += 3) {
        const a = arr[i];
        arr[i] = arr[i + 2];
        arr[i + 2] = a;
      }
      index.needsUpdate = true;
    }
    return g;
  }

  window.BunkerGeometry3D = {
    makeBunkerShape,
    makeFloorGeometry,
    makeCeilingGeometry,
  };
})();

