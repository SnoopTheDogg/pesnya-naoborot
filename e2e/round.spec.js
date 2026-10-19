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
  await page.locator('#chunk-slider').fill('1');
  await recordA(page, 2000);
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '2');
  await btn(page, 'Перезаписать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await page.waitForTimeout(4000);
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Завершить запись')).toBeHidden();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true');
  // the new ~4 s take replaced the 2 s one
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', /^[45]$/);
  // tapping the playing button stops it (the 4 s take is still playing)
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'false');
});

// Wraps the real getUserMedia with a settable delay and keeps every stream it hands out.
async function slowMic(page) {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    window.__gumDelay = 0;
    window.__streams = [];
    md.getUserMedia = async (c) => {
      if (window.__gumDelay) await new Promise((r) => setTimeout(r, window.__gumDelay));
      const s = await real(c);
      window.__streams.push(s);
      return s;
    };
  });
}
const liveTracks = (page) =>
  page.evaluate(() =>
    window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length,
  );

test('«Дальше: игрок Б» is unavailable while the mic is opening', async ({ page }) => {
  await slowMic(page);
  await startGame(page);
  await recordA(page, 2000);
  await expect(btn(page, 'Дальше: игрок Б')).toBeVisible();
  await page.evaluate(() => (window.__gumDelay = 1500));
  await btn(page, 'Перезаписать').click();
  // right away, while getUserMedia is still pending: hidden, and even a
  // programmatic tap must not leave screen A
  const hiddenWhilePending = await page.evaluate(() => {
    const b = document.querySelector('#btn-to-b');
    const hidden = b.hidden;
    b.click();
    return hidden;
  });
  expect(hiddenWhilePending).toBe(true);
  await expect(page.locator('section[data-screen="A"]')).toBeVisible();
  await page.waitForTimeout(2000); // mic is open now
  await expect(page.locator('section[data-screen="A"]')).toBeVisible();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await btn(page, 'Завершить запись').click();
  await expect(btn(page, 'Дальше: игрок Б')).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
});

test('«Переслушать» while the mic is opening cancels the take and plays the old one', async ({ page }) => {
  await slowMic(page);
  await startGame(page);
  await page.locator('#chunk-slider').fill('1');
  await recordA(page, 4000);
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', /^[45]$/);
  const nBefore = await page.locator('#plan-info').getAttribute('data-n');
  await page.evaluate(() => (window.__gumDelay = 1500));
  await btn(page, 'Перезаписать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await btn(page, 'Переслушать').click();
  // no sound while the mic is still opening
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'false');
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await expect(btn(page, 'Завершить запись')).toBeHidden();
  await expect(btn(page, 'Перезаписать')).toBeVisible();
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', nBefore);
  await expect(page.getByText('Слишком коротко, запиши ещё раз')).toBeHidden();
  expect(await liveTracks(page)).toBe(0);
  await page.waitForTimeout(500);
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true');
});

test('mic not found also shows the real error and the mic help', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
  });
  await startGame(page);
  await btn(page, 'Записать').click();
  await expect(page.locator('#error')).toContainText('NotFoundError: Requested device not found');
  await expect(page.locator('#error')).toContainText('Настройки → Safari → Микрофон');
  await expect(btn(page, 'Записать')).toBeEnabled();
});

test('audio that cannot start shows the real error', async ({ page }) => {
  await startGame(page);
  await recordA(page, 2000);
  await expect(btn(page, 'Переслушать')).toBeVisible();
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(AudioContext.prototype); // BaseAudioContext
    Object.defineProperty(proto, 'state', { configurable: true, get: () => 'interrupted' });
    AudioContext.prototype.resume = () =>
      Promise.reject(new DOMException('resume blocked by test', 'InvalidStateError'));
  });
  await btn(page, 'Переслушать').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('InvalidStateError: resume blocked by test');
});

test('next goes to player B', async ({ page }) => {
  await startGame(page);
  await recordA(page, 2000);
  await btn(page, 'Дальше: игрок Б').click();
  await expect(page.locator('section[data-screen="B"]')).toBeVisible();
  await expect(page.locator('section[data-screen="A"]')).toBeHidden();
});
