// Observable real-runtime tests: first frame, WASM/WebGL, focus, local IDBFS,
// iframe identity/reload, account restore, and recoverable fullscreen denial.

import { expect, test } from '@playwright/test';

async function waitForRuntime(pageOrFrame) {
  await pageOrFrame.waitForFunction(() => ['running', 'error'].includes(window.__taiseiDiagnostics?.runtimeState));
  const state = await pageOrFrame.evaluate(() => ({ ...window.__taiseiDiagnostics }));
  if (state.runtimeState === 'error') {
    const detail = await pageOrFrame.evaluate(() => ({
      status: document.querySelector('#status')?.textContent,
      fsMethods: Object.entries(window.__taiseiModule?.FS || {})
        .filter(([, value]) => typeof value === 'function')
        .map(([name, value]) => ({ name, arity: value.length, source: value.toString().slice(0, 180) })),
    }));
    throw new Error(JSON.stringify(detail));
  }
  return state;
}

test('standalone boots as guest and restores a local IDBFS file', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?diagnostics=1');
  const state = await waitForRuntime(page);
  expect(state).toMatchObject({
    authMode: 'guest',
    webAssembly: true,
    webgl2: true,
    indexedDB: true,
    wasmInstantiated: true,
    firstFrame: true,
  });

  await page.getByRole('button', { name: 'Focus game' }).click();
  await expect(page.locator('#canvas')).toBeFocused();
  await page.evaluate(async () => {
    await window.__taiseiTest.writeAllowedFile('config', '# astranet-local-e2e\n');
    await window.__taiseiTest.flushLocal();
  });
  await page.reload();
  await waitForRuntime(page);
  const restored = await page.evaluate(() => window.__taiseiTest.readAllowedFile('config'));
  expect(restored).toContain('astranet-local-e2e');

  await page.evaluate(() => {
    HTMLCanvasElement.prototype.requestFullscreen = () => Promise.reject(new Error('denied by test'));
  });
  await page.getByRole('button', { name: 'Fullscreen' }).click();
  await expect(page.locator('#warning')).toContainText('Fullscreen is unavailable');
  expect(pageErrors).toEqual([]);
});

test('test host completes identity, iframe reload, and cross-context server restore', async ({ browser }) => {
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const pageErrors = [];
  firstPage.on('pageerror', (error) => pageErrors.push(error.message));
  await firstPage.goto('/test-host/');
  let frame = firstPage.frame({ url: /diagnostics=1/ });
  expect(frame).not.toBeNull();
  const state = await waitForRuntime(frame);
  expect(state.authMode).toBe('astra');
  await expect(firstPage.locator('#events')).toContainText('identity requested');
  await expect(firstPage.locator('#events')).toContainText('identity issued');
  await frame.evaluate(async () => {
    await window.__taiseiTest.writeAllowedFile('config', '# astranet-account-e2e\n');
    await window.__taiseiTest.flushLocal();
    await window.__taiseiTest.syncNow();
  });
  expect(await frame.locator('#save-state').textContent()).toMatch(/synced r[1-9]/);

  await firstPage.getByRole('button', { name: 'Reload iframe' }).click();
  await expect(firstPage.locator('#events')).toContainText('iframe reloaded');
  frame = firstPage.frame({ url: /diagnostics=1/ });
  await waitForRuntime(frame);
  expect((await frame.evaluate(() => window.__taiseiDiagnostics.authMode))).toBe('astra');
  await firstContext.close();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto('/test-host/');
  const secondFrame = secondPage.frame({ url: /diagnostics=1/ });
  await waitForRuntime(secondFrame);
  const restored = await secondFrame.evaluate(() => window.__taiseiTest.readAllowedFile('config'));
  expect(restored).toContain('astranet-account-e2e');
  expect(pageErrors).toEqual([]);
  await secondContext.close();
});
