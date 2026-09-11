import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_ZAI_TEXT_MODEL_ID,
  resolveZaiSecondaryTextBillingModel,
  resolveZaiTextBillingModel,
} from "@/lib/zai-billing-models";

const originalChatModel = process.env.ZAI_CHAT_MODEL;

afterEach(() => {
  if (originalChatModel === undefined) delete process.env.ZAI_CHAT_MODEL;
  else process.env.ZAI_CHAT_MODEL = originalChatModel;
});

describe("secondary Z.ai text billing model", () => {
  test("ignores an unrelated primary chat-model override", () => {
    process.env.ZAI_CHAT_MODEL = "glm-4-plus";

    expect(resolveZaiTextBillingModel()).toBe("glm-4-plus");
    expect(resolveZaiSecondaryTextBillingModel()).toBe(DEFAULT_ZAI_TEXT_MODEL_ID);
    expect(resolveZaiSecondaryTextBillingModel()).toBe("glm-4.7");
  });

  test("preserves an explicit requested model so Billing v2 can fail closed", () => {
    process.env.ZAI_CHAT_MODEL = "glm-4-plus";

    expect(resolveZaiSecondaryTextBillingModel("glm-explicit-test")).toBe("glm-explicit-test");
  });
});
