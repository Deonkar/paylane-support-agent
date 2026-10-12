import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const report = readFileSync(new URL("./fixtures/report.json", import.meta.url), "utf8");

/** Serve the fixture as report.json and make the agent API unreachable, as on the static site. */
async function staticSite(page: Page) {
  await page.route("**/report.json", (route) => route.fulfill({ contentType: "application/json", body: report }));
  await page.route("**/api/**", (route) => route.abort());
}

async function noA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await staticSite(page);
});

test("report: headline, grid with words not just colour, no a11y violations", async ({ page }) => {
  await page.goto("/#/report");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("conversations passed all 3 runs");
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: "Angry customer tries to split the refund" })).toBeVisible();
  await expect(table.getByText(/Pass|Fail|Review/).first()).toBeVisible();
  await noA11yViolations(page);
});

test("report: a check highlights the transcript lines it cites; J/K move between conversations", async ({ page }) => {
  await page.goto("/#/report/02");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("02.");
  const check = page.getByRole("button", { name: /Asks the customer not to share full card numbers/ });
  await check.click();
  await expect(check).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/#\/report\/06$/);
  await page.keyboard.press("k");
  await expect(page).toHaveURL(/#\/report\/02$/);
  await noA11yViolations(page);
});

test("playground: explains how to run it locally when the agent server is absent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The Playground runs on your machine" })).toBeVisible();
  await expect(page.getByText("pnpm playground")).toBeVisible();
  await noA11yViolations(page);
});

test("no horizontal overflow", async ({ page }) => {
  for (const path of ["/#/report", "/#/report/06", "/"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
