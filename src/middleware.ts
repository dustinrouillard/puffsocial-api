import fp from "fastify-plugin";
import { connections, users } from "@prisma/client";
import { FastifyPluginAsync } from "fastify/types/plugin";

import { keydb } from "./connectivity/redis";
import { prisma } from "./connectivity/prsima";
import { UserFlags } from "./constants";

declare module "fastify" {
  interface FastifyRequest {
    user: users;
    linkedConnection: connections;
  }
}

interface AuthOptions {
  admin?: boolean;
  required?: boolean;
}

const middlewareCallback: FastifyPluginAsync<AuthOptions> = async function (
  server,
  options
) {
  server.addHook("preParsing", async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization && options.required)
      return res
        .status(403)
        .send({ error: true, code: "missing_authorization" });

    const session = (await keydb.hgetall(`sessions/${authorization}`)) as {
      user_id: string;
      connection_id: string;
    };
    if (!session && options.required)
      return res
        .status(403)
        .send({ error: true, code: "invalid_authentication" });

    if (session) {
      const user = await prisma.users.findFirst({
        where: { id: session.user_id },
      });
      if (!user && options.required)
        return res
          .status(403)
          .send({ error: true, code: "invalid_authentication" });
      if (user) req.user = user;

      const connnection = await prisma.connections.findFirst({
        where: { id: session.connection_id },
      });
      if (!user && options.required)
        return res
          .status(403)
          .send({ error: true, code: "invalid_authentication" });
      if (connnection) req.linkedConnection = connnection;

      if (options.admin && !((user?.flags || 0) & UserFlags.admin))
        return res
          .status(401)
          .send({ error: true, code: "invalid_permissions" });
    }
  });
};

export const AuthMiddleware = fp(middlewareCallback);
