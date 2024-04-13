import {
  Application,
  json,
  urlencoded,
  Response,
  Request,
  NextFunction,
} from 'express';

import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import cookieSession from 'cookie-session';
import HTTP_STATUS from 'http-status-codes';
import 'express-async-errors';
import compression from 'compression';
import Logger from 'bunyan';
import { config } from './config';
import { Server } from 'socket.io'; //밑에서 http.Server랑 다름. 걔는 http에 있는 거고. 이건 socket.io의 Server임
//그래서 앞에 . 붙는 거로 구분해서 사용할 예정
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  CustomError,
  IErrorResponse,
} from './shared/globals/helpers/error-handler';
import applicationRoutes from './routes';

const SERVER_PORT = 5000;
const log: Logger = config.createLogger('server');

export class ChattyServer {
  private app: Application; //이 type Application은 express에서 오는 거임 위에서 import한거

  constructor(app: Application) {
    this.app = app;
  }

  public start(): void {
    this.securityMiddleware(this.app);
    this.standardMiddleware(this.app);
    this.routeMiddleware(this.app);
    this.globalErrorHandler(this.app);
    this.startServer(this.app);
  }

  private securityMiddleware(app: Application): void {
    app.use(
      cookieSession({
        name: 'session',
        keys: [config.SECRET_KEY_ONE, config.SECRET_KEY_TWO],
        maxAge: 24 * 7 * 3600 * 1000,
        //secure: false, //local에서는 false도 오케이 https로 배포하면 true해야함
        secure: config.NODE_ENV !== 'development', //development가 아니면 local이니까 false
      }),
    );
    app.use(hpp());
    app.use(helmet());
    app.use(
      cors({
        origin: config.CLIENT_URL, //모든 주소에서 가능하도록 cors제한없이.  나중에는 특정주소로 바꿀거
        credentials: true, //true안해두면 뭔일생겨?
        optionsSuccessStatus: 200, //오래된 익스플로러때문에
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], //허가된 요청들
      }),
    );
  }

  private standardMiddleware(app: Application): void {
    app.use(compression());
    app.use(json({ limit: '50mb' })); //서버 클라이언트 통신에서 json제한을 50mb로
    app.use(urlencoded({ extended: true, limit: '50mb' })); //이것도 비슷
  }

  private routeMiddleware(app: Application): void {
    applicationRoutes(app);
  }

  private globalErrorHandler(app: Application): void {
    app.all('*', (req: Request, res: Response) => {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ message: `${req.originalUrl} not found` });
    });

    app.use(
      (
        error: IErrorResponse,
        _req: Request,
        res: Response,
        next: NextFunction,
      ) => {
        log.error(error);
        if (error instanceof CustomError) {
          return res.status(error.statusCode).json(error.serializeErrors());
        }
        next();
      },
    );
  }

  private async startServer(app: Application): Promise<void> {
    try {
      const httpServer: http.Server = new http.Server(app);
      const socketIO: Server = await this.createSocketIO(httpServer);
      this.startHttpServer(httpServer);
      this.socketIOConnections(socketIO);
    } catch (error) {
      log.error(error);
    }
  }
  private async createSocketIO(httpServer: http.Server): Promise<Server> {
    const io: Server = new Server(httpServer, {
      cors: {
        origin: config.CLIENT_URL,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      },
    });
    const pubClient = createClient({ url: config.REDIS_HOST });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    return io;
  }

  private startHttpServer(httpServer: http.Server): void {
    log.info(`Server has started with process ${process.pid}`);
    httpServer.listen(SERVER_PORT, () => {
      log.info(`Server running on port ${SERVER_PORT}`);
    });
  }

  private socketIOConnections(_io: Server): void {}
}
