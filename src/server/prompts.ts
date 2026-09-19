// Re-export prompt/instruction + skills helpers (implementation now lives server-side).
export {
  listSkills, readSkill, skillsRoots,
  loadSystemPrompt, loadStagePrompt, loadAgentsDocs, buildAgentsBlock, buildSkillsIndex,
  appRoot, appAutopromptDir, workspaceAutopromptDir, readPrompt, promptSource,
  PROMPT_FILES, DEFAULT_SYSTEM_PROMPT, DEFAULT_STAGE_PROMPTS,
} from './prompt-files';