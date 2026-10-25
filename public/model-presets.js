// Public, credential-free presets. Current pricing is linked from the settings dialog.
export const DEFAULT_PRESET = "xai-budget";
export const MODEL_PRESETS = {
  "xai-budget": { baseUrl: "https://api.x.ai/v1", protocol: "responses", model: "grok-build-0.1", format: "schema", maxOutputTokens: 2500, tokenParameter: "max_tokens", reasoningEffort: "auto" },
  "xai-general": { baseUrl: "https://api.x.ai/v1", protocol: "responses", model: "grok-4.3", format: "schema", maxOutputTokens: 2500, tokenParameter: "max_tokens", reasoningEffort: "none" },
  "xai-lawlens": { baseUrl: "https://api.x.ai/v1", protocol: "chat", model: "grok-4.20-0309-reasoning", format: "schema", maxOutputTokens: 8192, tokenParameter: "max_tokens", reasoningEffort: "auto" }
};
export const RETIRED_XAI_MODELS = ["grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning", "grok-4-fast-reasoning", "grok-4-fast-non-reasoning", "grok-4-0709", "grok-code-fast-1", "grok-3"];
export function isXaiUrl(value) {
  try { return ["api.x.ai", "us.api.x.ai"].includes(new URL(value).hostname); } catch { return false; }
}
export function modelNotice(baseUrl, model) {
  if (!isXaiUrl(baseUrl)) return "自定义服务：请核对地址与模型权限。";
  if (RETIRED_XAI_MODELS.includes(model)) return "旧模型已退休，已阻止调用；请选择新模型 ID。";
  if (model === "grok-build-0.1") return "抽取质量未验证；推理参数请保留服务商默认。";
  if (model === "grok-4.3") return "Grok 4.3：预设关闭推理。";
  if (model === "grok-4.20-0309-reasoning") return "LawLens 对照：Chat，输出上限 8,192 Token。";
  return "自定义模型：可获取模型列表确认权限。";
}
