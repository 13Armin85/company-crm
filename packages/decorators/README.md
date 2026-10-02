# `@plane/decorators`

کتابخانه‌ای سبک برای ساخت کنترلرهای Express.js با TypeScript و نگارشی خوانا و اعلانی.

## قابلیت‌ها

- طراحی‌شده برای TypeScript
- دکوراتورهای متدهای HTTP شامل GET، POST، PUT، PATCH و DELETE
- پشتیبانی از WebSocket و middleware
- قابل استفادهٔ مستقیم در فایل‌های TypeScript و بدون مرحلهٔ build جداگانه

## نصب

این بسته بخشی از workspace پلین است. آن را به وابستگی‌های پروژه اضافه کنید:

```json
{
  "dependencies": {
    "@plane/decorators": "workspace:*"
  }
}
```

## روش استفاده

### کنترلر REST

```typescript
import { Controller, Get, Post, BaseController } from "@plane/decorators";
import { Router, Request, Response } from "express";

@Controller("/api/users")
class UserController extends BaseController {
  @Get("/")
  async getUsers(req: Request, res: Response) {
    return res.json({ users: [] });
  }

  @Post("/")
  async createUser(req: Request, res: Response) {
    return res.json({ success: true });
  }
}

// ثبت مسیرها
const router = Router();
const userController = new UserController();
userController.registerRoutes(router);
```

### کنترلر WebSocket

```typescript
import { Controller, WebSocket, BaseWebSocketController } from "@plane/decorators";
import { Request } from "express";
import { WebSocket as WS } from "ws";

@Controller("/ws/chat")
class ChatController extends BaseWebSocketController {
  @WebSocket("/")
  handleConnection(ws: WS, req: Request) {
    ws.on("message", (message) => {
      ws.send(`Received: ${message}`);
    });
  }
}

// ثبت مسیرهای WebSocket
const router = require("express-ws")(app).router;
const chatController = new ChatController();
chatController.registerWebSocketRoutes(router);
```

## مرجع API

### دکوراتورها

- `@Controller(baseRoute: string)`: تعیین مسیر پایه برای کلاس
- `@Get(route: string)`: تعریف endpoint با متد GET
- `@Post(route: string)`: تعریف endpoint با متد POST
- `@Put(route: string)`: تعریف endpoint با متد PUT
- `@Patch(route: string)`: تعریف endpoint با متد PATCH
- `@Delete(route: string)`: تعریف endpoint با متد DELETE
- `@WebSocket(route: string)`: تعریف endpoint از نوع WebSocket
- `@Middleware(middleware: RequestHandler)`: اعمال middleware روی متد

### کلاس‌ها

- `BaseController`: کلاس پایهٔ کنترلرهای REST
- `BaseWebSocketController`: کلاس پایهٔ کنترلرهای WebSocket

## مجوز

این پروژه تحت [GNU Affero General Public License v3.0](https://github.com/makeplane/plane/blob/master/LICENSE.txt) منتشر شده است.
