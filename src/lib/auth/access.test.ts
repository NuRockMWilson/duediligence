// =============================================================================
// isRbacInitialized — the DENY fallback
// =============================================================================
// THIS FILE EXISTS BECAUSE NO ACCOUNT CAN REACH THE BRANCH. From the live
// measurement session, 2026-09-03:
//
//   "NO ROLELESS ACCOUNT EXISTS. michaellwilson@gmail.com holds Contributor in
//    Development AND Underwriting, so it cannot exercise the roleless branch...
//    Creating an account is forbidden by standing rules; stripping roles is a
//    production role mutation... THEREFORE the DENY direction of
//    isRbacInitialized() CANNOT be verified from the browser with current
//    accounts, now or after the P0 closes. If I claimed to verify it later, that
//    claim would be unfounded."
//
// Exactly right, and it is the reason this function's own history is what it is:
// the original counted app_user_roles THROUGH THE CALLER'S OWN RLS, so a
// roleless user saw zero rows, concluded RBAC was unconfigured, and switched the
// module gate off for precisely the users it exists to stop. An org admin — the
// only person able to test it by hand — was the one caller for whom it always
// answered correctly. A guard whose precondition is evaluated through the
// permissions of the user being guarded cannot be tested by anyone who has
// permission.
//
// So the test does not need an account. It needs the RPC to be absent, and
// asserts the fallback ENFORCES rather than waves the caller through.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

// The module under test calls createClient() at call time, so the mock only has
// to supply an rpc(). Declared with vi.hoisted so the factory below can close
// over it — vi.mock is hoisted above imports.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock }),
}));

import { isRbacInitialized } from "./access";

beforeEach(() => {
  rpcMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("isRbacInitialized — fails CLOSED", () => {
  it("ENFORCES when the RPC is missing (migration not applied)", async () => {
    // PostgREST answers a missing function with an error in `error`, not a
    // throw. The pre-fix code returned false here, which DISABLED the gate.
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'function public.app_rbac_initialized() does not exist' },
    });
    await expect(isRbacInitialized()).resolves.toBe(true);
  });

  it("ENFORCES when the client throws outright", async () => {
    rpcMock.mockRejectedValue(new Error("network"));
    await expect(isRbacInitialized()).resolves.toBe(true);
  });

  it("ENFORCES when the RPC answers null", async () => {
    // Null is not false. "Cannot establish whether RBAC is initialized" must not
    // read as "it is not initialized" — that conflation is the whole defect.
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(isRbacInitialized()).resolves.toBe(true);
  });

  it("does NOT count rows — a zero-row read must never disable the gate", async () => {
    // The regression guard for the original bug specifically. If someone
    // reintroduces a count(*) through the caller's session, a roleless user
    // yields 0 and this assertion is what fails. Shape-agnostic on purpose: any
    // count-like return must still enforce.
    rpcMock.mockResolvedValue({ data: 0 as unknown as boolean, error: null });
    await expect(isRbacInitialized()).resolves.toBe(true);
  });
});

describe("isRbacInitialized — the bootstrap case still works", () => {
  it("reports FALSE only on an explicit false from the RPC", async () => {
    // The genuine unseeded platform: the SECURITY DEFINER function can see the
    // whole table and says there are no assignments. Enforcement stays off so
    // the org cannot be locked out before roles are seeded. This is the ONE path
    // that may return false, and it must keep working — the standing rule
    // against denying by default on an unpopulated control depends on it.
    rpcMock.mockResolvedValue({ data: false, error: null });
    await expect(isRbacInitialized()).resolves.toBe(false);
  });

  it("reports TRUE on an explicit true", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await expect(isRbacInitialized()).resolves.toBe(true);
  });
});
