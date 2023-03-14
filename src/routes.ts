import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { ZodError } from "zod"
  ;
import { pika } from "./pika";
import { diagValidation, feedbackValidation, sanitize, trackingValidation, verifyRequest } from "./utils";
import { prisma } from "./connectivity/prsima";

export function Routes(server: FastifyInstance, opts: FastifyPluginOptions, next: () => void) {
  server.get('/leaderboard', async (req, res) => {
    const leaderboards = await prisma.leaderboard.findMany({ orderBy: { total_dabs: 'desc' }, take: 10 });
    for (const lb of leaderboards) sanitize(lb, ['last_ip']);

    return res.status(200).send({ success: true, data: { leaderboards } });
  });

  server.post('/track', async (req, res) => {
    if (!req.headers['x-signature']) return res.status(400).send({ code: 'invalid_tracking_data' });
    const body = await verifyRequest(Buffer.from(req.rawBody as string, 'base64'), req.headers['x-signature'] as string);
    const validate = await trackingValidation.parseAsync(body);

    const id = pika.gen('leaderboard');
    const ip = (req.headers['cf-connecting-ip'] || req.connection.remoteAddress || '0.0.0.0') as string;
    const deviceId = Buffer.from(validate.device.id, 'base64').toString('utf8');
    const deviceUid = Buffer.from(validate.device.uid, 'base64').toString('utf8');

    if (isNaN(Number(deviceId)) || isNaN(Number(deviceUid)))
      return res.status(400).send({ code: 'invalid_tracking_data' });

    const deviceBirthday = new Date(Number(deviceId) * 1000);
    const generatedDeviceId = `device_${Buffer.from(`${deviceUid}-${deviceBirthday.toISOString()}`).toString('base64')}`;

    const existing = await prisma.leaderboard.findFirst({ where: { device_id: generatedDeviceId } });
    if (existing) {
      await prisma.leaderboard.update({
        data: {
          device_name: validate.device.name,
          device_dob: deviceBirthday,
          device_model: validate.device.model,
          owner_name: validate.name,
          total_dabs: validate.device.totalDabs,
          last_active: new Date().toISOString(),
          last_ip: ip,
        },
        where: {
          device_id: generatedDeviceId
        }
      });
    } else {
      await prisma.leaderboard.create({
        data: {
          id,
          device_id: generatedDeviceId,
          device_name: validate.device.name,
          device_dob: deviceBirthday,
          device_model: validate.device.model,
          owner_name: validate.name,
          total_dabs: validate.device.totalDabs,
          last_ip: ip,
        }
      });
    }

    return res.status(204).send();
  });

  server.post('/diag', async (req, res) => {
    if (!req.headers['x-signature']) return res.status(400).send({ code: 'invalid_diag_data' });
    const body = await verifyRequest(Buffer.from(req.rawBody as string, 'base64'), req.headers['x-signature'] as string);
    const validate = await diagValidation.parseAsync(body);

    const id = pika.gen('diagnostics');
    const ip = (req.headers['cf-connecting-ip'] || req.connection.remoteAddress || '0.0.0.0') as string;
    const userAgent = req.headers["user-agent"];

    await prisma.diagnostics.create({
      data: {
        id,
        device_name: validate.device_name,
        device_model: validate.device_model,
        device_firmware: validate.device_firmware,
        user_agent: userAgent || 'unknown',
        ip,
      }
    });

    return res.status(204).send();
  });

  server.post('/feedback', async (req, res) => {
    try {
      if (!req.headers['x-signature']) return res.status(400).send({ code: 'invalid_feedback_request' });
      const body = await verifyRequest(Buffer.from(req.rawBody as string, 'base64'), req.headers['x-signature'] as string);
      const validate = await feedbackValidation.parseAsync(body);

      const id = pika.gen('feedback');
      const ip = (req.headers['cf-connecting-ip'] || req.connection.remoteAddress || '0.0.0.0') as string;

      await prisma.feedback.create({
        data: {
          id, message: validate.message, ip
        }
      });

      return res.status(204).send();
    } catch (error) {
      if (error instanceof ZodError)
        return res.status(400).send({ success: false, error: { code: 'validation_error', issues: error.issues } });


      console.error('error with feedback', error);
      return res.status(500).send({ success: false, error: { code: 'internal_error' } });
    }

  });

  return next();
}