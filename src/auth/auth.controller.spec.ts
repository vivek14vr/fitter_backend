import type { Response } from 'express';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

describe('AuthController refresh cookie', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  function createController() {
    const authService = {
      login: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1', role: 'admin' },
      }),
    } as unknown as AuthService;
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;
    return { controller: new AuthController(authService), response, cookie };
  }

  it('allows the production refresh cookie on cross-site credentialed requests', async () => {
    process.env.NODE_ENV = 'production';
    const { controller, response, cookie } = createController();

    await controller.login.bind(controller)({ email: 'admin@example.com', password: 'password' }, response);

    expect(cookie).toHaveBeenCalledWith(
      'deepti_refresh_token',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        path: '/auth',
      }),
    );
  });

  it('keeps local development compatible with localhost cookies', async () => {
    process.env.NODE_ENV = 'test';
    const { controller, response, cookie } = createController();

    await controller.login.bind(controller)({ email: 'admin@example.com', password: 'password' }, response);

    expect(cookie).toHaveBeenCalledWith(
      'deepti_refresh_token',
      'refresh-token',
      expect.objectContaining({ sameSite: 'lax', secure: false }),
    );
  });
});
