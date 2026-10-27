/**
 * R5 系列——「伪工具调用」识别与提示。
 *
 * 背景：小参数模型（如 qwen2.5:1.5b）偶发不走 tool_calls 协议，而把
 * `{"name":"search","arguments":{...}}` 当正文输出，用户会看到原始 JSON。
 * 修复：runToolAgent 在最终答复处识别该形态，产出 notice(code='badToolFormat')，
 * 由 UI 提示「模型未按工具协议输出，可重试」。
 */

import { describe, it, expect } from 'vitest';
import { looksLikeToolCallJson, runToolAgent } from '../../src/agent/fc';
import { createVaultTools } from '../../src/agent/tools';
import {
  collectToolAgent,
  jsonFetchMock,
  linesBody,
  openaiTextResponse,
  seedVault,
  sse,
  streamFetchMock,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };
const tools = () => createVaultTools(seedVault());

const PSEUDO = '{"name":"search","arguments":{"query":"苹果"}}';

describe('R5-01 looksLikeToolCallJson 识别规则', () => {
  it('R5-01a 标准伪工具调用被识别', () => {
    expect(looksLikeToolCallJson(PSEUDO)).toBe(true);
  });

  it('R5-01b function/parameters 与 tool/args 变体被识别', () => {
    expect(looksLikeToolCallJson('{"function":"search","parameters":{"query":"x"}}')).toBe(true);
    expect(looksLikeToolCallJson('{"tool":"search","args":{"query":"x"}}')).toBe(true);
  });

  it('R5-01c 普通 JSON（无 name/参数）不误判', () => {
    expect(looksLikeToolCallJson('{"a":1,"b":2}')).toBe(false);
    expect(looksLikeToolCallJson('{"name":"张三"}')).toBe(false);
  });

  it('R5-01d 自然语言中出现的 JSON 片段不误判', () => {
    expect(looksLikeToolCallJson(`请把 ${PSEUDO} 当作示例说明`)).toBe(false);
  });

  it('R5-01e 非法 JSON 不误判', () => {
    expect(looksLikeToolCallJson('{name: search}')).toBe(false);
    expect(looksLikeToolCallJson('')).toBe(false);
    expect(looksLikeToolCallJson(null)).toBe(false);
  });

  it('R5-01f 超长文本（>2000 字符）直接跳过解析', () => {
    const long = `{"name":"search","arguments":{"query":"${'x'.repeat(3000)}"}}`;
    expect(looksLikeToolCallJson(long)).toBe(false);
  });
});

describe('R5-02 runToolAgent 产出 badToolFormat 提示', () => {
  it('R5-02a 非流式：伪工具调用 → notice + 正文 + done', async () => {
    const { fetch } = jsonFetchMock(() => openaiTextResponse(PSEUDO));
    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: '搜索苹果', fetchImpl: fetch })
    );
    const notice = events.find((e) => e.type === 'notice');
    expect(notice).toMatchObject({ type: 'notice', code: 'badToolFormat' });
    // 正文仍原样输出（不改写模型内容），notice 只是附加提示
    expect(text).toBe(PSEUDO);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('R5-02b 非流式：正常回答不产 notice（不误伤）', async () => {
    const { fetch } = jsonFetchMock(() => openaiTextResponse('苹果笔记在 Alpha.md。'));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: '搜索苹果', fetchImpl: fetch })
    );
    expect(events.some((e) => e.type === 'notice')).toBe(false);
  });

  it('R5-02c 非流式：JSON 但非工具形态不产 notice', async () => {
    const { fetch } = jsonFetchMock(() => openaiTextResponse('{"答案":"Alpha.md"}'));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch })
    );
    expect(events.some((e) => e.type === 'notice')).toBe(false);
  });

  it('R5-02d 流式：跨 delta 拼出的伪调用同样能识别', async () => {
    const half1 = '{"name":"sea';
    const half2 = 'rch","arguments":{"query":"苹果"}}';
    const { fetch } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(
        sse([
          JSON.stringify({ choices: [{ delta: { content: half1 } }] }),
          JSON.stringify({ choices: [{ delta: { content: half2 } }] }),
        ])
      ),
    }));
    const { events, text } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: '搜索苹果',
        fetchImpl: fetch,
        streamFetch: fetch,
        streamFinal: true,
      })
    );
    expect(text).toBe(PSEUDO);
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ code: 'badToolFormat' });
  });

  it('R5-02e 流式：正常文本不产 notice（不误伤）', async () => {
    const { fetch } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(
        sse([JSON.stringify({ choices: [{ delta: { content: '苹果笔记在 Alpha.md。' } }] })])
      ),
    }));
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: fetch,
        streamFetch: fetch,
        streamFinal: true,
      })
    );
    expect(events.some((e) => e.type === 'notice')).toBe(false);
  });
});
