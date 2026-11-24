import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

// #region Parameters

const roomSizeX: number = 40;
const roomSizeZ: number = 40;
const roomSizeY: number = 3;
const thickness: number = 0.05;

const gridSize: number = 5;
const gridX: number = 1;
const gridZ: number = 1;

// #endregion

// #region Scene and Light

const scene: THREE.Scene = new THREE.Scene();

const sun: THREE.DirectionalLight = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(0, 8, -10);
scene.add(sun);

const hemisphere: THREE.HemisphereLight = new THREE.HemisphereLight(
	0xb1e1ff, // Sky Color
	0x654321, // Ground Color
	0.8, // Intensity
);

scene.add(hemisphere);

// #endregion

// #region GLTF Loader

const gltfLoader: GLTFLoader = new GLTFLoader();

let loadedModels: THREE.Group[] = [];

async function loadModel(address: string): Promise<void> {
	try {
		const gltf: GLTF = await gltfLoader.loadAsync(address);

		const model: THREE.Group = gltf.scene;

		scene.add(model);

		// FitCameraToModel(model);

		loadedModels.push(model);
	} catch (error) {
		console.error("Failed to load model: ", error);
	}
}

// #endregion

// #region Camera

const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(
	55,
	window.innerWidth / window.innerHeight,
	0.1,
	100,
);

camera.position.set(0, 0, 50);

// // Fit to camera
function FitCameraToModel(model: THREE.Object3D): void {
	const bounds: THREE.Box3 = new THREE.Box3().setFromObject(model);

	if (bounds.isEmpty()) {
		console.warn("Model has no bounding geometry.");
		return;
	}

	const center: THREE.Vector3 = bounds.getCenter(new THREE.Vector3());

	const size: THREE.Vector3 = bounds.getSize(new THREE.Vector3());

	const sphere: THREE.Sphere = bounds.getBoundingSphere(new THREE.Sphere());

	const radius: number = sphere.radius;

	if (radius === 0) {
		return;
	}

	// PerspectiveCamera.fov 是垂直視角
	const verticalHalfFov: number = THREE.MathUtils.degToRad(camera.fov / 2);

	const horizontalHalfFov: number = Math.atan(
		Math.tan(verticalHalfFov) * camera.aspect,
	);

	// 同時考慮畫面寬度和高度
	const limitingHalfFov: number = Math.min(
		verticalHalfFov,
		horizontalHalfFov,
	);

	// 讓整個 Bounding Sphere 進入 Camera 視野
	const distance: number = (radius / Math.sin(limitingHalfFov)) * 1.2;

	const direction: THREE.Vector3 = new THREE.Vector3(1, 0.7, 1).normalize();

	camera.position.copy(center).addScaledVector(direction, distance);

	mouseControl.target.copy(center);

	camera.near = Math.max(0.01, distance - radius * 2);
	camera.far = Math.max(100, distance + radius * 3);

	camera.updateProjectionMatrix();
	mouseControl.update();

	console.log("Model center:", center);
	console.log("Model size:", size);
}

// #endregion

// #region Raycast

//// Pointer to NDC

function pointerToNdc(
	event: PointerEvent,
	canvas: HTMLCanvasElement,
): THREE.Vector2 {
	const canvasRect: DOMRect = canvas.getBoundingClientRect();

	const pointX: number = event.clientX - canvasRect.left;
	const pointY: number = event.clientY - canvasRect.top;

	const ndcX: number = (2 * pointX) / canvasRect.width - 1;
	const ndcY: number = 1 - (2 * pointY) / canvasRect.height;

	return new THREE.Vector2(ndcX, ndcY);
}

const raycaster: THREE.Raycaster = new THREE.Raycaster();

function raycast(ndc: THREE.Vector2): void {
	raycaster.setFromCamera(ndc, camera);

	const visibleMeshes: THREE.Mesh[] = getVisibleMeshes();

	const intersections: THREE.Intersection[] = raycaster.intersectObjects(
		visibleMeshes,
		false,
	);

	const hit: THREE.Intersection | undefined = intersections[0];

	const nextMesh: THREE.Mesh | null =
		hit?.object instanceof THREE.Mesh ? hit.object : null;

	updateSelection(nextMesh);
}

function getVisibleMeshes(): THREE.Mesh[] {
	const visibleMeshes: THREE.Mesh[] = [];

	for (const model of loadedModels) {
		model.traverseVisible((object: THREE.Object3D): void => {
			if (object instanceof THREE.Mesh) {
				visibleMeshes.push(object);
			}
		});
	}

	return visibleMeshes;
}

let selectedMesh: THREE.Mesh | null = null;

let originalSelectedMaterial: THREE.Material | THREE.Material[] | null = null;

function updateSelection(nextMesh: THREE.Mesh | null): void {
	// Restore previous selection
	if (selectedMesh !== null && originalSelectedMaterial !== null) {
		selectedMesh.material = originalSelectedMaterial;
	}

	// Update selection state
	selectedMesh = nextMesh;

	originalSelectedMaterial = nextMesh !== null ? nextMesh.material : null;

	// Highlight new selection
	if (selectedMesh !== null) {
		selectedMesh.material = highlightMat;
	}
}

const dragThreshold: number = 5;

let pointerStart: THREE.Vector2 | null = null;
let activePointerId: number | null = null;
let wasDragged: boolean = false;

// #endregion

// #region Hiding

const hiddenMeshes: Set<THREE.Mesh> = new Set();

function hideSelection(): void {
	const meshToHide: THREE.Mesh | null = selectedMesh;

	if (meshToHide === null) return;

	updateSelection(null);

	meshToHide.visible = false;
	hiddenMeshes.add(meshToHide);
}

function showAllHidden(): void {
	for (const mesh of hiddenMeshes) {
		mesh.visible = true;
	}

	hiddenMeshes.clear();
}

let isolatedHiddenMeshes: Set<THREE.Mesh> | null = null;

function toggleIsolation(): void {
	// Exit Isolation
	if (isolatedHiddenMeshes !== null) {
		for (const mesh of isolatedHiddenMeshes) {
			mesh.visible = true;
		}

		isolatedHiddenMeshes = null;
		return;
	}

	// Enter Isolation
	const meshToKeep: THREE.Mesh | null = selectedMesh;

	if (meshToKeep === null) return;

	const hiddenByIsolation: Set<THREE.Mesh> = new Set();

	for (const mesh of getVisibleMeshes()) {
		if (mesh === meshToKeep) continue;

		mesh.visible = false;
		hiddenByIsolation.add(mesh);
	}

	isolatedHiddenMeshes = hiddenByIsolation;

	updateSelection(null);
}

// #endregion

// #region Geometries

const floorGeo: THREE.BoxGeometry = new THREE.BoxGeometry(
	roomSizeX,
	thickness,
	roomSizeZ,
);

const sideWallGeo: THREE.BoxGeometry = new THREE.BoxGeometry(
	thickness,
	roomSizeY,
	roomSizeZ,
);

const backWallGeo: THREE.BoxGeometry = new THREE.BoxGeometry(
	roomSizeX,
	roomSizeY,
	thickness,
);

// #endregion

// #region Materials

const floorTex: THREE.Texture = new THREE.TextureLoader().load(
	"/textures/water.jpg",
);

const floorNormalTex: THREE.Texture = new THREE.TextureLoader().load(
	"/textures/water.jpg",
);

floorTex.colorSpace = THREE.SRGBColorSpace;

floorTex.wrapS = THREE.RepeatWrapping;
floorTex.wrapT = THREE.RepeatWrapping;

floorTex.repeat.set(1, 1);

const floorMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
	map: floorTex,
	normalMap: floorNormalTex,
	color: 0xffffff,
	metalness: 1,
	roughness: 0.4,
});

const leftWallMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
	color: 0x4f8000,
	metalness: 1,
	roughness: 0.3,
});

const rightWallMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial(
	{
		color: 0xa36450,
		roughness: 0.3,
	},
);

const backWallMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
	color: 0xf86450,
	roughness: 0.3,
});

const highlightMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial(
	{
		color: 0xff3fff,
		normalMap: floorNormalTex,
		roughness: 0,
		metalness: 0.7,
	},
);

// #endregion

// #region Meshes

const floorMesh: THREE.Mesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.name = "floor";

const leftWallMesh: THREE.Mesh = new THREE.Mesh(sideWallGeo, leftWallMat);
leftWallMesh.name = "leftWall";

const rightWallMesh: THREE.Mesh = new THREE.Mesh(sideWallGeo, rightWallMat);
rightWallMesh.name = "rightWall";

const backWallMesh: THREE.Mesh = new THREE.Mesh(backWallGeo, backWallMat);
backWallMesh.name = "backWall";

// #endregion

// #region GLTF

async function handleModels(): Promise<void> {
	await Promise.all([
		loadModel("/models/Duck.glb"),
		loadModel("/models/Duck.glb"),
		loadModel("/models/Duck.glb"),
	]);

	for (let i = 0; i < loadedModels.length; i++) {
		loadedModels[i].position.set(
			(-(loadedModels.length - 1) / 2 + i) * 10,
			0,
			0,
		);
	}
}

handleModels();

// #endregion

// #region Groups

const roomGroup: THREE.Group = new THREE.Group();

// #endregion

// #region Hierachy

roomGroup.add(floorMesh, leftWallMesh, rightWallMesh, backWallMesh);

// scene.add(roomGroup);

// #endregion

// #region Transformas

leftWallMesh.position.x = -roomSizeX / 2;
leftWallMesh.position.y = +roomSizeY / 2;

rightWallMesh.position.x = +roomSizeX / 2;
rightWallMesh.position.y = +roomSizeY / 2;

backWallMesh.position.z = -roomSizeZ / 2;
backWallMesh.position.y = +roomSizeY / 2;

// #endregion

// #region Renderer

const renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer();

renderer.setSize(window.innerWidth, window.innerHeight);

// #endregion

// #region EventListener

renderer.domElement.addEventListener(
	"pointerdown",
	(event: PointerEvent): void => {
		if (event.pointerType !== "mouse" || event.button !== 0) {
			return;
		}

		pointerStart = new THREE.Vector2(event.clientX, event.clientY);
		activePointerId = event.pointerId;
		wasDragged = false;
	},
);

renderer.domElement.addEventListener(
	"pointermove",
	(event: PointerEvent): void => {
		if (pointerStart === null || event.pointerId !== activePointerId) {
			return;
		}

		const dx: number = event.clientX - pointerStart.x;
		const dy: number = event.clientY - pointerStart.y;

		if (dx * dx + dy * dy > dragThreshold * dragThreshold) {
			wasDragged = true;
		}
	},
);

renderer.domElement.addEventListener(
	"pointerup",
	(event: PointerEvent): void => {
		if (pointerStart === null || event.pointerId !== activePointerId) {
			return;
		}

		if (wasDragged == false) {
			const ndc: THREE.Vector2 = pointerToNdc(event, renderer.domElement);

			raycast(ndc);
		}

		pointerStart = null;
		activePointerId = null;
		wasDragged = false;
	},
);

renderer.domElement.addEventListener(
	"pointercancel",
	(event: PointerEvent): void => {
		if (event.pointerId !== activePointerId) return;

		pointerStart = null;
		activePointerId = null;
		wasDragged = false;
	},
);

window.addEventListener("keydown", (event: KeyboardEvent): void => {
	if (event.repeat) return;

	if (event.key.toLowerCase() === "h") {
		if (isolatedHiddenMeshes !== null) return;

		if (event.shiftKey) {
			showAllHidden();
		} else {
			hideSelection();
		}
	}
});

window.addEventListener("keydown", (event: KeyboardEvent): void => {
	if (event.repeat) return;

	if (event.key.toLowerCase() === "i") {
		toggleIsolation();
	}
});

// #endregion

// #region Canvas

const canvas: HTMLCanvasElement = renderer.domElement;

const app: HTMLDivElement | null =
	document.querySelector<HTMLDivElement>("#app");

if (!app) {
	throw new Error("No app.");
}

app.append(canvas);

// #endregion

// #region Orbit Controls

const mouseControl: OrbitControls = new OrbitControls(camera, canvas);

mouseControl.target.set(0, 0, 0);
mouseControl.enableDamping = true;
mouseControl.dampingFactor = 0.05;

window.addEventListener("resize", () => {
	const width = window.innerWidth;
	const height = window.innerHeight;

	camera.aspect = width / height;
	camera.updateProjectionMatrix();

	renderer.setSize(width, height);
});

// #endregion

// #region Animation loop and rendering

renderer.setAnimationLoop((time: number) => {
	mouseControl.update();

	renderer.render(scene, camera);
});

// #endregion
