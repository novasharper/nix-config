// Type-only conformance check between pi-api.test-shim.ts and the real
// @earendil-works/pi-coding-agent. The unit tests import the shim in place of
// the package, and bun strips types without checking them, so without this file
// an upstream signature change would leave the tests green while asserting
// against a contract that no longer exists. Compiled by the build's tsc pass
// only; nothing imports it at runtime.
import type * as real from "@earendil-works/pi-coding-agent";
import type * as shim from "./pi-api.test-shim.ts";

// Mutual assignability, so the check fails on a field added or removed on
// either side rather than only on a narrowing.
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// One-way for the factories: the shim deliberately returns a looser tool
// definition than pi's ToolDefinition, so only the real signature has to
// satisfy what sandbox.ts is checked against.
type Satisfies<A, B> = [A] extends [B] ? true : never;

export const conformance: {
  bashOperations: Mutual<shim.BashOperations, real.BashOperations>;
  bashSpawnContext: Mutual<shim.BashSpawnContext, real.BashSpawnContext>;
  bashSpawnHook: Mutual<shim.BashSpawnHook, real.BashSpawnHook>;
  bashToolOptions: Mutual<shim.BashToolOptions, real.BashToolOptions>;
  createLocalBashOperations: Satisfies<
    typeof real.createLocalBashOperations,
    typeof shim.createLocalBashOperations
  >;
  createBashToolDefinition: Satisfies<
    typeof real.createBashToolDefinition,
    typeof shim.createBashToolDefinition
  >;
} = {
  bashOperations: true,
  bashSpawnContext: true,
  bashSpawnHook: true,
  bashToolOptions: true,
  createLocalBashOperations: true,
  createBashToolDefinition: true,
};
