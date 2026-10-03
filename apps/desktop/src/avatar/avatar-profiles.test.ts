import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarService } from "@avatar-os/runtime";
import {
  attachAvatarPersistence,
  createLocalAvatarStorage,
  IN_MEMORY_AVATAR_STORAGE,
  DEFAULT_AVATAR_ID,
  type AvatarStorageAdapter,
} from "./avatar-profiles";

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avatar persistence (Phase C)", () => {
  it("falls back to in-memory storage when localStorage is unavailable", () => {
    expect(createLocalAvatarStorage()).toBe(IN_MEMORY_AVATAR_STORAGE);
  });

  it("saves and loads the active id via localStorage", () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: ls });
    const storage = createLocalAvatarStorage("k");
    storage.save("void-vrm");
    expect(ls.map.get("k")).toBe("void-vrm");
    expect(storage.load()).toBe("void-vrm");
  });

  it("migrates legacy bodies and ignores unknown ids on restore", () => {
    const mk = (id: string | undefined): AvatarStorageAdapter => ({ load: () => id, save: () => {} });

    const legacy = new AvatarService(DEFAULT_AVATAR_ID);
    attachAvatarPersistence(legacy, mk("bag-character"));
    expect(legacy.getActiveId()).toBe("void-vrm");

    const unknown = new AvatarService(DEFAULT_AVATAR_ID);
    attachAvatarPersistence(unknown, mk("deleted-body"));
    expect(unknown.getActiveId()).toBe(DEFAULT_AVATAR_ID);
  });

  it("writes back on activate", () => {
    const saved: string[] = [];
    const svc = new AvatarService(DEFAULT_AVATAR_ID);
    attachAvatarPersistence(svc, { load: () => undefined, save: (id) => saved.push(id) });
    svc.activate("fantasy-warrior");
    expect(saved).toContain("fantasy-warrior");
  });
});
