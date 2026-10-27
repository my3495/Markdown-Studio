/**
 * 将 VaultTools 转为 OpenAI/Ollama 或 Anthropic 的 function-calling 工具声明。
 */

import { toolDescriptors } from '../mcp/protocol';
import type { VaultTools } from './tools';

export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: unknown;
}

export function toOpenAITools(tools: VaultTools): OpenAITool[] {
  return toolDescriptors(tools.manifest()).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export function toAnthropicTools(tools: VaultTools): AnthropicTool[] {
  return toolDescriptors(tools.manifest()).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}
