// The boolean evaluation of a group, written against whichever THREE and CSG it is handed so
// the page (synchronously) and js/csg-worker.js (off the main thread) run literally the same
// code and cannot drift apart.
//
//   parts: [{ geometry, matrix: number[16] (the part's matrix relative to the group), isHole }]
//
// Returns { geometry, center }: the union of the solids minus the holes, re-centred on its
// bounding box, with `center` being where that box's middle was in group space.
export function evaluateParts(THREE, CSG, parts) {
    const solids = parts.filter(p => !p.isHole);
    const holes = parts.filter(p => p.isHole);
    if (solids.length === 0) throw new Error('Cannot group only holes. Please include at least one solid.');

    const dummy = new THREE.MeshBasicMaterial();
    const build = part => {
        const mesh = new THREE.Mesh(part.geometry, dummy);
        mesh.matrix.fromArray(part.matrix);
        mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        return mesh;
    };
    // three-csg-ts returns its result carrying the first operand's transform; bake it in
    // so the next operation starts from identity.
    const bake = temp => {
        temp.geometry.applyMatrix4(temp.matrix);
        temp.position.set(0, 0, 0); temp.rotation.set(0, 0, 0); temp.scale.set(1, 1, 1);
        temp.updateMatrixWorld(true);
        return temp;
    };

    let result = build(solids[0]);
    for (let i = 1; i < solids.length; i++) {
        const temp = CSG.union(result, build(solids[i]));
        if (temp) result = bake(temp);
    }
    for (const hole of holes) {
        const temp = CSG.subtract(result, build(hole));
        if (temp) result = bake(temp);
    }

    let geometry = result.geometry;
    if (parts.some(p => p.geometry === geometry)) geometry = geometry.clone(); // never re-centre a caller's own geometry
    if (!geometry.attributes.position || geometry.attributes.position.count === 0) {
        throw new Error('The boolean operation left nothing — the shapes may not overlap as intended, or a mesh is not watertight.');
    }
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    return { geometry, center };
}
