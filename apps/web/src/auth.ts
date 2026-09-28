import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

const uac = 'http://tncimweb1.cminl.oa/uacapi/adAuth';
const tokenKey = 'CIM_TK';
const refreshKey = 'CIM_RTK';

@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  token() { return sessionStorage.getItem(tokenKey); }

  async initialize() {
    const url = new URL(location.href);
    const certificateKey = url.searchParams.get('CertificateKey');
    try {
      if (certificateKey) {
        const result = await firstValueFrom(this.http.post<{ token: string; refreshToken: string }>(`${uac}/VerifyCert`, { CertificateKey: certificateKey }));
        this.save(result);
        url.searchParams.delete('CertificateKey');
        history.replaceState({}, '', url.toString());
        const pending = sessionStorage.getItem('reportReturnPath');
        sessionStorage.removeItem('reportReturnPath');
        if (pending) history.replaceState({}, '', `${url.pathname}${url.search}#${pending}`);
      } else if (!this.token() && sessionStorage.getItem(refreshKey)) {
        const result = await firstValueFrom(this.http.post<{ token: string; refreshToken: string }>(`${uac}/RefreshToken`, { refreshToken: sessionStorage.getItem(refreshKey) }));
        this.save(result);
      }
    } catch { this.clear(); }
  }

  async enter(path: string) {
    sessionStorage.setItem('reportReturnPath', path);
    const urls = await firstValueFrom(this.http.get<{ loginPage: string }>(`${uac}/SsoUrl`));
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete('CertificateKey');
    returnUrl.hash = '';
    location.assign(`${urls.loginPage}?url=${encodeURIComponent(returnUrl.toString())}`);
  }

  clear() { sessionStorage.removeItem(tokenKey); sessionStorage.removeItem(refreshKey); }
  private save(user: { token: string; refreshToken: string }) {
    sessionStorage.setItem(tokenKey, user.token);
    sessionStorage.setItem(refreshKey, user.refreshToken);
  }
}

export const apiToken: HttpInterceptorFn = (request, next) => {
  const token = inject(Auth).token();
  return next(token && request.url.startsWith('/api/') ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);
};

export const editorGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const http = inject(HttpClient);
  const router = inject(Router);
  if (!auth.token()) { await auth.enter(state.url); return false; }
  try {
    const me = await firstValueFrom(http.get<{ role: string }>('/api/me'));
    return me.role === 'Guy' || me.role === 'Head' ? true : router.parseUrl('/forbidden');
  } catch (error: any) {
    if (error.status === 401) { auth.clear(); await auth.enter(state.url); return false; }
    return router.parseUrl('/forbidden');
  }
};
