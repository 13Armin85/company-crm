import { describe, expect, it } from "vitest";
import { routingRuleForMethod, ruleProblems } from "./model";
import type { RoutingRule } from "../api/ticket";

const rule: Partial<RoutingRule> = {
  name: "پشتیبانی",
  conditions: { priorities: ["high"] },
  target_user_id: "person",
  member_ids: ["member"],
  required_role_id: "role",
  unit_id: "unit",
};

describe("routing destination fields", () => {
  it("submits only the destination relevant to a fixed person", () => {
    expect(routingRuleForMethod(rule, "user")).toEqual({
      ...rule,
      method: "user",
      member_ids: [],
      required_role_id: null,
      unit_id: null,
    });
  });
  it("keeps the role for a group and clears the old person and unit", () => {
    expect(routingRuleForMethod(rule, "group")).toEqual({
      ...rule,
      method: "group",
      member_ids: [],
      target_user_id: null,
      unit_id: null,
    });
  });
  it.each(["round_robin", "least_loaded"] as const)("preserves candidate selection for %s", (method) => {
    const result = routingRuleForMethod(rule, method);
    expect(result.member_ids).toEqual(["member"]);
    expect(result.target_user_id).toBeNull();
    expect(result.conditions).toEqual(rule.conditions);
    expect(ruleProblems(result)).toEqual([]);
  });
  it("keeps both required manager inputs and clears unrelated recipients", () => {
    const result = routingRuleForMethod(rule, "manager");
    expect(result.member_ids).toEqual([]);
    expect(result.target_user_id).toBeNull();
    expect(result.unit_id).toBe("unit");
    expect(result.required_role_id).toBe("role");
    expect(ruleProblems(result)).toEqual([]);
  });
});
