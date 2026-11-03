import { test, expect } from "@playwright/test";
const BASE = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test("TC-01: catalog filtering, guest cart redirect and responsive layout", async ({ page }) => {
  await page.goto(BASE);
  await expect(
    page.getByRole("heading", { name: "Dışarıda güzel bir hayat." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reddet" }).click();
  await page.getByRole("button", { name: "Sandalyeler", exact: true }).click();
  await expect(page.locator(".product")).toHaveCount(1);
  await expect(page.locator(".product .stock-label")).toHaveText("Stokta");
  await page
    .getByRole("button", { name: "Terra Örgü Sandalye sepete ekle" })
    .click();
  // Ziyaretçi sepet oluşturamaz; giriş penceresi açılır.
  await expect(page.getByRole("heading", { name: "Yeniden merhaba." })).toBeVisible();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.screenshot({ path: "/tmp/bahceni-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".product")).toBeVisible();
  const widths = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    innerWidth,
  ]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
  await page.screenshot({ path: "/tmp/bahceni-mobile.png", fullPage: true });
});

test("TC-31: guest can preview; saving asks for login", async ({ page }) => {
  await page.goto(BASE);
  await page
    .locator(".product")
    .first()
    .getByRole("button", { name: "Bahçede Gör" })
    .click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.locator(".studio input[type=file]").setInputFiles({
    name: "garden.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator(".scene")).toHaveCSS("background-image", /blob:/);
  await page.locator(".studio input[type=range]").nth(1).fill("45");
  await expect(page.getByText("Döndürme · 45°")).toBeVisible();
  await page.getByRole("button", { name: "Yerleşimi kaydetmek için giriş yap" }).click();
  await expect(
    page.getByText("Yerleşimi kaydetmek veya satın almak için hesap oluşturup giriş yapınız."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Yeniden merhaba." })).toBeVisible();
});

test("TC-23/25/27/28 + VAL-006: member preview, saved layout and demo checkout", async ({
  page,
}) => {
  const email = "browser-" + Date.now() + "@test.example";
  await page.goto(BASE);
  await page.getByRole("button", { name: "İzin ver" }).click();
  await page.locator(".account").click();
  await page.getByRole("button", { name: "Hesabın yok mu? Üye ol" }).click();
  await page.getByLabel("Ad soyad").fill("Tarayıcı Testi");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Şifre", { exact: true }).fill("BrowserPass123!");
  await page.getByRole("button", { name: "Hesap oluştur", exact: true }).click();
  await expect(page.locator(".account")).toContainText("Tarayıcı");
  await page
    .locator(".product")
    .first()
    .getByRole("button", { name: "Bahçede Gör" })
    .click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText(/Model yükleme süresi/)).toBeVisible();
  await page.locator(".studio input[type=range]").nth(1).fill("90");
  await expect(page.getByText("Döndürme · 90°")).toBeVisible();
  // Geçersiz dosya reddedilir (VAL-016).
  await page.locator(".studio input[type=file]").setInputFiles({
    name: "plan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(
    page.getByText("Lütfen JPEG veya PNG biçiminde bir fotoğraf yükleyiniz."),
  ).toBeVisible();
  await page.locator(".studio input[type=file]").setInputFiles({
    name: "garden.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator(".scene")).toHaveCSS("background-image", /blob:/);
  // Fotoğrafı yeniden yüklemeden başka ürün denenir (FR-030).
  await page.locator(".studio aside select").selectOption({ label: "Terra Örgü Sandalye" });
  await expect(page.locator(".scene")).toHaveCSS("background-image", /blob:/);
  await page.getByLabel("Bahçe fotoğrafını da hesabıma kaydet").check();
  await page.getByRole("button", { name: "Yerleşimimi kaydet" }).click();
  await expect(page.getByRole("button", { name: "Bahçem · 📷 ↗" })).toBeVisible();
  await page.screenshot({ path: "/tmp/bahceni-studio.png" });
  await page.getByRole("button", { name: "Satın al · Sepete ekle" }).click();
  await expect(page.getByText("Ürün sepetinize eklendi")).toBeVisible();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.locator(".cart-btn").click();
  await expect(page.locator(".summary")).toContainText("Genel toplam");
  await page.getByLabel("Adres", { exact: true }).fill("Test Mahallesi, Test Sokak 123, İstanbul");
  await page.getByRole("button", { name: "Demo ödemeyi tamamla" }).click();
  await expect(
    page.getByText("Devam etmek için gerekli metinleri onaylayınız."),
  ).toBeVisible();
  await page.getByLabel(/mesafeli satış sözleşmesini okudum/).check();
  await page.getByRole("button", { name: "Demo ödemeyi tamamla" }).click();
  await expect(page.getByRole("heading", { name: "Siparişlerim" })).toBeVisible();
  await expect(page.locator(".order .badge")).toHaveText("Ödendi (demo)");
});
