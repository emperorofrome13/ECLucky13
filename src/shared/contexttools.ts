// Context tools: prompt addenda for RTK, Ponytail, Context7, CodeGraph, Web Search, Skills.

import type { ContextToolLimits } from './settings-schema';

export type ContextToolId = 'rtk' | 'ponytail' | 'context7' | 'codegraph' | 'search' | 'skills';
export type ContextToolAction = 'test' | 'index' | 'refresh';
export interface ContextToolRequest {
  tool: ContextToolId;
  action?: ContextToolAction;
  workspaceId: string;
  apiKey?: string;
  contextTools?: Partial<ContextToolLimits>;
}
export interface ContextToolResponse {
  ok: boolean;
  status?: 'ready' | 'failed' | 'unavailable';
  output?: string;
  error?: string;
  action?: ContextToolAction;
}
export interface IntegrationDetail {
  installed?: boolean;
  status?: 'installed' | 'not-tested' | 'ready' | 'failed' | 'unavailable';
  output?: string;
  error?: string;
  message?: string;
  actions?: ContextToolAction[];
  workspaceId?: string;
}
export interface IntegrationStatus {
  rtk?: boolean;
  ponytail?: boolean;
  context7?: boolean;
  codegraph?: boolean;
  search?: boolean;
  skills?: boolean;
  lmStudio?: boolean;
  browser?: boolean;
  editor?: string;
  note?: string;
  details?: Partial<Record<ContextToolId, IntegrationDetail>>;
}

export interface ContextToolConfig extends Partial<ContextToolLimits> {
  rtk: boolean;
  ponytail: boolean;
  context7: boolean;
  codegraph: boolean;
  search: boolean;
  skills: boolean;
  context7ApiKey: string;
}

export function contextToolPrompts(ctx?: Partial<ContextToolConfig>): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.ponytail) parts.push('PONYTAIL MCP is ON: call ponytail_instructions before planning or editing to retrieve the official Ponytail ruleset. Use mode lite, full, or ultra; default to full.');
  if (ctx.rtk) parts.push('RTK is ON: before shell_command executes, the harness asks `rtk rewrite` for a token-saving equivalent. Unsupported commands and missing RTK run unchanged.');
  if (ctx.context7) parts.push('CONTEXT7 is ON: before using an external library or API, call context7_docs with the library name and your question to get current, version-specific docs. Do not guess APIs from memory.');
  if (ctx.codegraph) parts.push('CODEGRAPH MCP is ON: call codegraph_explore with a concrete architecture, caller, callee, impact, or definition question before broad text searches. This uses the official semantic graph.');
  if (ctx.search) parts.push('WEB SEARCH is ON: call web_search for current information (versions, error messages, recent changes) that may be newer than your training data.');
  if (!parts.length) return '';
  return '\n\n=== ENABLED CONTEXT TOOLS ===\n' + parts.join('\n\n');
}
