// Runs group booleans off the main thread so a large union does not freeze the page.
// Same code as the synchronous path (js/csg-core.js), fed plain typed arrays.
import { CSG } from '../vendor/three-csg-ts/csg.js';
import * as THREE from '../vendor/three-csg-ts/three.module.js';
import { evaluateParts } from './csg-core.js';

self.onmessage = ({ data: { id, parts } }) => {
    try {
        const built = parts.map(p => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
            return { geometry, matrix: p.matrix, isHole: p.isHole };
        });
        const { geometry, center } = evaluateParts(THREE, CSG, built);
        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal ? geometry.attributes.normal.array : null;
        self.postMessage({ id, positions, normals, center: center.toArray() }, [positions.buffer, ...(normals ? [normals.buffer] : [])]);
    } catch (err) {
        self.postMessage({ id, error: err.message || String(err) });
    }
};
