import { CSG } from '../vendor/three-csg-ts/csg.js';
import { importFile, importFormatOf, convertImported, UNIT_MM, ImportError, encodePositions, decodePositions } from './importers.js';
import { showFormDialog, showInfoDialog, loadPrefs, savePrefs, describeTransform, describeMeasurement } from './ui.js';
import { kvGet, kvPut, kvDelete } from './storage.js';
import { EXPORT_FORMATS, countTriangles } from './exporters.js';
import { evaluateParts } from './csg-core.js';
import { analyzeMesh, repairMesh, describeHealth } from './meshtools.js';
import { revolveProfile, mirrorPositions, flipWinding, signedVolume, beveledBox, normalizeEdge, frustum } from './modeling.js';

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

// Sketch tool state
let isSketchMode = false;
let sketchPoints = [];
let sketchLine = null;

// Measure tool state
let isMeasureMode = false;
let measurePending = null;   // first point of a measurement in progress
let measureGroup = null;
let measureMarkers = [];

let cloneShape = null; // deepCloneShape, hoisted out of setupToolbar for the modelling tools

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
        delBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i>';
        delBtn.setAttribute('aria-label', `Remove ${item.name} from the bill of materials`);
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
        document.getElementById('drag-hud')?.classList.toggle('active', !!event.value);
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
        if (transformControl.dragging) updateDragHud();
        if (transformControl.dragging && currentPropertyNode === selectedShape) syncTransformInputs();
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
    markClean();

    labelIconButtons();
    document.getElementById('btn-help')?.addEventListener('click', showShortcuts);
    offerRestore();
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
        nameInp.setAttribute('aria-label', `Variable name ${key}`);
        nameInp.style.width = '70px';
        
        const eq = document.createElement('span');
        eq.innerText = '=';
        
        const valInp = document.createElement('input');
        valInp.type = 'text';
        valInp.value = val;
        
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i>';
        delBtn.setAttribute('aria-label', `Delete variable ${key}`);
        valInp.setAttribute('aria-label', `Value of ${key}`);
        
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
            scheduleVariableApply();
        });

        valInp.addEventListener('change', () => {
            flushVariableApply();
            historyManager.saveState();
        });
        
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

// Applying a variable re-cuts every group whose parts are bound to it, which is far too
// expensive to do on each keystroke. Coalesce a burst of typing into one apply, and flush
// the pending one before anything that has to see the result (a save, mainly).
let variableApplyTimer = null;
const VARIABLE_APPLY_DELAY_MS = 120;

function scheduleVariableApply() {
    clearTimeout(variableApplyTimer);
    variableApplyTimer = setTimeout(() => {
        variableApplyTimer = null;
        applyVariablesToShapes();
    }, VARIABLE_APPLY_DELAY_MS);
}

function flushVariableApply() {
    if (variableApplyTimer === null) return;
    clearTimeout(variableApplyTimer);
    variableApplyTimer = null;
    applyVariablesToShapes();
}

function applyVariablesToShapes() {
    shapes.forEach(shape => {
        if (applyBindingsToNode(shape) && shape.userData.isComposite) {
            rebuildCSG(shape);
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
    if (node.userData.isComposite && node.userData.groupChildren) {
        node.userData.groupChildren.forEach(child => {
            boxes.push(...getSubFeatureBoxes(child, targetMatrix));
        });
    } else if (node.geometry) {
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
            // Applies to the node the panel is showing, so a part inside a group can be
            // turned into a hole after the fact.
            const shape = currentPropertyNode;
            if (shape) {
                shape.userData.isHole = (e.target.value === 'hole');

                if (shape.userData.isHole) {
                    shape.material.transparent = true;
                    shape.material.opacity = 0.3;
                    shape.material.color.setHex(0x888888);
                } else {
                    shape.material.transparent = document.getElementById('obj-transparent').checked;
                    shape.material.opacity = shape.material.transparent ? 0.85 : 1.0;
                    shape.material.color.set(document.getElementById('obj-color').value);
                }

                // Changing what a part is re-cuts the assembly it belongs to.
                rebuildAncestors(shape);

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
                
                rebuildAncestors(s);
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

    // Setup BOM and Lifecycle panel toggles
    const btnBom = document.getElementById('toggle-bom-btn');
    const panelBom = document.getElementById('bom-panel');
    if (btnBom && panelBom) {
        btnBom.addEventListener('click', () => {
            const isVisible = panelBom.style.display !== 'none';
            panelBom.style.display = isVisible ? 'none' : 'flex';
            btnBom.classList.toggle('active', !isVisible);
        });
    }

    const btnLifecycle = document.getElementById('toggle-lifecycle-btn');
    const panelLifecycle = document.getElementById('lifecycle-panel');
    if (btnLifecycle && panelLifecycle) {
        btnLifecycle.addEventListener('click', () => {
            const isVisible = panelLifecycle.style.display !== 'none';
            panelLifecycle.style.display = isVisible ? 'none' : 'flex';
            btnLifecycle.classList.toggle('active', !isVisible);
        });
    }
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
        if (isWiringMode && isSketchMode) cancelSketch(true);
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
    
    bindClick('export-stl', exportModel); bindClick('delete-selected', deleteSelected); bindClick('toggle-grid', toggleGrid);
    bindClick('unit-toggle', toggleUnit);
    bindClick('group-shapes', groupShapes);
    bindClick('ungroup-shapes', ungroupShapes);
    bindClick('distribute-shapes', toggleDistributeMode);
    bindClick('align-mode', toggleAlignMode); bindClick('projection-toggle', toggleProjection);
    bindClick('center-selection', centerSelection);
    bindClick('snap-toggle', () => setSnapEnabled(!snapEnabled)); bindClick('measure-tool', toggleMeasureMode);
    setupTransformInputs();
    setupShapeInputs();
    bindClick('duplicate-selected', duplicateSelection); bindClick('mirror-selected', mirrorSelection);
    bindClick('array-selected', arraySelection); bindClick('round-edges', roundEdges); bindClick('sketch-tool', toggleSketchMode);
    
    document.getElementById('snap-precision')?.addEventListener('change', (e) => { snapPrecision = parseFloat(e.target.value); updateTransformSnap(); });

    // History and Save/Load
    bindClick('btn-undo', () => historyManager.undo());
    bindClick('btn-redo', () => historyManager.redo());
    bindClick('btn-save', saveProjectFile);
    const fileLoad = document.getElementById('file-load');
    if (fileLoad) {
        bindClick('btn-load', () => fileLoad.click());
        fileLoad.addEventListener('change', (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (file) openProjectFile(file);
        });
    }

    // Import (STL / OBJ / SVG)
    const fileImport = document.getElementById('file-import');
    if (fileImport) {
        bindClick('btn-import', () => fileImport.click());
        fileImport.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            e.target.value = '';
            files.forEach(importModelFile);
        });
    }

    // Drag and drop anywhere on the page: models are imported, projects are opened.
    const dropOverlay = document.getElementById('drop-overlay');
    let dragDepth = 0;
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; dropOverlay?.classList.add('active'); } });
    window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; dropOverlay?.classList.remove('active'); } });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
        dragDepth = 0; dropOverlay?.classList.remove('active');
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        Array.from(e.dataTransfer.files).forEach(file => {
            if (/\.(holo|hldk)$/i.test(file.name)) openProjectFile(file);
            else importModelFile(file);
        });
    });

    // Keyboard shortcuts & Clipboard
    let clipboard = [];
    
    function deepCloneShape(s) {
        const clone = s.clone();
        
        function cloneUserData(origNode, cloneNode) {
            cloneNode.userData = { ...origNode.userData };
            if (origNode.userData.baseSize) cloneNode.userData.baseSize = { ...origNode.userData.baseSize };
            if (origNode.userData.bindings) cloneNode.userData.bindings = { ...origNode.userData.bindings };
            if (origNode.userData.originalGeometry) cloneNode.userData.originalGeometry = origNode.userData.originalGeometry;

            // Copy time is the last moment the source's BOM row can be found: the clone gets a
            // fresh uuid, so the link is by uuid only until now. Carry the row's contents so
            // paste can bill the copy. Cloning a clipboard entry finds no row and keeps the
            // template it already holds.
            const sourceRow = bomItems.find(item => item.meshId === origNode.uuid);
            if (sourceRow) {
                cloneNode.userData.bomTemplate = {
                    name: sourceRow.name, price: sourceRow.price, quantity: sourceRow.quantity
                };
            }


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
        
        // Object3D.clone() shares geometry with the source. The clipboard has to outlive its
        // source — cut deletes it, and deleting disposes — so give the clone its own copy.
        function cloneGeometryAndMaterial(mesh) {
            if (mesh.material) mesh.material = mesh.material.clone();
            if (mesh.geometry) {
                mesh.geometry = mesh.geometry.clone();
                if (mesh.userData.originalGeometry) mesh.userData.originalGeometry = mesh.geometry;
            }
            mesh.children.forEach(cloneGeometryAndMaterial);
        }
        cloneGeometryAndMaterial(clone);
        
        return clone;
    }

    cloneShape = deepCloneShape;

    window.addEventListener('keydown', (e) => {
        const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';
        
        if (e.key === 'Escape') {
            if (isMeasureMode) toggleMeasureMode();
            else if (isSketchMode) cancelSketch();
            else if (isWiringMode) cancelWire();
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
        
        if (!isInput && e.key === '?') { e.preventDefault(); showShortcuts(); return; }
        if (e.key === 'Enter' && isSketchMode) finishSketch();
        if (e.key === 'Enter' && isWiringMode) {
            if (wirePoints.length > 1) finalizeWire();
            else cancelWire();
        }
        
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 's') { e.preventDefault(); document.getElementById('btn-save').click(); }
            if (!isInput) {
                if (e.key === 'z') { e.preventDefault(); if (e.shiftKey) historyManager.redo(); else historyManager.undo(); }
                if (e.key === 'y') { e.preventDefault(); historyManager.redo(); }
                if (e.key === 'd' || e.key === 'D') { e.preventDefault(); duplicateSelection(); }
                if (e.key === 'a' || e.key === 'A') { e.preventDefault(); if (shapes.length) selectAll(shapes.slice()); }
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
                            addBomRowsForPaste(clone);
                            selectShape(clone, { ctrlKey: true });
                        });
                        renderBOM();
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
                syncTransformInputs();
                
                historyManager.saveState();
            }
        }
    });
}

// Unscaled size of a geometry, used as the divisor for the dimension inputs.
// Never returns 0 on an axis: a flat geometry would make scale = dim / 0.
// Imported meshes are kept out of the per-action history states: every saveState() would
// otherwise copy a multi-megabyte vertex array. A shape stores only an importId, and the
// vertices live here once, keyed by that id. They are embedded in the .holo file as `assets`.
const importedMeshes = new Map(); // importId -> Float32Array of triangle-soup positions

// Only meshes some history state still refers to are written out, so a project does not
// keep carrying an import the user deleted and undid past long ago.
function collectImportIds(node, into = new Set()) {
    if (Array.isArray(node)) node.forEach(n => collectImportIds(n, into));
    else if (node && typeof node === 'object') {
        if (node.importId) into.add(node.importId);
        Object.values(node).forEach(v => { if (v && typeof v === 'object') collectImportIds(v, into); });
    }
    return into;
}

function serializeImportedMeshes(states) {
    const assets = {};
    collectImportIds(states).forEach(id => {
        if (importedMeshes.has(id)) assets[id] = encodePositions(importedMeshes.get(id));
    });
    return assets;
}

function buildImportedGeometry(positions) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return geometry;
}

// --- Project files, dirty tracking and autosave ---
const AUTOSAVE_KEY = 'autosave';
let isDirty = false;
let autosaveTimer = null;
let autosavePaused = true; // until the previous session has been offered for restoring

function buildProjectJson(withThumbnail = true) {
    return JSON.stringify({
        version: "2.2",
        thumbnail: withThumbnail ? captureThumbnail() : '',
        assets: serializeImportedMeshes([historyManager.undoStack, historyManager.redoStack]),
        undoStack: historyManager.undoStack,
        redoStack: historyManager.redoStack
    });
}

function updateTitle() { document.title = (isDirty ? '• ' : '') + 'Holodeck - Web CAD'; }

function markClean() { isDirty = false; clearTimeout(autosaveTimer); updateTitle(); }

function markDirty() {
    isDirty = true; updateTitle();
    if (autosavePaused) return;
    clearTimeout(autosaveTimer);
    const delay = typeof window.HOLODECK_AUTOSAVE_MS === 'number' ? window.HOLODECK_AUTOSAVE_MS : 2000;
    autosaveTimer = setTimeout(() => kvPut(AUTOSAVE_KEY, { savedAt: Date.now(), json: buildProjectJson(false) }), delay);
}

function saveProjectFile() {
    const blob = new Blob([buildProjectJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'project.holo'; a.click(); URL.revokeObjectURL(url);
    markClean();
    kvDelete(AUTOSAVE_KEY); // what was saved to disk no longer needs recovering
    updateStatus('Project saved.');
}

// Anything unsaved is lost on close, so ask the browser to confirm.
window.addEventListener('beforeunload', (e) => {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = '';
});

function loadProjectData(data) {
    if (!(data.version && data.undoStack)) throw new Error('not a Holodeck project');
    Object.entries(data.assets || {}).forEach(([id, b64]) => importedMeshes.set(id, decodePositions(b64)));
    historyManager.undoStack = data.undoStack;
    historyManager.redoStack = data.redoStack || [];
    if (historyManager.undoStack.length > 0) {
        historyManager.restoreState(historyManager.undoStack[historyManager.undoStack.length - 1]);
    }
    updateToolbarButtons();
}

function openProjectFile(file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            loadProjectData(JSON.parse(evt.target.result));
            markClean();
            updateStatus('Project loaded successfully.');
        } catch (err) { console.error(err); updateStatus('Failed to load project.'); }
    };
    reader.readAsText(file);
}

function timeAgo(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'moments ago';
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} hour${h === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} days ago`;
}

// If the last session ended without a save, offer to bring it back. Autosave stays paused
// until the person answers, so the offer is never overwritten by the empty new session.
async function offerRestore() {
    const banner = document.getElementById('restore-banner');
    const resume = () => { autosavePaused = false; banner?.classList.remove('active'); };
    const record = await kvGet(AUTOSAVE_KEY);
    let data = null;
    try { data = record && JSON.parse(record.json); } catch (e) { /* corrupt: treated as none */ }
    const last = data && data.undoStack && data.undoStack[data.undoStack.length - 1];
    if (!last || !banner || (!(last.shapes && last.shapes.length) && !Object.keys(last.variables || {}).length)) {
        if (record) kvDelete(AUTOSAVE_KEY);
        resume();
        return;
    }
    const n = last.shapes.length;
    document.getElementById('restore-text').textContent = `Restore your unsaved session from ${timeAgo(record.savedAt)}? (${n} shape${n === 1 ? '' : 's'})`;
    banner.classList.add('active');
    document.getElementById('restore-yes').onclick = () => {
        try { loadProjectData(data); updateStatus('Previous session restored.'); } catch (e) { console.error(e); updateStatus('Could not restore the previous session.'); }
        resume(); markDirty();
    };
    document.getElementById('restore-no').onclick = () => { kvDelete(AUTOSAVE_KEY); resume(); };
}

const SHORTCUTS = [
    { heading: 'Project', rows: [['Ctrl+S', 'Save project (.holo)'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['?', 'Show this list']] },
    { heading: 'Selection & editing', rows: [
        ['Click', 'Select a shape'], ['Ctrl+Click', 'Add to / remove from the selection'], ['Shift+Drag', 'Box-select'],
        ['Ctrl+A', 'Select everything'], ['Esc', 'Clear the selection, or leave the active tool'], ['Delete', 'Delete the selection'],
        ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy, cut, paste'], ['Ctrl+D', 'Duplicate'], ['Ctrl+G', 'Group'], ['Ctrl+Shift+G', 'Ungroup'] ] },
    { heading: 'Moving', rows: [
        ['Arrows', 'Nudge along the screen axes by the snap size'], ['Shift+Arrows', 'Nudge 10× the snap size'],
        ['Ctrl+Arrows', 'Nudge half the snap size'], ['Ctrl+Shift+Arrows', 'Nudge a tenth of the snap size'],
        ['Alt (hold)', 'Bypass snapping while dragging'] ] },
    { heading: 'Tools', rows: [
        ['Sketch: Click, Enter', 'Add corners, then finish and extrude or revolve'], ['Wire: Click, Enter', 'Add route points, then finish'],
        ['Measure: Click, Click', 'Distance between two points (snaps to corners)'], ['Drop a file', 'Import STL / OBJ / SVG, or open a .holo project'] ] }
];
function showShortcuts() { showInfoDialog({ title: 'Keyboard shortcuts', sections: SHORTCUTS }); }

function labelIconButtons() {
    document.querySelectorAll('button[title]:not([aria-label])').forEach(b => b.setAttribute('aria-label', b.getAttribute('title')));
    document.querySelectorAll('.fas, .far, .fab').forEach(i => i.setAttribute('aria-hidden', 'true'));
    const roles = { 'top-left-toolbar': 'File and history', 'top-toolbar': 'Transform and arrange', 'left-sidebar': 'Create and modify', 'theme-toggles': 'Appearance and panels' };
    Object.entries(roles).forEach(([id, label]) => {
        const el = document.getElementById(id);
        if (el) { el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', label); }
    });
}

async function importModelFile(file) {
    const kind = importFormatOf(file.name);
    if (!kind) { updateStatus(`Import failed: unsupported file type "${file.name}". Use STL, OBJ or SVG.`); return; }

    const prefs = loadPrefs('import', { units: 'mm', up: 'y', depth: 5, recenter: true });
    const isSvg = kind === 'svg';
    const opts = await showFormDialog({
        title: `Import ${file.name}`,
        confirmLabel: 'Import',
        fields: [
            { id: 'units', label: 'File units', type: 'select', value: prefs.units, showIf: () => !isSvg,
              options: [['mm', 'Millimetres'], ['cm', 'Centimetres'], ['in', 'Inches'], ['m', 'Metres']] },
            { id: 'up', label: 'Up axis', type: 'select', value: prefs.up, showIf: () => !isSvg,
              options: [['y', 'Y up (Holodeck, most game/OBJ tools)'], ['z', 'Z up (most CAD, slicers)']] },
            { id: 'depth', label: 'Extrude depth', type: 'number', unit: 'mm', value: prefs.depth, min: 0.01, step: 0.5, showIf: () => isSvg,
              hint: 'SVG shapes are extruded; 1 SVG unit = 1 CSS px (0.2646 mm).' },
            { id: 'recenter', label: 'Centre on origin, resting on the grid', type: 'checkbox', value: prefs.recenter }
        ]
    });
    if (!opts) { updateStatus('Import cancelled.'); return; }
    savePrefs('import', { units: isSvg ? prefs.units : opts.units, up: isSvg ? prefs.up : opts.up, depth: isSvg ? opts.depth : prefs.depth, recenter: opts.recenter });

    updateStatus(`Importing ${file.name}...`);
    try {
        const result = await importFile(file, { svgDepthMm: opts.depth });
        let positions = convertImported(result.positions, isSvg ? {} : { unitsMm: UNIT_MM[opts.units], zUp: opts.up === 'z' });
        // Booleans need clean closed solids, so say up front when a mesh is not one, and fix
        // the two things that can be fixed without guessing. Very large meshes skip the check.
        let note = '';
        if (positions.length / 9 <= 300000) {
            const repaired = repairMesh(positions);
            positions = repaired.positions;
            note = describeHealth(analyzeMesh(positions), repaired);
        } else note = 'Note: too large to check for holes.';
        addImportedMesh({ positions, format: result.format, recenter: opts.recenter, note }, file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
        if (!(err instanceof ImportError)) console.error(err);
        updateStatus(`Import failed: ${err instanceof ImportError ? err.message : 'could not read ' + file.name}`);
    }
}

// `positions` arrive in scene units (cm). By default the mesh is moved so its bounding-box
// centre is the mesh origin — it then moves and scales about its middle like any other
// shape — and stood on the grid. With `keepPlace` the geometry is centred the same way but
// the mesh is put back where the positions were (for results built in world space, like a
// mirror or an extrusion); with recenter false the file's coordinates are used verbatim.
function addImportedMesh({ positions, format, recenter = true, keepPlace = false, color = 0x9aa7b8, focus = true, note = '' }, name) {
    const geometry = buildImportedGeometry(positions);
    const center = new THREE.Vector3();
    if (recenter || keepPlace) { geometry.boundingBox.getCenter(center); geometry.translate(-center.x, -center.y, -center.z); }
    const stored = Float32Array.from(geometry.attributes.position.array);
    geometry.computeBoundingBox();
    const size = new THREE.Vector3(); geometry.boundingBox.getSize(size);
    if (!(size.x > 0 || size.y > 0 || size.z > 0) || [size.x, size.y, size.z].some(v => !isFinite(v))) {
        geometry.dispose();
        throw new ImportError('The file has no usable geometry.');
    }

    const importId = THREE.MathUtils.generateUUID();
    importedMeshes.set(importId, stored);

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color, transparent: true, opacity: 0.85, roughness: 0.4, metalness: 0.1
    }));
    if (keepPlace) mesh.position.copy(center);
    else if (recenter) mesh.position.set(0, size.y / 2, 0);
    mesh.userData = {
        type: 'imported', importId, importFormat: format, originalGeometry: geometry,
        bindings: {}, isComposite: false, isHole: false, baseSize: measureBaseSize(geometry)
    };
    mesh.uuid = THREE.MathUtils.generateUUID();
    mesh.name = name || `Imported ${format}`;

    scene.add(mesh);
    shapes.push(mesh);
    selectShape(mesh);
    const tris = stored.length / 9;
    updateStatus(`${format === 'STL' || format === 'OBJ' || format === 'SVG' ? 'Imported' : 'Created'} ${mesh.name} (${format}, ${tris.toLocaleString()} triangles, ${(size.x * 10).toFixed(1)} × ${(size.y * 10).toFixed(1)} × ${(size.z * 10).toFixed(1)} mm)${note ? '. ' + note : ''}`);
    historyManager.saveState();
    if (focus) centerSelection();
    return mesh;
}

// A mesh's triangles in world space, outward-wound, as a flat non-indexed soup.
function worldPositionsOf(mesh) {
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    const p = Float32Array.from(g.attributes.position.array);
    g.dispose();
    return mesh.matrixWorld.determinant() < 0 ? flipWinding(p) : p;
}

// === MODELLING TOOLS ===
const cmPerSnap = () => (unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10);

function addClonedShape(clone) {
    scene.add(clone);
    shapes.push(clone);
    addBomRowsForPaste(clone);
}

function selectAll(list) {
    selectedShapes = []; selectedShape = null; transformControl.detach();
    list.forEach(m => selectShape(m, { ctrlKey: true }));
}

function duplicateSelection() {
    if (selectedShapes.length === 0) { updateStatus('Select something to duplicate.'); return; }
    const offset = cmPerSnap() * 2;
    const clones = selectedShapes.map(src => {
        const c = cloneShape(src);
        c.position.x += offset; c.position.z += offset;
        addClonedShape(c);
        return c;
    });
    renderBOM();
    selectAll(clones);
    historyManager.saveState();
    updateStatus(`Duplicated ${clones.length} shape(s).`);
}

async function mirrorSelection() {
    if (selectedShapes.length === 0) { updateStatus('Select something to mirror.'); return; }
    const v = await showFormDialog({
        title: 'Mirror', confirmLabel: 'Mirror',
        message: 'Adds a mirrored copy, reflected across a plane through the world origin.',
        fields: [{ id: 'axis', label: 'Mirror plane', type: 'select', value: 'x',
            options: [['x', 'YZ plane (flip left/right)'], ['y', 'XZ plane (flip up/down)'], ['z', 'XY plane (flip front/back)']] }]
    });
    if (!v) return;
    const created = [];
    selectedShapes.slice().forEach(src => {
        const mat = Array.isArray(src.material) ? src.material[0] : src.material;
        created.push(addImportedMesh({
            positions: mirrorPositions(worldPositionsOf(src), v.axis), format: 'Mirror', keepPlace: true,
            color: mat.color.getHex(), focus: false
        }, `${src.name} (mirror ${v.axis.toUpperCase()})`));
    });
    selectAll(created);
    updateStatus(`Mirrored ${created.length} shape(s) across the ${v.axis.toUpperCase()} plane.`);
}

async function arraySelection() {
    if (selectedShapes.length === 0) { updateStatus('Select something to array.'); return; }
    const prefs = loadPrefs('array', { kind: 'linear', count: 3, dx: 20, dy: 0, dz: 0, axis: 'y', angle: 360 });
    const linear = f => f.kind === 'linear';
    const v = await showFormDialog({
        title: 'Array', confirmLabel: 'Create array',
        fields: [
            { id: 'kind', label: 'Pattern', type: 'select', value: prefs.kind, options: [['linear', 'Linear'], ['polar', 'Polar (around an axis)']] },
            { id: 'count', label: 'Total copies (including the original)', type: 'number', value: prefs.count, min: 2, max: 200, step: 1 },
            { id: 'dx', label: 'Step X', unit: 'mm', type: 'number', value: prefs.dx, step: 1, showIf: linear },
            { id: 'dy', label: 'Step Y', unit: 'mm', type: 'number', value: prefs.dy, step: 1, showIf: linear },
            { id: 'dz', label: 'Step Z', unit: 'mm', type: 'number', value: prefs.dz, step: 1, showIf: linear },
            { id: 'axis', label: 'Axis through the world origin', type: 'select', value: prefs.axis, showIf: f => !linear(f),
              options: [['x', 'X'], ['y', 'Y (vertical)'], ['z', 'Z']] },
            { id: 'angle', label: 'Sweep angle', unit: '°', type: 'number', value: prefs.angle, min: 1, max: 360, step: 5, showIf: f => !linear(f),
              hint: '360 spreads the copies evenly round a full circle; less places the last copy at that angle.' }
        ]
    });
    if (!v) return;
    savePrefs('array', v);
    const count = Math.round(v.count);
    const sources = selectedShapes.slice();
    const created = [];
    const axisVec = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[v.axis];
    const step = v.angle >= 360 ? v.angle / count : v.angle / (count - 1);
    for (let i = 1; i < count; i++) {
        sources.forEach(src => {
            const c = cloneShape(src);
            if (v.kind === 'linear') {
                c.position.add(new THREE.Vector3(v.dx, v.dy, v.dz).multiplyScalar(i / 10));
            } else {
                const q = new THREE.Quaternion().setFromAxisAngle(axisVec, THREE.MathUtils.degToRad(step * i));
                c.position.applyQuaternion(q);
                c.quaternion.premultiply(q);
            }
            c.updateMatrix(); c.updateMatrixWorld(true);
            addClonedShape(c);
            created.push(c);
        });
    }
    renderBOM();
    selectAll(sources.concat(created));
    historyManager.saveState();
    updateStatus(`Array created: ${created.length} new shape(s).`);
}

// Cube and cone are parametric: their geometry is rebuilt from userData on undo and load, so
// nothing has to be saved as vertices. `edge` is the bevel { radius (cm), steps }, and a cone
// also carries { top, bottom, height } (cm). One cone shape covers cones, cylinders and
// frustums: a cylinder is just equal radii.
const DEFAULT_CONE = { top: 0.5, bottom: 1.5, height: 2 };

function meshFromSoup({ positions, normals }) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    else g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
}

const buildBeveledCubeGeometry = edge => meshFromSoup(beveledBox(2, 2, 2, edge));
const buildConeGeometry = (cone, edge) => meshFromSoup(frustum(cone.top, cone.bottom, cone.height, edge));

// Rebuilds a parametric leaf's geometry after its parameters changed, then everything that
// depends on it: the enclosing groups, the panel, the dimension labels and history.
function regenerateLeaf(node) {
    const geometry = rebuildLeafGeometry(node.userData);
    if (node.geometry) node.geometry.dispose();
    node.geometry = geometry;
    node.userData.originalGeometry = geometry;
    node.userData.baseSize = measureBaseSize(geometry);
    rebuildAncestors(node);
    selectPropertyNode(node);
    updateDimensions();
    historyManager.saveState();
}

const isBevelable = node => !!node && !node.userData.isComposite && (node.userData.type === 'cube' || node.userData.type === 'cone');
const meanScaleOf = node => (node.scale.x + node.scale.y + node.scale.z) / 3;

// size is in mm; steps 1 is a flat chamfer, more are progressively rounder.
function applyBevel(node, sizeMm, steps) {
    node.userData.edge = sizeMm > 0 ? { radius: sizeMm / 10 / meanScaleOf(node), steps: Math.max(1, Math.round(steps) || 1) } : null;
    regenerateLeaf(node);
    updateStatus(sizeMm > 0 ? `Beveled: ${sizeMm} mm in ${node.userData.edge.steps} step${node.userData.edge.steps === 1 ? ' (chamfer)' : 's'}.` : 'Bevel removed.');
}

// Radii and height in mm.
function applyCone(node, { top, bottom, height }) {
    if (![top, bottom, height].every(v => isFinite(v) && v >= 0) || height <= 0 || (top <= 0 && bottom <= 0)) {
        updateStatus('A cone needs a height above zero and at least one radius above zero.');
        selectPropertyNode(node);
        return;
    }
    node.userData.cone = { top: top / 10, bottom: bottom / 10, height: height / 10 };
    regenerateLeaf(node);
    const kind = top === bottom ? 'Cylinder' : (top === 0 || bottom === 0) ? 'Cone' : 'Truncated cone';
    updateStatus(`${kind}: top R ${top} mm, bottom R ${bottom} mm, height ${height} mm.`);
}

async function roundEdges() {
    const node = (currentPropertyNode && selectedShapes.length <= 1 ? currentPropertyNode : null)
        || (selectedShapes.length === 1 ? selectedShapes[0] : null);
    if (!isBevelable(node)) {
        updateStatus('Select a single cube or cone (or pick one inside a group) to bevel its edges.');
        return;
    }
    const cur = normalizeEdge(node.userData.edge);
    const v = await showFormDialog({
        title: 'Bevel edges', confirmLabel: 'Apply',
        message: node.userData.type === 'cone' ? 'Bevels the rim where each flat end meets the side.' : 'Bevels all twelve edges.',
        fields: [
            { id: 'size', label: 'Bevel radius', unit: 'mm', type: 'number', min: 0, step: 0.5,
              value: cur ? +(cur.radius * meanScaleOf(node) * 10).toFixed(2) : 2, hint: '0 removes the bevel. Approximate on a shape that has been stretched unevenly.' },
            { id: 'steps', label: 'Steps', type: 'number', min: 1, max: 16, step: 1, value: cur ? cur.steps : 1,
              hint: '1 is a flat chamfer; more steps make the edge progressively rounder.' }
        ]
    });
    if (!v) return;
    applyBevel(node, v.size, v.steps);
}

// The cone and bevel rows of the properties panel.
function setupShapeInputs() {
    const num = id => { const raw = document.getElementById(id).value.trim(); const v = isNaN(Number(raw)) ? evaluateExpression(raw, getResolvedVariables()) : Number(raw); return v === null ? NaN : v; };
    ['obj-cone-top', 'obj-cone-height', 'obj-cone-bottom'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
        el.addEventListener('change', () => {
            const node = currentPropertyNode;
            if (!node || node.userData.type !== 'cone') return;
            applyCone(node, { top: num('obj-cone-top'), height: num('obj-cone-height'), bottom: num('obj-cone-bottom') });
        });
    });
    ['obj-bevel-size', 'obj-bevel-steps'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
        el.addEventListener('change', () => {
            const node = currentPropertyNode;
            if (!isBevelable(node)) return;
            const size = num('obj-bevel-size'), steps = num('obj-bevel-steps');
            if (!isFinite(size) || size < 0) { selectPropertyNode(node); updateStatus('The bevel radius must be a number, 0 or more.'); return; }
            applyBevel(node, size, isFinite(steps) ? steps : 1);
        });
    });
}

function syncShapeInputs(node) {
    const isCone = node.userData.type === 'cone' && !node.userData.isComposite;
    document.getElementById('cone-properties').style.display = isCone ? 'flex' : 'none';
    document.getElementById('bevel-properties').style.display = isBevelable(node) ? 'flex' : 'none';
    const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = String(v); };
    if (isCone) {
        const c = coneParams(node.userData);
        set('obj-cone-top', +(c.top * 10).toFixed(3)); set('obj-cone-height', +(c.height * 10).toFixed(3)); set('obj-cone-bottom', +(c.bottom * 10).toFixed(3));
    }
    if (isBevelable(node)) {
        const e = normalizeEdge(node.userData.edge);
        set('obj-bevel-size', e ? +(e.radius * meanScaleOf(node) * 10).toFixed(3) : 0);
        set('obj-bevel-steps', e ? e.steps : 1);
    }
}

// --- Precision: numeric transform fields, drag readout, snapping, measuring ---
const TRANSFORM_INPUTS = ['obj-px', 'obj-py', 'obj-pz', 'obj-rx', 'obj-ry', 'obj-rz'];

function syncTransformInputs() {
    const node = currentPropertyNode;
    if (!node) return;
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) el.value = String(+v.toFixed(3));
    };
    const e = new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ');
    set('obj-px', node.position.x); set('obj-py', node.position.y); set('obj-pz', node.position.z);
    set('obj-rx', THREE.MathUtils.radToDeg(e.x)); set('obj-ry', THREE.MathUtils.radToDeg(e.y)); set('obj-rz', THREE.MathUtils.radToDeg(e.z));
}

function setupTransformInputs() {
    // Holding Alt bypasses snapping for the drag in progress.
    window.addEventListener('keydown', e => {
        if (e.key === 'Alt' && snapEnabled && !e.repeat) { transformControl.setTranslationSnap(null); transformControl.setRotationSnap(null); }
    });
    window.addEventListener('keyup', e => {
        if (e.key === 'Alt' && snapEnabled) { updateTransformSnap(); transformControl.setRotationSnap(THREE.MathUtils.degToRad(5)); }
    });

    TRANSFORM_INPUTS.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
        input.addEventListener('change', () => {
            const node = currentPropertyNode;
            if (!node) return;
            // Numbers, or an expression using the project's variables (evaluated once, not bound).
            const raw = input.value.trim();
            const value = isNaN(Number(raw)) ? evaluateExpression(raw, getResolvedVariables()) : Number(raw);
            if (value === null || !isFinite(value)) { syncTransformInputs(); updateStatus(`"${raw}" is not a number.`); return; }
            const num = k => { const v = evaluateExpression(document.getElementById(k).value.trim(), getResolvedVariables()); return v === null || !isFinite(v) ? 0 : v; };
            node.position.set(num('obj-px'), num('obj-py'), num('obj-pz'));
            node.quaternion.setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(num('obj-rx')), THREE.MathUtils.degToRad(num('obj-ry')), THREE.MathUtils.degToRad(num('obj-rz')), 'XYZ'));
            node.updateMatrix(); node.updateMatrixWorld(true);
            rebuildAncestors(node);
            if (transformControl.object) transformControl.updateMatrixWorld();
            syncTransformInputs();
            updateDimensions();
            historyManager.saveState();
        });
    });
}

const snapLabel = () => {
    if (unitMode === 'inch') return { 0.0625: '1/16 in', 0.125: '1/8 in', 0.25: '1/4 in', 0.5: '1/2 in', 1: '1 in', 2: '2 in' }[snapPrecision] || `${snapPrecision} in`;
    return snapPrecision >= 10 ? `${snapPrecision / 10} cm` : `${snapPrecision} mm`;
};

function updateDragHud() {
    const hud = document.getElementById('drag-hud');
    const node = transformControl.object;
    if (!hud || !node) return;
    const e = new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ');
    const base = node.userData.baseSize || { x: 1, y: 1, z: 1 };
    hud.textContent = describeTransform(transformControl.getMode(), {
        position: node.position.toArray(),
        rotationDeg: [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg),
        size: [node.scale.x * base.x, node.scale.y * base.y, node.scale.z * base.z]
    }, { enabled: snapEnabled, label: snapLabel() });
}

function setSnapEnabled(on) {
    snapEnabled = on;
    document.getElementById('snap-toggle')?.classList.toggle('active', on);
    transformControl.setRotationSnap(on ? THREE.MathUtils.degToRad(5) : null);
    updateTransformSnap();
    updateStatus(on ? `Snapping on (${snapLabel()}).` : 'Snapping off.');
}

function clearMeasurements() {
    if (measureGroup) {
        scene.remove(measureGroup);
        measureGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
            if (o.isCSS2DObject && o.element) o.element.remove();
        });
        measureGroup = null;
    }
    measurePending = null;
}

function toggleMeasureMode() {
    isMeasureMode = !isMeasureMode;
    document.getElementById('measure-tool')?.classList.toggle('active', isMeasureMode);
    if (isMeasureMode) {
        if (isWiringMode) cancelWire();
        if (isSketchMode) cancelSketch(true);
        updateStatus('Measure: click a point on a surface (it snaps to nearby corners), then a second point. Esc to finish.');
    } else {
        clearMeasurements();
        updateStatus('Measure finished.');
    }
}

// Where a click lands for measuring: the nearest corner of the face under the cursor when one
// is close, else the surface point, else the ground. Distances need real corners to be useful.
function measurePointAt(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, activeCamera);
    const hit = raycaster.intersectObjects(shapes, false)[0];
    if (hit) {
        const tolerance = activeCamera.position.distanceTo(hit.point) * 0.03;
        let best = null, bestD = tolerance;
        const g = hit.object.geometry, pos = g.attributes.position;
        [hit.face.a, hit.face.b, hit.face.c].forEach(i => {
            const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld);
            const d = v.distanceTo(hit.point);
            if (d < bestD) { bestD = d; best = v; }
        });
        return { point: best || hit.point.clone(), snapped: !!best };
    }
    const pt = groundPoint(event);
    return pt ? { point: pt, snapped: true } : null;
}

function addMeasureMarker(point) {
    if (!measureGroup) { measureGroup = new THREE.Group(); scene.add(measureGroup); }
    const r = Math.max(0.05, activeCamera.position.distanceTo(point) * 0.012);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), new THREE.MeshBasicMaterial({ color: 0x00ffcc, depthTest: false }));
    m.position.copy(point); m.renderOrder = 1000;
    measureGroup.add(m);
}

function measureClick(event) {
    const hit = measurePointAt(event);
    if (!hit) return;
    addMeasureMarker(hit.point);
    if (!measurePending) {
        measurePending = hit.point;
        updateStatus('Measure: pick the second point.');
        return;
    }
    const a = measurePending, b = hit.point;
    measurePending = null;
    const m = describeMeasurement(a.toArray(), b.toArray());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: false }));
    line.renderOrder = 1000;
    measureGroup.add(line);
    const div = document.createElement('div');
    div.className = 'measure-label';
    div.textContent = m.text;
    const small = document.createElement('small'); small.textContent = m.detail; div.appendChild(small);
    const label = new THREE.CSS2DObject(div);
    label.position.copy(a).lerp(b, 0.5);
    measureGroup.add(label);
    updateStatus(`Measured ${m.text} (${m.detail}). Click to measure again, Esc to finish.`);
}

// --- Sketch: draw a polygon on the ground, then extrude or revolve it ---
function snapToGrid(pt) {
    const g = cmPerSnap();
    return new THREE.Vector3(Math.round(pt.x / g) * g, 0, Math.round(pt.z / g) * g);
}

function groundPoint(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, activeCamera);
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt) ? snapToGrid(pt) : null;
}

function updateSketchLine(cursor = null) {
    if (sketchLine) { scene.remove(sketchLine); sketchLine.geometry.dispose(); sketchLine = null; }
    const pts = sketchPoints.map(p => p.clone().setY(0.02));
    if (cursor) pts.push(cursor.clone().setY(0.02));
    if (pts.length < 2) return;
    sketchLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x00ffcc }));
    scene.add(sketchLine);
}

function toggleSketchMode() {
    if (isSketchMode) { cancelSketch(); return; }
    if (isWiringMode) cancelWire();
    isSketchMode = true; sketchPoints = [];
    document.getElementById('sketch-tool')?.classList.add('active');
    updateStatus('Sketch: click to place corners on the ground (snapped). Click the first point or press Enter to finish, Esc to cancel.');
}

function cancelSketch(silent = false) {
    isSketchMode = false; sketchPoints = [];
    if (sketchLine) { scene.remove(sketchLine); sketchLine.geometry.dispose(); sketchLine = null; }
    document.getElementById('sketch-tool')?.classList.remove('active');
    if (!silent) updateStatus('Sketch cancelled.');
}

async function finishSketch() {
    if (sketchPoints.length < 3) { updateStatus('A sketch needs at least three corners.'); return; }
    const pts = sketchPoints.map(p => p.clone());
    cancelSketch(true);
    const prefs = loadPrefs('sketch', { op: 'extrude', depth: 10, segments: 48 });
    const v = await showFormDialog({
        title: 'Sketch to solid', confirmLabel: 'Create',
        fields: [
            { id: 'op', label: 'Operation', type: 'select', value: prefs.op,
              options: [['extrude', 'Extrude upward'], ['revolve', 'Revolve around the Y axis']] },
            { id: 'depth', label: 'Height', unit: 'mm', type: 'number', min: 0.1, step: 1, value: prefs.depth, showIf: f => f.op === 'extrude' },
            { id: 'segments', label: 'Smoothness', type: 'number', min: 8, max: 128, step: 4, value: prefs.segments, showIf: f => f.op === 'revolve',
              hint: 'Revolve uses distance from the Y axis as the radius and the drawing\'s top-view "up" as height. Keep every corner on one side of the axis.' }
        ]
    });
    if (!v) { updateStatus('Sketch discarded.'); return; }
    savePrefs('sketch', v);
    try {
        let positions;
        if (v.op === 'extrude') {
            // Shape space is XY extruded along +Z; rotating -90° about X makes Z the up axis,
            // and negating y first makes the drawing read the same way from above.
            const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z)));
            const g = new THREE.ExtrudeGeometry(shape, { depth: v.depth / 10, bevelEnabled: false });
            g.rotateX(-Math.PI / 2);
            positions = Float32Array.from((g.index ? g.toNonIndexed() : g).attributes.position.array);
            g.dispose();
            for (let i = 0; i < positions.length; i++) if (Math.abs(positions[i]) < 1e-6) positions[i] = 0; // rotation noise
            if (signedVolume(positions) < 0) positions = flipWinding(positions);
        } else {
            positions = revolveProfile(pts.map(p => [p.x, -p.z]), Math.round(v.segments));
        }
        addImportedMesh({ positions, format: 'Sketch', keepPlace: true, focus: false }, v.op === 'extrude' ? 'Extrusion' : 'Revolve');
    } catch (err) {
        updateStatus(`Sketch failed: ${err.message}`);
    }
}

function measureBaseSize(geometry) {
    geometry.computeBoundingBox();
    const sz = new THREE.Vector3();
    geometry.boundingBox.getSize(sz);
    return { x: sz.x || 1, y: sz.y || 1, z: sz.z || 1 };
}

function addShape(type) {
    let geometry;
    switch(type) {
        case 'cube': geometry = new THREE.BoxGeometry(2, 2, 2); break;
        case 'sphere': geometry = new THREE.SphereGeometry(1.5, 32, 32); break;
        case 'cone': geometry = buildConeGeometry(DEFAULT_CONE, null); break;
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: Math.random() * 0xffffff, transparent: true, opacity: 0.85, roughness: 0.4, metalness: 0.1
    }));
    
    const worldSnap = unitMode === 'inch' ? snapPrecision * 2.54 : snapPrecision / 10;
    mesh.position.set(Math.round((Math.random() - 0.5) * 4 / worldSnap) * worldSnap, Math.round(1 / worldSnap) * worldSnap, Math.round((Math.random() - 0.5) * 4 / worldSnap) * worldSnap);
    
    mesh.userData = { type: type, originalGeometry: geometry, bindings: {}, isComposite: false, isHole: false };
    if (type === 'cone') mesh.userData.cone = { ...DEFAULT_CONE };
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
        // Drop the panel's target too: it may point at a mesh that was just deleted or
        // replaced by a restore, and the variables panel refreshes from it.
        currentPropertyNode = null;
        if (previewMesh) { previewScene.remove(previewMesh); previewMesh = null; }
        clearDimensions();
    }
}

// Fills the properties panel from `node`, which is the selected shape or, for a group, the
// sub-part chosen in the part dropdown. It must read `node` and never the global selection:
// a sub-part has its own colour and its own hardware parameters, and the panel is also
// refreshed on variable changes, when nothing may be selected at all.
function selectPropertyNode(node) {
    currentPropertyNode = node;
    if (!node) return;

    const mat = Array.isArray(node.material) ? node.material[0] : node.material;

    document.getElementById('hardware-properties').style.display = 'none';
    if (node.userData.isHardware) {
        document.getElementById('hardware-properties').style.display = 'flex';
        // Hide others, show relevant
        document.querySelectorAll('.hw-extrusion, .hw-motor, .hw-screw').forEach(el => el.style.display = 'none');
        document.querySelectorAll(`.hw-${node.userData.type}`).forEach(el => el.style.display = 'flex');

        // Populate dropdowns based on hwProps
        const props = node.userData.hwProps || {};
        if (node.userData.type === 'extrusion') {
            const profileEl = document.getElementById('hw-extrusion-profile');
            if (profileEl && props.profile) profileEl.value = props.profile;
            const slotEl = document.getElementById('hw-extrusion-slot');
            if (slotEl && props.slot) slotEl.value = props.slot;
        } else if (node.userData.type === 'motor') {
            const nemaEl = document.getElementById('hw-motor-type');
            if (nemaEl && props.nema) nemaEl.value = props.nema;
        } else if (node.userData.type === 'screw') {
            const sizeEl = document.getElementById('hw-screw-size');
            if (sizeEl && props.size) sizeEl.value = props.size;
            const headEl = document.getElementById('hw-screw-head');
            if (headEl && props.head) headEl.value = props.head;
        }
    }

    document.getElementById('obj-color').value = '#' + mat.color.getHexString();
    document.getElementById('obj-transparent').checked = mat.transparent;

    let base = node.userData.baseSize;
    if (!base) {
        base = measureBaseSize(node.geometry);
        node.userData.baseSize = base;
    }

    const setInput = (id, axis) => {
        const input = document.getElementById(id);
        input.value = (node.userData.bindings && node.userData.bindings[axis]) || (node.scale[axis] * base[axis]).toFixed(2);
    };
    setInput('obj-w', 'x'); setInput('obj-h', 'y'); setInput('obj-l', 'z');
    syncTransformInputs();
    syncShapeInputs(node);
    
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
    
    if (isAlignMode || isDistributeMode || isMeasureMode) return;
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, activeCamera);

    if (isSketchMode) {
        const pt = groundPoint(event);
        if (!pt) return;
        if (sketchPoints.length >= 3 && pt.distanceTo(sketchPoints[0]) < 1e-6) { finishSketch(); return; }
        if (sketchPoints.length === 0 || pt.distanceTo(sketchPoints[sketchPoints.length - 1]) > 1e-6) sketchPoints.push(pt);
        updateSketchLine();
        updateStatus(`Sketch: ${sketchPoints.length} corner(s). Click the first point or press Enter to finish.`);
        return;
    }

    if (isWiringMode) {
        // intersect against shapes or a plane. Non-recursive: a group's hidden CSG source
        // meshes sit inside it with matching geometry, and intersectObjects defaults to
        // recursive, so a click could otherwise hit one of those instead of the group.
        const intersects = raycaster.intersectObjects(shapes, false);
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

    // Non-recursive: a grouped part's original mesh lives on (hidden) inside the group so its
    // CSG result can be rebuilt, occupying the same space as the group's visible surface.
    // intersectObjects defaults to recursive and does not check .visible, so a click could
    // otherwise select that hidden mesh instead of the group — corrupting the group's
    // parent/children bookkeeping the moment it gets grouped or moved again.
    const intersects = raycaster.intersectObjects(shapes, false);
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
    if (isSketchMode && sketchPoints.length > 0) {
        const pt = groundPoint(event);
        if (pt) updateSketchLine(pt);
    }
    if (isWiringMode && wirePreviewSphere) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1; mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, activeCamera);
        const intersects = raycaster.intersectObjects(shapes, false);
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
        if (isMeasureMode && !event.target.closest?.('.toolbar, .glass-panel, #theme-toggles, #viewcube-wrapper')) { measureClick(event); return; }
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
    updateAlignmentGizmoScale();
}

// Handles are built at a fixed world-space radius, which makes them shrink to nothing when
// zoomed out and swell to engulf the model when zoomed in. Re-derive their scale every frame
// from the current view so they hold a constant on-screen size instead.
const HANDLE_SCREEN_RADIUS_PX = 6;
const HANDLE_BASE_RADIUS = 0.7; // must match the SphereGeometry radius passed to addHandle above

function updateAlignmentGizmoScale() {
    if (!alignmentGizmo || !activeCamera) return;
    const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
    alignmentGizmo.children.forEach(handle => {
        if (!handle.userData.isHandle) return;
        let worldPerPixel;
        if (activeCamera.isOrthographicCamera) {
            worldPerPixel = (activeCamera.top - activeCamera.bottom) / activeCamera.zoom / viewportHeight;
        } else {
            const dist = handle.position.distanceTo(activeCamera.position);
            const visibleHeight = 2 * dist * Math.tan(THREE.MathUtils.degToRad(activeCamera.fov) / 2);
            worldPerPixel = visibleHeight / viewportHeight;
        }
        handle.scale.setScalar((HANDLE_SCREEN_RADIUS_PX * worldPerPixel) / HANDLE_BASE_RADIUS);
    });
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



// --- Group booleans ---
// Groups with more triangles than this are computed in a Web Worker so the page stays
// responsive; smaller ones run inline, which keeps them instantaneous and synchronous.
const CSG_WORKER_TRIANGLES = 20000;
const csgWorkerThreshold = () => (typeof window.HOLODECK_CSG_WORKER_THRESHOLD === 'number' ? window.HOLODECK_CSG_WORKER_THRESHOLD : CSG_WORKER_TRIANGLES);

const triangleCount = geometry => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
const groupTriangles = children => children.reduce((n, c) => n + (c.geometry ? triangleCount(c.geometry) : 0), 0);

function partsOf(children) {
    children.forEach(c => c.updateMatrixWorld(true));
    return children.map(c => ({ geometry: c.geometry, matrix: c.matrix.toArray(), isHole: !!c.userData.isHole }));
}

// Wraps a boolean result into the mesh a group is displayed as.
function finishGroupMesh(children, { geometry, center }) {
    const first = children.find(s => !s.userData.isHole);
    const material = Array.isArray(first.material) ? first.material.map(m => m.clone()) : first.material.clone();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center); mesh.updateMatrixWorld(true);
    return mesh;
}

function evaluateGroup(children) {
    return finishGroupMesh(children, evaluateParts(THREE, CSG, partsOf(children)));
}

let csgWorker = null;
let csgJobs = new Map();
let csgJobId = 0;

function getCsgWorker() {
    if (csgWorker) return csgWorker;
    try {
        csgWorker = new Worker(new URL('./csg-worker.js', import.meta.url), { type: 'module' });
    } catch (e) { csgWorker = null; return null; }
    csgWorker.onmessage = ({ data }) => {
        const job = csgJobs.get(data.id);
        if (!job) return;
        csgJobs.delete(data.id);
        if (data.error) { job.reject(new Error(data.error)); return; }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        if (data.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        job.resolve({ geometry, center: new THREE.Vector3().fromArray(data.center) });
    };
    csgWorker.onerror = () => {
        const failed = csgJobs; csgJobs = new Map(); csgWorker = null;
        failed.forEach(job => job.reject(new Error('The background worker failed to run.')));
    };
    return csgWorker;
}

function setBusy(on) { document.body.classList.toggle('busy', on); }

// Same result as evaluateGroup, computed off the main thread. Falls back to inline if the
// worker cannot be started (an old browser, or a file:// page).
async function evaluateGroupAsync(children) {
    const worker = getCsgWorker();
    if (!worker) return evaluateGroup(children);
    const parts = partsOf(children).map(p => {
        const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
        return { positions: Float32Array.from(g.attributes.position.array), normals: Float32Array.from(g.attributes.normal.array), matrix: p.matrix, isHole: p.isHole };
    });
    const id = ++csgJobId;
    setBusy(true);
    try {
        const result = await new Promise((resolve, reject) => {
            csgJobs.set(id, { resolve, reject });
            worker.postMessage({ id, parts }, parts.flatMap(p => [p.positions.buffer, p.normals.buffer]));
        });
        return finishGroupMesh(children, result);
    } finally { setBusy(csgJobs.size > 0); }
}

const useWorkerFor = children => groupTriangles(children) > csgWorkerThreshold();

function applyRebuiltGeometry(mesh, newMesh) {
    // three-csg-ts evaluates from each mesh's *local* matrix, and rebuildCSG always
    // runs with the children already parented to `mesh`, so the result is already in
    // mesh-local space — re-basing it against matrixWorld would shift the group by
    // -position on every rebuild. Only the core's re-centring has to be undone.
    newMesh.updateMatrix();
    newMesh.geometry.applyMatrix4(newMesh.matrix);
    if (mesh.geometry) mesh.geometry.dispose();
    mesh.geometry = newMesh.geometry;
    mesh.userData.baseSize = measureBaseSize(mesh.geometry);
    delete mesh.userData.csgError;
}

function reportCsgFailure(mesh, e) {
    console.error('CSG rebuild failed:', e);
    mesh.userData.csgError = e.message;
    updateStatus(`⚠ "${mesh.name}" could not be recomputed (${e.message}) — its previous shape was kept.`);
}

function rebuildCSG(mesh) {
    if (!mesh.userData.isComposite || !mesh.userData.groupChildren) return;

    mesh.userData.groupChildren.forEach(child => {
        if (child.userData.isComposite) rebuildCSG(child);
    });

    try {
        const newMesh = evaluateGroup(mesh.userData.groupChildren);
        if (newMesh) applyRebuiltGeometry(mesh, newMesh);
    } catch (e) { reportCsgFailure(mesh, e); }
}

async function rebuildCSGAsync(mesh) {
    if (!mesh.userData.isComposite || !mesh.userData.groupChildren) return;
    const version = (mesh.userData.csgVersion = (mesh.userData.csgVersion || 0) + 1);
    for (const child of mesh.userData.groupChildren) if (child.userData.isComposite) await rebuildCSGAsync(child);
    try {
        const newMesh = await evaluateGroupAsync(mesh.userData.groupChildren);
        if (mesh.userData.csgVersion !== version) { newMesh.geometry.dispose(); return; } // a newer edit superseded this one
        applyRebuiltGeometry(mesh, newMesh);
    } catch (e) { reportCsgFailure(mesh, e); }
}

// Re-cuts every group above `node` after it changed. Small models finish before this returns;
// a large one continues in the background (and resolves when done).
function rebuildAncestors(node) {
    const chain = [];
    for (let g = node.parent; g && g.type !== 'Scene'; g = g.parent) if (g.userData.isComposite) chain.push(g);
    if (chain.length === 0) return Promise.resolve();
    const outermost = chain[chain.length - 1];
    if (!useWorkerFor(outermost.userData.groupChildren)) { chain.forEach(rebuildCSG); return Promise.resolve(); }
    updateStatus('Recomputing group in the background…');
    return (async () => {
        for (const g of chain) await rebuildCSGAsync(g);
        updateDimensions();
        if (!/could not be recomputed/.test(document.getElementById('status-bar').innerText)) updateStatus('Group recomputed.');
    })();
}

// Notes about imported parts that are unlikely to survive a boolean cleanly.
function groupHealthWarning(shapesToGroup) {
    const bad = [];
    const check = m => {
        if (m.userData.type === 'imported' && importedMeshes.has(m.userData.importId)) {
            const h = analyzeMesh(importedMeshes.get(m.userData.importId));
            if (!h.watertight || h.inconsistentEdges) bad.push(m.name);
        }
        if (m.userData.isComposite && m.userData.groupChildren) m.userData.groupChildren.forEach(check);
    };
    shapesToGroup.forEach(check);
    return bad.length ? ` ⚠ ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not a clean closed mesh, so the result may have gaps.` : '';
}

async function groupShapes() {
    if (selectedShapes.length < 2) { updateStatus('Select at least 2 shapes to group'); return; }
    transformControl.detach();

    try {
        const shapesToGroup = [...selectedShapes];
        let resultMesh;
        if (useWorkerFor(shapesToGroup)) {
            updateStatus(`Grouping ${groupTriangles(shapesToGroup).toLocaleString()} triangles in the background…`);
            resultMesh = await evaluateGroupAsync(shapesToGroup);
        } else {
            resultMesh = evaluateGroup(shapesToGroup);
        }

        if (resultMesh) {
            resultMesh.userData = {
                type: 'group', isComposite: true, isHole: false, isHardware: false,
                groupChildren: shapesToGroup, bindings: {},
                baseSize: measureBaseSize(resultMesh.geometry)
            };
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
            updateStatus('Grouped shapes' + groupHealthWarning(shapesToGroup));
            historyManager.saveState();
        }
    } catch (e) {
        updateStatus(`Grouping failed: ${e.message}`);
        console.error(e);
        // The parts were detached from the gizmo but left untouched; put it back.
        if (selectedShape && !isAlignMode) transformControl.attach(selectedShape);
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

// 1 scene unit is 1 cm (see createMotorGeometry: a NEMA 17's real 42.3mm face is modelled as
// 4.23). STL carries no unit of its own, but every consumer that matters here — slicers,
// printers, CAD import — treats it as millimetres, so the export has to convert or every
// model comes out 10x the wrong size the moment it leaves Holodeck.
const STL_EXPORT_SCALE = 10; // cm -> mm

async function exportModel() {
    // Only real solids are exported: holes are modelling aids, and a group's source parts
    // are already inside its CSG result. `shapes` holds exactly the top-level meshes.
    const solids = shapes.filter(shape => shape.isMesh && shape.geometry && !shape.userData.isHole);
    if (solids.length === 0) { updateStatus('Nothing to export.'); return; }

    const prefs = loadPrefs('export', { format: 'stl-binary', selectionOnly: false });
    const selectedSolids = solids.filter(s => selectedShapes.includes(s));
    const fields = [{ id: 'format', label: 'Format', type: 'select', value: EXPORT_FORMATS[prefs.format] ? prefs.format : 'stl-binary',
        options: Object.entries(EXPORT_FORMATS).map(([id, f]) => [id, f.label]) }];
    if (selectedSolids.length > 0) {
        fields.push({ id: 'selectionOnly', label: `Export only the ${selectedSolids.length} selected shape(s)`, type: 'checkbox', value: prefs.selectionOnly });
    }
    const v = await showFormDialog({ title: 'Export', confirmLabel: 'Export', message: 'Sizes are written in millimetres.', fields });
    if (!v) { updateStatus('Export cancelled.'); return; }
    savePrefs('export', { format: v.format, selectionOnly: !!v.selectionOnly });

    const chosen = v.selectionOnly ? selectedSolids : solids;
    const parts = chosen.map(shape => {
        const positions = worldPositionsOf(shape);
        for (let i = 0; i < positions.length; i++) positions[i] *= STL_EXPORT_SCALE;
        return { name: shape.name || 'Part', positions };
    });
    const format = EXPORT_FORMATS[v.format];
    const blob = new Blob([format.write(parts)], { type: format.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `model.${format.ext}`; a.click(); URL.revokeObjectURL(url);
    updateStatus(`Exported ${parts.length} object(s), ${countTriangles(parts).toLocaleString()} triangles, as ${format.ext.toUpperCase()}.`);
}

// Frees the GPU resources behind a mesh and everything under it. Nothing else may still be
// pointing at these: the properties preview borrows originalGeometry, so callers drop the
// selection (which clears the preview) before disposing.
function disposeShape(node) {
    if (node.geometry) {
        if (node.userData.originalGeometry && node.userData.originalGeometry !== node.geometry) {
            node.userData.originalGeometry.dispose();
        }
        node.geometry.dispose();
    }
    if (node.material) {
        (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => {
            if (m.map) m.map.dispose();
            m.dispose();
        });
    }
    node.children.forEach(disposeShape);
}

function clearAll(isRestoring = false) {
    transformControl.detach();
    const removed = shapes.slice();
    removed.forEach(shape => scene.remove(shape));
    shapes = []; selectedShape = null; selectedShapes = []; updateSelectionEffects();
    removed.forEach(disposeShape);
    document.getElementById('properties-panel').classList.remove('active');
    if (!isRestoring) {
        historyManager.saveState();
        updateStatus('Cleared all shapes');
    }
}

// Every uuid still present in the scene, following groups: a part that was grouped is no
// longer in `shapes`, but it is still in the assembly and still on the bill.
function collectLiveShapeIds(nodes = shapes, into = new Set()) {
    nodes.forEach(node => {
        into.add(node.uuid);
        if (node.userData.groupChildren) collectLiveShapeIds(node.userData.groupChildren, into);
    });
    return into;
}

// Bills a pasted mesh, and every part inside it if it is a group, from the template
// deepCloneShape carried over at copy time.
function addBomRowsForPaste(node) {
    const template = node.userData.bomTemplate;
    if (template) {
        bomItems.push({
            id: node.uuid,
            name: template.name,
            price: template.price,
            quantity: template.quantity || 1,
            invisible: false,
            meshId: node.uuid
        });
    }
    if (node.userData.groupChildren) node.userData.groupChildren.forEach(addBomRowsForPaste);
}

// Drops BOM rows whose mesh is gone. Rows added by hand carry no meshId and are never
// touched, so a custom line item survives whatever happens to the geometry.
function reconcileBOM() {
    const live = collectLiveShapeIds();
    const before = bomItems.length;
    bomItems = bomItems.filter(item => !item.meshId || live.has(item.meshId));
    if (bomItems.length !== before) renderBOM();
}

function deleteSelected() {
    if (selectedShapes.length === 0) return;
    transformControl.detach();
    const removed = selectedShapes.slice();
    removed.forEach(shape => {
        scene.remove(shape);
        shapes = shapes.filter(s => s !== shape);
    });
    selectedShapes = [];
    selectedShape = null;
    updateSelectionEffects();
    removed.forEach(disposeShape);
    reconcileBOM();
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
    updateAlignmentGizmoScale();
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
const MAX_HISTORY_STATES = 200;

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
        // Bounded so a long session cannot grow the stack, and the saved file with it,
        // without limit. The oldest state is dropped, never the base state's role: undo()
        // stops at one remaining entry either way.
        if (this.undoStack.length > MAX_HISTORY_STATES) this.undoStack.shift();
        this.redoStack = [];
        updateToolbarButtons();
        markDirty();
    }

    undo() {
        if (this.undoStack.length <= 1) return;
        const currentState = this.undoStack.pop();
        this.redoStack.push(currentState);
        const prevState = this.undoStack[this.undoStack.length - 1];
        this.restoreState(prevState);
        updateToolbarButtons();
        markDirty();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const nextState = this.redoStack.pop();
        this.undoStack.push(nextState);
        this.restoreState(nextState);
        updateToolbarButtons();
        markDirty();
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
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const data = {
        uuid: mesh.uuid,
        name: mesh.name,
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
        material: {
            color: mat.color.getHex(),
            transparent: mat.transparent,
            opacity: mat.opacity,
            roughness: mat.roughness,
            metalness: mat.metalness
        },
        userData: {
            type: mesh.userData.type,
            importId: mesh.userData.importId || null,
            importFormat: mesh.userData.importFormat || null,
            edge: mesh.userData.edge ? { ...mesh.userData.edge } : null,
            cone: mesh.userData.cone ? { ...mesh.userData.cone } : null,
            bindings: mesh.userData.bindings ? { ...mesh.userData.bindings } : {},
            isComposite: !!mesh.userData.isComposite,
            isHole: !!mesh.userData.isHole,
            isHardware: !!mesh.userData.isHardware,
            hwProps: mesh.userData.hwProps ? { ...mesh.userData.hwProps } : null,
            wirePoints: mesh.userData.wirePoints ? mesh.userData.wirePoints.map(p => p.toArray()) : null,
            baseSize: mesh.userData.baseSize ? { ...mesh.userData.baseSize } : null
        }
    };

    // Groups are n-ary: every child is stored, and the CSG result is recomputed on load
    // rather than saved, so the geometry never has to go through JSON.
    if (mesh.userData.isComposite && mesh.userData.groupChildren) {
        data.userData.groupChildren = mesh.userData.groupChildren.map(child => serializeShape(child));
    }
    return data;
}

// Called on every action, so it must stay cheap: no rendering, no canvas reads. The project
// thumbnail is captured once at save time by captureThumbnail() instead.
function serializeScene() {
    return {
        shapes: shapes.map(serializeShape),
        variables: { ...window.holodeckVariables },
        metadata: {
            status: document.getElementById('lc-status')?.value || 'Draft',
            category: document.getElementById('lc-category')?.value || '',
            productLine: document.getElementById('lc-line')?.value || '',
            version: document.getElementById('lc-version')?.value || '1.0'
        },
        bom: JSON.parse(JSON.stringify(bomItems))
    };
}

// One downscaled snapshot for the project dashboard card. The WebGL drawing buffer is only
// readable in the same task as the render, so the draw has to follow it immediately.
const THUMBNAIL_WIDTH = 320;
function captureThumbnail() {
    try {
        renderer.render(scene, activeCamera);
        const source = renderer.domElement;
        if (!source.width || !source.height) return '';

        const canvas = document.createElement('canvas');
        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = Math.max(1, Math.round(source.height * (THUMBNAIL_WIDTH / source.width)));
        canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/webp', 0.6);
    } catch (e) {
        console.error('Thumbnail capture failed:', e);
        return '';
    }
}

// Rebuilds a leaf geometry from its saved userData. Hardware is regenerated from its
// hwProps by the same code that created it, so a saved NEMA 17 comes back a NEMA 17.
// Files from before the merge hold separate 'cylinder' and 'cone' shapes with no parameters.
function coneParams(ud) {
    if (ud.cone) return ud.cone;
    return ud.type === 'cylinder' ? { top: 1, bottom: 1, height: 2 } : { top: 0, bottom: 1.5, height: 2 };
}

function rebuildLeafGeometry(ud) {
    if (ud.type === 'wire' && ud.wirePoints && ud.wirePoints.length > 1) {
        const pts = ud.wirePoints.map(p => new THREE.Vector3().fromArray(p));
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
        return new THREE.TubeGeometry(curve, Math.max(20, pts.length * 10), 0.15, 8, false);
    }
    if (ud.type === 'imported' && importedMeshes.has(ud.importId)) {
        return buildImportedGeometry(importedMeshes.get(ud.importId));
    }
    if (ud.isHardware) {
        const geometry = generateHardwareGeometry(ud.type, ud.hwProps || {});
        if (geometry) return geometry;
    }
    switch (ud.type) {
        case 'cube': return normalizeEdge(ud.edge) ? buildBeveledCubeGeometry(ud.edge) : new THREE.BoxGeometry(2, 2, 2);
        case 'sphere': return new THREE.SphereGeometry(1.5, 32, 32);
        case 'cylinder': case 'cone': return buildConeGeometry(coneParams(ud), ud.edge);
        default: return new THREE.BoxGeometry(2, 2, 2);
    }
}

function deserializeShape(data) {
    let mesh;
    const material = new THREE.MeshStandardMaterial({
        color: data.material.color,
        transparent: data.material.transparent,
        opacity: data.material.opacity,
        roughness: data.material.roughness !== undefined ? data.material.roughness : 0.4,
        metalness: data.material.metalness !== undefined ? data.material.metalness : 0.1
    });

    const ud = { ...data.userData };
    if (ud.type === 'cylinder' || (ud.type === 'cone' && !ud.cone)) { ud.cone = { ...coneParams(ud) }; ud.type = 'cone'; }

    if (ud.isComposite && ud.groupChildren) {
        const children = ud.groupChildren.map(childData => deserializeShape(childData));

        mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.position.fromArray(data.position);
        mesh.quaternion.fromArray(data.quaternion);
        mesh.scale.fromArray(data.scale);
        mesh.updateMatrix();

        mesh.userData = ud;
        mesh.userData.groupChildren = children;
        children.forEach(child => {
            child.visible = false;
            mesh.add(child);
        });
        mesh.updateMatrixWorld(true);

        // Regenerate the CSG result from the children instead of storing it.
        rebuildCSG(mesh);
    } else {
        const geometry = rebuildLeafGeometry(ud);
        mesh = new THREE.Mesh(geometry, material);

        if (ud.wirePoints) ud.wirePoints = ud.wirePoints.map(p => new THREE.Vector3().fromArray(p));
        mesh.userData = ud;
        mesh.userData.originalGeometry = geometry;
        if (!mesh.userData.baseSize) mesh.userData.baseSize = measureBaseSize(geometry);

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

// Builds a dashboard card as DOM nodes. Everything here comes out of a .holo file on disk,
// so none of it may be parsed as HTML: a project name, a category or a thumbnail URL is
// data, not markup. Text goes in via textContent, and the thumbnail must be a data: image.
function buildProjectCard({ title, thumbnail, status, version, category, cost }) {
    const card = document.createElement('div');
    card.className = 'project-card';

    if (/^data:image\//.test(thumbnail || '')) {
        const img = document.createElement('img');
        img.src = thumbnail;
        img.alt = 'Thumbnail';
        card.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'width:100%; height:150px; background:#222;';
        card.appendChild(placeholder);
    }

    const heading = document.createElement('h3');
    heading.textContent = title;
    card.appendChild(heading);

    const addMetaRow = (left, right) => {
        const row = document.createElement('div');
        row.className = 'meta';
        const leftEl = document.createElement('span');
        leftEl.textContent = left;
        const rightEl = document.createElement('span');
        rightEl.textContent = right;
        row.appendChild(leftEl);
        row.appendChild(rightEl);
        card.appendChild(row);
    };

    addMetaRow(status, `v${version}`);
    addMetaRow(category, `$${cost.toFixed(2)}`);

    return card;
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
                            // v2.1 stores one thumbnail per file; older files carried one in
                            // every history state.
                            const thumbnail = data.thumbnail || state.thumbnail || '';
                            
                            const card = buildProjectCard({
                                title: entry.name.replace('.holo', ''),
                                thumbnail,
                                status: meta.status || 'Draft',
                                version: meta.version || '1.0',
                                category: meta.category || 'Uncategorized',
                                cost
                            });
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
    // Edits whatever the panel is showing, which for a group is the chosen sub-part.
    const target = currentPropertyNode;
    if (!target || !target.userData.isHardware) return;
    const type = target.userData.type;
    const props = target.userData.hwProps || {};

    if (type === 'extrusion') {
        props.profile = document.getElementById('hw-extrusion-profile').value;
        props.slot = document.getElementById('hw-extrusion-slot').value;
        target.name = `Alu Extrusion ${props.profile}`;
    } else if (type === 'motor') {
        props.nema = document.getElementById('hw-motor-type').value;
        target.name = `Stepper NEMA ${props.nema}`;
    } else if (type === 'screw') {
        props.size = document.getElementById('hw-screw-size').value;
        props.head = document.getElementById('hw-screw-head').value;
        target.name = `Screw ${props.size}`;
    }

    const newGeom = generateHardwareGeometry(type, props);
    if (target.geometry) target.geometry.dispose();
    target.geometry = newGeom;
    target.userData.originalGeometry = newGeom;
    target.userData.hwProps = props;
    target.userData.baseSize = measureBaseSize(newGeom);

    // If this part lives inside a group, the group's solid has to be re-cut around it.
    rebuildAncestors(target);

    // Refresh properties panel to show new dimensions
    selectPropertyNode(target);
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
