import { expect, test } from "@playwright/test";

test("frontend loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Notional/i);
  await expect(page.getByText(/paper/i).first()).toBeVisible();
});
