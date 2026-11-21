import { describe, expect, it } from "vitest";
import {
  WORKSPACE_PREFERENCES_STORAGE_KEY,
  LEGACY_WORKSPACE_STORAGE_KEYS,
  WORKSPACE_KINDS,
  createDefaultWorkspaceLayout,
  loadWorkspacePreferences,
  normalizeWorkspaceLayout,
  saveWorkspacePreferences,
  type WorkspacePreferencesStorage,
} from "../src/app/workspacePreferences";

const VIEWPORT = { width: 1280, height: 800 };
const FIXED_DATE = "2026-11-20T12:00:00.000Z";

class MemoryStorage implements WorkspacePreferencesStorage {
  constructor(readonly values: Map<string, string> = new Map<string, string>()) {}

  throwOnGet = false;
  throwOnSet = false;

  getItem(key: string): string | null {
    if (this.throwOnGet) throw new Error("blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error("quota");
    this.values.set(key, value);
  }
}

function makeLayout() {
  return createDefaultWorkspaceLayout(VIEWPORT, FIXED_DATE);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Workspace Preferences V1 defaults and storage", () => {
  it("round-trips a valid V1 layout through the versioned storage key", () => {
    const storage = new MemoryStorage();
    const layout = makeLayout();
    layout.windows[1].visibility = "open";
    layout.windows[1].stackOrder = 1;
    layout.stackOrder = [
      layout.windows[0].windowInstanceId,
      layout.windows[1].windowInstanceId,
    ];
    layout.activeWindowInstanceId = layout.windows[1].windowInstanceId;
    layout.activeWorkspace = "component-canvas";

    expect(saveWorkspacePreferences(layout, {
      storage,
      viewport: VIEWPORT,
      reconciliationComplete: true,
    })).toEqual({ ok: true, key: WORKSPACE_PREFERENCES_STORAGE_KEY });

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(loaded.status).toBe("valid");
    expect(loaded.layout).toEqual(layout);
  });

  it("uses last successful cross-tab write to replace the complete snapshot, independent of updatedAt", () => {
    const sharedValues = new Map<string, string>();
    const firstTabStorage = new MemoryStorage(sharedValues);
    const secondTabStorage = new MemoryStorage(sharedValues);

    const firstTabLayout = makeLayout();
    firstTabLayout.updatedAt = "2026-11-20T12:05:00.000Z";
    firstTabLayout.windows[1].visibility = "open";
    firstTabLayout.windows[1].stackOrder = 1;
    firstTabLayout.stackOrder = [
      firstTabLayout.windows[0].windowInstanceId,
      firstTabLayout.windows[1].windowInstanceId,
    ];
    firstTabLayout.activeWindowInstanceId = firstTabLayout.windows[1].windowInstanceId;
    firstTabLayout.activeWorkspace = "component-canvas";
    firstTabLayout.panelVisibility["pages-rack"] = true;

    expect(saveWorkspacePreferences(firstTabLayout, {
      storage: firstTabStorage,
      viewport: VIEWPORT,
      reconciliationComplete: true,
    }).ok).toBe(true);

    // This snapshot has an older updatedAt, but it is written successfully later.
    const secondTabLayout = makeLayout();
    secondTabLayout.panelVisibility["component-rack"] = true;
    secondTabLayout.windows[2].visibility = "open";
    secondTabLayout.windows[2].stackOrder = 1;
    secondTabLayout.stackOrder = [
      secondTabLayout.windows[0].windowInstanceId,
      secondTabLayout.windows[2].windowInstanceId,
    ];
    secondTabLayout.activeWindowInstanceId = secondTabLayout.windows[2].windowInstanceId;
    secondTabLayout.activeWorkspace = "node-logic";

    expect(saveWorkspacePreferences(secondTabLayout, {
      storage: secondTabStorage,
      viewport: VIEWPORT,
      reconciliationComplete: true,
    }).ok).toBe(true);

    const expectedSnapshot = normalizeWorkspaceLayout(secondTabLayout, VIEWPORT);
    const storedSnapshot = JSON.parse(
      sharedValues.get(WORKSPACE_PREFERENCES_STORAGE_KEY) ?? "null",
    );
    expect(storedSnapshot).toEqual(expectedSnapshot);
    expect(storedSnapshot.updatedAt).toBe(FIXED_DATE);
    expect(storedSnapshot.panelVisibility["pages-rack"]).toBe(false);
    expect(storedSnapshot.panelVisibility["component-rack"]).toBe(true);
    expect(storedSnapshot.windows).toHaveLength(WORKSPACE_KINDS.length);
    expect(storedSnapshot.windows.find((record: { workspace: string }) =>
      record.workspace === "component-canvas").visibility).toBe("closed");
    expect(storedSnapshot.windows.find((record: { workspace: string }) =>
      record.workspace === "node-logic").visibility).toBe("open");

    const reloaded = loadWorkspacePreferences({
      storage: firstTabStorage,
      viewport: VIEWPORT,
      now: FIXED_DATE,
    });
    expect(reloaded.status).toBe("valid");
    expect(reloaded.layout).toEqual(expectedSnapshot);
  });

  it("returns safe defaults when the versioned record is missing", () => {
    const loaded = loadWorkspacePreferences({
      storage: new MemoryStorage(),
      viewport: VIEWPORT,
      now: FIXED_DATE,
    });
    expect(loaded.status).toBe("missing");
    expect(loaded.requiresReconciliation).toBe(true);
    expect(loaded.layout.schemaVersion).toBe(1);
    expect(loaded.layout.windows.map((record) => record.workspace)).toEqual(WORKSPACE_KINDS);
    expect(loaded.layout.activeWorkspace).toBe("main-canvas");
    expect(loaded.layout.windows.every((record) => record.maximized === false)).toBe(true);
  });

  it("uses a dedicated versioned localStorage key", () => {
    expect(WORKSPACE_PREFERENCES_STORAGE_KEY).toBe("folio.workspace-layout.v1");
  });

  it("does not write normalized defaults during loading", () => {
    const storage = new MemoryStorage();
    loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(storage.values.size).toBe(0);
  });
});

describe("Workspace Preferences V1 validation and recovery", () => {
  it("falls back safely for malformed JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, "{not-json");
    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(loaded.status).toBe("malformed");
    expect(loaded.layout).toEqual(makeLayout());
  });

  it("rejects an invalid schema version and invalid required root field types", () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      ...makeLayout(),
      schemaVersion: 0,
    }));
    expect(loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE }).status)
      .toBe("malformed");

    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      ...makeLayout(),
      panelVisibility: [],
    }));
    expect(loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE }).status)
      .toBe("malformed");
  });

  it("refuses to overwrite an existing record larger than 64 KiB by default", () => {
    const storage = new MemoryStorage();
    const largeExisting = JSON.stringify(makeLayout()) + " ".repeat(70 * 1024);
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, largeExisting);

    const saved = saveWorkspacePreferences(makeLayout(), {
      storage,
      reconciliationComplete: true,
    });

    expect(saved).toEqual({ ok: false, reason: "existing-record-too-large" });
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe(largeExisting);
  });

  it("allows an oversized existing record to be replaced only with explicit override", () => {
    const storage = new MemoryStorage();
    const largeExisting = JSON.stringify(makeLayout()) + " ".repeat(70 * 1024);
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, largeExisting);

    const saved = saveWorkspacePreferences(makeLayout(), {
      storage,
      reconciliationComplete: true,
      replaceUnsupportedVersion: true,
    });

    expect(saved.ok).toBe(true);
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).not.toBe(largeExisting);
    expect(JSON.parse(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY) ?? "{}").schemaVersion)
      .toBe(1);
  });

  it("refuses to overwrite existing JSON that cannot be safely inspected", () => {
    const storage = new MemoryStorage();
    const unreadable = "{broken-existing-json";
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, unreadable);

    const saved = saveWorkspacePreferences(makeLayout(), {
      storage,
      reconciliationComplete: true,
    });

    expect(saved).toEqual({ ok: false, reason: "existing-record-unreadable" });
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe(unreadable);
  });

  it("does not overwrite or downgrade an unsupported newer schema", () => {
    const storage = new MemoryStorage();
    const newer = JSON.stringify({ schemaVersion: 2, futureField: true });
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, newer);
    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(loaded.status).toBe("unsupported-newer-schema");
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe(newer);

    expect(saveWorkspacePreferences(makeLayout(), {
      storage,
      reconciliationComplete: true,
    })).toEqual({ ok: false, reason: "unsupported-newer-schema" });
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe(newer);
  });

  it("drops unknown future workspace kinds without breaking the current layout", () => {
    const layout = makeLayout() as unknown as { windows: Array<Record<string, unknown>>; stackOrder: string[] };
    layout.windows.push({
      ...layout.windows[0],
      workspace: "future-workspace",
      windowInstanceId: "future-window",
    });
    layout.stackOrder.push("future-window");
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    expect(normalized).not.toBeNull();
    expect(normalized?.windows.map((record) => record.workspace)).toEqual(WORKSPACE_KINDS);
    expect(normalized?.stackOrder).not.toContain("future-window");
  });

  it("drops duplicate window IDs and duplicate workspace instances", () => {
    const layout = makeLayout();
    layout.windows.push({
      ...clone(layout.windows[0]),
      windowInstanceId: "duplicate-main",
    });
    layout.windows.push({
      ...clone(layout.windows[1]),
      workspace: "main-canvas",
      windowInstanceId: "second-main",
    });
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    expect(normalized?.windows.filter((record) => record.workspace === "main-canvas")).toHaveLength(1);
    expect(normalized?.windows.map((record) => record.windowInstanceId)).not.toContain("duplicate-main");
    expect(normalized?.windows.map((record) => record.windowInstanceId)).not.toContain("second-main");
  });

  it("rejects invalid visibility, presentation, and maximize values", () => {
    const layout = makeLayout() as unknown as { windows: Array<Record<string, unknown>>; stackOrder: string[] };
    layout.windows[0].visibility = "hidden";
    layout.windows[1].presentation = "fullscreen";
    layout.windows[2].maximized = true;
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    expect(normalized?.windows[0].visibility).toBe("open");
    expect(normalized?.windows[1].presentation).toBe("floating");
    expect(normalized?.windows[2].maximized).toBe(false);
  });

  it("clamps oversized positive geometry to the current viewport", () => {
    const layout = makeLayout();
    layout.windows[0].geometry = { x: 900, y: 900, width: 5000, height: 5000 };
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    const geometry = normalized?.windows[0].geometry;
    expect(geometry?.x).toBeGreaterThanOrEqual(0);
    expect(geometry?.y).toBeGreaterThanOrEqual(56);
    expect((geometry?.x ?? 0) + (geometry?.width ?? 0)).toBeLessThanOrEqual(VIEWPORT.width);
    expect((geometry?.y ?? 0) + (geometry?.height ?? 0)).toBeLessThanOrEqual(VIEWPORT.height - 27);
  });

  it("recovers negative, zero, non-finite, and unsupported geometry from defaults", () => {
    const cases = [
      { x: 0, y: 0, width: -10, height: 300 },
      { x: 0, y: 0, width: 0, height: 300 },
      { x: 0, y: 0, width: 300, height: 0 },
      { x: Number.NaN, y: 0, width: 300, height: 300 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 300, height: 300 },
      { x: 0, y: 0, width: Number.NEGATIVE_INFINITY, height: 300 },
      { x: 0, y: 0, width: 300, height: Number.NaN },
      { x: 2_000_000, y: 0, width: 300, height: 300 },
    ];
    for (const geometry of cases) {
      const layout = makeLayout();
      layout.windows[0].geometry = geometry;
      const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
      expect(normalized?.windows[0].geometry).toEqual(makeLayout().windows[0].geometry);
    }
  });

  it("rebuilds invalid stack order and repairs a missing or closed active window", () => {
    const layout = makeLayout();
    layout.windows[1].visibility = "open";
    layout.stackOrder = ["missing-window", layout.windows[0].windowInstanceId, "missing-window"];
    layout.activeWindowInstanceId = "missing-window";
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    expect(normalized?.stackOrder).toEqual([
      layout.windows[0].windowInstanceId,
      layout.windows[1].windowInstanceId,
    ]);
    expect(normalized?.activeWindowInstanceId).toBe(layout.windows[1].windowInstanceId);
    expect(normalized?.activeWorkspace).toBe("component-canvas");
  });

  it("removes closed and minimized windows from the active stack", () => {
    const layout = makeLayout();
    layout.windows[1].visibility = "minimized";
    layout.windows[2].visibility = "closed";
    layout.stackOrder = layout.windows.map((record) => record.windowInstanceId);
    layout.activeWindowInstanceId = layout.windows[1].windowInstanceId;
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    expect(normalized?.stackOrder).toEqual([layout.windows[0].windowInstanceId]);
    expect(normalized?.activeWindowInstanceId).toBe(layout.windows[0].windowInstanceId);
    expect(normalized?.stackOrder).not.toContain(layout.windows[1].windowInstanceId);
    expect(normalized?.stackOrder).not.toContain(layout.windows[2].windowInstanceId);
  });

  it("clamps negative positions without retaining an off-screen rectangle", () => {
    const layout = makeLayout();
    layout.windows[0].geometry = { x: -800, y: -100, width: 600, height: 400 };
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    expect(normalized?.windows[0].geometry.x).toBe(0);
    expect(normalized?.windows[0].geometry.y).toBeGreaterThanOrEqual(56);
  });
});

describe("Workspace V1 recovery reporting", () => {
  it("marks an empty windows array as recovered and requiring reconciliation", () => {
    const storage = new MemoryStorage();
    const damaged = {
      ...makeLayout(),
      windows: [],
      stackOrder: [],
      activeWindowInstanceId: null,
    };
    const original = JSON.stringify(damaged);
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, original);

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });

    expect(loaded.status).toBe("recovered");
    expect(loaded.requiresReconciliation).toBe(true);
    expect(loaded.warnings.some((warning) => warning.includes("Missing workspace window record")))
      .toBe(true);
    expect(loaded.layout.windows).toHaveLength(WORKSPACE_KINDS.length);
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe(original);
  });

  it("reports an invalid window record that was dropped and replaced", () => {
    const storage = new MemoryStorage();
    const damaged = JSON.parse(JSON.stringify(makeLayout())) as {
      windows: Array<Record<string, unknown>>;
    };
    damaged.windows[0].visibility = "unknown-visibility";
    const original = JSON.stringify(damaged);
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, original);

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });

    expect(loaded.status).toBe("recovered");
    expect(loaded.requiresReconciliation).toBe(true);
    expect(loaded.warnings.some((warning) => warning.includes("Dropped window record")))
      .toBe(true);
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe(original);
  });

  it("reports a missing known workspace kind and restores its default record", () => {
    const storage = new MemoryStorage();
    const layout = makeLayout();
    const damaged = {
      ...layout,
      windows: layout.windows.filter((record) => record.workspace !== "component-canvas"),
    };
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(damaged));

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });

    expect(loaded.status).toBe("recovered");
    expect(loaded.requiresReconciliation).toBe(true);
    expect(loaded.warnings).toContain(
      "Missing workspace window record for component-canvas; safe defaults were restored",
    );
    expect(loaded.layout.windows.find((record) => record.workspace === "component-canvas"))
      .toBeDefined();
  });

  it("reports invalid geometry replaced by the workspace safe default", () => {
    const storage = new MemoryStorage();
    const damaged = JSON.parse(JSON.stringify(makeLayout())) as {
      windows: Array<{ geometry: Record<string, unknown> }>;
    };
    damaged.windows[0].geometry.width = -10;
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(damaged));

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });

    expect(loaded.status).toBe("recovered");
    expect(loaded.requiresReconciliation).toBe(true);
    expect(loaded.warnings).toContain(
      "Invalid geometry for main-canvas was replaced with safe defaults",
    );
    expect(loaded.layout.windows[0].geometry).toEqual(makeLayout().windows[0].geometry);
  });

  it("reports viewport geometry clamping while preserving the recoverable rectangle", () => {
    const storage = new MemoryStorage();
    const damaged = JSON.parse(JSON.stringify(makeLayout())) as {
      windows: Array<{ geometry: Record<string, unknown> }>;
    };
    damaged.windows[0].geometry.x = -100;
    damaged.windows[0].geometry.y = -100;
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(damaged));

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });

    expect(loaded.status).toBe("recovered");
    expect(loaded.warnings).toContain(
      "Geometry for main-canvas was clamped to the current viewport",
    );
    expect(loaded.layout.windows[0].geometry.x).toBe(0);
    expect(loaded.layout.windows[0].geometry.y).toBeGreaterThanOrEqual(56);
  });

  it("keeps an intact V1 record valid with no recovery warnings", () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(makeLayout()));

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });

    expect(loaded.status).toBe("valid");
    expect(loaded.requiresReconciliation).toBe(false);
    expect(loaded.warnings).toEqual([]);
  });

  it("does not persist a recovered layout during load", () => {
    const storage = new MemoryStorage();
    const damaged = { ...makeLayout(), windows: [] };
    const original = JSON.stringify(damaged);
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, original);

    loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });

    expect(storage.values.size).toBe(1);
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe(original);
  });
});

describe("Workspace legacy localStorage migration", () => {
  it("migrates all three legacy {mode, position, size} records without deleting them", () => {
    const storage = new MemoryStorage();
    const legacyRecords = {
      "main-canvas": { mode: "floating", position: { x: 20, y: 80 }, size: { width: 700, height: 500 } },
      "component-canvas": { mode: "docked", position: { x: 90, y: 100 }, size: { width: 500, height: 360 } },
      "node-logic": { mode: "floating", position: { x: 150, y: 120 }, size: { width: 620, height: 420 } },
    };
    for (const workspace of WORKSPACE_KINDS) {
      storage.setItem(
        LEGACY_WORKSPACE_STORAGE_KEYS[workspace],
        JSON.stringify(legacyRecords[workspace]),
      );
    }

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(loaded.status).toBe("migrated");
    expect(loaded.requiresReconciliation).toBe(true);
    expect(loaded.warnings).toEqual([]);
    for (const workspace of WORKSPACE_KINDS) {
      expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEYS[workspace])).not.toBeNull();
      expect(loaded.layout.windows.find((record) => record.workspace === workspace)?.presentation)
        .toBe(legacyRecords[workspace].mode);
    }
    expect(loaded.layout.windows.find((record) => record.workspace === "main-canvas")?.visibility)
      .toBe("open");
    expect(loaded.layout.windows.find((record) => record.workspace === "component-canvas")?.visibility)
      .toBe("closed");
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it("warns when valid legacy geometry is clamped but keeps the result classified as migrated", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_WORKSPACE_STORAGE_KEYS["main-canvas"],
      JSON.stringify({
        mode: "floating",
        position: { x: -100, y: -100 },
        size: { width: 700, height: 500 },
      }),
    );

    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    const mainCanvas = loaded.layout.windows.find((record) => record.workspace === "main-canvas");

    expect(loaded.status).toBe("migrated");
    expect(loaded.requiresReconciliation).toBe(true);
    expect(loaded.warnings).toEqual([
      "Geometry for main-canvas was clamped to the current viewport",
    ]);
    expect(mainCanvas?.geometry.x).toBe(0);
    expect(mainCanvas?.geometry.y).toBeGreaterThanOrEqual(56);
    expect(mainCanvas?.geometry.width).toBe(700);
    expect(mainCanvas?.geometry.height).toBe(500);
  });

  it("recovers with defaults when a legacy entry is malformed", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEYS["main-canvas"], "broken");
    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(loaded.status).toBe("malformed");
    expect(loaded.layout).toEqual(makeLayout());
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEYS["main-canvas"])).toBe("broken");
  });
});

describe("Workspace storage failure isolation", () => {
  it("returns defaults when localStorage getItem throws", () => {
    const storage = new MemoryStorage();
    storage.throwOnGet = true;
    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(loaded.status).toBe("storage-unavailable");
    expect(loaded.layout).toEqual(makeLayout());
  });

  it("returns a write failure when localStorage setItem throws", () => {
    const storage = new MemoryStorage();
    storage.throwOnSet = true;
    const saved = saveWorkspacePreferences(makeLayout(), {
      storage,
      reconciliationComplete: true,
      viewport: VIEWPORT,
    });
    expect(saved).toEqual({ ok: false, reason: "write-failed" });
  });

  it("rejects invalid saves without writing", () => {
    const storage = new MemoryStorage();
    const invalid = makeLayout();
    invalid.windows[0].geometry.width = -1;
    const saved = saveWorkspacePreferences(invalid, {
      storage,
      reconciliationComplete: true,
    });
    expect(saved).toEqual({ ok: false, reason: "invalid-layout" });
    expect(storage.values.size).toBe(0);
  });

  it("requires explicit reconciliation confirmation before saving", () => {
    const storage = new MemoryStorage();
    expect(saveWorkspacePreferences(makeLayout(), { storage }))
      .toEqual({ ok: false, reason: "reconciliation-not-confirmed" });
    expect(storage.values.size).toBe(0);
  });

  it("does not mutate caller-owned objects during normalization or save", () => {
    const storage = new MemoryStorage();
    const layout = makeLayout();
    const before = JSON.stringify(layout);
    normalizeWorkspaceLayout(layout, VIEWPORT);
    saveWorkspacePreferences(layout, {
      storage,
      reconciliationComplete: true,
      viewport: VIEWPORT,
    });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it("can explicitly replace a newer schema only with the explicit override", () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({ schemaVersion: 3 }));
    const saved = saveWorkspacePreferences(makeLayout(), {
      storage,
      reconciliationComplete: true,
      replaceUnsupportedVersion: true,
    });
    expect(saved.ok).toBe(true);
    expect(JSON.parse(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY) ?? "{}").schemaVersion)
      .toBe(1);
  });
});

describe("Workspace adapter isolation boundaries", () => {
  it("runs with an injected storage interface and no browser globals", () => {
    const storage = new MemoryStorage();
    const loaded = loadWorkspacePreferences({ storage, viewport: VIEWPORT, now: FIXED_DATE });
    expect(loaded.status).toBe("missing");
    expect(storage.values.size).toBe(0);
  });

  it("accepts only the three currently implemented workspace kinds", () => {
    expect(WORKSPACE_KINDS).toEqual(["main-canvas", "component-canvas", "node-logic"]);
    const layout = makeLayout() as unknown as { activeWorkspace: string };
    layout.activeWorkspace = "future-workspace";
    const normalized = normalizeWorkspaceLayout(layout, VIEWPORT);
    expect(normalized?.activeWorkspace).toBe("main-canvas");
  });
});
