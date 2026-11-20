import {
  getDefaultWindowLayouts,
  recoverWindowLayout,
  type WindowViewport,
} from "./windowManager";

export const WORKSPACE_PREFERENCES_STORAGE_KEY = "folio.workspace-layout.v1";

export const LEGACY_WORKSPACE_STORAGE_KEYS = {
  "main-canvas": "folio.canvas-window",
  "component-canvas": "folio.component-canvas-window",
  "node-logic": "folio.node-logic-window",
} as const;

export const WORKSPACE_KINDS = [
  "main-canvas",
  "component-canvas",
  "node-logic",
] as const;

export const WORKSPACE_PANEL_KEYS = [
  "pages-rack",
  "component-rack",
  "layers",
] as const;

export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];
export type WorkspaceVisibility = "open" | "minimized" | "closed";
export type WorkspacePresentation = "docked" | "floating";
export type WorkspacePanelKey = (typeof WORKSPACE_PANEL_KEYS)[number];

export interface WorkspaceGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkspaceWindowRecord {
  windowInstanceId: string;
  workspace: WorkspaceKind;
  visibility: WorkspaceVisibility;
  presentation: WorkspacePresentation;
  geometry: WorkspaceGeometry;
  maximized: false;
  stackOrder: number;
}

export interface WorkspaceLayoutV1 {
  schemaVersion: 1;
  layoutId: string;
  windows: WorkspaceWindowRecord[];
  stackOrder: string[];
  activeWindowInstanceId: string | null;
  activeWorkspace: WorkspaceKind;
  panelVisibility: Record<WorkspacePanelKey, boolean>;
  updatedAt: string;
}

export interface WorkspacePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type WorkspacePreferencesLoadStatus =
  | "valid"
  | "missing"
  | "migrated"
  | "malformed"
  | "unsupported-newer-schema"
  | "storage-unavailable";

export interface WorkspacePreferencesLoadOptions {
  storage?: WorkspacePreferencesStorage | null;
  viewport?: WindowViewport;
  now?: string;
}

export interface WorkspacePreferencesLoadResult {
  status: WorkspacePreferencesLoadStatus;
  layout: WorkspaceLayoutV1;
  warnings: string[];
  requiresReconciliation: boolean;
}

export interface WorkspacePreferencesSaveOptions {
  storage?: WorkspacePreferencesStorage | null;
  viewport?: WindowViewport;
  /** Saving is intentionally disabled until the caller completes reconciliation. */
  reconciliationComplete?: boolean;
  /** Explicit opt-in required before replacing a record from a newer schema. */
  replaceUnsupportedVersion?: boolean;
}

export type WorkspacePreferencesSaveFailure =
  | "reconciliation-not-confirmed"
  | "invalid-layout"
  | "storage-unavailable"
  | "unsupported-newer-schema"
  | "write-failed";

export type WorkspacePreferencesSaveResult =
  | { ok: true; key: string }
  | { ok: false; reason: WorkspacePreferencesSaveFailure };

const DEFAULT_VIEWPORT: WindowViewport = { width: 1280, height: 800 };
const MAX_RECORD_LENGTH = 64 * 1024;
const MAX_WINDOW_RECORDS = 24;
const MAX_STACK_ENTRIES = 48;
const MAX_ID_LENGTH = 96;
const MAX_LAYOUT_ID_LENGTH = 128;
const MAX_COORDINATE = 1_000_000;
const DEFAULT_LAYOUT_ID = "folio-workspace-layout-v1";

const WINDOW_INSTANCE_IDS: Record<WorkspaceKind, string> = {
  "main-canvas": "workspace-main-canvas",
  "component-canvas": "workspace-component-canvas",
  "node-logic": "workspace-node-logic",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return typeof value === "string" &&
    (WORKSPACE_KINDS as readonly string[]).includes(value);
}

function isVisibility(value: unknown): value is WorkspaceVisibility {
  return value === "open" || value === "minimized" || value === "closed";
}

function isPresentation(value: unknown): value is WorkspacePresentation {
  return value === "docked" || value === "floating";
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 64 &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value));
}

function safeViewport(viewport?: WindowViewport): WindowViewport {
  const width = viewport?.width;
  const height = viewport?.height;
  return {
    width: typeof width === "number" && Number.isFinite(width) && width > 0
      ? Math.min(width, MAX_COORDINATE)
      : DEFAULT_VIEWPORT.width,
    height: typeof height === "number" && Number.isFinite(height) && height > 0
      ? Math.min(height, MAX_COORDINATE)
      : DEFAULT_VIEWPORT.height,
  };
}

function resolveStorage(
  storage: WorkspacePreferencesStorage | null | undefined,
): WorkspacePreferencesStorage | null {
  if (storage !== undefined) return storage;
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function geometryFromWindowManager(
  layout: { position: { x: number; y: number }; size: { width: number; height: number } },
): WorkspaceGeometry {
  return {
    x: layout.position.x,
    y: layout.position.y,
    width: layout.size.width,
    height: layout.size.height,
  };
}

function defaultVisibility(workspace: WorkspaceKind): WorkspaceVisibility {
  return workspace === "main-canvas" ? "open" : "closed";
}

function defaultPresentation(workspace: WorkspaceKind): WorkspacePresentation {
  return workspace === "main-canvas" ? "docked" : "floating";
}

function createDefaultWindow(
  workspace: WorkspaceKind,
  geometry: WorkspaceGeometry,
  stackOrder: number,
): WorkspaceWindowRecord {
  return {
    windowInstanceId: WINDOW_INSTANCE_IDS[workspace],
    workspace,
    visibility: defaultVisibility(workspace),
    presentation: defaultPresentation(workspace),
    geometry: { ...geometry },
    maximized: false,
    stackOrder,
  };
}

/** Creates safe V1 defaults without reading browser or project state. */
export function createDefaultWorkspaceLayout(
  viewport: WindowViewport = DEFAULT_VIEWPORT,
  updatedAt = new Date().toISOString(),
): WorkspaceLayoutV1 {
  const safeArea = safeViewport(viewport);
  const defaults = getDefaultWindowLayouts(safeArea);
  const main = createDefaultWindow(
    "main-canvas",
    geometryFromWindowManager(defaults["main-canvas"]),
    0,
  );
  const component = createDefaultWindow(
    "component-canvas",
    geometryFromWindowManager(defaults["component-canvas"]),
    0,
  );
  const logic = createDefaultWindow(
    "node-logic",
    geometryFromWindowManager(defaults["node-logic"]),
    0,
  );

  return {
    schemaVersion: 1,
    layoutId: DEFAULT_LAYOUT_ID,
    windows: [main, component, logic],
    stackOrder: [main.windowInstanceId],
    activeWindowInstanceId: main.windowInstanceId,
    activeWorkspace: "main-canvas",
    panelVisibility: {
      "pages-rack": false,
      "component-rack": false,
      layers: true,
    },
    updatedAt: isValidTimestamp(updatedAt) ? updatedAt : new Date().toISOString(),
  };
}

function hasValidGeometryNumbers(value: unknown): value is WorkspaceGeometry {
  if (!isObject(value)) return false;
  const { x, y, width, height } = value;
  return typeof x === "number" &&
    Number.isFinite(x) &&
    Math.abs(x) <= MAX_COORDINATE &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    Math.abs(y) <= MAX_COORDINATE &&
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    width <= MAX_COORDINATE &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0 &&
    height <= MAX_COORDINATE;
}

function defaultGeometryFor(
  workspace: WorkspaceKind,
  defaults: WorkspaceLayoutV1,
): WorkspaceGeometry {
  const record = defaults.windows.find((windowRecord) => windowRecord.workspace === workspace);
  return record ? { ...record.geometry } : { x: 0, y: 56, width: 280, height: 220 };
}

function normalizeWindowGeometry(
  geometry: unknown,
  workspace: WorkspaceKind,
  defaults: WorkspaceLayoutV1,
  viewport: WindowViewport,
): WorkspaceGeometry {
  if (!hasValidGeometryNumbers(geometry)) return defaultGeometryFor(workspace, defaults);
  const recovered = recoverWindowLayout(
    {
      position: { x: geometry.x, y: geometry.y },
      size: { width: geometry.width, height: geometry.height },
    },
    viewport,
  );
  return geometryFromWindowManager(recovered);
}

function normalizePanelVisibility(
  value: unknown,
  defaults: Record<WorkspacePanelKey, boolean>,
  warnings: string[],
): Record<WorkspacePanelKey, boolean> {
  const result = { ...defaults };
  if (!isObject(value)) {
    warnings.push("panelVisibility was not an object; defaults were used");
    return result;
  }
  for (const key of WORKSPACE_PANEL_KEYS) {
    if (typeof value[key] === "boolean") {
      result[key] = value[key] as boolean;
    } else if (value[key] !== undefined) {
      warnings.push("Invalid panel visibility for " + key + "; default was used");
    }
  }
  return result;
}

/**
 * Validates and normalizes a V1 payload. Unknown/duplicate workspace records
 * are discarded, missing known kinds are filled from defaults, and geometry
 * is recovered through the shared window-manager helper. Invalid root shapes
 * return null so callers can select the safe-default recovery path.
 */
export function normalizeWorkspaceLayout(
  value: unknown,
  viewport: WindowViewport = DEFAULT_VIEWPORT,
): WorkspaceLayoutV1 | null {
  if (!isObject(value) || value.schemaVersion !== 1) return null;
  if (!isBoundedString(value.layoutId, MAX_LAYOUT_ID_LENGTH)) return null;
  if (!Array.isArray(value.windows) || value.windows.length > MAX_WINDOW_RECORDS) return null;
  if (!Array.isArray(value.stackOrder) || value.stackOrder.length > MAX_STACK_ENTRIES) return null;
  if (value.activeWindowInstanceId !== null &&
      !isBoundedString(value.activeWindowInstanceId, MAX_ID_LENGTH)) return null;
  if (typeof value.activeWorkspace !== "string") return null;
  if (!isObject(value.panelVisibility) || Object.keys(value.panelVisibility).length > 16) return null;
  if (!isValidTimestamp(value.updatedAt)) return null;

  const safeArea = safeViewport(viewport);
  const defaults = createDefaultWorkspaceLayout(safeArea, value.updatedAt);
  const recordsByWorkspace = new Map<WorkspaceKind, WorkspaceWindowRecord>();
  const seenIds = new Set<string>();

  for (const candidate of value.windows) {
    if (!isObject(candidate)) continue;
    if (typeof candidate.workspace !== "string" || !isWorkspaceKind(candidate.workspace)) continue;
    const workspace = candidate.workspace;
    if (!isBoundedString(candidate.windowInstanceId, MAX_ID_LENGTH)) continue;
    if (seenIds.has(candidate.windowInstanceId) || recordsByWorkspace.has(workspace)) continue;
    if (!isVisibility(candidate.visibility) || !isPresentation(candidate.presentation)) continue;
    if (candidate.maximized !== false) continue;
    if (typeof candidate.stackOrder !== "number" ||
        !Number.isInteger(candidate.stackOrder) ||
        candidate.stackOrder < 0 ||
        candidate.stackOrder > MAX_STACK_ENTRIES) continue;

    const record: WorkspaceWindowRecord = {
      windowInstanceId: candidate.windowInstanceId,
      workspace,
      visibility: candidate.visibility,
      presentation: candidate.presentation,
      geometry: normalizeWindowGeometry(candidate.geometry, workspace, defaults, safeArea),
      maximized: false,
      stackOrder: candidate.stackOrder,
    };
    recordsByWorkspace.set(workspace, record);
    seenIds.add(record.windowInstanceId);
  }

  const windows = WORKSPACE_KINDS.map((workspace) => {
    const existing = recordsByWorkspace.get(workspace);
    if (existing) {
      return {
        ...existing,
        geometry: { ...existing.geometry },
      };
    }
    const fallback = defaults.windows.find((record) => record.workspace === workspace);
    return fallback ? { ...fallback, geometry: { ...fallback.geometry } } :
      createDefaultWindow(workspace, { x: 0, y: 56, width: 280, height: 220 }, 0);
  });

  const recordsById = new Map(windows.map((record) => [record.windowInstanceId, record]));
  const openIds = new Set(
    windows.filter((record) => record.visibility === "open").map((record) => record.windowInstanceId),
  );
  const normalizedStack: string[] = [];
  const stackCandidates = value.stackOrder as unknown[];
  for (const candidate of stackCandidates) {
    if (typeof candidate !== "string" || candidate.length > MAX_ID_LENGTH || !openIds.has(candidate) || normalizedStack.includes(candidate)) {
      continue;
    }
    normalizedStack.push(candidate);
  }
  for (const record of windows) {
    if (record.visibility === "open" && !normalizedStack.includes(record.windowInstanceId)) {
      normalizedStack.push(record.windowInstanceId);
    }
  }

  const requestedActive = value.activeWindowInstanceId;
  const activeWindowInstanceId =
    typeof requestedActive === "string" && openIds.has(requestedActive)
      ? requestedActive
      : normalizedStack.at(-1) ?? null;
  const activeRecord = activeWindowInstanceId
    ? recordsById.get(activeWindowInstanceId)
    : undefined;
  const activeWorkspace = activeRecord?.workspace ??
    (isWorkspaceKind(value.activeWorkspace) ? value.activeWorkspace : "main-canvas");

  const stackIndices = new Map(normalizedStack.map((id, index) => [id, index]));
  const normalizedWindows = windows.map((record) => ({
    ...record,
    geometry: { ...record.geometry },
    stackOrder: stackIndices.get(record.windowInstanceId) ?? 0,
  }));

  const warnings: string[] = [];
  const panelVisibility = normalizePanelVisibility(
    value.panelVisibility,
    defaults.panelVisibility,
    warnings,
  );

  return {
    schemaVersion: 1,
    layoutId: value.layoutId,
    windows: normalizedWindows,
    stackOrder: [...normalizedStack],
    activeWindowInstanceId,
    activeWorkspace,
    panelVisibility,
    updatedAt: value.updatedAt,
  };
}

function parseLegacyWindow(
  raw: string,
  workspace: WorkspaceKind,
  defaults: WorkspaceLayoutV1,
  viewport: WindowViewport,
): WorkspaceWindowRecord | null {
  if (raw.length > 8 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || !isPresentation(parsed.mode)) return null;
  if (!isObject(parsed.position) || !isObject(parsed.size)) return null;
  const geometry = {
    x: parsed.position.x,
    y: parsed.position.y,
    width: parsed.size.width,
    height: parsed.size.height,
  };
  if (!hasValidGeometryNumbers(geometry)) return null;

  return {
    windowInstanceId: WINDOW_INSTANCE_IDS[workspace],
    workspace,
    visibility: defaultVisibility(workspace),
    presentation: parsed.mode,
    geometry: normalizeWindowGeometry(geometry, workspace, defaults, viewport),
    maximized: false,
    stackOrder: workspace === "main-canvas" ? 0 : 0,
  };
}

function makeLoadResult(
  status: WorkspacePreferencesLoadStatus,
  layout: WorkspaceLayoutV1,
  warnings: string[] = [],
): WorkspacePreferencesLoadResult {
  return {
    status,
    layout,
    warnings,
    requiresReconciliation: status !== "valid",
  };
}

/**
 * Loads a versioned preference record, or safely migrates the three legacy
 * per-window records in memory. Loading never writes or deletes storage.
 */
export function loadWorkspacePreferences(
  options: WorkspacePreferencesLoadOptions = {},
): WorkspacePreferencesLoadResult {
  const storage = resolveStorage(options.storage);
  const viewport = safeViewport(options.viewport);
  const now = isValidTimestamp(options.now) ? options.now : new Date().toISOString();
  const defaults = createDefaultWorkspaceLayout(viewport, now);

  if (!storage) return makeLoadResult("storage-unavailable", defaults);

  let serialized: string | null;
  try {
    serialized = storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
  } catch {
    return makeLoadResult("storage-unavailable", defaults, ["Preference storage could not be read"]);
  }

  if (serialized !== null) {
    if (serialized.length > MAX_RECORD_LENGTH) {
      return makeLoadResult("malformed", defaults, ["Stored preference record exceeded the size limit"]);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      return makeLoadResult("malformed", defaults, ["Stored preference record was not valid JSON"]);
    }
    if (isObject(parsed) &&
        typeof parsed.schemaVersion === "number" &&
        Number.isInteger(parsed.schemaVersion) &&
        parsed.schemaVersion > 1) {
      return makeLoadResult(
        "unsupported-newer-schema",
        defaults,
        ["Stored preference schema is newer than this adapter supports"],
      );
    }
    const normalized = normalizeWorkspaceLayout(parsed, viewport);
    if (!normalized) {
      return makeLoadResult("malformed", defaults, ["Stored preference record did not match WorkspaceLayoutV1"]);
    }
    return makeLoadResult("valid", normalized);
  }

  const migrated = new Map<WorkspaceKind, WorkspaceWindowRecord>();
  let foundLegacyRecord = false;
  let validLegacyRecords = 0;
  const warnings: string[] = [];

  for (const workspace of WORKSPACE_KINDS) {
    let legacy: string | null;
    try {
      legacy = storage.getItem(LEGACY_WORKSPACE_STORAGE_KEYS[workspace]);
    } catch {
      return makeLoadResult(
        "storage-unavailable",
        defaults,
        ["Legacy preference storage could not be read"],
      );
    }
    if (legacy === null) continue;
    foundLegacyRecord = true;
    const record = parseLegacyWindow(legacy, workspace, defaults, viewport);
    if (!record) {
      warnings.push("Legacy record for " + workspace + " was malformed and its default was retained");
      continue;
    }
    migrated.set(workspace, record);
    validLegacyRecords += 1;
  }

  if (!foundLegacyRecord) return makeLoadResult("missing", defaults);
  if (validLegacyRecords === 0) return makeLoadResult("malformed", defaults, warnings);

  const windows = defaults.windows.map((record) => {
    const migratedRecord = migrated.get(record.workspace);
    return migratedRecord ? { ...migratedRecord, geometry: { ...migratedRecord.geometry } } : record;
  });
  const mainRecord = windows.find((record) => record.workspace === "main-canvas");
  const openRecords = windows.filter((record) => record.visibility === "open");
  const stackOrder = openRecords.map((record) => record.windowInstanceId);
  const activeWindowInstanceId = mainRecord?.visibility === "open"
    ? mainRecord.windowInstanceId
    : stackOrder.at(-1) ?? null;
  const activeRecord = windows.find((record) => record.windowInstanceId === activeWindowInstanceId);

  const layout: WorkspaceLayoutV1 = {
    ...defaults,
    windows,
    stackOrder,
    activeWindowInstanceId,
    activeWorkspace: activeRecord?.workspace ?? "main-canvas",
    panelVisibility: { ...defaults.panelVisibility },
  };
  return makeLoadResult("migrated", layout, warnings);
}

function isStrictSaveLayout(
  value: unknown,
): value is WorkspaceLayoutV1 {
  if (!isObject(value) || value.schemaVersion !== 1) return false;
  if (!isBoundedString(value.layoutId, MAX_LAYOUT_ID_LENGTH)) return false;
  if (!Array.isArray(value.windows) || value.windows.length !== WORKSPACE_KINDS.length) return false;
  if (!Array.isArray(value.stackOrder) || value.stackOrder.length > MAX_STACK_ENTRIES) return false;
  if (value.activeWindowInstanceId !== null &&
      !isBoundedString(value.activeWindowInstanceId, MAX_ID_LENGTH)) return false;
  if (!isWorkspaceKind(value.activeWorkspace) || !isValidTimestamp(value.updatedAt)) return false;
  if (!isObject(value.panelVisibility)) return false;

  for (const key of WORKSPACE_PANEL_KEYS) {
    if (typeof value.panelVisibility[key] !== "boolean") return false;
  }
  if (Object.keys(value.panelVisibility).some(
    (key) => !(WORKSPACE_PANEL_KEYS as readonly string[]).includes(key),
  )) return false;

  const ids = new Set<string>();
  const kinds = new Set<WorkspaceKind>();
  for (const candidate of value.windows) {
    if (!isObject(candidate) ||
        !isBoundedString(candidate.windowInstanceId, MAX_ID_LENGTH) ||
        !isWorkspaceKind(candidate.workspace) ||
        !isVisibility(candidate.visibility) ||
        !isPresentation(candidate.presentation) ||
        candidate.maximized !== false ||
        !Number.isInteger(candidate.stackOrder) ||
        typeof candidate.stackOrder !== "number" ||
        candidate.stackOrder < 0 ||
        !hasValidGeometryNumbers(candidate.geometry)) return false;
    if (ids.has(candidate.windowInstanceId) || kinds.has(candidate.workspace)) return false;
    ids.add(candidate.windowInstanceId);
    kinds.add(candidate.workspace);
  }
  if (kinds.size !== WORKSPACE_KINDS.length) return false;

  const openIds = value.windows
    .filter((record) => record.visibility === "open")
    .map((record) => record.windowInstanceId);
  const requestedStackOrder = value.stackOrder as unknown[];
  if (requestedStackOrder.some((id) => typeof id !== "string" || !ids.has(id))) return false;
  if (new Set(requestedStackOrder).size !== requestedStackOrder.length) return false;
  if (requestedStackOrder.length !== openIds.length ||
      openIds.some((id) => !requestedStackOrder.includes(id))) return false;
  if (value.activeWindowInstanceId !== null && !openIds.includes(value.activeWindowInstanceId)) {
    return false;
  }
  if (openIds.length === 0 && value.activeWindowInstanceId !== null) return false;
  return true;
}

/**
 * Saves only a fully validated V1 layout after explicit reconciliation.
 * It also protects a newer stored schema from accidental downgrade.
 */
export function saveWorkspacePreferences(
  value: unknown,
  options: WorkspacePreferencesSaveOptions = {},
): WorkspacePreferencesSaveResult {
  if (options.reconciliationComplete !== true) {
    return { ok: false, reason: "reconciliation-not-confirmed" };
  }
  if (!isStrictSaveLayout(value)) return { ok: false, reason: "invalid-layout" };

  const storage = resolveStorage(options.storage);
  if (!storage) return { ok: false, reason: "storage-unavailable" };

  let existing: string | null;
  try {
    existing = storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
  } catch {
    return { ok: false, reason: "storage-unavailable" };
  }
  if (existing !== null && !options.replaceUnsupportedVersion) {
    if (existing.length <= MAX_RECORD_LENGTH) {
      try {
        const previous = JSON.parse(existing) as unknown;
        if (isObject(previous) &&
            typeof previous.schemaVersion === "number" &&
            Number.isInteger(previous.schemaVersion) &&
            previous.schemaVersion > 1) {
          return { ok: false, reason: "unsupported-newer-schema" };
        }
      } catch {
        // A malformed old record may be replaced only after explicit reconciliation.
      }
    }
  }

  const normalized = normalizeWorkspaceLayout(value, safeViewport(options.viewport));
  if (!normalized) return { ok: false, reason: "invalid-layout" };

  let serialized: string;
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    return { ok: false, reason: "invalid-layout" };
  }
  if (serialized.length > MAX_RECORD_LENGTH) {
    return { ok: false, reason: "invalid-layout" };
  }

  try {
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, serialized);
    return { ok: true, key: WORKSPACE_PREFERENCES_STORAGE_KEY };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}
