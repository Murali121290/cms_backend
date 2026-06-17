# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: structuringReview.spec.ts >> Document Structuring Workspace >> should successfully select a paragraph, apply a new style, and save the changes
- Location: e2e\structuringReview.spec.ts:17:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: page.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('#username')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - img "S4Carlisle Publishing Services" [ref=e7]
    - generic [ref=e8]:
      - heading "Publishing workflows, powered by intelligence." [level=1] [ref=e10]:
        - text: Publishing workflows,
        - text: powered by intelligence.
      - paragraph [ref=e11]: The S4Carlisle Production Suite helps editorial teams manage manuscripts, automate processing, and deliver publication-ready content at scale.
      - generic [ref=e12]:
        - generic [ref=e15]: AI-powered manuscript structuring
        - generic [ref=e18]: End-to-end production workflow
        - generic [ref=e21]: Publisher-grade quality controls
    - paragraph [ref=e23]: © 2026 S4Carlisle Publishing Services
  - generic [ref=e25]:
    - heading "Welcome back" [level=2] [ref=e26]
    - paragraph [ref=e27]: Sign in to your account
    - generic [ref=e28]:
      - generic [ref=e29]:
        - generic [ref=e30]: Email Address
        - textbox "Email Address" [ref=e31]:
          - /placeholder: you@s4carlisle.com
      - generic [ref=e32]:
        - generic [ref=e33]: Password
        - generic [ref=e34]:
          - textbox "Password" [ref=e35]:
            - /placeholder: ••••••••
          - button "Show password" [ref=e36] [cursor=pointer]:
            - img [ref=e37]
      - generic [ref=e40]:
        - generic [ref=e41] [cursor=pointer]:
          - checkbox "Remember me" [ref=e42]
          - generic [ref=e43]: Remember me
        - button "Forgot password?" [ref=e44] [cursor=pointer]
      - button "Sign In" [ref=e45] [cursor=pointer]
    - generic [ref=e48]: or
    - paragraph [ref=e50]:
      - text: Don't have an account?
      - link "Request access" [ref=e51]:
        - /url: /register
    - paragraph [ref=e52]: S4Carlisle — Production Suite
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | test.describe("Document Structuring Workspace", () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     // 1. Navigate to the login page
  6  |     await page.goto("/login");
  7  | 
  8  |     // 2. Perform authentication using standard admin credentials
> 9  |     await page.fill("#username", "admin");
     |                ^ Error: page.fill: Test timeout of 30000ms exceeded.
  10 |     await page.fill("#password", "admin123");
  11 |     await page.click('button[type="submit"]');
  12 | 
  13 |     // 3. Verify that login completes and we are redirected to a secure session
  14 |     await expect(page).not.toHaveURL(/\/login/);
  15 |   });
  16 | 
  17 |   test("should successfully select a paragraph, apply a new style, and save the changes", async ({ page }) => {
  18 |     // 4. Navigate directly to the Document Structuring Review page
  19 |     // Using project 6, chapter 5, and file 22 (from our verified workspace environment)
  20 |     await page.goto("/projects/6/chapters/5/files/22/structuring-review");
  21 | 
  22 |     // 5. Open the Structuring Editor Workspace tab
  23 |     const editorTabButton = page.locator("button", { hasText: "Structuring Editor Workspace" });
  24 |     await expect(editorTabButton).toBeVisible();
  25 |     await editorTabButton.click();
  26 | 
  27 |     // 6. Wait for the loading state to resolve and the document workspace editor to appear
  28 |     const editorWorkspace = page.locator(".flex-1.bg-white.rounded-lg");
  29 |     await expect(editorWorkspace).toBeVisible();
  30 | 
  31 |     // 7. Verify document paragraphs have loaded (locate paragraph blocks inside the editor)
  32 |     // Looking for paragraph text blocks that we click to select
  33 |     const paragraphBlock = page.locator('div[style*="cursor: pointer"] p, p').first();
  34 |     await expect(paragraphBlock).toBeVisible();
  35 |     await paragraphBlock.click();
  36 | 
  37 |     // 8. Select and apply a new style (e.g. 'EQ' style)
  38 |     const searchInput = page.locator('input[placeholder="Search styles…"]');
  39 |     await expect(searchInput).toBeVisible();
  40 |     await searchInput.fill("EQ");
  41 | 
  42 |     const eqStyleButton = page.locator("aside button", { hasText: "EQ" }).first();
  43 |     await expect(eqStyleButton).toBeVisible();
  44 |     await eqStyleButton.click();
  45 | 
  46 |     // 9. Verify the unsaved changes count has updated in the styles panel footer
  47 |     const pendingChangesLabel = page.locator("aside", { hasText: "unsaved change" });
  48 |     await expect(pendingChangesLabel).toContainText(/1 unsaved change/i);
  49 | 
  50 |     // 10. Click the 'Save Changes' button in the sidebar panel
  51 |     const saveChangesButton = page.locator("aside button", { hasText: "Save Changes" });
  52 |     await expect(saveChangesButton).toBeEnabled();
  53 |     await saveChangesButton.click();
  54 | 
  55 |     // 11. Assert that the save operation completes successfully and displays the confirmation banner
  56 |     const successBanner = page.locator("main div", { hasText: "Save complete" }).first();
  57 |     await expect(successBanner).toBeVisible();
  58 |     await expect(successBanner).toContainText(/Saved 1 change/i);
  59 |   });
  60 | });
  61 | 
```