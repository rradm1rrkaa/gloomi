// Runs against a local Vite server. API fixtures stay in this browser session;
// no database, email, storage, or production service is contacted.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomInt } from 'node:crypto';

const browser = process.env.BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!browser) throw new Error('Set BROWSER_PATH to a Chromium browser executable.');
const origin = process.env.UI_ORIGIN || 'http://127.0.0.1:5173';
const output = resolve('.cache/ui-smoke'); mkdirSync(output, { recursive: true });
const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9337', `--user-data-dir=${output}/browser`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9337/json')).json(); if (targets.length) break; } catch {}
    await delay(200);
  }
  if (!targets?.length) throw new Error('Browser debugging endpoint did not start.');
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  let id = 0; const pending = new Map();
  function call(method, params = {}) {
    const request = ++id;
    return new Promise((resolve, reject) => {
      pending.set(request, { resolve, reject }); socket.send(JSON.stringify({ id: request, method, params }));
    });
  }
  const user = { id: 'viewer', username: 'gloomi.user', email: 'test@example.com', profile: { displayName: 'Ваш профиль', bio: 'Мои моменты', visibility: 'PUBLIC' } };
  const author = { id: 'author', username: 'anna.sokolova', profile: { displayName: 'Анна Соколова' } };
  const media = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="636"><rect width="780" height="636" fill="#dbd0fa"/><circle cx="480" cy="260" r="160" fill="#b7a0ed"/><path d="M0 500L230 270 550 636H0" fill="#7450ba"/></svg>');
  const post = { id: 'post-1', caption: 'Маленькие моменты большого дня', mediaUrl: media, mediaType: 'IMAGE', createdAt: '2026-11-09T10:00:00Z', author, liked: false, saved: false, _count: { likes: 3, comments: 1 } };
  const comments = [{ id: 'c1', body: 'Красивый момент', user: author, createdAt: post.createdAt }];
  const requests = []; let signedIn = false; let registrationCalls = 0; let resendCalls = 0;
  const verificationCode = String(randomInt(200000, 999999));
  const requestAccepted = () => ({ message: 'Запрос принят. Если адрес ожидает подтверждения, проверьте почту и «Спам».', retryAfterSeconds: resendCalls === 2 ? 6 : 1, expiresAt: new Date(Date.now() + 600000).toISOString() });
  const errors = [];
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p?.reject(new Error(message.error.message)) : p?.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const url = new URL(request.url); const path = url.pathname.replace(/^\/api/, '');
    requests.push(`${request.method} ${path}`);
    let result = {}; let status = 200;
    if (request.method === 'OPTIONS') status = 204;
    else if (path === '/auth/csrf') result = { csrfToken: signedIn ? 'fixture-csrf' : null };
    else if (path === '/auth/refresh') { status = signedIn ? 200 : 401; result = { accessToken: 'fixture-token', csrfToken: 'fixture-csrf' }; }
    else if (path === '/auth/login') {
      if (JSON.parse(request.postData).email === 'pending@example.com') { status = 401; result = { verificationRequired: true, code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Подтвердите email.' }; }
      else { signedIn = true; result = { accessToken: 'fixture-token', csrfToken: 'fixture-csrf' }; }
    }
    else if (path === '/auth/register') {
      registrationCalls++;
      result = { verificationRequired: true, delivery: 'not_requested', message: 'Продолжите подтверждение электронной почты или войдите в аккаунт.' };
    }
    else if (path === '/auth/resend-code') {
      resendCalls++;
      if (resendCalls === 1) { status = 503; result = { code: 'EMAIL_DELIVERY_FAILED', verificationRequired: true, retryAfterSeconds: 1, message: 'SMTP временно недоступен. Повторите отправку.' }; }
      else if (resendCalls === 3) { status = 429; result = { code: 'EMAIL_CODE_COOLDOWN', retryAfterSeconds: 1, message: 'Подождите перед повторной отправкой.' }; }
      else result = requestAccepted();
    }
    else if (path === '/auth/verify-email') {
      const code = JSON.parse(request.postData).code;
      if (code !== verificationCode) { status = 400; result = { code: 'INVALID_VERIFICATION_CODE', message: code === '111111' ? 'Срок действия кода истёк.' : 'Код неверен.' }; }
      else { signedIn = true; result = { accessToken: 'fixture-token', csrfToken: 'fixture-csrf' }; }
    }
    else if (path === '/auth/logout') { signedIn = false; result = { ok: true }; }
    else if (path === '/suggestions') result = [{ ...author, _count: { posts: 1, followers: 12 } }];
    else if (path === '/follow-requests') result = [];
    else if (path === '/auth/me') result = user;
    else if (path === '/feed') result = { items: [post], nextCursor: null };
    else if (path === '/stories') result = [];
    else if (path === '/explore') result = [post];
    else if (path === '/search/users') result = [{ ...author, _count: { followers: 12 } }];
    else if (path === '/posts/post-1/like') { post.liked = !post.liked; post._count.likes += post.liked ? 1 : -1; result = { liked: post.liked, count: post._count.likes }; }
    else if (path === '/posts/post-1/save') { post.saved = !post.saved; result = { saved: post.saved }; }
    else if (path === '/posts/post-1/comments') {
      if (request.method === 'POST') { comments.push({ id: 'c2', body: JSON.parse(request.postData).body, user, createdAt: post.createdAt }); post._count.comments++; }
      result = comments;
    }
    else if (path === '/saved') result = post.saved ? [{ post }] : [];
    else if (path.startsWith('/profiles/')) result = { ...user, counts: { posts: 0, followers: 2, following: 3 }, posts: [] };
    else if (path === '/notifications' || path === '/conversations') result = [];
    else if (!path.startsWith('/auth/password-reset/')) { status = 404; result = { message: `Unhandled fixture: ${path}` }; }
    await call('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [
      { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin },
      { name: 'Access-Control-Allow-Credentials', value: 'true' }, { name: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization,X-CSRF-Token' },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,OPTIONS' },
    ], body: Buffer.from(status === 204 ? '' : JSON.stringify(result)).toString('base64') });
  };
  async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
  async function wait(expression, label) { for (let i=0;i<80;i++) { if(await evaluate(expression)) return; await delay(100); } throw new Error(`Failed: ${label}`); }
  async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
  async function fill(selector, value) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
  async function screenshot(name) { const { data } = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${output}/${name}.png`, Buffer.from(data, 'base64')); }
  async function pasteCode(value) { await evaluate(`(()=>{const transfer=new DataTransfer();transfer.setData('text',${JSON.stringify(value)});document.querySelector('.otp-cells input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));})()`); }
  await call('Runtime.enable'); await call('Page.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*://localhost:*/api/*' },{ urlPattern: '*://127.0.0.1:*/api/*' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin });
  await wait(`!!document.querySelector('.auth-card form')`, 'login screen');
  await evaluate('document.fonts.ready'); await screenshot('desktop-login');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('mobile-login');
  if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('Login horizontal overflow');
  await click('.forgot-password'); await wait(`!!document.querySelector('.reset-wrap')`, 'reset screen');
  await fill('input[type=email]', 'test@example.com'); await click('.stack .primary');
  await wait(`!!document.querySelector('input[autocomplete="one-time-code"]')`, 'reset confirmation');
  await fill('input[autocomplete="one-time-code"]', '123456'); await fill('input[type=password]', 'newpassword1234'); await click('.stack .primary');
  await wait(`document.body.innerText.includes('Пароль обновлён')`, 'reset complete');
  await click('.stack a.primary'); await wait(`!!document.querySelector('.forgot-password')`, 'back to login');
  await click('.auth-switch button'); await fill('input[autocomplete=username]', 'new.user');
  await fill('input[type=email]', 'test@example.com'); await fill('input[type=password]', 'password1234'); await click('.stack .primary');
  await wait(`!!document.querySelector('.verification-request')`, 'registration opens request step');
  if(await evaluate(`!!document.querySelector('.otp-cells')`)) throw new Error('Request step must not display code inputs');
  if(resendCalls !== 0) throw new Error('Registration must not send automatically');
  if(await evaluate(`document.querySelector('.verification-request input').value`) !== 'test@example.com') throw new Error('Registration email lost');
  await screenshot('mobile-verification-request');
  await call('Page.reload'); await wait(`!!document.querySelector('.verification-request')`, 'request step survives reload');
  if(registrationCalls !== 1 || resendCalls !== 0) throw new Error('Reload must not register/send automatically');
  await click('.verification-request .primary'); await wait(`document.body.innerText.includes('SMTP временно недоступен')`, 'SMTP failure on request');
  if(await evaluate(`!!document.querySelector('.otp-cells')`)) throw new Error('SMTP failure must stay on request step');
  if(await evaluate(`!!document.querySelector('[role=status]')`)) throw new Error('SMTP failure must not show delivery success');
  await wait(`!document.querySelector('.verification-request .primary').disabled`, 'SMTP failure cooldown');
  await click('.verification-request .primary'); await wait(`document.querySelectorAll('.otp-cells input').length===6`, 'accepted request opens six-cell code step');
  if(await evaluate(`!!document.querySelector('input[type=email]')`)) throw new Error('Code step must not display email field');
  await screenshot('mobile-verification-code');
  for (const width of [320, 390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error(`Verification overflow at ${width}px`);
  }
  await pasteCode('000000');
  await wait(`Array.from(document.querySelectorAll('.otp-cells input')).map(e=>e.value).join('')==='000000'`, 'full code paste');
  if(!(await evaluate(`document.activeElement===document.querySelectorAll('.otp-cells input')[5]`))) throw new Error('Paste focus did not advance');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  if(!(await evaluate(`document.activeElement===document.querySelectorAll('.otp-cells input')[4]`))) throw new Error('OTP arrow navigation failed');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  if(await evaluate(`document.querySelectorAll('.otp-cells input')[4].value`) !== '') throw new Error('OTP backspace failed');
  await fill('.otp-cells input:nth-child(5)', '0');
  if(!(await evaluate(`document.activeElement===document.querySelectorAll('.otp-cells input')[5]`))) throw new Error('Digit entry did not advance focus');
  await click('.verification-code .primary'); await wait(`!!document.querySelector('[role=alert]')`, 'incorrect code error');
  await pasteCode('111111'); await click('.verification-code .primary'); await wait(`!!document.querySelector('[role=alert]')`, 'expired code error');
  const beforeReload = resendCalls;
  await call('Page.reload'); await wait(`document.querySelectorAll('.otp-cells input').length===6`, 'code step survives reload');
  if(resendCalls !== beforeReload) throw new Error('Reload must not resend');
  if(await evaluate(`Array.from(document.querySelectorAll('.otp-cells input')).some(e=>e.value)`)) throw new Error('OTP must not persist across reload');
  const stored = await evaluate(`JSON.parse(sessionStorage.getItem('gloomi.email-verification.v1'))`);
  if(stored.email !== 'test@example.com' || stored.step !== 'code' || !stored.retryAt || 'code' in stored || 'password' in stored) throw new Error('Invalid persisted verification state');
  await wait(`!!document.querySelector('.resend-code')`, 'resend control after reload');
  if(!(await evaluate(`document.querySelector('.resend-code').disabled`))) throw new Error('Backend cooldown lost on reload');
  await click('.verification-back'); await wait(`!!document.querySelector('.verification-request')`, 'back to request step');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await screenshot('desktop-verification-request');
  await click('.verification-request .text-button'); await wait(`!!document.querySelector('.verification-code')`, 'return to code without resending');
  await screenshot('desktop-verification-code');
  await wait(`!document.querySelector('.resend-code').disabled`, 'backend resend cooldown');
  await click('.resend-code'); await wait(`document.body.innerText.includes('Подождите перед повторной отправкой')`, 'server cooldown response');
  await wait(`!document.querySelector('.resend-code').disabled`, 'server cooldown respected');
  await click('.resend-code'); await wait(`!!document.querySelector('[role=status]')`, 'resend accepted');
  await pasteCode(verificationCode); await click('.verification-code .primary');
  await wait(`!!document.querySelector('.post')`, 'verification signs in');
  if(await evaluate(`sessionStorage.getItem('gloomi.email-verification.v1')`)) throw new Error('Verification draft not cleared after success');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('.mobile-nav button:nth-child(5)'); await wait(`!!document.querySelector('[aria-label="Выйти из аккаунта"]')`, 'mobile profile');
  await click('[aria-label="Выйти из аккаунта"]'); await wait(`!!document.querySelector('.forgot-password')`, 'logout after verification');
  await fill('input[type=email]', 'pending@example.com'); await fill('input[type=password]', 'password1234'); await click('.stack .primary');
  await wait(`!!document.querySelector('.verification-request')`, 'unverified login opens first step');
  if(resendCalls !== 4) throw new Error('Unverified login must not send automatically');
  await click('.back-to-login'); await wait(`!!document.querySelector('.forgot-password')`, 'back to login');
  await click('.auth-switch button'); await fill('input[autocomplete=username]', 'new.user');
  await fill('input[type=email]', 'test@example.com'); await fill('input[type=password]', 'password1234'); await click('.stack .primary');
  await wait(`!!document.querySelector('.verification-request')`, 'existing account continuation');
  if(registrationCalls !== 2 || resendCalls !== 4) throw new Error('Existing account continuation must not send automatically');
  await click('.back-to-login'); await wait(`!!document.querySelector('.forgot-password')`, 'back to login after existing account');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await fill('input[type=email]', 'test@example.com'); await fill('input[type=password]', 'password1234'); await click('.stack .primary');
  await wait(`!!document.querySelector('.post')`, 'authenticated feed');
  await click('button[aria-label="Нравится"]');
  await wait(`document.querySelector('button[aria-label="Нравится"]').getAttribute('aria-pressed')==='true'`, 'like persisted');
  await click('button[aria-label="Комментарии"]');
  await wait(`document.body.innerText.includes('Красивый момент')`, 'comments loaded');
  await fill('.comment-form input', 'Проверка комментария'); await click('.comment-form button');
  await wait(`document.querySelector('.comments-list').innerText.includes('Проверка комментария')`, 'comment submitted');
  await click('button[aria-label="Сохранить"]');
  await wait(`document.querySelector('button[aria-label="Сохранить"]').getAttribute('aria-pressed')==='true'`, 'bookmark persisted');
  await screenshot('desktop-feed');
  await click('.sidebar a[href="/saved"]'); await wait(`!!document.querySelector('.saved-page .post')`, 'saved collection');
  await click('button[aria-label="Сохранить"]'); await wait(`document.body.innerText.includes('Сохраните что-нибудь особенное')`, 'unsave updates collection');
  await click('.sidebar a[href="/profile"]'); await wait(`document.body.innerText.includes('Мои моменты')`, 'own profile');
  if(requests.includes('GET /profiles/profile')) throw new Error('Own profile regression');
  await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 1000, deviceScaleFactor: 1, mobile: false });
  if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('Tablet horizontal overflow');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('.mobile-nav button:nth-child(1)'); await wait(`!!document.querySelector('.post')`, 'mobile feed');
  await screenshot('mobile-feed');
  for (const width of [320, 360, 375, 390, 393, 412, 430, 768]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width <= 768 });
    await wait(`document.documentElement.clientWidth===${width}`, `viewport ${width}px`);
    if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error(`Mobile/tablet feed horizontal overflow at ${width}px`);
    if (width === 390) await screenshot('mobile-feed-390');
    if (width === 768) await screenshot('tablet-feed-768');
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('Landscape feed horizontal overflow at 844x390');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('.mobile-nav button:nth-child(5)'); await wait(`!!document.querySelector('.figma-profile')`, 'mobile profile');
  for (const width of [320, 390, 430]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error(`Profile horizontal overflow at ${width}px`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('.mobile-header a[href="/messages"]'); await wait(`!!document.querySelector('.messenger')`, 'mobile direct messages');
  for (const width of [320, 390, 430]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error(`Direct messages horizontal overflow at ${width}px`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('.mobile-nav button:nth-child(1)'); await wait(`!!document.querySelector('.post')`, 'mobile feed');
  await click('.mobile-nav button:nth-child(2)'); await wait(`!!document.querySelector('.searchbar')`, 'mobile search');
  await fill('.searchbar input', 'anna'); await wait(`!!document.querySelector('.user-results .person-result')`, 'user search');
  await click('.mobile-nav button:nth-child(4)'); await wait(`document.body.innerText.includes('Ваши люди скоро будут здесь')`, 'notifications');
  await click('.mobile-nav button:nth-child(3)'); await wait(`!!document.querySelector('[role=dialog]')`, 'create dialog');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(`!document.querySelector('[role=dialog]')`, 'escape closes create dialog');
  if(errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: two-step verification, SMTP failure/retry, six-cell paste/focus, invalid/expired codes, backend cooldown, resend, reload persistence without OTP, existing/unverified account entry, sign-in, password reset, feed and mobile/tablet navigation. API fixtures only.');
  console.log(`Screenshots: ${output}`);
  await call('Browser.close').catch(()=>{});
} finally { socket?.close(); child.kill(); }
