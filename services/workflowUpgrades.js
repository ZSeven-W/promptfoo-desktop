export function listWorkflowUpgrades() {
  return {
    reviewed_at: '2026-05-08',
    upstream: {
      package: 'promptfoo',
      version: '0.121.11',
      version_checked_via: 'npm view promptfoo version',
    },
    upgrades: [
      {
        id: 'code-scanning',
        title: 'Code scanning rollout',
        status: 'ready-now',
        released: '2025-11',
        why: 'Promptfoo code scanning now documents GitHub Action, CLI, and VS Code workflows while tracing prompt injection, PII exposure, and excessive agency across the wider codebase.',
        desktopUpgrade: 'Keep the rollout card in the dashboard so desktop users can adopt PR scanning without hunting through release notes.',
        highlights: [
          'GitHub Action posts review comments on pull requests',
          'CLI flow: promptfoo auth login + promptfoo code-scans run',
          'Severity levels and custom guidance let teams tune findings for local repo context',
        ],
        commands: [
          'npm install -g promptfoo',
          'promptfoo auth login',
          'promptfoo code-scans run',
        ],
        sources: [
          'https://www.promptfoo.dev/docs/code-scanning/',
          'https://www.promptfoo.dev/docs/code-scanning/cli/',
          'https://www.promptfoo.dev/docs/releases/',
        ],
      },
      {
        id: 'hydra-redteam',
        title: 'Hydra multi-turn red teaming',
        status: 'already-shipped',
        released: '2025-11',
        why: 'Recent Promptfoo releases added Hydra as an advanced multi-turn jailbreak strategy for branching conversations.',
        desktopUpgrade: 'Keep highlighting the existing desktop strategy picker because this capability is now a core workflow, not a niche add-on.',
        highlights: [
          'Hydra is called out in Promptfoo release notes and red-team docs',
          'Multi-turn branching/backtracking is already exposed in Promptfoo-Desktop',
          'Desktop preset copy should keep framing Hydra as a mainstream workflow',
        ],
        commands: ['Open Red Team → enable Hydra strategy'],
        sources: [
          'https://www.promptfoo.dev/docs/red-team/',
          'https://www.promptfoo.dev/docs/releases/',
        ],
      },
      {
        id: 'local-inference',
        title: 'Transformers.js local inference starters',
        status: 'ready-now',
        released: '2026-01',
        why: 'Promptfoo now documents fully local Transformers.js inference in Node.js, including local text generation, embeddings for similarity assertions, quantization, and WebGPU-capable device settings.',
        desktopUpgrade: 'Ship a built-in local-first starter config so desktop users can clone a private eval without hand-writing provider YAML.',
        highlights: [
          'Transformers.js supports text-generation and feature-extraction providers',
          'Docs recommend q4/q8 quantization plus device overrides like webgpu/coreml',
          'Local embeddings can grade similar assertions without external APIs',
        ],
        commands: [
          'npm install @huggingface/transformers',
          'provider: transformers:text-generation:onnx-community/Qwen3-0.6B-ONNX',
          'grading: transformers:feature-extraction:Xenova/all-MiniLM-L6-v2',
        ],
        sources: [
          'https://www.promptfoo.dev/docs/releases/',
          'https://www.promptfoo.dev/docs/providers/transformers/',
        ],
      },
      {
        id: 'telecom-redteam',
        title: 'Telecom red-team rollout',
        status: 'ready-now',
        released: '2026-01',
        why: 'Promptfoo added a dedicated telecommunications plugin suite for CPNI privacy, account takeover, E911 misinformation, billing/coverage guidance, and other carrier compliance risks.',
        desktopUpgrade: 'Surface the telecom plugin family in the desktop red-team catalog so regulated support teams can start from an industry-specific preset instead of assembling checks manually.',
        highlights: [
          'Release notes call out telecom red-team plugins as a January 2026 highlight',
          'The telecom plugin docs enumerate carrier-specific checks like telecom:cpni-disclosure and telecom:e911-misinformation',
          'Desktop can expose these as a dedicated compliance pack alongside the broader regulated profile',
        ],
        commands: [
          'plugins: [promptfoo:redteam:telecom:cpni-disclosure, promptfoo:redteam:telecom:e911-misinformation]',
          'Open Red Team → Telecom Compliance preset',
        ],
        sources: [
          'https://www.promptfoo.dev/docs/releases/',
          'https://www.promptfoo.dev/docs/red-team/plugins/telecom/',
        ],
      },
      {
        id: 'mcp-tool-routing',
        title: 'MCP multi-server routing starter',
        status: 'ready-now',
        released: '2026-04',
        why: 'Promptfoo documents local and remote MCP servers, multi-server routing via servers[], and progress-aware timeout controls for long-running tool calls.',
        desktopUpgrade: 'Ship a desktop starter template that demonstrates local + remote MCP routing with resetTimeoutOnProgress and maxTotalTimeout defaults.',
        highlights: [
          'mcp.enabled plus server/servers config turns tool use on per provider',
          'One provider can connect to multiple MCP servers through servers[]',
          'Timeout controls now include resetTimeoutOnProgress and maxTotalTimeout for long-running tools',
        ],
        commands: [
          'servers: [memory, remote-reference]',
          'resetTimeoutOnProgress: true',
          'maxTotalTimeout: 900000',
        ],
        sources: [
          'https://www.promptfoo.dev/docs/providers/mcp/',
        ],
      },
    ],
  };
}
