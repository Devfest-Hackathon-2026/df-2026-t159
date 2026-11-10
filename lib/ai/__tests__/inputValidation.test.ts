import { describe, expect, it } from "vitest";
import { AiApiError } from "../errors";
import {
  MAX_IMAGE_BYTES,
  MAX_MEMO_CHARS,
  validateStructureInput,
  type StructureImageInput,
} from "../inputValidation";

function image(overrides: Partial<StructureImageInput> = {}): StructureImageInput {
  return {
    mimeType: "image/jpeg",
    byteLength: 1024,
    dataBase64: "AAAA",
    ...overrides,
  };
}

function expectApiError(fn: () => void, status: number, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AiApiError);
    const apiError = error as AiApiError;
    expect(apiError.status).toBe(status);
    expect(apiError.code).toBe(code);
    return;
  }
  throw new Error("AiApiError が throw されませんでした");
}

describe("validateStructureInput", () => {
  it("画像なし・メモのみは通る", () => {
    expect(() =>
      validateStructureInput({ memo: "父は来週退院予定", images: [] }),
    ).not.toThrow();
  });

  it("画像2枚・ちょうど5MBは通る", () => {
    expect(() =>
      validateStructureInput({
        memo: "",
        images: [image({ byteLength: MAX_IMAGE_BYTES }), image()],
      }),
    ).not.toThrow();
  });

  it("画像が3枚だと 413", () => {
    expectApiError(
      () =>
        validateStructureInput({
          memo: "",
          images: [image(), image(), image()],
        }),
      413,
      "too_many_images",
    );
  });

  it("画像が5MBを超えると 413", () => {
    expectApiError(
      () =>
        validateStructureInput({
          memo: "",
          images: [image({ byteLength: MAX_IMAGE_BYTES + 1 })],
        }),
      413,
      "image_too_large",
    );
  });

  it("対応外の MIME タイプは 400", () => {
    expectApiError(
      () =>
        validateStructureInput({
          memo: "",
          images: [image({ mimeType: "application/pdf" })],
        }),
      400,
      "unsupported_image_type",
    );
  });

  it("メモがちょうど4,000字は通る", () => {
    expect(() =>
      validateStructureInput({ memo: "あ".repeat(MAX_MEMO_CHARS), images: [] }),
    ).not.toThrow();
  });

  it("メモが4,001字だと 413", () => {
    expectApiError(
      () =>
        validateStructureInput({
          memo: "あ".repeat(MAX_MEMO_CHARS + 1),
          images: [],
        }),
      413,
      "memo_too_long",
    );
  });
});
