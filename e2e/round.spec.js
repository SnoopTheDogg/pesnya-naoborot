// End-to-end round in Chromium with a fake microphone fed from e2e/fixtures/voice.wav.
import { readFile } from 'node:fs/promises';
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

// waits out the tap guard after a take ends (600 ms) or a chunk change (400 ms)
const afterGuard = (page) => page.waitForTimeout(700);

test('start screen shows title, slider and the silent-mode hint', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('section[data-screen="start"]')).toBeVisible();
  await expect(page.locator('section[data-screen="A"]')).toBeHidden();
  await expect(page.locator('#chunk-slider')).toBeVisible();
  await expect(page.locator('#chunk-value')).toHaveText('2 с');
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

// Every decodeAudioData call fails like Safari does on a broken recording.
async function blockDecode(page) {
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(AudioContext.prototype); // BaseAudioContext
    proto.decodeAudioData = function (data, ok, fail) {
      const e = new DOMException('decode blocked by test', 'EncodingError');
      if (fail) fail(e);
      return Promise.reject(e);
    };
  });
}

test('A: an undecodable take shows the real error along with «Слишком коротко»', async ({ page }) => {
  await startGame(page);
  await blockDecode(page);
  await recordA(page, 1000);
  await expect(page.getByText('Слишком коротко, запиши ещё раз')).toBeVisible();
  await expect(page.locator('#error')).toContainText('EncodingError: decode blocked by test');
  await expect(btn(page, 'Дальше: игрок Б')).toBeHidden();
  // an instant take (under 0,5 s) that fails to decode is just too short
  await afterGuard(page);
  await btn(page, 'Записать').click();
  await expect(page.locator('#error')).toBeHidden();
  await btn(page, 'Завершить запись').click();
  await expect(page.getByText('Слишком коротко, запиши ещё раз')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#error')).toBeHidden();
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
  await afterGuard(page);
  await btn(page, 'Перезаписать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await page.waitForTimeout(4000);
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Завершить запись')).toBeHidden();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true');
  // the new ~4 s take replaced the 2 s one (a cold mic may clip it a little)
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', /^[3-6]$/);
  // tapping the playing button stops it (the 4 s take is still playing)
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'false');
});

// Wraps the real getUserMedia with a settable delay and keeps every stream it
// hands out; with window.__gumFail set it fails with that error name after the delay.
async function slowMic(page) {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    window.__gumDelay = 0;
    window.__gumFail = null;
    window.__streams = [];
    md.getUserMedia = async (c) => {
      if (window.__gumDelay) await new Promise((r) => setTimeout(r, window.__gumDelay));
      if (window.__gumFail) throw new DOMException('mic failed by test', window.__gumFail);
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
  await afterGuard(page);
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
  await page.waitForTimeout(3000); // mic is open now (1.5 s delay + margin)
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
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', /^[3-6]$/);
  const nBefore = await page.locator('#plan-info').getAttribute('data-n');
  await afterGuard(page);
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

test('while the mic opens the slot says so; once open it says «Пой!» with the timer', async ({ page }) => {
  await slowMic(page);
  await startGame(page);
  await page.evaluate(() => (window.__gumDelay = 1500));
  await btn(page, 'Записать').click();
  const timer = page.locator('#timer');
  await expect(timer.getByText('Включаю микрофон…')).toBeVisible();
  expect(await timer.getByText('Пой!').isVisible()).toBe(false);
  expect(await timer.locator('.timer-clock').isVisible()).toBe(false);
  // «Завершить запись» is there, waiting, and still works
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await expect(btn(page, 'Завершить запись')).toHaveClass(/\bwaiting\b/);
  await expect(btn(page, 'Завершить запись')).toBeEnabled();
  await expect(timer.getByText('Пой!')).toBeVisible({ timeout: 5000 });
  await expect(timer.locator('.timer-clock')).toBeVisible();
  await expect(timer.locator('.timer-clock')).toHaveText(/^0:0\d$/);
  expect(await timer.getByText('Включаю микрофон…').isVisible()).toBe(false);
  await expect(btn(page, 'Завершить запись')).not.toHaveClass(/\bwaiting\b/);
  await page.waitForTimeout(1200);
  await expect(timer.locator('.timer-clock')).not.toHaveText('0:00');
  await btn(page, 'Завершить запись').click();
  await expect(btn(page, 'Переслушать')).toBeVisible();
  // B gets the same cue
  await afterGuard(page);
  await page.locator('#chunk-slider').fill('8');
  await btn(page, 'Дальше: игрок Б').click();
  await btn(page, 'Записать').click();
  await expect(page.locator('#b-timer').getByText('Включаю микрофон…')).toBeVisible();
  await expect(page.locator('#b-timer').getByText('Пой!')).toBeVisible({ timeout: 5000 });
});

test('«Завершить запись» while the mic opens ends the take once it is open', async ({ page }) => {
  await slowMic(page);
  await startGame(page);
  await page.evaluate(() => (window.__gumDelay = 1000));
  await btn(page, 'Записать').click();
  await expect(page.locator('#timer').getByText('Включаю микрофон…')).toBeVisible();
  await btn(page, 'Завершить запись').click();
  await expect(page.getByText('Слишком коротко, запиши ещё раз')).toBeVisible();
  await expect(btn(page, 'Записать')).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
});

test('«Завершить запись» while the mic opens, then the mic fails: the old take is kept', async ({ page }) => {
  await slowMic(page);
  await startGame(page);
  await page.locator('#chunk-slider').fill('1');
  await recordA(page, 3000);
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', /^[2-4]$/);
  const nBefore = await page.locator('#plan-info').getAttribute('data-n');
  await afterGuard(page);
  await page.evaluate(() => {
    window.__gumDelay = 800;
    window.__gumFail = 'NotReadableError';
  });
  await btn(page, 'Перезаписать').click();
  await btn(page, 'Завершить запись').click();
  await expect(page.locator('#error')).toContainText('NotReadableError: mic failed by test');
  await expect(btn(page, 'Перезаписать')).toBeVisible();
  await expect(btn(page, 'Переслушать')).toBeVisible();
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', nBefore);
  await expect(page.getByText('Слишком коротко, запиши ещё раз')).toBeHidden();
  await expect(btn(page, 'Дальше: игрок Б')).toBeVisible();
});

test('a take stops by itself at 60 s and says so', async ({ page }) => {
  await page.clock.install();
  await startGame(page);
  await btn(page, 'Записать').click();
  const timer = page.locator('#timer');
  await expect(timer.getByText('Пой!')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.clock.fastForward('01:00');
  await expect(btn(page, 'Переслушать')).toBeVisible();
  await expect(btn(page, 'Завершить запись')).toBeHidden();
  await expect(timer.getByText('Запись остановлена: максимум 60 с')).toBeVisible();
  await expect(page.locator('#error')).toBeHidden();
  // it is about that take: the next one clears it
  await afterGuard(page);
  await btn(page, 'Перезаписать').click();
  await expect(timer.getByText('Запись остановлена: максимум 60 с')).toBeHidden();
  await expect(timer.getByText('Пой!')).toBeVisible();
  await page.waitForTimeout(500);
  await btn(page, 'Завершить запись').click();
  await expect(btn(page, 'Перезаписать')).toBeVisible();
  expect(await timer.getByText('Запись остановлена: максимум 60 с').isVisible()).toBe(false);
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
  await afterGuard(page);
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

test('the sound error goes away once a sound does start', async ({ page }) => {
  await startGame(page);
  await recordA(page, 2000);
  await afterGuard(page);
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(AudioContext.prototype); // BaseAudioContext
    const state = Object.getOwnPropertyDescriptor(proto, 'state');
    Object.defineProperty(proto, 'state', { configurable: true, get: () => 'interrupted' });
    AudioContext.prototype.resume = () =>
      Promise.reject(new DOMException('resume blocked by test', 'InvalidStateError'));
    window.__unblockAudio = () => {
      Object.defineProperty(proto, 'state', state);
      delete AudioContext.prototype.resume;
    };
  });
  await btn(page, 'Переслушать').click();
  await expect(page.locator('#error')).toContainText('InvalidStateError: resume blocked by test');
  await page.evaluate(() => window.__unblockAudio());
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'false'); // the take ended
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#error')).toBeHidden();
});

test('a sound that starts does not clear an unrelated error', async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('quota hit by test', 'QuotaExceededError');
    };
  });
  await startGame(page);
  await recordA(page, 2000);
  await expect(page.locator('#error')).toContainText('QuotaExceededError: quota hit by test');
  await afterGuard(page);
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  await expect(page.locator('#error')).toContainText('QuotaExceededError: quota hit by test');
});

// Starts watching `selector`: window.__endedAt is set (page clock) the moment it
// gets hidden. window.__played turns true if any button starts playing after that.
async function watchHidden(page, selector) {
  await page.evaluate((sel) => {
    window.__endedAt = null;
    window.__played = false;
    new MutationObserver(() => {
      if (window.__endedAt !== null && document.querySelector('button.playing')) window.__played = true;
    }).observe(document.body, { subtree: true, attributeFilter: ['class'] });
    const node = document.querySelector(sel);
    new MutationObserver((_, o) => {
      if (!node.hidden) return;
      window.__endedAt = performance.now();
      o.disconnect();
    }).observe(node, { attributeFilter: ['hidden'] });
  }, selector);
}

// Taps the centre of `box` with the real mouse; returns ms between the take
// ending (watchHidden) and the tap reaching the page.
async function tapAt(page, box) {
  await page.evaluate(() => {
    document.addEventListener('click', () => (window.__tapAt = performance.now()), { capture: true, once: true });
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return page.evaluate(() => window.__tapAt - window.__endedAt);
}

test('A: a second tap where «Завершить запись» was does not play the take', async ({ page }) => {
  await startGame(page);
  await btn(page, 'Записать').click();
  const finish = btn(page, 'Завершить запись');
  await expect(finish).toBeVisible();
  await page.waitForTimeout(2000);
  const box = await finish.boundingBox();
  await watchHidden(page, '#btn-a-finish');
  await finish.click();
  await page.waitForFunction(() => window.__endedAt !== null, null, { polling: 'raf' });
  // the record/finish slot keeps its place; «Переслушать» is below it
  const rerecord = await btn(page, 'Перезаписать').boundingBox();
  expect(Math.abs(rerecord.y - box.y)).toBeLessThan(1);
  expect((await btn(page, 'Переслушать').boundingBox()).y).toBeGreaterThan(box.y + box.height);
  expect(await tapAt(page, box)).toBeLessThan(600);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__played)).toBe(false);
  expect(await finish.isVisible()).toBe(false); // nor a new take
  await expect(btn(page, 'Перезаписать')).toBeVisible();
  // once the guard is over the same spot works again
  await afterGuard(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(btn(page, 'Завершить запись')).toBeVisible();
});

test('B: a second tap where «Завершить запись» was is ignored', async ({ page }) => {
  await toB(page);
  await btn(page, 'Записать').click();
  const finish = btn(page, 'Завершить запись');
  await expect(finish).toBeVisible();
  await page.waitForTimeout(1000);
  const box = await finish.boundingBox();
  await watchHidden(page, '#btn-b-finish');
  await finish.click();
  await page.waitForFunction(() => window.__endedAt !== null, null, { polling: 'raf' });
  expect(Math.abs((await btn(page, 'Перезаписать').boundingBox()).y - box.y)).toBeLessThan(1);
  expect(await tapAt(page, box)).toBeLessThan(600);
  await page.waitForTimeout(300);
  expect(await finish.isVisible()).toBe(false); // no new take
  expect(await page.evaluate(() => window.__played)).toBe(false);
});

test('B: a double tap on «Дальше» moves one chunk only', async ({ page }) => {
  await toB(page);
  await recordB(page, 800);
  await btn(page, 'Дальше').click();
  await recordB(page, 800);
  await afterGuard(page);
  await btn(page, 'Назад').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 1 из 2');
  await afterGuard(page);
  await btn(page, 'Дальше').dblclick();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await page.waitForTimeout(300);
  await expect(section(page, 'B')).toBeVisible(); // not on to the result
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await afterGuard(page);
  await btn(page, 'Назад').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 1 из 2');
});

test('next goes to player B', async ({ page }) => {
  await startGame(page);
  await recordA(page, 2000);
  await btn(page, 'Дальше: игрок Б').click();
  await expect(page.locator('section[data-screen="B"]')).toBeVisible();
  await expect(page.locator('section[data-screen="A"]')).toBeHidden();
});

// ---- player B and the final screen ----

const section = (page, screen) => page.locator(`section[data-screen="${screen}"]`);

// A sings 4 s with 2 s chunks → 2 chunks; ends on «Кусок 1 из 2».
async function toB(page) {
  await startGame(page);
  await page.locator('#chunk-slider').fill('2');
  await recordA(page, 4000);
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '2');
  await btn(page, 'Дальше: игрок Б').click();
  await expect(section(page, 'B')).toBeVisible();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 1 из 2');
}

async function recordB(page, ms) {
  await btn(page, 'Записать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await page.waitForTimeout(ms);
  await btn(page, 'Завершить запись').click();
  await expect(btn(page, 'Переслушать мою')).toBeVisible();
}

test('full cycle: A → every B chunk → result', async ({ page }) => {
  await toB(page);
  for (let i = 1; i <= 2; i++) {
    await expect(page.locator('#chunk-label')).toHaveText(`Кусок ${i} из 2`);
    await btn(page, 'Послушать кусок').click();
    await expect(btn(page, 'Послушать кусок')).toHaveClass(/\bplaying\b/);
    await btn(page, 'Записать').click();
    await expect(btn(page, 'Послушать кусок')).not.toHaveClass(/\bplaying\b/);
    await page.waitForTimeout(1000);
    await btn(page, 'Завершить запись').click();
    await expect(btn(page, 'Переслушать мою')).toBeVisible();
    await expect(btn(page, 'Перезаписать')).toBeVisible();
    await btn(page, i < 2 ? 'Дальше' : 'К результату').click();
  }
  await expect(section(page, 'final')).toBeVisible();
  await expect(section(page, 'B')).toBeHidden();
  await btn(page, 'Слушать результат').click();
  await expect(btn(page, 'Слушать результат')).toHaveClass(/\bplaying\b/);
  const info = page.locator('#result-info');
  await expect(info).toHaveText(/^Результат: \d+,\d с$/);
  const sec = Number(await info.getAttribute('data-seconds'));
  expect(await info.getAttribute('data-seconds')).toMatch(/^\d+\.\d\d$/);
  expect(sec).toBeGreaterThan(1.5);
  expect(sec).toBeLessThan(3.0);
  // «Показать оригинал» takes over the single sound slot
  await btn(page, 'Показать оригинал').click();
  await expect(btn(page, 'Показать оригинал')).toHaveClass(/\bplaying\b/);
  await expect(btn(page, 'Слушать результат')).not.toHaveClass(/\bplaying\b/);
  // tapping the playing button stops it
  await btn(page, 'Показать оригинал').click();
  await expect(btn(page, 'Показать оригинал')).not.toHaveClass(/\bplaying\b/);
  await expect(page.locator('#error')).toBeHidden();
});

test('«Дальше» is disabled until the chunk has a take', async ({ page }) => {
  await toB(page);
  await expect(btn(page, 'Дальше')).toBeVisible();
  await expect(btn(page, 'Дальше')).toBeDisabled();
  await expect(btn(page, 'Назад')).toBeHidden(); // no chunk before the first
  await expect(btn(page, 'Переслушать мою')).toBeHidden();
  await recordB(page, 1000);
  await expect(btn(page, 'Дальше')).toBeEnabled();
});

test('B: playing the chunk while recording keeps the take, then plays', async ({ page }) => {
  await toB(page);
  await btn(page, 'Записать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await page.waitForTimeout(1000);
  await btn(page, 'Послушать кусок').click();
  await expect(btn(page, 'Переслушать мою')).toBeVisible();
  await expect(btn(page, 'Завершить запись')).toBeHidden();
  await expect(btn(page, 'Послушать кусок')).toHaveClass(/\bplaying\b/);
  await expect(btn(page, 'Дальше')).toBeEnabled();
});

test('«Назад» keeps the take of the previous chunk', async ({ page }) => {
  await toB(page);
  await recordB(page, 1000);
  await btn(page, 'Дальше').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await expect(btn(page, 'Переслушать мою')).toBeHidden();
  await expect(btn(page, 'К результату')).toBeDisabled();
  await afterGuard(page);
  await btn(page, 'Назад').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 1 из 2');
  await expect(btn(page, 'Переслушать мою')).toBeVisible();
  await expect(btn(page, 'Дальше')).toBeEnabled();
  await btn(page, 'Переслушать мою').click();
  await expect(btn(page, 'Переслушать мою')).toHaveClass(/\bplaying\b/);
});

test('B: «Дальше» and «Назад» are unavailable while recording or the mic is opening', async ({ page }) => {
  await slowMic(page);
  await toB(page);
  await recordB(page, 1000);
  await btn(page, 'Дальше').click();
  await recordB(page, 1000);
  await expect(btn(page, 'К результату')).toBeEnabled();
  await afterGuard(page);
  await page.evaluate(() => (window.__gumDelay = 1500));
  await btn(page, 'Перезаписать').click();
  // right away, while getUserMedia is still pending: both disabled, and even
  // programmatic taps must not change the chunk or the screen
  const whilePending = await page.evaluate(() => {
    const next = document.querySelector('#btn-b-next');
    const back = document.querySelector('#btn-b-back');
    const disabled = [next.disabled, back.disabled];
    for (const b of [next, back]) {
      b.click();
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    return disabled;
  });
  expect(whilePending).toEqual([true, true]);
  await page.waitForTimeout(3000); // mic is open now
  await expect(btn(page, 'К результату')).toBeDisabled();
  await expect(btn(page, 'Назад')).toBeDisabled();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await btn(page, 'Завершить запись').click();
  await expect(btn(page, 'Переслушать мою')).toBeVisible();
  await expect(btn(page, 'К результату')).toBeEnabled();
  await expect(btn(page, 'Назад')).toBeEnabled();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  expect(await liveTracks(page)).toBe(0);
});

test('B accepts an instant (empty) take', async ({ page }) => {
  await toB(page);
  await btn(page, 'Записать').click();
  await btn(page, 'Завершить запись').click();
  await expect(btn(page, 'Переслушать мою')).toBeVisible();
  await expect(btn(page, 'Дальше')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
});

test('B: an undecodable take is kept as silence and does not block «Дальше»', async ({ page }) => {
  await toB(page);
  await blockDecode(page);
  await recordB(page, 800);
  await expect(page.locator('#b-empty')).toBeVisible();
  await expect(btn(page, 'Дальше')).toBeEnabled();
  await expect(page.locator('#error')).toContainText('EncodingError: decode blocked by test');
  // the hint is about the stored take: it hides while a new one is being recorded
  await afterGuard(page);
  await btn(page, 'Перезаписать').click();
  await expect(btn(page, 'Завершить запись')).toBeVisible();
  await expect(page.locator('#b-empty')).toBeHidden();
  await page.waitForTimeout(500);
  await btn(page, 'Завершить запись').click();
  await expect(page.locator('#b-empty')).toBeVisible();
  await btn(page, 'Дальше').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await expect(page.locator('#b-empty')).toBeHidden();
  await recordB(page, 800);
  await btn(page, 'К результату').click();
  await expect(section(page, 'final')).toBeVisible();
  // two 0.1 s silences
  await expect(page.locator('#result-info')).toHaveAttribute('data-seconds', '0.20');
  await expect(page.locator('#result-info')).toHaveText('Результат: 0,2 с');
});

test('«Новая игра» on the final screen asks first', async ({ page }) => {
  await toB(page);
  await recordB(page, 800);
  await btn(page, 'Дальше').click();
  await recordB(page, 800);
  await btn(page, 'К результату').click();
  await expect(section(page, 'final')).toBeVisible();
  const messages = [];
  page.once('dialog', (d) => {
    messages.push(d.message());
    d.dismiss();
  });
  await btn(page, 'Новая игра').click();
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('Начать новую игру?');
  await expect(section(page, 'final')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await btn(page, 'Новая игра').click();
  await expect(section(page, 'start')).toBeVisible();
  await expect(section(page, 'final')).toBeHidden();
  await expect(page.locator('#chunk-value')).toHaveText('2 с'); // calibration kept
  // a fresh round starts on A with no take
  await btn(page, 'Новая игра').click();
  await expect(section(page, 'A')).toBeVisible();
  await expect(btn(page, 'Переслушать')).toBeHidden();
});

test('B: a take that decodes to nothing is kept as silence', async ({ page }) => {
  await toB(page);
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(AudioContext.prototype); // BaseAudioContext
    const empty = { numberOfChannels: 1, getChannelData: () => new Float32Array(0) };
    proto.decodeAudioData = function (data, ok) {
      if (ok) ok(empty);
      return Promise.resolve(empty);
    };
  });
  await recordB(page, 800);
  await expect(page.locator('#b-empty')).toBeVisible();
  await btn(page, 'Дальше').click();
  await recordB(page, 800);
  await btn(page, 'К результату').click();
  await expect(page.locator('#result-info')).toHaveAttribute('data-seconds', '0.20');
});

// ---- surviving a reload (IndexedDB) ----

const body = (page) => page.locator('body');

// Waits until every pending IndexedDB write has committed, reloads, and waits
// until the page has looked for a saved round.
async function reload(page) {
  await expect(body(page)).toHaveAttribute('data-saving', '0');
  await page.reload();
  await expect(body(page)).toHaveAttribute('data-saved-round', /^(yes|no)$/);
  await expect(section(page, 'start')).toBeVisible();
}

async function toFinal(page) {
  await toB(page);
  await recordB(page, 1000);
  await btn(page, 'Дальше').click();
  await recordB(page, 1000);
  await btn(page, 'К результату').click();
  await expect(section(page, 'final')).toBeVisible();
}

// Delays the first IndexedDB open of each page load by sessionStorage.idbDelay ms
// (sessionStorage survives reloads; no value = no delay).
async function slowStorage(page) {
  await page.addInitScript(() => {
    const delay = Number(sessionStorage.getItem('idbDelay')) || 0;
    if (!delay) return;
    const open = indexedDB.open.bind(indexedDB);
    const setOnSuccess = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess').set;
    let first = true;
    indexedDB.open = (...args) => {
      const req = open(...args);
      if (!first) return req;
      first = false;
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        set(fn) {
          setOnSuccess.call(req, (ev) => setTimeout(() => fn.call(req, ev), delay));
        },
      });
      return req;
    };
  });
}

// A round with one B take, saved, then a reload whose storage answers after `delay` ms.
async function reloadWithSlowStorage(page, delay) {
  await slowStorage(page);
  await toB(page);
  await recordB(page, 800);
  await expect(body(page)).toHaveAttribute('data-saving', '0');
  await page.evaluate((d) => sessionStorage.setItem('idbDelay', String(d)), delay);
  await page.reload();
  await expect(section(page, 'start')).toBeVisible();
}

test('«Новая игра» is disabled until the saved round has been looked for', async ({ page }) => {
  await reloadWithSlowStorage(page, 1500);
  await expect(btn(page, 'Новая игра')).toBeDisabled();
  await expect(body(page)).toHaveAttribute('data-saved-round', 'yes');
  await expect(btn(page, 'Новая игра')).toBeEnabled();
  await expect(btn(page, 'Продолжить')).toBeVisible();
});

test('storage that takes too long: «Новая игра» comes back but asks first', async ({ page }) => {
  await reloadWithSlowStorage(page, 6000);
  await expect(btn(page, 'Новая игра')).toBeDisabled();
  await expect(btn(page, 'Новая игра')).toBeEnabled({ timeout: 5000 });
  expect(await body(page).getAttribute('data-saved-round')).toBeNull(); // still looking
  const messages = [];
  page.once('dialog', (d) => {
    messages.push(d.message());
    d.dismiss();
  });
  await btn(page, 'Новая игра').click();
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('Начать новую игру?');
  await expect(section(page, 'start')).toBeVisible();
  await expect(btn(page, 'Продолжить')).toBeVisible({ timeout: 10_000 });
});

test('no «Продолжить» without a saved round', async ({ page }) => {
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-saved-round', 'no');
  await expect(btn(page, 'Продолжить')).toBeHidden();
  await expect(btn(page, 'Новая игра')).toBeVisible();
  // a round with nothing recorded yet is not worth continuing
  await btn(page, 'Новая игра').click();
  await expect(section(page, 'A')).toBeVisible();
  await reload(page);
  await expect(btn(page, 'Продолжить')).toBeHidden();
});

test('reload resumes', async ({ page }) => {
  await toB(page);
  await recordB(page, 1000);
  await btn(page, 'Дальше').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await reload(page);
  await expect(btn(page, 'Продолжить')).toBeVisible();
  await btn(page, 'Продолжить').click();
  await expect(section(page, 'B')).toBeVisible();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await expect(btn(page, 'Переслушать мою')).toBeHidden();
  await expect(btn(page, 'К результату')).toBeDisabled();
  await btn(page, 'Послушать кусок').click();
  await expect(btn(page, 'Послушать кусок')).toHaveClass(/\bplaying\b/);
  await btn(page, 'Назад').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 1 из 2');
  await expect(btn(page, 'Переслушать мою')).toBeVisible();
  await btn(page, 'Переслушать мою').click();
  await expect(btn(page, 'Переслушать мою')).toHaveClass(/\bplaying\b/);
  // the resumed round keeps going and keeps being saved
  await afterGuard(page);
  await btn(page, 'Дальше').click();
  await recordB(page, 1000);
  await reload(page);
  await btn(page, 'Продолжить').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await expect(btn(page, 'К результату')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
});

test('reload on screen A keeps the take and the chunk length', async ({ page }) => {
  await startGame(page);
  await page.locator('#chunk-slider').fill('2');
  await recordA(page, 4000);
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '2');
  await reload(page);
  await expect(page.locator('#chunk-value')).toHaveText('2 с');
  await btn(page, 'Продолжить').click();
  await expect(section(page, 'A')).toBeVisible();
  await expect(page.locator('#plan-info')).toHaveAttribute('data-n', '2');
  await expect(btn(page, 'Перезаписать')).toBeVisible();
  await btn(page, 'Переслушать').click();
  await expect(btn(page, 'Переслушать')).toHaveAttribute('aria-pressed', 'true');
  await btn(page, 'Дальше: игрок Б').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 1 из 2');
});

test('reload on the final screen restores a playable result', async ({ page }) => {
  await toFinal(page);
  const before = await page.locator('#result-info').getAttribute('data-seconds');
  expect(Number(before)).toBeGreaterThan(1.5);
  await reload(page);
  await btn(page, 'Продолжить').click();
  await expect(section(page, 'final')).toBeVisible();
  await expect(page.locator('#result-info')).toHaveAttribute('data-seconds', before);
  await btn(page, 'Слушать результат').click();
  await expect(btn(page, 'Слушать результат')).toHaveClass(/\bplaying\b/);
  await btn(page, 'Показать оригинал').click();
  await expect(btn(page, 'Показать оригинал')).toHaveClass(/\bplaying\b/);
  await expect(page.locator('#error')).toBeHidden();
});

test('a round saved at another sample rate still plays; seconds use the saved rate', async ({ page }) => {
  await toFinal(page);
  const before = Number(await page.locator('#result-info').getAttribute('data-seconds'));
  await expect(body(page)).toHaveAttribute('data-saving', '0');
  // pretend the takes were recorded at half this device's rate
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('pesnya-naoborot');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('kv', 'readwrite');
          const store = tx.objectStore('kv');
          const get = store.get('state');
          get.onsuccess = () => store.put({ ...get.result, sampleRate: get.result.sampleRate / 2 }, 'state');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await reload(page);
  await btn(page, 'Продолжить').click();
  await expect(section(page, 'final')).toBeVisible();
  const after = Number(await page.locator('#result-info').getAttribute('data-seconds'));
  expect(Math.abs(after - before * 2)).toBeLessThan(0.02);
  await btn(page, 'Слушать результат').click();
  await expect(btn(page, 'Слушать результат')).toHaveClass(/\bplaying\b/);
});

test('«Новая игра» after reload starts fresh and forgets the saved round', async ({ page }) => {
  await toB(page);
  await recordB(page, 1000);
  await reload(page);
  await expect(btn(page, 'Продолжить')).toBeVisible();
  // declining the prompt keeps the saved round
  const messages = [];
  page.once('dialog', (d) => {
    messages.push(d.message());
    d.dismiss();
  });
  await btn(page, 'Новая игра').click();
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('Начать новую игру?');
  await expect(btn(page, 'Продолжить')).toBeVisible();
  await reload(page);
  await expect(body(page)).toHaveAttribute('data-saved-round', 'yes');
  await expect(btn(page, 'Продолжить')).toBeVisible();
  // accepting it starts fresh
  page.once('dialog', (d) => d.accept());
  await btn(page, 'Новая игра').click();
  await expect(section(page, 'A')).toBeVisible();
  await expect(btn(page, 'Переслушать')).toBeHidden();
  await expect(btn(page, 'Записать')).toBeVisible();
  await reload(page);
  await expect(body(page)).toHaveAttribute('data-saved-round', 'no');
  await expect(btn(page, 'Продолжить')).toBeHidden();
});

test('«Новая игра» on the final screen forgets the saved round', async ({ page }) => {
  await toFinal(page);
  page.once('dialog', (d) => d.accept());
  await btn(page, 'Новая игра').click();
  await expect(section(page, 'start')).toBeVisible();
  await expect(btn(page, 'Продолжить')).toBeHidden();
  await reload(page);
  await expect(body(page)).toHaveAttribute('data-saved-round', 'no');
  await expect(btn(page, 'Продолжить')).toBeHidden();
});

// ---- «Сохранить запись» ----

const WAV_NAME = /^pesnya-naoborot-\d\d-\d\d\.wav$/;

// Replaces the share API: canShare accepts files, share keeps what it was given
// (and whether the tap's user activation was still active) and then rejects with
// the error name `failWith`, or resolves when it is null. With `failWith`
// 'none' there is no share API at all.
async function stubShare(page, failWith = null) {
  await page.addInitScript((failWith) => {
    window.__shared = [];
    if (failWith === 'none') {
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      return;
    }
    navigator.canShare = (data) => Boolean(data && data.files && data.files.length);
    let pending = false;
    navigator.share = async (data) => {
      window.__shared.push({ data, active: navigator.userActivation.isActive });
      // like WebKit: a second share while the sheet is open is refused
      if (pending) throw new DOMException('share already in progress', 'InvalidStateError');
      if (failWith === 'slow') {
        pending = true;
        await new Promise((r) => setTimeout(r, 1500));
        pending = false;
        return;
      }
      if (failWith) throw new DOMException('share failed by test', failWith);
    };
  }, failWith);
}

// What the stubbed share was given: the file's name, type, size and parsed header.
const sharedFile = (page) =>
  page.evaluate(async () => {
    if (!window.__shared.length) return null;
    const { data, active } = window.__shared[0];
    const f = data.files[0];
    const b = new Uint8Array(await f.arrayBuffer());
    const v = new DataView(b.buffer);
    const tag = (at) => String.fromCharCode(...b.subarray(at, at + 4));
    return {
      calls: window.__shared.length,
      active,
      title: data.title,
      count: data.files.length,
      name: f.name,
      type: f.type,
      size: f.size,
      riff: tag(0),
      wave: tag(8),
      rate: v.getUint32(24, true),
      dataBytes: v.getUint32(40, true),
    };
  });

// The same fields, read from a downloaded file.
const wavOfFile = (buf) => ({
  size: buf.length,
  riff: buf.toString('ascii', 0, 4),
  wave: buf.toString('ascii', 8, 12),
  rate: buf.readUInt32LE(24),
  dataBytes: buf.readUInt32LE(40),
});

// The saved WAV holds the result: its length over its rate is the shown duration.
async function expectResultWav(page, wav) {
  const sec = Number(await page.locator('#result-info').getAttribute('data-seconds'));
  expect(wav.riff).toBe('RIFF');
  expect(wav.wave).toBe('WAVE');
  expect(wav.size).toBe(44 + wav.dataBytes);
  const n = wav.dataBytes / 2;
  expect(Number.isInteger(n)).toBe(true);
  expect(Math.abs(n / wav.rate - sec)).toBeLessThanOrEqual(0.006);
}

test('«Сохранить запись» shares the result as a WAV file', async ({ page }) => {
  await stubShare(page);
  await toFinal(page);
  // it sits between the result and «Показать оригинал»
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('section[data-screen="final"] button, #result-info')].map(
      (n) => n.id,
    ),
  );
  expect(order).toEqual(['btn-result', 'result-info', 'btn-save', 'btn-original', 'btn-final-new']);
  // saving does not stop a playing result
  await btn(page, 'Слушать результат').click();
  await expect(btn(page, 'Слушать результат')).toHaveClass(/\bplaying\b/);
  await btn(page, 'Сохранить запись').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const wav = await sharedFile(page);
  expect(wav.active).toBe(true); // shared inside the tap, as iOS requires
  expect(wav.count).toBe(1);
  expect(wav.title).toBe('Песня наоборот');
  expect(wav.name).toMatch(WAV_NAME);
  expect(wav.type).toBe('audio/wav');
  await expectResultWav(page, wav);
  await expect(btn(page, 'Слушать результат')).toHaveClass(/\bplaying\b/);
  await expect(page.locator('#error')).toBeHidden();
});

test('«Сохранить запись» without a share API downloads the WAV', async ({ page }) => {
  await stubShare(page, 'none');
  await toFinal(page);
  const download = page.waitForEvent('download');
  await btn(page, 'Сохранить запись').click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(WAV_NAME);
  await expectResultWav(page, wavOfFile(await readFile(await d.path())));
  await expect(page.locator('#error')).toBeHidden();
});

test('«Сохранить запись» cancelled in the share sheet: no error, no download', async ({ page }) => {
  await stubShare(page, 'AbortError');
  await toFinal(page);
  let downloads = 0;
  page.on('download', () => (downloads += 1));
  await btn(page, 'Сохранить запись').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator('#error')).toBeHidden();
  expect(downloads).toBe(0);
  // it can be tapped again
  await btn(page, 'Сохранить запись').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(2);
});

test('«Сохранить запись» when sharing fails: real error, then a download', async ({ page }) => {
  await stubShare(page, 'NotAllowedError');
  await toFinal(page);
  const download = page.waitForEvent('download');
  await btn(page, 'Сохранить запись').click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(WAV_NAME);
  await expect(page.locator('#error')).toContainText('NotAllowedError: share failed by test');
});

test('«Сохранить запись» works on a final screen restored after a reload', async ({ page }) => {
  await stubShare(page);
  await toFinal(page);
  await reload(page);
  await btn(page, 'Продолжить').click();
  await expect(section(page, 'final')).toBeVisible();
  await btn(page, 'Сохранить запись').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const wav = await sharedFile(page);
  expect(wav.name).toMatch(WAV_NAME);
  expect(Number(await page.locator('#result-info').getAttribute('data-seconds'))).toBeGreaterThan(1.5);
  await expectResultWav(page, wav);
  await expect(page.locator('#error')).toBeHidden();
});

test('IndexedDB that cannot open: real error once, the game still works', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('open blocked by test', 'SecurityError');
    };
  });
  await page.goto('./');
  await expect(page.locator('#error')).toContainText('SecurityError: open blocked by test');
  await expect(btn(page, 'Продолжить')).toBeHidden();
  await btn(page, 'Новая игра').click();
  await page.locator('#chunk-slider').fill('2');
  await recordA(page, 4000);
  await btn(page, 'Дальше: игрок Б').click();
  await recordB(page, 800);
  await expect(btn(page, 'Дальше')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden(); // shown once, not on every save
});

test('IndexedDB writes failing (quota): real error once, the game still works', async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('quota hit by test', 'QuotaExceededError');
    };
  });
  await startGame(page);
  await page.locator('#chunk-slider').fill('2');
  await recordA(page, 4000);
  await expect(page.locator('#error')).toContainText('QuotaExceededError: quota hit by test');
  await expect(btn(page, 'Дальше: игрок Б')).toBeVisible();
  await btn(page, 'Дальше: игрок Б').click();
  await recordB(page, 800);
  await btn(page, 'Дальше').click();
  await recordB(page, 800);
  await btn(page, 'К результату').click();
  await expect(section(page, 'final')).toBeVisible();
  await expect(page.locator('#error')).toBeHidden();
  await reload(page);
  await expect(btn(page, 'Продолжить')).toBeHidden();
});

test('an IndexedDB request that fails later shows its real error', async ({ page }) => {
  // put → add: the first write of a key works, rewriting it fails asynchronously
  // (ConstraintError on the request, then the transaction aborts)
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function (value, key) {
      return this.add(value, key);
    };
  });
  await startGame(page);
  await page.locator('#chunk-slider').fill('2');
  await recordA(page, 4000);
  await btn(page, 'Дальше: игрок Б').click(); // rewrites 'state'
  await expect(page.locator('#error')).toContainText('ConstraintError: ');
  await expect(page.locator('#error')).not.toContainText('null');
  await expect(section(page, 'B')).toBeVisible();
  await recordB(page, 800);
  await expect(btn(page, 'Дальше')).toBeEnabled();
});

test('a transient IndexedDB failure is retried on a fresh connection', async ({ page }) => {
  await page.addInitScript(() => {
    window.__opens = 0;
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      window.__opens += 1;
      return open(...args);
    };
    window.__failNextWrite = false;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode) {
      if (mode === 'readwrite' && window.__failNextWrite) {
        window.__failNextWrite = false;
        throw new DOMException('connection lost by test', 'InvalidStateError');
      }
      return transaction.call(this, names, mode);
    };
  });
  await toB(page);
  await expect(body(page)).toHaveAttribute('data-saving', '0');
  const opensBefore = await page.evaluate(() => window.__opens);
  await page.evaluate(() => (window.__failNextWrite = true));
  await recordB(page, 1000);
  await btn(page, 'Дальше').click();
  await expect(body(page)).toHaveAttribute('data-saving', '0');
  expect(await page.evaluate(() => window.__opens)).toBeGreaterThan(opensBefore);
  await expect(page.locator('#error')).toBeHidden();
  await reload(page);
  await btn(page, 'Продолжить').click();
  await expect(page.locator('#chunk-label')).toHaveText('Кусок 2 из 2');
  await btn(page, 'Назад').click();
  await expect(btn(page, 'Переслушать мою')).toBeVisible();
});

test('«Продолжить» that fails half-way leaves the saved round on offer', async ({ page }) => {
  await toFinal(page);
  const before = await page.locator('#result-info').getAttribute('data-seconds');
  await reload(page);
  await page.evaluate(() => {
    const real = Float32Array.prototype.slice;
    Float32Array.prototype.slice = function () {
      Float32Array.prototype.slice = real;
      throw new RangeError('slice blocked by test');
    };
  });
  await btn(page, 'Продолжить').click();
  await expect(page.locator('#error')).toContainText('RangeError: slice blocked by test');
  await expect(section(page, 'start')).toBeVisible();
  await expect(btn(page, 'Продолжить')).toBeVisible();
  await btn(page, 'Продолжить').click();
  await expect(section(page, 'final')).toBeVisible();
  await expect(page.locator('#result-info')).toHaveAttribute('data-seconds', before);
  await btn(page, 'Слушать результат').click();
  await expect(btn(page, 'Слушать результат')).toHaveClass(/\bplaying\b/);
});

test('home-screen manifest is linked and its icons are served as PNG', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href, page.url()).href;
  const res = await request.get(manifestUrl);
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.name).toBe('Песня наоборот');
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const r = await request.get(new URL(icon.src, manifestUrl).href);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type'], icon.src).toContain('image/png');
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const tr = await request.get(new URL(touch, page.url()).href);
  expect(tr.status()).toBe(200);
  expect(tr.headers()['content-type']).toContain('image/png');
});

test('«Сохранить запись» double tap opens one share sheet, no error, no download', async ({ page }) => {
  await stubShare(page, 'slow');
  await toFinal(page);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await btn(page, 'Сохранить запись').dblclick();
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__shared.length)).toBe(1);
  await expect(page.locator('#error')).toBeHidden();
  expect(downloads).toBe(0);
  // after the sheet closes, saving works again
  await btn(page, 'Сохранить запись').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(2);
});
