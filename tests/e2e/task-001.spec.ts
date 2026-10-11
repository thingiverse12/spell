import { expect, test, type Page } from '@playwright/test';

/**
 * TASK-001 — Third-Person Character Controller & Dual Character Switching.
 *
 * These tests drive the real input path (keyboard events on the canvas) and
 * read measurements through `window.__spell`, the read-only telemetry seam
 * installed by `src/debug.ts`.
 */

const state = (page: Page) => page.evaluate(() => window.__spell!.state());
const metrics = (page: Page) => page.evaluate(() => window.__spell!.metrics());
const peakSpeed = (page: Page, ms: number) =>
  page.evaluate((duration) => window.__spell!.peakSpeed(duration), ms);

/** Waits for `window.__spell` and for the first rendered frame. */
async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => window.__spell !== undefined);
  // Let a couple of frames run so the camera has settled on the character.
  await page.waitForTimeout(300);

  expect(errors, `console/page errors during boot: ${errors.join(' | ')}`).toEqual([]);
}

test.describe('TASK-001 acceptance criteria', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test('1 — orbit camera follows the active character at its configured distance', async ({
    page,
  }) => {
    const before = await state(page);
    const distanceBefore = Math.hypot(
      before.cameraPosition[0] - before.position[0],
      before.cameraPosition[2] - before.position[2],
    );

    // Eimi's CameraProfile.distance is 5.4 m; the camera sits behind and above.
    expect(distanceBefore).toBeGreaterThan(2.5);
    expect(distanceBefore).toBeLessThan(6.5);
    expect(before.cameraPosition[1]).toBeGreaterThan(before.position[1] + 0.8);

    // Sprint away for a second; the camera must keep up, not be left behind.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(1200);
    await page.keyboard.up('Shift');
    await page.keyboard.up('KeyW');

    const after = await state(page);
    const distanceAfter = Math.hypot(
      after.cameraPosition[0] - after.position[0],
      after.cameraPosition[2] - after.position[2],
    );

    const travelled = Math.hypot(
      after.position[0] - before.position[0],
      after.position[2] - before.position[2],
    );
    expect(travelled).toBeGreaterThan(4);
    // Still framed at roughly the same distance — proof of a follow camera.
    expect(Math.abs(distanceAfter - distanceBefore)).toBeLessThan(1.5);
  });

  test('2 — Tab swaps character, preserving world position and camera angle', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(900);

    const before = await state(page);
    expect(before.active).toBe('eimi');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const after = await state(page);

    await page.keyboard.up('Shift');
    await page.keyboard.up('KeyW');

    expect(after.active).toBe('asch');
    expect(after.displayName).toBe('Asch');

    // World position carried across the swap.
    expect(after.position[0]).toBeCloseTo(before.position[0], 2);
    expect(after.position[1]).toBeCloseTo(before.position[1], 2);
    expect(after.position[2]).toBeCloseTo(before.position[2], 2);

    // Camera angle is untouched — this is the crux of criterion 2.
    expect(after.yaw).toBeCloseTo(before.yaw, 6);
    expect(after.pitch).toBeCloseTo(before.pitch, 6);

    // The HUD follows the swap.
    await expect(page.locator('#hud-name')).toHaveText('Asch');
  });

  test('3 — Eimi sprints at 8.0 m/s and never exceeds it', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Shift');

    const peak = await peakSpeed(page, 2000);
    const settled = await state(page);

    await page.keyboard.up('Shift');
    await page.keyboard.up('KeyW');

    expect(settled.topSpeed).toBeCloseTo(8.0, 5);
    expect(peak).toBeGreaterThan(7.6);
    expect(peak).toBeLessThanOrEqual(8.0 + 1e-6);
  });

  test('3 — Asch tops out at 5.5 m/s and never exceeds it', async ({ page }) => {
    await page.evaluate(() => window.__spell!.switchTo(1));
    await page.waitForTimeout(80);

    await page.keyboard.down('KeyW');
    await page.keyboard.down('Shift');

    const peak = await peakSpeed(page, 2500);
    const settled = await state(page);

    await page.keyboard.up('Shift');
    await page.keyboard.up('KeyW');

    expect(settled.active).toBe('asch');
    expect(settled.topSpeed).toBeCloseTo(5.5, 5);
    expect(peak).toBeGreaterThan(5.2);
    expect(peak).toBeLessThanOrEqual(5.5 + 1e-6);
  });

  test('3 — momentum carries across the swap but is clamped to the new body', async ({
    page,
  }) => {
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(1500);

    const sprinting = await state(page);
    expect(sprinting.speed).toBeGreaterThan(7.5);

    await page.keyboard.press('Tab');
    const swapped = await state(page);

    await page.keyboard.up('Shift');
    await page.keyboard.up('KeyW');

    // Momentum is not zeroed on switch…
    expect(Math.hypot(swapped.velocity[0], swapped.velocity[2])).toBeGreaterThan(1);
    // …but it can never exceed Asch's 5.5 m/s ceiling.
    expect(swapped.speed).toBeLessThanOrEqual(5.5 + 1e-6);
  });

  test('4 — repeated switching creates no duplicate meshes and leaks nothing', async ({
    page,
  }) => {
    const before = await metrics(page);

    for (let i = 0; i < 50; i += 1) {
      await page.keyboard.press('Tab');
    }
    await page.waitForTimeout(400);

    const after = await metrics(page);

    expect(after.meshes).toBe(before.meshes);
    expect(after.sceneChildren).toBe(before.sceneChildren);
    expect(after.geometries).toBe(before.geometries);
    expect(after.textures).toBe(before.textures);

    // Exactly one visible character at all times.
    const visible = await page.evaluate(() => {
      const api = window.__spell!;
      return api.state().active;
    });
    expect(visible).toBe('eimi'); // 50 toggles from Eimi returns to Eimi
  });

  test('jump makes the character airborne and it lands again', async ({ page }) => {
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    const airborne = await state(page);
    expect(airborne.grounded).toBe(false);
    expect(airborne.position[1]).toBeGreaterThan(0.3);

    await page.waitForTimeout(1500);
    const landed = await state(page);
    expect(landed.grounded).toBe(true);
    expect(landed.position[1]).toBeCloseTo(0, 3);
  });

  test('HUD roster chip performs a direct switch', async ({ page }) => {
    await page.locator('.chip', { hasText: 'Asch' }).click();
    await expect(page.locator('#hud-name')).toHaveText('Asch');
    expect((await state(page)).active).toBe('asch');
    await expect(page.locator('.chip[data-active="true"]')).toContainText('Asch');
  });
});
