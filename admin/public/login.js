const form = document.querySelector('#login-form');
const code = document.querySelector('#code');
const button = document.querySelector('#login-submit');
const errorMessage = document.querySelector('#login-error');

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  errorMessage.textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value.trim() }),
    });
    if (response.ok) {
      location.reload();
      return;
    }
    if (response.status === 429) {
      const result = await response.json().catch(() => null);
      const value = response.headers.get('Retry-After');
      const headerDelay = value && /^\d+$/.test(value) ? Number(value) : value ? (Date.parse(value) - Date.now()) / 1000 : 0;
      const delay = Math.max(1, Math.ceil(headerDelay || result?.retryAfter || 30));
      const until = Date.now() + delay * 1000;
      while (Date.now() < until) {
        errorMessage.textContent = Math.ceil((until - Date.now()) / 1000) + '초 후 다시 접속할 수 있습니다.';
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('접속 코드를 확인한 뒤 다시 시도해주세요.');
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new Error('접속 코드를 확인해주세요.');
    }
    throw new Error('관리자 페이지에 접속하지 못했습니다.');
  } catch (error) {
    errorMessage.textContent = error instanceof TypeError ? '연결 상태를 확인한 뒤 다시 시도해주세요.' : error.message;
    code.select();
    button.disabled = false;
  }
});
