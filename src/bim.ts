// Import styles, That Open Components, frontend interaction tools and Fragments types.
///////////////////////////////////////
// #region 01. Imports and Dependencies

import "./style.css";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import type {
	FragmentsModel,
	ItemData,
	ItemAttribute,
} from "@thatopen/fragments";

// #endregion
////////////////

// Locate the HTML container and initialize the 3D world, scene, camera, renderer and grid.
///////////////////////////////////////////////
// #region 02. Viewer and World Initialization

// 1. Get the HTML container.
const container = document.querySelector<HTMLDivElement>("#app");

if (!container) {
	throw new Error("Missing #app element");
}

// 2. Create the component system.
const components = new OBC.Components();
const worlds = components.get(OBC.Worlds);

// 3. Create a BIM world.
const world = worlds.create<
	OBC.SimpleScene,
	OBC.OrthoPerspectiveCamera,
	OBC.SimpleRenderer
>();

world.scene = new OBC.SimpleScene(components);
world.scene.setup();

world.renderer = new OBC.SimpleRenderer(components, container);

world.camera = new OBC.OrthoPerspectiveCamera(components);

components.init();

// 4. Add a grid.
components.get(OBC.Grids).create(world);

// #endregion
////////////////

// Initialize the Fragments worker, update model visibility when the camera changes, and attach loaded models to the scene.
////////////////
// #region 03. Fragments Initialization and Model Management
// 5. Initialize the Fragments system.
const fragments = components.get(OBC.FragmentsManager);

const workerUrl = await OBC.FragmentsManager.getWorker();
fragments.init(workerUrl);

// Update fragments when the camera moves.
world.camera.controls.addEventListener("update", () => {
	fragments.core.update();
});

// Add loaded models to the Three.js scene.
fragments.list.onItemSet.add(({ value: model }) => {
	model.useCamera(world.camera.three);
	world.scene.three.add(model.object);
	fragments.core.update(true);
});
// #endregion
////////////////

// Initialize raycasting and the Highlighter for interactive BIM element selection.
////////////////
// #region 04. BIM Element Selection Setup
// Initialize BIM element selection.
components.get(OBC.Raycasters).get(world);

const highlighter = components.get(OBF.Highlighter);

highlighter.setup({
	world,
});
// #endregion
////////////////

// Provide helpers for updating DOM text, reading IFC attributes and properties, and validating quantities and strings.
////////////////
// #region 05. Shared Data and DOM Utilities
function setProperty(id: string, value: string): void {
	const element = document.getElementById(id);

	if (element) {
		element.textContent = value;
	}
}

// Extract the actual value from an IFC attribute.
function getAttributeValue(item: ItemData | undefined, key: string): unknown {
	const attribute = item?.[key];

	if (!attribute || Array.isArray(attribute)) {
		return undefined;
	}

	return attribute.value;
}

function getPropertyValue(
	item: ItemData,
	setName: string,
	propertyName: string,
): unknown {
	const sets = item.IsDefinedBy;

	if (!Array.isArray(sets)) return undefined;

	const targetSet = sets.find(
		(set) => getAttributeValue(set, "Name") === setName,
	);

	const properties = targetSet?.HasProperties;

	if (!Array.isArray(properties)) return undefined;

	const targetProperty = properties.find(
		(property) => getAttributeValue(property, "Name") === propertyName,
	);

	return getAttributeValue(targetProperty, "NominalValue");
}

function toValidQuantity(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return value;
	}

	return null;
}

function toValidString(value: unknown): string | null {
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim();
	}

	return null;
}
// #endregion
////////////////

// Convert individual IFC column records into flat QTO domain objects with identifiers, type, material, level and quantities.
////////////////
// #region 06. Column QTO Data Transformation
function extractColumnQtoData(item: ItemData): ColumnQtoData | null {
	const localId = getAttributeValue(item, "_localId");

	if (typeof localId !== "number" || !Number.isInteger(localId)) {
		return null;
	}

	// Find the column type definition.
	const sets = item.IsDefinedBy;

	const columnType = Array.isArray(sets)
		? sets.find(
				(set) =>
					getAttributeValue(set, "_category") === "IFCCOLUMNTYPE",
			)
		: undefined;

	// Transform BIM data into QTO data.
	return {
		localId: localId,

		globalId: toValidString(getAttributeValue(item, "_guid")),

		typeName: toValidString(getAttributeValue(columnType, "Name")),

		material: toValidString(
			getPropertyValue(item, "Materiales y acabados", "Material"),
		),

		level: toValidString(getPropertyValue(item, "Location", "Nivel")),

		volume: toValidQuantity(
			getPropertyValue(item, "Dimensiones", "Volumen"),
		),

		length: toValidQuantity(
			getPropertyValue(item, "Dimensiones", "Longitud"),
		),
	};
}
// #endregion
////////////////

// Format IFC values and render property sets and quantity sets for the selected element.
////////////////
// #region 07. Properties Panel Rendering
// Convert an IFC value into displayable text.
function formatAttributeValue(value: unknown): string {
	return value == null ? "—" : String(value);
}

function renderRelatedSets(itemDetailData: ItemData): void {
	const container = document.getElementById("related-sets");

	if (!container) return;

	// Clear previous element information.
	container.replaceChildren();

	const sets = itemDetailData.IsDefinedBy;

	if (!Array.isArray(sets)) {
		container.textContent = "No related data";
		return;
	}

	for (const setItem of sets) {
		// A set may contain properties or quantities.
		const propertiesOrQuantities = Array.isArray(setItem.HasProperties)
			? setItem.HasProperties
			: Array.isArray(setItem.Quantities)
				? setItem.Quantities
				: [];

		if (propertiesOrQuantities.length === 0) continue;

		const section = document.createElement("section");
		const heading = document.createElement("h4");
		const list = document.createElement("dl");

		heading.textContent = formatAttributeValue(
			getAttributeValue(setItem, "Name"),
		);

		for (const propertyOrQuantity of propertiesOrQuantities) {
			const name = formatAttributeValue(
				getAttributeValue(propertyOrQuantity, "Name"),
			);

			const valueFields = [
				"NominalValue",
				"LengthValue",
				"AreaValue",
				"VolumeValue",
				"CountValue",
				"WeightValue",
			];

			const value = valueFields
				.map((field) =>
					formatAttributeValue(
						getAttributeValue(propertyOrQuantity, field),
					),
				)
				.find((result) => result !== "—");

			if (name === "—" || value === undefined) continue;

			const dt = document.createElement("dt");
			const dd = document.createElement("dd");

			dt.textContent = name;
			dd.textContent = value;

			list.append(dt, dd);
		}

		if (list.children.length === 0) continue;

		section.append(heading, list);
		container.append(section);
	}

	if (container.children.length === 0) {
		container.textContent = "No properties or quantities available";
	}
}
// #endregion
////////////////

// Query selected element data, update the properties panel, guard against stale asynchronous results and reset on deselection.
////////////////
// #region 08. Selection Events and Inspector Updates
// Prevent older async queries from overwriting a newer selection.
let selectionVersion = 0;

highlighter.events.select.onHighlight.add(async (modelIdMap) => {
	const version = ++selectionVersion;

	const firstSelection = Object.entries(modelIdMap)[0];

	if (!firstSelection) return;

	const [modelId, localIds] = firstSelection;
	const localId = localIds.values().next().value;

	if (localId === undefined) return;

	const model = fragments.list.get(modelId);

	if (!model) return;

	const [itemData] = await model.getItemsData([localId], {
		attributesDefault: false,

		attributes: [
			"Name",
			"NominalValue",
			"LengthValue",
			"AreaValue",
			"VolumeValue",
			"CountValue",
			"WeightValue",
		],

		relations: {
			IsDefinedBy: {
				attributes: true,
				relations: true,
			},

			DefinesOccurrence: {
				attributes: false,
				relations: false,
			},

			ObjectTypeOf: {
				attributes: false,
				relations: false,
			},
		},
	});

	if (version !== selectionVersion || !itemData) return;

	setProperty(
		"property-name",
		formatAttributeValue(getAttributeValue(itemData, "Name")),
	);

	setProperty(
		"property-guid",
		formatAttributeValue(getAttributeValue(itemData, "_guid")),
	);

	setProperty("property-model", modelId);
	setProperty("property-local", String(localId));

	renderRelatedSets(itemData);
});

// Reset the panel when selection is cleared.
highlighter.events.select.onClear.add(() => {
	++selectionVersion;

	setProperty("property-name", "Select an element");
	setProperty("property-guid", "—");
	setProperty("property-model", "—");
	setProperty("property-local", "—");

	const relatedContainer = document.getElementById("related-sets");

	if (relatedContainer) {
		relatedContainer.textContent = "Select an element";
	}
});
// #endregion
////////////////

// Configure the IFC importer to use locally hosted WebAssembly binaries.
////////////////
// #region 09. IFC Loader and WASM Configuration
// 6. Initialize IFC Loader.
const ifcLoader = components.get(OBC.IfcLoader);

await ifcLoader.setup({
	autoSetWasm: false,
	wasm: {
		path: "/wasm/",
		absolute: true,
	},
});
// #endregion
////////////////

// Define the column QTO data structure and retrieve and transform all IFC columns in the model.
////////////////
// #region 10. QTO Data Model and Bulk Extraction
interface ColumnQtoData {
	localId: number;
	globalId: string | null;
	typeName: string | null;
	material: string | null;
	level: string | null;
	volume: number | null;
	length: number | null;
}

async function extractColumns(model: FragmentsModel): Promise<ColumnQtoData[]> {
	// 1. Find all column IDs.
	const categories = await model.getItemsOfCategories([/^IFCCOLUMN$/]);

	const columnIds = categories.IFCCOLUMN ?? [];

	console.log("Total columns:", columnIds.length);

	// 2. Retrieve all column details.
	const columnDetails = await model.getItemsData(columnIds, {
		attributesDefault: false,

		attributes: ["Name", "NominalValue"],

		relations: {
			IsDefinedBy: {
				attributes: true,
				relations: true,
			},

			DefinesOccurrence: {
				attributes: false,
				relations: false,
			},

			ObjectTypeOf: {
				attributes: false,
				relations: false,
			},
		},
	});

	// 3. Transform each column.
	const columns: ColumnQtoData[] = [];

	for (const item of columnDetails) {
		const column = extractColumnQtoData(item);

		if (column === null) {
			console.warn("Invalid column data:", item);
			continue;
		}

		columns.push(column);
	}

	console.log("Extracted columns:", columns.length);

	return columns;
}
// #endregion
////////////////

// Aggregate reported volumes, track missing quantities, and group columns by material, level or type.
////////////////
// #region 11. QTO Calculation and Grouping
function calculateQto(columns: ColumnQtoData[]) {
	let totalVolume = 0;
	let missingCount = 0;

	for (const column of columns) {
		if (column.volume === null) {
			missingCount++;
			continue;
		}

		totalVolume += column.volume;
	}

	return {
		count: columns.length,
		missingCount,
		totalVolume: missingCount === columns.length ? null : totalVolume,
	};
}

function groupColumns(
	columns: ColumnQtoData[],
	key: "material" | "level" | "typeName",
) {
	const groups = new Map<string, ColumnQtoData[]>();

	for (const column of columns) {
		const groupName = column[key] ?? "Unknown";

		if (!groups.has(groupName)) {
			groups.set(groupName, []);
		}

		groups.get(groupName)!.push(column);
	}

	return Array.from(groups.entries()).map(([name, items]) => ({
		name,
		...calculateQto(items),
	}));
}
// #endregion
////////////////

// Display the quantity summary and update grouped results when the selected grouping changes.
////////////////
// #region 12. QTO Panel Rendering
function renderQto(columns: ColumnQtoData[]) {
	const selector = document.querySelector<HTMLSelectElement>("#qto-group");

	const container = document.getElementById("qto-results");
	const summary = document.getElementById("qto-summary");

	if (!selector || !container || !summary) return;

	const total = calculateQto(columns);

	summary.textContent =
		`Columns: ${total.count} | ` +
		`Reported volume: ${total.totalVolume?.toFixed(3) ?? "N/A"} | `;

	function update() {
		const key = selector!.value as "material" | "level" | "typeName";

		const groups = groupColumns(columns, key);

		container!.replaceChildren();

		for (const group of groups) {
			const section = document.createElement("section");
			const heading = document.createElement("h4");
			const details = document.createElement("p");

			heading.textContent = group.name;

			details.textContent =
				`Count: ${group.count} | ` +
				`Volume: ${group.totalVolume?.toFixed(3) ?? "N/A"} | `;

			section.append(heading, details);
			container!.append(section);
		}
	}

	selector.onchange = update;

	update();
}
// #endregion
////////////////

// Render editable material unit rates, calculate group costs and subtotals, and track missing pricing or quantity data.
////////////////
// #region 13. Cost Integration and Estimation
function renderCost(columns: ColumnQtoData[]): void {
	const container = document.getElementById("cost-results");
	const totalElement = document.getElementById("cost-total");

	if (!container || !totalElement) return;

	container.replaceChildren();

	const groups = groupColumns(columns, "material");

	function updateTotal() {
		let totalCost = 0;
		let missingGroups = 0;

		for (const group of groups) {
			const rate = unitRates.get(group.name);

			const cost =
				group.name === "Unknown"
					? null
					: calculateCost(group.totalVolume, rate);

			if (cost === null) {
				missingGroups++;
				continue;
			}

			totalCost += cost;
		}

		totalElement!.textContent =
			`Calculated subtotal: HK$ ${totalCost.toFixed(2)} ` +
			`| Unpriced groups: ${missingGroups}`;
	}

	for (const group of groups) {
		const section = document.createElement("section");
		const heading = document.createElement("h4");
		const volume = document.createElement("p");
		const input = document.createElement("input");
		const cost = document.createElement("p");

		heading.textContent = group.name;

		volume.textContent = `Reported volume: ${group.totalVolume?.toFixed(3) ?? "N/A"}`;

		input.type = "number";
		input.min = "0";
		input.step = "any";
		input.placeholder = "Unit rate (HK$/m³)";
		input.value = String(unitRates.get(group.name) ?? "");

		input.disabled = group.name === "Unknown";

		function updateCost() {
			const rate = input.valueAsNumber;

			if (Number.isFinite(rate) && rate >= 0) {
				unitRates.set(group.name, rate);
			} else {
				unitRates.delete(group.name);
			}

			const estimatedCost =
				group.name === "Unknown"
					? null
					: calculateCost(
							group.totalVolume,
							unitRates.get(group.name),
						);

			cost.textContent =
				estimatedCost === null
					? "Estimated cost: N/A"
					: `Estimated cost: HK$ ${estimatedCost.toFixed(2)}`;

			if (group.missingCount > 0) {
				cost.textContent += ` (${group.missingCount} missing volumes)`;
			}

			updateTotal();
		}

		input.addEventListener("input", updateCost);

		section.append(heading, volume, input, cost);
		container.append(section);

		updateCost();
	}

	updateTotal();
}

const unitRates = new Map<string, number>();

function calculateCost(
	volume: number | null,
	unitRate: number | undefined,
): number | null {
	if (
		volume === null ||
		unitRate === undefined ||
		!Number.isFinite(unitRate) ||
		unitRate < 0
	) {
		return null;
	}

	return volume * unitRate;
}
// #endregion
////////////////

// Fetch and import the IFC sample, extract column data, render both analysis panels and position the camera.
////////////////
// #region 14. IFC Loading and Application Startup
// 7. Load a real IFC file.
async function loadIfc(url: string): Promise<void> {
	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Failed to fetch IFC: ${response.status}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const ifcData = new Uint8Array(arrayBuffer);

	const model = await ifcLoader.load(ifcData, true, "School Model");

	const columns = await extractColumns(model);

	renderQto(columns);

	renderCost(columns);
}

// 8. Load official sample.
await loadIfc(
	"https://thatopen.github.io/engine_components/resources/ifc/school_str.ifc",
);

// 9. Position the camera.
await world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);
// #endregion
////////////////
