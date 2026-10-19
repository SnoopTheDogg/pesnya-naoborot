// End-to-end round in Chromium with a fake microphone fed from e2e/fixtures/voice.wav.
import { test, expect } from '@playwright/test';

const btn = (page, name) => page.getByRole('button', { name, exact: true });

async function startGame(page) {
  await page.goto('./');
  await btn(page, 'Новая игра').click();
  await expect(page.locator('section[data-screen="A"]')).toBeVisible();
}

async function recordA(page, ms) {
  await btn(page, 'Записать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await page.waitForTimeout(ms);
  await btn(page, 'Завершить запись').click();
}

test('start screen shows title, slider and the silent-mode hint', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('section[data-screen="start"]')).toBeVisible();
  await expect(page.locator('section[data-screen="A"]')).toBeHidden();
  await expect(page.locator('#chunk-slider')).toBeVisible();
  await expect(page.locator('#chunk-value')).toHaveText('5 с');
  await page.locator('#chunk-slider').fill('4.5');
  await expect(page.locator('#chunk-value')).toHaveText('4,5 с');
  await expect(page.locator('#hint-silent')).toHaveText('Нет звука? Выключи бесшумный режим');
  await expect(page.locator('#hint-silent')).toBeVisible();
});

test('start → A records', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('section[data-screen="start"]')).toBeHidden();
  await btn(page, 'Записать').click();
  await expect(page.locator('#timer')).toBeVisible();
  await expect(btn(page, 'Записать')).toBeHidden();
  await page.waitForTimeout(3000);
  await btn(page, 'Завершить запись').click();
  await expect(btn(page, 'Переслушать')).toBeVisible();
  await expect(btn(page, 'Перезаписать')).toBeVisible();
  await expect(page.locator('#plan-info')).toBeVisible();
  await expect(page.locator('#plan-info')).toHaveText(/^Выйдет 1 кусок по ~\d,\d с$/);
  await expect(page.locator('#timer')).toBeHidden();
  await expect(page.getByText('Если колонка подключена, звук пойдёт в неё')).toBeVisible();
  await expect(page.locator('#error')).toBeHidden();
});

test('slider changes plan', async ({ page }) => {
  await startGame(page);
  await recordA(page, 3000);
  await expect(page.locator('#plan-info')).toBeVisible();
  await page.locator('#chunk-slider').fill('1');
  await expect(page.locator('#chunk-value')).toHaveText('1 с');
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '3');
  await expect(page.locator('#plan-info')).toHaveText(/^Выйдет 3 куска по ~\d,\d с$/);
  await page.locator('#chunk-slider').fill('3');
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '1');
});

test('too short', async ({ page }) => {
  await startGame(page);
  await btn(page, 'Записать').click();
  await btn(page, 'Завершить запись').click();
  await expect(page.getByText('Слишком коротко, запиши ещё раз')).toBeVisible();
  await expect(btn(page, 'Дальше: игрок Б')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await expect(btn(page, 'Записать')).toBeVisible();
});

test('mic denied', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await startGame(page);
  await btn(page, 'Записать').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('NotAllowedError');
  await expect(page.locator('#error')).toContainText('Permission denied');
  await expect(page.locator('#error')).toContainText('Настройки → Safari → Микрофон');
  await expect(btn(page, 'Записать')).toBeEnabled();
});

test('playing while re-recording finishes the take, then plays it', async ({ page }) => {
  await startGame(page);
  await recordA(page, 3000);
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '1');
  await page.locator('#chunk-slider').fill('1');
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '3');
  await btn(page, 'Перезаписать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await page.waitForTimeout(1500);
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Завершить запись')).toBeHidden();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true');
  // the new ~1.5 s take replaced the 3 s one
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', /^[12]$/);
  // tapping the playing button stops it
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'false');
});

test('next goes to player B', async ({ page }) => {
  await startGame(page);
  await recordA(page, 2000);
  await btn(page, 'Дальше: игрок Б').click();
  await expect(page.locator('section[data-screen="B"]')).toBeVisible();
  await expect(page.locator('section[data-screen="A"]')).toBeHidden();
});
