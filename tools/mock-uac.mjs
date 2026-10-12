// 本機 mock UAC：免內網即可開發。用法：node tools/mock-uac.mjs [port]
// 提供 /auth/SsoUrl、/auth/VerifyCert、/auth/RefreshToken、/auth/login（假登入頁）與 /.well-known/jwks.json。
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const port = Number(process.argv[2] || 5090);
const origin = `http://localhost:${port}`;
const users = JSON.parse(readFileSync(new URL('../apps/api/appsettings.json', import.meta.url), 'utf8')).Access.Users;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

// JWT 無 kid，與正式 UAC 一致（JwtVerifier 會拒絕帶 kid 的 token）。
function jwt(empNo) {
  const p = `${b64({ alg: 'RS256' })}.${b64({ empNo, exp: Math.floor(Date.now() / 1000) + 8 * 3600 })}`;
  return `${p}.${createSign('RSA-SHA256').update(p).sign(privateKey).toString('base64url')}`;
}
// CertificateKey / refreshToken 直接編成 mock-<empNo>，免存狀態；重新整理頁面也能續登。
const login = key => {
  const empNo = String(key ?? '').replace(/^mock-/, '');
  return users.some(u => u.EmpNo === empNo) ? { token: jwt(empNo), refreshToken: `mock-${empNo}` } : null;
};

const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c).on('end', () => r(s ? JSON.parse(s) : {})); });

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  const url = new URL(req.url, origin);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (url.pathname === '/.well-known/jwks.json') return json(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), alg: 'RS256' }] });
  if (url.pathname === '/auth/SsoUrl') return json(res, 200, { loginPage: `${origin}/auth/login` });
  if (url.pathname === '/auth/VerifyCert' || url.pathname === '/auth/RefreshToken') {
    const b = await body(req);
    const result = login(b.CertificateKey ?? b.refreshToken);
    return result ? json(res, 200, result) : json(res, 401, { error: 'unknown mock user' });
  }
  if (url.pathname === '/auth/login') {
    const back = url.searchParams.get('url') ?? '';
    const rows = users.map(u => {
      const to = new URL(back); to.searchParams.set('CertificateKey', `mock-${u.EmpNo}`);
      return `<li><a href="${to.href.replace(/&/g, '&amp;')}">${u.Name}（${u.Role}${u.Section ? ' ' + u.Section : ''}，${u.EmpNo}）</a></li>`;
    });
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<meta charset="utf-8"><h3>Mock UAC：選擇登入身分</h3><ul>${rows.join('')}</ul>`);
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`Mock UAC ${origin}
  API : JwksUrl=${origin}/.well-known/jwks.json （環境變數，重啟 mock 後需重啟 API，金鑰每次不同）
  Web : apps/web/src/assets/config.json 的 uacBaseUrl 暫改為 ${origin}/auth （勿提交）`));
