import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocFromServer } from "firebase/firestore";
vi.mock("./firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({ doc: (_db: unknown, path: string) => path, getDocFromServer: vi.fn() }));
import { readSummaryState } from "./summary-store";

const read = vi.mocked(getDocFromServer);
const document = (data: object) => ({ exists: () => true, data: () => data }) as Awaited<ReturnType<typeof getDocFromServer>>;
beforeEach(() => read.mockReset());
describe("確定内容の読み取り", () => {
  it("rootの版・summary・rootの版だけを読み、現在の配置や制約を読まない", async () => {
    read.mockResolvedValueOnce(document({ revision: 3 })).mockResolvedValueOnce(document({ confirmedRevision: 3 })).mockResolvedValueOnce(document({ revision: 3 }));
    expect(await readSummaryState("test")).toEqual({ summary: { confirmedRevision: 3 }, currentRevision: 3 });
    expect(read.mock.calls.map(call => call[0])).toEqual(["rooms/test", "rooms/test/summary/main", "rooms/test"]);
  });
  it("版が途中で変わったら読み直す", async () => {
    for (const data of [{ revision: 3 }, { confirmedRevision: 3 }, { revision: 4 }, { revision: 4 }, { confirmedRevision: 3 }, { revision: 4 }]) read.mockResolvedValueOnce(document(data));
    expect((await readSummaryState("test")).currentRevision).toBe(4);
    expect(read).toHaveBeenCalledTimes(6);
  });
  it("読み取り失敗を『まだ確定していない』という結果に変えない", async () => {
    read.mockResolvedValueOnce(document({ revision: 3 })).mockRejectedValueOnce(new Error("permission-denied"));
    await expect(readSummaryState("test")).rejects.toThrow("permission-denied");
  });
});
