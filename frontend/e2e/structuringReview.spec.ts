import { test, expect } from "@playwright/test";

test.describe("Document Structuring Workspace", () => {
  test.beforeEach(async ({ page }) => {
    // 1. Navigate to the login page
    await page.goto("/login");

    // 2. Perform authentication using standard admin credentials
    await page.fill("#username", "admin");
    await page.fill("#password", "admin123");
    await page.click('button[type="submit"]');

    // 3. Verify that login completes and we are redirected to a secure session
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("should successfully select a paragraph, apply a new style, and save the changes", async ({ page }) => {
    // 4. Navigate directly to the Document Structuring Review page
    // Using project 6, chapter 5, and file 22 (from our verified workspace environment)
    await page.goto("/projects/6/chapters/5/files/22/structuring-review");

    // 5. Open the Structuring Editor Workspace tab
    const editorTabButton = page.locator("button", { hasText: "Structuring Editor Workspace" });
    await expect(editorTabButton).toBeVisible();
    await editorTabButton.click();

    // 6. Wait for the loading state to resolve and the document workspace editor to appear
    const editorWorkspace = page.locator(".flex-1.bg-white.rounded-lg");
    await expect(editorWorkspace).toBeVisible();

    // 7. Verify document paragraphs have loaded (locate paragraph blocks inside the editor)
    // Looking for paragraph text blocks that we click to select
    const paragraphBlock = page.locator('div[style*="cursor: pointer"] p, p').first();
    await expect(paragraphBlock).toBeVisible();
    await paragraphBlock.click();

    // 8. Select and apply a new style (e.g. 'EQ' style)
    const searchInput = page.locator('input[placeholder="Search styles…"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("EQ");

    const eqStyleButton = page.locator("aside button", { hasText: "EQ" }).first();
    await expect(eqStyleButton).toBeVisible();
    await eqStyleButton.click();

    // 9. Verify the unsaved changes count has updated in the styles panel footer
    const pendingChangesLabel = page.locator("aside", { hasText: "unsaved change" });
    await expect(pendingChangesLabel).toContainText(/1 unsaved change/i);

    // 10. Click the 'Save Changes' button in the sidebar panel
    const saveChangesButton = page.locator("aside button", { hasText: "Save Changes" });
    await expect(saveChangesButton).toBeEnabled();
    await saveChangesButton.click();

    // 11. Assert that the save operation completes successfully and displays the confirmation banner
    const successBanner = page.locator("main div", { hasText: "Save complete" }).first();
    await expect(successBanner).toBeVisible();
    await expect(successBanner).toContainText(/Saved 1 change/i);
  });
});
