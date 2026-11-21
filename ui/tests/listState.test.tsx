import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { countLabel, emptyListMessage } from "../src/lib/listState";
import { useResourceList } from "../src/hooks/useResourceList";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("emptyListMessage: Loading first, then the error, only then 'none'", () => {
  const base = { noun: "tags", none: "No tags yet." };

  it("says Loading while loading, even with an error or a search", () => {
    expect(emptyListMessage({ ...base, loading: true, error: "boom", search: "x" })).toBe("Loading tags...");
  });

  it("shows the error before any 'none' claim", () => {
    expect(emptyListMessage({ ...base, loading: false, error: "boom" })).toBe("boom");
  });

  it("distinguishes no match from none", () => {
    expect(emptyListMessage({ ...base, loading: false, search: " x " })).toBe("No tags match your search.");
    expect(emptyListMessage({ ...base, loading: false, search: "  " })).toBe("No tags yet.");
    expect(emptyListMessage({ ...base, loading: false, search: "x", noMatch: "Nothing." })).toBe("Nothing.");
  });
});

describe("countLabel", () => {
  it("reads Loading while loading, else a pluralised count", () => {
    expect(countLabel(true, 3, "tag")).toBe("Loading…");
    expect(countLabel(false, 1, "tag")).toBe("1 tag");
    expect(countLabel(false, 0, "tag")).toBe("0 tags");
    expect(countLabel(false, 2, "category", "categories")).toBe("2 categories");
  });
});

describe("useResourceList", () => {
  it("starts as loading, so a list is never empty before its first answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[1,2]", { status: 200 }));
    const { result } = renderHook(() => useResourceList<number>({ url: "/api/x" }));
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([1, 2]);
  });

  it("loads with a fetcher function and reports its error text", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(""));
    const { result } = renderHook(() => useResourceList<number>({ fetcher, onError: "Could not load." }));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.error).toBe("Could not load.");
    expect(result.current.loading).toBe(false);
  });

  it("ignores a slow older answer that arrives after a newer one", async () => {
    const answers: Array<(v: number[]) => void> = [];
    const fetcher = () => new Promise<number[]>((resolve) => answers.push(resolve));
    const { result } = renderHook(() => useResourceList<number>({ fetcher }));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.load();
      second = result.current.load();
    });
    await act(async () => {
      answers[1]([2]);
      await second;
    });
    expect(result.current.items).toEqual([2]);
    await act(async () => {
      answers[0]([1]);
      await first;
    });
    expect(result.current.items).toEqual([2]);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("a background refresh that supersedes a foreground load still clears loading", async () => {
    const answers: Array<(v: number[]) => void> = [];
    const fetcher = () => new Promise<number[]>((resolve) => answers.push(resolve));
    const { result } = renderHook(() => useResourceList<number>({ fetcher }));
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.load();
      b = result.current.load({ background: true });
    });
    await act(async () => {
      answers[1]([7]);
      await b;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([7]);
    await act(async () => {
      answers[0]([]);
      await a;
    });
    expect(result.current.items).toEqual([7]);
  });
});
