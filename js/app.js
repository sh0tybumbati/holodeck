import { CSG } from 'https://cdn.jsdelivr.net/npm/three-csg-ts@3.1.11/+esm';

// Basic Three.js setup
let scene, camera, renderer, controls, transformControl, selectionBox;
let selectionDiv;
let isAreaSelecting = false;
let selectionStartPoint = new THREE.Vector2();
let shapes = [];
let selectedShapes = []; // Multi-select support
let selectedShape = null; // Current single selection
let currentPropertyNode = null;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let isMobile = /Android|iPhone|iPad|iPod|mobile/i.test(navigator.userAgent);

// Camera and Projection
let activeCamera;
let orthoCamera;
let isOrthographic = false;

// Post Processing & Outlines
let composer, outlinePass;

// Properties Preview
let previewScene, previewCamera, previewRenderer, previewMesh;
let previewControls = null;


// Alignment Gizmo
let isAlignMode = false;
let isDistributeMode = false;
let alignmentGizmo = null;
let focusedAlignObject = null;
let pointerDownPos = new THREE.Vector2();

// ViewCube
let viewcubeScene, viewcubeCamera, viewcubeRenderer, viewcubeMesh, viewcubeHoverMesh;
let viewcubeRaycaster = new THREE.Raycaster();
let viewcubeMouse = new THREE.Vector2();
let viewcubeControls = null;
let isDraggingViewCube = false;
let isDraggingViewCubeDragOccurred = false;

// CSS2DRenderer & Dimensions
let labelRenderer;
let dimGroup = null;

// Grid settings
let gridHelper = null;
let gridVisible = true;
let unitMode = 'cm'; // 'cm' or 'inch'
let gridSize = 20;

// Snap settings
let snapEnabled = true;
let snapPrecision = 1; // mm

// Variables System
window.holodeckVariables = {};
let variableCounter = 1;

let dragStartScale = new THREE.Vector3();

// Wire Routing State
let isWiringMode = false;
let wirePoints = [];
let wirePreviewLine = null;
let wirePreviewSphere = null;

// BOM state
let bomItems = [];
function renderBOM() {
    const list = document.getElementById('bom-list');
    if (!list) return;
    list.innerHTML = '';
    let total = 0;
    bomItems.forEach((item, index) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '4px';
        row.style.borderBottom = '1px solid rgba(0,0,0,0.1)';
        
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = item.name || 'Item';
        nameInput.style.width = '100px';
        nameInput.style.background = 'transparent';
        nameInput.style.border = 'none';
        nameInput.style.color = 'inherit';
        nameInput.addEventListener('change', (e) => {
            item.name = e.target.value;
            historyManager.saveState();
        });

        const priceInput = document.createElement('input');
        priceInput.type = 'number';
        priceInput.value = item.price || 0;
        priceInput.step = '0.01';
        priceInput.style.width = '50px';
        priceInput.style.background = 'transparent';
        priceInput.style.border = 'none';
        priceInput.style.color = 'inherit';
        priceInput.addEventListener('change', (e) => {
            item.price = parseFloat(e.target.value) || 0;
            renderBOM();
            historyManager.saveState();
        });

        const qtyInput = document.createElement('input');
        qtyInput.type = 'number';
        qtyInput.value = item.quantity || 1;
        qtyInput.style.width = '40px';
        qtyInput.style.background = 'transparent';
        qtyInput.style.border = 'none';
        qtyInput.style.color = 'inherit';
        qtyInput.addEventListener('change', (e) => {
            item.quantity = parseInt(e.target.value) || 1;
            renderBOM();
            historyManager.saveState();
        });
        
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.style.background = 'none';
        delBtn.style.border = 'none';
        delBtn.style.cursor = 'pointer';
        delBtn.style.color = 'inherit';
        delBtn.addEventListener('click', () => {
            bomItems.splice(index, 1);
            renderBOM();
            historyManager.saveState();
        });

        row.appendChild(nameInput);
        row.appendChild(qtyInput);
        row.appendChild(priceInput);
        row.appendChild(delBtn);
        list.appendChild(row);

        total += (item.price || 0) * (item.quantity || 1);
    });
    const totalEl = document.getElementById('bom-total');
    if (totalEl) totalEl.innerText = `$${total.toFixed(2)}`;
}


function init() {
    // Scene
    scene = new THREE.Scene();

    // Cameras
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(10, 10, 10);
    
    orthoCamera = new THREE.OrthographicCamera(
        window.innerWidth / -2, window.innerWidth / 2,
        window.innerHeight / 2, window.innerHeight / -2,
        0.1, 1000
    );
    activeCamera = camera;

    // WebGL Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);
    
    // CSS2D Renderer for Drafting Dimensions
    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.getElementById('canvas-container').appendChild(labelRenderer.domElement);

    // Orbit Controls
    controls = new THREE.OrbitControls(activeCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.panSpeed = 0.8;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.screenSpacePanning = true;

    // Transform Controls
    transformControl = new THREE.TransformControls(activeCamera, renderer.domElement);
    transformControl.addEventListener('dragging-changed', function (event) {
        controls.enabled = !event.value;
        if (event.value && selectedShape) {
            dragStartScale.copy(selectedShape.scale);
        } else if (!event.value && selectedShape) {
            // Update Properties panel on drag end
            if (currentPropertyNode === selectedShape) {
                selectPropertyNode(selectedShape);
            }
            historyManager.saveState();
        }
    });
    
    transformControl.addEventListener('change', function () {
        if (transformControl.getMode() === 'scale' && selectedShapes.length === 1 && transformControl.dragging) {
            let base = selectedShape.userData.baseSize;
            if (!base) {
                selectedShape.geometry.computeBoundingBox();
                const sz = new THREE.Vector3();
                selectedShape.geometry.boundingBox.getSize(sz);
                base = { x: sz.x || 1, y: sz.y || 1, z: sz.z || 1 };
            }
            
            const worldSnap = unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10;
            
            if (snapEnabled) {
                const rawScale = selectedShape.scale.clone();
                ['x', 'y', 'z'].forEach(axis => {
                    const currentDim = rawScale[axis] * base[axis];
                    const snappedDim = Math.max(worldSnap, Math.round(currentDim / worldSnap) * worldSnap);
                    selectedShape.scale[axis] = snappedDim / base[axis];
                    
                    // Clear binding if dragged
                    if (Math.abs(selectedShape.scale[axis] - dragStartScale[axis]) > 0.001) {
                        if (selectedShape.userData.bindings) {
                            delete selectedShape.userData.bindings[axis];
                        }
                    }
                });
            }
            
            // Only update dimensions if user isn't actively typing
            if (document.activeElement && document.activeElement.classList.contains('dimension-label')) return;
            updateDimensions();
        }
    });
    transformControl.setRotationSnap(THREE.MathUtils.degToRad(5));
    updateTransformSnap();
    scene.add(transformControl);

    // Area Selection
    selectionBox = new THREE.SelectionBox(activeCamera, scene);
    selectionDiv = document.createElement('div');
    selectionDiv.className = 'selectBox';
    selectionDiv.style.display = 'none';
    document.body.appendChild(selectionDiv);

    // ViewCube
    initViewCube();

    // Post Processing
    initPostProcessing();
    
    // Properties Preview & Inputs
    initPreview();
    setupPropertyInputs();
    
    // Variables
    initVariables();

    // Initial Grid and Theme setup
    setupThemeToggle();
    createGrid();
    updateSceneBackground();
    
    // Axes helper
    scene.add(new THREE.AxesHelper(5));

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    const eventEl = renderer.domElement;
    
    eventEl.addEventListener('pointerdown', onPointerDown);
    eventEl.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    eventEl.addEventListener('contextmenu', (e) => {
        if (e.target.tagName !== 'INPUT') e.preventDefault();
    });
    
    setupToolbar();
    populateSnapOptions();
    
    // Lifecycle events to trigger save state
    ['lc-status', 'lc-category', 'lc-line', 'lc-version'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => historyManager.saveState());
    });
    
    const invisibleBtn = document.getElementById('add-invisible-btn');
    if (invisibleBtn) invisibleBtn.addEventListener('click', () => {
        bomItems.push({ id: THREE.MathUtils.generateUUID(), name: 'Custom Item', price: 0.00, quantity: 1, invisible: true });
        renderBOM();
        historyManager.saveState();
    });

    if (isMobile) {
        document.body.classList.add('touch-mode');
        updateStatus('Mobile mode active.');
    }
    
    // Save initial state
    historyManager.saveState();
}

// === VARIABLES LOGIC ===

function getResolvedVariables() {
    const context = {};
    for (let key in window.holodeckVariables) {
        context[key] = window.holodeckVariables[key];
    }
    
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 10) {
        changed = false;
        for (let key in context) {
            if (typeof context[key] === 'string' && isNaN(Number(context[key]))) {
                try {
                    const evaluated = math.evaluate(context[key], context);
                    if (typeof evaluated === 'number' && !isNaN(evaluated)) {
                        context[key] = evaluated;
                        changed = true;
                    }
                } catch(e) {}
            } else if (typeof context[key] === 'string' && !isNaN(Number(context[key]))) {
                context[key] = Number(context[key]);
                changed = true;
            }
        }
        iterations++;
    }
    
    for (let key in context) {
        if (typeof context[key] !== 'number') {
            context[key] = 1.0;
        }
    }
    return context;
}

function evaluateExpression(expr, context) {
    if (!context) context = getResolvedVariables();
    try {
        const result = math.evaluate(expr, context);
        return typeof result === 'number' ? result : null;
    } catch(e) {
        return null;
    }
}

function initVariables() {
    document.getElementById('add-var-btn').addEventListener('click', () => {
        const varName = `var${variableCounter++}`;
        window.holodeckVariables[varName] = "1";
        renderVariables();
        historyManager.saveState();
    });
}

function renderVariables() {
    const list = document.getElementById('variables-list');
    list.innerHTML = '';
    
    for (const [key, val] of Object.entries(window.holodeckVariables)) {
        const row = document.createElement('div');
        row.className = 'var-row';
        
        const nameInp = document.createElement('input');
        nameInp.type = 'text';
        nameInp.value = key;
        nameInp.style.width = '70px';
        
        const eq = document.createElement('span');
        eq.innerText = '=';
        
        const valInp = document.createElement('input');
        valInp.type = 'text';
        valInp.value = val;
        
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        
        nameInp.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== key && !(newName in window.holodeckVariables)) {
                window.holodeckVariables[newName] = window.holodeckVariables[key];
                delete window.holodeckVariables[key];
                shapes.forEach(s => updateBindingsRename(s, key, newName));
                renderVariables();
                historyManager.saveState();
            } else {
                nameInp.value = key;
            }
        });
        
        valInp.addEventListener('input', (e) => {
            window.holodeckVariables[key] = e.target.value;
            applyVariablesToShapes();
        });
        
        valInp.addEventListener('change', () => historyManager.saveState());
        
        delBtn.addEventListener('click', () => {
            delete window.holodeckVariables[key];
            shapes.forEach(s => updateBindingsRename(s, key, null));
            renderVariables();
            historyManager.saveState();
        });
        
        row.appendChild(nameInp);
        row.appendChild(eq);
        row.appendChild(valInp);
        row.appendChild(delBtn);
        list.appendChild(row);
    }
}

function updateBindingsRename(shape, oldName, newName) {
    const traverse = (s) => {
        if (s.userData.bindings) {
            ['x', 'y', 'z'].forEach(axis => {
                const expr = s.userData.bindings[axis];
                if (expr && typeof expr === 'string') {
                    if (newName) {
                        const regex = new RegExp('\\b' + oldName + '\\b', 'g');
                        s.userData.bindings[axis] = expr.replace(regex, newName);
                    } else if (expr === oldName) {
                        delete s.userData.bindings[axis];
                    }
                }
            });
        }
        if (s.userData.isComposite && s.userData.groupChildren) {
            s.userData.groupChildren.forEach(child => traverse(child));
        }
    };
    traverse(shape);
    if (selectedShape === shape) selectPropertyNode(currentPropertyNode); // Refresh UI
}

function applyVariablesToShapes() {
    let needsRebuild = false;
    shapes.forEach(shape => {
        if (applyBindingsToNode(shape)) {
            if (shape.userData.isComposite) {
                needsRebuild = true;
                rebuildCSG(shape);
            }
        }
    });
    if (currentPropertyNode) selectPropertyNode(currentPropertyNode);
    if (transformControl.getMode() === 'scale') updateDimensions();
}

function applyBindingsToNode(node) {
    let changed = false;
    if (node.userData.bindings && node.userData.baseSize) {
        const context = getResolvedVariables();
        ['x', 'y', 'z'].forEach(axis => {
            const expr = node.userData.bindings[axis];
            if (expr) {
                const targetDim = evaluateExpression(expr, context);
                if (targetDim !== null) {
                    const newScale = targetDim / node.userData.baseSize[axis];
                    if (Math.abs(node.scale[axis] - newScale) > 0.0001) {
                        node.scale[axis] = newScale;
                        node.updateMatrix();
                        node.updateMatrixWorld(true);
                        changed = true;
                    }
                }
            }
        });
    }
    if (node.userData.isComposite && node.userData.groupChildren) {
        node.userData.groupChildren.forEach(child => {
            if (applyBindingsToNode(child)) changed = true;
        });
    }
    return changed;
}

// === DIMENSIONS LOGIC ===

function clearDimensions() {
    if (dimGroup) {
        dimGroup.traverse(child => {
            if (child.isCSS2DObject && child.element && child.element.parentNode) {
                child.element.parentNode.removeChild(child.element);
            }
        });
        if (dimGroup.parent) dimGroup.parent.remove(dimGroup);
        dimGroup = null;
    }
}

function updateDimensions() {
    clearDimensions();
    if (!selectedShape || selectedShapes.length > 1 || transformControl.getMode() !== 'scale') return;
    
    dimGroup = new THREE.Group();
    
    // Overall dimensions
    if (!selectedShape.geometry.boundingBox) selectedShape.geometry.computeBoundingBox();
    drawBoxDimensions(selectedShape.geometry.boundingBox, true);
    
    // Subfeatures
    if (selectedShape.userData.isComposite) {
        const invMatrix = new THREE.Matrix4().copy(selectedShape.matrixWorld).invert();
        const boxes = getSubFeatureBoxes(selectedShape, invMatrix);
        boxes.forEach(box => drawBoxDimensions(box, false));
    }
    
    selectedShape.add(dimGroup);
}

function getSubFeatureBoxes(node, targetMatrix) {
    const boxes = [];
    if (node.userData.isComposite) {
        boxes.push(...getSubFeatureBoxes(node.userData.left, targetMatrix));
        boxes.push(...getSubFeatureBoxes(node.userData.right, targetMatrix));
    } else {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const min = node.geometry.boundingBox.min.clone().applyMatrix4(node.matrixWorld).applyMatrix4(targetMatrix);
        const max = node.geometry.boundingBox.max.clone().applyMatrix4(node.matrixWorld).applyMatrix4(targetMatrix);
        boxes.push(new THREE.Box3().setFromPoints([min, max]));
    }
    return boxes;
}

function drawBoxDimensions(box, isEditable) {
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    
    const colorTheme = document.body.getAttribute('data-color-theme') || 'holodeck';
    const accentColor = colorTheme === 'holodeck' ? 0xecc94b : 0x0055ff;
    
    const mat = new THREE.LineBasicMaterial({ 
        color: isEditable ? accentColor : 0xaaaaaa, 
        depthTest: false,
        transparent: true,
        opacity: isEditable ? 1.0 : 0.4
    });
    
    const off = isEditable ? maxDim * 0.2 : maxDim * 0.1;
    const tickSize = maxDim * 0.05;
    
    const createDim = (p1, p2, val, axis) => {
        const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const line = new THREE.Line(geom, mat);
        line.renderOrder = 999;
        dimGroup.add(line);
        
        const perp = new THREE.Vector3();
        if (axis === 'x') perp.set(0, 1, 0);
        else if (axis === 'y') perp.set(1, 0, 0);
        else if (axis === 'z') perp.set(0, 1, 0);
        perp.multiplyScalar(tickSize);
        
        const tickGeom = new THREE.BufferGeometry().setFromPoints([
            p1.clone().add(perp), p1.clone().sub(perp),
            p2.clone().add(perp), p2.clone().sub(perp)
        ]);
        const ticks = new THREE.LineSegments(tickGeom, mat);
        ticks.renderOrder = 999;
        dimGroup.add(ticks);
        
        const div = document.createElement('input');
        div.className = 'dimension-label';
        const currentDim = val * selectedShape.scale[axis];
        div.value = currentDim.toFixed(2);
        
        if (!isEditable) {
            div.readOnly = true;
            div.style.color = '#aaaaaa';
            div.style.pointerEvents = 'none';
        } else {
            div.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const newVal = parseFloat(div.value);
                    if (!isNaN(newVal) && newVal > 0) {
                        selectedShape.scale[axis] = newVal / val;
                        updateDimensions();
                    }
                    div.blur();
                }
            });
            div.addEventListener('pointerdown', e => e.stopPropagation());
        }
        
        const label = new THREE.CSS2DObject(div);
        label.position.copy(p1).lerp(p2, 0.5);
        dimGroup.add(label);
    };
    
    createDim(new THREE.Vector3(box.min.x, box.min.y - off, box.max.z + off), new THREE.Vector3(box.max.x, box.min.y - off, box.max.z + off), size.x, 'x');
    createDim(new THREE.Vector3(box.max.x + off, box.min.y, box.max.z + off), new THREE.Vector3(box.max.x + off, box.max.y, box.max.z + off), size.y, 'y');
    createDim(new THREE.Vector3(box.max.x + off, box.min.y - off, box.min.z), new THREE.Vector3(box.max.x + off, box.min.y - off, box.max.z), size.z, 'z');
}

// === VIEW CUBE ===
function initViewCube() {
    const container = document.getElementById('viewcube-container');
    if (!container) return;
    
    viewcubeScene = new THREE.Scene();
    viewcubeCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    viewcubeCamera.position.set(0, 0, 4);
    
    viewcubeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    viewcubeRenderer.setSize(100, 100);
    container.appendChild(viewcubeRenderer.domElement);
    
    viewcubeControls = new THREE.OrbitControls(viewcubeCamera, viewcubeRenderer.domElement);
    viewcubeControls.enableZoom = false;
    viewcubeControls.enablePan = false;
    viewcubeControls.enableDamping = true;
    
    viewcubeScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dLight.position.set(1, 1, 1);
    viewcubeScene.add(dLight);
    
    const geom = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    viewcubeMesh = new THREE.Mesh(geom, getCubeMaterials());
    
    const edges = new THREE.EdgesGeometry(geom);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
    viewcubeMesh.add(line);
    
    viewcubeScene.add(viewcubeMesh);
    viewcubeScene.add(new THREE.AxesHelper(1.2));
    
    viewcubeRenderer.domElement.addEventListener('pointerdown', (e) => {
        isDraggingViewCube = true;
        isDraggingViewCubeDragOccurred = false;
        viewcubeHoverMesh.visible = false;
    });
    
    viewcubeHoverMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x4299e1, transparent: true, opacity: 0.6, depthTest: false })
    );
    viewcubeHoverMesh.visible = false;
    viewcubeScene.add(viewcubeHoverMesh);

    viewcubeRenderer.domElement.addEventListener('pointermove', (e) => {
        if (isDraggingViewCube) {
            isDraggingViewCubeDragOccurred = true;
            viewcubeHoverMesh.visible = false;
            return;
        }
        
        const rect = e.target.getBoundingClientRect();
        viewcubeMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        viewcubeMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        
        viewcubeRaycaster.setFromCamera(viewcubeMouse, viewcubeCamera);
        const intersects = viewcubeRaycaster.intersectObject(viewcubeMesh);
        
        if (intersects.length > 0) {
            const pt = intersects[0].point;
            const snap = (v) => {
                if (v > 0.85) return 1;
                if (v < -0.85) return -1;
                return 0;
            };
            const sx = snap(pt.x / 0.75);
            const sy = snap(pt.y / 0.75);
            const sz = snap(pt.z / 0.75);
            
            if (sx === 0 && sy === 0 && sz === 0) {
                viewcubeHoverMesh.visible = false;
                e.target.style.cursor = 'grab';
            } else {
                const hx = sx === 0 ? 1.4 : 0.3;
                const hy = sy === 0 ? 1.4 : 0.3;
                const hz = sz === 0 ? 1.4 : 0.3;
                
                if (viewcubeHoverMesh.geometry) viewcubeHoverMesh.geometry.dispose();
                viewcubeHoverMesh.geometry = new THREE.BoxGeometry(hx, hy, hz);
                
                viewcubeHoverMesh.position.set(sx * 0.75, sy * 0.75, sz * 0.75);
                viewcubeHoverMesh.visible = true;
                e.target.style.cursor = 'pointer';
            }
        } else {
            viewcubeHoverMesh.visible = false;
            e.target.style.cursor = 'grab';
        }
    });

    viewcubeRenderer.domElement.addEventListener('pointerleave', (e) => {
        viewcubeHoverMesh.visible = false;
        e.target.style.cursor = 'grab';
    });
    window.addEventListener('pointerup', (e) => {
        isDraggingViewCube = false;
    });
    
    viewcubeRenderer.domElement.addEventListener('pointerup', (e) => {
        if (!isDraggingViewCubeDragOccurred) {
            onViewCubeClick(e);
        }
    });
}

function getCubeMaterials() {
    const colorTheme = document.body.getAttribute('data-color-theme') || 'holodeck';
    const isDark = document.body.getAttribute('data-brightness') === 'dark';
    
    let bg = isDark ? '#0a3d91' : '#ffffff';
    let fg = isDark ? '#ffffff' : '#0a3d91'; // Blueprint
    let border = isDark ? '#4da6ff' : '#0055ff';

    if (colorTheme === 'holodeck') { 
        bg = isDark ? '#1a202c' : '#e2e8f0'; 
        fg = isDark ? '#ecc94b' : '#2d3748'; 
        border = isDark ? '#d69e2e' : '#b7791f';
    } else if (colorTheme === 'amber') { 
        bg = isDark ? '#1a1100' : '#fffcf0'; 
        fg = isDark ? '#ffb000' : '#664400'; 
        border = fg;
    } else if (colorTheme === 'matrix') { 
        bg = isDark ? '#0d1a0d' : '#f0fff0'; 
        fg = isDark ? '#00ff41' : '#004d00'; 
        border = fg;
    }
    
    const faces = ['R', 'L', 'T', 'Bt', 'F', 'Bk'];
    const mats = [];
    faces.forEach(text => {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = fg; ctx.font = 'bold 72px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 64);
        ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 120, 120);
        mats.push(new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), color: 0xffffff, roughness: 0.8 }));
    });
    return mats;
}

function onViewCubeClick(e) {
    const rect = e.target.getBoundingClientRect();
    viewcubeMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    viewcubeMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    
    viewcubeRaycaster.setFromCamera(viewcubeMouse, viewcubeCamera);
    const intersects = viewcubeRaycaster.intersectObject(viewcubeMesh);
    
    if (intersects.length > 0) {
        const pt = intersects[0].point;
        // Tighter snap threshold to make faces larger targets than edges and corners
        const snap = (v) => {
            if (v > 0.85) return 1;
            if (v < -0.85) return -1;
            return 0;
        };
        const dir = new THREE.Vector3(
            snap(pt.x / 0.75),
            snap(pt.y / 0.75),
            snap(pt.z / 0.75)
        ).normalize();
        
        if (dir.lengthSq() === 0) return;
        
        const dist = activeCamera.position.distanceTo(controls.target);
        const targetPos = controls.target.clone().add(dir.multiplyScalar(dist));
        
        // Prevent gimbal lock on pure vertical views and avoid fighting OrbitControls damping
        controls.enabled = false;
        const isVertical = (dir.x === 0 && dir.z === 0);
        const targetUp = isVertical ? new THREE.Vector3(0, 0, dir.y === 1 ? -1 : 1) : new THREE.Vector3(0, 1, 0);
        
        gsap.to(activeCamera.up, {
            x: targetUp.x, y: targetUp.y, z: targetUp.z, duration: 0.6, ease: "power2.out"
        });
        
        gsap.to(activeCamera.position, {
            x: targetPos.x, y: targetPos.y, z: targetPos.z, duration: 0.6, ease: "power2.out", 
            onUpdate: () => { activeCamera.lookAt(controls.target); },
            onComplete: () => { controls.enabled = true; controls.update(); }
        });
    }
}

function toggleProjection() {
    isOrthographic = !isOrthographic;
    const btn = document.getElementById('projection-toggle');
    const dist = activeCamera.position.distanceTo(controls.target);
    
    if (isOrthographic) {
        const h = 2 * dist * Math.tan(camera.fov * THREE.MathUtils.DEG2RAD / 2);
        const w = h * camera.aspect;
        orthoCamera.left = w / -2; orthoCamera.right = w / 2;
        orthoCamera.top = h / 2; orthoCamera.bottom = h / -2;
        orthoCamera.position.copy(camera.position); orthoCamera.rotation.copy(camera.rotation);
        orthoCamera.updateProjectionMatrix();
        activeCamera = orthoCamera;
        btn.innerHTML = '<i class="fas fa-video-slash"></i>';
    } else {
        camera.position.copy(orthoCamera.position); camera.rotation.copy(orthoCamera.rotation);
        activeCamera = camera;
        btn.innerHTML = '<i class="fas fa-video"></i>';
    }
    
    controls.object = activeCamera; transformControl.camera = activeCamera; selectionBox.camera = activeCamera;
    if (outlinePass) outlinePass.renderCamera = activeCamera;
    if (composer) composer.passes[0].camera = activeCamera;
    controls.update(); updateStatus(`Projection: ${isOrthographic ? 'Orthographic' : 'Perspective'}`);
}

function centerSelection() {
    if (selectedShapes.length === 0) return;
    const box = new THREE.Box3();
    selectedShapes.forEach(mesh => box.expandByObject(mesh));
    const center = box.getCenter(new THREE.Vector3());
    
    const offset = new THREE.Vector3().subVectors(center, controls.target);
    const targetPos = new THREE.Vector3().copy(activeCamera.position).add(offset);
    
    controls.enabled = false;
    gsap.to(controls.target, {
        x: center.x, y: center.y, z: center.z, duration: 0.6, ease: "power2.out"
    });
    gsap.to(activeCamera.position, {
        x: targetPos.x, y: targetPos.y, z: targetPos.z, duration: 0.6, ease: "power2.out", 
        onUpdate: () => { activeCamera.lookAt(controls.target); },
        onComplete: () => { controls.enabled = true; controls.update(); }
    });
}

function initPostProcessing() {
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, activeCamera));
    outlinePass = new THREE.OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, activeCamera);
    outlinePass.edgeStrength = 4.0; outlinePass.edgeGlow = 1.0; outlinePass.edgeThickness = 1.0;
    outlinePass.pulsePeriod = 0; outlinePass.usePatternTexture = false;
    outlinePass.visibleEdgeColor.set('#0055ff'); outlinePass.hiddenEdgeColor.set('#190a05');
    composer.addPass(outlinePass);
}

function initPreview() {
    const container = document.getElementById('preview-container');
    if (!container) return;
    previewScene = new THREE.Scene();
    previewCamera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
    previewCamera.position.set(3, 3, 3); previewCamera.lookAt(0, 0, 0);
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    previewRenderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(previewRenderer.domElement);
    
    previewControls = new THREE.OrbitControls(previewCamera, previewRenderer.domElement);
    previewControls.enableZoom = true;
    previewControls.enablePan = true;
    previewControls.enableDamping = true;
    previewControls.autoRotate = true;
    previewControls.autoRotateSpeed = 2.0;
    
    previewScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 5, 5); previewScene.add(dirLight);
}

function setupPropertyInputs() {
    document.getElementById('obj-color').addEventListener('input', (e) => {
        if (currentPropertyNode) {
            currentPropertyNode.material.color.set(e.target.value);
            if (previewMesh) previewMesh.material.color.set(e.target.value);
        }
    });
    document.getElementById('obj-color').addEventListener('change', () => historyManager.saveState());
    
    document.getElementById('obj-transparent').addEventListener('change', (e) => {
        if (currentPropertyNode) {
            currentPropertyNode.material.transparent = e.target.checked;
            currentPropertyNode.material.opacity = e.target.checked ? 0.85 : 1.0;
            if (previewMesh) {
                previewMesh.material.transparent = currentPropertyNode.material.transparent;
                previewMesh.material.opacity = currentPropertyNode.material.opacity;
            }
            historyManager.saveState();
        }
    });
    
    document.getElementsByName('obj-type').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (selectedShapes.length === 1) {
                const shape = selectedShapes[0];
                shape.userData.isHole = (e.target.value === 'hole');
                
                if (shape.userData.isHole) {
                    shape.material.transparent = true;
                    shape.material.opacity = 0.3;
                    shape.material.color.setHex(0x888888);
                } else {
                    shape.material.transparent = document.getElementById('obj-transparent').checked;
                    shape.material.opacity = shape.material.transparent ? 0.85 : 1.0;
                    shape.material.color.setHex(document.getElementById('obj-color').value.replace('#', '0x'));
                }
                historyManager.saveState();
            }
        });
    });
    
    const handleInput = (axis, inputId) => {
        const input = document.getElementById(inputId);
        input.addEventListener('change', (e) => {
            if (!currentPropertyNode) return;
            const val = e.target.value.trim();
            const s = currentPropertyNode;
            if (!s.userData.bindings) s.userData.bindings = {};
            
            const context = getResolvedVariables();
            let numVal = evaluateExpression(val, context);
            
            if (numVal !== null && isNaN(Number(val))) {
                s.userData.bindings[axis] = val; // Store expression
            } else {
                numVal = parseFloat(val);
                delete s.userData.bindings[axis];
                if (isNaN(numVal)) numVal = 1;
            }
            
            let base = s.userData.baseSize;
            if (!base) {
                s.geometry.computeBoundingBox();
                const sz = new THREE.Vector3();
                s.geometry.boundingBox.getSize(sz);
                base = { x: sz.x || 1, y: sz.y || 1, z: sz.z || 1 };
                s.userData.baseSize = base;
            }
            
            if (!isNaN(numVal) && numVal > 0) {
                const newScale = numVal / base[axis];
                s.scale[axis] = newScale;
                s.updateMatrix();
                s.updateMatrixWorld(true);
                
                // Keep the input value as the expression if it's bound, otherwise show the number
                input.value = s.userData.bindings[axis] || numVal.toFixed(2);
                
                historyManager.saveState();
                
                let parentGroup = s.parent;
                while (parentGroup && parentGroup.type !== 'Scene') {
                    if (parentGroup.userData.isComposite) rebuildCSG(parentGroup);
                    parentGroup = parentGroup.parent;
                }
            } else {
                input.value = (s.scale[axis] * s.userData.baseSize[axis]).toFixed(2);
            }
            updateDimensions();
        });
    };
    handleInput('x', 'obj-w');
    handleInput('y', 'obj-h');
    handleInput('z', 'obj-l');
}

function updateSceneBackground() {
    scene.background = null; 
    const colorTheme = document.body.getAttribute('data-color-theme') || 'holodeck';
    const isDark = document.body.getAttribute('data-brightness') === 'dark';
    if (gridHelper) {
        let color = isDark ? 0xffffff : 0x0a3d91;
        if (colorTheme === 'holodeck') color = isDark ? 0xecc94b : 0x2d3748;
        gridHelper.material.color.setHex(color);
        gridHelper.material.opacity = isDark ? 0.4 : 0.2;
    }
    if (outlinePass) outlinePass.visibleEdgeColor.set(colorTheme === 'holodeck' ? '#ecc94b' : '#0055ff');
    if (alignmentGizmo) updateAlignmentGizmo();
    if (viewcubeMesh) {
        viewcubeScene.remove(viewcubeMesh);
        viewcubeMesh.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        viewcubeMesh.geometry.dispose();
        while (viewcubeMesh.children.length > 0) {
            const child = viewcubeMesh.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            viewcubeMesh.remove(child);
        }
        
        const geom = new THREE.BoxGeometry(1.5, 1.5, 1.5);
        viewcubeMesh = new THREE.Mesh(geom, getCubeMaterials());
        const edges = new THREE.EdgesGeometry(geom);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
        viewcubeMesh.add(line);
        
        viewcubeScene.add(viewcubeMesh);
    }
    if (viewcubeHoverMesh) {
        let hoverColor = 0x0055ff;
        if (colorTheme === 'holodeck') hoverColor = 0xecc94b;
        else if (colorTheme === 'amber') hoverColor = 0xffb000;
        else if (colorTheme === 'matrix') hoverColor = 0x00ff41;
        viewcubeHoverMesh.material.color.setHex(hoverColor);
    }
}

function createGrid() {
    if (gridHelper) scene.remove(gridHelper);
    const newSize = unitMode === 'inch' ? gridSize * 2.54 : gridSize;
    gridHelper = new THREE.GridHelper(newSize, Math.round(newSize), 0xffffff, 0xffffff);
    gridHelper.material.transparent = true; gridHelper.visible = gridVisible;
    scene.add(gridHelper);
}
function updateGridScale() { createGrid(); updateSceneBackground(); }

function populateSnapOptions() {
    const select = document.getElementById('snap-precision');
    if (!select) return;
    select.innerHTML = '';
    const cmOpts = [ {v: "0.1", l: "0.1 mm"}, {v: "1", l: "1.0 mm", s: true}, {v: "5", l: "5.0 mm"}, {v: "10", l: "1.0 cm"}, {v: "25", l: "2.5 cm"}, {v: "50", l: "5.0 cm"} ];
    const inOpts = [ {v: "0.0625", l: "1/16 in"}, {v: "0.125", l: "1/8 in"}, {v: "0.25", l: "1/4 in"}, {v: "0.5", l: "1/2 in"}, {v: "1", l: "1.0 in", s: true}, {v: "2", l: "2.0 in"} ];
    (unitMode === 'cm' ? cmOpts : inOpts).forEach(opt => select.add(new Option(opt.l, opt.v, false, opt.s)));
    snapPrecision = 1; updateTransformSnap();
}
function updateTransformSnap() {
    if (!snapEnabled) { transformControl.setTranslationSnap(null); return; }
    transformControl.setTranslationSnap(unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10);
}

function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle-btn');
    const select = document.getElementById('color-theme-select');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme') || (prefersDark ? 'dark' : 'light');
    const savedColorTheme = localStorage.getItem('color-theme') || 'holodeck';
    
    document.body.setAttribute('data-brightness', savedTheme);
    btn.querySelector('i').className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    document.body.setAttribute('data-color-theme', savedColorTheme); select.value = savedColorTheme;
    
    btn.addEventListener('click', () => {
        const next = document.body.getAttribute('data-brightness') === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-brightness', next); localStorage.setItem('theme', next);
        btn.querySelector('i').className = next === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        updateSceneBackground();
    });
    select.addEventListener('change', (e) => {
        document.body.setAttribute('data-color-theme', e.target.value); localStorage.setItem('color-theme', e.target.value);
        updateSceneBackground();
    });
}

function setupToolbar() {
    document.querySelectorAll('[data-shape]').forEach(btn => btn.addEventListener('click', () => addShape(btn.dataset.shape)));
    
    const bindClick = (id, handler) => { const el = document.getElementById(id); if (el) el.addEventListener('click', handler); };
    
    // Hardware Toolbar
    bindClick('add-extrusion', () => addHardware('extrusion'));
    bindClick('add-motor', () => addHardware('motor'));
    bindClick('add-screw', () => addHardware('screw'));
    bindClick('wire-tool', () => {
        isWiringMode = !isWiringMode;
        if (isWiringMode) {
            wirePoints = [];
            updateStatus('Wire Mode: Click points to route wire. Press Enter to finish, Esc to cancel.');
            document.getElementById('wire-tool').classList.add('active');
            
            // Add a preview sphere to show cursor location
            if (!wirePreviewSphere) {
                wirePreviewSphere = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
                scene.add(wirePreviewSphere);
            }
            wirePreviewSphere.visible = true;
        } else {
            cancelWire();
        }
    });
    
    document.querySelectorAll('[data-transform]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-transform]').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active'); transformControl.setMode(e.currentTarget.dataset.transform);
            if (transformControl.getMode() === 'scale' && selectedShapes.length === 1) updateDimensions(); else clearDimensions();
        });
    });
    
    bindClick('export-stl', exportSTL); bindClick('delete-selected', deleteSelected); bindClick('toggle-grid', toggleGrid);
    bindClick('unit-toggle', toggleUnit);
    bindClick('group-shapes', groupShapes);
    bindClick('ungroup-shapes', ungroupShapes);
    bindClick('distribute-shapes', toggleDistributeMode);
    bindClick('align-mode', toggleAlignMode); bindClick('projection-toggle', toggleProjection);
    bindClick('center-selection', centerSelection);
    
    document.getElementById('snap-precision')?.addEventListener('change', (e) => { snapPrecision = parseFloat(e.target.value); updateTransformSnap(); });

    // History and Save/Load
    bindClick('btn-undo', () => historyManager.undo());
    bindClick('btn-redo', () => historyManager.redo());
    bindClick('btn-save', () => {
        const data = JSON.stringify({ version: "2.0", undoStack: historyManager.undoStack, redoStack: historyManager.redoStack });
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'project.holo'; a.click(); URL.revokeObjectURL(url);
    });
    const fileLoad = document.getElementById('file-load');
    if (fileLoad) {
        bindClick('btn-load', () => fileLoad.click());
        fileLoad.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    if (data.version && data.undoStack) {
                        historyManager.undoStack = data.undoStack;
                        historyManager.redoStack = data.redoStack || [];
                        if (historyManager.undoStack.length > 0) {
                            historyManager.restoreState(historyManager.undoStack[historyManager.undoStack.length - 1]);
                        }
                        updateToolbarButtons();
                        updateStatus('Project loaded successfully.');
                    }
                } catch (err) { updateStatus('Failed to load project.'); }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // Keyboard shortcuts & Clipboard
    let clipboard = [];
    
    function deepCloneShape(s) {
        const clone = s.clone();
        
        function cloneUserData(origNode, cloneNode) {
            cloneNode.userData = { ...origNode.userData };
            if (origNode.userData.baseSize) cloneNode.userData.baseSize = { ...origNode.userData.baseSize };
            if (origNode.userData.bindings) cloneNode.userData.bindings = { ...origNode.userData.bindings };
            if (origNode.userData.originalGeometry) cloneNode.userData.originalGeometry = origNode.userData.originalGeometry;
            
            if (origNode.userData.isComposite && origNode.userData.groupChildren) {
                cloneNode.userData.groupChildren = origNode.userData.groupChildren.map(origChild => {
                    const index = origNode.children.indexOf(origChild);
                    return index !== -1 ? cloneNode.children[index] : null;
                }).filter(Boolean);
            }
            
            for (let i = 0; i < origNode.children.length; i++) {
                cloneUserData(origNode.children[i], cloneNode.children[i]);
            }
        }
        
        cloneUserData(s, clone);
        
        function cloneMaterials(mesh) {
            if (mesh.material) mesh.material = mesh.material.clone();
            mesh.children.forEach(cloneMaterials);
        }
        cloneMaterials(clone);
        
        return clone;
    }

    window.addEventListener('keydown', (e) => {
        const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';
        
        if (e.key === 'Escape') {
            if (isWiringMode) cancelWire();
            else if (isAlignMode) toggleAlignMode();
            else if (isDistributeMode) toggleDistributeMode();
            else {
                selectedShapes = [];
                selectedShape = null;
                transformControl.detach();
                updateSelectionEffects();
                updateStatus('Selection cleared');
            }
        }
        
        if (e.key === 'Enter' && isWiringMode) {
            if (wirePoints.length > 1) finalizeWire();
            else cancelWire();
        }
        
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 's') { e.preventDefault(); document.getElementById('btn-save').click(); }
            if (!isInput) {
                if (e.key === 'z') { e.preventDefault(); if (e.shiftKey) historyManager.redo(); else historyManager.undo(); }
                if (e.key === 'y') { e.preventDefault(); historyManager.redo(); }
                if (e.key === 'g' || e.key === 'G') {
                    e.preventDefault();
                    if (e.shiftKey) ungroupShapes();
                    else groupShapes();
                }
                if (e.key === 'c' || e.key === 'C') {
                    e.preventDefault();
                    clipboard = selectedShapes.map(s => deepCloneShape(s));
                    updateStatus(clipboard.length + ' shape(s) copied.');
                }
                if (e.key === 'x' || e.key === 'X') {
                    e.preventDefault();
                    clipboard = selectedShapes.map(s => deepCloneShape(s));
                    deleteSelected();
                    updateStatus(clipboard.length + ' shape(s) cut.');
                }
                if (e.key === 'v' || e.key === 'V') {
                    e.preventDefault();
                    if (clipboard.length > 0) {
                        selectedShapes = []; selectedShape = null; transformControl.detach(); updateSelectionEffects();
                        const worldSnap = unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10;
                        clipboard.forEach(s => {
                            const clone = deepCloneShape(s);
                            // Offset by one snap unit
                            clone.position.x += worldSnap * 2;
                            clone.position.z += worldSnap * 2;
                            
                            scene.add(clone);
                            shapes.push(clone);
                            selectShape(clone, { ctrlKey: true });
                        });
                        historyManager.saveState();
                        updateStatus(clipboard.length + ' shape(s) pasted.');
                    }
                }
            }
        } else if (!isInput) {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelected();
            } else if (e.key.startsWith('Arrow') && selectedShapes.length > 0) {
                e.preventDefault();
                
                let worldSnap = unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10;
                if (e.ctrlKey && e.shiftKey) worldSnap /= 10;
                else if (e.shiftKey) worldSnap *= 10;
                else if (e.ctrlKey) worldSnap /= 2;
                
                const forward = new THREE.Vector3();
                activeCamera.getWorldDirection(forward);
                
                const up = new THREE.Vector3(0, 1, 0).applyQuaternion(activeCamera.quaternion);
                const right = new THREE.Vector3().crossVectors(forward, up).normalize();
                
                const worldAxes = [
                    new THREE.Vector3(1,0,0), new THREE.Vector3(-1,0,0),
                    new THREE.Vector3(0,1,0), new THREE.Vector3(0,-1,0),
                    new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,-1)
                ];
                
                let bestUp = worldAxes[0];
                let maxUpDot = -Infinity;
                worldAxes.forEach(axis => {
                    const d = up.dot(axis);
                    if (d > maxUpDot) { maxUpDot = d; bestUp = axis; }
                });
                
                let bestRight = worldAxes[0];
                let maxRightDot = -Infinity;
                worldAxes.forEach(axis => {
                    const d = right.dot(axis);
                    if (d > maxRightDot) { maxRightDot = d; bestRight = axis; }
                });
                
                let moveDir = new THREE.Vector3();
                if (e.key === 'ArrowUp') moveDir.copy(bestUp);
                if (e.key === 'ArrowDown') moveDir.copy(bestUp).negate();
                if (e.key === 'ArrowRight') moveDir.copy(bestRight);
                if (e.key === 'ArrowLeft') moveDir.copy(bestRight).negate();
                
                moveDir.multiplyScalar(worldSnap);
                
                selectedShapes.forEach(shape => {
                    shape.position.add(moveDir);
                    shape.updateMatrixWorld(true);
                });
                
                if (transformControl.object) transformControl.updateMatrixWorld();
                updateDimensions();
                
                historyManager.saveState();
            }
        }
    });
}

function addShape(type) {
    let geometry;
    switch(type) {
        case 'cube': geometry = new THREE.BoxGeometry(2, 2, 2); break;
        case 'sphere': geometry = new THREE.SphereGeometry(1.5, 32, 32); break;
        case 'cylinder': geometry = new THREE.CylinderGeometry(1, 1, 2, 32); break;
        case 'cone': geometry = new THREE.ConeGeometry(1.5, 2, 32); break;
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: Math.random() * 0xffffff, transparent: true, opacity: 0.85, roughness: 0.4, metalness: 0.1
    }));
    
    const worldSnap = unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10;
    mesh.position.set(Math.round((Math.random() - 0.5) * 4 / worldSnap) * worldSnap, Math.round(1 / worldSnap) * worldSnap, Math.round((Math.random() - 0.5) * 4 / worldSnap) * worldSnap);
    
    mesh.userData = { type: type, originalGeometry: geometry, bindings: {}, isComposite: false, isHole: false };
    mesh.uuid = THREE.MathUtils.generateUUID();
    mesh.name = type.charAt(0).toUpperCase() + type.slice(1) + " " + (shapes.length + 1);
    
    geometry.computeBoundingBox();
    const sz = new THREE.Vector3();
    geometry.boundingBox.getSize(sz);
    mesh.userData.baseSize = { x: sz.x, y: sz.y, z: sz.z };

    scene.add(mesh);
    shapes.push(mesh);
    selectShape(mesh);
    updateStatus(`Added ${type}`);
    historyManager.saveState();
}

function createExtrusionShape(profile, slotType) {
    const isV = slotType === 'v-slot';
    const pW = parseInt(profile.substring(0, 2));
    const pH = parseInt(profile.substring(2, 4));
    
    const w = pW / 10;
    const h = pH / 10;
    
    const series = profile === '3030' ? 30 : 20;
    const s = series / 10;
    
    const slotsX = Math.round(w / s);
    const slotsY = Math.round(h / s);
    
    let openingH, chamferW, chamferD, wallD, innerH, verticalD, floorD, floorW, cornerCut;
    
            if (series === 30) { 
        openingH = 0.40; 
        chamferW = isV ? 0.20 : 0.0;
        chamferD = isV ? 0.15 : 0.0;
        wallD = 0.10; 
        innerH = 0.75; // Decreased to thicken the outer corner blocks
        verticalD = 0.50; // Mathematically aligned with floor to eliminate X support taper
        floorD = 0.90; 
        floorW = 0.35; // Mathematically aligned with wall to eliminate X support taper
        cornerCut = 0.15; 
    } else { 
        openingH = isV ? 0.317 : 0.263; 
        chamferW = isV ? 0.10 : 0.0;
        chamferD = isV ? 0.10 : 0.0;
        wallD = isV ? 0.05 : 0.15; 
        innerH = 0.62; 
        verticalD = 0.26; // Mathematically aligned with floor to eliminate X support taper
        floorD = 0.634; 
        floorW = 0.246; // Mathematically aligned with wall to eliminate X support taper
        cornerCut = 0.15; 
    }
    
    const shape = new THREE.Shape();
    const pts = [];
    
    const addSide = (sx, sy, ex, ey, numSlots) => {
        const dx = ex - sx; const dy = ey - sy;
        const L = Math.hypot(dx, dy);
        const ux = dx / L; const uy = dy / L;
        const nx = -uy; const ny = ux; 
        
        pts.push(new THREE.Vector2(sx + ux * cornerCut, sy + uy * cornerCut));
        
        const segmentL = L / numSlots;
        for (let i = 0; i < numSlots; i++) {
            const centerDist = (i + 0.5) * segmentL;
            const cx = sx + ux * centerDist;
            const cy = sy + uy * centerDist;
            
            pts.push(new THREE.Vector2(cx - ux * (openingH + chamferW), cy - uy * (openingH + chamferW)));
            pts.push(new THREE.Vector2(cx - ux * openingH + nx * chamferD, cy - uy * openingH + ny * chamferD));
            pts.push(new THREE.Vector2(cx - ux * openingH + nx * (chamferD + wallD), cy - uy * openingH + ny * (chamferD + wallD)));
            pts.push(new THREE.Vector2(cx - ux * innerH + nx * (chamferD + wallD), cy - uy * innerH + ny * (chamferD + wallD)));
            pts.push(new THREE.Vector2(cx - ux * innerH + nx * verticalD, cy - uy * innerH + ny * verticalD));
            pts.push(new THREE.Vector2(cx - ux * floorW + nx * floorD, cy - uy * floorW + ny * floorD));
            pts.push(new THREE.Vector2(cx + ux * floorW + nx * floorD, cy + uy * floorW + ny * floorD));
            pts.push(new THREE.Vector2(cx + ux * innerH + nx * verticalD, cy + uy * innerH + ny * verticalD));
            pts.push(new THREE.Vector2(cx + ux * innerH + nx * (chamferD + wallD), cy + uy * innerH + ny * (chamferD + wallD)));
            pts.push(new THREE.Vector2(cx + ux * openingH + nx * (chamferD + wallD), cy + uy * openingH + ny * (chamferD + wallD)));
            pts.push(new THREE.Vector2(cx + ux * openingH + nx * chamferD, cy + uy * openingH + ny * chamferD));
            pts.push(new THREE.Vector2(cx + ux * (openingH + chamferW), cy + uy * (openingH + chamferW)));
        }
        pts.push(new THREE.Vector2(ex - ux * cornerCut, ey - uy * cornerCut));
    };
    
    addSide(-w/2, -h/2, w/2, -h/2, slotsX); 
    addSide(w/2, -h/2, w/2, h/2, slotsY);   
    addSide(w/2, h/2, -w/2, h/2, slotsX);   
    addSide(-w/2, h/2, -w/2, -h/2, slotsY); 
    
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
    
    const holeR = series === 30 ? 0.365 : 0.21; 
    for (let ix = 0; ix < slotsX; ix++) {
        for (let iy = 0; iy < slotsY; iy++) {
            const hx = -w/2 + (ix + 0.5) * s;
            const hy = -h/2 + (iy + 0.5) * s;
            
            const hole = new THREE.Path();
            const segments = 32;
            for(let i=0; i<=segments; i++) {
                let ang = -(i/segments) * Math.PI * 2; 
                let r = holeR;
                let m = i % 8;
                if (m === 3 || m === 4 || m === 5) r = holeR * 1.25; 
                
                let px = hx + Math.cos(ang) * r;
                let py = hy + Math.sin(ang) * r;
                if (i === 0) hole.moveTo(px, py);
                else hole.lineTo(px, py);
            }
            shape.holes.push(hole);
        }
    }
    
    // Generate parametric seam hollows for multi-block extrusions (2040, 4040, etc)
    if (slotsX > 1 || slotsY > 1) {
        const wt = (series === 30) ? 0.20 : 0.18; // Consistent wall thickness (2mm or 1.8mm)
        const hole_r = (series === 30) ? 0.365 * 1.25 : 0.21 * 1.25;
        const s_half = s / 2;
        
        const r_hole = s_half - hole_r - wt; // Reach towards a hole
        const r_wall = s_half - wt;          // Reach towards an outer flat wall
        const r_hollow = s_half/2 - wt/2;    // Reach towards another internal hollow (boundary at s/4)
        
        // D_bound is the maximum diagonal reach allowed by the 45-degree slot tapers
        const D_bound = (series === 30) ? 1.46 : 0.86;
        
        const drawChamferedBox = (cx, cy, rxP, rxN, ryP, ryN) => {
            const p = new THREE.Path();
            
            // Intersect bounding box with 4 diagonal half-planes to clear slot tapers safely
            const tr_y = Math.min(ryP, D_bound - rxP);
            const tr_x = Math.min(rxP, D_bound - ryP);
            
            const tl_y = Math.min(ryP, D_bound - rxN);
            const tl_x = Math.max(-rxN, -(D_bound - ryP));
            
            const bl_y = Math.max(-ryN, -(D_bound - rxN));
            const bl_x = Math.max(-rxN, -(D_bound - ryN));
            
            const br_y = Math.max(-ryN, -(D_bound - rxP));
            const br_x = Math.min(rxP, D_bound - ryN);
            
            p.moveTo(cx + tr_x, cy + ryP);
            p.lineTo(cx + rxP, cy + tr_y);
            p.lineTo(cx + rxP, cy + br_y);
            p.lineTo(cx + br_x, cy - ryN);
            p.lineTo(cx + bl_x, cy - ryN);
            p.lineTo(cx - rxN, cy + bl_y);
            p.lineTo(cx - rxN, cy + tl_y);
            p.lineTo(cx + tl_x, cy + ryP);
            p.lineTo(cx + tr_x, cy + ryP);
            
            shape.holes.push(p);
        };

        // Horizontal seams
        for (let ix = 0; ix < slotsX - 1; ix++) {
            for (let iy = 0; iy < slotsY; iy++) {
                const cx = -w/2 + (ix + 1) * s;
                const cy = -h/2 + (iy + 0.5) * s;
                const ryP = (iy === slotsY - 1) ? r_wall : r_hollow;
                const ryN = (iy === 0) ? r_wall : r_hollow;
                drawChamferedBox(cx, cy, r_hole, r_hole, ryP, ryN);
            }
        }
        // Vertical seams
        for (let ix = 0; ix < slotsX; ix++) {
            for (let iy = 0; iy < slotsY - 1; iy++) {
                const cx = -w/2 + (ix + 0.5) * s;
                const cy = -h/2 + (iy + 1) * s;
                const rxP = (ix === slotsX - 1) ? r_wall : r_hollow;
                const rxN = (ix === 0) ? r_wall : r_hollow;
                drawChamferedBox(cx, cy, rxP, rxN, r_hole, r_hole);
            }
        }
        // Cross junctions
        for (let ix = 0; ix < slotsX - 1; ix++) {
            for (let iy = 0; iy < slotsY - 1; iy++) {
                const cx = -w/2 + (ix + 1) * s;
                const cy = -h/2 + (iy + 1) * s;
                // Cross junctions face other hollows in all 4 directions
                drawChamferedBox(cx, cy, r_hollow, r_hollow, r_hollow, r_hollow);
            }
        }
    }
    
    // Corner hollows for 30-series outer perimeter
    if (series === 30) {
        const offsetX = w/2 - 0.45;
        const offsetY = h/2 - 0.45;
        const cw = 0.25;
        for (let dx of [-1, 1]) {
            for (let dy of [-1, 1]) {
                const cx = dx * offsetX;
                const cy = dy * offsetY;
                const hollow = new THREE.Path();
                hollow.moveTo(cx - cw/2, cy + cw/2);
                hollow.lineTo(cx + cw/2, cy + cw/2); 
                hollow.lineTo(cx + cw/2, cy - cw/2); 
                hollow.lineTo(cx - cw/2, cy - cw/2); 
                hollow.lineTo(cx - cw/2, cy + cw/2); 
                shape.holes.push(hollow);
            }
        }
    }
    
    return shape;
}

function createMotorGeometry(nema) {
    // Determine motor dimensions based on NEMA size (approximate standard sizes in cm)
    let bodySize = 4.23; // NEMA 17 standard width (42.3mm)
    let bodyLength = 4.7; // Standard length
    let shaftRadius = 0.25; // 5mm diameter
    let shaftLength = 2.4; // 24mm length
    let flangeRadius = 1.1; // 22mm diameter centering boss

    if (nema === '14') { bodySize = 3.52; bodyLength = 3.4; shaftRadius = 0.25; shaftLength = 2.0; flangeRadius = 1.1; }
    if (nema === '23') { bodySize = 5.64; bodyLength = 7.6; shaftRadius = 0.3175; shaftLength = 2.1; flangeRadius = 1.91; }
    if (nema === '34') { bodySize = 8.6; bodyLength = 11.4; shaftRadius = 0.635; shaftLength = 3.2; flangeRadius = 3.65; }

    const geometries = [];

    // Main Body (rounded box)
    const cornerRadius = bodySize * 0.15;
    const shape = new THREE.Shape();
    const half = bodySize / 2;
    shape.moveTo(-half + cornerRadius, -half);
    shape.lineTo(half - cornerRadius, -half);
    shape.quadraticCurveTo(half, -half, half, -half + cornerRadius);
    shape.lineTo(half, half - cornerRadius);
    shape.quadraticCurveTo(half, half, half - cornerRadius, half);
    shape.lineTo(-half + cornerRadius, half);
    shape.quadraticCurveTo(-half, half, -half, half - cornerRadius);
    shape.lineTo(-half, -half + cornerRadius);
    shape.quadraticCurveTo(-half, -half, -half + cornerRadius, -half);

    const bodyGeom = new THREE.ExtrudeGeometry(shape, { depth: bodyLength, bevelEnabled: false, curveSegments: 4 });
    // Center it on the origin appropriately (shaft facing +Z)
    bodyGeom.translate(0, 0, -bodyLength);
    geometries.push(bodyGeom);

    // Front Flange (Boss)
    const flangeGeom = new THREE.CylinderGeometry(flangeRadius, flangeRadius, 0.2, 32);
    flangeGeom.rotateX(Math.PI / 2);
    flangeGeom.translate(0, 0, 0.1);
    geometries.push(flangeGeom);

    // Shaft
    const shaftGeom = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16);
    shaftGeom.rotateX(Math.PI / 2);
    shaftGeom.translate(0, 0, shaftLength / 2);
    geometries.push(shaftGeom);

    // Normalize geometries for merging (prevent index/uv mismatch errors)
    for (let i = 0; i < geometries.length; i++) {
        if (geometries[i].index) {
            geometries[i] = geometries[i].toNonIndexed();
        }
        geometries[i].deleteAttribute('uv');
        geometries[i].deleteAttribute('uv2');
        geometries[i].computeVertexNormals();
    }

    // Merge everything
    const mergedGeometry = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries, false);
    return mergedGeometry;
}

function createScrewGeometry(size, headType) {
    // Parse size (e.g. M3 -> 3)
    const metricSize = parseInt(size.substring(1)) || 3;
    const radius = metricSize / 10 / 2; // radius in cm (M3 -> 1.5mm -> 0.15cm)
    const threadLength = 1.0; // Default 10mm length

    const geometries = [];

    // Thread body (simple cylinder for performance)
    const threadGeom = new THREE.CylinderGeometry(radius, radius, threadLength, 16);
    threadGeom.translate(0, threadLength / 2, 0); // Base at origin, grows in +Y
    geometries.push(threadGeom);

    // Head
    let headRadius = radius * 1.8; // Approximate standard ratios
    let headHeight = radius * 2.0;

    if (headType === 'socket') {
        headRadius = radius * 1.9;
        headHeight = radius * 2.0;
        
        // Socket head: Extrude a circle with a hex hole
        const headShape = new THREE.Shape();
        headShape.absarc(0, 0, headRadius, 0, Math.PI * 2, false);
        
        const hexRadius = radius * 0.9;
        const hexPath = new THREE.Path();
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const x = Math.cos(angle) * hexRadius;
            const y = Math.sin(angle) * hexRadius;
            if (i === 0) hexPath.moveTo(x, y);
            else hexPath.lineTo(x, y);
        }
        hexPath.lineTo(Math.cos(0) * hexRadius, Math.sin(0) * hexRadius); // close path
        headShape.holes.push(hexPath);
        
        const headGeom = new THREE.ExtrudeGeometry(headShape, { depth: headHeight, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.02, bevelThickness: 0.02, curveSegments: 12 });
        headGeom.rotateX(-Math.PI / 2); // Orient correctly
        headGeom.translate(0, threadLength + headHeight, 0);
        geometries.push(headGeom);
    } else if (headType === 'flat') {
        headRadius = radius * 2.2;
        headHeight = radius * 1.5;
        // Flat countersunk head
        const headGeom = new THREE.CylinderGeometry(headRadius, radius, headHeight, 16);
        headGeom.translate(0, threadLength + headHeight / 2, 0);
        geometries.push(headGeom);
    } else if (headType === 'button') {
        headRadius = radius * 2.0;
        headHeight = radius * 1.2;
        // Button dome head (half sphere-ish)
        const headGeom = new THREE.SphereGeometry(headRadius, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        // Squash it a bit to look like a button head
        headGeom.scale(1, headHeight / headRadius, 1);
        headGeom.translate(0, threadLength, 0);
        geometries.push(headGeom);
    } else if (headType === 'set') {
        // Set screw has no real head, just a hex hole inside the thread itself. 
        // We can just use the thread we already made, but let's hollow out the top.
        // For simplicity, we just leave the cylinder as is.
    }

    // Normalize geometries for merging (prevent index/uv mismatch errors)
    for (let i = 0; i < geometries.length; i++) {
        if (geometries[i].index) {
            geometries[i] = geometries[i].toNonIndexed();
        }
        geometries[i].deleteAttribute('uv');
        geometries[i].deleteAttribute('uv2');
        geometries[i].computeVertexNormals();
    }

    const mergedGeometry = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries, false);
    return mergedGeometry;
}

function generateHardwareGeometry(type, props) {
    let geometry;
    if (type === 'extrusion') {
        const profile = props.profile || '2020';
        const slotType = props.slot || 'v-slot';
        const length = props.length || 10;
        
        const shape = createExtrusionShape(profile, slotType);
        
        geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 8 });
        geometry.translate(0, 0, -length/2);
    } else if (type === 'motor') {
        const nema = props.nema || '17';
        geometry = createMotorGeometry(nema);
    } else if (type === 'screw') {
        const size = props.size || 'M3';
        const head = props.head || 'socket';
        geometry = createScrewGeometry(size, head);
    }
    return geometry;
}

function addHardware(type) {
    let name = "Hardware";
    let price = 0.0;
    let hwProps = {};
    
    if (type === 'extrusion') {
        hwProps = {
            profile: document.getElementById('hw-extrusion-profile')?.value || '2020',
            slot: document.getElementById('hw-extrusion-slot')?.value || 'v-slot',
            length: 10
        };
        name = `Alu Extrusion ${hwProps.profile}`;
        price = 2.50;
    } else if (type === 'motor') {
        hwProps = { nema: document.getElementById('hw-motor-type')?.value || '17' };
        name = `Stepper NEMA ${hwProps.nema}`;
        price = 12.00;
    } else if (type === 'screw') {
        hwProps = {
            size: document.getElementById('hw-screw-size')?.value || 'M3',
            head: document.getElementById('hw-screw-head')?.value || 'socket'
        };
        name = `Screw ${hwProps.size}`;
        price = 0.05;
    }

    const geometry = generateHardwareGeometry(type, hwProps);

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0x888888, transparent: false, opacity: 1.0, roughness: 0.5, metalness: 0.8
    }));
    
    const worldSnap = unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10;
    mesh.position.set(0, Math.round(1 / worldSnap) * worldSnap, 0);
    
    mesh.userData = { type: type, originalGeometry: geometry, bindings: {}, isComposite: false, isHole: false, isHardware: true, hwProps: hwProps };
    mesh.uuid = THREE.MathUtils.generateUUID();
    mesh.name = name;
    
    geometry.computeBoundingBox();
    const sz = new THREE.Vector3();
    geometry.boundingBox.getSize(sz);
    mesh.userData.baseSize = { x: sz.x, y: sz.y, z: sz.z };

    scene.add(mesh);
    shapes.push(mesh);
    
    // Add to BOM
    bomItems.push({ id: mesh.uuid, name: name, price: price, quantity: 1, invisible: false, meshId: mesh.uuid });
    renderBOM();
    
    selectShape(mesh);
    updateStatus(`Added ${name}`);
    historyManager.saveState();
}

function updateWirePreview() {
    if (wirePreviewLine) {
        scene.remove(wirePreviewLine);
        wirePreviewLine.geometry.dispose();
        wirePreviewLine = null;
    }
    if (wirePoints.length > 0) {
        const mat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
        // If there's only 1 point, we'll draw a line to the preview sphere in onPointerMove
        const pts = [...wirePoints];
        if (wirePreviewSphere && wirePreviewSphere.visible) {
            pts.push(wirePreviewSphere.position.clone());
        }
        
        if (pts.length > 1) {
            const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
            const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
            wirePreviewLine = new THREE.Line(geom, mat);
            scene.add(wirePreviewLine);
        }
    }
}

function finalizeWire() {
    if (wirePoints.length < 2) return cancelWire();
    
    // Create tube geometry
    const curve = new THREE.CatmullRomCurve3(wirePoints, false, 'catmullrom', 0.5);
    const geometry = new THREE.TubeGeometry(curve, Math.max(20, wirePoints.length * 10), 0.15, 8, false);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0xcc0000, roughness: 0.7, metalness: 0.1
    }));
    
    mesh.userData = { type: 'wire', originalGeometry: geometry, bindings: {}, isComposite: false, isHardware: true, wirePoints: wirePoints.map(p => p.clone()) };
    mesh.uuid = THREE.MathUtils.generateUUID();
    mesh.name = `Wire Route`;
    
    geometry.computeBoundingBox();
    const sz = new THREE.Vector3();
    geometry.boundingBox.getSize(sz);
    mesh.userData.baseSize = { x: sz.x || 1, y: sz.y || 1, z: sz.z || 1 };

    scene.add(mesh);
    shapes.push(mesh);
    
    // Calculate length
    const lengthCm = curve.getLength();
    
    bomItems.push({ id: mesh.uuid, name: `22AWG Wire (${lengthCm.toFixed(1)}cm)`, price: (lengthCm * 0.05).toFixed(2), quantity: 1, invisible: false, meshId: mesh.uuid });
    renderBOM();
    
    selectShape(mesh);
    historyManager.saveState();
    cancelWire();
}

function cancelWire() {
    isWiringMode = false;
    wirePoints = [];
    if (wirePreviewLine) { scene.remove(wirePreviewLine); wirePreviewLine.geometry.dispose(); wirePreviewLine = null; }
    if (wirePreviewSphere) { wirePreviewSphere.visible = false; }
    document.getElementById('wire-tool').classList.remove('active');
    updateStatus('Wire routing cancelled.');
}

function updateSelectionEffects() {
    outlinePass.selectedObjects = selectedShapes;
    if (isAlignMode) updateAlignmentGizmo();
    
    const panel = document.getElementById('properties-panel');
    if (selectedShapes.length === 1 && !isAlignMode) {
        panel.style.display = 'flex';
        const shape = selectedShapes[0];
        
        const typeSolid = document.getElementById('type-solid');
        const typeHole = document.getElementById('type-hole');
        if (shape.userData.isHole) typeHole.checked = true;
        else typeSolid.checked = true;
        
        const partSelect = document.getElementById('obj-part');
        partSelect.innerHTML = '<option value="root">Overall Shape</option>';
        if (shape.userData.isComposite && shape.userData.groupChildren) {
            document.getElementById('prop-part-row').style.display = 'flex';
            const leaves = [];
            const extract = (node) => {
                if (node.userData.isComposite && node.userData.groupChildren) {
                    node.userData.groupChildren.forEach(child => extract(child));
                } else {
                    leaves.push(node);
                }
            };
            extract(shape);
            leaves.forEach(leaf => {
                const opt = document.createElement('option');
                opt.value = leaf.uuid; opt.innerText = leaf.name || 'Shape';
                partSelect.appendChild(opt);
            });
        } else {
            document.getElementById('prop-part-row').style.display = 'none';
        }
        
        partSelect.value = "root";
        selectPropertyNode(shape);
        
        partSelect.onchange = (e) => {
            if (e.target.value === 'root') selectPropertyNode(shape);
            else {
                let found = null;
                const search = (node) => {
                    if (!node) return;
                    if (node.uuid === e.target.value) found = node;
                    if (!found && node.userData.isComposite && node.userData.groupChildren) {
                        node.userData.groupChildren.forEach(child => search(child));
                    }
                };
                search(shape);
                if (found) selectPropertyNode(found);
            }
        };
        
        if (transformControl.getMode() === 'scale') updateDimensions();
    } else {
        panel.style.display = 'none';
        if (previewMesh) { previewScene.remove(previewMesh); previewMesh = null; }
        clearDimensions();
    }
}

function selectPropertyNode(node) {
    currentPropertyNode = node;    
    document.getElementById('hardware-properties').style.display = 'none';
    if (selectedShape.userData.isHardware) {
        document.getElementById('hardware-properties').style.display = 'flex';
        // Hide others, show relevant
        document.querySelectorAll('.hw-extrusion, .hw-motor, .hw-screw').forEach(el => el.style.display = 'none');
        document.querySelectorAll(`.hw-${selectedShape.userData.type}`).forEach(el => el.style.display = 'flex');
        
        // Populate dropdowns based on hwProps
        const props = selectedShape.userData.hwProps || {};
        if (selectedShape.userData.type === 'extrusion') {
            const profileEl = document.getElementById('hw-extrusion-profile');
            if (profileEl && props.profile) profileEl.value = props.profile;
            const slotEl = document.getElementById('hw-extrusion-slot');
            if (slotEl && props.slot) slotEl.value = props.slot;
        } else if (selectedShape.userData.type === 'motor') {
            const nemaEl = document.getElementById('hw-motor-type');
            if (nemaEl && props.nema) nemaEl.value = props.nema;
        } else if (selectedShape.userData.type === 'screw') {
            const sizeEl = document.getElementById('hw-screw-size');
            if (sizeEl && props.size) sizeEl.value = props.size;
            const headEl = document.getElementById('hw-screw-head');
            if (headEl && props.head) headEl.value = props.head;
        }
    }
    
    document.getElementById('obj-color').value = '#' + (Array.isArray(selectedShape.material) ? selectedShape.material[0].color : selectedShape.material.color).getHexString();
    document.getElementById('obj-transparent').checked = node.material.transparent;
    
    const bindings = node.userData.bindings || {};
    let base = node.userData.baseSize;
    if (!base) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const sz = new THREE.Vector3(); node.geometry.boundingBox.getSize(sz);
        base = { x: sz.x || 1, y: sz.y || 1, z: sz.z || 1 };
    }
    
    const setInput = (id, axis) => {
        const input = document.getElementById(id);
        const s = node;
        input.value = (s.userData.bindings && s.userData.bindings[axis]) || (s.scale[axis] * s.userData.baseSize[axis]).toFixed(2);
    };
    setInput('obj-w', 'x'); setInput('obj-h', 'y'); setInput('obj-l', 'z');
    
    const container = document.getElementById('preview-container');
    if (container.clientWidth > 0 && container.clientHeight > 0 && previewRenderer) {
        previewRenderer.setSize(container.clientWidth, container.clientHeight);
        previewCamera.aspect = container.clientWidth / container.clientHeight;
        previewCamera.updateProjectionMatrix();
    }
    
    if (previewMesh) previewScene.remove(previewMesh);
    
    // Some libraries return arrays for materials, so handle it safely
    const newMat = Array.isArray(node.material) ? node.material[0].clone() : node.material.clone();
    previewMesh = new THREE.Mesh(node.userData.originalGeometry || node.geometry, newMat);
    previewMesh.scale.copy(node.scale);
    previewMesh.position.set(0,0,0);
    
    const box = new THREE.Box3().setFromObject(previewMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const cameraZ = Math.abs(Math.max(size.x, size.y, size.z) / 2 / Math.tan(previewCamera.fov * (Math.PI / 180) / 2)) * 1.5;
    previewCamera.position.set(center.x + cameraZ, center.y + cameraZ, center.z + cameraZ);
    previewCamera.lookAt(center);
    if (previewControls) previewControls.target.copy(center);
    previewScene.add(previewMesh);
}

function selectShape(mesh, evt = null) {
    if (evt && (evt.ctrlKey || evt.metaKey || evt.shiftKey)) {
        const index = selectedShapes.indexOf(mesh);
        if (index > -1) {
            selectedShapes.splice(index, 1);
            if (selectedShapes.length > 0) { selectedShape = selectedShapes[selectedShapes.length - 1]; if (!isAlignMode) transformControl.attach(selectedShape); }
            else { selectedShape = null; transformControl.detach(); }
        } else { selectedShapes.push(mesh); selectedShape = mesh; if (!isAlignMode) transformControl.attach(selectedShape); }
    } else {
        selectedShapes = [mesh]; selectedShape = mesh; if (!isAlignMode) transformControl.attach(selectedShape);
    }
    updateSelectionEffects(); updateStatus(`${selectedShapes.length} shapes selected`);
}

function onPointerDown(event) {
    if (event.target.tagName === 'INPUT') return;
    if (event.target.closest('.toolbar, .glass-panel, #theme-toggles, #viewcube-wrapper')) return;
    if (transformControl.dragging) return;
    
    if (event.shiftKey) {
        isAreaSelecting = true; controls.enabled = false;
        selectionStartPoint.set(event.clientX, event.clientY);
        selectionDiv.style.left = event.clientX + 'px'; selectionDiv.style.top = event.clientY + 'px';
        selectionDiv.style.width = '0px'; selectionDiv.style.height = '0px'; selectionDiv.style.display = 'block';
        selectionBox.startPoint.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1, 0.5);
        return;
    }
    
    pointerDownPos.set(event.clientX, event.clientY);
    
    if (isAlignMode || isDistributeMode) return;
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, activeCamera);

    if (isWiringMode) {
        // intersect against shapes or a plane
        const intersects = raycaster.intersectObjects(shapes);
        let pt;
        if (intersects.length > 0) {
            pt = intersects[0].point;
        } else {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            pt = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, pt);
        }
        
        if (pt) {
            wirePoints.push(pt.clone());
            updateWirePreview();
        }
        return;
    }

    const intersects = raycaster.intersectObjects(shapes);
    if (intersects.length > 0) {
        const clickedShape = intersects[0].object;
        if (selectedShapes.indexOf(clickedShape) === -1 || (event.ctrlKey || event.metaKey || event.shiftKey)) selectShape(clickedShape, event);
    } else {
        if (!transformControl.axis && !isAlignMode && !isDistributeMode) {
            selectedShapes = []; selectedShape = null; transformControl.detach(); updateSelectionEffects(); updateStatus('Selection cleared');
        }
    }
}

function onPointerMove(event) {
    if (isWiringMode && wirePreviewSphere) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, activeCamera);
        const intersects = raycaster.intersectObjects(shapes);
        if (intersects.length > 0) {
            wirePreviewSphere.position.copy(intersects[0].point);
        } else {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const pt = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, pt);
            if (pt) wirePreviewSphere.position.copy(pt);
        }
        updateWirePreview();
    }

    if (isAreaSelecting) {
        selectionDiv.style.left = Math.min(selectionStartPoint.x, event.clientX) + 'px';
        selectionDiv.style.top = Math.min(selectionStartPoint.y, event.clientY) + 'px';
        selectionDiv.style.width = Math.abs(event.clientX - selectionStartPoint.x) + 'px';
        selectionDiv.style.height = Math.abs(event.clientY - selectionStartPoint.y) + 'px';
    }
}

function onPointerUp(event) {
    if (isAreaSelecting) {
        isAreaSelecting = false; selectionDiv.style.display = 'none'; controls.enabled = true;
        selectionBox.endPoint.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1, 0.5);
        const newSelections = selectionBox.select().filter(obj => shapes.includes(obj));
        newSelections.forEach(shape => { if (!selectedShapes.includes(shape)) selectedShapes.push(shape); });
        if (selectedShapes.length > 0) { selectedShape = selectedShapes[selectedShapes.length - 1]; if (!isAlignMode) transformControl.attach(selectedShape); }
        updateSelectionEffects(); updateStatus(`${selectedShapes.length} shapes selected`);
        return;
    }
    
    if (new THREE.Vector2(event.clientX, event.clientY).distanceTo(pointerDownPos) < 5) {
        if (isAlignMode || isDistributeMode) {
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, activeCamera);
            
            if (alignmentGizmo) {
                const handles = raycaster.intersectObjects(alignmentGizmo.children).filter(h => h.object.userData.isHandle);
                if (handles.length > 0) {
                    if (isAlignMode) performAlign(handles[0].object.userData.axis, handles[0].object.userData.valType, handles[0].object.userData.val);
                    else if (isDistributeMode) performDistribute(handles[0].object.userData.axis, handles[0].object.userData.valType);
                    return;
                }
                const objs = raycaster.intersectObjects(selectedShapes);
                if (objs.length > 0 && isAlignMode) { focusedAlignObject = objs[0].object; updateAlignmentGizmo(); updateStatus('Focused on object for relative alignment'); return; }
            }
        }
    }
}

function toggleAlignMode() {
    isAlignMode = !isAlignMode;
    const btn = document.getElementById('align-mode'); if (btn) btn.classList.toggle('active', isAlignMode);
    if (isAlignMode && isDistributeMode) toggleDistributeMode();
    
    if (isAlignMode) {
        transformControl.detach(); document.getElementById('properties-panel').style.display = 'none'; clearDimensions();
        if (selectedShapes.length < 2) { updateStatus('Select at least 2 shapes to align'); isAlignMode = false; btn.classList.remove('active'); if (selectedShape) transformControl.attach(selectedShape); return; }
        focusedAlignObject = null; updateAlignmentGizmo(); updateStatus('Align Mode: Click handles to align, or click an object to focus it.');
    } else {
        removeAlignmentGizmo(); if (selectedShape) transformControl.attach(selectedShape);
        updateSelectionEffects(); updateStatus('Exited Align Mode');
    }
}

function toggleDistributeMode() {
    isDistributeMode = !isDistributeMode;
    const btn = document.getElementById('distribute-shapes'); if (btn) btn.classList.toggle('active', isDistributeMode);
    if (isDistributeMode && isAlignMode) toggleAlignMode();
    
    if (isDistributeMode) {
        transformControl.detach(); document.getElementById('properties-panel').style.display = 'none'; clearDimensions();
        if (selectedShapes.length < 3) { updateStatus('Select at least 3 shapes to distribute'); isDistributeMode = false; btn.classList.remove('active'); if (selectedShape) transformControl.attach(selectedShape); return; }
        focusedAlignObject = null; updateAlignmentGizmo(); updateStatus('Distribute Mode: Click handles to distribute evenly along an axis.');
    } else {
        removeAlignmentGizmo(); if (selectedShape) transformControl.attach(selectedShape);
        updateSelectionEffects(); updateStatus('Exited Distribute Mode');
    }
}

function removeAlignmentGizmo() { if (alignmentGizmo) { scene.remove(alignmentGizmo); alignmentGizmo = null; } }

function updateAlignmentGizmo() {
    removeAlignmentGizmo(); if ((!isAlignMode && !isDistributeMode) || selectedShapes.length < 2) return;
    alignmentGizmo = new THREE.Group();
    let bounds = new THREE.Box3();
    if (focusedAlignObject) bounds.setFromObject(focusedAlignObject);
    else selectedShapes.forEach(shape => bounds.union(new THREE.Box3().setFromObject(shape)));
    
    const accentColor = document.body.getAttribute('data-color-theme') === 'holodeck' ? 0xecc94b : 0x0055ff;
    const mat = new THREE.MeshBasicMaterial({ color: accentColor, depthTest: false });
    const geom = new THREE.SphereGeometry(0.7, 16, 16);
    
    const addHandle = (x, y, z, axis, valType, val) => {
        const mesh = new THREE.Mesh(geom, mat); mesh.position.set(x, y, z);
        mesh.userData = { isHandle: true, axis, valType, val }; mesh.renderOrder = 999; alignmentGizmo.add(mesh);
    };
    
    const cX = (bounds.min.x + bounds.max.x) / 2, cY = (bounds.min.y + bounds.max.y) / 2, cZ = (bounds.min.z + bounds.max.z) / 2;
    addHandle(bounds.min.x, bounds.min.y - 1, bounds.min.z - 1, 'x', 'min', bounds.min.x); addHandle(cX, bounds.min.y - 1, bounds.min.z - 1, 'x', 'center', cX); addHandle(bounds.max.x, bounds.min.y - 1, bounds.min.z - 1, 'x', 'max', bounds.max.x);
    addHandle(bounds.max.x + 1, bounds.min.y, bounds.max.z + 1, 'y', 'min', bounds.min.y); addHandle(bounds.max.x + 1, cY, bounds.max.z + 1, 'y', 'center', cY); addHandle(bounds.max.x + 1, bounds.max.y, bounds.max.z + 1, 'y', 'max', bounds.max.y);
    addHandle(bounds.min.x - 1, bounds.min.y - 1, bounds.min.z, 'z', 'min', bounds.min.z); addHandle(bounds.min.x - 1, bounds.min.y - 1, cZ, 'z', 'center', cZ); addHandle(bounds.min.x - 1, bounds.min.y - 1, bounds.max.z, 'z', 'max', bounds.max.z);
    
    alignmentGizmo.add(new THREE.Box3Helper(bounds, accentColor)); scene.add(alignmentGizmo);
}

function performAlign(axis, valType, targetVal) {
    selectedShapes.forEach(shape => {
        if (focusedAlignObject && shape === focusedAlignObject) return;
        const b = new THREE.Box3().setFromObject(shape);
        const offset = valType === 'min' ? targetVal - b.min[axis] : (valType === 'max' ? targetVal - b.max[axis] : targetVal - (b.min[axis] + b.max[axis])/2);
        shape.position[axis] += offset;
    });
    updateAlignmentGizmo();
}



function evaluateGroup(children) {
    let solids = children.filter(s => !s.userData.isHole);
    let holes = children.filter(s => s.userData.isHole);
    
    if (solids.length === 0) throw new Error("Cannot group only holes. Please include at least one solid.");
    
    children.forEach(c => c.updateMatrixWorld(true));
    
    let baseSolid = solids[0];
    for (let i = 1; i < solids.length; i++) {
        const temp = CSG.union(baseSolid, solids[i]);
        if (temp) {
            temp.geometry.applyMatrix4(temp.matrix);
            temp.position.set(0,0,0); temp.rotation.set(0,0,0); temp.scale.set(1,1,1); temp.updateMatrixWorld(true);
            baseSolid = temp;
        }
    }
    
    let result = baseSolid;
    for (let i = 0; i < holes.length; i++) {
        const temp = CSG.subtract(result, holes[i]);
        if (temp) {
            temp.geometry.applyMatrix4(temp.matrix);
            temp.position.set(0,0,0); temp.rotation.set(0,0,0); temp.scale.set(1,1,1); temp.updateMatrixWorld(true);
            result = temp;
        }
    }
    
    const resultGeometry = result.geometry;
    resultGeometry.computeBoundingBox();
    const center = new THREE.Vector3(); resultGeometry.boundingBox.getCenter(center);
    resultGeometry.translate(-center.x, -center.y, -center.z);
    
    const newMat = Array.isArray(solids[0].material) ? solids[0].material.map(m => m.clone()) : solids[0].material.clone();
    const finalMesh = new THREE.Mesh(resultGeometry, newMat);
    finalMesh.position.copy(center); finalMesh.updateMatrixWorld(true);
    
    return finalMesh;
}

function rebuildCSG(mesh) {
    if (!mesh.userData.isComposite || !mesh.userData.groupChildren) return;
    
    mesh.userData.groupChildren.forEach(child => {
        if (child.userData.isComposite) rebuildCSG(child);
    });
    
    try {
        const newMesh = evaluateGroup(mesh.userData.groupChildren);
        if (newMesh) {
            const invMatrix = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
            newMesh.geometry.applyMatrix4(invMatrix);
            
            if (mesh.geometry) mesh.geometry.dispose();
            mesh.geometry = newMesh.geometry;
            mesh.geometry.computeBoundingBox();
            mesh.userData.baseSize = null;
        }
    } catch (e) { console.error('CSG rebuild failed:', e); }
}

function groupShapes() {
    if (selectedShapes.length < 2) { updateStatus('Select at least 2 shapes to group'); return; }
    transformControl.detach();
    
    try {
        const shapesToGroup = [...selectedShapes];
        const resultMesh = evaluateGroup(shapesToGroup);
        
        if (resultMesh) {
            resultMesh.userData = { isComposite: true, isHole: false, groupChildren: shapesToGroup, bindings: {} };
            resultMesh.uuid = THREE.MathUtils.generateUUID();
            resultMesh.name = "Group " + (shapes.length + 1);
            
            shapesToGroup.forEach(s => {
                const invMatrix = new THREE.Matrix4().copy(resultMesh.matrixWorld).invert();
                s.applyMatrix4(invMatrix);
                s.visible = false;
                resultMesh.add(s);
                scene.remove(s);
                shapes = shapes.filter(x => x !== s);
            });
            
            scene.add(resultMesh);
            shapes.push(resultMesh);
            selectShape(resultMesh);
            updateStatus('Grouped shapes');
            historyManager.saveState();
        }
    } catch (e) {
        updateStatus(`Grouping failed: ${e.message}`);
        console.error(e);
    }
}

function ungroupShapes() {
    const groups = selectedShapes.filter(s => s.userData.isComposite && s.userData.groupChildren);
    if (groups.length === 0) { updateStatus('No groups selected to ungroup'); return; }
    
    transformControl.detach();
    let newSelection = [];
    
    groups.forEach(group => {
        scene.remove(group);
        shapes = shapes.filter(s => s !== group);
        
        group.userData.groupChildren.forEach(child => {
            child.applyMatrix4(group.matrixWorld);
            child.visible = true;
            group.remove(child);
            scene.add(child);
            shapes.push(child);
            newSelection.push(child);
        });
    });
    
    selectedShapes = [];
    selectedShape = null;
    newSelection.forEach(s => selectShape(s, {ctrlKey: true}));
    
    updateStatus('Ungrouped shapes');
    historyManager.saveState();
}

function performDistribute(axis, valType) {
    if (selectedShapes.length < 3) return;

    selectedShapes.sort((a, b) => {
        const bA = new THREE.Box3().setFromObject(a);
        const bB = new THREE.Box3().setFromObject(b);
        const vA = valType === 'min' ? bA.min[axis] : (valType === 'max' ? bA.max[axis] : (bA.min[axis]+bA.max[axis])/2);
        const vB = valType === 'min' ? bB.min[axis] : (valType === 'max' ? bB.max[axis] : (bB.min[axis]+bB.max[axis])/2);
        return vA - vB;
    });

    const bFirst = new THREE.Box3().setFromObject(selectedShapes[0]);
    const bLast = new THREE.Box3().setFromObject(selectedShapes[selectedShapes.length - 1]);
    
    const minVal = valType === 'min' ? bFirst.min[axis] : (valType === 'max' ? bFirst.max[axis] : (bFirst.min[axis]+bFirst.max[axis])/2);
    const maxVal = valType === 'min' ? bLast.min[axis] : (valType === 'max' ? bLast.max[axis] : (bLast.min[axis]+bLast.max[axis])/2);
    
    const step = (maxVal - minVal) / (selectedShapes.length - 1);
    
    for (let i = 1; i < selectedShapes.length - 1; i++) {
        const shape = selectedShapes[i];
        const b = new THREE.Box3().setFromObject(shape);
        const currVal = valType === 'min' ? b.min[axis] : (valType === 'max' ? b.max[axis] : (b.min[axis]+b.max[axis])/2);
        const targetVal = minVal + i * step;
        shape.position[axis] += (targetVal - currVal);
        shape.updateMatrixWorld(true);
    }
    
    updateAlignmentGizmo();
    updateStatus(`Distributed ${selectedShapes.length} shapes along ${axis.toUpperCase()}`);
}

function exportSTL() {
    const exporter = new THREE.STLExporter();
    const blob = new Blob([exporter.parse(scene, { binary: false })], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'model.stl'; a.click(); URL.revokeObjectURL(url);
}

function clearAll(isRestoring = false) {
    transformControl.detach(); shapes.forEach(shape => scene.remove(shape));
    shapes = []; selectedShape = null; selectedShapes = []; updateSelectionEffects(); 
    document.getElementById('properties-panel').classList.remove('active');
    if (!isRestoring) {
        historyManager.saveState();
        updateStatus('Cleared all shapes');
    }
}

function deleteSelected() {
    if (selectedShapes.length === 0) return;
    transformControl.detach();
    selectedShapes.forEach(shape => {
        scene.remove(shape);
        shapes = shapes.filter(s => s !== shape);
    });
    selectedShapes = [];
    selectedShape = null;
    updateSelectionEffects();
    historyManager.saveState();
    updateStatus('Deleted selected shapes');
}

function toggleGrid() {
    gridVisible = !gridVisible; gridHelper.visible = gridVisible;
    document.getElementById('toggle-grid')?.classList.toggle('active', gridVisible); updateStatus(gridVisible ? 'Grid enabled' : 'Grid disabled');
}

function toggleUnit() {
    unitMode = unitMode === 'cm' ? 'inch' : 'cm';
    const btn = document.getElementById('unit-toggle'); if (btn) btn.innerHTML = unitMode === 'inch' ? '<i class="fas fa-shoe-prints"></i>' : '<i class="fas fa-ruler"></i>';
    updateStatus(`Unit: ${unitMode.toUpperCase()}`); updateGridScale(); populateSnapOptions();
}

function updateStatus(message) {
    const statusEl = document.getElementById('status-bar');
    if (statusEl) statusEl.innerHTML = `<i class="fas fa-info-circle status-icon"></i> ${message}`;
}

function onWindowResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (isOrthographic) {
        const dist = activeCamera.position.distanceTo(controls.target);
        const ht = 2 * dist * Math.tan(camera.fov * THREE.MathUtils.DEG2RAD / 2);
        orthoCamera.left = ht * camera.aspect / -2; orthoCamera.right = ht * camera.aspect / 2;
        orthoCamera.top = ht / 2; orthoCamera.bottom = ht / -2; orthoCamera.updateProjectionMatrix();
    }
    renderer.setSize(w, h); if (composer) { composer.setSize(w, h); if (outlinePass) outlinePass.resolution.set(w, h); }
    if (labelRenderer) labelRenderer.setSize(w, h);
}

function animate() {
    requestAnimationFrame(animate); controls.update();
    if (composer) composer.render(); else renderer.render(scene, activeCamera);
    if (labelRenderer) labelRenderer.render(scene, activeCamera);
    
    if (previewRenderer && previewScene && previewCamera && document.getElementById('properties-panel').style.display !== 'none') {
        if (previewControls) previewControls.update();
        previewRenderer.render(previewScene, previewCamera);
    }
    
    if (viewcubeRenderer && viewcubeScene && viewcubeCamera && activeCamera) {
        if (isDraggingViewCube) {
            const dir = viewcubeCamera.position.clone().normalize();
            const dist = activeCamera.position.distanceTo(controls.target);
            activeCamera.position.copy(controls.target).add(dir.multiplyScalar(dist));
            activeCamera.lookAt(controls.target);
            activeCamera.up.copy(viewcubeCamera.up);
        } else {
            viewcubeCamera.position.copy(activeCamera.position.clone().sub(controls.target)).normalize().multiplyScalar(4);
            viewcubeCamera.lookAt(0, 0, 0); viewcubeCamera.up.copy(activeCamera.up);
        }
        viewcubeControls.update();
        viewcubeRenderer.render(viewcubeScene, viewcubeCamera);
    }
}

// === HISTORY & UNDO/REDO LOGIC ===
class HistoryManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.isRestoring = false;
    }

    saveState() {
        if (this.isRestoring) return;
        const state = serializeScene();
        this.undoStack.push(state);
        this.redoStack = [];
        updateToolbarButtons();
    }

    undo() {
        if (this.undoStack.length <= 1) return;
        const currentState = this.undoStack.pop();
        this.redoStack.push(currentState);
        const prevState = this.undoStack[this.undoStack.length - 1];
        this.restoreState(prevState);
        updateToolbarButtons();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const nextState = this.redoStack.pop();
        this.undoStack.push(nextState);
        this.restoreState(nextState);
        updateToolbarButtons();
    }

    restoreState(state) {
        this.isRestoring = true;
        deserializeScene(state);
        this.isRestoring = false;
    }
}

const historyManager = new HistoryManager();

function updateToolbarButtons() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.style.opacity = historyManager.undoStack.length > 1 ? "1" : "0.5";
    if (btnRedo) btnRedo.style.opacity = historyManager.redoStack.length > 0 ? "1" : "0.5";
}

function serializeShape(mesh) {
    const data = {
        uuid: mesh.uuid,
        name: mesh.name,
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
        material: {
            color: Array.isArray(mesh.material) ? mesh.material[0].color.getHex() : mesh.material.color.getHex(),
            transparent: Array.isArray(mesh.material) ? mesh.material[0].transparent : mesh.material.transparent,
            opacity: Array.isArray(mesh.material) ? mesh.material[0].opacity : mesh.material.opacity
        },
        userData: {
            type: mesh.userData.type,
            bindings: mesh.userData.bindings ? { ...mesh.userData.bindings } : {},
            isComposite: mesh.userData.isComposite,
            baseSize: mesh.userData.baseSize ? { ...mesh.userData.baseSize } : null,
            csgOp: mesh.userData.csgOp
        }
    };
    
    if (mesh.userData.isComposite) {
        data.userData.left = serializeShape(mesh.userData.left);
        data.userData.right = serializeShape(mesh.userData.right);
    }
    return data;
}

function serializeScene() {
    renderer.render(scene, activeCamera);
    const thumbnail = renderer.domElement.toDataURL('image/webp', 0.2);
    return {
        shapes: shapes.map(serializeShape),
        variables: { ...window.holodeckVariables },
        metadata: {
            status: document.getElementById('lc-status')?.value || 'Draft',
            category: document.getElementById('lc-category')?.value || '',
            productLine: document.getElementById('lc-line')?.value || '',
            version: document.getElementById('lc-version')?.value || '1.0'
        },
        bom: JSON.parse(JSON.stringify(bomItems)),
        thumbnail: thumbnail
    };
}

function deserializeShape(data) {
    let mesh;
    const material = new THREE.MeshStandardMaterial({
        color: data.material.color,
        transparent: data.material.transparent,
        opacity: data.material.opacity,
        roughness: 0.4,
        metalness: 0.1
    });

    if (data.userData.isComposite) {
        const left = deserializeShape(data.userData.left);
        const right = deserializeShape(data.userData.right);
        
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.position.fromArray(data.position);
        mesh.quaternion.fromArray(data.quaternion);
        mesh.scale.fromArray(data.scale);
        mesh.updateMatrix();
        
        mesh.add(left);
        mesh.add(right);
        mesh.userData = data.userData;
        mesh.userData.left = left;
        mesh.userData.right = right;
        mesh.updateMatrixWorld(true);
        
        // Use the existing rebuildCSG logic to regenerate geometry
        rebuildCSG(mesh);
    } else {
        let geometry;
        switch(data.userData.type) {
            case 'cube': geometry = new THREE.BoxGeometry(2, 2, 2); break;
            case 'sphere': geometry = new THREE.SphereGeometry(1.5, 32, 32); break;
            case 'cylinder': geometry = new THREE.CylinderGeometry(1, 1, 2, 32); break;
            case 'cone': geometry = new THREE.ConeGeometry(1.5, 2, 32); break;
            default: geometry = new THREE.BoxGeometry(2,2,2);
        }
        mesh = new THREE.Mesh(geometry, material);
        mesh.userData = data.userData;
        mesh.userData.originalGeometry = geometry;
        
        mesh.position.fromArray(data.position);
        mesh.quaternion.fromArray(data.quaternion);
        mesh.scale.fromArray(data.scale);
        mesh.updateMatrix();
    }
    
    mesh.uuid = data.uuid;
    mesh.name = data.name;
    mesh.updateMatrixWorld(true);
    
    return mesh;
}

function deserializeScene(state) {
    clearAll(true); 
    window.holodeckVariables = { ...state.variables };
    renderVariables();
    
    if (state.metadata) {
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('lc-status', state.metadata.status || 'Draft');
        setVal('lc-category', state.metadata.category || '');
        setVal('lc-line', state.metadata.productLine || '');
        setVal('lc-version', state.metadata.version || '1.0');
    }
    
    if (state.bom) {
        bomItems = JSON.parse(JSON.stringify(state.bom));
    } else {
        bomItems = [];
    }
    renderBOM();
    
    state.shapes.forEach(shapeData => {
        const mesh = deserializeShape(shapeData);
        scene.add(mesh);
        shapes.push(mesh);
    });
    
    selectedShapes = [];
    selectedShape = null;
    transformControl.detach();
    updateSelectionEffects();
    document.getElementById('properties-panel').classList.remove('active');
}

// Local Project Dashboard Logic
const btnDashboard = document.getElementById('btn-dashboard');
const dashboardOverlay = document.getElementById('dashboard-overlay');
const closeDashboard = document.getElementById('close-dashboard');
const btnSelectDir = document.getElementById('btn-select-dir');
const dashboardGrid = document.getElementById('dashboard-grid');
const dashboardStatus = document.getElementById('dashboard-status');

if (btnDashboard) {
    btnDashboard.addEventListener('click', () => {
        dashboardOverlay.style.display = 'flex';
    });
}
if (closeDashboard) {
    closeDashboard.addEventListener('click', () => {
        dashboardOverlay.style.display = 'none';
    });
}

if (btnSelectDir) {
    btnSelectDir.addEventListener('click', async () => {
        try {
            const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
            dashboardStatus.innerText = `Folder: ${dirHandle.name}`;
            dashboardGrid.innerHTML = '';
            
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.holo')) {
                    try {
                        const file = await entry.getFile();
                        const text = await file.text();
                        const data = JSON.parse(text);
                        if (data.version && data.undoStack && data.undoStack.length > 0) {
                            const state = data.undoStack[data.undoStack.length - 1];
                            const meta = state.metadata || {};
                            let cost = 0;
                            if (state.bom) {
                                state.bom.forEach(i => cost += (i.price || 0) * (i.quantity || 1));
                            }
                            const thumbnail = state.thumbnail || '';
                            
                            const card = document.createElement('div');
                            card.className = 'project-card';
                            card.innerHTML = `
                                ${thumbnail ? `<img src="${thumbnail}" alt="Thumbnail">` : '<div style="width:100%; height:150px; background:#222;"></div>'}
                                <h3>${entry.name.replace('.holo', '')}</h3>
                                <div class="meta">
                                    <span>${meta.status || 'Draft'}</span>
                                    <span>v${meta.version || '1.0'}</span>
                                </div>
                                <div class="meta">
                                    <span>${meta.category || 'Uncategorized'}</span>
                                    <span>$${cost.toFixed(2)}</span>
                                </div>
                            `;
                            card.addEventListener('click', () => {
                                historyManager.undoStack = data.undoStack;
                                historyManager.redoStack = data.redoStack || [];
                                historyManager.restoreState(state);
                                updateToolbarButtons();
                                dashboardOverlay.style.display = 'none';
                                updateStatus(`Loaded ${entry.name}`);
                            });
                            dashboardGrid.appendChild(card);
                        }
                    } catch (err) {
                        console.error('Error parsing', entry.name, err);
                    }
                }
            }
        } catch (err) {
            console.error(err);
            dashboardStatus.innerText = 'Folder selection cancelled or failed.';
        }
    });
}

function updateSelectedHardwareProfile() {
    if (!selectedShape || !selectedShape.userData.isHardware) return;
    const type = selectedShape.userData.type;
    const props = selectedShape.userData.hwProps || {};
    
    if (type === 'extrusion') {
        props.profile = document.getElementById('hw-extrusion-profile').value;
        props.slot = document.getElementById('hw-extrusion-slot').value;
        selectedShape.name = `Alu Extrusion ${props.profile}`;
    } else if (type === 'motor') {
        props.nema = document.getElementById('hw-motor-type').value;
        selectedShape.name = `Stepper NEMA ${props.nema}`;
    } else if (type === 'screw') {
        props.size = document.getElementById('hw-screw-size').value;
        props.head = document.getElementById('hw-screw-head').value;
        selectedShape.name = `Screw ${props.size}`;
    }
    
    const newGeom = generateHardwareGeometry(type, props);
    if (selectedShape.geometry) selectedShape.geometry.dispose();
    selectedShape.geometry = newGeom;
    selectedShape.userData.originalGeometry = newGeom;
    
    newGeom.computeBoundingBox();
    const sz = new THREE.Vector3();
    newGeom.boundingBox.getSize(sz);
    selectedShape.userData.baseSize = { x: sz.x, y: sz.y, z: sz.z };
    
    // Refresh properties panel to show new dimensions
    if (currentPropertyNode) selectPropertyNode(currentPropertyNode);
    updateDimensions();
    renderBOM();
    historyManager.saveState();
}

['hw-extrusion-profile', 'hw-extrusion-slot', 'hw-motor-type', 'hw-screw-size', 'hw-screw-head'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateSelectedHardwareProfile);
});

init();
animate();
