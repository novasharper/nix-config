// Stand-in for @earendil-works/pi-coding-agent so the unit tests can import
// sandbox.ts without pulling in Pi's runtime. These signatures mirror
// core/tools/bash.d.ts. pi-api.conformance.ts asserts them against the real
// package during the build's tsc pass, so a drift here fails the build rather
// than leaving the tests asserting against a contract that no longer exists.
export type BashOperations = {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
};

export type BashSpawnContext = {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

export type BashToolOptions = {
  operations?: BashOperations;
  commandPrefix?: string;
  shellPath?: string;
  exposeSessionEnvironment?: boolean;
  spawnHook?: BashSpawnHook;
};

export type ExtensionAPI = Record<string, any>;

export function createLocalBashOperations(_options?: {
  shellPath?: string;
}): BashOperations {
  return {
    async exec() {
      return { exitCode: 0 };
    },
  };
}

export function createBashToolDefinition(
  _cwd: string,
  _options?: BashToolOptions,
): Record<string, any> {
  return {
    name: "bash",
    label: "bash",
    description: "test bash tool",
    parameters: {},
    async execute() {
      return { content: [], details: {} };
    },
  };
}
