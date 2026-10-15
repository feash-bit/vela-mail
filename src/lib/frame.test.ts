import { describe, expect, it } from "vitest";
import { isDesignedEmail } from "./frame";

describe("isDesignedEmail", () => {
  it("treats simple text HTML as plain", () => {
    expect(isDesignedEmail("<p>Hi</p><ul><li>One</li></ul>", "")).toBe(false);
  });
  it("keeps designed emails on paper", () => {
    expect(isDesignedEmail('<table bgcolor="#fff"><tr><td>x</td></tr></table>', "")).toBe(true);
    expect(isDesignedEmail('<div style="background-color:#000">x</div>', "")).toBe(true);
    expect(isDesignedEmail("<p>x</p>", "p{color:red}")).toBe(true);
  });
});
